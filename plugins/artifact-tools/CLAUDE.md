# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`artifact-tools` is a Claude plugin that exposes MCP tools and skills to query Stratio artifact repositories, inspect versions, and trigger Jenkins builds.

## Key Concepts

**Artifact:** An individual Stratio artifact — can be a chart, Docker image, library, Python package, etc. Users can query its latest release, versions, branches, and trigger builds from it.

**Universe:** The named product bundle — a versioned set of Stratio artifacts that ship together.

## Stack

TypeScript MCP server using `@modelcontextprotocol/sdk`. Source in `src/mcp/`, compiled to `dist/mcp/`.

## Commands

Run from the project root:
```bash
npm run build   # compile TypeScript → dist/mcp/
npm run dev     # run with tsx (no build needed, for development)
npm start       # run compiled server (requires build first)
```

## MCP Integration

`.mcp.json` at the project root configures Claude Code to run `dist/mcp/index.js`. Environment variables (`GITHUB_TOKEN`, `JENKINS_USER`, `JENKINS_TOKEN`) are read from the shell.

## Tool output policy

When any MCP tool returns a result, always reproduce the **complete response verbatim** — every field, line, and section — without summarizing, reformatting, or omitting any part. This applies to all tools: `get_artifact_info`, `get_artifact_versions`, `search_artifacts`, `list_artifact_branches`, `get_latest_release`, and all Jenkins tools.

## Available MCP Tools

### GitHub (`github-mcp.ts`)

| Tool | Description |
|---|---|
| `search_artifacts` | Search repos in the Stratio GitHub org by name (prefix, suffix, or substring) |
| `get_artifact_info` | Repo metadata, README summary, and all versions (snapshot/releases/milestones/prereleases + dev branch) |
| `get_artifact_versions` | All versions of an artifact: snapshot, releases, milestones, prereleases, dev branch status |
| `get_latest_release` | Latest version of a given type: `release`, `snapshot`, `milestone`, or `prerelease` |
| `list_artifact_branches` | All branches of an artifact repo (main, maintenance `branch-x.y`, and others) |
| `get_pull_request_info` | PR metadata: title, state, head/base branch, head SHA, author, draft status, mergeable flag |
| `get_pr_pipeline_status` | CI check runs for a PR's head commit (by pull_number). Use instead of `get_branch_pipeline_status` when you have a PR number |
| `merge_pull_request` | Squash-merge a PR bypassing branch protection rules. Requires admin token. Verifies PR is open before merging |

### Jenkins (`jenkins-mcp.ts`)

| Tool | Description |
|---|---|
| `list_jenkins_subdirectories` | List subdirectories under `Release/` in Jenkins |
| `trigger_jenkins_build` | Trigger a build: `prerelease`, `milestone`, `release`, or `branch` (create maintenance branch) |
| `get_jenkins_build_status` | Poll build status from queue URL or build URL; returns `queued/running/success/failure/aborted` |

#### Version formats
- **Prerelease:** `x.y.z-BUILD` — requires `branch-x.y` to exist
- **Milestone:** `x.y.z-M` — uses `branch-x.y` if it exists, otherwise master; version can be auto-read
- **Release:** `x.y.z` — requires `branch-x.y` to exist
- **Branch:** `x.y#master_version` — creates `branch-x.y` and advances master

## Available Skills

| Skill | Description |
|---|---|
| `artifact-latest-versions` | All versions for an artifact: snapshot, releases, milestones, prereleases, dev branch |
| `scope-versions` | Table with release, snapshot, and prerelease for all repos matching a keyword |
| `artifacts-manager-examples` | Quick-reference guide of everything the plugin can do |
| `release-from-master` | Full release-from-master flow: create branch, prerelease, release. Accepts `<artifact> [subdirectory]` — asks for Jenkins subdirectory at the start if not provided |
| `merge-pr-and-release-from-master` | Waits for PR CI to pass (all checks green), squash-merges the PR bypassing rules, then runs the full release-from-master flow. Accepts `<pr-url> [subdirectory]` |

Skills live in `skills/<name>/SKILL.md`. A symlink at `.claude/skills/` enables them during local development.

### Jenkins subdirectory resolution

Both `release-from-master` and `merge-pr-and-release-from-master` accept an optional subdirectory as a second argument (e.g. `/release-from-master my-repo SFE`). If omitted, the skill calls `list_jenkins_subdirectories` at the start, shows the list to the user, and waits for their reply before proceeding. The resolved subdirectory is then passed to every `trigger_jenkins_build` call in the flow.

## Adding New Tools

Add a `register*Tools(server: McpServer)` function in `src/mcp/` (named `<domain>-mcp.ts`) and call it from `src/mcp/index.ts`. Use `server.registerTool()` (not the deprecated `server.tool()`).

## Adding New Skills

Create `skills/<name>/SKILL.md` with a YAML frontmatter `description` field and the skill instructions. Add a symlink in `.claude/skills/` for local testing.

## Repository

- **Remote:** git@github.com:jgterradillos-stratio/stratio-assistant.git
- **Main branch:** `main`
