export class RuntimeDriver {
  constructor(name) {
    this.name = name;
  }

  async prepare() {
    throw new Error("RuntimeDriver.prepare is not implemented");
  }

  async runCommand() {
    throw new Error("RuntimeDriver.runCommand is not implemented");
  }

  async startProcess() {
    throw new Error("RuntimeDriver.startProcess is not implemented");
  }

  async stopProcess() {
    throw new Error("RuntimeDriver.stopProcess is not implemented");
  }

  async destroy() {
    throw new Error("RuntimeDriver.destroy is not implemented");
  }
}
