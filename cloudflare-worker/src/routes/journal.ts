/**
 * T14 — Decision journal (Task #14 contract reconciliation).
 * Mounted at /api/journal. Each entry is owned by a user; the journal is a
 * private, pre-vote record of an investment decision and its post-hoc outcome.
 *
 * Gated to admin/investor/partner (founders + advisors get 403). Every field
 * the SPA / dev-FastAPI contract sends round-trips: decision (invest|pass|
 * defer), conviction (1..5), thesis, key_risks, expected_outcome,
 * expected_multiple, expected_timeline_months, tags, and links to a project
 * (project_uid) and/or a watchlist item (watchlist_uid). Outcomes use the
 * outcome_status enum (pending|hit|miss|partial|inconclusive).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  isAdmin, isInvestor, isPartner, mapError, nowIso, newUid, jload,
  trimOrNull, normaliseTags,
} from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type Row = {
  id: number; uid: string; owner_user_id: number;
  project_id: number | null; watchlist_item_id: number | null; deal_id: number | null;
  decision: string; conviction: string | number | null; thesis: string;
  key_risks: string | null; expected_outcome: string | null;
  expected_multiple: number | null; expected_timeline_months: number | null;
  tags_json: string | null;
  decided_at: string | null;
  outcome_status: string; outcome_notes: string | null;
  outcome_actual_multiple: number | null; outcome_recorded_at: string | null;
  created_at: string; updated_at: string;
};

const DECISION_VALUES = new Set(['invest', 'pass', 'defer']);
const OUTCOME_VALUES = new Set(['pending', 'hit', 'miss', 'partial', 'inconclusive']);

function canUseJournal(u: User): boolean {
  return isAdmin(u) || isInvestor(u) || isPartner(u);
}

async function dto(env: Env, e: Row): Promise<Record<string, unknown>> {
  let project: Record<string, unknown> | null = null;
  if (e.project_id != null) {
    const p = await env.DB.prepare('SELECT uid, name, status FROM projects WHERE id = ? AND deleted_at IS NULL')
      .bind(e.project_id).first<any>();
    if (p) project = { uid: p.uid, name: p.name, status: p.status };
  }
  let watchlist: Record<string, unknown> | null = null;
  if (e.watchlist_item_id != null) {
    const w = await env.DB.prepare('SELECT uid, external_name, status FROM watchlist_items WHERE id = ?')
      .bind(e.watchlist_item_id).first<any>();
    if (w) watchlist = { uid: w.uid, external_name: w.external_name, status: w.status };
  }
  return {
    uid: e.uid,
    owner_user_id: e.owner_user_id,
    project,
    watchlist,
    deal_id: e.deal_id,
    decision: e.decision,
    conviction: e.conviction,
    thesis: e.thesis,
    key_risks: e.key_risks,
    expected_outcome: e.expected_outcome,
    expected_multiple: e.expected_multiple,
    expected_timeline_months: e.expected_timeline_months,
    tags: jload<string[]>(e.tags_json, []),
    decided_at: e.decided_at,
    outcome_status: e.outcome_status,
    outcome_notes: e.outcome_notes,
    outcome_actual_multiple: e.outcome_actual_multiple,
    outcome_recorded_at: e.outcome_recorded_at,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

type Targets =
  | { projectId: number | null; watchlistItemId: number | null; dealId: number | null }
  | { error: { detail: string; status: number } };

/** Resolve project / watchlist / deal links from ids or uids, ownership-checked. */
async function resolveTargets(env: Env, user: User, body: any): Promise<Targets> {
  let projectId: number | null = null;
  if (body.project_id != null && body.project_id !== '') {
    const n = Number(body.project_id);
    if (Number.isFinite(n)) projectId = n;
  }
  const projectUid = trimOrNull(body.project_uid, 64);
  if (projectUid && projectId == null) {
    const proj = await env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(projectUid).first<{ id: number }>();
    if (!proj) return { error: { detail: 'Project not found', status: 404 } };
    projectId = proj.id;
  }

  let watchlistItemId: number | null = null;
  if (body.watchlist_item_id != null && body.watchlist_item_id !== '') {
    const n = Number(body.watchlist_item_id);
    if (Number.isFinite(n)) watchlistItemId = n;
  }
  const watchlistUid = trimOrNull(body.watchlist_uid, 64);
  if (watchlistUid && watchlistItemId == null) {
    const item = await env.DB.prepare('SELECT id, owner_user_id FROM watchlist_items WHERE uid = ?')
      .bind(watchlistUid).first<{ id: number; owner_user_id: number }>();
    if (!item) return { error: { detail: 'Watchlist item not found', status: 404 } };
    if (item.owner_user_id !== user.id && !isAdmin(user)) return { error: { detail: 'Forbidden', status: 403 } };
    watchlistItemId = item.id;
  } else if (watchlistItemId != null) {
    const item = await env.DB.prepare('SELECT id, owner_user_id FROM watchlist_items WHERE id = ?')
      .bind(watchlistItemId).first<{ id: number; owner_user_id: number }>();
    if (!item) return { error: { detail: 'Watchlist item not found', status: 404 } };
    if (item.owner_user_id !== user.id && !isAdmin(user)) return { error: { detail: 'Forbidden', status: 403 } };
  }

  let dealId: number | null = null;
  if (body.deal_id != null && body.deal_id !== '') {
    const n = Number(body.deal_id);
    if (Number.isFinite(n)) dealId = n;
  }
  const dealUid = trimOrNull(body.deal_uid, 64);
  if (dealUid && dealId == null) {
    const d = await env.DB.prepare('SELECT id FROM deals WHERE uid = ?').bind(dealUid).first<{ id: number }>();
    if (!d) return { error: { detail: 'Deal not found', status: 404 } };
    dealId = d.id;
  }

  return { projectId, watchlistItemId, dealId };
}

r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const decision = c.req.query('decision');
    const outcomeStatus = c.req.query('outcome_status');
    const projectUid = c.req.query('project_uid');
    const owner = c.req.query('owner') || 'me';
    let where = 'owner_user_id = ?';
    const params: any[] = [user.id];
    if (owner === 'all') {
      if (!isAdmin(user)) return c.json({ detail: 'Admin only for owner=all' }, 403);
      where = '1=1';
      params.length = 0;
    }
    if (decision) {
      if (!DECISION_VALUES.has(decision)) return c.json({ detail: 'bad decision filter' }, 400);
      where += ' AND decision = ?';
      params.push(decision);
    }
    if (outcomeStatus) {
      if (!OUTCOME_VALUES.has(outcomeStatus)) return c.json({ detail: 'bad outcome_status filter' }, 400);
      where += ' AND outcome_status = ?';
      params.push(outcomeStatus);
    }
    const emptyCounts = () => ({
      items: [] as unknown[],
      counts_by_decision: { invest: 0, pass: 0, defer: 0 },
      counts_by_outcome: { pending: 0, hit: 0, miss: 0, partial: 0, inconclusive: 0 },
    });
    if (projectUid) {
      const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL')
        .bind(projectUid).first<{ id: number }>();
      if (!proj) return c.json(emptyCounts());
      where += ' AND project_id = ?';
      params.push(proj.id);
    }
    const rows = ((await c.env.DB.prepare(
      `SELECT * FROM decision_journal_entries WHERE ${where} ORDER BY COALESCE(decided_at, created_at) DESC LIMIT 500`
    ).bind(...params).all<Row>()).results || []) as Row[];
    const countsDec: Record<string, number> = { invest: 0, pass: 0, defer: 0 };
    const countsOut: Record<string, number> = { pending: 0, hit: 0, miss: 0, partial: 0, inconclusive: 0 };
    const items: Record<string, unknown>[] = [];
    for (const e of rows) {
      countsDec[e.decision] = (countsDec[e.decision] || 0) + 1;
      countsOut[e.outcome_status] = (countsOut[e.outcome_status] || 0) + 1;
      items.push(await dto(c.env, e));
    }
    return c.json({ items, counts_by_decision: countsDec, counts_by_outcome: countsOut });
  } catch (e) { return mapError(c, e); }
});

r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));

    const thesis = String(body.thesis || '').trim();
    if (thesis.length < 10) return c.json({ detail: 'thesis is required (min 10 chars)' }, 400);
    const decision = String(body.decision || 'defer').toLowerCase();
    if (!DECISION_VALUES.has(decision)) {
      return c.json({ detail: `decision must be one of ${[...DECISION_VALUES].sort().join(', ')}` }, 400);
    }
    let conviction = 3;
    if (body.conviction != null && body.conviction !== '') {
      conviction = Number(body.conviction);
      if (!Number.isInteger(conviction) || conviction < 1 || conviction > 5) {
        return c.json({ detail: 'conviction must be an integer 1..5' }, 400);
      }
    }
    let expectedMultiple: number | null = null;
    if (body.expected_multiple != null && body.expected_multiple !== '') {
      expectedMultiple = Number(body.expected_multiple);
      if (Number.isNaN(expectedMultiple) || expectedMultiple < 0) {
        return c.json({ detail: 'expected_multiple must be a non-negative number' }, 400);
      }
    }
    let expectedTimeline: number | null = null;
    if (body.expected_timeline_months != null && body.expected_timeline_months !== '') {
      expectedTimeline = Number(body.expected_timeline_months);
      if (!Number.isInteger(expectedTimeline) || expectedTimeline < 0) {
        return c.json({ detail: 'expected_timeline_months must be a non-negative integer' }, 400);
      }
    }

    const targets = await resolveTargets(c.env, user, body);
    if ('error' in targets) return c.json({ detail: targets.error.detail }, targets.error.status as any);
    if (targets.projectId == null && targets.watchlistItemId == null) {
      return c.json({ detail: 'Provide project_uid or watchlist_uid' }, 400);
    }

    const uid = newUid();
    const now = nowIso();
    const ins = await c.env.DB.prepare(
      `INSERT INTO decision_journal_entries
        (uid, owner_user_id, project_id, watchlist_item_id, deal_id, decision, conviction,
         thesis, key_risks, expected_outcome, expected_multiple, expected_timeline_months,
         tags_json, outcome_status, decided_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).bind(
      uid, user.id, targets.projectId, targets.watchlistItemId, targets.dealId,
      decision, conviction, thesis.slice(0, 6000),
      trimOrNull(body.key_risks, 4000), trimOrNull(body.expected_outcome, 4000),
      expectedMultiple, expectedTimeline, normaliseTags(body.tags),
      now, now, now,
    ).run();
    const e = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<Row>();
    return c.json(await dto(c.env, e!), 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const entry = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?')
      .bind(c.req.param('uid')).first<Row>();
    if (!entry) return c.json({ detail: 'Not found' }, 404);
    if (entry.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(await dto(c.env, entry));
  } catch (e) { return mapError(c, e); }
});

r.put('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const entry = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?')
      .bind(c.req.param('uid')).first<Row>();
    if (!entry) return c.json({ detail: 'Not found' }, 404);
    if (entry.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));

    let decision = entry.decision;
    let conviction = entry.conviction;
    let thesis = entry.thesis;
    let keyRisks = entry.key_risks;
    let expectedOutcome = entry.expected_outcome;
    let expectedMultiple = entry.expected_multiple;
    let expectedTimeline = entry.expected_timeline_months;
    let tagsJson = entry.tags_json;

    if ('thesis' in body) {
      const t = String(body.thesis || '').trim();
      if (t.length < 10) return c.json({ detail: 'thesis is required (min 10 chars)' }, 400);
      thesis = t.slice(0, 6000);
    }
    if ('key_risks' in body) keyRisks = trimOrNull(body.key_risks, 4000);
    if ('expected_outcome' in body) expectedOutcome = trimOrNull(body.expected_outcome, 4000);
    if ('decision' in body) {
      const v = String(body.decision || '').toLowerCase();
      if (!DECISION_VALUES.has(v)) return c.json({ detail: 'bad decision' }, 400);
      decision = v;
    }
    if ('conviction' in body) {
      const cv = Number(body.conviction);
      if (!Number.isInteger(cv) || cv < 1 || cv > 5) return c.json({ detail: 'conviction must be an integer 1..5' }, 400);
      conviction = cv;
    }
    if ('expected_multiple' in body) {
      if (body.expected_multiple == null || body.expected_multiple === '') expectedMultiple = null;
      else {
        const fv = Number(body.expected_multiple);
        if (Number.isNaN(fv) || fv < 0) return c.json({ detail: 'expected_multiple must be a non-negative number' }, 400);
        expectedMultiple = fv;
      }
    }
    if ('expected_timeline_months' in body) {
      if (body.expected_timeline_months == null || body.expected_timeline_months === '') expectedTimeline = null;
      else {
        const iv = Number(body.expected_timeline_months);
        if (!Number.isInteger(iv) || iv < 0) return c.json({ detail: 'expected_timeline_months must be a non-negative integer' }, 400);
        expectedTimeline = iv;
      }
    }
    if ('tags' in body) tagsJson = normaliseTags(body.tags);

    await c.env.DB.prepare(
      `UPDATE decision_journal_entries SET decision=?, conviction=?, thesis=?, key_risks=?, expected_outcome=?,
         expected_multiple=?, expected_timeline_months=?, tags_json=?, updated_at=? WHERE id=?`
    ).bind(
      decision, conviction, thesis, keyRisks, expectedOutcome,
      expectedMultiple, expectedTimeline, tagsJson, nowIso(), entry.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE id = ?').bind(entry.id).first<Row>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/outcome', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const entry = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?')
      .bind(c.req.param('uid')).first<Row>();
    if (!entry) return c.json({ detail: 'Not found' }, 404);
    if (entry.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const status = String(body.outcome_status || '').toLowerCase();
    if (!OUTCOME_VALUES.has(status) || status === 'pending') {
      return c.json({ detail: 'outcome_status must be one of hit, inconclusive, miss, partial' }, 400);
    }
    let actual: number | null = null;
    if (body.outcome_actual_multiple != null && body.outcome_actual_multiple !== '') {
      actual = Number(body.outcome_actual_multiple);
      if (Number.isNaN(actual) || actual < 0) {
        return c.json({ detail: 'outcome_actual_multiple must be a non-negative number' }, 400);
      }
    }
    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE decision_journal_entries SET outcome_status=?, outcome_notes=?, outcome_actual_multiple=?,
         outcome_recorded_at=?, updated_at=? WHERE id=?`
    ).bind(status, trimOrNull(body.outcome_notes, 4000), actual, now, now, entry.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE id = ?').bind(entry.id).first<Row>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

r.delete('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseJournal(user)) return c.json({ detail: 'Forbidden' }, 403);
    const entry = await c.env.DB.prepare('SELECT * FROM decision_journal_entries WHERE uid = ?')
      .bind(c.req.param('uid')).first<Row>();
    if (!entry) return c.json({ detail: 'Not found' }, 404);
    if (entry.owner_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    await c.env.DB.prepare('DELETE FROM decision_journal_entries WHERE id = ?').bind(entry.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// Task #1 (AG) — spec-contract aliases. /entries mirrors the root list/create
// + /:id PATCH/DELETE on the same table (spec uses numeric id; canonical
// handlers are keyed by :uid, so translate id → uid before forwarding).
r.get('/entries', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/journal/';
  return r.fetch(new Request(url, { method: 'GET', headers: c.req.raw.headers }), c.env, c.executionCtx);
});
r.post('/entries', async (c) => {
  const body = await c.req.text();
  const url = new URL(c.req.url);
  url.pathname = '/api/journal/';
  url.search = '';
  return r.fetch(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
});
async function resolveEntryUid(env: Env, id: string): Promise<string | null> {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = await env.DB.prepare('SELECT uid FROM decision_journal_entries WHERE id = ?')
    .bind(n).first<{ uid: string }>();
  return row?.uid ?? null;
}
r.patch('/entries/:id', async (c) => {
  try {
    await requireAuth(c);
    const uid = await resolveEntryUid(c.env, c.req.param('id'));
    if (!uid) return c.json({ detail: 'Not found' }, 404);
    const body = await c.req.text();
    const url = new URL(c.req.url);
    url.pathname = `/api/journal/${uid}`;
    url.search = '';
    return r.fetch(new Request(url, { method: 'PUT', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
  } catch (e) { return mapError(c, e); }
});
r.delete('/entries/:id', async (c) => {
  try {
    await requireAuth(c);
    const uid = await resolveEntryUid(c.env, c.req.param('id'));
    if (!uid) return c.json({ detail: 'Not found' }, 404);
    const url = new URL(c.req.url);
    url.pathname = `/api/journal/${uid}`;
    url.search = '';
    return r.fetch(new Request(url, { method: 'DELETE', headers: c.req.raw.headers }), c.env, c.executionCtx);
  } catch (e) { return mapError(c, e); }
});

export default r;
