import net from "node:net";
import { randomInt } from "node:crypto";

const DEFAULT_MIN = 49000;
const DEFAULT_MAX = 59999;

export async function allocatePorts(config, existing = {}) {
  const used = new Set();
  const ports = {};

  for (const [name, service] of Object.entries(config.services)) {
    if (!service.port) continue;
    ports[`services.${name}`] = await allocateOne({
      name,
      internalPort: service.port,
      existing: existing[`services.${name}`],
      used
    });
  }

  for (const [name, app] of Object.entries(config.apps)) {
    if (!app.port) continue;
    ports[`apps.${name}`] = await allocateOne({
      name,
      internalPort: app.port,
      existing: existing[`apps.${name}`],
      used
    });
  }

  return ports;
}

async function allocateOne({ name, internalPort, existing, used }) {
  if (existing?.hostPort && !used.has(existing.hostPort)) {
    const available = await isPortAvailable(existing.hostPort);
    if (available) {
      used.add(existing.hostPort);
      return existing;
    }
  }

  const start = randomInt(DEFAULT_MIN, DEFAULT_MAX + 1);

  for (let offset = 0; offset <= DEFAULT_MAX - DEFAULT_MIN; offset += 1) {
    const port = DEFAULT_MIN + ((start - DEFAULT_MIN + offset) % (DEFAULT_MAX - DEFAULT_MIN + 1));
    if (used.has(port)) continue;
    if (await isPortAvailable(port)) {
      used.add(port);
      return {
        name,
        internalPort,
        hostPort: port,
        protocol: "tcp"
      };
    }
  }

  throw new Error(`No free ports available in ${DEFAULT_MIN}-${DEFAULT_MAX}`);
}

export function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.on("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolve(true));
    });
  });
}
