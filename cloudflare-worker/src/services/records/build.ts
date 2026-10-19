/**
 * D690 (S18-B, #1694) — Build's six one-record reads, as CO:369-374 draws them.
 *
 * Each read is fixed, bound SQL scoped to the venture the route has already
 * proven owns the id (`ownedRow`). It writes nothing. A fact with no store is
 * `{ value: null, reason }`, and a section with no store reads Not recorded
 * with its reason. Decision numbers are #1693's, #1694's and #1695's.
 *
 * #1695 declares each record's actions. An action that edits what a route
 * writes runs that route's own function from `cycle_build.ts` (decision 13),
 * through `viaRoute()`, so a record and its form refuse alike; the actions
 * with no route (sessions, findings, links, checks, contributions, filing
 * steps, dependencies and proofs) write here, each with its activity row in
 * its batch (decision 15). The record route has already run `ownedRow` on the
 * id and on every id an action's `references` names.
 */
import type { Env } from '../../types';
import { CONNECTOR_METADATA, REGISTRY, getDescriptor } from '../../integrations/registry';
import { canWrite } from '../../routes/_founder_validate_helpers';
import {
  actionCall, featureLink, fitsKind, unallocated, writeProject, systemChoices, patchFeature, postRisk, postRoadmap, patchRoadmap, patchFounder, patchFormationStep, putSystem,
  type WriteCall, type WriteCtx,
} from '../../routes/cycle_build';
import { addOkrDependency } from '../okrGraph';
import { logCycleWriteStatement } from '../cycleActivity';
import { mintDownloadToken } from '../signedDownload';
import { customKpis, KPI_KEYS, KPI_LABEL, CUSTOM_PREFIX } from '../growKpis';
import type { ActionResult, ModuleSpec, RecordAction, RecordContent, RecordContext, RecordFact, RecordField, Row, Store } from './types';

type Any = Record<string, any>;
type Section = { rows: Row[]; empty?: string; action?: string };

const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const IMPACT_KEY: Record<string, string> = { High: 'high', Medium: 'medium', Low: 'low' };
const EFFORT_KEY: Record<string, string> = { S: 'low', M: 'medium', L: 'high', XL: 'high' };
const MUST_KEY: Record<string, string> = { Backlog: 'not_started', 'In Progress': 'in_progress', Review: 'in_progress', Done: 'done', Blocked: 'blocked' };
const MUST_LABEL: Record<string, string> = { blocked: 'Blocked', in_progress: 'In progress', not_started: 'Not started', done: 'Done' };
const MUST_TONE: Record<string, string> = { blocked: 'bad', in_progress: 'vio', not_started: 'grey', done: 'ok' };
const COLUMN_LABEL: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later', done: 'Done' };
const SEVERITY_TONE: Record<string, string> = { high: 'bad', medium: 'amb', low: 'grey' };
const FEEDS_LABEL: Record<string, string> = { use_of_funds: 'Use of funds', kpis: 'KPIs', team: 'Team' };
const SYNC_LABEL: Record<string, string> = { live: 'Live', hourly: 'Hourly', daily: 'Daily', manual: 'Manual' };
const FILING_KIND: Record<string, string> = {
  formation: 'Formation', ein: 'EIN', '83b': '83(b) election', annual_report: 'Annual report', franchise_tax: 'Franchise tax', other: 'Other',
};
const FILING_TONE: Record<string, string> = { filed: 'ok', due_soon: 'amb', overdue: 'bad', upcoming: 'grey' };
const LAB_STEPS = ['Order paid', 'Formation packet ready', 'Filed with state'] as const;
export const SYSTEM_KINDS = ['bank', 'accounting', 'payroll', 'crm', 'workspace'] as const;
type SystemKind = typeof SYSTEM_KINDS[number];
const SYSTEM_LABEL: Record<SystemKind, string> = { bank: 'Bank', accounting: 'Accounting', payroll: 'Payroll', crm: 'CRM', workspace: 'Workspace' };

/**
 * Each filing kind's checklist (#1693 decision 8). The last step is done when
 * a proof is stored; the others are rows of `formation_step_checks` by key.
 */
export const FILING_CHECKLIST: Record<string, ReadonlyArray<readonly [string, string]>> = {
  '83b': [['fill', 'Fill the election'], ['mail', 'Mail by certified post'], ['proof', 'Upload proof of mailing']],
  ein: [['apply', 'Apply for the EIN'], ['proof', 'Upload the EIN letter']],
  other: [['submit', 'Submit the filing'], ['proof', 'Upload the confirmation']],
};

const known = <T,>(map: Record<string, T>, key: unknown): T | null => typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null;
const fact = (label: string, value: string | number | null | undefined, reason: string): RecordFact =>
  value == null || value === '' ? { label, value: null, reason } : { label, value };
const notRecorded = (reason: string): Section => ({ rows: [{ a: 'Not recorded', b: reason, tone: 'grey' }] });
const rowsOf = <T,>(r: { results?: T[] | null }): T[] => r.results ?? [];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const percent = (n: number) => `${Math.round(n * 100) / 100}%`;
const numericId = (id: string, prefix = '') => Number(id.slice(prefix.length));

function dateOnly(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day ? null : date;
}
const longDate = (date: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
function dateText(raw: unknown): string | null {
  const date = dateOnly(raw);
  return date ? longDate(date) : null;
}
/** "12 Oct 2026 · 09:41" from a stored UTC timestamp, or the day alone. */
function stampText(raw: unknown): string | null {
  const day = dateText(raw);
  if (!day) return null;
  const time = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/.exec(String(raw))?.[1];
  return time ? `${day} · ${time}` : day;
}
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function daysUntil(raw: unknown): number | null {
  const date = dateOnly(raw);
  return date ? Math.round((date.getTime() - todayUtc().getTime()) / 86400000) : null;
}
function addMonths(date: Date, months: number): Date {
  const out = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(date.getUTCDate(), last));
  return out;
}
function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}
const recordHref = (slug: string, id: string | number, projectId: number) => `/build/${slug}/${id}?project=${projectId}`;
// Build's Connect a tool for one tool, keeping the venture, as the module
// read's links do (cycle_build.ts, D686 §5.4).
const connectHref = (providerKey: string, projectId: number) =>
  `/build/connect?tool=${encodeURIComponent(providerKey)}&project_id=${encodeURIComponent(String(projectId))}`;

async function projectRow(ctx: RecordContext): Promise<{ company_id: number | null; entity_id: number | null }> {
  return await ctx.env.DB.prepare('SELECT company_id, entity_id FROM projects WHERE id = ?')
    .bind(ctx.projectId).first<{ company_id: number | null; entity_id: number | null }>() ?? { company_id: null, entity_id: null };
}

// ── Writes (#1695) ───────────────────────────────────────────────────────────

type Write = (c: WriteCall, ctx: WriteCtx) => Promise<Response>;
type Body = Record<string, unknown>;
type Option = { value: string; label: string };
const JSON_TYPE = { 'Content-Type': 'application/json' };
function refuse(status: number, detail: string): never {
  throw new Response(JSON.stringify({ detail }), { status, headers: JSON_TYPE });
}
const jsonOf = (body: Body | FormData): Body => (body instanceof FormData ? {} : body);
const optionsOf = (pairs: Record<string, string>): Option[] => Object.entries(pairs).map(([value, label]) => ({ value, label }));
/** The stored value stays choosable, so an Edit sent back unchanged never rewrites it. */
const withCurrent = (options: Option[], current: unknown, label?: string): Option[] =>
  current == null || current === '' || options.some(o => o.value === String(current)) ? options : [...options, { value: String(current), label: label ?? String(current) }];
const idValue = (v: unknown) => (v == null ? '' : String(v));

/** Decision 13: an action runs its module's route write, and answers as that route would. */
async function viaRoute(ctx: RecordContext, write: Write, params: Record<string, string>, body: Body): Promise<ActionResult> {
  const project = await writeProject(ctx.env, ctx.projectId);
  if (!project) refuse(404, 'Project not found');
  const res = await write(actionCall(ctx.env, params, body), { project, user: ctx.user });
  if (res.status >= 400) throw res;
  return { ok: true, record: await res.json() };
}
/**
 * A form's keys, as its route reads them. A form sends '' for an empty
 * choice: a key that may be cleared becomes null, and any other blank is left
 * out, so the stored value stays.
 */
function formBody(body: Body, keys: string[], clearable: string[] = []): Body {
  const out: Body = {};
  for (const key of keys) {
    if (!Object.hasOwn(body, key)) continue;
    if (body[key] === '') { if (clearable.includes(key)) out[key] = null; continue; }
    out[key] = body[key];
  }
  return out;
}
/** The ids a body names, each checked in its own store before the write (decision 16). */
function references(body: Body | FormData, pairs: Array<[string, Store]>): Array<{ store: Store; id: string | number }> {
  const b = jsonOf(body);
  return pairs.filter(([key]) => b[key] != null && b[key] !== '').map(([key, store]) => {
    const raw = String(b[key]);
    return { store, id: store === 'cap_table_founders' && /^\d+$/.test(raw) ? `h-${raw}` : raw };
  });
}
function textIn(v: unknown, max: number, required: boolean, field: string): string | null {
  if (v == null || v === '') { if (required) refuse(400, `${field} is required`); return null; }
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) refuse(400, `${field} must be 1 to ${max} characters`);
  return v.trim();
}
function dayIn(v: unknown, field: string): string | null {
  if (v == null || v === '') return null;
  if (!dateOnly(v) || String(v).length !== 10) refuse(400, `${field} must be a YYYY-MM-DD date`);
  return v as string;
}
function idIn(v: unknown, field: string): number | null {
  if (v == null || v === '') return null;
  if (!/^[1-9][0-9]{0,9}$/.test(String(v))) refuse(400, `Invalid ${field}`);
  return Number(v);
}
const truthy = (v: unknown) => !(v === false || v === 0 || v === '0' || v === 'false' || v === '' || v == null);
/** Decision 15: one activity row, with the record's id, in the write's batch. */
function logRow(ctx: RecordContext, module: 'solution-design' | 'product-roadmap' | 'founding-team' | 'company-creation', entityId: string | number, action: string, summary: string) {
  return logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'build', module, entityId, action, summary });
}
/** An owner is a member of the venture's company; one who is not is the caller's choice, a 400. */
async function memberOwner(ctx: RecordContext, raw: unknown): Promise<number | null> {
  const owner = idIn(raw, 'owner');
  if (owner == null) return null;
  const { company_id: companyId } = await projectRow(ctx);
  const member = companyId != null && await ctx.env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(companyId, owner).first();
  if (!member) refuse(400, 'Owner is not a member of this company');
  return owner;
}
/** The company's members, the owners a form offers. Writers only see them. */
async function owners(ctx: RecordContext): Promise<Option[]> {
  const { company_id: companyId } = await projectRow(ctx);
  if (companyId == null) return [];
  return rowsOf(await ctx.env.DB.prepare(
    'SELECT u.id, u.name FROM user_company_links l JOIN users u ON u.id = l.user_id WHERE l.company_id = ? ORDER BY lower(u.name), u.id',
  ).bind(companyId).all<Any>()).map(u => ({ value: String(u.id), label: u.name ?? 'Unnamed member' }));
}

const IMPACT_OPTIONS = optionsOf({ High: 'High', Medium: 'Medium', Low: 'Low' });
const EFFORT_OPTIONS = optionsOf({ S: 'Low', M: 'Medium', L: 'High' });
const SCOPE_OPTIONS = optionsOf({ core: 'In scope', out: 'Out of scope' });
const STATE_OPTIONS = optionsOf({ Backlog: 'Not started', 'In Progress': 'In progress', Done: 'Done', Blocked: 'Blocked' });
const SEVERITY_OPTIONS = optionsOf(LEVEL);
const COLUMN_OPTIONS = optionsOf({ now: 'Now', next: 'Next', later: 'Later' });
const NEXT_COLUMN: Record<string, string> = { now: 'next', next: 'later', later: 'now' };
const FEED_OPTIONS = optionsOf(FEEDS_LABEL);
const SYNC_OPTIONS = optionsOf(SYNC_LABEL);
const VESTING_OPTIONS = optionsOf({ '4y_1y_cliff': '4 years, 1-year cliff', '4y_no_cliff': '4 years, no cliff', custom: 'Custom' });
const FILING_STATE_OPTIONS = optionsOf({ upcoming: 'Upcoming', due_soon: 'Due soon', filed: 'Filed' });
const ITEM_KEYS = ['title', 'column', 'kpi_key', 'feedback_theme', 'owner_user_id', 'target_date'];
const ITEM_CLEARABLE = ['kpi_key', 'feedback_theme', 'owner_user_id', 'target_date', 'feature_id'];

/** Add item's fields (Waits on is the record's Dependencies), with the values given. */
function itemFields(v: Any, columns: Option[]): RecordField[] {
  return [
    { key: 'title', label: 'Item', kind: 'T', required: true, value: v.title ?? '' },
    { key: 'column', label: 'Column', kind: 'CH', options: columns, value: v.column ?? 'next' },
    { key: 'kpi_key', label: 'Moves', kind: 'CH', value: v.kpi_key ?? '' },
    { key: 'feedback_theme', label: 'Answers', kind: 'CH', value: v.feedback_theme ?? '' },
    { key: 'owner_user_id', label: 'Owner', kind: 'CH', options: v.owners, value: idValue(v.owner_user_id) },
    { key: 'target_date', label: 'Date', kind: 'T', input: 'date', value: v.target_date ?? '' },
  ];
}

/** A feature's stored fields, as its Edit carries them. `ownedRow` has already run. */
async function featureFields(ctx: RecordContext, id: string): Promise<Any> {
  const row = await ctx.env.DB.prepare(
    `SELECT title, description, pain_group_id, hypothesis_id, added_value, effort, scope, is_must_have, delivery_status, owner_user_id, due_date
       FROM mvp_features WHERE id = ? AND project_id = ?`,
  ).bind(numericId(id), ctx.projectId).first<Any>();
  if (!row) throw new Error('Build feature vanished after its ownership check');
  return row;
}

async function addSession(ctx: RecordContext, featureId: number, b: Body): Promise<ActionResult> {
  const title = textIn(b.title, 200, true, 'Title'), heldOn = dayIn(b.held_on, 'Date');
  const status = b.status == null || b.status === '' ? 'planned' : String(b.status);
  if (!['planned', 'done'].includes(status)) refuse(400, 'Status is planned or done');
  const owner = await memberOwner(ctx, b.owner_user_id);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO mvp_test_sessions (project_id, feature_id, title, held_on, owner_user_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ctx.projectId, featureId, title, heldOn, owner, status, ctx.user.id),
    logRow(ctx, 'solution-design', featureId, 'build_test_session_added', status === 'done' ? 'Test session added, done' : 'Test session added, planned'),
  ]);
  return { ok: true };
}
async function addFinding(ctx: RecordContext, featureId: number, b: Body): Promise<ActionResult> {
  const sessionId = idIn(b.session_id, 'session');
  if (sessionId == null) refuse(400, 'Choose a session');
  // `references` proved the session is the venture's; it must also be this feature's.
  const own = await ctx.env.DB.prepare('SELECT 1 FROM mvp_test_sessions WHERE id = ? AND feature_id = ? AND project_id = ?').bind(sessionId, featureId, ctx.projectId).first();
  if (!own) refuse(404, 'Record not found.');
  const text = textIn(b.text, 2000, true, 'Finding'), hypothesisId = idIn(b.hypothesis_id, 'hypothesis');
  const direction = b.direction == null || b.direction === '' ? 'supports' : String(b.direction);
  if (!['supports', 'contradicts'].includes(direction)) refuse(400, 'Direction is supports or contradicts');
  const kept = !Object.hasOwn(b, 'kept') || truthy(b.kept) ? 1 : 0;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO mvp_test_findings (session_id, text, hypothesis_id, direction, kept, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(sessionId, text, hypothesisId, direction, kept, ctx.user.id),
    logRow(ctx, 'solution-design', featureId, 'build_test_finding_added', kept ? 'Finding kept' : 'Finding flagged'),
  ]);
  return { ok: true };
}
async function addLink(ctx: RecordContext, featureId: number, b: Body): Promise<ActionResult> {
  const link = featureLink(b.url);
  if (!link) refuse(400, 'A link is an https Figma or GitHub URL');
  const seen = await ctx.env.DB.prepare('SELECT 1 FROM mvp_feature_links WHERE feature_id = ? AND url = ?').bind(featureId, link.url).first();
  if (seen) refuse(409, 'That link is already recorded');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO mvp_feature_links (feature_id, kind, url, external_ref, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(featureId, link.kind, link.url, link.external_ref, ctx.user.id),
    // Decision 15: no URL in a summary.
    logRow(ctx, 'solution-design', featureId, 'build_feature_link_added', link.kind === 'figma' ? 'Figma link added' : 'GitHub link added'),
  ]);
  return { ok: true };
}
async function addCheck(ctx: RecordContext, featureId: number, b: Body): Promise<ActionResult> {
  const label = textIn(b.label, 200, true, 'Check');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO mvp_release_checks (feature_id, label, created_by) VALUES (?, ?, ?)').bind(featureId, label, ctx.user.id),
    logRow(ctx, 'solution-design', featureId, 'build_release_check_added', 'Release check added'),
  ]);
  return { ok: true };
}
async function setCheck(ctx: RecordContext, featureId: number, b: Body): Promise<ActionResult> {
  const checkId = idIn(b.check_id, 'check');
  if (checkId == null) refuse(400, 'Choose a check');
  const own = await ctx.env.DB.prepare('SELECT 1 FROM mvp_release_checks WHERE id = ? AND feature_id = ?').bind(checkId, featureId).first();
  if (!own) refuse(404, 'Record not found.');
  const done = !Object.hasOwn(b, 'done') || truthy(b.done);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE mvp_release_checks SET done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now')) ELSE NULL END, updated_at = datetime('now') WHERE id = ? AND feature_id = ?`)
      .bind(done ? 1 : 0, checkId, featureId),
    logRow(ctx, 'solution-design', featureId, 'build_release_check_changed', done ? 'Release check done' : 'Release check reopened'),
  ]);
  return { ok: true };
}
async function addDependency(ctx: RecordContext, itemId: number, b: Body): Promise<ActionResult> {
  const waits = b.waits_on_id != null && b.waits_on_id !== '', blocks = b.blocks_id != null && b.blocks_id !== '';
  if (waits === blocks) refuse(400, 'Choose one: Waits on or Blocks');
  const other = idIn(waits ? b.waits_on_id : b.blocks_id, 'item')!;
  // Decision 4: "Waits on X" is an edge from X to this item, through the one edge write.
  const edge = await addOkrDependency(ctx.env, {
    projectId: ctx.projectId, okrId: waits ? other : itemId, blocksOkrId: waits ? itemId : other, note: null, userId: ctx.user.id,
    also: [logRow(ctx, 'product-roadmap', itemId, 'build_roadmap_dependency_added', waits ? 'Waits on another item' : 'Blocks another item')],
  });
  if (!edge.ok) refuse(edge.status, edge.detail);
  return { ok: true };
}
async function logContribution(ctx: RecordContext, holderId: number, b: Body): Promise<ActionResult> {
  const text = textIn(b.text, 2000, true, 'Contribution'), onDate = dayIn(b.on_date, 'Date');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO founder_contributions (project_id, holder_id, text, on_date, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(ctx.projectId, holderId, text, onDate, ctx.user.id),
    logRow(ctx, 'founding-team', `h-${holderId}`, 'build_contribution_logged', 'Contribution logged'),
  ]);
  return { ok: true };
}
const VESTING_KEYS = ['vesting', 'vesting_start', 'total_months', 'cliff_months'];
function presetOf(h: Any): string {
  if (!h.start_date) return '';
  const total = Number(h.total_months), cliff = Number(h.cliff_months);
  return total === 48 && cliff === 12 ? '4y_1y_cliff' : total === 48 && cliff === 0 ? '4y_no_cliff' : 'custom';
}
/**
 * The founder's Edit sends every field back; only what changed reaches the
 * PATCH, so an Edit that changes only the role keeps that write's gate
 * (decision 6) and an unchanged Edit writes nothing.
 */
async function editFounder(ctx: RecordContext, h: Any, b: Body): Promise<ActionResult> {
  const out: Body = {};
  const same = (a: unknown, z: unknown) => (a == null || a === '' ? null : String(a).trim()) === (z == null || z === '' ? null : String(z).trim());
  if (Object.hasOwn(b, 'name') && !same(b.name, h.name)) out.name = b.name;
  if (Object.hasOwn(b, 'email') && !same(b.email, h.email)) out.email = b.email === '' ? null : b.email;
  if (Object.hasOwn(b, 'role') && !same(b.role, h.founder_role)) out.role = b.role === '' ? null : b.role;
  if (Object.hasOwn(b, 'equity_pct') && !(b.equity_pct === '' && h.ownership_pct == null) && Number(b.equity_pct) !== Number(h.ownership_pct)) {
    out.equity_pct = b.equity_pct === '' || b.equity_pct == null ? null : typeof b.equity_pct === 'string' && b.equity_pct.trim() !== '' && Number.isFinite(Number(b.equity_pct)) ? Number(b.equity_pct) : b.equity_pct;
  }
  const vestingSent = VESTING_KEYS.some(k => Object.hasOwn(b, k));
  const vestingSame = same(b.vesting ?? presetOf(h), presetOf(h)) && same(b.vesting_start ?? h.start_date, h.start_date?.slice?.(0, 10) ?? h.start_date)
    && (presetOf(h) !== 'custom' || (same(b.total_months ?? h.total_months, h.total_months) && same(b.cliff_months ?? h.cliff_months, h.cliff_months)));
  if (vestingSent && !vestingSame) {
    out.vesting = b.vesting === '' ? null : b.vesting;
    for (const k of ['vesting_start', 'total_months', 'cliff_months']) if (Object.hasOwn(b, k)) out[k] = b[k];
  }
  if (!Object.keys(out).length) return { ok: true, record: { ok: true, id: `h-${h.id}` } };
  return viaRoute(ctx, patchFounder, { id: `h-${h.id}` }, out);
}
async function stepCheck(ctx: RecordContext, id: string, stepId: number, keys: string[], b: Body): Promise<ActionResult> {
  const key = typeof b.key === 'string' ? b.key : '';
  if (!keys.includes(key)) refuse(400, 'Choose one of this filing’s steps');
  const done = !Object.hasOwn(b, 'done') || truthy(b.done);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`INSERT INTO formation_step_checks (step_id, key, done_at) VALUES (?, ?, CASE WHEN ? THEN datetime('now') END)
      ON CONFLICT(step_id, key) DO UPDATE SET done_at = CASE WHEN ? THEN COALESCE(formation_step_checks.done_at, datetime('now')) ELSE NULL END, updated_at = datetime('now')`)
      .bind(stepId, key, done ? 1 : 0, done ? 1 : 0),
    logRow(ctx, 'company-creation', id, 'build_filing_step_checked', done ? 'Filing step done' : 'Filing step reopened'),
  ]);
  return { ok: true };
}

const PROOF_MAX_BYTES = 10 * 1024 * 1024;
/** PDF, JPEG or PNG by its magic bytes; the declared type and the name are never trusted. */
function sniffProof(h: Uint8Array): { mime: string; ext: string } | null {
  if (h.length >= 5 && h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d) return { mime: 'application/pdf', ext: 'pdf' };
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 && h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  return null;
}
const proofPrefix = (projectId: number) => `build-proof/${projectId}/`;
/**
 * Upload proof (#1695), as `legal_83b.ts` takes a receipt: at most 10 MB, a
 * sniffed PDF, JPEG or PNG, kept under `build-proof/<project>/<uid>.<ext>`,
 * never the file's name. It completes the checklist's last step; it does not
 * mark the filing filed.
 */
async function uploadProof(ctx: RecordContext, id: string, f: Filing, body: Body | FormData): Promise<ActionResult> {
  if (!(body instanceof FormData)) refuse(400, 'Upload proof takes a multipart form with its file');
  const file = body.get('file') as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> } | null;
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') refuse(400, 'Choose a file');
  const bytes = new Uint8Array(await file.arrayBuffer!());
  if (!bytes.length) refuse(400, 'The file is empty');
  if (bytes.length > PROOF_MAX_BYTES) refuse(413, 'Proof files are at most 10 MB');
  const type = sniffProof(bytes);
  if (!type) refuse(400, 'Proof must be a PDF, JPEG or PNG file');
  const files = ctx.env.FILES;
  if (!files) refuse(503, 'File storage is not configured');
  const key = `${proofPrefix(ctx.projectId)}${crypto.randomUUID().replace(/-/g, '')}.${type.ext}`;
  await files.put(key, bytes, { httpMetadata: { contentType: type.mime }, customMetadata: { project_id: String(ctx.projectId) } });
  const write = f.source === 'step'
    ? ctx.env.DB.prepare('UPDATE formation_steps SET proof_file_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').bind(key, f.stepId, ctx.projectId)
    : ctx.env.DB.prepare('UPDATE entity_obligations SET proof_file_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND entity_id = (SELECT entity_id FROM projects WHERE id = ?)')
      .bind(key, numericId(id, 'obligation-'), ctx.projectId);
  try {
    await ctx.env.DB.batch([write, logRow(ctx, 'company-creation', id, 'build_proof_uploaded', 'Proof uploaded')]);
  } catch (e) {
    try { await files.delete(key); } catch { /* the object is unreferenced either way */ }
    throw e;
  }
  if (f.proofKey && f.proofKey.startsWith(proofPrefix(ctx.projectId))) {
    try { await files.delete(f.proofKey); } catch (e) { console.warn('[build records] old proof not deleted:', (e as Error)?.message); }
  }
  return { ok: true };
}
/** Open proof: one signed, single-use download, for a key under this venture's own prefix only. */
async function openProof(ctx: RecordContext, id: string): Promise<ActionResult> {
  const f = await filingOf(ctx, id);
  if (!f.proofKey || !f.proofKey.startsWith(proofPrefix(ctx.projectId))) refuse(404, 'This filing has no stored proof.');
  const { token, expires_at } = await mintDownloadToken(ctx.env, { key: f.proofKey, audience: `build-proof:${id}`, userId: ctx.user.id, ttlSec: 120 });
  return { ok: true, open: { url: `/api/files/dl/${token}`, expires_at } };
}

/**
 * Decision 5: Sync can be chosen for the caller's own mapped connection, or
 * for a kind with none mapped, whose choice waits in `sync_request`. Never
 * for Workspace, which has no connection row, or another member's connection.
 */
export function syncEditable(kind: string, stored: Any | null, userId: number): boolean {
  if (kind === 'workspace') return false;
  if (stored?.integration_id == null) return true;
  return Number(stored.owner_id) === Number(userId);
}
async function storedSystem(ctx: RecordContext, kind: string): Promise<Any | null> {
  return await ctx.env.DB.prepare(
    `SELECT s.integration_id, s.provider_key, s.used_by, s.feeds_json, s.sync_request, i.user_id AS owner_id, i.config_json
       FROM project_core_systems s LEFT JOIN integrations i ON i.id = s.integration_id WHERE s.project_id = ? AND s.kind = ?`,
  ).bind(ctx.projectId, kind).first<Any>() ?? null;
}
/** Choose connector's body: an empty connector keeps the mapping (decision 10), and Sync goes only where it may. */
async function editSystem(ctx: RecordContext, kind: string, editable: boolean, b: Body): Promise<ActionResult> {
  const out: Body = {};
  if (Object.hasOwn(b, 'used_by')) out.used_by = b.used_by === '' ? null : b.used_by;
  if (Object.hasOwn(b, 'feeds')) out.feeds = b.feeds === '' || b.feeds == null ? null : b.feeds;
  if (editable && b.sync != null && b.sync !== '') out.sync = b.sync;
  const choice = typeof b.connector === 'string' ? b.connector : '';
  if (choice.startsWith('uid:')) out.integration_uid = choice.slice(4);
  else if (choice.startsWith('provider:')) out.provider_key = choice.slice(9);
  else if (choice !== '') refuse(400, 'Choose a connector from the list');
  return viaRoute(ctx, putSystem, { kind }, out);
}

// ── Form options (#1695): the write gate, bound and bounded reads ────────────

const NONE_YET = 'None yet';
async function painThemes(ctx: RecordContext) {
  return { options: rowsOf(await ctx.env.DB.prepare('SELECT id, title FROM pain_groups WHERE project_id = ? ORDER BY lower(title), id LIMIT 200')
    .bind(ctx.projectId).all<Any>()).map(r => ({ value: String(r.id), label: r.title })), empty: NONE_YET };
}
async function hypothesisOptions(ctx: RecordContext) {
  return { options: rowsOf(await ctx.env.DB.prepare('SELECT id, code, claim FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY id LIMIT 200')
    .bind(ctx.projectId).all<Any>()).map(r => ({ value: String(r.id), label: r.code ? `${r.code} · ${r.claim}` : r.claim })), empty: NONE_YET };
}
const ownerOptions = async (ctx: RecordContext) => ({ options: await owners(ctx), empty: NONE_YET });
/** The venture's KPIs, read through `growKpis.ts`: the seven, then each custom KPI as `custom-<uid>`. */
async function kpiOptions(ctx: RecordContext) {
  const custom = await customKpis(ctx.env, ctx.projectId);
  return { options: [...KPI_KEYS.map(k => ({ value: k, label: KPI_LABEL[k] })), ...custom.map(k => ({ value: `${CUSTOM_PREFIX}${k.uid}`, label: k.label }))] };
}
/** Each feedback theme with its open, unlinked count: what Add item with that theme would link. */
async function feedbackThemes(ctx: RecordContext) {
  return { options: rowsOf(await ctx.env.DB.prepare(
    `SELECT theme, SUM(CASE WHEN status = 'open' AND roadmap_item_ref IS NULL THEN 1 ELSE 0 END) AS open_unlinked
       FROM product_feedback WHERE project_id = ? AND theme IS NOT NULL AND trim(theme) <> '' GROUP BY theme ORDER BY lower(theme) LIMIT 100`,
  ).bind(ctx.projectId).all<Any>()).map(r => ({ value: r.theme, label: r.theme, open_unlinked: Number(r.open_unlinked ?? 0) })), empty: NONE_YET };
}
async function roadmapItems(ctx: RecordContext) {
  return { options: rowsOf(await ctx.env.DB.prepare('SELECT id, objective, kanban_status FROM roadmap_okrs WHERE project_id = ? ORDER BY sort_order, id LIMIT 200')
    .bind(ctx.projectId).all<Any>()).map(r => ({ value: String(r.id), label: r.objective, column: COLUMN_LABEL[r.kanban_status] ?? null })), empty: NONE_YET };
}
/** The catalogue providers a kind can be connected to: `fitsKind`'s, less any `coming_soon` (the connect route refuses those). */
function catalogue(kind: SystemKind): Array<{ provider_key: string; display_name: string }> {
  return REGISTRY.filter(d => d.status !== 'coming_soon' && fitsKind(kind, d.key)).map(d => ({ provider_key: d.key, display_name: d.display_name }));
}

// ── Solution design and Prototype / MVP: one feature ─────────────────────────

/** Today's feature row, scoped to the venture. `ownedRow` has already run. */
async function featureRow(ctx: RecordContext, id: string): Promise<Any> {
  const row = await ctx.env.DB.prepare(
    `SELECT f.id, f.title, f.added_value, f.effort, f.scope, f.description, f.is_must_have, f.delivery_status, f.due_date,
            f.hypothesis_id, f.created_by, f.created_at, pg.title AS pain_theme, h.claim AS hypothesis, u.name AS owner
       FROM mvp_features f
       LEFT JOIN pain_groups pg ON pg.id = f.pain_group_id AND pg.project_id = f.project_id
       LEFT JOIN hypotheses h ON h.id = f.hypothesis_id AND h.project_id = f.project_id
       LEFT JOIN users u ON u.id = f.owner_user_id
      WHERE f.id = ? AND f.project_id = ?`,
  ).bind(numericId(id), ctx.projectId).first<Any>();
  if (!row) throw new Error('Build feature vanished after its ownership check');
  return row;
}

/** Decision 2: Impact is added_value; Effort is effort (S, M, L; an old XL is High); a NULL scope reads from the tier. */
function featureLevels(f: Any): { impact: string | null; effort: string | null; outOfScope: boolean } {
  const impact = known(IMPACT_KEY, f.added_value), effort = known(EFFORT_KEY, f.effort);
  const outOfScope = f.scope === 'out' || (f.scope == null && impact === 'low');
  return { impact: impact ? LEVEL[impact] : f.added_value ?? null, effort: effort ? LEVEL[effort] : f.effort ?? null, outOfScope };
}

const solutionDesign: ModuleSpec = {
  read: 'read', write: 'write', store: 'mvp_features',
  oldRows: { actions: ['build_feature_details_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const f = await featureRow(ctx, id);
    const { impact, effort, outOfScope } = featureLevels(f);
    const links = [f.pain_theme != null ? `Answers ${f.pain_theme}` : null, f.hypothesis != null ? `tests ${f.hypothesis}` : null].filter(Boolean) as string[];
    const sub = links.length ? links.join(' · ').replace(/^t/, 'T') : 'Links to nothing';
    return {
      title: f.title, sub,
      pills: [
        ...(links.length ? [] : [{ text: 'Links to nothing', tone: 'bad' }]),
        ...(impact ? [{ text: `${impact} impact`, tone: impact === 'High' ? 'ok' : 'grey' }] : []),
        ...(effort ? [{ text: `${effort} effort`, tone: 'grey' }] : []),
        ...(outOfScope ? [{ text: 'Out of scope', tone: 'grey' }] : []),
      ],
      facts: [
        fact('Pain theme', f.pain_theme, 'Not linked to a pain theme.'),
        fact('Hypothesis', f.hypothesis, 'Not linked to a hypothesis.'),
        fact('Impact', impact, 'No impact recorded.'),
        fact('Effort', effort, 'No effort recorded.'),
      ],
      createdBy: f.created_by ?? null, createdAt: f.created_at ?? null,
    };
  },
  sections: [
    { key: 'description', title: 'Description', async read(ctx, id) {
      const f = await featureRow(ctx, id);
      // Decision 12: the section's own action, so a description can be recorded.
      return typeof f.description === 'string' && f.description.trim() ? { rows: [{ a: f.description }], action: 'edit-description' } : { rows: [], empty: 'No description recorded.', action: 'edit-description' };
    } },
    { key: 'risks', title: 'Risks', async read(ctx, id) {
      const risks = rowsOf(await ctx.env.DB.prepare(
        `SELECT r.title, r.severity, u.name AS owner FROM venture_risks r LEFT JOIN users u ON u.id = r.owner_user_id
          WHERE r.feature_id = ? AND r.project_id = ? ORDER BY r.id`,
      ).bind(numericId(id), ctx.projectId).all<Any>());
      return { rows: risks.map(r => ({ a: r.title, b: r.owner ?? 'No owner', c: LEVEL[r.severity] ?? r.severity ?? 'Not recorded', tone: SEVERITY_TONE[r.severity] ?? 'grey' })),
        empty: 'No risks tied to this feature.' };
    } },
    { key: 'appears_in', title: 'Appears in', side: true, async read(ctx, id) {
      const f = await featureRow(ctx, id);
      const items = rowsOf(await ctx.env.DB.prepare(
        'SELECT id, objective, kanban_status FROM roadmap_okrs WHERE project_id = ? AND feature_id = ? ORDER BY sort_order, id',
      ).bind(ctx.projectId, f.id).all<Any>());
      const rows: Row[] = [];
      if (Number(f.is_must_have) === 1) rows.push({ a: 'Prototype / MVP', b: 'Must-have', href: recordHref('prototype-mvp', f.id, ctx.projectId) });
      for (const item of items) rows.push({ a: 'Roadmap', b: `${item.objective} · ${COLUMN_LABEL[item.kanban_status] ?? 'No column'}`, href: recordHref('product-roadmap', item.id, ctx.projectId) });
      return { rows, empty: 'Not on the MVP or the roadmap.', action: 'add-to-roadmap' };
    } },
    { key: 'brief', title: 'Brief', side: true, async read() { return notRecorded('No brief is stored for a feature.'); } },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const f = await featureFields(ctx, id), featureId = numericId(id), feature = { id: String(featureId) };
    const { outOfScope } = featureLevels(f);
    const people = await owners(ctx);
    const actions: RecordAction[] = [
      { key: 'add-risk', label: 'Add a risk', kind: 'form',
        form: { title: 'Add a risk', cta: 'Add', fields: [
          { key: 'title', label: 'Risk', kind: 'T', required: true },
          { key: 'severity', label: 'Severity', kind: 'CH', required: true, options: SEVERITY_OPTIONS },
          { key: 'owner_user_id', label: 'Owner', kind: 'CH', options: people },
          { key: 'mitigation', label: 'Mitigation', kind: 'T' },
        ] },
        execute: (c, _id, body) => viaRoute(c, postRisk, {}, { ...formBody(jsonOf(body), ['title', 'severity', 'owner_user_id', 'mitigation'], ['owner_user_id', 'mitigation']), feature_id: featureId }) },
      // Decision 12: a description and Appears in could never fill without these.
      { key: 'edit-description', label: 'Edit description', kind: 'form',
        form: { title: 'Edit description', cta: 'Save', fields: [{ key: 'description', label: 'Description', kind: 'T', value: f.description ?? '' }] },
        execute: (c, _id, body) => viaRoute(c, patchFeature, feature, formBody(jsonOf(body), ['description'], ['description'])) },
      outOfScope
        ? { key: 'scope-in', label: 'Move into scope', kind: 'write', execute: c => viaRoute(c, patchFeature, feature, { scope: 'core' }) }
        : { key: 'scope-out', label: 'Move out of scope', kind: 'write', execute: c => viaRoute(c, patchFeature, feature, { scope: 'out' }) },
      { key: 'add-to-roadmap', label: 'Add to roadmap', kind: 'form',
        form: { title: 'Add item', cta: 'Add', foot: 'Issues from a connected GitHub repository land here too.',
          fields: itemFields({ title: f.title, column: 'next', owners: people }, COLUMN_OPTIONS) },
        execute: (c, _id, body) => viaRoute(c, postRoadmap, {}, { ...formBody(jsonOf(body), ITEM_KEYS, ITEM_CLEARABLE), feature_id: featureId }) },
    ];
    if (Number(f.is_must_have) !== 1) {
      actions.push({ key: 'mark-must-have', label: 'Mark as must-have', kind: 'write', execute: c => viaRoute(c, patchFeature, feature, { is_must_have: true }) });
    }
    actions.push({ key: 'edit', label: 'Edit', kind: 'form',
      form: { title: 'Edit feature', cta: 'Save', fields: [
        { key: 'title', label: 'Feature', kind: 'T', required: true, value: f.title },
        { key: 'description', label: 'Description', kind: 'T', value: f.description ?? '' },
        { key: 'pain_group_id', label: 'Pain theme', kind: 'CH', value: idValue(f.pain_group_id) },
        { key: 'hypothesis_id', label: 'Hypothesis', kind: 'CH', value: idValue(f.hypothesis_id) },
        { key: 'impact', label: 'Impact', kind: 'CH', options: withCurrent(IMPACT_OPTIONS, f.added_value), value: f.added_value ?? '' },
        { key: 'effort', label: 'Effort', kind: 'CH', options: withCurrent(EFFORT_OPTIONS, f.effort, f.effort === 'XL' ? 'High (XL)' : undefined), value: f.effort ?? '' },
        { key: 'scope', label: 'Scope', kind: 'CH', options: SCOPE_OPTIONS, value: f.scope ?? '' },
      ] },
      references: body => references(body, [['pain_group_id', 'pain_groups'], ['hypothesis_id', 'hypotheses']]),
      execute: (c, _id, body) => viaRoute(c, patchFeature, feature,
        formBody(jsonOf(body), ['title', 'description', 'pain_group_id', 'hypothesis_id', 'impact', 'effort', 'scope'], ['description', 'pain_group_id', 'hypothesis_id', 'scope'])) });
    return actions;
  },
  async formOptions(ctx) {
    return { pain_group_id: await painThemes(ctx), hypothesis_id: await hypothesisOptions(ctx),
      impact: { options: IMPACT_OPTIONS }, effort: { options: EFFORT_OPTIONS }, scope: { options: SCOPE_OPTIONS } };
  },
};

/** Decision 7's "#<n>" of a GitHub ledger key, `issue:<owner>/<repo>#<n>` or `pull:...`. */
function ledgerLabel(ref: string): string | null {
  const m = /^(issue|pull):[^#]+#(\d+)$/.exec(ref);
  return m ? `${m[1] === 'issue' ? 'issue' : 'pull request'} #${m[2]}` : null;
}

const prototypeMvp: ModuleSpec = {
  read: 'read', write: 'write', store: 'mvp_must_haves',
  // Decision 15: a feature and its must-have show one history.
  activityType: 'build.solution-design',
  oldRows: { actions: ['build_feature_details_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const f = await featureRow(ctx, id);
    const state = known(MUST_KEY, f.delivery_status);
    const done = await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM mvp_test_sessions WHERE feature_id = ? AND project_id = ? AND status = 'done'",
    ).bind(f.id, ctx.projectId).first<{ n: number }>();
    const due = dateText(f.due_date);
    const sub = [f.hypothesis != null ? `Tests ${f.hypothesis}` : null, due ? `due ${due}` : null].filter(Boolean).join(' · ').replace(/^d/, 'D');
    return {
      title: f.title, sub: sub || 'No hypothesis or due date recorded',
      pills: state ? [{ text: MUST_LABEL[state], tone: MUST_TONE[state] }] : f.delivery_status ? [String(f.delivery_status)] : [],
      facts: [
        fact('Owner', f.owner, 'No owner recorded.'),
        fact('Due', due, 'No due date recorded.'),
        fact('Hypothesis', f.hypothesis, 'Not linked to a hypothesis.'),
        fact('Tests run', Number(done?.n ?? 0) || null, 'No test session is done yet.'),
      ],
      createdBy: f.created_by ?? null, createdAt: f.created_at ?? null,
    };
  },
  sections: [
    { key: 'sessions', title: 'Test sessions', async read(ctx, id) {
      const sessions = rowsOf(await ctx.env.DB.prepare(
        `SELECT s.title, s.held_on, s.status, (SELECT COUNT(*) FROM mvp_test_findings t WHERE t.session_id = s.id) AS findings
           FROM mvp_test_sessions s WHERE s.feature_id = ? AND s.project_id = ? ORDER BY s.held_on IS NULL, s.held_on, s.id`,
      ).bind(numericId(id), ctx.projectId).all<Any>());
      return { rows: sessions.map(s => {
        const on = dateText(s.held_on);
        return { a: on ? `${s.title} · ${on}` : s.title, b: plural(Number(s.findings), 'finding'),
          c: s.status === 'done' ? 'Done' : 'Planned', tone: s.status === 'done' ? 'ok' : 'grey' };
      }), empty: 'No test sessions yet.' };
    } },
    { key: 'findings', title: 'Findings', async read(ctx, id) {
      const findings = rowsOf(await ctx.env.DB.prepare(
        `SELECT t.text, t.direction, t.kept, h.claim AS hypothesis
           FROM mvp_test_findings t JOIN mvp_test_sessions s ON s.id = t.session_id
           LEFT JOIN hypotheses h ON h.id = t.hypothesis_id AND h.project_id = s.project_id
          WHERE s.feature_id = ? AND s.project_id = ? ORDER BY t.id`,
      ).bind(numericId(id), ctx.projectId).all<Any>());
      return { rows: findings.map(t => ({ a: t.text, b: t.hypothesis != null ? `${t.direction} ${t.hypothesis}` : t.direction,
        c: Number(t.kept) === 1 ? 'Kept' : 'Flagged', tone: Number(t.kept) === 1 ? 'ok' : 'bad' })), empty: 'No findings yet.' };
    } },
    { key: 'linked', title: 'Linked', side: true, async read(ctx, id) {
      // Decision 7: the attached URLs. A GitHub link reads synced when this
      // venture's ledger holds its key; a must-have the GitHub sync made also
      // shows its pull request from the ledger.
      const links = rowsOf(await ctx.env.DB.prepare(
        `SELECT l.kind, l.url, l.external_ref, ledger.last_seen_at
           FROM mvp_feature_links l
           LEFT JOIN connector_fed_items ledger ON ledger.external_id = l.external_ref AND ledger.project_id = ?
          WHERE l.feature_id = ? ORDER BY l.id`,
      ).bind(ctx.projectId, numericId(id)).all<Any>());
      const pulls = rowsOf(await ctx.env.DB.prepare(
        `SELECT external_id, last_seen_at FROM connector_fed_items
          WHERE project_id = ? AND local_table = 'mvp_features' AND local_id = ? AND kind = 'pull_request' ORDER BY id`,
      ).bind(ctx.projectId, numericId(id)).all<Any>());
      const rows: Row[] = links.map(l => {
        if (l.kind === 'figma') return { a: 'Figma', b: 'Sync not recorded: Figma’s connector is not built', href: l.url };
        const label = (l.external_ref && ledgerLabel(l.external_ref)) || 'link';
        const synced = l.last_seen_at ? dateText(l.last_seen_at) : null;
        return { a: 'GitHub', b: synced ? `${label} · synced ${synced}` : `${label} · Not synced`, href: l.url };
      });
      const attached = new Set(links.map(l => l.external_ref).filter(Boolean));
      for (const p of pulls) {
        if (attached.has(p.external_id)) continue;
        const synced = dateText(p.last_seen_at);
        rows.push({ a: 'GitHub', b: `${ledgerLabel(p.external_id) ?? 'pull request'}${synced ? ` · synced ${synced}` : ''}` });
      }
      return { rows, empty: 'No design or code linked.' };
    } },
    { key: 'release', title: 'Release checklist', side: true, async read(ctx, id) {
      const checks = rowsOf(await ctx.env.DB.prepare(
        'SELECT label, done_at FROM mvp_release_checks WHERE feature_id = ? ORDER BY id',
      ).bind(numericId(id)).all<Any>());
      if (!checks.length) return { rows: [], empty: 'No release checks yet.', action: 'add-check' };
      const done = checks.filter(k => k.done_at).length;
      return { rows: [{ a: 'Done', b: `${done} of ${checks.length}` },
        ...checks.map(k => ({ a: k.label, c: k.done_at ? 'Done' : 'Open', tone: k.done_at ? 'ok' : 'grey' }))], action: 'add-check' };
    } },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const f = await featureFields(ctx, id), featureId = numericId(id), feature = { id: String(featureId) };
    const people = await owners(ctx);
    const sessions = rowsOf(await ctx.env.DB.prepare('SELECT id, title FROM mvp_test_sessions WHERE feature_id = ? AND project_id = ? ORDER BY id')
      .bind(featureId, ctx.projectId).all<Any>());
    const checks = rowsOf(await ctx.env.DB.prepare('SELECT id, label, done_at FROM mvp_release_checks WHERE feature_id = ? ORDER BY id').bind(featureId).all<Any>());
    const actions: RecordAction[] = [
      { key: 'add-session', label: 'Add a session', kind: 'form',
        form: { title: 'Add a session', cta: 'Add', fields: [
          { key: 'title', label: 'Session', kind: 'T', required: true },
          { key: 'held_on', label: 'Date', kind: 'T', input: 'date' },
          { key: 'owner_user_id', label: 'Owner', kind: 'CH', options: people },
          { key: 'status', label: 'Status', kind: 'CH', options: optionsOf({ planned: 'Planned', done: 'Done' }), value: 'planned' },
        ] },
        execute: (c, _id, body) => addSession(c, featureId, jsonOf(body)) },
    ];
    if (sessions.length) {
      actions.push({ key: 'add-finding', label: 'Add a finding', kind: 'form',
        form: { title: 'Add a finding', cta: 'Add', fields: [
          { key: 'session_id', label: 'Session', kind: 'CH', required: true, options: sessions.map(x => ({ value: String(x.id), label: x.title })) },
          { key: 'text', label: 'Finding', kind: 'T', required: true },
          { key: 'hypothesis_id', label: 'Hypothesis', kind: 'CH' },
          { key: 'direction', label: 'Direction', kind: 'CH', options: optionsOf({ supports: 'Supports', contradicts: 'Contradicts' }), value: 'supports' },
          { key: 'kept', label: 'Kept', kind: 'CK', value: true },
        ] },
        references: body => references(body, [['session_id', 'mvp_test_sessions'], ['hypothesis_id', 'hypotheses']]),
        execute: (c, _id, body) => addFinding(c, featureId, jsonOf(body)) });
    }
    actions.push(
      { key: 'link', label: 'Link', kind: 'form',
        form: { title: 'Link a design or issue', cta: 'Link', fields: [{ key: 'url', label: 'Figma or GitHub URL', kind: 'T', required: true, placeholder: 'https://' }] },
        execute: (c, _id, body) => addLink(c, featureId, jsonOf(body)) },
      // Decision 12: Release checklist could never fill without it.
      { key: 'add-check', label: 'Add a check', kind: 'form',
        form: { title: 'Add a check', cta: 'Add', fields: [{ key: 'label', label: 'Check', kind: 'T', required: true }] },
        execute: (c, _id, body) => addCheck(c, featureId, jsonOf(body)) },
    );
    if (checks.length) {
      actions.push({ key: 'check', label: 'Check', kind: 'form',
        form: { title: 'Mark a check', cta: 'Save', fields: [
          { key: 'check_id', label: 'Check', kind: 'CH', required: true, options: checks.map(k => ({ value: String(k.id), label: k.label })) },
          { key: 'done', label: 'Done', kind: 'CK', value: true },
        ] },
        references: body => references(body, [['check_id', 'mvp_release_checks']]),
        execute: (c, _id, body) => setCheck(c, featureId, jsonOf(body)) });
    }
    if (f.delivery_status !== 'Blocked' && f.delivery_status !== 'Done') {
      actions.push({ key: 'mark-blocked', label: 'Mark blocked', kind: 'write', execute: c => viaRoute(c, patchFeature, feature, { state: 'Blocked' }) });
    }
    if (f.delivery_status !== 'Done') {
      actions.push({ key: 'mark-done', label: 'Mark done', kind: 'write', tone: 'primary', execute: c => viaRoute(c, patchFeature, feature, { state: 'Done' }) });
    }
    actions.push({ key: 'edit', label: 'Edit', kind: 'form',
      form: { title: 'Edit must-have', cta: 'Save', fields: [
        { key: 'title', label: 'Must-have', kind: 'T', required: true, value: f.title },
        { key: 'hypothesis_id', label: 'Hypothesis', kind: 'CH', value: idValue(f.hypothesis_id) },
        { key: 'state', label: 'State', kind: 'CH', options: withCurrent(STATE_OPTIONS, f.delivery_status, f.delivery_status === 'Review' ? 'In review' : undefined), value: f.delivery_status ?? '' },
        { key: 'owner_user_id', label: 'Owner', kind: 'CH', options: people, value: idValue(f.owner_user_id) },
        { key: 'due_date', label: 'Due', kind: 'T', input: 'date', value: f.due_date ?? '' },
      ] },
      references: body => references(body, [['hypothesis_id', 'hypotheses']]),
      execute: (c, _id, body) => viaRoute(c, patchFeature, feature,
        formBody(jsonOf(body), ['title', 'hypothesis_id', 'state', 'owner_user_id', 'due_date'], ['hypothesis_id', 'owner_user_id', 'due_date'])) });
    return actions;
  },
  async formOptions(ctx) {
    return { hypothesis_id: await hypothesisOptions(ctx), owner_user_id: await ownerOptions(ctx), state: { options: STATE_OPTIONS } };
  },
};

// ── Product roadmap: one item ────────────────────────────────────────────────

async function roadmapRow(ctx: RecordContext, id: string): Promise<Any> {
  const row = await ctx.env.DB.prepare(
    `SELECT o.id, o.objective, o.kanban_status, o.kpi_key, o.feedback_theme, o.target_date, o.created_by, o.created_at, u.name AS owner
       FROM roadmap_okrs o LEFT JOIN users u ON u.id = o.owner_user_id WHERE o.id = ? AND o.project_id = ?`,
  ).bind(numericId(id), ctx.projectId).first<Any>();
  if (!row) throw new Error('Build roadmap item vanished after its ownership check');
  return row;
}

const productRoadmap: ModuleSpec = {
  read: 'read', write: 'write', store: 'roadmap_okrs',
  oldRows: { actions: ['build_roadmap_details_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const o = await roadmapRow(ctx, id);
    const column = COLUMN_LABEL[o.kanban_status] ?? null;
    const sub = [column, o.kpi_key ? `moves ${o.kpi_key}` : null, o.owner ? `owner ${o.owner}` : null].filter(Boolean).join(' · ');
    return {
      title: o.objective, sub: sub || 'No column, KPI or owner recorded',
      pills: column ? [{ text: column, tone: 'vio' }] : [],
      facts: [
        fact('Column', column, 'No column recorded.'),
        fact('Moves', o.kpi_key, 'No KPI recorded.'),
        fact('Answers', o.feedback_theme, 'No feedback theme recorded.'),
        fact('Date', dateText(o.target_date), 'No date recorded.'),
      ],
      createdBy: o.created_by ?? null, createdAt: o.created_at ?? null,
    };
  },
  sections: [
    { key: 'dependencies', title: 'Dependencies', async read(ctx, id) {
      // Decision 4: "Waits on X" is an edge from X (okr_id) to this item (blocks_okr_id).
      const n = numericId(id);
      const edges = rowsOf(await ctx.env.DB.prepare(
        `SELECT CASE WHEN d.blocks_okr_id = ? THEN 'waits' ELSE 'blocks' END AS way, o.id, o.objective, o.kanban_status
           FROM okr_dependencies d
           JOIN roadmap_okrs o ON o.id = CASE WHEN d.blocks_okr_id = ? THEN d.okr_id ELSE d.blocks_okr_id END AND o.project_id = d.project_id
          WHERE d.project_id = ? AND (d.blocks_okr_id = ? OR d.okr_id = ?) ORDER BY way DESC, d.id`,
      ).bind(n, n, ctx.projectId, n, n).all<Any>());
      return { rows: edges.map(e => {
        const column = COLUMN_LABEL[e.kanban_status] ?? 'No column';
        const href = recordHref('product-roadmap', e.id, ctx.projectId);
        if (e.way === 'blocks') return { a: `Blocks ${e.objective}`, b: column, href };
        const done = e.kanban_status === 'done';
        return { a: `Waits on ${e.objective}`, b: column, c: done ? 'Done' : 'Open', tone: done ? 'ok' : 'amb', href };
      }), empty: 'No dependencies.' };
    } },
    { key: 'feedback', title: 'Feedback it answers', async read(ctx, id) {
      // The sender's name and date only: the email is never read.
      const feedback = rowsOf(await ctx.env.DB.prepare(
        `SELECT body, from_name, theme, created_at FROM product_feedback
          WHERE project_id = ? AND roadmap_item_ref = ? ORDER BY created_at DESC, id DESC LIMIT 20`,
      ).bind(ctx.projectId, String(numericId(id))).all<Any>());
      return { rows: feedback.map(f => ({ a: `“${f.body}”`, b: [f.from_name || 'Unnamed', dateText(f.created_at)].filter(Boolean).join(' · '),
        ...(f.theme ? { c: f.theme, tone: 'vio' } : {}) })), empty: 'No feedback answered by this item.' };
    } },
    { key: 'github', title: 'GitHub', side: true, async read(ctx, id) {
      const issue = await ctx.env.DB.prepare(
        `SELECT external_id, last_seen_at FROM connector_fed_items
          WHERE project_id = ? AND local_table = 'roadmap_okrs' AND local_id = ? AND kind = 'issue' ORDER BY id DESC LIMIT 1`,
      ).bind(ctx.projectId, numericId(id)).first<Any>();
      if (!issue) return notRecorded('No GitHub issue is synced to this item.');
      const label = ledgerLabel(issue.external_id) ?? 'issue';
      const synced = dateText(issue.last_seen_at);
      // D782 (#2111): the issue's milestone and the release that shipped the item.
      let gh: Any | null | undefined;
      try {
        gh = await ctx.env.DB.prepare(
          `SELECT o.milestone_title, o.milestone_due, r.tag, r.published_at, r.url
             FROM roadmap_okrs o LEFT JOIN roadmap_releases r ON r.id = o.shipped_release_id AND r.project_id = o.project_id
            WHERE o.id = ? AND o.project_id = ?`,
        ).bind(numericId(id), ctx.projectId).first<Any>();
      } catch { gh = undefined; }
      const due = dateText(gh?.milestone_due);
      const shipped = dateText(gh?.published_at);
      return { rows: [{ a: label.replace(/^i/, 'I'), b: synced ? `synced ${synced}` : 'Not synced' },
        { a: 'State', b: 'Not recorded: the sync stores no issue state.', tone: 'grey' },
        gh === undefined ? { a: 'Milestone', b: 'Unreadable', tone: 'grey' }
          : gh?.milestone_title ? { a: 'Milestone', b: due ? `${gh.milestone_title} · due ${due}` : gh.milestone_title } : { a: 'Milestone', b: 'In no milestone', tone: 'grey' },
        gh === undefined ? { a: 'Shipped', b: 'Unreadable', tone: 'grey' }
          : gh?.tag ? { a: 'Shipped', b: shipped ? `${gh.tag} · ${shipped}` : gh.tag, ...(gh.url ? { href: gh.url } : {}) }
            : { a: 'Shipped', b: 'Not shipped: no release names it or closes it.', tone: 'grey' }] };
    } },
    { key: 'public', title: 'Public roadmap', side: true, async read() { return notRecorded('Ventures have no public roadmap page.'); } },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const itemId = numericId(id), item = { id: String(itemId) };
    const o = await ctx.env.DB.prepare(
      'SELECT objective, kanban_status, kpi_key, feedback_theme, owner_user_id, target_date, feature_id FROM roadmap_okrs WHERE id = ? AND project_id = ?',
    ).bind(itemId, ctx.projectId).first<Any>();
    if (!o) throw new Error('Build roadmap item vanished after its ownership check');
    const others = rowsOf(await ctx.env.DB.prepare('SELECT id, objective FROM roadmap_okrs WHERE project_id = ? AND id <> ? ORDER BY sort_order, id LIMIT 200')
      .bind(ctx.projectId, itemId).all<Any>()).map(x => ({ value: String(x.id), label: x.objective }));
    const actions: RecordAction[] = [];
    if (others.length) {
      actions.push({ key: 'add-dependency', label: 'Add', kind: 'form',
        form: { title: 'Add a dependency', cta: 'Add', sub: 'Choose one: an item this waits on, or one it blocks.', fields: [
          { key: 'waits_on_id', label: 'Waits on', kind: 'CH', options: others },
          { key: 'blocks_id', label: 'Blocks', kind: 'CH', options: others },
        ] },
        references: body => references(body, [['waits_on_id', 'roadmap_okrs'], ['blocks_id', 'roadmap_okrs']]),
        execute: (c, _id, body) => addDependency(c, itemId, jsonOf(body)) });
    }
    // "Move to <column>" names the column after the item's own (Now → Next → Later → Now); a Done item offers none.
    const to = known(NEXT_COLUMN, o.kanban_status);
    if (to) {
      actions.push({ key: 'move', label: `Move to ${COLUMN_LABEL[to]}`, kind: 'form', tone: 'primary',
        form: { title: 'Move', cta: 'Move', fields: [{ key: 'to', label: 'Column', kind: 'CH', required: true, value: to,
          options: optionsOf(COLUMN_LABEL).filter(c => c.value !== o.kanban_status) }] },
        execute: (c, _id, body) => {
          const target = jsonOf(body).to;
          if (typeof target !== 'string' || !Object.hasOwn(COLUMN_LABEL, target) || target === o.kanban_status) refuse(400, 'Choose another column');
          return viaRoute(c, patchRoadmap, item, { column: target });
        } });
    }
    // Edit reopens a Done item, so its columns include Done.
    actions.push({ key: 'edit', label: 'Edit', kind: 'form',
      form: { title: 'Edit item', cta: 'Save', fields: [
        ...itemFields({ title: o.objective, column: o.kanban_status, kpi_key: o.kpi_key, feedback_theme: o.feedback_theme,
          owner_user_id: o.owner_user_id, target_date: o.target_date, owners: await owners(ctx) }, withCurrent(optionsOf(COLUMN_LABEL), o.kanban_status)),
        { key: 'feature_id', label: 'Feature', kind: 'CH', value: idValue(o.feature_id) },
      ] },
      references: body => references(body, [['feature_id', 'mvp_features']]),
      execute: (c, _id, body) => viaRoute(c, patchRoadmap, item, formBody(jsonOf(body), [...ITEM_KEYS, 'feature_id'], ITEM_CLEARABLE)) });
    return actions;
  },
  async formOptions(ctx) {
    const items = await roadmapItems(ctx);
    return { kpi_key: await kpiOptions(ctx), feedback_theme: await feedbackThemes(ctx), waits_on_id: items, blocks_id: items,
      owner_user_id: await ownerOptions(ctx), column: { options: COLUMN_OPTIONS } };
  },
};

// ── Founding team: one founder ───────────────────────────────────────────────

/**
 * Vesting belongs to a holder, but its own row is user-keyed. Both keys must
 * agree, so a founder's other company's schedule is never joined. A read only.
 */
async function founderRow(ctx: RecordContext, id: string): Promise<Any> {
  const row = await ctx.env.DB.prepare(
    `SELECT h.id, h.user_id, h.name, h.founder_role, h.ownership_pct, h.shares, h.security_type, h.kind, h.created_at,
            v.start_date, v.cliff_months, v.total_months, v.vested_shares
       FROM cap_table_holders h
       LEFT JOIN cap_table_vesting v ON v.holder_id = h.id AND v.user_id = h.user_id
      WHERE h.project_id = ? AND h.id = ? AND h.founder_role IS NOT NULL`,
  ).bind(ctx.projectId, numericId(id, 'h-')).first<Any>();
  if (!row) throw new Error('Build founder vanished after its ownership check');
  return row;
}

async function agreementOf(ctx: RecordContext, userId: unknown): Promise<Any | null> {
  if (userId == null) return null;
  return await ctx.env.DB.prepare(
    `SELECT d.status, d.signed_at, d.created_at FROM documents d
       JOIN cofounder_agreement_parties party ON party.document_id = d.id
      WHERE d.project_id = ? AND d.template_name = 'cofounder_agreement' AND party.user_id = ?
      ORDER BY d.created_at DESC, d.id DESC LIMIT 1`,
  ).bind(ctx.projectId, userId).first<Any>() ?? null;
}

/** Stored vested shares over shares when recorded; else the schedule: 0 before the cliff, then months elapsed over total. */
function vestedToday(h: Any): string | null {
  if (h.vested_shares != null && Number(h.shares) > 0) return percent(Math.min(100, 100 * Number(h.vested_shares) / Number(h.shares)));
  const start = dateOnly(h.start_date), total = Number(h.total_months);
  if (!start || !Number.isFinite(total) || total <= 0) return null;
  const elapsed = monthsBetween(start, todayUtc());
  if (elapsed < Number(h.cliff_months ?? 0) || elapsed < 0) return '0%';
  return percent(Math.min(100, 100 * elapsed / total));
}

function vestingText(h: Any): string | null {
  const start = dateOnly(h.start_date);
  if (!start) return null;
  const total = h.total_months == null ? null : Number(h.total_months), cliff = h.cliff_months == null ? null : Number(h.cliff_months);
  const years = total != null && Number.isFinite(total) && total > 0 ? Math.round(total / 12 * 100) / 100 : null;
  const length = years == null ? 'length not recorded' : `${years} ${years === 1 ? 'year' : 'years'}`;
  const cliffText = cliff == null || !Number.isFinite(cliff) ? 'cliff not recorded' : cliff === 0 ? 'no cliff' : `cliff ${longDate(addMonths(start, cliff))}`;
  return `${length} · ${cliffText}`;
}

const foundingTeam: ModuleSpec = {
  read: 'read', write: 'write', store: 'cap_table_founders',
  oldRows: { actions: ['build_founder_role_changed'], idWithoutPrefix: 'h-' },
  async record(ctx, id): Promise<RecordContent> {
    const h = await founderRow(ctx, id);
    const agreement = await agreementOf(ctx, h.user_id);
    const equity = h.ownership_pct == null ? null : percent(Number(h.ownership_pct));
    const since = dateText(h.start_date);
    const sub = [h.founder_role, equity, since ? `vesting since ${since}` : null].filter(Boolean).join(' · ');
    return {
      title: h.name, sub: sub || 'No role, equity or vesting recorded',
      pills: agreement == null ? [] : agreement.status === 'signed' ? [{ text: 'Agreement signed', tone: 'ok' }] : [{ text: 'Agreement awaiting', tone: 'amb' }],
      facts: [
        fact('Role', h.founder_role, 'No role recorded.'),
        fact('Equity', equity, 'No ownership percentage recorded.'),
        fact('Vesting', vestingText(h), 'No vesting schedule recorded.'),
        fact('Vested today', vestedToday(h), 'No vesting schedule recorded.'),
      ],
      createdAt: h.created_at ?? null,
    };
  },
  sections: [
    { key: 'timeline', title: 'Vesting timeline', async read(ctx, id) {
      const h = await founderRow(ctx, id);
      const start = dateOnly(h.start_date);
      if (!start) return notRecorded('No vesting schedule recorded.');
      const today = todayUtc();
      const point = (label: string, months: unknown): Row | null => {
        const n = months == null ? NaN : Number(months);
        if (!Number.isFinite(n) || n < 0) return { a: label, b: 'Not recorded' };
        const at = addMonths(start, n);
        return { a: label, b: longDate(at), c: at > today ? 'Upcoming' : 'Passed', tone: at > today ? 'grey' : 'ok' };
      };
      return { rows: [Number(h.cliff_months) === 0 ? null : point('Cliff', h.cliff_months), point('Fully vested', h.total_months)].filter(Boolean) as Row[] };
    } },
    { key: 'contributions', title: 'Contributions', async read(ctx, id) {
      const list = rowsOf(await ctx.env.DB.prepare(
        'SELECT text, on_date FROM founder_contributions WHERE project_id = ? AND holder_id = ? ORDER BY on_date IS NULL, on_date DESC, id DESC',
      ).bind(ctx.projectId, numericId(id, 'h-')).all<Any>());
      return { rows: list.map(k => ({ a: k.text, ...(dateText(k.on_date) ? { b: dateText(k.on_date)! } : {}) })), empty: 'No contributions logged yet.' };
    } },
    { key: 'documents', title: 'Documents', side: true, gate: 'write', async read(ctx, id) {
      const h = await founderRow(ctx, id);
      const rows: Row[] = [];
      const agreement = await agreementOf(ctx, h.user_id);
      if (agreement) {
        const on = dateText(agreement.status === 'signed' ? agreement.signed_at ?? agreement.created_at : agreement.created_at);
        rows.push({ a: 'Co-founder agreement', b: [agreement.status === 'signed' ? 'Signed' : 'Awaiting', on].filter(Boolean).join(' · ') });
      }
      const election = await ctx.env.DB.prepare(
        "SELECT id, due_date, state FROM formation_steps WHERE project_id = ? AND kind = '83b' AND for_holder_id = ? ORDER BY id DESC LIMIT 1",
      ).bind(ctx.projectId, h.id).first<Any>();
      if (election) {
        const due = dateText(election.due_date);
        rows.push({ a: '83(b)', b: election.state === 'done' ? 'Filed' : due ? `Due ${due}` : 'No due date recorded',
          href: recordHref('company-creation', `step-${election.id}`, ctx.projectId) });
      }
      return { rows, empty: 'No documents recorded.' };
    } },
    { key: 'cap_table', title: 'Cap table', side: true, async read(ctx, id) {
      const h = await founderRow(ctx, id);
      const kind = String(h.security_type ?? h.kind ?? 'Shares');
      return { rows: [{ a: kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' '),
        b: h.shares == null ? 'Shares not recorded' : `${Number(h.shares).toLocaleString('en-US')} shares` }] };
    } },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    const holderId = numericId(id, 'h-');
    const h = await ctx.env.DB.prepare(
      `SELECT h.id, h.name, h.email, h.founder_role, h.ownership_pct, v.start_date, v.total_months, v.cliff_months
         FROM cap_table_holders h LEFT JOIN cap_table_vesting v ON v.holder_id = h.id AND v.user_id = h.user_id
        WHERE h.project_id = ? AND h.id = ?`,
    ).bind(ctx.projectId, holderId).first<Any>();
    if (!h) throw new Error('Build founder vanished after its ownership check');
    return [
      { key: 'edit-split', label: 'Edit split', kind: 'link', href: '/raise/capital/cap-table' },
      { key: 'log-contribution', label: 'Log', kind: 'form',
        form: { title: 'Log a contribution', cta: 'Log', fields: [
          { key: 'text', label: 'Contribution', kind: 'T', required: true },
          { key: 'on_date', label: 'Date', kind: 'T', input: 'date' },
        ] },
        execute: (c, _id, body) => logContribution(c, holderId, jsonOf(body)) },
      // Decision 13: Add founder's fields, through the founders PATCH and its gate (decision 6).
      { key: 'edit', label: 'Edit', kind: 'form',
        form: { title: 'Edit founder', cta: 'Save', foot: 'Changes the unallocated share.', fields: [
          { key: 'name', label: 'Name', kind: 'T', required: true, value: h.name },
          { key: 'email', label: 'Email', kind: 'T', input: 'email', value: h.email ?? '' },
          { key: 'role', label: 'Role', kind: 'T', value: h.founder_role ?? '' },
          { key: 'equity_pct', label: 'Equity', kind: 'T', value: h.ownership_pct ?? '' },
          { key: 'vesting', label: 'Vesting', kind: 'CH', options: VESTING_OPTIONS, value: presetOf(h) },
          { key: 'vesting_start', label: 'Vesting start', kind: 'T', input: 'date', value: typeof h.start_date === 'string' ? h.start_date.slice(0, 10) : '' },
          { key: 'total_months', label: 'Total months', kind: 'T', value: h.total_months ?? '' },
          { key: 'cliff_months', label: 'Cliff months', kind: 'T', value: h.cliff_months ?? '' },
        ] },
        execute: (c, _id, body) => editFounder(c, h, jsonOf(body)) },
    ];
  },
  /** Decision 14: 100 less every holder's recorded percentage and the base scenario's pool; Not recorded with no percentage. */
  async formOptions(ctx) {
    const project = await writeProject(ctx.env, ctx.projectId);
    const recorded = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM cap_table_holders WHERE project_id = ? AND ownership_pct IS NOT NULL')
      .bind(ctx.projectId).first<{ n: number }>();
    const share = project && Number(recorded?.n ?? 0) > 0 ? await unallocated(ctx.env, project, null) : null;
    return { unallocated: share == null ? { value: null, reason: 'No ownership percentage recorded.' } : { value: share },
      vesting: { options: VESTING_OPTIONS } };
  },
};

// ── Company creation: one filing (step-, obligation- or lab-) ────────────────

type Filing = {
  source: 'step' | 'obligation' | 'lab';
  title: string; kind: string | null; jurisdiction: string | null; due: string | null; date?: string | null;
  done: boolean; proofKey: string | null; status?: string; forHolderId?: number | null; stepId?: number;
  createdBy?: number | null; createdAt?: string | null;
  lab?: Array<{ label: string; date: string | null }>;
};

async function filingOf(ctx: RecordContext, id: string): Promise<Filing> {
  const db = ctx.env.DB;
  if (id.startsWith('step-')) {
    const s = await db.prepare(
      'SELECT id, title, due_date, state, proof_file_key, kind, jurisdiction, for_holder_id, created_by, created_at FROM formation_steps WHERE id = ? AND project_id = ?',
    ).bind(numericId(id, 'step-'), ctx.projectId).first<Any>();
    if (s) return { source: 'step', title: s.title, kind: s.kind ?? null, jurisdiction: s.jurisdiction ?? null, due: s.due_date ?? null,
      done: s.state === 'done', proofKey: s.proof_file_key ?? null, forHolderId: s.for_holder_id ?? null, stepId: s.id,
      createdBy: s.created_by ?? null, createdAt: s.created_at ?? null };
  } else if (id.startsWith('obligation-')) {
    const o = await db.prepare(
      `SELECT o.title, o.due_date, o.status, o.proof_file_key, o.kind, o.created_at, e.jurisdiction
         FROM entity_obligations o JOIN entities e ON e.id = o.entity_id
         JOIN projects p ON p.entity_id = o.entity_id
        WHERE o.id = ? AND p.id = ?`,
    ).bind(numericId(id, 'obligation-'), ctx.projectId).first<Any>();
    if (o) return { source: 'obligation', title: o.title, kind: o.kind ?? null, jurisdiction: o.jurisdiction ?? null, due: o.due_date ?? null,
      done: false, status: o.status, proofKey: o.proof_file_key ?? null, createdAt: o.created_at ?? null };
  } else {
    const m = /^lab-(\d+)-([0-2])$/.exec(id);
    const order = m ? await db.prepare(
      'SELECT paid_at, packet_ready_at, filed_on, jurisdiction_id, created_at FROM incorporations WHERE id = ? AND project_id = ?',
    ).bind(Number(m[1]), ctx.projectId).first<Any>() : null;
    if (m && order) {
      const lab = [order.paid_at, order.packet_ready_at, order.filed_on].map((date, n) => ({ label: LAB_STEPS[n], date: date ?? null }));
      const step = lab[Number(m[2])];
      return { source: 'lab', title: step.label, kind: 'formation', jurisdiction: order.jurisdiction_id ?? null, due: step.date,
        date: step.date, done: !!step.date, proofKey: null, createdAt: order.created_at ?? null, lab };
    }
  }
  throw new Error('Build filing vanished after its ownership check');
}

/** Decision 8: Filed when done, Overdue past due, Due soon within 30 days, else Upcoming. */
function filingState(f: Filing): 'filed' | 'overdue' | 'due_soon' | 'upcoming' {
  if (f.done) return 'filed';
  const days = daysUntil(f.due);
  return days == null ? 'upcoming' : days < 0 ? 'overdue' : days <= 30 ? 'due_soon' : 'upcoming';
}
function filingLabel(f: Filing, state: string): string {
  if (state === 'filed') return f.kind === 'ein' && f.source === 'step' ? 'Issued' : 'Filed';
  if (state === 'overdue') return 'Overdue';
  if (state === 'upcoming') return 'Upcoming';
  const days = daysUntil(f.due)!;
  return days === 0 ? 'Due today' : `Due in ${plural(days, 'day')}`;
}
const proofStored = (key: string | null) => typeof key === 'string' && key.startsWith('build-proof/');

const companyCreation: ModuleSpec = {
  read: 'read', write: 'write', store: 'build_filings',
  // One prefix per spec (S1, 2026-10-17): an old obligation-proof row reads on
  // no record, since obligation 5 and step 5 can share a number.
  oldRows: { actions: ['build_formation_step_created', 'build_formation_step_changed'], idWithoutPrefix: 'step-' },
  async record(ctx, id): Promise<RecordContent> {
    const f = await filingOf(ctx, id);
    const state = filingState(f);
    const due = dateText(f.due), days = daysUntil(f.due);
    const sub = state === 'filed'
      ? (f.date && dateText(f.date) ? `${filingLabel(f, state)} ${dateText(f.date)}` : `${filingLabel(f, state)} · date not recorded`)
      : due && days != null
        ? `Due ${due} · ${days < 0 ? `${plural(-days, 'day')} overdue` : days === 0 ? 'due today' : `${plural(days, 'day')} left`}`
        : 'No due date recorded';
    const proof = typeof f.proofKey === 'string' && f.proofKey ? (proofStored(f.proofKey) ? 'Stored' : 'Key recorded') : null;
    return {
      title: f.title, sub,
      pills: [{ text: filingLabel(f, state), tone: FILING_TONE[state] }],
      facts: [
        fact('Filing', known(FILING_KIND, f.kind) ?? f.title, 'No filing kind recorded.'),
        fact('Jurisdiction', f.jurisdiction, 'No jurisdiction recorded.'),
        fact('Due', due, 'No due date recorded.'),
        fact('Proof', proof, f.source === 'lab' && f.done ? 'The Lab keeps this filing’s record.' : 'Not filed yet'),
      ],
      createdBy: f.createdBy ?? null, createdAt: f.createdAt ?? null,
    };
  },
  sections: [
    { key: 'steps', title: 'Steps', async read(ctx, id) {
      const f = await filingOf(ctx, id);
      if (f.source === 'lab') return { rows: f.lab!.map(s => ({ a: s.label, b: dateText(s.date) ?? '', c: s.date ? 'Done' : 'Open', tone: s.date ? 'ok' : 'grey' })) };
      const list = FILING_CHECKLIST[f.kind === '83b' || f.kind === 'ein' ? f.kind : 'other'];
      const checked = new Set(f.stepId == null ? [] : rowsOf(await ctx.env.DB.prepare(
        'SELECT key FROM formation_step_checks WHERE step_id = ? AND done_at IS NOT NULL',
      ).bind(f.stepId).all<{ key: string }>()).map(r => r.key));
      if (f.source === 'obligation' && f.status && f.status !== 'open') checked.add('submit');
      let firstOpen = true;
      return { rows: list.map(([key, label]) => {
        const done = key === 'proof' ? proofStored(f.proofKey) : checked.has(key);
        const tone = done ? 'ok' : firstOpen ? 'amb' : 'grey';
        if (!done) firstOpen = false;
        return { a: label, c: done ? 'Done' : 'Open', tone };
      }) };
    } },
    { key: 'reminders', title: 'Reminders', async read() { return notRecorded('No reminder is sent for filings.'); } },
    { key: 'linked', title: 'Linked', side: true, async read(ctx, id) {
      const f = await filingOf(ctx, id);
      const rows: Row[] = [];
      // Decision 9: a Lab row is read-only; its link is a row, not an action.
      if (f.source === 'lab') rows.push({ a: 'Incorporation', b: 'Open in the Legal engine', href: '/raise/legal-engine/incorporation' });
      if (f.forHolderId != null) {
        const holder = await ctx.env.DB.prepare(
          'SELECT id, name FROM cap_table_holders WHERE id = ? AND project_id = ? AND founder_role IS NOT NULL',
        ).bind(f.forHolderId, ctx.projectId).first<Any>();
        if (holder) rows.push({ a: 'Founder stock', b: holder.name, href: recordHref('founding-team', `h-${holder.id}`, ctx.projectId) });
      }
      if (canWrite(ctx.project, ctx.user)) {
        const docs = rowsOf(await ctx.env.DB.prepare(
          'SELECT title FROM documents WHERE project_id = ? AND title IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 5',
        ).bind(ctx.projectId).all<{ title: string }>());
        if (docs.length) rows.push({ a: 'Document vault', b: [...new Set(docs.map(d => d.title))].join(' · ') });
      }
      return { rows, empty: 'Nothing linked.' };
    } },
  ],
  // Decision 9: an obligation- row has Upload proof only (filing it is HQ's),
  // and a lab- row is read-only. Mark filed, the step checks and Edit are a step-'s.
  async actions(ctx, id): Promise<RecordAction[]> {
    const f = await filingOf(ctx, id);
    if (f.source === 'lab') return [];
    const actions: RecordAction[] = [];
    if (f.source === 'step') {
      const step = { id: String(f.stepId) };
      if (!f.done) actions.push({ key: 'mark-filed', label: 'Mark filed', kind: 'write', tone: 'primary', execute: c => viaRoute(c, patchFormationStep, step, { state: 'filed' }) });
      const checklist = FILING_CHECKLIST[f.kind === '83b' || f.kind === 'ein' ? f.kind : 'other'].filter(([key]) => key !== 'proof');
      actions.push({ key: 'step-check', label: 'Check a step', kind: 'form',
        form: { title: 'Check a step', cta: 'Save', fields: [
          { key: 'key', label: 'Step', kind: 'CH', required: true, options: checklist.map(([value, label]) => ({ value, label })) },
          { key: 'done', label: 'Done', kind: 'CK', value: true },
        ] },
        execute: (c, _id, body) => stepCheck(c, id, f.stepId!, checklist.map(([key]) => key), jsonOf(body)) });
      const step0 = await ctx.env.DB.prepare('SELECT state FROM formation_steps WHERE id = ? AND project_id = ?').bind(f.stepId, ctx.projectId).first<{ state: string }>();
      const state = step0?.state === 'done' ? 'filed' : step0?.state === 'doing' ? 'doing' : 'upcoming';
      actions.push({ key: 'edit', label: 'Edit', kind: 'form',
        form: { title: 'Edit filing', cta: 'Save', fields: [
          { key: 'title', label: 'Filing', kind: 'T', required: true, value: f.title },
          { key: 'kind', label: 'Kind', kind: 'CH', options: optionsOf(FILING_KIND), value: f.kind ?? '' },
          { key: 'jurisdiction', label: 'Jurisdiction', kind: 'CH', value: f.jurisdiction ?? '' },
          { key: 'for_holder_id', label: 'For', kind: 'CH', value: f.forHolderId == null ? '' : `h-${f.forHolderId}` },
          { key: 'due_date', label: 'Due', kind: 'T', input: 'date', value: f.due ?? '' },
          { key: 'state', label: 'State', kind: 'CH', options: withCurrent(FILING_STATE_OPTIONS, state, 'Doing'), value: state },
        ] },
        references: body => references(body, [['for_holder_id', 'cap_table_founders']]),
        execute: (c, _id, body) => viaRoute(c, patchFormationStep, step,
          formBody(jsonOf(body), ['title', 'kind', 'jurisdiction', 'for_holder_id', 'due_date', 'state'], ['kind', 'jurisdiction', 'for_holder_id', 'due_date'])) });
    }
    actions.push({ key: 'upload-proof', label: 'Upload proof', kind: 'form', multipart: true,
      form: { title: 'Upload proof', cta: 'Upload', fields: [{ key: 'file', label: 'Proof', kind: 'T', input: 'file', required: true, note: 'PDF, JPEG or PNG, at most 10 MB.' }] },
      execute: (c, _id, body) => uploadProof(c, id, f, body) });
    if (f.proofKey && f.proofKey.startsWith(proofPrefix(ctx.projectId))) {
      actions.push({ key: 'open-proof', label: 'Open proof', kind: 'write', execute: c => openProof(c, id) });
    }
    return actions;
  },
  async formOptions(ctx) {
    const entity = await ctx.env.DB.prepare('SELECT e.jurisdiction FROM projects p JOIN entities e ON e.id = p.entity_id WHERE p.id = ?')
      .bind(ctx.projectId).first<{ jurisdiction: string | null }>();
    const founders = rowsOf(await ctx.env.DB.prepare('SELECT id, name FROM cap_table_holders WHERE project_id = ? AND founder_role IS NOT NULL ORDER BY id LIMIT 100')
      .bind(ctx.projectId).all<Any>()).map(h => ({ value: `h-${h.id}`, label: h.name }));
    return { kind: { options: optionsOf(FILING_KIND) },
      jurisdiction: { options: [...new Set([entity?.jurisdiction, 'Federal'].filter((j): j is string => typeof j === 'string' && !!j.trim()))].map(j => ({ value: j, label: j })) },
      for_holder_id: { options: founders, empty: NONE_YET }, state: { options: FILING_STATE_OPTIONS } };
  },
};

// ── Operating systems: one system kind ───────────────────────────────────────

type System = {
  kind: SystemKind; companyId: number | null;
  feeds: string[]; providerKey: string | null; provider: string | null;
  connection: Any | null; workspace: boolean;
};

function feedsOf(raw: unknown): string[] {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : null;
    return Array.isArray(list) ? [...new Set(list.filter((key): key is string => typeof key === 'string' && Object.hasOwn(FEEDS_LABEL, key)))] : [];
  } catch { return []; }
}
function syncOf(configJson: unknown): string {
  try {
    const config = typeof configJson === 'string' ? JSON.parse(configJson) : null;
    return Object.hasOwn(SYNC_LABEL, config?.sync_frequency) ? config.sync_frequency : 'live';
  } catch { return 'live'; }
}
async function workspaceConnected(env: Env, userId: number, providerKey: string): Promise<boolean> {
  if (providerKey === 'google_calendar') return !!await env.DB.prepare('SELECT 1 FROM google_oauth_tokens WHERE user_id = ?').bind(userId).first();
  if (providerKey === 'microsoft_365') return !!await env.DB.prepare('SELECT 1 FROM microsoft_oauth_tokens WHERE user_id = ?').bind(userId).first();
  return false;
}

/**
 * The kind's mapping as the list reads it: a connection counts only while it
 * is enabled for the venture's company and its owner is a member. Decision 11:
 * the provider is the catalogue name unless the viewer owns the connection.
 */
async function systemOf(ctx: RecordContext, id: string): Promise<System> {
  const kind = id as SystemKind;
  const { company_id: companyId } = await projectRow(ctx);
  const base: System = { kind, companyId, feeds: [], providerKey: null, provider: null, connection: null, workspace: kind === 'workspace' };
  if (companyId == null) return base;
  const row = await ctx.env.DB.prepare(
    `SELECT s.feeds_json, s.provider_key AS workspace_provider, s.updated_by,
            i.id, i.user_id, i.provider_key, i.display_name, i.status, i.last_synced_at, i.created_at, i.config_json, i.scopes_json
       FROM project_core_systems s
       LEFT JOIN integrations i ON i.id = s.integration_id AND EXISTS (
         SELECT 1 FROM integration_companies ic JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
          WHERE ic.integration_id = i.id AND ic.company_id = ? AND ic.enabled = 1)
      WHERE s.project_id = ? AND s.kind = ?`,
  ).bind(companyId, ctx.projectId, kind).first<Any>();
  if (!row) return base;
  base.feeds = feedsOf(row.feeds_json);
  if (kind === 'workspace') {
    const member = row.workspace_provider && row.updated_by != null && !!await ctx.env.DB.prepare(
      'SELECT 1 FROM user_company_links WHERE user_id = ? AND company_id = ?',
    ).bind(row.updated_by, companyId).first();
    if (member && await workspaceConnected(ctx.env, row.updated_by, row.workspace_provider)) {
      base.providerKey = row.workspace_provider;
      base.provider = getDescriptor(row.workspace_provider)?.display_name ?? row.workspace_provider;
      base.connection = { status: 'active' };
    }
    return base;
  }
  if (row.id == null) return base;
  base.providerKey = row.provider_key;
  base.provider = (row.user_id === ctx.user.id ? row.display_name : getDescriptor(row.provider_key)?.display_name) ?? row.provider_key;
  base.connection = row;
  return base;
}
function systemState(s: System): 'connected' | 'failing' | 'not_connected' {
  return !s.connection ? 'not_connected' : s.connection.status === 'error' ? 'failing' : s.connection.status === 'active' ? 'connected' : 'not_connected';
}
const STATE_LABEL = { connected: 'Connected', failing: 'Failing', not_connected: 'Not connected' } as const;
const STATE_TONE = { connected: 'ok', failing: 'bad', not_connected: 'grey' } as const;
const NO_ROW = 'Workspace has no connection row.';

const operatingSystems: ModuleSpec = {
  read: 'read', write: 'write', store: 'build_systems',
  oldRows: { actions: ['build_system_mapping_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const s = await systemOf(ctx, id);
    const state = systemState(s);
    const c = s.connection;
    const sub = !c ? 'Not connected yet'
      : s.workspace ? 'Connected · sync not recorded'
        : [dateText(c.created_at) ? `Connected ${dateText(c.created_at)}` : 'Connected',
          dateText(c.last_synced_at) ? `last good sync ${dateText(c.last_synced_at)}` : 'no sync recorded'].join(' · ');
    return {
      title: `${SYSTEM_LABEL[s.kind]} · ${s.provider ?? 'Not connected'}`, sub,
      pills: [{ text: STATE_LABEL[state], tone: STATE_TONE[state] }],
      facts: [
        fact('State', STATE_LABEL[state], ''),
        s.workspace ? fact('Last sync', null, NO_ROW) : fact('Last sync', stampText(c?.last_synced_at), c ? 'No sync recorded.' : 'Not connected yet.'),
        // Decision 5: the mapped connection's sync_frequency, live when unset.
        s.workspace ? fact('Sync', null, NO_ROW) : fact('Sync', c ? SYNC_LABEL[syncOf(c.config_json)] : null, 'Not connected yet.'),
        fact('Feeds', s.feeds.map(key => FEEDS_LABEL[key]).join(' · '), 'No feeds recorded.'),
      ],
    };
  },
  sections: [
    { key: 'sync_log', title: 'Sync log', gate: 'write', async read(ctx, id) {
      const s = await systemOf(ctx, id);
      if (s.workspace) return notRecorded(NO_ROW);
      if (!s.connection) return notRecorded('Not connected yet.');
      // Decision 11: date, event type and status only; never a summary or payload.
      const logs = rowsOf(await ctx.env.DB.prepare(
        'SELECT created_at, event_type, status FROM integration_logs WHERE integration_id = ? ORDER BY created_at DESC, id DESC LIMIT 20',
      ).bind(s.connection.id).all<Any>());
      return { rows: logs.map(l => {
        const ok = /^(ok|success)$/i.test(String(l.status)), failed = /^(error|failed|failure)$/i.test(String(l.status));
        return { a: stampText(l.created_at) ?? 'Date not recorded', b: l.event_type ?? 'Event not recorded',
          c: ok ? 'OK' : failed ? 'Failed' : String(l.status ?? 'Not recorded'), tone: ok ? 'ok' : failed ? 'bad' : 'grey' };
      }), empty: 'No sync recorded yet.' };
    } },
    { key: 'permissions', title: 'Permissions', gate: 'write', async read(ctx, id) {
      const s = await systemOf(ctx, id);
      if (s.workspace) return notRecorded(NO_ROW);
      if (!s.connection) return notRecorded('Not connected yet.');
      const lines = CONNECTOR_METADATA[s.providerKey!]?.permissions ?? [];
      const requested = getDescriptor(s.providerKey!)?.oauth_scopes ?? [];
      let granted: unknown = null;
      try { granted = s.connection.scopes_json ? JSON.parse(s.connection.scopes_json) : null; } catch { granted = null; }
      if (!Array.isArray(granted) || granted.length === 0) return notRecorded('The connector stored no granted scopes.');
      if (!requested.every(scope => (granted as unknown[]).includes(scope))) return notRecorded('Some requested scopes were not granted.');
      return { rows: lines.map(line => ({ a: line, c: 'Granted', tone: 'ok' })), empty: 'The connector lists no permissions.' };
    } },
    { key: 'companies', title: 'Companies', side: true, async read(ctx, id) {
      const s = await systemOf(ctx, id);
      if (s.companyId == null) return notRecorded('This project has no company scope for connectors.');
      if (s.workspace || !s.connection) {
        const own = await ctx.env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?').bind(s.companyId).first<Any>();
        return s.connection ? { rows: [{ a: own?.company_name ?? 'This venture’s company', b: 'on' }] } : notRecorded('Not connected yet.');
      }
      // Decision 11: this venture's company, and others only where the viewer is a member.
      const list = rowsOf(await ctx.env.DB.prepare(
        `SELECT ic.company_id, ic.enabled, cp.company_name FROM integration_companies ic
           LEFT JOIN company_profiles cp ON cp.id = ic.company_id
          WHERE ic.integration_id = ? AND (ic.company_id = ? OR ic.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?))
          ORDER BY ic.company_id = ? DESC, ic.company_id`,
      ).bind(s.connection.id, s.companyId, ctx.user.id, s.companyId).all<Any>());
      return { rows: list.map(k => ({ a: k.company_name ?? (k.company_id === s.companyId ? 'This venture’s company' : 'Company name not recorded'),
        b: Number(k.enabled) === 1 ? 'on' : 'off' })) };
    } },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    // Decision 10: Reconnect links to the tool's Connect a tool, else Connect a tool for the venture.
    const s = await systemOf(ctx, id);
    const href = s.providerKey && /^[a-z0-9_]{1,80}$/.test(s.providerKey)
      ? connectHref(s.providerKey, ctx.projectId) : `/build/connect?project_id=${ctx.projectId}`;
    const actions: RecordAction[] = [{ key: 'reconnect', label: 'Reconnect', kind: 'link', tone: 'primary', href }];
    const stored = await storedSystem(ctx, id);
    const editable = syncEditable(id, stored, ctx.user.id);
    const project = await writeProject(ctx.env, ctx.projectId);
    const choices = project?.company_id == null ? [] : (await systemChoices(ctx.env, project, ctx.user)).find(k => k.kind === id)?.choices ?? [];
    // Decision 13: Choose connector starts empty, meaning keep the current one,
    // so an Edit sent back unchanged never re-maps or names another member's connection.
    actions.push({ key: 'edit', label: 'Choose connector', kind: 'form',
      form: { title: `Choose your ${SYSTEM_LABEL[s.kind]}`, cta: 'Save', fields: [
        { key: 'connector', label: 'Connector', kind: 'CH', value: '',
          options: choices.map(ch => ch.uid ? { value: `uid:${ch.uid}`, label: ch.display_name } : { value: `provider:${ch.provider_key}`, label: ch.display_name }) },
        { key: 'used_by', label: 'Used by', kind: 'T', value: stored?.used_by ?? '' },
        { key: 'feeds', label: 'Feeds', kind: 'CH', options: FEED_OPTIONS, value: feedsOf(stored?.feeds_json) },
        ...(editable ? [{ key: 'sync', label: 'Sync', kind: 'CH' as const, options: SYNC_OPTIONS,
          value: stored?.integration_id != null ? syncOf(stored.config_json) : stored?.sync_request ?? '' }] : []),
      ] },
      execute: (c, _id, body) => editSystem(c, id, editable, jsonOf(body)) });
    // Decision 10: Disconnect is the PUT with the connector key sent as null, while the kind names one.
    if (stored && (stored.integration_id != null || stored.provider_key != null)) {
      actions.push({ key: 'disconnect', label: 'Disconnect', kind: 'write', tone: 'danger',
        confirm: `Disconnect ${SYSTEM_LABEL[s.kind]} from this venture? The connection stays in Connect a tool.`,
        execute: c => viaRoute(c, putSystem, { kind: id }, id === 'workspace' ? { provider_key: null } : { integration_uid: null }) });
    }
    return actions;
  },
  /**
   * Per kind: the caller's own enabled connections (`systemChoices()`, the
   * route's own read), the catalogue providers that can be connected, and
   * `sync_editable` (decision 5); then the four Sync choices and three Feeds.
   */
  async formOptions(ctx) {
    const project = await writeProject(ctx.env, ctx.projectId);
    const own = project?.company_id == null ? [] : await systemChoices(ctx.env, project, ctx.user);
    const kinds = [];
    for (const kind of SYSTEM_KINDS) {
      kinds.push({ kind, label: SYSTEM_LABEL[kind], connections: own.find(k => k.kind === kind)?.choices ?? [], providers: catalogue(kind),
        sync_editable: syncEditable(kind, await storedSystem(ctx, kind), ctx.user.id) });
    }
    return { kinds, sync: { options: SYNC_OPTIONS }, feeds: { options: FEED_OPTIONS } };
  },
};

export const BUILD_SPECS: Record<string, ModuleSpec> = {
  'solution-design': solutionDesign,
  'prototype-mvp': prototypeMvp,
  'product-roadmap': productRoadmap,
  'founding-team': foundingTeam,
  'company-creation': companyCreation,
  'operating-systems': operatingSystems,
};
