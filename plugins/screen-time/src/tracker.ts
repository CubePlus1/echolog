import type { PluginContext } from "@echolog/plugin-sdk";
import { nanoid } from "nanoid";
import type { ScreenStore } from "./store.js";

const IGNORED_BUNDLES = new Set([
  "com.apple.loginwindow",
  "com.apple.ScreenSaver.Engine",
]);
const DB_UPDATE_INTERVAL_MS = 60_000;

interface Segment {
  id: string;
  bundleId: string;
  appName: string;
  startAt: Date;
  lastSeenAt: Date;
  lastDbWriteAt: number;
}

interface Sample {
  bundleId: string | null;
  appName: string | null;
  idleSeconds: number;
  mediaActive: boolean;
}

export interface ScreenTrackerConfig {
  sampleSeconds: number;
  idleSeconds: number;
}

function frontAppHoldsAssertion(
  output: string,
  bundleId: string | null,
  appName: string | null
): boolean {
  if (!output || !bundleId) return false;
  const normalizedBundle = bundleId.toLowerCase();
  const normalizedApp = (appName ?? "").toLowerCase();
  const expression =
    /pid \d+\(([^)]+)\):.*?(PreventUserIdleDisplaySleep|PreventUserIdleSystemSleep|NoIdleSleepAssertion)/g;
  for (const match of output.matchAll(expression)) {
    const processName = match[1].trim().toLowerCase();
    if (
      !processName ||
      processName === "caffeinate" ||
      processName === "powerd" ||
      processName === "coreaudiod"
    ) {
      continue;
    }
    if (
      normalizedBundle.includes(processName) ||
      normalizedApp.includes(processName) ||
      (normalizedApp && processName.includes(normalizedApp))
    ) {
      return true;
    }
  }
  return false;
}

export class ScreenTracker {
  private current: Segment | null = null;
  private lastSampleAt = 0;
  private lastMediaAt = 0;

  constructor(
    private readonly context: PluginContext,
    private readonly store: ScreenStore,
    readonly config: ScreenTrackerConfig
  ) {}

  currentSegment() {
    if (!this.current) return null;
    const { id, bundleId, appName, startAt, lastSeenAt } = this.current;
    return { id, bundleId, appName, startAt, lastSeenAt };
  }

  async sample(signal: AbortSignal): Promise<void> {
    if (process.platform !== "darwin") return;
    const now = new Date();
    const nowMs = now.getTime();
    if (
      this.current &&
      this.lastSampleAt &&
      nowMs - this.lastSampleAt > this.config.sampleSeconds * 3_000
    ) {
      await this.closeSegment(this.current.lastSeenAt);
    }
    this.lastSampleAt = nowMs;

    const sample = await this.takeSample(signal);
    if (sample.mediaActive) this.lastMediaAt = nowMs;
    if (sample.idleSeconds >= this.config.idleSeconds && !sample.mediaActive) {
      if (this.current) {
        const inputCutoff = nowMs - sample.idleSeconds * 1_000;
        await this.closeSegment(
          new Date(Math.max(inputCutoff, this.lastMediaAt))
        );
      }
      return;
    }

    const active =
      sample.bundleId && !IGNORED_BUNDLES.has(sample.bundleId)
        ? sample.bundleId
        : null;
    if (!active) {
      if (this.current) await this.closeSegment(now);
      return;
    }
    if (this.current?.bundleId === active) {
      this.current.lastSeenAt = now;
      if (Date.now() - this.current.lastDbWriteAt >= DB_UPDATE_INTERVAL_MS) {
        await this.writeSegment(this.current, now);
      }
      return;
    }
    if (this.current) await this.closeSegment(now);
    await this.openSegment(active, sample.appName ?? active, now);
  }

  async stop(): Promise<void> {
    try {
      await this.closeSegment(
        this.current ? this.current.lastSeenAt : new Date()
      );
    } catch {
      // The database may already be unavailable during daemon shutdown.
    }
  }

  private async command(
    executable: string,
    args: string[],
    signal: AbortSignal
  ): Promise<string> {
    const result = await this.context.exec(
      { executable, args, timeoutMs: 4_000 },
      signal
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `${executable} exited ${result.exitCode}: ${result.stderr.trim()}`
      );
    }
    return result.stdout;
  }

  private async takeSample(signal: AbortSignal): Promise<Sample> {
    const front = (await this.command("lsappinfo", ["front"], signal)).trim();
    const [appOutput, idleOutput, assertions] = await Promise.all([
      this.command(
        "lsappinfo",
        ["info", "-only", "name", "-only", "bundleid", front],
        signal
      ),
      this.command("ioreg", ["-c", "IOHIDSystem"], signal),
      this.command("pmset", ["-g", "assertions"], signal),
    ]);
    const nameMatch = appOutput.match(/"LSDisplayName"="(.*)"/);
    const bundleMatch = appOutput.match(/"CFBundleIdentifier"="(.*)"/);
    const idleMatch = idleOutput.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    const bundleId = bundleMatch?.[1] ?? null;
    const appName = nameMatch?.[1] ?? bundleId;
    return {
      bundleId,
      appName,
      idleSeconds: idleMatch ? Number(idleMatch[1]) / 1e9 : 0,
      mediaActive: frontAppHoldsAssertion(assertions, bundleId, appName),
    };
  }

  private segmentSeconds(segment: Segment, until: Date): number {
    return Math.max(
      0,
      Math.round((until.getTime() - segment.startAt.getTime()) / 1_000)
    );
  }

  private async openSegment(
    bundleId: string,
    appName: string,
    startAt: Date
  ): Promise<void> {
    const segment: Segment = {
      id: nanoid(12),
      bundleId,
      appName,
      startAt,
      lastSeenAt: startAt,
      lastDbWriteAt: Date.now(),
    };
    await this.store.insertUsage({
      id: segment.id,
      bundleId,
      appName,
      startAt,
      endAt: startAt,
      seconds: 0,
    });
    this.current = segment;
  }

  private async writeSegment(segment: Segment, endAt: Date): Promise<void> {
    await this.store.updateUsage(
      segment.id,
      endAt,
      this.segmentSeconds(segment, endAt)
    );
    segment.lastDbWriteAt = Date.now();
  }

  private async closeSegment(endAt: Date): Promise<void> {
    if (!this.current) return;
    const segment = this.current;
    this.current = null;
    const boundedEnd =
      endAt.getTime() < segment.startAt.getTime() ? segment.startAt : endAt;
    await this.writeSegment(segment, boundedEnd);
  }
}
