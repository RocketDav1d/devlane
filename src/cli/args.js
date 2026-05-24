export function readFlag(args, name, defaultValue = undefined) {
  const flag = `--${name}`;
  const index = args.indexOf(flag);

  if (index === -1) return defaultValue;
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    return true;
  }

  return value;
}

export function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

export function projectPathFromArgs(args) {
  const project = readFlag(args, "project", process.cwd());
  return String(project);
}

export function positional(args) {
  const result = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) index += 1;
      continue;
    }

    result.push(arg);
  }

  return result;
}
