import crypto from "node:crypto";
import type { StrategyConfig } from "./strategies/types.js";

/**
 * Stable identifier for the *prompt template* — independent of the transcript.
 * We hash the strategy name, system prompt, and any few-shot messages, but
 * deliberately strip the last user message because by convention every
 * strategy puts the live transcript in that final slot. This lets the runner
 * use the prompt hash as part of the idempotency key without producing a
 * different hash per case.
 */
export function hashStrategyConfig(config: StrategyConfig): string {
  const messagesWithoutTranscript = config.messages.slice(0, -1);
  const data = JSON.stringify({
    name: config.name,
    systemPrompt: config.systemPrompt,
    messages: messagesWithoutTranscript,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}
