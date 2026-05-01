/**
 * Hallucination detection: every checkable predicted value must be grounded
 * in the source transcript. Strings → fuzzy/substring/sliding-window match.
 * Numerics → must literally appear (with reasonable formatting) in the
 * transcript text.
 */
import type { Extraction } from "@test-evals/shared";
import { normalize, tokenSetRatio } from "./fuzzy.js";

export interface HallucinationResult {
  hallucinatedFields: string[];
  totalChecked: number;
  hallucinationCount: number;
}

interface CheckableValue {
  field: string;
  value: string;
  /** "string" → fuzzy grounding. "numeric" → digit-presence grounding. */
  kind: "string" | "numeric";
}

function extractCheckableValues(prediction: Extraction): CheckableValue[] {
  const values: CheckableValue[] = [];

  values.push({
    field: "chief_complaint",
    value: prediction.chief_complaint ?? "",
    kind: "string",
  });

  if (prediction.vitals.bp) {
    values.push({
      field: "vitals.bp",
      value: String(prediction.vitals.bp),
      kind: "numeric",
    });
  }
  if (prediction.vitals.hr != null) {
    values.push({ field: "vitals.hr", value: String(prediction.vitals.hr), kind: "numeric" });
  }
  if (prediction.vitals.temp_f != null) {
    values.push({
      field: "vitals.temp_f",
      value: String(prediction.vitals.temp_f),
      kind: "numeric",
    });
  }
  if (prediction.vitals.spo2 != null) {
    values.push({ field: "vitals.spo2", value: String(prediction.vitals.spo2), kind: "numeric" });
  }

  prediction.medications.forEach((med, i) => {
    values.push({ field: `medications[${i}].name`, value: med.name, kind: "string" });
    if (med.dose) values.push({ field: `medications[${i}].dose`, value: med.dose, kind: "numeric" });
  });

  prediction.diagnoses.forEach((d, i) => {
    values.push({ field: `diagnoses[${i}].description`, value: d.description, kind: "string" });
  });

  prediction.plan.forEach((p, i) => {
    values.push({ field: `plan[${i}]`, value: p, kind: "string" });
  });

  if (prediction.follow_up.reason) {
    values.push({
      field: "follow_up.reason",
      value: prediction.follow_up.reason,
      kind: "string",
    });
  }
  if (prediction.follow_up.interval_days != null) {
    values.push({
      field: "follow_up.interval_days",
      value: String(prediction.follow_up.interval_days),
      kind: "numeric",
    });
  }

  return values;
}

function isStringGrounded(value: string, normalizedTranscript: string): boolean {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return true;
  if (normalizedTranscript.includes(normalizedValue)) return true;

  const valueTokens = normalizedValue.split(" ").filter(Boolean);
  if (valueTokens.length === 0) return true;

  const found = valueTokens.filter((t) => normalizedTranscript.includes(t)).length;
  if (found / valueTokens.length >= 0.6) return true;

  if (valueTokens.length <= 2) {
    const transcriptTokens = normalizedTranscript.split(" ");
    for (let i = 0; i <= transcriptTokens.length - valueTokens.length; i++) {
      const window = transcriptTokens.slice(i, i + valueTokens.length).join(" ");
      if (tokenSetRatio(normalizedValue, window) >= 0.8) return true;
    }
  }
  return false;
}

/**
 * Numeric grounding: extract every number from the transcript (with optional
 * decimal point, slash for BP) and check whether the predicted number is
 * present. Avoids the "model invented HR=110" failure mode.
 */
function isNumericGrounded(value: string, transcript: string): boolean {
  const candidates = transcript.match(/\d+(?:[./]\d+)?/g) ?? [];
  if (candidates.length === 0) return false;
  // Compare normalised forms, e.g. "120 / 80" → "120/80".
  const target = value.replace(/\s+/g, "");
  return candidates.some((c) => c.replace(/\s+/g, "") === target);
}

export function detectHallucinations(
  prediction: Extraction,
  transcript: string,
): HallucinationResult {
  const normalizedTranscript = normalize(transcript);
  const checkable = extractCheckableValues(prediction);
  const hallucinatedFields: string[] = [];

  for (const c of checkable) {
    const grounded =
      c.kind === "numeric"
        ? isNumericGrounded(c.value, transcript) || isStringGrounded(c.value, normalizedTranscript)
        : isStringGrounded(c.value, normalizedTranscript);
    if (!grounded) hallucinatedFields.push(c.field);
  }

  return {
    hallucinatedFields,
    totalChecked: checkable.length,
    hallucinationCount: hallucinatedFields.length,
  };
}
