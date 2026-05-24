import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.PORT ?? 3102);
const upstreamUrl = process.env.UPSTREAM_URL;
const artifactDir = path.join(process.cwd(), "tmp");
const startPath = path.join(artifactDir, "app-start.json");

fs.mkdirSync(artifactDir, { recursive: true });

if (!upstreamUrl) {
  process.stderr.write("UPSTREAM_URL is required\n");
  process.exit(1);
}

const startupHealth = await checkUpstream();
const startupRecord = {
  appStartedAt: Date.now(),
  port,
  upstreamUrl,
  serviceHealthyAtStartup: startupHealth.ok,
  serviceStatusAtStartup: startupHealth.status
};

fs.writeFileSync(startPath, `${JSON.stringify(startupRecord, null, 2)}\n`);

if (!startupHealth.ok) {
  process.stderr.write(`upstream was not healthy at startup: ${startupHealth.status}\n`);
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/health") {
    const health = await checkUpstream();
    response.writeHead(health.ok ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: health.ok, upstream: health.status }));
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ app: "api", upstreamUrl }));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`api app listening on ${port}\n`);
});

async function checkUpstream() {
  try {
    const response = await fetch(`${upstreamUrl}/health`);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: error.message };
  }
}
