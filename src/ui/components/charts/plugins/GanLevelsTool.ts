"use client";

import type {
  IChartApiBase,
  IHorzScaleBehavior,
  ISeriesApi,
  SeriesType,
} from "lightweight-charts";
import {
  BaseLineTool,
  deepCopy,
  merge,
  type DeepPartial,
  FinalizationMethod,
  type HitTestResult,
  type LineToolHitTestData,
  type LineToolOptionsInternal,
  type LineToolPoint,
  type LineToolsCorePlugin,
  PaneCursorType,
  type PriceAxisLabelStackingManager,
} from "lightweight-charts-line-tools-core";
import { GanLevelsPaneView } from "./GanLevelsPaneView";

type GanLineToolOptions = LineToolOptionsInternal<"TrendLine">;

export const GAN_LEVELS_DEFAULTS: GanLineToolOptions = {
  visible: true,
  editable: true,
  defaultHoverCursor: PaneCursorType.Pointer,
  defaultDragCursor: PaneCursorType.Grabbing,
  defaultAnchorHoverCursor: PaneCursorType.DiagonalNwSeResize,
  defaultAnchorDragCursor: PaneCursorType.Grabbing,
  notEditableCursor: PaneCursorType.NotAllowed,
  showPriceAxisLabels: false,
  showTimeAxisLabels: false,
  priceAxisLabelAlwaysVisible: false,
  timeAxisLabelAlwaysVisible: false,
  line: {
    width: 1,
    color: "rgba(245, 158, 11, 1)",
    style: 0,
  },
};

export class GanLevelsTool<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
  public override readonly toolType = "Gan";
  public override readonly pointsCount = 2;

  public constructor(
    coreApi: LineToolsCorePlugin<HorzScaleItem>,
    chart: IChartApiBase<HorzScaleItem>,
    series: ISeriesApi<SeriesType, HorzScaleItem>,
    horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
    options: DeepPartial<GanLineToolOptions> = {},
    points: LineToolPoint[] = [],
    priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
  ) {
    const finalOptions = deepCopy(GAN_LEVELS_DEFAULTS) as GanLineToolOptions;
    merge(finalOptions, options);

    super(
      coreApi,
      chart,
      series,
      horzScaleBehavior,
      finalOptions,
      points,
      "Gan",
      2,
      priceAxisLabelStackingManager
    );

    this._setPaneViews([new GanLevelsPaneView(this, this._chart, this._series)]);
  }

  public override getFinalizationMethod(): FinalizationMethod {
    return FinalizationMethod.PointCount;
  }

  public override _internalHitTest(
    x: number,
    y: number
  ): HitTestResult<LineToolHitTestData> | null {
    if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
      return null;
    }

    const paneView = this._paneViews[0] as GanLevelsPaneView<HorzScaleItem>;
    const renderer = paneView.renderer();

    if (!renderer || !("hitTest" in renderer) || typeof renderer.hitTest !== "function") {
      return null;
    }

    return renderer.hitTest(x, y) as HitTestResult<LineToolHitTestData> | null;
  }
}
