/// <reference types="bun" />
import { test, expect, describe } from "bun:test";
import { computeCostUSD, isKnownModel, pricingFor } from "../cost.js";

describe("computeCostUSD", () => {
  test("matches expected math for Haiku 3.5", () => {
    const cost = computeCostUSD(
      { input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 },
      "claude-3-5-haiku-20241022",
    );
    expect(cost).toBeCloseTo(0.8, 6);
  });

  test("output tokens dominate cost", () => {
    const cost = computeCostUSD(
      { input: 100_000, output: 100_000, cache_read: 0, cache_write: 0 },
      "claude-3-5-haiku-20241022",
    );
    // input: 0.08, output: 0.4
    expect(cost).toBeCloseTo(0.48, 6);
  });

  test("cache reads cost less than fresh input", () => {
    const fresh = computeCostUSD(
      { input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 },
      "claude-3-5-haiku-20241022",
    );
    const cached = computeCostUSD(
      { input: 0, output: 0, cache_read: 1_000_000, cache_write: 0 },
      "claude-3-5-haiku-20241022",
    );
    expect(cached).toBeLessThan(fresh);
  });

  test("unknown model falls back to default pricing (no NaN, no zero)", () => {
    expect(isKnownModel("not-a-real-model")).toBe(false);
    const cost = computeCostUSD(
      { input: 1000, output: 1000, cache_read: 0, cache_write: 0 },
      "not-a-real-model",
    );
    expect(cost).toBeGreaterThan(0);
    expect(Number.isFinite(cost)).toBe(true);
  });

  test("pricingFor returns shape", () => {
    const p = pricingFor("claude-3-5-haiku-20241022");
    expect(p.input).toBeGreaterThan(0);
    expect(p.output).toBeGreaterThan(p.input);
  });
});
