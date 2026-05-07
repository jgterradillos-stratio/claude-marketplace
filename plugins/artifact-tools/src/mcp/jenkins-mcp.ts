import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const JENKINS_BASE = "https://builder.int.stratio.com";
const RELEASE_FOLDER = "Release";
const GITHUB_API = "https://api.github.com";
const STRATIO_ORG = "Stratio";

function jenkinsHeaders(): HeadersInit {
  const user = process.env.JENKINS_USER;
  const token = process.env.JENKINS_TOKEN;
  const headers: HeadersInit = {};
  if (user && token) {
    headers["Authorization"] = `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
  }
  return headers;
}

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

function checkCredentials(): string | null {
  if (!process.env.JENKINS_USER || !process.env.JENKINS_TOKEN) {
    return "JENKINS_USER and JENKINS_TOKEN must be set in the environment. Add them to your .bashrc and restart the session.";
  }
  return null;
}

async function listSubdirectories(): Promise<string[]> {
  const url = `${JENKINS_BASE}/job/${RELEASE_FOLDER}/api/json?tree=jobs[name]`;
  const res = await fetch(url, { headers: jenkinsHeaders() });
  if (!res.ok) throw new Error(`Jenkins API error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { jobs: { name: string }[] };
  return data.jobs.map((j) => j.name);
}

async function findProjectInSubdir(subdir: string, project: string): Promise<string | null> {
  const url = `${JENKINS_BASE}/job/${RELEASE_FOLDER}/job/${encodeURIComponent(subdir)}/api/json?tree=jobs[name]`;
  const res = await fetch(url, { headers: jenkinsHeaders() });
  if (!res.ok) return null;
  const data = (await res.json()) as { jobs: { name: string }[] };
  const found = data.jobs.find((j) => j.name.toLowerCase() === project.toLowerCase());
  return found?.name ?? null;
}

async function branchExists(artifact: string, branch: string): Promise<boolean> {
  const url = `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/branches/${branch}`;
  const res = await fetch(url, { headers: githubHeaders() });
  return res.ok;
}

async function getVersionFromRef(artifact: string, ref: string): Promise<string | null> {
  const encodedRef = encodeURIComponent(ref);
  // VERSION file
  const versionRes = await fetch(
    `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/contents/VERSION?ref=${encodedRef}`,
    { headers: githubHeaders() }
  );
  if (versionRes.ok) {
    const data = (await versionRes.json()) as { content: string };
    return Buffer.from(data.content, "base64").toString("utf-8").trim();
  }
  // package.json (Node/TypeScript projects)
  const pkgRes = await fetch(
    `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/contents/package.json?ref=${encodedRef}`,
    { headers: githubHeaders() }
  );
  if (pkgRes.ok) {
    const data = (await pkgRes.json()) as { content: string };
    const pkg = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8")) as Record<string, unknown>;
    if (pkg.version) return pkg.version as string;
  }
  // pom.xml (Java/Maven projects)
  const pomRes = await fetch(
    `${GITHUB_API}/repos/${STRATIO_ORG}/${artifact}/contents/pom.xml?ref=${encodedRef}`,
    { headers: githubHeaders() }
  );
  if (pomRes.ok) {
    const data = (await pomRes.json()) as { content: string };
    const pom = Buffer.from(data.content, "base64").toString("utf-8");
    const beforeDeps = pom.split(/<dependencies|<build/)[0];
    const match = beforeDeps.match(/<version>\s*([^<\s]+)\s*<\/version>/);
    if (match) return match[1].trim();
  }
  return null;
}

async function getMasterVersion(artifact: string): Promise<string | null> {
  return getVersionFromRef(artifact, "master");
}

async function triggerBuild(subdir: string, project: string, nextVersion: string): Promise<{ ok: boolean; status: number; queueUrl: string | null }> {
  const url = `${JENKINS_BASE}/job/${RELEASE_FOLDER}/job/${encodeURIComponent(subdir)}/job/${encodeURIComponent(project)}/buildWithParameters`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...jenkinsHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ NEXT_VERSION: nextVersion }).toString(),
  });
  const location = res.headers.get("Location");
  const queueUrl = location ? `${location.replace(/\/?$/, "/")}api/json` : null;
  return { ok: res.ok, status: res.status, queueUrl };
}

export function registerJenkinsTools(server: McpServer) {
  server.registerTool(
    "list_jenkins_subdirectories",
    {
      description: `List the available subdirectories under ${JENKINS_BASE}/job/${RELEASE_FOLDER}. Call this first when the subdirectory for a library is unknown, then show the full numbered list as plain text to the user and ask them to reply with the name or number. Do NOT use AskUserQuestion for this — just output the list and wait for the user's reply.`,
      inputSchema: {},
    },
    async () => {
      const credError = checkCredentials();
      if (credError) {
        return { content: [{ type: "text", text: credError }], isError: true };
      }
      let subdirs: string[];
      try {
        subdirs = await listSubdirectories();
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error connecting to Jenkins: ${(e as Error).message}` }],
          isError: true,
        };
      }
      const list = subdirs.map((s, i) => `${i + 1}. ${s}`).join("\n");
      return { content: [{ type: "text", text: list }] };
    }
  );

  server.registerTool(
    "trigger_jenkins_build",
    {
      description: `Trigger a Jenkins build for a Stratio artifact under ${JENKINS_BASE}/job/${RELEASE_FOLDER}.
Build types:
- prerelease: generates x.y.z-BUILD on branch-x.y (branch must exist)
- milestone: generates x.y.z-M on branch-x.y if it exists, otherwise on master
- release: generates x.y.z on branch-x.y (branch must exist)
- branch: creates branch-x.y and sets master to master_version (NEXT_VERSION = x.y#master_version)
IMPORTANT: If subdirectory is not provided, call list_jenkins_subdirectories first, show the full numbered list as plain text to the user, and wait for their reply before calling this tool.
ON SUCCESS: reproduce the complete tool response verbatim (Job, Type, NEXT_VERSION, Workflow, Execution, queue_url) — do not summarize or omit any field.
AFTER triggering: if a queue_url is returned, use ScheduleWakeup with delaySeconds=60 to poll get_jenkins_build_status. In each poll pass both queue_url and build_url (once known from a previous poll response). Continue until status is success/failure/aborted, then notify the user in chat with the final result.`,
      inputSchema: {
        artifact: z.string().describe("Name of the Stratio artifact/project in Jenkins"),
        type: z
          .enum(["prerelease", "milestone", "release", "branch"])
          .describe("Build type: prerelease, milestone, release, or branch (create branch)"),
        version: z
          .string()
          .optional()
          .describe(
            "Version to build. For prerelease/milestone/release use x.y.z. For branch use x.y (e.g. '1.2'). For milestone from master, omit to auto-read from VERSION/package.json."
          ),
        subdirectory: z
          .string()
          .optional()
          .describe("Jenkins subdirectory under Release/. If not provided, available subdirectories are listed."),
        master_version: z
          .string()
          .optional()
          .describe("For 'branch' type only: version to set on master after branch creation (e.g. '1.3')."),
      },
    },
    async ({ artifact, type, version, subdirectory, master_version }) => {
      const credError = checkCredentials();
      if (credError) {
        return { content: [{ type: "text", text: credError }], isError: true };
      }

      if (!subdirectory) {
        return {
          content: [{ type: "text", text: `Subdirectory not provided. Call list_jenkins_subdirectories first and show the full list to the user.` }],
          isError: true,
        };
      }

      // Step 1: verify artifact exists in subdirectory
      let projectName: string | null;
      try {
        projectName = await findProjectInSubdir(subdirectory, artifact);
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error querying Jenkins: ${(e as Error).message}` }],
          isError: true,
        };
      }
      if (!projectName) {
        return {
          content: [{
            type: "text",
            text: `Artifact "${artifact}" not found in subdirectory "${subdirectory}". Check the name or subdirectory.`,
          }],
          isError: true,
        };
      }

      // Step 3: calculate NEXT_VERSION based on type
      let nextVersion: string;

      if (type === "branch") {
        if (!version) {
          return {
            content: [{ type: "text", text: `To create a branch you must provide the version in x.y format (e.g. '1.2').` }],
            isError: true,
          };
        }
        if (!master_version) {
          return {
            content: [{
              type: "text",
              text: `To create branch-${version} you must provide the version master will be set to (master_version, e.g. '1.3').`,
            }],
            isError: true,
          };
        }
        nextVersion = `${version}#${master_version}`;

      } else if (type === "prerelease" || type === "release") {
        if (!version) {
          return {
            content: [{ type: "text", text: `To generate a ${type} you must provide the version in x.y.z format.` }],
            isError: true,
          };
        }
        const parts = version.split(".");
        if (parts.length < 3) {
          return {
            content: [{ type: "text", text: `Version must be in x.y.z format (e.g. '1.4.0').` }],
            isError: true,
          };
        }
        const branch = `branch-${parts[0]}.${parts[1]}`;
        const exists = await branchExists(artifact, branch);
        if (!exists) {
          return {
            content: [{
              type: "text",
              text: `Branch "${branch}" does not exist in repository "${artifact}". Create the branch first using the 'branch' type.`,
            }],
            isError: true,
          };
        }
        nextVersion = type === "prerelease" ? `${version}-BUILD` : version;

      } else {
        // milestone
        let resolvedVersion = version;
        const parts = resolvedVersion?.split(".");

        if (!resolvedVersion || !parts || parts.length < 3) {
          // If version is x.y (2 parts), read from the corresponding branch
          if (parts && parts.length === 2) {
            const targetBranch = `branch-${parts[0]}.${parts[1]}`;
            const branchVersion = await getVersionFromRef(artifact, targetBranch);
            if (!branchVersion) {
              return {
                content: [{
                  type: "text",
                  text: `Could not read version of "${artifact}" from "${targetBranch}". Provide the full version in x.y.z format.`,
                }],
                isError: true,
              };
            }
            resolvedVersion = branchVersion.replace(/-SNAPSHOT$/i, "");
          } else {
            // No version at all — read from master
            const masterVersion = await getMasterVersion(artifact);
            if (!masterVersion) {
              return {
                content: [{
                  type: "text",
                  text: `Could not determine the version of "${artifact}". Provide the version in x.y.z format.`,
                }],
                isError: true,
              };
            }
            resolvedVersion = masterVersion.replace(/-SNAPSHOT$/i, "");
          }
        }

        const vParts = resolvedVersion.split(".");
        if (vParts.length < 3) {
          return {
            content: [{ type: "text", text: `Version must be in x.y.z format (e.g. '1.4.0').` }],
            isError: true,
          };
        }

        const branch = `branch-${vParts[0]}.${vParts[1]}`;
        const exists = await branchExists(artifact, branch);
        if (!exists) {
          // Milestone from master — validate master version matches
          const masterVersion = await getMasterVersion(artifact);
          const masterBase = masterVersion?.replace(/-SNAPSHOT$/i, "");
          if (masterBase !== resolvedVersion) {
            return {
              content: [{
                type: "text",
                text: `Branch "${branch}" does not exist and master version is "${masterVersion}". To generate a milestone for ${resolvedVersion}, the branch must exist or it must match the master version.`,
              }],
              isError: true,
            };
          }
        }

        nextVersion = `${resolvedVersion}-M`;
      }

      // Step 4: trigger build
      const jobUrl = `${JENKINS_BASE}/job/${RELEASE_FOLDER}/job/${encodeURIComponent(subdirectory)}/job/${encodeURIComponent(projectName)}/`;
      let result: { ok: boolean; status: number; queueUrl: string | null };
      try {
        result = await triggerBuild(subdirectory, projectName, nextVersion);
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error triggering build: ${(e as Error).message}` }],
          isError: true,
        };
      }

      if (!result.ok) {
        return {
          content: [{
            type: "text",
            text: `Error triggering Jenkins build (HTTP ${result.status}). Check credentials and verify the job exists at ${jobUrl}`,
          }],
          isError: true,
        };
      }

      const lastBuildUrl = `${jobUrl}lastBuild/`;
      const lines = [
        `Build triggered successfully.`,
        `- Job: ${RELEASE_FOLDER}/${subdirectory}/${projectName}`,
        `- Type: ${type}`,
        `- NEXT_VERSION: ${nextVersion}`,
        `- Workflow: ${jobUrl}`,
        `- Execution: ${lastBuildUrl}`,
      ];
      if (result.queueUrl) {
        lines.push(`- queue_url: ${result.queueUrl}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  server.registerTool(
    "get_jenkins_build_status",
    {
      description: `Check the status of a Jenkins build previously triggered via trigger_jenkins_build.
Provide queue_url (from trigger_jenkins_build) and optionally build_url (known from a previous poll).
If queue_url returns 404 (item expired after build started), falls back to build_url automatically.
Returns: { status: "queued" | "running" | "success" | "failure" | "aborted" | "unknown", buildUrl, result, errorCause? }
- On failure: errorCause contains extracted error lines from the console log; buildUrl links to the build.
- Use ScheduleWakeup (delaySeconds=60) to poll until status is success/failure/aborted. Always pass both queue_url AND build_url (once known) in subsequent polls.
- On completion notify the user: always show buildUrl, status, and if failure show consoleUrl + errorCause as a bullet list.`,
      inputSchema: {
        queue_url: z.string().describe("The queue item API URL returned by trigger_jenkins_build (ends with /api/json)"),
        build_url: z.string().optional().describe("Direct build URL (e.g. .../job/X/42/), used as fallback if the queue item has already expired"),
      },
    },
    async ({ queue_url, build_url }) => {
      const credError = checkCredentials();
      if (credError) {
        return { content: [{ type: "text", text: credError }], isError: true };
      }

      let resolvedBuildUrl: string | null = null;

      let queueData: { executable?: { url: string; number: number }; why?: string; cancelled?: boolean };
      try {
        const res = await fetch(queue_url, { headers: jenkinsHeaders() });
        if (res.status === 404) {
          // Queue item expired — fall back to direct build_url if provided
          if (!build_url) {
            return {
              content: [{ type: "text", text: JSON.stringify({ status: "unknown", buildUrl: null, result: null, reason: "Queue item expired and no build_url provided" }) }],
            };
          }
          resolvedBuildUrl = build_url.replace(/\/?$/, "/");
        } else if (!res.ok) {
          return {
            content: [{ type: "text", text: `Error querying Jenkins queue (HTTP ${res.status})` }],
            isError: true,
          };
        } else {
          queueData = await res.json() as typeof queueData;

          if (queueData!.cancelled) {
            return {
              content: [{ type: "text", text: JSON.stringify({ status: "aborted", buildUrl: null, result: "ABORTED" }) }],
            };
          }

          if (!queueData!.executable) {
            const why = queueData!.why ?? "waiting in queue";
            return {
              content: [{ type: "text", text: JSON.stringify({ status: "queued", buildUrl: null, result: null, why }) }],
            };
          }

          resolvedBuildUrl = queueData!.executable.url.replace(/\/?$/, "/");
        }
      } catch (e) {
        return {
          content: [{ type: "text", text: `Network error querying Jenkins: ${(e as Error).message}` }],
          isError: true,
        };
      }

      const buildApiUrl = `${resolvedBuildUrl}api/json`;
      let buildData: { result: string | null; building: boolean; url: string };
      try {
        const res = await fetch(buildApiUrl, { headers: jenkinsHeaders() });
        if (!res.ok) {
          return {
            content: [{ type: "text", text: `Error querying Jenkins build (HTTP ${res.status})` }],
            isError: true,
          };
        }
        buildData = await res.json() as typeof buildData;
      } catch (e) {
        return {
          content: [{ type: "text", text: `Network error querying build: ${(e as Error).message}` }],
          isError: true,
        };
      }

      let status: string;
      if (buildData.building) {
        status = "running";
      } else if (buildData.result === "SUCCESS") {
        status = "success";
      } else if (buildData.result === "FAILURE") {
        status = "failure";
      } else if (buildData.result === "ABORTED") {
        status = "aborted";
      } else {
        status = "unknown";
      }

      const buildUrl = resolvedBuildUrl;

      if (status === "failure") {
        const errorCause = await extractBuildError(buildUrl);
        const consoleUrl = `${buildUrl}console`;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ status, buildUrl, consoleUrl, result: buildData.result, errorCause }),
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status, buildUrl, result: buildData.result }),
        }],
      };
    }
  );
}

async function extractBuildError(buildUrl: string): Promise<string[]> {
  const consoleUrl = `${buildUrl}consoleText`;
  try {
    const res = await fetch(consoleUrl, { headers: jenkinsHeaders() });
    if (!res.ok) return [`Could not fetch log (HTTP ${res.status})`];

    const text = await res.text();
    const lines = text.split("\n");

    // Extract meaningful error lines
    const errorPatterns = [
      /\[ERROR\]/i,
      /\bERROR:/i,
      /BUILD FAILURE/i,
      /BUILD FAILED/i,
      /\bFATAL:/i,
      /Exception in thread/i,
      /Caused by:/i,
      /npm ERR!/i,
      /error TS\d+:/i,
      /FAILED$/,
    ];

    const errorLines = lines.filter(l => errorPatterns.some(p => p.test(l.trim())));

    // Deduplicate and limit
    const unique = [...new Set(errorLines.map(l => l.trim()))].slice(0, 20);
    return unique.length > 0 ? unique : ["No specific error lines identified — check the full log"];
  } catch {
    return ["Could not fetch console log"];
  }
}
