/**
 * D1552 (#3799, deck v2 C4) — ⋯ › Whole deck · uses AI › Fix with critique.
 *
 *   POST /api/decks/:id/critique/quote   what a critique holds before it runs:
 *        → { ai: true, cards, score, findings, fixes: { count, per_microusd, microusd },
 *            vision: { available, reason, family, writer_family, cards, per_card_microusd, microusd },
 *            hold_microusd } | { ai: false, reason, message }
 *   POST /api/decks/:id/critique   { vision?: boolean }
 *        → { score_before, score, score_if_accepted, threshold, rubric, findings,
 *            fixes: [{ proposal_uid, card, card_uid, check, before, after }],
 *            what_we_fixed, not_fixed: [{ card, check, detail, reason }],
 *            vision: { ran, family, writer_family, cards_read, reason }, charged_microusd }
 *
 * The free checks (fit, density, contrast, image-style drift) always run. The
 * vision pass (DK9, `rail_vision`) reads each card rendered by the deck's own
 * print page, on a model of another family than the deck's writer (#3804's
 * rule, `criticModelFor`); without a browser binding or a model of another
 * family it does not run, and says why. Each fix (a block that overflows or
 * crowds, shortened) is a rail proposal on `deck:shorten`, the shape a card's
 * Shorten leaves, so the Ask's "Waiting for you" sheet offers it with Accept
 * and Accept all. Nothing is placed or saved here.
 *
 * Who: the deck's writers (`projectOwned` with write). Each run holds and
 * settles on its own, as every press on the deck does; the quote is their sum.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { getDeckRow, projectOwned, signDeckPrintToken, themeOfRow } from './decks';
import { elementModelFor, runModelOf } from './deck_element_models';
import { railFor } from '../util/railContext';
import { proposeRail } from '../services/railProposals';
import { ASSIST_PAGE, textMessage, wordingOf, wordingProblem } from '../services/decks/assist';
import { BODY_CONTRAST, contrast, fitText, themeTokens } from '../services/decks/designSystem';
import { artDirectionOfTheme } from '../services/decks/artDirection';
import { familyOf, otherFamily } from '../services/decks/critic';
import { renderUrl, DECK_PAGE_LOAD_MS, MAX_SLIDE_PNG_BYTES } from '../services/browserRun';
import { stripTrailingSlashes } from '../util/url';
import { MAX_IMAGE_BYTES } from '../services/ai/shapes';
import {
  QUALITY_THRESHOLD, VISION_QUESTION, codeFindings, critiqueScore, fixedLine, leftReason, pickCritic, styleFindings, visionFindings,
  type DeckAspect, type Finding,
} from '../services/decks/critique';

const deckCritique = new Hono<{ Bindings: Env }>();
const SHORTEN_OPTION = 'deck:shorten';
/** The vision pass reads at most this many cards, and renders a few at a time under one deadline. */
export const MAX_VISION_CARDS = 20;
export const VISION_CONCURRENCY = 3;
export const VISION_BUDGET_MS = 120_000;
const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };

type Deck = { deckId: number; projectId: number; slides: any[]; aspect: DeckAspect; contrastAa: boolean | null; deckStyle: string | null };

async function deckFor(c: any, user: User): Promise<Deck | Response> {
  const deckId = Number(c.req.param('id'));
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  let slides: any[] = [];
  try { slides = Array.isArray(row.slides) ? row.slides : JSON.parse(row.slides || '[]'); } catch { slides = []; }
  const theme = themeOfRow(row);
  let contrastAa: boolean | null = null;
  try {
    const colours = theme?.tokens?.colours ?? themeTokens(theme?.kind ?? 'brand').tokens.colours;
    contrastAa = contrast(String(colours.ink), String(colours.ground)) >= BODY_CONTRAST;
  } catch { contrastAa = null; }
  return {
    deckId, projectId, slides: Array.isArray(slides) ? slides : [], aspect: theme?.aspect === '4:3' ? '4:3' : '16:9', contrastAa,
    deckStyle: artDirectionOfTheme(theme).style ?? null,
  };
}

/** The deck's pictures and the style each was drawn in. */
async function imagesOf(env: Env, projectId: number, slides: any[]): Promise<Array<{ uid: string; style: string | null }>> {
  const uids = [...new Set(slides.flatMap((s) => (Array.isArray(s?.blocks) ? s.blocks : []).filter((b: any) => b?.kind === 'image' && typeof b.image_id === 'string').map((b: any) => b.image_id)))].slice(0, 100);
  if (!uids.length) return [];
  const r = await env.DB.prepare('SELECT uid, style FROM deck_images WHERE project_id = ?1 AND uid IN (SELECT value FROM json_each(?2))')
    .bind(projectId, JSON.stringify(uids)).all<{ uid: string; style: string | null }>().catch(() => null);
  return r?.results ?? [];
}

const allFindings = (d: Deck, images: Array<{ uid: string; style: string | null }>) =>
  [...codeFindings(d.slides, { aspect: d.aspect, contrastAa: d.contrastAa }), ...styleFindings(d.slides, images, d.deckStyle)];

/** The words' writer for this founder and deck (Body's element model), or null when it cannot be read. */
async function writerOf(c: any, user: User, projectId: number): Promise<{ pick: string | undefined; model: string | null }> {
  let pick: string | undefined;
  try { pick = runModelOf(await elementModelFor(c.env, user, projectId, 'body')); } catch { return { pick: undefined, model: null }; }
  const q = await quoteRun(c.env, { ...(pick ? { model: pick } : {}), task: 'rail_write', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch, systemPrompt: '', messages: [{ role: 'user', content: 'quote' }], maxTokens: 16 }).catch(() => null);
  return { pick, model: q && q.ok ? q.model ?? null : null };
}

function shortenRun(c: any, user: User, d: Deck, f: Finding, pick: string | undefined): RunOptions {
  const m = textMessage('shorten', f.before ?? '');
  return {
    ...(pick ? { model: pick } : {}), task: 'rail_write', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch,
    rail: { ...railFor(c, { page: ASSIST_PAGE, option: SHORTEN_OPTION }, `deck:${d.deckId}`), option: SHORTEN_OPTION },
    systemPrompt: m.system, messages: [{ role: 'user', content: `${m.user}\n\nKeep it to at most ${f.limit} characters.` }],
    temperature: 0.3, maxTokens: Math.min(800, Math.ceil(Number(f.limit || 280) / 3) + 40),
  };
}

/** A 1 by 1 PNG: a vision run's quote counts images, not their bytes. */
const QUOTE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
function visionRun(c: any, user: User, d: Deck, model: string, image: string): RunOptions {
  return {
    model, task: 'rail_vision', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch,
    rail: { ...railFor(c, { page: ASSIST_PAGE, option: SHORTEN_OPTION }, `deck:${d.deckId}`), option: SHORTEN_OPTION },
    text: VISION_QUESTION, images: [image], maxTokens: 300, temperature: 0.2,
  } as RunOptions;
}

/** Bytes as base64, a chunk at a time (a slide is too large to spread into one call). */
export function base64Of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const visionCards = (d: Deck) => d.slides.map((s, i) => ({ s, i })).filter((x) => !x.s?.appendix).slice(0, MAX_VISION_CARDS);
const AI_OFF = 'AI assistance is off on this page. The free checks still run.';

deckCritique.post('/:id{[0-9]+}/critique/quote', async (c) => {
  const user = await requireAuth(c);
  const d = await deckFor(c, user);
  if (d instanceof Response) return d;
  const images = await imagesOf(c.env, d.projectId, d.slides);
  const findings = allFindings(d, images);
  const shorten = findings.filter((f) => f.fix === 'shorten');
  const writer = await writerOf(c, user, d.projectId);
  let per = 0;
  if (shorten.length) {
    const q = await quoteRun(c.env, shortenRun(c, user, d, shorten[0], writer.pick));
    if (!q.ok && q.refusal === 'assist_off') return c.json({ ai: false, reason: 'assist_off', message: AI_OFF });
    if (!q.ok) return c.json({ ai: false, reason: q.refusal, message: q.error });
    per = q.hold_microusd;
  }
  const critic = pickCritic(writer.model);
  const cards = visionCards(d).length;
  let vision: Record<string, unknown> = { available: false, reason: null, family: familyOf(critic), writer_family: familyOf(writer.model), cards, per_card_microusd: null, microusd: 0 };
  if (!c.env.BROWSER) vision = { ...vision, reason: 'The cards cannot be pictured here, so only the free checks run.' };
  else if (!writer.model) vision = { ...vision, reason: 'The deck writer’s model could not be read, so the critic cannot be kept to another family.' };
  else if (!critic) vision = { ...vision, reason: 'No critic model of another family than the writer’s is offered.' };
  else {
    const q = await quoteRun(c.env, visionRun(c, user, d, critic, QUOTE_PNG));
    vision = q.ok ? { ...vision, available: true, per_card_microusd: q.hold_microusd, microusd: q.hold_microusd * cards } : { ...vision, reason: q.error };
  }
  const score = critiqueScore(d.slides, findings);
  const fixes = { count: shorten.length, per_microusd: shorten.length ? per : null, microusd: per * shorten.length };
  return c.json({ ai: true, cards: d.slides.length, score: score.score, rubric: score.rubric, findings: findings.length, fixes, vision, hold_microusd: fixes.microusd + Number(vision.microusd || 0) });
});

deckCritique.post('/:id{[0-9]+}/critique', async (c) => {
  const user = await requireAuth(c);
  const d = await deckFor(c, user);
  if (d instanceof Response) return d;
  let body: any = null;
  try { body = await c.req.json(); } catch { body = null; }
  const userId = Number(user.id) || 0;
  const images = await imagesOf(c.env, d.projectId, d.slides);
  let findings = allFindings(d, images);
  const writer = await writerOf(c, user, d.projectId);
  let charged = 0;

  // The vision pass, on a model of another family than the writer's.
  const critic = pickCritic(writer.model);
  const vision: Record<string, unknown> = { ran: false, family: familyOf(critic), writer_family: familyOf(writer.model), cards_read: 0, reason: null };
  if (body?.vision === false) vision.reason = 'Not asked for.';
  else if (!c.env.BROWSER) vision.reason = 'The cards cannot be pictured here, so only the free checks ran.';
  else if (!writer.model || !critic) vision.reason = 'No critic model of another family than the writer’s, so the vision pass did not run.';
  else {
    const token = await signDeckPrintToken(c.env, d.deckId, 300);
    const base = stripTrailingSlashes((c.env as any).PUBLIC_BASE_URL || (c.env as any).APP_URL || 'https://axal.vc');
    const deadline = Date.now() + VISION_BUDGET_MS;
    const todo = visionCards(d);
    let next = 0;
    const seen: Finding[] = [];
    const worker = async () => {
      while (next < todo.length) {
        const { s, i } = todo[next++];
        const shot = await renderUrl(c.env, 'screenshot', {
          url: `${base}/deck/print-export/${token}?print_mode=single&slide=${i}`, viewport: VIEWPORT,
          gotoOptions: { waitUntil: 'networkidle0', timeout: DECK_PAGE_LOAD_MS },
          screenshotOptions: { type: 'png', omitBackground: false, fullPage: false },
        }, { kind: 'png', maxBytes: Math.min(MAX_SLIDE_PNG_BYTES, MAX_IMAGE_BYTES), deadline, attempts: 1 });
        if (!shot.ok) continue;
        const uri = `data:image/png;base64,${base64Of(shot.bytes)}`;
        const opts = visionRun(c, user, d, critic, uri);
        const r = await run(c.env, { ...opts, rail: opts.rail, surface: AI_SURFACE.raisePitch });
        if (!r.ok) continue;
        charged += Number((r as any).usage?.charged_microusd ?? 0);
        // The family rule holds for what answered, not only for what was asked.
        if (!otherFamily(r.usage?.model ?? critic, writer.model)) continue;
        const notes = visionFindings(i, typeof s?.uid === 'string' ? s.uid : null, r.output);
        if (notes) { seen.push(...notes); vision.cards_read = Number(vision.cards_read) + 1; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(VISION_CONCURRENCY, todo.length) }, worker));
    vision.ran = Number(vision.cards_read) > 0;
    if (!vision.ran) vision.reason = 'No card could be pictured and read, so only the free checks ran.';
    findings = [...findings, ...seen];
  }
  const before = critiqueScore(d.slides, findings);

  // The fixes: each block that overflows or crowds, shortened, as a proposal.
  const fixes: Array<Record<string, unknown>> = [];
  const notFixed: Array<Record<string, unknown>> = [];
  let projected = d.slides;
  for (const f of findings.filter((x) => x.fix === 'shorten')) {
    const opts = shortenRun(c, user, d, f, writer.pick);
    const r = await run(c.env, { ...opts, rail: opts.rail, surface: AI_SURFACE.raisePitch });
    if (!r.ok) { notFixed.push({ card: f.card, check: f.check, detail: f.detail, reason: r.refusal === 'assist_off' ? AI_OFF : 'Eadwyn could not shorten it.' }); if (r.refusal === 'assist_off' || String(r.refusal ?? '').startsWith('budget_')) break; continue; }
    charged += Number((r as any).usage?.charged_microusd ?? 0);
    // Never cut to fit: words cut mid-sentence are not a fix, so a reply that is still too long is left for the founder.
    const after = wordingOf(r.output, 4000);
    const problem = after ? wordingProblem('shorten', f.before ?? '', after) : 'Eadwyn returned no words.';
    const fits = after && f.grid && f.role ? fitText(f.grid, f.role, after, d.aspect).fits : false;
    if (problem || !fits) { notFixed.push({ card: f.card, check: f.check, detail: f.detail, reason: problem || 'The shorter words still do not fit; edit this one by hand.' }); continue; }
    let proposal: { uid: string } | null = null;
    try {
      proposal = await proposeRail(c.env, {
        userId, page: ASSIST_PAGE, option: SHORTEN_OPTION, record: `deck:${d.deckId}`, kind: 'proposal',
        payload: { deck_id: d.deckId, card: f.card, card_uid: f.card_uid, block_id: f.block_id, action: 'shorten', before: f.before, after, source: 'critique', check: f.check },
        model: r.usage?.model ?? null, usageLogId: r.usageLogId ?? null,
      });
    } catch { notFixed.push({ card: f.card, check: f.check, detail: f.detail, reason: 'The fix could not be kept. Run the critique again.' }); continue; }
    fixes.push({ proposal_uid: proposal.uid, card: f.card, card_uid: f.card_uid, check: f.check, before: f.before, after });
    projected = projected.map((card, i) => (i !== f.card ? card : { ...card, blocks: (card.blocks || []).map((b: any) => (String(b?.id) === f.block_id ? { ...b, text: after } : b)) }));
  }
  for (const f of findings) {
    const reason = leftReason(f);
    if (reason) notFixed.push({ card: f.card, check: f.check, detail: f.detail, reason });
  }
  const kept = findings.filter((f) => !(f.fix === 'shorten' && fixes.some((x) => x.card === f.card && x.before === f.before)));
  const after = critiqueScore(projected, kept);
  return c.json({
    score_before: before.score, score: before.score, score_if_accepted: after.score, threshold: QUALITY_THRESHOLD, rubric: before.rubric,
    findings: findings.map(({ before: _b, limit: _l, grid: _g, role: _r, ...f }) => f),
    fixes, what_we_fixed: fixes.map((x) => fixedLine(x as unknown as Finding)), not_fixed: notFixed, vision, charged_microusd: charged,
  });
});

export default deckCritique;
