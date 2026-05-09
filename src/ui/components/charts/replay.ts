import type { ChartBar } from "@domain/entities";

export const REPLAY_SPEED_OPTIONS = [
  { label: "60s", intervalMs: 60_000 },
  { label: "30s", intervalMs: 30_000 },
  { label: "15s", intervalMs: 15_000 },
  { label: "0.1x", intervalMs: 1800 },
  { label: "0.25x", intervalMs: 900 },
  { label: "0.5x", intervalMs: 600 },
  { label: "1x", intervalMs: 320 },
  { label: "2x", intervalMs: 180 },
  { label: "3x", intervalMs: 120 },
  { label: "4x", intervalMs: 90 },
] as const;

export const DEFAULT_REPLAY_INTERVAL_MS = 900;

export function clampReplayIndex(index: number, barsLength: number): number {
  if (barsLength <= 0) return 0;
  return Math.max(0, Math.min(barsLength - 1, index));
}

export function findNearestReplayIndex(
  bars: ChartBar[],
  timestamp: number | null | undefined
): number {
  if (bars.length === 0) return 0;
  if (!Number.isFinite(timestamp)) return bars.length - 1;
  const targetTimestamp = timestamp as number;

  let low = 0;
  let high = bars.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = bars[middle]?.timestamp ?? 0;

    if (value === targetTimestamp) return middle;
    if (value < targetTimestamp) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const previousIndex = clampReplayIndex(high, bars.length);
  const nextIndex = clampReplayIndex(low, bars.length);
  const previousDistance = Math.abs((bars[previousIndex]?.timestamp ?? 0) - targetTimestamp);
  const nextDistance = Math.abs((bars[nextIndex]?.timestamp ?? 0) - targetTimestamp);

  return previousDistance <= nextDistance ? previousIndex : nextIndex;
}

export function findReplayStartIndex(
  bars: ChartBar[],
  timestamp: number | null | undefined
): number {
  if (bars.length === 0) return 0;
  if (!Number.isFinite(timestamp)) return bars.length - 1;
  const targetTimestamp = timestamp as number;

  let low = 0;
  let high = bars.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = bars[middle]?.timestamp ?? 0;

    if (value === targetTimestamp) return middle;
    if (value < targetTimestamp) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return clampReplayIndex(low, bars.length);
}
