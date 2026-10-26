/**
 * D1002 (#2817) — Persona segments part 5: the members read, why a member has
 * no segment, the move (one and many), "ask to finish their profile", and the
 * Activity read behind `/admin/persona-segments` (D997, SEG3, SEG5, SEG8).
 *
 * WHO IS A MEMBER. Every active account but admins, as D999 counts them.
 * Admin accounts are on no list and in no count; a deactivated account is on
 * none of these lists.
 *
 * WHAT IS RETURNED PER MEMBER. Who they are (name, email, profile), their
 * segment and second segment, how and when it was set, joined, last active,
 * sub-accounts, whether the segment's profile differs from the account's, and,
 * with no segment, why. What a member answered is never returned: "answered"
 * is a filter only, and the reason "started" says the chat was started, not
 * what was said in it.
 *
 * A value nothing records is null, read "Not recorded", never 0. A store this
 * read needs and cannot read fails the read (5xx), never an empty list; a
 * store only one column needs leaves that column null and names it in
 * `unreadable`.
 */
import type { Env } from '../types';
import { PERSONAS, PERSONA_BY_ID, type PersonaId } from '../personas';
import { retiredSentence, statusesOf } from './segmentProfiles';
import { CONFIDENCE_BANDS, SEGMENT_SOURCES } from './personaSegments';

const DAY_MS = 86_400_000;
/** Rows a page of members or activity holds (SEG3, SEG5: pages of 25). */
export const MEMBERS_PAGE = 25;
/** The most members one bulk move or ask may name (#2817 item 3). */
export const BULK_MAX = 50;
/** A member is asked to finish their profile at most once in this many days. */
export const ASK_EVERY_DAYS = 30;
/** Why a member has no segment (SEG5's chart and column). */
export const WHY = ['not_started', 'started', 'not_offered'] as const;
export type Why = typeof WHY[number];
export const WHY_LABEL: Record<Why, string> = {
  not_started: 'Skipped the sign-up chat',
  started: 'Started, did not finish',
  not_offered: 'Their profile has no segment yet',
};
/** "Last active" windows the filter offers. `never` is no recorded activity. */
export const ACTIVE_WINDOWS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export const MEMBER_SORTS = ['joined', 'last_active', 'name', 'given'] as const;
/** The suggestions store is part 6's (#2818); until it lands the Activity tab says so. */
export const SUGGESTIONS_REASON = 'Suggestions are recorded once part 6 (#2818) lands. None can be listed yet.';
export const ACTIVITY_KINDS = ['move', 'signup', 'segment_edit', 'ask'] as const;

/** A refusal this module words itself: `sentence` is ours, never a store's text. */
export class MembersError extends Error {
  status: number;
  code: string;
  sentence: string;
  constructor(status: number, code: string, sentence: string) { super(code); this.status = status; this.code = code; this.sentence = sentence; }
}

const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const stamp = (v: unknown): number => {
  if (v == null || v === '') return NaN;
  const s = String(v);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
};
const segmentName = (key: string | null, names: Map<string, string>) =>
  key == null ? null : names.get(key) ?? PERSONA_BY_ID[key as PersonaId]?.label ?? key;

async function readable(env: Env, table: string): Promise<boolean> {
  try { await env.DB.prepare('SELECT 1 FROM ' + table + ' LIMIT 0').all(); return true; } catch { return false; }
}

/** Each segment's name, profile and status: HQ's store (D1000) over code's twelve. */
async function segmentTable(env: Env) {
  const statuses = await statusesOf(env);
  const rows = (await env.DB.prepare('SELECT key, name, profile FROM segment_profiles').all<{ key: string; name: string; profile: string }>()).results || [];
  const names = new Map(rows.map((r) => [r.key, r.name]));
  const profiles = new Map<string, string>(PERSONAS.map((p) => [p.id, p.profile]));
  for (const r of rows) profiles.set(r.key, r.profile);
  return { statuses, names, profiles };
}

export type MembersQuery = {
  segment: string | null; // a segment key, 'none', or null for every member
  q: string; profile: string | null; how_set: string | null; band: string | null;
  sub: 'lp' | 'tester' | 'none' | null; answered: boolean | null; active: string | null;
  differs: boolean | null; why: Why | null; sort: typeof MEMBER_SORTS[number]; dir: 'asc' | 'desc'; page: number;
};

/** The query, or the 400 it answers. */
export function parseMembersQuery(get: (k: string) => string | undefined): MembersQuery | { error: string } {
  const v = (k: string) => (get(k) ?? '').trim();
  const pick = <T extends string>(k: string, allowed: readonly T[]): T | null | undefined => {
    const x = v(k); if (!x) return null; return (allowed as readonly string[]).includes(x) ? x as T : undefined;
  };
  const bool = (k: string): boolean | null | undefined => {
    const x = v(k); if (!x) return null; if (x === '1' || x === 'yes') return true; if (x === '0' || x === 'no') return false; return undefined;
  };
  const segment = v('segment') || null;
  if (segment && segment !== 'none' && !/^[a-z0-9_]{1,64}$/.test(segment)) return { error: 'invalid_segment' };
  const profile = pick('profile', ['founder', 'investor', 'advisor', 'partner', 'exploring'] as const);
  const how_set = pick('how_set', [...SEGMENT_SOURCES, 'not_recorded'] as const);
  const band = pick('band', [...CONFIDENCE_BANDS.map((b) => b.key), 'not_recorded'] as const);
  const sub = pick('sub', ['lp', 'tester', 'none'] as const);
  const active = pick('active', [...Object.keys(ACTIVE_WINDOWS), 'never'] as const);
  const why = pick('why', WHY);
  const sort = pick('sort', MEMBER_SORTS);
  const dir = pick('dir', ['asc', 'desc'] as const);
  const answered = bool('answered');
  const differs = bool('differs');
  for (const [k, x] of Object.entries({ profile, how_set, band, sub, active, why, sort, dir, answered, differs })) if (x === undefined) return { error: `invalid_${k}` };
  if (why && segment !== 'none') return { error: 'why_needs_no_segment' };
  const page = Math.max(1, Math.floor(Number(v('page') || 1)) || 1);
  return {
    segment, q: v('q').toLowerCase().slice(0, 120), profile: profile!, how_set: how_set!, band: band!, sub: sub!, answered: answered!,
    active: active!, differs: differs!, why: why!, sort: (sort || 'joined') as MembersQuery['sort'], dir: (dir || (sort === 'name' ? 'asc' : 'desc')) as 'asc' | 'desc', page,
  };
}

const bandOf = (c: unknown): string | null => {
  if (c == null || typeof c !== 'number' || !Number.isFinite(c)) return 'not_recorded';
  return CONFIDENCE_BANDS.find((b) => c >= b.lo && (b.hi == null || c < b.hi))?.key ?? 'not_recorded';
};

/** SEG3 and SEG5: one segment's members, or the members with none, a page at a time with the read's own total. */
export async function readMembers(env: Env, q: MembersQuery, nowMs = Date.now()) {
  const { statuses, names, profiles } = await segmentTable(env);
  const unreadable: string[] = [];
  const has = { lp: await readable(env, 'lp_applications'), tester: await readable(env, 'product_testers'), asks: await readable(env, 'persona_finish_asks'), extras: await readable(env, 'user_profile_extras') };
  if (!has.lp) unreadable.push('sub_accounts.lp');
  if (!has.tester) unreadable.push('sub_accounts.tester');
  if (!has.asks) unreadable.push('asked_at');
  if (!has.extras) unreadable.push('why');
  const rows = (await env.DB.prepare(
    `SELECT u.id AS user_id, u.name, u.email, COALESCE(u.role, '') AS role, u.created_at AS joined,
            COALESCE(u.last_active_at, u.last_active) AS last_active,
            up.persona_id, up.source, up.confidence, up.created_at AS given_at,
            (SELECT p2.persona_id FROM user_personas p2 WHERE p2.user_id = u.id AND p2.is_primary = 0 ORDER BY p2.id DESC LIMIT 1) AS second_segment,
            ` + (has.extras ? 'EXISTS (SELECT 1 FROM user_profile_extras x WHERE x.user_id = u.id)' : 'NULL') + ` AS started,
            ` + (has.lp ? "EXISTS (SELECT 1 FROM lp_applications l WHERE l.user_id = u.id AND l.status = 'approved')" : 'NULL') + ` AS lp,
            ` + (has.tester ? "EXISTS (SELECT 1 FROM product_testers t WHERE t.user_id = u.id AND t.status = 'active')" : 'NULL') + ` AS tester,
            ` + (has.asks ? '(SELECT MAX(f.asked_at) FROM persona_finish_asks f WHERE f.user_id = u.id)' : 'NULL') + ` AS asked_at
       FROM users u
       LEFT JOIN user_personas up ON up.id = (SELECT MAX(p.id) FROM user_personas p WHERE p.user_id = u.id AND p.is_primary = 1)
      WHERE COALESCE(u.role, '') <> 'admin' AND u.is_active <> 0`,
  ).all<any>()).results || [];
  const offered = (role: string) => [...statuses].some(([key, st]) => st === 'active' && (profiles.get(key) === role || profiles.get(key) === 'any'));
  const all = rows.map((r) => {
    const segment = r.persona_id ?? null;
    const segProfile = segment ? profiles.get(segment) ?? null : null;
    const why: Why | null = segment ? null
      : !offered(r.role) ? 'not_offered'
        : r.started == null ? null : Number(r.started) ? 'started' : 'not_started';
    return {
      user_id: Number(r.user_id), name: r.name ?? null, email: r.email ?? null, profile: r.role || null,
      segment: segment ? { key: segment, name: segmentName(segment, names) } : null,
      second_segment: r.second_segment ? { key: r.second_segment, name: segmentName(r.second_segment, names) } : null,
      how_set: segment ? ((SEGMENT_SOURCES as readonly string[]).includes(r.source) ? r.source : 'not_recorded') : null,
      confidence: segment && typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : null,
      given_at: segment ? r.given_at ?? null : null,
      joined: r.joined ?? null,
      last_active: r.last_active ?? null,
      sub_accounts: { lp: r.lp == null ? null : Boolean(Number(r.lp)), tester: r.tester == null ? null : Boolean(Number(r.tester)) },
      profile_differs: segment && segProfile && segProfile !== 'any' ? segProfile !== r.role : null,
      why,
      asked_at: r.asked_at ?? null,
      _started: r.started == null ? null : Boolean(Number(r.started)),
      _band: segment ? bandOf(r.confidence) : null,
    };
  });
  const inScope = all.filter((m) => (q.segment == null ? true : q.segment === 'none' ? m.segment == null : m.segment?.key === q.segment));
  const filtered = inScope.filter((m) => {
    if (q.q && q.q.length >= 2 && ![m.name, m.email].some((s) => String(s ?? '').toLowerCase().includes(q.q))) return false;
    if (q.profile && m.profile !== q.profile) return false;
    if (q.how_set && m.how_set !== q.how_set) return false;
    if (q.band && (m.how_set !== 'router' || m._band !== q.band)) return false;
    if (q.sub === 'lp' && m.sub_accounts.lp !== true) return false;
    if (q.sub === 'tester' && m.sub_accounts.tester !== true) return false;
    if (q.sub === 'none' && (m.sub_accounts.lp !== false || m.sub_accounts.tester !== false)) return false;
    if (q.answered != null && m._started !== q.answered) return false;
    if (q.differs != null && m.profile_differs !== q.differs) return false;
    if (q.why && m.why !== q.why) return false;
    if (q.active) {
      const t = stamp(m.last_active);
      if (q.active === 'never') { if (Number.isFinite(t)) return false; }
      else if (!(Number.isFinite(t) && t >= nowMs - ACTIVE_WINDOWS[q.active as keyof typeof ACTIVE_WINDOWS] * DAY_MS)) return false;
    }
    return true;
  });
  const key = (m: typeof all[number]): string | number | null => {
    switch (q.sort) {
      case 'name': return m.name ? String(m.name).toLowerCase() : null;
      case 'last_active': { const t = stamp(m.last_active); return Number.isFinite(t) ? t : null; }
      case 'given': { const t = stamp(m.given_at); return Number.isFinite(t) ? t : null; }
      default: { const t = stamp(m.joined); return Number.isFinite(t) ? t : null; }
    }
  };
  const sign = q.dir === 'asc' ? 1 : -1;
  // Unknown sorts last either way, never as the smallest value.
  filtered.sort((a, b) => {
    const x = key(a), y = key(b);
    if (x == null && y == null) return b.user_id - a.user_id;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sign || b.user_id - a.user_id;
  });
  const start = (q.page - 1) * MEMBERS_PAGE;
  const rowsOut = filtered.slice(start, start + MEMBERS_PAGE).map(({ _started, _band, ...m }) => m);
  const why_counts = q.segment === 'none'
    ? Object.fromEntries([...WHY, 'not_recorded'].map((w) => [w, inScope.filter((m) => (m.why ?? 'not_recorded') === w).length]))
    : null;
  return { total: filtered.length, page: q.page, page_size: MEMBERS_PAGE, rows: rowsOut, why_counts, unreadable };
}

// ---------------------------------------------------------------- the move

type Admin = { id: number; name?: string | null; email?: string | null; is_super_admin?: boolean; super_admin?: boolean };
export type MoveOutcome = 'moved' | 'unchanged' | 'user_not_found' | 'super_admin_required';

/**
 * The single move's rules (D255, D1000), for one member: the target must
 * exist; an admin target needs a Super Admin; the segment already held is a
 * no-op; a Retired segment takes no one (checked once by the caller). One
 * batch for the demote and set, then the `persona_retagged` activity row and
 * the admin audit row, each naming its subject.
 */
export async function moveOne(env: Env, admin: Admin, superAdmin: boolean, userId: number, personaId: string,
  beforeWrite: () => Promise<void> = async () => {}): Promise<MoveOutcome> {
  const db = env.DB;
  const target = await db.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ id: number; role: string }>();
  if (!target) return 'user_not_found';
  if (target.role === 'admin' && !superAdmin) return 'super_admin_required';
  const current = await db.prepare('SELECT persona_id FROM user_personas WHERE user_id = ? AND is_primary = 1').bind(userId).first<{ persona_id: string }>();
  if (current?.persona_id === personaId) return 'unchanged';
  // The single route checks the segment's status here, after the no-op, as D1000 placed it.
  await beforeWrite();
  await db.batch([
    db.prepare('UPDATE user_personas SET is_primary = 0 WHERE user_id = ?').bind(userId),
    db.prepare(`INSERT INTO user_personas (user_id, persona_id, confidence, manual_override, source, is_primary)
      VALUES (?, ?, 1, 1, 'admin_retag', 1)
      ON CONFLICT(user_id, persona_id) DO UPDATE SET manual_override = 1, source = 'admin_retag', is_primary = 1, updated_at = CURRENT_TIMESTAMP`).bind(userId, personaId),
  ]);
  await db.prepare(`INSERT INTO activity_logs (action, details, actor, user_id, entity_type, entity_id, metadata)
    VALUES ('persona_retagged', ?, ?, ?, 'user', ?, ?)`)
    .bind(`Admin ${admin.name ?? ''} re-tagged user ${userId} as ${personaId}`, admin.email ?? null, admin.id, String(userId),
      JSON.stringify({ from: current?.persona_id ?? null, to: personaId })).run();
  const { logAdminAction } = await import('./adminAudit');
  await logAdminAction(env, admin.id, admin.email ?? '', 'persona_retagged', { target_user_id: userId, from: current?.persona_id ?? null, to: personaId });
  return 'moved';
}

/** A list of distinct member ids, 1 to `BULK_MAX`, or the refusal. */
export function idsOf(v: unknown): number[] {
  if (!Array.isArray(v) || !v.length) throw new MembersError(400, 'user_ids_required', 'Choose at least one member.');
  const ids = [...new Set(v.map((x) => Number(x)))];
  if (ids.some((x) => !Number.isInteger(x) || x <= 0)) throw new MembersError(400, 'invalid_user_ids', 'A member id is not valid.');
  if (ids.length > BULK_MAX) throw new MembersError(400, 'too_many', `Choose at most ${BULK_MAX} members at a time.`);
  return ids;
}

/** The segment a move may use: one code knows or HQ created (D1128), never a Retired one. */
export async function movableSegment(env: Env, personaId: unknown): Promise<string> {
  if (typeof personaId !== 'string') throw new MembersError(400, 'invalid_persona_id', 'Choose a segment.');
  const { statuses, names } = await segmentTable(env).catch(() => { throw new MembersError(503, 'segments_unreadable', 'The segments could not be read just now. Try again in a moment.'); });
  // D1128: a segment HQ created is stored in segment_profiles only.
  if (!(personaId in PERSONA_BY_ID) && !names.has(personaId)) throw new MembersError(400, 'invalid_persona_id', 'Choose a segment.');
  if (statuses.get(personaId) === 'retired') {
    throw new MembersError(409, 'segment_retired', retiredSentence(names.get(personaId) || PERSONA_BY_ID[personaId as PersonaId]?.label || 'This segment'));
  }
  return personaId;
}

/** Bulk move: each member through the single move's rules, one audit row each, one outcome each. */
export async function moveMembers(env: Env, admin: Admin, superAdmin: boolean, userIds: unknown, personaId: unknown) {
  const ids = idsOf(userIds);
  const segment = await movableSegment(env, personaId);
  const results: Array<{ user_id: number; outcome: MoveOutcome | 'failed' }> = [];
  for (const id of ids) {
    try { results.push({ user_id: id, outcome: await moveOne(env, admin, superAdmin, id, segment) }); } catch (e) {
      console.error('[persona-members] a move failed:', (e as Error)?.message);
      results.push({ user_id: id, outcome: 'failed' });
    }
  }
  return { segment, results, moved: results.filter((r) => r.outcome === 'moved').length };
}

// ---------------------------------------------------------------- ask to finish

export const ASK_TITLE = 'Finish your profile';
export const ASK_BODY = 'A few questions help StudioOS show you the programmes, events and people that fit you.';
export const ASK_LINK = '/onboarding/persona';
export type AskOutcome = 'asked' | 'asked_recently' | 'has_segment' | 'not_a_member' | 'user_not_found' | 'failed';

/**
 * "Ask to finish their profile": one notice to each member with no segment,
 * at most once per member in `ASK_EVERY_DAYS`, whoever asks. The 571 row is
 * written first, guarded by the 30-day rule in the same statement, so two
 * admins asking at once send one notice.
 */
export async function askToFinish(env: Env, admin: Admin, userIds: unknown, nowMs = Date.now()) {
  const ids = idsOf(userIds);
  const { notify } = await import('./notify');
  const { logAdminAction } = await import('./adminAudit');
  const since = sqlTime(nowMs - ASK_EVERY_DAYS * DAY_MS);
  const results: Array<{ user_id: number; outcome: AskOutcome }> = [];
  for (const id of ids) {
    const u = await env.DB.prepare(`SELECT u.id, u.role, u.is_active,
        (SELECT 1 FROM user_personas p WHERE p.user_id = u.id AND p.is_primary = 1 LIMIT 1) AS has_segment
      FROM users u WHERE u.id = ?`).bind(id).first<{ id: number; role: string; is_active: number; has_segment: number | null }>();
    if (!u) { results.push({ user_id: id, outcome: 'user_not_found' }); continue; }
    if (u.role === 'admin' || Number(u.is_active) === 0) { results.push({ user_id: id, outcome: 'not_a_member' }); continue; }
    if (u.has_segment) { results.push({ user_id: id, outcome: 'has_segment' }); continue; }
    const wrote = await env.DB.prepare(`INSERT INTO persona_finish_asks (user_id, asked_by, asked_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM persona_finish_asks WHERE user_id = ? AND asked_at > ?)`)
      .bind(id, admin.id, sqlTime(nowMs), id, since).run();
    if (!Number((wrote as any)?.meta?.changes)) { results.push({ user_id: id, outcome: 'asked_recently' }); continue; }
    try {
      await notify(env, { userId: id, type: 'persona_finish_profile', title: ASK_TITLE, body: ASK_BODY, link: ASK_LINK, category: 'proactive_nudges' });
      await logAdminAction(env, admin.id, admin.email ?? '', 'persona_finish_asked', { target_user_id: id });
      results.push({ user_id: id, outcome: 'asked' });
    } catch (e) {
      console.error('[persona-members] a notice failed:', (e as Error)?.message);
      results.push({ user_id: id, outcome: 'failed' });
    }
  }
  return { results, asked: results.filter((r) => r.outcome === 'asked').length, every_days: ASK_EVERY_DAYS };
}

// ---------------------------------------------------------------- activity

/** One SELECT per source, the same seven columns each. */
const SOURCES: Record<typeof ACTIVITY_KINDS[number], { table: string; sql: string }> = {
  move: {
    table: 'activity_logs',
    sql: `SELECT 'move' AS kind, a.created_at AS at, a.user_id AS actor_id, CAST(a.entity_id AS INTEGER) AS member_id,
                 json_extract(a.metadata, '$.from') AS seg_from, json_extract(a.metadata, '$.to') AS seg_to, NULL AS extra
            FROM activity_logs a WHERE a.action = 'persona_retagged' AND a.entity_type = 'user'`,
  },
  signup: {
    table: 'user_personas',
    sql: `SELECT 'signup' AS kind, COALESCE(p.updated_at, p.created_at) AS at, p.user_id AS actor_id, p.user_id AS member_id,
                 NULL AS seg_from, p.persona_id AS seg_to, json_object('how_set', p.source, 'second', CASE WHEN p.is_primary = 1 THEN 0 ELSE 1 END) AS extra
            FROM user_personas p JOIN users su ON su.id = p.user_id
           WHERE p.source IN ('router', 'self_select') AND COALESCE(su.role, '') <> 'admin'`,
  },
  segment_edit: {
    table: 'segment_profile_history',
    sql: `SELECT 'segment_edit' AS kind, h.created_at AS at, h.actor_user_id AS actor_id, NULL AS member_id,
                 NULL AS seg_from, h.segment_key AS seg_to, json_object('fields', json(h.fields_json), 'reason', h.reason) AS extra
            FROM segment_profile_history h WHERE h.action = 'edited'`,
  },
  ask: {
    table: 'persona_finish_asks',
    sql: `SELECT 'ask' AS kind, f.asked_at AS at, f.asked_by AS actor_id, f.user_id AS member_id,
                 NULL AS seg_from, NULL AS seg_to, NULL AS extra
            FROM persona_finish_asks f`,
  },
};

export function parseActivityQuery(get: (k: string) => string | undefined) {
  const kind = (get('kind') ?? '').trim();
  if (kind && !(ACTIVITY_KINDS as readonly string[]).includes(kind)) return { error: 'invalid_kind' } as const;
  return { kind: kind || null, q: (get('q') ?? '').trim().toLowerCase().slice(0, 120), page: Math.max(1, Math.floor(Number(get('page') || 1)) || 1) };
}

/**
 * SEG8: moves, sign-up choices, segment edits and asks to finish, newest
 * first, a page at a time with the read's own total. A source that cannot be
 * read is named in `sources` and left out, never an empty list in its place;
 * suggestions are not recorded until part 6.
 */
export async function readActivity(env: Env, q: { kind: string | null; q: string; page: number }) {
  const sources: Record<string, unknown> = {};
  const parts: string[] = [];
  for (const k of ACTIVITY_KINDS) {
    if (await readable(env, SOURCES[k].table)) { sources[k] = { available: true }; parts.push(SOURCES[k].sql); }
    else sources[k] = { available: false, unreadable: true, reason: `${k === 'ask' ? 'Asks to finish' : k === 'move' ? 'Moves' : k === 'signup' ? 'Sign-up choices' : 'Segment edits'} could not be read on this database. That is not the same as none.` };
  }
  sources.suggestion = { recorded: false, reason: SUGGESTIONS_REASON };
  if (!parts.length) throw new MembersError(503, 'activity_unreadable', 'The activity could not be read. Try again.');
  const like = q.q.length >= 2 ? `%${q.q}%` : '';
  const where = ` WHERE (? = '' OR x.kind = ?) AND (? = '' OR lower(COALESCE(um.name, '')) LIKE ? OR lower(COALESCE(um.email, '')) LIKE ? OR lower(COALESCE(ua.name, '')) LIKE ?)`;
  const from = ' FROM (' + parts.join(' UNION ALL ') + ') x LEFT JOIN users ua ON ua.id = x.actor_id LEFT JOIN users um ON um.id = x.member_id';
  const binds = [q.kind ?? '', q.kind ?? '', like, like, like, like];
  const total = await env.DB.prepare('SELECT COUNT(*) AS n' + from + where).bind(...binds).first<{ n: number }>();
  const rows = (await env.DB.prepare(
    'SELECT x.kind, x.at, x.actor_id, ua.name AS actor_name, ua.role AS actor_role, x.member_id, um.name AS member_name, x.seg_from, x.seg_to, x.extra'
    + from + where + ' ORDER BY x.at DESC, x.kind LIMIT ? OFFSET ?',
  ).bind(...binds, MEMBERS_PAGE, (q.page - 1) * MEMBERS_PAGE).all<any>()).results || [];
  let names = new Map<string, string>();
  try { names = (await segmentTable(env)).names; } catch { /* code's labels stand in */ }
  const parse = (s: unknown) => { try { return s == null ? null : JSON.parse(String(s)); } catch { return null; } };
  return {
    total: Number(total?.n) || 0, page: q.page, page_size: MEMBERS_PAGE, sources,
    rows: rows.map((r) => ({
      kind: r.kind, at: r.at ?? null,
      actor: r.actor_id == null ? null : { user_id: Number(r.actor_id), name: r.actor_name ?? null, role: r.actor_role ?? null },
      member: r.member_id == null ? null : { user_id: Number(r.member_id), name: r.member_name ?? null },
      from: r.seg_from ? { key: r.seg_from, name: segmentName(r.seg_from, names) } : null,
      to: r.seg_to ? { key: r.seg_to, name: segmentName(r.seg_to, names) } : null,
      detail: parse(r.extra),
    })),
  };
}
