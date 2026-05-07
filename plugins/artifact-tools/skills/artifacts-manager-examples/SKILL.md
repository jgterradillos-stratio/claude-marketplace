---
name: artifacts-manager-examples
description: Show a quick-reference guide of everything artifacts-manager can do, organized by category.
model: haiku
---

Respond with the following content exactly, without calling any tools:

---

## artifacts-manager — Quick reference

### Search & explore

| What | Example |
|---|---|
| Repository info (README, language, versions) | Give me information about `gosec-management-ui` |
| Search repos by keyword | Search repositories for `gosec` |
| Repos in multiple scopes | What repositories are in the `rocket` and `gosec` scopes? |
| List branches | What branches does `gosec-management-ui` have? |

### Versions

| What | Example |
|---|---|
| All versions (snapshot, releases, milestones, prereleases) | Give me latest versions of `egeo-common` |
| Latest stable release | What is the latest release of `gosec-management-ui`? |
| Current snapshot (master) | What is the current snapshot of `egeo-forms`? |
| Latest prerelease | What prereleases does `egeo-navigation` have? |
| Latest milestone | What milestones does `egeo-dropdowns` have? |
| Next milestone to generate | What is the next milestone I can generate for `egeo-navigation`? |

### Jenkins — generate builds

| Type | Example |
|---|---|
| Prerelease | Generate a prerelease of `gosec-management-ui` version 1.5.0 |
| Milestone (specific version) | Generate milestone 1.4.0 of `egeo-navigation` |
| Milestone (auto from master) | Generate a milestone of `egeo-common` |
| Milestone (auto from branch) | Generate milestone 1.4 of `egeo-navigation` |
| Release | Launch release 1.5.0 of `egeo-common` |
| New maintenance branch | Create branch 1.5 of `egeo-common` (master will be set to 1.6) |

> Jenkins builds notify automatically when finished. On failure, the error cause and a link to the execution are shown.

### Slash commands

| Command | Description |
|---|---|
| `/scope-versions <keyword>` | Table with release, snapshot and prerelease for all repos in a scope |
| `/scope-versions SFE` | Same table for the predefined SFE scope |
| `/artifact-latest-versions <name>` | All versions for a single artifact |
