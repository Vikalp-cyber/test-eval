# NOTES


## Strategy Results (current local runs)

| Strategy | Status | Cases | Mean F1 | Cost | Notes |
| --- | --- | --- | --- | --- | --- |
| `zero_shot` | failed | 50/50 processed | 0.000 | $0.0000 | All cases marked schema invalid; root issue was API billing/key setup, not pipeline logic. |
| `few_shot` | completed | 0/5 (earlier trial) | 0.000 | $0.0000 | Ran before billing/key was fully usable; not representative of model quality. |
| `cot` | not run yet | - | - | - | Planned after key + credits are confirmed healthy. |

> Important: these numbers are operational/debug results, **not quality benchmarks** yet.

## What surprised me

- The system was "working" end-to-end, but account billing blocked Anthropic calls, which looked like model/schema failures at first glance.
- A run could look completed even when all extractions failed; this is now handled with clearer run/case error surfacing.
- Most debugging time was around environment/runtime correctness (ports, DB, keys, billing), not model prompting.

## What I'd build next

1. A small **health endpoint** (`/api/v1/health`) showing DB, API key present, Anthropic connectivity, and model availability.
2. A **preflight check** before starting a run (fail fast with actionable error if key/credits/model access are invalid).
3. A **run-quality baseline suite** (e.g., 10 fixed transcripts) to compare strategy changes quickly before full 50-case runs.
4. Better dashboard rollups for failed rows: grouped error counts and direct remediation tips.

## What I cut (for now)

- Deep prompt optimization loops until stable infra/credentials are guaranteed.
- Cross-model benchmark pass (Sonnet/Opus) until Haiku path is consistently green.
- Advanced eval extras (token-level attribution visualizer, richer confusion taxonomy) in favor of reliability fixes first.
