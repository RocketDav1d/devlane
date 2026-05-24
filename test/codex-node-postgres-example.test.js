import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EnvironmentManager } from "../src/daemon/environment-manager.js";

const hasPostgres = ["postgres", "initdb", "pg_isready", "psql", "createdb"].every(hasCommand);

test(
  "Codex Node Postgres example validates migrations, seed, reset, and app health",
  { skip: !hasPostgres },
  async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-codex-pg-"));
    const projectPath = path.join(tempRoot, "codex-node-postgres");
    const statePath = path.join(tempRoot, "state");
    const previousHome = process.env.DEVLANE_HOME;

    fs.cpSync(path.resolve("examples/codex-node-postgres"), projectPath, { recursive: true });
    process.env.DEVLANE_HOME = statePath;

    const manager = new EnvironmentManager();

    try {
      const record = await manager.ensureEnvironment(projectPath);

      assert.equal(record.status, "healthy");
      assert.match(record.urls.services.postgres, /^postgres:\/\/localhost:\d+\/app$/);
      assert.match(record.urls.apps.api, /^http:\/\/localhost:\d+$/);

      const envFile = fs.readFileSync(path.join(projectPath, ".env.local"), "utf8");
      assert.match(envFile, /DATABASE_URL=postgres:\/\/localhost:\d+\/app/);
      assert.match(envFile, /API_URL=http:\/\/localhost:\d+/);

      assert.deepEqual(await getJson(`${record.urls.apps.api}/health`), {
        ok: true,
        database: "reachable",
        migrations: 2,
        todos: 1
      });

      assert.deepEqual(await todoTitles(record.urls.apps.api), ["Seeded Devlane task"]);

      const created = await postJson(`${record.urls.apps.api}/todos`, {
        title: "Codex-created task"
      });
      assert.equal(created.todo.title, "Codex-created task");
      assert.deepEqual(await todoTitles(record.urls.apps.api), [
        "Seeded Devlane task",
        "Codex-created task"
      ]);

      const eventCount = await getJson(`${record.urls.apps.api}/events/count`);
      assert.deepEqual(eventCount, { count: 3 });

      const pidBeforeReset = record.apps.api.pid;
      const resetRecord = await manager.resetDatabase(projectPath);

      assert.equal(resetRecord.status, "healthy");
      assert.notEqual(resetRecord.apps.api.pid, pidBeforeReset);
      assert.deepEqual(await getJson(`${resetRecord.urls.apps.api}/health`), {
        ok: true,
        database: "reachable",
        migrations: 2,
        todos: 1
      });
      assert.deepEqual(await getJson(`${resetRecord.urls.apps.api}/events/count`), { count: 0 });
      assert.deepEqual(await todoTitles(resetRecord.urls.apps.api), ["Seeded Devlane task"]);
    } finally {
      try {
        await manager.destroyEnvironment(projectPath);
      } catch {
        // The setup path may fail before an environment record is persisted.
      }

      if (previousHome === undefined) {
        delete process.env.DEVLANE_HOME;
      } else {
        process.env.DEVLANE_HOME = previousHome;
      }
    }
  }
);

async function todoTitles(apiUrl) {
  const body = await getJson(`${apiUrl}/todos`);
  return body.todos.map((todo) => todo.title);
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const responseBody = await response.text();
  assert.equal(response.status, 201, responseBody);
  return JSON.parse(responseBody);
}

function hasCommand(command) {
  try {
    execFileSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
