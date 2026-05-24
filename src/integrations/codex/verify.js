import fs from "node:fs";
import path from "node:path";

export function verifyCodexIntegration(projectPath) {
  const root = path.resolve(projectPath);
  const paths = codexPaths(root);
  const checks = [
    checkFile("devlane.yaml", paths.devlaneConfig, {
      fix: "Run devlane init or create devlane.yaml."
    }),
    checkExecutable("Codex setup script", paths.setupScript, {
      contains: ["codex setup", "CODEX_WORKTREE_PATH"],
      fix: "Run devlane install-codex."
    }),
    checkExecutable("Codex cleanup script", paths.cleanupScript, {
      contains: ["destroy", "CODEX_WORKTREE_PATH"],
      fix: "Run devlane install-codex."
    }),
    checkExecutable("SessionStart hook script", paths.sessionStartHook, {
      contains: ["codex context", "CODEX_WORKTREE_PATH"],
      fix: "Run devlane install-codex."
    }),
    checkFile("Codex environment snippets", paths.environmentSnippets, {
      contains: ["Codex Settings -> Environments", "CODEX_WORKTREE_PATH"],
      rejectAbsoluteCodexScriptPaths: true,
      fix: "Run devlane install-codex."
    }),
    checkFile("Codex Local Environment config", paths.environmentConfig, {
      contains: [
        "version = 1",
        "[setup]",
        "[cleanup]",
        "CODEX_WORKTREE_PATH",
        ".codex/devlane/setup.sh",
        ".codex/devlane/cleanup.sh"
      ],
      rejectAbsoluteCodexScriptPaths: true,
      fix: "Run devlane install-codex."
    }),
    checkDuplicateEnvironmentConfigs(paths.environmentsDir),
    checkHooksJson(paths.hooksJson),
    checkConfigToml(paths.configToml),
    checkFile("Devlane skill", paths.skill, {
      contains: "name: devlane",
      fix: "Run devlane install-codex."
    })
  ];

  return {
    ok: checks.every((check) => check.ok),
    projectPath: root,
    setupScriptPath: paths.setupScript,
    environmentConfigPath: paths.environmentConfig,
    environmentSnippetsPath: paths.environmentSnippets,
    checks
  };
}

export function formatCodexVerification(report) {
  const lines = [
    "Codex integration",
    `Project: ${report.projectPath}`,
    `Status: ${report.ok ? "ready" : "needs attention"}`,
    ""
  ];

  for (const check of report.checks) {
    lines.push(`${check.ok ? "ok" : "missing"} - ${check.name}: ${check.message}`);
    if (!check.ok && check.fix) {
      lines.push(`  fix: ${check.fix}`);
    }
  }

  lines.push(
    "",
    "Codex Local Environment setup script:",
    report.setupScriptPath,
    "",
    "Codex Local Environment config:",
    report.environmentConfigPath,
    "",
    "Codex Settings -> Environments snippets:",
    report.environmentSnippetsPath
  );

  return lines.join("\n");
}

function codexPaths(root) {
  return {
    devlaneConfig: path.join(root, "devlane.yaml"),
    setupScript: path.join(root, ".codex", "devlane", "setup.sh"),
    cleanupScript: path.join(root, ".codex", "devlane", "cleanup.sh"),
    sessionStartHook: path.join(root, ".codex", "devlane", "session-start-hook.sh"),
    environmentSnippets: path.join(root, ".codex", "devlane", "codex-environment-snippets.md"),
    environmentsDir: path.join(root, ".codex", "environments"),
    environmentConfig: path.join(root, ".codex", "environments", "environment.toml"),
    hooksJson: path.join(root, ".codex", "hooks.json"),
    configToml: path.join(root, ".codex", "config.toml"),
    skill: path.join(root, ".agents", "skills", "devlane", "SKILL.md")
  };
}

function checkFile(name, filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return {
      name,
      ok: false,
      path: filePath,
      message: `missing ${filePath}`,
      fix: options.fix
    };
  }

  if (options.contains || options.rejectAbsoluteCodexScriptPaths) {
    const text = fs.readFileSync(filePath, "utf8");

    if (options.rejectAbsoluteCodexScriptPaths) {
      const stalePaths = findAbsoluteCodexScriptPaths(text);
      if (stalePaths.length > 0) {
        return {
          name,
          ok: false,
          path: filePath,
          message: `contains absolute .codex/devlane script path(s): ${stalePaths.join(", ")}`,
          fix: options.fix
        };
      }
    }

    if (!options.contains) {
      return {
        name,
        ok: true,
        path: filePath,
        message: filePath
      };
    }

    const required = Array.isArray(options.contains) ? options.contains : [options.contains];
    const missing = required.filter((value) => !text.includes(value));
    if (missing.length > 0) {
      return {
        name,
        ok: false,
        path: filePath,
        message: `does not contain ${missing.map((value) => JSON.stringify(value)).join(", ")}`,
        fix: options.fix
      };
    }
  }

  return {
    name,
    ok: true,
    path: filePath,
    message: filePath
  };
}

function checkExecutable(name, filePath, options = {}) {
  const file = checkFile(name, filePath, options);
  if (!file.ok) return file;

  const mode = fs.statSync(filePath).mode;
  if ((mode & 0o111) === 0) {
    return {
      name,
      ok: false,
      path: filePath,
      message: "file exists but is not executable",
      fix: `Run chmod +x ${filePath}`
    };
  }

  return file;
}

function checkDuplicateEnvironmentConfigs(environmentsDir) {
  const name = "Duplicate Codex Local Environment configs";
  if (!fs.existsSync(environmentsDir)) {
    return {
      name,
      ok: true,
      path: environmentsDir,
      message: "no environment directory"
    };
  }

  const duplicates = fs.readdirSync(environmentsDir)
    .filter((entry) => /^environment-.+\.toml$/.test(entry))
    .sort();

  if (duplicates.length > 0) {
    return {
      name,
      ok: false,
      path: environmentsDir,
      message: `found duplicate environment config file(s): ${duplicates.join(", ")}`,
      fix: "Remove duplicate .codex/environments/environment-*.toml files and keep only environment.toml."
    };
  }

  return {
    name,
    ok: true,
    path: environmentsDir,
    message: "only canonical environment.toml present"
  };
}

function checkHooksJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      name: "Codex hooks.json",
      ok: false,
      path: filePath,
      message: `missing ${filePath}`,
      fix: "Run devlane install-codex."
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      name: "Codex hooks.json",
      ok: false,
      path: filePath,
      message: `invalid JSON: ${error.message}`,
      fix: "Run devlane install-codex to regenerate the Devlane hook block."
    };
  }

  const hook = findSessionStartHook(parsed.hooks?.SessionStart);
  if (!hook) {
    return {
      name: "Codex SessionStart hook",
      ok: false,
      path: filePath,
      message: "SessionStart does not reference Devlane hook script",
      fix: "Run devlane install-codex."
    };
  }

  const stalePaths = findAbsoluteCodexScriptPaths(String(hook.command ?? ""));
  if (stalePaths.length > 0) {
    return {
      name: "Codex SessionStart hook",
      ok: false,
      path: filePath,
      message: `contains absolute .codex/devlane script path(s): ${stalePaths.join(", ")}`,
      fix: "Run devlane install-codex."
    };
  }

  if (hook.type !== "command" || hook.async !== false) {
    return {
      name: "Codex SessionStart hook",
      ok: false,
      path: filePath,
      message: "SessionStart Devlane hook must be a synchronous command hook",
      fix: "Run devlane install-codex."
    };
  }

  return {
    name: "Codex SessionStart hook",
    ok: true,
    path: filePath,
    message: filePath
  };
}

function findSessionStartHook(sessionStartHooks) {
  for (const entry of sessionStartHooks ?? []) {
    for (const hook of entry.hooks ?? []) {
      if (String(hook.command ?? "").includes(".codex/devlane/session-start-hook.sh")) {
        return hook;
      }
    }
  }

  return null;
}

function findAbsoluteCodexScriptPaths(text) {
  const matches = new Set();
  const pattern = /\/(?!\.codex\/)(?:[^"'`\n]*?)\.codex\/devlane\/(?:setup|cleanup|session-start-hook)\.sh/g;
  for (const match of text.matchAll(pattern)) {
    matches.add(match[0].trim());
  }

  return [...matches];
}

function checkConfigToml(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      name: "Codex MCP config",
      ok: false,
      path: filePath,
      message: `missing ${filePath}`,
      fix: "Run devlane install-codex."
    };
  }

  const text = fs.readFileSync(filePath, "utf8");
  const devlaneBlock = extractDevlaneConfigBlock(text);
  const hasMcpBlock = text.includes("[mcp_servers.devlane]");
  const hasMcpServe = text.includes('"mcp"') && text.includes('"serve"');
  const hasHardcodedCwd = /^\s*cwd\s*=/m.test(devlaneBlock);

  if (!hasMcpBlock || !hasMcpServe || hasHardcodedCwd) {
    return {
      name: "Codex MCP config",
      ok: false,
      path: filePath,
      message: hasHardcodedCwd ? "must not hardcode a cwd" : "missing mcp_servers.devlane command/args",
      fix: "Run devlane install-codex."
    };
  }

  return {
    name: "Codex MCP config",
    ok: true,
    path: filePath,
    message: filePath
  };
}

function extractDevlaneConfigBlock(text) {
  const markerStart = "# >>> devlane";
  const markerEnd = "# <<< devlane";
  const start = text.indexOf(markerStart);
  const end = text.indexOf(markerEnd);
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end);
  }

  return text;
}
