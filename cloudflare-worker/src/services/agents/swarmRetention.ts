/**
 * D5586 part 4 (#5586): bounded retention of the coordinator's swarm state. Settled and withdrawn tickets older than
 * `SWARM_RETENTION_MS` are compacted to a tombstone, and in-state audit entries older than that which D1 already holds
 * are removed, at most `SWARM_RETENTION_BATCH` of each per storage transaction and `SWARM_RETENTION_MAX_BATCHES`
 * transactions per call. A scheduler calls it through the coordinator (`retireSwarmAdmission` in
 * `workspaceAdmissionClient.ts`); no cron is configured (D5586-p4 §3 names the schedule it would run on).
 *
 * WHAT IS KEPT. A retired ticket leaves `{ venture, state, bill, ended_at }` under its uid, so a redelivered request is
 * refused `ticket_retired` (never admitted, never billed twice), a repeated settle answers the first bill, and the
 * coordinator still knows whose uid it was. Its settled charge is carried per venture and per render piece, so neither
 * the render budget nor a render approval regains what was spent. The tombstone list is bounded
 * (`SWARM_RETIRED_MAX`); the oldest are evicted and counted in `dropped`, never silently.
 *
 * WHAT IS NOT TOUCHED. Waiting and admitted tickets; a ticket whose #5570 lease still holds a slot; an audit entry not
 * yet copied to D1 (above `audit_flushed_seq`). D1's `swarm_admission_events` is append-only (its triggers refuse
 * DELETE) and is the durable record: retention never deletes from it.
 */
import type { AdmissionState, AdmissionStore } from './workspaceAdmission';
import { RENDER_APPROVAL_MODALITIES, renderKey, swarmOf, ventureKey, type SwarmRetired, type SwarmState, type SwarmTicket } from './swarmAdmission';

/** A terminal ticket, or a copied audit entry, is retired once it is this old: 30 days. */
export const SWARM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Tickets, and audit entries, retired per storage transaction. */
export const SWARM_RETENTION_BATCH = 200;
/** Transactions per call; a call that stops with work left answers `more: true`. */
export const SWARM_RETENTION_MAX_BATCHES = 10;
/** Tombstones kept; older ones are evicted and counted in `retired.dropped`. */
export const SWARM_RETIRED_MAX = 5000;

export type RetentionOptions = { maxAgeMs?: number; batch?: number; maxBatches?: number; retiredMax?: number };
export type RetentionPass = { tickets: number; slots: number; audit: number; evicted: number; more: boolean };
export type RetentionResult = { ok: true; value: RetentionPass & { batches: number; now: number; cutoff: number } }
  | { ok: false; status: 503; code: 'clock_regressed' | 'invalid_retention'; message: string; reasons: string[] };

const emptyRetired = (): SwarmRetired => ({ uids: {}, order: [], dropped: 0, tickets: {}, charged: {}, render: {}, audit_compacted: 0 });
/** When a terminal ticket ended; a withdrawal from before part 4 has no `ended_at` and is aged from its enqueue. */
const endedAt = (t: SwarmTicket): number | null => (t.state === 'settled' ? t.settled_at : t.state === 'withdrawn' ? t.ended_at ?? t.enqueued_at : null);
/** A #5570 slot that still holds (or may still hold) capacity keeps its ticket. */
const slotHolds = (state: AdmissionState, uid: string) => {
  const s = state.slots?.[uid];
  return Boolean(s) && s.state !== 'released' && s.state !== 'withdrawn';
};

/**
 * One bounded pass over one transaction's state. Pure: it changes only `state`, and only what is older than
 * `cutoff`. Oldest first, so a call that stops early leaves only younger work.
 */
export function retireSwarmState(state: AdmissionState, cutoff: number, opts: { batch: number; retiredMax: number }): RetentionPass {
  const sw: SwarmState = swarmOf(state);
  const due = Object.values(sw.tickets)
    .filter(t => { const e = endedAt(t); return e !== null && e <= cutoff && !slotHolds(state, t.ticket_uid); })
    .sort((a, b) => (endedAt(a) as number) - (endedAt(b) as number) || a.sequence - b.sequence);
  const take = due.slice(0, opts.batch);
  let slots = 0, evicted = 0;
  if (take.length) {
    const r = (sw.retired ??= emptyRetired());
    for (const t of take) {
      const key = ventureKey(t);
      const settled = t.state === 'settled';
      const charged = settled && Number.isSafeInteger(t.charged_microusd) ? t.charged_microusd as number : 0;
      r.uids[t.ticket_uid] = { venture: key, state: settled ? 'settled' : 'withdrawn', charged_microusd: settled ? t.charged_microusd : null,
        measured: settled ? t.measured : null, ended_at: endedAt(t) as number };
      r.order.push(t.ticket_uid);
      r.tickets[key] = (r.tickets[key] ?? 0) + 1;
      if (charged) {
        r.charged[key] = (r.charged[key] ?? 0) + charged;
        if (RENDER_APPROVAL_MODALITIES.includes(t.modality)) r.render[renderKey(t)] = (r.render[renderKey(t)] ?? 0) + charged;
      }
      delete sw.tickets[t.ticket_uid];
      if (state.slots?.[t.ticket_uid]) { delete state.slots[t.ticket_uid]; slots++; }
    }
    while (r.order.length > opts.retiredMax) { delete r.uids[r.order.shift() as string]; r.dropped++; evicted++; }
  }
  // Audit entries: only a leading run that D1 already holds and that is old enough (seq and time both ascend).
  const flushed = sw.audit_flushed_seq ?? 0;
  let k = 0;
  while (k < opts.batch && k < sw.audit.length && sw.audit[k].seq <= flushed && sw.audit[k].at <= cutoff) k++;
  if (k) { sw.audit.splice(0, k); (sw.retired ??= emptyRetired()).audit_compacted += k; }
  const nextAudit = sw.audit[0];
  const more = due.length > take.length || Boolean(nextAudit && nextAudit.seq <= flushed && nextAudit.at <= cutoff);
  return { tickets: take.length, slots, audit: k, evicted, more };
}

/**
 * Retire what is due, in at most `maxBatches` transactions of at most `batch` tickets and `batch` audit entries
 * each. Idempotent: a second call over the same state finds nothing due. The clock is read once; a clock behind the
 * state's last decision is refused (`clock_regressed`) and retires nothing.
 */
export async function retireSwarmAdmission(store: AdmissionStore, clock: () => number, opts: RetentionOptions = {}): Promise<RetentionResult> {
  const maxAgeMs = opts.maxAgeMs ?? SWARM_RETENTION_MS, batch = opts.batch ?? SWARM_RETENTION_BATCH;
  const maxBatches = opts.maxBatches ?? SWARM_RETENTION_MAX_BATCHES, retiredMax = opts.retiredMax ?? SWARM_RETIRED_MAX;
  const refusal = (code: 'clock_regressed' | 'invalid_retention') => ({ ok: false as const, status: 503 as const, code,
    message: 'Swarm retention did not run.', reasons: [code] });
  if (![maxAgeMs, batch, maxBatches, retiredMax].every(n => Number.isSafeInteger(n) && n >= 1)) return refusal('invalid_retention');
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) return refusal('invalid_retention');
  const cutoff = now - maxAgeMs;
  const total = { tickets: 0, slots: 0, audit: 0, evicted: 0, more: false };
  let batches = 0;
  for (; batches < maxBatches; ) {
    const pass = await store.transaction(state => (now < swarmOf(state).last_now ? null : retireSwarmState(state, cutoff, { batch, retiredMax })));
    if (pass === null) return refusal('clock_regressed');
    batches++;
    total.tickets += pass.tickets; total.slots += pass.slots; total.audit += pass.audit; total.evicted += pass.evicted; total.more = pass.more;
    if (!pass.more) break;
  }
  return { ok: true, value: { ...total, batches, now, cutoff } };
}
