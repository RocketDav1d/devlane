import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";
import { createDaemonServer } from "../src/daemon/rpc-server.js";
import { DaemonRpcClient } from "../src/daemon/rpc-client.js";
import { formatDevlaneError } from "../src/shared/devlane-error.js";

test("EnvironmentManager throws actionable healthcheck errors", async () => {
  const { projectPath, statePath } = createFailingHealthcheckFixture();
  process.env.DEVLANE_HOME = statePath;
  const manager = new EnvironmentManager();

  try {
    await assert.rejects(
      () => manager.ensureEnvironment(projectPath),
      (error) => {
        assert.equal(error.name, "DevlaneError");
        assert.equal(error.code, "DEVLANE_HEALTHCHECK_FAILED");
        assert.equal(error.component, "app.api");
        assert.equal(error.operation, "healthcheck");
        assert.match(error.details.logPath, /api\.log$/);
        assert.match(error.suggestions.join("\n"), /devlane logs api/);

        const formatted = formatDevlaneError(error);
        assert.match(formatted, /Code: DEVLANE_HEALTHCHECK_FAILED/);
        assert.match(formatted, /Component: app\.api/);
        assert.match(formatted, /Suggested next steps:/);
        return true;
      }
    );
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});

test("daemon RPC preserves structured Devlane errors", async () => {
  const { projectPath, statePath } = createFailingHealthcheckFixture();
  const socketPath = path.join(statePath, "daemon.sock");
  process.env.DEVLANE_HOME = statePath;
  const server = createDaemonServer({ socketPath });
  await server.start();

  try {
    const client = new DaemonRpcClient({ socketPath, timeoutMs: 5000 });
    await assert.rejects(
      () => client.ensureEnvironment(projectPath),
      (error) => {
        assert.equal(error.name, "DevlaneError");
        assert.equal(error.code, "DEVLANE_HEALTHCHECK_FAILED");
        assert.equal(error.component, "app.api");
        return true;
      }
    );
  } finally {
    const manager = new EnvironmentManager();
    await manager.destroyEnvironment(projectPath);
    await new Promise((resolve) => server.close(resolve));
  }
});

function createFailingHealthcheckFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-structured-error-"));
  const projectPath = path.join(tempRoot, "failing-app");
  const statePath = path.join(tempRoot, "state");

  fs.mkdirSync(path.join(projectPath, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, "scripts/hang.js"),
    "setInterval(() => {}, 1000);\n"
  );
  fs.writeFileSync(
    path.join(projectPath, "devlane.yaml"),
    `version: 1

runtime:
  driver: process

apps:
  api:
    command: "node scripts/hang.js"
    port: 3001
    healthcheck:
      url: "http://localhost:\${apps.api.hostPort}/health"
      interval_ms: 50
      timeout_ms: 300

setup:
  commands: []

context:
  files:
    - .devlane/context.md
    - .env.local
`
  );

  return { projectPath, statePath };
}
