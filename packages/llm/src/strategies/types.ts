import type Anthropic from "@anthropic-ai/sdk";

export interface StrategyConfig {
  name: string;
  systemPrompt: string;
  messages: Anthropic.MessageParam[]; // e.g. for few-shot examples
}

export type StrategyFn = (transcript: string) => StrategyConfig;
