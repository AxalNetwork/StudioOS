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
 *
 * D770 (#2095): the option and the record come from D768's page map
 * (`currentRail()`, set by `RailPageProvider`), so a fill, a draft, an upload
 * or a recording started inside a record view names that record
 * (`X-Rail-Record`, `type:id`). The PAGE stays the rail's workspace: it is the
 * key the switch is stored and checked under (`ai_rail_preferences.section`),
 * and D768's page keys ("Founder · Validate") would miss a member's Manual.
 */
import { currentRail } from './railPages.js';

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

/** D762's rule for an option or record key, as the Worker checks it (`railKey`). */
const KEY = /^[A-Za-z0-9/_.:-]{1,160}$/;
const keyOf = (v) => (typeof v === 'string' && KEY.test(v.trim()) ? v.trim() : null);

/** D768's record, `{ type, id }`, as `type:id`; null when it is not a valid key. */
export function recordKey(ref) {
  return ref && ref.type && ref.id != null ? keyOf(`${ref.type}:${ref.id}`) : null;
}

/**
 * D778 (#2103): a press's own rail context, taken on the click. The mounted
 * rail's page stays (it holds the member's Manual switch); the option is the
 * pressed one, sent with the run itself rather than after the busy render hands
 * it to the rail (`useRailOption`), which the request would beat.
 */
export function railPressHeaders(option) {
  return { ...railPageHeaders(), 'X-Rail-Option': encodeURIComponent(option) };
}

/**
 * The headers `request()` merges. Header values are URI-encoded (`·`, `&`).
 * The page only while a rail is mounted; the option the rail's own, else the
 * page map's open option; the record the page map's. Nothing when none is known.
 */
export function railPageHeaders() {
  const map = currentRail() || {};
  const option = current.option || keyOf(map.option);
  const record = recordKey(map.record);
  return {
    ...(current.page ? { 'X-Rail-Page': encodeURIComponent(current.page) } : {}),
    ...(option ? { 'X-Rail-Option': encodeURIComponent(option) } : {}),
    ...(record ? { 'X-Rail-Record': encodeURIComponent(record) } : {}),
  };
}
