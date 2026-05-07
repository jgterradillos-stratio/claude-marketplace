---
name: github-briefing
description: Query GitHub repositories for recent commits and open PRs using the configured repository list.
---

Base directory for this skill: /home/jgterradillos/Documentos/Workspaces/Bitbucket/claude-marketplace/plugins/basic-skills/skills/daily-briefing

Read `assets/github-repositories.json` from the daily-briefing assets directory.

Use the Agent tool with subagent_type `"basic-skills:github-briefing"` and this prompt:

```
Days: 2

Repository config:
<paste the full github-repositories.json content here>
```

Replace the placeholder with the actual content of `github-repositories.json`.

Report the structured markdown returned by the agent.
