/**
 * D1300 (#3396, part 1 of #2377) — All accounts: the list read behind
 * `GET /api/admin/users`, with the canvas's filters, sorts and columns
 * (ACC2, ACC3) and totals over the filtered set.
 *
 * WHAT IS READ. This deployment's own `users` table: HQ's on HQ, a
 * subsidiary's on that subsidiary. A branch is its own Worker over its own
 * D1, so no row here belongs to another studio; a `scope` naming another
 * studio is refused by the route before any read (`hq_only` for a plain
 * Admin, `scope_unavailable` for a Super Admin, since HQ does not fan out a
 * list of names and emails).
 *
 * EVERY STATEMENT IS BOUND. The WHERE clause is assembled from the fixed
 * fragments below, each with `?` placeholders, and every value the caller
 * sent travels in `binds`. No caller text reaches the query text: a value
 * outside a filter's allowed set is a 400 before the query is built.
 *
 * WITHIN A FILTER, ANY; ACROSS FILTERS, ALL. `profile=founder,investor` is
 * founders or investors; adding `status=active` keeps the active ones.
 *
 * A VALUE NOTHING RECORDS IS NULL, never 0: a trust score with no required
 * obligation, a profile completeness never computed, a last activity never
 * logged. A store only one column needs (personas, LP applications, product
 * testers, mentor cohorts, legal obligations) that cannot be read leaves that
 * column null and is named in `unreadable`; a filter or sort that needs it is
 * refused (503 `filter_unreadable`) rather than answered as "none match".
 */
import type { Env } from '../types';
import { likeNeedle } from '../util/likeSearch';

/**
 * THE ONE RULE FOR DEACTIVATED ACCOUNTS, shared with the overview read
 * (D1301). An account is deactivated when `users.is_active = 0`, and only
 * then. The list shows deactivated accounts, each marked, unless
 * `status=active` asks otherwise; every count here says active and
 * deactivated apart (`by_status`). The overview counts active accounts and
 * puts the deactivated beside them (`studioGlance.hqAccounts`: `total` over
 * `is_active = 1`, `deactivated` over `is_active = 0`), so neither read ever
 * folds one into the other.
 */
export const DEACTIVATED_RULE = 'An account is deactivated when users.is_active = 0. Lists show it marked unless asked for active only; every total says active and deactivated apart.';
export const ACTIVE_SQL = 'u.is_active <> 0';
export const DEACTIVATED_SQL = 'u.is_active = 0';

/** Today's console asks for 100 a page; the canvas for 25. The most is 200. */
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 200;

export const PROFILES = ['founder', 'investor', 'advisor', 'partner', 'exploring', 'admin'] as const;
export const SUBS = ['lp', 'tester', 'none'] as const;
export const STATUSES = ['active', 'deactivated'] as const;
export const EMAILS = ['verified', 'unverified'] as const;
/** `users.kyc_status` as `routes/kyc.ts` writes it; `pending` is the canvas's "Waiting". */
export const IDENTITY = ['not_started', 'pending', 'needs_info', 'approved', 'rejected', 'expired'] as const;
export const LIMITED = ['on', 'off'] as const;
export const JOINED = ['7d', '30d'] as const;
export const ACTIVE = ['7d', '30d', 'over_30d', 'never'] as const;
export const PROGRAMS = ['lab', 'mentor', 'testing'] as const;
export const TRUST = ['under_50', '50_79', '80_up', 'not_recorded'] as const;
export const SORTS = ['joined_desc', 'joined_asc', 'active_desc', 'active_asc', 'name_asc', 'completeness_asc', 'trust_asc'] as const;

/** Why a row's trust is null: the canvas's own sentence. */
export const TRUST_NOT_RECORDED = 'Not recorded: no obligation applies yet';

export type AccountsQuery = {
  q: string | null;
  profile: string[]; sub: string[]; status: string[]; email: string[]; identity: string[];
  limited: string[]; plan: string[]; country: string[]; persona: string[]; program: string[]; trust: string[];
  joined: string | null; joined_from: string | null; joined_to: string | null; active: string | null;
  sort: typeof SORTS[number]; limit: number; offset: number;
};

export type Parsed = { ok: true; query: AccountsQuery } | { ok: false; code: string; detail: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WORD = /^[a-z0-9_]{1,40}$/;
const COUNTRY = /^[\p{L} .'-]{2,64}$/u;

/** The query, or the 400 it answers. A value outside a filter's set is refused, never ignored. */
export function parseAccountsQuery(get: (k: string) => string | undefined): Parsed {
  const raw = (k: string) => String(get(k) ?? '').trim();
  const list = (k: string) => raw(k).split(',').map((s) => s.trim()).filter(Boolean);
  const bad = (k: string, detail: string): Parsed => ({ ok: false, code: `invalid_${k}`, detail });
  const oneOf = (k: string, allowed: readonly string[]) => {
    const xs = [...new Set(list(k).map((s) => s.toLowerCase()))];
    return xs.every((x) => allowed.includes(x)) ? xs : null;
  };
  const sets: Array<[string, readonly string[]]> = [
    ['profile', PROFILES], ['sub', SUBS], ['status', STATUSES], ['email', EMAILS], ['identity', IDENTITY],
    ['limited', LIMITED], ['program', PROGRAMS], ['trust', TRUST],
  ];
  const picked: Record<string, string[]> = {};
  for (const [k, allowed] of sets) {
    const xs = oneOf(k, allowed);
    if (!xs) return bad(k, `${k} must be one or more of: ${allowed.join(', ')}.`);
    picked[k] = xs;
  }
  const plan = [...new Set(list('plan').map((s) => s.toLowerCase()))];
  if (!plan.every((p) => WORD.test(p))) return bad('plan', 'plan must be plan names (letters, digits, underscores).');
  const persona = [...new Set(list('persona').map((s) => s.toLowerCase()))];
  if (!persona.every((p) => WORD.test(p))) return bad('persona', 'persona must be segment keys.');
  const country = [...new Set(list('country'))];
  if (!country.every((x) => COUNTRY.test(x)) || country.length > 20) return bad('country', 'country must be up to 20 country names.');

  const joined = raw('joined').toLowerCase() || null;
  if (joined && !(JOINED as readonly string[]).includes(joined)) return bad('joined', `joined must be one of: ${JOINED.join(', ')}.`);
  const joined_from = raw('joined_from') || null;
  const joined_to = raw('joined_to') || null;
  for (const [k, v] of [['joined_from', joined_from], ['joined_to', joined_to]] as const) {
    if (v && (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) return bad(k, `${k} must be a date, YYYY-MM-DD.`);
  }
  if (joined && (joined_from || joined_to)) return bad('joined', 'Use joined, or joined_from and joined_to, not both.');
  if (joined_from && joined_to && joined_from > joined_to) return bad('joined_from', 'joined_from is after joined_to.');
  const active = raw('active').toLowerCase() || null;
  if (active && !(ACTIVE as readonly string[]).includes(active)) return bad('active', `active must be one of: ${ACTIVE.join(', ')}.`);
  const sort = (raw('sort').toLowerCase() || 'joined_desc') as AccountsQuery['sort'];
  if (!(SORTS as readonly string[]).includes(sort)) return bad('sort', `sort must be one of: ${SORTS.join(', ')}.`);

  const qRaw = raw('q');
  const q = qRaw ? likeNeedle(qRaw) : null;
  if (qRaw && q === null) return { ok: false, code: 'query_too_short', detail: 'Type at least two characters to search.' };

  const n = parseInt(raw('limit'), 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
  const o = parseInt(raw('offset'), 10);
  const offset = Number.isFinite(o) && o > 0 ? o : 0;

  return {
    ok: true,
    query: {
      q, profile: picked.profile, sub: picked.sub, status: picked.status, email: picked.email, identity: picked.identity,
      limited: picked.limited, plan, country, persona, program: picked.program, trust: picked.trust,
      joined, joined_from, joined_to, active, sort, limit, offset,
    },
  };
}

/** Whether the read was asked anything beyond the page: a search, a filter or a sort. */
export function narrowed(q: AccountsQuery): boolean {
  return Boolean(q.q || q.joined || q.joined_from || q.joined_to || q.active
    || [q.profile, q.sub, q.status, q.email, q.identity, q.limited, q.plan, q.country, q.persona, q.program, q.trust].some((xs) => xs.length));
}

async function readable(env: Env, table: string): Promise<boolean> {
  try { await env.DB.prepare('SELECT 1 FROM ' + table + ' LIMIT 0').all(); return true; } catch { return false; }
}

/**
 * The `users` columns a database may predate. The baseline has them all; a
 * column this database lacks reads NULL and is named in `unreadable`.
 */
export const OPTIONAL_COLUMNS = ['last_active_at', 'last_active', 'country', 'subscription_tier', 'profile_completion_pct', 'spinout_lab_active', 'kyc_status', 'access_level'] as const;
type Col = typeof OPTIONAL_COLUMNS[number];

async function userColumns(env: Env): Promise<Set<string>> {
  try {
    const rows = (await env.DB.prepare('PRAGMA table_info(users)').all<{ name: string }>()).results || [];
    return new Set(rows.map((r) => String(r.name)));
  } catch { return new Set(); }
}

/** Which optional stores and columns this database can read. Each feeds one column. */
async function stores(env: Env) {
  const [persona, lp, tester, mentor, trust, cols] = await Promise.all([
    readable(env, 'user_personas'), readable(env, 'lp_applications'), readable(env, 'product_testers'),
    readable(env, 'advisor_cohort_assignments'), readable(env, 'legal_obligations'), userColumns(env),
  ]);
  const col = Object.fromEntries(OPTIONAL_COLUMNS.map((c) => [c, cols.has(c)])) as Record<Col, boolean>;
  return { persona, lp, tester, mentor, trust, col };
}

const ph = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * The row source: every column the list and its filters use, one row per
 * account. Optional stores the database cannot read become NULL columns.
 */
function source(has: Awaited<ReturnType<typeof stores>>): string {
  const c = (name: Col) => (has.col[name] ? 'u.' + name : 'NULL');
  const last = has.col.last_active_at && has.col.last_active ? 'COALESCE(u.last_active_at, u.last_active)' : has.col.last_active_at ? 'u.last_active_at' : has.col.last_active ? 'u.last_active' : 'NULL';
  return `SELECT u.id, u.uid, u.email, u.name, u.role, u.is_active, u.email_verified,
            ` + c('kyc_status') + ` AS kyc_status, ` + c('access_level') + ` AS access_level,
            u.created_at, ` + last + ` AS last_active_at, ` + c('country') + ` AS country,
            ` + c('subscription_tier') + ` AS subscription_tier, ` + c('profile_completion_pct') + ` AS profile_completion_pct,
            ` + (has.col.spinout_lab_active ? 'COALESCE(u.spinout_lab_active, 0)' : 'NULL') + ` AS in_lab,
            ` + (has.persona ? '(SELECT p.persona_id FROM user_personas p WHERE p.user_id = u.id AND p.is_primary = 1 ORDER BY p.id DESC LIMIT 1)' : 'NULL') + ` AS persona,
            ` + (has.lp ? "EXISTS (SELECT 1 FROM lp_applications l WHERE l.user_id = u.id AND l.status = 'approved')" : 'NULL') + ` AS is_lp,
            ` + (has.tester ? "EXISTS (SELECT 1 FROM product_testers t WHERE t.user_id = u.id AND t.status = 'active')" : 'NULL') + ` AS is_tester,
            ` + (has.mentor ? 'EXISTS (SELECT 1 FROM advisor_cohort_assignments m WHERE m.advisor_user_id = u.id AND m.is_active = 1)' : 'NULL') + ` AS in_mentor,
            ` + (has.trust ? '(SELECT COUNT(*) FROM legal_obligations o WHERE o.user_id = u.id AND o.required = 1)' : 'NULL') + ` AS trust_required,
            ` + (has.trust ? "(SELECT COUNT(*) FROM legal_obligations o WHERE o.user_id = u.id AND o.required = 1 AND o.status IN ('satisfied', 'waived'))" : 'NULL') + ` AS trust_met
       FROM users u`;
}

/** The trust score as `trustScoreOf` computes it, NULL where no required obligation applies. */
const TRUST_SCORE = 'CASE WHEN a.trust_required IS NULL OR a.trust_required = 0 THEN NULL ELSE CAST(ROUND(100.0 * a.trust_met / a.trust_required) AS INTEGER) END';

const ORDER: Record<AccountsQuery['sort'], string> = {
  joined_desc: 'datetime(a.created_at) IS NULL, datetime(a.created_at) DESC, a.id DESC',
  joined_asc: 'datetime(a.created_at) IS NULL, datetime(a.created_at) ASC, a.id ASC',
  active_desc: 'datetime(a.last_active_at) IS NULL, datetime(a.last_active_at) DESC, a.id DESC',
  active_asc: 'datetime(a.last_active_at) IS NULL, datetime(a.last_active_at) ASC, a.id ASC',
  name_asc: "a.name IS NULL OR trim(a.name) = '', lower(a.name) ASC, a.id ASC",
  completeness_asc: 'a.profile_completion_pct IS NULL, a.profile_completion_pct ASC, a.id ASC',
  trust_asc: 'a.trust_score IS NULL, a.trust_score ASC, a.id ASC',
};

/** The WHERE clause from fixed fragments, and its binds in order. `skip` leaves one filter out. */
function where(q: AccountsQuery, nowMs: number, skip: 'status' | null = null): { text: string; binds: unknown[] } {
  const parts: string[] = [];
  const binds: unknown[] = [];
  const any = (alts: string[]) => { if (alts.length) parts.push('(' + alts.join(' OR ') + ')'); };
  const now = sqlTime(nowMs);
  if (q.q) {
    parts.push("(a.name LIKE ? ESCAPE '\\' OR a.email LIKE ? ESCAPE '\\' OR a.uid LIKE ? ESCAPE '\\')");
    binds.push(q.q, q.q, q.q);
  }
  if (q.profile.length) { parts.push('a.role IN (' + ph(q.profile.length) + ')'); binds.push(...q.profile); }
  any(q.sub.map((s) => (s === 'lp' ? 'a.is_lp = 1' : s === 'tester' ? 'a.is_tester = 1' : '(a.is_lp = 0 AND a.is_tester = 0)')));
  if (skip !== 'status') any(q.status.map((s) => (s === 'active' ? 'a.is_active <> 0' : 'a.is_active = 0')));
  any(q.email.map((s) => (s === 'verified' ? 'a.email_verified = 1' : 'COALESCE(a.email_verified, 0) = 0')));
  if (q.identity.length) {
    // A row with no status recorded is "Not started", as `users.kyc_status` defaults.
    parts.push("COALESCE(a.kyc_status, 'not_started') IN (" + ph(q.identity.length) + ')');
    binds.push(...q.identity);
  }
  any(q.limited.map((s) => (s === 'on' ? "a.access_level = 'limited'" : "COALESCE(a.access_level, '') <> 'limited'")));
  if (q.plan.length) { parts.push("lower(COALESCE(a.subscription_tier, 'free')) IN (" + ph(q.plan.length) + ')'); binds.push(...q.plan); }
  if (q.country.length) { parts.push('lower(a.country) IN (' + ph(q.country.length) + ')'); binds.push(...q.country.map((c) => c.toLowerCase())); }
  if (q.persona.length) { parts.push('a.persona IN (' + ph(q.persona.length) + ')'); binds.push(...q.persona); }
  any(q.program.map((p) => (p === 'lab' ? 'a.in_lab = 1' : p === 'mentor' ? 'a.in_mentor = 1' : 'a.is_tester = 1')));
  any(q.trust.map((t) => (t === 'under_50' ? 'a.trust_score < 50'
    : t === '50_79' ? 'a.trust_score BETWEEN 50 AND 79'
      : t === '80_up' ? 'a.trust_score >= 80' : 'a.trust_score IS NULL')));
  if (q.joined) { parts.push("datetime(a.created_at) >= datetime(?, ?)"); binds.push(now, q.joined === '7d' ? '-7 days' : '-30 days'); }
  if (q.joined_from) { parts.push('date(a.created_at) >= ?'); binds.push(q.joined_from); }
  if (q.joined_to) { parts.push('date(a.created_at) <= ?'); binds.push(q.joined_to); }
  if (q.active === 'never') parts.push('a.last_active_at IS NULL');
  else if (q.active === 'over_30d') { parts.push("datetime(a.last_active_at) < datetime(?, '-30 days')"); binds.push(now); }
  else if (q.active) { parts.push('datetime(a.last_active_at) >= datetime(?, ?)'); binds.push(now, q.active === '7d' ? '-7 days' : '-30 days'); }
  return { text: parts.length ? ' WHERE ' + parts.join(' AND ') : '', binds };
}

/** The filters and sort that need a store this database cannot read. */
function needs(q: AccountsQuery, has: Awaited<ReturnType<typeof stores>>): string[] {
  const out: string[] = [];
  if (q.persona.length && !has.persona) out.push('persona');
  if (q.sub.some((s) => s === 'lp' || s === 'none') && !has.lp) out.push('sub');
  if ((q.sub.some((s) => s === 'tester' || s === 'none') || q.program.includes('testing')) && !has.tester) out.push(q.program.includes('testing') ? 'program' : 'sub');
  if (q.program.includes('mentor') && !has.mentor) out.push('program');
  if ((q.trust.length || q.sort === 'trust_asc') && !has.trust) out.push(q.sort === 'trust_asc' && !q.trust.length ? 'sort' : 'trust');
  const col = has.col;
  if ((q.active || q.sort.startsWith('active')) && !col.last_active_at && !col.last_active) out.push(q.active ? 'active' : 'sort');
  if (q.country.length && !col.country) out.push('country');
  if (q.plan.length && !col.subscription_tier) out.push('plan');
  if (q.sort === 'completeness_asc' && !col.profile_completion_pct) out.push('sort');
  if (q.program.includes('lab') && !col.spinout_lab_active) out.push('program');
  if (q.identity.length && !col.kyc_status) out.push('identity');
  if (q.limited.length && !col.access_level) out.push('limited');
  return [...new Set(out)];
}

export class AccountsReadError extends Error {
  status: number; code: string; detail: string;
  constructor(status: number, code: string, detail: string) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

const bool = (v: unknown): boolean | null => (v == null ? null : Boolean(Number(v)));

/** One row as the list returns it. Nothing recorded is null, never 0. */
function rowOut(r: any) {
  const required = r.trust_required == null ? null : Number(r.trust_required);
  const met = r.trust_met == null ? null : Number(r.trust_met);
  return {
    id: Number(r.id), uid: r.uid, email: r.email, name: r.name, role: r.role,
    // 0 and 1, as the route always answered them: callers compare them as numbers.
    is_active: Number(r.is_active) === 0 ? 0 : 1, email_verified: Number(r.email_verified) === 1 ? 1 : 0,
    kyc_status: r.kyc_status ?? null, access_level: r.access_level ?? null,
    created_at: r.created_at ?? null, last_active_at: r.last_active_at ?? null,
    country: r.country ? String(r.country) : null,
    subscription_tier: r.subscription_tier ? String(r.subscription_tier) : null,
    profile_completion_pct: r.profile_completion_pct == null ? null : Number(r.profile_completion_pct),
    persona: r.persona ?? null,
    sub_accounts: { lp: bool(r.is_lp), tester: bool(r.is_tester) },
    programs: { lab: bool(r.in_lab), mentor: bool(r.in_mentor), testing: bool(r.is_tester) },
    trust: required == null ? null : {
      score: r.trust_score == null ? null : Number(r.trust_score),
      open: required - (met ?? 0),
      reason: required === 0 ? TRUST_NOT_RECORDED : null,
    },
  };
}

/**
 * The page and the totals over the filtered set. `matched` counts every row
 * the filters keep, across every page, and `matched_by_role` splits it.
 * `status_split` counts active and deactivated under every filter but the
 * status one, so the Status filter can say what each choice would show.
 * `total` and `by_role` (the route's) stay counts over the whole table, as
 * D128 made them, so the console's tiles do not change.
 */
export async function listAccounts(env: Env, q: AccountsQuery, nowMs = Date.now()) {
  const has = await stores(env);
  const blocked = needs(q, has);
  if (blocked.length) {
    throw new AccountsReadError(503, 'filter_unreadable',
      `This database cannot read what ${blocked.join(' and ')} filters on. Nothing was filtered; clear it and try again.`);
  }
  const unreadable = [
    !has.persona && 'persona', !has.lp && 'sub_accounts.lp', !has.tester && 'sub_accounts.tester',
    !has.mentor && 'programs.mentor', !has.trust && 'trust',
    ...OPTIONAL_COLUMNS.filter((c) => !has.col[c] && c !== 'last_active' && !(c === 'last_active_at' && has.col.last_active)),
  ].filter(Boolean) as string[];

  const from = '(SELECT b.*, ' + TRUST_SCORE.replace(/a\./g, 'b.') + ' AS trust_score FROM (' + source(has) + ') AS b) AS a';
  const w = where(q, nowMs);
  const page = await env.DB.prepare('SELECT a.* FROM ' + from + w.text + ' ORDER BY ' + ORDER[q.sort] + ' LIMIT ? OFFSET ?')
    .bind(...w.binds, q.limit, q.offset).all<any>();
  // Status is split out, so the split leaves the status filter aside: "12 active, 3 deactivated" of the rest.
  const ws = where(q, nowMs, 'status');
  const split = await env.DB.prepare(
    'SELECT a.role AS role, CASE WHEN a.is_active = 0 THEN 1 ELSE 0 END AS off, COUNT(*) AS n FROM ' + from + ws.text + ' GROUP BY 1, 2',
  ).bind(...ws.binds).all<{ role: string | null; off: number; n: number }>();
  const statusOn = (off: number) => !q.status.length || q.status.includes(off ? 'deactivated' : 'active');
  const by_status = { active: 0, deactivated: 0 };
  const by_role: Record<string, number> = {};
  let matched = 0;
  for (const s of split.results || []) {
    const n = Number(s.n) || 0;
    by_status[Number(s.off) ? 'deactivated' : 'active'] += n;
    if (!statusOn(Number(s.off))) continue;
    matched += n;
    const role = String(s.role || 'no role');
    by_role[role] = (by_role[role] || 0) + n;
  }
  const results = (page.results || []).map(rowOut);
  return {
    results,
    matched,
    status_split: by_status,
    matched_by_role: by_role,
    showing: results.length,
    from: results.length ? q.offset + 1 : 0,
    to: q.offset + results.length,
    limit: q.limit,
    offset: q.offset,
    next_offset: q.offset + results.length < matched ? q.offset + results.length : null,
    sort: q.sort,
    unreadable,
    deactivated_rule: DEACTIVATED_RULE,
  };
}
