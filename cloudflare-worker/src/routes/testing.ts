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
 *                         send back, open, move to testing and close (D1198:
 *                         each answers `told`, counts only), withdraw an
 *                         application with a reason, and HQ's own programmes
 *                         with the partner's create, edit and pick.
 *                         D1197: any programme's history and applicants (a
 *                         partner's read only), and every application across programmes.
 *
 * Lists are `{ items }`; a refusal is `{ error, detail }` with the service's
 * sentence. Another firm's programme or application is 404, as a missing one.
 *
 * D1199 (#3149): the programme's logo (`services/testingLogo.ts`).
 *   PUT    /api/partner/testing/programmes/:uid/logo   multipart `file`: a square PNG or SVG
 *   DELETE /api/partner/testing/programmes/:uid/logo
 *   PUT    /api/admin/testing/programmes/:uid/logo     the same, on HQ's own programmes
 *   DELETE /api/admin/testing/programmes/:uid/logo
 *   GET    /api/testing/programmes/:uid/logo           the image, nosniff and cached; a missing logo is 404
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { isSuperAdmin, requireAuth, requireSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
import { isPartner } from './_t13t14t15_helpers';
import { mapError, requirePartnerProfile } from './_t13t14t15_helpers';
import { requirePartnerRole } from './_partner_workspace_helpers';
import { refusalBody } from '../util/refusal';
import * as svc from '../services/testing';
import type { Owner } from '../services/testing';
import { putLogo, readLogo, removeLogo, uploadedBytes } from '../services/testingLogo';

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

// D1199: a programme's logo, for any signed-in reader who may see the programme.
testing.get('/programmes/:uid/logo', async (c) => {
  try {
    const user = await member(c);
    const owner: Owner | null = isPartner(user) && user.partner_id ? { kind: 'partner', partnerId: Number(user.partner_id) } : null;
    const logo = await readLogo(c.env, { owner, superAdmin: isSuperAdmin(user as any) && !branchOf(c.env) }, c.req.param('uid'));
    if (!logo) return c.json(refusalBody({ code: 'not_found', message: 'No logo.' }), 404);
    return new Response(logo.body, { headers: {
      'Content-Type': logo.contentType,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // An SVG opened on its own runs nothing and reaches nothing.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    } });
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

const uploadLogo = (acting: Acting) => async (c: C) => {
  try {
    const { user, owner } = await acting(c);
    const form = await c.req.formData().catch(() => null);
    return c.json({ logo: await putLogo(c.env, owner, user.id, c.req.param('uid'), await uploadedBytes(form)) });
  } catch (e) { return fail(c, e); }
};

const deleteLogo = (acting: Acting) => async (c: C) => {
  try {
    const { user, owner } = await acting(c);
    return c.json({ logo: await removeLogo(c.env, owner, user.id, c.req.param('uid')) });
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
partnerTesting.put('/programmes/:uid/logo', uploadLogo(actingPartner));
partnerTesting.delete('/programmes/:uid/logo', deleteLogo(actingPartner));
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
    return c.json(await svc.openProgramme(c.env, user.id, c.req.param('uid')));
  } catch (e) { return fail(c, e); }
});

adminTesting.post('/programmes/:uid/close', async (c) => {
  try {
    const { user } = await actingHq(c);
    return c.json(await svc.closeProgramme(c.env, user.id, c.req.param('uid')));
  } catch (e) { return fail(c, e); }
});

// D1198 (#3148): open or closed → testing; the firm and the picked testers told.
adminTesting.post('/programmes/:uid/testing', async (c) => {
  try {
    const { user } = await actingHq(c);
    return c.json(await svc.startTesting(c.env, user.id, c.req.param('uid')));
  } catch (e) { return fail(c, e); }
});

// D1198: HQ withdraws an application with the reason the member reads.
adminTesting.post('/applications/:uid/withdraw', async (c) => {
  try {
    const { user } = await actingHq(c);
    return c.json(await svc.withdrawByHq(c.env, user.id, c.req.param('uid'), (await body(c)).reason));
  } catch (e) { return fail(c, e); }
});

adminTesting.post('/programmes', create(actingHq));
adminTesting.patch('/programmes/:uid', edit(actingHq));
// D1197 (#3147): HQ reads any programme's applicants; a partner's answer
// `can_decide: false`, and pick and decline below still reach HQ's own only.
adminTesting.get('/programmes/:uid/applicants', async (c) => {
  try {
    await actingHq(c);
    return c.json(await svc.hqApplicants(c.env, c.req.param('uid')));
  } catch (e) { return fail(c, e); }
});

// D1197: a programme's history, newest first, paged; names, never an address.
adminTesting.get('/programmes/:uid/events', async (c) => {
  try {
    await actingHq(c);
    return c.json(await svc.programmeEvents(c.env, c.req.param('uid'), { page: c.req.query('page'), page_size: c.req.query('page_size') }));
  } catch (e) { return fail(c, e); }
});

// D1197: every application across programmes, paged and filtered (TST8).
adminTesting.get('/applications', async (c) => {
  try {
    await actingHq(c);
    const q = (k: string) => c.req.query(k);
    return c.json(await svc.allApplications(c.env, {
      programme: q('programme'), owner: q('owner'), status: q('status'), role: q('role'), consented: q('consented'),
      tester: q('tester'), q: q('q'), sort: q('sort'), page: q('page'), page_size: q('page_size'),
    }));
  } catch (e) { return fail(c, e); }
});

// D1199 (#3149): HQ's own programme's logo.
adminTesting.put('/programmes/:uid/logo', uploadLogo(actingHq));
adminTesting.delete('/programmes/:uid/logo', deleteLogo(actingHq));
adminTesting.post('/applications/:uid/pick', decide(actingHq, 'pick'));
adminTesting.post('/applications/:uid/decline', decide(actingHq, 'decline'));

export default testing;
