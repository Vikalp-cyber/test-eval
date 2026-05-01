/// <reference types="bun" />
import { test, expect, describe } from "bun:test";
import {
  computeSetF1,
  scoreMedications,
  scoreDiagnoses,
  scorePlan,
  scoreVitals,
  scoreFollowUp,
} from "../services/metrics.js";
import { tokenSetRatio } from "../services/fuzzy.js";

describe("computeSetF1 (best-pair-first)", () => {
  test("perfect match returns f1=1", () => {
    const r = computeSetF1(["a", "b"], ["a", "b"], (x, y) => (x === y ? 1 : 0), 1);
    expect(r.f1).toBe(1);
  });

  test("partial match returns correct precision/recall", () => {
    const r = computeSetF1(["a", "b", "c"], ["a", "x"], (x, y) => (x === y ? 1 : 0), 1);
    expect(r.precision).toBeCloseTo(1 / 3, 6);
    expect(r.recall).toBeCloseTo(1 / 2, 6);
  });

  test("matching is order-independent", () => {
    const sim = (x: string, y: string) => tokenSetRatio(x, y);
    const a = computeSetF1(["red apple", "green pear"], ["green pear", "red apple"], sim, 0.5);
    const b = computeSetF1(["red apple", "green pear"], ["red apple", "green pear"], sim, 0.5);
    expect(a.f1).toBeCloseTo(b.f1, 6);
  });
});

describe("scoreMedications", () => {
  test("normalizes BID and dose spacing", () => {
    const r = scoreMedications(
      [{ name: "Lisinopril", dose: "10mg", frequency: "BID", route: "PO" }],
      [{ name: "Lisinopril", dose: "10 mg", frequency: "twice daily", route: "PO" }],
    );
    expect(r.f1).toBe(1);
  });

  test("name match but dose mismatch reduces score", () => {
    const r = scoreMedications(
      [{ name: "Lisinopril", dose: "10 mg", frequency: "daily", route: null }],
      [{ name: "Lisinopril", dose: "20 mg", frequency: "daily", route: null }],
    );
    expect(r.f1).toBeLessThan(1);
  });
});

describe("scoreDiagnoses", () => {
  test("ICD bonus blends into blendedF1", () => {
    const r = scoreDiagnoses(
      [{ description: "Hypertension", icd10: "I10" }],
      [{ description: "Hypertension", icd10: "I10" }],
    );
    expect(r.f1).toBe(1);
    expect(r.icd10Bonus).toBe(1);
    expect(r.blendedF1).toBeCloseTo(1, 6);
  });

  test("missing ICD penalizes blendedF1 but not f1", () => {
    const r = scoreDiagnoses(
      [{ description: "Hypertension" }],
      [{ description: "Hypertension", icd10: "I10" }],
    );
    expect(r.f1).toBe(1);
    expect(r.icd10Bonus).toBe(0);
    expect(r.blendedF1).toBeCloseTo(0.9, 6);
  });
});

describe("scoreVitals", () => {
  test("temp tolerance ±0.2°F", () => {
    const r = scoreVitals(
      { bp: null, hr: 80, temp_f: 100.1, spo2: 98 },
      { bp: null, hr: 80, temp_f: 100.0, spo2: 98 },
    );
    expect(r.temp_f).toBe(1);
  });
});

describe("scorePlan / scoreFollowUp", () => {
  test("plan tolerates wording", () => {
    const r = scorePlan(
      ["Start Tylenol 500mg q6h"],
      ["Start tylenol 500 mg every 6 hours"],
    );
    expect(r.f1).toBe(1);
  });

  test("follow_up exact integer match required", () => {
    const r = scoreFollowUp(
      { interval_days: 7, reason: "Recheck" },
      { interval_days: 14, reason: "Recheck" },
    );
    expect(r.intervalDays).toBe(0);
    expect(r.reason).toBe(1);
  });
});
