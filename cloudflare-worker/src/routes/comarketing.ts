/**
 * T15 — Co-marketing pitches + admin approval + attribution tracking.
 * Mounted at /api/comarketing.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureTier } from '../middleware/requireTier';
import { isAdmin, isPartner, mapError, nowIso, newUid, requirePartnerProfile } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

const ASSET_TYPES = new Set(['webinar', 'blog', 'podcast', 'event', 'newsletter', 'other']);
const LEGAL_TRANSITIONS: Record<string, Set<string>> = {
  approved: new Set(['proposed']),
  rejected: new Set(['proposed']),
  published: new Set(['approved']),
  withdrawn: new Set(['proposed', 'approved']),
};

type Pitch = {
  id: number; uid: string;
  partner_id: number; submitter_user_id: number;
  title: string; summary: string; asset_type: string;
  proposed_date: string | null;
  target_audience: string | null; distribution_channels: string | null;
  co_branding_notes: string | null; asset_url: string | null;
  status: string;
  review_notes: string | null; reviewed_by_user_id: number | null; reviewed_at: string | null;
  published_at: string | null; published_url: string | null;
  attribution_code: string | null;
  created_at: string; updated_at: string;
};

async function attribCounts(env: Env, pitchId: number) {
  const rows = await env.DB.prepare(
    `SELECT event_kind, COUNT(*) c FROM comarketing_attributions
     WHERE pitch_id = ? GROUP BY event_kind`
  ).bind(pitchId).all<{ event_kind: string; c: number }>();
  const out = { visit: 0, signup: 0, lead: 0, conversion: 0, total: 0 } as Record<string, number>;
  for (const row of rows.results || []) {
    out[row.event_kind] = Number(row.c);
    out.total += Number(row.c);
  }
  return out;
}

function pitchDto(p: Pitch, attribution: any, includeReviewNotes = true): any {
  const out: any = {
    id: p.id, uid: p.uid,
    partner_id: p.partner_id, submitter_user_id: p.submitter_user_id,
    title: p.title, summary: p.summary, asset_type: p.asset_type,
    proposed_date: p.proposed_date, target_audience: p.target_audience,
    distribution_channels: p.distribution_channels,
    co_branding_notes: p.co_branding_notes, asset_url: p.asset_url,
    status: p.status, published_at: p.published_at,
    published_url: p.published_url, attribution_code: p.attribution_code,
    created_at: p.created_at, updated_at: p.updated_at,
    attribution,
  };
  if (includeReviewNotes) {
    out.review_notes = p.review_notes;
    out.reviewed_at = p.reviewed_at;
  }
  return out;
}

async function mintCode(env: Env): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes).map((b) => b.toString(36)).join('').slice(0, 12).toLowerCase();
    const exists = await env.DB.prepare('SELECT 1 FROM comarketing_pitches WHERE attribution_code = ?').bind(code).first();
    if (!exists) return code;
  }
  // Last-ditch
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16)).join('').slice(0, 16);
}

// Partner side ----------------------------------------------------------
r.post('/me/pitches', async (c) => {
  // Task #6 — co-marketing pitch creation is Growth-tier.
  ensureTier(await requireAuth(c), 'growth');
  try {
    const user = await requireAuth(c);
    if (!(isPartner(user) || isAdmin(user))) return c.json({ detail: 'Partner role required' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const asset_type = String(body.asset_type || 'webinar');
    if (!ASSET_TYPES.has(asset_type)) return c.json({ detail: 'invalid asset_type' }, 400);
    const title = String(body.title || '').trim();
    const summary = String(body.summary || '').trim();
    if (title.length < 3 || summary.length < 10) return c.json({ detail: 'title/summary too short' }, 400);
    const partner = await requirePartnerProfile(c.env, user);
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO comarketing_pitches
         (uid, partner_id, submitter_user_id, title, summary, asset_type,
          proposed_date, target_audience, distribution_channels, co_branding_notes,
          asset_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`
    ).bind(uid, partner.id, user.id, title.slice(0, 200), summary.slice(0, 4000), asset_type,
           body.proposed_date || null,
           body.target_audience ? String(body.target_audience).slice(0, 500) : null,
           body.distribution_channels ? String(body.distribution_channels).slice(0, 500) : null,
           body.co_branding_notes ? String(body.co_branding_notes).slice(0, 2000) : null,
           body.asset_url ? String(body.asset_url).slice(0, 500) : null,
           nowIso(), nowIso()).run();
    const p = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<Pitch>();
    return c.json(pitchDto(p!, await attribCounts(c.env, p!.id)));
  } catch (e) { return mapError(c, e); }
});

r.get('/me/pitches', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const status = c.req.query('status');
    const sql = status
      ? 'SELECT * FROM comarketing_pitches WHERE partner_id = ? AND status = ? ORDER BY created_at DESC'
      : 'SELECT * FROM comarketing_pitches WHERE partner_id = ? ORDER BY created_at DESC';
    const rows = status
      ? await c.env.DB.prepare(sql).bind(partner.id, status).all<Pitch>()
      : await c.env.DB.prepare(sql).bind(partner.id).all<Pitch>();
    const items: any[] = [];
    for (const p of rows.results || []) items.push(pitchDto(p, await attribCounts(c.env, p.id)));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.patch('/me/pitches/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const p = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE uid = ?')
      .bind(c.req.param('uid')).first<Pitch>();
    if (!p || p.partner_id !== partner.id) return c.json({ detail: 'Pitch not found' }, 404);
    if (p.status !== 'proposed') return c.json({ detail: 'Pitch can only be edited while proposed' }, 409);
    const body = await c.req.json().catch(() => ({} as any));
    if (body.asset_type && !ASSET_TYPES.has(body.asset_type)) return c.json({ detail: 'invalid asset_type' }, 400);
    const fields = ['title', 'summary', 'asset_type', 'proposed_date', 'target_audience',
      'distribution_channels', 'co_branding_notes', 'asset_url'] as const;
    const sets: string[] = []; const params: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
    }
    if (!sets.length) return c.json(pitchDto(p, await attribCounts(c.env, p.id)));
    sets.push('updated_at = ?'); params.push(nowIso()); params.push(p.id);
    await c.env.DB.prepare(`UPDATE comarketing_pitches SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE id = ?').bind(p.id).first<Pitch>();
    return c.json(pitchDto(fresh!, await attribCounts(c.env, p.id)));
  } catch (e) { return mapError(c, e); }
});

r.post('/me/pitches/:uid/withdraw', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const p = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE uid = ?')
      .bind(c.req.param('uid')).first<Pitch>();
    if (!p || p.partner_id !== partner.id) return c.json({ detail: 'Pitch not found' }, 404);
    if (!LEGAL_TRANSITIONS.withdrawn.has(p.status)) {
      return c.json({ detail: `Cannot withdraw from ${p.status}` }, 409);
    }
    await c.env.DB.prepare("UPDATE comarketing_pitches SET status='withdrawn', updated_at=? WHERE id=?")
      .bind(nowIso(), p.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE id = ?').bind(p.id).first<Pitch>();
    return c.json(pitchDto(fresh!, await attribCounts(c.env, p.id)));
  } catch (e) { return mapError(c, e); }
});

// Admin -----------------------------------------------------------------
r.get('/admin/queue', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin only' }, 403);
    const status = c.req.query('status') || 'proposed';
    const rows = await c.env.DB.prepare(
      'SELECT * FROM comarketing_pitches WHERE status = ? ORDER BY created_at DESC'
    ).bind(status).all<Pitch>();
    const items: any[] = [];
    for (const p of rows.results || []) {
      const partner = await c.env.DB.prepare('SELECT name, company FROM partners WHERE id = ?').bind(p.partner_id).first<any>();
      const d = pitchDto(p, await attribCounts(c.env, p.id));
      d.partner_name = partner?.name || null;
      d.partner_company = partner?.company || null;
      items.push(d);
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

async function adminTransition(c: Context<{ Bindings: Env }>, target: 'approve' | 'reject' | 'publish') {
  const user = await requireAuth(c);
  if (!isAdmin(user)) return c.json({ detail: 'Admin only' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const p = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE uid = ?')
    .bind(c.req.param('uid')).first<Pitch>();
  if (!p) return c.json({ detail: 'Pitch not found' }, 404);
  const next = target === 'approve' ? 'approved' : target === 'reject' ? 'rejected' : 'published';
  if (!LEGAL_TRANSITIONS[next].has(p.status)) {
    return c.json({ detail: `Cannot ${target} from ${p.status}` }, 409);
  }
  let setAttribCode = p.attribution_code;
  if (next === 'approved' && !p.attribution_code) setAttribCode = await mintCode(c.env);
  let publishedAt = p.published_at;
  let publishedUrl = p.published_url;
  let reviewNotes = p.review_notes;
  if (next === 'published') {
    publishedAt = nowIso();
    if (body.published_url) publishedUrl = String(body.published_url).slice(0, 500);
    if (body.notes) {
      reviewNotes = (p.review_notes ? `${p.review_notes}\n\n` : '') + `[publish] ${body.notes}`;
    }
  } else if (body.notes !== undefined) {
    reviewNotes = body.notes ? String(body.notes).slice(0, 2000) : null;
  }
  await c.env.DB.prepare(
    `UPDATE comarketing_pitches SET status=?, review_notes=?, reviewed_by_user_id=?, reviewed_at=?,
       attribution_code=?, published_at=?, published_url=?, updated_at=? WHERE id=?`
  ).bind(next, reviewNotes, user.id, nowIso(), setAttribCode, publishedAt, publishedUrl, nowIso(), p.id).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE id = ?').bind(p.id).first<Pitch>();
  return c.json(pitchDto(fresh!, await attribCounts(c.env, p.id)));
}

r.post('/admin/pitches/:uid/approve', (c) => adminTransition(c, 'approve'));
r.post('/admin/pitches/:uid/reject', (c) => adminTransition(c, 'reject'));
r.post('/admin/pitches/:uid/publish', (c) => adminTransition(c, 'publish'));

// Public ----------------------------------------------------------------
r.get('/published', async (c) => {
  try {
    await requireAuth(c);
    const rows = await c.env.DB.prepare(
      "SELECT * FROM comarketing_pitches WHERE status='published' ORDER BY published_at DESC LIMIT 200"
    ).all<Pitch>();
    const items: any[] = [];
    for (const p of rows.results || []) {
      const partner = await c.env.DB.prepare('SELECT name, company FROM partners WHERE id = ?').bind(p.partner_id).first<any>();
      const d = pitchDto(p, await attribCounts(c.env, p.id), false);
      d.partner_name = partner?.name || null;
      d.partner_company = partner?.company || null;
      items.push(d);
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.post('/track', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const code = String(body.code || '').trim();
    if (!code) return c.json({ detail: 'code required' }, 400);
    const kind = String(body.event_kind || 'visit');
    if (!['visit', 'signup', 'lead', 'conversion'].includes(kind)) {
      return c.json({ detail: 'invalid event_kind' }, 400);
    }
    const p = await c.env.DB.prepare('SELECT * FROM comarketing_pitches WHERE attribution_code = ?')
      .bind(code).first<Pitch>();
    if (!p) return c.json({ detail: 'Unknown attribution code' }, 404);
    if (!['approved', 'published'].includes(p.status)) {
      return c.json({ detail: 'Pitch not active' }, 409);
    }
    const referrer = c.req.header('referer') || c.req.header('referrer') || null;
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO comarketing_attributions
         (uid, pitch_id, partner_id, event_kind, user_id, project_id, lead_email, referrer, landing_path, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, p.id, p.partner_id, kind, user.id,
           body.project_id != null ? Number(body.project_id) : null,
           body.lead_email || user.email,
           referrer ? referrer.slice(0, 500) : null,
           body.landing_path || null,
           body.notes ? String(body.notes).slice(0, 1000) : null,
           nowIso()).run();
    return c.json({ ok: true, pitch_uid: p.uid, attribution_uid: uid });
  } catch (e) { return mapError(c, e); }
});

r.get('/me/attributions', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const pitchUid = c.req.query('pitch_uid');
    let where = 'partner_id = ?';
    const params: any[] = [partner.id];
    if (pitchUid) {
      const p = await c.env.DB.prepare('SELECT id FROM comarketing_pitches WHERE uid = ?').bind(pitchUid).first<{ id: number }>();
      if (p) { where += ' AND pitch_id = ?'; params.push(p.id); }
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM comarketing_attributions WHERE ${where} ORDER BY created_at DESC LIMIT 500`
    ).bind(...params).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

// Task #1 (AG) — spec-contract aliases.
// POST /pitches mirrors /me/pitches (the create endpoint for the caller's pitch).
r.post('/pitches', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/comarketing/me/pitches';
  url.search = '';
  const body = await c.req.text();
  return r.fetch(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
});
// GET /campaigns aliases /published (campaigns = published pitches). Query
// params on /campaigns?... must be forwarded via url.search, never embedded
// into url.pathname (which would produce an encoded `%3F` segment).
r.get('/campaigns', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/comarketing/published';
  return r.fetch(new Request(url, { method: 'GET', headers: c.req.raw.headers }), c.env, c.executionCtx);
});
// POST /campaigns aliases /me/pitches (creating a campaign = creating a pitch).
r.post('/campaigns', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/comarketing/me/pitches';
  url.search = '';
  const body = await c.req.text();
  return r.fetch(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
});

export default r;
