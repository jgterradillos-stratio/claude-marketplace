---
name: merge-pr-and-release-from-master
description: Merge a GitHub PR (squash, bypassing rules) after its CI passes, then automatically run the full release-from-master flow for the artifact.
model: sonnet
allowed-tools: mcp__plugin_artifact-tools_artifact-tools
---

This skill merges a GitHub PR and then orchestrates a full release from master. The argument `$ARGUMENTS` is the PR URL (e.g. `https://github.com/Stratio/my-repo/pull/42`). Follow every step in order. If any step fails, stop immediately and report the error to the user — do not proceed.

---

## Step 0 — Parse arguments and resolve Jenkins subdirectory

Parse `$ARGUMENTS`:
- The first token is the PR URL. Extract from it:
  - **artifact**: segment after `/Stratio/` and before `/pull/`
  - **pull_number**: integer after `/pull/`
- The second token (if present, separated by a space after the URL) is the **subdirectory**.

Example: `https://github.com/Stratio/my-repo/pull/42 SFE` → artifact=`my-repo`, pull_number=`42`, subdirectory=`SFE`
Example: `https://github.com/Stratio/my-repo/pull/42` → artifact=`my-repo`, pull_number=`42`, subdirectory=unknown

If **subdirectory** is already known from the arguments: proceed to Step 1.

If **subdirectory** is not provided:
- Call `list_jenkins_subdirectories`.
- Show the complete numbered list as plain text to the user exactly as returned by the tool.
- Ask: "Which Jenkins subdirectory contains **<artifact>**? Reply with the name or number."
- Wait for the user's reply and resolve the **subdirectory** from it (by name or by position in the list).

Remember **subdirectory** — it will be passed to every `trigger_jenkins_build` call in this skill.

---

## Step 1 — Wait for CI and verify all checks pass

Call `get_pr_pipeline_status` with artifact and pull_number.

- If the tool returns a 404 or no check runs exist (total_count = 0): no CI to wait for — proceed to Step 2.
- If any check run has status `queued` or `in_progress`: report "Active CI detected on PR #<pull_number> — waiting for it to finish..." and **loop**: call `get_pr_pipeline_status` again immediately until all check runs reach a `completed` state.
  - After every 5 polling calls, report the current status so progress is visible.
  - Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.
- Once all check runs are `completed`, verify conclusions:
  - Allowed conclusions (green): `success`, `skipped`, `neutral`.
  - Blocking conclusions: `failure`, `timed_out`, `cancelled`, `action_required`, `stale`.
  - If **any** check run has a blocking conclusion: **stop** and report which checks failed — do not proceed to merge.
  - If all check runs have allowed conclusions: proceed to Step 2.

---

## Step 2 — Merge the PR

Call `merge_pull_request` with artifact and pull_number (no custom commit_title or commit_message — the PR title is used as default).

- If successful: report "PR #<pull_number> merged (squash). Commit: <sha>."
- If it returns an error: **stop** and report the error.

---

## Phase 2 — Release from master

The PR is now merged. Continue with the full release-from-master flow for **<artifact>**. Follow every step below in order.

---

## Step 3 — Get current snapshot version

Call `get_artifact_versions` with artifact `<artifact>`.

Extract the snapshot version (format: `X.Y.Z-SNAPSHOT`):
- **major.minor** = `X.Y`
- **next.minor** = `X.(Y+1)` (increment Y by 1)
- **branch_name** = `branch-X.Y`
- **release_version** = `X.Y.0`
- **prerelease_version** = `X.Y.0-BUILD`
- **branch_jenkins_version** = `X.Y#X.(Y+1)` (e.g. `1.5#1.6`)

Report:
```
Artifact:         <artifact>
Snapshot:         X.Y.Z-SNAPSHOT
Branch to create: branch-X.Y
Master advances:  X.(Y+1).x-SNAPSHOT
Prerelease:       X.Y.0-BUILD
Release:          X.Y.0
```

---

## Step 4 — Wait for any active pipeline on master/main to finish

Call `get_branch_pipeline_status` with artifact and branch `"master"`.

- If the tool returns an error indicating the branch or repo was not found (isError / 404), retry with branch `"main"`. Remember the resolved branch name for subsequent calls in this step.
- If the tool returns an error for any other reason: **stop** and report it.
- If any check run has status `queued` or `in_progress`: report "Active pipeline detected on master — waiting for it to finish..." and **loop**: call `get_branch_pipeline_status` again immediately until all check runs reach a `completed` state.
  - If a check run completes with conclusion `failure`, `cancelled`, or `timed_out`: **stop** and report: "Pipeline on master failed before the release could start. Aborting."
  - After every 5 polling calls, report the current pipeline status so progress is visible.
  - Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.
- If all check runs are `completed` or no check runs exist: proceed to Step 5.

---

## Step 5 — Trigger Jenkins branch build

Call `trigger_jenkins_build` with:
- `type`: `"branch"`
- `artifact`: `<artifact>`
- `version`: `"X.Y#X.(Y+1)"` (e.g. `"1.5#1.6"`)
- `subdirectory`: `<subdirectory>`

Save the returned queue URL or build URL.

Report: "Branch build triggered (X.Y#X.(Y+1)). Polling Jenkins..."

---

## Step 6 — Poll Jenkins until branch build completes

Call `get_jenkins_build_status` with the URL from Step 5. Repeat until a terminal status is reached. After every 10 calls, report the current status. Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.

- `queued` / `running`: call again immediately.
- `success`: proceed to Step 7.
- `failure` / `aborted`: **stop** and report the error.

---

## Step 7 — Wait for GitHub CI on branch-X.Y

Call `get_branch_pipeline_status` with artifact and branch `"branch-X.Y"`.

The branch may take a moment to register and for CI to be triggered. If no check runs are found yet (total_count = 0), call again immediately. Do this up to 20 times before concluding there is no CI to wait for.

Loop until all check runs are `completed`. After every 5 calls, report the current status. Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.

- If a check run completes with conclusion `failure`, `cancelled`, or `timed_out`: **stop** and report the failure, asking the user whether to continue.

Once all completed successfully: proceed to Step 8.

---

## Step 8 — Trigger Jenkins prerelease

Call `trigger_jenkins_build` with:
- `type`: `"prerelease"`
- `artifact`: `<artifact>`
- `version`: `"X.Y.0-BUILD"` (e.g. `"1.5.0-BUILD"`)
- `subdirectory`: `<subdirectory>`

Save the returned queue URL or build URL.

Report: "Prerelease triggered (X.Y.0-BUILD). Polling Jenkins..."

---

## Step 9 — Poll Jenkins until prerelease completes

Same polling logic as Step 6, using the URL from Step 8.

- `success`: proceed to Step 10.
- `failure` / `aborted`: **stop** and report the error.

---

## Step 10 — Wait for GitHub CI on branch-X.Y after prerelease

The prerelease build may push a new commit to `branch-X.Y`, changing the branch HEAD and triggering a new CI run.

Call `get_branch_pipeline_status` with artifact and branch `"branch-X.Y"`.

**Determine whether there is new CI to wait for:**
- If no check runs found (total_count = 0): call again immediately. Retry up to 20 times. If still no runs, conclude no CI was triggered and proceed to Step 11.
- If check runs exist and any are `queued` or `in_progress`: there is active CI — loop until all complete (same logic as Step 7).
- If all check runs are `completed` on the first call: call **once more** to confirm this is not a timing artifact. If the second call also shows all completed, proceed to Step 11.

After every 5 calls while looping, report progress. Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.

- If any check run fails: **stop** and report, asking the user whether to continue.

Once confirmed no active CI or all completed successfully: proceed to Step 11.

---

## Step 11 — Trigger Jenkins final release

Call `trigger_jenkins_build` with:
- `type`: `"release"`
- `artifact`: `<artifact>`
- `version`: `"X.Y.0"` (e.g. `"1.5.0"`)
- `subdirectory`: `<subdirectory>`

Save the returned queue URL or build URL.

Report: "Final release triggered (X.Y.0). Polling Jenkins..."

Poll `get_jenkins_build_status` until terminal (same logic as Step 6):
- `success`: report "Release X.Y.0 of <artifact> completed successfully."
- `failure` / `aborted`: **stop** and report the error.
