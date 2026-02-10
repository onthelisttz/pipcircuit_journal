"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Trade } from "@domain/entities";
import type { TradeQuery } from "@application/ports/repositories";
import { createTradeRepository } from "@infrastructure/db/createDualRepositories";
import { useAuth } from "@ui/hooks/useAuth";

export function useTradesByQuery(query: TradeQuery | null) {
  const { user } = useAuth();
  const tradeRepo = useMemo(() => createTradeRepository(user?.id), [user?.id]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!query) {
      setTrades([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await tradeRepo.list(query);
      setTrades(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load trades"));
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  }, [query, tradeRepo]);

  useEffect(() => {
    void load();
  }, [load]);

  return { trades, isLoading, error, refetch: load };
}
