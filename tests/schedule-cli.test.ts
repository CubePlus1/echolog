import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CapturedRequest = {
  method: string;
  url: string;
  body: unknown;
};

function runCli(configPath: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      join(repoRoot, "node_modules/.bin/tsx"),
      [join(repoRoot, "src/cli/index.ts"), ...args],
      {
        cwd: repoRoot,
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function scheduleItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "schedule-1",
    title: "设计评审",
    description: "确认 API 契约",
    scheduledStartAt: "2026-08-24T01:00:00.000Z",
    scheduledEndAt: "2026-08-24T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    priority: 2,
    status: "scheduled",
    nextReminderAt: "2026-08-24T01:00:00.000Z",
    confirmedStartAt: null,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    awaitingConfirmation: false,
    ...overrides,
  };
}

test("schedule commands are canonical HTTP thin clients with raw JSON success", async () => {
  const requests: CapturedRequest[] = [];
  let nextStatus = 200;
  let nextBody: unknown = scheduleItem();
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      body: await readJsonBody(request),
    });
    response.writeHead(nextStatus, { "content-type": "application/json" });
    response.end(JSON.stringify(nextBody));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const tempDir = await mkdtemp(join(tmpdir(), "echolog-schedule-cli-"));
  const configPath = join(tempDir, "config.yaml");
  await writeFile(configPath, [
    "server:",
    `  port: ${address.port}`,
    "  host: localhost",
    "",
  ].join("\n"));

  async function expectRequest(input: {
    args: string[];
    method: string;
    url: string;
    body?: unknown;
    response?: unknown;
  }): Promise<void> {
    const before = requests.length;
    nextStatus = 200;
    nextBody = input.response ?? scheduleItem();
    const result = await runCli(configPath, [...input.args, "--json"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), nextBody);
    assert.equal(requests.length, before + 1);
    assert.deepEqual(requests[before], {
      method: input.method,
      url: input.url,
      body: input.body,
    });
  }

  try {
    const listResponse = [scheduleItem()];
    await expectRequest({
      args: [
        "schedule", "list",
        "--from", "2026-08-24T00:00:00+08:00",
        "--to", "2026-08-25T00:00:00+08:00",
        "--status", "scheduled,active",
      ],
      method: "GET",
      url: "/api/plugins/schedule/items?from=2026-08-24T00%3A00%3A00%2B08%3A00&to=2026-08-25T00%3A00%3A00%2B08%3A00&status=scheduled%2Cactive",
      response: listResponse,
    });

    await expectRequest({
      args: ["schedule", "show", "item with space"],
      method: "GET",
      url: "/api/plugins/schedule/items/item%20with%20space",
    });

    await expectRequest({
      args: [
        "schedule", "add", "设计评审",
        "--start", "2026-08-24T09:00:00+08:00",
        "--end", "2026-08-24T10:00:00+08:00",
        "--timezone", "Asia/Shanghai",
        "--description", "确认 API 契约",
        "--priority", "2",
        "--no-reminder",
      ],
      method: "POST",
      url: "/api/plugins/schedule/items",
      body: {
        title: "设计评审",
        scheduledStartAt: "2026-08-24T09:00:00+08:00",
        timezone: "Asia/Shanghai",
        description: "确认 API 契约",
        scheduledEndAt: "2026-08-24T10:00:00+08:00",
        priority: 2,
        nextReminderAt: null,
      },
    });

    await expectRequest({
      args: [
        "schedule", "edit", "schedule-1",
        "--expected-version", "3",
        "--title", "设计评审（更新）",
        "--start", "2026-08-24T10:00:00+08:00",
        "--timezone", "Asia/Shanghai",
        "--priority", "4",
        "--clear-description",
        "--clear-end",
        "--clear-reminder",
      ],
      method: "PATCH",
      url: "/api/plugins/schedule/items/schedule-1",
      body: {
        expectedVersion: 3,
        title: "设计评审（更新）",
        description: null,
        scheduledStartAt: "2026-08-24T10:00:00+08:00",
        scheduledEndAt: null,
        timezone: "Asia/Shanghai",
        priority: 4,
        nextReminderAt: null,
      },
    });

    await expectRequest({
      args: ["schedule", "confirm", "schedule-1", "--expected-version", "1"],
      method: "POST",
      url: "/api/plugins/schedule/items/schedule-1/confirm-start",
      body: { expectedVersion: 1 },
    });

    await expectRequest({
      args: [
        "schedule", "snooze", "schedule-1",
        "--until", "2026-08-24T09:15:00+08:00",
        "--expected-version", "2",
      ],
      method: "POST",
      url: "/api/plugins/schedule/items/schedule-1/snooze",
      body: {
        expectedVersion: 2,
        nextReminderAt: "2026-08-24T09:15:00+08:00",
      },
    });

    await expectRequest({
      args: ["schedule", "done", "schedule-1", "--expected-version", "3"],
      method: "POST",
      url: "/api/plugins/schedule/items/schedule-1/complete",
      body: { expectedVersion: 3 },
    });

    await expectRequest({
      args: ["schedule", "cancel", "schedule-1", "--expected-version", "4"],
      method: "POST",
      url: "/api/plugins/schedule/items/schedule-1/cancel",
      body: { expectedVersion: 4 },
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("schedule human output is readable and 409 JSON errors remain structured on stderr", async () => {
  let status = 200;
  let body: unknown = [scheduleItem()];
  const server = createServer(async (request, response) => {
    await readJsonBody(request);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const tempDir = await mkdtemp(join(tmpdir(), "echolog-schedule-cli-errors-"));
  const configPath = join(tempDir, "config.yaml");
  await writeFile(configPath, [
    "server:",
    `  port: ${address.port}`,
    "  host: localhost",
    "",
  ].join("\n"));

  try {
    const human = await runCli(configPath, ["schedule", "list"]);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.equal(human.stderr, "");
    assert.match(human.stdout, /设计评审 \[schedule-1\] scheduled/);
    assert.match(human.stdout, /Asia\/Shanghai/);
    assert.match(human.stdout, /v1/);

    const conflict = {
      error: "Schedule item changed concurrently",
      currentVersion: 2,
      currentStatus: "active",
    };
    status = 409;
    body = conflict;
    const json = await runCli(configPath, [
      "schedule", "confirm", "schedule-1", "--expected-version", "1", "--json",
    ]);
    assert.equal(json.exitCode, 1);
    assert.equal(json.stdout, "");
    assert.deepEqual(JSON.parse(json.stderr), conflict);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("schedule rejects invalid local numeric options with non-zero JSON errors", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "echolog-schedule-cli-validation-"));
  const configPath = join(tempDir, "config.yaml");
  await writeFile(configPath, [
    "server:",
    "  port: 1",
    "  host: localhost",
    "",
  ].join("\n"));

  try {
    const invalidVersion = await runCli(configPath, [
      "schedule", "done", "schedule-1", "--expected-version", "1.5", "--json",
    ]);
    assert.equal(invalidVersion.exitCode, 1);
    assert.equal(invalidVersion.stdout, "");
    assert.deepEqual(JSON.parse(invalidVersion.stderr), {
      error: "--expected-version 必须是大于或等于 1 的整数",
    });

    const invalidPriority = await runCli(configPath, [
      "schedule", "add", "设计评审",
      "--start", "2026-08-24T09:00:00+08:00",
      "--timezone", "Asia/Shanghai",
      "--priority", "high",
      "--json",
    ]);
    assert.equal(invalidPriority.exitCode, 1);
    assert.equal(invalidPriority.stdout, "");
    assert.deepEqual(JSON.parse(invalidPriority.stderr), {
      error: "--priority 必须是整数",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("schedule help documents commands, concurrency, offset times, timezone, and examples", async () => {
  const scheduleHelp = await runCli("/does/not/matter.yaml", ["schedule", "--help"]);
  assert.equal(scheduleHelp.exitCode, 0, scheduleHelp.stderr);
  for (const command of ["list", "show", "add", "edit", "confirm", "snooze", "done", "cancel"]) {
    assert.match(scheduleHelp.stdout, new RegExp(`\\b${command}\\b`));
  }
  assert.match(scheduleHelp.stdout, /不会自动开始/);
  assert.match(scheduleHelp.stdout, /ISO-8601/);
  assert.match(scheduleHelp.stdout, /\+08:00/);
  assert.match(scheduleHelp.stdout, /IANA/);
  assert.match(scheduleHelp.stdout, /Asia\/Shanghai/);

  const editHelp = await runCli("/does/not/matter.yaml", ["schedule", "edit", "--help"]);
  assert.equal(editHelp.exitCode, 0, editHelp.stderr);
  assert.match(editHelp.stdout, /--expected-version <n>/);
  assert.match(editHelp.stdout, /409/);
  assert.match(editHelp.stdout, /--clear-reminder/);

  const snoozeHelp = await runCli("/does/not/matter.yaml", ["schedule", "snooze", "--help"]);
  assert.equal(snoozeHelp.exitCode, 0, snoozeHelp.stderr);
  assert.match(snoozeHelp.stdout, /--until <ISO>/);
  assert.match(snoozeHelp.stdout, /不会改变状态或自动开始/);
});
