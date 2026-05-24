import { execFileSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

const ready = execFileSync(
  "psql",
  [
    databaseUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-tAc",
    [
      "select",
      "  (select count(*) from schema_migrations) >= 2",
      "  and exists (select 1 from todos where title = 'Seeded Devlane task')"
    ].join("\n")
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: process.env }
).trim();

if (ready !== "t") {
  process.stderr.write("database is reachable but migrations/seed data are not ready\n");
  process.exit(1);
}
