import fs from "node:fs";
import { duplicateWorktreeGroups, StateStore } from "./state-store.js";
import { daemonLogPath, envLogDir, envStateDir } from "../shared/paths.js";
import { isPidRunning } from "../shared/processes.js";

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;

export function collectGarbage(options = {}) {
  const store = options.store ?? new StateStore();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxLogBytes = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const dryRun = options.dryRun ?? false;
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();

  const state = store.read();
  const removed = [];
  const skipped = [];
  const removalIds = new Set();
  const skippedIds = new Set();
  const duplicates = buildDuplicateReport(state);

  for (const group of duplicates) {
    for (const duplicate of group.duplicates) {
      const removal = {
        id: duplicate.id,
        worktreePath: group.worktreePath,
        reason: "duplicate-worktree",
        keptId: group.keep.id
      };
      queueRemoval({ state, removal, removed, skipped, removalIds, skippedIds });
    }
  }

  for (const [id, record] of Object.entries(state.environments)) {
    const staleReason = staleReasonFor(record, nowMs, maxAgeMs);
    if (!staleReason) continue;

    const removal = {
      id,
      worktreePath: record.worktreePath,
      reason: staleReason
    };

    queueRemoval({ state, removal, removed, skipped, removalIds, skippedIds });
  }

  for (const removal of removed) {
    if (dryRun) continue;
    delete state.environments[removal.id];
    removeDirectory(envStateDir(removal.id));
    removeDirectory(envLogDir(removal.id));
  }

  if (!dryRun) {
    store.write(state);
  }

  const rotated = rotateLogsForState(state, maxLogBytes, dryRun);
  const orphanSmolmachines = buildSmolmachinesOrphanReport(state, options.smolmachinesMachines);

  return {
    dryRun,
    duplicates,
    removed,
    skipped,
    orphanSmolmachines,
    rotated
  };
}

function staleReasonFor(record, nowMs, maxAgeMs) {
  if (record.worktreePath && !fs.existsSync(record.worktreePath)) {
    return "missing-worktree";
  }

  const updatedAtMs = record.updatedAt ? new Date(record.updatedAt).getTime() : 0;
  if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs < maxAgeMs) {
    return null;
  }

  if (recordHasRunningProcesses(record)) {
    return null;
  }

  return "old-inactive-environment";
}

function buildDuplicateReport(state) {
  return duplicateWorktreeGroups(state).map((group) => ({
    worktreePath: group.worktreePath,
    keep: summarizeRecord(group.keep.stateKey, group.keep.record),
    duplicates: group.duplicates.map((entry) => summarizeRecord(entry.stateKey, entry.record))
  }));
}

function summarizeRecord(stateKey, record) {
  return {
    id: record.id ?? stateKey,
    stateKey,
    status: record.status ?? null,
    runtimeDriver: record.runtime?.driver ?? null,
    runtimeId: record.runtime?.runtimeId ?? null,
    updatedAt: record.updatedAt ?? null,
    createdAt: record.createdAt ?? null
  };
}

function queueRemoval({ state, removal, removed, skipped, removalIds, skippedIds }) {
  if (removalIds.has(removal.id) || skippedIds.has(removal.id)) return;

  const record = state.environments[removal.id];
  const safety = removalSafetyFor(record);
  const plannedRemoval = {
    ...removal,
    safe: safety.safe
  };

  if (!safety.safe) {
    skipped.push({
      ...plannedRemoval,
      skipReason: safety.reason
    });
    skippedIds.add(removal.id);
    return;
  }

  removalIds.add(removal.id);
  removed.push(plannedRemoval);
}

function removalSafetyFor(record) {
  if (!record) return { safe: false, reason: "missing-state-record" };

  if (recordHasRunningProcesses(record)) {
    return { safe: false, reason: "running-process" };
  }

  if (record.runtime?.driver && record.runtime.driver !== "process") {
    return { safe: false, reason: "external-runtime-needs-explicit-destroy" };
  }

  return { safe: true };
}

function recordHasRunningProcesses(record) {
  const entries = [
    ...Object.values(record.apps ?? {}),
    ...Object.values(record.services ?? {})
  ];

  return entries.some((entry) => entry.pid && isPidRunning(entry.pid));
}

export function findSmolmachinesOrphanCandidates(state, machines = []) {
  const trackedMachines = new Set(
    Object.values(state.environments ?? {})
      .map((record) => smolmachinesMachineNameForRecord(record))
      .filter(Boolean)
  );

  return machines
    .map((machine) => normalizeMachine(machine))
    .filter((machine) => machine.name?.startsWith("devlane-env_"))
    .filter((machine) => !trackedMachines.has(machine.name))
    .map((machine) => ({
      name: machine.name,
      state: machine.state ?? null,
      pid: machine.pid ?? null,
      image: machine.image ?? null,
      reason: "no-matching-state-record",
      action: "report-only"
    }));
}

function buildSmolmachinesOrphanReport(state, machines) {
  if (!Array.isArray(machines)) {
    return {
      checked: false,
      candidates: [],
      note: "Smolmachines orphan detection is report-only and requires an explicit machine list."
    };
  }

  return {
    checked: true,
    candidates: findSmolmachinesOrphanCandidates(state, machines),
    note: "Report-only. Devlane GC does not stop or delete Smolmachines VMs yet."
  };
}

function smolmachinesMachineNameForRecord(record) {
  const runtimeId = record.runtime?.runtimeId;
  if (typeof runtimeId === "string" && runtimeId.startsWith("smolvm:")) {
    return runtimeId.slice("smolvm:".length);
  }

  if (record.runtime?.driver === "smolmachines" && record.id) {
    return `devlane-${record.id}`;
  }

  return null;
}

function normalizeMachine(machine) {
  if (typeof machine === "string") {
    return { name: machine };
  }

  return {
    name: machine.name ?? machine.Name ?? null,
    state: machine.state ?? machine.State ?? null,
    pid: machine.pid ?? machine.PID ?? machine.Pid ?? null,
    image: machine.image ?? machine.Image ?? null
  };
}

function rotateLogsForState(state, maxLogBytes, dryRun) {
  const files = new Set([daemonLogPath()]);

  for (const record of Object.values(state.environments)) {
    for (const entry of Object.values(record.apps ?? {})) {
      if (entry.logPath) files.add(entry.logPath);
    }

    for (const entry of Object.values(record.services ?? {})) {
      if (entry.logPath) files.add(entry.logPath);
    }
  }

  return [...files]
    .map((filePath) => rotateLogIfNeeded(filePath, maxLogBytes, dryRun))
    .filter(Boolean);
}

function rotateLogIfNeeded(filePath, maxLogBytes, dryRun) {
  if (!fs.existsSync(filePath)) return null;

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= maxLogBytes) return null;

  const rotatedPath = `${filePath}.1`;
  const keepBytes = Math.min(stat.size, maxLogBytes);

  if (!dryRun) {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(keepBytes);
    try {
      fs.readSync(fd, buffer, 0, keepBytes, stat.size - keepBytes);
    } finally {
      fs.closeSync(fd);
    }

    fs.writeFileSync(rotatedPath, buffer);
    fs.truncateSync(filePath, 0);
  }

  return {
    filePath,
    rotatedPath,
    originalBytes: stat.size,
    keptBytes: keepBytes
  };
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}
