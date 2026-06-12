---
name: merge-pr
description: Wait for a GitHub PR's CI to pass, then squash-merge it (bypassing rules). No release triggered.
model: sonnet
allowed-tools: mcp__plugin_artifact-tools_artifact-tools
---

This skill merges a GitHub PR after its CI passes. The argument `$ARGUMENTS` is the PR URL (e.g. `https://github.com/Stratio/my-repo/pull/42`). Follow every step in order. If any step fails, stop immediately and report the error to the user — do not proceed.

---

## Step 1 — Parse arguments

Parse `$ARGUMENTS`:
- The first token is the PR URL. Extract from it:
  - **artifact**: segment after `/Stratio/` and before `/pull/`
  - **pull_number**: integer after `/pull/`

Example: `https://github.com/Stratio/my-repo/pull/42` → artifact=`my-repo`, pull_number=`42`

---

## Step 2 — Wait for CI and verify all checks pass

Call `get_pr_pipeline_status` with artifact and pull_number.

- If the tool returns a 404 or no check runs exist (total_count = 0): no CI to wait for — proceed to Step 3.
- If any check run has status `queued` or `in_progress`: report "Active CI detected on PR #<pull_number> — waiting for it to finish..." and **loop**: use `ScheduleWakeup` with `delaySeconds=60`, then call `get_pr_pipeline_status` again. Do NOT poll in a tight loop.
  - After every 5 polls, report the current status so progress is visible.
  - Stop after 60 polls and ask the user whether to keep waiting.
- Once all check runs are `completed`, verify conclusions:
  - Allowed conclusions (green): `success`, `skipped`, `neutral`.
  - Blocking conclusions: `failure`, `timed_out`, `cancelled`, `action_required`, `stale`.
  - If **any** check run has a blocking conclusion: **stop** and report which checks failed — do not proceed to merge.
  - If all check runs have allowed conclusions: proceed to Step 3.

---

## Step 3 — Merge the PR

Call `merge_pull_request` with artifact and pull_number (no custom commit_title or commit_message — the PR title is used as default).

- If successful: report "PR #<pull_number> merged (squash). Commit: <sha>."
- If it returns an error: **stop** and report the error.
