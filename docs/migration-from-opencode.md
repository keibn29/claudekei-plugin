# Migrating from oh-my-openkei (OpenCode)

## Mapped 1:1

| oh-my-openkei | claudekei |
|---|---|
| Orchestrator, Planner, Sprinter, Business Analyst prompts | `agents/{orchestrator,planner,sprinter,business-analyst}.md` (same text, Claude Code tool names) |
| 9 specialist prompts | `agents/*.md`, invoked as `kei:<name>` |
| `task` tool | `Agent` tool |
| `task_id="exp-1"` reuse | `SendMessage(to: "exp-1")` |
| Task session manager (aliases, read context, protected running children, per-agent cap) | `hooks/kei.mjs` + native subagent resume |
| `question` tool | `AskUserQuestion` (primary agents); subagents return the question to the caller |
| Phase reminder, post-Read/Write nudge | `UserPromptSubmit` / `PostToolUse` hooks |
| Planner delegate validation | `PreToolUse` hook on `Agent` + `tools: Agent(...)` allowlist |
| Read-only permission profile | `tools:` allowlists |
| Per-agent skill permissions + "load skills first" | `skills:` frontmatter (preloaded) |
| Per-agent MCP lists | `tools:` allowlists with `mcp__plugin_kei_<server>__*` |
| `variant` | `effort` |
| Tab to switch primary agent | `claude --agent kei:<name>` or `/kei:orchestrate`, `/kei:plan`, `/kei:sprint`, `/kei:analyze` |
| Bundled skills | `skills/` (codemap now registers in `CLAUDE.md`) |
| `bunx oh-my-openkei install` | `claude plugin marketplace add` + `claude plugin install` |

## Changed behaviour

- **Background subagents.** Claude Code may run subagents in the background; results
  arrive as task notifications. The prompts tell primary agents to wait for them.
- **Session state persists** across restarts and `--resume` (OpenCode kept it in memory).
- **Observer is enabled** by default; Claude models read images and PDFs natively, and
  Observer still keeps raw bytes out of the orchestrator's context.

## Dropped (not needed or not possible)

| Feature | Why |
|---|---|
| Mixed providers per agent, model fallback chains (`foreground-fallback`) | Claude Code runs Anthropic models; no per-request model hook. See [configuration](configuration.md#third-party-models-unsupported-by-anthropic) |
| `apply-patch`, `json-error-recovery`, `delegate-task-retry` | Worked around non-Claude tool-call quirks |
| `chat-headers`, image hook | OpenCode-specific |
| `filter-available-skills` | Replaced by `skills:` preloading |
| `auto-update-checker`, CLI installer, config schema/presets | Handled by the plugin marketplace and agent frontmatter |
| `webfetch` (smartfetch), `ast_grep_*` tools | Use built-in `WebFetch`; add an ast-grep MCP server if you need structural search |
| `disabled_agents`, `displayName`, prompt override files | Edit or delete files in `agents/` |
