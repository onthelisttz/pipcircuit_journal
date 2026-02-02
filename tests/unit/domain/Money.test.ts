import { describe, expect, it } from "vitest";

import { Money } from "../../../src/domain/value-objects/Money";

describe("Money", () => {
  it("adds and subtracts with same currency", () => {
    const base = new Money(100, "usd");
    const profit = new Money(25, "USD");

    expect(base.add(profit).amount).toBe(125);
    expect(base.subtract(profit).amount).toBe(75);
  });

  it("rejects invalid amounts", () => {
    expect(() => new Money(Number.NaN, "USD")).toThrow("Amount");
  });

  it("rejects mismatched currencies", () => {
    const usd = new Money(10, "USD");
    const eur = new Money(5, "EUR");

    expect(() => usd.add(eur)).toThrow("Currency mismatch");
  });
});
