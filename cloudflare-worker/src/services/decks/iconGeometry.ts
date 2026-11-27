/**
 * D4574 H3 (#4574) — the deck icon set's NODES, read from a static asset
 * instead of the Worker script.
 *
 * `iconSet.json` was 395.5 KiB of the script, its largest single input, while
 * `elements.ts` needs only the 1,877 names to name, search and check an icon.
 * So the nodes and the licence text ship as a static asset
 * (`frontend/public/deck-icons/lucide-<version>.json`, written by
 * `scripts/gen-deck-icon-set.mjs`) and are read here, through the Worker's own
 * assets binding — the same pattern as `services/articleCovers.ts`. The
 * asset's name carries the set version, so one deploy's script never reads
 * another's nodes.
 *
 * Read once per isolate and remembered. A read that fails is NOT remembered:
 * the next request tries again, and the caller says the set could not be read
 * (`Unreadable`) rather than showing an empty library.
 *
 * Only two callers draw: `routes/deck_elements.ts` (the library panel) and the
 * PowerPoint writer by way of `routes/deck_exports.ts`.
 */
import type { Env } from '../../types';
import { ICON_ASSET, ICON_SET_VERSION, type IconGeometry, type Node } from './elements';

const LOADED = new WeakMap<object, IconGeometry>();
// The DB binding, as `articleCovers.ts` keys its own cache: one isolate has one
// DB, and it outlives any one request, so this is per-isolate. The assets
// binding is only the fallback, for a caller that has no DB.
const keyOf = (env: Env): object => (env.DB as unknown as object) ?? (env.ASSETS as unknown as object);

const ALLOWED = new Set(['path', 'circle', 'rect', 'line', 'ellipse', 'polyline', 'polygon']);

/**
 * The asset's parsed body, or null when it is anything but the set this script
 * was built with. A missing file answers the SPA shell
 * (`not_found_handling = "single-page-application"`), so an HTML answer, a
 * wrong version and a node list naming an element the set may not draw are all
 * refused here rather than reaching the sanitiser.
 */
function parse(body: unknown): IconGeometry | null {
  const b = body as { version?: unknown; licence_text?: unknown; icons?: unknown };
  if (!b || typeof b !== 'object') return null;
  if (b.version !== ICON_SET_VERSION) return null;
  if (typeof b.licence_text !== 'string' || !b.licence_text.trim()) return null;
  if (!b.icons || typeof b.icons !== 'object' || Array.isArray(b.icons)) return null;
  const nodes: Record<string, Node[]> = Object.create(null);
  for (const [name, list] of Object.entries(b.icons as Record<string, unknown>)) {
    if (!Array.isArray(list)) return null;
    for (const n of list) {
      if (!Array.isArray(n) || n.length !== 2 || !ALLOWED.has(String(n[0]))) return null;
      if (!n[1] || typeof n[1] !== 'object' || Array.isArray(n[1])) return null;
    }
    nodes[name] = list as Node[];
  }
  return { nodes, licence_text: b.licence_text };
}

/**
 * The icon geometry for this isolate, or null when the asset could not be
 * read. Callers treat null as "the set could not be read", never as an empty
 * set.
 */
export async function loadIconGeometry(env: Env): Promise<IconGeometry | null> {
  const key = keyOf(env);
  if (key) {
    const had = LOADED.get(key);
    if (had) return had;
  }
  if (!env.ASSETS) return null;
  try {
    // A URL string, not a Request built from the caller's: this reads one
    // static file and forwards nothing (the auth inventory reads
    // `fetch(new Request` as a relay).
    const res = await env.ASSETS.fetch(`https://assets.local${ICON_ASSET}`);
    if (!res.ok || !String(res.headers.get('content-type') || '').includes('json')) return null;
    const geo = parse(await res.json());
    if (geo && key) LOADED.set(key, geo);
    return geo;
  } catch (e) {
    console.warn('[iconGeometry] the icon set could not be read:', (e as Error).message);
    return null;
  }
}
