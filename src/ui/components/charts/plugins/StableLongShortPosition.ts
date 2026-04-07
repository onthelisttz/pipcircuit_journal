"use client";

import type { ChartTimeframe } from "@domain/entities";
import { LineToolLongShortPosition } from "lightweight-charts-line-tools-long-short-position";

type ToolPoint = { timestamp: number; price: number };

const DEFAULT_LONG_SHORT_WIDTH_BARS = 12;

function timeframeToSeconds(timeframe?: ChartTimeframe): number {
    switch (timeframe) {
        case "M1":
            return 60;
        case "M5":
            return 5 * 60;
        case "M15":
            return 15 * 60;
        case "M30":
            return 30 * 60;
        case "H1":
            return 60 * 60;
        case "H4":
            return 4 * 60 * 60;
        case "D1":
            return 24 * 60 * 60;
        default:
            return 60;
    }
}

export function defaultLongShortWidthSeconds(timeframe?: ChartTimeframe): number {
    return timeframeToSeconds(timeframe) * DEFAULT_LONG_SHORT_WIDTH_BARS;
}

export class StableLongShortPosition<HorzScaleItem> extends LineToolLongShortPosition<HorzScaleItem> {
    private _resolveWidthSeconds(): number {
        const configured = (this.options() as { initialWidthSeconds?: unknown }).initialWidthSeconds;
        return typeof configured === "number" && Number.isFinite(configured) && configured > 0
            ? configured
            : defaultLongShortWidthSeconds();
    }

    private _fixedTimestamp(entryTimestamp: number): number {
        return entryTimestamp + this._resolveWidthSeconds();
    }

    public override points(): ToolPoint[] {
        const points = super.points() as ToolPoint[];
        const entryTimestamp = points[0]?.timestamp;
        if (!Number.isFinite(entryTimestamp) || points.length < 2 || this.isFinished()) {
            return points;
        }

        const fixedTimestamp = this._fixedTimestamp(entryTimestamp);
        return points.map((point, index) =>
            index === 0 ? point : { ...point, timestamp: fixedTimestamp }
        );
    }

    public override addPoint(point: ToolPoint): void {
        const entryPoint = super.getPoint(0) as ToolPoint | null;
        if (
            entryPoint &&
            Number.isFinite(entryPoint.timestamp) &&
            this.getPermanentPointsCount() === 1
        ) {
            super.addPoint({
                ...point,
                timestamp: this._fixedTimestamp(entryPoint.timestamp),
            });
            return;
        }

        super.addPoint(point);
    }
}
