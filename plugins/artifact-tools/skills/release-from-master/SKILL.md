---
name: release-from-master
description: Orchestrate a full release from master for a Stratio artifact: create release branch, wait for CI, generate prerelease, wait for CI, then generate final release.
model: sonnet
allowed-tools: mcp__plugin_artifact-tools_artifact-tools
---

This skill orchestrates a full release-from-master flow for artifact "$ARGUMENTS". Follow every step in order. If any step fails, stop immediately and report the error to the user — do not proceed.

---

## Step 0 — Parse arguments and resolve Jenkins subdirectory

Parse `$ARGUMENTS`:
- Split on the first space: **artifact** = first token, **subdirectory** = second token (if present).
- Example: `my-repo SFE` → artifact=`my-repo`, subdirectory=`SFE`
- Example: `my-repo` → artifact=`my-repo`, subdirectory=unknown

If **subdirectory** is already known from the arguments: proceed to Step 1.

If **subdirectory** is not provided:
- Call `list_jenkins_subdirectories`.
- Show the complete numbered list as plain text to the user exactly as returned by the tool.
- Ask: "Which Jenkins subdirectory contains **<artifact>**? Reply with the name or number."
- Wait for the user's reply and resolve the **subdirectory** from it (by name or by position in the list).

Remember **subdirectory** — it will be passed to every `trigger_jenkins_build` call in this skill.

---

## Step 1 — Get current snapshot version

Call `get_artifact_versions` with artifact `"<artifact>"`.

Extract the snapshot version (format: `X.Y.Z-SNAPSHOT`):
- **major.minor** = `X.Y`
- **next.minor** = `X.(Y+1)` (increment Y by 1)
- **branch_name** = `branch-X.Y`
- **release_version** = `X.Y.0`
- **prerelease_version** = `X.Y.0-BUILD`
- **branch_jenkins_version** = `X.Y#X.(Y+1)` (e.g. `1.5#1.6`)

Report to the user:
```
Artifact:         <artifact>
Subdirectory:     <subdirectory>
Snapshot:         X.Y.Z-SNAPSHOT
Branch to create: branch-X.Y
Master advances:  X.(Y+1).x-SNAPSHOT
Prerelease:       X.Y.0-BUILD
Release:          X.Y.0
```

---

## Step 2 — Wait for any active pipeline on master/main to finish

Call `get_branch_pipeline_status` with artifact `"<artifact>"` and branch `"master"`.

- If the tool returns an error indicating the branch or repo was not found (isError / 404), retry with branch `"main"`. Remember the resolved branch name for subsequent calls in this step.
- If the tool returns an error for any other reason: **stop** and report it.
- If any check run has status `queued` or `in_progress`: report "Active pipeline detected on master — waiting for it to finish..." and **loop**: use `ScheduleWakeup` with `delaySeconds=60`, then call `get_branch_pipeline_status` again. Do NOT poll in a tight loop.
  - If a check run completes with conclusion `failure`, `cancelled`, or `timed_out`: **stop** and report: "Pipeline on master failed before the release could start. Aborting."
  - After every 5 polls, report the current pipeline status so progress is visible.
  - Stop after 60 polls and ask the user whether to keep waiting.
- If all check runs are `completed` or no check runs exist: proceed to Step 3.

---

## Step 3 — Trigger Jenkins branch build

Call `trigger_jenkins_build` with:
- `type`: `"branch"`
- `artifact`: `"<artifact>"`
- `version`: `"X.Y#X.(Y+1)"` (e.g. `"1.5#1.6"`)
- `subdirectory`: `"<subdirectory>"`

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

Call `get_branch_pipeline_status` with artifact `"<artifact>"` and branch `"branch-X.Y"`.

The branch may take a moment to register and for CI to be triggered. If no check runs are found yet (total_count = 0), use `ScheduleWakeup` with `delaySeconds=60` and retry. Do this up to 20 times before concluding there is no CI to wait for.

**Loop** until all check runs are `completed`: use `ScheduleWakeup` with `delaySeconds=60` between each poll. Do NOT poll in a tight loop. After every 5 polls, report the current status. Stop after 60 polls and ask the user whether to keep waiting.

- If a check run completes with conclusion `failure`, `cancelled`, or `timed_out`: **stop** and report the failure, asking the user whether to continue.

Once all completed successfully: proceed to Step 6.

---

## Step 6 — Trigger Jenkins prerelease

Call `trigger_jenkins_build` with:
- `type`: `"prerelease"`
- `artifact`: `"<artifact>"`
- `version`: `"X.Y.0-BUILD"` (e.g. `"1.5.0-BUILD"`)
- `subdirectory`: `"<subdirectory>"`

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

Call `get_branch_pipeline_status` with artifact `"<artifact>"` and branch `"branch-X.Y"`.

**Determine whether there is new CI to wait for:**
- If no check runs found (total_count = 0): use `ScheduleWakeup` with `delaySeconds=60` and retry. Do this up to 20 times before concluding no CI was triggered — proceed to Step 9.
- If check runs exist and any are `queued` or `in_progress`: there is active CI — loop using `ScheduleWakeup` with `delaySeconds=60` between each poll (same logic as Step 5). Do NOT poll in a tight loop.
- If all check runs are `completed` on the first call: wait 60s (`ScheduleWakeup`) and call **once more** to confirm this is not a timing artifact. If the second call also shows all completed, proceed to Step 9.

After every 5 polls while looping, report progress. Stop after 60 polls and ask the user whether to keep waiting.

- If any check run fails: **stop** and report, asking the user whether to continue.

Once confirmed no active CI or all completed successfully: proceed to Step 9.

---

## Step 9 — Trigger Jenkins final release

Call `trigger_jenkins_build` with:
- `type`: `"release"`
- `artifact`: `"<artifact>"`
- `version`: `"X.Y.0"` (e.g. `"1.5.0"`)
- `subdirectory`: `"<subdirectory>"`

Save the returned queue URL or build URL.

Report: "Final release triggered (X.Y.0). Polling Jenkins..."

Poll `get_jenkins_build_status` until terminal (same logic as Step 4):
- `success`: report "Release X.Y.0 of <artifact> completed successfully."
- `failure` / `aborted`: **stop** and report the error.
