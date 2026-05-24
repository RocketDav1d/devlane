import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SmolmachinesDriver } from "../src/drivers/smolmachines-driver.js";
import { envLogDir } from "../src/shared/paths.js";

test("SmolmachinesDriver prepares a mounted machine and runs commands through smolvm CLI", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-smol-"));
  process.env.DEVLANE_HOME = path.join(tempRoot, "state");
  const calls = [];
  const driver = new SmolmachinesDriver({
    runner: async (args, options) => {
      calls.push({ args, options });
      return { args, exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false };
    }
  });
  const handle = {
    id: "env_test",
    workdir: "/tmp/workspace",
    metadata: {
      config: {
        runtime: {
          driver: "smolmachines",
          cpus: 2,
          memory: "1gb",
          smolvmBinary: "/usr/local/bin/smolvm"
        }
      },
      ports: {
        "apps.api": {
          hostPort: 38123,
          internalPort: 3001
        }
      }
    }
  };

  await driver.prepare(handle);
  const result = await driver.runCommand(handle, {
    command: "echo ok",
    env: { NODE_ENV: "test" },
    timeoutMs: 1000
  });
  await driver.destroy(handle);

  assert.deepEqual(calls[0].args, ["--version"]);
  assert.equal(calls[0].options.binary, "/usr/local/bin/smolvm");
  assert.deepEqual(calls[1].args, ["machine", "stop", "--name", "devlane-env_test"]);
  assert.deepEqual(calls[2].args, ["machine", "delete", "--force", "devlane-env_test"]);
  assert.deepEqual(calls[3].args, [
    "machine",
    "create",
    "--cpus",
    "2",
    "--mem",
    "1024",
    "--workdir",
    "/workspace",
    "--volume",
    "/tmp/workspace:/workspace",
    "--volume",
    `${envLogDir("env_test")}:/devlane/logs`,
    "--port",
    "38123:3001",
    "--net",
    "devlane-env_test"
  ]);
  assert.deepEqual(calls[4].args, ["machine", "start", "--name", "devlane-env_test"]);
  assert.deepEqual(calls[5].args, [
    "machine",
    "exec",
    "--name",
    "devlane-env_test",
    "--workdir",
    "/workspace",
    "--env",
    "NODE_ENV=test",
    "--timeout",
    "1s",
    "sh",
    "-lc",
    "echo ok"
  ]);
  assert.equal(calls[5].options.timeoutMs, 6000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok\n");
  assert.deepEqual(calls[6].args, ["machine", "stop", "--name", "devlane-env_test"]);
  assert.deepEqual(calls[7].args, ["machine", "delete", "--force", "devlane-env_test"]);
  assert.equal(handle.runtimeId, "smolvm:devlane-env_test");
});

test("SmolmachinesDriver starts and stops a guest process through smolvm exec", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-smol-process-"));
  process.env.DEVLANE_HOME = path.join(tempRoot, "state");
  const calls = [];
  const processCalls = [];
  const stoppedPids = [];
  const driver = new SmolmachinesDriver({
    runner: async (args, options) => {
      calls.push({ args, options });
      return { args, exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
    processSpawner: async (binary, args, processSpec) => {
      processCalls.push({ binary, args, processSpec });
      return { pid: 4321 };
    },
    processStopper: async (pid) => {
      stoppedPids.push(pid);
    }
  });
  const handle = {
    id: "env_process",
    workdir: "/tmp/workspace",
    metadata: {
      config: {
        runtime: {
          driver: "smolmachines",
          network: false
        }
      }
    }
  };

  await driver.prepare(handle);
  const processHandle = await driver.startProcess(handle, {
    name: "api",
    command: "pnpm dev",
    cwd: "/tmp/workspace",
    env: { PORT: 3001 },
    logDir: envLogDir("env_process"),
    logPath: path.join(envLogDir("env_process"), "api.log")
  });
  await driver.stopProcess(handle, processHandle.id);

  assert.equal(processHandle.id, "env_process:api:host:4321");
  assert.equal(processHandle.pid, 4321);
  assert.ok(!calls[3].args.includes("--net"));
  assert.deepEqual(processCalls[0].args, [
    "machine",
    "exec",
    "--name",
    "devlane-env_process",
    "--workdir",
    "/workspace",
    "--env",
    "PORT=3001",
    "--stream",
    "sh",
    "-lc",
    "pnpm dev"
  ]);
  assert.equal(processCalls[0].processSpec.logPath, path.join(envLogDir("env_process"), "api.log"));
  assert.deepEqual(stoppedPids, [4321]);
});

test("SmolmachinesDriver reports missing smolvm CLI", async () => {
  const driver = new SmolmachinesDriver({
    runner: async (args) => ({
      args,
      exitCode: 127,
      stdout: "",
      stderr: "spawn smolvm ENOENT",
      timedOut: false,
      spawnError: {
        code: "ENOENT",
        message: "spawn smolvm ENOENT"
      }
    })
  });

  await assert.rejects(
    () =>
      driver.prepare({
        id: "env_missing",
        workdir: "/tmp/workspace",
        metadata: { config: { runtime: { driver: "smolmachines" } } }
      }),
    (error) => {
      assert.equal(error.name, "DevlaneError");
      assert.equal(error.code, "DEVLANE_SMOLMACHINES_CLI_MISSING");
      assert.match(error.suggestions.join("\n"), /install\.sh/);
      return true;
    }
  );
});
