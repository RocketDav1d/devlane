import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

test("EnvironmentManager restarts a managed app", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-restart-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();
  const record = await manager.ensureEnvironment(projectPath);

  try {
    const originalPid = record.apps.api.pid;
    const restarted = await manager.restart(projectPath, "api");

    assert.equal(restarted.status, "healthy");
    assert.notEqual(restarted.apps.api.pid, originalPid);
    const response = await fetch(`${restarted.urls.apps.api}/health`);
    assert.equal(response.status, 200);
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});

test("EnvironmentManager restart reports missing components", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-restart-missing-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();
  const record = await manager.ensureEnvironment(projectPath);

  try {
    await assert.rejects(
      () => manager.restart(projectPath, "worker"),
      (error) => {
        assert.equal(error.name, "DevlaneError");
        assert.equal(error.code, "DEVLANE_COMPONENT_NOT_FOUND");
        return true;
      }
    );
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});
