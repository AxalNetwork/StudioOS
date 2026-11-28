/**
 * D5842 (#5842) — a local, deterministic Raise evidence source for one founder-selected Search Console aggregate:
 * one venture, its one selected property, one whole Monday–Sunday week of finalized web-search data, and one
 * metric (clicks, impressions or weighted CTR), read from the rows D5840's sync stored. Never calls Google.
 *
 * Two reads, no write:
 *   - `previewSearchConsoleEvidence` builds the candidate the founder chose, with the exact property, date window,
 *     search type, units, coverage, per-day source revisions and a keyed snapshot hash; or says why it cannot.
 *   - `recheckSearchConsoleEvidence` takes a recorded reference (`source_ref`, `snapshot_hash`, `revision_key`)
 *     and says whether the source is still the same (`current`), was corrected since (`corrected`: the original
 *     revision's value beside the revised one, re-review required), or is `missing` or `revoked`.
 *
 * Only the selected property's byProperty daily totals are read: no top-page row, no other property, and no
 * search query (D5840 stores none). The figures are organic Google web search counts; they never back a
 * paying-customer, revenue or conversion claim (`searchConsoleMayBack`).
 *
 * Candidate persistence, accept/pin, sharing and withdrawal belong to the shared Raise evidence write paths
 * (`services/raiseEvidence.ts`), which this file does not touch.
 */
import type { Env } from '../types';
import { projectEnabled } from '../integrations/companyScope';
import { SEARCH_CONSOLE_KEY } from '../integrations/providers/google_search_console';
import { evidenceHash, evidenceStale, type EvidenceArea } from './raiseEvidenceSources';
import type { RaiseEvidenceContext } from './raiseEvidence';
import { DATA_STATE, SEARCH_TYPE } from './searchConsoleSync';
import { PROVIDER_TIMEZONE, addDays, validDay, weekStartOf, weekTotals, type DayRow } from './searchConsoleWeeks';

/** The kind is declared once, beside the evidence rule that reads a pinned selection (D5842 part 2). */
export { SEARCH_CONSOLE_EVIDENCE_KIND } from './raiseEvidenceSources';
import { SEARCH_CONSOLE_EVIDENCE_KIND } from './raiseEvidenceSources';
export const SEARCH_CONSOLE_EVIDENCE_TABLE = 'search_console_daily_totals';
export const SEARCH_CONSOLE_EVIDENCE_PROVIDER = SEARCH_CONSOLE_KEY;
export const SEARCH_CONSOLE_EVIDENCE_AREA: EvidenceArea = 'Investor narrative and Pitch deck';
/** A week older than this is marked stale, as the other ninety-day Raise evidence rules are. */
export const SEARCH_CONSOLE_STALE_DAYS = 90;
export const SEARCH_CONSOLE_METRICS = ['clicks', 'impressions', 'ctr'] as const;
export type SearchConsoleMetric = typeof SEARCH_CONSOLE_METRICS[number];

/** What each metric is, in the units D5840 stores. CTR is weighted: the week's clicks over its impressions. */
export const SEARCH_CONSOLE_METRIC_UNITS: Record<SearchConsoleMetric, { unit: 'count' | 'ratio'; label: string }> = {
  clicks: { unit: 'count', label: 'Organic Google web search clicks' },
  impressions: { unit: 'count', label: 'Organic Google web search impressions' },
  ctr: { unit: 'ratio', label: 'Organic Google web search click-through rate (week clicks ÷ week impressions)' },
};
/** The one sentence every candidate carries, so no reader mistakes the figure for customers or money. */
export const SEARCH_CONSOLE_MEANING = 'Organic Google web search activity for one property. These are not paying customers, revenue or attributed conversions.';

/** The claim keys a metric may back, and those it never may, whatever a caller asks. */
export const SEARCH_CONSOLE_BACKS: Record<SearchConsoleMetric, readonly string[]> = {
  clicks: ['organic_search', 'organic_search_clicks', 'distribution'],
  impressions: ['organic_search', 'organic_search_impressions', 'distribution'],
  ctr: ['organic_search', 'organic_search_ctr', 'distribution'],
};
export const SEARCH_CONSOLE_NEVER_BACKS: readonly string[] = [
  'paying_customers', 'customers', 'customer_evidence', 'revenue', 'revenue_growth', 'revenue_proof', 'mrr', 'arr',
  'conversions', 'attributed_conversions', 'traction_proof', 'received_capital',
];
export function searchConsoleMayBack(metric: SearchConsoleMetric, claimKey: string): boolean {
  return !SEARCH_CONSOLE_NEVER_BACKS.includes(claimKey) && SEARCH_CONSOLE_BACKS[metric].includes(claimKey);
}

const SENTENCES = {
  invalid: 'Choose a Search Console property, a whole week starting on a Monday, and clicks, impressions or CTR.',
  forbidden: 'Only this venture’s founders can choose Search Console evidence.',
  search_console_unavailable: 'Search Console is not available yet.',
  unreadable: 'Search Console evidence could not be read. Nothing changed; try again.',
} as const;
export class SearchConsoleEvidenceRefusal extends Error {
  readonly code: keyof typeof SENTENCES;
  readonly status: 400 | 403 | 503;
  readonly sentence: string;
  constructor(code: keyof typeof SENTENCES, status: SearchConsoleEvidenceRefusal['status']) {
    super('search_console_evidence_refused'); this.code = code; this.status = status; this.sentence = SENTENCES[code];
  }
}

export type SearchConsoleEvidenceSelection = { site_url: string; week_start: string; search_type: 'web'; metric: SearchConsoleMetric };
export type SearchConsoleEvidenceReference = { source_ref: string; snapshot_hash: string; revision_key: string };

const PROPERTY_ID = /^(sc-domain:[a-z0-9.-]{1,253}|https?:\/\/[^\s?#]{1,2040}\/)$/;
/** The founder's choice, exactly; anything else is `invalid`. Only `web` is stored (D5840). */
export function parseSearchConsoleSelection(raw: Record<string, unknown>): SearchConsoleEvidenceSelection {
  const { site_url, week_start, metric } = raw;
  const search_type = raw.search_type ?? SEARCH_TYPE;
  if (typeof site_url !== 'string' || !PROPERTY_ID.test(site_url)) throw new SearchConsoleEvidenceRefusal('invalid', 400);
  if (!validDay(week_start) || weekStartOf(week_start) !== week_start) throw new SearchConsoleEvidenceRefusal('invalid', 400);
  if (search_type !== SEARCH_TYPE) throw new SearchConsoleEvidenceRefusal('invalid', 400);
  if (typeof metric !== 'string' || !(SEARCH_CONSOLE_METRICS as readonly string[]).includes(metric)) throw new SearchConsoleEvidenceRefusal('invalid', 400);
  return { site_url, week_start, search_type: SEARCH_TYPE, metric: metric as SearchConsoleMetric };
}

const REF_RE = /^search-console:web:(\d{4}-\d{2}-\d{2}):(clicks|impressions|ctr):([a-f0-9]{16})$/;
const REVISION_RE = /^[1-9][0-9]{0,8}(\.[1-9][0-9]{0,8}){6}$/;
export function parseSearchConsoleReference(raw: Record<string, unknown>): SearchConsoleEvidenceReference & { week_start: string; metric: SearchConsoleMetric; property_key: string } {
  const { source_ref, snapshot_hash, revision_key } = raw;
  const m = typeof source_ref === 'string' ? REF_RE.exec(source_ref) : null;
  if (!m || !validDay(m[1]) || weekStartOf(m[1]) !== m[1]) throw new SearchConsoleEvidenceRefusal('invalid', 400);
  if (typeof snapshot_hash !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot_hash)) throw new SearchConsoleEvidenceRefusal('invalid', 400);
  if (typeof revision_key !== 'string' || !REVISION_RE.test(revision_key)) throw new SearchConsoleEvidenceRefusal('invalid', 400);
  return { source_ref: source_ref as string, snapshot_hash, revision_key, week_start: m[1], metric: m[2] as SearchConsoleMetric, property_key: m[3] };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
/** A short, non-reversible key for the property inside `source_ref`, so the reference names no URL. */
export async function propertyKey(siteUrl: string): Promise<string> {
  return (await sha256Hex('studioos:search-console-property:v1:' + siteUrl)).slice(0, 16);
}
export async function searchConsoleSourceRef(sel: Pick<SearchConsoleEvidenceSelection, 'site_url' | 'week_start' | 'metric'>): Promise<string> {
  return `search-console:web:${sel.week_start}:${sel.metric}:${await propertyKey(sel.site_url)}`;
}

/** Domain-separated HMAC key, so a public snapshot hash cannot be used to guess a low private count. */
async function snapshotKey(env: Env): Promise<CryptoKey> {
  if (typeof env.JWT_SECRET !== 'string' || !env.JWT_SECRET) throw new SearchConsoleEvidenceRefusal('unreadable', 503);
  const root = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', root, new TextEncoder().encode('studioos:raise-evidence:search-console:snapshot-key:v1'));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

type StoredDay = DayRow & { fingerprint: string; source_revision: number };
type Selection = { user_id: number; site_url: string; access_state: 'ok' | 'denied' | 'revoked' };

export type SearchConsoleCoverage = {
  days: 7; days_reported: number; days_not_returned: number; days_not_fetched: number;
  complete: boolean; incomplete_reason: string | null; note: string | null;
};
export type SearchConsoleMaterial = {
  value: number | null; numerator: number | null; denominator: number | null; value_reason: string | null;
  coverage: SearchConsoleCoverage; revision_key: string | null;
  day_revisions: { date: string; revision: number | null }[];
};

/** The metric's value over one week, from stored byProperty days only: deterministic for the same rows. */
export function materialOf(weekStart: string, metric: SearchConsoleMetric, days: readonly StoredDay[]): SearchConsoleMaterial {
  const t = weekTotals(weekStart, days, { fetchedThrough: addDays(weekStart, 6), initialFrom: weekStart });
  const byDate = new Map(days.map((d) => [d.data_date, d]));
  const day_revisions = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return { date, revision: byDate.get(date)?.source_revision ?? null };
  });
  const complete = t.days_not_fetched === 0;
  const coverage: SearchConsoleCoverage = {
    days: 7, days_reported: t.days_reported, days_not_returned: t.days_not_returned, days_not_fetched: t.days_not_fetched,
    complete, incomplete_reason: complete ? null : `${t.days_not_fetched} of 7 days not fetched as final`,
    note: t.days_not_returned ? `Google returned no row for ${t.days_not_returned} of 7 days (missing or suppressed); they add nothing and are not zero.` : null,
  };
  const revision_key = complete ? day_revisions.map((d) => d.revision).join('.') : null;
  let value: number | null = null, numerator: number | null = null, denominator: number | null = null, value_reason: string | null = null;
  if (!complete) value_reason = 'Incomplete: ' + coverage.incomplete_reason;
  else if (metric === 'ctr') {
    if (t.ctr == null) value_reason = t.ctr_reason;
    else { value = t.ctr; numerator = t.clicks; denominator = t.impressions; }
  } else if (t[metric] == null) value_reason = t.clicks_reason;
  else value = t[metric];
  return { value, numerator, denominator, value_reason, coverage, revision_key, day_revisions };
}

async function snapshotHashOf(key: CryptoKey, projectId: number, sel: SearchConsoleEvidenceSelection, m: SearchConsoleMaterial, fingerprints: readonly string[]) {
  return evidenceHash({
    v: 1, project_id: projectId, kind: SEARCH_CONSOLE_EVIDENCE_KIND, site_url: sel.site_url, search_type: sel.search_type, data_state: DATA_STATE,
    week_start: sel.week_start, week_end: addDays(sel.week_start, 6), metric: sel.metric, value: m.value, numerator: m.numerator, denominator: m.denominator,
    revision_key: m.revision_key, coverage: [m.coverage.days_reported, m.coverage.days_not_returned, m.coverage.days_not_fetched], fingerprints,
  }, key);
}

async function selectionOf(env: Env, projectId: number): Promise<Selection | null> {
  return env.DB.prepare('SELECT user_id, site_url, access_state FROM search_console_selections WHERE project_id = ?').bind(projectId).first<Selection>();
}
/** Why the stored source may no longer be used, or null while the binding member's access stands. */
async function revokedReason(env: Env, projectId: number, sel: Selection): Promise<string | null> {
  if (sel.access_state !== 'ok') return sel.access_state === 'denied'
    ? 'Google no longer grants access to this property. Nothing from it can be attached.'
    : 'The Search Console sign-in for this property was revoked. Nothing from it can be attached.';
  const row = await env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' AND auth_type = 'oauth2' LIMIT 1")
    .bind(sel.user_id, SEARCH_CONSOLE_KEY).first<{ id: number }>();
  if (!row) return 'The Search Console connection that serves this property is no longer active.';
  if (!(await projectEnabled(env, Number(row.id), projectId))) return 'The Search Console connection is switched off for this venture’s company.';
  return null;
}
async function storedDays(env: Env, projectId: number, siteUrl: string, weekStart: string): Promise<StoredDay[]> {
  const res = await env.DB.prepare(`SELECT data_date, row_state, clicks, impressions, fingerprint, source_revision FROM search_console_daily_totals
    WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND data_date BETWEEN ? AND ? ORDER BY data_date`)
    .bind(projectId, siteUrl, weekStart, addDays(weekStart, 6)).all<StoredDay>();
  if (!Array.isArray(res.results)) throw new SearchConsoleEvidenceRefusal('unreadable', 503);
  return res.results;
}

function founderOnly(ctx: RaiseEvidenceContext) { if (!ctx.founder) throw new SearchConsoleEvidenceRefusal('forbidden', 403); }
function approved(env: Env) { if (env.GOOGLE_SEARCH_CONSOLE_APPROVED !== '1') throw new SearchConsoleEvidenceRefusal('search_console_unavailable', 503); }

/** The candidate shape the shared Raise evidence paths take (`EvidenceCandidate`), plus the Search Console detail. */
export type SearchConsoleEvidenceCandidate = {
  area: EvidenceArea; kind: typeof SEARCH_CONSOLE_EVIDENCE_KIND; source_table: typeof SEARCH_CONSOLE_EVIDENCE_TABLE; source_ref: string;
  provider: typeof SEARCH_CONSOLE_EVIDENCE_PROVIDER; source_label: 'connector'; strength: 'measured'; observed_on: string; summary: string;
  value_num: number; value_unit: 'count' | 'ratio'; currency: null; snapshot_hash: string; private_reason: null;
  backs: readonly string[]; stale: boolean | null; date_reason: null;
  /** Every new item starts private; sharing is a separate founder decision on the shared paths. */
  visibility: 'private';
  search_console: {
    site_url: string; search_type: 'web'; data_state: 'final'; aggregation_type: 'byProperty'; timezone: string;
    window: { from: string; to: string }; metric: SearchConsoleMetric; label: string; unit: 'count' | 'ratio';
    numerator: number | null; denominator: number | null; meaning: string;
    coverage: SearchConsoleCoverage; revision_key: string; day_revisions: { date: string; revision: number | null }[];
  };
};
export type SearchConsoleEvidencePreview = {
  state: 'selectable' | 'not_selected' | 'revoked' | 'not_recorded' | 'incomplete' | 'undefined';
  reason: string | null; candidate: SearchConsoleEvidenceCandidate | null;
  window: { from: string; to: string }; metric: SearchConsoleMetric; coverage: SearchConsoleCoverage | null;
};

/**
 * The one candidate the founder chose, or why it cannot be offered. Read-only: nothing is written, and a
 * property the venture has not selected is never read (its rows, if any, stay unread).
 */
export async function previewSearchConsoleEvidence(ctx: RaiseEvidenceContext, selection: SearchConsoleEvidenceSelection, now = new Date().toISOString()): Promise<SearchConsoleEvidencePreview> {
  approved(ctx.env); founderOnly(ctx);
  const window = { from: selection.week_start, to: addDays(selection.week_start, 6) };
  const base = { window, metric: selection.metric };
  const sel = await selectionOf(ctx.env, ctx.projectId);
  if (!sel || sel.site_url !== selection.site_url) {
    return { ...base, state: 'not_selected', reason: 'This property is not the one selected for this venture’s Search Console.', candidate: null, coverage: null };
  }
  const revoked = await revokedReason(ctx.env, ctx.projectId, sel);
  if (revoked) return { ...base, state: 'revoked', reason: revoked, candidate: null, coverage: null };
  const days = await storedDays(ctx.env, ctx.projectId, sel.site_url, selection.week_start);
  if (!days.length) return { ...base, state: 'not_recorded', reason: 'Not recorded: no finalized data is stored for this week.', candidate: null, coverage: null };
  const m = materialOf(selection.week_start, selection.metric, days);
  if (!m.coverage.complete) return { ...base, state: 'incomplete', reason: m.value_reason, candidate: null, coverage: m.coverage };
  if (m.value == null) return { ...base, state: 'undefined', reason: m.value_reason, candidate: null, coverage: m.coverage };
  const key = await snapshotKey(ctx.env);
  const fingerprints = days.map((d) => d.fingerprint);
  const meta = SEARCH_CONSOLE_METRIC_UNITS[selection.metric];
  const candidate: SearchConsoleEvidenceCandidate = {
    area: SEARCH_CONSOLE_EVIDENCE_AREA, kind: SEARCH_CONSOLE_EVIDENCE_KIND, source_table: SEARCH_CONSOLE_EVIDENCE_TABLE,
    source_ref: await searchConsoleSourceRef(selection), provider: SEARCH_CONSOLE_EVIDENCE_PROVIDER, source_label: 'connector', strength: 'measured',
    observed_on: window.to, summary: `${meta.label}, ${window.from} to ${window.to} (Pacific Time). ${SEARCH_CONSOLE_MEANING}`,
    value_num: m.value, value_unit: meta.unit, currency: null, snapshot_hash: await snapshotHashOf(key, ctx.projectId, selection, m, fingerprints),
    private_reason: null, backs: SEARCH_CONSOLE_BACKS[selection.metric], stale: evidenceStale(window.to, SEARCH_CONSOLE_STALE_DAYS, now), date_reason: null,
    visibility: 'private',
    search_console: {
      site_url: sel.site_url, search_type: SEARCH_TYPE, data_state: DATA_STATE, aggregation_type: 'byProperty', timezone: PROVIDER_TIMEZONE,
      window, metric: selection.metric, label: meta.label, unit: meta.unit, numerator: m.numerator, denominator: m.denominator, meaning: SEARCH_CONSOLE_MEANING,
      coverage: m.coverage, revision_key: m.revision_key!, day_revisions: m.day_revisions,
    },
  };
  return { ...base, state: 'selectable', reason: null, candidate, coverage: m.coverage };
}

type Version = { value: number | null; numerator: number | null; denominator: number | null; value_reason: string | null; revision_key: string | null };
export type SearchConsoleEvidenceRecheck = {
  state: 'current' | 'corrected' | 'missing' | 'revoked';
  reason: string | null; requires_review: boolean; stale: boolean | null;
  source_ref: string; window: { from: string; to: string }; metric: SearchConsoleMetric;
  /** The pinned revision, rebuilt from D5840's revision history and verified against the recorded hash. */
  original: Version | null;
  /** The source as stored now; on `corrected`, the revised value the founder must review. */
  revised: Version | null;
  corrected_days: string[];
  snapshot_hash: string | null;
};

/**
 * Re-read a recorded Search Console reference. `current`: the same rows and the same hash. `corrected`: one or
 * more days of the week were revised since; the original value is rebuilt from the revision history and checked
 * against the recorded hash, and the revised value is returned beside it, with `requires_review`. `missing`: the
 * week is no longer complete or defined, or the reference does not match this venture's source. `revoked`: the
 * property is no longer selected, or its access was lost.
 */
export async function recheckSearchConsoleEvidence(ctx: RaiseEvidenceContext, ref: ReturnType<typeof parseSearchConsoleReference>, now = new Date().toISOString()): Promise<SearchConsoleEvidenceRecheck> {
  approved(ctx.env); founderOnly(ctx);
  const window = { from: ref.week_start, to: addDays(ref.week_start, 6) };
  const out = (state: SearchConsoleEvidenceRecheck['state'], reason: string | null, extra: Partial<SearchConsoleEvidenceRecheck> = {}): SearchConsoleEvidenceRecheck => ({
    state, reason, requires_review: state !== 'current', stale: evidenceStale(window.to, SEARCH_CONSOLE_STALE_DAYS, now),
    source_ref: ref.source_ref, window, metric: ref.metric, original: null, revised: null, corrected_days: [], snapshot_hash: null, ...extra,
  });
  const sel = await selectionOf(ctx.env, ctx.projectId);
  if (!sel || (await propertyKey(sel.site_url)) !== ref.property_key) return out('revoked', 'The Search Console property this evidence came from is no longer selected for this venture.');
  const revoked = await revokedReason(ctx.env, ctx.projectId, sel);
  if (revoked) return out('revoked', revoked);
  const selection: SearchConsoleEvidenceSelection = { site_url: sel.site_url, week_start: ref.week_start, search_type: SEARCH_TYPE, metric: ref.metric };
  const days = await storedDays(ctx.env, ctx.projectId, sel.site_url, ref.week_start);
  const current = materialOf(ref.week_start, ref.metric, days);
  const key = await snapshotKey(ctx.env);
  const currentHash = current.revision_key ? await snapshotHashOf(key, ctx.projectId, selection, current, days.map((d) => d.fingerprint)) : null;
  const version = (m: SearchConsoleMaterial): Version => ({ value: m.value, numerator: m.numerator, denominator: m.denominator, value_reason: m.value_reason, revision_key: m.revision_key });
  if (!current.revision_key) return out('missing', 'The week is no longer stored in full: ' + (current.coverage.incomplete_reason ?? 'not recorded') + '.', { revised: version(current) });
  if (currentHash === ref.snapshot_hash && current.revision_key === ref.revision_key) {
    return out('current', null, { original: version(current), revised: version(current), snapshot_hash: currentHash });
  }
  const recorded = ref.revision_key.split('.').map(Number);
  const corrected_days = current.day_revisions.filter((d, i) => d.revision !== recorded[i]).map((d) => d.date);
  const mismatch = () => out('missing', 'This evidence reference does not match the stored Search Console source for this venture.', { revised: version(current), snapshot_hash: currentHash });
  if (!corrected_days.length) return mismatch();
  // Rebuild each corrected day at its recorded revision from D5840's history: revision r+1's row holds r's values.
  const rebuilt: StoredDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = days.find((d) => d.data_date === current.day_revisions[i].date)!;
    const want = recorded[i];
    if (day.source_revision === want) { rebuilt.push(day); continue; }
    if (want > day.source_revision) return mismatch();
    const h = await ctx.env.DB.prepare(`SELECT previous_fingerprint, previous_json FROM search_console_revisions WHERE project_id = ? AND site_url = ? AND search_type = 'web'
      AND dataset = 'daily_totals' AND period_key = ? AND source_revision = ?`).bind(ctx.projectId, sel.site_url, day.data_date, want + 1).first<{ previous_fingerprint: string; previous_json: string }>();
    let prev: Record<string, unknown> | null = null;
    try { prev = h ? JSON.parse(h.previous_json) : null; } catch { prev = null; }
    if (!h || !prev || (prev.row_state !== 'reported' && prev.row_state !== 'not_returned')) return mismatch();
    rebuilt.push({ data_date: day.data_date, row_state: prev.row_state as DayRow['row_state'], clicks: typeof prev.clicks === 'number' ? prev.clicks : null,
      impressions: typeof prev.impressions === 'number' ? prev.impressions : null, fingerprint: h.previous_fingerprint, source_revision: want });
  }
  const original = materialOf(ref.week_start, ref.metric, rebuilt);
  const originalHash = await snapshotHashOf(key, ctx.projectId, selection, original, rebuilt.map((d) => d.fingerprint));
  if (originalHash !== ref.snapshot_hash) return mismatch();
  return out('corrected', `Google corrected ${corrected_days.length} of 7 days in this week since it was recorded. Review the revised value before it is used again.`,
    { original: version(original), revised: version(current), corrected_days, snapshot_hash: currentHash });
}
