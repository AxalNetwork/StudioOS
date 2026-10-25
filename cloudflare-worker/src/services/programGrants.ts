/**
 * D982 (#2773, part 1 of #2376) — Program grants: what HQ grants a licensed
 * studio, and on what terms. The store is migration 553; the routes are
 * `routes/admin_program_grants.ts`.
 *
 * THE PROGRAMS ARE THE CANVAS'S NINE, on the keys the Programs catalogue
 * (D953) and the grid (`frontend/src/lib/programGrants.js`, D981) use. The
 * Worker cannot import the frontend, so the list is repeated here and
 * `program_grants_d982.test.ts` holds the two equal.
 *
 * A TERM NOBODY SET IS NULL and reads "Not recorded" (D797), never a zero or
 * a default passed off as a decision. Each program carries only the terms the
 * canvas gives it (GR4: "Credits, HQ approval and cohorts a year do not apply
 * to Learning, so they are hidden"); a write naming a term that does not apply
 * is refused rather than stored.
 */
import type { Env } from '../types';

export type ProgramReadiness = 'yes' | 'hq' | 'notready';
export const PROGRAMS: Array<{ key: string; name: string; group: string; readiness: ProgramReadiness }> = [
  { key: 'spinout-lab', name: 'Spin-Out Lab', group: 'Ventures', readiness: 'yes' },
  { key: 'ai-native-venture', name: 'AI-native Venture', group: 'Ventures', readiness: 'notready' },
  { key: 'mentor-cohorts', name: 'Mentor cohort access', group: 'Access', readiness: 'yes' },
  { key: 'investor-cohorts', name: 'Investor cohort access', group: 'Access', readiness: 'notready' },
  { key: 'referral-partners', name: 'Referral partners', group: 'Network and referrals', readiness: 'yes' },
  { key: 'refer-and-earn', name: 'Refer & Earn', group: 'Network and referrals', readiness: 'yes' },
  { key: 'perks', name: 'Perks', group: 'Rewards', readiness: 'yes' },
  { key: 'learning', name: 'Learning', group: 'Learning', readiness: 'yes' },
  { key: 'product-testing', name: 'Product testing', group: 'Product', readiness: 'hq' },
];
export const PROGRAM_KEYS = PROGRAMS.map((p) => p.key);
export const programOf = (key: string) => PROGRAMS.find((p) => p.key === key) || null;

/** Why a program can never be granted, whatever its defaults say. */
export function readinessRefusal(key: string): string | null {
  const p = programOf(key);
  if (!p) return 'There is no such program.';
  if (p.readiness === 'hq') return `${p.name} stays at HQ, so it cannot be granted to a studio.`;
  if (p.readiness === 'notready') return `${p.name} is not ready to grant.`;
  return null;
}

type Kind = 'date' | 'flag' | 'count' | 'positive' | 'cents' | 'bps' | 'currency' | 'enum';
const ALL = PROGRAM_KEYS;
const CAPACITY = ['spinout-lab', 'mentor-cohorts', 'learning'];
export const TERM_FIELDS: Array<{ key: string; kind: Kind; values?: string[]; applies: string[]; defaultable: boolean }> = [
  { key: 'starts_on', kind: 'date', applies: ALL, defaultable: false },
  { key: 'ends_on', kind: 'date', applies: ALL, defaultable: false },
  { key: 'ends_with_licence', kind: 'flag', applies: ALL, defaultable: true },
  { key: 'capacity_cap', kind: 'positive', applies: CAPACITY, defaultable: true },
  { key: 'capacity_uncapped', kind: 'flag', applies: CAPACITY, defaultable: true },
  { key: 'cohorts_per_year', kind: 'count', applies: ['spinout-lab', 'mentor-cohorts'], defaultable: true },
  { key: 'credits_per_quarter', kind: 'count', applies: ['refer-and-earn', 'perks'], defaultable: true },
  { key: 'fee_cents', kind: 'cents', applies: ALL, defaultable: true },
  { key: 'currency', kind: 'currency', applies: ALL, defaultable: true },
  { key: 'hq_share_bps', kind: 'bps', applies: ['spinout-lab', 'referral-partners', 'refer-and-earn', 'perks', 'learning'], defaultable: true },
  { key: 'hq_approves_each_cohort', kind: 'flag', applies: ['spinout-lab', 'mentor-cohorts'], defaultable: true },
  { key: 'hq_approval_above_cents', kind: 'cents', applies: ['referral-partners'], defaultable: true },
  { key: 'playbook', kind: 'enum', values: ['as_written', 'may_adapt'], applies: ALL, defaultable: true },
  { key: 'brand', kind: 'enum', values: ['axal', 'studio'], applies: ALL, defaultable: true },
  { key: 'reporting', kind: 'enum', values: ['monthly', 'quarterly', 'yearly'], applies: ALL, defaultable: true },
  { key: 'requires_signed_schedule', kind: 'flag', applies: ALL, defaultable: true },
];
export const TERM_KEYS = TERM_FIELDS.map((f) => f.key);
export const DEFAULT_KEYS = TERM_FIELDS.filter((f) => f.defaultable).map((f) => f.key);
export const termsFor = (programKey: string) => TERM_FIELDS.filter((f) => f.applies.includes(programKey)).map((f) => f.key);

export type Terms = Record<string, string | number | null>;
export type TermError = { field: string; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function one(f: (typeof TERM_FIELDS)[number], v: unknown): { ok: true; value: string | number | null } | { ok: false; message: string } {
  if (v === null) return { ok: true, value: null };
  switch (f.kind) {
    case 'date':
      return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
        ? { ok: true, value: v } : { ok: false, message: 'must be a date, YYYY-MM-DD' };
    case 'flag':
      if (v === true || v === 1) return { ok: true, value: 1 };
      if (v === false || v === 0) return { ok: true, value: 0 };
      return { ok: false, message: 'must be true or false' };
    case 'currency':
      return typeof v === 'string' && /^[A-Za-z]{3}$/.test(v) ? { ok: true, value: v.toUpperCase() } : { ok: false, message: 'must be a three-letter currency code' };
    case 'enum':
      return typeof v === 'string' && f.values!.includes(v) ? { ok: true, value: v } : { ok: false, message: `must be one of ${f.values!.join(', ')}` };
    default: {
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) return { ok: false, message: 'must be a whole number' };
      if (f.kind === 'positive' && v < 1) return { ok: false, message: 'must be 1 or more' };
      if (v < 0) return { ok: false, message: 'cannot be negative' };
      if (f.kind === 'bps' && v > 10000) return { ok: false, message: 'cannot be more than 10000 (100%)' };
      return { ok: true, value: v };
    }
  }
}

/**
 * The terms a write names, checked. Only the keys present change; `null`
 * clears one. A key that is not a term, or a term that does not apply to the
 * program, is refused. `defaults` checks against the defaultable terms.
 */
export function validateTerms(programKey: string, input: unknown, opts: { defaults?: boolean } = {}):
  { ok: true; terms: Terms } | { ok: false; errors: TermError[] } {
  if (input == null) return { ok: true, terms: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ field: 'terms', message: 'must be an object' }] };
  const applies = new Set(termsFor(programKey));
  const errors: TermError[] = [];
  const terms: Terms = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const f = TERM_FIELDS.find((x) => x.key === k);
    if (!f || (opts.defaults && !f.defaultable)) { errors.push({ field: k, message: 'is not a term HQ sets here' }); continue; }
    if (!applies.has(k)) { errors.push({ field: k, message: `does not apply to ${programOf(programKey)?.name || programKey}` }); continue; }
    const r = one(f, v);
    if (!r.ok) errors.push({ field: k, message: r.message });
    else terms[k] = r.value;
  }
  // Capacity is either a cap or "No cap", never both.
  const cap = terms.capacity_cap ?? null;
  if (cap != null && terms.capacity_uncapped === 1) errors.push({ field: 'capacity_uncapped', message: 'cannot be set with a capacity cap' });
  return errors.length ? { ok: false, errors } : { ok: true, terms };
}

/** Every term of a stored row, null where nobody set it, only the ones that apply to its program. */
export function termsOf(row: Record<string, unknown>, programKey: string): Terms {
  return Object.fromEntries(termsFor(programKey).map((k) => [k, (row[k] as string | number | null | undefined) ?? null]));
}

/** The keys whose value differs, with before and after. */
export function termsDiff(before: Terms, after: Terms) {
  const out: Array<{ key: string; before: string | number | null; after: string | number | null }> = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    if (b !== a) out.push({ key: k, before: b, after: a });
  }
  return out;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type ScheduleStatus = 'not_sent' | 'sent' | 'signed';

/** D1120 — where a grant's schedule stands: signed once its time is set, sent once an envelope is named. */
export function scheduleStatus(row: { schedule_contract_uid?: unknown; schedule_signed_at?: unknown }): ScheduleStatus {
  if (row.schedule_signed_at) return 'signed';
  if (row.schedule_contract_uid) return 'sent';
  return 'not_sent';
}

export type LicenceLite = { id: number; uid: string; licence_ref: string | null; brand_name: string | null; kind: string | null; status: string; renews_on: string | null };

/**
 * One grant as HQ reads it. `in_force` holds only when the grant is granted,
 * the licence is active, its start has come, its end has not passed, and its
 * schedule is signed unless HQ switched that rule off. A rule nobody recorded
 * (null) is treated as on: the default is on (D981 §5, decision 3), and a
 * grant must not run on a schedule nobody signed because a term was blank.
 */
export function presentGrant(row: Record<string, any>, licence: LicenceLite, today: string) {
  const key = String(row.program_key);
  const terms = termsOf(row, key);
  const end = row.ends_on || (Number(row.ends_with_licence) === 1 ? (licence.renews_on ? String(licence.renews_on).slice(0, 10) : null) : null);
  const waiting: string[] = [];
  if (row.state === 'granted') {
    if (licence.status !== 'active') waiting.push('licence_active');
    // `Number(null)` is 0, so the rule is read as off only when it was recorded as 0.
    const ruleOff = row.requires_signed_schedule != null && Number(row.requires_signed_schedule) === 0;
    if (!ruleOff && !row.schedule_signed_at) waiting.push('schedule_signed');
    if (row.starts_on && String(row.starts_on) > today) waiting.push('start_date');
    if (end && end < today) waiting.push('ended_by_date');
  }
  return {
    uid: row.uid,
    licence_uid: licence.uid,
    program_key: key,
    state: row.state as 'granted' | 'paused' | 'ended',
    terms,
    effective_end: end,
    in_force: row.state === 'granted' && waiting.length === 0,
    waiting_on: waiting,
    // D1120: not sent, sent (an envelope is named) or signed (its time is set).
    schedule: {
      status: scheduleStatus(row),
      contract_uid: (row.schedule_contract_uid ?? null) as string | null,
      signed_at: (row.schedule_signed_at ?? null) as string | null,
    },
    note: row.note ?? null,
    paused_at: row.paused_at ?? null,
    ended_at: row.ended_at ?? null,
    set_by_user_id: row.set_by_user_id ?? null,
    set_at: row.set_at,
  };
}

export type Grant = ReturnType<typeof presentGrant>;

/** The defaults of every program, in catalogue order, with why a locked one cannot be switched on. */
export async function readDefaults(env: Env) {
  const rows = (await env.DB.prepare('SELECT * FROM program_grant_defaults').all<Record<string, any>>()).results || [];
  const by = new Map(rows.map((r) => [String(r.program_key), r]));
  return PROGRAMS.map((p) => {
    const r = by.get(p.key) || {};
    return {
      program_key: p.key,
      name: p.name,
      group: p.group,
      readiness: p.readiness,
      grantable: p.readiness === 'yes' && Number(r.grantable) === 1,
      locked_reason: readinessRefusal(p.key),
      terms: Object.fromEntries(termsFor(p.key).filter((k) => DEFAULT_KEYS.includes(k)).map((k) => [k, r[k] ?? null])),
      applies: termsFor(p.key),
      updated_by_user_id: r.updated_by_user_id ?? null,
      updated_at: r.updated_at ?? null,
    };
  });
}

export const REQUESTS_UNREADABLE = 'Program requests could not be read. That is not the same as none.';
/** Requests by month: the current month, so far, and the five before it. */
export const REQUEST_MONTHS = 6;

/**
 * D983: the program requests' tile and series, from `hq_escalations`. Waiting
 * is every open program request, on HQ's lane and every branch's. By month,
 * each month counts the requests sent in it, as they stand now: still
 * waiting, approved, declined or withdrawn. A failed read is null with its
 * reason, never 0.
 */
async function readRequestFigures(env: Env, today: string) {
  try {
    const open = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM hq_escalations
        WHERE status = 'open' AND kind IN ('program_grant', 'program_terms_change', 'program_end')`,
    ).first<{ n: number }>();
    const months: string[] = [];
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    for (let i = REQUEST_MONTHS - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const rows = ((await env.DB.prepare(
      `SELECT substr(created_at, 1, 7) AS month, status, COUNT(*) AS n FROM hq_escalations
        WHERE kind IN ('program_grant', 'program_terms_change', 'program_end') AND substr(created_at, 1, 7) >= ?
        GROUP BY 1, 2`,
    ).bind(months[0]).all<{ month: string; status: string; n: number }>()).results || []);
    const by = (month: string, status: string) => rows.filter((r) => r.month === month && r.status === status).reduce((t, r) => t + Number(r.n), 0);
    return {
      waiting: Number(open?.n ?? 0),
      by_month: months.map((month) => ({
        month,
        so_far: month === months[months.length - 1],
        waiting: by(month, 'open'),
        approved: by(month, 'answered'),
        declined: by(month, 'declined'),
        withdrawn: by(month, 'withdrawn'),
      })),
    };
  } catch (e) {
    console.error('[program-grants] requests', (e as Error)?.message);
    return null;
  }
}

/**
 * HQ's grid (GR1): every licence that holds or may hold a territory, its
 * grants by program, the tiles and the two series. A draft or terminated
 * licence is left out, as the page leaves it out (D981 §2).
 */
export async function readGrid(env: Env, today: string) {
  const licences = ((await env.DB.prepare(
    `SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences
      WHERE status NOT IN ('draft', 'terminated') ORDER BY licence_ref, id`,
  ).all<LicenceLite>()).results || []);
  const grants = ((await env.DB.prepare('SELECT * FROM program_grants ORDER BY id').all<Record<string, any>>()).results || []);
  const byLicence = new Map<number, Grant[]>();
  const lic = new Map(licences.map((l) => [l.id, l]));
  for (const g of grants) {
    const l = lic.get(Number(g.licence_id));
    if (!l) continue;
    const list = byLicence.get(l.id) || [];
    list.push(presentGrant(g, l, today));
    byLicence.set(l.id, list);
  }
  const all = [...byLicence.values()].flat();
  const live = all.filter((g) => g.state !== 'ended');
  const requests = await readRequestFigures(env, today);
  const horizon = addDays(today, 90);
  const fees = new Map<string, number>();
  let feesUnrecorded = 0;
  for (const g of all.filter((x) => x.state === 'granted')) {
    const fee = g.terms.fee_cents;
    const cur = g.terms.currency;
    if (fee == null || cur == null) { feesUnrecorded += 1; continue; }
    fees.set(String(cur), (fees.get(String(cur)) || 0) + Number(fee));
  }
  return {
    licences: licences.map((l) => ({
      uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, kind: l.kind, status: l.status,
      grants: Object.fromEntries((byLicence.get(l.id) || []).map((g) => [g.program_key, g])),
    })),
    tiles: {
      in_force: all.filter((g) => g.in_force).length,
      granted: all.filter((g) => g.state === 'granted').length,
      paused: all.filter((g) => g.state === 'paused').length,
      requests_waiting: requests ? requests.waiting : null,
      requests_waiting_reason: requests ? null : REQUESTS_UNREADABLE,
      ending_in_90_days: live.filter((g) => g.effective_end && g.effective_end >= today && g.effective_end <= horizon).length,
      fees_a_year: [...fees.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, cents]) => ({ currency, cents })),
      fees_not_recorded: feesUnrecorded,
    },
    series: {
      holding: PROGRAMS.map((p) => ({
        program_key: p.key,
        granted: live.filter((g) => g.program_key === p.key && g.state === 'granted').length,
        paused: live.filter((g) => g.program_key === p.key && g.state === 'paused').length,
      })),
      requests_by_month: requests ? requests.by_month : null,
      requests_by_month_reason: requests ? null : REQUESTS_UNREADABLE,
    },
  };
}

/** A licence's program history: its `program_changed` events, newest first. */
export async function readHistory(env: Env, licenceId: number, programKey?: string | null) {
  const rows = ((await env.DB.prepare(
    `SELECT e.id, e.detail_json, e.note, e.actor_user_id, e.created_at, u.name AS actor_name
       FROM licence_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.licence_id = ? AND e.event = 'program_changed'
      ORDER BY e.created_at DESC, e.id DESC LIMIT 200`,
  ).bind(licenceId).all<Record<string, any>>()).results || []);
  return rows.map((r) => {
    let d: Record<string, any> = {};
    try { d = r.detail_json ? JSON.parse(r.detail_json) : {}; } catch { d = {}; }
    return {
      id: r.id, action: d.action ?? null, program_key: d.program_key ?? null, changed: Array.isArray(d.changed) ? d.changed : [],
      reason: r.note ?? null, actor_user_id: r.actor_user_id ?? null, actor_name: r.actor_name ?? null, at: r.created_at,
    };
  }).filter((e) => !programKey || e.program_key === programKey);
}
