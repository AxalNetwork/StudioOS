/**
 * D5862 (#5862, part 2 of #2399) — the words for a Grow module's "From Facebook"
 * part, from the module read's `parts.from_facebook` (D5859, D5860;
 * `cloudflare-worker/src/services/facebook/grow.ts`). Pure, so
 * `frontend/test/grow_from_facebook_5862.test.mjs` holds each rule.
 *
 * Who may act is the read's to say (`can_sync`, `can_delete`, `can_link`,
 * `proposal.can_decide`); this never works it out from a role. A figure
 * Facebook did not give is "Not recorded" with its reason, a failed read is
 * "Unreadable", and a token Facebook refused is "Reconnect with Facebook";
 * none of them is ever 0. Unique viewers are counted per day and never summed
 * (D5859), so the part shows the newest day's.
 */
import { count, dayLabel } from './growFromTiktok';

export { count, dayLabel };

export const CONNECT_HREF = '/account/connectors/facebook';

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const whole = (v) => (Number.isSafeInteger(v) ? v : null);
const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** "From Facebook, as of 21 Oct 2026"; null with no date. */
export function fromFacebook(asOf) {
  return text(asOf) ? `From Facebook, as of ${dayLabel(asOf)}` : null;
}

/** A figure: its words, whether Facebook gave it, and why not. */
function figure(f, missing) {
  const n = whole(f?.count);
  return { id: whole(f?.id), n, text: count(n), recorded: n != null, reason: n == null ? text(f?.reason) || missing : null };
}

function proposalOf(p) {
  if (!p || typeof p !== 'object' || whole(p.id) == null) return null;
  if (p.state === 'pending') return { id: p.id, state: 'pending', canDecide: p.can_decide === true, sentence: text(p.sentence) };
  if (p.state === 'accepted') return { id: p.id, state: 'accepted', canDecide: false, channel: p.channel && text(p.channel.name) ? { name: p.channel.name } : null };
  return null;
}

const NOT_GIVEN = 'Not recorded: Facebook gave no figure for this day.';

/** The part, cleaned to what the page draws. `empty` is true when there is nothing to draw at all. */
export function facebookView(part, slug) {
  if (!part || typeof part !== 'object') return { state: 'none', empty: true };
  const link = part.link && typeof part.link === 'object' ? part.link : null;
  const common = {
    empty: false,
    canSync: part.can_sync === true,
    canDelete: part.can_delete === true,
    canLink: part.can_link === true,
    note: text(part.note),
    pageName: text(link?.page_name),
    servedBy: text(link?.served_by?.name),
    partlySynced: link?.partly_synced === true,
    disconnected: link ? link.connected === false : false,
    proposal: slug === 'distribution' ? proposalOf(part.proposal) : null,
  };
  if (part.state === 'unreadable') {
    return { ...common, state: 'unreadable', canSync: false, canDelete: false, proposal: null, reason: text(part.reason) || 'Unreadable: the Facebook figures could not be read' };
  }
  if (part.state === 'not_linked') {
    const href = typeof part.connect_href === 'string' && part.connect_href.startsWith('/account/connectors/') ? part.connect_href : CONNECT_HREF;
    return { ...common, state: 'not_linked', reason: text(part.reason) || 'Not recorded: no Facebook Page is linked to this venture.', connectHref: href };
  }
  if (part.state === 'not_recorded') {
    return { ...common, state: 'not_recorded', reason: text(part.reason) || 'Not recorded: the linked Facebook Page has not been synced yet.' };
  }
  if (part.state !== 'ok') return { state: 'none', empty: true };
  const source = fromFacebook(part.as_of);
  if (slug === 'revenue-and-traction') {
    const f = part.followers && typeof part.followers === 'object' ? part.followers : {};
    const followers = figure(f, 'Not recorded: Facebook has given no follower count yet.');
    const delta = whole(f.change?.delta);
    const change = delta == null || !text(f.change?.since) ? null
      : `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta).toLocaleString('en-US')} since ${dayLabel(f.change.since)}`;
    return { ...common, state: 'ok', source, followers: { ...followers, on: text(f.period) ? dayLabel(f.period) : null, change } };
  }
  const days = list(part.days).filter((d) => text(d.day)).map((d) => ({
    day: d.day, label: dayLabel(d.day),
    views: figure(d.views, NOT_GIVEN), viewers: figure(d.viewers, NOT_GIVEN), engagements: figure(d.engagements, NOT_GIVEN),
  })).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const totals = part.totals && typeof part.totals === 'object' ? part.totals : {};
  const span = (t) => (whole(t?.days_recorded) != null && whole(t?.of_days) != null ? `${t.days_recorded} of ${t.of_days} days recorded` : null);
  const newest = days[0] || null;
  const range = days.length ? `${dayLabel(days[days.length - 1].day)} to ${dayLabel(days[0].day)}` : null;
  return {
    ...common, state: 'ok', source, range,
    figures: [
      { key: 'views', label: 'Views', ...figure(totals.views, 'Not recorded: Facebook gave no views in these days.'), sub: [range && `${days.length} days, ${range}`, span(totals.views)].filter(Boolean).join(' · ') },
      { key: 'viewers', label: 'Unique viewers', ...(newest ? newest.viewers : figure(null, NOT_GIVEN)), sub: newest ? `On ${newest.label} · counted per day, so days do not add up` : 'Counted per day, so days do not add up' },
      { key: 'engagements', label: 'Post engagements', ...figure(totals.engagements, 'Not recorded: Facebook gave no engagements in these days.'), sub: [range && `${days.length} days, ${range}`, span(totals.engagements)].filter(Boolean).join(' · ') },
    ],
    days,
  };
}

/** What a sync did, in one sentence, from its counts (`{ followers, daily, kept_deleted, partial }`). */
export function syncSentence(c) {
  if (!c || typeof c !== 'object') return 'Synced from Facebook.';
  const followers = whole(c.followers) ?? 0;
  const daily = whole(c.daily) ?? 0;
  const parts = [`${followers} follower ${followers === 1 ? 'snapshot' : 'snapshots'}`, `${daily.toLocaleString('en-US')} daily ${daily === 1 ? 'figure' : 'figures'}`];
  const kept = whole(c.kept_deleted) ? ` ${c.kept_deleted} deleted ${c.kept_deleted === 1 ? 'figure stays' : 'figures stay'} deleted.` : '';
  if (c.partial === true) return `Partly synced: ${parts.join(' and ')} so far. Some months were not read; sync again to finish.${kept}`;
  return `Synced from Facebook: ${parts.join(' and ')}.${kept}`;
}

/**
 * A failed Sync, by the Worker's refusal code: a token Facebook refused or a Page it no longer lists is
 * Reconnect; a rate limit says to wait; anything else is a failed read. Nothing changed in each case.
 */
export function syncFailure(e) {
  const code = e?.code;
  if (code === 'sign_in_again' || code === 'facebook_page_not_granted') {
    return { kind: 'reconnect', sentence: 'Facebook needs to be reconnected. Reconnect with Facebook to continue.' };
  }
  if (code === 'rate_limited') return { kind: 'rate_limited', sentence: 'Facebook is limiting requests. Try again later. Nothing changed.' };
  return { kind: 'failed', sentence: text(e?.message) || 'Facebook could not be read. Nothing changed.' };
}
