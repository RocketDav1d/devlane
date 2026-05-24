import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("packed npm artifact contains and runs the Devlane CLI", () => {
  const repoRoot = path.resolve(".");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-package-"));
  const npmCache = path.join(tempRoot, "npm-cache");
  const packJson = execFileSync("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: npmCache
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const [packResult] = JSON.parse(packJson);
  const tarballPath = path.join(tempRoot, packResult.filename);
  const tarballEntries = execFileSync("tar", ["-tf", tarballPath], {
    encoding: "utf8"
  }).split("\n");

  assert.ok(tarballEntries.includes("package/package.json"));
  assert.ok(tarballEntries.includes("package/src/cli/index.js"));
  assert.ok(tarballEntries.includes("package/src/cli/commands/install-codex.js"));
  assert.ok(tarballEntries.includes("package/plugin/.codex-plugin/plugin.json"));
  assert.ok(tarballEntries.includes("package/examples/codex-node-postgres/devlane.yaml"));
  assert.equal(tarballEntries.some((entry) => entry.startsWith("package/test/")), false);
  assert.equal(tarballEntries.some((entry) => entry.includes("devlane-codex-smol-test")), false);

  execFileSync("tar", ["-xzf", tarballPath, "-C", tempRoot], { stdio: "ignore" });

  const packageRoot = path.join(tempRoot, "package");
  const nodeModulesPath = path.join(repoRoot, "node_modules");
  assert.equal(fs.existsSync(nodeModulesPath), true, "run npm install before package smoke tests");
  fs.symlinkSync(nodeModulesPath, path.join(packageRoot, "node_modules"), "dir");

  const cliPath = path.join(packageRoot, "src", "cli", "index.js");
  assert.notEqual(fs.statSync(cliPath).mode & 0o111, 0, "package CLI entrypoint must be executable");

  const help = execFileSync(process.execPath, [cliPath, "--help"], {
    cwd: packageRoot,
    encoding: "utf8"
  });
  assert.match(help, /devlane install-codex/);

  const shebangHelp = execFileSync(cliPath, ["--help"], {
    cwd: packageRoot,
    encoding: "utf8"
  });
  assert.match(shebangHelp, /devlane install-codex/);

  const projectPath = path.join(tempRoot, "consumer-repo");
  fs.mkdirSync(projectPath);
  fs.writeFileSync(path.join(projectPath, "devlane.yaml"), "version: 1\napps: {}\n");

  execFileSync(process.execPath, [cliPath, "install-codex", "--project", projectPath], {
    cwd: packageRoot,
    encoding: "utf8"
  });

  const setupScript = fs.readFileSync(path.join(projectPath, ".codex", "devlane", "setup.sh"), "utf8");
  const configToml = fs.readFileSync(path.join(projectPath, ".codex", "config.toml"), "utf8");

  assert.match(setupScript, /^devlane codex setup --project "\$worktree"$/m);
  assert.match(configToml, /^command = "devlane"$/m);
  assert.match(configToml, /args = \["mcp", "serve"\]/);
  assert.doesNotMatch(setupScript, /src\/cli\/index\.js/);
  assert.doesNotMatch(configToml, /src\/cli\/index\.js/);
});
