/// <reference types="bun" />
import { test, expect, describe } from "bun:test";
import { detectHallucinations } from "../services/hallucination.js";
import type { Extraction } from "@test-evals/shared";

const transcript = `Doctor: How are you?
Patient: Bad headache and fever 101.
Doctor: BP 118/76, HR 88. Take Tylenol 500 mg every 6 hours for fever. The plan is supportive care with fluids and saline nasal spray.
Doctor: Let's see you again in 3 days for follow up.`;

const baseValid: Extraction = {
  chief_complaint: "Headache and fever",
  vitals: { bp: "118/76", hr: 88, temp_f: 101, spo2: null },
  medications: [
    { name: "Tylenol", dose: "500 mg", frequency: "every 6 hours", route: null },
  ],
  diagnoses: [{ description: "Headache" }],
  plan: ["Supportive care with fluids", "Saline nasal spray"],
  follow_up: { interval_days: 3, reason: "follow up" },
};

describe("detectHallucinations", () => {
  test("grounded prediction has zero hallucinations", () => {
    const result = detectHallucinations(baseValid, transcript);
    expect(result.hallucinationCount).toBe(0);
    expect(result.hallucinatedFields).toEqual([]);
  });

  test("invented medication is flagged", () => {
    const bad: Extraction = {
      ...baseValid,
      medications: [
        ...baseValid.medications,
        { name: "Amoxicillin", dose: "500 mg", frequency: null, route: null },
      ],
    };
    const result = detectHallucinations(bad, transcript);
    expect(result.hallucinatedFields).toContain("medications[1].name");
  });

  test("invented numeric vital (HR=999) is flagged", () => {
    const bad: Extraction = {
      ...baseValid,
      vitals: { ...baseValid.vitals, hr: 999 },
    };
    const result = detectHallucinations(bad, transcript);
    expect(result.hallucinatedFields).toContain("vitals.hr");
  });

  test("invented follow-up interval is flagged", () => {
    const bad: Extraction = {
      ...baseValid,
      follow_up: { interval_days: 14, reason: "follow up" },
    };
    const result = detectHallucinations(bad, transcript);
    expect(result.hallucinatedFields).toContain("follow_up.interval_days");
  });
});
