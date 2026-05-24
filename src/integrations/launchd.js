import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { daemonLogPath, stateRoot } from "../shared/paths.js";
import { ensureDir } from "../shared/fs.js";

const LABEL = "com.devlane.daemon";

export function launchAgentPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function installLaunchAgent(options = {}) {
  const plistPath = options.plistPath ?? launchAgentPath();
  const shouldLoad = options.load ?? true;
  ensureDir(path.dirname(plistPath));
  ensureDir(stateRoot());
  fs.writeFileSync(plistPath, buildLaunchAgentPlist(options));

  const result = {
    plistPath,
    loaded: false,
    label: LABEL
  };

  if (shouldLoad) {
    result.loaded = runLaunchctl(["bootstrap", guiTarget(), plistPath]);
    runLaunchctl(["kickstart", "-k", `${guiTarget()}/${LABEL}`]);
  }

  return result;
}

export function uninstallLaunchAgent(options = {}) {
  const plistPath = options.plistPath ?? launchAgentPath();
  const shouldUnload = options.unload ?? true;
  const result = {
    plistPath,
    unloaded: false,
    removed: false,
    label: LABEL
  };

  if (shouldUnload && fs.existsSync(plistPath)) {
    result.unloaded = runLaunchctl(["bootout", guiTarget(), plistPath], { allowFailure: true });
  }

  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
    result.removed = true;
  }

  return result;
}

export function buildLaunchAgentPlist(options = {}) {
  const nodePath = options.nodePath ?? process.execPath;
  const cliPath = options.cliPath ?? process.argv[1];
  const devlaneHome = options.devlaneHome ?? stateRoot();
  const logPath = options.logPath ?? daemonLogPath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(cliPath)}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DEVLANE_HOME</key>
    <string>${escapeXml(devlaneHome)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

function runLaunchctl(args, options = {}) {
  if (process.platform !== "darwin") {
    return false;
  }

  const result = spawnSync("launchctl", args, {
    encoding: "utf8"
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`launchctl ${args.join(" ")} failed: ${result.stderr || result.stdout}`.trim());
  }

  return result.status === 0;
}

function guiTarget() {
  return `gui/${process.getuid()}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
