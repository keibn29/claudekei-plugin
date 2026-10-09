// Drives hooks/claudekei.mjs as a subprocess with payload shapes captured from a
// real Claude Code session (v2.1.x), using an isolated CLAUDE_PLUGIN_DATA.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../hooks/claudekei.mjs', import.meta.url));
const DATA = mkdtempSync(join(tmpdir(), 'claudekei-hooks-'));
after(() => rmSync(DATA, { recursive: true, force: true }));

let sessionCounter = 0;
const newSession = () => `sess-${process.pid}-${++sessionCounter}`;

function run(payload, env = {}) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: DATA, ...env },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

const base = (session, extra = {}) => ({
  session_id: session,
  cwd: '/repo',
  agent_type: 'claudekei:orchestrator',
  ...extra,
});

function launch(session, agentId, subagentType, status = 'completed') {
  return run(
    base(session, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_input: { description: `Task ${agentId}`, prompt: 'x', subagent_type: subagentType },
      tool_response: { status, agentId, agentType: subagentType },
    }),
  );
}

const state = (session) =>
  JSON.parse(readFileSync(join(DATA, 'sessions', `${session}.json`), 'utf8'));

test('PostToolUse Agent registers an alias and tells the model', () => {
  const s = newSession();
  const out = launch(s, 'ab4798b070eca6b7e', 'claudekei:explorer', 'async_launched');
  assert.match(out.hookSpecificOutput.additionalContext, /`exp-1`/);
  assert.equal(state(s).children[0].status, 'running');
});

test('PreToolUse SendMessage rewrites alias to agent id, keeping other fields', () => {
  const s = newSession();
  launch(s, 'ab4798b070eca6b7e', 'claudekei:explorer');
  const out = run(
    base(s, {
      hook_event_name: 'PreToolUse',
      tool_name: 'SendMessage',
      tool_input: {
        to: 'exp-1',
        summary: 'Follow up',
        message: 'what next?',
        recipient: 'exp-1',
        content: 'what next?',
      },
    }),
  );
  const hso = out.hookSpecificOutput;
  assert.equal(hso.permissionDecision, 'allow');
  assert.deepEqual(hso.updatedInput, {
    to: 'ab4798b070eca6b7e',
    summary: 'Follow up',
    message: 'what next?',
    recipient: 'ab4798b070eca6b7e',
    content: 'what next?',
  });
});

test('PreToolUse SendMessage denies unknown aliases and passes raw ids through', () => {
  const s = newSession();
  launch(s, 'a1', 'claudekei:oracle');
  const denied = run(
    base(s, {
      hook_event_name: 'PreToolUse',
      tool_name: 'SendMessage',
      tool_input: { to: 'exp-9', message: 'hi' },
    }),
  );
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /ora-1/);

  const raw = run(
    base(s, {
      hook_event_name: 'PreToolUse',
      tool_name: 'SendMessage',
      tool_input: { to: 'a1', message: 'hi' },
    }),
  );
  assert.equal(raw, null);
});

test('SubagentStop settles a child; SendMessage marks it running again', () => {
  const s = newSession();
  launch(s, 'a1', 'claudekei:explorer', 'async_launched');
  run({ session_id: s, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'claudekei:explorer' });
  assert.equal(state(s).children[0].status, 'idle');
  run(
    base(s, {
      hook_event_name: 'PostToolUse',
      tool_name: 'SendMessage',
      tool_input: { to: 'a1', message: 'more' },
      tool_response: { success: true, resumedAgentId: 'a1' },
    }),
  );
  assert.equal(state(s).children[0].status, 'running');
});

test('subagent Read calls feed read context into the resumable list', () => {
  const s = newSession();
  launch(s, 'a1', 'claudekei:explorer');
  run({
    session_id: s,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    agent_id: 'a1',
    agent_type: 'claudekei:explorer',
    tool_input: { file_path: '/repo/src/app.ts' },
    tool_response: { type: 'text', file: { filePath: '/repo/src/app.ts', numLines: 42 } },
  });
  const out = run(base(s, { hook_event_name: 'UserPromptSubmit', prompt: 'continue' }));
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /<reminder>/);
  assert.match(ctx, /- explorer: exp-1 Task a1/);
  assert.match(ctx, /Context read by exp-1: src\/app\.ts \(42 lines\)/);
});

test('UserPromptSubmit is silent outside claudekei primary agents and for task notifications', () => {
  const s = newSession();
  assert.equal(
    run({ session_id: s, hook_event_name: 'UserPromptSubmit', prompt: 'hello' }),
    null,
  );
  assert.equal(
    run(base(s, { hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>x</task-id>' })),
    null,
  );
});

test('mode switch via /claudekei:plan enables planner delegation rules', () => {
  const s = newSession();
  run({ session_id: s, hook_event_name: 'UserPromptSubmit', prompt: '/claudekei:plan add billing' });
  const denied = run({
    session_id: s,
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'claudekei:backend-developer', prompt: 'x', description: 'y' },
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  const allowed = run({
    session_id: s,
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'claudekei:explorer', prompt: 'x', description: 'y' },
  });
  assert.equal(allowed, null);
});

test('post-file nudge only for orchestrator/planner main thread', () => {
  const s = newSession();
  const nudge = run(base(s, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: {} }));
  assert.match(nudge.hookSpecificOutput.additionalContext, /Recall the workflow rules/);
  const none = run(
    base(s, {
      agent_type: 'claudekei:sprinter',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_response: {},
    }),
  );
  assert.equal(none, null);
  const off = run(
    base(s, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: {} }),
    { KEI_PHASE_REMINDER: '0' },
  );
  assert.equal(off, null);
});

test('SessionStart re-advertises aliases after compaction and clears on /clear', () => {
  const s = newSession();
  launch(s, 'a1', 'claudekei:oracle');
  const resumed = run(base(s, { hook_event_name: 'SessionStart', source: 'compact' }));
  assert.match(resumed.hookSpecificOutput.additionalContext, /ora-1/);
  run(base(s, { hook_event_name: 'SessionStart', source: 'clear' }));
  const after = run(base(s, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }));
  assert.doesNotMatch(after.hookSpecificOutput.additionalContext, /ora-1/);
});

test('parallel PostToolUse hooks do not lose registrations', async () => {
  const s = newSession();
  const { spawn } = await import('node:child_process');
  const runAsync = (payload) =>
    new Promise((resolve, reject) => {
      const child = spawn('node', [HOOK], {
        env: { ...process.env, CLAUDE_PLUGIN_DATA: DATA },
      });
      child.on('error', reject);
      child.on('exit', resolve);
      child.stdin.end(JSON.stringify(payload));
    });
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      runAsync(
        base(s, {
          hook_event_name: 'PostToolUse',
          tool_name: 'Agent',
          tool_input: { description: `p${i}`, subagent_type: 'claudekei:backend-developer' },
          tool_response: { status: 'async_launched', agentId: `p${i}` },
        }),
      ),
    ),
  );
  const aliases = state(s).children.map((c) => c.alias).sort();
  assert.deepEqual(aliases, ['bed-1', 'bed-2', 'bed-3', 'bed-4', 'bed-5', 'bed-6']);
});

test('malformed input never fails the hook', () => {
  const result = spawnSync('node', [HOOK], { input: '{not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('/claudekei:agent writes settings.local.json, keeps other keys, and blocks the prompt', () => {
  const project = join(DATA, 'project');
  mkdirSync(join(project, '.claude'), { recursive: true });
  const file = join(project, '.claude', 'settings.local.json');
  writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
  const env = { CLAUDE_PROJECT_DIR: project };
  const prompt = (text) =>
    run(base(newSession(), { hook_event_name: 'UserPromptSubmit', prompt: text }), env);

  const set = prompt('/claudekei:agent plan');
  assert.equal(set.decision, 'block');
  assert.match(set.reason, /claudekei:planner/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    permissions: { allow: ['Bash(ls)'] },
    agent: 'claudekei:planner',
  });

  assert.match(prompt('/claudekei:agent').reason, /new sessions: claudekei:planner, model app default/);
  assert.match(prompt('/claudekei:agent oracle').reason, /Unknown agent "oracle"/);

  prompt('/claudekei:agent reset');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { permissions: { allow: ['Bash(ls)'] } });
});

test('/claudekei:agent never overwrites an unreadable settings file', () => {
  const project = join(DATA, 'broken');
  mkdirSync(join(project, '.claude'), { recursive: true });
  const file = join(project, '.claude', 'settings.local.json');
  writeFileSync(file, '{ not json');
  const out = run(
    base(newSession(), { hook_event_name: 'UserPromptSubmit', prompt: '/claudekei:agent sprinter' }),
    { CLAUDE_PROJECT_DIR: project },
  );
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /Could not update/);
  assert.equal(readFileSync(file, 'utf8'), '{ not json');
});

test('PreToolUse Agent applies claudekei.jsonc model/effort, delegation rules still first', () => {
  const home = join(DATA, 'cfg-home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'claudekei.jsonc'),
    '{ "agents": { "explorer": { "model": "sonnet", "variant": "low" }, "backend-developer": { "model": "opus" } } }',
  );
  const env = { HOME: home, CLAUDE_PROJECT_DIR: join(DATA, 'cfg-project') };
  const s = newSession();
  const call = (subagentType, extra = {}) =>
    run(
      base(s, {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_input: { subagent_type: subagentType, prompt: 'x', description: 'y', ...extra },
      }),
      env,
    );

  const out = call('claudekei:explorer');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'sonnet');
  assert.equal(out.hookSpecificOutput.updatedInput.effort, 'low');
  assert.equal(out.hookSpecificOutput.updatedInput.prompt, 'x');
  assert.equal(call('claudekei:designer'), null);

  run({ session_id: s, hook_event_name: 'UserPromptSubmit', prompt: '/claudekei:plan x' }, env);
  assert.equal(call('claudekei:backend-developer').hookSpecificOutput.permissionDecision, 'deny');
});

test('/claudekei:agent writes model/effort defaults from claudekei.jsonc and never removes a hand-set model', () => {
  const home = join(DATA, 'defaults-home');
  const project = join(DATA, 'defaults-project');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'claudekei.jsonc'),
    `{
      "presets": { "default": { "planner": { "model": "opus", "variant": "max" } } },
      "preset": "default",
      "agents": { "orchestrator": { "model": "claude-opus-5-5", "effort": "high" } },
    }`,
  );
  const file = join(project, '.claude', 'settings.local.json');
  const env = { HOME: home, CLAUDE_PROJECT_DIR: project };
  const prompt = (text) =>
    run(base(newSession(), { hook_event_name: 'UserPromptSubmit', prompt: text }), env);
  const settings = () => JSON.parse(readFileSync(file, 'utf8'));

  assert.match(prompt('/claudekei:agent planner').reason, /model opus, effort xhigh \(effort max/);
  assert.deepEqual(settings(), { agent: 'claudekei:planner', model: 'opus', effortLevel: 'xhigh' });

  // Sprinter has no config entry: the plugin-written model/effort are removed.
  prompt('/claudekei:agent sprinter');
  assert.deepEqual(settings(), { agent: 'claudekei:sprinter' });

  // reset applies the orchestrator entry.
  prompt('/claudekei:agent reset');
  assert.deepEqual(settings(), { model: 'claude-opus-5-5', effortLevel: 'high' });

  // A model the user set by hand is never removed.
  writeFileSync(file, JSON.stringify({ model: 'sonnet' }));
  prompt('/claudekei:agent sprinter');
  assert.deepEqual(settings(), { model: 'sonnet', agent: 'claudekei:sprinter' });
});
