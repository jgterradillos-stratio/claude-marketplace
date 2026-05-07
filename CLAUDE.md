# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This repository is a Claude Code plugin marketplace. It hosts plugins that package skills (slash commands) and agents for use across projects via Claude Code's plugin system.

## Repository Structure

```
.claude-plugin/marketplace.json       # Marketplace registry — lists all plugins
plugins/<plugin-name>/
  .claude-plugin/plugin.json          # Plugin metadata (name, version, description, author, mcp, ...)
  agents/<AgentName>.md               # Agent definitions (optional)
  skills/<SkillName>/
    SKILL.md                          # Skill definition (frontmatter + instructions)
```

MCP-backed plugins additionally include:

```
plugins/<plugin-name>/
  bin/start.sh                        # Entrypoint launched by Claude Code to start the MCP server
  src/mcp/                            # TypeScript MCP server source
  dist/mcp/                           # Compiled output (referenced by start.sh)
```

## Architecture

**Marketplace layer** (`/.claude-plugin/marketplace.json`): The top-level registry that Claude Code reads to discover available plugins. Each entry points to a plugin directory under `plugins/`.

**Plugin layer** (`plugins/<name>/.claude-plugin/plugin.json`): Metadata for a plugin bundle. A plugin groups one or more related skills and/or agents. MCP plugins declare a `mcp.server` block here.

**Skill layer** (`plugins/<name>/skills/<SkillName>/SKILL.md`): The actual skill definition. The frontmatter (`name`, `description`) registers the skill as a slash command. The body is the instruction set Claude follows when the skill is invoked.

**Agent layer** (`plugins/<name>/agents/<AgentName>.md`): Agent definitions invoked via the `Agent` tool with `subagent_type: "<plugin-name>:<agent-name>"`.

## Plugin types

**Skills-only plugin** (`basic-skills`): Contains only skills and agents — no MCP server. The `plugin.json` has no `mcp` section.

**MCP plugin** (`artifact-tools`): Ships a TypeScript MCP server that exposes tools Claude can call. The `plugin.json` includes:
```json
"mcp": {
  "server": {
    "command": "bash",
    "args": ["${CLAUDE_PLUGIN_ROOT}/bin/start.sh"]
  },
  "requiredEnv": ["ENV_VAR_1", "ENV_VAR_2"]
}
```

## Adding a New Skill to an Existing Plugin

1. Create `plugins/<plugin-name>/skills/<SkillName>/SKILL.md` with YAML frontmatter:
   ```markdown
   ---
   name: SkillName
   description: One-line description shown in the skill picker
   ---

   Instructions for Claude when this skill is invoked...
   ```

## Adding a New Plugin

1. Create `plugins/<plugin-name>/.claude-plugin/plugin.json` with metadata following an existing plugin as reference.
2. Add the plugin entry to `.claude-plugin/marketplace.json` under the `plugins` array.
3. Add skills under `plugins/<plugin-name>/skills/`.
4. Add agents under `plugins/<plugin-name>/agents/` (if needed).
5. For MCP plugins, add the `mcp` section to `plugin.json` and implement the server under `src/mcp/`.

## Skill Authoring Conventions

- Skills that need isolation (e.g., to avoid polluting chat context) should delegate to a named subagent via the `Agent` tool with an appropriate `subagent_type`.
- The `description` frontmatter field is what users see in the skill picker — make it action-oriented and specific.
- Skill instructions should tell Claude *what agent or tool to invoke* and *what to report back*, not implement logic directly when an agent is more appropriate.
- MCP-backed skills can restrict which tools Claude may call via `allowed-tools` in the frontmatter.
