import { execFileSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

execFileSync("psql", [
  databaseUrl,
  "-v",
  "ON_ERROR_STOP=1",
  "-c",
  "drop table if exists items",
  "-c",
  "create table items (id serial primary key, name text not null)",
  "-c",
  "insert into items (name) values ('seed')"
], { stdio: "inherit" });
