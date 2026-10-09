// Pure session-alias logic. No I/O here so it stays unit-testable.
//
// A "child" is a subagent launched from the main thread. Claude Code keeps
// every subagent resumable via SendMessage(to: agentId); this module only
// maps short aliases (exp-1, ora-2, ...) onto those agent ids and decides
// which ones are worth advertising to the primary agent.

import {
  ALIAS_PREFIXES,
  DELEGATE_SETS,
  MODE_COMMANDS,
  PLUGIN_NAME,
  PRIMARY_AGENTS,
} from './config.mjs';

export function createState() {
  return { version: 1, mode: null, counters: {}, children: [] };
}

/** `claudekei:explorer` -> `explorer`; `general-purpose` stays as is. */
export function shortType(agentType) {
  if (typeof agentType !== 'string') return '';
  const idx = agentType.lastIndexOf(':');
  return idx === -1 ? agentType : agentType.slice(idx + 1);
}

export function aliasPrefix(agentType) {
  const type = shortType(agentType);
  if (ALIAS_PREFIXES[type]) return ALIAS_PREFIXES[type];
  const letters = type.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (letters || 'agt').slice(0, 3);
}

export function isAliasLike(value, state) {
  const match = /^([a-z0-9]{2,6})-(\d+)$/.exec(value ?? '');
  if (!match) return false;
  const prefix = match[1];
  return (
    Object.values(ALIAS_PREFIXES).includes(prefix) ||
    Object.hasOwn(state.counters, prefix)
  );
}

export function findChild(state, ref) {
  if (!ref) return undefined;
  return state.children.find((c) => c.alias === ref || c.agentId === ref);
}

/**
 * Remember a freshly launched child (or refresh an existing one) and apply
 * the per-specialist history cap.
 */
export function registerChild(state, entry, limits, now = Date.now()) {
  const existing = findChild(state, entry.agentId);
  if (existing) {
    existing.status = entry.status;
    existing.lastUsedAt = now;
    if (entry.description) existing.description = entry.description;
    return existing;
  }

  const prefix = aliasPrefix(entry.agentType);
  const next = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = next;

  const child = {
    alias: `${prefix}-${next}`,
    agentId: entry.agentId,
    agentType: shortType(entry.agentType),
    description: entry.description ?? '',
    status: entry.status,
    createdAt: now,
    lastUsedAt: now,
    reads: [],
  };
  state.children.push(child);
  evict(state, child.agentType, limits.maxSessionsPerAgent);
  return child;
}

/**
 * Keep at most `max` settled children per specialist type. Running children
 * are protected: they do not count toward the cap and are never evicted.
 */
export function evict(state, agentType, max) {
  const settled = state.children
    .filter((c) => c.agentType === agentType && c.status !== 'running')
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const drop = new Set(settled.slice(max).map((c) => c.agentId));
  if (drop.size === 0) return [];
  state.children = state.children.filter((c) => !drop.has(c.agentId));
  return [...drop];
}

export function touchChild(state, ref, status, limits, now = Date.now()) {
  const child = findChild(state, ref);
  if (!child) return undefined;
  child.status = status;
  child.lastUsedAt = now;
  if (status !== 'running') evict(state, child.agentType, limits.maxSessionsPerAgent);
  return child;
}

export function recordRead(state, agentId, filePath, lines, limits) {
  const child = findChild(state, agentId);
  if (!child || !filePath) return false;
  if (limits.readContextMaxFiles === 0) return false;
  if ((lines ?? 0) < limits.readContextMinLines) return false;
  child.reads = child.reads.filter((r) => r.path !== filePath);
  child.reads.push({ path: filePath, lines });
  if (child.reads.length > limits.readContextMaxFiles) {
    child.reads = child.reads.slice(-limits.readContextMaxFiles);
  }
  return true;
}

function displayPath(filePath, cwd) {
  if (cwd && filePath.startsWith(`${cwd}/`)) {
    return filePath.slice(cwd.length + 1);
  }
  return filePath;
}

export function renderResumable(state, { cwd } = {}) {
  if (state.children.length === 0) return '';
  const sorted = [...state.children].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const lines = [
    '### Resumable Sessions',
    'Child sessions you already ran in this conversation. Reuse is always explicit:',
    '- Continue the same thread: call `SendMessage` with to="<alias>" (load it via ToolSearch `select:SendMessage` if needed).',
    '- New or unrelated topic: launch a fresh child with the `Agent` tool.',
    '- If several aliases fit, use the most recently used one for that specialist.',
    '- Never reuse an alias blindly; an alias that is unknown or evicted fails the call.',
    '',
  ];
  for (const child of sorted) {
    const running = child.status === 'running' ? ' (running)' : '';
    lines.push(
      `- ${child.agentType}: ${child.alias}${running} ${child.description}`.trimEnd(),
    );
    if (child.reads.length > 0) {
      const files = child.reads
        .map((r) => `${displayPath(r.path, cwd)} (${r.lines} lines)`)
        .join(', ');
      lines.push(`  Context read by ${child.alias}: ${files}`);
    }
  }
  return lines.join('\n');
}

export function renderAvailableAliases(state) {
  if (state.children.length === 0) return 'none';
  return state.children
    .map((c) => `${c.alias} (${c.agentType}: ${c.description || 'no description'})`)
    .join(', ');
}

/** Returns a deny reason, or null when the delegation is allowed. */
export function checkDelegation(mode, subagentType) {
  const allowed = DELEGATE_SETS[mode];
  if (!allowed) return null;
  const type = shortType(subagentType);
  if (allowed.has(type)) return null;
  const list = [...allowed].map((t) => `claudekei:${t}`).join(', ');
  return `${mode} may only delegate to: ${list}. "${subagentType}" is not allowed in ${mode} mode.`;
}

/**
 * Detects mode-switch commands typed by the user (`/claudekei:plan ...`). Bare
 * `/plan` is Claude Code's own plan mode, so only `claudekei:`-prefixed commands
 * and unambiguous bare names count.
 */
export function detectModeSwitch(prompt) {
  const match = /^\s*\/(claudekei:)?(orchestrate|plan|sprint|analyze)(?:\s|$)/.exec(
    prompt ?? '',
  );
  if (!match) return null;
  if (!match[1] && match[2] === 'plan') return null;
  return MODE_COMMANDS[match[2]];
}

/**
 * The primary agent driving the main thread: an explicit mode switch wins,
 * otherwise the main-thread agent (`--agent` / settings `agent`).
 */
export function effectiveMode(state, agentType) {
  if (state.mode) return state.mode;
  if (typeof agentType !== 'string') return null;
  const idx = agentType.lastIndexOf(':');
  // Ignore same-named agents that belong to other plugins.
  if (idx !== -1 && agentType.slice(0, idx) !== PLUGIN_NAME) return null;
  const type = shortType(agentType);
  return PRIMARY_AGENTS.has(type) ? type : null;
}

/**
 * Parses `/claudekei:agent [name]`, which sets the default main-thread agent
 * for new sessions. Returns null when the prompt is not that command,
 * otherwise `{ action: 'show' | 'set' | 'reset' | 'invalid', agent?, arg? }`.
 */
export function parseAgentCommand(prompt) {
  const match = new RegExp(`^\\s*\\/${PLUGIN_NAME}:agent(?:\\s+(\\S+))?\\s*$`).exec(
    prompt ?? '',
  );
  if (!match) return null;
  const arg = match[1]?.toLowerCase();
  if (!arg) return { action: 'show' };
  if (arg === 'reset' || arg === 'default') return { action: 'reset' };
  const name = shortType(arg);
  const agent = PRIMARY_AGENTS.has(name) ? name : MODE_COMMANDS[name];
  return agent ? { action: 'set', agent } : { action: 'invalid', arg: match[1] };
}
