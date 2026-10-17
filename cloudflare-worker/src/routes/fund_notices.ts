/**
 * D716 (#1781, PR 1) — fund notices, mounted at /api/fund-notices.
 *
 * An Admin on HQ (a branch answers `HQ only`; a support session is refused):
 *   GET  /types                       the notice types
 *   POST /preview                     {type, source, inputs, page_size}         fund_notice.preview
 *   POST /calls/:callUid/preview      each line's figures, one digest           fund_notice.preview
 *   GET  /                            the notices
 *   GET  /:uid                        one notice's figures
 *   GET  /:uid/pdf                    its kept PDF
 *
 * The Super Admin (the act answers `super_admin_required` before any TOTP or
 * step-up demand, then the write bar):
 *   POST /issue                       {type, source, inputs, page_size, figures_sha256, reason?}  fund_notice.issue
 *   POST /calls/:callUid/issue        {page_size, digest}                                         fund_notice.issue
 *
 * The LP (only notices addressed to their own `limited_partners` row; anyone
 * else, admins included, gets 404):
 *   GET  /mine                        type, title, reference, amount, date, superseded, instructions_changed
 *   GET  /mine/:uid                   the masked figures
 *   GET  /mine/:uid/pdf               the kept PDF
 *
 * A preview answers fonts omitted, Draft, `no-store`. A PDF answers
 * `private, no-store` with a `[A-Za-z0-9_-]` filename. Every refusal goes
 * through `refuse()` with a code and echoes no input.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth } from '../auth';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, stepUpRefusalBody } from '../util/authErrors';
import { HQ_ONLY, branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import { SUPPORT_SESSION_REFUSED_CODE, assertAdminAct, isSupportSession } from '../services/fundAdminAccess';
import { NOTICE_TYPES, NoticeRefusal, buildNoticeFigures, figuresDigest, noticePaperInput, type NoticeFigures } from '../services/fundNotices';
import {
  issueCallNotices, issueNotice, listNotices, myNotice, myNotices, noticeFile, noticeSummary, previewCallNotices, readNotice,
  type NoticeRow,
} from '../services/fundNoticeStore';
import { paperHtml, paperModel, paperSha256 } from '../services/legalPaper';
import { readPaperChoice } from '../services/legalPaperCss';
import { payInstructionsFor, type PaymentPurpose } from '../services/payInstructions';
import type { AxalEntityKey } from '../services/legalDocFormat';

const r = new Hono<{ Bindings: Env }>();

r.onError((error: any, c) => {
  if (error instanceof Response) return error;
  if (error instanceof NoticeRefusal) return refuse(c, error.status, { code: error.code, message: error.publicMessage, extra: error.extra });
  if (error?.message === STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(error), 403);
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) {
    const sentence = error?.message === HQ_ONLY
      ? 'HQ only: fund notices are issued on HQ, not on a branch.'
      : 'This account cannot use fund notices.';
    return refuse(c, status, { code: error?.message === HQ_ONLY ? 'hq_only' : 'fund_notices_refused', message: sentence });
  }
  return refuse(c, 503, { code: 'fund_notices_unreadable', message: 'Unreadable: the notice could not be read or saved. Try again.', raw: error });
});

const body = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const today = () => new Date().toISOString().slice(0, 10);

/** An Admin, on HQ, not in a support session. */
async function admin(c: any) {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  if (await isSupportSession(c)) {
    throw new NoticeRefusal(403, SUPPORT_SESSION_REFUSED_CODE, 'A support session cannot read or issue fund notices.');
  }
  return user;
}

const notFound = () => new NoticeRefusal(404, 'notice_not_found', 'No notice here.');

function pdfResponse(file: { bytes: Uint8Array; filename: string }) {
  return new Response(file.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

/** The figures as an LP or an admin reads them: masked by construction (no number is ever stored). */
function figuresOf(n: NoticeRow): NoticeFigures {
  return JSON.parse(n.figures_json) as NoticeFigures;
}

/** True when the account a notice froze is no longer the resolver's answer. */
async function instructionsChanged(c: any, n: NoticeRow): Promise<boolean> {
  if (!n.bank_account_uid || !n.payee_entity || !n.purpose) return false;
  const now = await payInstructionsFor(c.env, n.payee_entity as AxalEntityKey, n.purpose as PaymentPurpose);
  return !now.ok || now.instructions.uid !== n.bank_account_uid;
}

// ── An Admin on HQ ──────────────────────────────────────────────────────────

r.get('/types', async (c) => {
  await admin(c);
  return c.json({ types: NOTICE_TYPES.map((t) => ({ type: t.type, title: t.title, sender: t.sender })) });
});

r.post('/preview', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'fund_notice.preview');
  const b = await body(c);
  const paper = readPaperChoice(b.page_size, null);
  if (!paper.ok) throw new NoticeRefusal(400, paper.code, 'page_size must be letter or a4.');
  const built = await buildNoticeFigures(c.env, { type: b.type, source: b.source, inputs: b.inputs }, today());
  const html = paperHtml(paperModel(noticePaperInput(built.figures)), { pageSize: paper.pageSize, cover: 'light', medium: 'screen', fonts: 'omit' });
  c.header('Cache-Control', 'no-store');
  return c.json({
    html, paper_sha256: await paperSha256(), figures: built.figures, figures_sha256: await figuresDigest(built.figures),
    refusal: built.refusal,
  });
});

r.post('/calls/:callUid/preview', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'fund_notice.preview');
  const out = await previewCallNotices(c.env, c.req.param('callUid'), today());
  c.header('Cache-Control', 'no-store');
  return c.json(out);
});

r.post('/issue', async (c) => {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  await assertAdminAct(c, user, 'fund_notice.issue');
  const b = await body(c);
  const out = await issueNotice(c.env, user, b, today());
  return c.json({ already_issued: out.already_issued, notice: noticeSummary({ ...out.notice, superseded: 0 }) }, out.already_issued ? 200 : 201);
});

r.post('/calls/:callUid/issue', async (c) => {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  await assertAdminAct(c, user, 'fund_notice.issue');
  const out = await issueCallNotices(c.env, user, c.req.param('callUid'), await body(c), today());
  return c.json({ already_issued: out.already_issued, notices: out.notices.map((n) => noticeSummary({ ...n, superseded: 0 })) }, out.already_issued ? 200 : 201);
});

// ── The LP ──────────────────────────────────────────────────────────────────
// Registered before `/:uid`, so `mine` is never read as a notice uid.

r.get('/mine', async (c) => {
  const user = await requireAuth(c);
  const rows = await myNotices(c.env, { id: Number(user.id), email: user.email });
  const notices = [];
  for (const n of rows) notices.push({ ...noticeSummary(n), instructions_changed: await instructionsChanged(c, n) });
  c.header('Cache-Control', 'no-store');
  return c.json({ notices });
});

r.get('/mine/:uid', async (c) => {
  const user = await requireAuth(c);
  const n = await myNotice(c.env, { id: Number(user.id), email: user.email }, c.req.param('uid'));
  if (!n) throw notFound();
  c.header('Cache-Control', 'no-store');
  return c.json({ ...noticeSummary(n), instructions_changed: await instructionsChanged(c, n), figures: figuresOf(n) });
});

r.get('/mine/:uid/pdf', async (c) => {
  const user = await requireAuth(c);
  const n = await myNotice(c.env, { id: Number(user.id), email: user.email }, c.req.param('uid'));
  if (!n) throw notFound();
  return pdfResponse(await noticeFile(c.env, n));
});

// ── An Admin on HQ: the records ─────────────────────────────────────────────

r.get('/', async (c) => {
  await admin(c);
  const fundId = Number(c.req.query('fund_id')) || null;
  const lpId = Number(c.req.query('lp_id')) || null;
  c.header('Cache-Control', 'no-store');
  return c.json({ notices: await listNotices(c.env, { fund_id: fundId, lp_id: lpId }) });
});

r.get('/:uid', async (c) => {
  await admin(c);
  const n = await readNotice(c.env, c.req.param('uid'));
  if (!n) throw notFound();
  c.header('Cache-Control', 'no-store');
  return c.json({ ...noticeSummary(n), reason: n.reason, figures: figuresOf(n), figures_sha256: n.figures_sha256 });
});

r.get('/:uid/pdf', async (c) => {
  await admin(c);
  const n = await readNotice(c.env, c.req.param('uid'));
  if (!n) throw notFound();
  return pdfResponse(await noticeFile(c.env, n));
});

export default r;
