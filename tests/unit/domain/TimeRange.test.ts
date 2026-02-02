import { describe, expect, it } from "vitest";

import { TimeRange } from "../../../src/domain/value-objects/TimeRange";

describe("TimeRange", () => {
  it("calculates duration and containment", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-01T01:00:00.000Z");
    const range = new TimeRange(start, end);

    expect(range.durationMs()).toBe(60 * 60 * 1000);
    expect(range.contains(new Date("2026-01-01T00:30:00.000Z"))).toBe(true);
  });

  it("rejects invalid ranges", () => {
    const start = new Date("2026-01-02T00:00:00.000Z");
    const end = new Date("2026-01-01T00:00:00.000Z");

    expect(() => new TimeRange(start, end)).toThrow("Start must be before end");
  });
});
