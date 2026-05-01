/**
 * Evaluate Service — orchestrates per-field scoring and hallucination
 * detection for a single (transcript, prediction, gold) triple.
 *
 * Two top-line numbers per case:
 *   • aggregateF1     — pure quality (per-field F1 / fuzzy averages)
 *   • aggregateScore  — aggregateF1 with hallucination + schema penalties
 *
 * Dashboards should rank on aggregateScore; per-field breakdowns
 * remain on aggregateF1 / individual scores so users can see where the
 * model is wrong vs where it's making things up.
 */
import type { Extraction } from "@test-evals/shared";
import {
  scoreChiefComplaint,
  scoreVitals,
  scoreMedications,
  scoreDiagnoses,
  scorePlan,
  scoreFollowUp,
  type VitalsScore,
  type SetF1Result,
  type DiagnosisF1Result,
  type FollowUpScore,
} from "./metrics.js";
import { detectHallucinations, type HallucinationResult } from "./hallucination.js";

export interface CaseScores {
  chief_complaint: number;
  vitals: VitalsScore;
  medications: SetF1Result;
  diagnoses: DiagnosisF1Result;
  plan: SetF1Result;
  follow_up: FollowUpScore;
}

export interface CaseEvaluation {
  caseId: string;
  /**
   * Per-field scores, or `null` if the case never produced a valid extraction
   * (model error / API key missing / schema-invalid after all retries). Such
   * cases are still part of the run; they contribute aggregateF1=0 to means
   * but are excluded from per-field averages.
   */
  scores: CaseScores | null;
  /** Pure quality. Equal-weight average of all 6 field scores. */
  aggregateF1: number;
  /** Quality - penalties (hallucinations, schema). */
  aggregateScore: number;
  hallucination: HallucinationResult;
  schemaValid: boolean;
}

const HALLUCINATION_PENALTY_PER_FIELD = 0.05; // capped
const SCHEMA_INVALID_PENALTY = 0.5;

export function evaluateCase(
  caseId: string,
  prediction: Extraction,
  gold: Extraction,
  transcript: string,
  schemaValid = true,
): CaseEvaluation {
  const chiefComplaint = scoreChiefComplaint(prediction.chief_complaint, gold.chief_complaint);
  const vitals = scoreVitals(prediction.vitals, gold.vitals);
  const medications = scoreMedications(prediction.medications, gold.medications);
  const diagnoses = scoreDiagnoses(prediction.diagnoses, gold.diagnoses);
  const plan = scorePlan(prediction.plan, gold.plan);
  const followUp = scoreFollowUp(prediction.follow_up, gold.follow_up);
  const hallucination = detectHallucinations(prediction, transcript);

  const aggregateF1 =
    (chiefComplaint +
      vitals.average +
      medications.f1 +
      diagnoses.blendedF1 +
      plan.f1 +
      followUp.average) /
    6;

  // Cap penalty so a single bad case can't pull a run negative.
  const halPenalty = Math.min(
    0.5,
    hallucination.hallucinationCount * HALLUCINATION_PENALTY_PER_FIELD,
  );
  const schemaPenalty = schemaValid ? 0 : SCHEMA_INVALID_PENALTY;
  const aggregateScore = Math.max(0, aggregateF1 - halPenalty - schemaPenalty);

  return {
    caseId,
    scores: {
      chief_complaint: chiefComplaint,
      vitals,
      medications,
      diagnoses,
      plan,
      follow_up: followUp,
    },
    aggregateF1,
    aggregateScore,
    hallucination,
    schemaValid,
  };
}

export interface RunAggregates {
  count: number;
  meanAggregateF1: number;
  meanAggregateScore: number;
  perField: {
    chief_complaint: number;
    vitals: number;
    medications_f1: number;
    diagnoses_f1: number;
    diagnoses_icd10_bonus: number;
    plan_f1: number;
    follow_up: number;
  };
  totalHallucinations: number;
  totalSchemaFailures: number;
}

export function aggregateResults(cases: CaseEvaluation[]): RunAggregates {
  const count = cases.length;
  if (count === 0) {
    return {
      count: 0,
      meanAggregateF1: 0,
      meanAggregateScore: 0,
      perField: {
        chief_complaint: 0,
        vitals: 0,
        medications_f1: 0,
        diagnoses_f1: 0,
        diagnoses_icd10_bonus: 0,
        plan_f1: 0,
        follow_up: 0,
      },
      totalHallucinations: 0,
      totalSchemaFailures: 0,
    };
  }

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  // Means use ALL cases so a failed extraction correctly drags the score down.
  // Per-field breakdowns only use cases that produced field-level scores —
  // otherwise we'd be dividing through nulls.
  const scored = cases.filter(
    (c): c is CaseEvaluation & { scores: CaseScores } => c.scores != null,
  );
  const scoredCount = scored.length || 1;

  return {
    count,
    meanAggregateF1: sum(cases.map((c) => c.aggregateF1)) / count,
    meanAggregateScore: sum(cases.map((c) => c.aggregateScore)) / count,
    perField: {
      chief_complaint: sum(scored.map((c) => c.scores.chief_complaint)) / scoredCount,
      vitals: sum(scored.map((c) => c.scores.vitals.average)) / scoredCount,
      medications_f1: sum(scored.map((c) => c.scores.medications.f1)) / scoredCount,
      diagnoses_f1: sum(scored.map((c) => c.scores.diagnoses.f1)) / scoredCount,
      diagnoses_icd10_bonus:
        sum(scored.map((c) => c.scores.diagnoses.icd10Bonus)) / scoredCount,
      plan_f1: sum(scored.map((c) => c.scores.plan.f1)) / scoredCount,
      follow_up: sum(scored.map((c) => c.scores.follow_up.average)) / scoredCount,
    },
    totalHallucinations: sum(cases.map((c) => c.hallucination.hallucinationCount)),
    totalSchemaFailures: cases.filter((c) => !c.schemaValid).length,
  };
}
