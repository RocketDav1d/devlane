#!/usr/bin/env node
import { initCommand } from "./commands/init.js";
import { upCommand } from "./commands/up.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import { restartCommand } from "./commands/restart.js";
import { destroyCommand } from "./commands/destroy.js";
import { resetDbCommand } from "./commands/reset-db.js";
import { doctorCommand } from "./commands/doctor.js";
import { installCodexCommand } from "./commands/install-codex.js";
import { codexSetupCommand, codexContextCommand, codexVerifyCommand } from "./commands/codex.js";
import { daemonCommand } from "./commands/daemon.js";
import { serveMcp } from "../integrations/mcp/server.js";
import { formatDevlaneError } from "../shared/devlane-error.js";

const USAGE = `devlane

Usage:
  devlane init [--detect]
  devlane up [--project <path>]
  devlane status [--project <path>]
  devlane logs [service] [--project <path>] [--tail <lines>] [--follow]
  devlane restart [service] [--project <path>]
  devlane reset-db [--project <path>]
  devlane destroy [--project <path>]
  devlane doctor [--project <path>]
  devlane daemon start|start --background|status|ping|stop|install|uninstall|gc
  devlane install-codex [--project <path>]
  devlane codex setup --project <path>
  devlane codex context --project <path>
  devlane codex verify --project <path>
  devlane mcp serve
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "-h" || command === "--help") {
    process.stdout.write(USAGE);
    return;
  }

  if (command === "init") return initCommand(args.slice(1));
  if (command === "up") return upCommand(args.slice(1));
  if (command === "status") return statusCommand(args.slice(1));
  if (command === "logs") return logsCommand(args.slice(1));
  if (command === "restart") return restartCommand(args.slice(1));
  if (command === "reset-db") return resetDbCommand(args.slice(1));
  if (command === "destroy") return destroyCommand(args.slice(1));
  if (command === "doctor") return doctorCommand(args.slice(1));
  if (command === "daemon") return daemonCommand(args.slice(1));
  if (command === "install-codex") return installCodexCommand(args.slice(1));

  if (command === "codex") {
    const subcommand = args[1];
    if (subcommand === "setup") return codexSetupCommand(args.slice(2));
    if (subcommand === "context") return codexContextCommand(args.slice(2));
    if (subcommand === "verify") return codexVerifyCommand(args.slice(2));
  }

  if (command === "mcp" && args[1] === "serve") {
    return serveMcp();
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});

function formatError(error) {
  const formatted = formatDevlaneError(error);
  if (formatted) return formatted;

  if (error && typeof error === "object" && "message" in error) {
    return error.message;
  }

  return String(error);
}
