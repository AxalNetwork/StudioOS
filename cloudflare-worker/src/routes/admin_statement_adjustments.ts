/** Governed statement disputes, due dates and scoped action history (#5039 part 3). */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { ACTION_REASON_MAX, ACTION_REASON_MIN, IDEMPOTENCY_KEY_RE, requestHash } from '../services/statementActions';
import { planAdjustment, type AdjustmentKind, type AdjustmentRow } from '../services/statementAdjustments';
import { logAdminAction } from '../services/adminAudit';
import { currencyCode } from '../services/currencies';

const r = new Hono<{ Bindings: Env }>();
type Row = AdjustmentRow & { uid: string; revision: number; currency: string; licence_uid: string; period: string };
type Stored = { request_hash: string; response_json: string };

async function adjust(c: any, kind: AdjustmentKind) {
  const admin = await requireSuperAdminWriteBar(c);
  const uid = c.req.param('uid');
  const row = await c.env.DB.prepare('SELECT * FROM subsidiary_statements WHERE uid = ?').bind(uid).first() as Row | null;
  if (!row) return c.json({ error: 'not_found' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < ACTION_REASON_MIN || reason.length > ACTION_REASON_MAX) return c.json({ error: 'reason_required', message: 'A reason of 10 to 500 characters is required, including when clearing a value.' }, 400);
  const expected = b.expected_revision;
  if (!Number.isSafeInteger(expected) || expected < 0) return c.json({ error: 'revision_required' }, 400);
  const key = typeof b.idempotency_key === 'string' ? b.idempotency_key : '';
  if (!IDEMPOTENCY_KEY_RE.test(key)) return c.json({ error: 'idempotency_key_required' }, 400);
  const value = kind === 'record_dispute' ? b.disputed_cents : b.due_on;
  // Missing is not an instruction to clear a field.
  if (value === undefined) return c.json({ error: kind === 'record_dispute' ? 'bad_amount' : 'bad_due_date' }, 400);
  const hash = await requestHash({ kind, uid, expected, value, reason });
  const prior = () => c.env.DB.prepare('SELECT request_hash, response_json FROM subsidiary_statement_actions WHERE actor_user_id = ? AND idempotency_key = ?').bind(admin.id, key).first() as Promise<Stored | null>;
  const replay = (p: Stored) => p.request_hash === hash
    ? c.json({ ...JSON.parse(p.response_json), replayed: true })
    : c.json({ error: 'idempotency_key_reused' }, 409);
  const existing = await prior();
  if (existing) return replay(existing);
  const changed = async () => c.json({ error: 'changed_since_open', current: await c.env.DB.prepare('SELECT * FROM subsidiary_statements WHERE uid = ?').bind(uid).first() }, 409);
  if (row.revision !== expected) return changed();
  if (kind === 'record_dispute' && !currencyCode(row.currency)) return c.json({ error: 'currency_unknown', message: 'Record a supported statement currency before changing its disputed amount.' }, 409);
  const plan = planAdjustment(kind, row, value);
  if ('error' in plan) return c.json({ error: plan.error, message: plan.message }, ['bad_amount', 'bad_due_date'].includes(plan.error!) ? 400 : 409);
  const actionUid = newUid();
  const now = nowIso();
  const response = {
    outcome: 'applied', action: kind, statement_uid: uid, settled: false, replayed: false,
    before: { ...plan.before, revision: expected }, after: { ...plan.after, revision: expected + 1 },
    receipt: { action_uid: actionUid, at: now, reason, currency: row.currency },
  };
  let results;
  try {
    results = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE subsidiary_statements SET disputed_cents = ?, due_on = ?,
        dispute_note = CASE WHEN ? = 'record_dispute' THEN ? ELSE dispute_note END,
        revision = revision + 1, last_action_uid = ?, updated_at = ? WHERE uid = ? AND revision = ?`)
        .bind(plan.after.disputed_cents, plan.after.due_on, kind, plan.after.disputed_cents > 0 ? reason : null, actionUid, now, uid, expected),
      c.env.DB.prepare(`INSERT INTO subsidiary_statement_actions
        (uid, statement_uid, action, actor_user_id, idempotency_key, request_hash, reason, amount_cents, currency,
         from_status, to_status, from_revision, to_revision, response_json, created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE EXISTS (SELECT 1 FROM subsidiary_statements WHERE uid = ? AND last_action_uid = ?)`)
        .bind(actionUid, uid, kind, admin.id, key, hash, reason, kind === 'record_dispute' ? value : null, row.currency,
          row.status, row.status, expected, expected + 1, JSON.stringify(response), now, uid, actionUid),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) { const won = await prior(); if (won) return replay(won); }
    throw e;
  }
  if (!results[0]?.meta?.changes) return changed();
  const auditAction = kind === 'record_dispute'
    ? (value === 0 ? 'subsidiary_statement_dispute_cleared' : 'subsidiary_statement_dispute')
    : 'subsidiary_statement_due_date';
  await logAdminAction(c.env, admin.id, admin.email, auditAction, {
    uid, statement_uid: uid, action_uid: actionUid, licence_uid: row.licence_uid, period: row.period,
    from_revision: expected, to_revision: expected + 1, note: reason,
    amounts: { disputed_before_cents: plan.before.disputed_cents, disputed_after_cents: plan.after.disputed_cents },
    ...(kind === 'set_due_date' ? { due_before: plan.before.due_on, due_after: plan.after.due_on } : {}),
  });
  return c.json(response);
}

// An unexpected failure is not a client refusal: the client must retain its key and check again.
function actionError(c: any, e: unknown) {
  const mapped = mapError(c, e);
  return mapped.status === 400 ? c.json({ error: 'action_unavailable', message: 'The action outcome could not be confirmed. Check again with the same key.' }, 500) : mapped;
}
r.post('/statements/:uid/disputes', async (c) => { try { return await adjust(c, 'record_dispute'); } catch (e) { return actionError(c, e); } });
r.post('/statements/:uid/due-date', async (c) => { try { return await adjust(c, 'set_due_date'); } catch (e) { return actionError(c, e); } });
r.get('/statements/:uid/actions', async (c) => {
  try {
    await requireSuperAdmin(c);
    const uid = c.req.param('uid');
    if (!await c.env.DB.prepare('SELECT uid FROM subsidiary_statements WHERE uid = ?').bind(uid).first()) return c.json({ error: 'not_found' }, 404);
    const raw = c.req.query('cursor');
    const cursor = raw === undefined ? Number.MAX_SAFE_INTEGER : Number(raw);
    if (!Number.isSafeInteger(cursor) || cursor <= 0) return c.json({ error: 'bad_cursor' }, 400);
    const rows = await c.env.DB.prepare(`SELECT id, uid, action, actor_user_id, reason, currency, response_json, created_at
      FROM subsidiary_statement_actions WHERE statement_uid = ? AND id < ? ORDER BY id DESC LIMIT 26`)
      .bind(uid, cursor).all<any>();
    const items = (rows.results || []).slice(0, 25).map(({ response_json, ...row }) => {
      const receipt = JSON.parse(response_json);
      return { ...row, before: receipt.before, after: receipt.after };
    });
    return c.json({ available: true, items, next_cursor: rows.results.length > 25 ? String(items[items.length - 1].id) : null });
  } catch (e) { return mapError(c, e); }
});

export const mount = { path: '/api/admin', router: r };
export default r;
