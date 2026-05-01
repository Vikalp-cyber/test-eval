import type { StrategyFn } from "./types.js";

export const zeroShot: StrategyFn = (transcript) => ({
  name: "zero_shot",
  systemPrompt: `You are an expert clinical documentation assistant.
Your task is to extract structured clinical data from the provided doctor-patient transcript.
You must adhere exactly to the required JSON schema.
Be precise and objective. Do not invent information. If a value is missing, use null or an empty array as appropriate according to the schema.`,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Here is the transcript:\n\n<transcript>\n${transcript}\n</transcript>\n\nExtract the structured data.`,
          cache_control: { type: "ephemeral" } // cache the transcript input if large, but wait, usually we cache the system prompt + few shot. Let's cache the transcript for now if we want, or cache the system prompt. Anthropic recommends caching static parts at the end of the prompt.
        }
      ]
    }
  ],
});
