import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../src/core/config.js";
import { notify, sendNotification } from "../src/core/notifier.js";

function config(
  notifications: Partial<Config["notifications"]> & {
    ntfy?: Partial<Config["notifications"]["ntfy"]>;
  } = {}
): Config {
  return {
    server: { port: 19827, host: "127.0.0.1" },
    database: {
      host: "127.0.0.1",
      port: 5432,
      name: "echolog",
      user: "echolog",
      password: "not-used",
    },
    sync: { target: "", auto: false },
    notifications: {
      enabled: notifications.enabled ?? true,
      mac: notifications.mac ?? true,
      ntfy: {
        enabled: notifications.ntfy?.enabled ?? true,
        server: notifications.ntfy?.server ?? "https://ntfy.invalid",
        topic: notifications.ntfy?.topic ?? "private-topic",
      },
      rules: notifications.rules ?? {
        task_overtime_minutes: 60,
        idle_reminder_enabled: false,
        idle_check_start: "09:00",
        idle_check_end: "18:00",
        daily_report_time: "18:00",
        end_of_day_time: "19:00",
      },
    },
  };
}

const request = { title: "Reminder", message: "Private notification body" };

test("reports both channels disabled when notifications are globally disabled", async () => {
  let macCalls = 0;
  let fetchCalls = 0;

  const result = await sendNotification(request, undefined, {
    loadConfig: () => config({ enabled: false }),
    macNotify: () => {
      macCalls++;
    },
    fetch: async () => {
      fetchCalls++;
      return new Response(null, { status: 200 });
    },
  });

  assert.deepEqual(result, {
    channels: {
      mac: { status: "disabled" },
      ntfy: { status: "disabled" },
    },
  });
  assert.equal(macCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("reports a disabled channel independently from a sent channel", async () => {
  let fetchedUrl = "";
  const result = await sendNotification(request, undefined, {
    loadConfig: () => config({ mac: false }),
    macNotify: () => assert.fail("disabled mac channel must not be called"),
    fetch: async (input) => {
      fetchedUrl = String(input);
      return new Response(null, { status: 204 });
    },
  });

  assert.deepEqual(result, {
    channels: {
      mac: { status: "disabled" },
      ntfy: { status: "sent" },
    },
  });
  assert.equal(fetchedUrl, "https://ntfy.invalid/private-topic");
});

test("reports mac callback success and failure", async (t) => {
  await t.test("success", async () => {
    const result = await sendNotification(request, undefined, {
      loadConfig: () => config({ ntfy: { enabled: false } }),
      macNotify: (_options, callback) => callback(null),
    });

    assert.deepEqual(result.channels.mac, { status: "sent" });
    assert.deepEqual(result.channels.ntfy, { status: "disabled" });
  });

  await t.test("failure", async () => {
    const result = await sendNotification(request, undefined, {
      loadConfig: () => config({ ntfy: { enabled: false } }),
      macNotify: (_options, callback) =>
        callback(new Error("mac notification unavailable")),
    });

    assert.equal(result.channels.mac.status, "failed");
    assert.ok(
      result.channels.mac.status === "failed" &&
        result.channels.mac.error.length > 0 &&
        result.channels.mac.error.length <= 200
    );
    assert.deepEqual(result.channels.ntfy, { status: "disabled" });
  });
});

test("bounds a non-cooperative mac delivery with an internal timeout", async () => {
  const startedAt = Date.now();
  const result = await sendNotification(request, undefined, {
    loadConfig: () => config({ ntfy: { enabled: false } }),
    macNotify: () => {},
    timeoutMs: 10,
  });

  assert.equal(result.channels.mac.status, "failed");
  assert.ok(Date.now() - startedAt < 1_000, "delivery timeout must be bounded");
  assert.match(
    result.channels.mac.status === "failed" ? result.channels.mac.error : "",
    /timed out/i
  );
});

test("honors a caller-provided abort signal for mac delivery", async () => {
  const controller = new AbortController();
  const delivery = sendNotification(request, controller.signal, {
    loadConfig: () => config({ ntfy: { enabled: false } }),
    macNotify: () => {},
    timeoutMs: 10_000,
  });
  controller.abort();

  const result = await delivery;
  assert.equal(result.channels.mac.status, "failed");
  assert.match(
    result.channels.mac.status === "failed" ? result.channels.mac.error : "",
    /abort/i
  );
});

test("reports ntfy success, non-2xx, and network failures", async (t) => {
  const ntfyOnly = () => config({ mac: false });

  await t.test("success", async () => {
    const result = await sendNotification(request, undefined, {
      loadConfig: ntfyOnly,
      fetch: async () => new Response(null, { status: 201 }),
    });
    assert.deepEqual(result.channels.ntfy, { status: "sent" });
  });

  await t.test("non-2xx", async () => {
    const result = await sendNotification(request, undefined, {
      loadConfig: ntfyOnly,
      fetch: async () =>
        new Response("upstream-private-response", { status: 503 }),
    });
    assert.equal(result.channels.ntfy.status, "failed");
    if (result.channels.ntfy.status === "failed") {
      assert.match(result.channels.ntfy.error, /503/);
      assert.equal(result.channels.ntfy.error.includes("private-topic"), false);
      assert.equal(
        result.channels.ntfy.error.includes("upstream-private-response"),
        false
      );
      assert.ok(result.channels.ntfy.error.length <= 200);
    }
  });

  await t.test("network failure", async () => {
    const result = await sendNotification(request, undefined, {
      loadConfig: ntfyOnly,
      fetch: async () => {
        throw new Error(
          "network unavailable for https://ntfy.invalid/private-topic with Private notification body"
        );
      },
    });
    assert.equal(result.channels.ntfy.status, "failed");
    if (result.channels.ntfy.status === "failed") {
      assert.ok(result.channels.ntfy.error.length > 0);
      assert.equal(result.channels.ntfy.error.includes("private-topic"), false);
      assert.equal(
        result.channels.ntfy.error.includes("Private notification body"),
        false
      );
    }
  });
});

test("aborts an in-flight ntfy transport when its delivery times out", async () => {
  let transportSignal: AbortSignal | undefined;
  const result = await sendNotification(request, undefined, {
    loadConfig: () => config({ mac: false }),
    fetch: async (_input, init) => {
      transportSignal = init?.signal ?? undefined;
      return new Promise<Pick<Response, "ok" | "status">>(() => {});
    },
    timeoutMs: 10,
  });

  assert.equal(transportSignal?.aborted, true);
  assert.equal(result.channels.ntfy.status, "failed");
  assert.match(
    result.channels.ntfy.status === "failed" ? result.channels.ntfy.error : "",
    /timed out/i
  );
});

test("keeps channel results independent when one delivery fails", async () => {
  const result = await sendNotification(request, undefined, {
    loadConfig: () => config(),
    macNotify: (_options, callback) =>
      callback(new Error("mac unavailable")),
    fetch: async () => new Response(null, { status: 200 }),
  });

  assert.equal(result.channels.mac.status, "failed");
  assert.deepEqual(result.channels.ntfy, { status: "sent" });
});

test("legacy notify remains a void, non-rejecting fire-and-forget wrapper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "echolog-notifier-test-"));
  const configPath = join(directory, "config.yaml");
  const originalConfigPath = process.env.ECHOLOG_CONFIG_PATH;
  const originalFetch = globalThis.fetch;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  writeFileSync(
    configPath,
    [
      "server:",
      "  port: 19827",
      "  host: 127.0.0.1",
      "database:",
      "  host: 127.0.0.1",
      "  port: 5432",
      "  name: echolog",
      "  user: echolog",
      "  password: not-used",
      "sync:",
      "  target: ''",
      "  auto: false",
      "notifications:",
      "  enabled: true",
      "  mac: false",
      "  ntfy:",
      "    enabled: true",
      "    server: https://ntfy.invalid",
      "    topic: private-topic",
      "  rules:",
      "    task_overtime_minutes: 60",
      "    idle_reminder_enabled: false",
      "    idle_check_start: '09:00'",
      "    idle_check_end: '18:00'",
      "    daily_report_time: '18:00'",
      "    end_of_day_time: '19:00'",
      "",
    ].join("\n")
  );

  try {
    process.env.ECHOLOG_CONFIG_PATH = configPath;
    globalThis.fetch = async () => {
      throw new Error("simulated background delivery rejection");
    };
    process.on("unhandledRejection", onUnhandled);

    const returnValue: void = notify("Legacy", "Scheduler-compatible");
    assert.equal(returnValue, undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    globalThis.fetch = originalFetch;
    if (originalConfigPath === undefined) {
      delete process.env.ECHOLOG_CONFIG_PATH;
    } else {
      process.env.ECHOLOG_CONFIG_PATH = originalConfigPath;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
