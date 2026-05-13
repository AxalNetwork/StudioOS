# Personal Advisor v2 — Phased Rollout Runbook

**Owner:** platform on-call · **Window:** ~10+ calendar days end-to-end ·
**Last revised:** 2026-05-13 (Task #6)

This runbook executes the time-gated rollout of the new Personal Advisor
to 100% of production users. The code, eval harness, kill switch, and
rollout flags all shipped in Task #5; this document is the operator
script for turning the dial across calendar time.

---

## 0. Prerequisites (do once, before Phase 1)

1. **Node 22 on PATH** (wrangler requires ≥22, default Replit Node is 20):
   ```bash
   export PATH=/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin:$PATH
   node -v   # → v22.x
   ```
2. **Wrangler authenticated** to the StudioOS Cloudflare account
   (`wrangler whoami`). You need `Workers Scripts: Edit` and
   `AI Gateway: Edit` on that account.
3. **Confirm the eval harness builds and runs against staging** —
   one dry run before Phase 1 starts:
   ```bash
   node scripts/run-advisor-eval.mjs --env staging --dry-run
   ```
   Output should be a dated JSON in `eval-results/`.
4. **Confirm the gate code is live in prod** — hit any advisor
   route with a non-allowlisted user while `ADVISOR_V2_DISABLED=1`
   is temporarily set; expect HTTP 423. Unset immediately after.
5. **Have the abort command in another terminal, ready to paste:**
   ```bash
   wrangler secret put ADVISOR_V2_DISABLED --env production
   # then type: 1
   ```

---

## Flag reference

All flags live on the production worker via `wrangler secret put …
--env production` (NOT in `wrangler.toml [vars]` — secrets only, so a
typo doesn't get committed).

| Flag                              | Meaning                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `ADVISOR_V2_DISABLED=1`           | Instant kill switch. Returns 423 on every advisor route. **Use first if anything looks wrong.** |
| `ADVISOR_V2_ALLOWLIST=u1,u2,…`    | CSV of user ids that get v2 regardless of percentage. Admins are implicitly allowlisted in code. |
| `ADVISOR_V2_ROLLOUT_PCT=N`        | 0–100. Deterministic FNV-1a bucket of `user_id`. Same user always lands in the same bucket. |
| `ADVISOR_V2_NEW_SIGNUPS_AFTER=ISO`| Optional. Only users created after this timestamp are eligible. |
| `ADVISOR_DISABLED=1`              | Legacy alias — OR'd with `ADVISOR_V2_DISABLED` for incident-response safety. |

Routes enforced by the gate (rollout decision → 503, kill switch → 423):
`/start`, `/answer`, `/explain`, `/skip`, `/sources`, `/next-question`,
`/progress`, `/manifest`, `/conversations/:id`, `/tools`, `/tool`,
`/tool/auto`, `/turn`, `/queue`.

---

## Phase 1 — Allowlist (3 days)

**Goal:** dogfood + admins only. Catch obvious bugs before any real
user sees v2.

### Start of window

1. Collect the user ids:
   ```sql
   -- via wrangler d1 execute studioos-db --remote --command "…"
   SELECT id, email FROM users
    WHERE role IN ('admin','superadmin')
       OR email LIKE '%@axal.%';
   ```
   Comma-join the resulting `id` column (UUIDs).
2. Push the allowlist + ensure rollout pct is 0:
   ```bash
   wrangler secret put ADVISOR_V2_ALLOWLIST --env production
   # paste:  uuid-1,uuid-2,uuid-3,…
   wrangler secret put ADVISOR_V2_ROLLOUT_PCT --env production
   # paste:  0
   wrangler secret delete ADVISOR_V2_DISABLED --env production || true
   ```
3. Capture a baseline eval against staging:
   ```bash
   node scripts/run-advisor-eval.mjs --env staging --label phase1-start
   ```
   Save the path to the dated JSON; it is the comparison anchor.

### Daily during the 3-day window

- Tail prod errors:
  ```bash
  wrangler tail --env production --format pretty | grep -E "advisor|503|423|rollout"
  ```
- Spot-check `activity_logs`:
  ```sql
  SELECT action, COUNT(*) FROM activity_logs
   WHERE created_at > datetime('now','-1 day')
     AND action LIKE 'advisor.%'
   GROUP BY action;
  ```

### End of window — gates to enter Phase 2

Re-run the eval and compare against the Phase 1 baseline JSON:
```bash
node scripts/run-advisor-eval.mjs --env staging --label phase1-end
```

| Metric                 | Threshold     |
| ---------------------- | ------------- |
| `repetition_rate`      | **≤ 0%**      |
| `write_success_rate`   | **≥ 95%**     |
| `p95_latency_ms`       | **≤ 4000**    |
| `mi_signal_coverage_delta` | **≥ 0** (no regression) |
| `cost_per_conversation_usd` | within 20% of baseline |
| Any `kill_switch_activations` in `activity_logs` | **0** unintentional |

If ANY threshold misses → flip `ADVISOR_V2_DISABLED=1`, file a bug,
do not advance.

---

## Phase 2 — 10% rollout (1 week)

**Goal:** real-user traffic at 1-in-10. Watch per-persona rates and
the AI-Gateway dashboard.

### Start of window

```bash
wrangler secret put ADVISOR_V2_ROLLOUT_PCT --env production
# paste:  10
# (leave allowlist in place so dogfood always sees v2)
```

Optional, if you want NEW signups only at 10% and grandfather existing
users to legacy:
```bash
wrangler secret put ADVISOR_V2_NEW_SIGNUPS_AFTER --env production
# paste:  2026-05-13T00:00:00Z   (or the day Phase 2 starts)
```

### Daily during the 7-day window

```bash
node scripts/run-advisor-eval.mjs --env staging --label phase2-day-N
```

Per-persona answer rate sanity check (run nightly):
```sql
SELECT json_extract(meta_json,'$.persona') AS persona,
       COUNT(*) AS answered_today
  FROM activity_logs
 WHERE action='advisor.answered'
   AND created_at > datetime('now','-1 day')
 GROUP BY persona;
```
Expect non-zero counts in every active persona. A zero where there
shouldn't be one (e.g. founders) means the gate is blocking them.

Also check the dedicated AI Gateway slug `advisor-ongoing` in the
Cloudflare dashboard for: cache hit rate, p95 latency, error %, and
rate-limit rejections. Flag anything > 1% error or > 5s p95.

### Gates to enter Phase 3

Same metric thresholds as end of Phase 1, **plus**:
- No spike in 4xx/5xx on advisor routes vs. the prior 7 days.
- No spike in `WORKERS_AI_ADVISOR_BUDGET_USD_DAY` cap-hits in
  `activity_logs` (`advisor.budget_blocked`).
- ≤ 0.5% of users hit the kill switch path (`423`) — anything more
  means the gate is mis-routing.

If anything misses → drop pct back to 0 (allowlist still serves dogfood),
investigate, do NOT flip the kill switch unless prod is actively broken.

---

## Phase 3 — 100% rollout (≥ 1 week soak)

```bash
wrangler secret put ADVISOR_V2_ROLLOUT_PCT --env production
# paste:  100
wrangler secret delete ADVISOR_V2_NEW_SIGNUPS_AFTER --env production || true
```

Allowlist can stay (it's a no-op at 100%) or be deleted for cleanliness:
```bash
wrangler secret delete ADVISOR_V2_ALLOWLIST --env production
```

Soak for one full week with the same daily eval + activity_logs +
AI Gateway checks as Phase 2. After 7 clean days, hand off to
**Task #7** to delete the legacy advisor code paths.

---

## Rollback procedure (any phase)

1. **Hard kill (instant, all users → polite 503/423):**
   ```bash
   wrangler secret put ADVISOR_V2_DISABLED --env production
   # paste:  1
   ```
2. **Soft rollback (drop pct, keep dogfood):**
   ```bash
   wrangler secret put ADVISOR_V2_ROLLOUT_PCT --env production
   # paste:  0
   ```
3. **Recovery (after fix is deployed):** unset `ADVISOR_V2_DISABLED`
   and resume from the last clean phase — do NOT skip phases.

Both kill-switch flags (`ADVISOR_V2_DISABLED` and the legacy
`ADVISOR_DISABLED`) are OR'd, so deleting one does NOT re-enable the
service if the other is still set. Always `wrangler secret list --env
production` after a rollback to confirm the final state.

---

## Files referenced

- Gate logic: `cloudflare-worker/src/services/advisor/rollout.ts`
- Kill switch: `cloudflare-worker/src/services/advisor/guardrails.ts`
  (`checkKillSwitch`)
- Route enforcement helper: `applyAdvisorGate` in
  `cloudflare-worker/src/routes/advisor.ts`
- Eval harness: `scripts/run-advisor-eval.mjs`
- Scenario tests: `cloudflare-worker/test/advisor.scenarios.test.ts`
- Worker config: `wrangler.toml` (secrets are NOT here — set via
  `wrangler secret put`)
