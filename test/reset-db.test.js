import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

test("EnvironmentManager resets database and restarts apps", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-reset-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, "scripts/reset.js"),
    [
      "import fs from 'node:fs';",
      "fs.writeFileSync('reset-marker.txt', JSON.stringify({",
      "  envId: process.env.DEVLANE_ENV_ID,",
      "  apiUrl: process.env.API_URL",
      "}));"
    ].join("\n")
  );
  fs.appendFileSync(
    path.join(projectPath, "devlane.yaml"),
    [
      "",
      "database:",
      "  reset:",
      "    commands:",
      "      - \"node scripts/reset.js\"",
      ""
    ].join("\n")
  );

  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();
  const record = await manager.ensureEnvironment(projectPath);

  try {
    const pidBefore = record.apps.api.pid;
    const resetRecord = await manager.resetDatabase(projectPath);

    assert.equal(resetRecord.status, "healthy");
    assert.notEqual(resetRecord.apps.api.pid, pidBefore);

    const marker = JSON.parse(fs.readFileSync(path.join(projectPath, "reset-marker.txt"), "utf8"));
    assert.equal(marker.envId, resetRecord.id);
    assert.equal(marker.apiUrl, resetRecord.urls.apps.api);

    const response = await fetch(`${resetRecord.urls.apps.api}/health`);
    assert.equal(response.status, 200);
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});

test("EnvironmentManager reset reports missing reset commands", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-reset-missing-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();

  await assert.rejects(
    () => manager.resetDatabase(projectPath),
    /No database reset commands configured/
  );
});
