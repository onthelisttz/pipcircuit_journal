const tokenKey = (accountNumber: string) => `ctrader_token_${accountNumber}`;

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class TokenStorage {
  static get(accountNumber: string): StoredToken | null {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(tokenKey(accountNumber));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as StoredToken;
    } catch {
      return null;
    }
  }

  static set(accountNumber: string, token: StoredToken): void {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(tokenKey(accountNumber), JSON.stringify(token));
  }

  static remove(accountNumber: string): void {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(tokenKey(accountNumber));
  }

  static getGlobal(): StoredToken | null {
    return this.get("ctid");
  }

  static setGlobal(token: StoredToken): void {
    this.set("ctid", token);
  }

  static removeGlobal(): void {
    this.remove("ctid");
  }
}
