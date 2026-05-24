import crypto from "node:crypto";

export function environmentId(input) {
  const hash = crypto
    .createHash("sha256")
    .update(`${input.repoRoot}\n${input.worktreePath}\n${input.branch}`)
    .digest("hex")
    .slice(0, 12);

  return `env_${hash}`;
}
