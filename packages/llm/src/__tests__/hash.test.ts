/// <reference types="bun" />
import { test, expect, describe } from "bun:test";
import { hashStrategyConfig } from "../hash.js";
import { zeroShot } from "../strategies/zero_shot.js";
import { fewShot } from "../strategies/few_shot.js";
import { cot } from "../strategies/cot.js";

describe("hashStrategyConfig", () => {
  test("is stable across transcripts (transcript content does not affect prompt hash)", () => {
    const a = hashStrategyConfig(zeroShot("Patient A has fever."));
    const b = hashStrategyConfig(zeroShot("Patient B has cough."));
    expect(a).toBe(b);
  });

  test("changes when system prompt changes", () => {
    const original = zeroShot("x");
    const modified = { ...original, systemPrompt: original.systemPrompt + "\nExtra rule." };
    expect(hashStrategyConfig(original)).not.toBe(hashStrategyConfig(modified));
  });

  test("differs across strategies", () => {
    const z = hashStrategyConfig(zeroShot("x"));
    const f = hashStrategyConfig(fewShot("x"));
    const c = hashStrategyConfig(cot("x"));
    expect(new Set([z, f, c]).size).toBe(3);
  });

  test("hash is deterministic SHA-256 hex", () => {
    const h = hashStrategyConfig(zeroShot("anything"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
