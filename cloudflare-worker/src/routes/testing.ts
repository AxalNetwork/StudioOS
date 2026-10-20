/**
 * D812 (#2258) — product testing. Three routers over `services/testing.ts`:
 *
 *   /api/testing          a member: the open programmes for their role, their
 *                         applications, apply and withdraw, and the Studio
 *                         card's summary (D814).
 *   /api/partner/testing  a partner, on their firm's programmes only: create,
 *                         edit a draft, send to HQ, read applicants, pick and
 *                         decline.
 *   /api/admin/testing    Super Admin: every programme for review, approve or
 *                         send back, open and close, and HQ's own programmes
 *                         with the partner's create, edit and pick.
 *
 * Lists are `{ items }`; a refusal is `{ error, detail }` with the service's
 * sentence. Another firm's programme or application is 404, as a missing one.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireSuperAdmin } from '../auth';
import { mapError, requirePartnerProfile } from './_t13t14t15_helpers';
import { requirePartnerRole } from './_partner_workspace_helpers';
import { refusalBody } from '../util/refusal';
import * as svc from '../services/testing';
import type { Owner } from '../services/testing';

type C = any;

function fail(c: C, e: unknown) {
  if (e instanceof svc.TestingRefusal) {
    return c.json(refusalBody({ code: e.code, message: e.message }), e.status as any);
  }
  return mapError(c, e);
}

async function body(c: C): Promise<any> {
  return c.req.json().catch(() => ({}));
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const testing = new Hono<{ Bindings: Env }>();

const member = async (c: C) => (await requireAuth(c)) as User;

testing.get('/programmes', async (c) => {
  try {
    const user = await member(c);
    return c.json({ items: await svc.memberProgrammes(c.env, user), consent: { version: svc.CONSENT_VERSION, text: svc.CONSENT_TEXT } });
  } catch (e) { return fail(c, e); }
});

testing.get('/applications/mine', async (c) => {
  try {
    const user = await member(c);
    return c.json({ items: await svc.myApplications(c.env, user.id) });
  } catch (e) { return fail(c, e); }
});

testing.post('/programmes/:uid/apply', async (c) => {
  try {
    const user = await member(c);
    return c.json({ application: await svc.apply(c.env, user, c.req.param('uid'), await body(c)) }, 201);
  } catch (e) { return fail(c, e); }
});

testing.post('/applications/:uid/withdraw', async (c) => {
  try {
    const user = await member(c);
    return c.json({ application: await svc.withdraw(c.env, user.id, c.req.param('uid')) });
  } catch (e) { return fail(c, e); }
});

testing.get('/summary', async (c) => {
  try {
    const user = await member(c);
    return c.json(await svc.summary(c.env, user));
  } catch (e) { return fail(c, e); }
});

// ---------------------------------------------------------------------------
// Owners: a partner's firm, or HQ. The same routes on both routers.
// ---------------------------------------------------------------------------

type Acting = (c: C) => Promise<{ user: User; owner: Owner }>;

const applicantsOf = (acting: Acting) => async (c: C) => {
  try {
    const { owner } = await acting(c);
    return c.json(await svc.applicants(c.env, owner, c.req.param('uid')));
  } catch (e) { return fail(c, e); }
};

const create = (acting: Acting) => async (c: C) => {
  try {
    const { user, owner } = await acting(c);
    return c.json({ programme: await svc.createProgramme(c.env, owner, user.id, await body(c)) }, 201);
  } catch (e) { return fail(c, e); }
};

const edit = (acting: Acting) => async (c: C) => {
  try {
    const { user, owner } = await acting(c);
    return c.json({ programme: await svc.editProgramme(c.env, owner, user.id, c.req.param('uid'), await body(c)) });
  } catch (e) { return fail(c, e); }
};

const decide = (acting: Acting, decision: 'pick' | 'decline') => async (c: C) => {
  try {
    const { user, owner } = await acting(c);
    return c.json({ application: await svc.decide(c.env, owner, user.id, c.req.param('uid'), decision) });
  } catch (e) { return fail(c, e); }
};

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

export const partnerTesting = new Hono<{ Bindings: Env }>();

const actingPartner: Acting = async (c) => {
  const user = (await requireAuth(c)) as User;
  requirePartnerRole(user);
  const partner = await requirePartnerProfile(c.env, user);
  return { user, owner: { kind: 'partner', partnerId: Number(partner.id) } };
};

partnerTesting.get('/programmes', async (c) => {
  try {
    const { owner } = await actingPartner(c);
    return c.json({ items: await svc.ownerProgrammes(c.env, owner) });
  } catch (e) { return fail(c, e); }
});

partnerTesting.post('/programmes/:uid/submit', async (c) => {
  try {
    const { user, owner } = await actingPartner(c);
    return c.json({ programme: await svc.submitProgramme(c.env, owner, user.id, c.req.param('uid')) });
  } catch (e) { return fail(c, e); }
});

partnerTesting.post('/programmes', create(actingPartner));
partnerTesting.patch('/programmes/:uid', edit(actingPartner));
partnerTesting.get('/programmes/:uid/applicants', applicantsOf(actingPartner));
partnerTesting.post('/applications/:uid/pick', decide(actingPartner, 'pick'));
partnerTesting.post('/applications/:uid/decline', decide(actingPartner, 'decline'));

// ---------------------------------------------------------------------------
// HQ (Super Admin)
// ---------------------------------------------------------------------------

export const adminTesting = new Hono<{ Bindings: Env }>();

const actingHq: Acting = async (c) => {
  const user = (await requireSuperAdmin(c)) as User;
  return { user, owner: { kind: 'hq' } };
};

adminTesting.get('/programmes', async (c) => {
  try {
    await actingHq(c);
    return c.json({ items: await svc.allProgrammes(c.env, c.req.query('status') || null) });
  } catch (e) { return fail(c, e); }
});

adminTesting.post('/programmes/:uid/approve', async (c) => {
  try {
    const { user } = await actingHq(c);
    return c.json({ programme: await svc.reviewProgramme(c.env, user.id, c.req.param('uid'), 'approve', (await body(c)).note) });
  } catch (e) { return fail(c, e); }
});

adminTesting.post('/programmes/:uid/reject', async (c) => {
  try {
    const { user } = await actingHq(c);
    return c.json({ programme: await svc.reviewProgramme(c.env, user.id, c.req.param('uid'), 'reject', (await body(c)).note) });
  } catch (e) { return fail(c, e); }
});

adminTesting.post('/programmes/:uid/open', async (c) => {
  try {
    const { user } = await actingHq(c);
    return c.json({ programme: await svc.openProgramme(c.env, user.id, c.req.param('uid')) });
  } catch (e) { return fail(c, e); }
});

adminTesting.post('/programmes/:uid/close', async (c) => {
  try {
    const { user } = await actingHq(c);
    return c.json({ programme: await svc.closeProgramme(c.env, user.id, c.req.param('uid')) });
  } catch (e) { return fail(c, e); }
});

adminTesting.post('/programmes', create(actingHq));
adminTesting.patch('/programmes/:uid', edit(actingHq));
adminTesting.get('/programmes/:uid/applicants', applicantsOf(actingHq));
adminTesting.post('/applications/:uid/pick', decide(actingHq, 'pick'));
adminTesting.post('/applications/:uid/decline', decide(actingHq, 'decline'));

export default testing;
