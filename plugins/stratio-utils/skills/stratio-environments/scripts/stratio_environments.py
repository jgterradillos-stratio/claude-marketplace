#!/usr/bin/env python3
"""List/inspect KEOS workspace environments from the Stratio internal index.

Usage:
  stratio_environments.py list
  stratio_environments.py detail <short-name>
  stratio_environments.py names [short-name]

`list` and `detail` download each environment's .tgz. `names` only fetches
the lightweight index page (no tgz downloads) and prints the short names
that exist, grouped by pattern — or, given a short-name argument, just
classifies that one name offline with no network call at all.

No third-party dependencies: uses only the stdlib (urllib, tarfile, re).
Streams each .tgz over HTTP and reads only the members it needs — nothing
is ever written to disk.
"""
import argparse
import os
import re
import sys
import tarfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = os.environ.get("STRATIO_WORKSPACES_URL", "https://keos-workspaces.int.stratio.com").rstrip("/")
PREFIX = "keos-workspace-"
LIST_CONCURRENCY = 8
LIST_TIMEOUT = 120
DETAIL_TIMEOUT = 300
USER_AGENT = "stratio-environments-skill/1.0"

NATO_WORDS = {
    "alpha", "alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "india", "juliett", "juliet", "kilo", "lima", "mike", "november", "oscar",
    "papa", "quebec", "romeo", "sierra", "tango", "uniform", "victor",
    "whiskey", "xray", "yankee", "zulu",
}
GREEK_WORDS = {
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho",
    "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
}
_ONES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
_TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
          "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
NUMBER_WORDS = set(_ONES) | set(_TEENS) | set(_TENS)
for _t in _TENS:
    for _o in _ONES:
        NUMBER_WORDS.add(_t + _o)

GROUP_ORDER = [
    "Numericos",
    "NATO",
    "Griegas",
    "Demo + NATO/Griego",
    "Infra",
    "Pit/Temp",
    "Otros",
]


def classify(name):
    n = name.lower()
    if n.startswith("demo") and n[4:] in (NATO_WORDS | GREEK_WORDS):
        return "Demo + NATO/Griego"
    if n in NUMBER_WORDS:
        return "Numericos"
    if n in NATO_WORDS:
        return "NATO"
    if n in GREEK_WORDS:
        return "Griegas"
    if n.startswith("keos") or "nightly" in n or "eosoffline" in n or n in ("fulle2k8s", "fullek8s") or "appsint" in n:
        return "Infra"
    if n.startswith("pit") or "temp" in n or "tmp" in n:
        return "Pit/Temp"
    return "Otros"


def http_get(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=timeout)


def list_environment_names():
    with http_get(BASE_URL + "/", LIST_TIMEOUT) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    names = sorted(set(re.findall(r'href="(?:\./)?' + re.escape(PREFIX) + r'([^"/]+)\.tgz"', html)))
    return names


def fetch_tar_members(short_name, wanted, timeout):
    """Stream keos-workspace-<short_name>.tgz and pull out `wanted` member suffixes.

    Returns {suffix: bytes}. Raises on HTTP/tar errors.
    """
    url = f"{BASE_URL}/{PREFIX}{short_name}.tgz"
    found = {}
    remaining = set(wanted)
    with http_get(url, timeout) as resp:
        with tarfile.open(fileobj=resp, mode="r|gz") as tar:
            for member in tar:
                if not remaining:
                    break
                match = next((w for w in remaining if member.name.endswith("/" + w) or member.name == w), None)
                if match:
                    extracted = tar.extractfile(member)
                    if extracted is not None:
                        found[match] = extracted.read()
                    remaining.discard(match)
    return found


def parse_cluster_versions(data):
    text = data.decode("utf-8", errors="replace")
    def scalar(key):
        m = re.search(rf'^\s*{key}:\s*(\S+)\s*$', text, re.MULTILINE)
        return m.group(1) if m else None
    return {
        "universeVersion": scalar("universeVersion") or "?",
        "keosVersion": scalar("keosVersion") or "?",
        "installed": scalar("installed") or "?",
    }


def parse_kubeconfig(data):
    text = data.decode("utf-8", errors="replace")
    clusters_part, _, rest = text.partition("\ncontexts:\n")
    contexts_part = rest.split("\ncurrent-context:")[0]
    cluster_name = re.search(r'\n\s*name:\s*(\S+)', clusters_part)
    server = re.search(r'server:\s*(\S+)', clusters_part)
    context_name = re.search(r'\n\s*name:\s*(\S+)', contexts_part)
    current_context = re.search(r'current-context:\s*(\S+)', text)
    return {
        "cluster_name": cluster_name.group(1) if cluster_name else "?",
        "server": server.group(1) if server else "?",
        "context_name": context_name.group(1) if context_name else "?",
        "current_context": current_context.group(1) if current_context else "?",
    }


def _yaml_block(text, key):
    """Return the sub-block under a `key:` line: lines indented deeper than
    the key, plus `- item` sequence lines at the *same* indent as the key
    (YAML allows block-sequence dashes to align with their parent key)."""
    lines = text.splitlines()
    out, capturing, key_indent = [], False, None
    for line in lines:
        stripped = line.strip()
        indent = len(line) - len(line.lstrip(" "))
        if not capturing:
            if re.match(rf'^{re.escape(key)}:\s*$', stripped):
                capturing, key_indent = True, indent
            continue
        if stripped == "":
            out.append(line)
            continue
        if indent > key_indent or (indent == key_indent and stripped.startswith("-")):
            out.append(line)
            continue
        break
    return "\n".join(out)


def _yaml_scalar(text, key):
    m = re.search(rf'^\s*{re.escape(key)}:\s*(.+)\s*$', text, re.MULTILINE)
    return m.group(1).strip().strip("'\"") if m else "?"


def _yaml_list(text, key):
    block = _yaml_block(text, key)
    return re.findall(r'^\s*-\s*(\S+)', block, re.MULTILINE)


def parse_keos_yaml(data):
    text = data.decode("utf-8", errors="replace")
    docker_registry = _yaml_block(text, "docker_registry")
    helm_repository = _yaml_block(text, "helm_repository")
    infra = _yaml_block(text, "infra")
    keos = _yaml_block(text, "keos")
    return {
        "docker_registry_url": _yaml_scalar(docker_registry, "url"),
        "helm_repository_url": _yaml_scalar(helm_repository, "url"),
        "ssh_user": _yaml_scalar(infra, "ssh_user"),
        "control_plane_ips": _yaml_list(infra, "kube_control_plane"),
        "node_ips": _yaml_list(infra, "kube_node"),
        "cluster_id": _yaml_scalar(keos, "cluster_id"),
        "external_domain": _yaml_scalar(keos, "external_domain"),
        "flavour": _yaml_scalar(keos, "flavour"),
    }


def cmd_list():
    print(f"Consultando indice: {BASE_URL}/\n", file=sys.stderr)
    try:
        names = list_environment_names()
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"ERROR: no se pudo listar el indice de entornos: {e}", file=sys.stderr)
        return 1

    results = {}
    with ThreadPoolExecutor(max_workers=LIST_CONCURRENCY) as pool:
        futures = {
            pool.submit(fetch_tar_members, n, {"cluster_versions.yaml"}, LIST_TIMEOUT): n
            for n in names
        }
        for fut in as_completed(futures):
            n = futures[fut]
            try:
                members = fut.result()
                results[n] = parse_cluster_versions(members["cluster_versions.yaml"]) if "cluster_versions.yaml" in members else {"error": "cluster_versions.yaml no encontrado en el tgz"}
            except Exception as e:
                results[n] = {"error": str(e)}

    groups = {}
    for n in names:
        groups.setdefault(classify(n), []).append(n)

    print(f"# Entornos KEOS ({len(names)} en total)\n")
    for group in GROUP_ORDER:
        members = sorted(groups.get(group, []))
        if not members:
            continue
        print(f"## {group} ({len(members)})\n")
        print("| Entorno | Universe version | Keos version | Instalado |")
        print("|---|---|---|---|")
        for m in members:
            info = results.get(m, {})
            if "error" in info:
                print(f"| {m} | _error: {info['error']}_ | | |")
            else:
                print(f"| {m} | {info['universeVersion']} | {info['keosVersion']} | {info['installed']} |")
        print()
    return 0


def cmd_detail(short_name):
    short_name = short_name.strip().lower().removeprefix(PREFIX)
    wanted = {"cluster_versions.yaml", ".kube/config", "keos.yaml"}
    try:
        members = fetch_tar_members(short_name, wanted, DETAIL_TIMEOUT)
    except urllib.error.HTTPError as e:
        print(f"ERROR: entorno '{short_name}' no encontrado ({e}). URL: {BASE_URL}/{PREFIX}{short_name}.tgz", file=sys.stderr)
        return 1
    except (urllib.error.URLError, tarfile.TarError) as e:
        print(f"ERROR: no se pudo descargar/leer el entorno '{short_name}': {e}", file=sys.stderr)
        return 1

    missing = wanted - members.keys()
    if missing:
        print(f"AVISO: no se encontraron en el tgz: {', '.join(sorted(missing))}", file=sys.stderr)

    cv = parse_cluster_versions(members["cluster_versions.yaml"]) if "cluster_versions.yaml" in members else {}
    kc = parse_kubeconfig(members[".kube/config"]) if ".kube/config" in members else {}
    ky = parse_keos_yaml(members["keos.yaml"]) if "keos.yaml" in members else {}

    print(f"# Entorno: {short_name}\n")
    print("## Versiones (cluster_versions.yaml)")
    print(f"- Universe version: {cv.get('universeVersion', '?')}")
    print(f"- Keos version: {cv.get('keosVersion', '?')}")
    print(f"- Instalado: {cv.get('installed', '?')}\n")

    print("## Cluster (.kube/config)")
    print(f"- Nombre cluster: {kc.get('cluster_name', '?')}")
    print(f"- Servidor API: {kc.get('server', '?')}")
    print(f"- Contexto: {kc.get('context_name', '?')}")
    print(f"- Contexto actual: {kc.get('current_context', '?')}\n")

    if ".kube/config" in members:
        print("## .kube/config (contenido completo, listo para Lens/kubectl)")
        print("```yaml")
        print(members[".kube/config"].decode("utf-8", errors="replace").rstrip("\n"))
        print("```\n")

    print("## Infraestructura (keos.yaml)")
    print(f"- Cluster ID: {ky.get('cluster_id', '?')}")
    print(f"- Dominio externo: {ky.get('external_domain', '?')}")
    print(f"- Flavour: {ky.get('flavour', '?')}")
    print(f"- Docker registry: {ky.get('docker_registry_url', '?')}")
    print(f"- Helm repository: {ky.get('helm_repository_url', '?')}")
    print(f"- SSH user: {ky.get('ssh_user', '?')}")
    print(f"- IPs control-plane: {', '.join(ky.get('control_plane_ips', [])) or '?'}")
    print(f"- IPs nodos: {', '.join(ky.get('node_ips', [])) or '?'}")
    return 0


def cmd_names(name=None):
    """Catalogo de entornos: just the short names that exist, grouped by
    pattern — no tgz downloads, no versions. If `name` is given, classify
    that single name offline instead (no network needed)."""
    if name:
        print(f"'{name}' -> {classify(name)}")
        return 0

    print(f"Consultando indice: {BASE_URL}/\n", file=sys.stderr)
    try:
        names = list_environment_names()
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"ERROR: no se pudo listar el indice de entornos: {e}", file=sys.stderr)
        return 1

    groups = {}
    for n in names:
        groups.setdefault(classify(n), []).append(n)

    print(f"# Catalogo de entornos ({len(names)} en total)\n")
    for group in GROUP_ORDER:
        members = sorted(groups.get(group, []))
        if not members:
            continue
        print(f"## {group} ({len(members)})")
        print(", ".join(members) + "\n")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="List all environments grouped by name pattern")
    p_detail = sub.add_parser("detail", help="Show detail for one environment")
    p_detail.add_argument("name", help="Short environment name, e.g. 'gamma'")
    p_names = sub.add_parser("names", help="Catalogo de entornos: just the short names, grouped by pattern (cheap: index only, no tgz downloads)")
    p_names.add_argument("name", nargs="?", default=None, help="Optional: classify this one name offline instead of listing the index")
    args = parser.parse_args()

    if args.command == "list":
        return cmd_list()
    if args.command == "names":
        return cmd_names(args.name)
    return cmd_detail(args.name)


if __name__ == "__main__":
    sys.exit(main())
