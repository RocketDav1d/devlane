import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
const dbDir = path.dirname(fileURLToPath(import.meta.url));

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
    "-f",
    path.join(dbDir, "seed.sql")
  ],
  { stdio: "inherit", env: process.env }
);
