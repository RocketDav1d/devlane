export class DevlaneError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DevlaneError";
    this.code = options.code ?? "DEVLANE_ERROR";
    this.component = options.component;
    this.operation = options.operation;
    this.details = options.details ?? {};
    this.suggestions = options.suggestions ?? [];
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      component: this.component,
      operation: this.operation,
      details: this.details,
      suggestions: this.suggestions
    };
  }
}

export function formatDevlaneError(error) {
  if (!(error instanceof DevlaneError) && error?.name !== "DevlaneError") {
    return null;
  }

  const lines = [
    error.message,
    "",
    `Code: ${error.code}`
  ];

  if (error.component) lines.push(`Component: ${error.component}`);
  if (error.operation) lines.push(`Operation: ${error.operation}`);

  const details = error.details ?? {};
  const detailLines = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `- ${humanize(key)}: ${formatValue(value)}`);

  if (detailLines.length > 0) {
    lines.push("", "Details:", ...detailLines);
  }

  if (error.suggestions?.length > 0) {
    lines.push("", "Suggested next steps:");
    for (const suggestion of error.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines.join("\n");
}

function humanize(key) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function formatValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
