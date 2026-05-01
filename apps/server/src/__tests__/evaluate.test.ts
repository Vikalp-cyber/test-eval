/// <reference types="bun" />
import { test, expect, describe } from "bun:test";
import { evaluateCase, aggregateResults } from "../services/evaluate.service.js";
import type { Extraction } from "@test-evals/shared";

const transcript =
  "Doctor: This is your hypertension follow-up. BP 120/80, HR 70. Continue Lisinopril 10 mg PO daily. Follow up in 14 days.";

const gold: Extraction = {
  chief_complaint: "Hypertension follow-up",
  vitals: { bp: "120/80", hr: 70, temp_f: null, spo2: null },
  medications: [
    { name: "Lisinopril", dose: "10 mg", frequency: "daily", route: "PO" },
  ],
  diagnoses: [{ description: "Hypertension", icd10: "I10" }],
  plan: ["Continue Lisinopril 10 mg PO daily"],
  follow_up: { interval_days: 14, reason: "Hypertension follow-up" },
};

describe("evaluateCase", () => {
  test("perfect prediction → high aggregateScore, zero hallucinations", () => {
    const r = evaluateCase("c1", gold, gold, transcript, true);
    expect(r.aggregateF1).toBeGreaterThan(0.85);
    expect(r.aggregateScore).toBeGreaterThan(0.85);
    expect(r.hallucination.hallucinationCount).toBe(0);
  });

  test("hallucination penalty reduces aggregateScore but not aggregateF1", () => {
    const withInvented: Extraction = {
      ...gold,
      medications: [
        ...gold.medications,
        { name: "Atorvastatin", dose: "20 mg", frequency: "nightly", route: "PO" },
      ],
    };
    const r = evaluateCase("c1", withInvented, gold, transcript, true);
    expect(r.hallucination.hallucinationCount).toBeGreaterThan(0);
    expect(r.aggregateScore).toBeLessThan(r.aggregateF1);
  });

  test("schema-invalid heavily penalises aggregateScore", () => {
    const r = evaluateCase("c1", gold, gold, transcript, false);
    expect(r.aggregateF1).toBeGreaterThan(0.85);
    expect(r.aggregateScore).toBeLessThan(r.aggregateF1 - 0.4);
  });
});

describe("aggregateResults", () => {
  test("means correctly", () => {
    const c1 = evaluateCase("c1", gold, gold, transcript, true);
    const c2 = evaluateCase("c2", gold, gold, transcript, true);
    const agg = aggregateResults([c1, c2]);
    expect(agg.count).toBe(2);
    expect(agg.meanAggregateF1).toBeCloseTo(c1.aggregateF1, 6);
    expect(agg.meanAggregateScore).toBeCloseTo(c1.aggregateScore, 6);
  });

  test("empty input returns zeros", () => {
    const agg = aggregateResults([]);
    expect(agg.count).toBe(0);
    expect(agg.meanAggregateF1).toBe(0);
    expect(agg.meanAggregateScore).toBe(0);
    expect(agg.totalSchemaFailures).toBe(0);
  });

  test("null scores (failed extractions) do not crash and are excluded from per-field means", () => {
    const ok = evaluateCase("c1", gold, gold, transcript, true);
    const failed = {
      caseId: "c2",
      scores: null,
      aggregateF1: 0,
      aggregateScore: 0,
      schemaValid: false,
      hallucination: {
        hallucinatedFields: [],
        hallucinationCount: 0,
        totalChecked: 0,
      },
    };
    const agg = aggregateResults([ok, failed]);
    expect(agg.count).toBe(2);
    // Mean F1 should drag failed=0 in: half of ok.
    expect(agg.meanAggregateF1).toBeCloseTo(ok.aggregateF1 / 2, 6);
    // Per-field reports the average across SCORED cases only (so equal to ok).
    expect(agg.perField.chief_complaint).toBeCloseTo(ok.scores!.chief_complaint, 6);
    expect(agg.totalSchemaFailures).toBe(1);
  });
});
