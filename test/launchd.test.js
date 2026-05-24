import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLaunchAgentPlist, installLaunchAgent, uninstallLaunchAgent } from "../src/integrations/launchd.js";

test("buildLaunchAgentPlist renders a launchd daemon for Devlane", () => {
  const plist = buildLaunchAgentPlist({
    nodePath: "/usr/local/bin/node",
    cliPath: "/usr/local/bin/devlane",
    devlaneHome: "/tmp/devlane-home",
    logPath: "/tmp/devlane-home/daemon.log"
  });

  assert.match(plist, /<string>com\.devlane\.daemon<\/string>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/devlane<\/string>/);
  assert.match(plist, /<string>daemon<\/string>/);
  assert.match(plist, /<string>start<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>/);
  assert.match(plist, /<key>DEVLANE_HOME<\/key>/);
});

test("installLaunchAgent can write and remove a plist without loading it", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-launchd-"));
  const statePath = path.join(tempRoot, "state");
  const plistPath = path.join(tempRoot, "com.devlane.daemon.plist");
  process.env.DEVLANE_HOME = statePath;

  const installed = installLaunchAgent({
    plistPath,
    nodePath: "/usr/local/bin/node",
    cliPath: "/usr/local/bin/devlane",
    load: false
  });

  assert.equal(installed.plistPath, plistPath);
  assert.equal(installed.loaded, false);
  assert.equal(fs.existsSync(plistPath), true);

  const uninstalled = uninstallLaunchAgent({ plistPath, unload: false });
  assert.equal(uninstalled.removed, true);
  assert.equal(fs.existsSync(plistPath), false);
});
