"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Copy, Plus, X } from "lucide-react";

export interface ChartPane {
  id: string;
  symbol: string;
  broker?: string;
  timeframe?: string;
}

export type LayoutType =
  | "single"
  | "horizontal-2"
  | "vertical-2"
  | "grid-2x2"
  | "left-1-right-2"
  | "top-1-bottom-2";

export interface ChartTab {
  id: string;
  layout: LayoutType;
  panes: ChartPane[];
  /** Active pane index (the one the tab label reflects) */
  activePaneIndex: number;
}

export interface ChartTabBarProps {
  tabs: ChartTab[];
  activeTabId: string;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: () => void;
  onTabDuplicate: (tabId: string) => void;
  onTabReorder: (tabs: ChartTab[]) => void;
}

function paneLabel(tab: ChartTab): string {
  const pane = tab.panes[tab.activePaneIndex] ?? tab.panes[0];
  if (!pane?.symbol) return "Select Symbol";
  return pane.timeframe ? `${pane.symbol} · ${pane.timeframe}` : pane.symbol;
}

export function ChartTabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabAdd,
  onTabDuplicate,
  onTabReorder,
}: ChartTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId]);

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (!contextRef.current?.contains(e.target as Node)) setContextMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const canClose = tabs.length > 1;

  // --- Drag handlers ---
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
    // Make the drag image slightly transparent
    const el = e.currentTarget as HTMLElement;
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragIndexRef.current === null) return;
      if (index !== dropIndex) setDropIndex(index);
    },
    [dropIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = dragIndexRef.current;
      dragIndexRef.current = null;
      setDropIndex(null);
      if (fromIndex === null || fromIndex === toIndex) return;
      const reordered = [...tabs];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      onTabReorder(reordered);
    },
    [tabs, onTabReorder]
  );

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDropIndex(null);
  }, []);

  return (
    <div className="relative flex items-center gap-0.5 border-b border-border">
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDropTarget = dropIndex === index && dragIndexRef.current !== index;
          return (
            <button
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              draggable
              onClick={() => onTabSelect(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && canClose) {
                  e.preventDefault();
                  onTabClose(tab.id);
                }
              }}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`group relative flex h-8 shrink-0 items-center gap-2 px-3 text-xs font-medium transition-all ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              } ${isDropTarget ? "bg-primary/5" : ""}`}
            >
              {/* Active tab bottom accent */}
              {isActive && (
                <div className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
              <span className="max-w-[160px] truncate">{paneLabel(tab)}</span>
              {canClose && (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${paneLabel(tab)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      onTabClose(tab.id);
                    }
                  }}
                  className={`flex h-4 w-4 items-center justify-center rounded-sm transition-colors ${
                    isActive
                      ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                      : "text-transparent group-hover:text-muted-foreground group-hover:hover:bg-muted group-hover:hover:text-foreground"
                  }`}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onTabAdd}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Open new symbol tab"
        aria-label="Add symbol tab"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="fixed z-[9999] min-w-[140px] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              onTabDuplicate(contextMenu.tabId);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          {canClose && (
            <button
              type="button"
              onClick={() => {
                onTabClose(contextMenu.tabId);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive transition-colors hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
