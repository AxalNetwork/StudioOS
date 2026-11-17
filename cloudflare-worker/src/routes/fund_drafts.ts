/**
 * #6252 (D6252): Eadwyn's two drafts on the fund pages, mounted at `/api/funds` ahead of `funds.ts`.
 *
 *   POST /api/funds/:id/drafts/brief                          the fund brief, from the fund's recorded facts
 *   POST /api/funds/:id/report-periods/:periodId/drafts/letter the letter's opening, from the period's capital movements
 *   POST /api/funds/:id/notes/brief                           Accept: keep a drafted brief as the fund's note
 *   GET  /api/funds/:id/notes/brief                           the newest kept brief, or null
 *
 * THE GP GATE. Both run behind `requireFundGp`, the gate every fund write uses: an LP or a reader who cannot manage
 * the fund is answered 404, as the fund's other operations answer them. The letter's period must be a draft of
 * this fund; an issued period is refused, since nothing may be written into it.
 *
 * THE NOTE (owner's Q1 answer A). Accept on the brief writes one `fund_notes` row: the paragraph and the sources it
 * cites, re-matched against the fund's recorded facts as read now, so a note can only cite this fund's own records.
 * It changes no fund record. Everyone who can manage the fund reads the newest one.
 *
 * NOTHING ELSE IS WRITTEN. Each draft answers the draft and the sources its [n] numbers cite, and stores nothing: the letter's
 * Accept inserts the paragraph into the page's unsaved editor, and the GP saves or issues it with the page's own
 * buttons. The run is metered through `run()` like every Eadwyn draft (the member's budget, usage row and rail
 * context), and refused before the model is called when there is nothing recorded to draft from.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { run as runAI } from '../services/aiRouter';
import { requireFundGp } from '../services/fundGpAccess';
import { readFundPage } from '../services/fundReports';
import { BRIEF_INSTRUCTION, LETTER_INSTRUCTION, briefMaterial, letterMaterial } from '../services/fundDrafts';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import funds from './funds';

/** The model call, replaceable in tests (as `MATCH_DEPS` is for the Grow rank). */
export const FUND_DRAFT_DEPS = { run: runAI };

export const FUND_DRAFT_SENTENCES = {
  brief_nothing: 'This fund has no recorded facts beyond its name, so there is nothing to draft from.',
  letter_dates: "Record the period's start and end dates first: the letter is drafted from the movements between them.",
  letter_nothing: 'This period has no recorded capital calls or paid distributions, so there is nothing to draft from.',
  letter_issued: 'This period is issued. Its letter cannot change; issue a correcting period instead.',
  not_found: 'Fund or reporting period not found.',
  note_empty: 'There is no brief to keep. Draft the brief first.',
  note_long: 'The brief is longer than a fund note keeps (4,000 characters). Discard it and draft again.',
  note_sources: "The brief cites a record this fund does not hold, so it was not kept. Draft the brief again.",
  note_unreadable: 'The fund note could not be read just now.',
  unavailable: 'Eadwyn could not draft this just now. Nothing was written. Try again.',
} as const;

const id = (v: string | undefined) => (typeof v === 'string' && /^[1-9][0-9]{0,15}$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null);

async function gate(c: any) {
  const fundId = id(c.req.param('id'));
  if (!fundId) return { refusal: refuse(c, 404, { code: 'not_found', message: FUND_DRAFT_SENTENCES.not_found }) };
  try {
    const ctx = await requireFundGp(c, fundId);
    return { ctx };
  } catch (error: any) {
    if (error instanceof Response) {
      if (error.status === 404) return { refusal: refuse(c, 404, { code: 'not_found', message: FUND_DRAFT_SENTENCES.not_found }) };
      return { refusal: error };
    }
    const status = AUTH_ERROR_STATUSES[error?.message];
    if (status) return { refusal: refuse(c, status, { code: 'fund_access_refused', message: 'This account cannot access that fund operation.' }) };
    throw error;
  }
}

async function draft(c: any, userId: number, task: { instruction: string; lines: string[]; option: string; page: string; record: string }) {
  // The app path the band sits on, recorded as the run's surface (D404, D510); the router re-validates it.
  const body = await c.req.json().catch(() => ({}));
  const surface = typeof body?.page === 'string' ? body.page.slice(0, 200) : undefined;
  let out: any;
  try {
    out = await FUND_DRAFT_DEPS.run(c.env, {
      task: 'workspace_explain',
      userId,
      text: `${task.instruction}\n\n${task.lines.join('\n')}`,
      maxTokens: 450,
      surface,
      rail: railFor(c, { page: task.page, option: task.option }, task.record),
    });
  } catch (e) {
    console.error('[fund-drafts] draft failed:', (e as Error).message);
    return { response: refuse(c, 503, { code: 'draft_unavailable', message: FUND_DRAFT_SENTENCES.unavailable, raw: e }) };
  }
  // The switch (403 assist_off), the budget (402) and the guard answer in their own words (`runRefusalView`).
  const refused = out?.ok ? null : refuseRun(c, out ?? {});
  if (refused) return { response: refused };
  const text = out?.ok && typeof out.output === 'string' ? out.output.trim() : '';
  if (!text) return { response: refuse(c, 503, { code: 'draft_unavailable', message: FUND_DRAFT_SENTENCES.unavailable }) };
  return { text, model: out.usage?.model ?? null, cost_usd: Number.isFinite(out.usage?.est_cost_usd) ? out.usage.est_cost_usd : null };
}

const r = new Hono<{ Bindings: Env }>();

r.post('/:id/drafts/brief', async (c) => {
  const g = await gate(c);
  if (g.refusal) return g.refusal;
  const { ctx } = g as any;
  const page = await readFundPage(c.env, ctx.fund, true);
  const material = briefMaterial(page);
  if (!material) return refuse(c, 409, { code: 'nothing_to_draft', message: FUND_DRAFT_SENTENCES.brief_nothing });
  const d = await draft(c, ctx.user.id, { instruction: BRIEF_INSTRUCTION, lines: material.lines, option: 'draft:fund-brief', page: 'Investor · Fund', record: `fund:${ctx.fund.id}` });
  if (d.response) return d.response;
  return c.json({ draft: { kind: 'fund_brief', body: d.text, sources: material.sources, model: d.model, cost_usd: d.cost_usd, stored: false } });
});

r.post('/:id/report-periods/:periodId/drafts/letter', async (c) => {
  const g = await gate(c);
  if (g.refusal) return g.refusal;
  const { ctx } = g as any;
  const periodId = id(c.req.param('periodId'));
  const period = periodId
    ? await c.env.DB.prepare('SELECT id, period, period_start, period_end, status FROM fund_report_periods WHERE fund_id = ? AND id = ?')
      .bind(ctx.fund.id, periodId).first<{ id: number; period: string; period_start: string | null; period_end: string | null; status: string }>()
    : null;
  if (!period) return refuse(c, 404, { code: 'not_found', message: FUND_DRAFT_SENTENCES.not_found });
  if (period.status !== 'draft') return refuse(c, 409, { code: 'period_issued', message: FUND_DRAFT_SENTENCES.letter_issued });
  if (!period.period_start || !period.period_end) return refuse(c, 409, { code: 'period_dates', message: FUND_DRAFT_SENTENCES.letter_dates });
  const calls = await c.env.DB.prepare(
    `SELECT id, call_number, amount_cents, purpose, due_date, created_at FROM fund_capital_calls
      WHERE fund_id = ? AND date(created_at) BETWEEN date(?) AND date(?) ORDER BY created_at, id LIMIT 50`,
  ).bind(ctx.fund.id, period.period_start, period.period_end).all<any>();
  const dists = await c.env.DB.prepare(
    `SELECT id, amount_cents, distribution_type, distributed_at, created_at FROM fund_distributions
      WHERE fund_id = ? AND status = 'paid' AND date(COALESCE(distributed_at, created_at)) BETWEEN date(?) AND date(?)
      ORDER BY COALESCE(distributed_at, created_at), id LIMIT 500`,
  ).bind(ctx.fund.id, period.period_start, period.period_end).all<any>();
  const material = letterMaterial(period, calls.results || [], dists.results || []);
  if (!material) return refuse(c, 409, { code: 'nothing_to_draft', message: FUND_DRAFT_SENTENCES.letter_nothing });
  const d = await draft(c, ctx.user.id, { instruction: LETTER_INSTRUCTION, lines: material.lines, option: 'draft:letter-opening', page: 'Investor · Fund · Reporting', record: `fund_report_period:${period.id}` });
  if (d.response) return d.response;
  return c.json({ draft: { kind: 'letter_opening', body: d.text, sources: material.sources, model: d.model, cost_usd: d.cost_usd, stored: false } });
});

export const NOTE_MAX = 4000;

/** The brief's own cited records, matched against the fund's recorded facts as read now; null if any is foreign. */
export function matchNoteSources(submitted: unknown, current: Array<{ n: number; kind: string; ref: string; label: string; date: string | null }>) {
  if (!Array.isArray(submitted) || submitted.length > 50) return null;
  const byKey = new Map(current.map((s) => [`${s.kind}:${s.ref}`, s]));
  const out: typeof current = [];
  for (const s of submitted as any[]) {
    const hit = s && typeof s.kind === 'string' && typeof s.ref === 'string' ? byKey.get(`${s.kind}:${s.ref}`) : undefined;
    if (!hit || hit.n !== s.n) return null;
    out.push(hit);
  }
  return out;
}

r.post('/:id/notes/brief', async (c) => {
  const g = await gate(c);
  if (g.refusal) return g.refusal;
  const { ctx } = g as any;
  const input = await c.req.json().catch(() => ({}));
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!body) return refuse(c, 422, { code: 'note_empty', message: FUND_DRAFT_SENTENCES.note_empty });
  if (body.length > NOTE_MAX) return refuse(c, 422, { code: 'note_too_long', message: FUND_DRAFT_SENTENCES.note_long });
  const material = briefMaterial(await readFundPage(c.env, ctx.fund, true));
  const sources = matchNoteSources(input?.sources, material?.sources ?? []);
  if (!sources) return refuse(c, 422, { code: 'note_sources', message: FUND_DRAFT_SENTENCES.note_sources });
  const row = await c.env.DB.prepare(
    `INSERT INTO fund_notes (fund_id, author_user_id, kind, body, sources_json) VALUES (?, ?, 'brief', ?, ?)
     RETURNING id, created_at`,
  ).bind(ctx.fund.id, ctx.user.id, body, JSON.stringify(sources)).first<{ id: number; created_at: string }>();
  return c.json({ note: { id: row?.id ?? null, kind: 'brief', body, sources, author: { id: ctx.user.id, name: ctx.user.name ?? null }, created_at: row?.created_at ?? null } }, 201);
});

r.get('/:id/notes/brief', async (c) => {
  const g = await gate(c);
  if (g.refusal) return g.refusal;
  const { ctx } = g as any;
  let row: any;
  try {
    row = await c.env.DB.prepare(
      `SELECT n.id, n.body, n.sources_json, n.author_user_id, n.created_at, u.name AS author_name
         FROM fund_notes n LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.fund_id = ? AND n.kind = 'brief' ORDER BY n.created_at DESC, n.id DESC LIMIT 1`,
    ).bind(ctx.fund.id).first<any>();
  } catch (e) {
    return refuse(c, 503, { code: 'note_unreadable', message: FUND_DRAFT_SENTENCES.note_unreadable, raw: e });
  }
  if (!row) return c.json({ note: null });
  let sources: unknown = [];
  try { sources = JSON.parse(row.sources_json); } catch { sources = null; }
  return c.json({ note: { id: row.id, kind: 'brief', body: row.body, sources: Array.isArray(sources) ? sources : null, author: { id: row.author_user_id, name: row.author_name ?? null }, created_at: row.created_at } });
});

export default r;
export const mount: RouteMount = { path: '/api/funds', router: r, before: [funds] };
