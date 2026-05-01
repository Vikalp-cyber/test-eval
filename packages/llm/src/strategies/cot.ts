import type { StrategyFn } from "./types.js";

export const cot: StrategyFn = (transcript) => {
  return {
    name: "cot",
    systemPrompt: `You are an expert clinical documentation assistant.
Your task is to extract structured clinical data from the provided doctor-patient transcript.
You must adhere exactly to the required JSON schema.
Before calling the extraction tool, you MUST use a <thinking> block to reason step-by-step about what to extract for each field based on the transcript. 
1. Identify the chief complaint.
2. Identify any mentioned vitals (BP, HR, Temp, SpO2).
3. List all medications (name, dose, freq, route).
4. List working diagnoses.
5. Identify plan items.
6. Identify follow-up.
Only after thinking should you call the tool.`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Here is the transcript:\n\n<transcript>\n${transcript}\n</transcript>\n\nExtract the structured data after thinking.`,
            cache_control: { type: "ephemeral" }
          }
        ]
      }
    ]
  };
};
