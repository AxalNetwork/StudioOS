/**
 * T14 — Watchlist + Anti-portfolio (Task #14 contract reconciliation).
 * Mounted at /api (so /api/watchlist + /api/antiportfolio share one router).
 *
 * Watchlist is per-user and gated to admin/investor/partner roles (founders +
 * advisors get 403 — it's a capital-side DD instrument). Every field the SPA /
 * dev-FastAPI contract sends now round-trips losslessly: external prospects
 * (external_name/url/sector/stage), source, tags, thesis, conviction
 * (low|medium|high) and the full watching|converted|passed_on|archived status
 * enum. The anti-portfolio is a derived roll-up of `pass` journal decisions +
 * `passed_on` watchlist items, graded against where each project is today.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  isAdmin, isInvestor, isPartner, mapError, nowIso, newUid, jload,
  trimOrNull, normaliseTags,
} from './_t13t14t15_helpers';
import { gradePass, type ProjectSignal } from '../services/watchlistGrading';

const r = new Hono<{ Bindings: Env }>();

type ItemRow = {
  id: number; uid: string; owner_user_id: number;
  project_id: number | null;
  external_name: string | null; external_url: string | null;
  sector: string | null; stage: string | null;
  thesis: string | null; conviction: string | null;
  source: string | null; tags_json: string | null;
  status: string;
  next_check_at: string | null; reminded_at: string | null;
  passed_reason: string | null; passed_at: string | null;
  converted_deal_id: number | null; converted_at: string | null;
  created_at: string; updated_at: string;
};

const CONVICTION_VALUES = new Set(['low', 'medium', 'high']);
const WATCHLIST_STATUS_VALUES = new Set(['watching', 'converted', 'passed_on', 'archived']);

function canUseWatchlist(user: User): boolean {
  return isAdmin(user) || isInvestor(user) || isPartner(user);
}

async function dto(env: Env, w: ItemRow): Promise<Record<string, unknown>> {
  let project: Record<string, unknown> | null = null;
  if (w.project_id != null) {
    const p = await env.DB.prepare(
      'SELECT uid, name, sector, stage, status FROM projects WHERE id = ? AND deleted_at IS NULL'
    ).bind(w.project_id).first<any>();
    if (p) project = { uid: p.uid, name: p.name, sector: p.sector, stage: p.stage, status: p.status };
  }
  return {
    uid: w.uid,
    owner_user_id: w.owner_user_id,
    project,
    external_name: w.external_name,
    external_url: w.external_url,
    sector: w.sector,
    stage: w.stage,
    thesis: w.thesis,
    conviction: w.conviction,
    source: w.source,
    tags: jload<string[]>(w.tags_json, []),
    status: w.status,
    converted_deal_id: w.converted_deal_id,
    converted_at: w.converted_at,
    passed_reason: w.passed_reason,
    next_check_at: w.next_check_at,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
}

// ---------------------------------------------------------------------------
// /api/watchlist  (list + create)
// ---------------------------------------------------------------------------
r.get('/watchlist', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const status = c.req.query('status');
    const owner = c.req.query('owner') || 'me';
    let where = 'owner_user_id = ?';
    const params: any[] = [user.id];
    if (owner === 'all') {
      if (!isAdmin(user)) return c.json({ detail: 'Admin only for owner=all' }, 403);
      where = '1=1';
      params.length = 0;
    }
    if (status) {
      if (!WATCHLIST_STATUS_VALUES.has(status)) return c.json({ detail: 'bad status filter' }, 400);
      where += ' AND status = ?';
      params.push(status);
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM watchlist_items WHERE ${where} ORDER BY created_at DESC LIMIT 500`
    ).bind(...params).all<ItemRow>();
    const list = (rows.results || []) as ItemRow[];
    const counts: Record<string, number> = { watching: 0, converted: 0, passed_on: 0, archived: 0 };
    const items: Record<string, unknown>[] = [];
    for (const w of list) {
      counts[w.status] = (counts[w.status] || 0) + 1;
      items.push(await dto(c.env, w));
    }
    return c.json({ items, counts });
  } catch (e) { return mapError(c, e); }
});

r.post('/watchlist', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));

    // Resolve target: in-system project (by id or uid) OR external prospect.
    let projectId: number | null = null;
    if (body.project_id != null && body.project_id !== '') {
      const n = Number(body.project_id);
      if (Number.isFinite(n)) projectId = n;
    }
    const projectUid = trimOrNull(body.project_uid, 64);
    if (projectUid && projectId == null) {
      const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL')
        .bind(projectUid).first<{ id: number }>();
      if (!proj) return c.json({ detail: 'Project not found' }, 404);
      projectId = proj.id;
    }
    const externalName = trimOrNull(body.external_name, 200);
    if (projectId == null && !externalName) {
      return c.json({ detail: 'Provide project_uid or external_name' }, 400);
    }
    if (projectId != null) {
      const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL')
        .bind(projectId).first<{ id: number }>();
      if (!proj) return c.json({ detail: 'Project not found' }, 404);
    }

    const conviction = String(body.conviction || 'medium').toLowerCase();
    if (!CONVICTION_VALUES.has(conviction)) {
      return c.json({ detail: `conviction must be one of ${[...CONVICTION_VALUES].sort().join(', ')}` }, 400);
    }
    const status = String(body.status || 'watching').toLowerCase();
    if (!WATCHLIST_STATUS_VALUES.has(status)) {
      return c.json({ detail: `status must be one of ${[...WATCHLIST_STATUS_VALUES].sort().join(', ')}` }, 400);
    }

    // Idempotency: same owner + same in-system project → return existing.
    if (projectId != null) {
      const existing = await c.env.DB.prepare(
        'SELECT * FROM watchlist_items WHERE owner_user_id = ? AND project_id = ?'
      ).bind(user.id, projectId).first<ItemRow>();
      if (existing) return c.json(await dto(c.env, existing));
    }

    const uid = newUid();
    try {
      const ins = await c.env.DB.prepare(
        `INSERT INTO watchlist_items
          (uid, owner_user_id, project_id, external_name, external_url, sector, stage,
           thesis, conviction, source, tags_json, status, next_check_at, passed_reason,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        uid, user.id, projectId,
        externalName,
        trimOrNull(body.external_url, 1000),
        trimOrNull(body.sector, 120),
        trimOrNull(body.stage, 120),
        trimOrNull(body.thesis, 4000),
        conviction,
        trimOrNull(body.source, 120),
        normaliseTags(body.tags),
        status,
        trimOrNull(body.next_check_at, 64),
        trimOrNull(body.passed_reason, 2000),
        nowIso(), nowIso(),
      ).run();
      const w = await c.env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?')
        .bind((ins as any).meta?.last_row_id).first<ItemRow>();
      return c.json(await dto(c.env, w!), 201);
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        // External name (or owner/project) already tracked → return existing.
        const dup = await c.env.DB.prepare(
          `SELECT * FROM watchlist_items
             WHERE owner_user_id = ?
               AND ((project_id IS NOT NULL AND project_id = ?)
                 OR (project_id IS NULL AND external_name = ?))`
        ).bind(user.id, projectId, externalName).first<ItemRow>();
        if (dup) return c.json(await dto(c.env, dup));
        return c.json({ detail: 'Already on your watchlist' }, 409);
      }
      throw e;
    }
  } catch (e) { return mapError(c, e); }
});

// /api/watchlist/anti-portfolio — alias for the legacy SPA path
r.get('/watchlist/anti-portfolio', async (c) => {
  return r.fetch(new Request(new URL('/antiportfolio?owner=me', c.req.url), c.req.raw), c.env);
});

async function getOwnedItem(env: Env, uid: string, user: User): Promise<ItemRow | null | { _forbidden: true }> {
  const w = await env.DB.prepare('SELECT * FROM watchlist_items WHERE uid = ?').bind(uid).first<ItemRow>();
  if (!w) return null;
  if (w.owner_user_id !== user.id && !isAdmin(user)) return { _forbidden: true } as any;
  return w;
}

r.get('/watchlist/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(await dto(c.env, w as ItemRow));
  } catch (e) { return mapError(c, e); }
});

r.put('/watchlist/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    const item = w as ItemRow;
    const body = await c.req.json().catch(() => ({} as any));

    const next = {
      external_name: item.external_name,
      external_url: item.external_url,
      sector: item.sector,
      stage: item.stage,
      thesis: item.thesis,
      source: item.source,
      passed_reason: item.passed_reason,
      conviction: item.conviction,
      status: item.status,
      tags_json: item.tags_json,
      next_check_at: item.next_check_at,
      passed_at: item.passed_at,
    };
    if ('external_name' in body) next.external_name = trimOrNull(body.external_name, 200);
    if ('external_url' in body) next.external_url = trimOrNull(body.external_url, 1000);
    if ('sector' in body) next.sector = trimOrNull(body.sector, 120);
    if ('stage' in body) next.stage = trimOrNull(body.stage, 120);
    if ('thesis' in body) next.thesis = trimOrNull(body.thesis, 4000);
    if ('source' in body) next.source = trimOrNull(body.source, 120);
    if ('passed_reason' in body) next.passed_reason = trimOrNull(body.passed_reason, 2000);
    if ('conviction' in body) {
      const v = String(body.conviction || '').toLowerCase();
      if (!CONVICTION_VALUES.has(v)) return c.json({ detail: 'bad conviction' }, 400);
      next.conviction = v;
    }
    if ('status' in body) {
      const v = String(body.status || '').toLowerCase();
      if (!WATCHLIST_STATUS_VALUES.has(v)) return c.json({ detail: 'bad status' }, 400);
      // Stamp passed_at when transitioning into passed_on (audit parity).
      if (v === 'passed_on' && item.status !== 'passed_on') next.passed_at = nowIso();
      next.status = v;
    }
    if ('tags' in body) next.tags_json = normaliseTags(body.tags);
    if ('next_check_at' in body) next.next_check_at = trimOrNull(body.next_check_at, 64);

    await c.env.DB.prepare(
      `UPDATE watchlist_items SET external_name=?, external_url=?, sector=?, stage=?, thesis=?,
         source=?, passed_reason=?, conviction=?, status=?, tags_json=?, next_check_at=?, passed_at=?,
         updated_at=? WHERE id=?`
    ).bind(
      next.external_name, next.external_url, next.sector, next.stage, next.thesis,
      next.source, next.passed_reason, next.conviction, next.status, next.tags_json,
      next.next_check_at, next.passed_at, nowIso(), item.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?').bind(item.id).first<ItemRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

r.delete('/watchlist/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    await c.env.DB.prepare('DELETE FROM watchlist_items WHERE id = ?').bind((w as ItemRow).id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/watchlist/:uid/convert', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const w = await getOwnedItem(c.env, c.req.param('uid'), user);
    if (!w) return c.json({ detail: 'Not found' }, 404);
    if ((w as any)._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    const item = w as ItemRow;
    if (item.project_id == null) {
      return c.json({ detail: 'External watchlist items must be onboarded as projects before converting' }, 400);
    }
    const body = await c.req.json().catch(() => ({} as any));
    const dealId = body.deal_id != null ? Number(body.deal_id) : null;
    await c.env.DB.prepare(
      `UPDATE watchlist_items SET status='converted', converted_deal_id=?, converted_at=?, updated_at=? WHERE id=?`
    ).bind(dealId, nowIso(), nowIso(), item.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM watchlist_items WHERE id = ?').bind(item.id).first<ItemRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// /api/antiportfolio — roll-up of `pass` journal decisions + `passed_on`
// watchlist items, graded against where each project is today.
// ---------------------------------------------------------------------------
async function projectSignal(env: Env, projectId: number | null): Promise<ProjectSignal> {
  if (projectId == null) return { exists: false };
  const proj = await env.DB.prepare(
    'SELECT uid, name, status FROM projects WHERE id = ? AND deleted_at IS NULL'
  ).bind(projectId).first<any>();
  if (!proj) return { exists: false };
  const score = await env.DB.prepare(
    'SELECT total_score, tier FROM score_snapshots WHERE project_id = ? AND is_sandbox = 0 ORDER BY created_at DESC LIMIT 1'
  ).bind(projectId).first<any>();
  const health = await env.DB.prepare(
    'SELECT badge, score FROM portfolio_health_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 1'
  ).bind(projectId).first<any>();
  return {
    exists: true,
    uid: proj.uid,
    name: proj.name,
    status: proj.status,
    is_alive: String(proj.status) !== 'rejected',
    latest_score: score ? score.total_score : null,
    latest_tier: score ? score.tier : null,
    latest_health_badge: health ? health.badge : null,
    latest_health_score: health ? health.score : null,
  };
}

r.get('/antiportfolio', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canUseWatchlist(user)) return c.json({ detail: 'Forbidden' }, 403);
    const owner = c.req.query('owner') || 'me';
    let ownerFilter: number | null = user.id;
    if (owner === 'all') {
      if (!isAdmin(user)) return c.json({ detail: 'Admin only for owner=all' }, 403);
      ownerFilter = null;
    }

    let jWhere = "decision = 'pass'";
    const jParams: any[] = [];
    if (ownerFilter != null) { jWhere += ' AND owner_user_id = ?'; jParams.push(ownerFilter); }
    const passEntries = ((await c.env.DB.prepare(
      `SELECT uid, project_id, decided_at, created_at, thesis, key_risks, conviction,
              expected_multiple, outcome_status, outcome_notes, outcome_actual_multiple
         FROM decision_journal_entries WHERE ${jWhere}
        ORDER BY COALESCE(decided_at, created_at) DESC LIMIT 500`
    ).bind(...jParams).all<any>()).results || []) as any[];

    let wWhere = "status = 'passed_on'";
    const wParams: any[] = [];
    if (ownerFilter != null) { wWhere += ' AND owner_user_id = ?'; wParams.push(ownerFilter); }
    const passedItems = ((await c.env.DB.prepare(
      `SELECT uid, project_id, thesis, passed_reason, external_name, updated_at, created_at
         FROM watchlist_items WHERE ${wWhere} ORDER BY updated_at DESC LIMIT 500`
    ).bind(...wParams).all<any>()).results || []) as any[];

    const counts: Record<string, number> = { vindicated: 0, regret: 0, open: 0 };
    const rows: any[] = [];
    let biggest: { score: number; row: any } | null = null;

    for (const e of passEntries) {
      const signal = await projectSignal(c.env, e.project_id ?? null);
      const verdict = gradePass(signal);
      counts[verdict] = (counts[verdict] || 0) + 1;
      const row = {
        kind: 'journal',
        uid: e.uid,
        decided_at: e.decided_at || e.created_at,
        thesis: e.thesis,
        key_risks: e.key_risks,
        conviction: e.conviction,
        expected_multiple: e.expected_multiple,
        outcome_status: e.outcome_status,
        outcome_notes: e.outcome_notes,
        outcome_actual_multiple: e.outcome_actual_multiple,
        verdict,
        project: signal.exists ? signal : null,
      };
      rows.push(row);
      if (verdict === 'regret') {
        const s = (signal.latest_score || 0) + (signal.latest_health_score || 0);
        if (!biggest || s > biggest.score) biggest = { score: s, row };
      }
    }

    for (const item of passedItems) {
      const signal = await projectSignal(c.env, item.project_id ?? null);
      const verdict = gradePass(signal);
      counts[verdict] = (counts[verdict] || 0) + 1;
      const row = {
        kind: 'watchlist',
        uid: item.uid,
        decided_at: item.updated_at || item.created_at,
        thesis: item.thesis,
        passed_reason: item.passed_reason,
        external_name: item.external_name,
        verdict,
        project: signal.exists ? signal : null,
      };
      rows.push(row);
      if (verdict === 'regret') {
        const s = (signal.latest_score || 0) + (signal.latest_health_score || 0);
        if (!biggest || s > biggest.score) biggest = { score: s, row };
      }
    }

    rows.sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)));
    const total = rows.length;
    return c.json({
      owner,
      total_passes: total,
      counts,
      regret_rate: total ? Math.round((counts.regret / total) * 1000) / 10 : 0.0,
      biggest_regret: biggest ? biggest.row : null,
      rows,
    });
  } catch (e) { return mapError(c, e); }
});

// Task #1 (AG) — spec-contract aliases. /items mirrors the existing /watchlist
// surface (root list/create/delete) and /digest aliases /anti-portfolio for
// the daily digest view.
r.get('/items', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/watchlist/watchlist';
  return r.fetch(new Request(url, { method: 'GET', headers: c.req.raw.headers }), c.env, c.executionCtx);
});
r.post('/items', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/watchlist/watchlist';
  url.search = '';
  const body = await c.req.text();
  return r.fetch(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
});
// /items/:id — spec uses numeric id; canonical handler is keyed by `:uid`.
// Translate id → uid via DB lookup, then forward. Returns 404 if no row.
r.delete('/items/:id', async (c) => {
  try {
    await requireAuth(c);
    const n = Number(c.req.param('id'));
    if (!Number.isFinite(n) || n <= 0) return c.json({ detail: 'Not found' }, 404);
    const row = await c.env.DB.prepare('SELECT uid FROM watchlist_items WHERE id = ?')
      .bind(n).first<{ uid: string }>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    const url = new URL(c.req.url);
    url.pathname = `/api/watchlist/watchlist/${row.uid}`;
    url.search = '';
    return r.fetch(new Request(url, { method: 'DELETE', headers: c.req.raw.headers }), c.env, c.executionCtx);
  } catch (e) { return mapError(c, e); }
});
r.get('/digest', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/watchlist/watchlist/anti-portfolio';
  return r.fetch(new Request(url, { method: 'GET', headers: c.req.raw.headers }), c.env, c.executionCtx);
});

export default r;
