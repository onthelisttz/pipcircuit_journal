import type { ITradeRepository, IAccountRepository } from "@application/ports/repositories";
import type { Trade, Account } from "@domain/entities";

export interface BrokerSymbolAnalysis {
  broker: string;
  symbols: string[];
  firstTradeDate: Date;
  lastTradeDate: Date;
  totalTrades: number;
}

export interface AnalyzeTradesResult {
  brokers: BrokerSymbolAnalysis[];
  totalBrokers: number;
  totalSymbols: number;
}

/**
 * AnalyzeTradesForBarSyncUseCase
 *
 * Analyzes trades to determine:
 * - Unique brokers
 * - Unique symbols per broker
 * - First trade date per broker (to calculate sync start date)
 * - Date ranges for sync
 */
export class AnalyzeTradesForBarSyncUseCase {
  constructor(
    private readonly tradeRepository: ITradeRepository,
    private readonly accountRepository: IAccountRepository
  ) {}

  async execute(userId?: string, accountIds?: string[]): Promise<AnalyzeTradesResult> {
    // Get all accounts to map accountId -> broker
    const accounts = await this.accountRepository.list();
    const accountMap = new Map<string, Account>();
    const brokerMap = new Map<string, Set<string>>(); // broker -> Set<accountId>

    console.log(`[AnalyzeTrades] Found ${accounts.length} accounts`);
    
    for (const account of accounts) {
      if (account.accountNumber) {
        accountMap.set(account.accountNumber, account);
        
        // Group accounts by broker - prioritize broker field, fallback to name/server/platform
        const broker = account.broker || 
                      (account.name && account.name !== account.accountNumber ? account.name : null) ||
                      account.server || 
                      account.platform || 
                      "Unknown";
        
        console.log(`[AnalyzeTrades] Account ${account.accountNumber}: broker="${broker}" (from: ${account.broker ? 'broker' : account.name ? 'name' : account.server ? 'server' : 'platform'})`);
        
        if (!brokerMap.has(broker)) {
          brokerMap.set(broker, new Set());
        }
        brokerMap.get(broker)!.add(account.accountNumber);
      }
    }

    // Get trades - filter by accountIds if provided
    const tradeQuery = accountIds ? { accountId: accountIds[0] } : undefined;
    const trades = await this.tradeRepository.list(tradeQuery);

    console.log(`[AnalyzeTrades] Found ${trades.length} trades`);

    if (trades.length === 0) {
      console.log("[AnalyzeTrades] No trades found, returning empty result");
      return {
        brokers: [],
        totalBrokers: 0,
        totalSymbols: 0,
      };
    }

    // Group trades by broker
    const brokerData = new Map<string, {
      symbols: Set<string>;
      tradeDates: Date[];
      trades: Trade[];
    }>();

    for (const trade of trades) {
      // Find broker for this trade's account
      const account = accountMap.get(trade.accountId);
      const broker = account?.broker || 
                    (account?.name && account.name !== account.accountNumber ? account.name : null) ||
                    account?.server || 
                    account?.platform || 
                    "Unknown";

      if (!brokerData.has(broker)) {
        brokerData.set(broker, {
          symbols: new Set(),
          tradeDates: [],
          trades: [],
        });
      }

      const data = brokerData.get(broker)!;
      data.symbols.add(trade.symbol);
      data.trades.push(trade);

      // Collect trade dates
      const openTime = trade.openTime instanceof Date 
        ? trade.openTime 
        : new Date(trade.openTime);
      data.tradeDates.push(openTime);

      if (trade.closeTime) {
        const closeTime = trade.closeTime instanceof Date 
          ? trade.closeTime 
          : new Date(trade.closeTime);
        data.tradeDates.push(closeTime);
      }
    }

    console.log(`[AnalyzeTrades] Found ${brokerData.size} brokers with trades`);

    // Build result
    const brokers: BrokerSymbolAnalysis[] = [];

    for (const [broker, data] of brokerData.entries()) {
      if (data.tradeDates.length === 0) continue;

      const sortedDates = data.tradeDates.sort((a, b) => a.getTime() - b.getTime());
      const firstTradeDate = sortedDates[0];
      const lastTradeDate = sortedDates[sortedDates.length - 1];

      brokers.push({
        broker,
        symbols: Array.from(data.symbols).sort(),
        firstTradeDate,
        lastTradeDate,
        totalTrades: data.trades.length,
      });
    }

    // Sort brokers by first trade date (oldest first)
    brokers.sort((a, b) => a.firstTradeDate.getTime() - b.firstTradeDate.getTime());

    const totalSymbols = new Set(
      brokers.flatMap((b) => b.symbols)
    ).size;

    console.log(`[AnalyzeTrades] Result: ${brokers.length} brokers, ${totalSymbols} unique symbols`);
    for (const broker of brokers) {
      console.log(`[AnalyzeTrades]   - ${broker.broker}: ${broker.symbols.length} symbols, ${broker.totalTrades} trades`);
    }

    return {
      brokers,
      totalBrokers: brokers.length,
      totalSymbols,
    };
  }
}
