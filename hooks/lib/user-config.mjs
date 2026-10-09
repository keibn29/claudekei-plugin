// Optional JSONC config file, modelled on oh-my-openkei's oh-my-openkei.jsonc.
//
//   ~/.claude/claudekei.jsonc            user config
//   <project>/.claude/claudekei.jsonc    project overrides (wins per field)
//
// `.jsonc` takes precedence over `.json` in the same folder. A missing or broken
// file is ignored so hooks keep failing open.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EFFORT_LEVELS, MODEL_ALIASES } from './config.mjs';

/**
 * Walks `text` outside of string literals, letting `onCode(i)` consume code
 * characters; it returns the next index to visit (or undefined for i + 1).
 */
function scanCode(text, onCode) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    const next = onCode(i, (s) => (out += s));
    if (next !== undefined) i = next;
  }
  return out;
}

/** JSON with `//` and `/* *\/` comments and trailing commas. */
export function parseJsonc(text) {
  const noComments = scanCode(text, (i, emit) => {
    if (text[i] === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      emit('\n');
      return end === -1 ? text.length : end;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      return end === -1 ? text.length : end + 1;
    }
    emit(text[i]);
    return undefined;
  });
  const noTrailingCommas = scanCode(noComments, (i, emit) => {
    if (noComments[i] === ',' && /^\s*[}\]]/.test(noComments.slice(i + 1))) return i;
    emit(noComments[i]);
    return undefined;
  });
  return JSON.parse(noTrailingCommas);
}

function readConfigFile(dir) {
  for (const name of ['claudekei.jsonc', 'claudekei.json']) {
    let text;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    try {
      const parsed = parseJsonc(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

/** Per-agent settings: the active preset first, then the top-level `agents` map. */
function agentEntries(config) {
  const merged = {};
  const preset = isObject(config.presets) ? config.presets[config.preset] : undefined;
  for (const source of [preset, config.agents]) {
    if (!isObject(source)) continue;
    for (const [name, entry] of Object.entries(source)) {
      if (isObject(entry)) merged[name] = { ...merged[name], ...entry };
    }
  }
  return merged;
}

// Specialists only take the Agent tool's aliases (checked in applyAgentConfig);
// primary agents may use any model id the `model` setting accepts.
function normalizeAgent(entry) {
  const result = {};
  const model = typeof entry.model === 'string' ? entry.model.trim() : '';
  if (model) result.model = MODEL_ALIASES.has(model.toLowerCase()) ? model.toLowerCase() : model;
  const effort = entry.effort ?? entry.variant;
  if (typeof effort === 'string' && EFFORT_LEVELS.has(effort.toLowerCase())) {
    result.effort = effort.toLowerCase();
  }
  return result;
}

export function loadUserConfig(projectDir, home = homedir()) {
  const user = readConfigFile(join(home, '.claude'));
  const project = projectDir ? readConfigFile(join(projectDir, '.claude')) : {};

  const agents = {};
  for (const config of [user, project]) {
    for (const [name, entry] of Object.entries(agentEntries(config))) {
      agents[name] = { ...agents[name], ...normalizeAgent(entry) };
    }
  }
  const sessionManager = {
    ...(isObject(user.sessionManager) ? user.sessionManager : {}),
    ...(isObject(project.sessionManager) ? project.sessionManager : {}),
  };
  return { agents, sessionManager };
}
