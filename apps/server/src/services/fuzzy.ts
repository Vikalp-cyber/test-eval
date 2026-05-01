/**
 * Fuzzy string matching utilities for the evaluator.
 *
 * Uses Levenshtein distance and token-set-ratio for comparing
 * clinical text where minor wording/punctuation differences are expected.
 */

/**
 * Compute Levenshtein edit distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,      // deletion
        dp[i]![j - 1]! + 1,      // insertion
        dp[i - 1]![j - 1]! + cost // substitution
      );
    }
  }
  return dp[m]![n]!;
}

/**
 * Normalize a string for comparison:
 * - lowercase
 * - collapse whitespace
 * - strip common punctuation
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:!?()\[\]{}"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize a string into a sorted, deduplicated set of lowercase words.
 */
function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

/**
 * Token-set ratio: measures overlap between two strings at the token level.
 * Returns a score ∈ [0, 1] where 1 = perfect match.
 *
 * Based on the fuzzywuzzy token_set_ratio concept:
 * intersection / union of token sets, with a fallback to
 * character-level similarity for single-token strings.
 */
export function tokenSetRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);

  const jaccardScore = intersection.size / union.size;

  // Also compute a sorted-token Levenshtein similarity as a secondary signal
  const sortedA = [...tokensA].sort().join(" ");
  const sortedB = [...tokensB].sort().join(" ");
  const maxLen = Math.max(sortedA.length, sortedB.length);
  const levScore = maxLen === 0 ? 1 : 1 - levenshtein(sortedA, sortedB) / maxLen;

  // Return the better of the two scores (more forgiving)
  return Math.max(jaccardScore, levScore);
}

/**
 * Simple fuzzy match: returns true if the token-set ratio exceeds a threshold.
 */
export function fuzzyMatch(a: string, b: string, threshold = 0.6): boolean {
  return tokenSetRatio(a, b) >= threshold;
}

/**
 * Normalize medication-specific text:
 * - "BID" -> "twice daily"
 * - "TID" -> "three times daily"
 * - "QID" -> "four times daily"
 * - "QD" / "QDay" -> "once daily"
 * - "PRN" -> "as needed"
 * - Strip spaces inside doses: "10 mg" -> "10mg"
 */
export function normalizeMedText(s: string | null): string {
  if (!s) return "";
  let result = normalize(s);

  // Frequency abbreviation expansions
  const freqMap: Record<string, string> = {
    bid: "twice daily",
    tid: "three times daily",
    qid: "four times daily",
    qd: "once daily",
    qday: "once daily",
    prn: "as needed",
    qhs: "at bedtime",
    qam: "every morning",
    qpm: "every evening",
    q4h: "every 4 hours",
    q6h: "every 6 hours",
    q8h: "every 8 hours",
    q12h: "every 12 hours",
  };

  // Replace whole-word abbreviations
  for (const [abbr, expansion] of Object.entries(freqMap)) {
    const regex = new RegExp(`\\b${abbr}\\b`, "gi");
    result = result.replace(regex, expansion);
  }

  // Normalize dose spacing: "10 mg" -> "10mg", "500 mcg" -> "500mcg"
  result = result.replace(/(\d+)\s*(mg|mcg|g|ml|units?|iu)\b/gi, "$1$2");

  return result;
}
