import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const STRATIO_ORG = "Stratio";
const GITHUB_API = "https://api.github.com";

function githubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body: string;
}

function formatRelease(library: string, release: GithubRelease): string {
  const publishDate = new Date(release.published_at).toLocaleDateString(
    "es-ES",
    { year: "numeric", month: "long", day: "numeric" }
  );

  const changelogLines = (release.body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("*") || l.startsWith("-"))
    .map((l) => l.replace(/^[*-]\s*/, "- "))
    .join("\n");

  return [
    `- Library name: ${library} ${release.tag_name}`,
    `- Publish date: ${publishDate}`,
    `- Changelog:`,
    changelogLines || "  (no documented changes)",
    `- Release URL: ${release.html_url}`,
  ].join("\n");
}

async function fetchReadmeSummary(artifact: string): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/readme`,
    { headers: githubHeaders() }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { content: string };
  const raw = Buffer.from(data.content, "base64").toString("utf-8");

  const lines = raw.split("\n")
    .map((l) => l.trim())
    .filter((l) =>
      l.length > 0 &&
      !l.startsWith("![") &&       // badges/images
      !l.startsWith("[![") &&
      !l.match(/^\[!\[/) &&
      !l.startsWith("<!--") &&
      !l.match(/^</)               // HTML tags
    );

  // Extract title and first meaningful content sections (headers + paragraphs)
  const summary: string[] = [];
  let chars = 0;
  for (const line of lines) {
    summary.push(line);
    chars += line.length;
    if (chars > 800) break;
  }
  return summary.join("\n") || null;
}

async function fetchSnapshotVersion(artifact: string, ref?: string): Promise<string | null> {
  const refsToTry = ref ? [ref] : ["master", "main"];
  for (const r of refsToTry) {
    // VERSION file
    const versionRes = await fetch(
      `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/contents/VERSION?ref=${r}`,
      { headers: githubHeaders() }
    );
    if (versionRes.ok) {
      const data = (await versionRes.json()) as { content: string };
      return Buffer.from(data.content, "base64").toString("utf-8").trim();
    }
    // package.json (Node/TypeScript projects)
    const pkgRes = await fetch(
      `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/contents/package.json?ref=${r}`,
      { headers: githubHeaders() }
    );
    if (pkgRes.ok) {
      const data = (await pkgRes.json()) as { content: string };
      const pkg = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8")) as Record<string, unknown>;
      if (pkg.version) return pkg.version as string;
    }
    // pom.xml (Java/Maven projects)
    const pomRes = await fetch(
      `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/contents/pom.xml?ref=${r}`,
      { headers: githubHeaders() }
    );
    if (pomRes.ok) {
      const data = (await pomRes.json()) as { content: string };
      const pom = Buffer.from(data.content, "base64").toString("utf-8");
      // Extract project version: first <version> before <dependencies> or <build>
      const beforeDeps = pom.split(/<dependencies|<build/)[0];
      const match = beforeDeps.match(/<version>\s*([^<\s]+)\s*<\/version>/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

// Base version: x.y.z or combined x.y.z-a.b.c
const BASE_RE = /^\d+\.\d+\.\d+(?:-\d+\.\d+\.\d+)?/;

function baseVersion(tag: string): string {
  return BASE_RE.exec(tag)?.[0] ?? tag;
}

function isMilestoneTag(tag: string): boolean {
  return /^\d+\.\d+\.\d+(?:-\d+\.\d+\.\d+)?-(M\d+|m\.\d+)$/.test(tag);
}

function isPrereleaseTag(tag: string): boolean {
  return /^\d+\.\d+\.\d+(?:-\d+\.\d+\.\d+)?-[a-zA-Z0-9]+$/.test(tag) && !isMilestoneTag(tag);
}

function isStableReleaseTag(tag: string): boolean {
  return /^\d+\.\d+\.\d+(?:-\d+\.\d+\.\d+)?$/.test(tag);
}

function compareTagsDesc(a: string, b: string): number {
  const nums = (tag: string) => baseVersion(tag).split(/[.\-]/).map(Number);
  const [pa, pb] = [nums(a), nums(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
}

async function branchExists(artifact: string, branch: string): Promise<boolean> {
  const url = `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/branches/${branch}`;
  const res = await fetch(url, { headers: githubHeaders() });
  return res.ok;
}

async function listBranches(artifact: string): Promise<string[]> {
  const branches: string[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/branches?per_page=100&page=${page}`,
      { headers: githubHeaders() }
    );
    if (!res.ok) break;
    const data = (await res.json()) as { name: string }[];
    if (data.length === 0) break;
    branches.push(...data.map((b) => b.name));
    if (data.length < 100) break;
    page++;
  }
  return branches;
}

export function registerGithubTools(server: McpServer) {
  server.registerTool(
    "get_latest_release",
    {
      description:
        "Get the latest release of a Stratio artifact from GitHub. Use the 'type' parameter to query stable releases, snapshots (version under development on master), milestones (x.y.z-M<number>), or prereleases (x.y.z-rc<alphanumeric> or x.y.z-<alphanumeric>). Always reproduce the complete response verbatim in your reply — do not summarize or omit any field.",
      inputSchema: {
        artifact: z
          .string()
          .describe("Name of the Stratio artifact/repository on GitHub"),
        type: z
          .enum(["release", "snapshot", "milestone", "prerelease"])
          .optional()
          .describe(
            "Type of version to query: 'release' (default, latest stable), 'snapshot' (current master version), 'milestone' (x.y.z-M<number>), 'prerelease' (x.y.z-rc<alphanumeric> or x.y.z-<alphanumeric>)"
          ),
      },
    },
    async ({ artifact, type = "release" }) => {
      if (type === "snapshot") {
        const version = await fetchSnapshotVersion(artifact);
        if (!version) {
          return {
            content: [{ type: "text", text: `No snapshot version found for "${artifact}" on master branch.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `- Artifact: ${artifact}\n- Snapshot version (master): ${version}` }],
        };
      }

      if (type === "milestone" || type === "prerelease") {
        const url = `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/releases?per_page=100`;
        const res = await fetch(url, { headers: githubHeaders() });
        if (res.status === 404) {
          return {
            content: [{ type: "text", text: `Artifact "${artifact}" not found in the Stratio GitHub organization.` }],
            isError: true,
          };
        }
        if (!res.ok) {
          return {
            content: [{ type: "text", text: `GitHub API error: ${res.status} ${res.statusText}` }],
            isError: true,
          };
        }
        const releases = (await res.json()) as GithubRelease[];
        const match = releases.find((r) =>
          type === "milestone" ? isMilestoneTag(r.tag_name) : isPrereleaseTag(r.tag_name)
        );
        if (!match) {
          return {
            content: [{ type: "text", text: `No ${type} found for "${artifact}".` }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: formatRelease(artifact, match) }] };
      }

      const url = `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/releases/latest`;
      const res = await fetch(url, { headers: githubHeaders() });

      if (res.status === 404) {
        return {
          content: [{ type: "text", text: `Artifact "${artifact}" not found in the Stratio GitHub organization.` }],
          isError: true,
        };
      }
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `GitHub API error: ${res.status} ${res.statusText}` }],
          isError: true,
        };
      }

      const release = (await res.json()) as GithubRelease;
      return { content: [{ type: "text", text: formatRelease(artifact, release) }] };
    }
  );

  server.registerTool(
    "get_artifact_versions",
    {
      description:
        "Get all available versions of a Stratio artifact: master/main snapshot (in active development), latest stable releases, milestones, prereleases, and whether the maintenance release branch (branch-x.y) exists on GitHub. Always reproduce the complete response verbatim in your reply — do not summarize or omit any field.",
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/repository on GitHub"),
      },
    },
    async ({ artifact }) => {
      const [snapshotVersion, allRes] = await Promise.all([
        fetchSnapshotVersion(artifact),
        fetch(`${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/releases?per_page=100`, { headers: githubHeaders() }),
      ]);

      if (allRes.status === 404) {
        return {
          content: [{ type: "text", text: `Artifact "${artifact}" not found in the Stratio GitHub organization.` }],
          isError: true,
        };
      }

      const allReleases = allRes.ok ? (await allRes.json() as GithubRelease[]) : [];

      const top5 = (tags: string[]) =>
        [...tags].sort(compareTagsDesc).slice(0, 5).join(", ") || "none";

      const stableTags = allReleases.map((r) => r.tag_name).filter(isStableReleaseTag);
      const milestoneTags = allReleases.map((r) => r.tag_name).filter(isMilestoneTag);
      const prereleaseTags = allReleases.map((r) => r.tag_name).filter(isPrereleaseTag);

      const latestRelease = [...stableTags].sort(compareTagsDesc)[0] ?? null;
      const releaseBranch = latestRelease
        ? `branch-${latestRelease.split(".").slice(0, 2).join(".")}`
        : null;
      const releaseBranchExists = releaseBranch ? await branchExists(artifact, releaseBranch) : false;

      const lines = [
        `## ${artifact}`,
        `- **Master (snapshot):** ${snapshotVersion ?? "unknown"}`,
        `- **Latest releases:** ${top5(stableTags)}`,
        `- **Latest milestones:** ${top5(milestoneTags)}`,
        `- **Latest prereleases:** ${top5(prereleaseTags)}`,
        `- **Release branch:** ${releaseBranch ?? "—"} ${releaseBranch ? (releaseBranchExists ? "✓ exists" : "✗ not found") : ""}`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "get_artifact_info",
    {
      description:
        "Get detailed information about a Stratio artifact: repository metadata, README summary, and all available versions (snapshot/releases/milestones/prereleases + release branch status). Always reproduce the complete response verbatim in your reply — every section including the README summary — do not summarize or omit any field.",
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/repository on GitHub"),
      },
    },
    async ({ artifact }) => {
      const repoRes = await fetch(`${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}`, { headers: githubHeaders() })
        .catch(() => null);

      if (!repoRes?.ok) {
        return {
          content: [{ type: "text", text: `Artifact "${artifact}" not found in the Stratio GitHub organization.` }],
          isError: true,
        };
      }

      const repo = await repoRes.json() as { html_url: string; description: string | null; default_branch: string; language: string | null };
      const ref = repo.default_branch ?? "master";

      const [snapshotVersion, releasesRes, readmeSummary] = await Promise.all([
        fetchSnapshotVersion(artifact, ref),
        fetch(`${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/releases?per_page=100`, { headers: githubHeaders() }),
        fetchReadmeSummary(artifact),
      ]);

      const allReleases = releasesRes.ok ? (await releasesRes.json() as { tag_name: string }[]) : [];
      const top5 = (tags: string[]) => [...tags].sort(compareTagsDesc).slice(0, 5).join(", ") || "none";
      const stableTags = allReleases.map((r) => r.tag_name).filter(isStableReleaseTag);
      const milestoneTags = allReleases.map((r) => r.tag_name).filter(isMilestoneTag);
      const prereleaseTags = allReleases.map((r) => r.tag_name).filter(isPrereleaseTag);

      const latestRelease = [...stableTags].sort(compareTagsDesc)[0] ?? null;
      const releaseBranch = latestRelease
        ? `branch-${latestRelease.split(".").slice(0, 2).join(".")}`
        : null;
      const releaseBranchExists = releaseBranch ? await branchExists(artifact, releaseBranch) : false;

      const lines = [
        `## ${artifact}`,
        `- **Repository:** ${repo.html_url}`,
        repo.description ? `- **Description:** ${repo.description}` : "",
        repo.language ? `- **Main language:** ${repo.language === "Mustache" ? "Helm" : repo.language}` : "",
        readmeSummary ? `\n### Summary\n${readmeSummary}` : "",
        `\n### Versions`,
        `- **Snapshot:** ${snapshotVersion ?? "unknown"}`,
        `- **Releases:** ${top5(stableTags)}`,
        `- **Milestones:** ${top5(milestoneTags)}`,
        `- **Prereleases:** ${top5(prereleaseTags)}`,
        `- **Release branch:** ${releaseBranch ?? "—"} ${releaseBranch ? (releaseBranchExists ? "✓ exists" : "✗ not found") : ""}`,
      ].filter((l) => l !== "");

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "search_artifacts",
    {
      description: "Search for Stratio artifact repositories on GitHub by name (prefix, suffix, or substring). Returns a markdown table with repo names, technology and URLs. Always reproduce the complete table verbatim in your response — do not summarize.",
      inputSchema: {
        query: z.string().describe("Search term to match against repo names (e.g. 'gosec', 'egeo-')"),
      },
    },
    async ({ query }) => {
      const res = await fetch(
        `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}+in:name+org:${STRATIO_ORG}&per_page=50&sort=name`,
        { headers: githubHeaders() }
      );
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Search error (HTTP ${res.status})` }],
          isError: true,
        };
      }
      const data = (await res.json()) as { total_count: number; items: { name: string; html_url: string; description: string | null; language: string | null }[] };
      if (data.total_count === 0) {
        return { content: [{ type: "text", text: `No repositories found matching "${query}".` }] };
      }
      const header = `## Stratio Repositories — "${query}" (${data.items.length}${data.total_count > 50 ? ` of ${data.total_count}` : ""})\n\n| Repository | Technology | Link |\n|---|---|---|`;
      const rows = data.items.map((r) =>
        `| ${r.name} | ${r.language === "Mustache" ? "Helm" : (r.language ?? "—")} | ${r.html_url} |`
      );
      return { content: [{ type: "text", text: [header, ...rows].join("\n") }] };
    }
  );

  server.registerTool(
    "list_artifact_branches",
    {
      description: "List all branches of a Stratio artifact repository on GitHub. Useful to know which maintenance branches (e.g. branch-1.4, branch-2.3) are active. Always reproduce the complete response verbatim in your reply — do not summarize or omit any branch.",
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/repository on GitHub"),
      },
    },
    async ({ artifact }) => {
      let branches: string[];
      try {
        branches = await listBranches(artifact);
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error fetching branches for "${artifact}": ${(e as Error).message}` }],
          isError: true,
        };
      }

      if (branches.length === 0) {
        return {
          content: [{ type: "text", text: `No branches found for "${artifact}" or repository does not exist.` }],
          isError: true,
        };
      }

      const mainBranches = branches.filter((b) => b === "master" || b === "main");
      const devBranches = branches.filter((b) => /^branch-\d+\.\d+/.test(b)).sort().reverse();
      const mainAndDev = new Set([...mainBranches, ...devBranches]);
      const others = branches.filter((b) => !mainAndDev.has(b));

      const lines = [`## Branches of ${artifact}`];
      if (mainBranches.length) lines.push(`\n**Main:** ${mainBranches.join(", ")}`);
      if (devBranches.length) lines.push(`\n**Dev/maintenance:**\n${devBranches.map((b) => `- ${b}`).join("\n")}`);
      if (others.length) lines.push(`\n**Other (${others.length}):** ${others.join(", ")}`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
  server.registerTool(
    "get_branch_pipeline_status",
    {
      description:
        "Check whether a Jenkins pipeline is currently running for a specific branch of a Stratio artifact. Queries GitHub Check Runs for the branch HEAD commit and reports the status (queued, in_progress, or completed with conclusion) of each check run. Always reproduce the complete response verbatim in your reply — do not summarize or omit any field.",
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/repository on GitHub"),
        branch: z
          .string()
          .describe("Branch to check, e.g. 'master', 'main', or 'branch-1.4'"),
      },
    },
    async ({ artifact, branch }) => {
      const checkRunsUrl = `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`;
      const res = await fetch(checkRunsUrl, { headers: githubHeaders() });

      if (res.status === 404) {
        return {
          content: [{ type: "text", text: `Artifact "${artifact}" or branch "${branch}" not found.` }],
          isError: true,
        };
      }
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `GitHub API error: ${res.status} ${res.statusText}` }],
          isError: true,
        };
      }

      const data = (await res.json()) as {
        total_count: number;
        check_runs: Array<{
          id: number;
          name: string;
          status: "queued" | "in_progress" | "completed";
          conclusion: string | null;
          started_at: string | null;
          completed_at: string | null;
          html_url: string;
          app: { name: string } | null;
        }>;
      };

      if (data.total_count === 0) {
        return {
          content: [{ type: "text", text: `No check runs found for "${artifact}" on branch "${branch}".` }],
        };
      }

      const running = data.check_runs.filter(
        (cr) => cr.status === "queued" || cr.status === "in_progress"
      );
      const completed = data.check_runs.filter((cr) => cr.status === "completed");

      const header = `## Pipeline status: ${artifact} @ ${branch}\n`;
      const summaryLine =
        running.length > 0
          ? `**Active pipelines: ${running.length}** (${data.total_count} total check runs)`
          : `All ${data.total_count} check run(s) completed — no active pipeline.`;

      const formatRun = (cr: (typeof data.check_runs)[0]) => {
        const app = cr.app?.name ?? "unknown";
        const statusLabel =
          cr.status === "completed"
            ? `completed / ${cr.conclusion ?? "unknown"}`
            : cr.status;
        return `- [${cr.name}](${cr.html_url}) — ${statusLabel} (app: ${app})`;
      };

      const lines = [header, summaryLine];

      if (running.length > 0) {
        lines.push(`\n### Active`);
        running.forEach((cr) => lines.push(formatRun(cr)));
      }

      if (completed.length > 0) {
        lines.push(`\n### Completed (last ${Math.min(completed.length, 10)})`);
        completed.slice(0, 10).forEach((cr) => lines.push(formatRun(cr)));
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "get_pr_pipeline_status",
    {
      description:
        "Check the CI pipeline status for a Stratio GitHub pull request. Queries GitHub Check Runs for the PR's head commit SHA and reports the status (queued, in_progress, or completed with conclusion) of each check run. Use this instead of get_branch_pipeline_status when you have a PR number. Always reproduce the complete response verbatim in your reply — do not summarize or omit any field.",
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/repository on GitHub"),
        pull_number: z.number().describe("Pull request number"),
      },
    },
    async ({ artifact, pull_number }) => {
      const prRes = await fetch(
        `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/pulls/${pull_number}`,
        { headers: githubHeaders() }
      );
      if (prRes.status === 404) {
        return {
          content: [{ type: "text", text: `PR #${pull_number} not found in "${artifact}".` }],
          isError: true,
        };
      }
      if (!prRes.ok) {
        return {
          content: [{ type: "text", text: `GitHub API error fetching PR: ${prRes.status} ${prRes.statusText}` }],
          isError: true,
        };
      }

      const pr = (await prRes.json()) as { head: { sha: string; ref: string }; title: string };
      const label = `PR #${pull_number} (${pr.head.ref}) — ${pr.title}`;

      const checkRunsUrl = `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/commits/${pr.head.sha}/check-runs?per_page=100`;
      const res = await fetch(checkRunsUrl, { headers: githubHeaders() });

      if (res.status === 404) {
        return {
          content: [{ type: "text", text: `No check runs found for "${artifact}" PR #${pull_number}.` }],
          isError: true,
        };
      }
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `GitHub API error: ${res.status} ${res.statusText}` }],
          isError: true,
        };
      }

      const data = (await res.json()) as {
        total_count: number;
        check_runs: Array<{
          id: number;
          name: string;
          status: "queued" | "in_progress" | "completed";
          conclusion: string | null;
          started_at: string | null;
          completed_at: string | null;
          html_url: string;
          app: { name: string } | null;
        }>;
      };

      if (data.total_count === 0) {
        return {
          content: [{ type: "text", text: `No check runs found for "${artifact}" ${label}.` }],
        };
      }

      const running = data.check_runs.filter(
        (cr) => cr.status === "queued" || cr.status === "in_progress"
      );
      const completed = data.check_runs.filter((cr) => cr.status === "completed");

      const header = `## Pipeline status: ${artifact} @ ${label}\n`;
      const summaryLine =
        running.length > 0
          ? `**Active pipelines: ${running.length}** (${data.total_count} total check runs)`
          : `All ${data.total_count} check run(s) completed — no active pipeline.`;

      const formatRun = (cr: (typeof data.check_runs)[0]) => {
        const app = cr.app?.name ?? "unknown";
        const statusLabel =
          cr.status === "completed"
            ? `completed / ${cr.conclusion ?? "unknown"}`
            : cr.status;
        return `- [${cr.name}](${cr.html_url}) — ${statusLabel} (app: ${app})`;
      };

      const lines = [header, summaryLine];

      if (running.length > 0) {
        lines.push(`\n### Active`);
        running.forEach((cr) => lines.push(formatRun(cr)));
      }

      if (completed.length > 0) {
        lines.push(`\n### Completed (last ${Math.min(completed.length, 10)})`);
        completed.slice(0, 10).forEach((cr) => lines.push(formatRun(cr)));
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
  server.registerTool(
    "get_pull_request_info",
    {
      description:
        "Get information about a specific pull request in a Stratio GitHub repository: title, state, head branch, base branch, head SHA, author, draft status, and mergeable flag. Always reproduce the complete response verbatim in your reply.",
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/repository on GitHub"),
        pull_number: z.number().describe("Pull request number"),
      },
    },
    async ({ artifact, pull_number }) => {
      const res = await fetch(
        `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/pulls/${pull_number}`,
        { headers: githubHeaders() }
      );

      if (res.status === 404) {
        return {
          content: [{ type: "text", text: `PR #${pull_number} not found in "${artifact}".` }],
          isError: true,
        };
      }
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `GitHub API error: ${res.status} ${res.statusText}` }],
          isError: true,
        };
      }

      const pr = (await res.json()) as {
        number: number;
        title: string;
        state: string;
        draft: boolean;
        html_url: string;
        user: { login: string };
        head: { ref: string; sha: string };
        base: { ref: string };
        mergeable: boolean | null;
      };

      return {
        content: [
          {
            type: "text",
            text: [
              `## PR #${pr.number}: ${pr.title}`,
              `- State: ${pr.state}${pr.draft ? " (draft)" : ""}`,
              `- Author: ${pr.user.login}`,
              `- Head branch: ${pr.head.ref}`,
              `- Head SHA: ${pr.head.sha}`,
              `- Base branch: ${pr.base.ref}`,
              `- Mergeable: ${pr.mergeable === null ? "unknown (still computing)" : pr.mergeable}`,
              `- URL: ${pr.html_url}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.registerTool(
    "merge_pull_request",
    {
      description:
        "Merge a Stratio GitHub pull request using squash merge, bypassing branch protection rules (requires admin token). Combines all commits into a single squash commit. Always reproduce the complete response verbatim in your reply.",
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/repository on GitHub"),
        pull_number: z.number().describe("Pull request number to merge"),
        commit_title: z
          .string()
          .optional()
          .describe("Title for the squash commit (defaults to the PR title if omitted)"),
        commit_message: z
          .string()
          .optional()
          .describe("Body of the squash commit message (optional)"),
      },
    },
    async ({ artifact, pull_number, commit_title, commit_message }) => {
      const prRes = await fetch(
        `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/pulls/${pull_number}`,
        { headers: githubHeaders() }
      );

      if (prRes.status === 404) {
        return {
          content: [{ type: "text", text: `PR #${pull_number} not found in "${artifact}".` }],
          isError: true,
        };
      }
      if (!prRes.ok) {
        return {
          content: [{ type: "text", text: `GitHub API error fetching PR: ${prRes.status} ${prRes.statusText}` }],
          isError: true,
        };
      }

      const pr = (await prRes.json()) as {
        title: string;
        number: number;
        html_url: string;
        state: string;
        mergeable: boolean | null;
      };

      if (pr.state !== "open") {
        return {
          content: [{ type: "text", text: `PR #${pull_number} is not open (state: ${pr.state}).` }],
          isError: true,
        };
      }

      const mergeBody: Record<string, string> = {
        merge_method: "squash",
        commit_title: commit_title ?? pr.title,
      };
      if (commit_message) mergeBody.commit_message = commit_message;

      const mergeRes = await fetch(
        `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/pulls/${pull_number}/merge`,
        {
          method: "PUT",
          headers: {
            ...(githubHeaders() as Record<string, string>),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(mergeBody),
        }
      );

      if (mergeRes.status === 405) {
        return {
          content: [{ type: "text", text: `PR #${pull_number} is not mergeable (already merged or has conflicts).` }],
          isError: true,
        };
      }
      if (mergeRes.status === 409) {
        return {
          content: [{ type: "text", text: `PR #${pull_number} has a merge conflict. Resolve it before merging.` }],
          isError: true,
        };
      }
      if (!mergeRes.ok) {
        const errBody = (await mergeRes.json().catch(() => ({}))) as { message?: string };
        return {
          content: [
            {
              type: "text",
              text: `GitHub API error merging PR: ${mergeRes.status} ${mergeRes.statusText}${errBody.message ? ` — ${errBody.message}` : ""}`,
            },
          ],
          isError: true,
        };
      }

      const result = (await mergeRes.json()) as { sha: string; merged: boolean; message: string };
      return {
        content: [
          {
            type: "text",
            text: [
              `## PR #${pull_number} merged successfully`,
              `- Repository: ${artifact}`,
              `- PR: ${pr.html_url}`,
              `- Merge commit: ${result.sha}`,
              `- Method: squash merge (bypass rules)`,
              `- Commit title: ${mergeBody.commit_title}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_repo_activity",
    {
      description:
        "Get recent commits merged to the default branch (master/main) and all open pull requests for a list of Stratio GitHub repositories. Returns structured JSON with commits from the last N days and open PRs. Use this for daily briefings and activity summaries.",
      inputSchema: {
        repositories: z.array(z.string()).describe("List of Stratio repository names"),
        days: z.number().optional().describe("Number of days to look back for commits (default: 2)"),
      },
    },
    async ({ repositories, days = 2 }) => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceISO = since.toISOString();

      // Accept full GitHub URLs or plain repo names
      const repoNames = repositories.map((r) =>
        r.startsWith("http") ? r.split("/").pop()! : r
      );

      interface CommitEntry {
        sha: string;
        message: string;
        author: string;
        date: string;
        url: string;
      }

      interface PREntry {
        number: number;
        title: string;
        author: string;
        updated_at: string;
        url: string;
      }

      interface RepoActivity {
        repo: string;
        error?: string;
        commits: CommitEntry[];
        open_prs: PREntry[];
      }

      const results: RepoActivity[] = [];

      for (const repo of repoNames) {
        const [commitsRes, prsRes] = await Promise.all([
          fetch(
            `${GITHUB_API}/repos/${STRATIO_ORG}/${repo}/commits?since=${sinceISO}&per_page=50`,
            { headers: githubHeaders() }
          ),
          fetch(
            `${GITHUB_API}/repos/${STRATIO_ORG}/${repo}/pulls?state=open&per_page=50&sort=updated`,
            { headers: githubHeaders() }
          ),
        ]);

        const activity: RepoActivity = { repo, commits: [], open_prs: [] };

        if (commitsRes.status === 404) {
          activity.error = "Repository not found";
        } else if (commitsRes.ok) {
          const commits = (await commitsRes.json()) as Array<{
            sha: string;
            commit: { message: string; author: { name: string; date: string } };
            html_url: string;
          }>;
          activity.commits = commits.map((c) => ({
            sha: c.sha.slice(0, 7),
            message: c.commit.message.split("\n")[0],
            author: c.commit.author.name,
            date: c.commit.author.date.split("T")[0],
            url: c.html_url,
          }));
        }

        if (prsRes.ok) {
          const prs = (await prsRes.json()) as Array<{
            number: number;
            title: string;
            html_url: string;
            user: { login: string };
            updated_at: string;
          }>;
          activity.open_prs = prs.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            updated_at: pr.updated_at.split("T")[0],
            url: pr.html_url,
          }));
        }

        results.push(activity);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );
}
