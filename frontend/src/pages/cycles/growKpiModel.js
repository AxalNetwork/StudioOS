/**
 * D4864 (#4864, GR-12, GR-15): Grow's headline figures and domain summaries as platform states (D5129).
 * Pure, so a plain `node --test` runs it.
 *
 * Each figure from `GET /api/cycles/grow/overview` carries a typed `reason_code` (no_record ·
 * not_connected · unavailable) and a `freshness` (current · stale) from the Worker, so this file never
 * parses the prose `reason`. The words come from `ui/dataState.js`: a measured 0 is a Value; nothing
 * recorded is Not recorded with its reason, never 0; a failed read is Unavailable, never Not recorded;
 * a Stale value keeps its figure and its age, and shows no change, because the comparison would mix
 * periods. Not connected is Not recorded with its reason (Platform States Q2 = A), not its own word.
 */
import { figureDelta, figureValue } from './cycleModel.js';
import { projectSearch } from './founderToolNavigation.js';
import { staleAge } from '../../ui/dataState.js';

/** The KPI form's value for each figure a founder can type (`forms.js` ENTERABLE_KPIS). */
const KPI_OF = Object.freeze({ mrr: 'mrr', customers: 'paying_accounts' });
const SOURCE_WORDS = Object.freeze({ manual: 'Entered by hand', stripe: 'Stripe', mercury: 'Mercury', posthog: 'PostHog', google: 'Google Sheets', google_sheets: 'Google Sheets' });

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const day = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** "Stripe", "Entered by hand", "Revenue ledger · Stripe"; null when the read names none. */
export function sourceName(source) {
  if (typeof source !== 'string' || !source.trim()) return null;
  return source.split(' · ').map((part) => SOURCE_WORDS[part.trim().toLowerCase()] ?? part.trim()).join(' · ');
}

/** The reason as a sentence, without the Worker's "Not recorded: " / "Unreadable: " lead. */
function sentence(reason) {
  if (typeof reason !== 'string' || !reason.trim()) return null;
  const s = reason.replace(/^(Not recorded|Unreadable):\s*/i, '').trim();
  if (!s) return null;
  const t = s[0].toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The one recovery action a figure's state offers, and a second where GR-12 draws two; none for a reader. */
function actions(fig, code, q, readOnly) {
  if (readOnly) return [];
  const kpi = KPI_OF[fig.key];
  const enter = kpi ? { label: 'Enter manually', href: `/grow/revenue-and-traction/new${q || '?'}${q ? '&' : ''}kpi=${kpi}`, key: 'enter' } : null;
  if (code === 'not_connected') return [{ label: 'Connect Stripe', href: '/account/connectors/stripe', key: 'connect' }, enter].filter(Boolean);
  if (code === 'no_record') {
    if (enter) return [enter];
    if (fig.key === 'headcount') return [{ label: 'Set up team', href: `/build/team${q}`, key: 'team' }];
  }
  return [];
}

/**
 * One figure's presentation:
 *   { key, label, state: value|not_recorded|unavailable|loading, value, zero, change, stale: {age, lastGood}|null,
 *     reason, actions: [{label, href, key}], source, asOf, lastGood: {value, asOf}|null, label for screen readers }
 * `lastGood` is a figure from an earlier read of the SAME venture by the SAME viewer (the caller checks),
 * shown under an Unavailable figure as the last value that was read, never as the current one.
 */
export function growKpi(fig, { search = '', readOnly = false, now = Date.now(), lastGood = null, kept = null } = {}) {
  const q = projectSearch(search);
  const label = String(fig?.label ?? 'Figure');
  const source = sourceName(fig?.source);
  const asOf = day(fig?.as_of);
  const base = { key: fig?.key, label, source, asOf, change: null, stale: null, zero: false, lastGood: null, actions: [], reason: null };
  const code = fig?.reason_code ?? (fig?.state === 'unreadable' ? 'unavailable' : fig?.state === 'not_recorded' ? 'no_record' : null);
  if (code === 'unavailable') {
    const last = lastGood && figureValue(lastGood) != null ? { value: figureValue(lastGood), asOf: day(lastGood.as_of) } : null;
    return { ...base, state: 'unavailable', lastGood: last, reason: last ? `Last read: ${last.value}${last.asOf ? ` as of ${last.asOf}` : ''}.` : null,
      sr: `${label}, unavailable: it could not be read.` };
  }
  const value = figureValue(fig);
  if (code === 'no_record' || code === 'not_connected' || value == null) {
    const reason = sentence(fig?.reason) || (code === 'not_connected' ? 'No source is connected and nothing was entered by hand.' : 'Nothing records this yet.');
    return { ...base, state: 'not_recorded', code: code || 'no_record', reason, actions: actions(fig, code || 'no_record', q, readOnly),
      sr: `${label}, not recorded. ${reason}` };
  }
  // A figure kept from the last good read after a refresh failed is Stale by that read's own age (`kept`: { age, at }).
  const stale = kept ? { age: kept.age, lastGood: kept.at, kept: true }
    : fig?.freshness === 'stale' ? { age: staleAge(fig.as_of, now), lastGood: asOf } : null;
  // GR-12: a change shows only when it is current; a stale figure's change would compare mixed periods.
  const change = stale ? null : figureDelta(fig);
  const zero = num(fig?.value) && fig.value === 0;
  const parts = [`${label}, ${value}${zero ? ', measured' : ''}`, change, source ? `from ${source}` : null, asOf ? `as of ${asOf}` : null, stale ? `stale, ${stale.age || 'age not recorded'}` : null];
  return { ...base, state: 'value', value, zero, change, stale, sr: `${parts.filter(Boolean).join(', ')}.` };
}

/** "Source: Stripe · as of 2026-11-14", or why there is none. */
export function sourceLine(kpi) {
  if (kpi.state === 'unavailable') return kpi.source ? `Source: ${kpi.source}` : 'Source could not be read';
  if (kpi.state === 'not_recorded') return kpi.code === 'not_connected' ? 'Source: none connected' : kpi.source ? `Source: ${kpi.source}` : 'Source: none recorded';
  return [kpi.source ? `Source: ${kpi.source}` : 'Source not recorded', kpi.asOf ? `as of ${kpi.asOf}` : 'date not recorded'].join(' · ');
}

const SAFE_NEXT = /^\/grow\/[a-z-]+(\/new)?\?project(_id)?=[1-9]\d*(&add=1)?$/;

/**
 * One "What is happening" tile (GR-01, GR-02): `{ state, summary, action }`. A count of zero is None with
 * its setup action; a failed read is Unavailable and offers no setup, because nothing is known to be missing.
 */
export function growDomain(area, { cards = [], attention = null, search = '', readOnly = false } = {}) {
  const q = projectSearch(search);
  const act = (label, path) => (readOnly ? null : { label, href: path.startsWith('/') && path.includes('?') ? path : `${path}${q}` });
  const signal = (s) => (s?.state === 'recorded' && num(s.value) ? s.value : null);
  if (area.key === 'customers' || area.key === 'distribution') {
    const s = attention?.signals?.[area.key === 'customers' ? 'customers' : 'channels'];
    const n = signal(s);
    const what = area.key === 'customers' ? 'Customer records' : 'Channel records';
    if (s?.state === 'restricted') return { state: 'refused', summary: `${what} are for the venture’s team.`, action: null };
    if (n == null) return { state: 'unavailable', summary: `${what} could not be read.`, action: null };
    if (n === 0) {
      return area.key === 'customers'
        ? { state: 'none', summary: 'No customer or prospect records.', action: act('Add customer', '/grow/customers') }
        : { state: 'none', summary: 'No acquisition channels.', action: act('Add channel', '/grow/distribution') };
    }
    return { state: 'value', summary: area.key === 'customers' ? `${n} customer/prospect record${n === 1 ? '' : 's'}` : `${n} acquisition channel${n === 1 ? '' : 's'}`, action: null };
  }
  if (area.key === 'focus') {
    const f = attention?.focus?.state;
    if (f === 'recorded') return { state: 'value', summary: 'Focus metric and target recorded', action: null };
    if (f === 'not_recorded') return { state: 'not_recorded', summary: 'No focus metric chosen.', action: act('Set focus metric', '/grow/focus') };
    return { state: 'unavailable', summary: 'Focus could not be read.', action: null };
  }
  const card = cards.find((c) => c.slug === area.key || area.aliases.includes(c.slug));
  if (!card) return { state: 'value', summary: 'Open the workspace to review its records.', action: null };
  if (card.state === 'unreadable') return { state: 'unavailable', summary: `${card.name || area.name} could not be read.`, action: null };
  if (card.state === 'empty') {
    const next = card.next && typeof card.next.href === 'string' && SAFE_NEXT.test(card.next.href) ? card.next : null;
    // The first sentence only: the overview is a summary, not a wall of explanations.
    const why = sentence(card.reason)?.split(/(?<=[.!?])\s+/)[0];
    return { state: 'none', summary: why || 'Nothing recorded yet.', action: next ? act(String(next.text).replace(/\.$/, ''), next.href.replace('?project=', '?project_id=')) : null };
  }
  return { state: 'value', summary: card.caption || 'Open the workspace to review its records.', action: null };
}

const hasValue = (f) => f && (f.state === 'ok' || f.state === 'too_little') && f.value != null;

/** The viewer and venture a read belongs to: a kept read is shown again only under the same pair. */
export const viewerKey = (projectId, search, user) => `${projectId ?? projectSearch(search)}|${user?.id ?? user?.email ?? ''}`;

/**
 * D4864 (GR-15): the store of the last good read, after one more read. A ready read replaces `read` (the
 * whole overview, with when it was read) and adds each recorded figure to `figures`; a read that is not
 * ready changes nothing. A different viewer or venture starts an empty store, so nothing crosses over.
 */
export function rememberRead(store, key, { status, raw, data, at }) {
  const own = store && store.key === key ? store : { key, read: null, figures: {} };
  if (status !== 'ready' || !data) return own;
  const figures = { ...own.figures };
  for (const f of data.figures || []) if (hasValue(f)) figures[f.key] = f;
  return { key, read: { raw, data, at }, figures };
}

/** What may be shown from the store for this viewer and venture: nothing from anyone else's. */
export const lastGoodFor = (store, key) => (store && store.key === key ? store : { key, read: null, figures: {} });
