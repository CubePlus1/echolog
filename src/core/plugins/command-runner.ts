import { execFile } from "child_process";
import type {
  PluginCommandRequest,
  PluginCommandResult,
} from "@echolog/plugin-sdk";

export type PluginCommandRunner = (
  request: PluginCommandRequest,
  signal?: AbortSignal
) => Promise<PluginCommandResult>;

export const MAX_PLUGIN_STDIN_BYTES = 64 * 1024;

export const runPluginCommand: PluginCommandRunner = (request, signal) => {
  if (
    request.stdin !== undefined &&
    Buffer.byteLength(request.stdin, "utf8") > MAX_PLUGIN_STDIN_BYTES
  ) {
    return Promise.reject(new Error("Plugin command stdin exceeds 65536 bytes"));
  }

  return new Promise((resolve, reject) => {
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
    if (request.stdin !== undefined && child.stdin) {
      // A process may exit before consuming stdin. Swallowing the stream-level
      // EPIPE is safe because execFile's callback still reports the exit.
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") {
          reject(new Error("Plugin command stdin write failed"));
        }
      });
      child.stdin.end(request.stdin);
    }
  });
};
