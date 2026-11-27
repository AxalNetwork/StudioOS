/**
 * D1098 (#2963) — the words for Vercel's parts on Prototype / MVP (VC2) and
 * Product roadmap (VC3), from each module read's `parts.vercel`
 * (`cloudflare-worker/src/services/vercel/buildReads.ts`). Pure, so
 * `frontend/test/vercel_deploys_d1098.test.mjs` holds each rule.
 *
 * Nothing measured is drawn as a zero: a week before the first deploy the
 * connection read, a share with no finished deploy and a median with no
 * build are "Not recorded", with the read's reason. A link out goes only to
 * an https address on vercel.app or a domain the read named; anything else
 * is text.
 */

export const CONNECTOR_HREF = '/account/connectors/vercel';
export const EMPTY = 'Vercel has not brought anything to this venture yet.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parse = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : null);

/** "3 Oct", in UTC, or null. */
export function shortDay(v) {
  const d = parse(v);
  return d && !Number.isNaN(d.getTime()) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : null;
}

/** "3 Oct, 14:20", in UTC, or null. */
export function dayTime(v) {
  const d = parse(v);
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${shortDay(v)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "2m 41s", "45s", or null for a build not measured. */
export function duration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** A preview address: https on a host name, or null. */
export function previewHref(url) {
  return typeof url === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(url) ? url : null;
}

/** The part's state: ok, empty, unreadable or reconnect (VC5). */
export function partState(part) {
  if (!part || typeof part !== 'object') return null;
  if (part.state === 'unreadable') return 'unreadable';
  if (part.state === 'empty') return 'empty';
  if (part.state !== 'ok') return 'unreadable';
  return part.connection?.reconnect ? 'reconnect' : 'ok';
}

/** VC5's Reconnect sentence: the project named only when the read names it. */
export function reconnectText(part) {
  const r = part?.connection?.reconnect;
  if (!r) return null;
  const who = typeof r.project === 'string' && r.project ? `Vercel’s sign-in for ${r.project}` : 'Vercel’s sign-in';
  const since = shortDay(r.since);
  const asOf = shortDay(part.connection.as_of);
  return `${who} ${since ? `expired on ${since}` : 'has expired'}. ${asOf ? `Figures are as of ${asOf}.` : 'Figures are as of the last sync.'}`;
}

const LIVE_TONE = { live: 'ok', failing: 'bad', building: 'v1', not_deployed: 'grey' };

/** One Live strip line: where production is live, since when, its last deploy's commit and build. */
export function liveView(l) {
  const state = Object.hasOwn(LIVE_TONE, l?.state) ? l.state : null;
  const since = dayTime(l?.since);
  const domain = typeof l?.domain === 'string' && l.domain ? l.domain : null;
  const title = state === 'live' ? (domain ? `Live at ${domain}` : 'Live')
    : state === 'failing' ? (domain ? `Failing at ${domain}` : 'Failing')
      : state === 'building' ? 'Building' : state === 'not_deployed' ? 'Not deployed' : 'Not recorded';
  const pill = state === 'live' ? (since ? `Ready since ${since}` : 'Ready')
    : state === 'failing' ? (since ? `Failing since ${since}` : 'Failing')
      : state === 'building' ? 'Building' : state === 'not_deployed' ? 'Not deployed' : 'Not recorded';
  const build = duration(l?.build_seconds);
  const facts = [
    typeof l?.commit === 'string' && l.commit ? `commit ${l.commit}` : null,
    build ? `build ${build}` : null,
    typeof l?.error_code === 'string' && l.error_code ? l.error_code : null,
  ].filter(Boolean);
  return {
    title,
    name: typeof l?.name === 'string' && l.name ? l.name : null,
    pill, tone: state ? LIVE_TONE[state] : 'grey',
    detail: facts.length ? `Last production deploy · ${facts.join(' · ')}` : state === 'not_deployed' ? 'No production deploy yet.' : null,
  };
}

/** GitHub's state for a fed must-have, as its own part words it (D782). */
const PR_LABEL = { planned: 'Planned', in_progress: 'In progress', in_review: 'In review', built: 'Built', dropped: 'Dropped' };
const PR_TONE = { planned: 'grey', in_progress: 'v1', in_review: 'warn', built: 'ok', dropped: 'muted' };
const PREVIEW = {
  READY: ['Preview Ready', 'ok'], BUILDING: ['Preview Building', 'v1'], QUEUED: ['Preview Building', 'v1'], INITIALIZING: ['Preview Building', 'v1'],
  ERROR: ['Preview Failed', 'bad'], CANCELED: ['Preview Canceled', 'muted'],
};

/** One must-have: GitHub's state, its Preview pill or why there is none, and "In production since". */
export function mustHaveView(m) {
  const pr = Object.hasOwn(PR_LABEL, m?.pr_state) ? m.pr_state : null;
  const preview = m?.preview && typeof m.preview === 'object' ? m.preview : null;
  const [label, tone] = preview ? PREVIEW[String(preview.state).toUpperCase()] ?? ['Preview', 'grey'] : [null, null];
  const since = shortDay(m?.in_production_since);
  return {
    title: typeof m?.title === 'string' && m.title ? m.title : 'Untitled',
    status: pr ? PR_LABEL[pr] : null,
    statusTone: pr ? PR_TONE[pr] : 'grey',
    preview: label, previewTone: tone,
    previewHref: preview ? previewHref(preview.url) : null,
    previewNote: preview ? null : (typeof m?.preview_reason === 'string' ? m.preview_reason : 'Not recorded: no preview deploy for this pull request yet.'),
    production: since ? `In production since ${since}` : null,
    productionNote: since ? null : (typeof m?.production_reason === 'string' ? m.production_reason : null),
  };
}

/** The 12 bars: a measured week has a count (0 is a flat line); a week before the first deploy is Not recorded. */
export function deployBars(weeks) {
  const list = Array.isArray(weeks) ? weeks : [];
  const max = Math.max(1, ...list.map((w) => (typeof w?.count === 'number' ? w.count : 0)));
  return list.map((w) => {
    const of = shortDay(w?.week_of) ?? 'a week';
    const measured = typeof w?.count === 'number' && Number.isFinite(w.count);
    return {
      key: w?.week_of ?? of,
      measured,
      count: measured ? w.count : null,
      height: measured ? Math.round((w.count / max) * 100) : 0,
      label: !measured ? `Week of ${of}: not recorded, before the first deploy Vercel read`
        : `Week of ${of}: ${w.count === 0 ? 'no deploys' : `${w.count} ${w.count === 1 ? 'deploy' : 'deploys'}`}`,
    };
  });
}

/** "Failed 6% · median build 2m 30s · 1 rollback", each figure Not recorded when nothing measured it. */
export function deploySummary(part) {
  const share = typeof part?.failed_share === 'number' ? `Failed ${part.failed_share}%` : 'Failed: not recorded';
  const build = duration(part?.median_build_seconds);
  const events = Array.isArray(part?.events) ? part.events : [];
  const rollbacks = events.filter((e) => e?.kind === 'rollback').length;
  const promotions = events.filter((e) => e?.kind === 'promotion').length;
  return [
    share,
    build ? `median build ${build}` : 'median build: not recorded',
    `${rollbacks} ${rollbacks === 1 ? 'rollback' : 'rollbacks'}`,
    ...(promotions ? [`${promotions} ${promotions === 1 ? 'promotion' : 'promotions'}`] : []),
  ].join(' · ');
}

/** The notes under the bars: each rollback and promotion, and each measured week with no deploys. */
export function deployNotes(part) {
  const events = (Array.isArray(part?.events) ? part.events : []).map((e) => {
    const on = shortDay(e?.at);
    return e?.kind === 'rollback' ? `↺ Rollback${on ? ` on ${on}` : ''}.` : `Promoted to production${on ? ` on ${on}` : ''}.`;
  });
  const quiet = (Array.isArray(part?.weeks) ? part.weeks : []).filter((w) => w?.count === 0).map((w) => shortDay(w.week_of)).filter(Boolean);
  const reasons = [part?.failed_reason, part?.median_reason].filter((r) => typeof r === 'string' && r);
  return [
    ...events,
    ...(quiet.length ? [`The ${quiet.length === 1 ? 'week' : 'weeks'} of ${quiet.join(', ')} had no deploys.`] : []),
    ...reasons,
  ];
}

/** A release's mark: "Live on 3 Oct" only on SHA equality; otherwise a dashed pill saying why not. */
export function releaseMark(r) {
  const tag = typeof r?.tag === 'string' && r.tag ? r.tag : 'Untagged';
  const on = r?.state === 'live' ? shortDay(r.live_on) : null;
  if (on) return { tag, text: `Live on ${on}`, tone: 'ok', dashed: false };
  if (r?.state === 'needs_github') return { tag, text: 'Needs GitHub’s commit links', tone: 'muted', dashed: true };
  return { tag, text: 'No matching deploy', tone: 'muted', dashed: true };
}
