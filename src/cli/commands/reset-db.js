import { projectPathFromArgs } from "../args.js";
import { EnvironmentClient } from "../environment-client.js";

export async function resetDbCommand(args) {
  const client = new EnvironmentClient();
  const record = await client.resetDatabase(projectPathFromArgs(args));
  process.stdout.write(`Database reset complete for environment ${record.id}. Status: ${record.status}.\n`);
}
