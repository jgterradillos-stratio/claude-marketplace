---
name: release-from-master
description: Orchestrate a full release from master for a Stratio artifact: create release branch, wait for CI, generate prerelease, wait for CI, then generate final release.
model: sonnet
allowed-tools: mcp__plugin_artifact-tools_artifact-tools
---

This skill orchestrates a full release-from-master flow for artifact "$ARGUMENTS". Follow every step in order. If any step fails, stop immediately and report the error to the user — do not proceed.

---

## Step 1 — Get current snapshot version

Call `get_artifact_versions` with artifact `"$ARGUMENTS"`.

Extract the snapshot version (format: `X.Y.Z-SNAPSHOT`):
- **major.minor** = `X.Y`
- **next.minor** = `X.(Y+1)` (increment Y by 1)
- **branch_name** = `branch-X.Y`
- **release_version** = `X.Y.0`
- **prerelease_version** = `X.Y.0-BUILD`
- **branch_jenkins_version** = `X.Y#X.(Y+1)` (e.g. `1.5#1.6`)

Report to the user:
```
Artifact:         $ARGUMENTS
Snapshot:         X.Y.Z-SNAPSHOT
Branch to create: branch-X.Y
Master advances:  X.(Y+1).x-SNAPSHOT
Prerelease:       X.Y.0-BUILD
Release:          X.Y.0
```

---

## Step 2 — Wait for any active pipeline on master/main to finish

Call `get_branch_pipeline_status` with artifact `"$ARGUMENTS"` and branch `"master"`.

- If the tool returns an error indicating the branch or repo was not found (isError / 404), retry with branch `"main"`. Remember the resolved branch name for subsequent calls in this step.
- If the tool returns an error for any other reason: **stop** and report it.
- If any check run has status `queued` or `in_progress`: report "Active pipeline detected on master — waiting for it to finish..." and **poll every 60 seconds** (call `get_branch_pipeline_status` again after each wait) until all check runs reach a `completed` state.
  - If a check run completes with conclusion `failure`, `cancelled`, or `timed_out`: **stop** and report: "Pipeline on master failed before the release could start. Aborting."
  - After every 5 polling calls, report the current pipeline status so progress is visible.
  - Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.
- If all check runs are `completed` or no check runs exist: proceed to Step 3.

---

## Step 3 — Trigger Jenkins branch build

Call `trigger_jenkins_build` with:
- `type`: `"branch"`
- `artifact`: `"$ARGUMENTS"`
- `version`: `"X.Y#X.(Y+1)"` (e.g. `"1.5#1.6"`)

Save the returned queue URL or build URL.

Report: "Branch build triggered (X.Y#X.(Y+1)). Polling Jenkins..."

---

## Step 4 — Poll Jenkins until branch build completes

Call `get_jenkins_build_status` with the URL from Step 3. Repeat until a terminal status is reached. After every 10 calls, report the current status to the user so progress is visible. Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.

- `queued` / `running`: call again immediately.
- `success`: proceed to Step 5.
- `failure` / `aborted`: **stop** and report the error.

---

## Step 5 — Wait for GitHub CI on branch-X.Y

Call `get_branch_pipeline_status` with artifact `"$ARGUMENTS"` and branch `"branch-X.Y"`.

The branch may take a moment to register and for CI to be triggered. If no check runs are found yet (total_count = 0), call again immediately. Do this up to 20 times before concluding there is no CI to wait for.

Loop until all check runs are `completed`. After every 5 calls, report the current status. Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.

- If a check run completes with conclusion `failure`, `cancelled`, or `timed_out`: **stop** and report the failure, asking the user whether to continue.

Once all completed successfully: proceed to Step 6.

---

## Step 6 — Trigger Jenkins prerelease

Call `trigger_jenkins_build` with:
- `type`: `"prerelease"`
- `artifact`: `"$ARGUMENTS"`
- `version`: `"X.Y.0-BUILD"` (e.g. `"1.5.0-BUILD"`)

Save the returned queue URL or build URL.

Report: "Prerelease triggered (X.Y.0-BUILD). Polling Jenkins..."

---

## Step 7 — Poll Jenkins until prerelease completes

Same polling logic as Step 4, using the URL from Step 6.

- `success`: proceed to Step 8.
- `failure` / `aborted`: **stop** and report the error.

---

## Step 8 — Wait for GitHub CI on branch-X.Y after prerelease

The prerelease build may push a new commit to `branch-X.Y`, changing the branch HEAD and triggering a new CI run.

Call `get_branch_pipeline_status` with artifact `"$ARGUMENTS"` and branch `"branch-X.Y"`.

**Determine whether there is new CI to wait for:**
- If no check runs found (total_count = 0): call again immediately. Retry up to 20 times. If still no runs, conclude no CI was triggered and proceed to Step 9.
- If check runs exist and any are `queued` or `in_progress`: there is active CI — loop until all complete (same logic as Step 5).
- If all check runs are `completed` on the first call: call **once more** to confirm this is not a timing artifact (the new CI may not have been registered yet). If the second call also shows all completed, proceed to Step 9.

After every 5 calls while looping, report progress. Stop after 60 consecutive non-terminal results and ask the user whether to keep waiting.

- If any check run fails: **stop** and report, asking the user whether to continue.

Once confirmed no active CI or all completed successfully: proceed to Step 9.

---

## Step 9 — Trigger Jenkins final release

Call `trigger_jenkins_build` with:
- `type`: `"release"`
- `artifact`: `"$ARGUMENTS"`
- `version`: `"X.Y.0"` (e.g. `"1.5.0"`)

Save the returned queue URL or build URL.

Report: "Final release triggered (X.Y.0). Polling Jenkins..."

Poll `get_jenkins_build_status` until terminal (same logic as Step 4):
- `success`: report "Release X.Y.0 of $ARGUMENTS completed successfully."
- `failure` / `aborted`: **stop** and report the error.
