import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.PORT ?? 3101);
const artifactDir = path.join(process.cwd(), "tmp");
const readyPath = path.join(artifactDir, "service-ready.json");

fs.mkdirSync(artifactDir, { recursive: true });

let ready = false;

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    if (!ready) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, reason: "starting" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, port }));
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ service: "upstream", port }));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`upstream service listening on ${port}\n`);
});

setTimeout(() => {
  ready = true;
  fs.writeFileSync(readyPath, `${JSON.stringify({ readyAt: Date.now(), port }, null, 2)}\n`);
  process.stdout.write("upstream service healthy\n");
}, 300);
