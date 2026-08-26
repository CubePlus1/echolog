import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../src/core/config.js";
import {
  notify,
  sendNotification,
  type MacNotify,
  type NotificationFetch,
} from "../src/core/notifier.js";

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

function signalPoint(): { reached: Promise<void>; release: () => void } {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release };
}

function assertAbortError(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "AbortError");
  return true;
}

test("rejects a pre-aborted call before configuration or channel short circuits", async () => {
  const controller = new AbortController();
  controller.abort();
  let configCalls = 0;
  let macCalls = 0;
  let fetchCalls = 0;

  await assert.rejects(
    sendNotification(request, controller.signal, {
      loadConfig: () => {
        configCalls++;
        return config({ enabled: false });
      },
      macNotify: () => {
        macCalls++;
      },
      fetch: async () => {
        fetchCalls++;
        return new Response(null, { status: 200 });
      },
    }),
    assertAbortError
  );

  assert.equal(configCalls, 0);
  assert.equal(macCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("does not dispatch queued transports after an immediate caller abort", async () => {
  const controller = new AbortController();
  let macCalls = 0;
  let fetchCalls = 0;
  const delivery = sendNotification(request, controller.signal, {
    loadConfig: () => config(),
    macNotify: () => {
      macCalls++;
    },
    fetch: async () => {
      fetchCalls++;
      return new Response(null, { status: 200 });
    },
    timeoutMs: 10_000,
  });
  const rejected = assert.rejects(delivery, assertAbortError);

  controller.abort();
  await rejected;

  assert.equal(macCalls, 0);
  assert.equal(fetchCalls, 0);
});

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

test("distinguishes caller abort from timeout for the same non-cooperative mac transport", async () => {
  const starts = [signalPoint(), signalPoint()];
  const callbacks: Array<(error: Error | null) => void> = [];
  const macNotify: MacNotify = (_options, callback) => {
    const callIndex = callbacks.push(callback) - 1;
    starts[callIndex]?.release();
  };
  const controller = new AbortController();
  const delivery = sendNotification(request, controller.signal, {
    loadConfig: () => config({ ntfy: { enabled: false } }),
    macNotify,
    timeoutMs: 10_000,
  });
  const rejected = assert.rejects(delivery, assertAbortError);

  await starts[0].reached;
  controller.abort();
  await rejected;
  assert.equal(callbacks.length, 1);
  assert.doesNotThrow(() => callbacks[0](null));

  const timedDelivery = sendNotification(request, undefined, {
    loadConfig: () => config({ ntfy: { enabled: false } }),
    macNotify,
    timeoutMs: 10,
  });
  await starts[1].reached;
  const result = await timedDelivery;

  assert.equal(result.channels.mac.status, "failed");
  assert.match(
    result.channels.mac.status === "failed" ? result.channels.mac.error : "",
    /timed out/i
  );
  assert.deepEqual(result.channels.ntfy, { status: "disabled" });
  assert.equal(callbacks.length, 2);
  assert.doesNotThrow(() => callbacks[1](null));
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

  await t.test("transport-supplied AbortError remains an operational failure", async () => {
    const result = await sendNotification(request, undefined, {
      loadConfig: ntfyOnly,
      fetch: async () => {
        throw new DOMException("transport cancelled itself", "AbortError");
      },
    });

    assert.equal(result.channels.ntfy.status, "failed");
    assert.match(
      result.channels.ntfy.status === "failed"
        ? result.channels.ntfy.error
        : "",
      /ntfy notification failed/i
    );
  });
});

test("distinguishes caller abort from timeout for the same non-cooperative ntfy transport", async () => {
  const starts = [signalPoint(), signalPoint()];
  const transportSignals: Array<AbortSignal | undefined> = [];
  const fetch: NotificationFetch = async (_input, init) => {
    const callIndex = transportSignals.push(init?.signal ?? undefined) - 1;
    starts[callIndex]?.release();
    return new Promise<Pick<Response, "ok" | "status">>(() => {});
  };
  const controller = new AbortController();
  const delivery = sendNotification(request, controller.signal, {
    loadConfig: () => config({ mac: false }),
    fetch,
    timeoutMs: 10_000,
  });
  const rejected = assert.rejects(delivery, assertAbortError);

  await starts[0].reached;
  controller.abort();
  await rejected;
  assert.equal(transportSignals[0]?.aborted, true);

  const timedDelivery = sendNotification(request, undefined, {
    loadConfig: () => config({ mac: false }),
    fetch,
    timeoutMs: 10,
  });
  await starts[1].reached;
  const result = await timedDelivery;

  assert.equal(transportSignals[1]?.aborted, true);
  assert.equal(result.channels.ntfy.status, "failed");
  assert.match(
    result.channels.ntfy.status === "failed" ? result.channels.ntfy.error : "",
    /timed out/i
  );
  assert.deepEqual(result.channels.mac, { status: "disabled" });
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
