/**
 * Model-aware cost calculation. Prices are USD per 1M tokens.
 * Source: Anthropic public pricing as of 2025-Q4 — change in one place.
 *
 * If a model is unknown we fall back to a conservative Haiku-class price
 * so cost never silently reads $0 in production dashboards.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Haiku class
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },

  // Sonnet class
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },

  // Opus class
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
};

const DEFAULT_PRICING: ModelPricing = PRICING["claude-3-5-haiku-20241022"]!;

export function pricingFor(model: string): ModelPricing {
  return PRICING[model] ?? DEFAULT_PRICING;
}

export function computeCostUSD(usage: TokenUsage, model: string): number {
  const p = pricingFor(model);
  return (
    (usage.input * p.input) / 1_000_000 +
    (usage.output * p.output) / 1_000_000 +
    (usage.cache_read * p.cacheRead) / 1_000_000 +
    (usage.cache_write * p.cacheWrite) / 1_000_000
  );
}

export function isKnownModel(model: string): boolean {
  return model in PRICING;
}
