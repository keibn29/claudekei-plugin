import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadLimits } from '../hooks/lib/config.mjs';
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

test('loadUserConfig merges preset, agents map, and project overrides', () => {
  const home = join(ROOT, 'home');
  const project = join(ROOT, 'project');
  writeConfig(home, 'claudekei.jsonc', `{
    "preset": "default",
    "presets": {
      "default": {
        "oracle": { "model": "opus", "variant": "xhigh" },
        "explorer": { "model": "haiku" },
        "librarian": { "model": "openai/gpt-5" }, // not a Claude alias: ignored
      },
      "unused": { "explorer": { "model": "opus" } },
    },
    "agents": { "debugger": { "model": "Sonnet", "effort": "high" } },
    "sessionManager": { "maxSessionsPerAgent": 3 },
  }`);
  writeConfig(project, 'claudekei.json', '{ "agents": { "oracle": { "model": "fable" } } }');

  const config = loadUserConfig(project, home);
  assert.deepEqual(config.agents.oracle, { model: 'fable', effort: 'xhigh' });
  assert.deepEqual(config.agents.explorer, { model: 'haiku' });
  // Kept for primary agents; applyAgentConfig ignores non-alias models for specialists.
  assert.deepEqual(config.agents.librarian, { model: 'openai/gpt-5' });
  assert.deepEqual(config.agents.debugger, { model: 'sonnet', effort: 'high' });
  assert.equal(loadLimits(config.sessionManager).maxSessionsPerAgent, 3);
});

test('loadUserConfig ignores missing or broken files', () => {
  const home = join(ROOT, 'broken-home');
  writeConfig(home, 'claudekei.jsonc', '{ nope');
  assert.deepEqual(loadUserConfig(join(ROOT, 'missing'), home), { agents: {}, sessionManager: {} });
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
  assert.equal(applyAgentConfig({ subagent_type: 'claudekei:explorer' }, { explorer: { model: 'openai/gpt-5' } }), null);
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
  assert.equal(loadLimits().maxSessionsPerAgent, 2);
});
