// Hook event handlers. Each returns the JSON object to print on stdout, or
// null for "no opinion". All state access goes through the injected store so
// tests can point it at a temporary directory.

import {
  NUDGE_AGENTS,
  PHASE_REMINDER_TEXT,
  PLUGIN_NAME,
  PRIMARY_AGENTS,
  REMINDER_AGENTS,
} from './config.mjs';
import { readDefaults, writeDefaults } from './project-settings.mjs';
import {
  applyAgentConfig,
  checkDelegation,
  detectModeSwitch,
  effectiveMode,
  findChild,
  isAliasLike,
  parseAgentCommand,
  recordRead,
  registerChild,
  renderAvailableAliases,
  renderResumable,
  touchChild,
} from './sessions.mjs';

const TASK_NOTIFICATION = /^\s*<task-notification>/;

function context(eventName, text) {
  if (!text) return null;
  return {
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  };
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

// Stops the prompt before it reaches the model; `reason` is shown to the user.
function block(reason) {
  return { decision: 'block', reason };
}

const isMainThread = (input) => !input.agent_id;

function onSessionStart(input, { store, limits }) {
  store.pruneStale();
  if (input.source === 'clear') {
    store.deleteState(input.session_id);
    return null;
  }
  if (input.source === 'startup') return null;
  // resume / compact: re-advertise remembered aliases.
  const state = store.readState(input.session_id);
  if (!effectiveMode(state, input.agent_type)) return null;
  return context('SessionStart', renderResumable(state, { cwd: input.cwd, limits }));
}

const AGENT_USAGE = `Usage: /${PLUGIN_NAME}:agent <${[...PRIMARY_AGENTS].join('|')}|reset>`;

// The `effortLevel` setting stops at xhigh; `max` only exists per call.
const sessionEffort = (effort) => (effort === 'max' ? 'xhigh' : effort);

function describeDefaults({ agent, model, effortLevel }) {
  const parts = [agent ?? `${PLUGIN_NAME}:orchestrator (plugin default)`];
  parts.push(`model ${model ?? 'app default'}`);
  parts.push(`effort ${effortLevel ?? 'app default'}`);
  return parts.join(', ');
}

// `/claudekei:agent <name>` sets the defaults for NEW sessions in this project:
// the main-thread agent plus its `model`/`effort` from claudekei.jsonc. They are
// only defaults; the app's model picker and /model still win. The hook does the
// write itself so no model turn is spent.
function onAgentCommand(command, input, { store, agents = {} }) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const file = '.claude/settings.local.json';
  try {
    if (command.action === 'invalid') {
      return block(`Unknown agent "${command.arg}". ${AGENT_USAGE}`);
    }
    if (command.action === 'show') {
      return block(`Defaults for new sessions: ${describeDefaults(readDefaults(projectDir))}. ${AGENT_USAGE}`);
    }
    const name = command.action === 'reset' ? 'orchestrator' : command.agent;
    const entry = agents[name] ?? {};
    const values = {
      agent: command.action === 'reset' ? null : `${PLUGIN_NAME}:${name}`,
      model: entry.model,
      effortLevel: sessionEffort(entry.effort),
    };
    const owned = writeDefaults(projectDir, values, store.readOwned(projectDir));
    store.writeOwned(projectDir, owned);
    const note = entry.effort === 'max' ? ' (effort max is per-call only, so new sessions start at xhigh)' : '';
    return block(
      `Defaults for new sessions in this project: ${describeDefaults(readDefaults(projectDir))}${note}. ` +
        `Saved to ${file}. Start a new session (Cmd+N in the desktop app) to use them; ` +
        'the model picker can still change the model. This conversation keeps its current agent.',
    );
  } catch (error) {
    return block(
      `Could not update ${file}: ${error?.message ?? error}. ` +
        `Set "agent": "${PLUGIN_NAME}:<name>" there by hand.`,
    );
  }
}

function onUserPrompt(input, deps) {
  const { store, limits } = deps;
  if (!isMainThread(input)) return null;
  const agentCommand = parseAgentCommand(input.prompt);
  if (agentCommand) return onAgentCommand(agentCommand, input, deps);
  const switched = detectModeSwitch(input.prompt);
  const { state } = store.withState(input.session_id, (s) => {
    if (!switched || s.mode === switched) return false;
    s.mode = switched;
  });
  if (TASK_NOTIFICATION.test(input.prompt ?? '')) return null;

  const mode = effectiveMode(state, input.agent_type);
  if (!mode) return null;

  const parts = [];
  if (limits.phaseReminder && REMINDER_AGENTS.has(mode)) {
    parts.push(`<reminder>${PHASE_REMINDER_TEXT}</reminder>`);
  }
  const resumable = renderResumable(state, { cwd: input.cwd });
  if (resumable) parts.push(resumable);
  return context('UserPromptSubmit', parts.join('\n\n'));
}

function onPreAgent(input, { store, agents }) {
  if (isMainThread(input)) {
    const state = store.readState(input.session_id);
    const mode = effectiveMode(state, input.agent_type);
    const reason = mode && checkDelegation(mode, input.tool_input?.subagent_type);
    if (reason) return deny(reason);
  }
  const updatedInput = applyAgentConfig(input.tool_input, agents);
  if (!updatedInput) return null;
  const applied = ['model', 'effort']
    .filter((key) => updatedInput[key] !== input.tool_input[key])
    .map((key) => `${key}=${updatedInput[key]}`)
    .join(', ');
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `claudekei.jsonc: ${applied} for ${input.tool_input.subagent_type}`,
      updatedInput,
    },
  };
}

function onPreSendMessage(input, { store }) {
  const toolInput = input.tool_input ?? {};
  const target = toolInput.to;
  if (typeof target !== 'string') return null;

  const state = store.readState(input.session_id);
  const child = findChild(state, target);
  if (child) {
    if (child.alias !== target) return null; // already a raw agent id
    const updatedInput = { ...toolInput, to: child.agentId };
    if (toolInput.recipient === target) updatedInput.recipient = child.agentId;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `Resolved session alias ${target} -> ${child.agentId}`,
        updatedInput,
      },
    };
  }

  if (isAliasLike(target, state)) {
    return deny(
      `Unknown or evicted session alias "${target}". Available aliases: ${renderAvailableAliases(state)}. ` +
        'Start a fresh child with the Agent tool instead.',
    );
  }
  return null;
}

function onPostAgent(input, { store, limits }) {
  if (!isMainThread(input)) return null;
  const response = input.tool_response ?? {};
  const agentId = response.agentId;
  if (typeof agentId !== 'string' || !agentId) return null;

  const agentType =
    input.tool_input?.subagent_type || response.agentType || 'general-purpose';
  const status = response.status === 'async_launched' ? 'running' : 'idle';
  const { result: child } = store.withState(input.session_id, (state) =>
    registerChild(
      state,
      { agentId, agentType, description: input.tool_input?.description, status },
      limits,
    ),
  );
  return context(
    'PostToolUse',
    `[claudekei] Child session registered as \`${child.alias}\` (${child.agentType}). ` +
      `To continue this same thread later, call SendMessage with to: "${child.alias}". ` +
      'For new or unrelated work, launch a fresh Agent call instead.',
  );
}

function onPostSendMessage(input, { store, limits }) {
  const response = input.tool_response ?? {};
  const agentId = response.resumedAgentId ?? input.tool_input?.to;
  if (typeof agentId !== 'string' || response.success === false) return null;
  store.withState(input.session_id, (state) =>
    touchChild(state, agentId, 'running', limits) ? undefined : false,
  );
  return null;
}

function onPostFileTool(input, { store, limits }) {
  if (!isMainThread(input)) {
    if (input.tool_name !== 'Read') return null;
    const file = input.tool_response?.file;
    if (!file?.filePath) return null;
    store.withState(input.session_id, (state) =>
      recordRead(state, input.agent_id, file.filePath, file.numLines, limits)
        ? undefined
        : false,
    );
    return null;
  }

  if (!limits.phaseReminder) return null;
  const state = store.readState(input.session_id);
  const mode = effectiveMode(state, input.agent_type);
  if (!mode || !NUDGE_AGENTS.has(mode)) return null;
  return context('PostToolUse', PHASE_REMINDER_TEXT);
}

function onSubagentStop(input, { store, limits }) {
  if (!input.agent_id) return null;
  store.withState(input.session_id, (state) =>
    touchChild(state, input.agent_id, 'idle', limits) ? undefined : false,
  );
  return null;
}

export function handle(input, deps) {
  if (!input?.session_id) return null;
  switch (input.hook_event_name) {
    case 'SessionStart':
      return onSessionStart(input, deps);
    case 'UserPromptSubmit':
      return onUserPrompt(input, deps);
    case 'PreToolUse':
      if (input.tool_name === 'Agent') return onPreAgent(input, deps);
      if (input.tool_name === 'SendMessage') return onPreSendMessage(input, deps);
      return null;
    case 'PostToolUse':
      if (input.tool_name === 'Agent') return onPostAgent(input, deps);
      if (input.tool_name === 'SendMessage') return onPostSendMessage(input, deps);
      if (input.tool_name === 'Read' || input.tool_name === 'Write') {
        return onPostFileTool(input, deps);
      }
      return null;
    case 'SubagentStop':
      return onSubagentStop(input, deps);
    default:
      return null;
  }
}
