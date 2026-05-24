export function interpolate(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
      const replacement = variables[key.trim()];
      return replacement === undefined ? "" : String(replacement);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, variables));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, interpolate(entry, variables)])
    );
  }

  return value;
}
