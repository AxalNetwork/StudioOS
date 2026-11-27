/**
 * D1541 (#3779, deck v2 B3) — the elements library a card's decor draws from.
 *
 * D4574 H3 (#4574): an icon's nodes are a static asset, not part of the Worker
 * script, so the two routes that draw one load the geometry first
 * (`decks/iconGeometry.ts`). Where the asset cannot be read the reply says so
 * — `unreadable: true` with a `reason` and no SVGs, a 503 for the licence
 * text — rather than answering an empty set.
 *
 *   GET /api/decks/elements
 *       → { licence: { id, name, version, spdx, url, copyright, derived }, decor_max: 16,
 *           icons: { total }, shapes: [Item], dividers: [Item], textures: [Item],
 *           generate: { available: false, reason } }
 *   GET /api/decks/elements/icons?q=&offset=&limit=   (limit ≤ 120), or ?refs=a,b,… (≤ 16) for the icons a card holds
 *       → { total, offset, icons: [{ ref, label, svg }], licence }, or
 *         { …, icons: [], unreadable: true, reason } where the set's asset could not be read
 *   GET /api/decks/elements/licence                    the set's full licence text, as text/plain; 503 where it could not be read
 *
 * `Item` is `{ kind, ref, label, svg }`. Every `svg` is drawn by
 * `services/decks/elements.ts` and has passed its sanitiser; colours are the
 * theme's tones (`var(--deck-ink)` and the like), never a value. "Generate an
 * icon" (`grid_icon`) is phase 2: `generate` says so, and no route here runs a
 * model.
 *
 * Who: anyone signed in. The library is the same for every member; placing an
 * item on a card is the deck's own save, which `slideModel` checks (16 at most,
 * a library item it cannot draw refused).
 *
 * Mounted before `decks`, so `/elements` never reaches `GET /api/decks/:id`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import {
  DIVIDERS, LICENCE_RECORD, MAX_DECOR, SHAPES, TEXTURES, decorSvg, iconCount, iconSvg, isIcon, licenceText, searchIcons,
} from '../services/decks/elements';
import { loadIconGeometry } from '../services/decks/iconGeometry';

/** What the reply says where the icon set's asset could not be read. */
const UNREADABLE = 'The icon set could not be read.';

const deckElements = new Hono<{ Bindings: Env }>();

const items = (kind: 'shape' | 'divider' | 'texture', list: ReadonlyArray<{ id: string; label: string }>) =>
  list.map((x) => ({ kind, ref: x.id, label: x.label, svg: decorSvg({ kind, ref: x.id }) }));
const label = (ref: string) => ref.replace(/-/g, ' ');

deckElements.get('/elements', async (c) => {
  await requireAuth(c);
  c.header('Cache-Control', 'private, max-age=3600');
  return c.json({
    licence: LICENCE_RECORD, decor_max: MAX_DECOR,
    icons: { total: iconCount() },
    shapes: items('shape', SHAPES), dividers: items('divider', DIVIDERS), textures: items('texture', TEXTURES),
    generate: { available: false, reason: 'Coming later' },
  });
});

deckElements.get('/elements/icons', async (c) => {
  await requireAuth(c);
  const q = String(c.req.query('q') ?? '').slice(0, 80);
  const offset = Number(c.req.query('offset') ?? 0);
  const limit = Number(c.req.query('limit') ?? 60);
  const refs = String(c.req.query('refs') ?? '').split(',').map((r) => r.trim()).filter(isIcon).slice(0, MAX_DECOR);
  const found = c.req.query('refs') != null ? { total: refs.length, names: refs } : searchIcons(q, offset, limit);
  // D4574 H3: the names come from the script, the nodes from the asset. A page
  // of names whose nodes could not be read is `unreadable`, never an empty page.
  const geo = await loadIconGeometry(c.env);
  if (geo) c.header('Cache-Control', 'private, max-age=3600');
  return c.json({
    total: found.total, offset: Math.max(0, Math.trunc(offset) || 0),
    icons: geo ? found.names.map((ref) => ({ kind: 'icon', ref, label: label(ref), svg: iconSvg(geo, ref) })) : [],
    ...(geo ? {} : { unreadable: true, reason: UNREADABLE }),
    licence: { set: LICENCE_RECORD.id, version: LICENCE_RECORD.version, spdx: LICENCE_RECORD.spdx },
  });
});

deckElements.get('/elements/licence', async (c) => {
  await requireAuth(c);
  // D4574 H3: the licence text travels with the nodes in the asset.
  const text = licenceText(await loadIconGeometry(c.env));
  if (!text) return c.json({ detail: UNREADABLE }, 503);
  return c.text(text, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

export default deckElements;
