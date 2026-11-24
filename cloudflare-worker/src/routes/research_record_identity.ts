/**
 * D7825 (#7825): record identity of a Research company or fund record (names, native identifiers, reviewed domains),
 * mounted at /api/research/record-identity (no `before`: research.ts has no catch-all or middleware under that path). Service: `services/researchRecordIdentity.ts`.
 *
 *   GET    /:kind/:uid                       a member's read; answers as that record's own profile route answers the
 *                                            account (the Companies rule and served rows; the fund catalogue's rule
 *                                            and SERVED_FUNDS, a moved fund uid followed one hop)
 *   POST   /:kind/:uid/domains               admin: review a domain (reviewed | rejected with https proof; not_reviewed
 *                                            withdraws a review)
 *   POST   /:kind/:uid/names                 admin: add a name with its source
 *   PATCH  /:kind/:uid/names/:id             admin: correct it
 *   DELETE /:kind/:uid/names/:id             admin: remove it
 *   POST|PATCH|DELETE /:kind/:uid/identifiers[/:id]   admin: the same for a native identifier
 * Every admin write goes through the admin audit trail.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAdmin, requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { refuseCompanies } from '../services/researchCompaniesAccess';
import { mapError } from './_t13t14t15_helpers';
import {
  IdentityInputError, addIdentifier, addName, correctIdentifier, correctName, identityOf, parseKind, parseUid,
  removeEntry, resolveRecord, reviewDomain,
} from '../services/researchRecordIdentity';

const r = new Hono<{ Bindings: Env }>();

const fail = (c: any, e: unknown) => {
  if (e instanceof IdentityInputError) return c.json(e.status === 404 ? { detail: 'Not found' } : { error: e.code, detail: e.detail }, e.status);
  return mapError(c, e);
};
const entryId = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new IdentityInputError('not_found', 'Not found', 404);
  return n;
};

r.get('/:kind/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    c.header('Cache-Control', 'private, no-store');
    const kind = parseKind(c.req.param('kind'));
    // The Companies rule is decided before the record is read: a refusal never says whether it exists.
    const rec = await resolveRecord(c.env, user, kind, parseUid(c.req.param('uid')));
    if (rec.state === 'refused') return refuseCompanies(c);
    if (rec.state === 'not_found') return c.json({ detail: 'Not found' }, 404);
    if (rec.state === 'withdrawn') return c.json({ error: 'record_not_served', detail: rec.reason, review_status: rec.review_status }, 410);
    if (rec.state === 'removed') return c.json({ error: 'source_withdrawn', detail: 'Removed', removed: rec.removed }, 410);
    return c.json(await identityOf(c.env, rec, 'member'));
  } catch (e) { return fail(c, e); }
});

const audited = (action: string, run: (c: any, kind: any, uid: string, user: any) => Promise<Record<string, unknown>>, status = 200) => async (c: any) => {
  try {
    const user = await requireAdmin(c);
    const kind = parseKind(c.req.param('kind'));
    const uid = parseUid(c.req.param('uid'));
    const out = await run(c, kind, uid, user);
    await logAdminAction(c.env, Number(user.id), String(user.email || ''), action, { kind, uid, ...out });
    return c.json({ ok: true, ...out }, status);
  } catch (e) { return fail(c, e); }
};
const body = (c: any) => c.req.json().catch(() => ({}));

r.post('/:kind/:uid/domains', audited('research_record_domain_review', async (c, kind, uid, user) => reviewDomain(c.env, kind, uid, await body(c), Number(user.id))));
r.post('/:kind/:uid/names', audited('research_record_name_add', async (c, kind, uid) => addName(c.env, kind, uid, await body(c)), 201));
r.patch('/:kind/:uid/names/:id', audited('research_record_name_correct', async (c, kind, uid) => correctName(c.env, kind, uid, entryId(c.req.param('id')), await body(c))));
r.delete('/:kind/:uid/names/:id', audited('research_record_name_remove', async (c, kind, uid) => removeEntry(c.env, 'names', kind, uid, entryId(c.req.param('id')))));
r.post('/:kind/:uid/identifiers', audited('research_record_identifier_add', async (c, kind, uid) => addIdentifier(c.env, kind, uid, await body(c)), 201));
r.patch('/:kind/:uid/identifiers/:id', audited('research_record_identifier_correct', async (c, kind, uid) => correctIdentifier(c.env, kind, uid, entryId(c.req.param('id')), await body(c))));
r.delete('/:kind/:uid/identifiers/:id', audited('research_record_identifier_remove', async (c, kind, uid) => removeEntry(c.env, 'identifiers', kind, uid, entryId(c.req.param('id')))));

export default r;

export const mount: RouteMount = { path: '/api/research/record-identity', router: r };
