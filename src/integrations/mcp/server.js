import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { EnvironmentClient } from "../../cli/environment-client.js";

const client = new EnvironmentClient({ timeoutMs: 120000 });

const projectInputSchema = {
  projectPath: z.string().optional().describe("Worktree path. Defaults to the current process working directory.")
};

const serviceInputSchema = {
  ...projectInputSchema,
  service: z.string().optional().describe("App or service name."),
  tail: z.number().int().positive().max(5000).optional().describe("Number of log lines to return.")
};

export function createMcpServer(options = {}) {
  const environmentClient = options.environmentClient ?? client;
  const server = new McpServer({
    name: "devlane",
    version: "0.1.0"
  });

  server.registerTool(
    "devlane.status",
    {
      title: "Devlane Status",
      description: "Return status, URLs, ports, and health for the current worktree environment.",
      inputSchema: projectInputSchema
    },
    async ({ projectPath }) => {
      const record = await environmentClient.refreshEnvironment(projectPath ?? process.cwd());
      return textResult(record ? JSON.stringify(record, null, 2) : "No Devlane environment exists for this worktree.");
    }
  );

  server.registerTool(
    "devlane.logs",
    {
      title: "Devlane Logs",
      description: "Return recent log lines for a Devlane service or app, or all log paths when no service is provided.",
      inputSchema: serviceInputSchema
    },
    async ({ projectPath, service, tail }) => {
      const record = await environmentClient.getEnvironment(projectPath ?? process.cwd());
      if (!record) {
        return textResult("No Devlane environment exists for this worktree.");
      }

      const entry = service ? record.apps[service] ?? record.services[service] : null;
      const text = entry ? tailFile(entry.logPath, tail ?? 200) : JSON.stringify(logMap(record), null, 2);
      return textResult(text);
    }
  );

  server.registerTool(
    "devlane.reset_db",
    {
      title: "Devlane Reset DB",
      description: "Run configured database reset commands, then restart app processes and wait for health.",
      inputSchema: projectInputSchema
    },
    async ({ projectPath }) => {
      const record = await environmentClient.resetDatabase(projectPath ?? process.cwd());
      return textResult(`Database reset complete for environment ${record.id}. Status: ${record.status}.`);
    }
  );

  server.registerTool(
    "devlane.restart",
    {
      title: "Devlane Restart",
      description: "Restart a Devlane app/service, or all apps when no service is provided.",
      inputSchema: serviceInputSchema
    },
    async ({ projectPath, service }) => {
      const record = await environmentClient.restart(projectPath ?? process.cwd(), service);
      return textResult(`Restart complete for environment ${record.id}. Status: ${record.status}.`);
    }
  );

  return server;
}

export async function serveMcp(options = {}) {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function tailFile(filePath, lines) {
  if (!fs.existsSync(filePath)) return `No log file at ${filePath}`;
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).slice(-Number(lines)).join("\n");
}

function logMap(record) {
  return {
    apps: Object.fromEntries(Object.entries(record.apps).map(([name, app]) => [name, app.logPath])),
    services: Object.fromEntries(
      Object.entries(record.services).map(([name, service]) => [name, service.logPath])
    )
  };
}

function textResult(text) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}
