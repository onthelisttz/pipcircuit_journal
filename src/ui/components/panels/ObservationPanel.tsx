"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Expand, Minimize2, RotateCcw } from "lucide-react";
import { useObservationPanel } from "@ui/providers";
import { ObservationPanelContent } from "./ObservationPanelContent";

const DESKTOP_BREAKPOINT_PX = 768;
const DEFAULT_DESKTOP_PANEL_WIDTH_PX = 28 * 16; // 28rem
const MAX_DESKTOP_PANEL_WIDTH_RATIO = 0.7;
const PANEL_WIDTH_STORAGE_KEY = "observation-panel-desktop-width";
const TRADE_PANEL_WIDTH_STORAGE_KEY = "trade-panel-desktop-width";
const PANEL_WIDTH_CSS_VAR = "--observation-panel-desktop-width";

export function ObservationPanel() {
  const { isOpen, observationId, observationIds, closePanel, goToNext, goToPrev } = useObservationPanel();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditorOnlyExpanded, setIsEditorOnlyExpanded] = useState(false);
  const [desktopPanelWidth, setDesktopPanelWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const minPanelWidth = DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const maxPanelWidth = Math.max(
      minPanelWidth,
      Math.floor(window.innerWidth * MAX_DESKTOP_PANEL_WIDTH_RATIO)
    );
    const rawStoredWidth =
      window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ??
      window.localStorage.getItem(TRADE_PANEL_WIDTH_STORAGE_KEY);
    const storedWidth = rawStoredWidth ? Number(rawStoredWidth) : DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const nextWidth = Number.isFinite(storedWidth) ? storedWidth : DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    return Math.min(Math.max(nextWidth, minPanelWidth), maxPanelWidth);
  });
  const [isResizing, setIsResizing] = useState(false);
  const desktopPanelWidthRef = useRef(desktopPanelWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const panelExpandedBeforeEditorRef = useRef(false);

  useEffect(() => {
    desktopPanelWidthRef.current = desktopPanelWidth;
  }, [desktopPanelWidth]);

  const currentIdx = observationId != null ? observationIds.indexOf(observationId) : -1;
  const canGoPrev = currentIdx > 0;
  const canGoNext = currentIdx >= 0 && currentIdx < observationIds.length - 1;

  const clampDesktopWidth = useCallback((width: number) => {
    if (typeof window === "undefined") return width;
    const minPanelWidth = DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const maxPanelWidth = Math.max(
      minPanelWidth,
      Math.floor(window.innerWidth * MAX_DESKTOP_PANEL_WIDTH_RATIO)
    );
    return Math.min(Math.max(width, minPanelWidth), maxPanelWidth);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setDesktopPanelWidth((prev) => clampDesktopWidth(prev));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampDesktopWidth]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      PANEL_WIDTH_CSS_VAR,
      `${desktopPanelWidth}px`
    );
  }, [desktopPanelWidth]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
      if (typeof document === "undefined") return;
      document.documentElement.style.removeProperty(PANEL_WIDTH_CSS_VAR);
    };
  }, []);

  useEffect(() => {
    if (!isResizing || typeof document === "undefined") return;
    const bodyStyle = document.body.style;
    const previousCursor = bodyStyle.cursor;
    const previousUserSelect = bodyStyle.userSelect;
    bodyStyle.cursor = "col-resize";
    bodyStyle.userSelect = "none";
    return () => {
      bodyStyle.cursor = previousCursor;
      bodyStyle.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  const handleClose = useCallback(() => {
    setIsExpanded(false);
    setIsEditorOnlyExpanded(false);
    panelExpandedBeforeEditorRef.current = false;
    closePanel();
  }, [closePanel]);

  useEffect(() => {
    if (!isOpen) {
      const timeoutId = window.setTimeout(() => {
        setIsExpanded(false);
        setIsEditorOnlyExpanded(false);
        panelExpandedBeforeEditorRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [isOpen]);

  const handleToggleEditorOnlyExpanded = useCallback(() => {
    if (!isEditorOnlyExpanded) {
      panelExpandedBeforeEditorRef.current = isExpanded;
      setIsExpanded(true);
      setIsEditorOnlyExpanded(true);
      return;
    }

    setIsEditorOnlyExpanded(false);
    setIsExpanded(panelExpandedBeforeEditorRef.current);
  }, [isEditorOnlyExpanded, isExpanded]);

  const handleTogglePanelExpanded = useCallback(() => {
    if (isEditorOnlyExpanded) {
      setIsEditorOnlyExpanded(false);
      setIsExpanded(false);
      panelExpandedBeforeEditorRef.current = false;
      return;
    }

    setIsExpanded((value) => !value);
  }, [isEditorOnlyExpanded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    if (isOpen) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (isOpen || !isResizing) return;
    resizeCleanupRef.current?.();
    const timeoutId = window.setTimeout(() => setIsResizing(false), 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, isResizing]);

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (typeof window === "undefined" || window.innerWidth < DESKTOP_BREAKPOINT_PX) {
        return;
      }
      event.preventDefault();
      resizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = desktopPanelWidthRef.current;
      setIsResizing(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX;
        setDesktopPanelWidth(clampDesktopWidth(startWidth + delta));
      };

      const finishResize = () => {
        setIsResizing(false);
        window.localStorage.setItem(
          PANEL_WIDTH_STORAGE_KEY,
          String(desktopPanelWidthRef.current)
        );
        removeResizeListeners();
      };

      const removeResizeListeners = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
        resizeCleanupRef.current = null;
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
      resizeCleanupRef.current = removeResizeListeners;
    },
    [clampDesktopWidth]
  );

  const handleResetPanelWidth = useCallback(() => {
    const defaultWidth = clampDesktopWidth(DEFAULT_DESKTOP_PANEL_WIDTH_PX);
    setDesktopPanelWidth(defaultWidth);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(defaultWidth));
    }
  }, [clampDesktopWidth]);

  const header = (
    <div
      className={`shrink-0 ${
        isEditorOnlyExpanded
          ? "border-b border-border bg-background/95 px-4 py-3"
          : isExpanded
            ? "rounded-xl border border-border/70 bg-card/90 px-4 py-3 shadow-sm"
            : "border-b border-border px-4 py-3"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={goToPrev}
            disabled={!canGoPrev}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous observation"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToNext}
            disabled={!canGoNext}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next observation"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-0">
          <h2 id="observation-panel-title" className="truncate text-sm font-semibold text-foreground">
            Observation {observationIds.length > 0 ? `${currentIdx + 1} / ${observationIds.length}` : ""}
          </h2>
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>{observationIds.length} observation{observationIds.length !== 1 ? "s" : ""}</span>
            {currentIdx >= 0 ? <span>Viewing #{currentIdx + 1}</span> : null}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {desktopPanelWidth > DEFAULT_DESKTOP_PANEL_WIDTH_PX ? (
            <button
              type="button"
              onClick={handleResetPanelWidth}
              className="hidden rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex"
              aria-label="Reset panel to default width"
              title="Reset to default width"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleTogglePanelExpanded}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={isExpanded ? "Exit full page" : "Expand to full page"}
            title={isExpanded ? "Exit full page" : "Expand to full page"}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Expand className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  if (!isOpen || !observationId) return null;

  const panelBody = (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        isEditorOnlyExpanded
          ? "bg-background"
          : isExpanded
            ? "gap-3 bg-muted/20 p-3 md:p-4"
            : ""
      }`}
    >
      {header}
      <ObservationPanelContent
        observationId={observationId}
        onClose={handleClose}
        isEditorOnlyExpanded={isEditorOnlyExpanded}
        onToggleEditorOnlyExpanded={handleToggleEditorOnlyExpanded}
      />
    </div>
  );

  if (isExpanded) {
    return (
      <div
        className={`fixed inset-0 z-50 ${
          isEditorOnlyExpanded ? "bg-background" : "bg-background/80 p-2 backdrop-blur-sm md:p-4"
        }`}
      >
        <div
          className={`flex h-full w-full flex-col overflow-hidden bg-background ${
            isEditorOnlyExpanded
              ? ""
              : "mx-auto max-w-[1800px] rounded-2xl border border-border shadow-2xl"
          }`}
          role="complementary"
          aria-labelledby="observation-panel-title"
        >
          {panelBody}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-screen w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background md:w-[var(--observation-panel-desktop-width)] md:min-w-[28rem] md:max-w-[70vw]"
      style={{ [PANEL_WIDTH_CSS_VAR]: `${desktopPanelWidth}px` } as CSSProperties}
      role="complementary"
      aria-labelledby="observation-panel-title"
    >
      <div
        className="absolute inset-y-0 left-0 z-10 hidden w-4 cursor-col-resize touch-none items-center justify-center md:flex"
        role="separator"
        aria-label="Resize observation panel"
        aria-orientation="vertical"
        onPointerDown={handleResizeStart}
      >
        <span
          className={`h-full w-px transition-colors ${
            isResizing ? "bg-primary/70" : "bg-border/70 hover:bg-primary/50"
          }`}
        />
      </div>
      {panelBody}
    </div>
  );
}
