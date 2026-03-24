"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { LayoutType, ChartPane } from "./ChartTabBar";

/* ─── Layout definitions ─── */

interface LayoutDef {
  /** Number of panes this layout needs */
  paneCount: number;
  /** CSS grid-template-areas using named areas p0, p1, p2, p3 */
  areas: string;
  /** Default column template */
  cols: string;
  /** Default row template */
  rows: string;
  /** Which axis the primary divider works on: "col" | "row" | "both" */
  dividers: DividerDef[];
}

interface DividerDef {
  axis: "col" | "row";
  /** CSS grid placement for the handle */
  gridArea: string;
  /** Which CSS variable to update */
  cssVar: string;
  cursor: string;
}

const LAYOUT_DEFS: Record<LayoutType, LayoutDef> = {
  single: {
    paneCount: 1,
    areas: `"p0"`,
    cols: "1fr",
    rows: "1fr",
    dividers: [],
  },
  "horizontal-2": {
    paneCount: 2,
    areas: `"p0 div0 p1"`,
    cols: "var(--col-split, 1fr) 4px var(--col-split2, 1fr)",
    rows: "1fr",
    dividers: [
      { axis: "col", gridArea: "div0", cssVar: "--col-split", cursor: "col-resize" },
    ],
  },
  "vertical-2": {
    paneCount: 2,
    areas: `"p0" "div0" "p1"`,
    cols: "1fr",
    rows: "var(--row-split, 1fr) 4px var(--row-split2, 1fr)",
    dividers: [
      { axis: "row", gridArea: "div0", cssVar: "--row-split", cursor: "row-resize" },
    ],
  },
  "grid-2x2": {
    paneCount: 4,
    areas: `"p0 vdiv p1" "hdiv hdiv hdiv" "p2 vdiv2 p3"`,
    cols: "var(--col-split, 1fr) 4px var(--col-split2, 1fr)",
    rows: "var(--row-split, 1fr) 4px var(--row-split2, 1fr)",
    dividers: [
      { axis: "col", gridArea: "vdiv", cssVar: "--col-split", cursor: "col-resize" },
      { axis: "row", gridArea: "hdiv", cssVar: "--row-split", cursor: "row-resize" },
    ],
  },
  "left-1-right-2": {
    paneCount: 3,
    areas: `"p0 vdiv p1" "p0 vdiv hdiv" "p0 vdiv p2"`,
    cols: "var(--col-split, 1fr) 4px var(--col-split2, 1fr)",
    rows: "var(--row-split, 1fr) 4px var(--row-split2, 1fr)",
    dividers: [
      { axis: "col", gridArea: "vdiv", cssVar: "--col-split", cursor: "col-resize" },
      { axis: "row", gridArea: "hdiv", cssVar: "--row-split", cursor: "row-resize" },
    ],
  },
  "top-1-bottom-2": {
    paneCount: 3,
    areas: `"p0 p0" "hdiv hdiv" "p1 vdiv p2"`,
    cols: "var(--col-split, 1fr) 4px var(--col-split2, 1fr)",
    rows: "var(--row-split, 1fr) 4px var(--row-split2, 1fr)",
    dividers: [
      { axis: "row", gridArea: "hdiv", cssVar: "--row-split", cursor: "row-resize" },
      { axis: "col", gridArea: "vdiv", cssVar: "--col-split", cursor: "col-resize" },
    ],
  },
};

/* ─── Pane count helper ─── */

export function paneCountForLayout(layout: LayoutType): number {
  return LAYOUT_DEFS[layout]?.paneCount ?? 1;
}

/* ─── Component ─── */

export interface ChartLayoutGridProps {
  layout: LayoutType;
  panes: ChartPane[];
  activePaneIndex: number;
  onActivePaneChange: (index: number) => void;
  renderPane: (pane: ChartPane, index: number, isActive: boolean) => ReactNode;
}

export function ChartLayoutGrid({
  layout,
  panes,
  activePaneIndex,
  onActivePaneChange,
  renderPane,
}: ChartLayoutGridProps) {
  const def = LAYOUT_DEFS[layout] ?? LAYOUT_DEFS.single;
  const gridRef = useRef<HTMLDivElement>(null);
  const [splits, setSplits] = useState<Record<string, number>>({});
  const draggingRef = useRef<{ div: DividerDef; startPos: number; startFr: number } | null>(null);

  // Reset splits when layout changes
  useEffect(() => {
    setSplits({});
  }, [layout]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, div: DividerDef) => {
      e.preventDefault();
      const grid = gridRef.current;
      if (!grid) return;

      const startPos = div.axis === "col" ? e.clientX : e.clientY;
      const total = div.axis === "col" ? grid.clientWidth : grid.clientHeight;
      const currentFr = splits[div.cssVar] ?? 50;

      draggingRef.current = { div, startPos, startFr: currentFr };

      const handleMove = (me: MouseEvent) => {
        if (!draggingRef.current) return;
        const pos = div.axis === "col" ? me.clientX : me.clientY;
        const delta = pos - draggingRef.current.startPos;
        const deltaPercent = (delta / total) * 100;
        const newFr = Math.min(80, Math.max(20, draggingRef.current.startFr + deltaPercent));
        setSplits((prev) => ({ ...prev, [div.cssVar]: newFr }));
      };

      const handleUp = () => {
        draggingRef.current = null;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = div.cursor;
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [splits]
  );

  // Build CSS variables for splits
  const style: Record<string, string> = {
    display: "grid",
    gridTemplateAreas: def.areas,
    gridTemplateColumns: def.cols,
    gridTemplateRows: def.rows,
  };

  for (const div of def.dividers) {
    const val = splits[div.cssVar];
    if (val !== undefined) {
      const complement = 100 - val;
      style[div.cssVar] = `${val}fr`;
      // Set the complementary variable
      const complementVar = div.cssVar.replace(/\d*$/, (m) => String(Number(m || "0") + 1));
      if (complementVar.endsWith("1")) {
        style[`${div.cssVar}2`] = `${complement}fr`;
      } else {
        style[complementVar] = `${complement}fr`;
      }
    }
  }

  if (def.paneCount === 1) {
    // Single pane — no grid needed
    const pane = panes[0];
    if (!pane) return null;
    return (
      <div className="flex min-h-0 flex-1 flex-col">{renderPane(pane, 0, true)}</div>
    );
  }

  return (
    <div ref={gridRef} className="min-h-0 flex-1" style={style}>
      {panes.slice(0, def.paneCount).map((pane, i) => (
        <div
          key={pane.id}
          style={{ gridArea: `p${i}` }}
          className="relative min-h-0 min-w-0 overflow-hidden transition-all"
          onClick={() => onActivePaneChange(i)}
        >
          {/* Active pane top-only accent bar */}
          <div className={`absolute inset-x-0 top-0 z-20 transition-all ${
            activePaneIndex === i && def.paneCount > 1
              ? "h-[2px] bg-primary"
              : "h-px bg-border/30"
          }`} />
          {renderPane(pane, i, activePaneIndex === i)}
        </div>
      ))}

      {def.dividers.map((div) => (
        <div
          key={div.gridArea}
          style={{ gridArea: div.gridArea, cursor: div.cursor }}
          className="group z-10 flex items-center justify-center bg-border/20 transition-all hover:bg-primary/25"
          onMouseDown={(e) => handleMouseDown(e, div)}
        >
          {/* Prominent drag handle with triple dots */}
          <div
            className={`flex items-center justify-center gap-[2px] rounded-full transition-opacity group-hover:opacity-100 opacity-40 ${
              div.axis === "col"
                ? "h-10 w-2 flex-col"
                : "h-2 w-10 flex-row"
            }`}
          >
            <div className="h-1 w-1 rounded-full bg-muted-foreground/60" />
            <div className="h-1 w-1 rounded-full bg-muted-foreground/60" />
            <div className="h-1 w-1 rounded-full bg-muted-foreground/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
