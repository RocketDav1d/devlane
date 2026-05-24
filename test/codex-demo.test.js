import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installCodexCommand } from "../src/cli/commands/install-codex.js";
import { verifyCodexIntegration } from "../src/integrations/codex/verify.js";

test("Codex demo repo can install and verify Devlane integration assets", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-codex-demo-"));
  const projectPath = path.join(tempRoot, "codex-node-postgres");
  fs.cpSync(path.resolve("examples/codex-node-postgres"), projectPath, { recursive: true });

  await withMutedStdout(() => installCodexCommand(["--project", projectPath]));

  const report = verifyCodexIntegration(projectPath);
  assert.equal(report.ok, true);
  assert.ok(fs.existsSync(path.join(projectPath, ".codex", "config.toml")));
  assert.ok(fs.existsSync(path.join(projectPath, ".agents", "skills", "devlane", "SKILL.md")));
  assert.doesNotMatch(
    fs.readFileSync(path.join(projectPath, ".codex", "environments", "environment.toml"), "utf8"),
    absoluteCodexScriptPathPattern()
  );
  assert.doesNotMatch(
    JSON.stringify(JSON.parse(fs.readFileSync(path.join(projectPath, ".codex", "hooks.json"), "utf8"))),
    absoluteCodexScriptPathPattern()
  );
});

function absoluteCodexScriptPathPattern() {
  return /\/(?!\.codex\/)(?:[^"'`\n]*?)\.codex\/devlane\/(?:setup|cleanup|session-start-hook)\.sh/;
}

async function withMutedStdout(callback) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    return await callback();
  } finally {
    process.stdout.write = originalWrite;
  }
}
