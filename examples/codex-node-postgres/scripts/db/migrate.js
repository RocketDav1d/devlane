import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dbDir, "migrations");

if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

psql([
  "-c",
  [
    "create table if not exists schema_migrations (",
    "  version text primary key,",
    "  applied_at timestamptz not null default now()",
    ")"
  ].join("\n")
]);

const migrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

for (const fileName of migrations) {
  const version = fileName.replace(/\.sql$/, "");
  const applied = psql([
    "-tAc",
    `select 1 from schema_migrations where version = ${sqlString(version)}`
  ]).trim();

  if (applied === "1") continue;

  const filePath = path.join(migrationsDir, fileName);
  psql([
    "-c",
    "begin",
    "-f",
    filePath,
    "-c",
    `insert into schema_migrations (version) values (${sqlString(version)})`,
    "-c",
    "commit"
  ]);
}

function psql(args) {
  return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"]
  });
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
