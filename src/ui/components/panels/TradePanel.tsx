"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

  const panelBody = (
    <TradePanelContent
      title={title}
      trades={trades}
      isLoading={isLoading}
      isExpanded={isExpanded}
      onToggleExpanded={() => setIsExpanded((v) => !v)}
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
      className="flex h-screen w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background md:w-[min(50%,28rem)]"
      role="complementary"
      aria-labelledby="trade-panel-title"
    >
      {panelBody}
    </div>
  );
}
