import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT ?? 3201);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/health") {
      await query("select 1");
      json(response, 200, { ok: true });
      return;
    }

    if (request.url === "/insert") {
      await query("create table if not exists items (id serial primary key, name text not null)");
      await query("insert into items (name) values ('extra')");
      json(response, 200, { ok: true });
      return;
    }

    if (request.url === "/count") {
      await query("create table if not exists items (id serial primary key, name text not null)");
      const count = Number((await query("select count(*) from items")).trim());
      json(response, 200, { count });
      return;
    }

    json(response, 200, { app: "postgres-basic" });
  } catch (error) {
    json(response, 500, { ok: false, error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`postgres fixture api listening on ${port}\n`);
});

async function query(sql) {
  const result = await execFileAsync("psql", [databaseUrl, "-tAc", sql], {
    env: process.env
  });
  return result.stdout;
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
