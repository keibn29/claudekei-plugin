import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadLimits, PRIMARY_AGENTS } from '../hooks/lib/config.mjs';
import { applyAgentConfig } from '../hooks/lib/sessions.mjs';
import { loadUserConfig, parseJsonc } from '../hooks/lib/user-config.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'claudekei-config-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

function writeConfig(dir, name, text) {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', name), text);
}

test('parseJsonc strips comments and trailing commas but not string contents', () => {
  const parsed = parseJsonc(`{
    // line comment
    "url": "https://x.dev/a//b", /* block */
    "odd": "keep ,} and // here",
    "list": [1, 2,],
  }`);
  assert.deepEqual(parsed, { url: 'https://x.dev/a//b', odd: 'keep ,} and // here', list: [1, 2] });
});

test('loadUserConfig reads the presets map with project overrides per field', () => {
  const home = join(ROOT, 'home');
  const project = join(ROOT, 'project');
  writeConfig(home, 'claudekei.jsonc', `{
    "presets": {
      "oracle": { "model": "opus", "effort": "xhigh" },
      "explorer": { "model": "haiku" },
      "debugger": { "model": "Sonnet", "effort": "HIGH" },
      "librarian": { "model": "openai/gpt-5" }, // not a Claude alias: ignored
    },
    "sessionManager": { "maxSessionsPerAgent": 3 },
  }`);
  writeConfig(project, 'claudekei.json', '{ "presets": { "oracle": { "model": "fable" } } }');

  const config = loadUserConfig(project, home);
  assert.deepEqual(config.agents.oracle, { model: 'fable', effort: 'xhigh' });
  assert.deepEqual(config.agents.explorer, { model: 'haiku' });
  assert.deepEqual(config.agents.debugger, { model: 'sonnet', effort: 'high' });
  assert.deepEqual(config.agents.librarian, {});
  assert.equal(loadLimits(config.sessionManager).maxSessionsPerAgent, 3);
});

test('loadUserConfig ignores the removed preset/agents keys', () => {
  const home = join(ROOT, 'legacy-home');
  writeConfig(home, 'claudekei.jsonc', `{
    "preset": "default",
    "agents": { "oracle": { "model": "haiku" } },
  }`);
  assert.deepEqual(loadUserConfig(join(ROOT, 'missing'), home).agents, {});
});

test('loadUserConfig ignores missing or broken files', () => {
  const home = join(ROOT, 'broken-home');
  writeConfig(home, 'claudekei.jsonc', '{ nope');
  assert.deepEqual(loadUserConfig(join(ROOT, 'missing'), home), {
    agents: {},
    agentScope: 'project',
    sessionManager: {},
  });
});

test('applyAgentConfig fills model/effort for claudekei agents only, explicit values win', () => {
  const agents = { oracle: { model: 'opus', effort: 'max' }, explorer: { model: 'haiku' } };
  assert.deepEqual(applyAgentConfig({ subagent_type: 'claudekei:oracle', prompt: 'p' }, agents), {
    subagent_type: 'claudekei:oracle',
    prompt: 'p',
    model: 'opus',
    effort: 'max',
  });
  assert.deepEqual(
    applyAgentConfig({ subagent_type: 'claudekei:oracle', model: 'sonnet' }, agents),
    { subagent_type: 'claudekei:oracle', model: 'sonnet', effort: 'max' },
  );
  assert.equal(applyAgentConfig({ subagent_type: 'claudekei:explorer', model: 'haiku' }, agents), null);
  assert.equal(applyAgentConfig({ subagent_type: 'other:oracle' }, agents), null);
  assert.equal(applyAgentConfig({ subagent_type: 'claudekei:designer' }, agents), null);
});

test('environment variables still override the config file', () => {
  process.env.KEI_MAX_SESSIONS_PER_AGENT = '5';
  process.env.KEI_PHASE_REMINDER = '0';
  try {
    const limits = loadLimits({ maxSessionsPerAgent: 3, phaseReminder: true });
    assert.equal(limits.maxSessionsPerAgent, 5);
    assert.equal(limits.phaseReminder, false);
  } finally {
    delete process.env.KEI_MAX_SESSIONS_PER_AGENT;
    delete process.env.KEI_PHASE_REMINDER;
  }
  assert.equal(loadLimits({ phaseReminder: false }).phaseReminder, false);
  assert.equal(loadLimits().maxSessionsPerAgent, 1);
});

test('claudekei.jsonc template lists every specialist with its agents/*.md defaults', () => {
  const repo = new URL('..', import.meta.url);
  const template = parseJsonc(readFileSync(new URL('claudekei.jsonc', repo), 'utf8'));
  const listed = template.presets;

  const frontmatter = (name) => {
    const text = readFileSync(new URL(`agents/${name}.md`, repo), 'utf8');
    const block = /^---\n([\s\S]*?)\n---/.exec(text)[1];
    const field = (key) => new RegExp(`^${key}:\\s*(\\S+)`, 'm').exec(block)?.[1];
    return { model: field('model'), effort: field('effort') };
  };
  const agents = readdirSync(new URL('agents/', repo))
    .map((file) => file.replace(/\.md$/, ''))
    .filter((name) => !PRIMARY_AGENTS.has(name))
    .sort();

  assert.deepEqual(Object.keys(listed).sort(), agents);
  for (const name of agents) {
    const { model, effort } = frontmatter(name);
    assert.equal(listed[name].model, model, `${name} model`);
    assert.equal(listed[name].effort, effort, `${name} effort`);
  }
  assert.deepEqual(loadLimits(template.sessionManager), loadLimits());
});

test('agentScope defaults to project; a valid project value wins over the user value', () => {
  const home = join(ROOT, 'scope-home');
  const project = join(ROOT, 'scope-project');
  writeConfig(home, 'claudekei.jsonc', '{ "agentScope": "global" }');
  assert.equal(loadUserConfig(join(ROOT, 'missing'), home).agentScope, 'global');
  writeConfig(project, 'claudekei.jsonc', '{ "agentScope": "project" }');
  assert.equal(loadUserConfig(project, home).agentScope, 'project');
  writeConfig(project, 'claudekei.jsonc', '{ "agentScope": "everywhere" }');
  assert.equal(loadUserConfig(project, home).agentScope, 'global');
  assert.equal(loadUserConfig(join(ROOT, 'missing'), join(ROOT, 'no-home')).agentScope, 'project');
});
