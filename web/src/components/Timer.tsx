import { useState, useEffect } from "react";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export default function Timer({
  lastResumedAt,
  paused,
  liveDurationSeconds,
}: {
  lastResumedAt: string | null;
  paused: boolean;
  liveDurationSeconds: number;
}) {
  const [elapsed, setElapsed] = useState(liveDurationSeconds);

  useEffect(() => {
    if (paused || !lastResumedAt) {
      setElapsed(liveDurationSeconds);
      return;
    }
    const resumedMs = new Date(lastResumedAt).getTime();
    const snapshotTime = Date.now();
    const tick = () => {
      const sinceTick = Math.floor((Date.now() - snapshotTime) / 1000);
      setElapsed(liveDurationSeconds + sinceTick);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastResumedAt, paused, liveDurationSeconds]);

  return (
    <span className="font-mono text-2xl tabular-nums">
      {formatDuration(elapsed)}
    </span>
  );
}
