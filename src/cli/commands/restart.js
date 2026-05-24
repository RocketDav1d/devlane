import { positional, projectPathFromArgs } from "../args.js";
import { EnvironmentClient } from "../environment-client.js";

export async function restartCommand(args) {
  const client = new EnvironmentClient();
  const name = positional(args)[0];
  const record = await client.restart(projectPathFromArgs(args), name);
  process.stdout.write(`Restart complete for environment ${record.id}. Status: ${record.status}.\n`);
}
