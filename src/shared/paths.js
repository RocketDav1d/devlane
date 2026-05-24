import os from "node:os";
import path from "node:path";

export function stateRoot() {
  return process.env.DEVLANE_HOME
    ? path.resolve(process.env.DEVLANE_HOME)
    : path.join(os.homedir(), ".devlane");
}

export function stateFilePath() {
  return path.join(stateRoot(), "state.json");
}

export function daemonSocketPath() {
  return path.join(stateRoot(), "daemon.sock");
}

export function daemonLogPath() {
  return path.join(stateRoot(), "daemon.log");
}

export function daemonPidPath() {
  return path.join(stateRoot(), "daemon.pid");
}

export function lockDir() {
  return path.join(stateRoot(), "locks");
}

export function envRoot() {
  return path.join(stateRoot(), "envs");
}

export function logRoot() {
  return path.join(stateRoot(), "logs");
}

export function envStateDir(envId) {
  return path.join(envRoot(), envId);
}

export function envLogDir(envId) {
  return path.join(logRoot(), envId);
}
