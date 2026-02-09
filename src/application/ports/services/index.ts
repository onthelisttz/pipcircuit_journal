/**
 * Service Interfaces (Ports)
 *
 * These interfaces define the contract for external services.
 * Implementations are provided in the Infrastructure layer.
 */

export type {
  ICTraderAPI,
  CTraderTokenResponse,
  CTraderAccountInfo,
  CTraderTradeRecord,
  CTraderBarRecord,
} from "./ICTraderAPI";
export type {
  IAuthService,
  AuthSession,
  AuthUser,
} from "./IAuthService";
export type {
  ISyncService,
  SyncResult,
  SyncOptions,
} from "./ISyncService";
