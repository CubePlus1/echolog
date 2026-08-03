import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function runCli(cwd: string, configPath: string, args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    execFile(
      join(repoRoot, "node_modules/.bin/tsx"),
      [join(repoRoot, "src/cli/index.ts"), ...args],
      {
        cwd,
        env: { ...process.env, ECHOLOG_CONFIG_PATH: configPath },
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      }
    );
  });
}

test("plugins doctor preserves structured 503 diagnostics in human and JSON modes", async () => {
  const body = {
    error: "One or more enabled plugin checks failed",
    ok: false,
    plugins: [{
      id: "tmux-status",
      state: "ready",
      checks: [{ id: "status-contract", ok: false, message: "bad schema" }],
    }],
  };
  const server = createServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const cwd = await mkdtemp(join(tmpdir(), "echolog-cli-doctor-"));
  const configPath = join(cwd, "config.yaml");
  await writeFile(configPath, [
    "server:",
    `  port: ${address.port}`,
    "  host: localhost",
    "",
  ].join("\n"));

  try {
    const json = await runCli(cwd, configPath, ["plugins", "doctor", "--json"]);
    assert.equal(json.exitCode, 1);
    assert.equal(json.stdout, "");
    assert.deepEqual(JSON.parse(json.stderr), body);

    const human = await runCli(cwd, configPath, ["plugins", "doctor"]);
    assert.equal(human.exitCode, 1);
    assert.equal(human.stdout, "");
    assert.match(human.stderr, /One or more enabled plugin checks failed/);
    assert.match(human.stderr, /tmux-status\s+ready/);
    assert.match(human.stderr, /fail\s+status-contract\s+bad schema/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
    await rm(cwd, { recursive: true, force: true });
  }
});
