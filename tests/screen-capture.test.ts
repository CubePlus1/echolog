import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  CaptureError,
  MacScreenCaptureService,
} from "../plugins/screen-time/src/macos-screen-capture.js";
import {
  DEFAULT_MACOS_HELPER_EXECUTABLE,
  resolveMacosHelperExecutable,
  validateMacosHelperExecutableOverride,
} from "../plugins/screen-time/src/macos-helper.js";
import { createScreenRoutes } from "../plugins/screen-time/src/routes.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function outputPathFrom(args: string[]): string {
  const index = args.indexOf("--output");
  assert.notEqual(index, -1);
  return args[index + 1]!;
}

function argumentValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  assert.notEqual(index, -1);
  return args[index + 1]!;
}

function success(outputPath: string, bytes = PNG_1X1.length) {
  return {
    stdout: JSON.stringify({
      ok: true,
      command: "capture",
      path: outputPath,
      format: "png",
      displayId: 1,
      widthPixels: 1,
      heightPixels: 1,
      bytes,
      capturedAt: "2026-08-11T12:34:56.789Z",
    }),
    stderr: "",
    exitCode: 0,
  };
}

async function writePrivatePng(path: string): Promise<void> {
  await writeFile(path, PNG_1X1);
  await chmod(path, 0o600);
}

async function writeLaunchFiles(
  args: string[],
  stdout: string,
  stderr = ""
): Promise<void> {
  const stdoutPath = argumentValue(args, "-o");
  const stderrPath = argumentValue(args, "--stderr");
  await writeFile(stdoutPath, stdout);
  await chmod(stdoutPath, 0o600);
  await writeFile(stderrPath, stderr);
  await chmod(stderrPath, 0o600);
}

async function completeLaunch(
  args: string[],
  result: ReturnType<typeof success>,
  openStdout = "Unable to block on application launch\n"
) {
  await writeLaunchFiles(args, result.stdout);
  return { stdout: openStdout, stderr: "", exitCode: 0 };
}

test("macOS helper resolution uses the packaged app inner executable and validates overrides", () => {
  assert.match(
    DEFAULT_MACOS_HELPER_EXECUTABLE,
    /plugins\/screen-time\/native\/macos-capture\/build\/EchoLogScreenCapture\.app\/Contents\/MacOS\/echolog-screen-capture$/
  );
  const override = "/opt/echolog/EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture";
  assert.equal(validateMacosHelperExecutableOverride(override), null);
  assert.equal(resolveMacosHelperExecutable(override), override);
  assert.match(validateMacosHelperExecutableOverride("relative/helper") ?? "", /absolute/);
  assert.throws(() => resolveMacosHelperExecutable("/tmp/wrong-helper"));
});

test("capture service returns a bounded in-memory PNG preview and removes the private directory", async () => {
  let capturedPath = "";
  const service = new MacScreenCaptureService(async (request) => {
    capturedPath = outputPathFrom(request.args);
    assert.equal(request.executable, "/usr/bin/open");
    assert.equal(request.timeoutMs, 15_000);
    assert.equal(request.maxBufferBytes, 65_536);
    assert.deepEqual(request.args.slice(0, 9), [
      "-W", "-n", "-o", argumentValue(request.args, "-o"),
      "--stderr", argumentValue(request.args, "--stderr"),
      DEFAULT_MACOS_HELPER_EXECUTABLE.replace("/Contents/MacOS/echolog-screen-capture", ""),
      "--args", "capture",
    ]);
    assert.equal(request.args.indexOf("-o") < request.args.indexOf("--args"), true);
    assert.equal(request.args.indexOf("--stderr") < request.args.indexOf("--args"), true);
    await writePrivatePng(capturedPath);
    return completeLaunch(request.args, success(capturedPath));
  });
  const result = await service.captureTest();
  assert.equal(result.preview.base64, PNG_1X1.toString("base64"));
  assert.equal(result.preview.mediaType, "image/png");
  assert.equal(result.bytes, PNG_1X1.length);
  await assert.rejects(stat(capturedPath), /ENOENT/);
  await assert.rejects(stat(dirname(capturedPath)), /ENOENT/);
});

test("capture service rejects concurrent tests with a bounded busy response", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const service = new MacScreenCaptureService(async (request) => {
    const outputPath = outputPathFrom(request.args);
    entered();
    await gate;
    await writePrivatePng(outputPath);
    return completeLaunch(request.args, success(outputPath));
  });
  const first = service.captureTest();
  await started;
  await assert.rejects(
    service.captureTest(),
    (error) => error instanceof CaptureError &&
      error.code === "CAPTURE_BUSY" &&
      error.statusCode === 409
  );
  release();
  await first;
});

test("capture service rejects malformed output, unsafe paths, symlinks, oversize files, and timeouts with cleanup", async (t) => {
  const cases: Array<{
    name: string;
    run: ConstructorParameters<typeof MacScreenCaptureService>[0];
    code: string;
    after?: () => Promise<void>;
  }> = [];
  let malformedPath = "";
  cases.push({
    name: "malformed JSON",
    run: async (request) => {
      malformedPath = outputPathFrom(request.args);
      await writeLaunchFiles(request.args, "not-json");
      return { stdout: "ignored", stderr: "", exitCode: 0 };
    },
    code: "PLUGIN_OUTPUT_INVALID",
  });
  let traversalPath = "";
  cases.push({
    name: "returned traversal path",
    run: async (request) => {
      traversalPath = outputPathFrom(request.args);
      await writePrivatePng(traversalPath);
      return completeLaunch(
        request.args,
        success(join(dirname(traversalPath), "..", "capture.png"))
      );
    },
    code: "PLUGIN_OUTPUT_INVALID",
  });
  const outside = await mkdtemp(join(tmpdir(), "echolog-capture-test-outside-"));
  const outsidePng = join(outside, "outside.png");
  await writePrivatePng(outsidePng);
  let symlinkPath = "";
  cases.push({
    name: "symlink destination",
    run: async (request) => {
      symlinkPath = outputPathFrom(request.args);
      await symlink(outsidePng, symlinkPath);
      return completeLaunch(request.args, success(symlinkPath));
    },
    code: "PLUGIN_OUTPUT_INVALID",
    after: async () => {
      assert.equal((await stat(outsidePng)).isFile(), true);
    },
  });
  let oversizePath = "";
  cases.push({
    name: "oversize report",
    run: async (request) => {
      oversizePath = outputPathFrom(request.args);
      await writePrivatePng(oversizePath);
      return completeLaunch(request.args, success(oversizePath, 8 * 1024 * 1024 + 1));
    },
    code: "PLUGIN_OUTPUT_INVALID",
  });
  let timeoutPath = "";
  cases.push({
    name: "timeout",
    run: async (request) => {
      timeoutPath = outputPathFrom(request.args);
      throw Object.assign(new Error("sensitive helper detail"), {
        killed: true,
        signal: "SIGTERM",
      });
    },
    code: "PLUGIN_TIMEOUT",
  });

  try {
    for (const item of cases) {
      await t.test(item.name, async () => {
        const service = new MacScreenCaptureService(item.run);
        await assert.rejects(
          service.captureTest(),
          (error) => error instanceof CaptureError && error.code === item.code &&
            !error.message.includes("sensitive helper detail")
        );
        const path = malformedPath || traversalPath || symlinkPath || oversizePath || timeoutPath;
        if (path) await assert.rejects(writeFile(path, "removed"), /ENOENT/);
        await item.after?.();
        malformedPath = traversalPath = symlinkPath = oversizePath = timeoutPath = "";
      });
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("capture service waits for an asynchronous LaunchServices result", async () => {
  const service = new MacScreenCaptureService(async (request) => {
    const outputPath = outputPathFrom(request.args);
    await writePrivatePng(outputPath);
    setTimeout(() => {
      void writeLaunchFiles(request.args, success(outputPath).stdout);
    }, 40);
    return { stdout: "ignored", stderr: "Unable to block", exitCode: 0 };
  });
  const result = await service.captureTest();
  assert.equal(result.preview.base64, PNG_1X1.toString("base64"));
});

test("capture service bounds a missing LaunchServices result and cleans up", async () => {
  let privateDirectory = "";
  const controller = new AbortController();
  const service = new MacScreenCaptureService(async (request) => {
    privateDirectory = dirname(argumentValue(request.args, "-o"));
    const stderrPath = argumentValue(request.args, "--stderr");
    await writeFile(stderrPath, "");
    await chmod(stderrPath, 0o600);
    setTimeout(() => controller.abort(), 40);
    return { stdout: "ignored", stderr: "Unable to block", exitCode: 0 };
  });
  await assert.rejects(
    service.captureTest(controller.signal),
    (error) => error instanceof CaptureError && error.code === "PLUGIN_TIMEOUT"
  );
  await assert.rejects(stat(privateDirectory), /ENOENT/);
});

test("capture service rejects an insecure LaunchServices result and cleans up", async () => {
  let privateDirectory = "";
  const service = new MacScreenCaptureService(async (request) => {
    privateDirectory = dirname(argumentValue(request.args, "-o"));
    await writeLaunchFiles(request.args, JSON.stringify({ ok: true }));
    await chmod(argumentValue(request.args, "-o"), 0o644);
    return { stdout: "ignored", stderr: "Unable to block", exitCode: 0 };
  });
  await assert.rejects(
    service.captureTest(),
    (error) => error instanceof CaptureError && error.code === "PLUGIN_OUTPUT_INVALID"
  );
  await assert.rejects(stat(privateDirectory), /ENOENT/);
});

test("capture helper errors are mapped safely and permission diagnostics stay non-degrading", async () => {
  const permission = new MacScreenCaptureService(async (request) => {
    if (request.args.includes("doctor")) {
      await writeLaunchFiles(
        request.args,
        JSON.stringify({
          ok: true,
          command: "doctor",
          bundleIdentifier: "com.cubeplus1.echolog.screen-capture",
          helperVersion: "0.1.0",
          osSupported: true,
          screenRecordingPermission: "granted",
          keychainAvailable: true,
        })
      );
      return { stdout: "ignored", stderr: "benign open diagnostic", exitCode: 0 };
    }
    await writeLaunchFiles(
      request.args,
      JSON.stringify({
        ok: false,
        error: "internal path must not escape",
        code: "CAPTURE_PERMISSION_REQUIRED",
        retryable: false,
      }),
      "private diagnostic"
    );
    return { stdout: "ignored", stderr: "benign open diagnostic", exitCode: 0 };
  });
  await assert.rejects(
    permission.captureTest(),
    (error) => error instanceof CaptureError &&
      error.code === "CAPTURE_PERMISSION_REQUIRED" &&
      !error.message.includes("internal path")
  );
  const checks = await permission.doctor();
  assert.equal(checks[0]?.ok, true);
  assert.deepEqual(checks[1], {
    id: "screen-understanding:permission",
    ok: true,
    message: "Screen Recording permission is granted",
    details: { granted: true, actionable: false },
  });
  assert.equal(checks[0]?.details?.launchMethod, "LaunchServices");
});

test("capture test route is canonical, local-only, pathless, and returns safe errors", async () => {
  const routes = createScreenRoutes(
    () => ({}) as never,
    () => ({}) as never,
    () => ({}) as never,
    () => ({
      async captureTest() {
        throw new CaptureError("CAPTURE_FAILED", "Screen capture failed", 502);
      },
    }) as never
  );
  const route = routes.find((item) =>
    item.method === "POST" &&
    item.path === "/api/plugins/screen-time/understanding/capture/test"
  );
  assert.ok(route);
  assert.equal(route.localOnly, true);
  assert.equal(routes.some((item) => item.path.includes("/api/screen/understanding/capture")), false);
  const invalid = await route.handler({
    params: {}, query: {}, body: { path: "/tmp/capture.png" }, headers: {},
  }, new AbortController().signal);
  assert.deepEqual(invalid, {
    statusCode: 400,
    body: { error: "capture test body must be an empty object" },
  });
  for (const body of [undefined, null]) {
    const missing = await route.handler({
      params: {}, query: {}, body, headers: {},
    }, new AbortController().signal);
    assert.deepEqual(missing, {
      statusCode: 400,
      body: { error: "capture test body must be an empty object" },
    });
  }
  const failed = await route.handler({
    params: {}, query: {}, body: {}, headers: {},
  }, new AbortController().signal);
  assert.deepEqual(failed, {
    statusCode: 502,
    body: { error: "Screen capture failed", code: "CAPTURE_FAILED" },
  });
});

test("screen-time Web test-capture action keeps a validated preview only in the live DOM", async () => {
  const { activate } = await import(
    new URL("../plugins/screen-time/web/index.js", import.meta.url).href
  );
  let invalid = false;
  const contribution = await activate({
    api: async (path: string) => {
      assert.equal(path, "/plugins/screen-time/understanding/capture/test");
      if (invalid) throw new Error("reflected private helper output");
      return {
        format: "png",
        displayId: 1,
        widthPixels: 1,
        heightPixels: 1,
        bytes: PNG_1X1.length,
        capturedAt: "2026-08-11T12:34:56.789Z",
        preview: { mediaType: "image/png", base64: PNG_1X1.toString("base64") },
      };
    },
  });
  const elements: Record<string, any> = {
    suCapturePreview: { hidden: true },
    suCaptureImage: { src: "" },
    suCaptureMeta: { textContent: "" },
    suError: { textContent: "" },
  };
  const context = { $: (id: string) => elements[id] ?? null, confirm: () => true };
  const result = await contribution.handleAction("test-understanding-capture", context);
  assert.deepEqual(result, { handled: true, refresh: false, message: "测试截图完成" });
  assert.equal(elements.suCapturePreview.hidden, false);
  assert.equal(elements.suCaptureImage.src, `data:image/png;base64,${PNG_1X1.toString("base64")}`);
  assert.equal(JSON.stringify(contribution).includes(PNG_1X1.toString("base64")), false);

  invalid = true;
  await contribution.handleAction("test-understanding-capture", context);
  assert.equal(elements.suCapturePreview.hidden, true);
  assert.equal(elements.suCaptureImage.src, "");
  assert.equal(elements.suError.textContent.includes("reflected private helper output"), false);
  assert.equal(
    elements.suError.textContent,
    "测试截图失败，请检查 helper、屏幕录制权限与本机服务状态"
  );
});
