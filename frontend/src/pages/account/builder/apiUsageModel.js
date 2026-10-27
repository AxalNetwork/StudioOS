/**
 * D1320 (#2481) — Account › Builder › API usage and Activity's request
 * history (APIU1–APIU12), as pure functions so `api_usage_model_d1320.test.mjs`
 * holds every rule.
 *
 * Every figure comes from D845's reads (`/api/developer/usage`, `…/events`,
 * `…/keys`), D849's limits read or D788's account limit. A NULL charge is "Not
 * recorded", never 0; a measured zero is "Free". The page never asks for
 * `group=model` and never names a model: per-model AI cost is Usage › Cost's.
 */
import { usd } from '../usageModel';

const DAY_MS = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDay(Date.parse(`${v}T00:00:00Z`)) === v;
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** D845 reads at most this many days. */
export const MAX_DAYS = 92;

export const RANGES = Object.freeze([
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'mtd', label: 'Month to date' },
  { id: 'custom', label: 'Custom' },
]);

/** The breakdowns Chart 2 offers. Never `model` (Usage › Cost owns it). */
export const BREAKDOWNS = Object.freeze([
  { id: 'key', label: 'By key' },
  { id: 'provider', label: 'By provider' },
  { id: 'connector', label: 'By connector' },
  { id: 'tool', label: 'By tool' },
]);

export const WORDS = Object.freeze({
  line: 'What your keys and assistants asked StudioOS to do, what it cost in AI tokens, and what failed.',
  footer: 'StudioOS records which tool ran, for whom, how it ended and what it cost. It never records what was sent or what came back.',
  activityFooter: 'StudioOS records which tool ran, for which company, how it ended and what it cost. It never records what the assistant or key sent or what came back.',
  byModel: 'AI runs by model are in Usage › Cost ›',
  noArgs: 'Arguments and results are never stored, so they cannot be shown.',
  tokensOnly: 'Token counts and the price list are not recorded per request yet.',
  noCaller: 'No requests yet.',
  noCallerSub: 'Requests appear here once an API key or an assistant calls StudioOS.',
  summaryUnreadable: 'Usage could not be read. That is not the same as none.',
  breakdownUnreadable: 'This breakdown could not be read. The other tabs still work.',
  logUnreadable: 'Requests could not be read.',
  notYours: 'This request is not on your account.',
  notYoursSub: 'Nothing here says whether it exists. Your own requests are in Activity.',
  keyNotYours: 'That key is not on your account. The filter is back to All keys.',
  limitVsAlert: 'A limit stops calls. An alert only tells you.',
  keyAlertsFixed: 'Key alerts are always on. Choosing which ones reach you is not offered yet.',
  connectionEvents: 'Connection events (an assistant approved or revoked) are not read here yet. #2479 adds them to this log.',
  free: 'Free',
  notRecorded: 'Not recorded',
});

export const OUTCOMES = Object.freeze({
  ok: { word: 'OK', tone: 'ok' },
  refused: { word: 'Refused', tone: 'refused' },
  error: { word: 'Error', tone: 'error' },
  rate_limited: { word: 'Rate-limited', tone: 'rate' },
  insufficient_tokens: { word: 'Not enough AI tokens', tone: 'tokens' },
});

/** The Outcome filter, in the canvas's order. `failed` is every call that did not succeed. */
export const OUTCOME_FILTERS = Object.freeze([
  { id: 'failed', label: 'Failed' }, { id: 'ok', label: 'OK' }, { id: 'refused', label: 'Refused' },
  { id: 'error', label: 'Error' }, { id: 'rate_limited', label: 'Rate-limited' },
  { id: 'insufficient_tokens', label: 'Not enough AI tokens' },
]);

/** D843's fixed reasons, each as a short name and the line under a failed row. */
export const CATEGORIES = Object.freeze({
  auth: { short: 'Sign-in not accepted', line: 'The key or sign-in was not accepted.' },
  scope: { short: 'Missing permission', line: 'The key lacks the permission for this tool.' },
  company: { short: 'Company not allowed', line: 'The caller may not reach that company.' },
  rate_limited: { short: 'Rate-limited', line: 'Too many requests this minute. It was not run.' },
  insufficient_tokens: { short: 'Not enough AI tokens', line: 'Not enough AI tokens.' },
  timeout: { short: 'Service did not answer', line: 'The service behind this tool did not answer in time.' },
  provider: { short: 'Service error', line: 'The service behind this tool returned an error.' },
  invalid_input: { short: 'Request not accepted', line: 'The request was not one this tool accepts.' },
  internal: { short: 'StudioOS error', line: 'StudioOS could not complete it.' },
});

export const outcomeWord = (o) => OUTCOMES[o]?.word ?? 'Unknown outcome';
export const categoryLine = (c) => (c ? CATEGORIES[c]?.line ?? 'It did not complete.' : null);
export const categoryShort = (c) => (c ? CATEGORIES[c]?.short ?? 'Other reason' : null);
export const surfaceWord = (s) => (s === 'mcp' ? 'MCP' : s === 'api' ? 'API' : 'Unknown');

// ------------------------------------------------------------------ the range

function startOfMonth(day) { return `${day.slice(0, 8)}01`; }

/**
 * The address's range as `{ id, from, to }` in UTC days. An unknown range is
 * 30 days; a custom range that is not two days, runs backwards or is longer
 * than 92 days falls back to 30 days too.
 */
export function rangeFor({ range = '30d', from, to } = {}, now = new Date()) {
  const today = isoDay(Date.parse(`${isoDay(now.getTime())}T00:00:00Z`));
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const days = (n) => ({ from: isoDay(todayMs - (n - 1) * DAY_MS), to: today });
  if (range === '7d') return { id: '7d', ...days(7) };
  if (range === 'mtd') return { id: 'mtd', from: startOfMonth(today), to: today };
  if (range === 'custom' && isDay(from) && isDay(to)) {
    const n = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
    if (n >= 1 && n <= MAX_DAYS) return { id: 'custom', from, to };
  }
  return { id: '30d', ...days(30) };
}

/** Every UTC day from `from` to `to`, both included. */
export function daysOf({ from, to }) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end && out.length <= MAX_DAYS; t += DAY_MS) out.push(isoDay(t));
  return out;
}

/** The same number of days just before the range, for "Compare with previous period". */
export function previousRange({ from, to }) {
  const n = daysOf({ from, to }).length;
  const end = Date.parse(`${from}T00:00:00Z`) - DAY_MS;
  return { from: isoDay(end - (n - 1) * DAY_MS), to: isoDay(end) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "22 Sep". */
export function shortDay(day) {
  if (!isDay(day)) return '';
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

// ------------------------------------------------------------------ the address

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/** The page's view from its query string: range, key and breakdown (usage); filters (activity). */
export function usageQuery(search = '', now = new Date()) {
  const q = new URLSearchParams(search);
  const r = rangeFor({ range: q.get('range') || '30d', from: q.get('from'), to: q.get('to') }, now);
  const group = BREAKDOWNS.some((b) => b.id === q.get('group')) ? q.get('group') : 'key';
  const key = ID.test(q.get('key') || '') ? q.get('key') : null;
  const caller = /^(key|grant):[A-Za-z0-9_.:-]{1,80}$/.test(q.get('caller') || '') ? q.get('caller') : null;
  const surface = ['mcp', 'api'].includes(q.get('surface')) ? q.get('surface') : null;
  const outcome = OUTCOME_FILTERS.some((o) => o.id === q.get('outcome')) ? q.get('outcome') : null;
  const tool = (q.get('tool') || '').length && (q.get('tool') || '').length <= 200 ? q.get('tool') : null;
  const company = /^[1-9]\d{0,15}$/.test(q.get('company') || '') ? q.get('company') : null;
  return { range: r, group, key, caller, surface, outcome, tool, company, compare: q.get('compare') === '1' };
}

/** A view back to its query string; defaults are left out so a plain link stays plain. */
export function usageSearch(view) {
  const q = new URLSearchParams();
  if (view.range?.id && view.range.id !== '30d') q.set('range', view.range.id);
  if (view.range?.id === 'custom') { q.set('from', view.range.from); q.set('to', view.range.to); }
  if (view.group && view.group !== 'key') q.set('group', view.group);
  for (const k of ['key', 'caller', 'surface', 'outcome', 'tool', 'company']) if (view[k]) q.set(k, view[k]);
  if (view.compare) q.set('compare', '1');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The report's query for a view. Never `group=model`. */
export function reportParams(view, group = 'day') {
  if (group === 'model') throw new Error('Per-model cost is Usage › Cost’s; this page never asks for it.');
  return { from: view.range.from, to: view.range.to, group, key: view.key || undefined };
}

/** The events read's query for Activity's filters. */
export function eventParams(view, cursor) {
  const [kind, id] = view.caller ? view.caller.split(/:(.*)/s) : [null, null];
  return {
    from: view.range.from, to: view.range.to,
    key: kind === 'key' ? id : undefined, grant: kind === 'grant' ? id : undefined,
    surface: view.surface || undefined, outcome: view.outcome || undefined,
    operation: view.tool || undefined, company: view.company || undefined, cursor: cursor || undefined,
  };
}

// ------------------------------------------------------------------ money

/** Micro-USD as dollars, with enough places for a small call; 0 is "Free"; null is null. */
export function tokensText(microusd) {
  if (microusd === null || microusd === undefined || !isCount(microusd)) return null;
  if (microusd === 0) return WORDS.free;
  return usd(microusd / 1_000_000);
}

/** "$4.10 of AI tokens", or null when not recorded. */
export function tokensLine(microusd) {
  const t = tokensText(microusd);
  return t === null ? null : t === WORDS.free ? 'Free' : `${t} of AI tokens`;
}

export const count = (n) => (isCount(n) ? n.toLocaleString('en-US') : null);

// ------------------------------------------------------------------ the tiles

/**
 * The four tiles from `totals` (and the previous period's, when compare is
 * on). A charge never metered reads "Not recorded", with the date usage
 * started when the store gives one.
 */
export function tiles(report, previous = null) {
  const t = report?.totals;
  if (!t) return null;
  const since = report.recorded_since && report.range?.from && report.recorded_since > report.range.from ? report.recorded_since : null;
  const prev = previous?.totals ?? null;
  const charged = tokensText(t.charged_microusd);
  return [
    { id: 'requests', label: 'Requests', value: count(t.calls), prev: prev ? count(prev.calls) : null },
    { id: 'ok', label: 'OK', value: count(t.ok), prev: prev ? count(prev.ok) : null },
    { id: 'failed', label: 'Failed', value: count(t.errors), prev: prev ? count(prev.errors) : null, link: true },
    {
      id: 'charged', label: 'AI tokens charged', value: charged,
      reason: charged === null ? (since ? `Not recorded before ${shortDay(since)}` : 'Not recorded: no request in this range was metered.') : null,
      sub: t.refunded_microusd ? `${tokensText(t.refunded_microusd)} returned` : null,
      prev: prev ? tokensText(prev.charged_microusd) ?? WORDS.notRecorded : null,
    },
  ];
}

// ------------------------------------------------------------------ Chart 1

/**
 * One entry per day of the range from `group=day`. A day with no row after
 * usage was recorded is a measured zero; a day before `recorded_since` has no
 * bar (`recorded: false`). A day's AI tokens are null when none was metered.
 */
export function daySeries(report, range) {
  const rows = new Map((report?.groups || []).map((g) => [g.key, g]));
  const since = report?.recorded_since ?? null;
  return daysOf(range).map((day) => {
    const g = rows.get(day);
    const recorded = !!g || (since !== null && day >= since);
    return {
      day, recorded,
      calls: g ? g.calls : recorded ? 0 : null,
      ok: g ? g.ok : recorded ? 0 : null,
      failed: g ? g.errors : recorded ? 0 : null,
      charged: g ? g.charged_microusd : null,
    };
  });
}

/** The chart's one-sentence summary. */
export function daySummary(report, range) {
  const t = report?.totals;
  if (!t) return '';
  const n = daysOf(range).length;
  const money = tokensLine(t.charged_microusd);
  return `${count(t.calls)} ${t.calls === 1 ? 'request' : 'requests'} in ${n} ${n === 1 ? 'day' : 'days'}, ${count(t.errors)} failed${money ? `; ${money}.` : '; AI tokens not recorded.'}`;
}

// ------------------------------------------------------------------ Chart 2

const NULL_LABELS = { key: 'Assistants (no key)', provider: 'No provider recorded', connector: 'No connector', tool: 'Unknown tool', category: 'No reason' };

/** A group's name: a key's name, or the bracket-free value, or what its null means. */
export function groupName(g, group) {
  if (g.key === null || g.key === undefined) return NULL_LABELS[group] ?? WORDS.notRecorded;
  if (group === 'key') return g.label || 'A key no longer listed';
  if (group === 'provider' && g.key === 'studioos') return 'StudioOS';
  return String(g.label ?? g.key);
}

const sumOrNull = (rows, f) => {
  const known = rows.filter((r) => r[f] !== null && r[f] !== undefined);
  return known.length ? known.reduce((s, r) => s + r[f], 0) : null;
};

/**
 * The breakdown: the top five groups by AI tokens charged (then by calls),
 * and the rest folded into "Other". A group whose charge was not recorded
 * keeps null.
 */
export function breakdownRows(report, group) {
  const rows = (report?.groups || []).map((g) => ({
    id: g.key === null ? `none:${group}` : String(g.key), name: groupName(g, group), filterKey: g.key,
    calls: g.calls, failed: g.errors, charged: g.charged_microusd, p50: g.p50_ms,
  }));
  rows.sort((a, b) => (b.charged ?? -1) - (a.charged ?? -1) || b.calls - a.calls || a.name.localeCompare(b.name));
  if (rows.length <= 5) return rows;
  const rest = rows.slice(5);
  return [...rows.slice(0, 5), {
    id: 'other', name: 'Other', other: rest.length, filterKey: undefined,
    calls: rest.reduce((s, r) => s + r.calls, 0), failed: rest.reduce((s, r) => s + r.failed, 0),
    charged: sumOrNull(rest, 'charged'), p50: null,
  }];
}

/** Chart 2's summary sentence: who spent the most. */
export function breakdownSummary(rows, report) {
  const top = rows.find((r) => r.charged !== null && r.charged > 0 && r.id !== 'other');
  const total = report?.totals?.charged_microusd;
  if (!top || total === null || total === undefined) return rows.length ? 'No AI tokens were charged in this range.' : 'No requests in this range.';
  return `${top.name} spent the most: ${tokensText(top.charged)} of ${tokensText(total)}.`;
}

// ------------------------------------------------------------------ callers, limits

/** The preview a key is known by: its name and `axk_<id>_••••`. Never the secret. */
export function keyPreview(k) { return k?.key_id ? `axk_${k.key_id}_••••` : null; }

/**
 * Who called: a key (its name and preview), an assistant connection the
 * member still holds ("Recognised as …"), or an unrecognised one.
 */
export function callerOf(e, { keys = [], grants = [] } = {}) {
  if (e.api_key_uid) {
    const k = keys.find((x) => x.uid === e.api_key_uid);
    return { kind: 'key', name: k?.name ?? 'A key no longer listed', sub: keyPreview(k) };
  }
  const g = e.grant_id ? grants.find((x) => x.id === e.grant_id) : null;
  if (g?.client_name) return { kind: 'assistant', name: `Recognised as ${g.client_name}`, sub: null };
  return { kind: 'assistant', name: 'Unrecognised assistant', sub: e.client ? `It called itself “${e.client}”` : null };
}

/** The Caller filter's options: each key (revoked ones after), then each assistant. */
export function callerOptions({ keys = [], grants = [] } = {}) {
  const live = keys.filter((k) => k.live !== false), gone = keys.filter((k) => k.live === false);
  return [
    ...live.map((k) => ({ id: `key:${k.uid}`, label: `${k.name} ${keyPreview(k) ?? ''}`.trim(), group: 'Keys' })),
    ...gone.map((k) => ({ id: `key:${k.uid}`, label: `${k.name} ${keyPreview(k) ?? ''}`.trim(), group: 'Revoked' })),
    ...grants.map((g) => ({ id: `grant:${g.id}`, label: g.client_name || 'Unrecognised assistant', group: 'Assistants' })),
  ];
}

/** The 1st of the next UTC month, "1 Nov". */
export function resetsOn(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return null;
  const [y, m] = month.split('-').map(Number);
  return shortDay(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`);
}

/** A key's month against its own limit, for APIU1's card and APIU5's table. */
export function keyMeter(k) {
  const used = tokensText(k.charged_microusd);
  const limit = k.monthly_limit_microusd;
  if (limit === null || limit === undefined) return { value: used === null ? 'Nothing charged this month' : `${used} this month`, limit: 'No limit', percent: null, alert: null };
  const limitText = usd(limit / 1_000_000);
  return {
    value: used === null ? `Nothing charged of ${limitText}` : `${used} of ${limitText}`,
    limit: limitText, percent: k.used_percent ?? (k.charged_microusd === null ? 0 : null), alert: k.alert ?? null,
  };
}

/** A key's 80% or 100% flag as a sentence, or null. */
export function keyAlertLine(k, month) {
  if (k.alert === 'at_limit') return `${k.name} has reached its monthly limit. Its calls that spend AI tokens stop until ${resetsOn(month) ?? 'the 1st'}.`;
  if (k.alert === 'near_limit') return `${k.name} has used ${k.used_percent}% of its monthly limit.`;
  return null;
}

/** The account's limit from D788, as a meter. */
export function accountMeter(limit) {
  if (!limit) return null;
  const used = tokensText(limit.charged_microusd) ?? WORDS.notRecorded;
  if (limit.limit_microusd === null || limit.limit_microusd === undefined) return { value: `${used === 'Free' ? '$0.00' : used} this month`, limit: 'No limit', percent: null };
  return {
    value: `${used === 'Free' ? '$0.00' : used} of ${usd(limit.limit_microusd / 1_000_000)}`,
    limit: usd(limit.limit_microusd / 1_000_000), percent: limit.share_used ?? null,
  };
}

/**
 * The alerts that exist today, as APIU5 lists them: D849's two key alerts
 * (`services/apiKeyLimits.ts`: `api_key_limit` at 80% and 100% of a key's own
 * limit, `api_key_failures` when more than 20% of at least 50 calls on a key
 * fail within an hour), always on, and D788's account notices, which Limits sets.
 */
export const KEY_ALERTS = Object.freeze([
  { id: 'api_key_limit', title: 'When a key reaches 80% and 100% of its monthly limit', where: 'In the app and by email · always on for a key with a limit' },
  { id: 'api_key_failures', title: 'When more than 20% of at least 50 calls on a key fail within an hour', where: 'In the app and by email · always on' },
]);

/** D788's account notices, as the Alerts list says them. */
export function accountAlerts(limit) {
  const n = limit?.notify;
  if (!n) return null;
  const on = ['50', '80', '100'].filter((p) => n[p]);
  return on.length ? `On at ${on.map((p) => `${p}%`).join(', ')}` : 'Off';
}

// ------------------------------------------------------------------ failures (APIU6)

/** Failures by outcome, from the totals. */
export function failureBand(totals) {
  if (!totals) return [];
  return [
    { id: 'refused', label: 'Refused', n: totals.refused },
    { id: 'error', label: 'Error', n: totals.error },
    { id: 'rate_limited', label: 'Rate-limited', n: totals.rate_limited },
    { id: 'insufficient_tokens', label: 'Not enough AI tokens', n: totals.insufficient_tokens },
  ].filter((b) => isCount(b.n));
}

/** The top three reasons from `group=category`, most first. */
export function topReasons(report, n = 3) {
  return (report?.groups || []).filter((g) => g.key)
    .sort((a, b) => b.calls - a.calls || String(a.key).localeCompare(String(b.key)))
    .slice(0, n).map((g) => ({ id: g.key, label: categoryShort(g.key), n: g.calls }));
}

// ------------------------------------------------------------------ a request (APIU4)

/** The drawer's AI tokens: Held, Charged, Returned, each a figure or "Not recorded" with its reason. */
export function requestTokens(e) {
  const reason = e.reservation_uid ? 'Not recorded: the hold has not settled yet.' : 'Not recorded: this request was not metered.';
  const row = (label, v) => ({ label, value: tokensText(v), reason: tokensText(v) === null ? reason : null });
  return [row('Held', e.reserved_microusd), row('Charged', e.charged_microusd), row('Returned', e.refunded_microusd)];
}

/** What to do about a failed request: its links, by reason. */
export function requestActions(e) {
  if (e.outcome === 'ok') return [];
  const out = [];
  if (e.error_category === 'insufficient_tokens') out.push({ label: 'Add AI tokens ›', to: '/account/usage/ai-tokens' });
  if (['scope', 'auth', 'company', 'rate_limited'].includes(e.error_category) && e.api_key_uid) out.push({ label: 'See the key ›', to: `/account/builder/keys/${encodeURIComponent(e.api_key_uid)}` });
  if (['timeout', 'provider'].includes(e.error_category)) out.push({ label: e.connector ? `Open ${e.connector} ›` : 'Open MCP and services ›', to: '/account/builder' });
  return out;
}

/** "21 Oct · 14:32:07" in UTC, from the store's `YYYY-MM-DD HH:MM:SS`. */
export function stamp(at) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(at || ''));
  return m ? `${shortDay(m[1])} · ${m[2]}` : WORDS.notRecorded;
}

// ------------------------------------------------------------------ CSV (#2419)
// Header and rows only: `lib/csvExport.js` quotes and saves them, the one CSV rule the app keeps.

const dollars = (m) => (isCount(m) ? (m / 1_000_000).toFixed(6) : null);

/** The days file: the same read as Chart 1. An empty money cell is "not recorded", never 0. */
export function daysCsv(series) {
  return {
    header: ['day', 'requests', 'ok', 'failed', 'ai_tokens_charged_usd'],
    rows: series.map((d) => [d.day, d.calls, d.ok, d.failed, dollars(d.charged)]),
  };
}

/** The requests file: the history's own columns, never an argument, a result or a model. */
export function eventsCsv(events, ctx = {}) {
  return {
    header: ['time_utc', 'execution_id', 'caller', 'surface', 'tool', 'company', 'outcome', 'reason', 'took_ms', 'held_usd', 'charged_usd', 'returned_usd'],
    rows: events.map((e) => [
      e.created_at, e.execution_id, callerOf(e, ctx).name, surfaceWord(e.surface), e.operation,
      e.company_id === null ? null : (ctx.companyName?.(e.company_id) ?? e.company_id), outcomeWord(e.outcome),
      categoryShort(e.error_category), e.duration_ms,
      dollars(e.reserved_microusd), dollars(e.charged_microusd), dollars(e.refunded_microusd),
    ]),
  };
}
