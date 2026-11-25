/**
 * D7826 (#7826): Research organizations (roles, linked company and fund records, sourced relationships), mounted at
 * /api/research/organizations. Service: `services/researchOrganizations.ts`.
 *
 *   GET  /record/:type/:uid      a member's read: the organization of a company or fund record, by the record's uid
 *                                (the reader #7674 and #7680 use for View in Research)
 *   GET  /:uid                   a member's read: an organization with its roles, relationships and linked records
 *   POST /                       admin: create an organization
 *   POST /:uid/roles             admin: add a role with its source and date
 *   POST /:uid/links             admin: confirm a link to a company or fund record
 *   POST /:uid/relationships     admin: add a sourced relationship to another organization
 *
 * One access decision governs both reads (D7178 Companies rule and D7819 served rows for anything derived from a
 * company record; SERVED_FUNDS for fund records). What the caller may not read is left out: an organization the
 * caller may not see answers as not found, the same as one that does not exist. A company record asked of an account
 * the Companies rule does not admit gets that rule's refusal, decided before the record is read. Every admin write
 * goes through the admin audit trail.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAdmin, requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { admitsCompanies, refuseCompanies } from '../services/researchCompaniesAccess';
import { mapError } from './_t13t14t15_helpers';
import {
  OrganizationInputError, addRelationship, addRole, confirmLink, createOrganization, organizationOfRecord,
  parseRecordType, readOrganization,
} from '../services/researchOrganizations';

const r = new Hono<{ Bindings: Env }>();

const fail = (c: any, e: unknown) => {
  if (e instanceof OrganizationInputError) return c.json(e.status === 404 && e.code === 'not_found' ? { detail: 'Not found' } : { error: e.code, detail: e.detail }, e.status);
  return mapError(c, e);
};

r.get('/record/:type/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    c.header('Cache-Control', 'private, no-store');
    const type = parseRecordType(c.req.param('type'));
    // The Companies rule is decided before anything is read: a refusal never says whether the record exists.
    if (type === 'company' && !admitsCompanies(user as any)) return refuseCompanies(c);
    return c.json({ organization: await organizationOfRecord(c.env, user, type, c.req.param('uid')) });
  } catch (e) { return fail(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    c.header('Cache-Control', 'private, no-store');
    const org = await readOrganization(c.env, user, c.req.param('uid'));
    if (!org) return c.json({ detail: 'Not found' }, 404);
    return c.json(org);
  } catch (e) { return fail(c, e); }
});

const audited = (action: string, run: (c: any, user: any) => Promise<Record<string, unknown>>, status = 200) => async (c: any) => {
  try {
    const user = await requireAdmin(c);
    const out = await run(c, user);
    await logAdminAction(c.env, Number(user.id), String(user.email || ''), action, out);
    return c.json({ ok: true, ...out }, status);
  } catch (e) { return fail(c, e); }
};
const body = (c: any) => c.req.json().catch(() => ({}));

r.post('/', audited('research_organization_create', async (c, user) => createOrganization(c.env, await body(c), Number(user.id)), 201));
r.post('/:uid/roles', audited('research_organization_role_add', async (c, user) => addRole(c.env, c.req.param('uid'), await body(c), Number(user.id)), 201));
r.post('/:uid/links', audited('research_organization_link_confirm', async (c, user) => confirmLink(c.env, c.req.param('uid'), await body(c), Number(user.id))));
r.post('/:uid/relationships', audited('research_organization_relationship_add', async (c, user) => addRelationship(c.env, c.req.param('uid'), await body(c), Number(user.id)), 201));

export default r;

export const mount: RouteMount = { path: '/api/research/organizations', router: r };
