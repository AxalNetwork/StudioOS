/** D973 / #2759: read-only AP1/AP3/AP4 network contracts. No client names. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, isSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
import { COHORT_TZ, wallClockToUtcMs } from '../services/cohortTiming';
import { weekStartOf } from '../services/okrWeeks';
import { deckRosterReach } from '../services/decks/deckRoster';
import { kindOf, stageOf, type PersonRow } from '../services/networkStanding';

type Row = Record<string, any>;
type Read<T> = { available: true; recorded: true; value: T } | { available: true; recorded: false; reason: string } | { available: false; reason: string };
const ok = <T>(value: T): Read<T> => ({ available: true, recorded: true, value });
const missing = (reason: string): Read<never> => ({ available: true, recorded: false, reason });
const unreadable = (reason: string): Read<never> => ({ available: false, reason });
const has = <T>(block: Read<T>): block is { available: true; recorded: true; value: T } => block.available && block.recorded;
const rows = (block: Read<Row[]>) => has(block) ? block.value : [];
const STAGE = 'Network stages are not recorded here yet; D976 (#2762) supplies them.';
const DAY = 86_400_000;
const route = new Hono<{ Bindings: Env; Variables: { networkAdmin: any } }>();
route.use('*', async (c, next) => {
  try { c.set('networkAdmin', await requireAdmin(c as any)); }
  catch (error) { return c.json({ detail: 'Admin required' }, (error as Error).message === 'Unauthorized' ? 401 : 403); }
  await next();
});

function stamp(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const v = value.trim();
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v) ? v : v.replace(' ', 'T') + (v.length === 10 ? 'T00:00:00Z' : 'Z'));
}
function dayAt(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: COHORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const midnight = (day: string) => { const [y, m, d] = day.split('-').map(Number); return wallClockToUtcMs(y, m, d); };
function strings(raw: unknown, label: string): Read<string[]> {
  if (raw == null) return missing(`${label} not recorded.`);
  try { const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(value) || value.some(x => typeof x !== 'string')) throw new Error();
    return ok([...new Set(value.map(x => x.trim()).filter(Boolean))]);
  } catch { return unreadable(`${label} could not be read. Try again.`); }
}
const field = (value: unknown, label: string): Read<any> => value == null || value === '' ? missing(`${label} not recorded.`) : ok(value);

async function read(db: D1Database, key: string, sql: string, args: unknown[] = []): Promise<Read<Row[]>> {
  try {
    const result = await db.prepare(sql).bind(...args).all<Row>();
    if (('success' in result && !result.success) || !Array.isArray(result.results)) throw new Error();
    return ok(result.results);
  } catch { console.warn('[admin_network] unreadable block', key); return unreadable(`${key} could not be read. Try again.`); }
}

/** Separate projections deliberately never select emails, client names, notes or payment identifiers. */
async function snapshot(env: Env, actor: any, now: number, includeSettlements = false) {
  const branch = branchOf(env);
  const since = new Date(now - 90 * DAY).toISOString();
  const until = new Date(now).toISOString();
  const today = dayAt(now);
  const entries = await Promise.all([
    read(env.DB, 'accounts', "SELECT id, name, role, headline, partner_id, kyc_status, last_active_at, is_active FROM users WHERE lower(role) IN ('advisor','partner')"),
    read(env.DB, 'advisors', `SELECT a.id, a.user_id, a.display_name, a.bio, a.headline, a.expertise_json, a.sectors_json,
      a.stages_json, a.languages_json, a.country, a.timezone, a.availability_note, a.weekly_hours_band,
      a.linkedin_url, a.hourly_rate_usd, a.is_active, u.id AS member_id, u.role AS member_role
      FROM advisors a LEFT JOIN users u ON u.id = a.user_id
      WHERE lower(COALESCE(u.role,'')) <> 'admin' OR u.id = ? OR ? = 1`, [actor.id, isSuperAdmin(actor) ? 1 : 0]),
    read(env.DB, 'roster', `SELECT id, name, kind, role, company, bio, linkedin_url, skills_json, display_order, is_active,
      CASE WHEN photo_r2_key IS NOT NULL AND photo_r2_key <> '' THEN 1 ELSE 0 END AS has_photo FROM network_profiles ORDER BY display_order, id`),
    read(env.DB, 'firms', 'SELECT id, name, company, specialization, directory_listed, directory_featured FROM partners'),
    read(env.DB, 'profile_checks', 'SELECT user_id, admin_status, updated_at FROM partner_profiles WHERE user_id IS NOT NULL ORDER BY updated_at, user_id'),
    read(env.DB, 'hosts', 'SELECT id, user_id, host_kind, host_id, capacity, status FROM lab_host_applications'),
    read(env.DB, 'deals', "SELECT id, user_id, deal_type, expires_at FROM partner_deals WHERE status = 'active'"),
    read(env.DB, 'advisor_sessions', `SELECT b.advisor_id, s.starts_at, b.status, COUNT(*) AS n FROM advisor_bookings b
      LEFT JOIN advisor_office_hour_slots s ON s.id = b.slot_id
      WHERE datetime(s.starts_at) IS NULL OR (datetime(s.starts_at) >= datetime(?) AND datetime(s.starts_at) <= datetime(?))
      GROUP BY b.advisor_id, s.starts_at, b.status`, [since, until]),
    read(env.DB, 'partner_sessions', `SELECT b.partner_id, s.starts_at, b.status, COUNT(*) AS n FROM partner_bookings b
      LEFT JOIN partner_office_hour_slots s ON s.id = b.slot_id
      WHERE datetime(s.starts_at) IS NULL OR (datetime(s.starts_at) >= datetime(?) AND datetime(s.starts_at) <= datetime(?))
      GROUP BY b.partner_id, s.starts_at, b.status`, [since, until]),
    read(env.DB, 'advisor_ratings', `SELECT b.advisor_id, COUNT(*) AS n, AVG(r.rating) AS average FROM advisor_reviews r
      JOIN advisor_bookings b ON b.id = r.booking_id WHERE r.reviewer_role = 'founder' AND r.rating BETWEEN 1 AND 5 GROUP BY b.advisor_id`),
    read(env.DB, 'open_slots', `SELECT advisor_id, COUNT(*) AS n FROM advisor_office_hour_slots
      WHERE is_cancelled = 0 AND datetime(starts_at) >= datetime(?) AND datetime(starts_at) < datetime(?) GROUP BY advisor_id`, [until, new Date(now + 14 * DAY).toISOString()]),
    read(env.DB, 'cohort_assignments', 'SELECT advisor_user_id, cohort_cycle_id, assigned_at FROM advisor_cohort_assignments WHERE is_active = 1 AND unassigned_at IS NULL'),
    read(env.DB, 'engagements', 'SELECT advisor_id, lane, COUNT(*) AS n FROM advisor_engagements GROUP BY advisor_id, lane'),
    includeSettlements && !branch
      ? read(env.DB, 'settlements', `SELECT id, partner_deal_id, user_id, kind, direction, amount_cents, currency, due_on
          FROM partner_deal_settlements WHERE state = 'issued' AND date(due_on) >= date(?) AND date(due_on) <= date(?) ORDER BY due_on, id`, [today, addDays(today, 30)])
      : Promise.resolve(missing(branch ? 'Settlements are kept by HQ.' : 'Not requested on the people read.')),
  ]);
  const [accounts, advisors, roster, firms, profile_checks, hosts, deals, advisor_sessions, partner_sessions, advisor_ratings, open_slots, cohort_assignments, engagements, settlements] = entries;
  return { branch, accounts, advisors, roster, firms, profile_checks, hosts, deals, advisor_sessions, partner_sessions, advisor_ratings, open_slots, cohort_assignments, engagements, settlements };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function fromRows<T>(block: Read<Row[]>, fn: (value: Row[]) => T): Read<T> {
  if (!has(block)) return block;
  try { return ok(fn(block.value)); } catch { return unreadable('Stored values could not be read. Try again.'); }
}
function combined<T>(blocks: Read<Row[]>[], fn: () => T): Read<T> {
  const failed = blocks.find(b => !has(b));
  if (failed) return failed;
  try { return ok(fn()); } catch { return unreadable('Stored values could not be read. Try again.'); }
}
const take = (block: Read<any>): any => has(block) ? block.value : null;
// Index only this request's result objects, never a database/readiness flag.
const indexes = new WeakMap<Read<Row[]>, Map<string, Map<number, Row[]>>>();
function forId(block: Read<Row[]>, key: string, id: unknown): Row[] {
  if (id == null) return [];
  let fields = indexes.get(block);
  if (!fields) { fields = new Map(); indexes.set(block, fields); }
  let index = fields.get(key);
  if (!index) {
    index = new Map(); fields.set(key, index);
    for (const row of rows(block)) if (row[key] != null) {
      const n = Number(row[key]); const group = index.get(n) ?? []; group.push(row); index.set(n, group);
    }
  }
  return index.get(Number(id)) ?? [];
}
function hourlyRate(value: unknown): Read<Row> {
  if (value == null) return missing('Hourly rate not recorded.');
  if (typeof value !== 'number') return unreadable('Hourly rate could not be read. Try again.');
  const cents = Number(value) * 100;
  return Number.isSafeInteger(cents) && cents >= 0 ? ok({ amount_cents: cents, currency: 'usd' }) : unreadable('Hourly rate could not be read. Try again.');
}
function sessionCounts(block: Read<Row[]>, key: string, id: unknown): Read<Row> {
  if (id == null) return missing('There is no linked office-hours profile.');
  return fromRows(block, list => {
    const out = { booked: 0, completed: 0, no_show: 0, cancelled: 0, total: 0 };
    for (const r of forId(block, key, id)) {
      if (!Number.isFinite(stamp(r.starts_at))) throw new Error();
      const n = Number(r.n);
      if (r.status === 'pending' || r.status === 'confirmed') out.booked += n;
      else if (['completed', 'no_show', 'cancelled'].includes(r.status)) (out as Row)[r.status] += n;
      out.total += n;
    }
    return out;
  });
}

function people(s: Snapshot) {
  const byUser = new Map<number, Row>();
  for (const a of rows(s.advisors)) if (a.member_id != null) byUser.set(Number(a.member_id), a);
  const sources: Array<{ u: Row | null; a: Row | undefined; r: Row | null }> = rows(s.accounts).map(u => ({ u, a: byUser.get(Number(u.id)), r: null as Row | null }));
  const userIds = new Set(rows(s.accounts).map(u => Number(u.id)));
  for (const a of rows(s.advisors)) if (a.member_id == null || !userIds.has(Number(a.member_id))) sources.push({ u: null as any, a, r: null });
  for (const r of rows(s.roster)) sources.push({ u: null, a: undefined, r });
  const shown = rows(s.roster).filter(r => r.is_active).sort((a, b) => a.display_order - b.display_order || a.id - b.id);
  const reaches = deckRosterReach(shown.map(x => x.name));
  const reach = new Map(shown.map((r, i) => [r.id, { reach: reaches[i], position: i + 1 }]));
  return sources.map(({ u, a, r }) => {
    const userId = u?.id ?? a?.member_id ?? null;
    const kind = r ? 'deck_only' : (u?.role ?? a?.member_role)?.toLowerCase() === 'partner' ? 'operating_partner' : 'advisor';
    const firmRow = u?.partner_id == null ? null : forId(s.firms, 'id', u.partner_id)[0];
    const firm: Read<any> = r?.company ? ok({ id: null, name: r.company, source: 'roster_text' }) : userId != null && !has(s.accounts) ? s.accounts : !has(s.firms) ? s.firms : firmRow ? ok({ id: firmRow.id, name: firmRow.name, company: firmRow.company, source: 'account_link' })
      : ok(null);
    const profile = userId == null ? null : forId(s.profile_checks, 'user_id', userId).at(-1);
    const hostRows = userId == null ? [] : forId(s.hosts, 'user_id', userId);
    const dealRows = userId == null ? [] : forId(s.deals, 'user_id', userId);
    const skill = r ? strings(r.skills_json, 'Skills') : a ? strings(a.expertise_json, 'Expertise') : has(s.advisors) ? missing('No per-person skills are recorded.') : s.advisors;
    const sessions = !a && !has(s.advisors) ? s.advisors : a ? sessionCounts(s.advisor_sessions, 'advisor_id', a.id) : missing(kind === 'operating_partner' ? 'Partner sessions are recorded for the firm, not this person.' : 'No linked advisor profile.');
    const rating = !a && !has(s.advisors) ? s.advisors : a ? fromRows(s.advisor_ratings, list => { const v = forId(s.advisor_ratings, 'advisor_id', a.id)[0]; return { count: Number(v?.n ?? 0), average: v?.average == null ? null : Number(v.average) }; }) : missing('No individual advisor rating store is linked.');
    const deck: Read<any> = r ? ok({ roster_id: r.id, shown: !!r.is_active, reach: reach.get(r.id)?.reach ?? 'hidden', position: reach.get(r.id)?.position ?? null, has_photo: !!r.has_photo })
      : missing('No member-to-roster link is recorded yet (D974).');
    return {
      ref: r ? `roster:${r.id}` : userId != null ? `user:${userId}` : `advisor:${a!.id}`,
      user_id: userId, advisor_id: a?.id ?? null, kind,
      name: r?.name ?? a?.display_name ?? u?.name ?? null,
      headline: field(r?.role ?? a?.headline ?? u?.headline, 'Headline'), firm, skills: skill,
      sectors: !a && !has(s.advisors) ? s.advisors : a ? strings(a.sectors_json, 'Sectors') : missing('No per-person sectors are recorded.'),
      stage: missing(STAGE), profile_check: userId == null ? missing('No member account is linked.') : !has(s.profile_checks) ? s.profile_checks : field(profile?.admin_status, 'Profile check'),
      kyc: userId != null && !has(s.accounts) ? s.accounts : u ? field(u.kyc_status, 'KYC') : missing('No account KYC is linked.'),
      lab_host: userId == null ? missing('No member account is linked.') : fromRows(s.hosts, () => hostRows.map(h => ({ id: h.id, status: h.status, capacity: h.capacity }))),
      sessions_90d: sessions, rating, deck,
      active_deals: fromRows(s.deals, () => dealRows.map(d => ({ id: d.id, type: d.deal_type, ends_at: d.expires_at }))),
      hourly_rate: !a && !has(s.advisors) ? s.advisors : a ? hourlyRate(a.hourly_rate_usd) : missing('No hourly rate recorded.'),
      last_active: userId != null && !has(s.accounts) ? s.accounts : u ? field(u.last_active_at, 'Last active') : missing('No account activity timestamp is linked.'),
      member_active: userId != null && !has(s.accounts) ? s.accounts : u ? ok(!!u.is_active) : missing('No member account is linked.'),
      _advisor: a,
    };
  });
}
const publicPerson = ({ _advisor, ...row }: Row) => row;
const core = (s: Snapshot) => [s.accounts, s.advisors, s.roster];
const unreadableKeys = (s: Snapshot) => Object.entries(s).filter(([, value]) => value && typeof value === 'object' && 'available' in value && !value.available).map(([key]) => key);

function weekSeries(s: Snapshot, now: number) {
  return combined([s.advisor_sessions, s.partner_sessions], () => {
    const current = weekStartOf(dayAt(now))!;
    const weeks = Array.from({ length: 12 }, (_, i) => ({ week: addDays(current, (i - 11) * 7), partial: i === 11, booked: 0, completed: 0, no_show: 0, cancelled: 0 }));
    const byWeek = new Map(weeks.map(w => [w.week, w]));
    const month = dayAt(now).slice(0, 7);
    let thisMonth = 0;
    for (const r of [...rows(s.advisor_sessions), ...rows(s.partner_sessions)]) {
      const ms = stamp(r.starts_at);
      if (!Number.isFinite(ms)) throw new Error();
      const date = dayAt(ms); const n = Number(r.n);
      if (date.startsWith(month) && ['pending', 'confirmed', 'completed', 'no_show'].includes(r.status)) thisMonth += n;
      const w = byWeek.get(weekStartOf(date)!);
      if (!w || ms < midnight(weeks[0].week) || ms > now) continue;
      if (r.status === 'pending' || r.status === 'confirmed') w.booked += n;
      else if (['completed', 'no_show', 'cancelled'].includes(r.status)) (w as Row)[r.status] += n;
    }
    return { timezone: COHORT_TZ, as_of: new Date(now).toISOString(), weeks, this_month: thisMonth };
  });
}
function dueSettlements(s: Snapshot) {
  return fromRows(s.settlements, list => {
    if (list.some(r => r.currency !== 'usd' || !Number.isSafeInteger(Number(r.amount_cents)))) throw new Error();
    return { currency: 'usd', count: list.length,
      to_member_cents: list.filter(r => r.direction === 'to_member').reduce((n, r) => n + Number(r.amount_cents), 0),
      from_member_cents: list.filter(r => r.direction === 'from_member').reduce((n, r) => n + Number(r.amount_cents), 0),
      rows: list.map(r => ({ id: r.id, deal_id: r.partner_deal_id, kind: r.kind, direction: r.direction, amount_cents: r.amount_cents, due_on: r.due_on })) };
  });
}

route.get('/overview', async (c) => {
  const now = Date.now(); const s = await snapshot(c.env, c.get('networkAdmin'), now, true); const list = people(s);
  const endings = rows(s.deals).filter(d => stamp(d.expires_at) >= now && stamp(d.expires_at) <= now + 30 * DAY);
  const sessions = weekSeries(s, now); const settlements = dueSettlements(s);
  const roles = new Map([...rows(s.advisors).map(a => [Number(a.member_id), a.member_role] as const), ...rows(s.accounts).map(u => [Number(u.id), u.role] as const)]);
  const kindFor = (p: Row) => p.kind === 'deck_only' ? 'deck_only' : kindOf({ role: roles.get(Number(p.user_id)), advisor_id: p.advisor_id }) ?? p.kind;
  // D977 / D976: use the standing rule, not roster visibility or guessed stages.
  // This projection is only needed by C1 and fails independently of other blocks.
  const standingRows = await read(c.env.DB, 'network_stages', `SELECT u.id AS user_id, u.role,
    u.is_active AS user_active, u.partner_id, a.id AS advisor_id, a.is_active AS advisor_active,
    p.status AS firm_status, n.paused_at
    FROM users u LEFT JOIN advisors a ON a.user_id = u.id
    LEFT JOIN partners p ON p.id = u.partner_id
    LEFT JOIN network_member_states n ON n.user_id = u.id
    WHERE (lower(u.role) IN ('advisor','partner') OR a.id IS NOT NULL)
      AND (lower(u.role) <> 'admin' OR u.id = ? OR ? = 1)`, [c.get('networkAdmin').id, isSuperAdmin(c.get('networkAdmin')) ? 1 : 0]);
  const byStage = combined([...core(s), standingRows], () => {
    const states = new Map(rows(standingRows).map(r => [Number(r.user_id), r]));
    const groups = new Map<string, { kind: string; stage: string | null; count: number }>();
    for (const person of list) {
      const row = person.kind === 'deck_only' ? null : states.get(Number(person.user_id));
      const kind = row ? kindOf(row as PersonRow) ?? person.kind : person.kind;
      const stage = row ? stageOf(row as PersonRow) : null;
      const key = `${kind}:${stage}`;
      const group = groups.get(key) ?? { kind, stage, count: 0 };
      group.count++; groups.set(key, group);
    }
    return [...groups.values()];
  });
  return c.json({ as_of: new Date(now).toISOString(), scope: s.branch ?? 'hq', timezone: COHORT_TZ,
    counts: {
      people: combined(core(s), () => list.length),
      by_kind: combined(core(s), () => ['advisor', 'operating_partner', 'deck_only'].map(kind => ({ kind, count: list.filter(p => kindFor(p) === kind).length }))),
      by_stage: byStage,
      firms: fromRows(s.firms, value => ({ total: value.length, listed: value.filter(f => f.directory_listed).length })),
      lab_hosts: fromRows(s.hosts, value => ({ approved: value.filter(h => h.status === 'approved').length, pending: value.filter(h => h.status === 'pending').length })),
      cohort_assignments: fromRows(s.cohort_assignments, value => value.length),
    },
    sessions,
    deals: fromRows(s.deals, value => ({ total: value.length, ending_soon: endings.length,
      by_type: [...new Set(value.map(d => d.deal_type))].sort().map(type => { const group = value.filter(d => d.deal_type === type); const dates = group.map(d => d.expires_at).filter(d => Number.isFinite(stamp(d))).sort((a, b) => stamp(a) - stamp(b)); return { type, count: group.length, soonest_end: dates[0] ?? null }; }) })),
    settlements,
    skills: combined([s.advisors, s.roster], () => {
      const supply = new Map<string, number>();
      for (const p of list) { if (!has(p.skills)) { if (!p.skills.available) throw new Error(); continue; } for (const skill of p.skills.value) supply.set(skill, (supply.get(skill) ?? 0) + 1); }
      return { supply: [...supply].sort(([a], [b]) => a.localeCompare(b)).map(([skill, count]) => ({ skill, count })), demand: missing('Founder skill requests are not recorded in a matching demand store.') };
    }),
    needs_you: {
      missing_advisor_profiles: combined([s.accounts, s.advisors], () => rows(s.accounts).filter(u => u.role.toLowerCase() === 'advisor' && !rows(s.advisors).some(a => Number(a.member_id) === Number(u.id))).map(u => ({ ref: `user:${u.id}`, name: u.name, href: '/admin/accounts' }))),
      unattached_partners: combined([s.accounts, s.firms], () => rows(s.accounts).filter(u => u.role.toLowerCase() === 'partner' && !rows(s.firms).some(f => Number(f.id) === Number(u.partner_id))).map(u => ({ ref: `user:${u.id}`, name: u.name, href: '/admin/advisors-partners/firms' }))),
      ending_deals: fromRows(s.deals, () => endings.map(d => ({ id: d.id, type: d.deal_type, ends_at: d.expires_at, href: '/admin/partner-invitations' }))),
      pending_hosts: fromRows(s.hosts, value => value.filter(h => h.status === 'pending').map(h => ({ id: h.id, href: '/admin/programs/spinout-lab/hosts' }))),
      missing_deck_photos: fromRows(s.roster, () => list.filter(p => p.kind === 'deck_only' && take(p.deck)?.reach === 'profile' && !take(p.deck)?.has_photo).map(p => ({ ref: p.ref, name: p.name, href: '/admin/advisors-partners/deck' }))),
      settlements,
    }, unreadable: [...unreadableKeys(s), ...(standingRows.available ? [] : ['network_stages'])],
  });
});

const FILTERS = ['kind', 'skill', 'sector', 'lab_host', 'profile_check', 'kyc', 'on_deck', 'firm_attached', 'active_deal'] as const;
const SORTS = ['name_asc', 'name_desc', 'firm_asc', 'sessions_desc', 'rating_desc', 'last_active_desc'] as const;
function options(list: Row[]) {
  const values = (key: string) => [...new Set(list.flatMap(p => { const v = take(p[key]); return Array.isArray(v) ? v : typeof v === 'string' ? [v] : []; }))].sort();
  return { kind: ['advisor', 'operating_partner', 'deck_only'], stage: missing(STAGE), skill: values('skills'), sector: values('sectors'), profile_check: values('profile_check'), kyc: values('kyc'), sort: SORTS };
}
function filtered(list: Row[], query: URLSearchParams) {
  const q = (query.get('q') ?? '').trim().toLowerCase();
  return list.filter(p => {
    const firm = take(p.firm);
    if (q && ![p.name, take(p.headline), firm?.name, firm?.company, ...(take(p.skills) ?? [])].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
    for (const key of FILTERS) {
      const wanted = query.get(key); if (wanted == null || wanted === '') continue;
      if (key === 'kind') { if (p.kind !== wanted) return false; continue; }
      if (['skill', 'sector'].includes(key)) { if (!(take(p[key === 'skill' ? 'skills' : 'sectors']) ?? []).some((v: string) => v.toLowerCase() === wanted.toLowerCase())) return false; continue; }
      if (key === 'profile_check' || key === 'kyc') {
        if (wanted === 'not_recorded' ? !(p[key].available && p[key].recorded === false) : take(p[key]) !== wanted) return false;
        continue;
      }
      if (key === 'lab_host') { if (!(take(p.lab_host) ?? []).some((h: Row) => h.status === wanted)) return false; continue; }
      const expected = wanted === 'true' || wanted === '1';
      const actual = key === 'on_deck' ? take(p.deck)?.reach === 'profile' : key === 'firm_attached' ? firm?.source === 'account_link' : (take(p.active_deals) ?? []).length > 0;
      const block = key === 'on_deck' ? p.deck : key === 'firm_attached' ? p.firm : p.active_deals;
      if (!has(block) || actual !== expected) return false;
    }
    return true;
  });
}
route.get('/people', async (c) => {
  const query = new URL(c.req.url).searchParams;
  const limit = Number(query.get('limit') ?? 25), offset = Number(query.get('offset') ?? 0), sort = query.get('sort') ?? 'name_asc';
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || !SORTS.includes(sort as any) || (query.get('q')?.length ?? 0) > 200) return c.json({ detail: 'Invalid paging, search or sort.' }, 400);
  if (query.get('stage')) return c.json({ detail: STAGE, recorded: false }, 400);
  if (query.has('kind') && !['advisor', 'operating_partner', 'deck_only', ''].includes(query.get('kind')!)) return c.json({ detail: 'Invalid kind.' }, 400);
  for (const key of ['on_deck', 'firm_attached', 'active_deal']) if (query.get(key) && !['true', 'false', '1', '0'].includes(query.get(key)!)) return c.json({ detail: `Invalid ${key}.` }, 400);
  const s = await snapshot(c.env, c.get('networkAdmin'), Date.now()); const all = people(s);
  const dependencies: Record<string, Read<Row[]>[]> = { q: [s.firms, s.advisors, s.roster], skill: [s.advisors, s.roster], sector: [s.advisors], lab_host: [s.hosts], profile_check: [s.profile_checks], on_deck: [s.roster], firm_attached: [s.firms], active_deal: [s.deals] };
  if (Object.entries(dependencies).some(([key, deps]) => query.get(key) && deps.some(b => !has(b)))) return c.json({ available: false, detail: 'A requested search/filter source could not be read. Try again.', reason: 'A requested search/filter source could not be read. Try again.', unreadable: unreadableKeys(s) }, 503);
  const checkedFields = new Set<'headline' | 'firm' | 'skills' | 'sectors'>();
  if (query.get('q')) for (const key of ['headline', 'firm', 'skills'] as const) checkedFields.add(key);
  if (query.get('skill')) checkedFields.add('skills');
  if (query.get('sector')) checkedFields.add('sectors');
  if (all.some(p => [...checkedFields].some(key => !p[key].available))) return c.json({ available: false, detail: 'A requested search/filter value could not be read. Try again.', reason: 'A requested search/filter value could not be read. Try again.' }, 503);
  const list = filtered(all, query);
  const scalar = (p: Row): any => sort === 'firm_asc' ? take(p.firm)?.name ?? null : sort === 'sessions_desc' ? take(p.sessions_90d)?.total ?? null : sort === 'rating_desc' ? take(p.rating)?.average ?? null : sort === 'last_active_desc' ? Number.isFinite(stamp(take(p.last_active))) ? stamp(take(p.last_active)) : null : p.name;
  list.sort((a, b) => { const av = scalar(a), bv = scalar(b); if (av == null || bv == null) return av == null && bv == null ? a.ref.localeCompare(b.ref) : av == null ? 1 : -1;
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'en', { sensitivity: 'base' });
    return (sort === 'name_desc' || sort.endsWith('_desc') ? -cmp : cmp) || a.ref.localeCompare(b.ref);
  });
  const complete = core(s).every(has);
  return c.json({ available: complete, ...(complete ? {} : { reason: 'Some people could not be read. Try again.' }), items: list.slice(offset, offset + limit).map(publicPerson), total: complete ? list.length : null, limit, offset, sort, filters: options(all), unreadable: unreadableKeys(s) });
});

route.get('/people/:ref', async (c, next) => {
  const ref = c.req.param('ref');
  // D976 keeps the numeric account-standing read; opaque D973 refs use this drawer.
  if (/^[0-9]+$/.test(ref)) return next();
  if (!/^(?:user|advisor|roster):[1-9]\d*$/.test(ref)) return c.json({ detail: 'Person not found.' }, 404);
  const s = await snapshot(c.env, c.get('networkAdmin'), Date.now()); const row = people(s).find(p => p.ref === ref);
  if (!row) return core(s).every(has) ? c.json({ detail: 'Person not found.' }, 404) : c.json({ available: false, detail: 'The person could not be read. Try again.', reason: 'The person could not be read. Try again.' }, 503);
  const a = row._advisor;
  return c.json({ person: publicPerson(row), profile: !has(s.advisors) ? s.advisors : a ? ok({ bio: a.bio, stages: strings(a.stages_json, 'Stages'), languages: strings(a.languages_json, 'Languages'), country: field(a.country, 'Country'), timezone: field(a.timezone, 'Timezone'), availability_note: field(a.availability_note, 'Availability'), weekly_hours: field(a.weekly_hours_band, 'Weekly hours'), linkedin_url: field(a.linkedin_url, 'LinkedIn') }) : missing('No advisor profile is linked.'),
    work: {
      sessions_90d: row.sessions_90d,
      firm_sessions_90d: row.kind === 'operating_partner' ? !has(row.firm) ? row.firm : sessionCounts(s.partner_sessions, 'partner_id', take(row.firm)?.id) : missing('No operating-partner firm.'),
      open_slots_14d: !has(s.advisors) ? s.advisors : a ? fromRows(s.open_slots, value => Number(value.find(v => Number(v.advisor_id) === Number(a.id))?.n ?? 0)) : missing('No advisor profile linked.'),
      cohort_assignments: fromRows(s.cohort_assignments, value => value.filter(v => row.user_id != null && Number(v.advisor_user_id) === Number(row.user_id)).map(v => ({ cohort_id: v.cohort_cycle_id, assigned_at: v.assigned_at }))),
      engagements: !has(s.advisors) ? s.advisors : a ? fromRows(s.engagements, value => ['drafting', 'proposed', 'signed', 'renewal_due', 'ended'].map(lane => ({ lane, count: Number(value.find(v => Number(v.advisor_id) === Number(a.id) && v.lane === lane)?.n ?? 0) }))) : missing('No individual advisor engagement store linked.'),
    }, terms: { hourly_rate: row.hourly_rate, active_deals: row.active_deals, payout_readiness: missing('Payout readiness is supplied by D976 (#2762).'), studio_agreement: missing('A signed studio agreement is not recorded in this read yet (D976).') },
    history: missing('A network-person history read is not recorded yet (D974/D976).'), unreadable: unreadableKeys(s) });
});
export default route;
