---
name: stratio-environments
description: Query KEOS workspace environments from the Stratio internal index — list all environments grouped by name pattern with their versions, show full detail (versions, kube context, infra) for one specific environment, or show a cheap catalog of just the environment names grouped by pattern.
---

Parse `$ARGUMENTS` as an optional environment short name (e.g. `gamma`, `eight`).

All logic lives in `scripts/stratio_environments.py` (pure Python 3 stdlib — no
dependencies). Never re-implement its parsing/download logic inline; only
invoke it via Bash and report its output.

## Step 1 — Decide the mode

**If `$ARGUMENTS` is non-empty:** treat it as the environment short name and go
straight to Step 3 (detail mode) — skip the question.

**If `$ARGUMENTS` is empty:** ask the user with AskUserQuestion whether they
want to consult **all environments** (with versions), **one specific
environment** (full detail), or just **the catalog of environment names**
(grouped by pattern, no versions — a cheap way to see what exists before
picking one for Step 3). Route to Step 2, Step 3, or Step 4 respectively. If
they pick "one specific", ask for the short name next (e.g. `gamma`, `eight`).

## Step 2 — All environments

Run:
```
python3 <skill_dir>/scripts/stratio_environments.py list
```
This streams every `.tgz` from the index (in parallel), reads only
`cluster_versions.yaml` from each, and prints a Markdown report already
grouped into the categories: Numericos, NATO, Griegas, Demo + NATO/Griego,
Infra, Pit/Temp, Otros — each with a table of Entorno / Universe version /
Keos version / Instalado.

Report that output to the user largely as-is (light formatting cleanup only,
do not drop rows or reorder groups). This step takes tens of seconds and
downloads roughly 150-250MB in total — mention this once instead of narrating
progress.

An environment showing an error (e.g. "cluster_versions.yaml no encontrado")
means that field is genuinely absent from its archive (older environments) —
report the error inline in the table row, do not treat it as a skill failure.

Then ask the user (AskUserQuestion or plain question) whether they want the
detailed view of any specific environment from the list. If yes, go to Step 3
with that short name.

## Step 3 — Detail for one environment

Run:
```
python3 <skill_dir>/scripts/stratio_environments.py detail <short-name>
```
where `<short-name>` is the bare name without the `keos-workspace-` prefix
(the script also strips the prefix itself if the user includes it).

This downloads that one environment's `.tgz` and streams out three files
without ever writing them to disk: `cluster_versions.yaml`, `.kube/config`,
and `keos.yaml`. It prints: universe/keos version and installed flag; cluster
name, API server address, and kube context from `.kube/config`; the **full
raw `.kube/config` content** (including its embedded certificate/key data) in
a fenced code block, ready to paste into Lens or save as a kubeconfig file;
and cluster ID, external domain, flavour, docker registry, helm repository,
ssh user, and control-plane/node IPs from `keos.yaml`.

Report this output to the user verbatim, including the full raw kubeconfig
block — do not truncate, summarize, or redact it. If the script errors with
"no encontrado", the short name doesn't match any environment — suggest
re-running the `list` step to see valid names.

**Security note:** the raw `.kube/config` block contains admin client
certificate/key material for that cluster — it is only ever streamed in
memory and printed to the user, never written to disk by the script. Don't
persist it to a file yourself unless the user explicitly asks you to save it
somewhere (e.g. to load into Lens).

## Step 4 — Catalog of environment names (cheap, no tgz downloads)

Run:
```
python3 <skill_dir>/scripts/stratio_environments.py names
```
This only fetches the lightweight index page (a single HTTP request) and
prints the short names that exist, grouped into Numericos, NATO, Griegas,
Demo + NATO/Griego, Infra, Pit/Temp, Otros — no per-environment tgz download,
no version info. Use this when the user just wants to see what environments
exist (e.g. to then pick one for Step 3) without paying the cost of Step 2's
full `list` (which downloads every .tgz).

If the user instead asks "which group would `<name>` fall into" for an
arbitrary/hypothetical name, run
`python3 <skill_dir>/scripts/stratio_environments.py names <name>` — it
classifies that one name offline, no network call at all.
