"use client";

import type { Coordinate } from "lightweight-charts";
import {
  AnchorPoint,
  BaseLineTool,
  CompositeRenderer,
  getToolBoundingBox,
  getToolCullingState,
  type LineOptions,
  type LineToolOptionsInternal,
  type LineToolPoint,
  LineToolPaneView,
  OffScreenState,
  PaneCursorType,
  PolygonRenderer,
  type PolygonRendererData,
} from "lightweight-charts-line-tools-core";
import type { PreciseBrushTool } from "./PreciseBrushTool";

export class PreciseBrushPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
  protected _polygonRenderer: PolygonRenderer<HorzScaleItem> = new PolygonRenderer();

  public constructor(
    source: PreciseBrushTool<HorzScaleItem>,
    chart: unknown,
    series: unknown
  ) {
    super(
      source as unknown as BaseLineTool<any>,
      chart as never,
      series as never
    );
  }

  protected _smoothArray(points: AnchorPoint[], iterations = 1): AnchorPoint[] {
    if (points.length <= 2 || iterations === 0) {
      return points;
    }

    let smoothedPoints = points.map((point) => point.clone());
    const windowSize = 3;

    for (let i = 0; i < iterations; i += 1) {
      const currentIterationPoints = smoothedPoints.map((point) => point.clone());

      for (let j = 1; j < smoothedPoints.length - 1; j += 1) {
        const prev = smoothedPoints[j - 1];
        const current = smoothedPoints[j];
        const next = smoothedPoints[j + 1];

        currentIterationPoints[j].x = ((prev.x + current.x + next.x) / windowSize) as Coordinate;
        currentIterationPoints[j].y = ((prev.y + current.y + next.y) / windowSize) as Coordinate;
      }

      smoothedPoints = currentIterationPoints;
    }

    return smoothedPoints;
  }

  protected override _updateImpl(_height: number, _width: number): void {
    void _height;
    void _width;
    this._invalidated = false;
    this._renderer.clear();

    const options = this._tool.options() as LineToolOptionsInternal<"Brush">;
    const permanentPoints = this._tool.getPermanentPointsForTranslation();
    const hasScreenPoints = this._updatePoints();

    if (!options.visible || !hasScreenPoints || this._points.length === 0) {
      return;
    }

    if (!this._tool.isCreating() && !this._tool.isEditing() && permanentPoints.length > 1) {
      const toolAabb = getToolBoundingBox(permanentPoints);

      if (toolAabb) {
        const boundingPointsLogical: LineToolPoint[] = [
          { timestamp: toolAabb.minTime, price: toolAabb.maxPrice },
          { timestamp: toolAabb.maxTime, price: toolAabb.minPrice },
        ];

        const cullingState = getToolCullingState(boundingPointsLogical, this._tool);

        if (cullingState !== OffScreenState.Visible) {
          this._renderer.clear();
          return;
        }
      }
    }

    const smoothedPoints = this._smoothArray(this._points, 1);
    const finalLineOptions = options.line as LineOptions;

    let finalBackgroundData: { color: string } | undefined;
    if (options.background && options.background.color) {
      finalBackgroundData = { color: options.background.color };
    }

    const polygonRendererData: PolygonRendererData = {
      points: smoothedPoints,
      line: finalLineOptions,
      background: finalBackgroundData,
      hitTestBackground: false,
      toolDefaultHoverCursor: options.defaultHoverCursor as PaneCursorType | undefined,
      toolDefaultDragCursor: options.defaultDragCursor as PaneCursorType | undefined,
    };

    this._polygonRenderer.setData(polygonRendererData);
    (this._renderer as CompositeRenderer<HorzScaleItem>).append(this._polygonRenderer);
    this._addAnchors(this._renderer as CompositeRenderer<HorzScaleItem>);
  }

  protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
    if (this._points.length === 0) return;

    const avgX = this._points.reduce((sum, point) => sum + point.x, 0) / this._points.length;
    const avgY = this._points.reduce((sum, point) => sum + point.y, 0) / this._points.length;

    const centerAnchor = new AnchorPoint(avgX, avgY, 0, true);
    const anchorData = {
      points: [centerAnchor],
      pointsCursorType: [PaneCursorType.Grabbing],
    };

    renderer.append(this.createLineAnchor(anchorData, 0));
  }
}
