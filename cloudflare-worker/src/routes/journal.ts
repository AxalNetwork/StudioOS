/**
 * T14 — Decision journal.
 * Mounted at /api/journal. Each entry is owned by a user; the journal is a
 * private record of investment decisions and their post-hoc outcomes.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isInvestor, isPartner, mapError, nowIso, newUid } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type Row = {
  id: number; uid: string; owner_user_id: number;
  project_id: number | null; deal_id: number | null;
  decision: string; thesis: string;
  expected_outcome: string | null; conviction: string | null;
  outcome: string | null; outcome_notes: string | null; outcome_recorded_at: string | null;
  created_at: string; updated_at: string;
};

const VALID_DECISIONS = new Set(['invest', 'pass', 'follow', 'other']);
const VALID_OUTCOMES = new Set(['win', 'loss', 'pending']);

function canUseJournal(u: User): boolean {
  return isAdmin(u) || isInvestor(u) || isPartner(u);
}

function dto(j: Row): any { return { ...j }; }

r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const decision = c.req.query('decision');
    const outcome = c.req.query('outcome');
    const ownerAll = c.req.query('owner') === 'all' && isAdmin(user);
    let where = ownerAll ? '1=1' : 'owner_user_id = ?';
    const params: any[] = ownerAll ? [] : [user.id];
    if (decision) { where += ' AND decision = ?'; params.push(decision); }
    if (outcome) { where += ' AND outcome = ?'; params.push(outcome); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM decision_journal_entries WHERE ${where} ORDER BY created_at DESC LIMIT 500`
    ).bind(...params).all<Row>();
    return c.json({ items: (rows.results || []).map(dto) });
  } catch (e) { return mapError(c, e); }
});

r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const decision = String(body.decision || '').toLowerCase();
    const thesis = String(body.thesis || '').trim();
    if (!VALID_DECISIONS.has(decision)) return c.json({ detail: `decision must be one of ${[...VALID_DECISIONS]}` }, 400);
    if (!thesis) return c.json({ detail: 'thesis required' }, 400);
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO decision_journal_entries
        (uid, owner_user_id, project_id, deal_id, decision, thesis, expected_outcome, conviction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, user.id,
           body.project_id != null ? Number(body.project_id) : null,
           body.deal_id != null ? Number(body.deal_id) : null,
           decision, thesis.slice(0, 6000),
           body.expected_outcome ? String(body.expected_outcome).slice(0, 4000) : null,
           body.conviction ? String(body.conviction).slice(0, 16) : null,
           nowIso(), nowIso()).run();
    const j = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<Row>();
    return c.json(dto(j!));
  } catch (e) { return mapError(c, e); }
});

async function loadOwn(c: Context<{ Bindings: Env }>, uid: string): Promise<{ row: Row | null; forbidden: boolean }> {
  const user: User = c.get('_user') || (await requireAuth(c));
  c.set('_user', user);
  const j = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?').bind(uid).first<Row>();
  if (!j) return { row: null, forbidden: false };
  if (j.owner_user_id !== user.id && !isAdmin(user)) return { row: j, forbidden: true };
  return { row: j, forbidden: false };
}

r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const j = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?').bind(c.req.param('uid')).first<Row>();
    if (!j) return c.json({ detail: 'Not found' }, 404);
    if (j.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(dto(j));
  } catch (e) { return mapError(c, e); }
});

r.put('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const j = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?').bind(c.req.param('uid')).first<Row>();
    if (!j) return c.json({ detail: 'Not found' }, 404);
    if (j.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const decision = body.decision != null ? String(body.decision).toLowerCase() : j.decision;
    if (!VALID_DECISIONS.has(decision)) return c.json({ detail: 'invalid decision' }, 400);
    const thesis = body.thesis != null ? String(body.thesis).slice(0, 6000) : j.thesis;
    const expected = body.expected_outcome !== undefined
      ? (body.expected_outcome ? String(body.expected_outcome).slice(0, 4000) : null)
      : j.expected_outcome;
    const conviction = body.conviction !== undefined
      ? (body.conviction ? String(body.conviction).slice(0, 16) : null)
      : j.conviction;
    await c.env.DB.prepare(
      `UPDATE decision_journal_entries SET decision=?, thesis=?, expected_outcome=?, conviction=?, updated_at=? WHERE id=?`
    ).bind(decision, thesis, expected, conviction, nowIso(), j.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE id = ?').bind(j.id).first<Row>();
    return c.json(dto(fresh!));
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/outcome', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const j = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?').bind(c.req.param('uid')).first<Row>();
    if (!j) return c.json({ detail: 'Not found' }, 404);
    if (j.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const outcome = String(body.outcome || '').toLowerCase();
    if (!VALID_OUTCOMES.has(outcome)) return c.json({ detail: `outcome must be one of ${[...VALID_OUTCOMES]}` }, 400);
    await c.env.DB.prepare(
      `UPDATE decision_journal_entries SET outcome=?, outcome_notes=?, outcome_recorded_at=?, updated_at=? WHERE id=?`
    ).bind(outcome, body.outcome_notes ? String(body.outcome_notes).slice(0, 4000) : null, nowIso(), nowIso(), j.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE id = ?').bind(j.id).first<Row>();
    return c.json(dto(fresh!));
  } catch (e) { return mapError(c, e); }
});

r.delete('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const j = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?').bind(c.req.param('uid')).first<Row>();
    if (!j) return c.json({ detail: 'Not found' }, 404);
    if (j.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    await c.env.DB.prepare('DELETE FROM decision_journal_entries WHERE id = ?').bind(j.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export default r;
