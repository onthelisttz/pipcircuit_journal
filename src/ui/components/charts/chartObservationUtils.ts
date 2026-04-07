"use client";

import type { ObservationChartDrawing } from "@domain/entities";

export function drawingTimestampToMs(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

export function filterDrawingsToVisibleWindow<T extends ObservationChartDrawing>(
  drawings: T[],
  centerTimestamp: number | null,
  windowSeconds: number | null
): T[] {
  if (drawings.length === 0) return drawings;
  if (centerTimestamp == null || windowSeconds == null || windowSeconds <= 0) {
    return drawings;
  }

  const halfWindowMs = (windowSeconds * 1000) / 2;
  const visibleFrom = centerTimestamp - halfWindowMs;
  const visibleTo = centerTimestamp + halfWindowMs;

  return drawings.filter((drawing) => {
    let minTimestamp = Number.POSITIVE_INFINITY;
    let maxTimestamp = Number.NEGATIVE_INFINITY;

    for (const point of drawing.points) {
      if (!Number.isFinite(point.timestamp)) continue;
      const timestamp = drawingTimestampToMs(point.timestamp);
      minTimestamp = Math.min(minTimestamp, timestamp);
      maxTimestamp = Math.max(maxTimestamp, timestamp);
    }

    if (!Number.isFinite(minTimestamp) || !Number.isFinite(maxTimestamp)) {
      return false;
    }

    return maxTimestamp >= visibleFrom && minTimestamp <= visibleTo;
  });
}
