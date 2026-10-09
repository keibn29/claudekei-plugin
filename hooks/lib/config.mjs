// Static configuration shared by the hook handlers.

export const PLUGIN_NAME = 'claudekei';

export const PRIMARY_AGENTS = new Set([
  'orchestrator',
  'planner',
  'sprinter',
  'business-analyst',
]);

// Slash commands (skills/<command>/SKILL.md) that switch the primary agent
// mode inside the current conversation.
export const MODE_COMMANDS = {
  orchestrate: 'orchestrator',
  plan: 'planner',
  sprint: 'sprinter',
  analyze: 'business-analyst',
};

// Primary agents that receive the workflow reminder before each user prompt.
export const REMINDER_AGENTS = new Set(['orchestrator', 'planner', 'sprinter']);

// Primary agents that receive the delegation nudge after Read/Write.
export const NUDGE_AGENTS = new Set(['orchestrator', 'planner']);

// Which specialists each primary agent may delegate to. `null` = no limit.
export const DELEGATE_SETS = {
  orchestrator: null,
  sprinter: null,
  planner: new Set(['explorer', 'librarian', 'oracle', 'designer']),
  'business-analyst': new Set(['explorer', 'librarian', 'oracle']),
};

export const ALIAS_PREFIXES = {
  explorer: 'exp',
  librarian: 'lib',
  oracle: 'ora',
  debugger: 'dbg',
  designer: 'des',
  'frontend-developer': 'fed',
  'backend-developer': 'bed',
  'trigger-developer': 'trg',
  observer: 'obs',
  'general-purpose': 'gen',
};

export const PHASE_REMINDER_TEXT = `!IMPORTANT! Recall the workflow rules:
Understand → choose the best parallelized path based on your capabilities and agents delegation rules → recall session reuse rules → execute → verify.
If delegating, launch the specialist in the same turn you mention it !END!`;

export const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function intFromEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function loadLimits() {
  return {
    maxSessionsPerAgent: intFromEnv('KEI_MAX_SESSIONS_PER_AGENT', 2, 1, 10),
    readContextMinLines: intFromEnv('KEI_READ_CONTEXT_MIN_LINES', 10, 0, 1000),
    readContextMaxFiles: intFromEnv('KEI_READ_CONTEXT_MAX_FILES', 8, 0, 50),
    phaseReminder: process.env.KEI_PHASE_REMINDER !== '0',
  };
}
