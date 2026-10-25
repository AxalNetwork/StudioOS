/**
 * D999 (#2814) — Persona segments part 2: the segments read behind
 * `GET /api/personas/admin/segments` (D997's page, SEG1, SEG2's tiles, SEG7,
 * SEG10–SEG12).
 *
 * Counts only. No row names, emails or ids a member; nothing a member
 * answered is read. It counts every account, not the newest 500 the list
 * returns (D997's Guard L), and it leaves admin accounts out of every count.
 * Deactivated accounts are left out too, and counted apart.
 *
 * Every block is either `{ available: true, … }` or
 * `{ available: false, unreadable: true, reason }`, so one failed count never
 * blanks the page. A value nothing records is null with a reason, never 0.
 *
 * A member's segment is their primary `user_personas` row. Should an account
 * ever hold two primaries, the newest row (highest id) is the one counted,
 * so no account is counted twice.
 */
import type { Env } from '../types';
import { PERSONAS, PERSONA_BY_ID } from '../personas';
import { PRODUCT_TESTERS_REASON } from './adminInsights';

type Unreadable = { available: false; unreadable: true; reason: string };
type NotRecorded = { recorded: false; reason: string };

const DAY_MS = 86_400_000;
/** Weeks drawn in "New segment tags per week" (SEG1: eight, the current one to date). */
export const SEGMENT_WEEKS = 8;
/** The account profiles a segment can belong to (D998), in the canvas's order. */
export const SEGMENT_PROFILES = ['founder', 'investor', 'advisor', 'partner', 'exploring'] as const;
/** How a segment was set: `user_personas.source`. */
export const SEGMENT_SOURCES = ['router', 'self_select', 'admin_retag'] as const;
/** "How sure the sign-up suggestion was": D997's four bands over `confidence` (0–1). */
export const CONFIDENCE_BANDS = [
  { key: 'under_50', lo: 0, hi: 0.5 },
  { key: '50_69', lo: 0.5, hi: 0.7 },
  { key: '70_89', lo: 0.7, hi: 0.9 },
  { key: '90_up', lo: 0.9, hi: null },
] as const;

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[persona-segments]', what, (e as Error)?.message ?? e);
  return { available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` };
};

/** `YYYY-MM-DD HH:MM:SS`, SQLite's own format (D162). */
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

/** The Monday (UTC) of the week holding `ms`, as `YYYY-MM-DD`. */
export function mondayOf(ms: number): string {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

type MemberRow = {
  role: string; active: number; persona_id: string | null; source: string | null;
  band: string | null; new_30d: number; n: number;
};

/**
 * One grouped pass over every account but admins: active or not, role,
 * primary segment, how it was set, the confidence band, and whether the
 * segment was given in the last 30 days. Every member block folds from it, so
 * their totals are the same total.
 */
async function memberRows(env: Env, nowMs: number): Promise<MemberRow[]> {
  const q = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(u.role), ''), '') AS role,
            CASE WHEN u.is_active = 0 THEN 0 ELSE 1 END AS active,
            up.persona_id AS persona_id,
            up.source AS source,
            CASE
              WHEN up.id IS NULL THEN NULL
              WHEN up.confidence IS NULL OR typeof(up.confidence) NOT IN ('integer', 'real') THEN 'not_recorded'
              WHEN up.confidence < 0.5 THEN 'under_50'
              WHEN up.confidence < 0.7 THEN '50_69'
              WHEN up.confidence < 0.9 THEN '70_89'
              ELSE '90_up'
            END AS band,
            CASE WHEN up.id IS NOT NULL AND datetime(up.created_at) >= datetime(?, '-30 days') THEN 1 ELSE 0 END AS new_30d,
            COUNT(*) AS n
       FROM users u
       LEFT JOIN user_personas up
         ON up.id = (SELECT MAX(p.id) FROM user_personas p WHERE p.user_id = u.id AND p.is_primary = 1)
      WHERE COALESCE(u.role, '') <> 'admin'
      GROUP BY 1, 2, 3, 4, 5, 6`,
  ).bind(sqlTime(nowMs)).all<MemberRow>();
  return (q.results || []).map((r) => ({ ...r, active: n(r.active), new_30d: n(r.new_30d), n: n(r.n) }));
}

/** Members with an approved LP application, by their segment (the Insights definition of an LP). */
async function lpRows(env: Env): Promise<Array<{ persona_id: string | null; n: number }>> {
  const q = await env.DB.prepare(
    `SELECT up.persona_id AS persona_id, COUNT(DISTINCT u.id) AS n
       FROM lp_applications l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN user_personas up
         ON up.id = (SELECT MAX(p.id) FROM user_personas p WHERE p.user_id = u.id AND p.is_primary = 1)
      WHERE l.status = 'approved' AND u.is_active = 1 AND COALESCE(u.role, '') <> 'admin'
      GROUP BY 1`,
  ).all<{ persona_id: string | null; n: number }>();
  return (q.results || []).map((r) => ({ persona_id: r.persona_id, n: n(r.n) }));
}

/** The day each member's current segment was first given, for the weekly chart. */
async function tagDays(env: Env): Promise<Array<{ day: string | null; n: number }>> {
  const q = await env.DB.prepare(
    `SELECT date(up.created_at) AS day, COUNT(*) AS n
       FROM users u
       JOIN user_personas up
         ON up.id = (SELECT MAX(p.id) FROM user_personas p WHERE p.user_id = u.id AND p.is_primary = 1)
      WHERE u.is_active = 1 AND COALESCE(u.role, '') <> 'admin'
      GROUP BY 1`,
  ).all<{ day: string | null; n: number }>();
  return (q.results || []).map((r) => ({ day: r.day, n: n(r.n) }));
}

/** Re-tags of members by an admin in the last 30 days (D255's `persona_retagged` rows). */
async function movesCount(env: Env, nowMs: number): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM activity_logs a
       JOIN users u ON CAST(u.id AS TEXT) = a.entity_id
      WHERE a.action = 'persona_retagged' AND a.entity_type = 'user'
        AND datetime(a.created_at) >= datetime(?, '-30 days')
        AND COALESCE(u.role, '') <> 'admin'`,
  ).bind(sqlTime(nowMs)).first<{ n: number }>();
  return n(r?.n);
}

async function settle<T>(what: string, read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; block: Unreadable }> {
  try {
    return { ok: true, value: await read() };
  } catch (e) {
    return { ok: false, block: unreadable(what, e) };
  }
}

const profileOf = (id: string | null) => (id && id in PERSONA_BY_ID ? PERSONA_BY_ID[id as keyof typeof PERSONA_BY_ID].profile : null);

export async function readPersonaSegments(env: Env, nowMs: number = Date.now()) {
  const [members, lps, days, moves] = await Promise.all([
    settle('The accounts and their segments', () => memberRows(env, nowMs)),
    settle('The LP applications', () => lpRows(env)),
    settle('The dates segments were given', () => tagDays(env)),
    settle('The admin moves', () => movesCount(env, nowMs)),
  ]);

  const live = members.ok ? members.value.filter((r) => r.active === 1) : [];
  const sum = (rows: MemberRow[]) => rows.reduce((t, r) => t + r.n, 0);
  const memberBlock = <T>(build: () => T): ({ available: true } & T) | Unreadable =>
    (members.ok ? { available: true, ...build() } : members.block);

  const known = new Set<string>(PERSONAS.map((p) => p.id));
  const tagged = live.filter((r) => r.persona_id);

  // Per segment: members, given in 30 days, still Explorers, and profile differs.
  const segmentRows = () => {
    const ids = [...PERSONAS.map((p) => p.id as string),
      ...[...new Set(tagged.map((r) => r.persona_id as string))].filter((id) => !known.has(id)).sort()];
    return ids.map((id) => {
      const rows = tagged.filter((r) => r.persona_id === id);
      const profile = profileOf(id);
      return {
        id,
        in_taxonomy: known.has(id),
        profile,
        members: sum(rows),
        new_30d: sum(rows.filter((r) => r.new_30d === 1)),
        still_explorers: sum(rows.filter((r) => r.role === 'exploring')),
        // A segment the taxonomy does not know has no profile to differ from.
        profile_differs: profile === null ? null : sum(rows.filter((r) => r.role !== profile)),
      };
    });
  };

  // Weeks: Monday UTC, the current week to date. A week before any segment
  // was dated is not 0: nothing was recorded then, so it is null (a break).
  const weekly = (): ({ available: true } & Record<string, unknown>) | Unreadable => {
    if (!days.ok) return days.block;
    const thisMonday = Date.parse(`${mondayOf(nowMs)}T00:00:00Z`);
    const starts = Array.from({ length: SEGMENT_WEEKS }, (_, i) => thisMonday - (SEGMENT_WEEKS - 1 - i) * 7 * DAY_MS);
    const dated = days.value.filter((d) => d.day && Number.isFinite(Date.parse(`${d.day}T00:00:00Z`)));
    const first = dated.length ? Math.min(...dated.map((d) => Date.parse(`${d.day}T00:00:00Z`))) : null;
    const weeks = starts.map((s, i) => {
      const end = s + 7 * DAY_MS;
      const count = first === null || end <= first
        ? null
        : dated.filter((d) => { const t = Date.parse(`${d.day}T00:00:00Z`); return t >= s && t < end; }).reduce((t, d) => t + d.n, 0);
      return { week_start: new Date(s).toISOString().slice(0, 10), count, ...(i === SEGMENT_WEEKS - 1 ? { to_date: true } : {}) };
    });
    return {
      available: true,
      weeks,
      undated: days.value.filter((d) => !dated.includes(d)).reduce((t, d) => t + d.n, 0),
      counted_by: 'The day each member’s current segment was first given. A member moved since is counted in the week of their current segment.',
    };
  };

  return {
    as_of: new Date(nowMs).toISOString(),
    counted: 'Every account but admins. Deactivated accounts are counted apart.',
    members: memberBlock(() => {
      const total = sum(live);
      const inSegment = sum(tagged);
      return {
        total,
        in_segment: inSegment,
        no_segment: total - inSegment,
        new_30d: sum(tagged.filter((r) => r.new_30d === 1)),
        deactivated: sum((members as { ok: true; value: MemberRow[] }).value.filter((r) => r.active === 0)),
        profile_differs: sum(tagged.filter((r) => { const p = profileOf(r.persona_id); return p !== null && r.role !== p; })),
        not_in_taxonomy: sum(tagged.filter((r) => !known.has(r.persona_id as string))),
      };
    }),
    segments: memberBlock(() => ({ rows: segmentRows() })),
    sub_accounts: members.ok && lps.ok
      ? {
        available: true as const,
        lp: {
          total: lps.value.reduce((t, r) => t + r.n, 0),
          by_segment: Object.fromEntries(lps.value.filter((r) => r.persona_id).map((r) => [r.persona_id as string, r.n])),
          no_segment: lps.value.filter((r) => !r.persona_id).reduce((t, r) => t + r.n, 0),
          definition: 'Accounts with an approved LP application. Not added to the segment’s total.',
        },
        product_tester: { recorded: false, reason: PRODUCT_TESTERS_REASON } as NotRecorded,
      }
      : (!members.ok ? members.block : (lps as { ok: false; block: Unreadable }).block),
    by_profile: memberBlock(() => {
      const group = (inRole: MemberRow[]) => {
        const by = new Map<string, number>();
        for (const r of inRole) if (r.persona_id) by.set(r.persona_id, (by.get(r.persona_id) ?? 0) + r.n);
        return {
          members: sum(inRole),
          no_segment: sum(inRole.filter((r) => !r.persona_id)),
          segments: [...by].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
        };
      };
      const profiles = SEGMENT_PROFILES.map((p) => ({ profile: p, ...group(live.filter((r) => r.role === p)) }));
      const other = group(live.filter((r) => !(SEGMENT_PROFILES as readonly string[]).includes(r.role)));
      return { profiles, other };
    }),
    how_set: memberBlock(() => ({
      counts: {
        ...Object.fromEntries(SEGMENT_SOURCES.map((s) => [s, sum(tagged.filter((r) => r.source === s))])),
        not_recorded: sum(tagged.filter((r) => !(SEGMENT_SOURCES as readonly string[]).includes(String(r.source)))),
      },
    })),
    confidence: memberBlock(() => {
      const suggested = tagged.filter((r) => r.source === 'router');
      return {
        over: sum(suggested),
        bands: CONFIDENCE_BANDS.map((b) => ({ ...b, count: sum(suggested.filter((r) => r.band === b.key)) })),
        not_recorded: sum(suggested.filter((r) => r.band === 'not_recorded')),
      };
    }),
    weekly: weekly(),
    moves_30d: moves.ok ? { available: true as const, count: moves.value } : moves.block,
  };
}
