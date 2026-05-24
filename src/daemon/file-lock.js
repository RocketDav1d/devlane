import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { lockDir } from "../shared/paths.js";
import { ensureDir } from "../shared/fs.js";
import { isPidRunning } from "../shared/processes.js";
import { DevlaneError } from "../shared/devlane-error.js";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_STALE_MS = 10 * 60 * 1000;

export async function withFileLock(key, metadata, callback, options = {}) {
  const release = await acquireFileLock(key, metadata, options);

  try {
    return await callback();
  } finally {
    release();
  }
}

export async function acquireFileLock(key, metadata = {}, options = {}) {
  ensureDir(lockDir());

  const timeoutMs = Number(options.timeoutMs ?? process.env.DEVLANE_LOCK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const staleMs = Number(options.staleMs ?? process.env.DEVLANE_LOCK_STALE_MS ?? DEFAULT_STALE_MS);
  const filePath = lockPathFor(key);
  const deadline = Date.now() + timeoutMs;
  const payload = {
    key,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    metadata
  };

  while (Date.now() <= deadline) {
    try {
      const fd = fs.openSync(filePath, "wx");
      fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
      fs.closeSync(fd);

      return () => releaseFileLock(filePath, payload);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = readLock(filePath);

      if (isStale(existing, staleMs)) {
        try {
          fs.unlinkSync(filePath);
          continue;
        } catch {
          // Another process may have released or replaced it.
        }
      }

      await sleep(100);
    }
  }

  const existing = readLock(filePath);
  throw new DevlaneError("Timed out waiting for Devlane lifecycle lock.", {
    code: "DEVLANE_LOCK_TIMEOUT",
    component: "lifecycle-lock",
    operation: metadata.operation,
    details: {
      lockPath: filePath,
      requestedBy: payload,
      heldBy: existing
    },
    suggestions: [
      "Run devlane doctor to inspect daemon and state health.",
      `If the lock owner is gone, remove stale lock file: ${filePath}`,
      "Prefer routing lifecycle commands through the Devlane daemon."
    ]
  });
}

function releaseFileLock(filePath, payload) {
  const existing = readLock(filePath);
  if (existing?.pid !== payload.pid || existing?.createdAt !== payload.createdAt) return;

  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best effort release.
  }
}

function lockPathFor(key) {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(lockDir(), `${hash}.lock`);
}

function readLock(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isStale(lock, staleMs) {
  if (!lock) return true;
  if (!lock.pid || !isPidRunning(lock.pid)) return true;

  const createdAt = Date.parse(lock.createdAt);
  if (Number.isNaN(createdAt)) return true;

  return Date.now() - createdAt > staleMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
