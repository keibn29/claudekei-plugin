// Reads and writes the `agent` key that Claude Code reads at session start to
// pick the main-thread agent: in the project's .claude/settings.local.json, or
// in ~/.claude/settings.json when claudekei.jsonc sets "agentScope": "global".

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function projectSettingsPaths(projectDir) {
  return [
    join(projectDir, '.claude', 'settings.local.json'),
    join(projectDir, '.claude', 'settings.json'),
  ];
}

export function userSettingsPath(home = homedir()) {
  return join(home, '.claude', 'settings.json');
}

function readSettings(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return parsed;
}

export function readAgent(file) {
  const value = readSettings(file).agent;
  return typeof value === 'string' ? value : null;
}

/**
 * Sets `agent` (or removes it when null) and keeps every other key.
 * `leftovers` are the `model`/`effortLevel` values v0.4.0 wrote; each is
 * removed only while it is unchanged, so a value set by hand survives.
 */
export function writeAgent(file, agent, leftovers = {}) {
  const settings = readSettings(file);
  if (agent) settings.agent = agent;
  else delete settings.agent;
  for (const [key, value] of Object.entries(leftovers)) {
    if (settings[key] === value) delete settings[key];
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(tmp, file);
}
