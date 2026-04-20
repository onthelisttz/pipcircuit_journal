"use client";

import type {
  IChartApiBase,
  ISeriesApi,
  SeriesType,
} from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import {
  HitTestResult,
  HitTestType,
  PaneCursorType,
  RectangleRenderer,
  SegmentRenderer,
  type LineToolOptionsInternal,
  LineToolPaneView,
} from "lightweight-charts-line-tools-core";
import type { GanLevelsTool } from "./GanLevelsTool";

const GAN_LEVELS = [0.3, 0.5, 0.7] as const;

export class GanLevelsPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
  private readonly _dragAreaRenderer = new RectangleRenderer<HorzScaleItem>(
    new HitTestResult(HitTestType.MovePointBackground)
  );
  private readonly _segmentRenderers = GAN_LEVELS.map(
    () => new SegmentRenderer<HorzScaleItem>(new HitTestResult(HitTestType.MovePointBackground))
  );

  public constructor(
    source: GanLevelsTool<HorzScaleItem>,
    chart: IChartApiBase<HorzScaleItem>,
    series: ISeriesApi<SeriesType, HorzScaleItem>
  ) {
    super(source, chart, series);
  }

  protected override _updateImpl(_height: number, _width: number): void {
    void _height;
    void _width;
    this._invalidated = false;
    this._renderer.clear();

    const options = this._tool.options() as LineToolOptionsInternal<"TrendLine">;
    if (!options.visible || !this._updatePoints() || this._points.length < 2) {
      return;
    }

    const [pointA, pointB] = this._points;
    const minX = Math.min(pointA.x, pointB.x);
    const maxX = Math.max(pointA.x, pointB.x);
    const topY = Math.min(pointA.y, pointB.y);
    const bottomY = Math.max(pointA.y, pointB.y);
    const lineColor = options.line?.color || "#f59e0b";

    this._dragAreaRenderer.setData({
      points: [
        { ...pointA, x: minX, y: topY },
        { ...pointB, x: maxX, y: bottomY },
      ],
      background: { color: "rgba(0, 0, 0, 0.001)" },
      border: { color: "rgba(0, 0, 0, 0)", width: 0, style: LineStyle.Solid },
      hitTestBackground: true,
      toolDefaultDragCursor: options.defaultDragCursor as PaneCursorType | undefined,
    });
    this._renderer.append(this._dragAreaRenderer);

    GAN_LEVELS.forEach((level, index) => {
      const y = (topY + (bottomY - topY) * level) as typeof pointA.y;
      this._segmentRenderers[index].setData({
        points: [
          { ...pointA, x: minX, y },
          { ...pointB, x: maxX, y },
        ],
        line: {
          color: lineColor,
          width: options.line?.width ?? 1,
          style:
            index === 1
              ? options.line?.style ?? LineStyle.Solid
              : LineStyle.Dashed,
        },
        toolDefaultHoverCursor: options.defaultHoverCursor as PaneCursorType | undefined,
        toolDefaultDragCursor: options.defaultDragCursor as PaneCursorType | undefined,
      });
      this._renderer.append(this._segmentRenderers[index]);
    });

    if (this.areAnchorsVisible()) {
      this._addAnchors(this._renderer);
    }
  }

  protected override _addAnchors(renderer: typeof this._renderer): void {
    if (this._points.length < 2) return;

    renderer.append(
      this.createLineAnchor({ points: [this._points[0]] }, 0)
    );
    renderer.append(
      this.createLineAnchor({ points: [this._points[1]] }, 1)
    );
  }
}
