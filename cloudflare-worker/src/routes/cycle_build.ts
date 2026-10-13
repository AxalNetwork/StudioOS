/** D662 — Build overview and six module reads, from the founder's project. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { CONNECTOR_METADATA, getDescriptor } from '../integrations/registry';
import { canReadBoard, canWrite } from './_founder_validate_helpers';
import type { Card } from '../services/cycleCards';
import { pageBuildRows, unreadableBuildCard, type BuildFigure, type BuildRecords, type Cell, type ChartSpec, type RecordRow } from '../services/buildCycleRecords';

const app = new Hono<{ Bindings: Env }>();
const MODULES = [
  ['solution-design', 'Solution design', 'mvp_features and venture_risks', 'Features linked to a pain theme, and risks by severity.'],
  ['prototype-mvp', 'Prototype / MVP', 'mvp_features', 'Must-haves done over time against the total.'],
  ['product-roadmap', 'Product roadmap', 'roadmap_okrs and okr_column_moves', 'Items in Now, Next and Later; items shipped per month.'],
  ['founding-team', 'Founding team', 'cap_table_holders and cap_table_vesting', 'The equity split and each founder’s vesting.'],
  ['company-creation', 'Company creation', 'formation_steps and entity_obligations', 'Formation steps and the next three filings.'],
  ['operating-systems', 'Operating systems', 'integration_companies and ritual_runs', 'Core systems by state; weekly reviews held.'],
] as const;
type Slug = typeof MODULES[number][0];
type Project = { id: number; founder_id: number | null; company_id: number | null; entity_id: number | null; mvp_target_date: string | null; incorporation_meta: string | null; cofounder_decision_meta: string | null; spinout_ip_meta: string | null };
type ModuleRead = { card: Card; cols: BuildRecords['cols']; rows: RecordRow[]; facts?: Record<string, unknown>; add?: BuildRecords['add'] };
type Query = { q?: string; filter?: string; sort?: string; page?: string };

function number(v: unknown): number { return Number(v ?? 0); }
function rows<T>(r: { results?: T[] | null }): T[] { return r.results ?? []; }
function record(id: number | string, cells: Record<string, Cell>): RecordRow { return { id, cells }; }
function card(slug: Slug, state: Card['state'], series: ChartSpec[], range = 'Now', reason: string | null = null, next: Card['next'] = null): Card {
  const spec = MODULES.find(m => m[0] === slug)!;
  return { slug, name: spec[1], caption: spec[3], state, series, range, reason, next };
}
function next(slug: Slug, text: string | null): Card['next'] {
  return text ? { text, href: `/build/${slug}` } : null;
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

async function solution(env: Env, p: Project): Promise<ModuleRead> {
  const features = rows(await env.DB.prepare(
    `SELECT f.id, f.title, f.added_value, f.effort, f.pain_group_id, f.hypothesis_id,
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
  const featureRows = features.map(f => record(f.id, { feature: f.title, pain_theme: f.pain_theme, hypothesis: f.hypothesis, impact: f.added_value, effort: f.effort }));
  return { card: card('solution-design', features.length || risks.length ? 'ok' : 'empty', series, 'Now', features.length || risks.length ? null : 'No features or founder risks recorded yet.', next('solution-design', unlinked ? `Link ${unlinked} features to a pain theme` : null)),
    cols: [['feature', 'Feature'], ['pain_theme', 'Pain theme'], ['hypothesis', 'Hypothesis'], ['impact', 'Impact'], ['effort', 'Effort']].map(([key, label]) => ({ key, label })), rows: featureRows, facts: { features: features.length, risks } };
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
  return { card: card('prototype-mvp', state, series, 'Since first completion', state === 'too_little' ? 'Fewer than three completion dates are recorded.' : state === 'empty' ? 'Mark features as must-have to start the MVP timeline.' : null, next('prototype-mvp', missing ? `Complete ${missing.title}` : null)),
    cols: [['must_have', 'Must-have'], ['tests', 'Tests'], ['state', 'State'], ['owner', 'Owner'], ['due', 'Due']].map(([key, label]) => ({ key, label })),
    rows: must.map(f => record(f.id, { must_have: f.title, tests: f.test_hypothesis, state: f.delivery_status, owner: f.owner, due: f.due_date })),
    facts: { done: done.length, total: must.length, target_date: p.mvp_target_date } };
}

async function roadmap(env: Env, p: Project): Promise<ModuleRead> {
  const items = rows(await env.DB.prepare(
    `SELECT o.id, o.objective, o.kanban_status, o.owner_user_id, o.target_date, o.kpi_key,
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
  return { card: card('product-roadmap', items.length ? 'ok' : 'empty', series, 'All time', items.length ? null : 'No roadmap items recorded yet.', next('product-roadmap', items.find(i => i.kanban_status === 'next') ? 'Move the next planned item into Now' : null)),
    cols: [['item', 'Item'], ['column', 'Column'], ['moves', 'Moves (KPI)'], ['owner', 'Owner'], ['date', 'Date']].map(([key, label]) => ({ key, label })),
    rows: items.map(i => record(i.id, { item: i.objective, column: i.kanban_status, moves: i.kpi_key, owner: i.owner, date: i.target_date })),
    facts: { shipped_this_month: months.get(thisMonth)?.size ?? 0 } };
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
  const state = !founderRows.length ? 'empty' : !equityKnown ? 'not_recorded' : equityTotal > 0 || withVesting.length ? 'ok' : 'too_little';
  return { card: card('founding-team', state, series, 'Today', state === 'not_recorded' ? 'One or more founder ownership percentages are not recorded.' : state === 'empty' ? 'No founder roles have been recorded on the cap table.' : state === 'too_little' ? 'Ownership percentages sum to zero; no split can be drawn.' : null, next('founding-team', founderRows.find(h => !h.start_date) ? 'Record founder vesting' : null)),
    cols: [['founder', 'Founder'], ['role', 'Role'], ['equity', 'Equity'], ['vesting', 'Vesting'], ['agreement', 'Agreement']].map(([key, label]) => ({ key, label })),
    rows: founderRows.map(h => record(h.id, { founder: h.name, role: h.founder_role, equity: h.ownership_pct, vesting: h.start_date ? `${h.start_date} · ${h.total_months} months · ${h.cliff_months ?? 'unknown'} month cliff` : null, agreement: h.agreement_status })),
    facts: { cofounder_decision: p.cofounder_decision_meta ? JSON.parse(p.cofounder_decision_meta) : null,
      agreement_reason: 'The latest document status for a founder is recorded; individual signing status is not.' } };
}

async function company(env: Env, p: Project): Promise<ModuleRead> {
  const steps = rows(await env.DB.prepare(
    'SELECT id, title, due_date, state, proof_file_key FROM formation_steps WHERE project_id = ? ORDER BY sort_order, id',
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
  const combined = [
    ...labSteps.map((s, n) => record(`lab-${order.id}-${n}`, { filing: s.label, jurisdiction: order.jurisdiction_id, due: s.date, state: s.done ? 'done' : 'not recorded', proof: null })),
    ...steps.map(s => record(`step-${s.id}`, { filing: s.title, jurisdiction: null, due: s.due_date, state: s.state, proof: s.proof_file_key ? 'Key recorded' : null })),
    ...obligations.map(o => record(`obligation-${o.id}`, { filing: o.title, jurisdiction: o.jurisdiction, due: o.due_date, state: o.status, proof: o.proof_file_key ? 'Key recorded' : null })),
  ];
  return { card: card('company-creation', combined.length ? 'ok' : 'empty', series, 'Next filings', combined.length ? null : 'No formation steps or entity filings recorded yet.', next('company-creation', steps.find(s => s.state !== 'done')?.title ? `Complete ${steps.find(s => s.state !== 'done')!.title}` : null)),
    cols: [['filing', 'Filing'], ['jurisdiction', 'Jurisdiction'], ['due', 'Due'], ['state', 'State'], ['proof', 'Proof']].map(([key, label]) => ({ key, label })), rows: combined,
    facts: { ip: p.spinout_ip_meta ? JSON.parse(p.spinout_ip_meta) : null, incorporation: p.incorporation_meta ? JSON.parse(p.incorporation_meta) : null } };
}

const SYSTEM_KINDS = ['bank', 'accounting', 'payroll', 'crm', 'workspace'] as const;
type SystemKind = typeof SYSTEM_KINDS[number];
const SYSTEM_LABEL: Record<SystemKind, string> = { bank: 'Bank', accounting: 'Accounting', payroll: 'Payroll', crm: 'CRM', workspace: 'Workspace' };
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
  const connectors = p.company_id == null ? [] : rows(await env.DB.prepare(
    `SELECT s.kind, s.used_by, i.user_id, i.provider_key, i.display_name, i.status, i.last_synced_at
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
    status: 'active', last_synced_at: null,
  });
  const byKind = new Map(connectors.map(c => [c.kind, c]));
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
  const failingLast = failing ? byKind.get(failing)?.last_synced_at : null;
  return { card: card('operating-systems', p.company_id == null ? 'not_recorded' : 'ok', p.company_id == null ? [] : series, 'Last 12 weeks', p.company_id == null ? 'This project has no company scope for connectors.' : null, failing ? { text: `Reconnect ${getDescriptor(byKind.get(failing)?.provider_key)?.display_name ?? SYSTEM_LABEL[failing]}${failingLast ? ` · last good sync ${String(failingLast).slice(0, 10)}` : ''}`, href: `/build/connect?tool=${encodeURIComponent(byKind.get(failing)?.provider_key)}` } : null),
    cols: [['system', 'System'], ['provider', 'Provider'], ['state', 'State'], ['last_sync', 'Last sync'], ['used_by', 'Used by']].map(([key, label]) => ({ key, label })),
    rows: SYSTEM_KINDS.map(k => { const c = byKind.get(k); return record(k, { system: SYSTEM_LABEL[k], provider: c ? (c.user_id === viewer.id ? c.display_name : getDescriptor(c.provider_key)?.display_name) ?? c.provider_key : null, state: !c ? 'Not connected' : c.status === 'error' ? 'Failing' : c.status === 'active' ? 'Connected' : 'Not connected', last_sync: c?.last_synced_at ?? null, used_by: c?.used_by ?? null }); }),
    facts: { connected, total: SYSTEM_KINDS.length } };
}

const READS: Record<Slug, (env: Env, p: Project, viewer: Viewer) => Promise<ModuleRead>> = {
  'solution-design': solution, 'prototype-mvp': prototype, 'product-roadmap': roadmap,
  'founding-team': founding, 'company-creation': company, 'operating-systems': operating,
};
const FILTER_FIELD: Record<Slug, string> = {
  'solution-design': 'impact', 'prototype-mvp': 'state', 'product-roadmap': 'column',
  'founding-team': 'role', 'company-creation': 'state', 'operating-systems': 'state',
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
    : figure('roadmap_shipped', 'Roadmap shipped this month', number(rFacts?.shipped_this_month), 'items', 'okr_column_moves', 'ok');
  const connected = sBad ? unreadableFigure('systems_connected', 'Systems connected', 'integration_companies')
    : project.company_id == null ? figure('systems_connected', 'Systems connected', null, 'of', 'integration_companies', 'not_recorded', 'The project has no company scope.')
      : figure('systems_connected', 'Systems connected', [number(sFacts?.connected), 5], 'of', 'integration_companies', 'ok');
  return c.json({ cycle: 'build', question: 'Can this become a real company?', figures: [must, mvp, shipped, connected], cards: results.map(r => r.card) });
});

app.get('/modules/:slug', async c => {
  const slug = c.req.param('slug') as Slug;
  if (!Object.hasOwn(READS, slug)) return c.json({ detail: 'Module not found' }, 404);
  const project = await context(c);
  if (project instanceof Response) return project;
  const result = await safeRead(slug, c.env, project, await requireAuth(c));
  const query: Query = { q: c.req.query('q'), filter: c.req.query('filter'), sort: c.req.query('sort'), page: c.req.query('page') };
  const filterKey = FILTER_FIELD[slug];
  const filterLabel = result.cols.find(col => col.key === filterKey)?.label ?? filterKey;
  const options = [...new Set(result.rows.map(row => row.cells[filterKey]).filter((value): value is string => typeof value === 'string' && !/[:,]/.test(value)))].sort()
    .slice(0, 100).map(value => ({ value, label: value }));
  const filters = result.cols.length ? [{ key: filterKey, label: filterLabel, options }] : [];
  const sorts = result.cols.flatMap(col => [{ key: col.key, label: col.label }, { key: `-${col.key}`, label: `${col.label} descending` }]);
  return c.json({ module: slug, card: result.card, records: { cols: result.cols, ...pageBuildRows(result.rows, query), filters, sorts,
    ...(result.add ? { add: result.add } : {}) }, ...(result.facts ? { facts: result.facts } : {}) });
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
function audit(env: Env, projectId: number, userId: number, action: string, rowId: number | string) {
  return env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, ?, ?)')
    .bind(projectId, userId, action, JSON.stringify({ id: rowId }), `user:${userId}`);
}
function auditInserted(env: Env, projectId: number, userId: number, action: string) {
  return env.DB.prepare("INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, json_object('id', last_insert_rowid()), ?)")
    .bind(projectId, userId, action, `user:${userId}`);
}

app.patch('/project/target', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const body = await jsonBody(c);
  if (!body || !Object.hasOwn(body, 'mvp_target_date')) return c.json({ detail: 'mvp_target_date required' }, 400);
  const target = dateValue(body.mvp_target_date);
  if (target === false) return c.json({ detail: 'Use a valid YYYY-MM-DD date' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').bind(target, ctx.project.id),
    audit(c.env, ctx.project.id, ctx.user.id, 'build_mvp_target_changed', ctx.project.id),
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
    audit(c.env, ctx.project.id, ctx.user.id, 'build_ip_copied', applicationId),
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
    audit(c.env, ctx.project.id, ctx.user.id, 'build_feature_details_changed', id),
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
    auditInserted(c.env, ctx.project.id, ctx.user.id, 'build_risk_created'),
  ]);
  const id = Number(result.meta.last_row_id);
  return c.json({ id }, 201);
});

app.patch('/risks/:id', async c => {
  const ctx = await writeContext(c); if (ctx instanceof Response) return ctx;
  const id = positiveId(c.req.param('id'));
  const existing = id && await c.env.DB.prepare('SELECT title, severity, mitigation, state FROM venture_risks WHERE id = ? AND project_id = ?').bind(id, ctx.project.id).first<any>();
  if (!existing) return c.json({ detail: 'Risk not found' }, 404);
  const body = await jsonBody(c); if (!body) return c.json({ detail: 'Body required' }, 400);
  const title = Object.hasOwn(body, 'title') ? text(body.title) : existing.title;
  const mitigation = Object.hasOwn(body, 'mitigation') ? text(body.mitigation, 2000) : existing.mitigation;
  const severity = body.severity ?? existing.severity; const state = body.state ?? existing.state;
  if (!title || mitigation === false || !['high', 'medium', 'low'].includes(String(severity)) || !['open', 'mitigating', 'closed'].includes(String(state))) return c.json({ detail: 'Invalid risk field' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE venture_risks SET title = ?, mitigation = ?, severity = ?, state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').bind(title, mitigation, severity, state, id, ctx.project.id),
    audit(c.env, ctx.project.id, ctx.user.id, 'build_risk_changed', id!),
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
    audit(c.env, ctx.project.id, ctx.user.id, 'build_roadmap_details_changed', id!),
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
    audit(c.env, ctx.project.id, ctx.user.id, 'build_founder_role_changed', id),
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
    auditInserted(c.env, ctx.project.id, ctx.user.id, 'build_formation_step_created'),
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
    audit(c.env, ctx.project.id, ctx.user.id, 'build_formation_step_changed', id!),
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
    audit(c.env, ctx.project.id, ctx.user.id, 'build_obligation_proof_changed', id),
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
  return c.json({ kinds: SYSTEM_KINDS.map(kind => ({
    kind, label: SYSTEM_LABEL[kind],
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
  const body = await jsonBody(c), usedBy = text(body?.used_by, 200);
  if (!body || usedBy === false) return c.json({ detail: 'Invalid mapping' }, 400);
  let integrationId: number | null = null, providerKey: string | null = null;
  if (kind === 'workspace') {
    const member = await c.env.DB.prepare('SELECT 1 FROM user_company_links WHERE user_id = ? AND company_id = ?')
      .bind(ctx.user.id, ctx.project.company_id).first();
    if (!member) return c.json({ error: 'not_in_company', detail: 'You are not in this project’s company.' }, 403);
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
  await c.env.DB.batch([change, audit(c.env, ctx.project.id, ctx.user.id, 'build_system_mapping_changed', kind)]);
  return c.json({ ok: true, kind });
});

export default app;
