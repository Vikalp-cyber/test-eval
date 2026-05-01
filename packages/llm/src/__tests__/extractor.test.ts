/// <reference types="bun" />
import { test, expect, mock } from "bun:test";
import { Extractor } from "../extractor.js";
import { zeroShot } from "../strategies/zero_shot.js";

test("Extractor retry loop self-corrects", async () => {
  const extractor = new Extractor("dummy");
  const strategy = zeroShot("Patient has headache.");

  let callCount = 0;

  // Mock Anthropic SDK method
  (extractor as any).client.beta = {
    messages: {
      create: mock(async (_params: any) => {
        callCount++;
        
        if (callCount === 1) {
          // Return invalid schema
          return {
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "extract_clinical_data",
                input: {
                  chief_complaint: 123, // invalid type
                  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
                  medications: [],
                  diagnoses: [],
                  plan: [],
                  follow_up: { interval_days: null, reason: null }
                }
              }
            ],
            usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
          };
        } else {
          // Return valid schema
          return {
            content: [
              {
                type: "tool_use",
                id: "toolu_2",
                name: "extract_clinical_data",
                input: {
                  chief_complaint: "Headache",
                  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
                  medications: [],
                  diagnoses: [],
                  plan: [],
                  follow_up: { interval_days: null, reason: null }
                }
              }
            ],
            usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
          };
        }
      })
    }
  };

  const result = await extractor.extract("Patient has headache.", strategy);
  
  expect(callCount).toBe(2); // Retried once
  expect(result.success).toBe(true);
  expect(result.data.chief_complaint).toBe("Headache");
  expect(result.attempts.length).toBe(2);
  expect(result.attempts[0]!.status).toBe("schema_invalid");
  expect(result.attempts[1]!.status).toBe("ok");
  expect(result.attempts[0]!.validationErrors?.length ?? 0).toBeGreaterThan(0);
  expect(result.promptHash).toMatch(/^[0-9a-f]{64}$/);
  expect(result.strategyName).toBe("zero_shot");
});
