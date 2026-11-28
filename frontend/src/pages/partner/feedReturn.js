/**
 * D8733 (#8733) — the way back from a page the firm feed opened. When the partner opens an alert, the feed keeps a
 * return record: the Studio address with the view they had (`?feed=`) and the alert they used (`?alert=`), plus
 * that alert's client, kind and position, so Studio can put focus back on it or, if it has left the feed, on the
 * alert now in its place and say why (SOP07). The destination reads the record for its "Back to Studio · Firm feed"
 * link.
 *
 * The record lives in this tab's sessionStorage. It is a convenience only: a private window or blocked storage
 * reads back nothing, and every reader falls back to `/studio#firm-feed`, which still lands on the module.
 */
const KEY = 'axal.studio.feedReturn';
export const FEED_ANCHOR = 'firm-feed';
export const STUDIO_FEED = `/studio#${FEED_ANCHOR}`;

/** The Studio address that reopens the feed as it was, with the alert used. */
export function studioReturnHref(view, key) {
  const q = new URLSearchParams();
  if (view) q.set('feed', view);
  if (key) q.set('alert', key);
  const s = q.toString();
  return `/studio${s ? `?${s}` : ''}#${FEED_ANCHOR}`;
}

export function saveFeedReturn(record) {
  try { globalThis.sessionStorage?.setItem(KEY, JSON.stringify(record)); } catch { /* storage unavailable: the fallback applies */ }
}

export function readFeedReturn() {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    const r = raw ? JSON.parse(raw) : null;
    return r && typeof r === 'object' ? r : null;
  } catch { return null; }
}

/** Where "Back to Studio · Firm feed" goes: the kept record's address when it is a Studio one, else the module. */
export function feedReturnHref(record = readFeedReturn()) {
  const href = record?.href;
  return typeof href === 'string' && href.startsWith('/studio') ? href : STUDIO_FEED;
}
