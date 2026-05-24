import { projectPathFromArgs } from "../args.js";
import { EnvironmentClient } from "../environment-client.js";

export async function statusCommand(args) {
  const client = new EnvironmentClient();
  const record = await client.refreshEnvironment(projectPathFromArgs(args));

  if (!record) {
    process.stdout.write("No Devlane environment exists for this worktree.\n");
    return;
  }

  process.stdout.write(formatStatus(record));
}

export function formatStatus(record) {
  const lines = [
    `Environment ${record.id}`,
    `Status: ${record.status}`,
    `Worktree: ${record.worktreePath}`,
    `Runtime: ${record.runtime.driver}${record.runtime.runtimeId ? ` (${record.runtime.runtimeId})` : ""}`,
    ""
  ];

  if (Object.keys(record.apps).length > 0) {
    lines.push("Apps:");
    for (const [name, app] of Object.entries(record.apps)) {
      const url = record.urls.apps?.[name] ? ` ${record.urls.apps[name]}` : "";
      lines.push(`- ${name}: ${app.status}${url}`);
    }
    lines.push("");
  }

  if (Object.keys(record.services).length > 0) {
    lines.push("Services:");
    for (const [name, service] of Object.entries(record.services)) {
      const url = record.urls.services?.[name] ? ` ${record.urls.services[name]}` : "";
      lines.push(`- ${name}: ${service.status}${url}`);
    }
    lines.push("");
  }

  lines.push("Context files:");
  for (const file of record.contextFiles) {
    lines.push(`- ${file}`);
  }

  return `${lines.join("\n")}\n`;
}
