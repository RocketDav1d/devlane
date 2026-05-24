import http from "node:http";

const port = Number(process.env.PORT ?? 3001);

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain" });
  response.end("devlane fixture\n");
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`fixture server listening on ${port}\n`);
});
