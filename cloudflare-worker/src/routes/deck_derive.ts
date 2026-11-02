/**
 * D1583 (#3830, deck builder v2 F4) — a teaser, a one-pager and a memo from one
 * frozen deck version (`services/decks/derive.ts`).
 *
 *   POST /api/decks/:id/derive/quote   { format, blind? }
 *        → { format, option, ai: false, hold_microusd: 0, model: null }        teaser, one-pager
 *        | { format, option, ai: true, hold_microusd, model }                  memo
 *        | { format, option, ai: false, reason, message }                      memo, refused
 *   POST /api/decks/:id/derive         { format, blind? }
 *        → { proposal, format, blind, title, cards?, memo?, figures, dropped?, cost? }
 *   POST /api/decks/:id/derive/:uid/accept
 *        → { derivative }                          the proposal, now a stored derivative
 *   GET  /api/decks/:id/derivatives    → { derivatives: [{ uid, format, blind, title, created_at }] }
 *   GET  /api/decks/derivatives/:uid   → { derivative: { …, cards | memo, figures } }
 *
 * `:id` is the frozen master: one `pitch_decks` row, one version. A press
 * needs write access to the venture (`projectOwned`), as every deck write
 * does; the reads need read access.
 *
 * NOTHING IS SAVED BY A RUN. Every press files one `ai_rail_proposals` row
 * (`derive:<format>`, record `deck:<id>`) that Ask lists under "Waiting for
 * you". Accept is this file's `/accept`, which stores the derivative and marks
 * the proposal accepted in one batch. The generic decide route refuses to
 * accept or edit a `derive:` proposal (`railProposals.decideRail`), so a
 * proposal can never be "accepted" without its derivative; Discard is generic.
 *
 * A teaser or a one-pager is made by code, costs nothing and is not quoted.
 * Its proposal holds a summary and the hash of the cards; `/accept` makes them
 * again from the frozen version and refuses with 409 `derivative_changed`
 * when the venture's names changed since, so what is stored is what was
 * proposed. A memo is one `memo_write` run: its model is the member's pick
 * for `derive:memo` in the AIRail (or that row's default), never one the
 * request names, quoted first, and its text is in the proposal.
 *
 * Mounted in index.ts BEFORE `decks`, beside the other `/api/decks/*` routers.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import {
  DERIVE_FORMATS, DERIVE_OPTIONS, DERIVE_PAGE, FORMAT_LABEL, derivedTitle, memoFacts, memoFrom, memoMessages,
  onePagerCard, sourceCards, statedFigures, strayFigures, teaserCards, type DeriveFormat, type Figure, type Identity,
} from '../services/decks/derive';
import { getRail, proposeRail } from '../services/railProposals';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { auditDeckWrite, getDeckRow, projectOwned } from './decks';
import { newUid } from './_t13t14t15_helpers';

const deckDerive = new Hono<{ Bindings: Env }>();

type Press = { deckId: number; projectId: number; version: number | null; format: DeriveFormat; blind: boolean; slides: unknown[]; who: Identity };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hashOf(v: unknown): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v))));
}

/** The names a blind output must not carry: the venture's, its company's and its founders'. */
async function identityOf(env: Env, projectId: number): Promise<Identity> {
  const venture: string[] = [];
  const founders: string[] = [];
  const p = await env.DB.prepare(
    `SELECT p.name, p.slug, p.founder_id, cp.company_name, f.name AS founder_name
       FROM projects p
       LEFT JOIN company_profiles cp ON cp.id = p.company_id
       LEFT JOIN founders f ON f.id = p.founder_id
      WHERE p.id = ?`,
  ).bind(projectId).first<{ name: string | null; slug: string | null; company_name: string | null; founder_name: string | null }>();
  for (const v of [p?.name, p?.company_name, p?.slug ? String(p.slug).replace(/-/g, ' ') : null]) if (v && v.trim()) venture.push(v.trim());
  if (p?.founder_name?.trim()) founders.push(p.founder_name.trim());
  const members = (await env.DB.prepare(
    `SELECT u.name FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? AND m.removed_at IS NULL AND m.status = 'accepted'`,
  ).bind(projectId).all<{ name: string | null }>()).results ?? [];
  for (const m of members) if (m.name?.trim()) founders.push(m.name.trim());
  // A person's surname alone names them too.
  for (const n of [...founders]) {
    const parts = n.split(/\s+/).filter((w) => w.length >= 3);
    if (parts.length > 1) founders.push(...parts);
  }
  return { venture: [...new Set(venture)], founders: [...new Set(founders)] };
}

/** The press a request asks for, checked, or the response that refuses it. Nothing runs before this answers. */
async function pressOf(c: any, user: User): Promise<{ press: Press } | { refused: Response }> {
  const body = await c.req.json().catch(() => ({} as any));
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return { refused: c.json({ error: 'deck id required' }, 400) };
  const format = String(body?.format ?? '') as DeriveFormat;
  if (!(DERIVE_FORMATS as readonly string[]).includes(format)) {
    return { refused: refuse(c, 400, { code: 'unknown_format', message: 'Choose a teaser, a one-pager or a memo.' }) };
  }
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return { refused: c.json({ error: 'not found' }, 404) }; }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
  let slides: unknown[] = [];
  try { const s = JSON.parse(row.slides || '[]'); slides = Array.isArray(s) ? s : []; } catch { slides = []; }
  if (!sourceCards(slides, false).length) {
    return { refused: refuse(c, 422, { code: 'deck_empty', message: 'This version has no card to work from. Nothing was run.' }) };
  }
  const blind = body?.blind === true;
  const who = blind ? await identityOf(c.env, projectId) : { venture: [], founders: [] };
  return { press: { deckId, projectId, version: row.version == null ? null : Number(row.version), format, blind, slides, who } };
}

/** The cards a teaser or a one-pager is: made by code, the same for the same version and names. */
const cardsOf = (p: Pick<Press, 'format' | 'slides' | 'blind' | 'who'>) =>
  p.format === 'one_pager' ? onePagerCard(p.slides, { blind: p.blind, who: p.who }) : teaserCards(p.slides, { blind: p.blind, who: p.who });

/** The one `memo_write` run a memo press makes, so the quote and the run read the same input. */
function memoRun(c: any, user: User, p: Press): { opts: RunOptions; facts: ReturnType<typeof memoFacts> } {
  const cards = p.blind ? teaserCards(p.slides, { blind: true, who: p.who }) : sourceCards(p.slides, false);
  const facts = memoFacts(cards);
  const msg = memoMessages(facts, p.blind);
  const option = DERIVE_OPTIONS.memo;
  return {
    facts,
    opts: {
      task: 'memo_write',
      userId: Number(user.id) || 0,
      surface: AI_SURFACE.raisePitch,
      // The model is the AIRail's only: the member's pick for `derive:memo`, or the row's default. No `model` is
      // passed, so a request cannot name one (D720 §5 lets a caller's model past the row).
      rail: { ...railFor(c, { page: DERIVE_PAGE, option }, `deck:${p.deckId}`), option },
      systemPrompt: msg.system,
      messages: [{ role: 'user', content: msg.user }],
      temperature: 0.3,
      maxTokens: 1800,
    },
  };
}

async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

deckDerive.post('/:id/derive/quote', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const option = DERIVE_OPTIONS[p.format];
  if (p.format !== 'memo') return c.json({ format: p.format, option, ai: false, hold_microusd: 0, model: null });
  const q = await quoteRun(c.env, memoRun(c, user, p).opts);
  if (q.ok) return c.json({ format: p.format, option, ai: true, hold_microusd: q.hold_microusd, model: q.model });
  return c.json({ format: p.format, option, ai: false, reason: q.refusal, message: q.refusal === 'assist_off' ? 'AI assistance is off on this page. The teaser and the one-pager still work.' : q.error });
});

deckDerive.post('/:id/derive', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const userId = Number(user.id) || 0;
  const option = DERIVE_OPTIONS[p.format];
  const title = derivedTitle(p.format, p.blind, p.version);
  let payload: Record<string, unknown>;
  let answer: Record<string, unknown>;
  let model: string | null = null;
  let usageLogId: number | null = null;
  let cost: Record<string, unknown> | null = null;

  if (p.format === 'memo') {
    const { opts, facts } = memoRun(c, user, p);
    const res = await run(c.env, { ...opts, surface: AI_SURFACE.raisePitch, rail: opts.rail });
    if (!res.ok) {
      const stop = refuseRun(c, res);
      if (stop) return stop;
      return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
    }
    usageLogId = res.usageLogId ?? null;
    model = res.usage?.model ?? null;
    cost = { charged_microusd: await chargedOf(c.env, usageLogId, userId), usage_log_id: usageLogId };
    const made = memoFrom(res.output, facts, { blind: p.blind, who: p.who });
    if (!made.memo.replace(/^##.*$/gm, '').trim()) {
      return refuse(c, 422, { code: 'memo_empty', message: 'Eadwyn wrote nothing the deck supports, so no memo was proposed. It was charged for the run.', extra: { cost } });
    }
    if (strayFigures(p.slides, made.memo).length) {
      return refuse(c, 422, { code: 'figure_in_output', message: 'The memo stated a figure the deck does not, so it was not proposed. It was charged for the run.', extra: { cost } });
    }
    payload = { deck_id: p.deckId, version: p.version, format: p.format, blind: p.blind, title, memo: made.memo, figures: made.figures, dropped: made.dropped };
    answer = { memo: made.memo, figures: made.figures, dropped: made.dropped };
  } else {
    const cards = cardsOf(p);
    if (!cards.length) return refuse(c, 422, { code: 'deck_empty', message: 'This version has no card to work from. Nothing was run.' });
    if (strayFigures(p.slides, cards).length) return refuse(c, 500, { code: 'derive_unsound', message: 'The draft stated a figure the deck does not. Nothing was proposed.' });
    const figures = [...statedFigures(cards)];
    payload = {
      deck_id: p.deckId, version: p.version, format: p.format, blind: p.blind, title,
      cards: cards.map((x: any) => String(x.title ?? '')), count: cards.length, hash: await hashOf(cards), figures,
    };
    answer = { cards, figures };
  }

  let proposal = null;
  try {
    proposal = await proposeRail(c.env, { userId, page: DERIVE_PAGE, option, record: `deck:${p.deckId}`, kind: 'proposal', payload, model, usageLogId });
  } catch {
    return refuse(c, 503, { code: 'proposal_unsaved', message: `The ${FORMAT_LABEL[p.format].toLowerCase()} could not be kept as a proposal. Try again in a moment.`, extra: cost ? { cost } : undefined });
  }
  await auditDeckWrite(c, user, p.projectId, 'deck_derive_proposed', `${title} proposed`);
  return c.json({ proposal, format: p.format, blind: p.blind, title, ...answer, ...(cost ? { cost } : {}) });
});

deckDerive.post('/:id/derive/:uid/accept', async (c) => {
  const user = await requireAuth(c);
  const userId = Number(user.id) || 0;
  const deckId = Number(c.req.param('id'));
  const uid = String(c.req.param('uid') || '');
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return c.json({ error: 'deck id required' }, 400);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  const open = await getRail(c.env, userId, uid);
  const format = DERIVE_FORMATS.find((f) => DERIVE_OPTIONS[f] === open?.rail_option);
  if (!open || !format || open.record_ref !== `deck:${deckId}` || open.status !== 'proposed') {
    return refuse(c, 409, { code: 'not_open', message: 'That proposal is not yours, or it has already been decided.' });
  }
  const pl = open.payload as Record<string, any>;
  const blind = pl.blind === true;
  let slides: unknown[] = [];
  try { const s = JSON.parse(row.slides || '[]'); slides = Array.isArray(s) ? s : []; } catch { slides = []; }
  let cards: unknown[] = [];
  let memo: string | null = null;
  let figures: unknown[];
  if (format === 'memo') {
    memo = typeof pl.memo === 'string' ? pl.memo : '';
    figures = Array.isArray(pl.figures) ? (pl.figures as Figure[]) : [];
  } else {
    const who = blind ? await identityOf(c.env, projectId) : { venture: [], founders: [] };
    cards = cardsOf({ format, slides, blind, who });
    if (!cards.length || await hashOf(cards) !== pl.hash) {
      return refuse(c, 409, { code: 'derivative_changed', message: 'The venture\'s details changed since this was proposed. Discard it and make it again.' });
    }
    figures = [...statedFigures(cards)];
  }
  const title = typeof pl.title === 'string' && pl.title.trim() ? pl.title.trim().slice(0, 120) : derivedTitle(format, blind, row.version ?? null);
  const derivativeUid = newUid();
  // One batch: the derivative exists exactly when its proposal is accepted.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO deck_derivatives (uid, deck_id, project_id, format, blind, title, slides, memo, figures_json, proposal_uid, created_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM ai_rail_proposals WHERE uid = ? AND user_id = ? AND status = 'proposed')`,
    ).bind(derivativeUid, deckId, projectId, format, blind ? 1 : 0, title, JSON.stringify(cards), memo, JSON.stringify(figures), uid, userId, uid, userId),
    c.env.DB.prepare(
      `UPDATE ai_rail_proposals
          SET status = 'accepted', decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE uid = ? AND user_id = ? AND status = 'proposed'`,
    ).bind(uid, userId),
  ]);
  if (!Number(results[0]?.meta?.changes ?? 0)) {
    return refuse(c, 409, { code: 'not_open', message: 'That proposal is not yours, or it has already been decided.' });
  }
  await auditDeckWrite(c, user, projectId, 'deck_derive_accepted', `${title} kept`);
  return c.json({ derivative: { uid: derivativeUid, deck_id: deckId, format, blind, title, cards, memo, figures } }, 201);
});

/** A derivative's row as the editor reads it. */
function derivativeOf(r: any, full: boolean) {
  const out: Record<string, unknown> = {
    uid: r.uid, deck_id: Number(r.deck_id), format: r.format, blind: Number(r.blind) === 1, title: r.title, created_at: r.created_at,
  };
  if (full) {
    let cards: unknown = [];
    let figures: unknown = [];
    try { cards = JSON.parse(r.slides || '[]'); } catch { cards = []; }
    try { figures = JSON.parse(r.figures_json || '[]'); } catch { figures = []; }
    // Three fixed keys, set one by one: the reply's shape never comes from the row or the request.
    out.cards = cards;
    out.memo = r.memo ?? null;
    out.figures = figures;
  }
  return out;
}

deckDerive.get('/derivatives/:uid', async (c) => {
  const user = await requireAuth(c);
  const r = await c.env.DB.prepare('SELECT * FROM deck_derivatives WHERE uid = ?').bind(String(c.req.param('uid') || '')).first<any>();
  if (!r) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(r.project_id)); } catch { return c.json({ error: 'not found' }, 404); }
  return c.json({ derivative: derivativeOf(r, true) });
});

deckDerive.get('/:id/derivatives', async (c) => {
  const user = await requireAuth(c);
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return c.json({ error: 'deck id required' }, 400);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id)); } catch { return c.json({ error: 'not found' }, 404); }
  const rows = (await c.env.DB.prepare('SELECT * FROM deck_derivatives WHERE deck_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').bind(deckId).all<any>()).results ?? [];
  return c.json({ derivatives: rows.map((r) => derivativeOf(r, false)) });
});

export default deckDerive;
