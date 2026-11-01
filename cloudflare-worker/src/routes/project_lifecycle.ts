/**
 * D1137 (#3017, part 3 of #2422) — a venture's company and its owner: the
 * "assignment UI" `services/tenancyScope.ts` waits for. Mounted at
 * /api/projects beside `projects.ts`.
 *
 *   POST /api/projects/:id/move      — { company_id }: to a company the owner
 *                                      belongs to (owner question 8 A), or
 *                                      `null` to take it out of its company
 *   POST /api/projects/:id/transfer  — { user_id }: the owner seat to a
 *                                      co-founder of the venture who has a
 *                                      founder account
 *
 * Only the venture's owner (its founder account) or an admin does either,
 * `isProjectManager`'s rule (D889). Each change and its membership event are
 * one batch (migration 597).
 *
 * A VENTURE ONLY SITS IN A COMPANY ITS OWNER BELONGS TO. `projects.company_id`
 * is the founder's company (`tenancyScope.companyScope`), so a move checks the
 * owner's link, and a transfer to a co-founder who does not belong to the
 * venture's company is refused until the venture is moved: the dialog says
 * what to do, and nothing changes the company behind the owner's back. An
 * archived company takes no venture.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isProjectManager, ensureProjectMembershipSchema } from '../services/projectAccess';
import { membershipEvent } from '../services/companyMembershipEvents';
import { ownerUserId, projectMoveStatements } from '../services/projectMove';
import { checkSlug, slugHolder, retireSlug, projectPath } from '../services/slugs';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

type ProjectRow = { id: number; founder_id: number | null; company_id: number | null; slug: string | null };

async function managedProject(env: Env, raw: string, user: User): Promise<{ project: ProjectRow } | { status: 400 | 403 | 404; detail: string }> {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return { status: 400, detail: 'Invalid project id' };
  const project = await env.DB.prepare('SELECT id, founder_id, company_id, slug FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<ProjectRow>();
  if (!project) return { status: 404, detail: 'Project not found' };
  if (!isProjectManager(user, project)) return { status: 403, detail: 'Only the venture\'s owner can do this' };
  return { project };
}

async function belongs(env: Env, userId: number, companyId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE user_id = ? AND company_id = ? LIMIT 1')
    .bind(userId, companyId).first<{ ok: number }>();
  return Boolean(row);
}

r.post('/:id/move', async (c) => {
  const user = await requireAuth(c);
  const g = await managedProject(c.env, c.req.param('id'), user);
  if ('status' in g) return c.json({ detail: g.detail }, g.status);
  const body = await c.req.json().catch(() => ({} as any));
  if (!body || !('company_id' in body)) return c.json({ detail: 'company_id is required (null takes the venture out of its company)' }, 400);
  const to = body.company_id === null ? null : Number(body.company_id);
  if (to !== null && (!Number.isSafeInteger(to) || to <= 0)) return c.json({ detail: 'company_id must be a company id or null' }, 400);
  const from = g.project.company_id ?? null;
  if (to === from) return c.json({ detail: 'The venture is already there', code: 'unchanged' }, 409);
  if (to !== null) {
    const owner = await ownerUserId(c.env, g.project.founder_id);
    if (owner == null) return c.json({ detail: 'This venture has no owner account to check the company against', code: 'no_owner' }, 409);
    const company = await c.env.DB.prepare('SELECT id, archived_at FROM company_profiles WHERE id = ?').bind(to).first<{ id: number; archived_at: string | null }>();
    // A company the owner does not belong to reads as not found, so the route confirms no company it does not name.
    if (!company || !(await belongs(c.env, owner, to))) return c.json({ detail: 'The venture\'s owner does not belong to that company', code: 'not_owner_company' }, 404);
    if (company.archived_at) return c.json({ detail: 'That company is archived. Restore it before you move a venture to it.', code: 'archived' }, 409);
  }
  // D1415: a project slug is unique within its scope. A move into a scope that
  // already holds it (current or retired) is refused, changing nothing; else
  // the old address is retired in the same batch, so it still resolves.
  const slug = g.project.slug;
  if (slug) {
    const holder = await slugHolder(c.env, 'project', slug, to);
    if (holder != null && holder !== g.project.id) {
      return refuse(c, 409, { code: 'slug_taken', message: 'A project there already has this project\'s address. Change this project\'s slug first, then move it.' });
    }
  }
  // D1415 Part 3: the one writer of `projects.company_id`, shared with the filing (`services/projectMove.ts`).
  await c.env.DB.batch(projectMoveStatements(c.env, { projectId: g.project.id, from, to, actorUserId: user.id, slug }));
  return c.json({ project_id: g.project.id, company_id: to, previous_company_id: from });
});

/** The company a project sits in, for its path: uid and slug, or null for standalone. */
const companyOfProject = (env: Env, companyId: number | null) => companyId == null
  ? Promise.resolve(null)
  : env.DB.prepare('SELECT uid, slug FROM company_profiles WHERE id = ?').bind(companyId).first<{ uid: string; slug: string | null }>();

const SLUG_MESSAGES: Record<string, string> = {
  slug_invalid: 'A slug is 1 to 50 lower-case letters, digits and hyphens, and starts and ends with a letter or digit.',
  slug_reserved: 'That word is used by the address itself. Choose another.',
};

// D1415 — the project's slug, unique within its current scope. The old slug is
// retired in the same batch and keeps resolving to this project.
r.put('/:id/slug', async (c) => {
  const user = await requireAuth(c);
  const g = await managedProject(c.env, c.req.param('id'), user);
  if ('status' in g) return c.json({ detail: g.detail }, g.status);
  const body = (await c.req.json().catch(() => ({}))) as { slug?: unknown };
  const s = checkSlug(body.slug);
  if (!s.ok) return refuse(c, 400, { code: s.code, message: SLUG_MESSAGES[s.code] });
  const scope = g.project.company_id ?? null;
  const company = await companyOfProject(c.env, scope);
  const previous = g.project.slug;
  if (previous === s.slug) return c.json({ slug: s.slug, path: projectPath(g.project, company), previous_slug: previous });
  const holder = await slugHolder(c.env, 'project', s.slug, scope);
  const taken = () => refuse(c, 409, { code: 'slug_taken', message: 'Another project here holds that address. Choose another.' });
  if (holder != null && holder !== g.project.id) return taken();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE projects SET slug = ? WHERE id = ?').bind(s.slug, g.project.id),
      ...(previous ? [retireSlug(c.env, 'project', previous, g.project.id, scope, user.id)] : []),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message))) return taken();
    throw e;
  }
  return c.json({ slug: s.slug, path: projectPath({ id: g.project.id, slug: s.slug }, company), previous_slug: previous });
});

r.post('/:id/transfer', async (c) => {
  const user = await requireAuth(c);
  const g = await managedProject(c.env, c.req.param('id'), user);
  if ('status' in g) return c.json({ detail: g.detail }, g.status);
  const body = await c.req.json().catch(() => ({} as any));
  const targetId = Number(body?.user_id);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return c.json({ detail: 'user_id is required' }, 400);
  await ensureProjectMembershipSchema(c.env);
  const seat = await c.env.DB.prepare(
    `SELECT pm.role, u.role AS account_role, u.founder_id, u.is_active
       FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.user_id = ? AND pm.status = 'accepted'`,
  ).bind(g.project.id, targetId).first<{ role: string; account_role: string; founder_id: number | null; is_active: number }>();
  if (!seat || seat.role !== 'cofounder') return c.json({ detail: 'The owner seat goes to a co-founder of this venture', code: 'not_cofounder' }, 404);
  if (seat.account_role !== 'founder' || seat.founder_id == null || !Number(seat.is_active)) {
    return c.json({ detail: 'That co-founder has no founder account to own the venture', code: 'no_founder_account' }, 409);
  }
  if (Number(seat.founder_id) === Number(g.project.founder_id)) return c.json({ detail: 'That person already owns the venture', code: 'unchanged' }, 409);
  const companyId = g.project.company_id ?? null;
  if (companyId != null && !(await belongs(c.env, targetId, companyId))) {
    return c.json({
      detail: 'The new owner does not belong to this venture\'s company. Move the venture to a company they belong to, or out of its company, first.',
      code: 'owner_not_in_company',
    }, 409);
  }
  const previousOwner = await ownerUserId(c.env, g.project.founder_id);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE projects SET founder_id = ? WHERE id = ?').bind(seat.founder_id, g.project.id),
    // The previous owner keeps a seat, as a co-founder.
    ...(previousOwner != null ? [c.env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role, status, source, accepted_at)
       VALUES (?, ?, 'cofounder', 'accepted', 'owner_transfer', datetime('now'))
       ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'cofounder', status = 'accepted', removed_at = NULL, updated_at = datetime('now')`,
    ).bind(g.project.id, previousOwner)] : []),
    c.env.DB.prepare(`UPDATE project_members SET role = 'owner', updated_at = datetime('now') WHERE project_id = ? AND user_id = ?`)
      .bind(g.project.id, targetId),
    membershipEvent(c.env, {
      kind: 'project_transfer', projectId: g.project.id, companyId, actorUserId: user.id, targetUserId: targetId,
      before: { owner_user_id: previousOwner }, after: { owner_user_id: targetId },
    }),
  ]);
  return c.json({ project_id: g.project.id, owner_user_id: targetId, previous_owner_user_id: previousOwner });
});

export default r;
