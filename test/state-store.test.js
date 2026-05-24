import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { duplicateWorktreeGroups, StateStore } from "../src/daemon/state-store.js";

test("StateStore findByWorktree returns the latest record for duplicate worktree entries", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-state-store-"));
  const statePath = path.join(tempRoot, "state.json");
  const worktreePath = path.join(tempRoot, "repo");
  const store = new StateStore(statePath);

  store.write({
    environments: {
      old: {
        id: "old",
        worktreePath,
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      current: {
        id: "current",
        worktreePath,
        updatedAt: "2026-01-02T00:00:00.000Z"
      }
    }
  });

  assert.equal(store.findByWorktree(worktreePath).id, "current");
  assert.equal(store.findByWorktree(`${worktreePath}/`).id, "current");
});

test("StateStore writes custom paths without touching DEVLANE_HOME", () => {
  const previous = process.env.DEVLANE_HOME;
  delete process.env.DEVLANE_HOME;

  try {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-state-store-"));
    const statePath = path.join(tempRoot, "nested", "state.json");
    const store = new StateStore(statePath);

    store.write({ environments: {} });

    assert.equal(fs.existsSync(statePath), true);
  } finally {
    if (previous === undefined) {
      delete process.env.DEVLANE_HOME;
    } else {
      process.env.DEVLANE_HOME = previous;
    }
  }
});

test("duplicateWorktreeGroups reports duplicate worktree records with deterministic keeper", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devlane-state-store-"));
  const worktreePath = path.join(tempRoot, "repo");
  const state = {
    environments: {
      old: {
        id: "old",
        worktreePath,
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      current: {
        id: "current",
        worktreePath: `${worktreePath}/`,
        updatedAt: "2026-01-02T00:00:00.000Z"
      },
      unrelated: {
        id: "unrelated",
        worktreePath: path.join(tempRoot, "other"),
        updatedAt: "2026-01-03T00:00:00.000Z"
      }
    }
  };

  const groups = duplicateWorktreeGroups(state);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].worktreePath, worktreePath);
  assert.equal(groups[0].keep.id, "current");
  assert.deepEqual(groups[0].duplicates.map((entry) => entry.id), ["old"]);
});
