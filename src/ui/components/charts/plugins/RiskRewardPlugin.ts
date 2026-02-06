import {
    type ISeriesPrimitive,
    type ISeriesApi,
    type IChartApi,
    type Time,
    type IPrimitivePaneRenderer,
    type IPrimitivePaneView,
} from "lightweight-charts";

export class RiskRewardPlugin implements ISeriesPrimitive {
    _chart: IChartApi | undefined;
    _series: ISeriesApi<any> | undefined;

    _entry: number;
    _sl: number;
    _tp: number;
    _startTime: Time | null = null;
    _endTime: Time | null = null;

    constructor(
        entry: number,
        sl: number,
        tp: number,
        startTime: Time | null = null,
        endTime: Time | null = null
    ) {
        this._entry = entry;
        this._sl = sl;
        this._tp = tp;
        this._startTime = startTime;
        this._endTime = endTime;
    }

    attached({ chart, series, requestUpdate }: { chart: IChartApi; series: ISeriesApi<any>; requestUpdate: () => void }) {
        this._chart = chart;
        this._series = series;
        this.requestUpdate = requestUpdate;
    }

    detached() {
        this._chart = undefined;
        this._series = undefined;
    }

    requestUpdate() { }

    updateData(entry: number, sl: number, tp: number, startTime: Time | null, endTime: Time | null) {
        this._entry = entry;
        this._sl = sl;
        this._tp = tp;
        this._startTime = startTime;
        this._endTime = endTime;
        this.requestUpdate();
    }

    paneViews(): readonly IPrimitivePaneView[] {
        if (!this._series || !this._chart) return [];

        return [{
            renderer: () => {
                return new RiskRewardPaneRenderer(
                    this._entry,
                    this._sl,
                    this._tp,
                    this._startTime,
                    this._endTime,
                    this._chart!,
                    this._series!
                );
            },
            zOrder: 'normal'
        }];
    }

    timeAxisViews() { return []; }
    priceAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

class RiskRewardPaneRenderer implements IPrimitivePaneRenderer {
    constructor(
        private _entry: number,
        private _sl: number,
        private _tp: number,
        private _startTime: Time | null,
        private _endTime: Time | null,
        private _chart: IChartApi,
        private _series: ISeriesApi<any>
    ) { }

    draw(target: CanvasRenderingContext2D) {
        const entryY = this._series.priceToCoordinate(this._entry);
        const slY = this._series.priceToCoordinate(this._sl);
        const tpY = this._series.priceToCoordinate(this._tp);

        if (entryY === null || slY === null || tpY === null) return;

        const timeScale = this._chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (!visibleRange) return;

        // --- Calculate X Coordinates ---

        // 1. Start X
        let startX = -1000;
        if (this._startTime) {
            const coord = timeScale.timeToCoordinate(this._startTime as Time);
            if (coord !== null) startX = coord;
        } else {
            const left = timeScale.logicalToCoordinate(visibleRange.from);
            if (left) startX = left;
        }

        // 2. End X
        let endX: number | null = null;
        if (this._endTime) {
            const coord = timeScale.timeToCoordinate(this._endTime as Time);
            if (coord !== null) endX = coord;
        }

        // If no explicit end time (open trade) or off-screen right, extend to visible right
        if (endX === null) {
            const right = timeScale.logicalToCoordinate(visibleRange.to);
            if (right) endX = right;
        }

        // Clamp to visible area for safety
        const leftEdge = timeScale.logicalToCoordinate(visibleRange.from) ?? 0;
        const finalStartX = Math.max(leftEdge, startX);
        const finalEndX = endX ?? (timeScale.logicalToCoordinate(visibleRange.to) ?? 0);

        const width = finalEndX - finalStartX;
        if (width <= 0) return;

        // --- Draw ---

        // Risk Zone (SL) - Red
        target.save();
        target.fillStyle = 'rgba(239, 68, 68, 0.2)';
        const riskHeight = slY - entryY;
        target.fillRect(finalStartX, entryY, width, riskHeight);
        target.restore();

        // Reward Zone (TP) - Green
        target.save();
        target.fillStyle = 'rgba(34, 197, 94, 0.2)';
        const rewardHeight = tpY - entryY;
        target.fillRect(finalStartX, entryY, width, rewardHeight);
        target.restore();

        // Entry Line (Separator)
        target.save();
        target.strokeStyle = 'rgba(156, 163, 175, 0.8)'; // Gray-400
        target.lineWidth = 1;
        target.setLineDash([4, 4]); // Dashed
        target.beginPath();
        target.moveTo(finalStartX, entryY);
        target.lineTo(finalEndX, entryY);
        target.stroke();
        target.restore();
    }
}
