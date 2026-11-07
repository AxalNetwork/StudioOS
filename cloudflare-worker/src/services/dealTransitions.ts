/**
 * D4632 (#4632) — one policy for how a studio deal (`deals.status`) is born
 * and how it moves, and the one atomic write each move makes.
 *
 * BIRTH. A founder's deal is born `applied` and nothing else. A founder never
 * names a partner. An admin may draft into any pipeline stage. Nobody drafts
 * into the terminal stage: a pass needs its reason, so it goes through
 * POST /:id/pass. Intake and project creation write `applied` as well.
 *
 * A MOVE. The callers (PUT /:id, POST /:id/advance, POST /:id/pass) check the
 * mover's authority with `canMoveRound` before calling in here. A move is then
 * one batch of two statements, and both read the same precondition: the stage
 * and `stage_changed_at` the caller read, i.e. the round's version.
 *
 *   1. its history row (`deal_stage_events`), inserted only while that
 *      version still holds;
 *   2. the deal itself, with every field sent with the move, updated only
 *      while that version still holds.
 *
 * If another move lands between the read and the write, neither statement
 * changes anything. The stage, the note, the partner and the history are all
 * left as the other move wrote them, and the caller answers 409 `deal_moved`.
 * A retry of a move that already landed finds a new version, so it cannot
 * write a second history row either.
 */
import type { Env } from '../types';
import { daysBetween } from './dealStageHistory';

export const PIPELINE = ['applied', 'scored', 'active', 'funded'] as const;
export const PASSED_STATUS = 'rejected';
/** Every value `deals.status` accepts, mirroring the column's CHECK. */
export const DEAL_STATUSES: readonly string[] = [...PIPELINE, PASSED_STATUS];
export const FOUNDER_INITIAL_STATUS = 'applied';

export type Refusal = { status: 400 | 403 | 409; body: Record<string, unknown> };

export const DEAL_MOVED: Refusal = {
  status: 409,
  body: { error: 'deal_moved', detail: 'This deal moved meanwhile. Reload it and try again. Nothing in this request was saved.' },
};
export const PASS_THROUGH_ROUTE: Refusal = {
  status: 400,
  body: { error: 'pass_needs_reason', detail: 'Record a pass through POST /api/deals/:id/pass. A reason is required.' },
};

/**
 * The stage a new deal is born in, for the caller's role, or the refusal.
 * `staff` is an admin drafting a deal. Anyone else is the venture's founder.
 */
export function initialStatus(requested: unknown, staff: boolean): { status: string } | { refuse: Refusal } {
  if (requested == null || requested === '') return { status: FOUNDER_INITIAL_STATUS };
  const s = String(requested);
  if (!DEAL_STATUSES.includes(s)) {
    return { refuse: { status: 400, body: { error: 'unknown_status', detail: `Unknown deal status '${s}'`, allowed: DEAL_STATUSES } } };
  }
  if (s === PASSED_STATUS) return { refuse: PASS_THROUGH_ROUTE };
  if (!staff && s !== FOUNDER_INITIAL_STATUS) {
    return { refuse: { status: 403, body: { error: 'initial_status_not_allowed', detail: 'A new deal starts as applied. The studio moves it from there. Nothing was saved.' } } };
  }
  return { status: s };
}

/** The version a move is conditional on: the stage and when it was entered. */
export type Version = { status: string; stage_changed_at: string | null };

const VERSION_SQL = ' WHERE id = ? AND status = ? AND stage_changed_at IS ?';

/**
 * The columns a move may write alongside the stage. The names come from this
 * list only, never from the request, so the SET list cannot be injected.
 */
export const MOVE_COLUMNS = [
  'partner_id', 'notes', 'amount', 'lead_partner_id', 'target_raise', 'minimum_check', 'valuation_cap', 'carry_pct',
  'management_fee_pct', 'instrument', 'spv_jurisdiction', 'closing_deadline', 'website', 'description', 'source',
  'pass_reason', 'pass_note', 'passed_at', 'passed_by_user_id',
] as const;
export type MoveColumn = typeof MOVE_COLUMNS[number];
/** `passed_at` takes the database's clock, as `stage_changed_at` does. */
const NOW = Symbol('now');
export const DB_NOW = NOW;

function setList(fields: Partial<Record<MoveColumn, unknown>>) {
  const cols: string[] = []; const binds: unknown[] = [];
  for (const col of MOVE_COLUMNS) {
    if (!Object.hasOwn(fields, col)) continue;
    const v = fields[col];
    if (v === NOW) { cols.push(col + " = datetime('now')"); continue; }
    cols.push(col + ' = ?'); binds.push(v ?? null);
  }
  return { cols, binds };
}

/**
 * The two statements of a move from `from` to `to`. `kind` is the history's
 * (`advance`, `pass`, `set`). `fields` are written in the same UPDATE.
 */
export function moveStatements(env: Env, input: {
  dealId: number; from: Version; to: string; kind: 'advance' | 'pass' | 'set'; actorUserId: number | null;
  fields?: Partial<Record<MoveColumn, unknown>>;
}): D1PreparedStatement[] {
  const { dealId, from, to, kind, actorUserId } = input;
  const days = daysBetween(from.stage_changed_at);
  const { cols, binds } = setList(input.fields ?? {});
  const event = env.DB.prepare(
    'INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, kind, days_in_from, actor_user_id)'
    + ' SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM deals' + VERSION_SQL + ')',
  ).bind(dealId, from.status, to, kind, days, actorUserId, dealId, from.status, from.stage_changed_at);
  const update = env.DB.prepare(
    "UPDATE deals SET status = ?, stage_changed_at = datetime('now'), updated_at = CURRENT_TIMESTAMP"
    + cols.map((c) => ', ' + c).join('') + VERSION_SQL,
  ).bind(to, ...binds, dealId, from.status, from.stage_changed_at);
  return [event, update];
}

/** Runs a move. False when the version no longer held, and nothing was written. */
export async function runMove(env: Env, input: Parameters<typeof moveStatements>[1]): Promise<boolean> {
  const results = await env.DB.batch(moveStatements(env, input));
  return Number(results[1]?.meta?.changes) === 1;
}

/** Writes fields with no move: one UPDATE, so all of them land or none does. */
export async function writeFields(env: Env, dealId: number, fields: Partial<Record<MoveColumn, unknown>>): Promise<void> {
  const { cols, binds } = setList(fields);
  if (!cols.length) return;
  await env.DB.prepare('UPDATE deals SET updated_at = CURRENT_TIMESTAMP' + cols.map((c) => ', ' + c).join('') + ' WHERE id = ?')
    .bind(...binds, dealId).run();
}

/**
 * A deal's birth and its first history row, in one batch: the row is the
 * funnel's cohort for the first stage, so a deal is never born without it.
 */
export async function createDeal(env: Env, row: Record<string, unknown>, status: string, actorUserId: number | null): Promise<number> {
  const cols = Object.keys(row).filter((k) => /^[a-z_]+$/.test(k));
  const results = await env.DB.batch([
    env.DB.prepare('INSERT INTO deals (status, stage_changed_at, ' + cols.join(', ') + ") VALUES (?, datetime('now'), " + cols.map(() => '?').join(', ') + ')')
      .bind(status, ...cols.map((k) => row[k] ?? null)),
    env.DB.prepare("INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, kind, days_in_from, actor_user_id) VALUES (last_insert_rowid(), NULL, ?, 'set', NULL, ?)")
      .bind(status, actorUserId),
  ]);
  return Number(results[0]?.meta?.last_row_id);
}
