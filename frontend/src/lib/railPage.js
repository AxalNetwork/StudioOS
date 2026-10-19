/**
 * D765 (#2090) — the page the member's AI rail is on, sent with every
 * request as `X-Rail-Page` (and `X-Rail-Option` while an option is open), so
 * the Worker records each run where it was spent and checks the page's switch
 * (`cloudflare-worker/src/util/railContext.ts`).
 *
 * Until D768's page map lands, the page is the rail's `workspace`, lower-cased
 * as the switch is stored (`hooks/useAssistMode.js`). `WorkerRail` sets it on
 * mount and clears it on unmount; a page with no rail sends nothing, and the
 * route's own page stands.
 */
const current = { page: null, option: null, owner: 0 };
let next = 1;

const clean = (v) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s && s.length <= 160 ? s : null;
};

/** Mark `page` as the rail's; returns a token that clears it only while it is still the latest. */
export function setRailPage(page, option = null) {
  current.page = clean(page);
  current.option = clean(option);
  current.owner = next++;
  return current.owner;
}

export function clearRailPage(token) {
  if (token !== current.owner) return;
  current.page = null;
  current.option = null;
}

/** The headers `request()` merges: none when no rail is mounted. Header values are URI-encoded (`·`, `&`). */
export function railPageHeaders() {
  if (!current.page) return {};
  return {
    'X-Rail-Page': encodeURIComponent(current.page),
    ...(current.option ? { 'X-Rail-Option': encodeURIComponent(current.option) } : {}),
  };
}
