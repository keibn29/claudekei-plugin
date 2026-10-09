# Session Management

Session management lets the primary agents (Orchestrator, Planner, Sprinter,
Business Analyst) continue a specialist's earlier thread instead of starting a fresh
subagent every time. It is enabled by default.

## How it works

Claude Code already keeps every subagent resumable: the `Agent` tool returns an
`agentId`, and `SendMessage` with `to: <agentId>` resumes that subagent with its full
history. The plugin adds the OpenCode-style ergonomics on top with hooks
(`hooks/kei.mjs`):

| Hook | What it does |
|---|---|
| `PostToolUse` · `Agent` | Registers the new child under an alias (`exp-1`) and tells the model the alias |
| `PreToolUse` · `SendMessage` | Rewrites `to: "exp-1"` → the real agent id; rejects unknown/evicted aliases |
| `PostToolUse` · `SendMessage` | Marks the child as running again |
| `SubagentStop` | Marks the child as settled (idle) |
| `PostToolUse` · `Read` (inside a child) | Records which files that child has read |
| `UserPromptSubmit` | Injects the workflow reminder + the `### Resumable Sessions` list |
| `SessionStart` (resume/compact) | Re-advertises aliases after `--resume` or compaction |

Alias prefixes: `exp` explorer · `lib` librarian · `ora` oracle · `dbg` debugger ·
`des` designer · `fed` frontend-developer · `bed` backend-developer ·
`trg` trigger-developer · `obs` observer · `gen` general-purpose · first three letters
for any other agent type.

## Reuse is always explicit

| What the agent sends | What happens |
|---|---|
| `Agent(subagent_type: "kei:explorer", ...)` | New child, new alias |
| `SendMessage(to: "exp-1", ...)` | Continues the child behind `exp-1` |
| `SendMessage(to: "exp-9", ...)` (unknown/evicted) | Denied before running; the reason lists valid aliases |
| `SendMessage(to: "<raw agent id>", ...)` | Passed through unchanged |

Resumed children answer asynchronously like any background subagent: the result
arrives as a task notification.

## Retention

- `KEI_MAX_SESSIONS_PER_AGENT` (default `2`, range 1–10) settled children are listed per
  specialist type. Running children are protected and do not count toward the cap.
- Eviction only removes the alias from the list. The subagent itself is still
  resumable by its raw agent id until Claude Code cleans up transcripts
  (`cleanupPeriodDays`, default 30).
- Counters never reuse a number, so an evicted `exp-1` is never silently replaced by a
  different `exp-1`.
- State is stored per Claude Code session in `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json`.
  Unlike OpenCode's in-memory manager, it survives restarts and `claude --resume`.
  `/clear` resets it; files older than 7 days are pruned on session start.

## Read context

When a child reads a file with the `Read` tool, the list shows it:

```text
- explorer: exp-1 Search routing files
  Context read by exp-1: src/router.ts (120 lines), src/routes/api.ts (74 lines)
```

- `KEI_READ_CONTEXT_MIN_LINES` (default `10`) — minimum lines read before a file is listed.
- `KEI_READ_CONTEXT_MAX_FILES` (default `8`, `0` hides the list) — most recent files kept per child.

Reads through `Grep`, `Bash` or MCP tools are not tracked.

## Scope and limits

- Only `Agent` calls made from the main thread are aliased (children launched by
  other children are not).
- Built-in one-shot agents (`Explore`, `Plan`) return no agent id and are not aliased.
- The reminder/list is injected only when the main thread runs a `kei` primary agent
  (`settings.json` default, `--agent kei:*`, or a `/kei:*` mode switch). Alias
  resolution in `SendMessage` works regardless.
- Hooks fail open: if a hook errors, the tool call proceeds normally.

Set the variables in `~/.claude/settings.json` (or a project's `.claude/settings.json`):

```json
{
  "env": {
    "KEI_MAX_SESSIONS_PER_AGENT": "3",
    "KEI_READ_CONTEXT_MAX_FILES": "4"
  }
}
```
