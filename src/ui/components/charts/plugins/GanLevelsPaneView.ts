"use client";

import { LineStyle } from "lightweight-charts";
import {
  AnchorPoint,
  BaseLineTool,
  HitTestResult,
  HitTestType,
  LineCap,
  LineJoin,
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
    chart: unknown,
    series: unknown
  ) {
    super(
      source as unknown as BaseLineTool<unknown>,
      chart as never,
      series as never
    );
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
    const minX = Math.min(pointA.x, pointB.x) as typeof pointA.x;
    const maxX = Math.max(pointA.x, pointB.x) as typeof pointA.x;
    const topY = Math.min(pointA.y, pointB.y) as typeof pointA.y;
    const bottomY = Math.max(pointA.y, pointB.y) as typeof pointA.y;
    const lineColor = options.line?.color || "#f59e0b";
    const topLeft = new AnchorPoint(minX, topY, pointA.data, pointA.square);
    const bottomRight = new AnchorPoint(maxX, bottomY, pointB.data, pointB.square);

    this._dragAreaRenderer.setData({
      points: [topLeft, bottomRight],
      background: { color: "rgba(0, 0, 0, 0.001)" },
      border: { color: "rgba(0, 0, 0, 0)", width: 0, style: LineStyle.Solid },
      hitTestBackground: true,
      toolDefaultDragCursor: options.defaultDragCursor as PaneCursorType | undefined,
    });
    this._renderer.append(this._dragAreaRenderer);

    GAN_LEVELS.forEach((level, index) => {
      const y = (topY + (bottomY - topY) * level) as typeof pointA.y;
      const startPoint = new AnchorPoint(minX, y, pointA.data, pointA.square);
      const endPoint = new AnchorPoint(maxX, y, pointB.data, pointB.square);
      const baseLine = options.line;
      this._segmentRenderers[index].setData({
        points: [startPoint, endPoint],
        line: {
          ...baseLine,
          color: lineColor,
          width: baseLine?.width ?? 1,
          join: LineJoin.Round,
          cap: LineCap.Round,
          style:
            index === 1
              ? baseLine?.style ?? LineStyle.Solid
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
