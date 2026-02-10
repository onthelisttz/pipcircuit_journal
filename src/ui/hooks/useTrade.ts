import { useState, useEffect, useCallback, useMemo } from "react";
import type { Trade } from "@domain/entities";
import { GetTradeByIdUseCase } from "@application/use-cases/trades";
import { createTradeRepository } from "@infrastructure/db/createDualRepositories";
import { useAuth } from "@ui/hooks/useAuth";

export function useTrade(id?: number) {
    const { user } = useAuth();
    const tradeRepository = useMemo(() => createTradeRepository(user?.id), [user?.id]);
    const getTradeByIdUseCase = useMemo(() => new GetTradeByIdUseCase(tradeRepository), [tradeRepository]);
    const [trade, setTrade] = useState<Trade | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const loadTrade = useCallback(async () => {
        if (!id) return;

        setIsLoading(true);
        setError(null);

        try {
            const result = await getTradeByIdUseCase.execute({ id });
            setTrade(result);
            if (!result) {
                throw new Error(`Trade ${id} not found`);
            }
        } catch (err) {
            setError(err instanceof Error ? err : new Error("Failed to load trade"));
            setTrade(null);
        } finally {
            setIsLoading(false);
        }
    }, [id, getTradeByIdUseCase]);

    useEffect(() => {
        void loadTrade();
    }, [loadTrade]);

    return {
        trade,
        isLoading,
        error,
        refetch: loadTrade
    };
}
