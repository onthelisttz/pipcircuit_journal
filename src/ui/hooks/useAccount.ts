import { useCallback, useEffect } from "react";

import { SetActiveAccountUseCase } from "@application/use-cases";
import type { Account } from "@domain/entities";
import { TokenStorage } from "@infrastructure/auth";
import { Direction, OrderType } from "@domain/enums";
import { DexieTradeRepository } from "@infrastructure/db/dexie";
import { DexieAccountRepository } from "@infrastructure/db/dexie";
import { useAccountStore } from "@ui/state";

const accountRepository = new DexieAccountRepository();
const tradeRepository = new DexieTradeRepository();

export function useAccount() {
  const { accounts, activeAccountId, setAccounts, setActiveAccountId } =
    useAccountStore();

  const loadAccounts = useCallback(async () => {
    const records = await accountRepository.list();
    setAccounts(records);
    const active = records.find((record) => record.isActive);
    setActiveAccountId(active?.id ?? null);
  }, [setAccounts, setActiveAccountId]);

  const syncFromCTrader = useCallback(async () => {
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
      const record: Account = {
        accountNumber,
        ctraderAccountId:
          typeof raw["accountId"] === "number"
            ? raw["accountId"]
            : typeof raw["ctidTraderAccountId"] === "number"
              ? raw["ctidTraderAccountId"]
              : undefined,
        platform: "cTrader",
        name,
        broker,
        server,
        type,
        currency:
          typeof raw["currency"] === "string"
            ? raw["currency"]
            : typeof raw["depositCurrency"] === "string"
              ? raw["depositCurrency"]
              : undefined,
        balance,
        equity,
        leverage: typeof raw["leverage"] === "number" ? raw["leverage"] : undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSyncAt: new Date(),
      };

      const existing = await accountRepository.getByAccountNumber(accountNumber);
      if (existing?.id) {
        await accountRepository.update(existing.id, {
          ...record,
          updatedAt: new Date(),
        });
      } else {
        await accountRepository.create(record);
      }
    }

    const refreshed = await accountRepository.list();
    setAccounts(refreshed);
    const active = refreshed.find((record) => record.isActive) ?? refreshed[0];
    setActiveAccountId(active?.id ?? null);
  }, [setAccounts, setActiveAccountId]);

  const syncTradesForAccount = useCallback(
    async (accountNumber: string, ctraderAccountId?: number) => {
      const token = TokenStorage.getGlobal();
      if (!token) {
        throw new Error("Missing cTrader token");
      }
      const response = await fetch("/api/ctrader/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token.accessToken,
          accountNumber,
          accountId: ctraderAccountId,
        }),
      });
      const data = (await response.json()) as { trades?: Record<string, unknown>[]; error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Failed to sync trades");
      }
      const trades = (data.trades ?? []).map((trade) => ({
        accountId: accountNumber,
        ticketId: String(trade["ticketId"] ?? ""),
        symbol: String(trade["symbol"] ?? ""),
        direction: trade["direction"] === "Sell" ? Direction.Sell : Direction.Buy,
        orderType: OrderType.Market,
        openTime: new Date(String(trade["openTime"] ?? "")),
        closeTime: trade["closeTime"] ? new Date(String(trade["closeTime"])) : null,
        openPrice: Number(trade["openPrice"] ?? 0),
        closePrice: trade["closePrice"] !== undefined ? Number(trade["closePrice"]) : null,
        volume: Number(trade["volume"] ?? 0),
        commission: trade["commission"] !== undefined ? Number(trade["commission"]) : undefined,
        swap: trade["swap"] !== undefined ? Number(trade["swap"]) : undefined,
        fee: trade["fee"] !== undefined ? Number(trade["fee"]) : undefined,
        grossProfit:
          trade["grossProfit"] !== undefined ? Number(trade["grossProfit"]) : undefined,
        netProfit: trade["netProfit"] !== undefined ? Number(trade["netProfit"]) : undefined,
        percentGain:
          trade["percentGain"] !== undefined ? Number(trade["percentGain"]) : undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await tradeRepository.bulkUpsert(trades);

      const existing = await accountRepository.getByAccountNumber(accountNumber);
      if (existing?.id) {
        await accountRepository.update(existing.id, { lastSyncAt: new Date() });
        const refreshed = await accountRepository.list();
        setAccounts(refreshed);
      }
    },
    [setAccounts]
  );

  const setActive = useCallback(
    async (accountId: number) => {
      const useCase = new SetActiveAccountUseCase(accountRepository);
      await useCase.execute(accountId);
      setActiveAccountId(accountId);
      const refreshed = await accountRepository.list();
      setAccounts(refreshed);
    },
    [setAccounts, setActiveAccountId]
  );

  const renameAccount = useCallback(
    async (accountId: number, name: string) => {
      await accountRepository.update(accountId, { name, updatedAt: new Date() });
      const refreshed = await accountRepository.list();
      setAccounts(refreshed);
    },
    [setAccounts]
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
