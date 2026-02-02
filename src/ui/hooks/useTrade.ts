import { useState, useEffect, useCallback } from "react";
import type { Trade } from "@domain/entities";
import { GetTradeByIdUseCase } from "@application/use-cases/trades";
import { DexieTradeRepository } from "@infrastructure/db/dexie";

const tradeRepository = new DexieTradeRepository();
const getTradeByIdUseCase = new GetTradeByIdUseCase(tradeRepository);

export function useTrade(id?: number) {
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
    }, [id]);

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
