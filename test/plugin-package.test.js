import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Codex plugin package scaffold is present", () => {
  const pluginJsonPath = path.resolve("plugin/.codex-plugin/plugin.json");
  const mcpConfigPath = path.resolve("plugin/mcp/devlane-mcp.json");
  const skillPath = path.resolve("plugin/skills/devlane/SKILL.md");
  const metadataPath = path.resolve("plugin/skills/devlane/agents/openai.yaml");

  const plugin = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8"));
  const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));

  assert.equal(plugin.name, "devlane");
  assert.deepEqual(plugin.skills, ["skills/devlane"]);
  assert.equal(plugin.mcpServers.devlane.command, "devlane");
  assert.deepEqual(plugin.mcpServers.devlane.args, ["mcp", "serve"]);
  assert.equal(mcpConfig.mcpServers.devlane.command, "devlane");
  assert.deepEqual(mcpConfig.mcpServers.devlane.args, ["mcp", "serve"]);
  assert.match(fs.readFileSync(skillPath, "utf8"), /name: devlane/);
  assert.match(fs.readFileSync(metadataPath, "utf8"), /display_name: Devlane/);
});
