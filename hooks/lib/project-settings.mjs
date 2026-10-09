// Reads and writes the session defaults in the project's .claude/settings.local.json,
// which Claude Code reads at session start: `agent` (main-thread agent), `model`
// and `effortLevel` (only defaults; the app's model picker and /model still win).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function settingsPath(projectDir) {
  return join(projectDir, '.claude', 'settings.local.json');
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

const MANAGED_KEYS = ['agent', 'model', 'effortLevel'];

export function readDefaults(projectDir) {
  const settings = readSettings(settingsPath(projectDir));
  const result = {};
  for (const key of MANAGED_KEYS) {
    if (typeof settings[key] === 'string') result[key] = settings[key];
  }
  return result;
}

/**
 * Sets each managed key that `values` defines and keeps every other key.
 * `agent` is removed when null. `model`/`effortLevel` without a value are
 * removed only while they still equal what this plugin wrote last time
 * (`owned`), so a value the user set by hand survives. Returns the new
 * `owned` record for the caller to persist.
 */
export function writeDefaults(projectDir, values, owned = {}) {
  const file = settingsPath(projectDir);
  const settings = readSettings(file);
  if (values.agent) settings.agent = values.agent;
  else delete settings.agent;
  const nextOwned = {};
  for (const key of ['model', 'effortLevel']) {
    if (values[key]) {
      settings[key] = values[key];
      nextOwned[key] = values[key];
    } else if (owned[key] !== undefined && settings[key] === owned[key]) {
      delete settings[key];
    }
  }
  mkdirSync(join(projectDir, '.claude'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(tmp, file);
  return nextOwned;
}
