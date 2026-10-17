/**
 * D712 (#1777) — the fund reporting queue, mounted at /api/fund-reporting.
 *
 *   GET  /drafts                  the queue, never a figure or a digest
 *   GET  /drafts/:uid             the figures and digest, after a `viewed` row
 *   GET  /drafts/:uid/export      a CSV, after an `exported` row
 *   POST /build                   {kind, period_label, fund_id?}: a closed period's missing drafts
 *   POST /drafts/:uid/rebuild     a draft or prepared pack, as its next revision
 *   POST /drafts/:uid/prepare     {figures_sha256, note?}
 *   POST /drafts/:uid/return      {reason}
 *   POST /drafts/:uid/correct     an issued pack, as a correcting draft pack
 *   POST /drafts/:uid/issue       {figures_sha256, acknowledgement?}: a Super Admin only
 *
 * Every route is an Admin's (any `role = 'admin'` account on HQ), and HQ's
 * only: a branch answers `HQ only`. Only a Super Admin issues, behind
 * `requireSuperAdminWriteBar`; an Admin without the elevation is refused with
 * `super_admin_required` first, before any TOTP or step-up demand, and nothing
 * is written. A support session neither prepares nor issues (decision 2).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin, requireSuperAdminWriteBar, selectJwt } from '../auth';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, stepUpRefusalBody } from '../util/authErrors';
import { HQ_ONLY, branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import {
  DraftRefusal, buildPeriod, correctDraft, issueDraft, listDrafts, prepareDraft, readDraft, rebuildDraft, returnDraft,
} from '../services/fundReportDrafts';

const r = new Hono<{ Bindings: Env }>();

r.onError((error: any, c) => {
  if (error instanceof Response) return error;
  if (error instanceof DraftRefusal) return refuse(c, error.status, { code: error.code, message: error.publicMessage });
  if (error?.message === STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(error), 403);
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) return refuse(c, status, { code: 'fund_reporting_refused', message: error.message });
  return refuse(c, 503, { code: 'fund_reporting_unreadable', message: 'Unreadable: the reporting queue could not be read or saved. Try again.', raw: error });
});

/** An Admin, on HQ. */
async function admin(c: any) {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  return user;
}

/** A support session (a token carrying `impersonated_by`) cannot prepare or issue. */
async function refuseSupportSession(c: any) {
  if ((await selectJwt(c))?.payload?.impersonated_by) {
    throw new DraftRefusal(403, 'support_session', 'A support session cannot prepare or issue a report.');
  }
}

const body = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const today = () => new Date().toISOString().slice(0, 10);

r.get('/drafts', async (c) => {
  await admin(c);
  const q = c.req.query();
  return c.json(await listDrafts(c.env, { kind: q.kind, status: q.status, fund_id: q.fund_id, entity_key: q.entity_key, period: q.period }));
});

r.get('/drafts/:uid', async (c) => {
  const user = await admin(c);
  return c.json(await readDraft(c.env, c.req.param('uid'), { id: Number(user.id), email: user.email }, 'viewed'));
});

// ── The export ──────────────────────────────────────────────────────────────

/** A quoted cell. Text a spreadsheet would run as a formula is defused with a leading `'`. */
function cell(value: unknown, text: boolean): string {
  let s = value == null ? '' : String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Every leaf of the frozen figures as one row: path, value, and the reason a missing line gives. */
function rowsOf(value: unknown, path: string[] = [], out: string[][] = []): string[][] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if ('cents' in v && Object.keys(v).every((k) => k === 'cents' || k === 'reason')) {
      out.push([path.join('.'), v.cents == null ? '' : String(v.cents), typeof v.reason === 'string' ? v.reason : '']);
      return out;
    }
    for (const [k, child] of Object.entries(v)) rowsOf(child, [...path, k], out);
    return out;
  }
  if (Array.isArray(value)) { value.forEach((child, i) => rowsOf(child, [...path, String(i)], out)); return out; }
  out.push([path.join('.'), value == null ? '' : String(value), '']);
  return out;
}

export function draftCsv(draft: { status: string; kind: string; period_label: string; uid: string }, figures: unknown): string {
  const lines: string[] = [];
  if (draft.status !== 'issued') lines.push(cell('DRAFT, not issued', true));
  lines.push(['field', 'value', 'note'].map((h) => cell(h, true)).join(','));
  for (const [field, value, note] of rowsOf(figures)) {
    const numeric = /^-?\d+(\.\d+)?$/.test(value);
    lines.push([cell(field, true), numeric ? cell(value, false) : cell(value, true), cell(note, true)].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

r.get('/drafts/:uid/export', async (c) => {
  const user = await admin(c);
  const read = await readDraft(c.env, c.req.param('uid'), { id: Number(user.id), email: user.email }, 'exported');
  const name = `${read.draft.kind}-${read.draft.period_label}-${read.draft.uid}`.replace(/[^A-Za-z0-9_-]+/g, '-');
  return new Response(draftCsv(read.draft, read.figures), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'no-store' },
  });
});

// ── Writes ──────────────────────────────────────────────────────────────────

r.post('/build', async (c) => {
  const user = await admin(c);
  return c.json(await buildPeriod(c.env, await body(c), Number(user.id), today()), 201);
});

r.post('/drafts/:uid/rebuild', async (c) => {
  const user = await admin(c);
  return c.json(await rebuildDraft(c.env, c.req.param('uid'), Number(user.id)));
});

r.post('/drafts/:uid/prepare', async (c) => {
  const user = await admin(c);
  await refuseSupportSession(c);
  return c.json(await prepareDraft(c.env, c.req.param('uid'), Number(user.id), await body(c)));
});

r.post('/drafts/:uid/return', async (c) => {
  const user = await admin(c);
  return c.json(await returnDraft(c.env, c.req.param('uid'), Number(user.id), await body(c)));
});

r.post('/drafts/:uid/correct', async (c) => {
  const user = await admin(c);
  return c.json(await correctDraft(c.env, c.req.param('uid'), Number(user.id)), 201);
});

r.post('/drafts/:uid/issue', async (c) => {
  const user = await admin(c);
  // The elevation first: an Admin without it is never asked for a code it cannot use.
  if (!isSuperAdmin(user as any)) return c.json({ code: 'super_admin_required', detail: 'Super admin required' }, 403);
  await refuseSupportSession(c);
  const issuer = await requireSuperAdminWriteBar(c);
  return c.json(await issueDraft(c.env, c.req.param('uid'), Number(issuer.id), await body(c)));
});

export default r;
