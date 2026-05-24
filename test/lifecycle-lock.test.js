import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

test("EnvironmentManager serializes concurrent ensure calls for one worktree", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-lock-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, "scripts/setup-count.js"),
    [
      "import fs from 'node:fs';",
      "const file = 'setup-count.txt';",
      "const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;",
      "fs.writeFileSync(file, String(count + 1));"
    ].join("\n")
  );
  const configPath = path.join(projectPath, "devlane.yaml");
  fs.writeFileSync(
    configPath,
    fs.readFileSync(configPath, "utf8").replace(
      "setup:\n  commands: []",
      "setup:\n  commands:\n    - \"node scripts/setup-count.js\""
    )
  );

  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();

  try {
    const [first, second] = await Promise.all([
      manager.ensureEnvironment(projectPath),
      manager.ensureEnvironment(projectPath)
    ]);

    assert.equal(first.id, second.id);
    assert.equal(first.status, "healthy");
    assert.equal(second.status, "healthy");
    assert.equal(fs.readFileSync(path.join(projectPath, "setup-count.txt"), "utf8"), "1");
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});
