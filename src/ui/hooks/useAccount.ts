import { useCallback, useEffect, useMemo } from "react";

import { SetActiveAccountUseCase } from "@application/use-cases";
import type { Account } from "@domain/entities";
import { TokenStorage } from "@infrastructure/auth";
import { Direction, OrderType } from "@domain/enums";
import { createAccountRepository, createTradeRepository } from "@infrastructure/db/createDualRepositories";
import { db } from "@infrastructure/db/dexie/database";
import { useAccountStore } from "@ui/state";
import { useAuth } from "@ui/hooks/useAuth";
import { estimateGrossProfit } from "@lib/pnl-estimate";

// Lock to prevent concurrent syncs
let syncInProgress = false;

export function useAccount() {
  const { user } = useAuth();
  const { accounts, activeAccountId, setAccounts, setActiveAccountId, setLastAccountsSyncAt } =
    useAccountStore();

  const accountRepository = useMemo(() => createAccountRepository(user?.id), [user?.id]);
  const tradeRepository = useMemo(() => createTradeRepository(user?.id), [user?.id]);

  const loadAccounts = useCallback(async () => {
    const records = await accountRepository.list();
    setAccounts(records);
    const active = records.find((record) => record.isActive);
    setActiveAccountId(active?.id ?? null);
  }, [setAccounts, setActiveAccountId]);

  const syncFromCTrader = useCallback(async () => {
    // Prevent concurrent syncs
    if (syncInProgress) {
      console.log("[useAccount] Sync already in progress, skipping...");
      return;
    }

    syncInProgress = true;
    try {
      const token = TokenStorage.getGlobal();
      if (!token) {
        return;
      }

      const response = await fetch("/api/ctrader/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token.accessToken }),
      });
      const data = (await response.json()) as { accounts?: Record<string, unknown>[]; error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Failed to load accounts");
      }
      if (!data.accounts || data.accounts.length === 0) {
        return;
      }

      // Use transaction to prevent race conditions
      await db.transaction("rw", db.accounts, async () => {
        for (const raw of data.accounts) {
          const accountNumber = String(
            raw["accountNumber"] ??
              raw["ctidTraderAccountId"] ??
              raw["accountId"] ??
              raw["login"] ??
              raw["id"]
          );
          if (!accountNumber || accountNumber === "undefined") {
            continue;
          }
          const rawBalance =
            typeof raw["balance"] === "number"
              ? raw["balance"]
              : typeof raw["balance"] === "string"
                ? Number.parseFloat(raw["balance"])
                : undefined;
          const rawEquity =
            typeof raw["equity"] === "number"
              ? raw["equity"]
              : typeof raw["equity"] === "string"
                ? Number.parseFloat(raw["equity"])
                : undefined;
          const precision =
            typeof raw["moneyDigits"] === "number"
              ? raw["moneyDigits"]
              : typeof raw["currencyDigits"] === "number"
                ? raw["currencyDigits"]
                : typeof raw["balanceDigits"] === "number"
                  ? raw["balanceDigits"]
                  : typeof raw["digits"] === "number"
                    ? raw["digits"]
                    : 2;
          const normalizeMoney = (value?: number) => {
            if (value === undefined || Number.isNaN(value)) {
              return undefined;
            }
            if (precision > 0 && Number.isInteger(value)) {
              return value / 10 ** precision;
            }
            if (Number.isInteger(value) && value >= 1000) {
              return value / 100;
            }
            return value;
          };
          const balance = normalizeMoney(rawBalance);
          const equity = normalizeMoney(rawEquity);
          const accountType = String(
            raw["accountType"] ??
              raw["type"] ??
              raw["traderAccountType"] ??
              raw["accountTypeName"] ??
              raw["environment"] ??
              raw["environmentType"] ??
              raw["brokerType"] ??
              ""
          ).toLowerCase();
          const liveFlag =
            typeof raw["live"] === "boolean"
              ? raw["live"]
              : typeof raw["isLive"] === "boolean"
                ? raw["isLive"]
                : typeof raw["isLiveAccount"] === "boolean"
                  ? raw["isLiveAccount"]
                  : typeof raw["isDemo"] === "boolean"
                    ? !raw["isDemo"]
                    : undefined;
          const nameHint = `${raw["name"] ?? ""} ${raw["brokerName"] ?? ""} ${raw["server"] ?? ""}`.toLowerCase();
          const type =
            accountType.includes("demo") ||
            nameHint.includes("demo") ||
            liveFlag === false
              ? "Demo"
              : accountType.includes("live") ||
                  nameHint.includes("live") ||
                  liveFlag === true
                ? "Live"
                : undefined;
          const broker =
            typeof raw["brokerTitle"] === "string"
              ? raw["brokerTitle"]
              : typeof raw["brokerName"] === "string"
                ? raw["brokerName"]
                : undefined;
          const server =
            typeof raw["server"] === "string" ? raw["server"] : broker ?? undefined;
          const name =
            typeof raw["name"] === "string"
              ? raw["name"]
              : broker ?? (typeof raw["server"] === "string" ? raw["server"] : undefined);

          const existing = await accountRepository.getByAccountNumber(accountNumber);
          const record: Account = {
            ...(existing || {}), // Preserve existing fields (especially id and lastSyncAt)
            accountNumber,
            ctraderAccountId:
              typeof raw["accountId"] === "number"
                ? raw["accountId"]
                : typeof raw["ctidTraderAccountId"] === "number"
                  ? raw["ctidTraderAccountId"]
                  : existing?.ctraderAccountId,
            platform: "cTrader",
            // Preserve user-renamed name if present; otherwise use remote name
            name: existing?.name ?? name,
            broker: broker ?? existing?.broker,
            server: server ?? existing?.server,
            type: type ?? existing?.type,
            currency:
              typeof raw["currency"] === "string"
                ? raw["currency"]
                : typeof raw["depositCurrency"] === "string"
                  ? raw["depositCurrency"]
                  : existing?.currency,
            balance,
            equity,
            leverage: typeof raw["leverage"] === "number" ? raw["leverage"] : existing?.leverage,
            createdAt: existing?.createdAt ?? new Date(),
            updatedAt: new Date(),
            // lastSyncAt is reserved for trade sync; preserve existing value so
            // initial trade sync can fetch full history instead of "from now".
            lastSyncAt: existing?.lastSyncAt ?? null,
            isActive: existing?.isActive ?? false,
          };
          
          if (existing?.id) {
            await accountRepository.update(existing.id, record);
          } else {
            await accountRepository.create(record);
          }
        }
      });

      const refreshed = await accountRepository.list();
      setAccounts(refreshed);
      setLastAccountsSyncAt(new Date());
      const active = refreshed.find((record) => record.isActive) ?? refreshed[0];
      setActiveAccountId(active?.id ?? null);
    } finally {
      syncInProgress = false;
    }
  }, [accountRepository, setAccounts, setActiveAccountId, setLastAccountsSyncAt]);

  const syncTradesForAccount = useCallback(
    async (accountNumber: string, ctraderAccountId?: number) => {
      const token = TokenStorage.getGlobal();
      if (!token) {
        throw new Error("Missing cTrader token");
      }

      const existingAccount = await accountRepository.getByAccountNumber(accountNumber);
      const parseNum = (v: unknown): number | undefined => {
        if (v === undefined || v === null || v === "") return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };

      // First sync: no lastSyncAt -> full history (last 10 years).
      // Later syncs: incremental from lastSyncAt.
      const from =
        existingAccount?.lastSyncAt instanceof Date
          ? existingAccount.lastSyncAt.getTime()
          : Math.max(0, Date.now() - 10 * 365 * 24 * 60 * 60 * 1000);
      const response = await fetch("/api/ctrader/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token.accessToken,
          accountNumber,
          accountId: ctraderAccountId,
          from,
        }),
      });
      const data = (await response.json()) as { trades?: Record<string, unknown>[]; error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Failed to sync trades");
      }
      const trades = (data.trades ?? []).map((trade) => {
        const closeTime = trade["closeTime"] ? new Date(String(trade["closeTime"])) : null;
        const openPrice = parseNum(trade["openPrice"]) ?? 0;
        const closePrice = (closeTime ? parseNum(trade["closePrice"]) : undefined) ?? null;
        const symbol = String(trade["symbol"] ?? "");
        const volume = parseNum(trade["volume"]) ?? 0;
        const direction = trade["direction"] === "Sell" ? Direction.Sell : Direction.Buy;
        let grossProfit = parseNum(trade["grossProfit"]);
        let netProfit = parseNum(trade["netProfit"]);

        if (closeTime && (grossProfit === undefined || netProfit === undefined)) {
          const entryPrice = parseNum(trade["entryPrice"]) ?? openPrice;
          const close = closePrice ?? openPrice;
          if (entryPrice != null && close != null && volume > 0) {
            const closingDir = direction === Direction.Sell ? "Sell" : "Buy";
            const openingDir = closingDir === "Sell" ? "Buy" : "Sell";
            const estimated = estimateGrossProfit(
              entryPrice,
              close,
              volume,
              openingDir,
              symbol
            );
            grossProfit = grossProfit ?? estimated;
            netProfit =
              netProfit ??
              estimated +
                (parseNum(trade["commission"]) ?? 0) +
                (parseNum(trade["swap"]) ?? 0) +
                (parseNum(trade["fee"]) ?? 0);
          }
        }

        return {
          accountId: accountNumber,
          ticketId: String(trade["ticketId"] ?? ""),
          symbol,
          direction,
          orderType: OrderType.Market,
          openTime: new Date(String(trade["openTime"] ?? "")),
          closeTime,
          openPrice,
          closePrice,
          entryPrice: parseNum(trade["entryPrice"]) ?? null,
          volume,
          commission: parseNum(trade["commission"]),
          swap: parseNum(trade["swap"]),
          fee: parseNum(trade["fee"]),
          grossProfit,
          netProfit,
          percentGain: parseNum(trade["percentGain"]),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });
      await tradeRepository.bulkUpsert(trades);

      const existing = await accountRepository.getByAccountNumber(accountNumber);
      if (existing?.id) {
        await accountRepository.update(existing.id, { lastSyncAt: new Date() });
        const refreshed = await accountRepository.list();
        setAccounts(refreshed);
      }
    },
    [accountRepository, tradeRepository, setAccounts]
  );

  const setActive = useCallback(
    async (accountId: number) => {
      const useCase = new SetActiveAccountUseCase(accountRepository);
      await useCase.execute(accountId);
      setActiveAccountId(accountId);
      const refreshed = await accountRepository.list();
      setAccounts(refreshed);
    },
    [accountRepository, setAccounts, setActiveAccountId]
  );

  const renameAccount = useCallback(
    async (accountId: number, name: string) => {
      await accountRepository.update(accountId, { name, updatedAt: new Date() });
      const refreshed = await accountRepository.list();
      setAccounts(refreshed);
    },
    [accountRepository, setAccounts]
  );

  const activeAccount: Account | undefined = accounts.find(
    (account) => account.id === activeAccountId
  );

  useEffect(() => {
    const run = async () => {
      await loadAccounts();
      const current = await accountRepository.list();
      if (current.length === 0) {
        try {
          await syncFromCTrader();
        } catch {
          // ignore sync failures; UI will show no accounts
        }
      }
    };
    void run();
  }, [loadAccounts, syncFromCTrader]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "ctrader-linked") {
        void syncFromCTrader();
      }
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, [syncFromCTrader]);

  return {
    accounts,
    activeAccount,
    activeAccountId,
    loadAccounts,
    syncFromCTrader,
    syncTradesForAccount,
    renameAccount,
    setActive,
  };
}
