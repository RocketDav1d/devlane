import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/integrations/mcp/server.js";

test("MCP server registers Devlane tools through the official SDK", async () => {
  const environmentClient = {
    async refreshEnvironment(projectPath) {
      return {
        id: "env_test",
        status: "healthy",
        worktreePath: projectPath,
        apps: {},
        services: {}
      };
    },
    async getEnvironment() {
      return null;
    },
    async resetDatabase() {
      return { id: "env_test", status: "healthy" };
    },
    async restart() {
      return { id: "env_test", status: "healthy" };
    }
  };

  const server = createMcpServer({ environmentClient });
  const client = new Client({ name: "devlane-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "devlane.status"));
    assert.ok(tools.tools.some((tool) => tool.name === "devlane.reset_db"));

    const result = await client.callTool({
      name: "devlane.status",
      arguments: { projectPath: "/tmp/example-worktree" }
    });

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /env_test/);
    assert.match(result.content[0].text, /\/tmp\/example-worktree/);
  } finally {
    await client.close();
    await server.close();
  }
});
