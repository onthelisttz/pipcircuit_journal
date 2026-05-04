"use client";

import type {
  Coordinate,
  IChartApiBase,
  IHorzScaleBehavior,
  ISeriesApi,
  SeriesType,
} from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import {
  BaseLineTool,
  CompositeRenderer,
  deepCopy,
  type DeepPartial,
  ensureNotNull,
  FinalizationMethod,
  type HitTestResult,
  LineCap,
  LineJoin,
  merge,
  type LineToolHitTestData,
  type LineToolOptionsInternal,
  type LineToolPoint,
  type LineToolType,
  type LineToolsCorePlugin,
  PaneCursorType,
  type PriceAxisLabelStackingManager,
} from "lightweight-charts-line-tools-core";
import { PreciseBrushPaneView } from "./PreciseBrushPaneView";

export const PRECISE_BRUSH_DEFAULTS: LineToolOptionsInternal<"Brush"> = {
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
    width: 2,
    color: "rgba(0, 188, 212, 1)",
    style: LineStyle.Solid,
    join: LineJoin.Round,
    cap: LineCap.Round,
  },
  background: {
    color: "rgba(0, 0, 0, 0)",
  },
};

const DISTANCE_THRESHOLD_PX = 0.35;

export class PreciseBrushTool<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
  public override readonly toolType: LineToolType = "Brush";
  public override readonly pointsCount = -1;

  public constructor(
    coreApi: LineToolsCorePlugin<HorzScaleItem>,
    chart: IChartApiBase<HorzScaleItem>,
    series: ISeriesApi<SeriesType, HorzScaleItem>,
    horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
    options: DeepPartial<LineToolOptionsInternal<"Brush">> = {},
    points: LineToolPoint[] = [],
    priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
  ) {
    const finalOptions = deepCopy(PRECISE_BRUSH_DEFAULTS) as LineToolOptionsInternal<"Brush">;
    merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<"Brush">>);

    super(
      coreApi,
      chart,
      series,
      horzScaleBehavior,
      finalOptions,
      points,
      "Brush",
      -1,
      priceAxisLabelStackingManager
    );

    this._setPaneViews([new PreciseBrushPaneView(this, this._chart, this._series)]);
  }

  public maxAnchorIndex(): number {
    return 0;
  }

  public supportsClickClickCreation(): boolean {
    return false;
  }

  public supportsClickDragCreation(): boolean {
    return true;
  }

  public supportsShiftClickDragConstraint(): boolean {
    return false;
  }

  public override addPoint(newLogicalPoint: LineToolPoint): void {
    const permanentPointsCount = this.getPermanentPointsCount();

    if (permanentPointsCount > 0) {
      const lastLogicalPoint = ensureNotNull(this.getPoint(permanentPointsCount - 1));
      const lastScreenPoint = this.pointToScreenPoint(lastLogicalPoint);
      const newScreenPoint = this.pointToScreenPoint(newLogicalPoint);

      if (lastScreenPoint && newScreenPoint) {
        const distance = newScreenPoint.subtract(lastScreenPoint).length();
        if (distance < DISTANCE_THRESHOLD_PX) {
          return;
        }
      }
    }

    super.addPoint(newLogicalPoint);
  }

  public override getFinalizationMethod(): FinalizationMethod {
    return FinalizationMethod.MouseUp;
  }

  public override anchor0TriggersTranslation(): boolean {
    return true;
  }

  public override _internalHitTest(
    x: Coordinate,
    y: Coordinate
  ): HitTestResult<LineToolHitTestData> | null {
    if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
      return null;
    }

    const paneView = this._paneViews[0] as PreciseBrushPaneView<HorzScaleItem>;
    const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;

    if (!compositeRenderer || !compositeRenderer.hitTest) {
      return null;
    }

    try {
      return compositeRenderer.hitTest(x, y);
    } catch {
      return null;
    }
  }
}
