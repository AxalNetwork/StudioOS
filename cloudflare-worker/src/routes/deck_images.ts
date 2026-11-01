/**
 * D903 (#2682, part 9 of #2434) — images for the pitch deck's cards and
 * backgrounds (PD12–PD12e).
 *
 *   POST /api/decks/:id/images/quote
 *        { use, description, style, palette, aspect, count, card?, points?, colours? }
 *        → { ai: true, models: [{ id, label, per_image_microusd }], model, per_image_microusd, count,
 *            total_microusd, balance: { ok, code?, message? } } | { ai: false, reason, message }
 *   POST /api/decks/:id/images           (the same body) → { images: [image], stopped? }
 *   POST /api/decks/:id/images/upload    multipart: file, use, card?, alt?, shows_person?, consent?
 *   POST /api/decks/:id/images/import    D1506: { url, use?, card?, alt?, shows_person?, consent? }, an external image copied into R2
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
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import {
  ALT_MAX, EXTENSION, IMAGE_BYTES_ESTIMATE, IMAGE_MODEL, IMAGE_OPTION, IMAGE_PAGE, MIMES, NOT_ILLUSTRATIVE_MESSAGE, imageModelLabel,
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
import { imageSize, sha256Hex, stripMetadata, tooManyPixels, type ImageMime } from '../services/decks/imageBytes';
import { fetchExternalImage } from '../services/decks/imageFetch';

const deckImages = new Hono<{ Bindings: Env }>();

const HEX = /^#[0-9a-f]{6}$/i;
const UID = /^[0-9a-f-]{36}$/;
const NO_STORAGE = 'Images cannot be stored here yet. Nothing was run and nothing was charged.';

type Deck = { deckId: number; projectId: number; slides: unknown[] };

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
  return { deckId, projectId, slides };
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
  };
}

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
function runOptions(c: any, user: User, deck: Deck, ask: ImageAsk, colours: string[]): RunOptions {
  const rail = { ...railFor(c, { page: IMAGE_PAGE, option: IMAGE_OPTION }, `deck:${deck.deckId}`), option: IMAGE_OPTION };
  return { task: 'deck_image', drawJob: 'DK4', userId: Number(user.id) || 0, text: promptOf(ask, colours).slice(0, 2048), draw: {}, surface: AI_SURFACE.raisePitch, rail };
}

const coloursOf = (body: any): string[] => (Array.isArray(body?.colours) ? body.colours : []).filter((x: unknown): x is string => typeof x === 'string' && HEX.test(x)).slice(0, 4);

/** What a run charged, from its usage row; null when it is not known. */
async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

type Priced = { ask: ImageAsk; colours: string[]; opts: RunOptions; model: string; per: number; total: number };

/** The checked request and its price, or the response that refuses it. Shared by the quote and the run. */
async function priced(c: any, user: User, deck: Deck): Promise<Priced | Response> {
  const body = await c.req.json().catch(() => ({} as any));
  const read = askOf(body);
  if ('error' in read) return c.json({ error: read.error }, 400);
  const refused = await refusedAsk(c, read.ask, deck.projectId);
  if (refused) return refused;
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: NO_STORAGE });
  const colours = coloursOf(body);
  const opts = runOptions(c, user, deck, read.ask, colours);
  const q = await quoteRun(c.env, opts);
  if (!q.ok) {
    const stop = refuseRun(c, { refusal: q.refusal, error: q.error });
    return stop ?? refuse(c, 503, { code: 'model_unavailable', message: 'The image model is not available. Nothing was run.' });
  }
  return { ask: read.ask, colours, opts, model: q.model, per: q.hold_microusd, total: q.hold_microusd * read.ask.count };
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
  // Before any hold: the balance for every image asked for, then room on the venture's storage plan.
  const short = await balanceRefusal(c.env, userId, p.total);
  if (short) return refuse(c, 402, { code: short.code, message: short.message });
  let ticket;
  try { ticket = await assertStorageRoom(c.env, { projectId: deck.projectId }, IMAGE_BYTES_ESTIMATE * p.ask.count, user); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const ref = cardRefOf(deck.slides, { card: p.ask.card, card_uid: p.ask.card_uid });
  const cardUid = 'error' in ref ? null : ref.uid;
  const images: any[] = [];
  let stopped: { code: string; message: string } | null = null;
  for (let i = 0; i < p.ask.count; i += 1) {
    const r = await run(c.env, { ...p.opts, surface: AI_SURFACE.raisePitch, rail: p.opts.rail });
    if (!r.ok || !r.image) {
      const answer = refuseRun(c, r);
      if (!images.length) return answer ?? refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not draw the image. Nothing was charged and nothing changed.' });
      const body: any = await answer?.clone().json().catch(() => null);
      stopped = { code: body?.error || 'model_unavailable', message: body?.message || 'Eadwyn stopped before drawing every image. What it drew is below.' };
      break;
    }
    const mime = (MIMES as readonly string[]).includes(r.image.mime) ? r.image.mime as typeof MIMES[number] : sniffMime(r.image.bytes);
    const charged = await chargedOf(c.env, r.usageLogId, userId);
    if (!mime) { stopped = { code: 'image_unreadable', message: 'The image came back in a format the deck cannot show. It was charged; nothing was placed.' }; break; }
    // D1506: a drawn image is stripped, measured and hashed like an upload. The same picture twice keeps no hash the second time.
    const drawn = stripMetadata(r.image.bytes, mime as ImageMime);
    const drawnSize = imageSize(drawn, mime as ImageMime);
    const drawnSha = await sha256Hex(drawn);
    const taken = await c.env.DB.prepare('SELECT 1 FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(deck.projectId, drawnSha).first();
    const uid = crypto.randomUUID();
    const key = `deck-images/${deck.projectId}/${uid}.${EXTENSION[mime]}`;
    try {
      await c.env.FILES!.put(key, drawn, { httpMetadata: { contentType: mime }, customMetadata: { projectId: String(deck.projectId), userId: String(userId) } });
    } catch {
      stopped = { code: 'image_unsaved', message: 'Eadwyn drew the image, but it could not be stored. It was charged for the run; try again in a moment.' };
      break;
    }
    await c.env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, card, r2_key, mime, size_bytes, width, height, sha256, source, prompt, style, aspect, use,
        state, model, ai_usage_log_id, charged_microusd, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`)
      .bind(uid, deck.projectId, deck.deckId, p.ask.card, key, mime, drawn.byteLength, drawnSize?.width ?? r.image.width, drawnSize?.height ?? r.image.height, taken ? null : drawnSha,
        p.ask.description, p.ask.style, p.ask.aspect, p.ask.use, r.usage?.model ?? IMAGE_MODEL, r.usageLogId ?? null, charged, userId).run();
    await recordCardUid(c.env, uid, cardUid);
    images.push(await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first());
  }
  await noteStorageLanded(c.env, ticket);
  const where = p.ask.card == null ? 'The deck' : `Card ${p.ask.card + 1}`;
  await auditDeckWrite(c, user, deck.projectId, 'deck_image_proposed', `${where}: ${images.length} image${images.length === 1 ? '' : 's'} proposed`);
  return c.json({ images: images.map((r) => view(c, r)), ...(stopped ? { stopped } : {}) });
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
  await auditDeckWrite(c, user, deck.projectId, 'deck_image_uploaded', `${card == null ? 'The deck' : `Card ${card + 1}`}: ${l.audit}${showsPerson ? ', with the person’s agreement recorded' : ''}`);
  return c.json({ image: view(c, await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first()) }, 201);
}

/** The use, card and alt a request names, or the refusal. */
function landingOf(c: any, deck: Deck, get: (k: string) => unknown): Omit<Landing, 'showsPerson' | 'audit'> | Response {
  const use = (USES as readonly string[]).includes(String(get('use'))) ? String(get('use')) as Use : 'content';
  const ref = cardRefOf(deck.slides, { card: get('card'), card_uid: get('card_uid') });
  if ('error' in ref) return c.json({ error: ref.error }, 400);
  const alt = String(get('alt') ?? '').replace(/\s+/g, ' ').trim().slice(0, ALT_MAX);
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
  const rows = await c.env.DB.prepare("SELECT * FROM deck_images WHERE project_id = ? AND state = 'kept' ORDER BY created_at DESC, id DESC LIMIT 100")
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
  await c.env.DB.prepare("UPDATE deck_images SET state = 'discarded' WHERE uid = ? AND state = 'proposed'").bind(row.uid).run();
  return c.json({ ok: true, uid: row.uid });
});

deckImages.get('/images/:uid/file', async (c) => {
  const uid = String(c.req.param('uid') || '');
  if (!UID.test(uid) || !c.env.FILES) return c.json({ error: 'not found' }, 404);
  const row = await c.env.DB.prepare('SELECT uid, project_id, r2_key, mime, state FROM deck_images WHERE uid = ?').bind(uid).first<any>();
  if (!row || row.state === 'discarded') return c.json({ error: 'not found' }, 404);
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
