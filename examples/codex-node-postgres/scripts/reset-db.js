import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

execFileSync(
  "psql",
  [
    databaseUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "drop schema if exists public cascade",
    "-c",
    "create schema public"
  ],
  { stdio: "inherit" }
);

runNodeScript(path.join(scriptDir, "db", "migrate.js"));
runNodeScript(path.join(scriptDir, "db", "seed.js"));

function runNodeScript(filePath) {
  execFileSync(process.execPath, [filePath], { stdio: "inherit", env: process.env });
}
