---
name: scope-versions
description: Show the latest release, snapshot and prerelease for every artifact repository matching a scope keyword (e.g. 'gosec', 'egeo'). For the 'SFE' scope, uses a predefined list of repositories.
model: sonnet
allowed-tools: mcp__artifacts-manager
---

Follow these steps to respond to the user's request for scope "$ARGUMENTS":

## Step 1 — Get the list of repositories with their technology

**If "$ARGUMENTS" is "SFE" (case-insensitive):**
- Read the file `assets/scopes/sfe.md` from the skill base directory. Each line is a repository name.
- For each repository, call `get_artifact_info` to get technology and versions in one call. Skip to Step 3.

**Otherwise:**
- Call `search_artifacts` with query "$ARGUMENTS". This returns a list of repositories with their name, technology and link.
- Keep the technology and link for each repository for use in Step 3.

## Step 2 — Get versions (only for non-predefined scopes)

For each repository returned by `search_artifacts`, call `get_artifact_versions`.

## Step 3 — Display results

First, output a summary markdown table with these exact columns:

| Repository | Technology | Release | Snapshot | Prerelease | Link |
|---|---|---|---|---|---|

Column rules:
- **Repository**: repository name
- **Technology**: programming language (from `search_artifacts` or `get_artifact_info`)
- **Release**: highest stable version (first in the releases list)
- **Snapshot**: master/main snapshot version
- **Prerelease**: highest prerelease version (first in the prereleases list)
- **Link**: GitHub repository URL
- Use "—" for any column where the value is not available

Then, after the table, reproduce the full raw response from `get_artifact_versions` (or `get_artifact_info`) for each repository **verbatim** — every field, line, and section — without omitting, summarizing, or reformatting anything.

Do not omit any repository from either the table or the detail section.
