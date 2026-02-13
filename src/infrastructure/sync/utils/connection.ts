/**
 * Connection Detection Utilities
 *
 * Detects online/offline status and provides connection state management
 */

export interface ConnectionState {
  isOnline: boolean;
  lastChecked: Date;
}

class ConnectionManager {
  private browserOnline: boolean = typeof navigator !== "undefined" ? navigator.onLine : true;
  private degradedUntil = 0;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private listeners: Set<(isOnline: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  private computeOnline(now: number = Date.now()): boolean {
    return this.browserOnline && now >= this.degradedUntil;
  }

  private handleOnline = () => {
    this.browserOnline = true;
    this.degradedUntil = 0;
    this.clearRecoveryTimer();
    this.notifyListeners();
  };

  private handleOffline = () => {
    this.browserOnline = false;
    this.degradedUntil = 0;
    this.clearRecoveryTimer();
    this.notifyListeners();
  };

  private notifyListeners = () => {
    const online = this.computeOnline();
    this.listeners.forEach((listener) => listener(online));
  };

  private clearRecoveryTimer() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }
  }

  private scheduleRecovery(ms: number) {
    this.clearRecoveryTimer();
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      if (!this.browserOnline) {
        return;
      }
      if (Date.now() >= this.degradedUntil) {
        this.degradedUntil = 0;
        this.notifyListeners();
      }
    }, ms);
  };

  /**
   * Check if currently online
   */
  checkOnline(): boolean {
    if (typeof navigator !== "undefined") {
      const navOnline = navigator.onLine;
      if (this.browserOnline !== navOnline) {
        this.browserOnline = navOnline;
      }
      if (!navOnline) {
        this.degradedUntil = 0;
        this.clearRecoveryTimer();
      }
    }
    return this.computeOnline();
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return {
      isOnline: this.checkOnline(),
      lastChecked: new Date(),
    };
  }

  /**
   * Subscribe to connection state changes
   */
  subscribe(listener: (isOnline: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Report transient cloud/network failure even if navigator still says "online".
   * This temporarily puts app in offline mode to avoid request storms.
   */
  reportFailure(cooldownMs: number = 120000): void {
    if (!this.browserOnline) {
      return;
    }
    const prevOnline = this.computeOnline();
    const nextDegradedUntil = Date.now() + Math.max(1000, cooldownMs);
    this.degradedUntil = Math.max(this.degradedUntil, nextDegradedUntil);
    this.scheduleRecovery(this.degradedUntil - Date.now());
    const nextOnline = this.computeOnline();
    if (prevOnline !== nextOnline) {
      this.notifyListeners();
    }
  }

  /**
   * Report successful cloud communication and clear temporary degraded state.
   */
  reportSuccess(): void {
    if (!this.browserOnline) {
      return;
    }
    const prevOnline = this.computeOnline();
    this.degradedUntil = 0;
    this.clearRecoveryTimer();
    const nextOnline = this.computeOnline();
    if (prevOnline !== nextOnline) {
      this.notifyListeners();
    }
  }

  /**
   * Cleanup event listeners
   */
  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    this.clearRecoveryTimer();
    this.listeners.clear();
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();

/**
 * Check if currently online
 */
export function isOnline(): boolean {
  return connectionManager.checkOnline();
}

/**
 * Get current connection state
 */
export function getConnectionState(): ConnectionState {
  return connectionManager.getState();
}

/**
 * Subscribe to connection state changes
 */
export function onConnectionChange(listener: (isOnline: boolean) => void): () => void {
  return connectionManager.subscribe(listener);
}

/**
 * Mark connection as temporarily degraded after network/cloud failures.
 */
export function reportConnectionFailure(cooldownMs?: number): void {
  connectionManager.reportFailure(cooldownMs);
}

/**
 * Mark connection healthy after successful cloud communication.
 */
export function reportConnectionSuccess(): void {
  connectionManager.reportSuccess();
}
