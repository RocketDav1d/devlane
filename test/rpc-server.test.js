import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDaemonServer } from "../src/daemon/rpc-server.js";
import { DaemonRpcClient } from "../src/daemon/rpc-client.js";

test("daemon RPC server responds to ping", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-rpc-"));
  const socketPath = path.join(tempRoot, "daemon.sock");
  const server = createDaemonServer({ socketPath });

  await server.start();

  try {
    const client = new DaemonRpcClient({ socketPath });
    const result = await client.ping();
    assert.equal(result.ok, true);
    assert.equal(typeof result.pid, "number");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
