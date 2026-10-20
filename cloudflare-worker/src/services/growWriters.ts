/**
 * D691 (S19-A, #1697) — one writer per Grow store. `routes/cycle_grow.ts`
 * calls them after its gate (`canAccessProject` for writing), and #1698's
 * actions and feedback-theme fill call the same ones, so a store has one
 * insert and one update.
 *
 * Each writer checks every id its body names against the venture (an id
 * outside it is a 404), records who wrote the row, and logs one activity row
 * through `logCycleWrite`: `entity_type 'grow.<module>'`, the record's id and
 * the `project_id`. A summary never holds a customer's, contact's or
 * applicant's name, because every reader reads activity.
 *
 * Money is whole cents with a three-letter lowercase currency, stored only
 * beside an amount, `usd` when the body sends none. Every request value is
 * bound; a column or a table is never taken from a request.
 */
import type { Env, User } from '../types';
import { logCycleWrite, logCycleWriteStatement } from './cycleActivity';
import { closePosting, createPosting, submitForReview } from './jobBoardCommon';
import { APPLICATION_STAGES, MARKET_PARTS, type GrowSlug } from './growCycle';
import { calendarDay } from './growKpis';
import { mintDownloadToken } from './signedDownload';

export class Refused extends Error {
  status: number; sentence: string; field: string | null;
  constructor(status: number, sentence: string, field: string | null = null) { super(sentence); this.status = status; this.sentence = sentence; this.field = field; }
}

type Body = Record<string, unknown>;
type Row = Record<string, unknown>;

const nowIso = () => new Date().toISOString();
const newUid = () => crypto.randomUUID().replace(/-/g, '');
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
const has = (b: Body, k: string) => b[k] !== undefined;

export const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, required = false): T | null {
  if (v == null || v === '') { if (required) throw new Refused(400, `${field} is required`, field); return null; }
  if (!(allowed as readonly string[]).includes(String(v))) throw new Refused(400, `${field} must be one of ${allowed.join(', ')}`, field);
  return String(v) as T;
}

export function cents(v: unknown, field: string): number {
  const n = typeof v === 'object' || typeof v === 'boolean' ? NaN : Number(v);
  if (v === '' || !Number.isInteger(n) || n < 0 || n > 10_000_000_000) throw new Refused(400, `${field} must be whole cents, 0 or more`, field);
  return n;
}
const centsOrNull = (v: unknown, field: string) => (v == null || v === '' ? null : cents(v, field));

/** A currency stored only beside an amount: the body's, or `usd` when it sends none. */
function currencyFor(amount: number | null, v: unknown, field: string): string | null {
  if (amount == null) return null;
  if (v == null || v === '') return 'usd';
  const c = String(v).trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(c)) throw new Refused(400, `${field} is a three-letter currency code`, field);
  return c;
}

function pct(v: unknown, field: string): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'object' || typeof v === 'boolean' ? NaN : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Refused(400, `${field} is a percentage from 0 to 100`, field);
  return n;
}

/** A yes/no switch: 1, 0, true or false; anything else is refused. */
function switchOf(v: unknown, field: string): 0 | 1 {
  if (v === 1 || v === true || v === '1') return 1;
  if (v === 0 || v === false || v === '0') return 0;
  throw new Refused(400, `${field} is 1 or 0`, field);
}

function day(v: unknown, field: string): string | null {
  if (v == null || v === '') return null;
  const d = calendarDay(v);
  if (!d) throw new Refused(400, `${field} is a real date written YYYY-MM-DD`, field);
  return d;
}

function email(v: unknown, field: string): string | null {
  const e = str(v, 200)?.toLowerCase() ?? null;
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Refused(400, `${field} is an email address`, field);
  return e;
}

function score(v: unknown, field: string): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10) throw new Refused(400, `${field} must be a whole number from 0 to 10`, field);
  return n;
}

async function owned<T>(env: Env, sql: string, key: unknown, pid: number): Promise<T> {
  const row = await env.DB.prepare(sql).bind(key, pid).first<T>();
  if (!row) throw new Refused(404, 'Not found');
  return row;
}

type Log = { module: GrowSlug | 'kpis'; entityId: string | number; action: string; summary: string };
const MODULE_OF: Record<Log['module'], GrowSlug> = {
  'product-improvement': 'product-improvement', distribution: 'distribution', 'revenue-and-traction': 'revenue-and-traction',
  'team-expansion': 'team-expansion', 'partner-network': 'partner-network', 'market-expansion': 'market-expansion',
  'durable-company-building': 'durable-company-building', kpis: 'revenue-and-traction',
};
const entry = (pid: number, userId: number, l: Log) =>
  ({ projectId: pid, userId, cycle: 'grow' as const, module: MODULE_OF[l.module], entityId: l.entityId, action: l.action, summary: l.summary });
export const logGrowWrite = (env: Env, pid: number, userId: number, l: Log) => logCycleWrite(env, entry(pid, userId, l));

// ── Product improvement ─────────────────────────────────────────────────────

export const FEEDBACK_SOURCES = ['customer', 'investor', 'team'] as const;
export const FEEDBACK_STATUS = ['open', 'planned', 'shipped'] as const;

/** A roadmap item of this venture, and its label read from the item; another venture's is a 404. */
async function roadmapItem(env: Env, pid: number, ref: unknown): Promise<{ ref: string; label: string } | null> {
  if (ref == null || ref === '') return null;
  const id = Number(ref);
  if (!Number.isSafeInteger(id) || id < 1) throw new Refused(404, 'Not found', 'roadmap_item_ref');
  const row = await env.DB.prepare('SELECT id, objective FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(id, pid).first<{ id: number; objective: string }>();
  if (!row) throw new Refused(404, 'Not found', 'roadmap_item_ref');
  return { ref: String(row.id), label: String(row.objective).slice(0, 200) };
}

const flag = (v: unknown) => (v === true || v === 1 || v === '1' ? 1 : 0);

export async function addFeedback(env: Env, pid: number, user: User, b: Body): Promise<{ uid: string }> {
  const text = str(b.body, 4000);
  if (!text) throw new Refused(400, 'Feedback says something', 'body');
  const source = oneOf(b.source, FEEDBACK_SOURCES, 'source', true);
  const item = await roadmapItem(env, pid, b.roadmap_item_ref);
  const status = oneOf(b.status, FEEDBACK_STATUS, 'status') ?? 'open';
  const id = newUid();
  await env.DB.prepare(
    `INSERT INTO product_feedback (uid, project_id, body, source, from_name, from_email, from_company, theme, roadmap_item_ref, roadmap_item_label,
       notify_on_ship, status, shipped_on, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, pid, text, source, str(b.from_name, 200), email(b.from_email, 'from_email'), str(b.from_company, 200), str(b.theme, 80),
    item?.ref ?? null, item?.label ?? str(b.roadmap_item_label, 200), flag(b.notify_on_ship),
    status, status === 'shipped' ? nowIso().slice(0, 10) : null, user.id, user.id).run();
  await logGrowWrite(env, pid, user.id, { module: 'product-improvement', entityId: id, action: 'grow_feedback_logged', summary: 'Feedback logged' });
  return { uid: id };
}

export async function updateFeedback(env: Env, pid: number, user: User, uid: string, b: Body): Promise<{ uid: string; status: string }> {
  const row = await owned<Row & { id: number; status: string }>(env,
    `SELECT id, body, source, status, from_name, from_email, from_company, theme, roadmap_item_ref, roadmap_item_label, notify_on_ship
       FROM product_feedback WHERE uid = ? AND project_id = ?`, uid, pid);
  const status = has(b, 'status') ? oneOf(b.status, FEEDBACK_STATUS, 'status', true)! : row.status;
  let text = row.body;
  if (has(b, 'body')) { text = str(b.body, 4000); if (!text) throw new Refused(400, 'Feedback says something', 'body'); }
  let ref = row.roadmap_item_ref; let label = row.roadmap_item_label;
  if (has(b, 'roadmap_item_ref')) {
    const item = await roadmapItem(env, pid, b.roadmap_item_ref);
    ref = item?.ref ?? null;
    label = item ? item.label : has(b, 'roadmap_item_label') ? str(b.roadmap_item_label, 200) : null;
  } else if (has(b, 'roadmap_item_label')) label = str(b.roadmap_item_label, 200);
  await env.DB.prepare(
    `UPDATE product_feedback SET body = ?, source = ?, status = ?, from_name = ?, from_email = ?, from_company = ?, theme = ?,
       roadmap_item_ref = ?, roadmap_item_label = ?, notify_on_ship = ?,
       shipped_on = CASE WHEN ? = 'shipped' AND status <> 'shipped' THEN ? ELSE shipped_on END, updated_by = ?, updated_at = ? WHERE id = ?`,
  ).bind(text, has(b, 'source') ? oneOf(b.source, FEEDBACK_SOURCES, 'source', true) : row.source, status,
    has(b, 'from_name') ? str(b.from_name, 200) : row.from_name, has(b, 'from_email') ? email(b.from_email, 'from_email') : row.from_email,
    has(b, 'from_company') ? str(b.from_company, 200) : row.from_company, has(b, 'theme') ? str(b.theme, 80) : row.theme,
    ref, label, has(b, 'notify_on_ship') ? flag(b.notify_on_ship) : row.notify_on_ship,
    status, nowIso().slice(0, 10), user.id, nowIso(), row.id).run();
  await logGrowWrite(env, pid, user.id, { module: 'product-improvement', entityId: uid, action: 'grow_feedback_updated', summary: 'Feedback updated' });
  return { uid, status };
}

/** The writer #1698's feedback-theme fill applies through: an existing theme or a new one. */
export async function setFeedbackTheme(env: Env, projectId: number, uid: string, theme: string | null, userId: number): Promise<{ uid: string; theme: string | null }> {
  const row = await owned<{ id: number }>(env, 'SELECT id FROM product_feedback WHERE uid = ? AND project_id = ?', uid, projectId);
  const t = str(theme, 80);
  await env.DB.prepare('UPDATE product_feedback SET theme = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(t, userId, nowIso(), row.id).run();
  await logGrowWrite(env, projectId, userId, { module: 'product-improvement', entityId: uid, action: 'grow_feedback_theme_set', summary: t ? 'Theme set' : 'Theme cleared' });
  return { uid, theme: t };
}

// ── Distribution ────────────────────────────────────────────────────────────

export const CHANNEL_STATES = ['active', 'testing', 'paused'] as const;
export const CHANNEL_KINDS = ['content', 'paid_search', 'paid_social', 'outbound', 'referral', 'partner', 'events', 'other'] as const;

/** A UTM source from a channel's name: lowercase, non-alphanumerics to `-`, `-2`, `-3` on a clash. */
export async function deriveUtmSource(env: Env, pid: number, name: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'channel';
  const taken = new Set(((await env.DB.prepare('SELECT utm_source FROM growth_channels WHERE project_id = ?').bind(pid).all<{ utm_source: string }>()).results || [])
    .map((r) => r.utm_source));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

const thisMonth = () => nowIso().slice(0, 7);
const spendStatement = (env: Env, uid: string, month: string, spend: number, userId: number) => env.DB.prepare(
  `INSERT INTO channel_spend (channel_id, month, spend_cents, source, recorded_by)
   VALUES ((SELECT id FROM growth_channels WHERE uid = ?), ?, ?, 'manual', ?)
   ON CONFLICT(channel_id, month) DO UPDATE SET spend_cents = excluded.spend_cents, recorded_by = excluded.recorded_by`,
).bind(uid, month, spend, userId);

const isUnique = (e: unknown) => String((e as Error).message).toLowerCase().includes('unique');

export async function addChannel(env: Env, pid: number, user: User, b: Body): Promise<{ uid: string; utm_source: string }> {
  const name = str(b.name, 120);
  if (!name) throw new Refused(400, 'A channel has a name', 'name');
  const given = str(b.utm_source, 80)?.toLowerCase() ?? null;
  const utm = given ?? await deriveUtmSource(env, pid, name);
  const bar = centsOrNull(b.cac_bar_cents, 'cac_bar_cents');
  const spend = centsOrNull(b.spend_cents, 'spend_cents');
  const id = newUid();
  const statements = [
    env.DB.prepare(`INSERT INTO growth_channels (uid, project_id, name, utm_source, state, kind, cac_bar_cents, bar_currency, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, pid, name, utm, oneOf(b.state, CHANNEL_STATES, 'state') ?? 'active', oneOf(b.kind, CHANNEL_KINDS, 'kind'),
        bar, currencyFor(bar, b.bar_currency, 'bar_currency'), user.id),
    ...(spend == null ? [] : [spendStatement(env, id, thisMonth(), spend, user.id)]),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'distribution', entityId: id, action: 'grow_channel_added', summary: 'Channel added' })),
  ];
  try { await env.DB.batch(statements); } catch (e) {
    if (isUnique(e)) throw new Refused(409, 'A channel already uses that UTM source', 'utm_source');
    throw e;
  }
  return { uid: id, utm_source: utm };
}

export async function updateChannel(env: Env, pid: number, user: User, uid: string, b: Body): Promise<{ uid: string }> {
  const row = await owned<Row & { id: number }>(env,
    'SELECT id, name, state, kind, cac_bar_cents, bar_currency FROM growth_channels WHERE uid = ? AND project_id = ?', uid, pid);
  const bar = has(b, 'cac_bar_cents') ? centsOrNull(b.cac_bar_cents, 'cac_bar_cents') : row.cac_bar_cents as number | null;
  const barCurrency = has(b, 'cac_bar_cents') || has(b, 'bar_currency')
    ? currencyFor(bar, has(b, 'bar_currency') ? b.bar_currency : row.bar_currency, 'bar_currency') : row.bar_currency;
  const spend = has(b, 'spend_cents') ? centsOrNull(b.spend_cents, 'spend_cents') : null;
  await env.DB.batch([
    env.DB.prepare('UPDATE growth_channels SET name = ?, state = ?, kind = ?, cac_bar_cents = ?, bar_currency = ?, updated_at = ? WHERE id = ?')
      .bind(has(b, 'name') ? (str(b.name, 120) ?? row.name) : row.name, has(b, 'state') ? oneOf(b.state, CHANNEL_STATES, 'state', true) : row.state,
        has(b, 'kind') ? oneOf(b.kind, CHANNEL_KINDS, 'kind') : row.kind, bar, barCurrency, nowIso(), row.id),
    ...(spend == null ? [] : [spendStatement(env, uid, thisMonth(), spend, user.id)]),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'distribution', entityId: uid, action: 'grow_channel_updated', summary: 'Channel updated' })),
  ]);
  return { uid };
}

export async function setChannelSpend(env: Env, pid: number, user: User, uid: string, month: string, b: Body) {
  if (!MONTH.test(month)) throw new Refused(400, 'month is YYYY-MM', 'month');
  await owned<{ id: number }>(env, 'SELECT id FROM growth_channels WHERE uid = ? AND project_id = ?', uid, pid);
  const spend = cents(b.spend_cents, 'spend_cents');
  await env.DB.batch([
    spendStatement(env, uid, month, spend, user.id),
    // The channel's own id: D690's record ids hold no month.
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'distribution', entityId: uid, action: 'grow_channel_spend', summary: `Spend entered for ${month}` })),
  ]);
  return { uid, month, spend_cents: spend, source: 'manual' as const };
}

// ── Team expansion ──────────────────────────────────────────────────────────

/** The types Open a role offers; anything else is refused, never turned into full-time. */
export const ROLE_TYPES = ['full_time', 'part_time', 'contract', 'fractional'] as const;

function roleFields(b: Body, prev: Row = {}) {
  const pick = <T>(k: string, read: () => T, fallback: unknown) => (has(b, k) ? read() : fallback) as T;
  const target = pick('target_start', () => str(b.target_start, 10), prev.target_start ?? null) as string | null;
  if (target && !DATE.test(target) && !MONTH.test(target)) throw new Refused(400, 'target_start is YYYY-MM or YYYY-MM-DD', 'target_start');
  const min = pick('comp_min_cents', () => centsOrNull(b.comp_min_cents, 'comp_min_cents'), prev.comp_min_cents ?? null) as number | null;
  const max = pick('comp_max_cents', () => centsOrNull(b.comp_max_cents, 'comp_max_cents'), prev.comp_max_cents ?? null) as number | null;
  if (min != null && max != null && min > max) throw new Refused(400, 'The band starts below where it ends', 'comp_max_cents');
  const amount = min ?? max;
  const currency = has(b, 'comp_currency') || has(b, 'comp_min_cents') || has(b, 'comp_max_cents')
    ? currencyFor(amount, has(b, 'comp_currency') ? b.comp_currency : prev.comp_currency, 'comp_currency')
    : (prev.comp_currency ?? null);
  // #2181: the band on the public board is the founder's switch, off by default. A
  // switch sent on with no band is refused; a band cleared later turns it off.
  const shown = has(b, 'comp_public') ? switchOf(b.comp_public, 'comp_public') : (Number(prev.comp_public) === 1 ? 1 : 0);
  if (shown === 1 && min == null && max == null && has(b, 'comp_public')) throw new Refused(400, 'Fill the band before showing it on the jobs board', 'comp_public');
  return {
    comp_public: (min == null && max == null ? 0 : shown) as 0 | 1,
    team: pick('team', () => str(b.team, 80), prev.team ?? null) as string | null,
    target_start: target,
    employment_type: pick('type', () => oneOf(b.type, ROLE_TYPES, 'type', true), prev.employment_type ?? 'full_time') as string,
    comp_min_cents: min, comp_max_cents: max, comp_currency: currency as string | null,
    equity_pct: pick('equity_pct', () => pct(b.equity_pct, 'equity_pct'), prev.equity_pct ?? null) as number | null,
  };
}

export async function openRole(env: Env, pid: number, user: User, b: Body): Promise<{ id: number; status: string }> {
  const title = str(b.title, 200);
  if (!title) throw new Refused(400, 'A role has a title', 'title');
  if (b.type == null || b.type === '') b = { ...b, type: 'full_time' };
  const f = roleFields(b);
  const posting = await createPosting(env, user.id, pid, { title, ...f });
  let status = String(posting.status);
  if (b.publish === true) {
    // The caller is the posting's host, so the board's own gate admits them.
    const out = await submitForReview(env, posting, user);
    if (out.ok) status = String(out.posting.status);
  }
  await logGrowWrite(env, pid, user.id, { module: 'team-expansion', entityId: posting.id, action: 'grow_role_opened',
    summary: status === 'pending_review' ? 'Role opened and sent for review' : 'Role opened as a draft' });
  return { id: Number(posting.id), status };
}

export async function updateRole(env: Env, pid: number, user: User, id: number, b: Body): Promise<{ id: number; status: string }> {
  const row = await owned<Row & { id: number; status: string }>(env, 'SELECT * FROM job_postings WHERE id = ? AND project_id = ?', id, pid);
  const publish = b.publish === true && (row.status === 'draft' || row.status === 'rejected');
  // Publishing is the board's: only the posting's host or an admin, and a refusal writes nothing.
  if (b.publish === true && !(user.role === 'admin' || Number(row.host_user_id) === Number(user.id))) {
    throw new Refused(403, 'Only the role\'s host or an admin can send it for review', 'publish');
  }
  let title = row.title as string;
  if (has(b, 'title')) { title = str(b.title, 200) ?? ''; if (!title) throw new Refused(400, 'A role has a title', 'title'); }
  const f = roleFields(b, row);
  await env.DB.prepare(
    `UPDATE job_postings SET title = ?, team = ?, target_start = ?, employment_type = ?, comp_min_cents = ?, comp_max_cents = ?,
       comp_currency = ?, equity_pct = ?, comp_public = ?, updated_at = ? WHERE id = ?`,
  ).bind(title, f.team, f.target_start, f.employment_type, f.comp_min_cents, f.comp_max_cents, f.comp_currency, f.equity_pct, f.comp_public, nowIso(), row.id).run();
  let status = row.status;
  if (publish) {
    const out = await submitForReview(env, { ...row, title }, user);
    if (!out.ok) throw new Refused(out.status, out.error === 'forbidden' ? 'Only the role\'s host or an admin can send it for review' : 'A role has a title', 'publish');
    status = String(out.posting.status);
  }
  await logGrowWrite(env, pid, user.id, { module: 'team-expansion', entityId: row.id, action: 'grow_role_updated',
    summary: publish ? 'Role updated and sent for review' : 'Role updated' });
  return { id: row.id, status };
}

/** Close role (#1698's action): the board's own close, so only the host or an admin. */
export async function closeRole(env: Env, pid: number, user: User, id: number): Promise<{ id: number; status: string }> {
  const row = await owned<Row & { id: number }>(env, 'SELECT * FROM job_postings WHERE id = ? AND project_id = ?', id, pid);
  const out = await closePosting(env, row, user);
  if (!out.ok) throw new Refused(out.status, 'Only the role\'s host or an admin can close it');
  await logGrowWrite(env, pid, user.id, { module: 'team-expansion', entityId: row.id, action: 'grow_role_closed', summary: 'Role closed' });
  return { id: row.id, status: String(out.posting.status) };
}

export async function setApplicationStage(env: Env, pid: number, user: User, id: number, b: Body) {
  const row = await owned<{ id: number; posting_id: number }>(env,
    'SELECT a.id, a.posting_id FROM job_applications a JOIN job_postings p ON p.id = a.posting_id WHERE a.id = ? AND p.project_id = ?', id, pid);
  const stage = oneOf(b.stage, APPLICATION_STAGES, 'stage', true);
  await env.DB.prepare('UPDATE job_applications SET stage = ?, stage_changed_at = ?, stage_changed_by = ?, updated_at = ? WHERE id = ?')
    .bind(stage, nowIso(), user.id, nowIso(), row.id).run();
  // The role's record: an applicant is never a Grow record, and never named.
  await logGrowWrite(env, pid, user.id, { module: 'team-expansion', entityId: row.posting_id, action: 'grow_application_stage', summary: `Applicant moved to ${stage}` });
  return { id: row.id, stage };
}

// ── Partner network ─────────────────────────────────────────────────────────

export const PARTNER_TYPES = ['reseller', 'integration', 'agency', 'referral', 'co_marketing', 'other'] as const;
export const PARTNER_STAGES = ['talking', 'terms', 'signed', 'paused', 'ended'] as const;
export const TERMS_KINDS = ['rev_share', 'services_fee', 'referral_fee', 'none'] as const;

/** Terms keep a percentage and an amount apart: one or the other, never both (decision 7). */
function termsFields(b: Body, prev: Row = {}) {
  const pctGiven = has(b, 'terms_pct') && b.terms_pct != null && b.terms_pct !== '';
  const amountGiven = has(b, 'terms_amount_cents') && b.terms_amount_cents != null && b.terms_amount_cents !== '';
  if (pctGiven && amountGiven) throw new Refused(400, 'Terms are a percentage or an amount, not both', 'terms_amount_cents');
  let termsPct = (prev.terms_pct ?? null) as number | null;
  let amount = (prev.terms_amount_cents ?? null) as number | null;
  if (has(b, 'terms_pct')) { termsPct = pct(b.terms_pct, 'terms_pct'); if (termsPct != null) amount = null; }
  if (has(b, 'terms_amount_cents')) { amount = centsOrNull(b.terms_amount_cents, 'terms_amount_cents'); if (amount != null) termsPct = null; }
  const currency = has(b, 'terms_amount_cents') || has(b, 'terms_currency') || has(b, 'terms_pct')
    ? currencyFor(amount, has(b, 'terms_currency') ? b.terms_currency : prev.terms_currency, 'terms_currency')
    : (prev.terms_currency ?? null);
  return {
    terms_kind: has(b, 'terms_kind') ? oneOf(b.terms_kind, TERMS_KINDS, 'terms_kind') : (prev.terms_kind ?? null),
    terms_pct: termsPct, terms_amount_cents: amount, terms_currency: currency,
    renewal_on: has(b, 'renewal_on') ? day(b.renewal_on, 'renewal_on') : (prev.renewal_on ?? null),
    contact_name: has(b, 'contact_name') ? str(b.contact_name, 200) : (prev.contact_name ?? null),
    contact_email: has(b, 'contact_email') ? email(b.contact_email, 'contact_email') : (prev.contact_email ?? null),
    terms: has(b, 'terms') ? str(b.terms, 400) : (prev.terms ?? null),
  };
}

export async function addPartner(env: Env, pid: number, user: User, b: Body): Promise<{ uid: string }> {
  const name = str(b.name, 200);
  if (!name) throw new Refused(400, 'A partner has a name', 'name');
  const t = termsFields(b);
  const id = newUid();
  await env.DB.prepare(
    `INSERT INTO growth_partners (uid, project_id, name, type, stage, terms, terms_kind, terms_pct, terms_amount_cents, terms_currency,
       renewal_on, contact_name, contact_email, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, pid, name, oneOf(b.type, PARTNER_TYPES, 'type', true), oneOf(b.stage, PARTNER_STAGES, 'stage') ?? 'talking', t.terms,
    t.terms_kind, t.terms_pct, t.terms_amount_cents, t.terms_currency, t.renewal_on, t.contact_name, t.contact_email, user.id).run();
  await logGrowWrite(env, pid, user.id, { module: 'partner-network', entityId: id, action: 'grow_partner_added', summary: 'Partner added' });
  return { uid: id };
}

export async function updatePartner(env: Env, pid: number, user: User, uid: string, b: Body): Promise<{ uid: string }> {
  const row = await owned<Row & { id: number }>(env, 'SELECT * FROM growth_partners WHERE uid = ? AND project_id = ?', uid, pid);
  const t = termsFields(b, row);
  let name = row.name;
  if (has(b, 'name')) { name = str(b.name, 200); if (!name) throw new Refused(400, 'A partner has a name', 'name'); }
  await env.DB.prepare(
    `UPDATE growth_partners SET name = ?, type = ?, stage = ?, terms = ?, terms_kind = ?, terms_pct = ?, terms_amount_cents = ?, terms_currency = ?,
       renewal_on = ?, contact_name = ?, contact_email = ?, updated_at = ? WHERE id = ?`,
  ).bind(name, has(b, 'type') ? oneOf(b.type, PARTNER_TYPES, 'type', true) : row.type, has(b, 'stage') ? oneOf(b.stage, PARTNER_STAGES, 'stage', true) : row.stage,
    t.terms, t.terms_kind, t.terms_pct, t.terms_amount_cents, t.terms_currency, t.renewal_on, t.contact_name, t.contact_email, nowIso(), row.id).run();
  await logGrowWrite(env, pid, user.id, { module: 'partner-network', entityId: uid, action: 'grow_partner_updated', summary: 'Partner updated' });
  return { uid };
}

export async function setPartnerRevenue(env: Env, pid: number, user: User, uid: string, month: string, b: Body) {
  if (!MONTH.test(month)) throw new Refused(400, 'month is YYYY-MM', 'month');
  const row = await owned<{ id: number }>(env, 'SELECT id FROM growth_partners WHERE uid = ? AND project_id = ?', uid, pid);
  const amount = cents(b.amount_cents, 'amount_cents');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO partner_revenue (partner_id, month, amount_cents, source, recorded_by) VALUES (?, ?, ?, 'manual', ?)
       ON CONFLICT(partner_id, month) DO UPDATE SET amount_cents = excluded.amount_cents, recorded_by = excluded.recorded_by`,
    ).bind(row.id, month, amount, user.id),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'partner-network', entityId: uid, action: 'grow_partner_revenue', summary: `Revenue entered for ${month}` })),
  ]);
  return { uid, month, amount_cents: amount, source: 'manual' as const };
}

// ── Market expansion ────────────────────────────────────────────────────────

export const MARKET_STATES = ['considering', 'entering', 'served', 'not_now'] as const;
export const DECISIONS = ['enter', 'not_yet', 'exit'] as const;

/** The four parts from a body: a score needs its source. */
function marketParts(b: Body, prev: Row = {}) {
  const out: Row = {};
  for (const [k, label] of MARKET_PARTS) {
    const s = b[`${k}_score`] === undefined ? (prev[`${k}_score`] as number | null ?? null) : score(b[`${k}_score`], `${k}_score`);
    const src = b[`${k}_source`] === undefined ? (prev[`${k}_source`] as string | null ?? null) : str(b[`${k}_source`], 200);
    if (s != null && !src) throw new Refused(400, `The ${label.toLowerCase()} score needs its source`, `${k}_source`);
    out[`${k}_score`] = s; out[`${k}_source`] = s == null ? null : src;
  }
  return out;
}

async function marketExtras(env: Env, b: Body, prev: Row = {}) {
  let geo = (prev.geography_ref ?? null) as string | null;
  if (has(b, 'geography_ref')) {
    geo = str(b.geography_ref, 2)?.toUpperCase() ?? null;
    if (geo && !await env.DB.prepare('SELECT 1 FROM research_countries WHERE code = ?').bind(geo).first()) {
      throw new Refused(400, 'geography_ref is not a country in Research › Geographies', 'geography_ref');
    }
  }
  const size = has(b, 'size_cents') ? centsOrNull(b.size_cents, 'size_cents') : (prev.size_cents ?? null) as number | null;
  return {
    geography_ref: geo, size_cents: size,
    size_currency: has(b, 'size_cents') || has(b, 'size_currency')
      ? currencyFor(size, has(b, 'size_currency') ? b.size_currency : prev.size_currency, 'size_currency') : (prev.size_currency ?? null),
    size_source: has(b, 'size_source') ? str(b.size_source, 200) : (prev.size_source ?? null),
  };
}

export async function addMarket(env: Env, pid: number, user: User, b: Body): Promise<{ uid: string }> {
  const name = str(b.name, 120);
  if (!name) throw new Refused(400, 'A market has a name', 'name');
  const p = marketParts(b);
  const x = await marketExtras(env, b);
  const id = newUid();
  try {
    await env.DB.prepare(
      `INSERT INTO markets (uid, project_id, name, state, demand_score, demand_source, regulation_score, regulation_source,
         partners_score, partners_source, cost_score, cost_source, geography_ref, size_cents, size_currency, size_source, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, pid, name, oneOf(b.state, MARKET_STATES, 'state') ?? 'considering', p.demand_score, p.demand_source, p.regulation_score, p.regulation_source,
      p.partners_score, p.partners_source, p.cost_score, p.cost_source, x.geography_ref, x.size_cents, x.size_currency, x.size_source, user.id, user.id).run();
  } catch (e) {
    if (isUnique(e)) throw new Refused(409, 'That market is already on the list', 'name');
    throw e;
  }
  await logGrowWrite(env, pid, user.id, { module: 'market-expansion', entityId: id, action: 'grow_market_added', summary: 'Market added' });
  return { uid: id };
}

export async function updateMarket(env: Env, pid: number, user: User, uid: string, b: Body): Promise<{ uid: string }> {
  const row = await owned<Row & { id: number; state: string; decision: string | null }>(env, 'SELECT * FROM markets WHERE uid = ? AND project_id = ?', uid, pid);
  const p = marketParts(b, row);
  const x = await marketExtras(env, b, row);
  const decision = b.decision === undefined ? row.decision : oneOf(b.decision, DECISIONS, 'decision');
  await env.DB.prepare(
    `UPDATE markets SET state = ?, decision = ?, decided_on = CASE WHEN ? IS NOT ? THEN ? ELSE decided_on END,
       demand_score = ?, demand_source = ?, regulation_score = ?, regulation_source = ?, partners_score = ?, partners_source = ?,
       cost_score = ?, cost_source = ?, geography_ref = ?, size_cents = ?, size_currency = ?, size_source = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
  ).bind(b.state === undefined ? row.state : oneOf(b.state, MARKET_STATES, 'state', true), decision, decision, row.decision, nowIso().slice(0, 10),
    p.demand_score, p.demand_source, p.regulation_score, p.regulation_source, p.partners_score, p.partners_source,
    p.cost_score, p.cost_source, x.geography_ref, x.size_cents, x.size_currency, x.size_source, user.id, nowIso(), row.id).run();
  await logGrowWrite(env, pid, user.id, { module: 'market-expansion', entityId: uid, action: 'grow_market_updated', summary: 'Market updated' });
  return { uid };
}

// ── Durable company-building ────────────────────────────────────────────────

export const OBLIGATION_KINDS = ['governance', 'compliance', 'risk', 'culture', 'tax', 'other'] as const;
export const OBLIGATION_STATES = ['scheduled', 'upcoming', 'draft', 'done', 'not_set_up', 'overdue', 'snoozed'] as const;
const OBLIGATION_EVENTS = { governance: 'board_meeting', compliance: 'other', risk: 'risk', culture: 'culture', tax: 'franchise_tax', other: 'other' } as const;
/** Repeats, as the form says it, to `compliance_events.recurrence` (decision 1). */
export const REPEATS = { once: 'one_time', monthly: 'monthly', quarterly: 'quarterly', yearly: 'annual' } as const;
export const REPEATS_OF: Record<string, keyof typeof REPEATS> = { one_time: 'once', monthly: 'monthly', quarterly: 'quarterly', annual: 'yearly' };

export function obligationKind(event: Row): string {
  if (event.kind) return String(event.kind);
  if (event.event_type === 'board_meeting') return 'governance';
  if (event.event_type === 'risk' || event.event_type === 'culture') return String(event.event_type);
  return 'compliance';
}

export function obligationState(completion: unknown, kind: string, due: string, today: string): string {
  if (completion === 'completed') return 'done';
  if (completion === 'snoozed') return 'snoozed';
  if (due < today) return 'overdue';
  return kind === 'governance' ? 'scheduled' : 'upcoming';
}

function obligationCompletion(state: unknown): string {
  return state === 'done' ? 'completed' : state === 'snoozed' ? 'snoozed' : 'pending';
}

function obligationDue(value: unknown): string {
  const due = str(value, 10);
  if (!due) throw new Refused(400, 'An obligation has a due date.', 'due_at');
  if (!DATE.test(due)) throw new Refused(400, 'due_at is YYYY-MM-DD', 'due_at');
  return due;
}

function obligationClash(error: unknown, kind: string, due: string): never {
  if (isUnique(error)) throw new Refused(409, `Another ${kind} obligation is already due on ${due}. Pick another date.`, 'due_at');
  throw error;
}

/** Remind: whole days before the due date, 0 to 90, at most three, stored as a JSON array. */
function remindDays(v: unknown): string | null {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length > 3) throw new Refused(400, 'remind_days is at most three whole numbers of days', 'remind_days');
  const days = v.map((d) => Number(d));
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 90)) throw new Refused(400, 'Each reminder is a whole number of days from 0 to 90', 'remind_days');
  const unique = [...new Set(days)].sort((a, b) => b - a);
  return unique.length ? JSON.stringify(unique) : null;
}

export async function addObligation(env: Env, pid: number, user: User, b: Body): Promise<{ id: number }> {
  const title = str(b.title, 200);
  if (!title) throw new Refused(400, 'An obligation has a title', 'title');
  const due = obligationDue(b.due_at);
  const kind = oneOf(b.kind, OBLIGATION_KINDS, 'kind', true)!;
  const repeats = oneOf(b.repeats, Object.keys(REPEATS) as Array<keyof typeof REPEATS>, 'repeats') ?? 'once';
  const remind = remindDays(b.remind_days);
  const completion = obligationCompletion(oneOf(b.status, OBLIGATION_STATES, 'status'));
  const entity = await env.DB.prepare(
    'SELECT e.id, e.jurisdiction FROM projects p JOIN entities e ON e.id = p.entity_id WHERE p.id = ?',
  ).bind(pid).first<{ id: number; jurisdiction: string | null }>();
  let id: number;
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO compliance_events (project_id, entity_id, jurisdiction, event_type, title, due_date,
        completion_status, recurrence, source, kind, owner_name, owner_user_id, created_by_user_id, created_by,
        completed_at, completed_by_user_id, remind_days_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(pid, entity?.id ?? null, entity?.jurisdiction || 'Unspecified', OBLIGATION_EVENTS[kind], title, due,
      completion, REPEATS[repeats], kind, str(b.owner_name, 120), null, user.id, user.id,
      completion === 'completed' ? nowIso() : null, completion === 'completed' ? user.id : null, remind).run();
    id = ins.meta.last_row_id;
  } catch (error) { obligationClash(error, kind, due); }
  await logGrowWrite(env, pid, user.id, { module: 'durable-company-building', entityId: id, action: 'grow_obligation_added', summary: 'Obligation added' });
  return { id };
}

export async function updateObligation(env: Env, pid: number, user: User, id: number, b: Body): Promise<{ id: number }> {
  const row = await owned<Row & { id: number; completion_status: string; owner_name: string | null; due_date: string; title: string;
    completed_at: string | null; completed_by_user_id: number | null; reminders_sent_json: string; recurrence: string; remind_days_json: string | null }>(env,
    `SELECT id, title, kind, event_type, completion_status, owner_name, due_date, completed_at, completed_by_user_id, reminders_sent_json,
            recurrence, remind_days_json FROM compliance_events WHERE id = ? AND project_id = ?`, id, pid);
  const due = b.due_at === undefined ? row.due_date : obligationDue(b.due_at);
  const completion = b.status === undefined ? row.completion_status : obligationCompletion(oneOf(b.status, OBLIGATION_STATES, 'status', true));
  const completedAt = b.status === undefined ? row.completed_at : completion === 'completed' ? nowIso() : null;
  const completedBy = b.status === undefined ? row.completed_by_user_id : completion === 'completed' ? user.id : null;
  let title = row.title;
  if (has(b, 'title')) { title = str(b.title, 200) ?? ''; if (!title) throw new Refused(400, 'An obligation has a title', 'title'); }
  const kind = has(b, 'kind') ? oneOf(b.kind, OBLIGATION_KINDS, 'kind', true)! : null;
  const recurrence = has(b, 'repeats') ? REPEATS[oneOf(b.repeats, Object.keys(REPEATS) as Array<keyof typeof REPEATS>, 'repeats', true)!] : row.recurrence;
  const remind = has(b, 'remind_days') ? remindDays(b.remind_days) : row.remind_days_json;
  try {
    await env.DB.prepare(
      `UPDATE compliance_events SET title = ?, kind = ?, event_type = ?, completion_status = ?, owner_name = ?, due_date = ?, completed_at = ?,
        completed_by_user_id = ?, reminders_sent_json = ?, recurrence = ?, remind_days_json = ?, updated_at = ? WHERE id = ?`,
    ).bind(title, kind ?? row.kind ?? null, kind ? OBLIGATION_EVENTS[kind] : row.event_type, completion,
      b.owner_name === undefined ? row.owner_name : str(b.owner_name, 120), due, completedAt, completedBy,
      due !== row.due_date || remind !== row.remind_days_json ? '[]' : row.reminders_sent_json, recurrence, remind, nowIso(), row.id).run();
  } catch (error) { obligationClash(error, kind ?? obligationKind(row), due); }
  await logGrowWrite(env, pid, user.id, { module: 'durable-company-building', entityId: row.id, action: 'grow_obligation_updated', summary: 'Obligation updated' });
  return { id: row.id };
}

export async function setChecklistItem(env: Env, pid: number, user: User, key: string, done: boolean) {
  await env.DB.prepare(
    `INSERT INTO durability_checklist (project_id, item_key, done_at, done_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, item_key) DO UPDATE SET done_at = excluded.done_at, done_by = excluded.done_by, updated_at = excluded.updated_at`,
  ).bind(pid, key, done ? nowIso() : null, done ? user.id : null, nowIso()).run();
  await logGrowWrite(env, pid, user.id, { module: 'durable-company-building', entityId: key, action: done ? 'grow_checklist_done' : 'grow_checklist_undone',
    summary: done ? 'Checklist item ticked' : 'Checklist item unticked' });
  return { key, done };
}

// ── The records' actions (#1698) ────────────────────────────────────────────
// Each action on a Grow record (`services/records/grow.ts`) runs one of these,
// or the PATCH writer above, so a record and a route write a row one way.

export const TOLD_VIA = ['email', 'call', 'message', 'in_person'] as const;

/**
 * Mark told (decision 5): the founder told the customer themselves. Records how
 * and when, and hands back a `mailto:` draft for their own mail client when the
 * feedback carries an address; the platform never emails a venture's customer.
 */
export async function markFeedbackTold(env: Env, pid: number, user: User, uid: string, b: Body) {
  const row = await owned<{ id: number; body: string; from_name: string | null; from_email: string | null; roadmap_item_label: string | null;
    notify_on_ship: number; status: string }>(env,
    'SELECT id, body, from_name, from_email, roadmap_item_label, notify_on_ship, status FROM product_feedback WHERE uid = ? AND project_id = ?', uid, pid);
  if (Number(row.notify_on_ship) !== 1) throw new Refused(400, 'Nobody asked to be told about this feedback', 'via');
  if (row.status !== 'shipped') throw new Refused(400, 'Mark it told once it has shipped', 'via');
  const via = oneOf(b.via, TOLD_VIA, 'via', true)!;
  const at = nowIso();
  await env.DB.prepare('UPDATE product_feedback SET told_at = ?, told_via = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(at, via, user.id, at, row.id).run();
  await logGrowWrite(env, pid, user.id, { module: 'product-improvement', entityId: uid, action: 'grow_feedback_told', summary: `Customer told it shipped (${via.replace('_', ' ')})` });
  const what = row.roadmap_item_label ? `"${row.roadmap_item_label}"` : 'what you asked for';
  const mailto = row.from_email
    ? `mailto:${encodeURIComponent(row.from_email)}?subject=${encodeURIComponent('It shipped')}&body=${encodeURIComponent(
      `Hi${row.from_name ? ` ${row.from_name}` : ''},\n\nYou told us: "${String(row.body).slice(0, 300)}"\n\n${what} has shipped. Thank you for asking for it.\n`)}`
    : null;
  return { uid, told_at: at, told_via: via, mailto };
}

export async function addExperiment(env: Env, pid: number, user: User, channelUid: string, b: Body) {
  const ch = await owned<{ id: number }>(env, 'SELECT id FROM growth_channels WHERE uid = ? AND project_id = ?', channelUid, pid);
  const title = str(b.title, 200);
  if (!title) throw new Refused(400, 'An experiment has a title', 'title');
  const cac = centsOrNull(b.cac_cents, 'cac_cents');
  const id = newUid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO channel_experiments (uid, channel_id, title, run_on, cac_cents, currency, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, ch.id, title, day(b.run_on, 'run_on'), cac, currencyFor(cac, b.currency, 'currency'), user.id),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'distribution', entityId: channelUid, action: 'grow_experiment_added', summary: 'Experiment added' })),
  ]);
  return { uid: id };
}

export const ALERT_MEASURES = ['value', 'change_30d_pct'] as const;
export const ALERT_OPS = ['below', 'above'] as const;

/** Set an alert: a threshold for a count or a percentage, or whole cents for money; never both. */
export async function setKpiAlert(env: Env, pid: number, user: User, kpi: string, b: Body) {
  const measure = oneOf(b.measure, ALERT_MEASURES, 'measure') ?? 'value';
  const op = oneOf(b.op, ALERT_OPS, 'op', true)!;
  const hasThreshold = b.threshold != null && b.threshold !== '';
  const hasCents = b.threshold_cents != null && b.threshold_cents !== '';
  if (hasThreshold === hasCents) throw new Refused(400, 'An alert has one threshold: a number, or an amount in cents', 'threshold');
  let threshold: number | null = null;
  if (hasThreshold) {
    threshold = typeof b.threshold === 'object' || typeof b.threshold === 'boolean' ? NaN : Number(b.threshold);
    if (!Number.isFinite(threshold)) throw new Refused(400, 'threshold is a number', 'threshold');
  }
  const cents = hasCents ? centsOrNull(b.threshold_cents, 'threshold_cents') : null;
  if (cents != null && measure !== 'value') throw new Refused(400, 'A change is a percentage, not an amount', 'threshold_cents');
  const id = newUid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO kpi_alerts (uid, project_id, kpi_key, measure, op, threshold, threshold_cents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, pid, kpi, measure, op, threshold, cents, user.id),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'revenue-and-traction', entityId: kpi, action: 'grow_alert_set', summary: 'Alert set' })),
  ]);
  return { uid: id, kpi };
}

export async function addPartnerDeal(env: Env, pid: number, user: User, partnerUid: string, b: Body) {
  const p = await owned<{ id: number }>(env, 'SELECT id FROM growth_partners WHERE uid = ? AND project_id = ?', partnerUid, pid);
  const customer = str(b.customer, 200);
  if (!customer) throw new Refused(400, 'A deal names its customer', 'customer');
  const amount = centsOrNull(b.amount_cents, 'amount_cents');
  const id = newUid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO growth_partner_deals (uid, partner_id, customer, closed_on, amount_cents, currency, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, p.id, customer, day(b.closed_on, 'closed_on'), amount, currencyFor(amount, b.currency, 'currency'), user.id),
    // The partner's record; the customer is never named in activity.
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'partner-network', entityId: partnerUid, action: 'grow_deal_added', summary: 'Deal added' })),
  ]);
  return { uid: id };
}

export async function addEntryStep(env: Env, pid: number, user: User, marketUid: string, b: Body) {
  const m = await owned<{ id: number }>(env, 'SELECT id FROM markets WHERE uid = ? AND project_id = ?', marketUid, pid);
  const text = str(b.text, 300);
  if (!text) throw new Refused(400, 'A step says what is to be done', 'text');
  const id = newUid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO market_entry_steps (uid, market_id, text, owner_name, due_on) VALUES (?, ?, ?, ?, ?)')
      .bind(id, m.id, text, str(b.owner_name, 120), day(b.due_on, 'due_on')),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'market-expansion', entityId: marketUid, action: 'grow_entry_step_added', summary: 'Entry step added' })),
  ]);
  return { uid: id };
}

export const LOCALISATION_KEYS = ['language', 'payments', 'legal_entity'] as const;

export async function setLocalisation(env: Env, pid: number, user: User, marketUid: string, b: Body) {
  const m = await owned<{ id: number }>(env, 'SELECT id FROM markets WHERE uid = ? AND project_id = ?', marketUid, pid);
  const key = oneOf(b.key, LOCALISATION_KEYS, 'key', true)!;
  const done = b.done === true || b.done === 1 || b.done === '1' || b.done === 'true';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO market_localisation (uid, market_id, key, done_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(market_id, key) DO UPDATE SET done_at = excluded.done_at, updated_at = datetime('now')`,
    ).bind(newUid(), m.id, key, done ? nowIso() : null),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'market-expansion', entityId: marketUid, action: 'grow_localisation_checked',
      summary: `${key.replace('_', ' ')} ${done ? 'done' : 'reopened'}` })),
  ]);
  return { key, done };
}

export async function addAgendaItem(env: Env, pid: number, user: User, eventId: number, b: Body) {
  const e = await owned<{ id: number }>(env, 'SELECT id FROM compliance_events WHERE id = ? AND project_id = ?', eventId, pid);
  const text = str(b.text, 300);
  if (!text) throw new Refused(400, 'An agenda item says what is discussed', 'text');
  const id = newUid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO obligation_agenda_items (uid, event_id, text, owner_name) VALUES (?, ?, ?, ?)').bind(id, e.id, text, str(b.owner_name, 120)),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'durable-company-building', entityId: e.id, action: 'grow_agenda_added', summary: 'Agenda item added' })),
  ]);
  return { uid: id };
}

/** The month length each repeat moves an obligation by (decision 2); a one-time obligation is completed instead. */
const REPEAT_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

/** `YYYY-MM-DD` moved by whole calendar months, clamped to the target month's last day. */
export function addCalendarMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Minutes: a PDF or a DOCX, 20 MB at most, under a key the server makes and that carries no file name. */
const MINUTES_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
export const MINUTES_MAX_BYTES = 20 * 1024 * 1024;
export const minutesPrefix = (pid: number) => `grow-minutes/${pid}/`;

/**
 * Mark held (decision 2): an occurrence (date, notes, optional minutes) and the
 * same obligation moved to its next due date, so its id, agenda and past
 * meetings stay on one record; the reminders it sent are reset. A one-time
 * obligation is completed instead. A clash with another obligation of the
 * same kind on the new date answers 409 and writes nothing.
 */
export async function markHeld(env: Env, pid: number, user: User, eventId: number, b: Body & { minutes?: unknown }) {
  const e = await owned<Row & { id: number; due_date: string; recurrence: string }>(env,
    'SELECT id, kind, event_type, due_date, recurrence FROM compliance_events WHERE id = ? AND project_id = ?', eventId, pid);
  const heldOn = day(b.held_on, 'held_on');
  if (!heldOn) throw new Refused(400, 'When was it held?', 'held_on');
  const file = b.minutes && typeof b.minutes === 'object' && 'arrayBuffer' in (b.minutes as object) ? b.minutes as File : null;
  let key: string | null = null;
  if (file) {
    if (!env.FILES) throw new Refused(503, 'File storage is not configured', 'minutes');
    const ext = MINUTES_TYPES[String(file.type || '').toLowerCase()];
    if (!ext) throw new Refused(415, 'Minutes are a PDF or a DOCX file', 'minutes');
    if (file.size > MINUTES_MAX_BYTES) throw new Refused(413, 'Minutes are 20 MB at most', 'minutes');
    key = `${minutesPrefix(pid)}${newUid()}.${ext}`;
    await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  }
  const months = REPEAT_MONTHS[e.recurrence];
  const next = months ? addCalendarMonths(e.due_date, months) : e.due_date;
  const at = nowIso();
  const occurrence = newUid();
  const statements = [
    env.DB.prepare('INSERT INTO obligation_occurrences (uid, event_id, held_on, minutes_file_key, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(occurrence, e.id, heldOn, key, str(b.notes, 2000), user.id),
    months
      ? env.DB.prepare("UPDATE compliance_events SET due_date = ?, reminders_sent_json = '[]', updated_at = ? WHERE id = ?").bind(next, at, e.id)
      : env.DB.prepare("UPDATE compliance_events SET completion_status = 'completed', completed_at = ?, completed_by_user_id = ?, updated_at = ? WHERE id = ?")
        .bind(at, user.id, at, e.id),
    logCycleWriteStatement(env, entry(pid, user.id, { module: 'durable-company-building', entityId: e.id, action: 'grow_obligation_held',
      summary: months ? `Held on ${heldOn}; next due ${next}` : `Held on ${heldOn}; completed` })),
  ];
  try { await env.DB.batch(statements); } catch (error) {
    if (key) { try { await env.FILES?.delete(key); } catch { /* the stored file is orphaned, never served */ } }
    obligationClash(error, obligationKind(e), next);
  }
  return { id: e.id, occurrence, due_at: next, status: months ? 'pending' : 'completed' };
}

/** Open minutes: one signed download, for a key under this venture's own prefix only; anything else is a 404. */
export async function openMinutes(env: Env, pid: number, user: User, eventId: number, occurrenceId: number) {
  const row = await env.DB.prepare(
    `SELECT o.id, o.minutes_file_key FROM obligation_occurrences o JOIN compliance_events e ON e.id = o.event_id
      WHERE o.id = ? AND o.event_id = ? AND e.project_id = ?`,
  ).bind(occurrenceId, eventId, pid).first<{ id: number; minutes_file_key: string | null }>();
  if (!row || !row.minutes_file_key || !row.minutes_file_key.startsWith(minutesPrefix(pid))) throw new Refused(404, 'Not found', 'occurrence');
  const { token, expires_at } = await mintDownloadToken(env, {
    key: row.minutes_file_key, audience: `grow-minutes:occurrence-${row.id}`, userId: user.id, ttlSec: 120,
  });
  return { open: { url: `/api/files/dl/${token}`, expires_at } };
}
