/**
 * D5866 (#5866, part 2 of #2401) — the words for a Grow module's "From TikTok"
 * part, from the module read's `parts.from_tiktok` (D5863, D5864;
 * `cloudflare-worker/src/services/tiktok/grow.ts`). Pure, so
 * `frontend/test/grow_from_tiktok_5866.test.mjs` holds each rule.
 *
 * Who may act is the read's to say (`can_sync`, `can_delete`,
 * `proposal.can_decide`); this never works it out from a role. A count TikTok
 * did not give is "Not recorded" with its reason, never 0. Reach is the sum of
 * the views of the videos posted in the month of the latest sync, so it reads
 * no clock and has no Delete of its own: deleting a video takes it out.
 */

export const CONNECT_HREF = '/account/connectors/tiktok';
/** The videos the part lists before "Show all" (owner option A on D5865). */
export const TOP_VIDEOS = 3;

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const whole = (v) => (Number.isSafeInteger(v) ? v : null);
const text = (v) => (typeof v === 'string' && v.trim() ? v : null);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18,400" from a whole count; "Not recorded" when TikTok gave none. A recorded 0 stays 0. */
export function count(v) {
  const n = whole(v);
  return n == null ? 'Not recorded' : n.toLocaleString('en-US');
}

/** "14 Nov 2026" from "2026-11-14" (or a timestamp starting with it); the input when it is not a date. */
export function dayLabel(iso) {
  const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!x || Number(x[2]) < 1 || Number(x[2]) > 12) return String(iso || '');
  return `${Number(x[3])} ${MONTHS[Number(x[2]) - 1]} ${x[1]}`;
}

/** "Nov 2026" from "2026-11…". */
export function monthLabel(iso) {
  const x = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!x || Number(x[2]) < 1 || Number(x[2]) > 12) return '';
  return `${MONTHS[Number(x[2]) - 1]} ${x[1]}`;
}

/** "From TikTok, as of 14 Nov 2026"; null with no date. */
export function fromTiktok(asOf) {
  return text(asOf) ? `From TikTok, as of ${dayLabel(asOf)}` : null;
}

/** A scope the member did not grant: the read's sentence says so, and Reconnect shares it. */
const scopeMissing = (reason) => /did not let Axal VC read/.test(String(reason || ''));

function videoOf(v) {
  const reasons = v.reasons && typeof v.reasons === 'object' ? v.reasons : {};
  const figure = (k) => ({ n: whole(v[k]), text: count(v[k]), reason: whole(v[k]) == null ? text(reasons[k]) || 'Not recorded: TikTok gave no figure for this video' : null });
  return {
    id: whole(v.id), postedOn: text(v.posted_on), posted: v.posted_on ? dayLabel(v.posted_on) : 'Not recorded',
    title: text(v.title) ? String(v.title).slice(0, 150) : 'Untitled video',
    views: figure('views'), likes: figure('likes'), comments: figure('comments'), shares: figure('shares'),
    source: fromTiktok(v.as_of),
  };
}

function proposalOf(p) {
  if (!p || typeof p !== 'object' || whole(p.id) == null) return null;
  if (p.state === 'pending') return { id: p.id, state: 'pending', canDecide: p.can_decide === true, sentence: text(p.sentence) };
  if (p.state === 'accepted') return { id: p.id, state: 'accepted', canDecide: false, channel: p.channel && text(p.channel.name) ? { name: p.channel.name } : null };
  return null;
}

/** The part, cleaned to what the page draws. `empty` is true when there is nothing to draw at all. */
export function tiktokView(part, slug) {
  if (!part || typeof part !== 'object') return { state: 'none', empty: true };
  const link = part.link && typeof part.link === 'object' ? part.link : null;
  const common = {
    empty: false,
    canSync: part.can_sync === true,
    canDelete: part.can_delete === true,
    note: text(part.note),
    servedBy: text(link?.served_by?.name),
    partlySynced: link?.partly_synced === true,
    disconnected: link ? link.connected === false : false,
  };
  if (part.state === 'unreadable') return { ...common, state: 'unreadable', canSync: false, canDelete: false, reason: text(part.reason) || 'Unreadable: the TikTok figures could not be read' };
  if (part.state === 'not_linked') {
    const href = typeof part.connect_href === 'string' && part.connect_href.startsWith('/account/connectors/') ? part.connect_href : CONNECT_HREF;
    return { ...common, state: 'not_linked', reason: text(part.reason) || 'Not recorded: no TikTok account serves this venture yet.', connectHref: href, proposal: proposalOf(part.proposal) };
  }
  if (part.state === 'not_recorded') {
    const reason = text(part.reason) || 'Not recorded: TikTok has not been synced for this venture yet.';
    return { ...common, state: 'not_recorded', reason, reconnect: scopeMissing(reason), proposal: proposalOf(part.proposal) };
  }
  if (part.state !== 'ok') return { state: 'none', empty: true };
  const source = fromTiktok(part.as_of);
  if (slug === 'revenue-and-traction') {
    const figures = list(part.figures).map((f) => ({
      key: String(f.key || ''), label: text(f.label) || '', text: count(f.count), recorded: whole(f.count) != null,
      reason: whole(f.count) == null ? text(f.reason) || 'Not recorded' : null,
      reconnect: whole(f.count) == null && scopeMissing(f.reason),
    }));
    return { ...common, state: 'ok', source, snapshotDate: part.as_of ? dayLabel(part.as_of) : null, snapshotId: whole(part.snapshot_id), figures };
  }
  const videos = list(part.videos).map(videoOf).filter((v) => v.id != null);
  const month = /^(\d{4}-\d{2})/.exec(String(part.as_of || ''))?.[1] || null;
  const inMonth = month ? videos.filter((v) => v.postedOn?.startsWith(month)) : [];
  const known = inMonth.filter((v) => v.views.n != null);
  const ranked = [...inMonth].sort((a, b) => (b.views.n ?? -1) - (a.views.n ?? -1));
  return {
    ...common, state: 'ok', source, proposal: proposalOf(part.proposal),
    month: monthLabel(part.as_of),
    reach: inMonth.length ? {
      views: known.length ? count(known.reduce((s, v) => s + v.views.n, 0)) : 'Not recorded',
      posts: inMonth.length,
      missing: inMonth.length - known.length,
    } : null,
    videos: ranked,
  };
}

/** What a sync did, in one sentence, from its counts. */
export function syncSentence(c) {
  if (!c || typeof c !== 'object') return 'Synced from TikTok.';
  const videos = whole(c.videos) ?? 0;
  const vids = `${videos} ${videos === 1 ? 'video' : 'videos'}`;
  const kept = whole(c.kept_deleted) ? ` ${c.kept_deleted} deleted ${c.kept_deleted === 1 ? 'figure stays' : 'figures stay'} deleted.` : '';
  const missing = !Array.isArray(c.scopes_missing) || !c.scopes_missing.length ? ''
    : ' Some figures were not shared when you connected, so they stay Not recorded.';
  if (c.partial === true || c.outcome === 'Partly synced') return `Partly synced: ${vids} read so far. Sync again to finish.${kept}${missing}`;
  const snap = whole(c.snapshots) ? ' and today’s audience' : '';
  return `Synced from TikTok: ${vids}${snap}.${kept}${missing}`;
}
