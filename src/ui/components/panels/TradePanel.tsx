"use client";

import { useEffect, useMemo } from "react";
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

  const effectiveQuery = useMemo((): import("@application/ports/repositories").TradeQuery | null => {
    if (!activeAccount?.accountNumber) return null;
    if (tradeIds && tradeIds.length > 0) {
      return { accountId: activeAccount.accountNumber, ids: tradeIds };
    }
    if (query) {
      return { ...query, accountId: query.accountId ?? activeAccount.accountNumber };
    }
    return null;
  }, [activeAccount?.accountNumber, tradeIds, query]);

  const { trades: rawTrades, isLoading } = useTradesByQuery(effectiveQuery);

  // When opened by query (e.g. from dashboard cards), show only closed trades so count matches dashboard
  const trades = useMemo(() => {
    if (tradeIds && tradeIds.length > 0) return rawTrades;
    return rawTrades.filter((t) => t.closeTime);
  }, [rawTrades, tradeIds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    if (isOpen) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closePanel]);

  if (!isOpen) return null;

  return (
    <div
      className="flex h-screen w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background md:w-[min(50%,28rem)]"
      role="complementary"
      aria-labelledby="trade-panel-title"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 id="trade-panel-title" className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        <button
          onClick={closePanel}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close panel"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <TradePanelContent
        trades={trades}
        isLoading={isLoading}
        onClose={closePanel}
      />
    </div>
  );
}
