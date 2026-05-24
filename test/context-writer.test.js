import test from "node:test";
import assert from "node:assert/strict";
import {
  appEnvironment,
  buildEnvironmentVariables,
  buildRuntimeContext,
  renderEnvFile,
  renderMarkdownContext
} from "../src/daemon/context-writer.js";

test("context writer renders app URLs and generated env", () => {
  const config = {
    env: {},
    services: {},
    apps: {
      api: {
        command: "node scripts/server.js",
        port: 3001
      }
    }
  };
  const ports = {
    "apps.api": {
      name: "api",
      internalPort: 3001,
      hostPort: 49123,
      protocol: "tcp"
    }
  };
  const context = buildRuntimeContext(config, ports);
  const record = { id: "env_test", status: "healthy" };

  assert.equal(context.urls.apps.api, "http://localhost:49123");
  assert.match(renderMarkdownContext(record, context), /api: http:\/\/localhost:49123/);
  assert.match(renderEnvFile(record, config, context), /API_URL=http:\/\/localhost:49123/);
});

test("runtime env uses internal ports for Smolmachines while generated files use host ports", () => {
  const config = {
    runtime: { driver: "smolmachines" },
    env: {},
    services: {
      postgres: {
        type: "postgres",
        env: {
          POSTGRES_USER: "app",
          POSTGRES_PASSWORD: "secret",
          POSTGRES_DB: "app"
        }
      }
    },
    apps: {
      api: {
        command: "node scripts/server.js",
        port: 3001
      }
    }
  };
  const ports = {
    "services.postgres": {
      name: "postgres",
      internalPort: 5432,
      hostPort: 49124,
      protocol: "tcp"
    },
    "apps.api": {
      name: "api",
      internalPort: 3001,
      hostPort: 49123,
      protocol: "tcp"
    }
  };
  const context = buildRuntimeContext(config, ports);
  context.bindingLookup = ports;
  const record = { id: "env_test", status: "healthy" };

  assert.equal(appEnvironment(config, "api", context).PORT, "3001");
  assert.equal(
    buildEnvironmentVariables(config, context, { target: "runtime" }).POSTGRES_URL,
    "postgres://app:secret@localhost:5432/app"
  );
  assert.match(renderEnvFile(record, config, context), /POSTGRES_URL=postgres:\/\/app:secret@localhost:49124\/app/);
  assert.match(renderEnvFile(record, config, context), /API_URL=http:\/\/localhost:49123/);
});
