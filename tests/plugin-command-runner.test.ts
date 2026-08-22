import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  MAX_PLUGIN_STDIN_BYTES,
  runPluginCommand,
} from "../src/core/plugins/command-runner.js";

test("plugin command runner sends bounded stdin without putting it in argv or env", async () => {
  const value = "test-credential-value";
  const script = [
    "const crypto=require('node:crypto');",
    "let input='';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => input += chunk);",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify({",
    "hash:crypto.createHash('sha256').update(input).digest('hex'),",
    "argv:process.argv.includes(input),",
    "env:Object.values(process.env).includes(input)",
    "})));",
  ].join("");
  const result = await runPluginCommand({
    executable: process.execPath,
    args: ["-e", script],
    stdin: value,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    hash: createHash("sha256").update(value).digest("hex"),
    argv: false,
    env: false,
  });
  assert.equal(result.stderr, "");
});

test("plugin command runner rejects oversized stdin before spawning", async () => {
  const value = "x".repeat(MAX_PLUGIN_STDIN_BYTES + 1);
  await assert.rejects(
    runPluginCommand({ executable: "/definitely/not/a/program", args: [], stdin: value }),
    (error: Error) => {
      assert.equal(error.message, "Plugin command stdin exceeds 65536 bytes");
      assert.equal(error.message.includes(value.slice(0, 64)), false);
      return true;
    }
  );
});

test("plugin command runner handles a child closing stdin early", async () => {
  const result = await runPluginCommand({
    executable: process.execPath,
    args: ["-e", "process.stdin.destroy(); setImmediate(() => process.exit(0))"],
    stdin: "x".repeat(MAX_PLUGIN_STDIN_BYTES),
  });
  assert.equal(result.exitCode, 0);
});

test("plugin command runner keeps stdin out of timeout and output-limit errors", async () => {
  const value = "test-credential-for-error-paths";
  await assert.rejects(
    runPluginCommand({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      stdin: value,
      timeoutMs: 20,
    }),
    (error: Error) => {
      assert.equal(error.message.includes(value), false);
      return true;
    }
  );

  await assert.rejects(
    runPluginCommand({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(1024))"],
      stdin: value,
      maxBufferBytes: 16,
    }),
    (error: Error) => {
      assert.equal(error.message.includes(value), false);
      return true;
    }
  );
});

test("plugin command runner keeps stdin out of abort errors", async () => {
  const value = "test-credential-for-abort";
  const controller = new AbortController();
  const command = runPluginCommand({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10_000)"],
    stdin: value,
  }, controller.signal);
  controller.abort();
  await assert.rejects(command, (error: Error) => {
    assert.equal(error.message.includes(value), false);
    return true;
  });
});
