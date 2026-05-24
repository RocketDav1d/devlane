import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initCommand } from "../src/cli/commands/init.js";

test("init --detect drafts package, Prisma, and Compose config", async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-init-detect-"));
  fs.mkdirSync(path.join(projectPath, "prisma"));
  fs.writeFileSync(path.join(projectPath, "pnpm-lock.yaml"), "");
  fs.writeFileSync(
    path.join(projectPath, "package.json"),
    JSON.stringify({
      scripts: {
        "dev:api": "next dev"
      }
    })
  );
  fs.writeFileSync(path.join(projectPath, "prisma", "schema.prisma"), "datasource db { provider = \"postgresql\" }\n");
  fs.writeFileSync(
    path.join(projectPath, "compose.yaml"),
    [
      "services:",
      "  db:",
      "    image: postgres:16",
      "  cache:",
      "    image: redis:7"
    ].join("\n")
  );

  await withMutedStdout(() => initCommand(["--detect", "--project", projectPath]));

  const config = fs.readFileSync(path.join(projectPath, "devlane.yaml"), "utf8");
  assert.match(config, /command: "pnpm dev:api"/);
  assert.match(config, /postgres:/);
  assert.match(config, /command: "docker compose -f compose.yaml up db"/);
  assert.match(config, /redis:/);
  assert.match(config, /command: "docker compose -f compose.yaml up cache"/);
  assert.match(config, /- "pnpm install"/);
  assert.match(config, /- "pnpm prisma migrate dev"/);
});

async function withMutedStdout(callback) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    return await callback();
  } finally {
    process.stdout.write = originalWrite;
  }
}
