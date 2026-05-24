import fs from "node:fs";
import { hasFlag, positional, projectPathFromArgs, readFlag } from "../args.js";
import { EnvironmentClient } from "../environment-client.js";

export async function logsCommand(args) {
  const client = new EnvironmentClient();
  const record = await client.getEnvironment(projectPathFromArgs(args));

  if (!record) {
    throw new Error("No Devlane environment exists for this worktree.");
  }

  const service = positional(args)[0];
  const tail = Number(readFlag(args, "tail", 200));
  const follow = hasFlag(args, "follow");
  const logPaths = service ? [logPathFor(record, service)] : allLogPaths(record);

  for (const logPath of logPaths) {
    if (!fs.existsSync(logPath)) {
      process.stdout.write(`No log file at ${logPath}\n`);
      continue;
    }

    process.stdout.write(`==> ${logPath} <==\n`);
    process.stdout.write(`${tailFile(logPath, tail)}\n`);
  }

  if (follow) {
    await followFiles(logPaths);
  }
}

function logPathFor(record, name) {
  const entry = record.apps[name] ?? record.services[name];
  if (!entry) {
    throw new Error(`No app or service named "${name}" in environment ${record.id}`);
  }

  return entry.logPath;
}

function allLogPaths(record) {
  return [
    ...Object.values(record.services).map((service) => service.logPath),
    ...Object.values(record.apps).map((app) => app.logPath)
  ];
}

function tailFile(filePath, lines) {
  const text = fs.readFileSync(filePath, "utf8");
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

function followFiles(filePaths) {
  return new Promise((resolve) => {
    const offsets = new Map(
      filePaths.map((filePath) => [
        filePath,
        fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
      ])
    );

    const interval = setInterval(() => {
      for (const filePath of filePaths) {
        if (!fs.existsSync(filePath)) continue;
        const size = fs.statSync(filePath).size;
        const offset = offsets.get(filePath) ?? 0;
        if (size <= offset) continue;

        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(size - offset);
        fs.readSync(fd, buffer, 0, buffer.length, offset);
        fs.closeSync(fd);
        offsets.set(filePath, size);
        process.stdout.write(buffer.toString());
      }
    }, 250);

    const stop = () => {
      clearInterval(interval);
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
