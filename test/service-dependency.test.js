import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

test("EnvironmentManager starts apps after managed services are healthy", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-service-test-"));
  const projectPath = path.join(tempRoot, "service-dependency");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/service-dependency"), projectPath, { recursive: true });
  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();
  const record = await manager.ensureEnvironment(projectPath);

  try {
    assert.equal(record.status, "healthy");
    assert.match(record.urls.services.upstream, /^http:\/\/localhost:\d+$/);
    assert.match(record.urls.apps.api, /^http:\/\/localhost:\d+$/);

    const serviceResponse = await fetch(`${record.urls.services.upstream}/health`);
    assert.equal(serviceResponse.status, 200);

    const appResponse = await fetch(`${record.urls.apps.api}/health`);
    assert.equal(appResponse.status, 200);
    assert.deepEqual(await appResponse.json(), { ok: true, upstream: 200 });

    const serviceReady = JSON.parse(
      fs.readFileSync(path.join(projectPath, "tmp/service-ready.json"), "utf8")
    );
    const appStart = JSON.parse(
      fs.readFileSync(path.join(projectPath, "tmp/app-start.json"), "utf8")
    );

    assert.equal(appStart.upstreamUrl, record.urls.services.upstream);
    assert.equal(appStart.serviceHealthyAtStartup, true);
    assert.equal(appStart.serviceStatusAtStartup, 200);
    assert.ok(appStart.appStartedAt >= serviceReady.readyAt);

    const context = fs.readFileSync(path.join(projectPath, ".devlane/context.md"), "utf8");
    assert.match(context, new RegExp(`upstream: ${escapeRegExp(record.urls.services.upstream)}`));
    assert.match(context, new RegExp(`api: ${escapeRegExp(record.urls.apps.api)}`));

    const env = fs.readFileSync(path.join(projectPath, ".env.local"), "utf8");
    assert.match(env, new RegExp(`UPSTREAM_URL=${escapeRegExp(record.urls.services.upstream)}`));
    assert.match(env, new RegExp(`API_URL=${escapeRegExp(record.urls.apps.api)}`));
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
