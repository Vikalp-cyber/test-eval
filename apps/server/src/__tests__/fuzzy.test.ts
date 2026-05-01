/// <reference types="bun" />
import { test, expect, describe } from "bun:test";
import {
  levenshtein,
  tokenSetRatio,
  fuzzyMatch,
  normalizeMedText,
  normalize,
} from "../services/fuzzy.js";

describe("levenshtein", () => {
  test("identical strings → 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  test("empty vs non-empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  test("single edit", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
    expect(levenshtein("cat", "cats")).toBe(1);
    expect(levenshtein("cat", "ca")).toBe(1);
  });
});

describe("normalize", () => {
  test("lowercases and strips punctuation", () => {
    expect(normalize("Hello, World!")).toBe("hello world");
  });

  test("collapses whitespace", () => {
    expect(normalize("  a   b  c  ")).toBe("a b c");
  });
});

describe("tokenSetRatio", () => {
  test("identical strings → 1", () => {
    expect(tokenSetRatio("sore throat", "sore throat")).toBe(1);
  });

  test("reordered tokens → 1", () => {
    expect(tokenSetRatio("sore throat", "throat sore")).toBe(1);
  });

  test("partial overlap → intermediate score", () => {
    const score = tokenSetRatio("sore throat and cough", "sore throat");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1);
  });

  test("completely different → low score", () => {
    const score = tokenSetRatio("headache", "diabetes mellitus");
    expect(score).toBeLessThan(0.3);
  });

  test("empty strings → 1 (both empty)", () => {
    expect(tokenSetRatio("", "")).toBe(1);
  });

  test("one empty → 0", () => {
    expect(tokenSetRatio("hello", "")).toBe(0);
  });
});

describe("fuzzyMatch", () => {
  test("matches similar strings", () => {
    expect(fuzzyMatch("ibuprofen", "Ibuprofen")).toBe(true);
  });

  test("rejects very different strings", () => {
    expect(fuzzyMatch("ibuprofen", "metformin")).toBe(false);
  });
});

describe("normalizeMedText", () => {
  test("normalizes BID → twice daily", () => {
    expect(normalizeMedText("BID")).toBe("twice daily");
  });

  test("normalizes TID → three times daily", () => {
    expect(normalizeMedText("TID")).toBe("three times daily");
  });

  test("normalizes dose spacing: '10 mg' → '10mg'", () => {
    expect(normalizeMedText("10 mg")).toBe("10mg");
  });

  test("normalizes '500 mcg twice daily' correctly", () => {
    expect(normalizeMedText("500 mcg BID")).toBe("500mcg twice daily");
  });

  test("handles null → empty string", () => {
    expect(normalizeMedText(null)).toBe("");
  });
});
