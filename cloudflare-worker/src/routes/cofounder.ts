/**
 * T12 — Co-founder matching (port of backend/app/api/routes/cofounder.py
 * + backend/app/services/cofounder.py merged into one file for the worker).
 *
 * Mounted at /api/cofounder. Founders + admins only. Mutual-interest
 * reveal pattern with auto-NDA on first connect:
 *
 *   1. Founder upserts a CofounderProfile.
 *   2. Browse returns redacted cards (handle = `cofounder-<uid[:8]>`).
 *   3. Express interest creates a directed signal. If the inverse
 *      already exists, a CofounderConnection + two NDA Documents are
 *      minted in `pending_nda` status.
 *   4. After both sides sign, status flips to `active` and identity
 *      (name + email) is exposed via the connections endpoint.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const cofounder = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Vocab + NDA template (copied verbatim from services/cofounder.py).
// ---------------------------------------------------------------------------
const SUGGESTED_SKILLS = [
  'engineering', 'product', 'design', 'data', 'ai_ml', 'research',
  'sales', 'marketing', 'growth', 'ops', 'finance', 'legal',
  'hardware', 'biotech', 'community', 'fundraising',
];
const SUGGESTED_SECTORS = [
  'fintech', 'saas', 'marketplace', 'consumer', 'ai', 'developer_tools',
  'health', 'biotech', 'climate', 'deeptech', 'edtech', 'gaming',
  'logistics', 'real_estate', 'media',
];
const ALLOWED_COMMITMENT = new Set(['full_time', 'part_time', 'exploring']);

const COFOUNDER_NDA_TITLE = 'Co-founder Mutual Non-Disclosure Agreement';
const COFOUNDER_NDA_BODY = `CO-FOUNDER MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement (the "Agreement") is entered into
between {signer_name} ("Recipient") and {counterparty_name}
("Discloser"), each a "Party", effective as of {today}.

1. PURPOSE. The Parties wish to evaluate a potential co-founder
   relationship and the formation of a startup (the "Purpose"). In
   connection with the Purpose, each Party may disclose Confidential
   Information to the other.

2. CONFIDENTIAL INFORMATION. "Confidential Information" includes any
   non-public business plan, product idea, customer list, technical
   approach, source code sketch, financial model, fundraising plan,
   personal contact, or other materials disclosed by one Party to the
   other in connection with the Purpose.

3. RECIPIENT OBLIGATIONS. Recipient shall (a) hold the Discloser's
   Confidential Information in strict confidence, (b) not use it for any
   purpose other than the Purpose, (c) not disclose it to any third
   party without the Discloser's prior written consent, and (d) protect
   it with at least the same degree of care it uses for its own
   confidential information of similar sensitivity.

4. EXCLUSIONS. The obligations in Section 3 do not apply to information
   that (a) was lawfully known by Recipient prior to disclosure, (b)
   becomes publicly available through no breach of this Agreement, (c)
   is independently developed by Recipient without use of Discloser's
   Confidential Information, or (d) is required to be disclosed by law,
   provided Recipient gives Discloser prompt notice where permitted.

5. NO LICENCE; NO PARTNERSHIP. Nothing in this Agreement grants either
   Party any right or licence to the other Party's Confidential
   Information except as expressly set out herein. This Agreement does
   not create a partnership, joint venture, employment, or agency
   relationship.

6. TERM. Each Party's obligations of confidentiality survive for two
   (2) years from the effective date.

7. RETURN OR DESTRUCTION. Upon written request, Recipient shall
   promptly destroy or return all Confidential Information received
   from the other Party, except for one archival copy retained for legal
   compliance.

8. GOVERNING LAW. This Agreement is governed by the laws of the State
   of Delaware, without regard to its conflict-of-laws principles.

By signing below, Recipient acknowledges and agrees to the terms above.

Signed: {signer_name} ({signer_email})
Date:   {today}
`;

// ---------------------------------------------------------------------------
// Tiny JSON helpers (mirror _loads/_dumps).
// ---------------------------------------------------------------------------
function loadList(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch { return []; }
}
function dumpList(items: any): string {
  if (!Array.isArray(items)) return '[]';
  const cleaned = items
    .map((x) => String(x ?? '').trim())
    .filter((x) => x.length > 0)
    .slice(0, 32);
  return JSON.stringify(cleaned);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ProfileRow = {
  id: number; uid: string; user_id: number;
  skills_json: string; sectors_json: string; commitment: string;
  location_city: string | null; location_country: string | null;
  remote_ok: number;
  equity_expectation_min: number | null; equity_expectation_max: number | null;
  bio: string | null; looking_for: string | null;
  listed: number;
  created_at: string; updated_at: string;
};
type InterestRow = {
  id: number; from_user_id: number; to_user_id: number;
  message: string | null; status: string;
  created_at: string; updated_at: string;
};
type ConnectionRow = {
  id: number; uid: string; user_a_id: number; user_b_id: number;
  nda_doc_a_id: number | null; nda_doc_b_id: number | null;
  nda_signed_at_a: string | null; nda_signed_at_b: string | null;
  nda_signed_ip_a: string | null; nda_signed_ip_b: string | null;
  nda_signed_name_a: string | null; nda_signed_name_b: string | null;
  status: string; closed_at: string | null; closed_reason: string | null;
  created_at: string; updated_at: string;
};
type UserLite = { id: number; uid?: string | null; name: string | null; email: string; is_active: number };

function role(u: { role: string }): string { return (u.role || '').toLowerCase(); }
function isAdmin(u: { role: string }): boolean { return role(u) === 'admin'; }
function canUseCofounder(u: { role: string }): boolean { return ['admin', 'founder'].includes(role(u)); }
function clientIp(c: any): string {
  const fwd = c.req.header('x-forwarded-for') || '';
  if (fwd) return fwd.split(',')[0].trim();
  return c.req.header('cf-connecting-ip') || 'unknown';
}
function gate(u: { role: string }): void {
  if (!canUseCofounder(u)) {
    const e = new Error('Co-founder matching is for founder accounts'); (e as any).status = 403; throw e;
  }
}

async function getProfile(env: Env, userId: number): Promise<ProfileRow | null> {
  return env.DB.prepare('SELECT * FROM cofounder_profiles WHERE user_id = ?')
    .bind(userId).first<ProfileRow>();
}

async function loadUser(env: Env, userId: number): Promise<UserLite | null> {
  return env.DB.prepare('SELECT id, uid, name, email, is_active FROM users WHERE id = ?')
    .bind(userId).first<UserLite>();
}
async function loadUserByUid(env: Env, uid: string): Promise<UserLite | null> {
  return env.DB.prepare('SELECT id, uid, name, email, is_active FROM users WHERE uid = ?')
    .bind(uid).first<UserLite>();
}

function serializeProfilePublic(p: ProfileRow, userUid: string | null): any {
  return {
    uid: p.uid,
    user_uid: userUid,
    handle: `cofounder-${p.uid.slice(0, 8)}`,
    skills: loadList(p.skills_json),
    sectors: loadList(p.sectors_json),
    commitment: p.commitment,
    location_city: p.location_city,
    location_country: p.location_country,
    remote_ok: !!p.remote_ok,
    equity_expectation_min: p.equity_expectation_min,
    equity_expectation_max: p.equity_expectation_max,
    bio: p.bio,
    looking_for: p.looking_for,
    listed: !!p.listed,
  };
}
function serializeProfileSelf(p: ProfileRow, userUid: string | null): any {
  return {
    ...serializeProfilePublic(p, userUid),
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Profile CRUD
// ---------------------------------------------------------------------------
cofounder.get('/me', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const p = await getProfile(c.env, user.id);
  if (!p) return c.json({ detail: 'No co-founder profile yet' }, 404);
  return c.json(serializeProfileSelf(p, user.uid || null));
});

cofounder.put('/me', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const body = await c.req.json().catch(() => ({}));
  const commitment = String(body?.commitment || 'full_time').trim().toLowerCase();
  if (!ALLOWED_COMMITMENT.has(commitment)) {
    return c.json({ detail: `commitment must be one of ${[...ALLOWED_COMMITMENT].sort()}` }, 400);
  }
  const eqMin = body?.equity_expectation_min;
  const eqMax = body?.equity_expectation_max;
  for (const [label, v] of [['equity_expectation_min', eqMin], ['equity_expectation_max', eqMax]] as const) {
    if (v != null) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) return c.json({ detail: `${label} must be a percent in [0, 100]` }, 400);
    }
  }
  if (eqMin != null && eqMax != null && Number(eqMin) > Number(eqMax)) {
    return c.json({ detail: 'equity_expectation_min cannot exceed equity_expectation_max' }, 400);
  }
  const bio = body?.bio ? String(body.bio).slice(0, 2000) : null;
  const lookingFor = body?.looking_for ? String(body.looking_for).slice(0, 400) : null;
  const now = new Date().toISOString();

  const existing = await getProfile(c.env, user.id);
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE cofounder_profiles
          SET skills_json = ?, sectors_json = ?, commitment = ?,
              location_city = ?, location_country = ?, remote_ok = ?,
              equity_expectation_min = ?, equity_expectation_max = ?,
              bio = ?, looking_for = ?, listed = ?, updated_at = ?
        WHERE user_id = ?`,
    ).bind(
      dumpList(body?.skills), dumpList(body?.sectors), commitment,
      body?.location_city || null, body?.location_country || null,
      body?.remote_ok === false ? 0 : 1,
      eqMin != null ? Number(eqMin) : null, eqMax != null ? Number(eqMax) : null,
      bio, lookingFor,
      body?.listed === false ? 0 : 1, now, user.id,
    ).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO cofounder_profiles
         (user_id, skills_json, sectors_json, commitment,
          location_city, location_country, remote_ok,
          equity_expectation_min, equity_expectation_max,
          bio, looking_for, listed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      user.id, dumpList(body?.skills), dumpList(body?.sectors), commitment,
      body?.location_city || null, body?.location_country || null,
      body?.remote_ok === false ? 0 : 1,
      eqMin != null ? Number(eqMin) : null, eqMax != null ? Number(eqMax) : null,
      bio, lookingFor,
      body?.listed === false ? 0 : 1, now, now,
    ).run();
  }
  const fresh = await getProfile(c.env, user.id);
  return c.json(serializeProfileSelf(fresh as ProfileRow, user.uid || null));
});

cofounder.delete('/me', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  await c.env.DB.prepare('UPDATE cofounder_profiles SET listed = 0, updated_at = ? WHERE user_id = ?')
    .bind(new Date().toISOString(), user.id).run();
  return c.json({ ok: true, listed: false });
});

cofounder.get('/vocab', async (c) => {
  await requireAuth(c);
  return c.json({
    skills: SUGGESTED_SKILLS,
    sectors: SUGGESTED_SECTORS,
    commitments: [...ALLOWED_COMMITMENT].sort(),
  });
});

// ---------------------------------------------------------------------------
// Browse + scoring
// ---------------------------------------------------------------------------
function scoreMatch(viewer: ProfileRow, candidate: ProfileRow): { score: number; why: string[] } {
  let score = 0;
  const why: string[] = [];
  const vSkills = new Set(loadList(viewer.skills_json));
  const cSkills = new Set(loadList(candidate.skills_json));
  const complementary = [...cSkills].filter((s) => !vSkills.has(s));
  if (complementary.length) {
    const bonus = Math.min(25, 5 * complementary.length);
    score += bonus;
    why.push(`complementary skills: ${complementary.sort().join(', ').slice(0, 80)}`);
  }
  const vSectors = new Set(loadList(viewer.sectors_json));
  const cSectors = new Set(loadList(candidate.sectors_json));
  const shared = [...vSectors].filter((s) => cSectors.has(s));
  if (shared.length) {
    const bonus = Math.min(30, 15 * shared.length);
    score += bonus;
    why.push(`sector overlap: ${shared.sort().join(', ')}`);
  }
  if (viewer.commitment === candidate.commitment) {
    score += 20;
    why.push(`same commitment (${viewer.commitment})`);
  }
  const vCity = (viewer.location_city || '').trim().toLowerCase();
  const cCity = (candidate.location_city || '').trim().toLowerCase();
  const vCountry = (viewer.location_country || '').trim().toLowerCase();
  const cCountry = (candidate.location_country || '').trim().toLowerCase();
  if (vCity && cCity && vCity === cCity) {
    score += 15; why.push(`same city (${viewer.location_city})`);
  } else if (vCountry && cCountry && vCountry === cCountry) {
    score += 5; why.push(`same country (${viewer.location_country})`);
  }
  if (viewer.remote_ok && candidate.remote_ok) {
    score += 5; why.push('both open to remote');
  }
  const vLo = viewer.equity_expectation_min, vHi = viewer.equity_expectation_max;
  const cLo = candidate.equity_expectation_min, cHi = candidate.equity_expectation_max;
  if ([vLo, vHi, cLo, cHi].every((x) => x != null)) {
    if (Math.max(vLo as number, cLo as number) <= Math.min(vHi as number, cHi as number)) {
      score += 10; why.push('equity expectations overlap');
    }
  }
  return { score, why };
}

cofounder.get('/browse', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const viewerProfile = await getProfile(c.env, user.id);
  if (!viewerProfile) {
    return c.json({ detail: 'Create your co-founder profile first (PUT /api/cofounder/me)' }, 400);
  }
  const q = c.req.query('q')?.toLowerCase() || null;
  const skill = c.req.query('skill')?.toLowerCase() || null;
  const sector = c.req.query('sector')?.toLowerCase() || null;
  const commitment = c.req.query('commitment') || null;
  const remoteOnly = c.req.query('remote_only') === 'true' || c.req.query('remote_only') === '1';
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 50)));

  let where = 'listed = 1 AND user_id <> ?';
  const params: any[] = [user.id];
  if (commitment) { where += ' AND commitment = ?'; params.push(commitment); }
  if (remoteOnly) { where += ' AND remote_ok = 1'; }
  const fetched = await c.env.DB.prepare(
    `SELECT * FROM cofounder_profiles WHERE ${where} LIMIT ?`,
  ).bind(...params, Math.max(limit * 4, 200)).all<ProfileRow>();
  const rows = (fetched.results || []) as ProfileRow[];

  const sentRows = await c.env.DB.prepare(
    `SELECT * FROM cofounder_interests WHERE from_user_id = ? AND status = 'sent'`,
  ).bind(user.id).all<InterestRow>();
  const sent = new Set((sentRows.results || []).map((r: any) => r.to_user_id));
  const recvRows = await c.env.DB.prepare(
    `SELECT * FROM cofounder_interests WHERE to_user_id = ? AND status = 'sent'`,
  ).bind(user.id).all<InterestRow>();
  const received = new Set((recvRows.results || []).map((r: any) => r.from_user_id));
  const closedRows = await c.env.DB.prepare(
    `SELECT user_a_id, user_b_id FROM cofounder_connections
       WHERE status = 'closed' AND (user_a_id = ? OR user_b_id = ?)`,
  ).bind(user.id, user.id).all<{ user_a_id: number; user_b_id: number }>();
  const closedIds = new Set<number>();
  for (const r of (closedRows.results || []) as any[]) {
    closedIds.add(r.user_a_id === user.id ? r.user_b_id : r.user_a_id);
  }

  const userIds = rows.map((p) => p.user_id);
  const uidById = new Map<number, string>();
  // T20 — exclude users who set show_in_directory=0 in user_settings.
  // The table is created lazily; absence == default (visible).
  const hiddenIds = new Set<number>();
  if (userIds.length) {
    const placeholders = userIds.map(() => '?').join(',');
    const ures = await c.env.DB.prepare(
      `SELECT id, uid FROM users WHERE id IN (${placeholders})`,
    ).bind(...userIds).all<{ id: number; uid: string | null }>();
    for (const u of (ures.results || []) as any[]) uidById.set(u.id, u.uid || '');
    try {
      const hres = await c.env.DB.prepare(
        `SELECT user_id FROM user_settings WHERE show_in_directory = 0 AND user_id IN (${placeholders})`,
      ).bind(...userIds).all<{ user_id: number }>();
      for (const h of (hres.results || []) as any[]) hiddenIds.add(h.user_id);
    } catch {}
  }

  const scored: Array<{ score: number; why: string[]; profile: ProfileRow }> = [];
  for (const p of rows) {
    if (closedIds.has(p.user_id)) continue;
    if (hiddenIds.has(p.user_id)) continue;
    const cSkills = loadList(p.skills_json).map((s) => s.toLowerCase());
    const cSectors = loadList(p.sectors_json).map((s) => s.toLowerCase());
    if (skill && !cSkills.includes(skill)) continue;
    if (sector && !cSectors.includes(sector)) continue;
    if (q) {
      const blob = [
        p.bio || '', p.looking_for || '',
        cSkills.join(' '), cSectors.join(' '),
        p.location_city || '', p.location_country || '',
      ].join(' ').toLowerCase();
      if (!blob.includes(q)) continue;
    }
    const { score, why } = scoreMatch(viewerProfile, p);
    scored.push({ score, why, profile: p });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.profile.id - b.profile.id));
  const cards = scored.slice(0, limit).map(({ score, why, profile: p }) => {
    const card: any = serializeProfilePublic(p, uidById.get(p.user_id) || null);
    // Task #51 — surface integer user_id alongside the (already-public)
    // user_uid so admin/investor/partner viewers' UserTrustBadge can call
    // /api/trust/score/:userId. Mirrors the partners.ts non-admin LEFT
    // JOIN: identity stays anonymized (no name/email leak); the trust
    // endpoint itself enforces viewer-role access.
    card.user_id = p.user_id;
    card.match_score = score;
    card.match_reasons = why;
    card.interest_sent = sent.has(p.user_id);
    card.interest_received = received.has(p.user_id);
    card.mutual_interest = card.interest_sent && card.interest_received;
    return card;
  });
  return c.json({ items: cards });
});

// ---------------------------------------------------------------------------
// Interest
// ---------------------------------------------------------------------------
function orderedPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

async function getConnection(env: Env, x: number, y: number): Promise<ConnectionRow | null> {
  const [lo, hi] = orderedPair(x, y);
  return env.DB.prepare(
    'SELECT * FROM cofounder_connections WHERE user_a_id = ? AND user_b_id = ?',
  ).bind(lo, hi).first<ConnectionRow>();
}

function renderNda(signer: UserLite, counterparty: UserLite): string {
  const today = new Date().toISOString().slice(0, 10);
  return COFOUNDER_NDA_BODY
    .replaceAll('{signer_name}', signer.name || signer.email)
    .replaceAll('{signer_email}', signer.email)
    .replaceAll('{counterparty_name}', counterparty.name || counterparty.email)
    .replaceAll('{today}', today);
}

async function ensureConnectionWithNdas(env: Env, ux: UserLite, uy: UserLite): Promise<ConnectionRow> {
  const [lo, hi] = orderedPair(ux.id, uy.id);
  const existing = await env.DB.prepare(
    'SELECT * FROM cofounder_connections WHERE user_a_id = ? AND user_b_id = ?',
  ).bind(lo, hi).first<ConnectionRow>();
  if (existing) return existing;

  // Race-safe: insert the connection FIRST (with NULL doc IDs). The
  // UNIQUE(user_a_id, user_b_id) constraint is the race detector. Only
  // after a successful insert do we mint the NDA documents and back-fill
  // the FK columns — so a losing race never produces orphan documents.
  // Only swallow UNIQUE-constraint errors; other failures must propagate.
  try {
    await env.DB.prepare(
      `INSERT INTO cofounder_connections
         (user_a_id, user_b_id, status)
       VALUES (?, ?, 'pending_nda')`,
    ).bind(lo, hi).run();
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (!/UNIQUE|constraint failed/i.test(msg)) throw e;
    const conn = await env.DB.prepare(
      'SELECT * FROM cofounder_connections WHERE user_a_id = ? AND user_b_id = ?',
    ).bind(lo, hi).first<ConnectionRow>();
    return conn as ConnectionRow;
  }

  const userA = lo === ux.id ? ux : uy;
  const userB = hi === uy.id ? uy : ux;
  const titleA = `${COFOUNDER_NDA_TITLE} — ${userA.email}`;
  const titleB = `${COFOUNDER_NDA_TITLE} — ${userB.email}`;
  const bodyA = renderNda(userA, userB);
  const bodyB = renderNda(userB, userA);
  const docARes = await env.DB.prepare(
    `INSERT INTO documents (title, doc_type, status, content, template_name)
     VALUES (?, 'other', 'generated', ?, 'nda_cofounder')`,
  ).bind(titleA, bodyA).run();
  const docBRes = await env.DB.prepare(
    `INSERT INTO documents (title, doc_type, status, content, template_name)
     VALUES (?, 'other', 'generated', ?, 'nda_cofounder')`,
  ).bind(titleB, bodyB).run();
  const docAId = (docARes.meta as any)?.last_row_id ?? null;
  const docBId = (docBRes.meta as any)?.last_row_id ?? null;

  await env.DB.prepare(
    `UPDATE cofounder_connections
        SET nda_doc_a_id = ?, nda_doc_b_id = ?, updated_at = datetime('now')
      WHERE user_a_id = ? AND user_b_id = ? AND nda_doc_a_id IS NULL`,
  ).bind(docAId, docBId, lo, hi).run();

  const conn = await env.DB.prepare(
    'SELECT * FROM cofounder_connections WHERE user_a_id = ? AND user_b_id = ?',
  ).bind(lo, hi).first<ConnectionRow>();
  return conn as ConnectionRow;
}

cofounder.post('/interest', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const body = await c.req.json().catch(() => ({}));
  const targetUid = String(body?.user_uid || '');
  if (!targetUid) return c.json({ detail: 'user_uid required' }, 400);
  const target = await loadUserByUid(c.env, targetUid);
  if (!target || !target.is_active) return c.json({ detail: 'User not found' }, 404);
  if (target.id === user.id) return c.json({ detail: 'cannot_self_interest' }, 400);

  const me = await getProfile(c.env, user.id);
  if (!me) return c.json({ detail: 'viewer_has_no_profile' }, 400);
  const targetProfile = await getProfile(c.env, target.id);
  if (!targetProfile || !targetProfile.listed) return c.json({ detail: 'target_not_listed' }, 400);

  const existingConn = await getConnection(c.env, user.id, target.id);
  if (existingConn && existingConn.status === 'closed') {
    return c.json({ detail: 'connection_closed' }, 400);
  }

  const message = body?.message ? String(body.message).slice(0, 500) : null;
  // Idempotent on (from, to) — UPSERT to flip a withdrawn row back to sent.
  await c.env.DB.prepare(
    `INSERT INTO cofounder_interests (from_user_id, to_user_id, message, status)
       VALUES (?, ?, ?, 'sent')
     ON CONFLICT(from_user_id, to_user_id) DO UPDATE SET
       status = 'sent',
       message = COALESCE(cofounder_interests.message, excluded.message),
       updated_at = datetime('now')`,
  ).bind(user.id, target.id, message).run();
  const interest = await c.env.DB.prepare(
    'SELECT * FROM cofounder_interests WHERE from_user_id = ? AND to_user_id = ?',
  ).bind(user.id, target.id).first<InterestRow>();

  // Detect mutual interest.
  const inverse = await c.env.DB.prepare(
    `SELECT * FROM cofounder_interests
       WHERE from_user_id = ? AND to_user_id = ? AND status = 'sent'`,
  ).bind(target.id, user.id).first<InterestRow>();
  let connectionUid: string | null = null;
  if (inverse) {
    const me_user = await loadUser(c.env, user.id);
    if (me_user) {
      const conn = await ensureConnectionWithNdas(c.env, me_user, target);
      connectionUid = conn.uid;
    }
  }
  return c.json({
    ok: true,
    interest_id: interest?.id ?? null,
    mutual: !!inverse,
    connection_uid: connectionUid,
  });
});

cofounder.delete('/interest/:user_uid', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const target = await loadUserByUid(c.env, c.req.param('user_uid'));
  if (!target) return c.json({ detail: 'User not found' }, 404);
  const interest = await c.env.DB.prepare(
    'SELECT * FROM cofounder_interests WHERE from_user_id = ? AND to_user_id = ?',
  ).bind(user.id, target.id).first<InterestRow>();
  if (!interest || interest.status === 'withdrawn') return c.json({ ok: true, withdrew: false });
  await c.env.DB.prepare(
    `UPDATE cofounder_interests SET status = 'withdrawn', updated_at = datetime('now')
       WHERE from_user_id = ? AND to_user_id = ?`,
  ).bind(user.id, target.id).run();
  return c.json({ ok: true, withdrew: true });
});

// ---------------------------------------------------------------------------
// Connections + NDA
// ---------------------------------------------------------------------------
async function loadConnectionOr403(env: Env, uid: string, user: { id: number; role: string }):
  Promise<{ ok: true; conn: ConnectionRow } | { ok: false; res: Response }> {
  const conn = await env.DB.prepare('SELECT * FROM cofounder_connections WHERE uid = ?')
    .bind(uid).first<ConnectionRow>();
  if (!conn) return { ok: false, res: new Response(JSON.stringify({ detail: 'Connection not found' }), { status: 404, headers: { 'content-type': 'application/json' } }) };
  if (conn.user_a_id !== user.id && conn.user_b_id !== user.id && !isAdmin(user)) {
    return { ok: false, res: new Response(JSON.stringify({ detail: 'Not a party to this connection' }), { status: 403, headers: { 'content-type': 'application/json' } }) };
  }
  return { ok: true, conn };
}

async function serializeConnectionFor(env: Env, c: ConnectionRow, viewer: { id: number }): Promise<any> {
  const isA = c.user_a_id === viewer.id;
  const otherId = isA ? c.user_b_id : c.user_a_id;
  const other = await loadUser(env, otherId);
  const otherProfile = await getProfile(env, otherId);
  const mySigned = isA ? c.nda_signed_at_a : c.nda_signed_at_b;
  const theirSigned = isA ? c.nda_signed_at_b : c.nda_signed_at_a;
  const myDoc = isA ? c.nda_doc_a_id : c.nda_doc_b_id;
  return {
    uid: c.uid,
    status: c.status,
    created_at: c.created_at,
    i_signed_at: mySigned,
    they_signed_at: theirSigned,
    my_nda_document_id: myDoc,
    counterparty: {
      user_id: otherId,
      name: other?.name || null,
      email: other?.email || null,
      profile: otherProfile ? serializeProfilePublic(otherProfile, other?.uid || null) : null,
    },
  };
}

cofounder.get('/connections', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const rows = await c.env.DB.prepare(
    'SELECT * FROM cofounder_connections WHERE user_a_id = ? OR user_b_id = ? ORDER BY created_at DESC',
  ).bind(user.id, user.id).all<ConnectionRow>();
  const items = await Promise.all(((rows.results || []) as ConnectionRow[]).map((r) => serializeConnectionFor(c.env, r, user)));
  return c.json({ items });
});

cofounder.get('/connections/:uid', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const r = await loadConnectionOr403(c.env, c.req.param('uid'), user);
  if (!r.ok) return r.res;
  return c.json(await serializeConnectionFor(c.env, r.conn, user));
});

cofounder.get('/connections/:uid/nda', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const r = await loadConnectionOr403(c.env, c.req.param('uid'), user);
  if (!r.ok) return r.res;
  const isA = r.conn.user_a_id === user.id;
  const docId = isA ? r.conn.nda_doc_a_id : r.conn.nda_doc_b_id;
  if (!docId) return c.json({ detail: 'NDA document not found' }, 404);
  const doc = await c.env.DB.prepare(
    'SELECT id, title, content, status FROM documents WHERE id = ?',
  ).bind(docId).first<{ id: number; title: string; content: string; status: string }>();
  if (!doc) return c.json({ detail: 'NDA document not found' }, 404);
  return c.json({ title: doc.title, body: doc.content, status: doc.status, document_id: doc.id });
});

cofounder.post('/connections/:uid/nda/sign', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const body = await c.req.json().catch(() => ({}));
  if (!body?.accepted) return c.json({ detail: 'You must affirmatively accept the NDA terms' }, 400);
  const signerName = String(body?.signer_name || '').trim();
  if (!signerName || signerName.length > 200) return c.json({ detail: 'signer_name 1..200 chars required' }, 400);

  const r = await loadConnectionOr403(c.env, c.req.param('uid'), user);
  if (!r.ok) return r.res;
  let conn = r.conn;
  if (conn.status === 'closed') return c.json({ detail: 'connection_closed' }, 400);

  const isA = conn.user_a_id === user.id;
  const already = isA ? conn.nda_signed_at_a : conn.nda_signed_at_b;
  if (!already) {
    const now = new Date().toISOString();
    const ip = clientIp(c).slice(0, 64);
    if (isA) {
      await c.env.DB.prepare(
        `UPDATE cofounder_connections
            SET nda_signed_at_a = ?, nda_signed_name_a = ?, nda_signed_ip_a = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(now, signerName.slice(0, 200), ip, now, conn.id).run();
    } else {
      await c.env.DB.prepare(
        `UPDATE cofounder_connections
            SET nda_signed_at_b = ?, nda_signed_name_b = ?, nda_signed_ip_b = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(now, signerName.slice(0, 200), ip, now, conn.id).run();
    }
    // Re-load to determine if both sides have now signed.
    conn = await c.env.DB.prepare('SELECT * FROM cofounder_connections WHERE id = ?')
      .bind(conn.id).first<ConnectionRow>() as ConnectionRow;
    if (conn.nda_signed_at_a && conn.nda_signed_at_b && conn.status !== 'closed') {
      await c.env.DB.prepare(
        `UPDATE cofounder_connections SET status = 'active', updated_at = ? WHERE id = ?`,
      ).bind(now, conn.id).run();
      conn = { ...conn, status: 'active' };
    }
    const docId = isA ? conn.nda_doc_a_id : conn.nda_doc_b_id;
    if (docId) {
      await c.env.DB.prepare(
        `UPDATE documents SET status = 'signed', signed_by = ?, signed_at = ?, updated_at = ?
           WHERE id = ? AND status <> 'signed'`,
      ).bind(user.email, now, now, docId).run();
    }
  }
  return c.json(await serializeConnectionFor(c.env, conn, user));
});

cofounder.delete('/connections/:uid', async (c) => {
  const user = await requireAuth(c);
  try { gate(user); } catch (e: any) { return c.json({ detail: e.message }, e.status || 403); }
  const reason = c.req.query('reason')?.slice(0, 200) || null;
  const r = await loadConnectionOr403(c.env, c.req.param('uid'), user);
  if (!r.ok) return r.res;
  let conn = r.conn;
  if (conn.status !== 'closed') {
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE cofounder_connections
          SET status = 'closed', closed_at = ?, closed_reason = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(now, reason, now, conn.id).run();
    conn = { ...conn, status: 'closed', closed_at: now, closed_reason: reason };
  }
  return c.json(await serializeConnectionFor(c.env, conn, user));
});

// Task #1 (AG) — spec-contract aliases.
// POST /me/preferences mirrors PUT /me (preferences are part of the profile).
cofounder.post('/me/preferences', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/cofounder/me';
  url.search = '';
  const body = await c.req.text();
  const proxied = new Request(url, { method: 'PUT', headers: c.req.raw.headers, body });
  return cofounder.fetch(proxied, c.env, c.executionCtx);
});
// GET /matches mirrors /browse (the discovery surface). Preserve query params
// (e.g. ?stage=, ?skills=) by leaving url.search untouched and only swapping
// the pathname — never concatenate `search` into `pathname`.
cofounder.get('/matches', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/cofounder/browse';
  return cofounder.fetch(new Request(url, { method: 'GET', headers: c.req.raw.headers }), c.env, c.executionCtx);
});

export default cofounder;
