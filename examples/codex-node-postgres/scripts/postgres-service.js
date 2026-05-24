import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 5432);
const root = path.join(process.cwd(), "tmp", "postgres");
const dataDir = path.join(root, "data");
const runDir = path.join("/tmp", `devlane-demo-pg-${process.pid}-${port}`);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(runDir, { recursive: true });

if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
  run("initdb", ["-D", dataDir, "-A", "trust", "-U", process.env.USER ?? "postgres"]);
}

const postgres = spawn("postgres", ["-D", dataDir, "-h", "127.0.0.1", "-p", String(port), "-k", runDir], {
  stdio: "inherit"
});

postgres.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

await waitForReady();
ensureDatabase();
runNodeScript(path.join(scriptDir, "db", "migrate.js"));
runNodeScript(path.join(scriptDir, "db", "seed.js"));
process.stdout.write(`demo postgres ready on ${port}\n`);

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function ensureDatabase() {
  const result = spawnSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-d",
      "postgres",
      "-tAc",
      "select 1 from pg_database where datname = 'app'"
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "failed to inspect databases");
  }

  if (result.stdout.trim() !== "1") {
    run("createdb", ["-h", "127.0.0.1", "-p", String(port), "app"]);
  }
}

async function waitForReady() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", String(port)], {
      encoding: "utf8"
    });
    if (result.status === 0) return;
    await sleep(100);
  }

  throw new Error("postgres did not become ready");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function runNodeScript(filePath) {
  run(process.execPath, [filePath]);
}

function shutdown() {
  postgres.kill("SIGTERM");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
