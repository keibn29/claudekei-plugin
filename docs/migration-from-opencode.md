# Migrating from oh-my-openkei (OpenCode)

## Mapped 1:1

| oh-my-openkei | claudekei |
|---|---|
| Orchestrator, Planner, Sprinter, Business Analyst prompts | `agents/{orchestrator,planner,sprinter,business-analyst}.md` (same text, Claude Code tool names) |
| 7 specialist prompts (trigger-developer and observer dropped) | `agents/*.md`, invoked as `claudekei:<name>` |
| `task` tool | `Agent` tool |
| `task_id="exp-1"` reuse | `SendMessage(to: "exp-1")` |
| Task session manager (aliases, read context, protected running children, per-agent cap) | `hooks/claudekei.mjs` + native subagent resume |
| `question` tool | `AskUserQuestion` (primary agents); subagents return the question to the caller |
| Phase reminder, post-Read/Write nudge | `UserPromptSubmit` / `PostToolUse` hooks |
| Planner delegate validation | `PreToolUse` hook on `Agent` + `tools: Agent(...)` allowlist |
| Designer is decision/spec-only | `disallowedTools: Agent, Bash, NotebookEdit` + `PreToolUse` hook on file edits (only `*.md`/`*.mdx`/`.designer/` allowed) |
| Read-only permission profile | `tools:` allowlists |
| Per-agent skill permissions + "load skills first" | `skills:` frontmatter (namespaced `claudekei:<name>`, preloaded) + a "verify/load your skills first" step in the FE/BE/BA prompts |
| Per-agent MCP lists | `tools:` allowlists with `mcp__plugin_claudekei_<server>__*` |
| `variant` | `effort` |
| Tab to switch primary agent | `claude --agent claudekei:<name>` or `/claudekei:orchestrate`, `/claudekei:plan`, `/claudekei:sprint`, `/claudekei:analyze` |
| Bundled skills | `skills/` (codemap now registers in `CLAUDE.md`) |
| `bunx oh-my-openkei install` | `claude plugin marketplace add` + `claude plugin install` |

## Changed behaviour

- **Background subagents.** Claude Code may run subagents in the background; results
  arrive as task notifications. The prompts tell primary agents to wait for them.
- **Session state persists** across restarts and `--resume` (OpenCode kept it in memory).

## Dropped (not needed or not possible)

| Feature | Why |
|---|---|
| Mixed providers per agent, model fallback chains (`foreground-fallback`) | Claude Code runs Anthropic models; `claudekei.jsonc` only picks among `opus`/`sonnet`/`haiku`/`fable`. See [configuration](configuration.md#third-party-models-unsupported-by-anthropic) |
| `apply-patch`, `json-error-recovery`, `delegate-task-retry` | Worked around non-Claude tool-call quirks |
| `chat-headers`, image hook | OpenCode-specific |
| `filter-available-skills` | Replaced by `skills:` preloading (namespaced names) |
| `auto-update-checker`, CLI installer, config schema | Handled by the plugin marketplace; the active `oh-my-openkei.jsonc` preset maps to the single `subAgents` map in `claudekei.jsonc` (models/effort/sessionManager) |
| `webfetch` (smartfetch), `ast_grep_*` tools | Use built-in `WebFetch`; add an ast-grep MCP server if you need structural search |
| `disabled_agents`, `displayName`, prompt override files | Edit or delete files in `agents/` |
