import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

const execFileAsync = promisify(execFile);

test("EnvironmentManager serializes concurrent ensure calls across processes", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-xproc-lock-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");
  const runnerPath = path.join(tempRoot, "ensure.mjs");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, "scripts/setup-count.js"),
    [
      "import fs from 'node:fs';",
      "const file = 'setup-count.txt';",
      "const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;",
      "await new Promise((resolve) => setTimeout(resolve, 200));",
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
  fs.writeFileSync(
    runnerPath,
    [
      `import { EnvironmentManager } from ${JSON.stringify(pathToFileURL(path.resolve("src/daemon/environment-manager.js")).href)};`,
      "const manager = new EnvironmentManager();",
      "const record = await manager.ensureEnvironment(process.argv[2]);",
      "console.log(record.id);"
    ].join("\n")
  );

  const env = { ...process.env, DEVLANE_HOME: statePath };
  process.env.DEVLANE_HOME = statePath;

  try {
    const [first, second] = await Promise.all([
      execFileAsync(process.execPath, [runnerPath, projectPath], { env }),
      execFileAsync(process.execPath, [runnerPath, projectPath], { env })
    ]);

    assert.equal(first.stdout.trim(), second.stdout.trim());
    assert.equal(fs.readFileSync(path.join(projectPath, "setup-count.txt"), "utf8"), "1");
  } finally {
    await new EnvironmentManager().destroyEnvironment(projectPath);
  }
});
