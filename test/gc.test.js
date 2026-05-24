import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectGarbage, findSmolmachinesOrphanCandidates } from "../src/daemon/gc.js";
import { StateStore } from "../src/daemon/state-store.js";
import { daemonLogPath, envLogDir, envStateDir } from "../src/shared/paths.js";

test("collectGarbage removes stale environments and rotates oversized logs", () => {
  withTempHome((tempRoot) => {
    const activeWorktree = path.join(tempRoot, "active-worktree");

    fs.mkdirSync(activeWorktree, { recursive: true });
    fs.mkdirSync(envStateDir("stale"), { recursive: true });
    fs.mkdirSync(envLogDir("stale"), { recursive: true });
    fs.mkdirSync(envLogDir("active"), { recursive: true });

    const activeLogPath = path.join(envLogDir("active"), "api.log");
    fs.writeFileSync(daemonLogPath(), "daemon log that is definitely too long");
    fs.writeFileSync(activeLogPath, "application log that is definitely too long");

    const store = new StateStore();
    store.write({
      environments: {
        stale: {
          id: "stale",
          worktreePath: path.join(tempRoot, "missing-worktree"),
          runtime: { driver: "process" },
          updatedAt: "2024-01-01T00:00:00.000Z",
          apps: {},
          services: {}
        },
        active: {
          id: "active",
          worktreePath: activeWorktree,
          runtime: { driver: "process" },
          updatedAt: "2026-01-01T00:00:00.000Z",
          apps: {
            api: {
              logPath: activeLogPath
            }
          },
          services: {}
        }
      }
    });

    const result = collectGarbage({
      maxAgeMs: 1000,
      maxLogBytes: 12,
      now: "2026-01-01T00:00:00.500Z"
    });

    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].id, "stale");
    assert.equal(result.removed[0].reason, "missing-worktree");
    assert.equal(result.skipped.length, 0);
    assert.equal(fs.existsSync(envStateDir("stale")), false);
    assert.equal(fs.existsSync(envLogDir("stale")), false);
    assert.equal(store.get("stale"), null);
    assert.equal(fs.existsSync(`${daemonLogPath()}.1`), true);
    assert.equal(fs.existsSync(`${activeLogPath}.1`), true);
    assert.equal(fs.statSync(daemonLogPath()).size, 0);
    assert.equal(fs.statSync(activeLogPath).size, 0);
  });
});

test("collectGarbage dry-run reports duplicate worktree state without deleting it", () => {
  withTempHome((tempRoot) => {
    const worktreePath = path.join(tempRoot, "repo");
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(envStateDir("old"), { recursive: true });
    fs.mkdirSync(envLogDir("old"), { recursive: true });

    const store = new StateStore();
    store.write({
      environments: {
        old: {
          id: "old",
          worktreePath,
          runtime: { driver: "process" },
          status: "failed",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          apps: {},
          services: {}
        },
        current: {
          id: "current",
          worktreePath,
          runtime: { driver: "process" },
          status: "healthy",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          apps: {},
          services: {}
        }
      }
    });

    const result = collectGarbage({
      dryRun: true,
      maxAgeMs: 365 * 24 * 60 * 60 * 1000,
      now: "2026-01-03T00:00:00.000Z"
    });

    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].keep.id, "current");
    assert.deepEqual(result.duplicates[0].duplicates.map((entry) => entry.id), ["old"]);
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].id, "old");
    assert.equal(result.removed[0].reason, "duplicate-worktree");
    assert.equal(result.removed[0].keptId, "current");
    assert.equal(store.get("old").id, "old");
    assert.equal(fs.existsSync(envStateDir("old")), true);
    assert.equal(fs.existsSync(envLogDir("old")), true);
  });
});

test("collectGarbage removes safe duplicate process state records", () => {
  withTempHome((tempRoot) => {
    const worktreePath = path.join(tempRoot, "repo");
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(envStateDir("old"), { recursive: true });
    fs.mkdirSync(envLogDir("old"), { recursive: true });

    const store = new StateStore();
    store.write({
      environments: {
        old: {
          id: "old",
          worktreePath,
          runtime: { driver: "process" },
          status: "failed",
          updatedAt: "2026-01-01T00:00:00.000Z",
          apps: {},
          services: {}
        },
        current: {
          id: "current",
          worktreePath,
          runtime: { driver: "process" },
          status: "healthy",
          updatedAt: "2026-01-02T00:00:00.000Z",
          apps: {},
          services: {}
        }
      }
    });

    const result = collectGarbage({
      maxAgeMs: 365 * 24 * 60 * 60 * 1000,
      now: "2026-01-03T00:00:00.000Z"
    });

    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].id, "old");
    assert.equal(store.get("old"), null);
    assert.equal(store.get("current").id, "current");
    assert.equal(fs.existsSync(envStateDir("old")), false);
    assert.equal(fs.existsSync(envLogDir("old")), false);
  });
});

test("collectGarbage skips unsafe duplicate and external runtime state records", () => {
  withTempHome((tempRoot) => {
    const worktreePath = path.join(tempRoot, "repo");
    fs.mkdirSync(worktreePath, { recursive: true });

    const store = new StateStore();
    store.write({
      environments: {
        runningDuplicate: {
          id: "runningDuplicate",
          worktreePath,
          runtime: { driver: "process" },
          status: "healthy",
          updatedAt: "2026-01-01T00:00:00.000Z",
          apps: {
            api: {
              pid: process.pid
            }
          },
          services: {}
        },
        current: {
          id: "current",
          worktreePath,
          runtime: { driver: "process" },
          status: "healthy",
          updatedAt: "2026-01-02T00:00:00.000Z",
          apps: {},
          services: {}
        },
        external: {
          id: "external",
          worktreePath: path.join(tempRoot, "missing-external-worktree"),
          runtime: {
            driver: "smolmachines",
            runtimeId: "smolvm:devlane-external"
          },
          status: "healthy",
          updatedAt: "2026-01-01T00:00:00.000Z",
          apps: {},
          services: {}
        }
      }
    });

    const result = collectGarbage({
      maxAgeMs: 365 * 24 * 60 * 60 * 1000,
      now: "2026-01-03T00:00:00.000Z"
    });

    assert.equal(result.removed.length, 0);
    assert.deepEqual(
      result.skipped.map((entry) => [entry.id, entry.skipReason]).sort(),
      [
        ["external", "external-runtime-needs-explicit-destroy"],
        ["runningDuplicate", "running-process"]
      ]
    );
    assert.equal(store.get("runningDuplicate").id, "runningDuplicate");
    assert.equal(store.get("external").id, "external");
  });
});

test("findSmolmachinesOrphanCandidates reports only untracked Devlane VMs", () => {
  const state = {
    environments: {
      keep: {
        id: "env_keep",
        runtime: {
          driver: "smolmachines",
          runtimeId: "smolvm:devlane-env_keep"
        }
      }
    }
  };

  const candidates = findSmolmachinesOrphanCandidates(state, [
    {
      name: "devlane-env_keep",
      state: "running",
      pid: 123
    },
    {
      name: "devlane-env_orphan",
      state: "running",
      pid: 456
    },
    {
      name: "unrelated",
      state: "running",
      pid: 789
    }
  ]);

  assert.deepEqual(candidates, [
    {
      name: "devlane-env_orphan",
      state: "running",
      pid: 456,
      image: null,
      reason: "no-matching-state-record",
      action: "report-only"
    }
  ]);
});

test("collectGarbage includes report-only Smolmachines orphan candidates from explicit machine list", () => {
  withTempHome(() => {
    const store = new StateStore();
    store.write({
      environments: {
        keep: {
          id: "env_keep",
          runtime: {
            driver: "smolmachines",
            runtimeId: "smolvm:devlane-env_keep"
          }
        }
      }
    });

    const result = collectGarbage({
      dryRun: true,
      smolmachinesMachines: ["devlane-env_keep", "devlane-env_orphan"]
    });

    assert.equal(result.orphanSmolmachines.checked, true);
    assert.deepEqual(result.orphanSmolmachines.candidates.map((candidate) => candidate.name), ["devlane-env_orphan"]);
  });
});

function withTempHome(callback) {
  const previous = process.env.DEVLANE_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-gc-"));
  process.env.DEVLANE_HOME = path.join(tempRoot, "state");

  try {
    return callback(tempRoot);
  } finally {
    if (previous === undefined) {
      delete process.env.DEVLANE_HOME;
    } else {
      process.env.DEVLANE_HOME = previous;
    }
  }
}
