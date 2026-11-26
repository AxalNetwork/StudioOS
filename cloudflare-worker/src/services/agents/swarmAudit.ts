/**
 * D5586 part 2 (#5586): the swarm admission audit copied to D1's append-only `swarm_admission_events`, keyed by each
 * entry's `seq` (the owner's answer A1), a venture-scoped snapshot and a venture-scoped read of the copy. Preview-only
 * and unmounted: no route, cron, binding or flag reads it.
 *
 * The in-state audit stays the record of the transaction (it commits or rolls back with the change, D5586 §2). This
 * module copies it after the transaction: it reads the entries above the state's watermark (`audit_flushed_seq`),
 * writes them with `ON CONFLICT DO NOTHING`, checks any row that was already there against its entry, and only then
 * moves the watermark. A D1 failure moves nothing, so the entries stay in state and the next call copies them again.
 * Entries the bounded state dropped before they were copied become one `audit_gap` row, recorded, never silent. No
 * admission decision reads D1, so a D1 failure can neither admit nor refuse anything.
 */
import type { Env } from '../../types';
import { validateWorkGraph, type Scope, type ValidationContext } from '../workGraphContracts';
import type { AdmissionStore } from './workspaceAdmission';
import { createSwarmAdmission, swarmOf, ventureKey, type SwarmAudit, type SwarmState } from './swarmAdmission';

/** The vocabulary the table's CHECKs accept; `swarm_audit_5586_p2.test.ts` pins it to `swarmAdmission.ts`. */
export const SWARM_AUDIT_ACTIONS = ['request', 'promote', 'settle', 'withdraw', 'revoke', 'audit_gap'] as const;
export const SWARM_AUDIT_OUTCOMES = ['applied', 'queued', 'refused', 'dropped'] as const;
export const SWARM_AUDIT_CODES = ['swarm_halted', 'wrong_tenant', 'agent_revoked', 'agent_unverified', 'modality_not_allowed',
  'provider_not_allowed', 'model_not_allowed', 'revision_unverified', 'stale_revision',
  // #5585 part 15 (D5585-p15): a render's release approval; 202611260840_5585_swarm_admission_events_render_codes.sql.
  'render_approval_unverified', 'render_unapproved', 'render_over_approved',
  'budget_unverified', 'budget_exhausted',
  'storage_unverified', 'storage_quota_exhausted', 'no_capacity', 'venture_capacity', 'modality_capacity', 'publication_in_flight',
  'audit_dropped'] as const;
/** Entries per D1 batch; one flush writes pages until it has caught up or a page fails. */
export const SWARM_AUDIT_PAGE = 100;

export type SwarmAuditRow = {
  tenant_id: number; company_id: number; seq: number; at: number; ticket_uid: string | null;
  action: typeof SWARM_AUDIT_ACTIONS[number]; outcome: typeof SWARM_AUDIT_OUTCOMES[number]; code: string | null;
  charged_microusd: number | null; measured: 0 | 1 | null; gap_to_seq: number | null;
};
export type FlushResult =
  | { ok: true; written: number; replayed: number; gap: { from_seq: number; to_seq: number } | null; flushed_seq: number }
  | { ok: false; code: 'audit_store_unavailable' | 'audit_conflict'; flushed_seq: number; seq?: number };

const COLUMNS = ['tenant_id', 'company_id', 'seq', 'at', 'ticket_uid', 'action', 'outcome', 'code', 'charged_microusd', 'measured', 'gap_to_seq'] as const;
const INSERT = `INSERT INTO swarm_admission_events (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT (tenant_id, company_id, seq) DO NOTHING RETURNING seq`;
const SELECT = `SELECT ${COLUMNS.join(', ')} FROM swarm_admission_events WHERE tenant_id = ? AND company_id = ? AND seq = ?`;

/** One in-state entry as its D1 row. */
export function auditRow(e: SwarmAudit): SwarmAuditRow {
  const billed = e.action === 'settle';
  return { tenant_id: e.tenant_id, company_id: e.company_id, seq: e.seq, at: e.at, ticket_uid: e.ticket_uid, action: e.action,
    outcome: e.outcome, code: e.code, charged_microusd: billed ? e.charged_microusd ?? null : null,
    measured: billed && typeof e.measured === 'boolean' ? (e.measured ? 1 : 0) : null, gap_to_seq: null };
}
const gapRow = (from: number, to: number, at: number): SwarmAuditRow => ({ tenant_id: 0, company_id: 0, seq: from, at, ticket_uid: null,
  action: 'audit_gap', outcome: 'dropped', code: 'audit_dropped', charged_microusd: null, measured: null, gap_to_seq: to });
const sameRow = (a: Record<string, unknown> | null, b: SwarmAuditRow) => Boolean(a) && COLUMNS.every(k => (a as Record<string, unknown>)[k] === b[k]);

/**
 * Copy the entries above the watermark to D1, page by page. Replay-safe: a row already there must equal its entry,
 * or the flush stops with `audit_conflict` and the watermark stays below that entry. The watermark only rises, so two
 * flushes racing over the same entries both land them once.
 */
export async function flushSwarmAudit(store: AdmissionStore, db: Pick<D1Database, 'prepare' | 'batch'>, page = SWARM_AUDIT_PAGE): Promise<FlushResult> {
  let written = 0, replayed = 0, gap: { from_seq: number; to_seq: number } | null = null;
  for (;;) {
    const todo = await store.transaction(state => {
      const sw = swarmOf(state);
      const from = sw.audit_flushed_seq ?? 0;
      const entries = sw.audit.filter(e => e.seq > from).slice(0, page).map(auditRow);
      const firstKept = entries[0]?.seq ?? sw.audit_seq + 1;
      const rows = firstKept > from + 1 ? [gapRow(from + 1, firstKept - 1, sw.last_now), ...entries] : entries;
      return { from, rows };
    });
    if (!todo.rows.length) return { ok: true, written, replayed, gap, flushed_seq: todo.from };
    let results: D1Result[];
    try {
      results = await db.batch(todo.rows.map(r => db.prepare(INSERT).bind(...COLUMNS.map(k => r[k]))));
    } catch {
      return { ok: false, code: 'audit_store_unavailable', flushed_seq: todo.from };
    }
    let through = todo.from;
    for (const [i, row] of todo.rows.entries()) {
      if ((results[i]?.results?.length ?? 0) === 0) {
        let existing: Record<string, unknown> | null;
        try { existing = await db.prepare(SELECT).bind(row.tenant_id, row.company_id, row.seq).first(); }
        catch { break; }
        if (!sameRow(existing, row)) {
          const flushed = await advance(store, through);
          return { ok: false, code: 'audit_conflict', flushed_seq: flushed, seq: row.seq };
        }
        replayed++;
      } else written++;
      if (row.action === 'audit_gap') gap = { from_seq: row.seq, to_seq: row.gap_to_seq as number };
      through = row.action === 'audit_gap' ? row.gap_to_seq as number : row.seq;
    }
    const flushed = await advance(store, through);
    if (through < todo.rows.at(-1)!.seq) return { ok: false, code: 'audit_store_unavailable', flushed_seq: flushed };
  }
}
const advance = (store: AdmissionStore, through: number) => store.transaction(state => {
  const sw = swarmOf(state);
  sw.audit_flushed_seq = Math.max(sw.audit_flushed_seq ?? 0, through);
  return sw.audit_flushed_seq;
});

/**
 * One venture's part of the swarm state: its tickets and its audit entries (refusals included), nothing of another
 * venture's. The shape is `SwarmState`, so a reader written for the whole state (#5585's `renderAdmissions`) takes it.
 * The counters (`audit_seq`, `audit_dropped`, the watermark) are the coordinator's and say nothing about other ventures.
 */
export function scopedSwarmState(sw: SwarmState, venture: { tenant_id: number; company_id: number }): SwarmState {
  const key = ventureKey(venture);
  return structuredClone({ ...sw,
    tickets: Object.fromEntries(Object.entries(sw.tickets).filter(([, t]) => ventureKey(t) === key)),
    audit: sw.audit.filter(e => ventureKey(e) === key) });
}

/**
 * Swarm admission whose every change is followed by a copy of the audit to D1, for the coordinator Durable Object to
 * host. The answer is the admission's own, whatever the copy did: a failed copy is reported through `onFlush` and
 * retried by the next call, never turned into a refusal or an admission.
 */
export function createAuditedSwarmAdmission(deps: Parameters<typeof createSwarmAdmission>[0] & {
  db: Pick<D1Database, 'prepare' | 'batch'>; onFlush?: (r: FlushResult) => void;
}) {
  const swarm = createSwarmAdmission(deps);
  const flush = async () => {
    let r: FlushResult;
    try { r = await flushSwarmAudit(deps.store, deps.db); }
    catch { r = { ok: false, code: 'audit_store_unavailable', flushed_seq: -1 }; }
    deps.onFlush?.(r);
    return r;
  };
  const after = <A extends unknown[], R>(op: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => { const out = await op(...a); await flush(); return out; };
  return {
    request: after(swarm.request), promote: after(swarm.promote), settle: after(swarm.settle),
    withdraw: after(swarm.withdraw), revokeAgent: after(swarm.revokeAgent),
    snapshot: swarm.snapshot,
    /** One venture's tickets and audit entries (see `scopedSwarmState`). */
    snapshotFor: async (venture: { tenant_id: number; company_id: number }) => scopedSwarmState(await swarm.snapshot(), venture),
    flushAudit: flush,
  };
}
export type AuditedSwarmAdmission = ReturnType<typeof createAuditedSwarmAdmission>;

/**
 * The copied audit of one tenant and company, oldest first, optionally for some tickets only. It refuses
 * `wrong_tenant` before any statement and binds every statement to the scope's tenant and company; gap rows belong
 * to no venture and are not returned.
 */
export async function readSwarmAdmissionEvents(env: Pick<Env, 'DB'>, ctx: ValidationContext, scope: Scope, opts: { ticket_uids?: readonly string[]; limit?: number } = {})
  : Promise<{ ok: true; events: SwarmAuditRow[] } | { ok: false; code: 'wrong_tenant' | 'malformed' | 'unavailable' }> {
  if (!scope || !Number.isSafeInteger(scope.tenantId) || !Number.isSafeInteger(scope.companyId) || scope.tenantId < 1 || scope.companyId < 1) return { ok: false, code: 'malformed' };
  const uids = opts.ticket_uids ?? null;
  if (uids && (!Array.isArray(uids) || uids.length > 50 || uids.some(u => typeof u !== 'string' || !u))) return { ok: false, code: 'malformed' };
  const limit = Math.min(Math.max(Number.isSafeInteger(opts.limit) ? opts.limit as number : 500, 1), 2000);
  if (validateWorkGraph({ assets: [{ id: 'x', scope, kind: 'composite', headVersionId: null, accessClass: 'internal', approvalPolicy: 'x' }] }, ctx).some(v => v.code === 'wrong_tenant')) {
    return { ok: false, code: 'wrong_tenant' };
  }
  try {
    const r = await env.DB.prepare(`SELECT tenant_id, company_id, seq, at, ticket_uid, action, outcome, code, charged_microusd, measured, gap_to_seq
        FROM swarm_admission_events
       WHERE tenant_id = ? AND company_id = ? AND (? IS NULL OR ticket_uid IN (SELECT value FROM json_each(?)))
       ORDER BY seq LIMIT ?`)
      .bind(scope.tenantId, scope.companyId, uids ? 1 : null, JSON.stringify(uids ?? []), limit).all<SwarmAuditRow>();
    return { ok: true, events: r.results ?? [] };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}
