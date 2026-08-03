import { execFile } from "child_process";
import type {
  PluginCommandRequest,
  PluginCommandResult,
} from "@echolog/plugin-sdk";

export type PluginCommandRunner = (
  request: PluginCommandRequest,
  signal?: AbortSignal
) => Promise<PluginCommandResult>;

export const runPluginCommand: PluginCommandRunner = (request, signal) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      request.executable,
      request.args,
      {
        timeout: request.timeoutMs ?? 5_000,
        maxBuffer: request.maxBufferBytes ?? 1024 * 1024,
        env: request.env ? { ...process.env, ...request.env } : process.env,
        encoding: "utf8",
        signal,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode:
            error && typeof error.code === "number" ? error.code : child.exitCode ?? 0,
        });
      }
    );
  });
