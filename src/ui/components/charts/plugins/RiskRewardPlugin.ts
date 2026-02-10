import {
    type ISeriesPrimitive,
    type ISeriesApi,
    type IChartApi,
    type Time,
    type IPrimitivePaneRenderer,
    type IPrimitivePaneView,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export interface RiskRewardLabels {
    /** Label for risk zone (e.g. "-3") */
    riskLabel?: string;
    /** Label for reward zone (e.g. "+6") */
    rewardLabel?: string;
    /** Actual profit (e.g. "$12.50") */
    profitLabel?: string;
    /** True if trade was profitable; when false, exit zone is drawn red */
    isProfit?: boolean;
}

export class RiskRewardPlugin implements ISeriesPrimitive<unknown> {
    _chart: IChartApi | undefined;
    _series: ISeriesApi<"Candlestick"> | undefined;

    _entry: number;
    _sl: number;
    _tp: number;
    _startTime: Time | null = null;
    _endTime: Time | null = null;
    _isBuy: boolean;
    _useMae: boolean;
    _labels: RiskRewardLabels;

    constructor(
        entry: number,
        sl: number,
        tp: number,
        startTime: Time | null = null,
        endTime: Time | null = null,
        isBuy: boolean = true,
        useMae: boolean = false,
        labels: RiskRewardLabels = {}
    ) {
        this._entry = entry;
        this._sl = sl;
        this._tp = tp;
        this._startTime = startTime;
        this._endTime = endTime;
        this._isBuy = isBuy;
        this._useMae = useMae;
        this._labels = labels;
    }

    attached(param: unknown) {
        const { chart, series, requestUpdate } = param as {
            chart: IChartApi;
            series: ISeriesApi<"Candlestick">;
            requestUpdate: () => void;
        };
        this._chart = chart;
        this._series = series;
        this.requestUpdate = requestUpdate;
    }

    detached() {
        this._chart = undefined;
        this._series = undefined;
    }

    requestUpdate() { }

    updateData(
        entry: number,
        sl: number,
        tp: number,
        startTime: Time | null,
        endTime: Time | null,
        isBuy?: boolean,
        useMae?: boolean,
        labels?: RiskRewardLabels
    ) {
        this._entry = entry;
        this._sl = sl;
        this._tp = tp;
        this._startTime = startTime;
        this._endTime = endTime;
        if (isBuy !== undefined) this._isBuy = isBuy;
        if (useMae !== undefined) this._useMae = useMae;
        if (labels) this._labels = { ...this._labels, ...labels };
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
                    this._isBuy,
                    this._useMae,
                    this._labels,
                    this._chart!,
                    this._series!
                );
            },
            zOrder: () => 'normal' as const
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
        private _isBuy: boolean,
        private _useMae: boolean,
        private _labels: RiskRewardLabels,
        private _chart: IChartApi,
        private _series: ISeriesApi<"Candlestick">
    ) { }

    draw(target: CanvasRenderingTarget2D) {
        target.useMediaCoordinateSpace((scope) => {
            const ctx = scope.context;
            this._drawImpl(ctx);
        });
    }

    private _drawImpl(target: CanvasRenderingContext2D) {
        const entryY = this._series.priceToCoordinate(this._entry);
        const slY = this._series.priceToCoordinate(this._sl);
        const tpY = this._series.priceToCoordinate(this._tp);

        if (entryY === null || slY === null || tpY === null) return;

        const timeScale = this._chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (!visibleRange) return;

        // --- Calculate X Coordinates ---

        let startX = -1000;
        if (this._startTime) {
            const coord = timeScale.timeToCoordinate(this._startTime as Time);
            if (coord !== null) startX = coord;
        } else {
            const left = timeScale.logicalToCoordinate(visibleRange.from);
            if (left) startX = left;
        }

        let endX: number | null = null;
        if (this._endTime) {
            const coord = timeScale.timeToCoordinate(this._endTime as Time);
            if (coord !== null) endX = coord;
        }

        if (endX === null) {
            const right = timeScale.logicalToCoordinate(visibleRange.to);
            if (right) endX = right;
        }

        const leftEdge = timeScale.logicalToCoordinate(visibleRange.from) ?? 0;
        const finalStartX = Math.max(leftEdge, startX);
        const finalEndX = endX ?? (timeScale.logicalToCoordinate(visibleRange.to) ?? 0);

        const width = finalEndX - finalStartX;
        if (width <= 0) return;

        // --- Draw zones (Y increases downward, higher price = smaller Y) ---

        // Risk Zone - Red (below entry for Buy, above entry for Sell). 
        // Only draw when there's a risk label (explicit SL or MAE for open trades).
        // For closed trades without explicit SL, riskLabel will be undefined, so no risk zone is drawn.
        const riskHeight = this._isBuy ? slY - entryY : entryY - slY;
        if (this._labels.riskLabel && riskHeight > 1) {
            target.save();
            target.fillStyle = 'rgba(185, 28, 28, 0.25)';
            if (this._isBuy) {
                target.fillRect(finalStartX, entryY, width, riskHeight);
            } else {
                target.fillRect(finalStartX, slY, width, riskHeight);
            }
            target.restore();
        }

        // Exit/Target Zone - Green when profit, red when loss (e.g. hit stop loss)
        const isProfit = this._labels.isProfit !== false;
        target.save();
        target.fillStyle = isProfit ? 'rgba(22, 101, 52, 0.25)' : 'rgba(185, 28, 28, 0.25)';
        if (this._isBuy) {
            const rewardHeight = entryY - tpY;
            if (rewardHeight > 1) {
                target.fillRect(finalStartX, tpY, width, rewardHeight);
            } else if (rewardHeight < -1) {
                target.fillRect(finalStartX, entryY, width, -rewardHeight);
            }
        } else {
            const rewardHeight = tpY - entryY;
            if (rewardHeight > 1) {
                target.fillRect(finalStartX, entryY, width, rewardHeight);
            } else if (rewardHeight < -1) {
                target.fillRect(finalStartX, tpY, width, -rewardHeight);
            }
        }
        target.restore();

        // Entry Line (Separator) - dashed horizontal
        target.save();
        target.strokeStyle = 'rgba(156, 163, 175, 0.9)';
        target.lineWidth = 1;
        target.setLineDash([4, 4]);
        target.beginPath();
        target.moveTo(finalStartX, entryY);
        target.lineTo(finalEndX, entryY);
        target.stroke();
        target.restore();

        // --- Labels: SL/MAE (e.g. "-2") and Exit/TP (e.g. "+6") ---
        const labelPadding = 8;
        const labelFont = '12px "Inter", sans-serif';

        target.save();
        target.font = labelFont;
        target.textAlign = 'left';
        target.textBaseline = 'middle';

        if (this._labels.riskLabel && riskHeight > 1) {
            target.fillStyle = 'rgba(239, 68, 68, 0.95)';
            const riskCenterY = this._isBuy ? entryY + (slY - entryY) / 2 : slY + (entryY - slY) / 2;
            target.fillText(this._labels.riskLabel, finalStartX + labelPadding, riskCenterY);
        }

        if (this._labels.rewardLabel) {
            const rewardCenterY = (entryY + tpY) / 2;
            target.fillStyle = this._labels.isProfit === false ? 'rgba(239, 68, 68, 0.95)' : 'rgba(34, 197, 94, 0.95)';
            target.fillText(this._labels.rewardLabel, finalStartX + labelPadding, rewardCenterY);
        }

        target.restore();
    }
}
