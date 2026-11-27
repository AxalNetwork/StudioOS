/**
 * D1591 (#3858) — is this address free, while the member types it.
 *
 *   GET /api/account/slug-check?kind=company|project&slug=…[&company=<uid>][&target=<company uid | project id>]
 *     → { slug, available, reason, suggestion, path }
 *
 * The create sheets and the slug rows of company and project settings
 * (Portfolio canvas PF4a, PF4b, PF6) ask this before any write. `PUT
 * /api/company/:uid/slug` only answers after one, and `GET /api/account/resolve`
 * answers 404 for both "free" and "not yours", by design.
 *
 * SCOPES are migration 685's: a company slug is global; a project slug is
 * unique within its company (`company`), or among standalone projects (no
 * `company`). A retired slug stays taken for everyone but its target.
 *
 * IT NEVER NAMES THE HOLDER: no name, uid, id or count of whoever holds a
 * slug. `company` answers only inside a company the caller belongs to; any
 * other uid, known or not, reads the same 404. `target` (the row being
 * renamed) counts only when the caller may reach it, so it cannot be used to
 * ask whether some other row holds a slug.
 *
 * A bad shape or a reserved word is a 200 with `available: false` and its
 * reason, so the field can say why; neither gets a suggestion.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { checkSlug, nextFreeSlug, slugHolder, type SlugKind } from '../services/slugs';

type Company = { id: number; uid: string; slug: string | null };

const NOT_FOUND = { code: 'not_found', message: 'Company not found.' } as const;

async function memberCompany(env: Env, uid: string, user: User): Promise<Company | null> {
  const company = await env.DB.prepare('SELECT id, uid, slug FROM company_profiles WHERE uid = ?')
    .bind(uid).first<Company>();
  if (!company) return null;
  if (isAdmin(user)) return company;
  const link = await env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?')
    .bind(company.id, user.id).first();
  return link ? company : null;
}

/** The id `target` names, when the caller may reach it in this scope; otherwise null (ignored). */
async function targetId(env: Env, kind: SlugKind, raw: string, user: User, scope: Company | null): Promise<number | null> {
  if (!raw) return null;
  if (kind === 'company') {
    const company = await memberCompany(env, raw, user);
    return company ? Number(company.id) : null;
  }
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const project = await env.DB.prepare('SELECT id, company_id, founder_id FROM projects WHERE id = ?')
    .bind(Number(raw)).first<{ id: number; company_id: number | null; founder_id: number | null }>();
  if (!project) return null;
  // Only a project in the scope being checked: a rename never changes scope.
  if ((project.company_id == null ? null : Number(project.company_id)) !== (scope ? Number(scope.id) : null)) return null;
  // Inside a company the caller already belongs to it (`scope` is a member company).
  if (scope || isAdmin(user) || Number(project.founder_id) === Number(user.id)) return Number(project.id);
  const seat = await env.DB.prepare(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'accepted' AND removed_at IS NULL",
  ).bind(project.id, user.id).first();
  return seat ? Number(project.id) : null;
}

function pathOf(kind: SlugKind, slug: string, scope: Company | null): string {
  if (kind === 'company') return `/c/${slug}`;
  return scope ? `/c/${scope.slug ?? scope.uid}/p/${slug}` : `/p/${slug}`;
}

/** Mounted at `/api`: the path below is written out in full. */
const app = new Hono<{ Bindings: Env }>();

app.get('/account/slug-check', async (c) => {
  try {
    const user = await requireAuth(c);
    const kind = c.req.query('kind');
    if (kind !== 'company' && kind !== 'project') {
      return refuse(c, 400, { code: 'kind_invalid', message: 'Ask about a company or a project address.' });
    }
    const companyUid = String(c.req.query('company') ?? '').trim();
    let scope: Company | null = null;
    if (kind === 'project' && companyUid) {
      scope = await memberCompany(c.env, companyUid, user);
      if (!scope) return refuse(c, 404, NOT_FOUND);
    }

    const raw = c.req.query('slug');
    const checked = checkSlug(raw);
    if (!checked.ok) {
      const slug = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      return c.json({ slug, available: false, reason: checked.code, suggestion: null, path: null });
    }
    const { slug } = checked;
    const scopeId = scope ? Number(scope.id) : null;
    const holder = await slugHolder(c.env, kind, slug, scopeId);
    const mine = holder != null && holder === (await targetId(c.env, kind, String(c.req.query('target') ?? '').trim(), user, scope));
    const available = holder == null || mine;
    return c.json({
      slug,
      available,
      reason: available ? null : 'slug_taken',
      suggestion: available ? null : await nextFreeSlug(c.env, kind, slug, scopeId),
      path: pathOf(kind, slug, scope),
    });
  } catch (e) {
    return mapError(c, e);
  }
});

export default app;
