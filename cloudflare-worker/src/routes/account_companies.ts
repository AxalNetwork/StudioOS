/**
 * D1136 / #3016 — Companies and projects part 2: the caller's own reads, and
 * answering an invitation while signed in.
 *
 *   GET  /api/account/companies     — one light summary per company the caller
 *                                     belongs to (the switcher can use it too:
 *                                     #2422 item 11)
 *   GET  /api/account/projects      — the caller's own ventures and accepted
 *                                     seats, for every profile
 *   GET  /api/account/invitations   — pending company and project invitations
 *                                     addressed to the caller
 *   POST /api/company/invitations/:uid/(accept|decline)
 *   POST /api/projects/invitations/:id/(accept|decline)
 *
 * EACH READ IS THE CALLER'S OWN. Nothing here is the privileged arm of
 * `GET /api/projects` (every venture, to an investor): a venture is listed
 * only because the caller owns it (`projects.founder_id`) or holds an
 * accepted seat on it (`project_members`).
 *
 * THE BINDING IS THE TOKEN ROUTES'. An invitation is addressed to an address
 * (or, for a project, to an account): the signed-in caller answers it only
 * when they are that address or that account. A bare project link names no
 * one, so it is answered only through its token, never by id.
 *
 * A block whose store failed is `{ available: false, reason }`, never a zero.
 * No member email, no token or hash, and no inviter address is returned.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { cyclesActive, visitsFor, CYCLE_STORES } from '../services/companySheet';
import { ensureProjectMembershipSchema, normalizeEmail } from '../services/projectAccess';
import { refuse } from '../util/refusal';

type Row = Record<string, any>;
type Block<T> = { available: true; value: T } | { available: false; reason: string };
const ok = <T>(value: T): Block<T> => ({ available: true, value });
const failed = (what: string): Block<never> => ({ available: false, reason: `${what} could not be read. That is not the same as none.` });

const EDITOR_ROLES = ['Owner', 'Admin', 'Founder'];

async function rows(env: Env, what: string, sql: string, binds: unknown[]): Promise<Block<Row[]>> {
  try {
    const r: any = await env.DB.prepare(sql).bind(...binds).all();
    if ((r && 'success' in r && !r.success) || !Array.isArray(r?.results)) throw new Error('rows were not returned');
    return ok(r.results);
  } catch (e) {
    console.warn('[account_companies] unreadable', what, (e as Error)?.message);
    return failed(what);
  }
}

/** A grouped count per id from one store: the store's failure, or 0 for an id the store holds nothing for. */
function countsBy(block: Block<Row[]>, key: string): Block<Map<number, number>> {
  if (!block.available) return block;
  return ok(new Map(block.value.map((r) => [Number(r[key]), Number(r.n || 0)])));
}
const countFor = (block: Block<Map<number, number>>, id: number): Block<number> =>
  (block.available ? ok(block.value.get(id) ?? 0) : block);

// ── GET /api/account/companies ─────────────────────────────────────────────

/** Mounted at `/api`: every path below is written out in full. */
const account = new Hono<{ Bindings: Env }>();

account.get('/account/companies', async (c) => {
  try {
    const user = await requireAuth(c);
    const links = await rows(c.env, 'Your companies', `SELECT l.company_id, l.role_in_company, l.title, l.authority, l.is_primary_admin, l.created_at,
        cp.uid, cp.company_name, cp.stage, cp.logo_url
        FROM user_company_links l JOIN company_profiles cp ON cp.id = l.company_id
        WHERE l.user_id = ? ORDER BY l.is_primary_admin DESC, l.created_at ASC, l.id ASC`, [user.id]);
    if (!links.available) return refuse(c, 503, { code: 'companies_unreadable', message: 'Your companies could not be read. That is not the same as none.' });

    // One entry per company, in the switcher's order (primary admin first, then oldest link).
    const seen = new Set<number>();
    const mine = links.value.filter((l) => (seen.has(Number(l.company_id)) ? false : (seen.add(Number(l.company_id)), true)));
    const ids = JSON.stringify(mine.map((l) => Number(l.company_id)));
    const editorOf = (l: Row) => isAdmin(user) || Number(l.is_primary_admin) === 1 || EDITOR_ROLES.includes(String(l.role_in_company));
    const editorIds = JSON.stringify(mine.filter(editorOf).map((l) => Number(l.company_id)));

    const [members, invitations, projects, funds, engagements, quotes, offers, visits, cycles] = await Promise.all([
      rows(c.env, 'The member counts', `SELECT company_id, COUNT(*) AS n FROM user_company_links
          WHERE company_id IN (SELECT value FROM json_each(?)) GROUP BY company_id`, [ids]),
      rows(c.env, 'The pending invitations', `SELECT company_id, COUNT(*) AS n FROM company_invitations
          WHERE company_id IN (SELECT value FROM json_each(?)) AND status = 'pending' AND datetime(expires_at) >= datetime('now')
          GROUP BY company_id`, [editorIds]),
      rows(c.env, 'The ventures', `SELECT company_id, COUNT(*) AS n FROM projects
          WHERE company_id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL GROUP BY company_id`, [ids]),
      rows(c.env, 'The funds', `SELECT company_id, COUNT(*) AS n FROM vc_funds
          WHERE company_id IN (SELECT value FROM json_each(?)) GROUP BY company_id`, [ids]),
      rows(c.env, 'The engagements', `SELECT company_id, COUNT(*) AS n FROM engagements
          WHERE company_id IN (SELECT value FROM json_each(?)) GROUP BY company_id`, [ids]),
      rows(c.env, 'The quotes', `SELECT company_id, COUNT(*) AS n FROM quotes
          WHERE company_id IN (SELECT value FROM json_each(?)) GROUP BY company_id`, [ids]),
      rows(c.env, 'The offers', `SELECT company_id, COUNT(*) AS n FROM service_offerings
          WHERE company_id IN (SELECT value FROM json_each(?)) GROUP BY company_id`, [ids]),
      visitsFor(c.env, user.id),
      Promise.all(mine.map((l) => cyclesActive(c.env, user, Number(l.company_id)))),
    ]);
    const memberN = countsBy(members, 'company_id');
    const invitesN = countsBy(invitations, 'company_id');
    const counts = {
      projects: countsBy(projects, 'company_id'),
      funds: countsBy(funds, 'company_id'),
      engagements: countsBy(engagements, 'company_id'),
      quotes: countsBy(quotes, 'company_id'),
      offers: countsBy(offers, 'company_id'),
    };

    return c.json({
      companies: mine.map((l, i) => {
        const id = Number(l.company_id);
        return {
          uid: l.uid,
          company_name: l.company_name,
          stage: l.stage ?? null,
          logo_url: l.logo_url ?? null,
          my_role: l.role_in_company,
          // Migration 191: null is "not recorded", never "none".
          title: l.title ?? null,
          authority: l.authority ?? null,
          is_primary_admin: Number(l.is_primary_admin) === 1,
          member_count: countFor(memberN, id),
          cycles_active: cycles[i] === null ? failed('The cycles in use') : ok(cycles[i]),
          last_opened: visits === null ? failed('When you last opened it') : ok(visits.get(id) ?? null),
          // An invitation names a person's address, so even its count is the editors' (company.ts's rule).
          ...(editorOf(l) ? { pending_invitations: countFor(invitesN, id) } : {}),
          counts: Object.fromEntries(Object.entries(counts).map(([k, b]) => [k, countFor(b, id)])),
        };
      }),
    });
  } catch (e) { return mapError(c, e); }
});

// ── GET /api/account/projects ──────────────────────────────────────────────

/**
 * Which cycles hold work, per venture. One literal statement over
 * CYCLE_STORES' tables (the SQL guard allows no composed statement); a test
 * holds it to CYCLE_STORES, so a new store cannot be missed here.
 */
export const PROJECT_CYCLES_SQL = `SELECT DISTINCT cycle, project_id FROM (
  SELECT 'validate' AS cycle, project_id FROM discovery_interviews
  UNION ALL SELECT 'validate', project_id FROM pain_groups
  UNION ALL SELECT 'validate', project_id FROM hypotheses
  UNION ALL SELECT 'validate', project_id FROM demand_signals
  UNION ALL SELECT 'build', project_id FROM mvp_features
  UNION ALL SELECT 'build', project_id FROM venture_risks
  UNION ALL SELECT 'build', project_id FROM roadmap_okrs
  UNION ALL SELECT 'build', project_id FROM formation_steps
  UNION ALL SELECT 'raise', project_id FROM readiness_items
  UNION ALL SELECT 'raise', project_id FROM pitch_decks
  UNION ALL SELECT 'raise', project_id FROM data_room_files
  UNION ALL SELECT 'raise', project_id FROM raise_prospects
  UNION ALL SELECT 'grow', project_id FROM product_feedback
  UNION ALL SELECT 'grow', project_id FROM growth_channels
  UNION ALL SELECT 'grow', project_id FROM growth_partners
  UNION ALL SELECT 'grow', project_id FROM markets
  UNION ALL SELECT 'grow', project_id FROM compliance_events
) WHERE project_id IN (SELECT value FROM json_each(?))`;

account.get('/account/projects', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureProjectMembershipSchema(c.env);
    // Owned (by founder_id) or seated (accepted, not removed). Never every venture.
    const ventures = await rows(c.env, 'Your ventures', `SELECT p.id, p.uid, p.name, p.stage, p.playbook_week, p.company_id,
        cp.uid AS company_uid, cp.company_name,
        CASE WHEN p.founder_id IS NOT NULL AND p.founder_id = ? THEN 'owner' ELSE pm.role END AS my_seat
        FROM projects p
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'accepted' AND pm.removed_at IS NULL
        LEFT JOIN company_profiles cp ON cp.id = p.company_id
        WHERE p.deleted_at IS NULL AND ((p.founder_id IS NOT NULL AND p.founder_id = ?) OR pm.id IS NOT NULL)
        ORDER BY p.created_at DESC, p.id DESC`, [user.founder_id ?? null, user.id, user.founder_id ?? null]);
    if (!ventures.available) return refuse(c, 503, { code: 'projects_unreadable', message: 'Your ventures could not be read. That is not the same as none.' });
    const ids = JSON.stringify(ventures.value.map((v) => Number(v.id)));

    const [members, owners, cycleRows] = await Promise.all([
      rows(c.env, 'The member counts', `SELECT project_id, COUNT(*) AS n FROM project_members
          WHERE project_id IN (SELECT value FROM json_each(?)) AND status = 'accepted' AND removed_at IS NULL AND role <> 'owner'
          GROUP BY project_id`, [ids]),
      // The owner is a member whether or not their `owner` row has been seeded (projects.ts seeds it lazily).
      rows(c.env, 'The owners', `SELECT p.id AS project_id, COUNT(u.id) AS n FROM projects p
          LEFT JOIN users u ON u.id = (SELECT MIN(x.id) FROM users x WHERE x.founder_id = p.founder_id)
          WHERE p.id IN (SELECT value FROM json_each(?)) GROUP BY p.id`, [ids]),
      rows(c.env, 'The cycles in use', PROJECT_CYCLES_SQL, [ids]),
    ]);
    const memberN = countsBy(members, 'project_id');
    const ownerN = countsBy(owners, 'project_id');
    const cycles = new Map<number, string[]>();
    if (cycleRows.available) for (const r of cycleRows.value) cycles.set(Number(r.project_id), [...(cycles.get(Number(r.project_id)) ?? []), String(r.cycle)]);
    const order = Object.keys(CYCLE_STORES);

    return c.json({
      projects: ventures.value.map((v) => {
        const id = Number(v.id);
        const m = countFor(memberN, id);
        const o = countFor(ownerN, id);
        return {
          id, uid: v.uid, name: v.name,
          my_seat: v.my_seat,
          company_id: v.company_id ?? null,
          company_uid: v.company_uid ?? null,
          company_name: v.company_name ?? null,
          stage: v.stage ?? null,
          playbook_week: v.playbook_week ?? null,
          member_count: m.available && o.available ? ok(m.value + o.value) : (m.available ? o : m),
          cycles_active: cycleRows.available
            ? ok(order.filter((k) => (cycles.get(id) ?? []).includes(k)))
            : cycleRows,
        };
      }),
    });
  } catch (e) { return mapError(c, e); }
});

// ── GET /api/account/invitations ───────────────────────────────────────────

account.get('/account/invitations', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureProjectMembershipSchema(c.env);
    const email = normalizeEmail(user.email);
    const [company, project] = await Promise.all([
      rows(c.env, 'Your company invitations', `SELECT ci.uid, ci.role_in_company, ci.title, ci.authority, ci.created_at, ci.expires_at,
          cp.uid AS company_uid, cp.company_name, cp.logo_url, u.name AS invited_by_name
          FROM company_invitations ci
          JOIN company_profiles cp ON cp.id = ci.company_id
          LEFT JOIN users u ON u.id = ci.invited_by_user_id
          WHERE ci.status = 'pending' AND lower(ci.email) = ? AND datetime(ci.expires_at) >= datetime('now')
          ORDER BY ci.created_at DESC, ci.id DESC`, [email]),
      rows(c.env, 'Your venture invitations', `SELECT i.id, i.role, i.created_at, i.expires_at,
          p.id AS project_id, p.uid AS project_uid, p.name AS project_name, u.name AS invited_by_name
          FROM project_member_invitations i
          JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
          LEFT JOIN users u ON u.id = i.invited_by_user_id
          WHERE i.status = 'pending'
            AND (i.invitee_user_id = ? OR (i.invitee_user_id IS NULL AND i.invitee_email IS NOT NULL AND lower(i.invitee_email) = ?))
            AND (i.expires_at IS NULL OR datetime(i.expires_at) >= datetime('now'))
          ORDER BY i.created_at DESC, i.id DESC`, [user.id, email]),
    ]);
    // Investors are never project members (projects.ts), so their venture invitations are listed but cannot be accepted.
    const canJoinVentures = user.role !== 'investor';
    return c.json({
      company: company.available ? ok(company.value.map((r) => ({
        uid: r.uid, company_uid: r.company_uid, company_name: r.company_name, logo_url: r.logo_url ?? null,
        role_in_company: r.role_in_company, title: r.title ?? null, authority: r.authority ?? null,
        invited_by_name: r.invited_by_name ?? null, created_at: r.created_at, expires_at: r.expires_at,
      }))) : company,
      project: project.available ? ok(project.value.map((r) => ({
        id: Number(r.id), project_id: Number(r.project_id), project_uid: r.project_uid, project_name: r.project_name,
        role: r.role, invited_by_name: r.invited_by_name ?? null, created_at: r.created_at, expires_at: r.expires_at ?? null,
        can_accept: canJoinVentures,
      }))) : project,
    });
  } catch (e) { return mapError(c, e); }
});

// ── Answering a company invitation ─────────────────────────────────────────

/** The invitation, if it is still the caller's to answer; else the refusal. */
async function openCompanyInvitation(c: any, user: User): Promise<Row | Response> {
  const inv = await c.env.DB.prepare(
    `SELECT id, company_id, email, role_in_company, title, authority, status,
            CASE WHEN datetime(expires_at) < datetime('now') THEN 1 ELSE 0 END AS expired
       FROM company_invitations WHERE uid = ?`,
  ).bind(c.req.param('uid')).first() as Row | null;
  // Another address's invitation reads as missing: its existence is not the caller's to learn.
  if (!inv || normalizeEmail(user.email) !== normalizeEmail(inv.email)) {
    return refuse(c, 404, { code: 'not_found', message: 'There is no invitation with that id for you.' });
  }
  if (inv.status !== 'pending') return refuse(c, 410, { code: inv.status, message: 'This invitation is no longer open.' });
  if (Number(inv.expired) === 1) {
    await c.env.DB.prepare(`UPDATE company_invitations SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`).bind(inv.id).run();
    return refuse(c, 410, { code: 'expired', message: 'This invitation has expired.' });
  }
  return inv;
}

account.post('/company/invitations/:uid/accept', async (c) => {
  try {
    const user = await requireAuth(c);
    const inv = await openCompanyInvitation(c, user);
    if (inv instanceof Response) return inv;
    const company = await c.env.DB.prepare('SELECT id, uid, company_name FROM company_profiles WHERE id = ?').bind(inv.company_id).first<Row>();
    if (!company) return refuse(c, 404, { code: 'company_gone', message: 'That company no longer exists.' });
    const already = await c.env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(company.id, user.id).first();
    // One batch: the seat is written only while the invitation is still pending, and the answer is claimed in the
    // same transaction, so two answers at once cannot both land and a failed write leaves the invitation open.
    const [, claimed] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, title, authority, created_at)
         SELECT ?, ?, ?, ?, 0, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM company_invitations WHERE id = ? AND status = 'pending')
            AND NOT EXISTS (SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?)`,
      ).bind(newUid(), company.id, user.id, inv.role_in_company, inv.title ?? null, inv.authority ?? null, nowIso(), inv.id, company.id, user.id),
      c.env.DB.prepare(
        `UPDATE company_invitations SET status = 'accepted', accepted_by_user_id = ?, accepted_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
      ).bind(user.id, inv.id),
    ]);
    if (!claimed?.meta?.changes) return refuse(c, 409, { code: 'already_answered', message: 'This invitation was answered a moment ago.' });
    return c.json({ ok: true, company_uid: company.uid, company_name: company.company_name, role_in_company: inv.role_in_company, already_member: !!already });
  } catch (e) { return mapError(c, e); }
});

// ── Answering a venture invitation ─────────────────────────────────────────

async function openProjectInvitation(c: any, user: User): Promise<Row | Response> {
  const id = Number(c.req.param('id'));
  await ensureProjectMembershipSchema(c.env);
  const inv = await c.env.DB.prepare(
    `SELECT i.id, i.project_id, i.role, i.status, i.source, i.invitee_user_id, i.invitee_email, i.invited_by_user_id, i.cofounder_connection_id,
            CASE WHEN i.expires_at IS NOT NULL AND datetime(i.expires_at) < datetime('now') THEN 1 ELSE 0 END AS expired
       FROM project_member_invitations i WHERE i.id = ?`,
  ).bind(id).first() as Row | null;
  // Addressed to this account, or to this address with no account named. A bare link names no one: only its token answers it.
  const mine = inv && (inv.invitee_user_id != null
    ? Number(inv.invitee_user_id) === Number(user.id)
    : inv.invitee_email != null && normalizeEmail(inv.invitee_email) === normalizeEmail(user.email));
  if (!inv || !mine) return refuse(c, 404, { code: 'not_found', message: 'There is no invitation with that id for you.' });
  if (inv.status !== 'pending') return refuse(c, 410, { code: inv.status, message: 'This invitation is no longer open.' });
  if (Number(inv.expired) === 1) {
    await c.env.DB.prepare(`UPDATE project_member_invitations SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`).bind(inv.id).run();
    return refuse(c, 410, { code: 'expired', message: 'This invitation has expired.' });
  }
  return inv;
}

const SEATS = new Set(['cofounder', 'advisor']);

account.post('/projects/invitations/:id{[0-9]+}/accept', async (c) => {
  try {
    const user = await requireAuth(c);
    if (user.role === 'investor') return refuse(c, 403, { code: 'investor', message: 'Investors cannot join ventures as members.' });
    const inv = await openProjectInvitation(c, user);
    if (inv instanceof Response) return inv;
    const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(inv.project_id).first<Row>();
    if (!project) return refuse(c, 404, { code: 'project_gone', message: 'That venture no longer exists.' });
    const accept = c.env.DB.prepare(
      `UPDATE project_member_invitations SET status = 'accepted', invitee_user_id = COALESCE(invitee_user_id, ?), accepted_by_user_id = ?,
              accepted_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    ).bind(user.id, user.id, inv.id);
    // The owner accepting an invitation to their own venture takes no seat.
    if (project.founder_id != null && user.founder_id != null && Number(user.founder_id) === Number(project.founder_id)) {
      const done = await accept.run();
      if (!done.meta?.changes) return refuse(c, 409, { code: 'already_answered', message: 'This invitation was answered a moment ago.' });
      return c.json({ ok: true, project_id: Number(project.id), role: 'owner', already_owner: true });
    }
    const role = SEATS.has(String(inv.role)) ? String(inv.role) : 'cofounder';
    // One batch, each seat written only while the invitation is pending, then the answer claimed: two answers at
    // once cannot both land, and a failed write leaves the invitation open.
    const results = await c.env.DB.batch([
      // The owner's row, as projects.ts seeds it, so the roster stays complete.
      c.env.DB.prepare(`INSERT INTO project_members (project_id, user_id, role, status, source, accepted_at)
          SELECT ?, u.id, 'owner', 'accepted', 'owner_seed', datetime('now') FROM users u
           WHERE u.id = (SELECT MIN(x.id) FROM users x WHERE x.founder_id = ?)
             AND EXISTS (SELECT 1 FROM project_member_invitations WHERE id = ? AND status = 'pending')
          ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'owner', status = 'accepted', removed_at = NULL, updated_at = datetime('now')`)
        .bind(project.id, project.founder_id ?? null, inv.id),
      c.env.DB.prepare(`INSERT INTO project_members (project_id, user_id, role, status, source, invitation_id, cofounder_connection_id, added_by_user_id, accepted_at)
          SELECT ?, ?, ?, 'accepted', ?, ?, ?, ?, datetime('now')
           WHERE EXISTS (SELECT 1 FROM project_member_invitations WHERE id = ? AND status = 'pending')
          ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, status = 'accepted', source = excluded.source,
            invitation_id = excluded.invitation_id, accepted_at = datetime('now'), removed_at = NULL, updated_at = datetime('now')`)
        .bind(project.id, user.id, role, inv.source ?? null, inv.id, inv.cofounder_connection_id ?? null, inv.invited_by_user_id ?? null, inv.id),
      accept,
    ]);
    if (!results[2]?.meta?.changes) return refuse(c, 409, { code: 'already_answered', message: 'This invitation was answered a moment ago.' });
    return c.json({ ok: true, project_id: Number(project.id), role });
  } catch (e) { return mapError(c, e); }
});

account.post('/projects/invitations/:id{[0-9]+}/decline', async (c) => {
  try {
    const user = await requireAuth(c);
    const inv = await openProjectInvitation(c, user);
    if (inv instanceof Response) return inv;
    const done = await c.env.DB.prepare(
      `UPDATE project_member_invitations SET status = 'declined', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
    ).bind(inv.id).run();
    if (!done.meta?.changes) return refuse(c, 409, { code: 'already_answered', message: 'This invitation was answered a moment ago.' });
    return c.json({ ok: true, declined: true });
  } catch (e) { return mapError(c, e); }
});

export default account;
