import { describe, expect, it } from "vitest";

import { DateRange } from "../../../src/domain/value-objects/DateRange";

describe("DateRange", () => {
  it("returns ISO range and containment", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-02T00:00:00.000Z");
    const range = new DateRange(start, end);

    expect(range.toISOStringRange()).toEqual({
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-02T00:00:00.000Z",
    });
    expect(range.contains(new Date("2026-01-01T12:00:00.000Z"))).toBe(true);
  });

  it("rejects invalid ranges", () => {
    const start = new Date("2026-01-03T00:00:00.000Z");
    const end = new Date("2026-01-02T00:00:00.000Z");

    expect(() => new DateRange(start, end)).toThrow("Start must be before end");
  });
});
