---
name: jira-briefing
description: Query Jira projects for recent activity. Usage: /jira-briefing [PROJECT1 PROJECT2 ...] — defaults to FLOW and PLT if no projects specified.
---

Parse `$ARGUMENTS` as a space-separated list of Jira project keys (e.g. `FLOW PLT`). If empty, default to `FLOW PLT`.

Use the Agent tool with subagent_type `"basic-skills:jira-briefing"` and this prompt:

```
Projects: <KEYS>
Days: 2
```

Replace `<KEYS>` with the comma-separated list of project keys.

Report the structured markdown returned by the agent.
