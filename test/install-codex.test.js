import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installCodexCommand } from "../src/cli/commands/install-codex.js";
import { formatCodexVerification, verifyCodexIntegration } from "../src/integrations/codex/verify.js";

test("install-codex writes hook, MCP, and skill assets", async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-codex-install-"));
  fs.writeFileSync(path.join(projectPath, "devlane.yaml"), "version: 1\napps: {}\n");
  await withMutedStdout(() => installCodexCommand(["--project", projectPath]));

  const setupPath = path.join(projectPath, ".codex/devlane/setup.sh");
  const cleanupPath = path.join(projectPath, ".codex/devlane/cleanup.sh");
  const hookPath = path.join(projectPath, ".codex/devlane/session-start-hook.sh");
  const snippetsPath = path.join(projectPath, ".codex/devlane/codex-environment-snippets.md");
  const environmentConfigPath = path.join(projectPath, ".codex/environments/environment.toml");
  const hooksJsonPath = path.join(projectPath, ".codex/hooks.json");
  const configTomlPath = path.join(projectPath, ".codex/config.toml");
  const readmePath = path.join(projectPath, ".codex/devlane/README.md");
  const skillPath = path.join(projectPath, ".agents/skills/devlane/SKILL.md");

  assert.equal(fs.existsSync(setupPath), true);
  assert.equal(fs.existsSync(cleanupPath), true);
  assert.equal(fs.existsSync(hookPath), true);
  assert.equal(fs.existsSync(snippetsPath), true);
  assert.equal(fs.existsSync(environmentConfigPath), true);
  assert.equal(fs.existsSync(skillPath), true);
  assert.match(fs.readFileSync(setupPath, "utf8"), /CODEX_WORKTREE_PATH/);
  assert.match(fs.readFileSync(hookPath, "utf8"), /CODEX_WORKTREE_PATH/);
  assert.match(fs.readFileSync(snippetsPath, "utf8"), /Codex Settings -> Environments/);
  assert.match(fs.readFileSync(environmentConfigPath, "utf8"), /CODEX_WORKTREE_PATH/);
  assert.match(fs.readFileSync(environmentConfigPath, "utf8"), /\.codex\/devlane\/setup\.sh/);
  assert.doesNotMatch(fs.readFileSync(snippetsPath, "utf8"), absoluteCodexScriptPathPattern());
  assert.doesNotMatch(fs.readFileSync(environmentConfigPath, "utf8"), absoluteCodexScriptPathPattern());
  assert.equal(fs.readFileSync(readmePath, "utf8").includes(projectPath), false);

  const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
  assert.equal(hooksJson.hooks.SessionStart[0].hooks[0].type, "command");
  assert.equal(hooksJson.hooks.SessionStart[0].hooks[0].async, false);
  assert.equal(hooksJson.hooks.SessionStart[0].hooks[0].command, "'.codex/devlane/session-start-hook.sh'");
  assert.doesNotMatch(JSON.stringify(hooksJson), absoluteCodexScriptPathPattern());

  const configToml = fs.readFileSync(configTomlPath, "utf8");
  assert.match(configToml, /\[mcp_servers\.devlane\]/);
  assert.match(configToml, /args = \[/);
  assert.match(configToml, /"mcp"/);
  assert.match(configToml, /"serve"/);
  assert.doesNotMatch(configToml, /^cwd\s*=/m);

  const report = verifyCodexIntegration(projectPath);
  assert.equal(report.ok, true);
  assert.match(formatCodexVerification(report), /Status: ready/);
  assert.match(formatCodexVerification(report), /Codex Local Environment config:/);
  assert.match(formatCodexVerification(report), /Codex Settings -> Environments snippets:/);
});

test("verifyCodexIntegration reports missing Codex assets", () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-codex-missing-"));
  const report = verifyCodexIntegration(projectPath);

  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.name === "devlane.yaml" && !check.ok));
  assert.ok(report.checks.some((check) => check.name === "Codex setup script" && !check.ok));
  assert.match(formatCodexVerification(report), /Status: needs attention/);
});

test("verifyCodexIntegration flags stale absolute Codex script paths", async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-codex-stale-paths-"));
  fs.writeFileSync(path.join(projectPath, "devlane.yaml"), "version: 1\napps: {}\n");
  await withMutedStdout(() => installCodexCommand(["--project", projectPath]));

  const staleRoot = path.join(os.tmpdir(), "stale checkout with spaces");
  const staleSetup = path.join(staleRoot, ".codex/devlane/setup.sh");
  const staleCleanup = path.join(staleRoot, ".codex/devlane/cleanup.sh");
  const staleHook = path.join(staleRoot, ".codex/devlane/session-start-hook.sh");

  fs.writeFileSync(path.join(projectPath, ".codex/environments/environment.toml"), `version = 1
name = "stale"

[setup]
script = '''
set -euo pipefail
worktree="\${CODEX_WORKTREE_PATH:-$PWD}"
"${staleSetup}" "$worktree"
'''

[cleanup]
script = '''
set -euo pipefail
worktree="\${CODEX_WORKTREE_PATH:-$PWD}"
"${staleCleanup}" "$worktree"
'''
`);

  fs.writeFileSync(path.join(projectPath, ".codex/devlane/codex-environment-snippets.md"), `# Devlane Codex Environment Snippets

Use these in Codex Settings -> Environments for this project.

\`\`\`bash
set -euo pipefail
worktree="\${CODEX_WORKTREE_PATH:-$PWD}"
"${staleSetup}" "$worktree"
\`\`\`
`);

  const hooksJsonPath = path.join(projectPath, ".codex/hooks.json");
  const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
  hooksJson.hooks.SessionStart[0].hooks[0].command = `"${staleHook}"`;
  fs.writeFileSync(hooksJsonPath, `${JSON.stringify(hooksJson, null, 2)}\n`);

  const report = verifyCodexIntegration(projectPath);
  assert.equal(report.ok, false);
  assertCheckFailed(report, "Codex Local Environment config", /absolute \.codex\/devlane script path/);
  assertCheckFailed(report, "Codex environment snippets", /absolute \.codex\/devlane script path/);
  assertCheckFailed(report, "Codex SessionStart hook", /absolute \.codex\/devlane script path/);
});

test("verifyCodexIntegration reports duplicate Codex environment files", async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-codex-duplicates-"));
  fs.writeFileSync(path.join(projectPath, "devlane.yaml"), "version: 1\napps: {}\n");
  await withMutedStdout(() => installCodexCommand(["--project", projectPath]));
  fs.writeFileSync(path.join(projectPath, ".codex/environments/environment-2.toml"), "name = \"duplicate\"\n");

  const report = verifyCodexIntegration(projectPath);
  assert.equal(report.ok, false);
  assertCheckFailed(report, "Duplicate Codex Local Environment configs", /environment-2\.toml/);
});

function assertCheckFailed(report, name, messagePattern) {
  const check = report.checks.find((candidate) => candidate.name === name);
  assert.ok(check, `expected check named ${name}`);
  assert.equal(check.ok, false);
  assert.match(check.message, messagePattern);
}

function absoluteCodexScriptPathPattern() {
  return /\/(?!\.codex\/)(?:[^"'`\n]*?)\.codex\/devlane\/(?:setup|cleanup|session-start-hook)\.sh/;
}

async function withMutedStdout(callback) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    return await callback();
  } finally {
    process.stdout.write = originalWrite;
  }
}
