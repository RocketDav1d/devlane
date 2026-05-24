import path from "node:path";
import { ensureDir, readJson, writeJson } from "../shared/fs.js";
import { stateFilePath } from "../shared/paths.js";

export class StateStore {
  constructor(filePath = stateFilePath()) {
    this.filePath = filePath;
  }

  read() {
    ensureDir(path.dirname(this.filePath));
    return readJson(this.filePath, { environments: {} });
  }

  write(state) {
    ensureDir(path.dirname(this.filePath));
    writeJson(this.filePath, state);
  }

  get(id) {
    return this.read().environments[id] ?? null;
  }

  findByWorktree(worktreePath) {
    const state = this.read();
    const normalized = normalizeWorktreePath(worktreePath);
    return Object.values(state.environments)
      .filter((record) => record.worktreePath)
      .filter((record) => normalizeWorktreePath(record.worktreePath) === normalized)
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0] ?? null;
  }

  findDuplicateWorktrees() {
    return duplicateWorktreeGroups(this.read());
  }

  save(record) {
    const state = this.read();
    state.environments[record.id] = {
      ...record,
      updatedAt: new Date().toISOString()
    };
    this.write(state);
    return state.environments[record.id];
  }

  delete(id) {
    const state = this.read();
    const record = state.environments[id] ?? null;
    delete state.environments[id];
    this.write(state);
    return record;
  }
}

export function duplicateWorktreeGroups(state) {
  const byWorktree = new Map();

  for (const [stateKey, record] of Object.entries(state.environments ?? {})) {
    if (!record.worktreePath) continue;

    const worktreePath = normalizeWorktreePath(record.worktreePath);
    const records = byWorktree.get(worktreePath) ?? [];
    records.push({
      id: record.id ?? stateKey,
      stateKey,
      record
    });
    byWorktree.set(worktreePath, records);
  }

  return [...byWorktree.entries()]
    .map(([worktreePath, records]) => {
      const sorted = records.sort(compareStateEntries);
      return {
        worktreePath,
        keep: sorted[0],
        duplicates: sorted.slice(1),
        records: sorted
      };
    })
    .filter((group) => group.records.length > 1);
}

export function normalizeWorktreePath(worktreePath) {
  return path.resolve(String(worktreePath));
}

function compareStateEntries(left, right) {
  const updatedDelta = timestamp(right.record.updatedAt) - timestamp(left.record.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;

  const createdDelta = timestamp(right.record.createdAt) - timestamp(left.record.createdAt);
  if (createdDelta !== 0) return createdDelta;

  return String(right.stateKey).localeCompare(String(left.stateKey));
}

function timestamp(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}
