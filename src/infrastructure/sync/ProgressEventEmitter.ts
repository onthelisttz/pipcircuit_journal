import type { SymbolSyncProgress } from "@domain/entities";

/**
 * ProgressEventEmitter - Event emitter for sync progress updates
 *
 * Allows components to subscribe to progress updates without
 * directly coupling to the sync service.
 */
class ProgressEventEmitter {
  private listeners: Set<(progress: SymbolSyncProgress) => void> = new Set();

  /**
   * Emit progress update event
   */
  emit(progress: SymbolSyncProgress): void {
    this.listeners.forEach((listener) => {
      try {
        listener(progress);
      } catch (error) {
        console.error("Error in progress listener:", error);
      }
    });
  }

  /**
   * Subscribe to progress updates
   * @returns Unsubscribe function
   */
  subscribe(listener: (progress: SymbolSyncProgress) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Get listener count (for debugging)
   */
  getListenerCount(): number {
    return this.listeners.size;
  }
}

// Singleton instance
export const progressEventEmitter = new ProgressEventEmitter();
