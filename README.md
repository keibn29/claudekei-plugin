[🇻🇳 Tiếng Việt](README.vi.md)

# claudekei

**Delegation-first agent orchestration for Claude Code** · port of [oh-my-openkei](https://www.npmjs.com/package/oh-my-openkei) (OpenCode)

by **Kei**

---

## What it is

A Claude Code plugin (plugin name: `claudekei`) that turns the main conversation into an
**Orchestrator** that routes work to a team of specialist subagents, and remembers
each specialist's session under a short alias (`exp-1`, `ora-1`, `fed-2`) so
follow-up work continues in the same context instead of starting from scratch.

| Piece | How it works in Claude Code |
|---|---|
| Orchestrator as the main agent | `settings.json` → `"agent": "orchestrator"` |
| Specialists | `agents/*.md` subagents, invoked as `claudekei:<name>` via the `Agent` tool |
| Session reuse | Native `SendMessage` resume + hooks that map aliases → agent ids |
| Per-agent skills | `skills:` frontmatter (preloaded, no "load skills first" step) |
| Per-agent MCP access | `tools:` allowlists (`mcp__plugin_claudekei_context7__*`, …) |
| Planner / Sprinter / Business Analyst | `claude --agent claudekei:<name>` or `/claudekei:plan`, `/claudekei:sprint`, `/claudekei:analyze` in-session |
| Workflow reminders | `UserPromptSubmit` / `PostToolUse` hooks |

## Install

Requirements: Claude Code ≥ 2.1, Node.js ≥ 18 (hooks run with `node`).

```bash
claude plugin marketplace add keibn29/claudekei
```

```bash
claude plugin install claudekei@claudekei
```

Or inside Claude Code: `/plugin marketplace add keibn29/claudekei`, then
`/plugin install claudekei@claudekei`.

Update to the latest release:

```bash
claude plugin marketplace update claudekei
```

```bash
claude plugin update claudekei@claudekei
```

To work from a local clone instead, add the folder: `claude plugin marketplace add ~/Projects/claudekei`.

Try it without installing:

```bash
claude --plugin-dir ~/Projects/claudekei
```

Verify: start a session and ask `ping all agents` — the orchestrator should launch each
specialist.

> The plugin makes **Orchestrator the default main agent** wherever it is enabled. To keep
> plain Claude in a project, disable the plugin there:
> `.claude/settings.json` → `{"enabledPlugins": {"claudekei@claudekei": false}}`.

## The team

### Primary agents (who you talk to)

| Agent | Start it with | Role |
|---|---|---|
| **orchestrator** (default) | `claude` / `/claudekei:orchestrate` | Delegation-first coordinator: routes, parallelizes, reuses sessions, integrates and verifies |
| **planner** | `claude --agent claudekei:planner` / `/claudekei:plan` | Interview-first planning; delegates only to explorer/librarian/oracle/designer; returns `<planner-plan>` |
| **sprinter** | `claude --agent claudekei:sprinter` / `/claudekei:sprint` | Fast self-executing agent, no delegation |
| **business-analyst** | `claude --agent claudekei:business-analyst` / `/claudekei:analyze` | Research + requirements + strategy; delegates to explorer/librarian/oracle; saves analysis to `.business-analyst/*.md` |

`/claudekei:<mode>` switches the role inside the current conversation (handy in the desktop
app). `--agent` starts a session with that agent's own prompt and tool restrictions.

To pick the agent for **new** sessions without the CLI (e.g. in the desktop app), type
`/claudekei:agent planner` (or `orchestrator`, `sprinter`, `business-analyst`, `reset`;
no argument shows the current value). The hook saves it to the project's
`.claude/settings.local.json` without a model turn; then open a new session (Cmd+N).

### Specialists (`subagent_type: claudekei:<name>`)

| Agent | Default model | Access | Role |
|---|---|---|---|
| explorer | haiku | read-only (+ Serena if configured) | Locate files, symbols, patterns |
| librarian | haiku | read-only + WebFetch/WebSearch + context7, grep_app, websearch (+ Atlassian) | Library docs, API references, GitHub examples |
| oracle | opus, effort high | read-only, skill `simplify` | Architecture, trade-offs, code review, escalated bugs |
| debugger | sonnet, effort high | read-only | Root-cause investigation, no fixes |
| designer | sonnet | full (no subagents) | UI/UX decisions and polish |
| frontend-developer | sonnet | full (no subagents), skills `vercel-react-best-practices`, `karpathy-guidelines` | Client-side implementation + tests |
| backend-developer | sonnet | full (no subagents), skills `backend-developer`, `karpathy-guidelines` | Server-side implementation + tests |
| trigger-developer | sonnet | full (no subagents), skill `karpathy-guidelines` | Trigger.dev tasks, config, schedules |
| observer | haiku | Read/Glob | Images, screenshots, PDFs → structured text |

The main-thread model is whatever you pick in Claude Code (`/model`); Opus is recommended
for orchestrator and planner.

To change specialist models/effort without editing the plugin, create
`~/.claude/claudekei.jsonc` (or `<project>/.claude/claudekei.jsonc`), in the same shape as
`oh-my-openkei.jsonc`:

```jsonc
{
  "preset": "default",
  "presets": {
    "default": {
      "oracle": { "model": "opus", "variant": "xhigh" },
      "explorer": { "model": "haiku" },
    },
  },
}
```

Specialist entries apply from the next delegation; primary agents (`orchestrator`,
`planner`, ...) get their `model`/`effort` as the new-session default when you run
`/claudekei:agent <name>`. Details: [docs/configuration.md](docs/configuration.md#config-file-claudekeijsonc).

## Session reuse

```text
### Resumable Sessions
- explorer: exp-1 Find PHASE_REMINDER_TEXT usage
  Context read by exp-1: src/config/constants.ts (30 lines), src/hooks/phase-reminder/index.ts (95 lines)
- oracle: ora-1 Review auth architecture
```

- Every `Agent` call from the main thread is registered under an alias and the model is
  told the alias immediately.
- Same thread → `SendMessage` with `to: "exp-1"`; the hook rewrites the alias to the real
  agent id. New topic → a fresh `Agent` call.
- Unknown/evicted aliases are rejected before the call runs, with the list of valid ones.

Details: **[docs/session-management.md](docs/session-management.md)**.

## Documentation

| Doc | What it covers |
|---|---|
| [Session Management](docs/session-management.md) | Aliases, eviction, read context, limits |
| [Configuration](docs/configuration.md) | Models, env vars, MCP servers, skills, customizing agents |
| [Migrating from oh-my-openkei](docs/migration-from-opencode.md) | What maps 1:1, what changed, what was dropped |

## Development

```bash
npm test                # hook unit + integration tests (node:test)
npm run sync:modes      # regenerate /claudekei:* mode skills from agents/*.md
npm run check           # sync check + tests + claude plugin validate
```

`skills/{orchestrate,plan,sprint,analyze}/SKILL.md` are generated from the matching
primary agent — edit `agents/*.md`, then run `npm run sync:modes`.

## License

MIT
