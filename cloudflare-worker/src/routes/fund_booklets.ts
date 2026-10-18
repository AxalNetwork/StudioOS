/**
 * D716 (#1781, PR 2) — the Subscription Booklet, mounted at /api/fund-booklets.
 *
 * The applicant (the user of an `approved` Fund I `lp_applications` row;
 * anyone else gets 404):
 *   POST /mine                 opens the booklet, or returns the live one
 *   GET  /mine                 the parts, the fields with their ticks, and the digest of what it shows
 *   GET  /mine/paper           the booklet on #1776's paper, as screen HTML (faces inline), no-store
 *   PUT  /mine/answers         {answers: [{field_id, checked}]}: 400 field_unknown, 409 booklet_not_open
 *   POST /mine/submit          {digest}: 409 booklet_part_missing or content_changed
 *   POST /mine/sign            D759: sends the submitted booklet for the applicant's e-signature
 *                              (Parts 3 to 8) and answers the signing token to its recipient, no-store
 *
 * An Admin on HQ (a branch answers `HQ only`; a support session is refused):
 *   GET  /                     the booklets, never a tick        fund_booklet.read
 *   GET  /:uid                 one booklet with its ticks, audited fund_booklet.read
 *   GET  /:uid/pdf             its PDF, drawn on request, never kept, audited   fund_booklet.read
 *   POST /:uid/withdraw        {reason}: 10 to 200 characters     fund_booklet.withdraw
 *                              (409 booklet_accepted; voids the booklet's pending envelopes)
 *   POST /:uid/acceptance      D759: sends the General Partner's stage (Part 9) again   fund_booklet.accept
 *
 * The PDF goes through #1776's `renderLegalPdf(…, { fallback: false })`, never
 * pdf-lib: a failed call answers 503 `booklet_render_unavailable`. Every
 * refusal goes through `refuse()` with a code and echoes no input.
 *
 * D759 (#1858): a submitted booklet's paper prints its frozen text, and the
 * Structure of the Fund page names the receiving accounts only once the
 * General Partner has accepted (`bookletAudience`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth } from '../auth';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, stepUpRefusalBody } from '../util/authErrors';
import { HQ_ONLY, branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import { SUPPORT_SESSION_REFUSED_CODE, assertAdminAct, auditFundAct, isSupportSession } from '../services/fundAdminAccess';
import {
  BookletRefusal, answerBooklet, bookletAudience, bookletByUid, bookletPaperInput, bookletSigning, bookletView, listBooklets,
  mineOrNull, openBooklet, readAnswers, submitBooklet, withdrawBooklet,
} from '../services/subscriptionBooklet';
import { sendApplicantStage, sendGpStage } from '../services/bookletSigning';
import { clientIp } from '../util/clientIp';
import { paperHtml, paperModel } from '../services/legalPaper';
import { structureForPaper } from '../services/fundStructure';
import { readPaperChoice } from '../services/legalPaperCss';
import { renderLegalPdf } from '../services/legalPaperRender';

const r = new Hono<{ Bindings: Env }>();

r.onError((error: any, c) => {
  if (error instanceof Response) return error;
  if (error instanceof BookletRefusal) {
    return refuse(c, error.status, { code: error.code, message: error.publicMessage, extra: error.extra });
  }
  if (error?.message === STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(error), 403);
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) {
    const sentence = error?.message === HQ_ONLY
      ? 'HQ only: subscription booklets are administered on HQ, not on a branch.'
      : 'This account cannot use subscription booklets.';
    return refuse(c, status, { code: error?.message === HQ_ONLY ? 'hq_only' : 'fund_booklets_refused', message: sentence });
  }
  return refuse(c, 503, { code: 'fund_booklets_unreadable', message: 'Unreadable: the booklet could not be read or saved. Try again.', raw: error });
});

const body = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

/** A support session never writes an applicant's booklet. */
async function refuseSupportSession(c: any) {
  if (await isSupportSession(c)) {
    throw new BookletRefusal(403, SUPPORT_SESSION_REFUSED_CODE, 'A support session cannot answer or submit a booklet.');
  }
}

/** An Admin, on HQ. */
async function admin(c: any) {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  return user;
}

const missing = () => new BookletRefusal(404, 'booklet_not_found', 'No subscription booklet here.');

/** `?page=letter|a4` and `?cover=dark|light`. */
function paperChoice(c: any) {
  const paper = readPaperChoice(c.req.query('page'), c.req.query('cover'));
  if (!paper.ok) throw new BookletRefusal(400, paper.code, 'page must be letter or a4, and cover dark or light.');
  return paper;
}

// ── The applicant ───────────────────────────────────────────────────────────

r.post('/mine', async (c) => {
  const user = await requireAuth(c);
  await refuseSupportSession(c);
  const { booklet, created } = await openBooklet(c.env, Number(user.id));
  c.header('Cache-Control', 'no-store');
  return c.json(await bookletView(c.env, booklet), created ? 201 : 200);
});

r.get('/mine', async (c) => {
  const user = await requireAuth(c);
  const booklet = await mineOrNull(c.env, Number(user.id));
  if (!booklet) throw missing();
  c.header('Cache-Control', 'no-store');
  return c.json(await bookletView(c.env, booklet));
});

r.get('/mine/paper', async (c) => {
  const user = await requireAuth(c);
  const paper = paperChoice(c);
  const booklet = await mineOrNull(c.env, Number(user.id));
  if (!booklet) throw missing();
  const input = await bookletPaperInput(c.env, booklet);
  // D717 — the booklet's Structure of the Fund page, after Part 2; its
  // accounts once the General Partner has accepted (D759).
  const structure = await structureForPaper(c.env, input.slug, await bookletAudience(c.env, booklet));
  const html = paperHtml(paperModel({ ...input, structure }), { pageSize: paper.pageSize, cover: paper.cover, medium: 'screen', fonts: 'inline' });
  c.header('Cache-Control', 'no-store');
  return c.json({ html, digest: input.bodySha256, page_size: paper.pageSize });
});

r.put('/mine/answers', async (c) => {
  const user = await requireAuth(c);
  await refuseSupportSession(c);
  const booklet = await mineOrNull(c.env, Number(user.id));
  if (!booklet) throw missing();
  await answerBooklet(c.env, booklet, Number(user.id), readAnswers(await body(c)));
  c.header('Cache-Control', 'no-store');
  return c.json(await bookletView(c.env, booklet));
});

r.post('/mine/submit', async (c) => {
  const user = await requireAuth(c);
  await refuseSupportSession(c);
  const booklet = await mineOrNull(c.env, Number(user.id));
  if (!booklet) throw missing();
  const out = await submitBooklet(c.env, booklet, (await body(c)).digest);
  return c.json({ uid: booklet.uid, status: 'submitted', ...out });
});

// D759 — the applicant sends their submitted booklet for signature. The
// caller is the one recipient, signed in, so the token comes back to them
// (and by email); it is never logged or audited.
r.post('/mine/sign', async (c) => {
  const user = await requireAuth(c);
  await refuseSupportSession(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  const booklet = await mineOrNull(c.env, Number(user.id));
  if (!booklet) throw missing();
  const out = await sendApplicantStage(c.env, user, booklet, c.env.APP_URL || 'https://axal.vc', clientIp(c.req.raw));
  c.header('Cache-Control', 'no-store');
  return c.json({ uid: booklet.uid, stage: 'applicant', envelope_uuid: out.envelope_uuid, token: out.token }, 201);
});

// ── The Admin, on HQ ────────────────────────────────────────────────────────

r.get('/', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'fund_booklet.read');
  c.header('Cache-Control', 'no-store');
  return c.json({ booklets: await listBooklets(c.env) });
});

r.get('/:uid', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'fund_booklet.read');
  const booklet = await bookletByUid(c.env, c.req.param('uid'));
  if (!booklet) throw missing();
  const view = await bookletView(c.env, booklet);
  // Opening a booklet's ticks is audited (decision 9).
  await auditFundAct(c.env, user, 'fund_booklet.read', { booklet_uid: booklet.uid, status: booklet.status });
  c.header('Cache-Control', 'no-store');
  return c.json({ ...view, gp_sent: (await bookletSigning(c.env, booklet)).gp_sent, withdrawn_reason: booklet.withdrawn_reason });
});

r.get('/:uid/pdf', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'fund_booklet.read');
  const paper = paperChoice(c);
  const booklet = await bookletByUid(c.env, c.req.param('uid'));
  if (!booklet) throw missing();
  const input = await bookletPaperInput(c.env, booklet);
  const structure = await structureForPaper(c.env, input.slug, await bookletAudience(c.env, booklet));
  const rendered = await renderLegalPdf(c.env, paperModel({ ...input, structure }),
    { pageSize: paper.pageSize, cover: paper.cover, fallback: false });
  if (!rendered.ok) {
    throw new BookletRefusal(503, 'booklet_render_unavailable', 'The booklet could not be printed just now. Try again.');
  }
  // The PDF carries the ticks, so reading it is audited as reading them is.
  await auditFundAct(c.env, user, 'fund_booklet.read', { booklet_uid: booklet.uid, status: booklet.status, pdf: true });
  return new Response(rendered.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="subscription-booklet-${booklet.uid.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

r.post('/:uid/withdraw', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'fund_booklet.withdraw');
  const booklet = await bookletByUid(c.env, c.req.param('uid'));
  if (!booklet) throw missing();
  await withdrawBooklet(c.env, booklet, Number(user.id), (await body(c)).reason);
  await auditFundAct(c.env, user, 'fund_booklet.withdraw', { booklet_uid: booklet.uid });
  return c.json({ uid: booklet.uid, status: 'withdrawn' });
});

// D759 — a Super Admin sends the General Partner's stage again (the hook
// sends it when the applicant signs). No token: it goes to the GP's inbox.
r.post('/:uid/acceptance', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'fund_booklet.accept');
  const booklet = await bookletByUid(c.env, c.req.param('uid'));
  if (!booklet) throw missing();
  const out = await sendGpStage(c.env, booklet, c.env.APP_URL || 'https://axal.vc');
  await auditFundAct(c.env, user, 'fund_booklet.accept', { booklet_uid: booklet.uid, envelope_uuid: out.envelope_uuid });
  return c.json({ uid: booklet.uid, stage: 'gp', envelope_uuid: out.envelope_uuid }, 201);
});

export default r;
