import { spawnSync } from "node:child_process";

function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

export function createSystem(environment = process.env) {
  return {
    run(name, args, options = {}) {
      const result = spawnSync(executable(name), args, {
        encoding: "utf8",
        env: environment,
        maxBuffer: 16 * 1024 * 1024,
        stdio: options.inherit ? "inherit" : "pipe",
      });
      if (result.error?.code === "ENOENT") throw new Error(`${name} is required and was not found in PATH`);
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
        throw new Error(detail || `${name} exited with status ${result.status}`);
      }
      return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}
