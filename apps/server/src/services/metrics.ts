/**
 * Per-field evaluation metrics for clinical extraction.
 *
 * Each metric returns a score ∈ [0, 1]. Set-based metrics use a
 * "best-pair-first" greedy algorithm (descending similarity) instead of the
 * prediction-order greedy one — this is closer to optimal bipartite matching
 * for small N and removes order sensitivity in scores.
 */
import type { Extraction, Medication, Diagnosis } from "@test-evals/shared";
import { tokenSetRatio, fuzzyMatch, normalizeMedText, normalize } from "./fuzzy.js";

// ── Chief Complaint ──────────────────────────────────────────────
export function scoreChiefComplaint(predicted: string, gold: string): number {
  return tokenSetRatio(predicted ?? "", gold ?? "");
}

// ── Vitals ───────────────────────────────────────────────────────
export interface VitalsScore {
  bp: number;
  hr: number;
  temp_f: number;
  spo2: number;
  average: number;
}

export function scoreVitals(
  predicted: Extraction["vitals"],
  gold: Extraction["vitals"],
): VitalsScore {
  const bp = scoreBp(predicted.bp, gold.bp);
  const hr = scoreNumeric(predicted.hr, gold.hr, 0);
  const temp_f = scoreNumeric(predicted.temp_f, gold.temp_f, 0.2);
  const spo2 = scoreNumeric(predicted.spo2, gold.spo2, 0);
  return { bp, hr, temp_f, spo2, average: (bp + hr + temp_f + spo2) / 4 };
}

function scoreBp(predicted: string | null, gold: string | null): number {
  if (predicted == null && gold == null) return 1;
  if (predicted == null || gold == null) return 0;
  // Tolerate whitespace + slash variants (120/80 vs 120 / 80).
  const norm = (s: string) => s.replace(/\s+/g, "").trim();
  return norm(predicted) === norm(gold) ? 1 : 0;
}

function scoreNumeric(
  predicted: number | null,
  gold: number | null,
  tolerance: number,
): number {
  if (predicted == null && gold == null) return 1;
  if (predicted == null || gold == null) return 0;
  return Math.abs(predicted - gold) <= tolerance ? 1 : 0;
}

// ── Set-based F1 ─────────────────────────────────────────────────
export interface SetF1Result {
  precision: number;
  recall: number;
  f1: number;
  matchedPairs: Array<{ predicted: number; gold: number; score: number }>;
}

/**
 * Set-F1 with best-pair-first greedy matching.
 * Ranks all (i,j) pairs by similarity desc, then greedily takes the best
 * unmatched pair. Order-independent for the prediction array.
 */
export function computeSetF1<T>(
  predicted: T[],
  gold: T[],
  similarityFn: (a: T, b: T) => number,
  threshold: number,
): SetF1Result {
  if (predicted.length === 0 && gold.length === 0) {
    return { precision: 1, recall: 1, f1: 1, matchedPairs: [] };
  }
  if (predicted.length === 0 || gold.length === 0) {
    return { precision: 0, recall: 0, f1: 0, matchedPairs: [] };
  }

  const candidates: Array<{ predicted: number; gold: number; score: number }> = [];
  for (let i = 0; i < predicted.length; i++) {
    for (let j = 0; j < gold.length; j++) {
      const score = similarityFn(predicted[i]!, gold[j]!);
      if (score >= threshold) candidates.push({ predicted: i, gold: j, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedPredicted = new Set<number>();
  const usedGold = new Set<number>();
  const matchedPairs: Array<{ predicted: number; gold: number; score: number }> = [];
  for (const c of candidates) {
    if (usedPredicted.has(c.predicted) || usedGold.has(c.gold)) continue;
    usedPredicted.add(c.predicted);
    usedGold.add(c.gold);
    matchedPairs.push(c);
  }

  const tp = matchedPairs.length;
  const precision = tp / predicted.length;
  const recall = tp / gold.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, matchedPairs };
}

// ── Medications ──────────────────────────────────────────────────
function medSimilarity(a: Medication, b: Medication): number {
  const nameSim = tokenSetRatio(a.name ?? "", b.name ?? "");
  if (nameSim < 0.6) return 0;

  // Penalty for dose disagreement (post normalization), if both present.
  const doseA = normalizeMedText(a.dose);
  const doseB = normalizeMedText(b.dose);
  let dosePenalty = 0;
  if (doseA && doseB) dosePenalty = doseA === doseB ? 0 : 0.5;

  const freqA = normalizeMedText(a.frequency);
  const freqB = normalizeMedText(b.frequency);
  let freqPenalty = 0;
  if (freqA && freqB) freqPenalty = fuzzyMatch(freqA, freqB, 0.7) ? 0 : 0.3;

  return Math.max(0, nameSim - dosePenalty - freqPenalty);
}

export function medMatch(a: Medication, b: Medication): boolean {
  return medSimilarity(a, b) >= 0.6;
}

export function scoreMedications(
  predicted: Medication[],
  gold: Medication[],
): SetF1Result {
  return computeSetF1(predicted, gold, medSimilarity, 0.6);
}

// ── Diagnoses ────────────────────────────────────────────────────
export interface DiagnosisF1Result extends SetF1Result {
  icd10Bonus: number;
  /** F1 blended with ICD10 bonus — 90% F1 + 10% ICD bonus. */
  blendedF1: number;
}

function diagnosisSimilarity(a: Diagnosis, b: Diagnosis): number {
  return tokenSetRatio(a.description ?? "", b.description ?? "");
}

export function scoreDiagnoses(
  predicted: Diagnosis[],
  gold: Diagnosis[],
): DiagnosisF1Result {
  const base = computeSetF1(predicted, gold, diagnosisSimilarity, 0.6);

  let icd10Matches = 0;
  let icd10Total = 0;
  for (const pair of base.matchedPairs) {
    const pDiag = predicted[pair.predicted]!;
    const gDiag = gold[pair.gold]!;
    if (gDiag.icd10) {
      icd10Total++;
      if (pDiag.icd10 && normalize(pDiag.icd10) === normalize(gDiag.icd10)) {
        icd10Matches++;
      }
    }
  }
  const icd10Bonus = icd10Total === 0 ? 1 : icd10Matches / icd10Total;
  const blendedF1 = base.f1 * 0.9 + icd10Bonus * 0.1;

  return { ...base, icd10Bonus, blendedF1 };
}

// ── Plan ─────────────────────────────────────────────────────────
function planSimilarity(a: string, b: string): number {
  return tokenSetRatio(a ?? "", b ?? "");
}

export function scorePlan(predicted: string[], gold: string[]): SetF1Result {
  return computeSetF1(predicted, gold, planSimilarity, 0.5);
}

// ── Follow-up ────────────────────────────────────────────────────
export interface FollowUpScore {
  intervalDays: number;
  reason: number;
  average: number;
}

export function scoreFollowUp(
  predicted: Extraction["follow_up"],
  gold: Extraction["follow_up"],
): FollowUpScore {
  const intervalDays = predicted.interval_days === gold.interval_days ? 1 : 0;

  let reason: number;
  if (predicted.reason == null && gold.reason == null) reason = 1;
  else if (predicted.reason == null || gold.reason == null) reason = 0;
  else reason = tokenSetRatio(predicted.reason, gold.reason);

  return { intervalDays, reason, average: (intervalDays + reason) / 2 };
}
