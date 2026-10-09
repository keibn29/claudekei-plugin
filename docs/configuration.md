# Configuration

claudekei has no JSON config file of its own. Everything is standard Claude Code
configuration: agent frontmatter, `settings.json`, and environment variables.

## Config file (`claudekei.jsonc`)

Like `oh-my-openkei.jsonc`, an optional JSONC file (comments and trailing commas allowed)
changes specialist models and session limits without forking the plugin:

| File | Scope |
|---|---|
| `~/.claude/claudekei.jsonc` (or `.json`) | All projects |
| `<project>/.claude/claudekei.jsonc` (or `.json`) | This project; wins per field over the user file |

```jsonc
{
  // Active preset (optional). Entries under "agents" are applied on top of it.
  "preset": "default",
  "presets": {
    "default": {
      "oracle":   { "model": "opus",   "variant": "xhigh" },
      "debugger": { "model": "sonnet", "variant": "high" },
      "explorer": { "model": "haiku" },
    },
    "cheap": {
      "oracle": { "model": "sonnet" },
    },
  },
  "agents": {
    // Primary agents: default model/effort for new sessions (see below)
    "planner": { "model": "opus", "variant": "xhigh" },
    "frontend-developer": { "model": "sonnet", "effort": "high" },
  },
  "sessionManager": {
    "maxSessionsPerAgent": 2,
    "readContextMinLines": 10,
    "readContextMaxFiles": 8,
    "phaseReminder": true,
  },
}
```

| Option | Values |
|---|---|
| `<agent>.model` | Specialists: `opus`, `sonnet`, `haiku`, `fable` (other values are ignored). Primary agents: also any full model id |
| `<agent>.effort` (or `variant`) | `low`, `medium`, `high`, `xhigh`, `max` |
| `sessionManager.*` | Same as the `KEI_*` variables below; a set env variable wins |

**Specialists:** the `PreToolUse` hook fills `model`/`effort` into each `Agent` call for a
`claudekei:<agent>`, which overrides the agent file. The file is read on every call, so
edits apply immediately, with no plugin update or new session.

**Primary agents** (orchestrator, planner, sprinter, business-analyst): `/claudekei:agent <name>`
writes their `model`/`effort` as the *default* for new sessions (`model` and `effortLevel` in
`.claude/settings.local.json`, next to `agent`); `/claudekei:agent reset` uses the
`orchestrator` entry. The app's model picker and `/model` still change it per session.
`effortLevel` stops at `xhigh`, so `max` starts new sessions at `xhigh`. The plugin only
removes a `model`/`effortLevel` it wrote itself; a value you set by hand stays.

Limits:

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
| `KEI_MAX_SESSIONS_PER_AGENT` | `2` | Settled resumable children listed per specialist (1–10) |
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
    "figma": { "type": "http", "url": "http://127.0.0.1:3845/mcp" },
    "trigger": { "command": "npx", "args": ["trigger.dev@latest", "mcp", "--readonly"] }
  }
}
```

| Server | Available to |
|---|---|
| `serena` | explorer (+ every agent without a `tools` allowlist) |
| `atlassian` | librarian (+ unrestricted agents) |
| `figma`, `trigger` | designer, developers, primary agents (no allowlist) |

Read-only agents (explorer, librarian, oracle, debugger, observer) only see the tools in
their `tools:` line; edit it to grant more.

## Skills

Bundled skills (`/claudekei:<name>`): `backend-developer`, `business-analyst`, `codemap`,
`karpathy-guidelines`, `simplify`, `vercel-react-best-practices`.

Agents preload theirs through the `skills:` frontmatter. Skills that oh-my-openkei
referenced but did not ship (`agent-browser`, `requesting-code-review`, `trigger-*`)
are not bundled — install them separately and add them to the agent's `skills:` list.

## Custom agents

Add a file to `agents/` with `name`, `description`, `model`, and optional `tools`,
`disallowedTools`, `skills`, `effort`, `color`, then describe it in the `<Agents>`
section of `agents/orchestrator.md` (and run `npm run sync:modes`). For a personal agent
that should not live in the plugin, put it in `~/.claude/agents/` and reference it by its
bare name.
