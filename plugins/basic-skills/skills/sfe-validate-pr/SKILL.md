---
name: sfe-validate-pr
description: Validate a pull request by reviewing local changes not yet pushed to upstream. Launches an isolated agent to avoid polluting the chat context.
---

Launch the sfe-agent-validate-pr agent to validate the PR changes in isolation:

Use the Agent tool with subagent_type "basic-skills:sfe-agent-validate-pr" and the following prompt:

"Validate the local commits not yet pushed to upstream against coding conventions."

Report the agent's findings back to the user.
