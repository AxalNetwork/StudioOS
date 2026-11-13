/**
 * #4575 (AI governance G1) — one agent run's provenance, read from the tables
 * the engine already writes. No new store, no new ledger: a join over
 * `agent_task_runs`, `scope_tasks`, `team_agents`, `ai_usage_logs`,
 * `ai_budget_reservations` and `ai_rail_proposals`.
 *
 * UNAVAILABLE IS NOT ZERO. Every field that may be missing is a `Known<T>`:
 * `{ available: true, value }` or `{ available: false, why }`. A charge the
 * usage row does not record, a hold that was never written, a field no table
 * keeps per run (the tool grants as they were when the run was admitted, the
 * data class): each says so, and none is reported as 0 or invented.
 *
 * NEVER INCLUDED: a prompt, a proposal's payload, a tool's arguments or
 * result, a step's summary text, an email or a name. The ids are the opaque
 * ones the tables already carry. The test holds this.
 *
 * RECONCILIATION — one word per run, from its hold (by the hold's idempotency
 * key, `agent:<run uid>:run`, so a hold with no usage row is still found), its
 * usage row and its proposal:
 *   nothing_charged   no hold, no usage row, no proposal: nothing ran
 *   settled_matches   the hold settled, at exactly the usage row's charge
 *   held_unsettled    the hold is still pending or in review
 *   held_expired      pending past its expiry: an orphan for the sweep
 *   released          the hold was refunded and nothing was charged
 *   mismatch          a settled amount differs from the charge, a refunded hold
 *                     with a charge, or a charge with no hold
 *   unrecorded        a proposal or a usage row exists but its charge or hold
 *                     cannot be read: unknown, not zero
 */
import type { Env } from '../../types';
import { holdKeyOf, runKeyOf } from './agentRun';

export type Known<T> = { available: true; value: T } | { available: false; why: string };
const known = <T>(value: T): Known<T> => ({ available: true, value });
const unknown = (why: string): Known<never> => ({ available: false, why });

export const RECONCILIATION = ['nothing_charged', 'settled_matches', 'held_unsettled', 'held_expired', 'released', 'mismatch', 'unrecorded'] as const;
export type Reconciliation = (typeof RECONCILIATION)[number];

export type RunProvenance = {
  run: { uid: string; attempt: number; status: string; step: string | null; failure: Known<string>; admitted_at: string; ended_at: Known<string> };
  task: { uid: string; scope: string; module: string | null; option: string | null };
  agent: { uid: string; role_key: string; sponsor_user_id: number; model_configured: string | null };
  model_invoked: Known<string>;
  skill: Known<{ id: number; version: number }>;
  tool_grants_at_admission: Known<never>;
  data_class: Known<never>;
  idempotency: { run_key: string; hold_key: string };
  hold: Known<{ status: string; held_microusd: number; settled_microusd: Known<number>; expired: boolean }>;
  charge_microusd: Known<number>;
  proposal: Known<{ uid: string; status: string; decided_at: Known<string>; decided_by_user_id: Known<number> }>;
  reconciliation: Reconciliation;
};

type RunRow = { uid: string; attempt: number; status: string; step: string | null; refusal: string | null; created_at: string; ended_at: string | null;
  usage_log_id: number | null; proposal_uid: string | null;
  task_uid: string; scope_kind: string; company_id: number | null; project_id: number | null; module: string | null; option: string | null;
  agent_uid: string; role_key: string; sponsor_user_id: number; model_id: string | null };
type UsageRow = { model: string | null; charged_microusd: number | null; skill_id: number | null; skill_version: number | null };
type HoldRow = { status: string; included_microusd: number; topup_microusd: number; actual_included_microusd: number | null; actual_topup_microusd: number | null; expires_at: string | null };
type ProposalRow = { uid: string; status: string; decided_at: string | null; decided_by_user_id: number | null };

const int = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** The one word for a run's money, from what was read (see the header). */
export function reconcile(hold: HoldRow | null, usage: UsageRow | null, proposal: ProposalRow | null, now: Date): Reconciliation {
  const charged = usage ? int(usage.charged_microusd) : null;
  if (!hold) {
    if (charged !== null && charged > 0) return 'mismatch';
    if (!usage && !proposal) return 'nothing_charged';
    return 'unrecorded';
  }
  if (hold.status === 'pending' || hold.status === 'review') {
    const expired = hold.expires_at ? Date.parse(`${hold.expires_at.replace(' ', 'T')}Z`) < now.getTime() : false;
    return expired ? 'held_expired' : 'held_unsettled';
  }
  const settled = (int(hold.actual_included_microusd) ?? 0) + (int(hold.actual_topup_microusd) ?? 0);
  if (hold.status === 'refunded') return charged !== null && charged > 0 ? 'mismatch' : 'released';
  if (hold.status === 'settled') {
    if (charged === null) return 'unrecorded';
    return charged === settled ? 'settled_matches' : 'mismatch';
  }
  return 'unrecorded';
}

/** One run's provenance, or null when no such run exists. Read-only; never throws on a missing join. */
export async function runProvenance(env: Env, runUid: string, now = new Date()): Promise<RunProvenance | null> {
  const r = await env.DB.prepare(
    `SELECT r.uid, r.attempt, r.status, r.step, r.refusal, r.created_at, r.ended_at, r.usage_log_id, r.proposal_uid,
            t.uid AS task_uid, t.scope_kind, t.company_id, t.project_id, t.module, t.option,
            a.uid AS agent_uid, a.role_key, a.sponsor_user_id, a.model_id
       FROM agent_task_runs r
       JOIN scope_tasks t ON t.id = r.task_id
       JOIN team_agents a ON a.id = r.agent_id
      WHERE r.uid = ?`,
  ).bind(runUid).first<RunRow>();
  if (!r) return null;
  const runKey = runKeyOf(r.uid);
  const holdKey = holdKeyOf(runKey);
  const usage = r.usage_log_id == null ? null : await env.DB.prepare(
    'SELECT model, charged_microusd, skill_id, skill_version FROM ai_usage_logs WHERE id = ?',
  ).bind(r.usage_log_id).first<UsageRow>();
  const hold = await env.DB.prepare(
    `SELECT status, included_microusd, topup_microusd, actual_included_microusd, actual_topup_microusd, expires_at
       FROM ai_budget_reservations WHERE idempotency_key = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(holdKey).first<HoldRow>();
  const proposal = await env.DB.prepare(
    'SELECT uid, status, decided_at, decided_by_user_id FROM ai_rail_proposals WHERE run_key = ? LIMIT 1',
  ).bind(runKey).first<ProposalRow>();

  const charged = usage ? int(usage.charged_microusd) : null;
  const settled = hold && (hold.status === 'settled' || hold.status === 'refunded')
    ? known((int(hold.actual_included_microusd) ?? 0) + (int(hold.actual_topup_microusd) ?? 0))
    : unknown('the hold is not settled');
  const scopeId = r.scope_kind === 'company' ? r.company_id : r.project_id;
  return {
    run: {
      uid: r.uid, attempt: Number(r.attempt), status: r.status, step: r.step ?? null,
      failure: r.refusal ? known(r.refusal) : unknown('no failure recorded'),
      admitted_at: r.created_at,
      ended_at: r.ended_at ? known(r.ended_at) : unknown('the run has not ended'),
    },
    task: { uid: r.task_uid, scope: `${r.scope_kind}:${scopeId}`, module: r.module, option: r.option },
    agent: { uid: r.agent_uid, role_key: r.role_key, sponsor_user_id: Number(r.sponsor_user_id), model_configured: r.model_id ?? null },
    model_invoked: usage?.model ? known(usage.model) : unknown(usage ? 'the usage row names no model' : 'no usage row for this run'),
    skill: usage && int(usage.skill_id) !== null && int(usage.skill_version) !== null
      ? known({ id: Number(usage.skill_id), version: Number(usage.skill_version) })
      : unknown(usage ? 'the usage row records no skill' : 'no usage row for this run'),
    tool_grants_at_admission: unknown('not recorded per run: an agent\'s grants are read live at each call'),
    data_class: unknown('not recorded per run'),
    idempotency: { run_key: runKey, hold_key: holdKey },
    hold: hold
      ? known({ status: hold.status, held_microusd: (int(hold.included_microusd) ?? 0) + (int(hold.topup_microusd) ?? 0), settled_microusd: settled,
        expired: (hold.status === 'pending' || hold.status === 'review') && !!hold.expires_at && Date.parse(`${hold.expires_at.replace(' ', 'T')}Z`) < now.getTime() })
      : unknown('no hold was written for this run'),
    charge_microusd: charged !== null ? known(charged) : unknown(usage ? 'the usage row records no charge' : 'no usage row for this run'),
    proposal: proposal
      ? known({ uid: proposal.uid, status: proposal.status,
        decided_at: proposal.decided_at ? known(proposal.decided_at) : unknown('not decided'),
        decided_by_user_id: proposal.decided_by_user_id != null ? known(Number(proposal.decided_by_user_id)) : unknown('not decided') })
      : unknown('no proposal for this run'),
    reconciliation: reconcile(hold, usage, proposal, now),
  };
}
