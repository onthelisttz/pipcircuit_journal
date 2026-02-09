import type { ITradeRepository, IAccountRepository } from "@application/ports/repositories";
import type { SyncResult } from "@application/ports/services";
import { AnalyzeTradesForBarSyncUseCase } from "./AnalyzeTradesForBarSyncUseCase";
import { PlanBarSyncUseCase } from "./PlanBarSyncUseCase";
import type { SyncPlan } from "./PlanBarSyncUseCase";

export interface InitializeSyncParams {
  userId: string;
  /** Account IDs to sync (if not provided, syncs all accounts) */
  accountIds?: string[];
  /** Whether to force full sync */
  forceFull?: boolean;
}

export interface InitializeSyncResult extends SyncResult {
  /** Sync plans created */
  plans: SyncPlan[];
  /** Number of brokers found */
  brokers: number;
  /** Number of symbols to sync */
  symbols: number;
}

/**
 * InitializeSyncUseCase
 *
 * Initializes sync after login:
 * 1. Analyzes trades to determine what needs syncing
 * 2. Creates sync plans
 * 3. Returns plans ready for execution
 */
export class InitializeSyncUseCase {
  constructor(
    private readonly tradeRepository: ITradeRepository,
    private readonly accountRepository: IAccountRepository,
    private readonly analyzeUseCase: AnalyzeTradesForBarSyncUseCase,
    private readonly planUseCase: PlanBarSyncUseCase
  ) {}

  async execute(params: InitializeSyncParams): Promise<InitializeSyncResult> {
    const { userId, accountIds, forceFull = false } = params;

    try {
      // 1. Analyze trades to determine sync requirements
      const analysis = await this.analyzeUseCase.execute(userId, accountIds);

      if (analysis.totalBrokers === 0 || analysis.totalSymbols === 0) {
        return {
          success: true,
          plans: [],
          brokers: 0,
          symbols: 0,
          itemsSynced: 0,
          itemsFailed: 0,
        };
      }

      // 2. Create sync plans
      console.log(`[InitializeSync] Creating sync plans for ${analysis.brokers.length} brokers`);
      const planResult = await this.planUseCase.execute({
        analysis: analysis.brokers,
        daysBeforeFirstTrade: 14,
        includeCompleted: forceFull,
      });
      console.log(`[InitializeSync] Created ${planResult.plans.length} sync plans`);

      return {
        success: true,
        plans: planResult.plans,
        brokers: planResult.brokers.length,
        symbols: planResult.symbols.length,
        itemsSynced: 0, // Will be updated during sync
        itemsFailed: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
        plans: [],
        brokers: 0,
        symbols: 0,
        itemsSynced: 0,
        itemsFailed: 0,
      };
    }
  }
}
