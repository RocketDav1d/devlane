import { projectPathFromArgs } from "../args.js";
import { EnvironmentClient } from "../environment-client.js";
import { buildCodexAdditionalContext } from "../../integrations/codex/context.js";
import { formatCodexVerification, verifyCodexIntegration } from "../../integrations/codex/verify.js";

export async function codexSetupCommand(args) {
  const client = new EnvironmentClient();
  const record = await client.ensureEnvironment(projectPathFromArgs(args));
  process.stdout.write(`Devlane environment ${record.id} is ${record.status}.\n`);
}

export async function codexContextCommand(args) {
  const client = new EnvironmentClient();
  const record = await client.getEnvironment(projectPathFromArgs(args));

  const additionalContext = record
    ? buildCodexAdditionalContext(record)
    : "No Devlane environment is active for this worktree. Automatic provisioning should be configured through Codex Settings -> Environments using `.codex/devlane/codex-environment-snippets.md`. If the user asks you to repair Devlane in this thread, run `.codex/devlane/setup.sh` once before starting backend services manually.";

  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext
    }
  })}\n`);
}

export async function codexVerifyCommand(args) {
  const report = verifyCodexIntegration(projectPathFromArgs(args));
  process.stdout.write(`${formatCodexVerification(report)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
  }
}
