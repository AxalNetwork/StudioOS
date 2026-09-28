/**
 * T15 — Company profiles + memberships.
 * Mounted at /api (so it serves /api/company/* + /api/companies).
 *
 * DTO layering mirrors FastAPI:
 *   summary  -> public list shape (no business-sensitive fields, no member emails)
 *   detail   -> members + private fields (member emails masked unless viewer is
 *               a member of this company or platform admin).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, generateToken } from '../auth';
import {
  isTitle, isAuthority, normalizeCarryBps, teamVocabulary,
} from '../services/teamAuthority';
import { isAdmin, mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { clampLimit, parseOffset } from '../util/pagination';
import { hashInviteToken } from '../services/projectAccess';
import { refuse } from '../util/refusal';
import {
  validatePerson, validateCoverage, validatePlan, personDto,
} from '../services/companyTeam';

const r = new Hono<{ Bindings: Env }>();

type Company = {
  id: number; uid: string; company_name: string;
  stage: string | null; revenue_range: string | null;
  employee_count: number | null;
  current_products: string | null; international_presence: string | null;
  expansion_goals: string | null;
  logo_url: string | null; website: string | null; linkedin_url: string | null;
  description: string | null;
  created_at: string; updated_at: string;
};
type Link = {
  id: number; uid: string; company_id: number; user_id: number;
  role_in_company: string; is_primary_admin: number; created_at: string;
};

const PUBLIC_FIELDS = ['id', 'uid', 'company_name', 'stage', 'logo_url', 'website',
  'linkedin_url', 'description', 'international_presence'] as const;
const PRIVATE_FIELDS = ['revenue_range', 'employee_count', 'current_products', 'expansion_goals'] as const;

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const dom = email.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***${dom}`;
}

async function memberCount(env: Env, companyId: number): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) c FROM user_company_links WHERE company_id = ?')
    .bind(companyId).first<{ c: number }>();
  return Number(r?.c || 0);
}

async function viewerIsMember(env: Env, companyId: number, viewer: User): Promise<boolean> {
  if (isAdmin(viewer)) return true;
  const link = await env.DB.prepare(
    'SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?'
  ).bind(companyId, viewer.id).first();
  return !!link;
}

async function summaryDto(env: Env, c: Company): Promise<any> {
  const out: any = {};
  for (const f of PUBLIC_FIELDS) out[f] = (c as any)[f];
  out.member_count = await memberCount(env, c.id);
  out.created_at = c.created_at;
  return out;
}

async function detailDto(env: Env, c: Company, viewer: User): Promise<any> {
  const out: any = {};
  for (const f of PUBLIC_FIELDS) out[f] = (c as any)[f];
  for (const f of PRIVATE_FIELDS) out[f] = (c as any)[f];
  out.created_at = c.created_at;
  out.updated_at = c.updated_at;
  const isMember = await viewerIsMember(env, c.id, viewer);
  // D431 — economics are the member's and the editors'. `canEdit` is the rule
  // that already decides who may WRITE carry; the same rule decides who may
  // read it, so a reader who could not change a figure is never shown it.
  const editor = await canEdit(env, c, viewer);
  const links = await env.DB.prepare('SELECT * FROM user_company_links WHERE company_id = ?')
    .bind(c.id).all<Link>();
  const members: any[] = [];
  for (const lnk of links.results || []) {
    const u = await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?')
      .bind(lnk.user_id).first<{ id: number; name: string; email: string }>();
    if (!u) continue;
    members.push({
      user_id: u.id, name: u.name,
      email: isMember ? u.email : maskEmail(u.email),
      role_in_company: lnk.role_in_company,
      is_primary_admin: !!lnk.is_primary_admin,
      // Migration 191 — three independent axes. Null means NOT RECORDED, not
      // "none": a member added before 191 has no title, and showing them as an
      // Analyst on VIEW would be inventing a fact about a real person.
      title: (lnk as any).title ?? null,
      authority: (lnk as any).authority ?? null,
      // D431 — carry is served to its holder and to an editor, and to nobody
      // else: the FIELD is absent for a refused reader, not null, because null
      // already means "not recorded" and a reader must not confuse "withheld"
      // with "none". Canvas T4: economics are locked when the viewer is
      // neither the member nor a partner, "visible as a locked section,
      // because a hidden one teaches people the wrong shape of the org".
      ...(editor || lnk.user_id === viewer.id
        ? { carry_bps: (lnk as any).carry_bps ?? null }
        : {}),
      joined_at: lnk.created_at,
    });
  }
  out.members = members;
  out.member_count = members.length;
  out.viewer_is_member = isMember;
  return out;
}

async function getCompanyOr404(env: Env, uid: string): Promise<Company | null> {
  return env.DB.prepare('SELECT * FROM company_profiles WHERE uid = ?').bind(uid).first<Company>();
}

async function getLink(env: Env, companyId: number, userId: number): Promise<Link | null> {
  return env.DB.prepare('SELECT * FROM user_company_links WHERE company_id = ? AND user_id = ?')
    .bind(companyId, userId).first<Link>();
}

async function canEdit(env: Env, c: Company, user: User): Promise<boolean> {
  if (isAdmin(user)) return true;
  const link = await getLink(env, c.id, user.id);
  if (!link) return false;
  return !!link.is_primary_admin || ['Owner', 'Admin', 'Founder'].includes(link.role_in_company);
}

// /company/me
r.get('/company/me', async (c) => {
  try {
    const user = await requireAuth(c);
    const link = await c.env.DB.prepare(
      `SELECT * FROM user_company_links WHERE user_id = ?
       ORDER BY is_primary_admin DESC, created_at ASC LIMIT 1`
    ).bind(user.id).first<Link>();
    if (!link) return c.json(null);
    const company = await c.env.DB.prepare('SELECT * FROM company_profiles WHERE id = ?')
      .bind(link.company_id).first<Company>();
    if (!company) return c.json(null);
    const detail = await detailDto(c.env, company, user);
    return c.json({ ...detail, my_role: link.role_in_company, is_primary_admin: !!link.is_primary_admin });
  } catch (e) { return mapError(c, e); }
});

// /company/memberships — every company the caller belongs to.
//
// MUST stay above `/company/:uid`: Hono matches in declaration order, so
// registering it later would let the param route claim uid="memberships" and
// answer 404 instead. Same reason `/company/me` sits above it.
//
// `/company/me` answers with the single primary company; the sidebar's company
// switcher needs the whole list, in the same order `/company/me` picks its
// winner from (primary admin first, then oldest link), so `list[0]` is the same
// company `/company/me` would have returned.
// /company/team-vocabulary — the ladder, the functions and what each authority
// level MEANS, so a picker never has to hardcode them.
//
// Registered here for the same reason /company/memberships is: it must come
// before `/company/:uid`, or the param route claims uid="team-vocabulary".
// scripts/check-route-ordering enforces that; this comment is why.
r.get('/company/team-vocabulary', async (c) => {
  try {
    await requireAuth(c);
    return c.json(teamVocabulary());
  } catch (e) { return mapError(c, e); }
});

r.get('/company/memberships', async (c) => {
  try {
    const user = await requireAuth(c);
    const links = await c.env.DB.prepare(
      `SELECT * FROM user_company_links WHERE user_id = ?
       ORDER BY is_primary_admin DESC, created_at ASC`
    ).bind(user.id).all<Link>();
    const out: any[] = [];
    // One entry per COMPANY, not per link. This loop returned a row per link,
    // and nothing stopped two links naming the same pair: `user_company_links`
    // shipped with only `idx_uclink_user` (a plain index on user_id), so the
    // same company could appear twice in the switcher — the one control whose
    // whole job is to say unambiguously which company you are looking at.
    // Migration 192 dedupes the table and adds the unique index; this guard
    // stays because a client rendering duplicates is the visible failure and
    // it should not depend on the index having been applied yet.
    const seen = new Set<number>();
    for (const link of links.results || []) {
      if (seen.has(link.company_id)) continue;
      seen.add(link.company_id);
      const company = await c.env.DB.prepare('SELECT * FROM company_profiles WHERE id = ?')
        .bind(link.company_id).first<Company>();
      // A link whose company row is gone is skipped rather than surfaced as a
      // null entry — the switcher renders straight from this array.
      if (!company) continue;
      out.push({
        ...(await detailDto(c.env, company, user)),
        my_role: link.role_in_company,
        is_primary_admin: !!link.is_primary_admin,
      });
    }
    return c.json(out);
  } catch (e) { return mapError(c, e); }
});

// /company/create
r.post('/company/create', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const name = String(body.company_name || '').trim();
    if (!name) return c.json({ detail: 'company_name required' }, 400);
    const stored = name.slice(0, 200);
    // Refuse a name this caller already holds.
    //
    // `company_profiles.company_name` is not unique and never should be —
    // two unrelated founders may both run a "Northwind". What must not happen
    // is ONE user ending up with two of them, which is what a double submit
    // (retry, second tab, flaky network) produced: two company_profiles rows
    // and two links, rendering as two identical entries in the switcher with
    // different ids. Only one of them holds anything, because migration 189
    // backfilled projects through the PRIMARY link, so selecting the other
    // shows an empty workspace that reads as data loss.
    //
    // 409 rather than returning the existing row: silently handing back a
    // different company than the one the caller asked to create is the kind
    // of "helpful" that hides a bug. The switcher surfaces `detail` verbatim,
    // so the user reads why nothing was created.
    //
    // Compared case-insensitively on the trimmed, truncated value — the same
    // string that would be stored. SQLite's `lower()` is ASCII-only, so this
    // catches "Acme"/"acme" and not "STRASSE"/"straße"; the narrow form is
    // preferred over a fabricated collation.
    const clash = await c.env.DB.prepare(
      `SELECT cp.company_name
         FROM company_profiles cp
         JOIN user_company_links ucl ON ucl.company_id = cp.id
        WHERE ucl.user_id = ?
          AND lower(trim(cp.company_name)) = lower(trim(?))
        LIMIT 1`
    ).bind(user.id, stored).first<{ company_name: string }>();
    if (clash) {
      return c.json({ detail: `You already have a company called "${clash.company_name}".` }, 409);
    }
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO company_profiles
         (uid, company_name, stage, revenue_range, employee_count, current_products,
          international_presence, expansion_goals, logo_url, website, linkedin_url, description,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, stored,
           body.stage || null, body.revenue_range || null,
           body.employee_count != null ? Number(body.employee_count) : null,
           body.current_products || null, body.international_presence || null,
           body.expansion_goals || null,
           body.logo_url || null, body.website || null, body.linkedin_url || null,
           body.description || null, nowIso(), nowIso()).run();
    const newId = (ins as any).meta?.last_row_id as number;
    await c.env.DB.prepare(
      `INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at)
       VALUES (?, ?, ?, 'Admin', 1, ?)`
    ).bind(newUid(), newId, user.id, nowIso()).run();
    const company = await c.env.DB.prepare('SELECT * FROM company_profiles WHERE id = ?').bind(newId).first<Company>();
    return c.json(await detailDto(c.env, company!, user));
  } catch (e) { return mapError(c, e); }
});

// /company/:uid (PATCH update / GET detail-or-summary)
r.patch('/company/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    if (!(await canEdit(c.env, company, user))) {
      return c.json({ detail: 'Not authorized to edit this company' }, 403);
    }
    const body = await c.req.json().catch(() => ({} as any));
    const updatable = ['company_name', 'stage', 'revenue_range', 'employee_count',
      'current_products', 'international_presence', 'expansion_goals',
      'logo_url', 'website', 'linkedin_url', 'description'] as const;
    const sets: string[] = []; const params: any[] = [];
    for (const f of updatable) {
      if (body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
    }
    if (sets.length) {
      sets.push('updated_at = ?'); params.push(nowIso()); params.push(company.id);
      await c.env.DB.prepare(`UPDATE company_profiles SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM company_profiles WHERE id = ?').bind(company.id).first<Company>();
    return c.json(await detailDto(c.env, fresh!, user));
  } catch (e) { return mapError(c, e); }
});

r.get('/company/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    // Companies are private workspaces: only members (and platform admins)
    // may read the profile. A non-member gets 404 rather than a summary so
    // the directory does not confirm a company exists.
    if (!(await viewerIsMember(c.env, company.id, user))) {
      return c.json({ detail: 'Company not found' }, 404);
    }
    return c.json(await detailDto(c.env, company, user));
  } catch (e) { return mapError(c, e); }
});

// /companies (list)
//
// Companies are private workspaces. The directory is not a public catalogue:
// non-admin callers see only the companies they are members of, so a company
// one user creates is not visible to another user's search. Admins keep the
// full list for support and moderation.
r.get('/companies', async (c) => {
  try {
    const user = await requireAuth(c);
    const stage = c.req.query('stage');
    const revenue = c.req.query('revenue_range');
    const q = (c.req.query('q') || '').trim().toLowerCase();
    const limit = clampLimit(c.req.query('limit'), 50, 200);
    const offset = parseOffset(c.req.query('offset'));
    let where = '1=1';
    const params: any[] = [];
    if (stage) { where += ' AND stage = ?'; params.push(stage); }
    if (revenue) {
      if (!isAdmin(user)) {
        return c.json({ detail: 'Filtering by revenue_range is restricted to administrators' }, 403);
      }
      where += ' AND revenue_range = ?'; params.push(revenue);
    }
    if (!isAdmin(user)) {
      where += ' AND id IN (SELECT company_id FROM user_company_links WHERE user_id = ?)';
      params.push(user.id);
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM company_profiles WHERE ${where} ORDER BY created_at DESC`
    ).bind(...params).all<Company>();
    let list = (rows.results || []) as Company[];
    if (q) {
      list = list.filter((r) =>
        (r.company_name || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q));
    }
    const total = list.length;
    const slice = list.slice(offset, offset + limit);
    const items: any[] = [];
    for (const r of slice) items.push(await summaryDto(c.env, r));
    return c.json({ total, limit, offset, items });
  } catch (e) { return mapError(c, e); }
});

// Members
//
// POST /company/:uid/members IS GONE (D434). It joined an EXISTING account to
// the company on an editor's say-so — no invitation, no consent, and a 404
// for anyone who had never signed up. Task #121 built the invitation the
// invitee accepts (POST /company/:uid/invitations and the accept below); the
// one page that still called the direct add (CompanyProfilePanel's "Add team
// member") now points at Company Settings, so nothing in the tree called this
// route and it is retired on D304's rule with its client method. Role change
// and removal below are unchanged.

// Wave 2 — change a member's role, or move primary-admin status.
//
// The canvas's Members & access zone asks for role change; only add and remove
// existed, so the UI had no way to promote someone without removing and
// re-adding them (which loses joined_at). Guards mirror POST exactly:
//   • canEdit gates the whole route
//   • only a primary admin (or a platform admin) may grant primary-admin
//   • the LAST primary admin cannot be demoted — same invariant DELETE
//     enforces, and for the same reason: a company with no primary admin has
//     nobody who can appoint one
r.patch('/company/:uid/members/:userId', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    if (!(await canEdit(c.env, company, user))) return c.json({ detail: 'Not authorized to manage members' }, 403);
    const userId = Number(c.req.param('userId'));
    const link = await getLink(c.env, company.id, userId);
    if (!link) return c.json({ detail: 'Member not found on this company' }, 404);
    const body = await c.req.json().catch(() => ({} as any));

    const sets: string[] = [];
    const params: any[] = [];

    if (body.role_in_company !== undefined) {
      if (typeof body.role_in_company !== 'string' || !body.role_in_company.trim()) {
        return c.json({ detail: 'role_in_company must be a non-empty string' }, 400);
      }
      sets.push('role_in_company = ?');
      params.push(body.role_in_company.trim().slice(0, 80));
    }

    if (body.is_primary_admin !== undefined) {
      const next = body.is_primary_admin ? 1 : 0;
      if (next && !isAdmin(user)) {
        const my = await getLink(c.env, company.id, user.id);
        if (!(my && my.is_primary_admin)) {
          return c.json({ detail: 'Only the primary admin can grant primary admin status' }, 403);
        }
      }
      if (!next && link.is_primary_admin) {
        const cnt = await c.env.DB.prepare(
          'SELECT COUNT(*) c FROM user_company_links WHERE company_id = ? AND is_primary_admin = 1',
        ).bind(company.id).first<{ c: number }>();
        if (Number(cnt?.c || 0) <= 1) {
          return c.json({ detail: 'Cannot demote the only primary admin — appoint another first' }, 400);
        }
      }
      sets.push('is_primary_admin = ?');
      params.push(next);
    }

    // Migration 191 — title, authority and carry are INDEPENDENT. Setting one
    // never sets another: authorityForTitle() exists to pre-fill a picker, and
    // is deliberately not called here. Deriving authority from title would let
    // a rename grant or revoke power silently.
    if (body.title !== undefined) {
      if (body.title === null) { sets.push('title = ?'); params.push(null); }
      else if (!isTitle(body.title)) {
        return c.json({ detail: 'title must be a ladder rung or a named function' }, 400);
      } else { sets.push('title = ?'); params.push(body.title); }
    }

    if (body.authority !== undefined) {
      if (body.authority === null) { sets.push('authority = ?'); params.push(null); }
      else if (!isAuthority(body.authority)) {
        return c.json({ detail: 'authority must be VIEW, WORK, FLAG, SPONSOR or VOTE' }, 400);
      } else { sets.push('authority = ?'); params.push(body.authority); }
    }

    if (body.carry_bps !== undefined) {
      const bps = normalizeCarryBps(body.carry_bps);
      if (bps === undefined) {
        return c.json({ detail: 'carry_bps must be a whole number of basis points, 0–10000' }, 400);
      }
      sets.push('carry_bps = ?');
      params.push(bps);
    }

    if (!sets.length) return c.json({ detail: 'Nothing to update' }, 400);
    params.push(link.id);
    await c.env.DB.prepare(`UPDATE user_company_links SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params).run();
    return c.json(await detailDto(c.env, company, user));
  } catch (e) { return mapError(c, e); }
});

r.delete('/company/:uid/members/:userId', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    if (!(await canEdit(c.env, company, user))) return c.json({ detail: 'Not authorized to manage members' }, 403);
    const userId = Number(c.req.param('userId'));
    const link = await getLink(c.env, company.id, userId);
    if (!link) return c.json({ detail: 'Member not found on this company' }, 404);
    if (link.is_primary_admin) {
      const cnt = await c.env.DB.prepare(
        'SELECT COUNT(*) c FROM user_company_links WHERE company_id = ? AND is_primary_admin = 1'
      ).bind(company.id).first<{ c: number }>();
      if (Number(cnt?.c || 0) <= 1) {
        return c.json({ detail: 'Cannot remove the only primary admin — assign another first' }, 400);
      }
    }
    await c.env.DB.prepare('DELETE FROM user_company_links WHERE id = ?').bind(link.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// Task #1 (AG) — spec-contract alias. Frontend calls PATCH /api/company/me;
// resolve `me` to the caller's primary company via user_company_links (same
// pattern as GET /company/me) and delegate to the canonical /:uid handler.
r.patch('/company/me', async (c) => {
  try {
    const user = await requireAuth(c);
    const link = await c.env.DB.prepare(
      `SELECT company_id FROM user_company_links WHERE user_id = ?
         ORDER BY is_primary_admin DESC, created_at ASC LIMIT 1`,
    ).bind(user.id).first<{ company_id: number }>();
    if (!link) return c.json({ detail: 'Company not found for current user' }, 404);
    const company = await c.env.DB.prepare('SELECT uid FROM company_profiles WHERE id = ?')
      .bind(link.company_id).first<{ uid: string }>();
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    const body = await c.req.text();
    const url = new URL(c.req.url);
    url.pathname = `/api/company/${company.uid}`;
    const proxied = new Request(url, { method: 'PATCH', headers: c.req.raw.headers, body });
    return await r.fetch(proxied, c.env, c.executionCtx);
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Invitations — Task #121, and the comment this replaces was the bug report.
//
// `CompanySettingsPage` said it in its own docblock: "Invite by email is not an
// invite. The backend resolves the address to an EXISTING user and 404s
// otherwise — there is no invitation record and no email is sent." Writing
// that down was right; leaving it true was not. Two people could not be
// reached at all by the control that claimed to reach them: anyone who has not
// signed up, and anyone whose address is not the one on their account. And a
// registered user was LINKED to a company without ever being asked.
//
// So there is an invitation now: a row, a hashed token, an email, and an
// accept step that the invitee takes. `POST /company/:uid/members` is
// deliberately left alone — it is the direct add an admin performs on someone
// who has already agreed, and removing it would break the admin console that
// uses it. What changed is that the settings page no longer calls it.
//
// THE SHAPE IS `project_member_invitations`, ON PURPOSE. That table already
// solved token hashing, expiry, revoke and the accept binding in this codebase;
// a second invitation flow inventing its own vocabulary would make two things
// that behave alike read differently. Where this one differs it is because a
// company invitation is always addressed to an email (there is no bare share
// link) and carries the three axes migration 191 separated.
// ---------------------------------------------------------------------------

/** Trim + lower-case, so the unique index and the accept-time match agree. */
function normEmail(v: unknown): string {
  return String(v || '').trim().toLowerCase();
}
// Deliberately loose: the mailer is the real check, and a regex that rejects a
// deliverable address is worse than one that accepts an undeliverable one.
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

/**
 * The role, clamped the way `PATCH /company/:uid/members/:userId` clamps it.
 * Accepting writes this straight into `user_company_links`, so an invitation
 * that stored a longer one would seat a member with a role the edit control
 * can never reproduce.
 */
function roleFrom(v: unknown): string {
  const s = String(v ?? '').trim().slice(0, 80);
  return s || 'Member';
}

/** What a caller may see. The token is NOT in here — it is shown once, at creation. */
function invitationDto(row: any): any {
  return {
    uid: row.uid,
    email: row.email,
    role_in_company: row.role_in_company,
    title: row.title ?? null,
    authority: row.authority ?? null,
    status: row.status,
    // Whether the message actually left. An invitation nobody was told about
    // is a different thing from one that is merely unanswered, and the page
    // draws them differently.
    email_sent: !!row.email_sent,
    invited_by: row.invited_by_name || null,
    created_at: row.created_at,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at ?? null,
  };
}

async function listInvitations(env: Env, companyId: number): Promise<any[]> {
  const rows = await env.DB.prepare(
    `SELECT ci.*, u.name AS invited_by_name
       FROM company_invitations ci
       LEFT JOIN users u ON u.id = ci.invited_by_user_id
      WHERE ci.company_id = ?
      ORDER BY ci.created_at DESC`,
  ).bind(companyId).all<any>();
  return (rows.results || []).map(invitationDto);
}

/**
 * Mint a token, store only its hash, and try to send the mail.
 *
 * Returns the raw token so the caller can put it in a link ONCE. Nothing
 * persists it, so a lost invitation is resent (a new token) rather than
 * recovered — which is the property that makes the stored hash worth having.
 */
async function issueInvitationEmail(
  env: Env, company: Company, inviter: User, email: string, token: string,
): Promise<boolean> {
  const base = String((env as any).PUBLIC_BASE_URL || (env as any).APP_URL || 'https://axal.vc').replace(/\/+$/, '');
  const link = `${base}/company/invitations/accept?token=${encodeURIComponent(token)}`;
  try {
    const { sendCompanyInvitationEmail } = await import('../services/email');
    return await sendCompanyInvitationEmail(env, email, company.company_name, inviter.name || 'A teammate', link);
  } catch (e) {
    console.warn('[company] invitation email failed', { company_id: company.id }, e);
    return false;
  }
}

// POST /company/:uid/invitations — invite by email, whether or not they have
// an account. This is what the settings page calls now.
r.post('/company/:uid/invitations', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    if (!(await canEdit(c.env, company, user))) return c.json({ detail: 'Not authorized to manage members' }, 403);

    const body = await c.req.json().catch(() => ({} as any));
    const email = normEmail(body.email);
    if (!looksLikeEmail(email)) return c.json({ detail: 'A valid email address is required' }, 400);

    // Already a member? Say so rather than sending an invitation that would
    // 409 on accept — the reader's next move is different in each case.
    const existing = await c.env.DB.prepare(
      `SELECT ucl.id FROM user_company_links ucl
         JOIN users u ON u.id = ucl.user_id
        WHERE ucl.company_id = ? AND lower(u.email) = ?`,
    ).bind(company.id, email).first();
    if (existing) return c.json({ detail: 'That person is already a member of this company' }, 409);

    const title = body.title && isTitle(String(body.title)) ? String(body.title) : null;
    const authority = body.authority && isAuthority(String(body.authority)) ? String(body.authority) : null;

    const token = generateToken();
    const tokenHash = await hashInviteToken(token);
    try {
      await c.env.DB.prepare(
        `INSERT INTO company_invitations
           (uid, company_id, email, role_in_company, title, authority, token_hash,
            status, invited_by_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', '+14 days'))`,
      ).bind(newUid(), company.id, email, roleFrom(body.role_in_company),
             title, authority, tokenHash, user.id).run();
    } catch (e) {
      // The partial unique index, not a lost race to check first. Resending is
      // the right answer to "there is already one pending", and the caller is
      // told which so the page can offer it.
      if (String((e as Error)?.message || '').includes('UNIQUE')) {
        return c.json({ detail: 'An invitation to that address is already pending', code: 'already_pending' }, 409);
      }
      throw e;
    }

    const sent = await issueInvitationEmail(c.env, company, user, email, token);
    if (sent) {
      await c.env.DB.prepare(
        `UPDATE company_invitations SET email_sent = 1, updated_at = datetime('now') WHERE token_hash = ?`,
      ).bind(tokenHash).run();
    }
    return c.json({
      ok: true,
      email_sent: sent,
      // Shown once. With no mailer configured this is the only way the
      // inviter can pass the invitation on, so the page renders it rather
      // than reporting a success nobody can act on.
      accept_path: `/company/invitations/accept?token=${encodeURIComponent(token)}`,
      invitations: await listInvitations(c.env, company.id),
      company: await detailDto(c.env, company, user),
    });
  } catch (e) { return mapError(c, e); }
});

// GET /company/:uid/invitations — the pending list the settings page draws.
r.get('/company/:uid/invitations', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    // An invitation names a person's email address, so reading the list is
    // gated on the same right as managing one — not on mere membership.
    if (!(await canEdit(c.env, company, user))) return c.json({ detail: 'Not authorized to manage members' }, 403);
    return c.json({ invitations: await listInvitations(c.env, company.id) });
  } catch (e) { return mapError(c, e); }
});

// POST /company/:uid/invitations/:inviteUid/resend — a NEW token, not the old
// one. Nothing stored can reproduce the original, and re-sending a link the
// server cannot recompute would be a button that does nothing.
r.post('/company/:uid/invitations/:inviteUid/resend', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    if (!(await canEdit(c.env, company, user))) return c.json({ detail: 'Not authorized to manage members' }, 403);
    const inv = await c.env.DB.prepare(
      `SELECT * FROM company_invitations WHERE uid = ? AND company_id = ?`,
    ).bind(c.req.param('inviteUid'), company.id).first<any>();
    if (!inv) return c.json({ detail: 'Invitation not found' }, 404);
    if (inv.status !== 'pending') {
      return c.json({ detail: 'That invitation is no longer pending', code: inv.status }, 409);
    }
    const token = generateToken();
    const tokenHash = await hashInviteToken(token);
    // The clock restarts with the token: the old link stops working the moment
    // this row's hash changes, so leaving the old expiry would shorten an
    // invitation that was just re-sent.
    await c.env.DB.prepare(
      `UPDATE company_invitations
          SET token_hash = ?, email_sent = 0, expires_at = datetime('now', '+14 days'),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(tokenHash, inv.id).run();
    const sent = await issueInvitationEmail(c.env, company, user, inv.email, token);
    if (sent) {
      await c.env.DB.prepare(
        `UPDATE company_invitations SET email_sent = 1, updated_at = datetime('now') WHERE id = ?`,
      ).bind(inv.id).run();
    }
    return c.json({
      ok: true,
      email_sent: sent,
      accept_path: `/company/invitations/accept?token=${encodeURIComponent(token)}`,
      invitations: await listInvitations(c.env, company.id),
    });
  } catch (e) { return mapError(c, e); }
});

// DELETE /company/:uid/invitations/:inviteUid — revoke. The row stays so the
// address can be invited again later and the history of who asked whom
// survives; only the status and the clock change.
r.delete('/company/:uid/invitations/:inviteUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const company = await getCompanyOr404(c.env, c.req.param('uid'));
    if (!company) return c.json({ detail: 'Company not found' }, 404);
    if (!(await canEdit(c.env, company, user))) return c.json({ detail: 'Not authorized to manage members' }, 403);
    const res = await c.env.DB.prepare(
      `UPDATE company_invitations
          SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now')
        WHERE uid = ? AND company_id = ? AND status = 'pending'`,
    ).bind(c.req.param('inviteUid'), company.id).run();
    if (!res.meta.changes) return c.json({ detail: 'No pending invitation with that id' }, 404);
    return c.json({ ok: true, invitations: await listInvitations(c.env, company.id) });
  } catch (e) { return mapError(c, e); }
});

// POST /company/invitations/accept — the invitee's own act.
//
// It cannot collide with `/company/:uid/invitations` despite the equal segment
// count: that pattern requires the THIRD segment to be the literal
// `invitations`, and here the third is `accept`. No ordering dependency.
r.post('/company/invitations/accept', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const token = String(body.token || '').trim();
    if (!token) return c.json({ detail: 'token is required' }, 400);
    const inv = await c.env.DB.prepare(
      `SELECT * FROM company_invitations WHERE token_hash = ?`,
    ).bind(await hashInviteToken(token)).first<any>();
    if (!inv) return c.json({ detail: 'Invitation not found' }, 404);
    if (inv.status !== 'pending') {
      return c.json({ detail: 'This invitation is no longer valid', code: inv.status }, 410);
    }
    // Expiry is checked in SQL so both sides are the same `datetime()` format,
    // and stamped when found so the list stops calling it pending.
    const exp = await c.env.DB.prepare(
      `SELECT CASE WHEN datetime(expires_at) < datetime('now') THEN 1 ELSE 0 END AS expired
         FROM company_invitations WHERE id = ?`,
    ).bind(inv.id).first<{ expired: number }>();
    if (Number(exp?.expired) === 1) {
      await c.env.DB.prepare(
        `UPDATE company_invitations SET status = 'expired', updated_at = datetime('now') WHERE id = ?`,
      ).bind(inv.id).run();
      return c.json({ detail: 'This invitation has expired', code: 'expired' }, 410);
    }
    // THE BINDING. An invitation is addressed to an address, and the account
    // accepting it must be that address — otherwise a forwarded link would
    // join the forwarder to a company they were never invited to.
    if (normEmail(user.email) !== normEmail(inv.email)) {
      return c.json({
        detail: 'This invitation was sent to a different email address',
        code: 'wrong_account',
        invited_email: inv.email,
      }, 403);
    }
    const company = await c.env.DB.prepare(
      'SELECT * FROM company_profiles WHERE id = ?',
    ).bind(inv.company_id).first<Company>();
    if (!company) return c.json({ detail: 'That company no longer exists' }, 404);

    const already = await getLink(c.env, company.id, user.id);
    if (!already) {
      await c.env.DB.prepare(
        `INSERT INTO user_company_links
           (uid, company_id, user_id, role_in_company, is_primary_admin, title, authority, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      ).bind(newUid(), company.id, user.id, inv.role_in_company,
             inv.title, inv.authority, nowIso()).run();
    }
    // An invitation accepted by someone who was added directly in the meantime
    // is still accepted — the outcome it asked for is the outcome that holds.
    await c.env.DB.prepare(
      `UPDATE company_invitations
          SET status = 'accepted', accepted_by_user_id = ?, accepted_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(user.id, inv.id).run();
    return c.json({
      ok: true,
      company_uid: company.uid,
      company_name: company.company_name,
      role_in_company: inv.role_in_company,
      already_member: !!already,
    });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// D435 — the founder's Team page: roster, coverage and headcount plan
// (migration 326). Read by every member; written by an editor (`canEdit`, the
// same rule that decides who may change the membership list). Economics —
// `salary_cents`, `compensation_note` — follow D431: present for an editor and
// for the person the row is linked to, ABSENT for everyone else.
//
// THE READS THIS PAGE COMPOSES FROM OTHER STORES are attempted here and
// reported per source, never masked: `cap_table_holders` (migration 020) is
// keyed by project, so the company's holders are those of the projects that
// name this company, matched to a person by email; `cap_table_option_pools`
// (migration 057) is keyed by the member who imported it from Carta, so the
// pool shown is a member's import and the page says so; the co-founder
// decision is `projects.cofounder_decision_meta` (migration 162), read from
// the newest project of this company that recorded one. A source that cannot
// be read answers `{ available: false, reason }`, which the page prints as
// Unreadable rather than as an empty section.
// ---------------------------------------------------------------------------

async function teamCompanyOr404(c: any): Promise<{ user: User; company: Company; editor: boolean } | Response> {
  const user = await requireAuth(c);
  const company = await getCompanyOr404(c.env, c.req.param('uid'));
  if (!company) return c.json({ detail: 'Company not found' }, 404);
  if (!(await viewerIsMember(c.env, company.id, user))) {
    return refuse(c, 403, { code: 'not_a_member', message: 'Only members of this company can read its team.', raw: null });
  }
  return { user, company, editor: await canEdit(c.env, company, user) };
}

function teamWriteGate(c: any, ctx: { editor: boolean }): Response | null {
  if (ctx.editor) return null;
  return refuse(c, 403, {
    code: 'not_an_editor',
    message: 'Only an Owner, Admin, Founder or the primary admin can change the team record.',
    raw: null,
  });
}

r.get('/company/:uid/team', async (c) => {
  try {
    const ctx = await teamCompanyOr404(c);
    if (ctx instanceof Response) return ctx;
    const { user, company, editor } = ctx;

    const people = await c.env.DB.prepare(
      `SELECT * FROM company_people WHERE company_id = ?
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'offer_out' THEN 1 ELSE 2 END, start_date, id`,
    ).bind(company.id).all<any>();
    const rows = (people.results || []).map((p) => personDto(p, editor || Number(p.user_id) === user.id));

    // The company's projects, then their cap-table holders. The join is by
    // project because that is how migration 020 keyed the import; a company
    // with several projects has several cap tables here, and which one is
    // the company's is an owner decision the page names (D435).
    let capTable: any;
    try {
      const projects = await c.env.DB.prepare(
        'SELECT id, name FROM projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
      ).bind(company.id).all<{ id: number; name: string }>();
      const projRows = projects.results || [];
      let holders: any[] = [];
      if (projRows.length) {
        const h = await c.env.DB.prepare(
          `SELECT h.project_id, h.name, h.email, h.security_type, h.shares, h.ownership_pct, h.source, h.updated_at
             FROM cap_table_holders h
             JOIN projects p ON p.id = h.project_id
            WHERE p.company_id = ? AND p.deleted_at IS NULL`,
        ).bind(company.id).all<any>();
        holders = (h.results || []).map((x) => ({
          project_id: x.project_id,
          name: x.name,
          email: x.email ? String(x.email).toLowerCase() : null,
          security_type: x.security_type ?? null,
          shares: x.shares == null ? null : Number(x.shares),
          ownership_pct: x.ownership_pct == null ? null : Number(x.ownership_pct),
          source: x.source,
          as_of: x.updated_at,
        }));
      }
      capTable = { available: true, projects: projRows, holders };
    } catch (e) {
      capTable = { available: false, reason: 'The cap table could not be read just now.', projects: [], holders: [] };
      console.error('[company/team] cap_table read failed', String((e as any)?.message || e).slice(0, 200));
    }

    // Option pools: a member's Carta import (migration 057, keyed by user).
    let pool: any;
    try {
      const p = await c.env.DB.prepare(
        `SELECT o.id, o.user_id, o.name, o.shares_authorized, o.shares_issued, o.shares_available, o.source, o.updated_at
           FROM cap_table_option_pools o
           JOIN user_company_links ucl ON ucl.user_id = o.user_id
          WHERE ucl.company_id = ? ORDER BY o.name`,
      ).bind(company.id).all<any>();
      const poolRows: any[] = (p.results || []).map((x) => ({
        id: x.id,
        imported_by_user_id: x.user_id,
        name: x.name,
        shares_authorized: x.shares_authorized == null ? null : Number(x.shares_authorized),
        shares_issued: x.shares_issued == null ? null : Number(x.shares_issued),
        shares_available: x.shares_available == null ? null : Number(x.shares_available),
        source: x.source,
        as_of: x.updated_at,
      }));
      pool = { available: true, rows: poolRows };
    } catch (e) {
      pool = { available: false, reason: 'The option pool could not be read just now.', rows: [] };
      console.error('[company/team] option_pool read failed', String((e as any)?.message || e).slice(0, 200));
    }

    const coverage = await c.env.DB.prepare(
      'SELECT uid, function_name, state, owner_note, fix_note, updated_by, updated_at FROM company_function_coverage WHERE company_id = ? ORDER BY id',
    ).bind(company.id).all<any>();
    const plan = await c.env.DB.prepare(
      'SELECT uid, period_label, target_headcount, note, updated_by, updated_at FROM company_headcount_plan WHERE company_id = ? ORDER BY id',
    ).bind(company.id).all<any>();

    // The co-founder decision (migration 162): the newest project of this
    // company that recorded one. The blob is returned parsed; the page reads
    // its `outcome`, `note` and `decided_at` with the same model the Match
    // page writes (lib/cofounderMatchViewModel.js).
    let cofounder: any;
    try {
      const row = await c.env.DB.prepare(
        `SELECT id, name, cofounder_decision_meta FROM projects
          WHERE company_id = ? AND deleted_at IS NULL AND cofounder_decision_meta IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
      ).bind(company.id).first<{ id: number; name: string; cofounder_decision_meta: string }>();
      if (!row) cofounder = { available: false, reason: 'No project of this company has recorded a co-founder decision.' };
      else {
        let meta: any = null;
        try { meta = JSON.parse(row.cofounder_decision_meta); } catch { meta = null; }
        cofounder = { available: true, project_id: row.id, project_name: row.name, meta };
      }
    } catch (e) {
      cofounder = { available: false, reason: 'The co-founder decision could not be read just now.' };
      console.error('[company/team] cofounder read failed', String((e as any)?.message || e).slice(0, 200));
    }

    return c.json({
      company: { id: company.id, uid: company.uid, company_name: company.company_name, stage: company.stage, created_at: company.created_at },
      viewer: { editor, user_id: user.id },
      people: rows,
      coverage: coverage.results || [],
      plan: plan.results || [],
      cap_table: capTable,
      pool,
      cofounder,
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/company/:uid/team/people', async (c) => {
  try {
    const ctx = await teamCompanyOr404(c);
    if (ctx instanceof Response) return ctx;
    const gate = teamWriteGate(c, ctx);
    if (gate) return gate;
    const { user, company } = ctx;
    const body = await c.req.json().catch(() => ({}));
    const v = validatePerson(body, true);
    if (v.error || !v.value) return refuse(c, 400, { code: 'invalid_person', message: v.error || 'Invalid person', raw: null });
    const p = v.value;
    // A row may name an account: matched by email to a member of THIS company
    // only, never to an arbitrary account — the roster must not become a way
    // to look up who holds which email on the platform.
    let userId: number | null = null;
    if (p.email) {
      const m = await c.env.DB.prepare(
        `SELECT u.id FROM users u JOIN user_company_links ucl ON ucl.user_id = u.id
          WHERE ucl.company_id = ? AND lower(u.email) = ?`,
      ).bind(company.id, String(p.email)).first<{ id: number }>();
      userId = m?.id ?? null;
    }
    const uid = newUid();
    const f = (k: string) => (p[k] === undefined ? null : p[k]);
    await c.env.DB.prepare(
      `INSERT INTO company_people
         (uid, company_id, user_id, name, email, person_type, role_title, start_date, access_level, status,
          salary_cents, compensation_note, equity_shares, equity_kind, vest_start_date, cliff_months, vest_months,
          agreement_status, ip_assignment, election_83b, advisor_focus, advisor_cadence, note,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, company.id, userId, p.name, f('email'), p.person_type, f('role_title'), f('start_date'), f('access_level'), p.status,
           f('salary_cents'), f('compensation_note'), f('equity_shares'), f('equity_kind'), f('vest_start_date'), f('cliff_months'), f('vest_months'),
           f('agreement_status'), f('ip_assignment'), f('election_83b'), f('advisor_focus'), f('advisor_cadence'), f('note'),
           user.id, user.id, nowIso(), nowIso()).run();
    const row = await c.env.DB.prepare('SELECT * FROM company_people WHERE uid = ?').bind(uid).first<any>();
    return c.json(personDto(row, true), 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/company/:uid/team/people/:pid', async (c) => {
  try {
    const ctx = await teamCompanyOr404(c);
    if (ctx instanceof Response) return ctx;
    const gate = teamWriteGate(c, ctx);
    if (gate) return gate;
    const { user, company } = ctx;
    const existing = await c.env.DB.prepare(
      'SELECT * FROM company_people WHERE company_id = ? AND uid = ?',
    ).bind(company.id, c.req.param('pid')).first<any>();
    if (!existing) return c.json({ detail: 'Person not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const v = validatePerson(body, false);
    if (v.error || !v.value) return refuse(c, 400, { code: 'invalid_person', message: v.error || 'Invalid person', raw: null });
    const sets: string[] = []; const params: any[] = [];
    for (const [k, val] of Object.entries(v.value)) { sets.push(`${k} = ?`); params.push(val); }
    // Offboarding is a status with a date, never a delete: the record of who
    // was on the team, and on what terms, is what a later diligence reads.
    if (v.value.status === 'offboarded' && existing.status !== 'offboarded') {
      sets.push('offboarded_at = ?'); params.push(nowIso());
    } else if (v.value.status && v.value.status !== 'offboarded' && existing.status === 'offboarded') {
      sets.push('offboarded_at = ?'); params.push(null);
    }
    if (!sets.length) return c.json(personDto(existing, true));
    sets.push('updated_by = ?'); params.push(user.id);
    sets.push('updated_at = ?'); params.push(nowIso());
    params.push(existing.id);
    await c.env.DB.prepare(`UPDATE company_people SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    const row = await c.env.DB.prepare('SELECT * FROM company_people WHERE id = ?').bind(existing.id).first<any>();
    return c.json(personDto(row, true));
  } catch (e) { return mapError(c, e); }
});

// PUT replaces the list: a function taken off the list is a function the
// company stopped tracking, so its row goes rather than lingering as "gap".
// The rows are rewritten rather than upserted, so each save re-stamps the
// actor on every row: the list is one record, signed as a whole.
r.put('/company/:uid/team/coverage', async (c) => {
  try {
    const ctx = await teamCompanyOr404(c);
    if (ctx instanceof Response) return ctx;
    const gate = teamWriteGate(c, ctx);
    if (gate) return gate;
    const { user, company } = ctx;
    const body = await c.req.json().catch(() => ({}));
    const v = validateCoverage(body);
    if (v.error || !v.value) return refuse(c, 400, { code: 'invalid_coverage', message: v.error || 'Invalid coverage', raw: null });
    // One batch, atomic on D1: the old list goes, the new list lands.
    const stmts = [c.env.DB.prepare('DELETE FROM company_function_coverage WHERE company_id = ?').bind(company.id)];
    for (const x of v.value) {
      stmts.push(c.env.DB.prepare(
        `INSERT INTO company_function_coverage (uid, company_id, function_name, state, owner_note, fix_note, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newUid(), company.id, x.function_name, x.state, x.owner_note, x.fix_note, user.id, nowIso(), nowIso()));
    }
    await c.env.DB.batch(stmts);
    const rows = await c.env.DB.prepare(
      'SELECT uid, function_name, state, owner_note, fix_note, updated_by, updated_at FROM company_function_coverage WHERE company_id = ? ORDER BY id',
    ).bind(company.id).all<any>();
    return c.json({ coverage: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

r.put('/company/:uid/team/plan', async (c) => {
  try {
    const ctx = await teamCompanyOr404(c);
    if (ctx instanceof Response) return ctx;
    const gate = teamWriteGate(c, ctx);
    if (gate) return gate;
    const { user, company } = ctx;
    const body = await c.req.json().catch(() => ({}));
    const v = validatePlan(body);
    if (v.error || !v.value) return refuse(c, 400, { code: 'invalid_plan', message: v.error || 'Invalid plan', raw: null });
    const stmts = [c.env.DB.prepare('DELETE FROM company_headcount_plan WHERE company_id = ?').bind(company.id)];
    for (const x of v.value) {
      stmts.push(c.env.DB.prepare(
        `INSERT INTO company_headcount_plan (uid, company_id, period_label, target_headcount, note, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newUid(), company.id, x.period_label, x.target_headcount, x.note, user.id, nowIso(), nowIso()));
    }
    await c.env.DB.batch(stmts);
    const rows = await c.env.DB.prepare(
      'SELECT uid, period_label, target_headcount, note, updated_by, updated_at FROM company_headcount_plan WHERE company_id = ? ORDER BY id',
    ).bind(company.id).all<any>();
    return c.json({ plan: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

export default r;
