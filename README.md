# jgterradillos-plugins

A Claude Code plugin marketplace. Each plugin packages skills and agents as slash commands for use in Claude Code.

## Available plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| [artifact-tools](./plugins/artifact-tools/) | 0.1.0 | Query Stratio artifact releases, inspect versions across repos, and trigger Jenkins builds |
| [basic-skills](./plugins/basic-skills/) | 0.1.0 | General-purpose development skills and agents |

---

### artifact-tools

MCP-backed plugin. Requires environment variables: `GITHUB_TOKEN`, `JENKINS_USER`, `JENKINS_TOKEN`.

**Skills (slash commands)**

| Skill | Command | Description |
|-------|---------|-------------|
| artifact-latest-versions | `/artifact-tools:artifact-latest-versions` | Show all available versions of a Stratio artifact: snapshot, releases, milestones, prereleases and dev branch |
| artifacts-manager-examples | `/artifact-tools:artifacts-manager-examples` | Show a quick-reference guide of everything artifacts-manager can do, organized by category |
| scope-versions | `/artifact-tools:scope-versions` | Show the latest release, snapshot and prerelease for every artifact repo matching a scope keyword |

**MCP tools exposed**

| Tool | Description |
|------|-------------|
| `search_artifacts` | Search repos in the Stratio GitHub org by name |
| `get_artifact_info` | Repo metadata, README summary, and all versions |
| `get_artifact_versions` | All versions: snapshot, releases, milestones, prereleases, dev branch |
| `get_latest_release` | Latest version of a given type: `release`, `snapshot`, `milestone`, or `prerelease` |
| `list_artifact_branches` | All branches of an artifact repo |
| `list_jenkins_subdirectories` | List subdirectories under `Release/` in Jenkins |
| `trigger_jenkins_build` | Trigger a build: `prerelease`, `milestone`, `release`, or `branch` |
| `get_jenkins_build_status` | Poll build status from queue URL or build URL |

---

### basic-skills

**Skills (slash commands)**

| Skill | Command | Description |
|-------|---------|-------------|
| sfe-validate-pr | `/basic-skills:sfe-validate-pr` | Validates local commits not yet pushed to upstream against Stratio coding conventions. Runs in an isolated agent to avoid polluting the chat context. |

**Agents**

| Agent | Subagent type | Description |
|-------|--------------|-------------|
| sfe-validate-pr-agent | `basic-skills:sfe-validate-pr-agent` | Validates unpushed commits against Stratio conventions (types, private naming, observable suffix, license headers). |
| sfe-readme-updater-agent | `basic-skills:sfe-readme-updater-agent` | Audits and updates an Angular component library's README.md to match the current public API and style imports. |

---

## Installation

Add this marketplace to Claude Code:

```bash
claude plugin marketplace add https://bitbucket.org/javiergt_85/claude-marketplace/raw/main
```

Then install any plugin:

```bash
claude plugin install artifact-tools@jgterradillos-plugins
claude plugin install basic-skills@jgterradillos-plugins
```

---

## Structure

```
.claude-plugin/marketplace.json       # Marketplace registry
plugins/<plugin-name>/
  .claude-plugin/plugin.json          # Plugin metadata (name, version, description, mcp, ...)
  agents/<AgentName>.md               # Agent definitions (optional)
  skills/<SkillName>/SKILL.md         # Skill definitions (slash commands)
```

**MCP plugins** additionally include:

```
plugins/<plugin-name>/
  bin/start.sh                        # Entrypoint script for the MCP server
  src/mcp/                            # MCP server source (TypeScript)
  dist/mcp/                           # Compiled output (run by start.sh)
```

## Local development

### Validate the marketplace

```bash
/plugin validate .
```

### Test a plugin directly (fast iteration)

Launch Claude Code pointing to one or more plugin directories (`--plugin-dir` is repeatable):

```bash
claude --plugin-dir ./plugins/basic-skills
claude --plugin-dir ./plugins/artifact-tools
claude --plugin-dir ./plugins/gmail-api-mcp
claude --plugin-dir ./plugins/basic-skills --plugin-dir ./plugins/artifact-tools --plugin-dir ./plugins/gmail-api-mcp
```

After making changes, reload without restarting:

```
/reload-plugins
```

### Test the full marketplace flow

Simulates the real installation experience from within Claude Code:

```
/plugin marketplace add ./
/plugin install artifact-tools@jgterradillos-plugins
/plugin install basic-skills@jgterradillos-plugins
```

## Adding a new plugin

1. Create `plugins/<plugin-name>/.claude-plugin/plugin.json`
2. Add skills under `plugins/<plugin-name>/skills/<SkillName>/SKILL.md`
3. Add agents under `plugins/<plugin-name>/agents/<AgentName>.md` (if needed)
4. For MCP plugins, declare the `mcp.server` section in `plugin.json` and add required env vars under `mcp.requiredEnv`
5. Register the plugin in `.claude-plugin/marketplace.json`
