import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/loader.js";

test("loadConfig parses real YAML and applies Devlane defaults", () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-config-"));
  fs.writeFileSync(
    path.join(projectPath, "devlane.yaml"),
    `version: 1
runtime:
  driver: process
apps:
  api:
    command: "node scripts/server.js"
    port: 3001
    healthcheck:
      url: "http://localhost:\${apps.api.hostPort}/health"
setup:
  commands:
    - pnpm install
    - pnpm db:migrate
`
  );

  const loaded = loadConfig(projectPath);

  assert.equal(loaded.config.runtime.driver, "process");
  assert.equal(loaded.config.apps.api.command, "node scripts/server.js");
  assert.equal(loaded.config.apps.api.port, 3001);
  assert.deepEqual(loaded.config.setup.commands, ["pnpm install", "pnpm db:migrate"]);
  assert.deepEqual(loaded.config.database.reset.commands, []);
  assert.deepEqual(loaded.config.context.files, [".devlane/context.md", ".env.local"]);
});

test("loadConfig reports schema validation errors with paths", () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-invalid-config-"));
  fs.writeFileSync(
    path.join(projectPath, "devlane.yaml"),
    `version: 1
runtime:
  driver: docker
apps:
  api:
    port: 3001
`
  );

  assert.throws(
    () => loadConfig(projectPath),
    /Invalid devlane config: .*runtime\.driver.*apps\.api\.command/
  );
});
