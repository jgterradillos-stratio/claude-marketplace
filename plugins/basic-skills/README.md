# basic-skills

A Claude Code plugin that provides general-purpose skills (slash commands) for development workflows.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| sfe-validate-pr | `/basic-skills:sfe-validate-pr` | Validates local commits not yet pushed to upstream. Runs in an isolated agent to avoid polluting the chat context. |

## Usage

Install this plugin via the marketplace, then invoke any skill by typing its slash command in Claude Code.

## Adding Skills

Add a new directory under `skills/<SkillName>/` containing a `SKILL.md` with YAML frontmatter (`name`, `description`) and the instruction body.
