// Per-session state file with a cross-process lock.
//
// Hooks run as separate processes and parallel Agent calls fire their
// PostToolUse hooks concurrently, so every read-modify-write goes through
// withState(), which serializes on a mkdir lock and writes atomically.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { STATE_TTL_MS } from './config.mjs';
import { createState } from './sessions.mjs';

const LOCK_STALE_MS = 5_000;
const LOCK_TIMEOUT_MS = 3_000;

function dataDir() {
  return (
    process.env.CLAUDE_PLUGIN_DATA ||
    join(homedir(), '.claude', 'plugins', 'data', 'claudekei')
  );
}

export function stateDir() {
  return join(dataDir(), 'sessions');
}

// Values /claudekei:agent last wrote into each project's settings.local.json.
const ownedFile = () => join(dataDir(), 'project-defaults.json');

function readOwnedMap() {
  try {
    const parsed = JSON.parse(readFileSync(ownedFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readOwned(projectDir) {
  return readOwnedMap()[projectDir] ?? {};
}

export function writeOwned(projectDir, owned) {
  const map = readOwnedMap();
  if (Object.keys(owned).length > 0) map[projectDir] = owned;
  else delete map[projectDir];
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${ownedFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(map));
  renameSync(tmp, ownedFile());
}

function safeId(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function statePath(dir, sessionId) {
  return join(dir, `${safeId(sessionId)}.json`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lockPath);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for state lock ${lockPath}`);
      }
      sleep(15);
    }
  }
}

export function readState(sessionId, dir = stateDir()) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dir, sessionId), 'utf8'));
    if (parsed?.version === 1 && Array.isArray(parsed.children)) return parsed;
  } catch {
    // Missing or corrupt state starts fresh.
  }
  return createState();
}

/**
 * Run `fn(state)` under the session lock. When `fn` returns a value other
 * than `false`, the (possibly mutated) state is persisted.
 */
export function withState(sessionId, fn, dir = stateDir()) {
  mkdirSync(dir, { recursive: true });
  const file = statePath(dir, sessionId);
  const lockPath = `${file}.lock`;
  acquireLock(lockPath);
  try {
    const state = readState(sessionId, dir);
    const result = fn(state);
    if (result !== false) {
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, file);
    }
    return { state, result };
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function deleteState(sessionId, dir = stateDir()) {
  rmSync(statePath(dir, sessionId), { force: true });
}

export function pruneStale(dir = stateDir(), now = Date.now()) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs > STATE_TTL_MS) rmSync(file, { force: true });
    } catch {
      // Another process may have removed it already.
    }
  }
}
