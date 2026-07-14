# stratio-utils

A Claude Code plugin that provides Stratio-specific utility skills (slash commands).

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| stratio-environments | `/stratio-utils:stratio-environments` | Query KEOS workspace environments from the Stratio internal index (`keos-workspaces.int.stratio.com`): list all environments grouped by name pattern with their versions, show full detail (versions, kube context/config, infra) for one specific environment, or show a cheap catalog of just the environment names and last-modified dates grouped by pattern. |

### stratio-environments modes

All logic lives in `skills/stratio-environments/scripts/stratio_environments.py` (pure Python 3 stdlib, no dependencies):

| Mode | Command | Cost |
|------|---------|------|
| List all (with versions) | `stratio_environments.py list` | Downloads every environment's `.tgz` (~150-250MB total, tens of seconds) |
| Detail for one environment | `stratio_environments.py detail <short-name>` | Downloads one `.tgz`; prints versions, `.kube/config` (including raw content, ready for Lens/kubectl), and infra data from `keos.yaml` |
| Catalog of names only | `stratio_environments.py names [short-name]` | A single lightweight index request (no tgz downloads); with a name argument, classifies that one name offline with no network call |

Environments are grouped into: Numericos, NATO, Griegas, Demo + NATO/Griego, Infra, Pit/Temp, Otros.

## Usage

Install this plugin via the marketplace, then invoke the skill by typing `/stratio-utils:stratio-environments` in Claude Code (optionally followed by a short environment name to jump straight to detail mode).

## Adding Skills

Add a new directory under `skills/<SkillName>/` containing a `SKILL.md` with YAML frontmatter (`name`, `description`) and the instruction body.
