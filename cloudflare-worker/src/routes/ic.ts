/**
 * Investment Decision / IC record (Commit stage).
 *
 * One per-deal object that unifies the IC memo, proposed terms, member votes,
 * the final decision, and the post-hoc outcome — data that today is smeared
 * across Pipeline votes, the Scoring deal-memo, and Watchlist decision fields.
 *
 * Mounted at /api/ic. Readers/writers are admin/partner/investor. Investor
 * callers are professional-tier gated in index.ts (INVESTOR_PRO_PREFIXES),
 * matching Deal Flow / Pipeline.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isInvestor, isPartner, mapError, nowIso, newUid, jload } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type DecisionRow = {
  id: number; uid: string; project_id: number | null; deal_id: number | null;
  title: string; memo: string | null; terms_json: string | null;
  status: string; decision: string | null; outcome: string | null;
  created_by: number | null; decided_at: string | null;
  created_at: string; updated_at: string;
};

function canUseIc(user: User): boolean {
  return isAdmin(user) || isInvestor(user) || isPartner(user);
}

async function tally(env: Env, decisionId: number): Promise<{ yes: number; no: number; abstain: number }> {
  const rows = await env.DB.prepare(
    'SELECT vote, COUNT(*) AS n FROM ic_votes WHERE ic_decision_id = ? GROUP BY vote'
  ).bind(decisionId).all<{ vote: string; n: number }>();
  const out = { yes: 0, no: 0, abstain: 0 };
  for (const row of (rows.results || [])) {
    if (row.vote in out) (out as any)[row.vote] = Number(row.n) || 0;
  }
  return out;
}

async function dto(env: Env, d: DecisionRow, opts: { votes?: boolean } = {}): Promise<any> {
  const proj = d.project_id
    ? await env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE id = ? AND deleted_at IS NULL').bind(d.project_id).first<any>()
    : null;
  const base: any = {
    id: d.id, uid: d.uid, project_id: d.project_id, deal_id: d.deal_id,
    project: proj || null,
    title: d.title, memo: d.memo, terms: jload(d.terms_json, null),
    status: d.status, decision: d.decision, outcome: d.outcome,
    created_by: d.created_by, decided_at: d.decided_at,
    created_at: d.created_at, updated_at: d.updated_at,
    tally: await tally(env, d.id),
  };
  if (opts.votes) {
    const votes = await env.DB.prepare(
      `SELECT v.vote, v.rationale, v.user_id, v.created_at, u.name AS user_name
         FROM ic_votes v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.ic_decision_id = ? ORDER BY v.created_at ASC`
    ).bind(d.id).all<any>();
    base.votes = votes.results || [];
  }
  return base;
}

// ---------------------------------------------------------------------------
// GET /api/ic  — list decisions (filter by status / project_id)
// ---------------------------------------------------------------------------
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const status = c.req.query('status');
    const projectId = c.req.query('project_id');
    let where = '1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (projectId) { where += ' AND project_id = ?'; params.push(Number(projectId)); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM ic_decisions WHERE ${where} ORDER BY updated_at DESC LIMIT 500`
    ).bind(...params).all<DecisionRow>();
    const items: any[] = [];
    for (const d of (rows.results || []) as DecisionRow[]) items.push(await dto(c.env, d));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// POST /api/ic  — create a decision (optionally seed memo from scoring deal-memo)
r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const title = body.title ? String(body.title).slice(0, 300) : null;
    if (!title) return c.json({ detail: 'title required' }, 400);
    const projectId = body.project_id != null ? Number(body.project_id) : null;
    if (projectId != null && Number.isFinite(projectId)) {
      const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ id: number }>();
      if (!proj) return c.json({ detail: 'Project not found' }, 404);
    }
    const dealId = body.deal_id != null ? Number(body.deal_id) : null;
    let memo = body.memo ? String(body.memo).slice(0, 20000) : null;
    // Optional: seed the memo from the latest stored scoring deal-memo. Main
    // stores deal memos as structured columns in `deal_memos` (not a single
    // free-text blob), so compose a readable memo from the narrative fields.
    if (!memo && (body.from_scoring || c.req.query('from_scoring')) && projectId != null) {
      const dm = await c.env.DB.prepare(
        "SELECT problem, solution, why_now, key_insight, risks FROM deal_memos WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
      ).bind(projectId).first<any>().catch(() => null);
      if (dm) {
        const parts: string[] = [];
        if (dm.problem) parts.push(`Problem: ${dm.problem}`);
        if (dm.solution) parts.push(`Solution: ${dm.solution}`);
        if (dm.why_now) parts.push(`Why now: ${dm.why_now}`);
        if (dm.key_insight) parts.push(`Key insight: ${dm.key_insight}`);
        if (dm.risks) parts.push(`Risks: ${dm.risks}`);
        if (parts.length) memo = parts.join('\n\n').slice(0, 20000);
      }
    }
    const termsJson = body.terms != null ? JSON.stringify(body.terms) : null;
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO ic_decisions (uid, project_id, deal_id, title, memo, terms_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    ).bind(uid, projectId, dealId, title, memo, termsJson, user.id, nowIso(), nowIso()).run();
    const d = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<DecisionRow>();
    return c.json(await dto(c.env, d!, { votes: true }), 201);
  } catch (e) { return mapError(c, e); }
});

// GET /api/ic/:uid — detail with votes
r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const d = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE uid = ?').bind(c.req.param('uid')).first<DecisionRow>();
    if (!d) return c.json({ detail: 'Not found' }, 404);
    return c.json(await dto(c.env, d, { votes: true }));
  } catch (e) { return mapError(c, e); }
});

// PUT /api/ic/:uid — update memo/terms/status/decision/outcome (creator or admin)
r.put('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const d = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE uid = ?').bind(c.req.param('uid')).first<DecisionRow>();
    if (!d) return c.json({ detail: 'Not found' }, 404);
    if (d.created_by !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const title = body.title !== undefined ? (body.title ? String(body.title).slice(0, 300) : d.title) : d.title;
    const memo = body.memo !== undefined ? (body.memo ? String(body.memo).slice(0, 20000) : null) : d.memo;
    const termsJson = body.terms !== undefined ? (body.terms != null ? JSON.stringify(body.terms) : null) : d.terms_json;
    let status = d.status;
    if (body.status && ['draft', 'voting', 'decided'].includes(body.status)) status = body.status;
    let decision = d.decision;
    let decidedAt = d.decided_at;
    if (body.decision !== undefined) {
      decision = body.decision && ['invest', 'pass', 'defer'].includes(body.decision) ? body.decision : null;
      if (decision) { status = 'decided'; decidedAt = decidedAt || nowIso(); }
    }
    let outcome = d.outcome;
    if (body.outcome !== undefined) {
      outcome = body.outcome && ['open', 'vindicated', 'regret'].includes(body.outcome) ? body.outcome : null;
    }
    await c.env.DB.prepare(
      `UPDATE ic_decisions SET title=?, memo=?, terms_json=?, status=?, decision=?, outcome=?, decided_at=?, updated_at=? WHERE id=?`
    ).bind(title, memo, termsJson, status, decision, outcome, decidedAt, nowIso(), d.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE id = ?').bind(d.id).first<DecisionRow>();
    return c.json(await dto(c.env, fresh!, { votes: true }));
  } catch (e) { return mapError(c, e); }
});

// POST /api/ic/:uid/vote — upsert the caller's vote
r.post('/:uid/vote', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseIc(user)) return c.json({ detail: 'Forbidden' }, 403);
    const d = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE uid = ?').bind(c.req.param('uid')).first<DecisionRow>();
    if (!d) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const vote = String(body.vote || '').toLowerCase();
    if (!['yes', 'no', 'abstain'].includes(vote)) return c.json({ detail: 'vote must be yes|no|abstain' }, 400);
    const rationale = body.rationale ? String(body.rationale).slice(0, 2000) : null;
    await c.env.DB.prepare(
      `INSERT INTO ic_votes (ic_decision_id, user_id, vote, rationale, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ic_decision_id, user_id) DO UPDATE SET vote=excluded.vote, rationale=excluded.rationale, created_at=excluded.created_at`
    ).bind(d.id, user.id, vote, rationale, nowIso()).run();
    // First vote moves a draft into the voting stage.
    if (d.status === 'draft') {
      await c.env.DB.prepare("UPDATE ic_decisions SET status='voting', updated_at=? WHERE id=?").bind(nowIso(), d.id).run();
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM ic_decisions WHERE id = ?').bind(d.id).first<DecisionRow>();
    return c.json(await dto(c.env, fresh!, { votes: true }));
  } catch (e) { return mapError(c, e); }
});

export default r;
