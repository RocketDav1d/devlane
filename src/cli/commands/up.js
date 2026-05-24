import { projectPathFromArgs } from "../args.js";
import { EnvironmentClient } from "../environment-client.js";

export async function upCommand(args) {
  const client = new EnvironmentClient();
  const record = await client.ensureEnvironment(projectPathFromArgs(args));
  process.stdout.write(formatEnvironment(record));
}

function formatEnvironment(record) {
  const lines = [`Environment ${record.id} ${record.status}`, ""];

  for (const [name, app] of Object.entries(record.apps)) {
    const url = record.urls.apps?.[name] ? ` ${record.urls.apps[name]}` : "";
    lines.push(`- app ${name}: ${app.status}${url}`);
  }

  for (const [name, service] of Object.entries(record.services)) {
    const url = record.urls.services?.[name] ? ` ${record.urls.services[name]}` : "";
    lines.push(`- service ${name}: ${service.status}${url}`);
  }

  return `${lines.join("\n")}\n`;
}
