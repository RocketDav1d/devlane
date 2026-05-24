import { projectPathFromArgs } from "../args.js";
import { EnvironmentClient } from "../environment-client.js";

export async function destroyCommand(args) {
  const client = new EnvironmentClient();
  const destroyed = await client.destroyEnvironment(projectPathFromArgs(args));

  if (!destroyed) {
    process.stdout.write("No Devlane environment exists for this worktree.\n");
    return;
  }

  process.stdout.write(`Destroyed environment ${destroyed.id}\n`);
}
