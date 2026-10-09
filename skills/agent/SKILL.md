---
name: agent
description: 'Set the default claudekei agent for NEW sessions in this project (orchestrator, planner, sprinter, business-analyst, or reset). Writes .claude/settings.local.json.'
argument-hint: '<orchestrator|planner|sprinter|business-analyst|reset>'
disable-model-invocation: true
---

The claudekei `UserPromptSubmit` hook normally handles this command before it
reaches you. If you are reading this, the hook did not run (for example, `node`
was not found). Tell the user that in one sentence, then do the same job:

1. Map the argument `$ARGUMENTS` to an agent: `orchestrator`/`orchestrate`,
   `planner`/`plan`, `sprinter`/`sprint`, `business-analyst`/`analyze`.
   `reset` means remove the override. No argument means only report the current value.
2. In `.claude/settings.local.json` at the project root, set `"agent"` to
   `"claudekei:<agent>"` (or delete the `agent` key for `reset`). Keep every other key.
3. Tell the user to start a new session (Cmd+N in the desktop app). The current
   conversation keeps its agent; `/claudekei:<mode>` switches roles in place.
