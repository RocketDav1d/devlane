import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

test("EnvironmentManager provisions and destroys a process-driver app", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-test-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();
  const record = await manager.ensureEnvironment(projectPath);

  try {
    assert.equal(record.status, "healthy");
    assert.match(record.urls.apps.api, /^http:\/\/localhost:\d+$/);

    const response = await fetch(`${record.urls.apps.api}/health`);
    assert.equal(response.status, 200);
    assert.equal(fs.existsSync(path.join(projectPath, ".devlane/context.md")), true);
    assert.equal(fs.existsSync(path.join(projectPath, ".env.local")), true);
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});

test("EnvironmentManager reuses existing ports when reattaching to a running app", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-reattach-"));
  const projectPath = path.join(tempRoot, "node-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/node-basic"), projectPath, { recursive: true });
  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();
  const first = await manager.ensureEnvironment(projectPath);

  try {
    const second = await manager.ensureEnvironment(projectPath);

    assert.equal(second.ports["apps.api"].hostPort, first.ports["apps.api"].hostPort);
    assert.equal(second.urls.apps.api, first.urls.apps.api);

    const response = await fetch(`${second.urls.apps.api}/health`);
    assert.equal(response.status, 200);

    second.urls.apps.api = "http://localhost:1";
    await manager.refreshRuntimeStatus(second);
    assert.equal(second.urls.apps.api, first.urls.apps.api);
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});
