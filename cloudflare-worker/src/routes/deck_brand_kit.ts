/**
 * D1562 (#3809, deck v2 D1) — the deck brand kit's writer and Apply brand.
 *
 *   PUT  /api/decks/brand-kit?project_id=   { fonts?, palette?, image_style?, references?, logo_uid? }
 *        the venture's deck brand kit (migration 737), replaced whole. Fonts are
 *        two of `BRAND_FONTS` (Google Fonts under the OFL, decision K); palette
 *        roles are #rrggbb; references (at most three) and the logo are kept deck
 *        images of this venture, or the save is refused, naming the one that is not.
 *   POST /api/decks/:id/apply-brand
 *        the deck restyled with the kit as ONE new version (one undo step):
 *        theme `brand`, the font pair, the logo corner, and the art direction from
 *        the image style. Never a model, never a charge. A palette colour that
 *        would fail contrast is left out and named in `adjustments`.
 *
 * `GET /api/decks/brand-kit` (D898, `decks.ts`) reads the kit, with these
 * fields under `kit.deck`. Writers of the venture only, as the deck save.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import decks, { auditDeckWrite, ensureSchema, getDeckRow, insertVersion, projectOwned, rowToDeck, sanitizeSlides, themeOfRow } from './decks';
import type { RouteMount } from '../util/routeRegistry';
import { fetchLandingPageForProject } from '../services/decks/branding';
import { applyBrand, deckBrandKitFor, keptImagesOf, sanitizeBrandKit, saveDeckBrandKit } from '../services/decks/brandKit';

const deckBrandKit = new Hono<{ Bindings: Env }>();

deckBrandKit.put('/brand-kit', async (c) => {
  const user = await requireAuth(c);
  const pid = Number(c.req.query('project_id'));
  if (!Number.isSafeInteger(pid) || pid <= 0) return c.json({ error: 'project_id required' }, 400);
  try { await projectOwned(c, user, pid, { write: true }); } catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => null) as any;
  if (!body || typeof body !== 'object') return c.json({ error: 'A brand kit is required.' }, 400);
  if (body.fonts != null && (typeof body.fonts !== 'object')) return c.json({ error: 'fonts must be { display, body }.' }, 400);
  const kit = sanitizeBrandKit(body);
  if (body.fonts && !kit.fonts) return refuse(c, 422, { code: 'font_not_offered', message: 'Choose two fonts from the list: Google Fonts under the open font licence.' });
  const named = [...kit.references, ...(kit.logo_uid ? [kit.logo_uid] : [])];
  const kept = await keptImagesOf(c.env, pid, named);
  const missing = named.find((u) => !kept.has(u));
  if (missing) return refuse(c, 422, { code: 'image_not_kept', message: 'A reference image or the logo is not a kept image of this venture. Keep it in the image library first.', extra: { image_uid: missing } });
  await saveDeckBrandKit(c.env, pid, kit, Number(user.id) || null);
  await auditDeckWrite(c, user, pid, 'deck_brand_kit_saved', 'Deck brand kit saved');
  return c.json({ project_id: pid, deck: await deckBrandKitFor(c.env, pid) });
});

deckBrandKit.post('/:id{[0-9]+}/apply-brand', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  const pid = Number(row.project_id);
  try { await projectOwned(c, user, pid, { write: true }); } catch { return c.json({ error: 'forbidden' }, 403); }
  let kit;
  try { kit = await deckBrandKitFor(c.env, pid); }
  catch { return refuse(c, 503, { code: 'unreadable', message: 'Your brand kit could not be read. Nothing was changed.' }); }
  const landing = await fetchLandingPageForProject(c.env, pid).catch(() => null);
  if (!kit && !landing) return refuse(c, 409, { code: 'no_brand_kit', message: 'There is no brand kit to apply yet. Add one under ⋯ › Brand kit.' });
  const applied = applyBrand(themeOfRow(row), landing, kit ?? sanitizeBrandKit({}));
  if (applied.problems.length) return refuse(c, 409, { code: 'contrast', message: applied.problems[0] });
  // Cards that cannot be read are refused, never saved over with an empty deck.
  let slides: any[];
  try { slides = sanitizeSlides(JSON.parse(row.slides || '[]')); }
  catch { return refuse(c, 503, { code: 'unreadable', message: 'This deck could not be read. Nothing was changed.' }); }
  const newId = await insertVersion(c.env, pid, slides, row.title, Number(user.id) || null,
    { audience: row.audience ?? null, round_ref: row.round_ref ?? null, theme: applied.theme });
  await auditDeckWrite(c, user, pid, 'deck_brand_applied', 'Brand kit applied to the deck');
  return c.json({ deck: rowToDeck(await getDeckRow(c.env, Number(newId))), adjustments: applied.adjustments, one_undo_step: true });
});

// Ahead of `decks`, whose `/:id` routes would otherwise take these paths.
export const mount: RouteMount = { path: '/api/decks', router: deckBrandKit, before: [decks] };

export default deckBrandKit;
