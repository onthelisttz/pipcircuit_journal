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
  private isOnline: boolean = typeof navigator !== "undefined" ? navigator.onLine : true;
  private listeners: Set<(isOnline: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  private handleOnline = () => {
    this.isOnline = true;
    this.notifyListeners();
  };

  private handleOffline = () => {
    this.isOnline = false;
    this.notifyListeners();
  };

  private notifyListeners = () => {
    this.listeners.forEach((listener) => listener(this.isOnline));
  };

  /**
   * Check if currently online
   */
  checkOnline(): boolean {
    if (typeof navigator !== "undefined") {
      this.isOnline = navigator.onLine;
    }
    return this.isOnline;
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
   * Cleanup event listeners
   */
  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
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
