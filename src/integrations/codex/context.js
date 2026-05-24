export function buildCodexAdditionalContext(record) {
  const lines = [
    "Devlane environment is active for this worktree.",
    "",
    `Environment ID: ${record.id}`,
    `Status: ${record.status}`,
    "",
    "Apps:"
  ];

  if (Object.keys(record.urls.apps ?? {}).length === 0) {
    lines.push("- none");
  } else {
    for (const [name, url] of Object.entries(record.urls.apps)) {
      lines.push(`- ${name}: ${url}`);
    }
  }

  lines.push("", "Services:");

  if (Object.keys(record.urls.services ?? {}).length === 0) {
    lines.push("- none");
  } else {
    for (const [name, url] of Object.entries(record.urls.services)) {
      lines.push(`- ${name}: ${url}`);
    }
  }

  lines.push(
    "",
    "Useful commands:",
    "- devlane status",
    "- devlane logs <service>",
    "- devlane destroy",
    "",
    "Use these existing URLs and logs. Do not start duplicate databases or backend services unless explicitly asked."
  );

  return lines.join("\n");
}
