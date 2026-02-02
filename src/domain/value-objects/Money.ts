import { ValidationError } from "../errors";

export class Money {
  public readonly amount: number;
  public readonly currency: string;

  constructor(amount: number, currency: string) {
    if (!Number.isFinite(amount)) {
      throw new ValidationError("Amount must be a finite number", "amount");
    }
    if (!currency || currency.trim().length < 3) {
      throw new ValidationError("Currency must be a valid ISO code", "currency");
    }

    this.amount = amount;
    this.currency = currency.toUpperCase();
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  isNegative(): boolean {
    return this.amount < 0;
  }

  format(locale = "en-US"): string {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: this.currency,
      }).format(this.amount);
    } catch {
      return `${this.currency} ${this.amount.toFixed(2)}`;
    }
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new ValidationError("Currency mismatch", "currency", {
        expected: this.currency,
        received: other.currency,
      });
    }
  }
}
