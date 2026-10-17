/** D662 — Build overview and six module reads, from the founder's project. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { CONNECTOR_METADATA, getDescriptor } from '../integrations/registry';
import { MODULE_LABELS } from '../integrations/fed';
import { canReadBoard, canWrite } from './_founder_validate_helpers';
import type { Card } from '../services/cycleCards';
import { buildPhone } from '../services/cycleFocus';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { pageBuildRows, unreadableBuildCard, type BuildFigure, type BuildRecords, type Cell, type ChartSpec, type RecordRow } from '../services/buildCycleRecords';

const app = new Hono<{ Bindings: Env }>();
// D690 (#1693): the fifth entry is the list's title, as the canvas titles it (CO:617-622).
const MODULES = [
  ['solution-design', 'Solution design', 'mvp_features and venture_risks', 'Features linked to a pain theme, and risks by severity.', 'Features'],
  ['prototype-mvp', 'Prototype / MVP', 'mvp_features', 'Must-haves done over time against the total.', 'Must-haves'],
  ['product-roadmap', 'Product roadmap', 'roadmap_okrs and okr_column_moves', 'Items in Now, Next and Later; items shipped per month.', 'Roadmap items'],
  ['founding-team', 'Founding team', 'cap_table_holders and cap_table_vesting', 'The equity split and each founder’s vesting.', 'Founders'],
  ['company-creation', 'Company creation', 'formation_steps and entity_obligations', 'Formation steps and the next three filings.', 'Filings'],
  ['operating-systems', 'Operating systems', 'integration_companies and ritual_runs', 'Core systems by state; weekly reviews held.', 'Systems'],
] as const;
type Slug = typeof MODULES[number][0];
type Project = { id: number; founder_id: number | null; company_id: number | null; entity_id: number | null; mvp_target_date: string | null; incorporation_meta: string | null; cofounder_decision_meta: string | null; spinout_ip_meta: string | null };
type Filter = NonNullable<BuildRecords['filters']>[number];
type Sort = NonNullable<BuildRecords['sorts']>[number];
/**
 * A module's list (D690, #1693): its filters, its default sort (the canvas's,
 * sent first and applied when no sort is sent) and its ordinal keys, which
 * sort by their list and never by the alphabet.
 */
type ListSpec = { filters: Filter[]; sort: Sort; orders?: Record<string, readonly string[]> };
type ModuleRead = { card: Card; cols: BuildRecords['cols']; rows: RecordRow[]; list?: ListSpec; facts?: Record<string, unknown>; add?: BuildRecords['add']; parts?: Record<string, unknown> };
type Query = { q?: string; filter?: string; sort?: string; page?: string };

function number(v: unknown): number { return Number(v ?? 0); }
function rows<T>(r: { results?: T[] | null }): T[] { return r.results ?? []; }
function record(id: number | string, cells: Record<string, Cell>, keys?: RecordRow['keys'], edit?: RecordRow['edit']): RecordRow {
  return { id, cells, ...(keys ? { keys } : {}), ...(edit ? { edit } : {}) };
}
function options(pairs: Array<[string, string]>): Filter['options'] { return pairs.map(([value, label]) => ({ value, label })); }
/** A free-text key's filter options: the values the rows hold, as today's one filter offered them. */
function optionsOf(list: RecordRow[], key: string, label: (value: string) => string = value => value): Filter['options'] {
  return [...new Set(list.map(row => row.keys?.[key]).filter((value): value is string => typeof value === 'string' && value !== '' && !/[:,]/.test(value)))].sort()
    .slice(0, 100).map(value => ({ value, label: label(value) }));
}

// The canvas's words for stored values (#1693 decision 2). Impact is
// added_value; Effort is effort, whose S, M and L read Low, Medium and High,
// and an old XL High. Review is an old must-have state and reads In progress.
const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const IMPACT_KEY: Record<string, string> = { High: 'high', Medium: 'medium', Low: 'low' };
const EFFORT_KEY: Record<string, string> = { S: 'low', M: 'medium', L: 'high', XL: 'high' };
const MUST_KEY: Record<string, string> = { Backlog: 'not_started', 'In Progress': 'in_progress', Review: 'in_progress', Done: 'done', Blocked: 'blocked' };
const MUST_LABEL: Record<string, string> = { blocked: 'Blocked', in_progress: 'In progress', not_started: 'Not started', done: 'Done' };
const COLUMN_LABEL: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later', done: 'Done' };
const FILING_LABEL: Record<string, string> = { overdue: 'Overdue', due_soon: 'Due soon', upcoming: 'Upcoming', filed: 'Filed' };
const FEEDS_LABEL: Record<string, string> = { use_of_funds: 'Use of funds', kpis: 'KPIs', team: 'Team' };
const known = <T,>(map: Record<string, T>, key: unknown): T | null => typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null;
const longDate = (date: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
const percent = (n: number) => `${Math.round(n * 100) / 100}%`;
function addMonths(date: Date, months: number): Date {
  const out = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(date.getUTCDate(), last));
  return out;
}
/** "4y · cliff 1 Jan 2027", or "no cliff" when the cliff is 0. Null without a start date. */
function vestingText(start: unknown, cliff: unknown, total: unknown): string | null {
  const from = typeof start === 'string' ? dateOnly(start.slice(0, 10)) : null;
  if (!from) return null;
  const months = total == null ? null : Number(total), cliffMonths = cliff == null ? null : Number(cliff);
  const length = months != null && Number.isFinite(months) && months > 0 ? `${Math.round(months / 12 * 100) / 100}y` : 'length not recorded';
  const cliffText = cliffMonths == null || !Number.isFinite(cliffMonths) ? 'cliff not recorded'
    : cliffMonths === 0 ? 'no cliff' : `cliff ${longDate(addMonths(from, cliffMonths))}`;
  return `${length} · ${cliffText}`;
}
/** Whole days from today (UTC) to a date, or null with no date. */
function daysUntil(raw: unknown): number | null {
  const date = typeof raw === 'string' ? dateOnly(raw.slice(0, 10)) : null;
  if (!date) return null;
  const now = new Date();
  return Math.round((date.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);
}
/**
 * A filing's state (#1693 decision 8): filed when done, overdue when past due,
 * due soon within 30 days, else upcoming.
 */
function filingState(done: boolean, due: unknown): 'filed' | 'upcoming' | 'due_soon' | 'overdue' {
  if (done) return 'filed';
  const days = daysUntil(due);
  return days == null ? 'upcoming' : days < 0 ? 'overdue' : days <= 30 ? 'due_soon' : 'upcoming';
}
function filingText(state: string, due: unknown, kind: unknown = null): string {
  if (state === 'filed') return kind === 'ein' ? 'Issued' : 'Filed';
  if (state !== 'due_soon') return FILING_LABEL[state];
  const days = daysUntil(due)!;
  return days === 0 ? 'Due today' : `Due in ${days} ${days === 1 ? 'day' : 'days'}`;
}
/**
 * The Due filter's window. A filed filing with a past date is in none of the
 * four, since it is neither overdue nor ahead.
 */
function dueWindow(state: string, due: unknown): string {
  const days = daysUntil(due);
  return state === 'overdue' ? 'overdue' : days == null ? 'none' : days < 0 ? 'past' : days <= 30 ? 'next_30' : 'later';
}
/**
 * Stored is a proof uploaded under `build-proof/`; Key recorded is a key typed
 * before 461, which opens nothing. A filing that is filed, overdue or due
 * within 30 days with no proof reads Missing.
 */
function proofText(key: unknown, state: string): string {
  if (typeof key === 'string' && key) return key.startsWith('build-proof/') ? 'Stored' : 'Key recorded';
  return state === 'upcoming' ? '—' : 'Missing';
}
function filingKeys(state: string, due: unknown): RecordRow['keys'] {
  const day = typeof due === 'string' && dateOnly(due.slice(0, 10)) ? due.slice(0, 10) : null;
  return { state, due: day, due_window: dueWindow(state, due) };
}
function feedsOf(raw: unknown): string[] {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : null;
    return Array.isArray(list) ? [...new Set(list.filter((key): key is string => typeof key === 'string' && Object.hasOwn(FEEDS_LABEL, key)))] : [];
  } catch { return []; }
}
function syncOf(configJson: unknown): string {
  try {
    const config = typeof configJson === 'string' ? JSON.parse(configJson) : null;
    return ['live', 'hourly', 'daily', 'manual'].includes(config?.sync_frequency) ? config.sync_frequency : 'live';
  } catch { return 'live'; }
}
function card(slug: Slug, state: Card['state'], series: ChartSpec[], range = 'Now', reason: string | null = null, next: Card['next'] = null): Card {
  const spec = MODULES.find(m => m[0] === slug)!;
  return { slug, name: spec[1], caption: spec[3], state, series, range, reason, next };
}
function next(p: Project, slug: Slug, text: string | null, add = false): Card['next'] {
  return text ? { text, href: `/build/${slug}?project=${p.id}${add ? '&add=1' : ''}` } : null;
}
function figure(key: string, label: string, value: BuildFigure['value'], unit: string, source: string, state: BuildFigure['state'], reason: string | null = null): BuildFigure {
  return { key, label, value, unit, delta_30d: null, spark: [], source, as_of: null, state, reason };
}
function unreadableFigure(key: string, label: string, source: string): BuildFigure {
  return figure(key, label, null, 'count', source, 'unreadable', `${source} is unreadable.`);
}
function dateOnly(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : date;
}
function failureDate(raw: unknown): string | null {
  const date = typeof raw === 'string' ? dateOnly(raw.slice(0, 10)) : null;
  return date ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date) : null;
}
// Build's Connect a tool for one tool, keeping the venture (D686 §5.4): the
// sheet reads the project from `project_id`, so a link without it opens on
// whichever venture the page picks first.
function connectHref(providerKey: string, projectId: number): string {
  return `/build/connect?tool=${encodeURIComponent(providerKey)}&project_id=${encodeURIComponent(String(projectId))}`;
}
function reconnect(providerKey: string, failedAt: unknown, projectId: number, fallbackName = providerKey): Card['next'] {
  const name = getDescriptor(providerKey)?.display_name ?? fallbackName;
  const since = failureDate(failedAt);
  return { text: `Reconnect ${name}${since ? ` · failing since ${since}` : ''}`, href: connectHref(providerKey, projectId) };
}

async function solution(env: Env, p: Project): Promise<ModuleRead> {
  const features = rows(await env.DB.prepare(
    `SELECT f.id, f.title, f.added_value, f.effort, f.pain_group_id, f.hypothesis_id, f.description, f.scope,
            pg.title AS pain_theme, h.claim AS hypothesis
       FROM mvp_features f
       LEFT JOIN pain_groups pg ON pg.id = f.pain_group_id AND pg.project_id = f.project_id
       LEFT JOIN hypotheses h ON h.id = f.hypothesis_id AND h.project_id = f.project_id
      WHERE f.project_id = ? ORDER BY f.sort_order, f.id`,
  ).bind(p.id).all<any>());
  const risks = rows(await env.DB.prepare(
    'SELECT id, title, severity, owner_user_id, mitigation, state FROM venture_risks WHERE project_id = ? ORDER BY id',
  ).bind(p.id).all<any>());
  const linked = features.filter(f => f.pain_theme != null).length;
  const unlinked = features.length - linked;
  const severity = ['high', 'medium', 'low'].map(s => risks.filter(r => r.severity === s).length);
  const series: ChartSpec[] = [];
  if (features.length) series.push({ kind: 'stack', rows: [{ label: 'Features', parts: [linked, unlinked] }], tones: ['v1', 'grey'], legend: [{ label: 'Linked', tone: 'v1' }, { label: 'Unlinked', tone: 'grey' }] });
  if (risks.length) series.push({ kind: 'stack', rows: [{ label: 'Risks', parts: severity }], tones: ['bad', 'warn', 'grey'], legend: ['High', 'Medium', 'Low'].map((label, i) => ({ label, tone: ['bad', 'warn', 'grey'][i] })) });
  // A feature with neither a pain theme nor a hypothesis links to nothing.
  // keys.linked is the chart's linked count: a stored pain theme.
  const featureRows = features.map(f => {
    const impact = known(IMPACT_KEY, f.added_value), effort = known(EFFORT_KEY, f.effort);
    return record(f.id, {
      feature: f.title, pain_theme: f.pain_theme ?? (f.hypothesis == null ? { text: 'Links to nothing', tone: 'bad' } : null), hypothesis: f.hypothesis,
      impact: impact ? LEVEL[impact] : f.added_value ?? null, effort: effort ? LEVEL[effort] : f.effort ?? null,
    }, { linked: f.pain_theme != null ? 'yes' : 'no', impact, effort },
    { title: f.title, description: f.description ?? null, pain_group_id: f.pain_group_id ?? null, hypothesis_id: f.hypothesis_id ?? null,
      added_value: f.added_value ?? null, effort: f.effort ?? null, scope: f.scope ?? null });
  });
  const levels = options([['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]);
  return { card: card('solution-design', features.length || risks.length ? 'ok' : 'empty', series, 'Now', features.length || risks.length ? null : 'No features yet. Linked and unlinked features appear here.', features.length || risks.length ? next(p, 'solution-design', unlinked ? `Link ${unlinked} features to a pain theme` : null) : next(p, 'solution-design', 'Add feature', true)),
    cols: [['feature', 'Feature'], ['pain_theme', 'Pain theme'], ['hypothesis', 'Hypothesis'], ['impact', 'Impact'], ['effort', 'Effort']].map(([key, label]) => ({ key, label })), rows: featureRows,
    list: { filters: [{ key: 'linked', label: 'Linked', options: options([['yes', 'Linked'], ['no', 'Unlinked']]) }, { key: 'impact', label: 'Impact', options: levels }, { key: 'effort', label: 'Effort', options: levels }],
      sort: { key: 'impact', label: 'Impact' }, orders: { impact: ['high', 'medium', 'low'], effort: ['low', 'medium', 'high'] } },
    facts: { features: features.length, risks } };
}

async function prototype(env: Env, p: Project): Promise<ModuleRead> {
  const features = rows(await env.DB.prepare(
    `SELECT f.id, f.title, f.is_must_have, f.delivery_status, f.done_at, f.updated_at,
            f.hypothesis_id, f.due_date, u.name AS owner, h.claim AS test_hypothesis
       FROM mvp_features f LEFT JOIN hypotheses h ON h.id = f.hypothesis_id AND h.project_id = f.project_id
       LEFT JOIN users u ON u.id = f.owner_user_id
      WHERE f.project_id = ? ORDER BY f.sort_order, f.id`,
  ).bind(p.id).all<any>());
  const must = features.filter(f => number(f.is_must_have) === 1);
  const done = must.filter(f => f.delivery_status === 'Done');
  const history = new Map<string, number>();
  for (const f of done.filter(f => f.done_at)) { const month = String(f.done_at).slice(0, 7); history.set(month, (history.get(month) ?? 0) + 1); }
  const points = [...history.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cumulative = 0;
  const dated: Array<{ date: string; value: number | null; label: string }> = points.map(([month, n]) => ({ date: `${month}-01`, value: (cumulative += n), label: month }));
  const ship = dateOnly(p.mvp_target_date);
  if (ship) dated.push({ date: p.mvp_target_date!, value: null, label: 'Ship' });
  dated.sort((a, b) => a.date.localeCompare(b.date));
  const mark = ship ? dated.findIndex(point => point.label === 'Ship') : -1;
  const series = points.length >= 3 ? [{ kind: 'line', values: dated.map(point => point.value), target: must.length,
    labels: dated.map((point, at) => ({ at, label: point.label })),
    ...(mark >= 0 ? { mark, mark_label: `Ship ${p.mvp_target_date}` } : {}) }] : [];
  const state = must.length === 0 ? 'empty' : points.length < 3 ? 'too_little' : 'ok';
  const missing = must.find(f => f.delivery_status !== 'Done');
  const tests = new Map(must.filter(f => f.test_hypothesis != null).map(f => [String(f.hypothesis_id), String(f.test_hypothesis)]));
  const mustRows = must.map(f => {
    const state = known(MUST_KEY, f.delivery_status);
    return record(f.id, { must_have: f.title, tests: f.test_hypothesis, state: state ? MUST_LABEL[state] : f.delivery_status ?? null, owner: f.owner, due: f.due_date },
      { state, hypothesis: f.test_hypothesis != null ? String(f.hypothesis_id) : 'none' }, { due_date: f.due_date ?? null });
  });
  return { card: card('prototype-mvp', state, series, 'Since first completion', state === 'too_little' ? 'Fewer than three completion dates are recorded.' : state === 'empty' ? 'No must-haves yet. The burn-up toward the ship date appears here.' : null, state === 'empty' ? next(p, 'prototype-mvp', 'Add must-have', true) : next(p, 'prototype-mvp', missing ? `Complete ${missing.title}` : null)),
    cols: [['must_have', 'Must-have'], ['tests', 'Tests'], ['state', 'State'], ['owner', 'Owner'], ['due', 'Due']].map(([key, label]) => ({ key, label })),
    rows: mustRows,
    list: { filters: [{ key: 'state', label: 'State', options: options(Object.entries(MUST_LABEL)) },
      { key: 'hypothesis', label: 'Hypothesis', options: optionsOf(mustRows, 'hypothesis', id => id === 'none' ? 'No hypothesis' : tests.get(id) ?? id) }],
    sort: { key: 'state', label: 'State' }, orders: { state: ['blocked', 'in_progress', 'not_started', 'done'] } },
    facts: { done: done.length, total: must.length, target_date: p.mvp_target_date } };
}

async function roadmap(env: Env, p: Project): Promise<ModuleRead> {
  const items = rows(await env.DB.prepare(
    `SELECT o.id, o.objective, o.kanban_status, o.owner_user_id, o.target_date, o.kpi_key, o.feedback_theme, o.feature_id,
            u.name AS owner
       FROM roadmap_okrs o LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.project_id = ? ORDER BY o.sort_order, o.id`,
  ).bind(p.id).all<any>());
  const moves = rows(await env.DB.prepare(
    `SELECT m.okr_id, m.to_status, m.moved_at FROM okr_column_moves m
       JOIN roadmap_okrs o ON o.id = m.okr_id AND o.project_id = m.project_id
      WHERE m.project_id = ? AND m.to_status = 'done' AND datetime(m.moved_at) <= datetime('now') ORDER BY m.moved_at`,
  ).bind(p.id).all<any>());
  const buckets = ['now', 'next', 'later', 'done'].map(s => items.filter(i => i.kanban_status === s).length);
  const months = new Map<string, Set<number>>();
  for (const m of moves) {
    const month = String(m.moved_at).slice(0, 7);
    if (!months.has(month)) months.set(month, new Set());
    months.get(month)!.add(number(m.okr_id));
  }
  const trend = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const series: ChartSpec[] = items.length ? [{ kind: 'stack', rows: ['Now', 'Next', 'Later', 'Done'].map((label, n) => ({ label, parts: [buckets[n]] })), tones: ['v1'] }] : [];
  if (trend.length) series.push({ kind: 'vbars', values: trend.map(([, ids]) => ids.size), labels: trend.map(([month], at) => ({ at, label: month })) });
  const thisMonth = new Date().toISOString().slice(0, 7);
  // Moves reads the feedback theme an item answers and the KPI it moves.
  const itemRows = items.map(i => record(i.id,
    { item: i.objective, column: i.kanban_status, moves: [i.feedback_theme, i.kpi_key].filter(v => typeof v === 'string' && v.trim()).join(' · ') || null, owner: i.owner, date: i.target_date },
    { column: i.kanban_status ?? null, theme: i.feedback_theme ?? null, kpi: i.kpi_key ?? null },
    { objective: i.objective, kanban_status: i.kanban_status ?? null, owner_user_id: i.owner_user_id ?? null, target_date: i.target_date ?? null,
      kpi_key: i.kpi_key ?? null, feedback_theme: i.feedback_theme ?? null, feature_id: i.feature_id ?? null }));
  return { card: card('product-roadmap', items.length ? 'ok' : 'empty', series, 'All time', items.length ? null : 'No roadmap items yet. Now, Next and Later appear here.', items.length ? next(p, 'product-roadmap', items.find(i => i.kanban_status === 'next') ? 'Move the next planned item into Now' : null) : { text: 'Add item', href: `/build/roadmap?project_id=${p.id}` }),
    cols: [['item', 'Item'], ['column', 'Column'], ['moves', 'Moves'], ['owner', 'Owner'], ['date', 'Date']].map(([key, label]) => ({ key, label })),
    rows: itemRows,
    list: { filters: [{ key: 'column', label: 'Column', options: options(Object.entries(COLUMN_LABEL)) }, { key: 'theme', label: 'Theme', options: optionsOf(itemRows, 'theme') }, { key: 'kpi', label: 'KPI', options: optionsOf(itemRows, 'kpi') }],
      sort: { key: 'column', label: 'Column' }, orders: { column: ['now', 'next', 'later', 'done'] } },
    facts: { items: items.length, shipped_this_month: months.get(thisMonth)?.size ?? 0 } };
}

/**
 * The option pool is not a founder (#1693 decision 14): it is the base
 * scenario's `inputs_json.option_pool_pct`, the newest scenario that is not a
 * variant, as Raise's cap table reads it. Null with no such row or no value.
 */
async function optionPool(env: Env, p: Project): Promise<number | null> {
  const base = await env.DB.prepare(
    'SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0 ORDER BY updated_at DESC LIMIT 1',
  ).bind(p.id).first<{ inputs_json: string | null }>();
  let inputs: any = null;
  try { inputs = base?.inputs_json ? JSON.parse(base.inputs_json) : null; } catch { inputs = null; }
  const pool = inputs?.option_pool_pct;
  return pool == null || pool === '' || !Number.isFinite(Number(pool)) ? null : Number(pool);
}

async function founding(env: Env, p: Project): Promise<ModuleRead> {
  // Vesting belongs to a holder, but its own row is user-keyed. Both keys
  // must agree; a founder's other company's schedule must never be joined.
  const holders = rows(await env.DB.prepare(
    `SELECT h.id, h.name, h.founder_role, h.ownership_pct, h.shares,
            v.start_date, v.cliff_months, v.total_months, v.vested_shares,
            (SELECT d.status FROM documents d
              JOIN cofounder_agreement_parties party ON party.document_id = d.id
             WHERE d.project_id = h.project_id AND d.template_name = 'cofounder_agreement'
               AND party.user_id = h.user_id
             ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS agreement_status
       FROM cap_table_holders h
       LEFT JOIN cap_table_vesting v ON v.holder_id = h.id AND v.user_id = h.user_id
      WHERE h.project_id = ? ORDER BY h.id`,
  ).bind(p.id).all<any>());
  const founderRows = holders.filter(h => h.founder_role != null);
  const equityKnown = founderRows.length && founderRows.every(h => h.ownership_pct != null);
  const series: ChartSpec[] = [];
  if (equityKnown) series.push({ kind: 'stack', rows: [{ label: 'Equity', parts: founderRows.map(h => number(h.ownership_pct)) }], tones: founderRows.map((_, i) => ['v1', 'v2', 'v3', 'grey'][i % 4]), legend: founderRows.map((h, i) => ({ label: h.name, tone: ['v1', 'v2', 'v3', 'grey'][i % 4] })) });
  const withVesting = founderRows.filter(h => h.start_date && h.total_months);
  if (withVesting.length) series.push({ kind: 'progress', items: withVesting.map(h => ({ label: `${h.name} · ${h.cliff_months ?? 'unknown'}m cliff`, pct: h.shares && h.vested_shares != null ? Math.min(100, Math.round(100 * number(h.vested_shares) / number(h.shares))) : null })) });
  const equityTotal = equityKnown ? founderRows.reduce((sum, h) => sum + number(h.ownership_pct), 0) : 0;
  // A founder's id is `h-<holder id>` (D-c). Agreement is Signed for a
  // signed document, Awaiting for any other status, else not recorded.
  const holderRows = founderRows.map(h => record(`h-${h.id}`, {
    founder: h.name, role: h.founder_role, equity: h.ownership_pct == null ? null : percent(number(h.ownership_pct)),
    vesting: vestingText(h.start_date, h.cliff_months, h.total_months),
    agreement: h.agreement_status == null ? null : h.agreement_status === 'signed' ? 'Signed' : 'Awaiting',
  }, { role: h.founder_role ?? null, equity: h.ownership_pct == null ? null : number(h.ownership_pct) },
  { role: h.founder_role ?? null, ownership_pct: h.ownership_pct ?? null }));
  const state = !founderRows.length ? 'empty' : !equityKnown ? 'not_recorded' : equityTotal > 0 || withVesting.length ? 'ok' : 'too_little';
  return { card: card('founding-team', state, series, 'Today', state === 'not_recorded' ? 'One or more founder ownership percentages are not recorded.' : state === 'empty' ? 'No founders yet. The equity split and vesting appear here.' : state === 'too_little' ? 'Ownership percentages sum to zero; no split can be drawn.' : null, state === 'empty' ? { text: 'Add founder', href: '/raise/capital/cap-table' } : next(p, 'founding-team', founderRows.find(h => !h.start_date) ? 'Record founder vesting' : null)),
    cols: [['founder', 'Founder'], ['role', 'Role'], ['equity', 'Equity'], ['vesting', 'Vesting'], ['agreement', 'Agreement']].map(([key, label]) => ({ key, label })),
    rows: holderRows,
    list: { filters: [{ key: 'role', label: 'Role', options: optionsOf(holderRows, 'role') }], sort: { key: '-equity', label: 'Equity' } },
    facts: { cofounder_decision: p.cofounder_decision_meta ? JSON.parse(p.cofounder_decision_meta) : null, option_pool_pct: await optionPool(env, p),
      agreement_reason: 'The latest document status for a founder is recorded; individual signing status is not.' } };
}

async function company(env: Env, p: Project): Promise<ModuleRead> {
  const steps = rows(await env.DB.prepare(
    'SELECT id, title, due_date, state, proof_file_key, kind, jurisdiction, for_holder_id FROM formation_steps WHERE project_id = ? ORDER BY sort_order, id',
  ).bind(p.id).all<any>());
  const order = await env.DB.prepare(
    `SELECT id, status, paid_at, packet_ready_at, filed_on, jurisdiction_id
       FROM incorporations WHERE project_id = ? AND status != 'pending_payment'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).bind(p.id).first<any>();
  let obligations: any[] = [];
  if (p.entity_id != null) obligations = rows(await env.DB.prepare(
    `SELECT o.id, o.title, o.due_date, o.status, o.proof_file_key, o.kind, e.jurisdiction
       FROM entity_obligations o JOIN entities e ON e.id = o.entity_id
      WHERE o.entity_id = ? AND o.status = 'open' ORDER BY o.due_date, o.id LIMIT 3`,
  ).bind(p.entity_id).all<any>());
  const series: ChartSpec[] = [];
  const labSteps = order ? [
    { label: 'Order paid', date: order.paid_at, done: !!order.paid_at },
    { label: 'Formation packet ready', date: order.packet_ready_at, done: !!order.packet_ready_at },
    { label: 'Filed with state', date: order.filed_on, done: !!order.filed_on },
  ] : [];
  const timelineSteps = [...labSteps, ...steps.map(s => ({ label: s.title, date: s.due_date, done: s.state === 'done' }))];
  if (timelineSteps.length >= 2) series.push({ kind: 'timeline', steps: timelineSteps });
  else if (timelineSteps.length === 1) series.push({ kind: 'rows', items: [{ label: timelineSteps[0].label, value: timelineSteps[0].date ?? 'Date not recorded' }] });
  if (obligations.length) series.push({ kind: 'rows', items: obligations.map(o => ({ label: o.title, value: o.due_date ?? 'Not recorded' })) });
  // State and Proof in the canvas's words (#1693 decision 8). A Lab step is
  // filed once its date is recorded and holds no proof; an obligation is open.
  const combined = [
    ...labSteps.map((s, n) => { const state = s.done ? 'filed' : 'upcoming';
      return record(`lab-${order.id}-${n}`, { filing: s.label, jurisdiction: order.jurisdiction_id, due: s.date, state: filingText(state, s.date), proof: null },
        filingKeys(state, s.date), { date: s.date ?? null }); }),
    ...steps.map(s => { const state = filingState(s.state === 'done', s.due_date);
      return record(`step-${s.id}`, { filing: s.title, jurisdiction: s.jurisdiction ?? null, due: s.due_date, state: filingText(state, s.due_date, s.kind), proof: proofText(s.proof_file_key, state) },
        filingKeys(state, s.due_date), { title: s.title, due_date: s.due_date ?? null, state: s.state, kind: s.kind ?? null, jurisdiction: s.jurisdiction ?? null, for_holder_id: s.for_holder_id ?? null }); }),
    ...obligations.map(o => { const state = filingState(false, o.due_date);
      return record(`obligation-${o.id}`, { filing: o.title, jurisdiction: o.jurisdiction, due: o.due_date, state: filingText(state, o.due_date), proof: proofText(o.proof_file_key, state) },
        filingKeys(state, o.due_date), { title: o.title, due_date: o.due_date ?? null, status: o.status }); }),
  ];
  return { card: card('company-creation', combined.length ? 'ok' : 'empty', series, 'Next filings', combined.length ? null : 'No filings yet. Formation steps and their dates appear here.', combined.length ? next(p, 'company-creation', steps.find(s => s.state !== 'done')?.title ? `Complete ${steps.find(s => s.state !== 'done')!.title}` : null) : next(p, 'company-creation', 'Add filing', true)),
    cols: [['filing', 'Filing'], ['jurisdiction', 'Jurisdiction'], ['due', 'Due'], ['state', 'State'], ['proof', 'Proof']].map(([key, label]) => ({ key, label })), rows: combined,
    list: { filters: [{ key: 'state', label: 'State', options: options(Object.entries(FILING_LABEL)) },
      { key: 'due_window', label: 'Due', options: options([['overdue', 'Overdue'], ['next_30', 'Next 30 days'], ['later', 'Later'], ['none', 'No date']]) }],
    sort: { key: 'due', label: 'Due' }, orders: { state: ['overdue', 'due_soon', 'upcoming', 'filed'] } },
    facts: { ip: p.spinout_ip_meta ? JSON.parse(p.spinout_ip_meta) : null, incorporation: p.incorporation_meta ? JSON.parse(p.incorporation_meta) : null } };
}

const SYSTEM_KINDS = ['bank', 'accounting', 'payroll', 'crm', 'workspace'] as const;
type SystemKind = typeof SYSTEM_KINDS[number];
const SYSTEM_LABEL: Record<SystemKind, string> = { bank: 'Bank', accounting: 'Accounting', payroll: 'Payroll', crm: 'CRM', workspace: 'Workspace' };
const SYSTEM_STATE: Record<string, string> = { failing: 'Failing', connected: 'Connected', not_connected: 'Not connected' };
type Viewer = Awaited<ReturnType<typeof requireAuth>>;
function fitsKind(kind: SystemKind, providerKey: string): boolean {
  return kind === 'workspace' ? ['google_calendar', 'microsoft_365'].includes(providerKey)
    : kind === 'crm' && CONNECTOR_METADATA[providerKey]?.category === 'CRM';
}
async function workspaceConnected(env: Env, userId: number, providerKey: string): Promise<boolean> {
  if (providerKey === 'google_calendar') return !!await env.DB.prepare('SELECT 1 FROM google_oauth_tokens WHERE user_id = ?').bind(userId).first();
  if (providerKey === 'microsoft_365') return !!await env.DB.prepare('SELECT 1 FROM microsoft_oauth_tokens WHERE user_id = ?').bind(userId).first();
  return false;
}
async function operating(env: Env, p: Project, viewer: Viewer): Promise<ModuleRead> {
  // The company's enabled mapping is the only source. A member's personal
  // connector list would include tools withheld from this company.
  const mapped = p.company_id == null ? 0 : number((await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM project_core_systems WHERE project_id = ?',
  ).bind(p.id).first<{ n: number }>())?.n);
  const connectors = p.company_id == null ? [] : rows(await env.DB.prepare(
    `SELECT s.kind, s.used_by, i.user_id, i.provider_key, i.display_name, i.status, i.last_synced_at, i.last_error_at
       FROM project_core_systems s
       JOIN integrations i ON i.id = s.integration_id
       JOIN integration_companies ic ON ic.integration_id = i.id AND ic.company_id = ? AND ic.enabled = 1
       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
      WHERE s.project_id = ?`,
  ).bind(p.company_id, p.id).all<any>());
  const workspace = p.company_id == null ? null : await env.DB.prepare(
    `SELECT s.provider_key, s.updated_by, s.used_by FROM project_core_systems s
       JOIN user_company_links ucl ON ucl.user_id = s.updated_by AND ucl.company_id = ?
      WHERE s.project_id = ? AND s.kind = 'workspace'`,
  ).bind(p.company_id, p.id).first<{ provider_key: string; updated_by: number; used_by: string | null }>();
  if (workspace && await workspaceConnected(env, workspace.updated_by, workspace.provider_key)) connectors.push({
    kind: 'workspace', used_by: workspace.used_by, user_id: workspace.updated_by,
    provider_key: workspace.provider_key, display_name: getDescriptor(workspace.provider_key)?.display_name,
    status: 'active', last_synced_at: null, last_error_at: null,
  });
  const byKind = new Map(connectors.map(c => [c.kind, c]));
  // Each kind's stored row, connected or not: Used by, Feeds, and the Sync
  // the caller may set (#1693 decision 5). Sync is the caller's own mapped
  // connection's setting, or, with none mapped, the choice waiting for one.
  const stored = new Map(p.company_id == null ? [] : rows(await env.DB.prepare(
    `SELECT s.kind, s.used_by, s.feeds_json, s.sync_request, s.integration_id, i.user_id AS integration_user_id, i.config_json
       FROM project_core_systems s LEFT JOIN integrations i ON i.id = s.integration_id
      WHERE s.project_id = ?`,
  ).bind(p.id).all<any>()).map(r => [r.kind, r]));
  const systemEdit = (k: SystemKind): RecordRow['edit'] => {
    const row = stored.get(k), feeds = feedsOf(row?.feeds_json);
    const editable = k !== 'workspace' && (row?.integration_id == null || row.integration_user_id === viewer.id);
    return { used_by: row?.used_by ?? null, feeds, ...(editable ? { sync: row?.integration_id == null ? row?.sync_request ?? null : syncOf(row.config_json) } : {}) };
  };
  const viewerMember = p.company_id != null && !!await env.DB.prepare(
    'SELECT 1 FROM user_company_links WHERE user_id = ? AND company_id = ?',
  ).bind(viewer.id, p.company_id).first();
  const tools = p.company_id == null ? [] : rows(await env.DB.prepare(
    `SELECT i.id, i.user_id, i.provider_key, i.status, i.last_synced_at, i.last_error_at, u.name AS owner_name
       FROM integrations i
       JOIN integration_companies ic ON ic.integration_id = i.id AND ic.company_id = ? AND ic.enabled = 1
       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
       LEFT JOIN users u ON u.id = i.user_id
      WHERE i.provider_key NOT IN ('google_calendar','microsoft_365') ORDER BY i.id`,
  ).bind(p.company_id).all<any>());
  const toolRows = tools.map((tool, index) => {
    const descriptor = getDescriptor(tool.provider_key);
    const metadata = CONNECTOR_METADATA[tool.provider_key];
    const href = descriptor && /^[a-z0-9_]{1,80}$/.test(descriptor.key) ? connectHref(descriptor.key, p.id) : null;
    return record(`tool-${index}`, {
      tool: descriptor?.display_name ?? 'Unknown tool', category: metadata?.category ?? 'Not recorded',
      state: tool.status === 'active' ? 'Connected' : tool.status === 'error' ? 'Failing' : 'Not connected',
      last_sync: tool.last_synced_at ?? null,
      failed_at: tool.last_error_at ?? null,
      feeds: metadata?.feeds.map(key => MODULE_LABELS[key] ?? key).join(' · ') || 'Not recorded',
      owner: tool.user_id === viewer.id ? 'You' : viewerMember ? tool.owner_name ?? null : null,
      action: href ? { text: 'Open', href } : null,
    });
  });
  const failingTool = tools.find(tool => tool.status === 'error' && getDescriptor(tool.provider_key));

  const rituals = rows(await env.DB.prepare(
    `SELECT run_date, state FROM ritual_runs WHERE project_id = ?
      AND run_date >= date('now', '-84 days') ORDER BY run_date, id`,
  ).bind(p.id).all<any>());
  const connected = SYSTEM_KINDS.filter(k => byKind.get(k)?.status === 'active').length;
  const tiles = SYSTEM_KINDS.map(k => ({ label: SYSTEM_LABEL[k], state: !byKind.has(k) ? 'not_connected' : byKind.get(k)?.status === 'error' ? 'failing' : byKind.get(k)?.status === 'active' ? 'connected' : 'not_connected' }));
  const reviews = rituals.map(r => r.state === 'done');
  const series: ChartSpec[] = [{ kind: 'tiles', items: tiles }];
  if (reviews.length) series.push({ kind: 'dots', values: reviews, label: 'Weekly reviews held' });
  const failing = SYSTEM_KINDS.find(k => byKind.get(k)?.status === 'error');
  const failedSystem = failing ? byKind.get(failing) : null;
  const toolNext = failingTool ? reconnect(failingTool.provider_key, failingTool.last_error_at, p.id) : null;
  const empty = p.company_id != null && mapped === 0 && rituals.length === 0 && tools.length === 0;
  return { card: card('operating-systems', p.company_id == null ? 'not_recorded' : empty ? 'empty' : 'ok', p.company_id == null || empty ? [] : series, 'Last 12 weeks', p.company_id == null ? 'This project has no company scope for connectors.' : empty ? 'No systems connected yet. Each system and its state appear here.' : null, empty ? { text: 'Connect a system', href: `/build/connect?project_id=${p.id}` } : failedSystem ? reconnect(failedSystem.provider_key, failedSystem.last_error_at, p.id, SYSTEM_LABEL[failing!]) : toolNext),
    cols: [['system', 'System'], ['provider', 'Provider'], ['state', 'State'], ['last_sync', 'Last sync'], ['used_by', 'Used by']].map(([key, label]) => ({ key, label })),
    // Used by shows the recorded Used by, else what the system feeds.
    rows: SYSTEM_KINDS.map(k => { const c = byKind.get(k), edit = systemEdit(k)!; const state = !c ? 'not_connected' : c.status === 'error' ? 'failing' : c.status === 'active' ? 'connected' : 'not_connected';
      return record(k, { system: SYSTEM_LABEL[k], provider: c ? (c.user_id === viewer.id ? c.display_name : getDescriptor(c.provider_key)?.display_name) ?? c.provider_key : null, state: SYSTEM_STATE[state], last_sync: c?.last_synced_at ?? null,
        used_by: (edit.used_by as string | null) ?? ((edit.feeds as string[]).map(key => FEEDS_LABEL[key]).join(' · ') || null) }, { state }, edit); }),
    list: { filters: [{ key: 'state', label: 'State', options: options(Object.entries(SYSTEM_STATE)) }], sort: { key: 'state', label: 'State' },
      orders: { state: ['failing', 'connected', 'not_connected'] } },
    facts: { connected, mapped, reviews: rituals.length, total: SYSTEM_KINDS.length, tools_connected: p.company_id == null ? null : tools.filter(tool => tool.status === 'active').length,
      tools_failing: p.company_id == null ? null : tools.filter(tool => tool.status === 'error').length, tools_total: p.company_id == null ? null : tools.length },
    parts: { tools: {
      cols: [['tool','Tool'],['category','Category'],['state','State'],['last_sync','Last good sync'],['failed_at','Failed at'],['feeds','Feeds'],['owner','Owner'],['action','Action']].map(([key,label]) => ({key,label})),
      rows: toolRows, total: p.company_id == null ? null : toolRows.length,
      state: p.company_id == null ? 'not_recorded' : 'ok', reason: p.company_id == null ? 'This project has no company scope for connectors.' : null,
      note: 'Google Calendar and Microsoft 365 are personal connections and are listed only in Connect a tool.',
    } } };

}

const READS: Record<Slug, (env: Env, p: Project, viewer: Viewer) => Promise<ModuleRead>> = {
  'solution-design': solution, 'prototype-mvp': prototype, 'product-roadmap': roadmap,
  'founding-team': founding, 'company-creation': company, 'operating-systems': operating,
};

async function safeRead(slug: Slug, env: Env, project: Project, viewer: Viewer): Promise<ModuleRead> {
  try { return await READS[slug](env, project, viewer); }
  catch (error) {
    console.error(`[cycle_build] ${MODULES.find(m => m[0] === slug)![2]} read failed`, error);
    const spec = MODULES.find(m => m[0] === slug)!;
    return { card: unreadableBuildCard(slug, spec[1], spec[2], spec[3]), cols: [], rows: [] };
  }
}

async function context(c: any): Promise<Project | Response> {
  const user = await requireAuth(c);
  const raw = c.req.query('project');
  if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) return c.json({ detail: 'Valid project is required' }, 400);
  const p = await c.env.DB.prepare(
    'SELECT id, founder_id, company_id, entity_id, mvp_target_date, incorporation_meta, cofounder_decision_meta, spinout_ip_meta FROM projects WHERE id = ? AND deleted_at IS NULL',
  ).bind(Number(raw)).first() as Project | null;
  if (!p) return c.json({ detail: 'Project not found' }, 404);
  if (!canReadBoard(p, user)) return c.json({ detail: 'Forbidden' }, 403);
  return p;
}

app.get('/overview', async c => {
  const project = await context(c);
  if (project instanceof Response) return project;
  const viewer = await requireAuth(c);
  const results = await Promise.all(MODULES.map(m => safeRead(m[0], c.env, project, viewer)));
  const prototype = results[1], roadmap = results[2], systems = results[5];
  const pFacts = prototype.facts, rFacts = roadmap.facts, sFacts = systems.facts;
  const pBad = prototype.card.state === 'unreadable';
  const rBad = roadmap.card.state === 'unreadable';
  const sBad = systems.card.state === 'unreadable';
  const must = pBad ? unreadableFigure('must_haves_done', 'Must-haves done', 'mvp_features')
    : number(pFacts?.total) === 0 ? figure('must_haves_done', 'Must-haves done', null, 'of', 'mvp_features', 'not_recorded', 'No must-haves marked.')
      : figure('must_haves_done', 'Must-haves done', [number(pFacts?.done), number(pFacts?.total)], 'of', 'mvp_features', 'ok');
  const target = dateOnly(pFacts?.target_date);
  const today = new Date();
  const days = target ? Math.ceil((target.getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86400000) : null;
  const mvp = pBad ? unreadableFigure('days_to_mvp', 'Days to the MVP date', 'projects')
    : figure('days_to_mvp', 'Days to the MVP date', days, 'days', 'projects.mvp_target_date', days == null ? 'not_recorded' : 'ok', days == null ? 'No MVP target date has been recorded.' : null);
  const shipped = rBad ? unreadableFigure('roadmap_shipped', 'Roadmap shipped this month', 'okr_column_moves')
    : number(rFacts?.items) === 0 ? figure('roadmap_shipped', 'Roadmap shipped this month', null, 'items', 'okr_column_moves', 'not_recorded', 'No roadmap items recorded yet.')
      : figure('roadmap_shipped', 'Roadmap shipped this month', number(rFacts?.shipped_this_month), 'items', 'okr_column_moves', 'ok');
  const connected = sBad ? unreadableFigure('systems_connected', 'Systems connected', 'integration_companies')
    : project.company_id == null ? figure('systems_connected', 'Systems connected', null, 'of', 'integration_companies', 'not_recorded', 'The project has no company scope.')
      : number(sFacts?.mapped) === 0 ? figure('systems_connected', 'Systems connected', null, 'of', 'integration_companies', 'not_recorded', 'No systems mapped yet.')
        : figure('systems_connected', 'Systems connected', [number(sFacts?.connected), 5], 'of', 'integration_companies', 'ok');
  const cards = results.map(r => r.card);
  // D692 (#1701): the phone's focus, meter and index, each failing on its own.
  return c.json({ cycle: 'build', question: 'Can this become a real company?', figures: [must, mvp, shipped, connected], cards,
    ...(await buildPhone(c.env, project, viewer, results, [must, mvp, shipped, connected])) });
});

app.get('/modules/:slug', async c => {
  const slug = c.req.param('slug') as Slug;
  if (!Object.hasOwn(READS, slug)) return c.json({ detail: 'Module not found' }, 404);
  const project = await context(c);
  if (project instanceof Response) return project;
  const result = await safeRead(slug, c.env, project, await requireAuth(c));
  const spec = MODULES.find(m => m[0] === slug)!;
  const query: Query = { q: c.req.query('q'), filter: c.req.query('filter'), sort: c.req.query('sort'), page: c.req.query('page') };
  // The canvas's filters, then its default sort first (the page shows
  // sorts[0] as the current one), then each column both ways.
  const list = result.cols.length ? result.list : undefined;
  const filters = list?.filters ?? [];
  const bySort = result.cols.flatMap(col => [{ key: col.key, label: col.label }, { key: `-${col.key}`, label: `${col.label} descending` }]);
  const sorts = list ? [list.sort, ...bySort.filter(s => s.key !== list.sort.key).map(s => s.label === list.sort.label ? { ...s, label: `${s.label} ascending` } : s)] : bySort;
  return c.json({ module: { slug, name: spec[1], records_title: spec[4] }, card: result.card, records: { cols: result.cols,
    ...pageBuildRows(result.rows, query, 25, { orders: list?.orders, defaultSort: list?.sort.key }), filters, sorts,
    ...(result.add ? { add: result.add } : {}) }, ...(result.facts ? { facts: result.facts } : {}), ...(result.parts ? { parts: result.parts } : {}) });
});

// The existing MVP, OKR, cap table and obligation writers remain canonical for
// their original columns. These narrow writes expose only the D662 additions.
async function writeContext(c: any): Promise<{ project: Project; user: Awaited<ReturnType<typeof requireAuth>> } | Response> {
  const project = await context(c);
  if (project instanceof Response) return project;
  const user = await requireAuth(c);
  if (!canWrite(project, user)) return c.json({ detail: 'Forbidden' }, 403);
  return { project, user };
}
async function jsonBody(c: any): Promise<Record<string, unknown> | null> {
  const raw = await c.req.json().catch(() => null);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}
function positiveId(v: unknown): number | null {
  if (!/^[1-9]\d*$/.test(String(v ?? ''))) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}
function text(v: unknown, max = 200): string | null | false {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) return false;
  return v.trim();
}
function dateValue(v: unknown): string | null | false {
  if (v == null || v === '') return null;
  return dateOnly(v) ? v as string : false;
}
/**
 * D690 (#1693 decision 15): every write logs one entity row through
 * logCycleWrite's statement form, in the write's own batch, under today's
 * action names. A write that changes no record logs `project`, which no Build
 * record id equals. No summary names a person, an email, a URL or a file.
 */
function logged(env: Env, projectId: number, userId: number, module: Slug, entityId: string | number, action: string, summary: string) {
  return logCycleWriteStatement(env, { projectId, userId, cycle: 'build', module, entityId, action, summary });
}
function loggedInserted(env: Env, projectId: number, userId: number, module: Slug, table: 'formation_steps', prefix: string, action: string, summary: string) {
  return logCycleWriteStatement(env, { projectId, userId, cycle: 'build', module, readback: { table, by: 'max', prefix }, action, summary });
}
const STEP_STATE: Record<string, string> = { todo: 'to do', doing: 'doing', done: 'done' };

app.patch('/project/target', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const body = await jsonBody(c);
  if (!body || !Object.hasOwn(body, 'mvp_target_date')) return c.json({ detail: 'mvp_target_date required' }, 400);
  const target = dateValue(body.mvp_target_date);
  if (target === false) return c.json({ detail: 'Use a valid YYYY-MM-DD date' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').bind(target, ctx.project.id),
    logged(c.env, ctx.project.id, ctx.user.id, 'solution-design', 'project', 'build_mvp_target_changed', target ? `MVP target date set to ${target}` : 'MVP target date cleared'),
  ]);
  return c.json({ mvp_target_date: target });
});

app.post('/project/ip-copy', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const body = await jsonBody(c);
  const applicationId = positiveId(body?.application_id);
  if (!applicationId) return c.json({ detail: 'application_id required' }, 400);
  // An application is personal. Only its own applicant may copy its answers;
  // the caller chooses the project explicitly when owning more than one.
  const application = await c.env.DB.prepare(
    `SELECT answers_json FROM spinout_applications
      WHERE id = ? AND user_id = ? AND status = 'accepted'`,
  ).bind(applicationId, ctx.user.id).first<{ answers_json: string | null }>();
  if (!application?.answers_json) return c.json({ detail: 'Accepted application not found' }, 404);
  let answer: Record<string, unknown>;
  try { answer = JSON.parse(application.answers_json); } catch { return c.json({ detail: 'Application answers unreadable' }, 503); }
  const ip = { origin: answer.origin ?? null, institution: answer.institution ?? null,
    research_group: answer.research_group ?? null, tto_status: answer.tto_status ?? null,
    ip: Array.isArray(answer.ip) ? answer.ip : [] };
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE projects SET spinout_ip_meta = ? WHERE id = ?').bind(JSON.stringify(ip), ctx.project.id),
    logged(c.env, ctx.project.id, ctx.user.id, 'company-creation', 'project', 'build_ip_copied', 'IP details copied from an accepted application'),
  ]);
  return c.json({ ip });
});

app.patch('/features/:id', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const id = positiveId(c.req.param('id'));
  if (!id) return c.json({ detail: 'Invalid feature id' }, 400);
  const existing = await c.env.DB.prepare(
    'SELECT pain_group_id, hypothesis_id, is_must_have, owner_user_id, due_date FROM mvp_features WHERE id = ? AND project_id = ?',
  ).bind(id, ctx.project.id).first<any>();
  if (!existing) return c.json({ detail: 'Feature not found' }, 404);
  const body = await jsonBody(c);
  if (!body) return c.json({ detail: 'Body required' }, 400);
  const painId = Object.hasOwn(body, 'pain_group_id') ? (body.pain_group_id == null ? null : positiveId(body.pain_group_id)) : existing.pain_group_id;
  const hypothesisId = Object.hasOwn(body, 'hypothesis_id') ? (body.hypothesis_id == null ? null : positiveId(body.hypothesis_id)) : existing.hypothesis_id;
  const ownerId = Object.hasOwn(body, 'owner_user_id') ? (body.owner_user_id == null ? null : positiveId(body.owner_user_id)) : existing.owner_user_id;
  const due = Object.hasOwn(body, 'due_date') ? dateValue(body.due_date) : existing.due_date;
  const must = Object.hasOwn(body, 'is_must_have') ? body.is_must_have : existing.is_must_have;
  if (painId === false || hypothesisId === false || ownerId === false || due === false || ![true, false, 0, 1, null].includes(must as never)) return c.json({ detail: 'Invalid feature field' }, 400);
  if (Object.hasOwn(body, 'pain_group_id') && body.pain_group_id != null && painId == null) return c.json({ detail: 'Invalid pain theme' }, 400);
  if (Object.hasOwn(body, 'hypothesis_id') && body.hypothesis_id != null && hypothesisId == null) return c.json({ detail: 'Invalid hypothesis' }, 400);
  if (Object.hasOwn(body, 'owner_user_id') && body.owner_user_id != null && ownerId == null) return c.json({ detail: 'Invalid owner' }, 400);
  if (painId != null && !(await c.env.DB.prepare('SELECT id FROM pain_groups WHERE id = ? AND project_id = ?').bind(painId, ctx.project.id).first())) {
    return c.json({ detail: 'Pain theme belongs to another project or does not exist' }, 400);
  }
  if (hypothesisId != null && !(await c.env.DB.prepare('SELECT id FROM hypotheses WHERE id = ? AND project_id = ?').bind(hypothesisId, ctx.project.id).first())) {
    return c.json({ detail: 'Hypothesis belongs to another project or does not exist' }, 400);
  }
  if (ownerId != null) {
    const member = await c.env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(ctx.project.company_id, ownerId).first();
    if (!member) return c.json({ detail: 'Owner is not a member of this company' }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE mvp_features SET pain_group_id = ?, hypothesis_id = ?, is_must_have = ?, owner_user_id = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?')
      .bind(painId, hypothesisId, must == null ? null : Number(must), ownerId, due, id, ctx.project.id),
    logged(c.env, ctx.project.id, ctx.user.id, 'solution-design', id, 'build_feature_details_changed', 'Links, must-have mark, owner or due date changed'),
  ]);
  return c.json({ ok: true, id });
});

app.post('/risks', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const body = await jsonBody(c);
  const title = text(body?.title); const mitigation = text(body?.mitigation, 2000);
  const severity = body?.severity;
  if (!title || mitigation === false || !['high', 'medium', 'low'].includes(String(severity))) return c.json({ detail: 'Valid title and severity required' }, 400);
  const ownerId = body?.owner_user_id == null ? null : positiveId(body.owner_user_id);
  if (body?.owner_user_id != null && !ownerId) return c.json({ detail: 'Invalid owner' }, 400);
  if (ownerId) {
    const member = await c.env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(ctx.project.company_id, ownerId).first();
    if (!member) return c.json({ detail: 'Owner is not a member of this company' }, 400);
  }
  const [result] = await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO venture_risks (project_id, title, severity, owner_user_id, mitigation, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(ctx.project.id, title, severity, ownerId, mitigation, ctx.user.id),
    // A risk tied to no feature changes no record.
    logged(c.env, ctx.project.id, ctx.user.id, 'solution-design', 'project', 'build_risk_created', `Risk added, ${severity} severity`),
  ]);
  const id = Number(result.meta.last_row_id);
  return c.json({ id }, 201);
});

app.patch('/risks/:id', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const id = positiveId(c.req.param('id'));
  const existing = id && await c.env.DB.prepare('SELECT title, severity, mitigation, state, feature_id FROM venture_risks WHERE id = ? AND project_id = ?').bind(id, ctx.project.id).first<any>();
  if (!existing) return c.json({ detail: 'Risk not found' }, 404);
  const body = await jsonBody(c); if (!body) return c.json({ detail: 'Body required' }, 400);
  const title = Object.hasOwn(body, 'title') ? text(body.title) : existing.title;
  const mitigation = Object.hasOwn(body, 'mitigation') ? text(body.mitigation, 2000) : existing.mitigation;
  const severity = body.severity ?? existing.severity; const state = body.state ?? existing.state;
  if (!title || mitigation === false || !['high', 'medium', 'low'].includes(String(severity)) || !['open', 'mitigating', 'closed'].includes(String(state))) return c.json({ detail: 'Invalid risk field' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE venture_risks SET title = ?, mitigation = ?, severity = ?, state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').bind(title, mitigation, severity, state, id, ctx.project.id),
    logged(c.env, ctx.project.id, ctx.user.id, 'solution-design', existing.feature_id ?? 'project', 'build_risk_changed', `Risk changed: ${severity} severity, ${state}`),
  ]);
  return c.json({ ok: true, id });
});

app.patch('/roadmap/:id', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const id = positiveId(c.req.param('id'));
  const existing = id && await c.env.DB.prepare('SELECT owner_user_id, target_date, kpi_key FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(id, ctx.project.id).first<any>();
  if (!existing) return c.json({ detail: 'Roadmap item not found' }, 404);
  const body = await jsonBody(c); if (!body) return c.json({ detail: 'Body required' }, 400);
  const ownerId = Object.hasOwn(body, 'owner_user_id') ? (body.owner_user_id == null ? null : positiveId(body.owner_user_id)) : existing.owner_user_id;
  const due = Object.hasOwn(body, 'target_date') ? dateValue(body.target_date) : existing.target_date;
  const kpi = Object.hasOwn(body, 'kpi_key') ? text(body.kpi_key) : existing.kpi_key;
  if (due === false || kpi === false || (body.owner_user_id != null && !ownerId)) return c.json({ detail: 'Invalid roadmap field' }, 400);
  if (ownerId) {
    const member = await c.env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(ctx.project.company_id, ownerId).first();
    if (!member) return c.json({ detail: 'Owner is not a member of this company' }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE roadmap_okrs SET owner_user_id = ?, target_date = ?, kpi_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').bind(ownerId, due, kpi, id, ctx.project.id),
    logged(c.env, ctx.project.id, ctx.user.id, 'product-roadmap', id!, 'build_roadmap_details_changed', 'Owner, date or KPI changed'),
  ]);
  return c.json({ ok: true, id });
});

app.patch('/founders/:id', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const id = positiveId(c.req.param('id'));
  if (!id || !(await c.env.DB.prepare('SELECT 1 FROM cap_table_holders WHERE id = ? AND project_id = ?').bind(id, ctx.project.id).first())) return c.json({ detail: 'Holder not found' }, 404);
  const body = await jsonBody(c);
  if (!body || !Object.hasOwn(body, 'role')) return c.json({ detail: 'role required' }, 400);
  const role = text(body.role, 100);
  if (role === false) return c.json({ detail: 'Invalid role' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE cap_table_holders SET founder_role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').bind(role, id, ctx.project.id),
    logged(c.env, ctx.project.id, ctx.user.id, 'founding-team', `h-${id}`, 'build_founder_role_changed', role ? `Role set to ${role}` : 'Role cleared'),
  ]);
  return c.json({ ok: true, id });
});

app.post('/formation-steps', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const body = await jsonBody(c);
  const title = text(body?.title); const due = dateValue(body?.due_date);
  if (!title || due === false) return c.json({ detail: 'Valid title and due date required' }, 400);
  const [result] = await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO formation_steps (project_id, title, due_date, created_by) VALUES (?, ?, ?, ?)')
      .bind(ctx.project.id, title, due, ctx.user.id),
    loggedInserted(c.env, ctx.project.id, ctx.user.id, 'company-creation', 'formation_steps', 'step-', 'build_formation_step_created', 'Filing added'),
  ]);
  const id = Number(result.meta.last_row_id);
  return c.json({ id }, 201);
});

app.patch('/formation-steps/:id', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const id = positiveId(c.req.param('id'));
  const existing = id && await c.env.DB.prepare('SELECT title, due_date, state, proof_file_key FROM formation_steps WHERE id = ? AND project_id = ?').bind(id, ctx.project.id).first<any>();
  if (!existing) return c.json({ detail: 'Formation step not found' }, 404);
  const body = await jsonBody(c); if (!body) return c.json({ detail: 'Body required' }, 400);
  const title = Object.hasOwn(body, 'title') ? text(body.title) : existing.title;
  const due = Object.hasOwn(body, 'due_date') ? dateValue(body.due_date) : existing.due_date;
  const proof = Object.hasOwn(body, 'proof_file_key') ? text(body.proof_file_key, 500) : existing.proof_file_key;
  const state = body.state ?? existing.state;
  if (!title || due === false || proof === false || !['todo', 'doing', 'done'].includes(String(state))) return c.json({ detail: 'Invalid formation field' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE formation_steps SET title = ?, due_date = ?, state = ?, proof_file_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').bind(title, due, state, proof, id, ctx.project.id),
    logged(c.env, ctx.project.id, ctx.user.id, 'company-creation', `step-${id}`, 'build_formation_step_changed', `Filing changed, ${STEP_STATE[String(state)]}`),
  ]);
  return c.json({ ok: true, id });
});

app.patch('/obligations/:id/proof', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const id = positiveId(c.req.param('id'));
  if (!id || !ctx.project.entity_id) return c.json({ detail: 'Obligation not found' }, 404);
  const obligation = await c.env.DB.prepare('SELECT 1 FROM entity_obligations WHERE id = ? AND entity_id = ?')
    .bind(id, ctx.project.entity_id).first();
  if (!obligation) return c.json({ detail: 'Obligation not found' }, 404);
  const body = await jsonBody(c);
  if (!body || !Object.hasOwn(body, 'proof_file_key')) return c.json({ detail: 'proof_file_key required' }, 400);
  const key = text(body.proof_file_key, 500);
  if (key === false) return c.json({ detail: 'Invalid proof key' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE entity_obligations SET proof_file_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND entity_id = ?')
      .bind(key, id, ctx.project.entity_id),
    logged(c.env, ctx.project.id, ctx.user.id, 'company-creation', `obligation-${id}`, 'build_obligation_proof_changed', key ? 'Proof key recorded' : 'Proof key cleared'),
  ]);
  return c.json({ ok: true, id });
});


app.get('/systems/choices', async c => {
  const project = await context(c); if (project instanceof Response) return project;
  const user = await requireAuth(c);
  if (!project.company_id) return c.json({ detail: 'Project has no company' }, 409);
  const member = await c.env.DB.prepare('SELECT 1 FROM user_company_links WHERE user_id = ? AND company_id = ?').bind(user.id, project.company_id).first();
  if (!member) return c.json({ error: 'not_in_company', detail: 'You are not in this project’s company.' }, 403);
  const own = rows(await c.env.DB.prepare(
    `SELECT i.uid, i.provider_key FROM integrations i
       JOIN integration_companies ic ON ic.integration_id = i.id AND ic.company_id = ? AND ic.enabled = 1
       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
      WHERE i.user_id = ? ORDER BY i.id`,
  ).bind(project.company_id, user.id).all<{ uid: string; provider_key: string }>());
  const workspace: string[] = [];
  for (const provider of ['google_calendar', 'microsoft_365']) if (await workspaceConnected(c.env, user.id, provider)) workspace.push(provider);
  // Which kinds already name a connector, and their Used by, so Connect a
  // tool's "Use as your <kind>" offers only an unmapped kind and keeps what
  // the row says (D686 §5.4). Kinds and booleans only: no connector names.
  const current = new Map(rows(await c.env.DB.prepare(
    'SELECT kind, integration_id, provider_key, used_by FROM project_core_systems WHERE project_id = ?',
  ).bind(project.id).all<{ kind: string; integration_id: number | null; provider_key: string | null; used_by: string | null }>()).map(r => [r.kind, r]));
  return c.json({ kinds: SYSTEM_KINDS.map(kind => ({
    kind, label: SYSTEM_LABEL[kind],
    mapped: current.get(kind)?.integration_id != null || current.get(kind)?.provider_key != null,
    used_by: current.get(kind)?.used_by ?? null,
    choices: kind === 'workspace' ? workspace.map(provider_key => ({ uid: null, provider_key, display_name: getDescriptor(provider_key)?.display_name ?? provider_key, category: 'Calendar and workspace' }))
      : own.filter(i => fitsKind(kind, i.provider_key)).map(i => ({ ...i, display_name: getDescriptor(i.provider_key)?.display_name ?? i.provider_key, category: CONNECTOR_METADATA[i.provider_key]?.category })),
  })) });
});

app.put('/systems/:kind', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const rawKind = c.req.param('kind');
  if (!(SYSTEM_KINDS as readonly string[]).includes(rawKind)) return c.json({ error: 'invalid_kind', detail: 'Unknown system kind' }, 400);
  const kind = rawKind as SystemKind;
  if (!ctx.project.company_id) return c.json({ detail: 'Project has no company' }, 409);
  const member = await c.env.DB.prepare('SELECT 1 FROM user_company_links WHERE user_id = ? AND company_id = ?')
    .bind(ctx.user.id, ctx.project.company_id).first();
  if (!member) return c.json({ error: 'not_in_company', detail: 'You are not in this project’s company.' }, 403);
  const body = await jsonBody(c), usedBy = text(body?.used_by, 200);
  if (!body || usedBy === false) return c.json({ detail: 'Invalid mapping' }, 400);
  let integrationId: number | null = null, providerKey: string | null = null;
  if (kind === 'workspace') {
    if (body.integration_uid != null || body.integration_id != null) return c.json({ error: 'kind_mismatch', detail: 'That connector is not a workspace tool.' }, 400);
    if (body.provider_key != null) {
      if (typeof body.provider_key !== 'string' || !fitsKind(kind, body.provider_key)) return c.json({ error: 'kind_mismatch', detail: 'That connector is not a workspace tool.' }, 400);
      providerKey = body.provider_key;
      if (!await workspaceConnected(c.env, ctx.user.id, providerKey)) return c.json({ error: 'workspace_not_connected', detail: 'Connect Google Calendar or Microsoft 365 first.' }, 403);
    }
  } else {
    if (body.provider_key != null) return c.json({ error: 'kind_mismatch', detail: `That connector is not a ${kind} tool.` }, 400);
    if (body.integration_uid != null && body.integration_id != null) return c.json({ detail: 'Choose one connector key' }, 400);
    if (body.integration_uid != null || body.integration_id != null) {
      const uid = body.integration_uid == null ? null : text(body.integration_uid, 200);
      const id = body.integration_id == null ? null : positiveId(body.integration_id);
      if ((body.integration_uid != null && !uid) || (body.integration_id != null && !id)) return c.json({ detail: 'Invalid mapping' }, 400);
      const enabled = await c.env.DB.prepare(
        `SELECT i.id, i.provider_key FROM integrations i JOIN integration_companies ic ON ic.integration_id = i.id
          JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
         WHERE ((? IS NOT NULL AND i.uid = ?) OR (? IS NOT NULL AND i.id = ?))
           AND i.user_id = ? AND ic.company_id = ? AND ic.enabled = 1`,
      ).bind(uid, uid, id, id, ctx.user.id, ctx.project.company_id).first<{ id: number; provider_key: string }>();
      if (!enabled) return c.json({ detail: 'Connector not enabled for this company or not owned by you' }, 403);
      if (!fitsKind(kind, enabled.provider_key)) return c.json({ error: 'kind_mismatch', detail: `That connector is not a ${kind} tool.` }, 400);
      integrationId = enabled.id;
    }
  }
  const change = kind === 'workspace' && providerKey == null
    ? c.env.DB.prepare('DELETE FROM project_core_systems WHERE project_id = ? AND kind = ?').bind(ctx.project.id, kind)
    : c.env.DB.prepare(
      `INSERT INTO project_core_systems (project_id, kind, integration_id, provider_key, used_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, kind) DO UPDATE SET
         integration_id = excluded.integration_id, provider_key = excluded.provider_key, used_by = excluded.used_by,
         updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    ).bind(ctx.project.id, kind, integrationId, providerKey, usedBy, ctx.user.id);
  await c.env.DB.batch([change, logged(c.env, ctx.project.id, ctx.user.id, 'operating-systems', kind, 'build_system_mapping_changed', `${SYSTEM_LABEL[kind]} mapping changed`)]);
  return c.json({ ok: true, kind });
});

export default app;
