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
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      const migrations = Number(await scalar("select count(*) from schema_migrations"));
      const todos = Number(await scalar("select count(*) from todos"));
      json(response, 200, { ok: true, database: "reachable", migrations, todos });
      return;
    }

    if (request.method === "GET" && url.pathname === "/todos") {
      await logEvent("GET /todos");
      json(response, 200, { todos: await todos() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/todos") {
      const body = await readJson(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        json(response, 400, { ok: false, error: "title is required" });
        return;
      }

      const todo = await insertTodo(title);
      await logEvent("POST /todos");
      json(response, 201, { todo });
      return;
    }

    if (request.method === "GET" && url.pathname === "/events/count") {
      const count = Number(await scalar("select count(*) from api_events"));
      json(response, 200, { count });
      return;
    }

    json(response, 200, { app: "codex-node-postgres-demo" });
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    json(response, 500, { ok: false, error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`demo api listening on ${port}\n`);
});

async function query(sql) {
  const result = await execFileAsync("psql", [databaseUrl, "-qAtc", sql], {
    env: process.env
  });
  return result.stdout;
}

async function scalar(sql) {
  return (await query(sql)).trim();
}

async function todos() {
  const raw = await scalar(`
    select coalesce(json_agg(row_to_json(t)), '[]'::json)::text
    from (
      select id, title, completed
      from todos
      order by id
    ) t
  `);
  return JSON.parse(raw);
}

async function insertTodo(title) {
  const raw = await scalar(`
    insert into todos (title)
    values (${sqlString(title)})
    returning json_build_object(
      'id', id,
      'title', title,
      'completed', completed
    )::text
  `);
  return JSON.parse(raw);
}

async function logEvent(route) {
  await query(`insert into api_events (route) values (${sqlString(route)})`);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
