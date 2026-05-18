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
  startAt,
  paused,
  baseSeconds,
}: {
  startAt: string;
  paused: boolean;
  baseSeconds: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (paused) {
      setElapsed(baseSeconds);
      return;
    }
    const start = new Date(startAt).getTime();
    const tick = () => {
      const now = Date.now();
      setElapsed(baseSeconds + Math.floor((now - start) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startAt, paused, baseSeconds]);

  return (
    <span className="font-mono text-2xl tabular-nums">
      {formatDuration(elapsed)}
    </span>
  );
}
