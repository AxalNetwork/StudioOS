/**
 * D1315 (#2418) — Account › Builder, which was Account › Developer.
 *
 * The section's four pages, in the canvases' order (`MCP Services Page`, `API
 * Keys Page`, `API Usage Page`, `Builder Page` in `design/incoming/`), their
 * addresses under `/account/builder`, the drawers each page opens, and the
 * words each page's header carries. Pure, so `builder_d1315.test.mjs` holds
 * every rule.
 *
 * `/account/developer` and every address under it moved here. The Worker
 * answers a page load of an old address with a 308 (`services/builderRedirect.ts`);
 * `legacyBuilderPath` is the same rule for a link followed inside the app.
 */

export const BUILDER_ROOT = '/account/builder';
export const LEGACY_ROOT = '/account/developer';

/** The section's pages, in the canvases' order. */
export const BUILDER_PAGES = Object.freeze([
  { id: 'services', label: 'MCP and services', path: BUILDER_ROOT },
  { id: 'keys', label: 'API keys', path: `${BUILDER_ROOT}/keys` },
  { id: 'usage', label: 'API usage', path: `${BUILDER_ROOT}/usage` },
  { id: 'activity', label: 'Activity', path: `${BUILDER_ROOT}/activity` },
]);

/** Each page's header line, byte for byte from its canvas. */
export const BUILDER_LINES = Object.freeze({
  services: 'Where assistants and your API keys connect to StudioOS, what they can call, and how the services behind those tools are doing.',
  keys: 'Keys your own scripts use to call StudioOS. Each key reaches only what you choose, and its secret is shown once.',
  usage: 'What your keys and assistants asked StudioOS to do, what it cost in AI tokens, and what failed.',
  activity: 'What your keys and assistants asked StudioOS to do, what it cost in AI tokens, and what failed.',
});

/** A drawer's kind, the page it opens over, its address segment and its trail. */
export const BUILDER_DRAWERS = Object.freeze({
  assistant: { page: 'services', segment: 'assistants', trail: 'Builder › AI assistants' },
  service: { page: 'services', segment: 'services', trail: 'Builder › MCP and services › Services' },
  key: { page: 'keys', segment: 'keys', trail: 'Builder › API keys' },
  request: { page: 'activity', segment: 'activity', trail: 'Builder › Activity' },
});

/** The words the rename moved, each in one place. */
export const BUILDER_WORDS = Object.freeze({
  title: 'Builder',
  movedNotice: 'AI assistants moved: they now live in Builder.',
  openBuilder: 'Open Builder →',
  handoffTitle: 'AI assistants',
  handoffLine: 'Connect an assistant to StudioOS, see what it may do and what it did.',
});

// An id or key in an address: the Worker's own shapes (uids, grant ids, connector keys).
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/**
 * What an address under `/account/builder` opens: `{ page, drawer }`, where
 * `drawer` is `{ kind, id }` or null. Anything the section does not know opens
 * MCP and services, the section's default page.
 */
export function builderViewFor(pathname = '') {
  const m = String(pathname).match(/^\/account\/builder(?:\/([^/?#]+))?(?:\/([^/?#]+))?\/?$/);
  if (!m || !m[1]) return { page: 'services', drawer: null };
  const [, first, second] = m;
  const page = BUILDER_PAGES.find((p) => p.id === first && p.id !== 'services');
  if (page && !second) return { page: page.id, drawer: null };
  for (const [kind, d] of Object.entries(BUILDER_DRAWERS)) {
    if (d.segment === first && second && ID.test(second)) return { page: d.page, drawer: { kind, id: second } };
  }
  return { page: 'services', drawer: null };
}

/** A view's own address. */
export function builderPathFor({ page = 'services', drawer = null } = {}) {
  if (drawer && BUILDER_DRAWERS[drawer.kind] && ID.test(String(drawer.id ?? ''))) {
    return `${BUILDER_ROOT}/${BUILDER_DRAWERS[drawer.kind].segment}/${encodeURIComponent(drawer.id)}`;
  }
  return (BUILDER_PAGES.find((p) => p.id === page) ?? BUILDER_PAGES[0]).path;
}

/** The eyebrow over the pane: "Builder › <page>", or the drawer's own trail. */
export function builderTrailFor({ page = 'services', drawer = null } = {}) {
  if (drawer && BUILDER_DRAWERS[drawer.kind]) return BUILDER_DRAWERS[drawer.kind].trail;
  return `Builder › ${(BUILDER_PAGES.find((p) => p.id === page) ?? BUILDER_PAGES[0]).label}`;
}

/**
 * An old `/account/developer…` address as its `/account/builder…` one, the
 * sub-path and the query kept; null for any other address.
 */
export function legacyBuilderPath(pathname = '', search = '') {
  const m = String(pathname).match(/^\/account\/developer(\/.*)?$/);
  if (!m) return null;
  const rest = m[1] && m[1] !== '/' ? m[1] : '';
  const q = String(search || '');
  return `${BUILDER_ROOT}${rest}${q && !q.startsWith('?') ? `?${q}` : q}`;
}
