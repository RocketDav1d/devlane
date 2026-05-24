import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { hasFlag, projectPathFromArgs } from "../args.js";
import { loadConfig } from "../../config/loader.js";
import { stateRoot } from "../../shared/paths.js";
import { formatCodexVerification, verifyCodexIntegration } from "../../integrations/codex/verify.js";
import { resolveSmolvmBinary } from "../../drivers/smolmachines-driver.js";

export async function doctorCommand(args) {
  const projectPath = projectPathFromArgs(args);
  const lines = ["Devlane doctor", ""];

  lines.push(`Node: ${process.version}`);
  lines.push(`State directory: ${stateRoot()}`);
  fs.mkdirSync(stateRoot(), { recursive: true });
  lines.push(`State writable: ${canWrite(stateRoot()) ? "yes" : "no"}`);

  try {
    const loaded = loadConfig(projectPath);
    lines.push(`Config: ${loaded.configPath}`);
    lines.push(`Runtime driver: ${loaded.config.runtime.driver}`);
    if (loaded.config.runtime.driver === "smolmachines") {
      const binary = resolveSmolvmBinary(loaded.config.runtime);
      const result = spawnSync(binary, ["--version"], {
        encoding: "utf8"
      });
      lines.push(`smolvm binary: ${binary}`);
      lines.push(
        `smolvm CLI: ${
          result.status === 0
            ? `ok (${(result.stdout || result.stderr).trim()})`
            : `missing or failed (${result.error?.message ?? result.stderr?.trim() ?? "unknown error"})`
        }`
      );
    }
  } catch (error) {
    lines.push(`Config: ${error.message}`);
  }

  if (hasFlag(args, "codex")) {
    lines.push("", formatCodexVerification(verifyCodexIntegration(projectPath)));
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function canWrite(directory) {
  try {
    const probe = `${directory}/.write-test-${process.pid}`;
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
