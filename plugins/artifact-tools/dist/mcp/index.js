import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGithubTools } from "./github-mcp.js";
import { registerJenkinsTools } from "./jenkins-mcp.js";
const server = new McpServer({
    name: "stratio-artifacts",
    version: "0.1.0",
});
registerGithubTools(server);
registerJenkinsTools(server);
const transport = new StdioServerTransport();
await server.connect(transport);
