/**
 * D4708 (#4708) — the AI-safety block of HQ › Security: what `/overview` serves as `ai_safety` and the pointer
 * `/governance` serves as `guardrails`. Moved from `routes/admin_security.ts` unchanged.
 */
import type { Env } from '../../types';
import { loadTokenAnomalies } from '../tokenAnomalies';
import { loadGuardrailCounters, loadRecentGuardVerdicts } from '../aiRouter';

/**
 * D152 — THE SENTENCE WAS WRONG ON TWO OF ITS THREE CLAUSES, AND IT IS
 * NARROWED RATHER THAN DELETED (the D111 pattern).
 *
 * It read: *"No guardrail-hit, flagged-output or token-anomaly counter is
 * stored for the AI rails."* Measured against the code:
 *
 *   · **guardrail-hit — FALSE.** `ai_usage_logs.safety_score` (migration 040)
 *     is written by `recordUsage` on every router call, and `task = 'safety'`
 *     rows are llama-guard's verdicts. They were already rolled up and already
 *     on screen — `AiUsageTab` renders them as "Guardrail safety (llama-guard)"
 *     — so this page denied a store the platform was showing one click away.
 *   · **flagged-output — FALSE.** `advisor_turn_audit.shadow_flagged`
 *     (migration 043) with its own index, written from seventeen call sites.
 *   · **token-anomaly — TRUE, and it is the only clause that survives.** The
 *     phrase occurs nowhere in the repo except this constant.
 *
 * So the zones now carry FIGURES from `loadGuardrailCounters` plus this,
 * which is what is still genuinely uncounted. One list, two zones — the same
 * argument the old comment made for one sentence, and for the same reason:
 * two literals drift the day one of them is reworded.
 */
export const AI_SAFETY_NOT_COUNTED: Array<{ what: string; reason: string }> = [
  // D481 — 'Token anomalies' WAS THE FIRST ROW HERE AND IS GONE, for the reason
  // D158 removed the rule row below: the thing was built rather than
  // re-described. The block now carries `token_anomalies` from
  // services/tokenAnomalies.ts, which reads `ai_usage_logs` directly.
  //
  // The two rows that replace it are H23's own tiles, which this page had not
  // named at all — the canvas drew them with sample counts and the page drew
  // nothing, which is neither a figure nor a stated absence.
  {
    what: 'Cross-tenant refusals',
    reason: 'No store records a refusal to cross a tenant. `ai_usage_logs.refusal` names budget, kill-switch '
      + 'and model failures only, neither AI table carries a tenant column, and no branch RPC returns one — '
      + 'so the tenancy wall holding is not something this page can count.',
  },
  {
    what: 'Flagged outputs held for review',
    reason: 'Nothing holds an output for review. A shadow flag is counted above as Outputs flagged, and the '
      + 'turn it flagged was still answered; no table records a held output or its release.',
  },
  // D158 — 'Which guardrail rule fired' WAS THE SECOND ROW HERE AND IS GONE,
  // because the thing it described was fixed rather than merely re-described.
  // D152 filed the category as a producer with no store and put this row on the
  // screen saying so; migration 270 gave `advisor_turn_audit` the column,
  // `writeTurnAudit` binds it at all seventeen call sites, and
  // `loadGuardrailCounters` returns the breakdown as `enforcement.rules`. The
  // TWELFTH refusal in this programme to be re-aimed the day it stopped being
  // true — and the first one this codebase filed against itself, which is what
  // a filed measurement is supposed to lead to.
  {
    what: 'Guardrail counters by branch',
    reason: 'Neither `ai_usage_logs` nor `advisor_turn_audit` carries a branch, tenant or licence column, and no '
      + 'branch RPC returns safety counters — so these figures are platform-wide. Splitting them four ways today '
      + 'would label one deployment\'s numbers as four.',
  },
];

/**
 * The window both zones count over. One constant for the same reason the list
 * above is one list, and 7 days because that is what `loadAiUsageReport`
 * defaults to — so this page and `AiUsageTab` are counting the same days
 * rather than two figures that disagree for a reason nobody can see.
 */
export const AI_SAFETY_WINDOW_DAYS = 7;

/**
 * The AI-safety block, built once and served to `/overview` as `ai_safety` and
 * to `/governance` as `guardrails`. `verdicts` and `enforcement` each carry
 * their own availability, because they come from different tables and
 * `advisor_turn_audit` is lazily bootstrapped — an unreadable table read as
 * "zero hits" is the #204 defect, and on a safety counter it is the worst
 * possible direction to be wrong in.
 */
export async function aiSafetyBlock(env: Env) {
  // D481 — the token anomalies carry their own availability, their own table
  // and their own window (24 hours against the seven days before), stated in
  // their own `how`; they answer whatever the rollup below does.
  const always = {
    token_anomalies: await loadTokenAnomalies(env),
    // D4803 — SE08's "Recent guard verdicts", its own read with its own availability.
    recent_verdicts: await loadRecentGuardVerdicts(env, AI_SAFETY_WINDOW_DAYS),
    not_counted: AI_SAFETY_NOT_COUNTED,
  };
  // D4691 — `available` is earned, not asserted: a rollup that threw is the
  // whole block unreadable, with its reason, never a block of zeros.
  let counters: Awaited<ReturnType<typeof loadGuardrailCounters>>;
  try {
    counters = await loadGuardrailCounters(env, AI_SAFETY_WINDOW_DAYS);
  } catch {
    return {
      available: false as const,
      reason: 'The AI guardrail counters could not be read on this database. That is not a claim that no guarded '
        + 'call ran or that nothing was blocked.',
      ...always,
    };
  }
  return {
    available: true as const,
    window_days: counters.window_days,
    since: counters.since,
    verdicts: counters.verdicts,
    enforcement: counters.enforcement,
    guard: counters.guard, // D4522: router enforcement is separate from legacy chat.
    ...always,
  };
}

/**
 * H7 draws a guardrail-hit panel, and D152 gave it figures — served ONCE,
 * by /overview as `ai_safety`, with this field pointing at them.
 *
 * WHY A POINTER AND NOT A SECOND COPY OF THE BLOCK. Both payloads land on
 * the same page: `SecurityPage` fetches /overview and /governance together,
 * and the page's own header records that H7 was reconciled INTO this
 * surface rather than drawn beside it — so H7's guardrail panel IS the
 * AI-safety zone. Serving the counters here too would put two renders of
 * one rollup on one screen (the tile-vs-table disagreement D128 ended) and
 * spend a second pair of D1 reads per governance load on a field nothing
 * reads. This is the shape `audit` at the top of /overview already uses:
 * the figure in one place, a pointer to it in the other.
 */
export const GUARDRAILS_POINTER = {
  counters_on: '/api/admin/security/overview',
  field: 'ai_safety',
  window_days: AI_SAFETY_WINDOW_DAYS,
  // What the counters still cannot say, from the same list they carry, so
  // a reader of this endpoint alone is not told a narrower truth than a
  // reader of the other one.
  not_counted: AI_SAFETY_NOT_COUNTED,
};
