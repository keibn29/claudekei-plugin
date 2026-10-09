// Optional JSONC config file, modelled on oh-my-openkei's oh-my-openkei.jsonc but
// with a single `subAgents` map (agent name -> { model, effort }) instead of named presets.
// `presets` is the deprecated former name of `subAgents` and is still accepted.
// `primaryAgents` holds the same shape for the four primary agents; hooks cannot change
// the main thread's model, so only the ClaudeKei VS Code extension applies it.
//
//   ~/.claude/claudekei.jsonc            user config
//   <project>/.claude/claudekei.jsonc    project overrides (wins per field)
//
// `.jsonc` takes precedence over `.json` in the same folder. A missing or broken
// file is ignored so hooks keep failing open.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EFFORT_LEVELS, MODEL_ALIASES, PRIMARY_AGENTS } from './config.mjs';

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

function normalizeAgent(label, entry, warn) {
  const result = {};
  if (entry.model !== undefined) {
    const model = typeof entry.model === 'string' ? entry.model.trim().toLowerCase() : '';
    if (MODEL_ALIASES.has(model)) result.model = model;
    else warn(`${label}.model ${JSON.stringify(entry.model)} ignored`);
  }
  if (entry.effort !== undefined) {
    const effort = typeof entry.effort === 'string' ? entry.effort.trim().toLowerCase() : '';
    if (EFFORT_LEVELS.has(effort)) result.effort = effort;
    else warn(`${label}.effort ${JSON.stringify(entry.effort)} ignored`);
  }
  return result;
}

// A full model id such as "claude-opus-5-5": one token, no whitespace.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/;

// Like normalizeAgent, but `model` may also be a full model id.
function normalizePrimaryAgent(name, entry, warn) {
  const result = {};
  if (entry.model !== undefined) {
    const model = typeof entry.model === 'string' ? entry.model.trim() : '';
    if (MODEL_ALIASES.has(model.toLowerCase())) result.model = model.toLowerCase();
    else if (MODEL_ID.test(model)) result.model = model;
    else warn(`primaryAgents.${name}.model ${JSON.stringify(entry.model)} ignored`);
  }
  if (entry.effort !== undefined) {
    const effort = typeof entry.effort === 'string' ? entry.effort.trim().toLowerCase() : '';
    if (EFFORT_LEVELS.has(effort)) result.effort = effort;
    else warn(`primaryAgents.${name}.effort ${JSON.stringify(entry.effort)} ignored`);
  }
  return result;
}

export function loadUserConfig(projectDir, home = homedir()) {
  const user = readConfigFile(join(home, '.claude'));
  const project = projectDir ? readConfigFile(join(projectDir, '.claude')) : {};
  const warnings = [];

  const agents = {};
  const primaryAgents = {};
  let usedLegacyKey = false;
  for (const config of [user, project]) {
    // `presets` is the deprecated alias of `subAgents`; inside one file a `subAgents`
    // entry replaces the same-named `presets` entry, then files merge per field.
    const fileAgents = {};
    for (const key of ['presets', 'subAgents']) {
      if (config[key] === undefined) continue;
      if (key === 'presets') usedLegacyKey = true;
      if (!isObject(config[key])) {
        warnings.push(`${key} must be an object, ignored`);
        continue;
      }
      for (const [name, entry] of Object.entries(config[key])) {
        if (!isObject(entry)) {
          warnings.push(`${key}.${name} must be an object, ignored`);
          continue;
        }
        fileAgents[name] = normalizeAgent(`${key}.${name}`, entry, (message) => warnings.push(message));
      }
    }
    for (const [name, entry] of Object.entries(fileAgents)) {
      agents[name] = { ...agents[name], ...entry };
    }
    if (config.primaryAgents === undefined) continue;
    if (!isObject(config.primaryAgents)) {
      warnings.push('primaryAgents must be an object, ignored');
      continue;
    }
    for (const [name, entry] of Object.entries(config.primaryAgents)) {
      if (!PRIMARY_AGENTS.has(name)) {
        warnings.push(`primaryAgents.${name} is not a primary agent, ignored`);
      } else if (!isObject(entry)) {
        warnings.push(`primaryAgents.${name} must be an object, ignored`);
      } else {
        const preset = normalizePrimaryAgent(name, entry, (message) => warnings.push(message));
        primaryAgents[name] = { ...primaryAgents[name], ...preset };
      }
    }
  }
  if (usedLegacyKey) warnings.push('`presets` is deprecated, rename to `subAgents`');
  // Where /claudekei:agent saves the default agent: "project" (default) or "global".
  const scopes = [project.agentScope, user.agentScope];
  const agentScope = scopes.find((value) => value === 'global' || value === 'project') ?? 'project';
  const sessionManager = {
    ...(isObject(user.sessionManager) ? user.sessionManager : {}),
    ...(isObject(project.sessionManager) ? project.sessionManager : {}),
  };
  return { agents, primaryAgents, agentScope, sessionManager, warnings };
}

/**
 * Configured default model/effort for one primary agent (bare name, e.g.
 * "planner"): `{ model?, effort? }` with project values winning per field,
 * or null when claudekei.jsonc does not set it.
 */
export function getPrimaryAgentPreset(name, projectDir, home = homedir()) {
  const preset = loadUserConfig(projectDir, home).primaryAgents[name];
  return preset && Object.keys(preset).length > 0 ? preset : null;
}
