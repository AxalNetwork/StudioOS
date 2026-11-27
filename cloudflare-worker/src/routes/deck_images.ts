/**
 * D903 (#2682, part 9 of #2434) — images for the pitch deck's cards and
 * backgrounds (PD12–PD12e).
 *
 *   POST /api/decks/:id/images/quote
 *        { use, description, style, palette, aspect, count, card?, points?, colours? }
 *        → { ai: true, models: [{ id, label, per_image_microusd }], model, per_image_microusd, count,
 *            total_microusd, balance: { ok, code?, message? } } | { ai: false, reason, message }
 *   POST /api/decks/:id/images           (the same body, plus area?, slide_aspect?) → { images: [image], refused: [line], stopped? };
 *        D1505: each image is the pipeline (expand · draw at its area's size and seed · image check · style ·
 *        alt text · provenance) under one hold, the quote above prices every step (`steps`), and a press whose
 *        every image was refused is 422 in the first one's words, with `refused` and `charged_microusd: 0`.
 *   POST /api/decks/:id/images/replace-all/quote   D1561 (#3808): every image area of the deck, priced as one quote
 *        → { ai, count, total_microusd, hold_microusd, areas, left_out, balance }
 *   POST /api/decks/:id/images/replace-all         { slide_aspect? }, Idempotency-Key optional → { images, refused, left_out,
 *        hold_microusd, charged_microusd, stopped? }: every area through the pipeline under one hold, one redraw each.
 *   POST /api/decks/:id/images/upload    multipart: file, use, card?, alt, shows_person?, consent?
 *   POST /api/decks/:id/images/import    D1506: { url, use?, card?, alt, shows_person?, consent? }, an external image copied into R2
 *        D1534 (#3778): both need alt text (422 `alt_required`), and each stored image is screened once
 *        (`uploadScreen.ts`): the screen flags (`image.screen`), it never blocks.
 *   GET  /api/decks/:id/images           the venture's kept images, generated or uploaded (PD12d's Design list)
 *   GET  /api/decks/:id/images/plan      D903 §10 (#3660): whether this Worker can draw, the deck's one art
 *        direction, and the words-only cards an illustration would help → { capability, direction, cards }.
 *        A proposal only: it runs nothing and charges nothing.
 *   POST /api/decks/images/:uid/keep     { use?, overlay?, ink?, alt? }
 *   POST /api/decks/images/:uid/discard
 *   GET  /api/decks/images/:uid/file     the bytes, at an https app URL (never a data: URL)
 *
 * `:id` is the version the editor opened (`pitch_decks.id`). Each generated
 * image is one run() of the `deck_image` task (FLUX.1 Schnell, #2434 owner
 * question 1, A) on the rail option `deck:image`, charged to the founder who
 * pressed: its row keeps the run's `ai_usage_log_id` and `charged_microusd`.
 * A proposal is stored and shown; nothing reaches a card until the founder
 * keeps it and saves the version.
 *
 * REFUSED BEFORE THE QUOTE OR THE HOLD (`services/decks/images.ts`): a real
 * person (422 `real_person`, the canvas's sentence), a figure
 * (`figure_in_prompt`), a chart (`not_illustrative`); then, before the hold,
 * a balance that cannot cover every image asked for (402, the router's words)
 * and a storage plan with no room (413). An upload showing a person needs that
 * person's agreement recorded (422 `person_consent_required`).
 *
 * WHO READS THE BYTES. A kept image is in decks that are shared and exported,
 * so its file is served to anyone holding its unguessable URL. A proposal is
 * served only to the venture's writers; a discarded image to nobody.
 *
 * Every image run, Keep and upload writes one `raise.pitch-deck` cycle row
 * (D691 decision 12), never a figure. Mounted in index.ts BEFORE `decks`, so
 * `/api/decks/images/…` never reaches `GET /api/decks/:id`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import {
  ALT_MAX, EXTENSION, IMAGE_BYTES_ESTIMATE, IMAGE_OPTION, IMAGE_PAGE, NOT_ILLUSTRATIVE_MESSAGE, imageModelLabel,
  OVERLAYS, PERSON_CONSENT_MESSAGE, REAL_PERSON_MESSAGE, UPLOAD_MAX_BYTES, USES, asksForChart, askOf, balanceRefusal, overlayContrast,
  personIn, promptOf, readable, sniffMime, ventureNames, type ImageAsk, type Overlay, type Use,
} from '../services/decks/images';
import { figureRefusal } from '../services/decks/newDeck';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { auditDeckWrite, getDeckRow, projectOwned, themeOfRow } from './decks';
import { cardRefOf } from '../services/decks/cardUids';
import { imageCapability, imagePlan } from '../services/decks/visuals';
import { fetchLandingPageForProject } from '../services/decks/branding';
import { ElementOffError, elementModelFor, lockedOutRefusal, runPickOf } from './deck_element_models';
import { lockedOut, type Resolved } from '../services/decks/elementModels';
import { notSwitchedOn } from '../services/featureFlags';
import { imageSize, sha256Hex, stripMetadata, tooManyPixels, type ImageMime } from '../services/decks/imageBytes';
import { fetchExternalImage } from '../services/decks/imageFetch';
import { deckArtOf, drawDeckImages, quoteDeckImage, type DrawArgs, type Refused } from '../services/decks/imageDraw';
import { reserveAiBudget, settleAiReservation } from '../services/aiBudget';
import { replaceAreasOf, type ReplaceArea } from '../services/decks/deckActions';
import type { Aspect } from '../services/ai/shapes';
import { artDirectionOfTheme, seedFor, type ArtDirection } from '../services/decks/artDirection';
import { asReference } from '../services/decks/imageEdits';
import { IMAGE_SPECS, type DrawReference } from '../services/ai/shapes';
import { screenOf, screenUpload } from '../services/decks/uploadScreen';
import { deckCeilingRefusal } from '../services/decks/observability';
import { takedownPng } from '../services/decks/takedownPlaceholder';

/** #4375: an image HQ took down is no longer the founder's to keep, edit, discard or upload again. */
export const TAKEN_DOWN_SENTENCE = 'Axal HQ removed this image. Every card that used it shows a placeholder; choose another image.';

/** D1534 (#3778): pd27's words. */
export const ALT_REQUIRED_MESSAGE = 'Alt text is needed before this image can be inserted.';

const deckImages = new Hono<{ Bindings: Env }>();

/**
 * D1544 (#3784): the art direction's reference image as a model's reference,
 * or null: when the deck keeps none, the model takes none, the image is not a
 * kept image of this venture, or it cannot be read or resized (then the image
 * is drawn without it rather than refused).
 */
async function artReference(env: Env, deck: Deck, model: string): Promise<DrawReference | null> {
  if (!deck.art.reference_uid || !((IMAGE_SPECS[model]?.maxReferences ?? 0) > 0) || !env.FILES) return null;
  const row = await env.DB.prepare("SELECT r2_key, mime, shows_person FROM deck_images WHERE uid = ? AND project_id = ? AND state = 'kept' AND taken_down_at IS NULL")
    .bind(deck.art.reference_uid, deck.projectId).first<any>().catch(() => null);
  if (!row || Number(row.shows_person) === 1) return null;
  try {
    const obj = await env.FILES.get(row.r2_key);
    if (!obj) return null;
    const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
    return await asReference(env, bytes, row.mime as ImageMime);
  } catch { return null; }
}

const HEX = /^#[0-9a-f]{6}$/i;
const UID = /^[0-9a-f-]{36}$/;
const NO_STORAGE = 'Images cannot be stored here yet. Nothing was run and nothing was charged.';

type Deck = { deckId: number; projectId: number; slides: unknown[]; art: ArtDirection };

/** The deck version and its venture, which the caller may write (or read, with `write: false`), or the refusal. */
async function deckOf(c: any, user: User, write = true): Promise<Deck | Response> {
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return c.json({ error: 'deck id required' }, 400);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  let slides: unknown[] = [];
  try { const parsed = JSON.parse(row.slides || '[]'); if (Array.isArray(parsed)) slides = parsed; } catch { slides = []; }
  // D1544 (#3784): the version's art direction, which every image request on it inherits.
  return { deckId, projectId, slides, art: artDirectionOfTheme(themeOfRow(row)) };
}

/**
 * D1500: record the card's uid beside its place. Best effort, after the row is
 * written: a database without migration 714 still keeps the image by place.
 */
async function recordCardUid(env: Env, imageUid: string, cardUid: string | null): Promise<void> {
  if (!cardUid) return;
  try { await env.DB.prepare('UPDATE deck_images SET card_uid = ? WHERE uid = ?').bind(cardUid, imageUid).run(); }
  catch (e) { console.warn('[deck_images] card_uid not recorded', (e as Error)?.message); }
}

/** One image row by its uid, with the caller's write access to its venture checked. */
async function imageOf(c: any, user: User): Promise<any | Response> {
  const uid = String(c.req.param('uid') || '');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(row.project_id), { write: true }); } catch { return c.json({ error: 'not found' }, 404); }
  if (row.taken_down_at) return refuse(c, 410, { code: 'image_taken_down', message: TAKEN_DOWN_SENTENCE });
  return row;
}

/** The https app URL an image is read at: the request's own origin, never a data: URL. */
export const imageUrl = (requestUrl: string, uid: string) => new URL(`/api/decks/images/${uid}/file`, requestUrl).toString();

function view(c: any, r: any) {
  return {
    uid: r.uid, url: imageUrl(c.req.url, r.uid), state: r.state, use: r.use, source: r.source, card: r.card ?? null, card_uid: r.card_uid ?? null,
    style: r.style ?? null, aspect: r.aspect ?? null, overlay: r.overlay ?? null, alt: r.alt ?? '',
    width: r.width ?? null, height: r.height ?? null, model: r.model ?? null,
    model_label: imageModelLabel(r.model),
    usage_log_id: r.ai_usage_log_id ?? null, charged_microusd: r.charged_microusd ?? null,
    shows_person: r.shows_person === 1, created_at: r.created_at, kept_at: r.kept_at ?? null,
    // D1505 (#3756): the pipeline's step lines, seed and provenance.
    seed: r.seed ?? null, pipeline_uid: r.pipeline_uid ?? null, variant_index: r.variant_index ?? null,
    steps: parseJson(r.steps, null), provenance: parseJson(r.provenance_json, null),
    // D1534 (#3778): an upload's screen — flagged, not flagged, or not screened — never a block.
    screen: screenOf(r.qa_json),
  };
}

const parseJson = <T>(s: unknown, d: T): T => { try { return typeof s === 'string' && s ? JSON.parse(s) : d; } catch { return d; } };

/** What a description is refused for before anything is quoted or held, or null. */
async function refusedAsk(c: any, ask: ImageAsk, projectId: number): Promise<Response | null> {
  const text = [ask.description, ...ask.points].join(' ');
  if (personIn(text, await ventureNames(c.env, projectId))) return refuse(c, 422, { code: 'real_person', message: REAL_PERSON_MESSAGE });
  const fig = figureRefusal(text, projectId, 'an image description');
  if (fig) return refuse(c, 422, { code: fig.code, message: fig.message, extra: { figure: fig.figure, source_key: fig.source_key, module: fig.module, href: fig.href } });
  if (asksForChart(text)) return refuse(c, 422, { code: 'not_illustrative', message: NOT_ILLUSTRATIVE_MESSAGE });
  return null;
}

/** One image's run, as one options object, so the quote and the run read the same input. */
function runOptions(c: any, user: User, deck: Deck, ask: ImageAsk, colours: string[], pick: { model?: string; pinned?: true } = {}, references: DrawReference[] = []): RunOptions {
  const rail = { ...railFor(c, { page: IMAGE_PAGE, option: IMAGE_OPTION }, `deck:${deck.deckId}`), option: IMAGE_OPTION };
  // D1503 (#3754): the element's model is the caller's pick, which D1478's DK4 draw job weighs (`drawChoice`).
  // D1549 (#3796): an HQ lock runs pinned, so the draw job never swaps in another model.
  // D1544 (#3784): the deck's art direction: its note in the prompt, its seed family, its reference image when the model takes one.
  const note = deck.art.note ? ` Art direction: ${deck.art.note}.` : '';
  const seed = seedFor(deck.art, 0);
  return { ...pick, task: 'deck_image', drawJob: 'DK4', userId: Number(user.id) || 0, text: (promptOf(ask, colours) + note).slice(0, 2048), draw: { ...(seed != null ? { seed } : {}), ...(references.length ? { references } : {}) }, surface: AI_SURFACE.raisePitch, rail };
}

/** The grid element an image request is: a scene is a Generated photo, every other style an Illustration. */
export const imageElementOf = (ask: ImageAsk): 'photo' | 'illustration' => (ask.style === 'scene' ? 'photo' : 'illustration');

const coloursOf = (body: any): string[] => (Array.isArray(body?.colours) ? body.colours : []).filter((x: unknown): x is string => typeof x === 'string' && HEX.test(x)).slice(0, 4);

type Priced = { ask: ImageAsk; colours: string[]; opts: RunOptions; model: string; per: number; total: number; element: Resolved; args: DrawArgs; steps: Array<{ step: string; label: string; hold_microusd: number }> };

/** The checked request and its price, or the response that refuses it. Shared by the quote and the run. */
async function priced(c: any, user: User, deck: Deck): Promise<Priced | Response> {
  return pricedAsk(c, user, deck, await c.req.json().catch(() => ({} as any)));
}

/** One image request's checks and price, from its body. D1561's Replace all images prices each area through it. */
async function pricedAsk(c: any, user: User, deck: Deck, body: any): Promise<Priced | Response> {
  // D1544 (#3784): a request that names no style or palette takes the deck's art direction's.
  const read = askOf({ ...body, style: body?.style ?? deck.art.style, palette: body?.palette ?? deck.art.palette });
  if ('error' in read) return c.json({ error: read.error }, 400);
  const refused = await refusedAsk(c, read.ask, deck.projectId);
  if (refused) return refused;
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: NO_STORAGE });
  const colours = coloursOf(body);
  // D1503 (#3754): the image runs on its element's model, a scene as Generated photo and every other style as Illustration.
  let element: Resolved;
  try { element = await elementModelFor(c.env, user, deck.projectId, imageElementOf(read.ask)); } catch (e) {
    // D1509: an image element switched off answers as a surface not switched on, never as a failure.
    if (e instanceof ElementOffError) return refuse(c, 404, notSwitchedOn);
    return refuse(c, 503, { code: 'picks_unreadable', message: 'Your model picks for this deck could not be read. Nothing was run.' });
  }
  // D1549: HQ's lock wins; a lock the caller's plan cannot run stops the run before any quote or hold.
  if (lockedOut(element)) return lockedOutRefusal(c, element);
  let opts = runOptions(c, user, deck, read.ask, colours, runPickOf(element));
  let q = await quoteRun(c.env, opts);
  // D1544: the art direction's reference image, sent only to a model that takes references, and priced in the hold.
  const styleRef = q.ok ? await artReference(c.env, deck, q.model) : null;
  if (q.ok && styleRef) {
    opts = runOptions(c, user, deck, read.ask, colours, { ...runPickOf(element), model: q.model }, [styleRef]);
    q = await quoteRun(c.env, opts);
  }
  if (!q.ok) {
    const stop = refuseRun(c, { refusal: q.refusal, error: q.error });
    return stop ?? refuse(c, 503, { code: 'model_unavailable', message: 'The image model is not available. Nothing was run.' });
  }
  // D1505 (#3756): one image is every step of the pipeline, priced step by step under one figure (pd14).
  const ref = cardRefOf(deck.slides, { card: read.ask.card, card_uid: read.ask.card_uid });
  const args: DrawArgs = {
    userId: Number(user.id), deckId: deck.deckId, projectId: deck.projectId, slides: deck.slides, ask: read.ask,
    // D1544's note is in the prompt the pipeline draws, and its reference image in the draw's options.
    base: String(opts.text ?? promptOf(read.ask, colours)).slice(0, 2048), colours, draw: opts, model: q.model,
    area: typeof body?.area === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(body.area) ? body.area : null,
    slideAspect: (body?.slide_aspect === '4:3' ? '4:3' : '16:9') as Aspect,
    cardUid: 'error' in ref ? null : ref.uid, surface: AI_SURFACE.raisePitch, rail: opts.rail!,
    // The deck's one art direction (D1544, on the version's theme): the request's style and palette already default to it.
    art: deckArtOf(deck.art, deck.projectId, { style: read.ask.style, palette: read.ask.palette, colours: colours.slice(0, 4) }),
  };
  const pq = await quoteDeckImage(c.env, args);
  if (!pq.ok) {
    const stop = refuseRun(c, { refusal: pq.refusal, error: pq.error });
    return stop ?? refuse(c, 503, { code: 'model_unavailable', message: 'The image model is not available. Nothing was run.' });
  }
  return { ask: read.ask, colours, opts, model: q.model, per: pq.hold_microusd, total: pq.hold_microusd * read.ask.count, element, args, steps: pq.steps };
}

deckImages.post('/:id/images/quote', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const p = await priced(c, user, deck);
  if (p instanceof Response) {
    // A switched-off page is an answer the lightbox draws, not an error.
    const body: any = await p.clone().json().catch(() => null);
    if (body?.error === 'assist_off') return c.json({ ai: false, reason: 'assist_off', message: body.message });
    return p;
  }
  const short = await balanceRefusal(c.env, Number(user.id), p.total);
  return c.json({
    // D1478 (#3721): the model the run will use (the member's pick, when offered), not a fixed one.
    ai: true, model: p.model, model_label: imageModelLabel(p.model),
    models: [{ id: p.model, label: imageModelLabel(p.model), per_image_microusd: p.per }],
    per_image_microusd: p.per, count: p.ask.count, total_microusd: p.total,
    // D1505: expand prompt · draw · image check · style check · alt text, each priced (pd14).
    steps: p.steps,
    // D1549 (#3796): the element the image runs as, the model it resolved to and why.
    element_models: { [p.element.element]: { model: p.model, source: p.element.source, notice: p.element.notice, ...(p.element.locked ? { locked: true } : {}) } },
    balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true },
  });
});

deckImages.post('/:id/images', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const p = await priced(c, user, deck);
  if (p instanceof Response) return p;
  const userId = Number(user.id);
  // D1510 (#3761): the owner's daily ceiling, before anything is held or drawn.
  const ceiling = await deckCeilingRefusal(c.env, p.total);
  if (ceiling) return refuse(c, 429, ceiling);
  // Before any hold: the balance for every image asked for, then room on the venture's storage plan.
  const short = await balanceRefusal(c.env, userId, p.total);
  if (short) return refuse(c, 402, { code: short.code, message: short.message });
  let ticket;
  try { ticket = await assertStorageRoom(c.env, { projectId: deck.projectId }, IMAGE_BYTES_ESTIMATE * p.ask.count, user); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  // D1505 (#3756): every image runs the pipeline under one hold; a refused one is kept as discarded, settled at zero.
  const drawn = await drawDeckImages(c.env, p.args);
  if ('refusal' in drawn) {
    await noteStorageLanded(c.env, ticket);
    const stop = refuseRun(c, { refusal: drawn.refusal, error: drawn.error });
    return stop ?? refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not draw the image. Nothing was charged and nothing changed.' });
  }
  if (!drawn.rows.length && !drawn.refused.length && drawn.stopped) {
    await noteStorageLanded(c.env, ticket);
    return refuse(c, 503, { code: drawn.stopped.code, message: drawn.stopped.message });
  }
  if (!drawn.rows.length && drawn.refused.length) {
    // Every image was refused: a refusal in the words of the first one (pd15's
    // refused card), with the refused lines and the zero settle beside it, so
    // `refusalOf` draws it as the sentence and not "could not draw".
    await noteStorageLanded(c.env, ticket);
    const [first] = drawn.refused;
    return refuse(c, 422, { code: first.code, message: first.message, extra: { refused: drawn.refused, charged_microusd: 0, redraw: first.redraw } });
  }
  const images = drawn.rows;
  const stopped = drawn.stopped;
  await noteStorageLanded(c.env, ticket);
  const where = p.ask.card == null ? 'The deck' : `Card ${p.ask.card + 1}`;
  await auditDeckWrite(c, user, deck.projectId, 'deck_image_proposed', `${where}: ${images.length} image${images.length === 1 ? '' : 's'} proposed`);
  return c.json({ images: images.map((r) => view(c, r)), refused: drawn.refused, ...(stopped ? { stopped } : {}) });
});

// ───────────────────────────────────────────── D1561 (#3808): Replace all images

type LeftOut = { card: number; block: string; code: string; message: string };
type Planned = { area: ReplaceArea; p: Priced };

/**
 * Every image area of the deck (`replaceAreasOf`), each checked and priced as
 * its own press would be. An area whose description is refused (a person, a
 * figure, a chart: 422) is left out and named; any other refusal stops the
 * whole action before anything is held.
 */
async function replacePlan(c: any, user: User, deck: Deck, body: any): Promise<{ planned: Planned[]; leftOut: LeftOut[] } | Response> {
  const slideAspect = body?.slide_aspect === '4:3' ? '4:3' : '16:9';
  const areas = replaceAreasOf(deck.slides, slideAspect);
  if (!areas.length) return refuse(c, 409, { code: 'no_image_areas', message: 'This deck has no image areas to replace. Nothing was run.' });
  const planned: Planned[] = [];
  const leftOut: LeftOut[] = [];
  for (const area of areas) {
    const p = await pricedAsk(c, user, deck, {
      use: 'content', description: area.description, aspect: area.aspect, count: 1,
      card: area.card, card_uid: area.card_uid, area: area.area, slide_aspect: slideAspect,
    });
    if (p instanceof Response) {
      if (p.status !== 422) return p;
      const why: any = await p.clone().json().catch(() => ({}));
      leftOut.push({ card: area.card, block: area.block, code: String(why?.error || 'refused'), message: String(why?.message || 'This area was left out.') });
      continue;
    }
    planned.push({ area, p });
  }
  return { planned, leftOut };
}

/** One quote for every area: what each draw holds, and the hold with one redraw each (pd13's "Holds up to"). */
const replaceQuote = (planned: Planned[]) => {
  const total = planned.reduce((n, x) => n + x.p.per, 0);
  return { total, hold: total * 2 };
};

deckImages.post('/:id/images/replace-all/quote', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const plan = await replacePlan(c, user, deck, await c.req.json().catch(() => ({})));
  if (plan instanceof Response) {
    const body: any = await plan.clone().json().catch(() => null);
    if (body?.error === 'assist_off') return c.json({ ai: false, reason: 'assist_off', message: body.message });
    return plan;
  }
  const q = replaceQuote(plan.planned);
  const short = plan.planned.length ? await balanceRefusal(c.env, Number(user.id), q.hold) : null;
  return c.json({
    ai: true, count: plan.planned.length, total_microusd: q.total, hold_microusd: q.hold,
    areas: plan.planned.map(({ area, p }) => ({ card: area.card, block: area.block, area: area.area, aspect: area.aspect, model: p.model, per_image_microusd: p.per })),
    left_out: plan.leftOut,
    balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true },
  });
});

/**
 * Replace all images: every area drawn through #3756's pipeline under ONE hold,
 * one redraw each when the image check refuses it, a refused image charged
 * zero. The images are proposals, kept card by card as any other. An
 * `Idempotency-Key` makes a second press of the same key run nothing.
 */
deckImages.post('/:id/images/replace-all', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const plan = await replacePlan(c, user, deck, await c.req.json().catch(() => ({})));
  if (plan instanceof Response) return plan;
  if (!plan.planned.length) {
    const [first] = plan.leftOut;
    return refuse(c, 422, { code: first?.code || 'refused', message: first?.message || 'No image area could be drawn. Nothing was run.', extra: { left_out: plan.leftOut } });
  }
  const userId = Number(user.id);
  const q = replaceQuote(plan.planned);
  // D1510 (#3761): the owner's daily ceiling, before the one hold.
  const ceiling = await deckCeilingRefusal(c.env, q.hold);
  if (ceiling) return refuse(c, 429, ceiling);
  // The one hold refuses a balance that cannot cover it (402, the router's words) before anything is drawn.
  let ticket;
  try { ticket = await assertStorageRoom(c.env, { projectId: deck.projectId }, IMAGE_BYTES_ESTIMATE * plan.planned.length, user); }
  catch (e) { if (e instanceof Response) return e; throw e; }
  const key = c.req.header('Idempotency-Key');
  const idem = typeof key === 'string' && /^[A-Za-z0-9._:-]{8,64}$/.test(key) ? `deck-replace-all:${deck.deckId}:${key}` : null;
  const held = await reserveAiBudget(c.env, userId, q.hold, new Date(), { idempotencyKey: idem });
  if (!held.ok) {
    await noteStorageLanded(c.env, ticket);
    return refuseRun(c, { refusal: held.refusal, error: 'The images could not be held.' }) ?? refuse(c, 402, { code: 'hold_refused', message: 'The images could not be held. Nothing was run.' });
  }
  if ('replayed' in held && held.replayed) {
    await noteStorageLanded(c.env, ticket);
    return refuse(c, 409, { code: 'already_pressed', message: 'This Replace all images was already pressed. Its images are in the results.' });
  }
  const parent = held.reservation;
  const images: any[] = [];
  const refused: Array<Refused & { card: number }> = [];
  let stopped: { code: string; message: string } | null = null;
  let cost = 0;
  try {
    for (const { area, p } of plan.planned) {
      const drawn = await drawDeckImages(c.env, { ...p.args, parentHold: parent, autoRedraw: true });
      if ('refusal' in drawn) { stopped = { code: drawn.refusal, message: 'Eadwyn stopped before drawing every image. What it drew is below.' }; break; }
      images.push(...drawn.rows);
      refused.push(...drawn.refused.map((r) => ({ ...r, card: area.card })));
      if (drawn.stopped) { stopped = drawn.stopped; break; }
    }
  } finally {
    // The one hold settles once, at what the passed images cost; a refused image's runs were set to zero.
    const sum = await c.env.DB.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS c FROM ai_usage_logs WHERE reservation_uid = ? AND user_id = ?')
      .bind(parent.uid, userId).first<{ c: number }>();
    cost = Number(sum?.c ?? 0);
    await settleAiReservation(c.env, parent, cost, cost === 0);
    await noteStorageLanded(c.env, ticket);
  }
  await auditDeckWrite(c, user, deck.projectId, 'deck_images_replaced', `The deck: ${images.length} image${images.length === 1 ? '' : 's'} proposed for ${plan.planned.length} area${plan.planned.length === 1 ? '' : 's'}`);
  return c.json({
    images: images.map((r) => view(c, r)), refused, left_out: plan.leftOut, hold_microusd: q.hold, charged_microusd: cost,
    ...(stopped ? { stopped } : {}),
  });
});

type Landing = { use: Use; card: number | null; cardUid: string | null; alt: string; showsPerson: boolean; audit: string };

/**
 * D1506 (#3757): an uploaded or imported image, stored. The type is sniffed,
 * the size read from the header (over 50 MP is refused), the metadata stripped
 * and the stripped bytes hashed; a picture this venture already holds is
 * answered with that row, not stored twice (`UNIQUE(project_id, sha256)`,
 * migration 718). A discarded copy gives up its hash, so the new one is stored.
 */
async function landImage(c: any, user: User, deck: Deck, raw: Uint8Array, l: Landing): Promise<Response> {
  const mime = sniffMime(raw) as ImageMime | null;
  if (!mime) return c.json({ error: 'Upload a PNG, JPEG or WebP image.' }, 415);
  const size = imageSize(raw, mime);
  if (!size) return refuse(c, 415, { code: 'image_unreadable', message: 'This image’s size could not be read from the file. Save it again as PNG, JPEG or WebP and upload it.' });
  if (tooManyPixels(size)) return refuse(c, 413, { code: 'image_too_large', message: 'An image is at most 50 megapixels. Make it smaller and upload it again.' });
  const bytes = stripMetadata(raw, mime);
  const sha = await sha256Hex(bytes);
  const same = await c.env.DB.prepare('SELECT * FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(deck.projectId, sha).first() as any;
  // #4375: the same bytes as an image HQ took down are refused, not handed back as a duplicate.
  if (same?.taken_down_at) return refuse(c, 409, { code: 'image_taken_down', message: TAKEN_DOWN_SENTENCE });
  if (same && same.state !== 'discarded') return c.json({ image: view(c, same), duplicate: true });
  if (same) await c.env.DB.prepare('UPDATE deck_images SET sha256 = NULL WHERE id = ? AND project_id = ?').bind(same.id, deck.projectId).run();
  let ticket;
  try { ticket = await assertStorageRoom(c.env, { projectId: deck.projectId }, bytes.byteLength, user); }
  catch (e) { if (e instanceof Response) return e; throw e; }
  const uid = crypto.randomUUID();
  const key = `deck-images/${deck.projectId}/${uid}.${EXTENSION[mime]}`;
  try { await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mime }, customMetadata: { projectId: String(deck.projectId), userId: String(user.id) } }); }
  catch { return refuse(c, 503, { code: 'image_unsaved', message: 'The image could not be stored. Nothing was saved; try again in a moment.' }); }
  const userId = Number(user.id);
  const { use, card, alt, showsPerson } = l;
  // An uploaded background still has to read at 4.5:1: it is kept as a content image until Keep sets its overlay.
  await c.env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, card, r2_key, mime, size_bytes, width, height, sha256, source, use, alt, state,
      shows_person, person_consent_at, person_consent_by, created_by, kept_at, kept_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(uid, deck.projectId, deck.deckId, card, key, mime, bytes.byteLength, size.width, size.height, sha, use, alt, use === 'content' ? 'kept' : 'proposed',
      showsPerson ? 1 : 0, showsPerson ? new Date().toISOString() : null, showsPerson ? userId : null, userId,
      use === 'content' ? new Date().toISOString() : null, use === 'content' ? userId : null).run();
  await recordCardUid(c.env, uid, l.cardUid);
  await noteStorageLanded(c.env, ticket);
  // D1534 (#3778): the image screen flags an upload; it never blocks one.
  const rail = { ...railFor(c, { page: IMAGE_PAGE, option: IMAGE_OPTION }, `deck:${deck.deckId}`), option: IMAGE_OPTION };
  await screenUpload(c.env, { userId, rail, imageUid: uid, mime, bytes });
  await auditDeckWrite(c, user, deck.projectId, 'deck_image_uploaded', `${card == null ? 'The deck' : `Card ${card + 1}`}: ${l.audit}${showsPerson ? ', with the person’s agreement recorded' : ''}`);
  return c.json({ image: view(c, await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first()) }, 201);
}

/** The use, card and alt a request names, or the refusal. */
function landingOf(c: any, deck: Deck, get: (k: string) => unknown): Omit<Landing, 'showsPerson' | 'audit'> | Response {
  const use = (USES as readonly string[]).includes(String(get('use'))) ? String(get('use')) as Use : 'content';
  const ref = cardRefOf(deck.slides, { card: get('card'), card_uid: get('card_uid') });
  if ('error' in ref) return c.json({ error: ref.error }, 400);
  const alt = String(get('alt') ?? '').replace(/\s+/g, ' ').trim().slice(0, ALT_MAX);
  // D1534 (#3778): an upload or import is described before it is inserted.
  if (!alt) return refuse(c, 422, { code: 'alt_required', message: ALT_REQUIRED_MESSAGE });
  return { use, card: ref.index, cardUid: ref.uid, alt };
}

deckImages.post('/:id/images/upload', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Images cannot be stored here yet. Nothing was saved.' });
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return c.json({ error: 'Choose an image to upload.' }, 400);
  if (file.size > UPLOAD_MAX_BYTES) return c.json({ error: 'An image is at most 5 MB.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffMime(bytes)) return c.json({ error: 'Upload a PNG, JPEG or WebP image.' }, 415);
  // #2434 owner question 7, A: a photo of a person goes in only with their agreement recorded.
  const showsPerson = form!.get('shows_person') === '1';
  if (showsPerson && form!.get('consent') !== '1') return refuse(c, 422, { code: 'person_consent_required', message: PERSON_CONSENT_MESSAGE });
  const l = landingOf(c, deck, (k) => form!.get(k));
  if (l instanceof Response) return l;
  return landImage(c, user, deck, bytes, { ...l, showsPerson, audit: 'an image uploaded' });
});

/**
 * D1506 (#3757): an external image, copied in. `{ url, use?, card?, alt?, shows_person?, consent? }`.
 * The URL is fetched once through `fetchExternalImage` (https, a public host at
 * every hop, a deadline, the 5 MB cap) and stored like an upload; the deck then
 * reads our copy, never the other server.
 */
deckImages.post('/:id/images/import', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Images cannot be stored here yet. Nothing was saved.' });
  const body = await c.req.json().catch(() => null) as any;
  if (!body || typeof body.url !== 'string' || body.url.length > 2048) return c.json({ error: 'url required: the https address of a PNG, JPEG or WebP image.' }, 400);
  const showsPerson = body.shows_person === true;
  if (showsPerson && body.consent !== true) return refuse(c, 422, { code: 'person_consent_required', message: PERSON_CONSENT_MESSAGE });
  const l = landingOf(c, deck, (k) => body[k]);
  if (l instanceof Response) return l;
  const got = await fetchExternalImage(body.url, UPLOAD_MAX_BYTES);
  if (!got.ok) {
    if (got.code === 'unsafe_url') return refuse(c, 422, { code: 'unsafe_url', message: 'Only a public https address can be copied in. Nothing was saved.' });
    if (got.code === 'too_large') return c.json({ error: 'An image is at most 5 MB.' }, 413);
    return refuse(c, 502, { code: 'image_unfetched', message: 'That address did not return an image. Nothing was saved.' });
  }
  return landImage(c, user, deck, got.bytes, { ...l, showsPerson, audit: 'an image copied in from a link' });
});

deckImages.get('/:id/images', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user, false);
  if (deck instanceof Response) return deck;
  const rows = await c.env.DB.prepare("SELECT * FROM deck_images WHERE project_id = ? AND state = 'kept' AND taken_down_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 100")
    .bind(deck.projectId).all();
  return c.json({ images: (rows.results ?? []).map((r: any) => view(c, r)) });
});

deckImages.get('/:id/images/plan', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user, false);
  if (deck instanceof Response) return deck;
  const row = await getDeckRow(c.env, deck.deckId);
  let slides: any[] = [];
  try { slides = JSON.parse(row?.slides || '[]'); } catch { slides = []; }
  const theme = themeOfRow(row);
  const kit = await fetchLandingPageForProject(c.env, deck.projectId);
  return c.json(imagePlan(slides, theme?.kind ?? 'brand', kit, imageCapability(c.env)));
});

deckImages.post('/images/:uid/keep', async (c) => {
  const user = await requireAuth(c);
  const row = await imageOf(c, user);
  if (row instanceof Response) return row;
  if (row.state === 'discarded') return refuse(c, 409, { code: 'image_discarded', message: 'This image was discarded. Generate or upload another.' });
  const body = await c.req.json().catch(() => ({} as any));
  const use = (USES as readonly string[]).includes(body?.use) ? body.use as Use : row.use as Use;
  const overlay = (OVERLAYS as readonly string[]).includes(body?.overlay) ? body.overlay as Overlay : (row.overlay as Overlay | null) ?? 'none';
  const ink = typeof body?.ink === 'string' && HEX.test(body.ink) ? body.ink : undefined;
  // PD12b, PD12c: a background is kept only when its text reads at 4.5:1 wherever it falls.
  if (use !== 'content' && !readable(overlay, ink)) {
    return refuse(c, 422, { code: 'contrast_low', message: `The text reads at ${overlayContrast(overlay, ink)}:1 on this overlay. Choose an overlay that reaches 4.5:1.`, extra: { contrast: overlayContrast(overlay, ink) } });
  }
  const alt = typeof body?.alt === 'string' ? body.alt.replace(/\s+/g, ' ').trim().slice(0, ALT_MAX) : row.alt;
  await c.env.DB.prepare(`UPDATE deck_images SET state = 'kept', use = ?, overlay = ?, alt = ?, kept_at = COALESCE(kept_at, datetime('now')), kept_by = COALESCE(kept_by, ?)
    WHERE uid = ? AND state <> 'discarded'`).bind(use, use === 'content' ? null : overlay, alt ?? '', Number(user.id), row.uid).run();
  const kept = await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(row.uid).first<any>();
  const label = use === 'content' ? 'a content image' : use === 'card' ? 'a card background' : 'the deck background';
  await auditDeckWrite(c, user, Number(row.project_id), 'deck_image_kept', `${row.card == null ? 'The deck' : `Card ${Number(row.card) + 1}`}: ${label} kept`);
  return c.json({ image: view(c, kept) });
});

deckImages.post('/images/:uid/discard', async (c) => {
  const user = await requireAuth(c);
  const row = await imageOf(c, user);
  if (row instanceof Response) return row;
  // A kept image may already sit in a saved version, which keeps reading it.
  if (row.state === 'kept') return refuse(c, 409, { code: 'image_kept', message: 'A kept image stays: a saved version may show it. Remove it from the card instead.' });
  // D1508: the daily cleanup removes it from R2 24 hours after this, unless a version, draft or proposal names it.
  await c.env.DB.prepare("UPDATE deck_images SET state = 'discarded', discarded_at = datetime('now') WHERE uid = ? AND state = 'proposed'").bind(row.uid).run();
  return c.json({ ok: true, uid: row.uid });
});

deckImages.get('/images/:uid/file', async (c) => {
  const uid = String(c.req.param('uid') || '');
  if (!UID.test(uid) || !c.env.FILES) return c.json({ error: 'not found' }, 404);
  const row = await c.env.DB.prepare('SELECT uid, project_id, r2_key, mime, state, taken_down_at FROM deck_images WHERE uid = ?').bind(uid).first<any>();
  if (!row || row.state === 'discarded') return c.json({ error: 'not found' }, 404);
  // #4375: a taken-down image answers the neutral placeholder, read before R2, so every card, version,
  // draft and export that names it draws "Image removed by Axal HQ" and never the removed bytes.
  if (row.taken_down_at) {
    return new Response(takedownPng(), { headers: {
      'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
      'cache-control': 'no-store', 'x-axal-image-state': 'taken-down',
    } });
  }
  if (row.state !== 'kept') {
    // A proposal is the venture's own until it is kept.
    try { const user = await requireAuth(c); await projectOwned(c, user, Number(row.project_id), { write: true }); }
    catch { return c.json({ error: 'not found' }, 404); }
  }
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) return c.json({ error: 'not found' }, 404);
  return new Response(object.body, { headers: {
    'content-type': row.mime, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
    'cache-control': row.state === 'kept' ? 'public, max-age=31536000, immutable' : 'private, no-store',
  } });
});

export default deckImages;
