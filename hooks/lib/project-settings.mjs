// Reads and writes the `agent` key of the project's .claude/settings.local.json,
// which Claude Code reads at session start to pick the main-thread agent.

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

export function readAgent(projectDir) {
  const value = readSettings(settingsPath(projectDir)).agent;
  return typeof value === 'string' ? value : null;
}

/** Sets `agent` (or removes it when `agent` is null), keeping every other key. */
export function writeAgent(projectDir, agent) {
  const file = settingsPath(projectDir);
  const settings = readSettings(file);
  if (agent) settings.agent = agent;
  else delete settings.agent;
  mkdirSync(join(projectDir, '.claude'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(tmp, file);
}
