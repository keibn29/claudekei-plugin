# Configuration

Besides standard Claude Code configuration (agent frontmatter, `settings.json`,
environment variables), claudekei reads one optional file: `claudekei.jsonc`.

## Config file (`claudekei.jsonc`)

Like `oh-my-openkei.jsonc`, but with one `presets` map (no named presets) and OpenCode's
`variant` renamed to Claude Code's `effort`. This optional JSONC file (comments and trailing
commas allowed) changes specialist models/effort and session limits without forking the plugin:

| File | Scope |
|---|---|
| `~/.claude/claudekei.jsonc` (or `.json`) | All projects |
| `<project>/.claude/claudekei.jsonc` (or `.json`) | This project; wins per field over the user file |

The repo root has a ready-to-copy template, [`claudekei.jsonc`](../claudekei.jsonc), with every
specialist at its default (a test keeps it in sync with `agents/*.md`).

```jsonc
{
  "presets": {
    "oracle":   { "model": "opus",   "effort": "xhigh" },
    "debugger": { "model": "sonnet", "effort": "high" },
    "explorer": { "model": "haiku" },
  },
  "sessionManager": {
    "maxSessionsPerAgent": 1,
    "readContextMinLines": 10,
    "readContextMaxFiles": 8,
    "phaseReminder": true,
  },
}
```

| Option | Values |
|---|---|
| `presets.<agent>.model` | `opus`, `sonnet`, `haiku`, `fable` (other values are ignored) |
| `presets.<agent>.effort` | `low`, `medium`, `high`, `xhigh`, `max` |
| `agentScope` | Where `/claudekei:agent` saves: `"project"` (default, `.claude/settings.local.json`) or `"global"` (`~/.claude/settings.json`) |
| `sessionManager.*` | Same as the `KEI_*` variables below; a set env variable wins |

The `PreToolUse` hook fills `model`/`effort` into each `Agent` call for a
`claudekei:<agent>`, which overrides the agent file. The file is read on every call, so
edits apply immediately, with no plugin update or new session.

Limits:

- Only specialists. Primary agents (orchestrator, planner, sprinter, business-analyst)
  are ignored here; they run on the session's model and effort: pick them in the app (model menu Cmd+Shift+I,
  effort menu Cmd+Shift+E) or with `/model` and `/effort`. The desktop app starts every
  session with explicit `--model`/`--effort` flags, which beat any settings value, so the
  plugin does not try to set them.

- If the orchestrator passes `model`/`effort` itself (e.g. you asked for it), that wins.
- A child resumed with `SendMessage` keeps the model it started with.
- Per-agent `skills`/`mcps` lists stay in the agent files (`skills:` / `tools:`).

## Models and effort per agent (defaults)

Each agent sets its default model in `agents/<name>.md` (`claudekei.jsonc` overrides it):

```yaml
---
name: oracle
model: opus        # opus | sonnet | haiku | fable | inherit | full model id
effort: high       # low | medium | high | xhigh | max
---
```

To change them, edit the files in your clone, bump `version` in
`.claude-plugin/plugin.json`, then run `claude plugin marketplace update claudekei`
and `claude plugin update claudekei@claudekei`. While iterating, `claude --plugin-dir
<clone>` plus `/reload-plugins` picks up edits directly. Primary agents (`orchestrator`, `planner`, `sprinter`, `business-analyst`)
leave `model` unset, so they use whatever you pick with `/model`.

Global overrides that Claude Code itself supports:

| Env var | Effect |
|---|---|
| `CLAUDE_CODE_SUBAGENT_MODEL` | Default model for subagents without a `model` field |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` | Force that model on all subagents |

### Third-party models (unsupported by Anthropic)

The OpenCode version mixed providers per agent. In Claude Code this needs an
Anthropic-Messages-compatible gateway (e.g. LiteLLM) via `ANTHROPIC_BASE_URL`, then a
full model id in `model:` that the gateway routes. Anthropic does not support routing
Claude Code to non-Claude models; expect issues with thinking, prompt caching and
tool use.

## Plugin environment variables

| Variable | Default | Meaning |
|---|---|---|
| `KEI_MAX_SESSIONS_PER_AGENT` | `1` | Settled resumable children listed per specialist (1–10) |
| `KEI_READ_CONTEXT_MIN_LINES` | `10` | Min lines read before a file appears in read context |
| `KEI_READ_CONTEXT_MAX_FILES` | `8` | Files listed per child (`0` hides read context) |
| `KEI_PHASE_REMINDER` | `1` | `0` disables the workflow reminder and Read/Write nudge |

Set them under `"env"` in `~/.claude/settings.json` or `.claude/settings.json`, or use
`sessionManager` in `claudekei.jsonc` (an env variable wins when both are set).

## Default main agent

The plugin's `settings.json` sets `"agent": "orchestrator"`. Your own `agent` setting
takes precedence. `/claudekei:agent <orchestrator|planner|sprinter|business-analyst|reset>`
writes it for you: the `UserPromptSubmit` hook sets (or removes) `"agent": "claudekei:<name>"`
in the project's `.claude/settings.local.json`, keeps every other key, and blocks the
prompt so no model turn is spent. It applies to sessions started afterwards; the current
conversation keeps its agent (use `/claudekei:<mode>` to switch roles in place). Keep
`settings.local.json` out of git if your repo does not ignore it already.

To keep everything global (no `.claude/` folder in your projects), set `"agentScope": "global"`
in `~/.claude/claudekei.jsonc`. `/claudekei:agent` then sets `"agent"` in
`~/.claude/settings.json`, for every project, and keeps all other keys there. A project
that still has its own `agent` (in `.claude/settings.local.json` or `.claude/settings.json`)
wins over it; the command's message points that out. Plugin v0.4.0
also wrote `model`/`effortLevel` there; the next `/claudekei:agent` removes them unless
you changed them by hand.

To use plain Claude Code in a project, disable the plugin there:

```json
{ "enabledPlugins": { "claudekei@claudekei": false } }
```

## MCP servers

Bundled in `.mcp.json` (no setup needed):

| Server | Used by | Notes |
|---|---|---|
| `context7` | librarian | Library docs. Anonymous rate limit; for a key, add your own `context7` server with a `CONTEXT7_API_KEY` header |
| `grep_app` | librarian | GitHub code search |
| `websearch` | librarian | Exa web search (anonymous) |

Optional servers from oh-my-openkei that need local setup or auth. Add them to your
user (`claude mcp add --scope user ...`) or project `.mcp.json`; the agents' tool
allowlists already accept these names:

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"]
    },
    "atlassian": {
      "type": "http",
      "url": "https://mcp.atlassian.com/v1/mcp?capabilities=READ_JIRA,SEARCH_JIRA,READ_CONFLUENCE,SEARCH_CONFLUENCE"
    },
    "figma": { "type": "http", "url": "http://127.0.0.1:3845/mcp" }
  }
}
```

| Server | Available to |
|---|---|
| `serena` | explorer (+ every agent without a `tools` allowlist) |
| `atlassian` | librarian (+ unrestricted agents) |
| `figma` | designer, developers, primary agents (no allowlist) |

Read-only agents (explorer, librarian, oracle, debugger) only see the tools in
their `tools:` line; edit it to grant more.

## Skills

Bundled skills (`/claudekei:<name>`): `backend-developer`, `business-analyst`, `codemap`,
`karpathy-guidelines`, `simplify`, `vercel-react-best-practices`.

Agents preload theirs through the `skills:` frontmatter. Skills that oh-my-openkei
referenced but did not ship (`agent-browser`, `requesting-code-review`)
are not bundled — install them separately and add them to the agent's `skills:` list.

## Custom agents

Add a file to `agents/` with `name`, `description`, `model`, and optional `tools`,
`disallowedTools`, `skills`, `effort`, `color`, then describe it in the `<Agents>`
section of `agents/orchestrator.md` (and run `npm run sync:modes`). For a personal agent
that should not live in the plugin, put it in `~/.claude/agents/` and reference it by its
bare name.
