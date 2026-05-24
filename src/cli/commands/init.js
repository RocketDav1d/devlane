import fs from "node:fs";
import path from "node:path";
import { hasFlag, projectPathFromArgs } from "../args.js";

export async function initCommand(args) {
  const projectPath = path.resolve(projectPathFromArgs(args));
  const configPath = path.join(projectPath, "devlane.yaml");

  if (fs.existsSync(configPath)) {
    throw new Error(`devlane.yaml already exists at ${configPath}`);
  }

  const detected = hasFlag(args, "detect") ? detectProject(projectPath) : emptyDetection();
  const config = buildInitialConfig(detected);

  fs.writeFileSync(configPath, config);
  process.stdout.write(`Created ${configPath}\n`);

  if (detected.notes.length > 0) {
    process.stdout.write(`\nDetected:\n${detected.notes.map((note) => `- ${note}`).join("\n")}\n`);
  }
}

function emptyDetection() {
  return {
    services: {},
    setupCommands: [],
    notes: []
  };
}

function detectProject(projectPath) {
  const packagePath = path.join(projectPath, "package.json");
  const result = emptyDetection();

  if (fs.existsSync(packagePath)) {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    result.packageManager = detectPackageManager(projectPath);
    result.setupCommands.push(installCommandFor(result.packageManager));
    result.notes.push(`package manager: ${result.packageManager.label}`);

    if (packageJson.scripts?.["dev:api"]) {
      result.appCommand = scriptCommand(result.packageManager, "dev:api");
      result.notes.push("app command from package.json script: dev:api");
    } else if (packageJson.scripts?.dev) {
      result.appCommand = scriptCommand(result.packageManager, "dev");
      result.notes.push("app command from package.json script: dev");
    }

    if (fs.existsSync(path.join(projectPath, "prisma", "schema.prisma"))) {
      result.setupCommands.push(prismaMigrateCommand(result.packageManager));
      result.notes.push("Prisma schema detected");
    }
  }

  const compose = detectCompose(projectPath);
  if (compose.postgres) {
    result.services.postgres = {
      type: "postgres",
      command: `${compose.command} up ${compose.postgres}`,
      port: 5432,
      url: "postgres://postgres:postgres@localhost:${service.hostPort}/postgres",
      healthcheck: {
        command: "pg_isready -h 127.0.0.1 -p ${services.postgres.hostPort}",
        interval_ms: 1000,
        timeout_ms: 30000
      }
    };
    result.notes.push(`Postgres service from ${compose.file}: ${compose.postgres}`);
  }

  if (compose.redis) {
    result.services.redis = {
      type: "redis",
      command: `${compose.command} up ${compose.redis}`,
      port: 6379,
      url: "redis://localhost:${service.hostPort}",
      healthcheck: {
        command: "redis-cli -h 127.0.0.1 -p ${services.redis.hostPort} ping",
        interval_ms: 1000,
        timeout_ms: 30000
      }
    };
    result.notes.push(`Redis service from ${compose.file}: ${compose.redis}`);
  }

  return result;
}

function detectPackageManager(projectPath) {
  if (fs.existsSync(path.join(projectPath, "pnpm-lock.yaml"))) return { label: "pnpm", runner: "pnpm" };
  if (fs.existsSync(path.join(projectPath, "yarn.lock"))) return { label: "yarn", runner: "yarn" };
  return { label: "npm", runner: "npm run" };
}

function installCommandFor(packageManager) {
  if (packageManager.label === "pnpm") return "pnpm install";
  if (packageManager.label === "yarn") return "yarn install";
  return "npm install";
}

function scriptCommand(packageManager, script) {
  return `${packageManager.runner} ${script}`;
}

function prismaMigrateCommand(packageManager) {
  if (packageManager.label === "pnpm") return "pnpm prisma migrate dev";
  if (packageManager.label === "yarn") return "yarn prisma migrate dev";
  return "npx prisma migrate dev";
}

function detectCompose(projectPath) {
  const file = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"]
    .find((name) => fs.existsSync(path.join(projectPath, name)));

  if (!file) return {};

  const text = fs.readFileSync(path.join(projectPath, file), "utf8");
  return {
    file,
    command: `docker compose -f ${file}`,
    postgres: detectComposeService(text, "postgres"),
    redis: detectComposeService(text, "redis")
  };
}

function detectComposeService(text, kind) {
  const lines = text.split(/\r?\n/);
  let current = null;
  let currentIndent = 0;
  const serviceNames = new Set();

  for (const line of lines) {
    const match = line.match(/^(\s{2,})([A-Za-z0-9_-]+):\s*$/);
    if (match) {
      current = match[2];
      currentIndent = match[1].length;
      if (current.toLowerCase().includes(kind)) serviceNames.add(current);
      continue;
    }

    if (current && line.startsWith(" ".repeat(currentIndent + 2))) {
      const lower = line.toLowerCase();
      if (lower.includes(`image: ${kind}`) || lower.includes(`image: "${kind}`) || lower.includes(`image: '${kind}`)) {
        serviceNames.add(current);
      }
    }
  }

  return [...serviceNames][0];
}

function buildInitialConfig(detected) {
  const command = detected.appCommand ?? "node scripts/dev-server.js";
  const services = renderServices(detected.services);
  const setupCommands = detected.setupCommands.length > 0
    ? detected.setupCommands.map((setupCommand) => `    - ${quote(setupCommand)}`).join("\n")
    : "    []";

  return `version: 1

runtime:
  driver: process

${services}apps:
  api:
    command: ${quote(command)}
    port: 3001
    healthcheck:
      url: "http://localhost:\${apps.api.hostPort}/health"
      interval_ms: 500
      timeout_ms: 30000

setup:
  commands:
${setupCommands}

context:
  files:
    - .devlane/context.md
    - .env.local
`;
}

function renderServices(services) {
  const entries = Object.entries(services);
  if (entries.length === 0) return "";

  const lines = ["services:"];

  for (const [name, service] of entries) {
    lines.push(`  ${name}:`);
    lines.push(`    type: ${service.type}`);
    lines.push(`    command: ${quote(service.command)}`);
    lines.push(`    port: ${service.port}`);
    lines.push(`    url: ${quote(service.url)}`);
    lines.push("    healthcheck:");
    if (service.healthcheck.command) {
      lines.push(`      command: ${quote(service.healthcheck.command)}`);
    } else {
      lines.push(`      url: ${quote(service.healthcheck.url)}`);
    }
    lines.push(`      interval_ms: ${service.healthcheck.interval_ms}`);
    lines.push(`      timeout_ms: ${service.healthcheck.timeout_ms}`);
  }

  return `${lines.join("\n")}\n\n`;
}

function quote(value) {
  return JSON.stringify(value);
}
