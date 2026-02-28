"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTradePanel } from "@ui/providers";
import { useAccount } from "@ui/hooks";
import { useTradesByQuery } from "@ui/hooks/useTradesByQuery";
import { TradePanelContent } from "./TradePanelContent";

const DESKTOP_BREAKPOINT_PX = 768;
const DEFAULT_DESKTOP_PANEL_WIDTH_PX = 28 * 16; // 28rem
const MAX_DESKTOP_PANEL_WIDTH_RATIO = 0.7;
const PANEL_WIDTH_STORAGE_KEY = "trade-panel-desktop-width";
const PANEL_WIDTH_CSS_VAR = "--trade-panel-desktop-width";

/**
 * TradePanel - Side panel (no overlay); main content and panel both stay interactive
 *
 * - Renders as a column next to main content when open
 * - Large screens: resizable panel (default width 28rem)
 * - Small screens: panel full width of its column
 * - Keyboard: Escape to close
 */
export function TradePanel() {
  const { isOpen, title, tradeIds, query, closePanel } = useTradePanel();
  const { activeAccount } = useAccount();
  const [isExpanded, setIsExpanded] = useState(false);
  const [desktopPanelWidth, setDesktopPanelWidth] = useState(DEFAULT_DESKTOP_PANEL_WIDTH_PX);
  const [isResizing, setIsResizing] = useState(false);
  const desktopPanelWidthRef = useRef(desktopPanelWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const accountNumber = activeAccount?.accountNumber ?? null;

  useEffect(() => {
    desktopPanelWidthRef.current = desktopPanelWidth;
  }, [desktopPanelWidth]);

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
    const rawStoredWidth = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (rawStoredWidth) {
      const storedWidth = Number(rawStoredWidth);
      if (Number.isFinite(storedWidth)) {
        setDesktopPanelWidth(clampDesktopWidth(storedWidth));
      }
    } else {
      setDesktopPanelWidth(clampDesktopWidth(DEFAULT_DESKTOP_PANEL_WIDTH_PX));
    }

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

  const effectiveQuery = useMemo((): import("@application/ports/repositories").TradeQuery | null => {
    if (!accountNumber) return null;
    if (tradeIds && tradeIds.length > 0) {
      return { accountId: accountNumber, ids: tradeIds };
    }
    if (query) {
      return { ...query, accountId: query.accountId ?? accountNumber };
    }
    return null;
  }, [accountNumber, tradeIds, query]);

  const { trades: rawTrades, isLoading } = useTradesByQuery(effectiveQuery);

  // When opened by query (e.g. from dashboard cards), show only closed trades so count matches dashboard
  const trades = useMemo(() => {
    if (tradeIds && tradeIds.length > 0) return rawTrades;
    return rawTrades.filter((t) => t.closeTime);
  }, [rawTrades, tradeIds]);

  const handleClose = useCallback(() => {
    setIsExpanded(false);
    closePanel();
  }, [closePanel]);

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
    setIsResizing(false);
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

  if (!isOpen) return null;

  const panelBody = (
    <TradePanelContent
      title={title}
      trades={trades}
      isLoading={isLoading}
      isExpanded={isExpanded}
      canResetToDefaultSize={desktopPanelWidth > DEFAULT_DESKTOP_PANEL_WIDTH_PX}
      onToggleExpanded={() => setIsExpanded((v) => !v)}
      onResetToDefaultSize={handleResetPanelWidth}
      onClosePanel={handleClose}
    />
  );

  if (isExpanded) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 p-2 backdrop-blur-sm md:p-4">
        <div
          className="mx-auto flex h-full w-full max-w-[1800px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          role="complementary"
          aria-labelledby="trade-panel-title"
        >
          {panelBody}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-screen w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background md:w-[var(--trade-panel-desktop-width)] md:min-w-[28rem] md:max-w-[70vw]"
      style={{ [PANEL_WIDTH_CSS_VAR]: `${desktopPanelWidth}px` } as CSSProperties}
      role="complementary"
      aria-labelledby="trade-panel-title"
    >
      <div
        className="absolute inset-y-0 left-0 hidden w-3 -translate-x-1/2 touch-none items-center justify-center md:flex"
        role="separator"
        aria-label="Resize trade panel"
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
