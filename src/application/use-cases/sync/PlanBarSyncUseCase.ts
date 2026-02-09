import type { ISymbolSyncProgressRepository } from "@application/ports/repositories";
import type { SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import type { BrokerSymbolAnalysis } from "./AnalyzeTradesForBarSyncUseCase";

export interface SyncPlan {
  broker: string;
  symbol: string;
  startDate: Date;
  endDate: Date;
  progressRecord: SymbolSyncProgress;
}

export interface PlanBarSyncResult {
  plans: SyncPlan[];
  totalPlans: number;
  brokers: string[];
  symbols: string[];
}

export interface PlanBarSyncParams {
  analysis: BrokerSymbolAnalysis[];
  /** Days before first trade to start syncing (default: 14) */
  daysBeforeFirstTrade?: number;
  /** Whether to include symbols that already have completed sync */
  includeCompleted?: boolean;
}

/**
 * PlanBarSyncUseCase
 *
 * Creates sync plans based on trade analysis:
 * - Creates SymbolSyncProgress records for each broker+symbol combination
 * - Calculates sync date ranges (firstTrade - 14 days to now)
 * - Returns sync plans ready for execution
 */
export class PlanBarSyncUseCase {
  constructor(
    private readonly progressRepository: ISymbolSyncProgressRepository
  ) {}

  async execute(params: PlanBarSyncParams): Promise<PlanBarSyncResult> {
    console.log(`[PlanBarSync] Starting execution with ${params.analysis.length} brokers`);
    const { analysis, daysBeforeFirstTrade = 14, includeCompleted = false } = params;
    const plans: SyncPlan[] = [];
    const brokers = new Set<string>();
    const symbols = new Set<string>();

    for (const brokerAnalysis of analysis) {
      console.log(`[PlanBarSync] Processing broker: ${brokerAnalysis.broker} with ${brokerAnalysis.symbols.length} symbols`);
      brokers.add(brokerAnalysis.broker);

      // Calculate sync start date (first trade - daysBeforeFirstTrade)
      const startDate = new Date(brokerAnalysis.firstTradeDate);
      startDate.setDate(startDate.getDate() - daysBeforeFirstTrade);

      // End date is now (or last trade date if later)
      const endDate = new Date();
      if (brokerAnalysis.lastTradeDate > endDate) {
        endDate.setTime(brokerAnalysis.lastTradeDate.getTime());
      }

      // Batch create progress records for better performance
      const progressRecordsToUpsert: SymbolSyncProgress[] = [];

      console.log(`[PlanBarSync] Processing ${brokerAnalysis.symbols.length} symbols for ${brokerAnalysis.broker}`);
      for (let i = 0; i < brokerAnalysis.symbols.length; i++) {
        const symbol = brokerAnalysis.symbols[i];
        console.log(`[PlanBarSync] Processing symbol ${i + 1}/${brokerAnalysis.symbols.length}: ${symbol}`);
        
        try {
          symbols.add(symbol);

          // Check if progress record already exists
          const existing = await this.progressRepository.getByBrokerAndSymbol(
            brokerAnalysis.broker,
            symbol
          );
          console.log(`[PlanBarSync] Existing record for ${symbol}:`, existing ? { id: existing.id, status: existing.status } : null);

          // Skip if completed and includeCompleted is false
          if (existing?.status === "completed" && !includeCompleted) {
            console.log(`[PlanBarSync] Skipping ${symbol} (already completed)`);
            continue;
          }

          // Create or update progress record
          const progressRecord: SymbolSyncProgress = existing || {
            broker: brokerAnalysis.broker,
            symbol,
            status: "pending" as SymbolSyncStatus,
            totalBars: 0,
            firstBarDate: null,
            lastBarDate: null,
            lastSyncTime: null,
            progressPercent: 0,
          };

          // Update with sync date range if new
          if (!existing) {
            progressRecord.firstBarDate = startDate;
            progressRecord.lastBarDate = endDate;
            console.log(`[PlanBarSync] New record for ${symbol} with dates: ${startDate.toISOString()} to ${endDate.toISOString()}`);
          } else if (existing.status === "pending" || existing.status === "failed") {
            // Update date range for retry
            progressRecord.firstBarDate = startDate;
            progressRecord.lastBarDate = endDate;
            console.log(`[PlanBarSync] Updating existing ${symbol} record for retry`);
          }

          // Collect for batch upsert
          progressRecordsToUpsert.push(progressRecord);
          console.log(`[PlanBarSync] Added ${symbol} to upsert list (total: ${progressRecordsToUpsert.length})`);

          plans.push({
            broker: brokerAnalysis.broker,
            symbol,
            startDate,
            endDate,
            progressRecord,
          });
        } catch (err) {
          console.error(`[PlanBarSync] Error processing symbol ${symbol}:`, err);
          // Continue with next symbol even if one fails
        }
      }
      
      console.log(`[PlanBarSync] Finished processing symbols. Total records to upsert: ${progressRecordsToUpsert.length}`);

      // Batch upsert all progress records at once
      if (progressRecordsToUpsert.length > 0) {
        console.log(`[PlanBarSync] Upserting ${progressRecordsToUpsert.length} progress records for ${brokerAnalysis.broker}`);
        try {
          const repo = this.progressRepository as any;
          if (repo.upsertMany) {
            console.log(`[PlanBarSync] Using batch upsertMany`);
            await repo.upsertMany(progressRecordsToUpsert);
            console.log(`[PlanBarSync] Batch upsert completed`);
          } else {
            console.log(`[PlanBarSync] Using individual upserts`);
            // Fallback to individual upserts
            await Promise.all(progressRecordsToUpsert.map(record => {
              console.log(`[PlanBarSync] Upserting ${record.broker}:${record.symbol}`);
              return this.progressRepository.upsert(record);
            }));
            console.log(`[PlanBarSync] Individual upserts completed`);
          }
          
          // Verify records were created (with a small delay to ensure transaction is committed)
          await new Promise(resolve => setTimeout(resolve, 100));
          console.log(`[PlanBarSync] Verifying ${progressRecordsToUpsert.length} records were created...`);
          for (const record of progressRecordsToUpsert) {
            try {
              const verify = await this.progressRepository.getByBrokerAndSymbol(record.broker, record.symbol);
              if (verify) {
                console.log(`[PlanBarSync] ✓ Verified: ${record.broker}:${record.symbol} exists (id: ${verify.id}, status: ${verify.status})`);
              } else {
                console.error(`[PlanBarSync] ✗ ERROR: ${record.broker}:${record.symbol} was not created!`);
              }
            } catch (err) {
              console.error(`[PlanBarSync] ✗ ERROR verifying ${record.broker}:${record.symbol}:`, err);
            }
          }
        } catch (error) {
          console.error(`[PlanBarSync] ERROR during upsert:`, error);
          throw error; // Re-throw to see the error
        }
      } else {
        console.warn(`[PlanBarSync] No records to upsert for ${brokerAnalysis.broker}!`);
      }
    }

    console.log(`[PlanBarSync] Execution completed: ${plans.length} plans, ${brokers.size} brokers, ${symbols.size} symbols`);
    
    return {
      plans,
      totalPlans: plans.length,
      brokers: Array.from(brokers).sort(),
      symbols: Array.from(symbols).sort(),
    };
  }

  /**
   * Get sync plans for a specific broker
   */
  async getPlansForBroker(broker: string): Promise<SyncPlan[]> {
    const progressRecords = await this.progressRepository.getByBroker(broker);
    const plans: SyncPlan[] = [];

    for (const progress of progressRecords) {
      const startDate = progress.firstBarDate || new Date();
      const endDate = progress.lastBarDate || new Date();

      plans.push({
        broker: progress.broker,
        symbol: progress.symbol,
        startDate,
        endDate,
        progressRecord: progress,
      });
    }

    return plans;
  }

  /**
   * Get sync plans by status
   */
  async getPlansByStatus(status: SymbolSyncStatus): Promise<SyncPlan[]> {
    const progressRecords = await this.progressRepository.getByStatus(status);
    const plans: SyncPlan[] = [];

    for (const progress of progressRecords) {
      const startDate = progress.firstBarDate || new Date();
      const endDate = progress.lastBarDate || new Date();

      plans.push({
        broker: progress.broker,
        symbol: progress.symbol,
        startDate,
        endDate,
        progressRecord: progress,
      });
    }

    return plans;
  }
}
