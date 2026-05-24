import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

const hasPostgres = ["postgres", "initdb", "pg_isready", "psql", "createdb"].every(hasCommand);

test("EnvironmentManager runs a real Postgres-backed fixture", { skip: !hasPostgres }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-postgres-"));
  const projectPath = path.join(tempRoot, "postgres-basic");
  const statePath = path.join(tempRoot, "state");

  fs.cpSync(path.resolve("fixtures/postgres-basic"), projectPath, { recursive: true });
  process.env.DEVLANE_HOME = statePath;

  const manager = new EnvironmentManager();
  const record = await manager.ensureEnvironment(projectPath);

  try {
    assert.equal(record.status, "healthy");
    assert.match(record.urls.services.postgres, /^postgres:\/\/localhost:\d+\/app$/);
    assert.match(record.urls.apps.api, /^http:\/\/localhost:\d+$/);

    const envFile = fs.readFileSync(path.join(projectPath, ".env.local"), "utf8");
    assert.match(envFile, /DATABASE_URL=postgres:\/\/localhost:\d+\/app/);

    await manager.resetDatabase(projectPath);
    assert.deepEqual(await getJson(`${record.urls.apps.api}/count`), { count: 1 });

    assert.equal((await fetch(`${record.urls.apps.api}/insert`)).status, 200);
    assert.deepEqual(await getJson(`${record.urls.apps.api}/count`), { count: 2 });

    await manager.resetDatabase(projectPath);
    assert.deepEqual(await getJson(`${record.urls.apps.api}/count`), { count: 1 });
  } finally {
    await manager.destroyEnvironment(projectPath);
  }
});

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

function hasCommand(command) {
  try {
    execFileSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
