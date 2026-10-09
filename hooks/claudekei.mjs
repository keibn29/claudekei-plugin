#!/usr/bin/env node
// Single entry point for every claudekei hook. Claude Code pipes the
// hook payload as JSON on stdin; we print an optional JSON decision on stdout.
// Any failure is swallowed so a broken hook never blocks the session.

import { readFileSync } from 'node:fs';
import { loadLimits } from './lib/config.mjs';
import { handle } from './lib/handlers.mjs';
import * as store from './lib/store.mjs';
import { loadUserConfig } from './lib/user-config.mjs';

try {
  const raw = readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : null;
  const config = loadUserConfig(process.env.CLAUDE_PROJECT_DIR || input?.cwd);
  const output = handle(input, {
    store,
    limits: loadLimits(config.sessionManager),
    agents: config.agents,
  });
  if (output) process.stdout.write(JSON.stringify(output));
} catch (error) {
  process.stderr.write(`[claudekei] hook error: ${error?.message ?? error}\n`);
}
process.exit(0);
