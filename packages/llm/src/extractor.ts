/// <reference types="bun" />
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractionSchema } from "@test-evals/shared";
import type { StrategyConfig } from "./strategies/types.js";
import { hashStrategyConfig } from "./hash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../../data/schema.json");
const jsonSchema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const { $schema, $id, ...toolSchema } = jsonSchema;

/**
 * Slim per-attempt trace stored in the DB. We deliberately strip raw SDK envelopes
 * so `run_cases.attempts` doesn't blow up Postgres jsonb on long runs.
 */
export interface AttemptTrace {
  attempt: number;
  status: "schema_invalid" | "no_tool_call" | "ok" | "model_error";
  toolUseId?: string;
  rawInput?: unknown;
  validationErrors?: Array<{ path: string; message: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  stopReason?: string;
  errorMessage?: string;
  latencyMs: number;
}

export interface ExtractionResult {
  data: any | null;
  attempts: AttemptTrace[];
  promptHash: string;
  strategyName: string;
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
  success: boolean;
}

export interface ExtractOptions {
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Override default of 3. */
  maxAttempts?: number;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_MAX_ATTEMPTS = 3;

export class Extractor {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async extract(
    transcript: string,
    strategy: StrategyConfig,
    modelOrOptions?: string | ExtractOptions,
  ): Promise<ExtractionResult> {
    const opts: ExtractOptions =
      typeof modelOrOptions === "string"
        ? { model: modelOrOptions }
        : (modelOrOptions ?? {});
    const model = opts.model ?? DEFAULT_MODEL;
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    void transcript; // transcript already baked into strategy.messages by strategy fn

    const messages = [...strategy.messages];
    const attempts: AttemptTrace[] = [];
    const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const promptHash = hashStrategyConfig(strategy);
    let success = false;
    let data: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (opts.signal?.aborted) {
        attempts.push({
          attempt,
          status: "model_error",
          errorMessage: "aborted",
          usage: emptyUsage(),
          latencyMs: 0,
        });
        break;
      }

      const startedAt = Date.now();
      let response: Anthropic.Beta.Messages.BetaMessage;
      try {
        response = await this.client.beta.messages.create(
          {
            model,
            max_tokens: maxTokens,
            system: [
              {
                type: "text",
                text: strategy.systemPrompt,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages,
            tools: [
              {
                name: "extract_clinical_data",
                description: "Save structured clinical data extracted from a transcript.",
                input_schema: toolSchema as Anthropic.Tool.InputSchema,
              },
            ],
            tool_choice: { type: "tool", name: "extract_clinical_data" },
          },
          { signal: opts.signal },
        );
      } catch (err: unknown) {
        attempts.push({
          attempt,
          status: "model_error",
          errorMessage: err instanceof Error ? err.message : String(err),
          usage: emptyUsage(),
          latencyMs: Date.now() - startedAt,
        });
        // Surface 429s and other API errors to the runner so it can back off.
        throw err;
      }

      const usage = {
        input_tokens: response.usage.input_tokens ?? 0,
        output_tokens: response.usage.output_tokens ?? 0,
        cache_read_input_tokens:
          (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
        cache_creation_input_tokens:
          (response.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0,
      };
      tokens.input += usage.input_tokens;
      tokens.output += usage.output_tokens;
      tokens.cache_read += usage.cache_read_input_tokens;
      tokens.cache_write += usage.cache_creation_input_tokens;

      const toolCall = response.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
      );

      if (!toolCall) {
        attempts.push({
          attempt,
          status: "no_tool_call",
          usage,
          stopReason: response.stop_reason ?? undefined,
          latencyMs: Date.now() - startedAt,
        });
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content:
            "You must call the extract_clinical_data tool with the structured fields. Do not respond with prose.",
        });
        continue;
      }

      const validation = ExtractionSchema.safeParse(toolCall.input);
      if (validation.success) {
        attempts.push({
          attempt,
          status: "ok",
          toolUseId: toolCall.id,
          rawInput: toolCall.input,
          usage,
          latencyMs: Date.now() - startedAt,
        });
        data = validation.data;
        success = true;
        break;
      }

      const issues = validation.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      attempts.push({
        attempt,
        status: "schema_invalid",
        toolUseId: toolCall.id,
        rawInput: toolCall.input,
        validationErrors: issues,
        usage,
        latencyMs: Date.now() - startedAt,
      });

      // Targeted, machine-actionable feedback. Smaller payload than dumping JSON.stringify of the
      // full Zod tree, which models tend to overweight.
      const feedback = [
        "Your previous tool call did not match the required schema.",
        "Fix only these issues and call the tool again:",
        ...issues.map((i) => `- ${i.path || "(root)"}: ${i.message}`),
      ].join("\n");

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolCall.id,
            is_error: true,
            content: feedback,
          },
        ],
      });
    }

    return {
      data,
      attempts,
      promptHash,
      strategyName: strategy.name,
      tokens,
      success,
    };
  }
}

function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}
