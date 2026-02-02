import { describe, expect, it } from "vitest";

import { Symbol } from "../../../src/domain/value-objects/Symbol";

describe("Symbol", () => {
  it("normalizes symbol to uppercase", () => {
    const symbol = new Symbol("eurusd");
    expect(symbol.toString()).toBe("EURUSD");
  });

  it("rejects short values", () => {
    expect(() => new Symbol("ab")).toThrow("Symbol must be at least 3 characters");
  });
});
