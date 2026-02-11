"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTradePanel } from "@ui/providers";
import { useAccount } from "@ui/hooks";
import { useTradesByQuery } from "@ui/hooks/useTradesByQuery";
import { TradePanelContent } from "./TradePanelContent";

/**
 * TradePanel - Side panel (no overlay); main content and panel both stay interactive
 *
 * - Renders as a column next to main content when open
 * - Large screens: panel ~50% width
 * - Small screens: panel full width of its column
 * - Keyboard: Escape to close
 */
export function TradePanel() {
  const { isOpen, title, tradeIds, query, closePanel } = useTradePanel();
  const { activeAccount } = useAccount();
  const [isExpanded, setIsExpanded] = useState(false);
  const accountNumber = activeAccount?.accountNumber ?? null;

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

  if (!isOpen) return null;

  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden bg-background ${
        isExpanded
          ? "fixed inset-0 z-50 h-screen w-screen"
          : "h-screen w-full border-l border-border md:w-[min(50%,28rem)]"
      }`}
      role="complementary"
      aria-labelledby="trade-panel-title"
    >
      <div
        className={`flex shrink-0 items-center justify-between border-b border-border ${
          isExpanded ? "px-4 py-2.5" : "px-3 py-2"
        }`}
      >
        <h2
          id="trade-panel-title"
          className={`truncate font-semibold text-foreground ${isExpanded ? "text-base" : "text-sm"}`}
        >
          {title}
        </h2>
        <button
          onClick={handleClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <TradePanelContent
        trades={trades}
        isLoading={isLoading}
        isExpanded={isExpanded}
        onToggleExpanded={() => setIsExpanded((v) => !v)}
      />
    </div>
  );
}
