import type Anthropic from "@anthropic-ai/sdk";
import type { StrategyFn } from "./types.js";
import { zeroShot } from "./zero_shot.js";

/**
 * Few-shot examples designed to cover representative variation:
 *  1) Vitals + simple meds + short follow-up
 *  2) No vitals captured + multi-med + dx with ICD-10
 *  3) Stable patient + null follow-up + multi-line plan
 *
 * Each (user, assistant tool_use, user tool_result) triple is a single
 * "shot". We mark the LAST shot's user tool_result with cache_control so
 * the entire static prefix (system + 3 shots) is cached together.
 */
const EXAMPLES: Array<{
  transcript: string;
  output: Anthropic.ToolUseBlock["input"];
}> = [
  {
    transcript:
      "Doctor: How are you feeling today?\nPatient: My head hurts and I have a fever of 101.\nDoctor: BP 118/76, HR 88. Let's start Tylenol 500 mg PO every 6 hours. Follow up in 3 days if not improved.",
    output: {
      chief_complaint: "Headache and fever",
      vitals: { bp: "118/76", hr: 88, temp_f: 101, spo2: null },
      medications: [
        { name: "Tylenol", dose: "500 mg", frequency: "every 6 hours", route: "PO" },
      ],
      diagnoses: [
        { description: "Fever" },
        { description: "Headache" },
      ],
      plan: ["Start Tylenol 500 mg PO every 6 hours"],
      follow_up: { interval_days: 3, reason: "if not improved" },
    },
  },
  {
    transcript:
      "Patient: I've been feeling short of breath and my legs are swelling.\nDoctor: I'm increasing your furosemide to 40 mg PO daily and adding lisinopril 10 mg PO daily. Working diagnosis is heart failure exacerbation, ICD-10 I50.9. See me in 1 week.",
    output: {
      chief_complaint: "Shortness of breath and leg swelling",
      vitals: { bp: null, hr: null, temp_f: null, spo2: null },
      medications: [
        { name: "Furosemide", dose: "40 mg", frequency: "daily", route: "PO" },
        { name: "Lisinopril", dose: "10 mg", frequency: "daily", route: "PO" },
      ],
      diagnoses: [{ description: "Heart failure exacerbation", icd10: "I50.9" }],
      plan: [
        "Increase furosemide to 40 mg PO daily",
        "Start lisinopril 10 mg PO daily",
      ],
      follow_up: { interval_days: 7, reason: "Re-evaluate heart failure" },
    },
  },
  {
    transcript:
      "Doctor: Vitals look great today, BP 120/78, HR 70, SpO2 99%. Continue current regimen, no medication changes. Stay active. No follow-up needed unless symptoms recur.",
    output: {
      chief_complaint: "Routine follow-up",
      vitals: { bp: "120/78", hr: 70, temp_f: null, spo2: 99 },
      medications: [],
      diagnoses: [],
      plan: ["Continue current regimen", "Stay active"],
      follow_up: { interval_days: null, reason: null },
    },
  },
];

export const fewShot: StrategyFn = (transcript) => {
  const base = zeroShot(transcript);

  const exampleMessages: Anthropic.MessageParam[] = [];
  EXAMPLES.forEach((ex, i) => {
    const id = `toolu_example_${i + 1}`;
    exampleMessages.push({
      role: "user",
      content: `Here is the transcript:\n\n<transcript>\n${ex.transcript}\n</transcript>\n\nExtract the structured data.`,
    });
    exampleMessages.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name: "extract_clinical_data",
          input: ex.output,
        },
      ],
    });
    exampleMessages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: "Data recorded.",
        },
      ],
    });
  });

  // Cache the entire static few-shot prefix.
  const lastShot = exampleMessages[exampleMessages.length - 1];
  if (lastShot && Array.isArray(lastShot.content)) {
    const lastBlock = lastShot.content[lastShot.content.length - 1] as {
      cache_control?: { type: "ephemeral" };
    };
    lastBlock.cache_control = { type: "ephemeral" };
  }

  return {
    name: "few_shot",
    systemPrompt: base.systemPrompt,
    messages: [
      ...exampleMessages,
      {
        role: "user",
        content: `Here is the transcript:\n\n<transcript>\n${transcript}\n</transcript>\n\nExtract the structured data.`,
      },
    ],
  };
};
