import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import * as z from "zod/v4";

const CONFIG_NAMES = ["devlane.yaml", "devlane.yml", "devlane.json"];

const healthcheckSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    command: z.string().trim().min(1).optional(),
    interval_ms: z.number().int().positive().optional(),
    timeout_ms: z.number().int().positive().optional()
  })
  .passthrough();

const envSchema = z.record(z.string(), z.unknown()).default({});

const serviceSchema = z
  .object({
    type: z.string().trim().min(1).optional(),
    command: z.string().trim().min(1).optional(),
    port: z.number().int().positive().optional(),
    url: z.string().trim().min(1).optional(),
    env: envSchema,
    healthcheck: healthcheckSchema.optional()
  })
  .passthrough();

const appSchema = z
  .object({
    command: z.string().trim().min(1),
    port: z.number().int().positive().optional(),
    env: envSchema,
    healthcheck: healthcheckSchema.optional()
  })
  .passthrough();

const configSchema = z
  .object({
    version: z.literal(1),
    runtime: withObjectDefault(
      z
        .object({
          driver: z.enum(["process", "smolmachines"]).default("process")
        })
        .passthrough()
    ),
    env: envSchema,
    services: z.record(z.string(), serviceSchema).default({}),
    apps: z.record(z.string(), appSchema).default({}),
    database: withObjectDefault(
      z
        .object({
          reset: withObjectDefault(
            z
              .object({
                commands: z.array(z.string().trim().min(1)).default([])
              })
              .passthrough()
          )
        })
        .passthrough()
    ),
    setup: withObjectDefault(
      z
        .object({
          commands: z.array(z.string().trim().min(1)).default([])
        })
        .passthrough()
    ),
    context: withObjectDefault(
      z
        .object({
          files: z.array(z.string().trim().min(1)).default([".devlane/context.md", ".env.local"])
        })
        .passthrough()
    )
  })
  .passthrough();

export function loadConfig(projectPath) {
  const start = path.resolve(projectPath);
  const configPath = findConfigPath(start);

  if (!configPath) {
    throw new Error(`No devlane.yaml found from ${start}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = parseConfig(raw, configPath);
  const config = normalizeConfig(parsed);

  return {
    config,
    configPath,
    projectRoot: path.dirname(configPath),
    worktreePath: start
  };
}

export function findConfigPath(startPath) {
  let current = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);

  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(current, name);
      if (fs.existsSync(candidate)) return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeConfig(config) {
  const result = configSchema.safeParse(config);

  if (!result.success) {
    throw new Error(`Invalid devlane config: ${formatIssues(result.error.issues)}`);
  }

  return result.data;
}

function parseConfig(raw, configPath) {
  try {
    return configPath.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  } catch (error) {
    throw new Error(`Unable to parse ${path.basename(configPath)}: ${error.message}`);
  }
}

function withObjectDefault(schema) {
  return z.preprocess((value) => value ?? {}, schema);
}

function formatIssues(issues) {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}
