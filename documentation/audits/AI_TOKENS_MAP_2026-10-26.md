# AI tokens map — 2026-10-26

This audit reads the owner's "AI tokens" canvas (#2482, boards TOKB1–TOKB13) against the code on `origin/main` at `3f466ec0b7`. It is a snapshot, true as of that date and **not maintained**. D1277 is the decision that acts on it.

## 1. The canvas

`design/incoming/AI tokens · Boards.dc.html` holds the board grid. It imports `AI Tokens Page.dc.html`.

| Boards | What they draw |
|---|---|
| TOKB1, TOKB1v | The page: available now, held right now, what things cost, what stops spend, when tokens run out |
| TOKB2–TOKB5 | A hold's detail, the price list, the stop states, the per-key limits |
| TOKB6–TOKB12 | Empty, loading, error, support session, phone and dark |
| TOKB13 | Overview's balance card with its new link |

## 2. What each board can read today

| Card | Read | Status on `main` |
|---|---|---|
| Available now | `GET /api/ai-budget/me` (balance, allowance, `month_reserved_microusd`, `topup_reserved_microusd`, review holds) | built |
| Held right now | none: `/me` gives totals only | #2482 contract gap 2: **open** (D1278) |
| What things cost | none: `METERING_POLICY` is a Worker constant (`services/metering.ts`) | #2482 contract gap 1: **open** (D1278) |
| What stops spend | `GET /api/ai-budget/limit`; per-key limits through `/api/developer/keys` | built; `key_limit_reached` exists (`services/apiKeyLimits.ts`) |
| When tokens run out | the refusal words in `services/aiBudget.ts` and `services/aiRouter.ts`; the `/mcp` 402 body | gaps 3 and 4: **addressed on main** (`mcp/server.ts` carries the quote and what is available) — #2482 step 1 confirms the fields |

## 3. What waits, and on what

- #2482 itself is the build (S20). Step 1 draws Cards 1, 4 and 5 from the reads that exist and can start now.
- Step 2 (holds, prices, per-key rows) follows D1278: the price list and holds reads.
- #2482's four owner questions take their recommended answers (D1277 §5).
