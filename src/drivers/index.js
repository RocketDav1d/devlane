import { ProcessDriver } from "./process-driver.js";
import { SmolmachinesDriver } from "./smolmachines-driver.js";

export function driverFor(config) {
  if (config.runtime.driver === "process") return new ProcessDriver();
  if (config.runtime.driver === "smolmachines") return new SmolmachinesDriver();
  throw new Error(`Unsupported runtime driver: ${config.runtime.driver}`);
}
