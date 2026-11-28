/**
 * #8516 (D8516) — the durable record of what a signature set in motion, and
 * its replay.
 *
 * A completed envelope used to run its dependent effects in try blocks that
 * only logged: a failure left no trace and nobody could replay it. Each
 * required effect now has a row in `esign_effects` (migration
 * 202611250101_8516_esign_effects.sql): pending, done or failed, with its
 * attempts and the CLASS of its last error (a code, never message text).
 *
 * Part 1 holds one kind, `staged_next_stage` (the next signer of a staged
 * envelope). The others stay as they are in routes/esign.ts until their own
 * parts move onto this record.
 *
 *   · `REQUIRED_EFFECTS` — the one table of which effects a document type
 *     requires. `'*'` is every type.
 *   · `recordRequiredEffects` — statements for the batch that completes the
 *     envelope, so the record exists as soon as the envelope is completed.
 *   · `runEffect` — one attempt, claimed in SQL so an attempt that is not
 *     due runs nothing. A `done` record is never run again.
 *   · `sweepEffects` — the Worker tick's retry: pending and failed records,
 *     oldest first, until `MAX_EFFECT_ATTEMPTS`.
 *
 * D6706 (#6706) adds an OWED effect: `formation_case_signed`, the signed copy
 * of an envelope a formation case sent, landing on the case (and, for a
 * consent to act, the person's consent). It is not in REQUIRED_EFFECTS: the
 * case writes its record when it sends the envelope (`owedEffectStatement`),
 * so the completion batch never names a formation table. A record runs only
 * once its envelope is completed — the claim and the sweep both require it —
 * so an owed record waits, untouched, until the signature completes.
 */
import type { Env } from '../types';

export type EffectKind = 'staged_next_stage' | 'formation_case_signed';
export type EffectState = 'pending' | 'done' | 'failed';

/** Every run counts, the first included. A record at the cap stays failed until an operator retries it. */
export const MAX_EFFECT_ATTEMPTS = 5;
/** A pending or failed record is retried by the tick only when it was last touched this long ago. */
export const RETRY_AFTER_MINUTES = 2;
const SWEEP_LIMIT = 20;

/** Which effects each document type requires. Part 1 lists only the staged effect. */
export const REQUIRED_EFFECTS: Record<string, readonly EffectKind[]> = {
  '*': ['staged_next_stage'],
};

export function requiredEffects(documentType: string | null | undefined): EffectKind[] {
  return [...new Set([...(REQUIRED_EFFECTS['*'] ?? []), ...(documentType ? REQUIRED_EFFECTS[documentType] ?? [] : [])])];
}

type Handler = (env: Env, envelopeUuid: string, appUrl: string) => Promise<unknown>;
const HANDLERS: Record<EffectKind, Handler> = {
  staged_next_stage: async (env, uuid, appUrl) => {
    const { runStagedNextStage } = await import('./stagedSigning');
    return runStagedNextStage(env, uuid, appUrl);
  },
  formation_case_signed: async (env, uuid) => {
    const { onCaseEnvelopeCompleted } = await import('./formationCaseSigned');
    return onCaseEnvelopeCompleted(env, uuid);
  },
};

/** Kinds a sender declares owed when it sends the envelope, rather than the completion batch. */
export const OWED_AT_SEND: readonly EffectKind[] = Object.freeze(['formation_case_signed']);

/**
 * D6706: the statement that records an effect owed by the sender, to ride in
 * the sender's own batch after the envelope exists. `INSERT OR IGNORE`: a
 * second send of the same envelope never resets a record.
 */
export function owedEffectStatement(env: Env, envelopeId: number, kind: EffectKind) {
  if (!OWED_AT_SEND.includes(kind)) throw new Error('effect_not_owed_at_send');
  return env.DB.prepare(`INSERT OR IGNORE INTO esign_effects (envelope_id, effect_kind) SELECT id, ? FROM esign_envelopes WHERE id = ?`)
    .bind(kind, envelopeId);
}

// D6706: a record is due only once its envelope is completed (a record written at completion always is):
// the claim and the sweep below both carry that EXISTS.

export type EffectRow = {
  id: number; envelope_id: number; effect_kind: EffectKind; state: EffectState;
  attempts: number; last_error_class: string | null;
};

/**
 * Statements that create the pending records, to ride in the batch that
 * completes the envelope. A kind that does not apply to this envelope writes
 * no row (the staged effect applies only to an envelope that is a stage).
 * `INSERT OR IGNORE`: a replayed completion never resets a record.
 */
export function recordRequiredEffects(env: Env, envelopeId: number, documentType: string | null | undefined) {
  const stmts = [];
  for (const kind of requiredEffects(documentType)) {
    if (kind === 'staged_next_stage') {
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO esign_effects (envelope_id, effect_kind)
         SELECT e.id, 'staged_next_stage' FROM esign_envelopes e
          WHERE e.id = ? AND EXISTS (SELECT 1 FROM esign_staged_signers s WHERE s.envelope_uuid = e.envelope_uuid)`,
      ).bind(envelopeId));
    }
  }
  return stmts;
}

function errorClass(e: unknown): string {
  const name = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : (e as Error)?.name;
  const cls = String(name || 'error').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 64);
  return cls || 'error';
}

export type EffectOutcome = { ran: boolean; state: EffectState | 'missing'; attempts: number; error_class: string | null };

/**
 * One attempt at one record. The claim is the UPDATE: it succeeds only for a
 * pending or failed record under the cap (or any not-done record when
 * `force`, the operator's retry), so a `done` record, and a record at the cap
 * the tick reaches, change nothing and run nothing.
 */
export async function runEffect(env: Env, id: number, appUrl: string, opts: { force?: boolean } = {}): Promise<EffectOutcome> {
  const claim = await env.DB.prepare(
    `UPDATE esign_effects SET attempts = attempts + 1, last_attempt_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND state IN ('pending', 'failed') AND (? = 1 OR attempts < ?) AND EXISTS (SELECT 1 FROM esign_envelopes ce WHERE ce.id = esign_effects.envelope_id AND ce.status = 'completed')`,
  ).bind(id, opts.force ? 1 : 0, MAX_EFFECT_ATTEMPTS).run();
  const row = await env.DB.prepare(
    `SELECT x.id, x.envelope_id, x.effect_kind, x.state, x.attempts, x.last_error_class, e.envelope_uuid
       FROM esign_effects x LEFT JOIN esign_envelopes e ON e.id = x.envelope_id WHERE x.id = ?`,
  ).bind(id).first<EffectRow & { envelope_uuid: string | null }>();
  if (!row) return { ran: false, state: 'missing', attempts: 0, error_class: null };
  if ((claim.meta?.changes ?? 0) === 0) return { ran: false, state: row.state, attempts: Number(row.attempts), error_class: row.last_error_class };
  try {
    const handler = HANDLERS[row.effect_kind];
    if (!handler) throw Object.assign(new Error('unknown_effect_kind'), { code: 'unknown_effect_kind' });
    if (!row.envelope_uuid) throw Object.assign(new Error('envelope_missing'), { code: 'envelope_missing' });
    await handler(env, row.envelope_uuid, appUrl);
    await env.DB.prepare(
      `UPDATE esign_effects SET state = 'done', last_error_class = NULL, done_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).bind(id).run();
    return { ran: true, state: 'done', attempts: Number(row.attempts), error_class: null };
  } catch (e) {
    const cls = errorClass(e);
    await env.DB.prepare(
      `UPDATE esign_effects SET state = 'failed', last_error_class = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(cls, id).run().catch(() => {});
    console.warn(`[esign] effect_failed kind=${row.effect_kind} envelope=${row.envelope_id} class=${cls} attempt=${row.attempts}`);
    return { ran: true, state: 'failed', attempts: Number(row.attempts), error_class: cls };
  }
}

/** The records an envelope has, run once each, right after completion. */
export async function runEnvelopeEffects(env: Env, envelopeId: number, appUrl: string): Promise<void> {
  const rows = await env.DB.prepare(`SELECT id FROM esign_effects WHERE envelope_id = ? AND state = 'pending' ORDER BY id`).bind(envelopeId).all<{ id: number }>();
  for (const r of rows.results || []) await runEffect(env, r.id, appUrl);
}

export type SweepSummary = { due: number; done: number; failed: number; at_cap: number };

/**
 * The tick's replay: pending and failed records under the cap that were last
 * touched at least RETRY_AFTER_MINUTES ago, oldest first. `at_cap` counts
 * failed records the sweep no longer retries, for the log line.
 */
export async function sweepEffects(env: Env, appUrl: string): Promise<SweepSummary> {
  const due = await env.DB.prepare(
    `SELECT id FROM esign_effects
      WHERE state IN ('pending', 'failed') AND attempts < ? AND datetime(updated_at) <= datetime('now', ?) AND EXISTS (SELECT 1 FROM esign_envelopes ce WHERE ce.id = esign_effects.envelope_id AND ce.status = 'completed')
      ORDER BY id LIMIT ?`,
  ).bind(MAX_EFFECT_ATTEMPTS, `-${RETRY_AFTER_MINUTES} minutes`, SWEEP_LIMIT).all<{ id: number }>();
  const out: SweepSummary = { due: 0, done: 0, failed: 0, at_cap: 0 };
  for (const r of due.results || []) {
    out.due += 1;
    const o = await runEffect(env, r.id, appUrl);
    if (o.state === 'done') out.done += 1; else if (o.state === 'failed') out.failed += 1;
  }
  const cap = await env.DB.prepare(`SELECT COUNT(*) AS n FROM esign_effects WHERE state = 'failed' AND attempts >= ?`).bind(MAX_EFFECT_ATTEMPTS).first<{ n: number }>();
  out.at_cap = Number(cap?.n ?? 0);
  return out;
}
