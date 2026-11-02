/**
 * D1562 (#3809, deck v2 D1) — the deck brand kit's write, and Apply brand.
 *
 *   PUT  /api/decks/brand-kit?project_id=
 *        { fonts: { heading, body } | null, logo_url, palette: { ground?, ink?,
 *          accent?, secondary?, muted? }, image_style, library: [{ url, alt?, reference? }] }
 *        → { project_id, kit }   the same view `GET /api/decks/brand-kit` answers
 *   POST /api/decks/:id/apply-brand  { cards?, theme? }
 *        → { deck_id, theme, cards, changed, tokens, problems: [], reason, adjustments }
 *
 * The read stays `GET /api/decks/brand-kit` in `decks.ts`; both answer the
 * view of `services/decks/brandKit.ts`.
 *
 * THE WRITE replaces the whole deck kit in one D1 batch (the row and its
 * library), so a failed write leaves the kit as it was. Fonts are a pair from
 * the Google Fonts (OFL) list only (owner decision K = A); the logo and every
 * library image pass the deck image guard. Nothing about a person, an email
 * or a figure is logged.
 *
 * APPLY BRAND never calls a model and writes nothing. `cards` and `theme` are
 * the deck as the editor holds it (its unsaved edits included), sanitised as
 * a save would be; without them it restyles the stored version. It answers
 * the whole restyled deck at once, which the editor applies as ONE edit, so
 * one Undo puts every card and the theme back. A deck it cannot restyle
 * without a contrast failure is refused (`problems` is [] on every 200).
 * With no kit recorded it refuses with `no_kit`, never a sample kit.
 *
 * Who: writing the kit, and applying it, need write access to the venture
 * (`projectOwned` with `write`); a support session may not write the kit.
 * All SQL is bound (in `brandKit.ts`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import decks, { ensureSchema, getDeckRow, projectOwned, sanitizeImageUrl, themeOfRow } from './decks';
import type { RouteMount } from '../util/routeRegistry';
import { isSupportSession } from '../integrations/providers/mercury';
import { refuse } from '../util/refusal';
import { sanitizeModel, sanitizeTheme } from '../services/decks/slideModel';
import { KIT_CHOICES, applyBrandToDeck, kitBody, readKitView, writeDeckKit } from '../services/decks/brandKit';

/** The most cards one Apply brand restyles; a deck past it is refused, never cut. */
export const APPLY_MAX_CARDS = 100;

const deckBrandKit = new Hono<{ Bindings: Env }>();

deckBrandKit.put('/brand-kit', async (c) => {
  const user = await requireAuth(c);
  const pid = Number(c.req.query('project_id'));
  if (!Number.isSafeInteger(pid) || pid <= 0) return c.json({ error: 'project_id required' }, 400);
  try { await projectOwned(c, user, pid, { write: true }); } catch { return c.json({ error: 'forbidden' }, 403); }
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot change this member\'s brand kit.' });
  const body = kitBody(await c.req.json().catch(() => null), sanitizeImageUrl);
  if ('code' in body) return refuse(c, body.status, { code: body.code, message: body.message });
  try {
    await writeDeckKit(c.env, pid, Number(user.id), body);
    return c.json({ project_id: pid, kit: await readKitView(c.env, pid, sanitizeImageUrl), choices: KIT_CHOICES });
  } catch (e) {
    console.warn('[deck_brand_kit] write failed', (e as Error)?.message);
    return refuse(c, 503, { code: 'unwritten', message: 'Your brand kit could not be saved. Nothing was changed. Try again.' });
  }
});

deckBrandKit.post('/:id{[0-9]+}/apply-brand', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({})) as { cards?: unknown; theme?: unknown } | null;
  if (body?.cards != null && !Array.isArray(body.cards)) return c.json({ error: 'cards must be the deck\'s cards' }, 400);
  if (Array.isArray(body?.cards) && body!.cards.length > APPLY_MAX_CARDS) return refuse(c, 400, { code: 'too_many_cards', message: `Apply brand restyles at most ${APPLY_MAX_CARDS} cards at once.` });
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  const pid = Number(row.project_id);
  try { await projectOwned(c, user, pid, { write: true, audit: false }); } catch { return c.json({ error: 'forbidden' }, 403); }
  let kit;
  try { kit = await readKitView(c.env, pid, sanitizeImageUrl); } catch (e) {
    console.warn('[deck_brand_kit] kit unreadable', (e as Error)?.message);
    return refuse(c, 503, { code: 'unreadable', message: 'Your brand kit could not be read, so nothing was applied. Try again.' });
  }
  if (!kit) return refuse(c, 409, { code: 'no_kit', message: 'No brand kit is recorded yet. Add a logo, a palette or a font pair under Brand kit, then apply it.' });
  let raw: unknown[];
  if (Array.isArray(body?.cards)) raw = body!.cards;
  else { try { raw = JSON.parse(row.slides || '[]'); } catch { raw = []; } }
  const cards = raw.map((s: any) => (s && typeof s === 'object' && !Array.isArray(s) ? { ...s, ...sanitizeModel(s, sanitizeImageUrl) } : s));
  const theme = body && 'theme' in body ? sanitizeTheme(body.theme, sanitizeImageUrl) : themeOfRow(row);
  const r = applyBrandToDeck(cards, theme, kit);
  // The applied theme passes the save's own sanitiser, so the editor can save what it is handed.
  const saved = sanitizeTheme(r.theme, sanitizeImageUrl);
  if (r.problems.length || !saved) return refuse(c, 422, { code: 'unreadable_result', message: 'Apply brand would leave text that cannot be read, so nothing was applied.' });
  return c.json({ deck_id: Number(row.id), theme: saved, cards: r.cards, changed: r.changed, tokens: r.tokens, problems: r.problems, reason: r.reason, adjustments: r.adjustments });
});

export const mount: RouteMount = { path: '/api/decks', router: deckBrandKit, before: [decks] };
export default deckBrandKit;
