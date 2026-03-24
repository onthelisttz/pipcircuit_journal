"use client";

import { useState, useRef, useEffect } from "react";
import { LayoutGrid } from "lucide-react";
import type { LayoutType } from "./ChartTabBar";

interface LayoutOption {
  id: LayoutType;
  label: string;
  /** Short label for the dropdown grid */
  short: string;
  /** Grid areas string for SVG visualization */
  areas: number[][];
}

const LAYOUTS: LayoutOption[] = [
  { id: "single", label: "Single", short: "1", areas: [[1]] },
  { id: "horizontal-2", label: "2 Horizontal", short: "1|1", areas: [[1, 2]] },
  { id: "vertical-2", label: "2 Vertical", short: "1/1", areas: [[1], [2]] },
  { id: "grid-2x2", label: "2×2 Grid", short: "2×2", areas: [[1, 2], [3, 4]] },
  { id: "left-1-right-2", label: "1 + 2 Right", short: "1+2R", areas: [[1, 2], [1, 3]] },
  { id: "top-1-bottom-2", label: "1 + 2 Bottom", short: "1+2B", areas: [[1, 1], [2, 3]] },
];

function MiniLayoutIcon({ areas, isActive }: { areas: number[][]; isActive: boolean }) {
  const rows = areas.length;
  const cols = Math.max(...areas.map((r) => r.length));
  const gap = 1.5;
  const w = 32;
  const h = 22;
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;

  // Build rectangles from unique cell IDs with proper merging
  const drawn = new Set<number>();
  const rects: { x: number; y: number; w: number; h: number; id: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = areas[r][c];
      if (drawn.has(id)) continue;
      drawn.add(id);

      // Find extent of this id
      let endR = r;
      let endC = c;
      while (endR + 1 < rows && areas[endR + 1][c] === id) endR++;
      while (endC + 1 < cols && areas[r][endC + 1] === id) endC++;

      const x = c * (cellW + gap);
      const y = r * (cellH + gap);
      const rw = (endC - c + 1) * cellW + (endC - c) * gap;
      const rh = (endR - r + 1) * cellH + (endR - r) * gap;
      rects.push({ x, y, w: rw, h: rh, id });
    }
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {rects.map((rect) => (
        <rect
          key={rect.id}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={1.5}
          className={
            isActive
              ? "fill-primary/25 stroke-primary/70"
              : "fill-muted/50 stroke-border"
          }
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

export interface ChartLayoutSelectorProps {
  value: LayoutType;
  onChange: (layout: LayoutType) => void;
  disabled?: boolean;
}

export function ChartLayoutSelector({
  value,
  onChange,
  disabled = false,
}: ChartLayoutSelectorProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const currentLayout = LAYOUTS.find((l) => l.id === value) ?? LAYOUTS[0];

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={`flex h-7 items-center gap-2 rounded border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? "border-primary/60 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:bg-muted"
        }`}
        title="Change layout"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{currentLayout.label}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-1 w-[240px] rounded-md border border-border bg-popover p-2 shadow-xl"
        >
          <div className="grid grid-cols-3 gap-1.5">
            {LAYOUTS.map((layout) => {
              const isActive = value === layout.id;
              return (
                <button
                  key={layout.id}
                  type="button"
                  onClick={() => {
                    onChange(layout.id);
                    setOpen(false);
                  }}
                  className={`flex flex-col items-center gap-1.5 rounded-md px-2 py-2 transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  title={layout.label}
                >
                  <MiniLayoutIcon areas={layout.areas} isActive={isActive} />
                  <span className="text-[9px] font-medium leading-none whitespace-nowrap">
                    {layout.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
