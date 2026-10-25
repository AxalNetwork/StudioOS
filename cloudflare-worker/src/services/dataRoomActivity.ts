/**
 * D1105 (#2985, part 4 of #2456) — the data room's activity over any period,
 * by investor and exported, and its diligence checklist. The founder side of
 * `routes/data_room.ts` serves them:
 *
 *   GET /:projectUid/activity?from=&to=&investor=&action=&page=
 *   GET /:projectUid/activity.csv?from=&to=&investor=&action=
 *   GET /:projectUid/checklist
 *
 * THE LOG IS D374's `data_room_access_log`: `open_room`, `download`, and
 * `blocked`, a download the NDA gate refused. A REFUSAL IS NEVER AN OPEN: each
 * of the three is its own figure, in the daily counts, the totals, the
 * per-investor summary, the log and the CSV.
 *
 * THE PERIOD is whole UTC days, `from` and `to` included, at most a year. With
 * none named it is the 30 days to today. The period before is the same number
 * of days ending the day before `from`. `investor` (a grant's uid) narrows all
 * of it to that investor; `action` narrows the log and the CSV only, so the
 * figures stay comparable.
 *
 * NAMES AND EMAILS appear only for a reader holding one of this venture's own
 * grants. A logged reader with no grant here (a row from before a grant was
 * deleted) keeps their row with no name, never another venture's contact.
 *
 * A COUNT OF A TABLE THIS ROUTE OWNS: a day or an investor with no row is zero
 * events, not an unknown, as `week` already reads it (D374).
 *
 * THE CHECKLIST (`DILIGENCE_CHECKLIST`, `services/raiseCycle.ts`) says, per
 * item, the files that answer it (`data_room_files.checklist_item`) and how
 * many grants in force can open each one. That is the investor read's own rule:
 * `tierAdmits` with each grant's folder scope (D691, D1103), then the NDA gate,
 * as the page's `accessNow` reads it. A file only a `nobody` tier answers is
 * "no one can open it".
 */
import type { Env } from '../types';
import { grantFolderScope, tierAdmits, type FolderScope } from './dataRoomAccess';
import { DILIGENCE_CHECKLIST } from './raiseCycle';
import { csvCell } from './capTableRegister';

export const ACTIVITY_ACTIONS = ['open_room', 'download', 'blocked'] as const;
export type ActivityAction = typeof ACTIVITY_ACTIONS[number];
export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_DEFAULT_DAYS = 30;
export const ACTIVITY_MAX_DAYS = 366;
export const CSV_MAX_ROWS = 10_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const validDay = (d: unknown): d is string => typeof d === 'string' && DAY.test(d) && dayOf(dayMs(d)) === d;

export type ActivityQuery = { from: string; to: string; days: number; investor: string | null; action: ActivityAction | null; page: number };

/** The query a request names, checked; `today` is a UTC day. */
export function parseActivityQuery(get: (k: string) => string | undefined, today: string):
  { ok: true; q: ActivityQuery } | { ok: false; code: string; detail: string } {
  const rawTo = get('to') || '';
  const rawFrom = get('from') || '';
  if (rawTo && !validDay(rawTo)) return { ok: false, code: 'bad_to', detail: 'to is a date, YYYY-MM-DD.' };
  if (rawFrom && !validDay(rawFrom)) return { ok: false, code: 'bad_from', detail: 'from is a date, YYYY-MM-DD.' };
  const to = rawTo || today;
  const from = rawFrom || dayOf(dayMs(to) - (ACTIVITY_DEFAULT_DAYS - 1) * DAY_MS);
  if (from > to) return { ok: false, code: 'bad_period', detail: 'from is on or before to.' };
  const days = Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
  if (days > ACTIVITY_MAX_DAYS) return { ok: false, code: 'bad_period', detail: `A period is at most ${ACTIVITY_MAX_DAYS} days.` };
  const action = get('action') || null;
  if (action !== null && !(ACTIVITY_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, code: 'bad_action', detail: 'action is open_room, download or blocked.' };
  }
  const rawPage = get('page');
  const page = rawPage === undefined || rawPage === '' ? 1 : Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || (rawPage && String(page) !== rawPage)) {
    return { ok: false, code: 'bad_page', detail: 'page is a whole number from 1.' };
  }
  const investor = get('investor') || null;
  return { ok: true, q: { from, to, days, investor, action: action as ActivityAction | null, page } };
}

type Figures = { opened: number; downloaded: number; blocked: number };
const zero = (): Figures => ({ opened: 0, downloaded: 0, blocked: 0 });
const FIGURE: Record<ActivityAction, keyof Figures> = { open_room: 'opened', download: 'downloaded', blocked: 'blocked' };
const add = (f: Figures, action: string, n: number) => {
  const k = FIGURE[action as ActivityAction];
  if (k) f[k] += Number(n) || 0;
};

/** The investor a grant uid names on this venture: its user id, or null when the venture has no such grant. */
export async function investorOfGrant(env: Env, projectId: number, grantUid: string) {
  return env.DB.prepare('SELECT investor_user_id FROM data_room_grants WHERE uid = ? AND project_id = ?')
    .bind(grantUid, projectId).first<{ investor_user_id: number }>();
}

// EVERY STATEMENT IS WRITTEN OUT (scripts/check-sql-prepare.mjs). The period
// is `datetime(l.created_at) >= datetime(from) AND < datetime(to, '+1 day')`:
// `created_at` is an ISO string (`nowIso`), so it is normalised with
// datetime() before it is compared (D124). A logged reader is named only
// through one of this venture's own grants: `users` joins only where `g` does.

type LogRow = {
  id: number; created_at: string; action: string; grant_uid: string | null;
  investor_name: string | null; investor_email: string | null; file_uid: string | null; file_name: string | null;
};

async function logRows(env: Env, projectId: number, q: ActivityQuery, userId: number | null, limit: number, offset: number) {
  const res = await env.DB.prepare(
    `SELECT l.id, l.created_at, l.action, g.uid AS grant_uid, u.name AS investor_name, u.email AS investor_email,
            f.uid AS file_uid, f.name AS file_name
       FROM data_room_access_log l
       LEFT JOIN data_room_grants g ON g.project_id = l.project_id AND g.investor_user_id = l.user_id
       LEFT JOIN users u ON u.id = l.user_id AND g.id IS NOT NULL
       LEFT JOIN data_room_files f ON f.id = l.file_id AND f.project_id = l.project_id
      WHERE l.project_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?, '+1 day') AND (? IS NULL OR l.user_id = ?) AND (? IS NULL OR l.action = ?)
      ORDER BY datetime(l.created_at) DESC, l.id DESC
      LIMIT ? OFFSET ?`,
  ).bind(projectId, q.from, q.to, userId, userId, q.action, q.action, limit, offset).all<LogRow>();
  return res.results || [];
}

async function logCount(env: Env, projectId: number, q: ActivityQuery, userId: number | null) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM data_room_access_log l
      WHERE l.project_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?, '+1 day') AND (? IS NULL OR l.user_id = ?) AND (? IS NULL OR l.action = ?)`,
  ).bind(projectId, q.from, q.to, userId, userId, q.action, q.action).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

async function figuresOf(env: Env, projectId: number, from: string, to: string, userId: number | null) {
  const res = await env.DB.prepare(
    `SELECT l.action, COUNT(*) AS n FROM data_room_access_log l
      WHERE l.project_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?, '+1 day') AND (? IS NULL OR l.user_id = ?) GROUP BY l.action`,
  ).bind(projectId, from, to, userId, userId).all<{ action: string; n: number }>();
  const f = zero();
  for (const r of res.results || []) add(f, r.action, r.n);
  return f;
}

/**
 * The activity read: the period's daily figures against the period before,
 * the per-investor summary, and one page of the log. `userId` is the investor
 * the query names, already resolved, or null for every reader.
 */
export async function activityRead(env: Env, projectId: number, q: ActivityQuery, userId: number | null) {
  const daily = await env.DB.prepare(
    `SELECT date(l.created_at) AS day, l.action, COUNT(*) AS n FROM data_room_access_log l
      WHERE l.project_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?, '+1 day') AND (? IS NULL OR l.user_id = ?) GROUP BY 1, 2`,
  ).bind(projectId, q.from, q.to, userId, userId).all<{ day: string; action: string; n: number }>();
  const byDay = new Map<string, Figures>();
  for (let i = 0; i < q.days; i += 1) byDay.set(dayOf(dayMs(q.from) + i * DAY_MS), zero());
  for (const r of daily.results || []) { const f = byDay.get(r.day); if (f) add(f, r.action, r.n); }
  const totals = zero();
  for (const f of byDay.values()) { totals.opened += f.opened; totals.downloaded += f.downloaded; totals.blocked += f.blocked; }

  const prevTo = dayOf(dayMs(q.from) - DAY_MS);
  const prevFrom = dayOf(dayMs(q.from) - q.days * DAY_MS);
  const previous = await figuresOf(env, projectId, prevFrom, prevTo, userId);

  const people = await env.DB.prepare(
    `SELECT l.user_id, l.action, COUNT(*) AS n, MAX(datetime(l.created_at)) AS last_at,
            g.uid AS grant_uid, u.name AS investor_name, u.email AS investor_email
       FROM data_room_access_log l
       LEFT JOIN data_room_grants g ON g.project_id = l.project_id AND g.investor_user_id = l.user_id
       LEFT JOIN users u ON u.id = l.user_id AND g.id IS NOT NULL
      WHERE l.project_id = ? AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?, '+1 day') AND (? IS NULL OR l.user_id = ?)
      GROUP BY l.user_id, l.action`,
  ).bind(projectId, q.from, q.to, userId, userId).all<{
    user_id: number; action: string; n: number; last_at: string; grant_uid: string | null; investor_name: string | null; investor_email: string | null;
  }>();
  const investors = new Map<number, { grant_uid: string | null; name: string | null; email: string | null; last_at: string } & Figures>();
  for (const r of people.results || []) {
    const cur = investors.get(r.user_id) ?? { grant_uid: r.grant_uid, name: r.investor_name, email: r.investor_email, last_at: r.last_at, ...zero() };
    add(cur, r.action, r.n);
    if (r.last_at > cur.last_at) cur.last_at = r.last_at;
    investors.set(r.user_id, cur);
  }

  const total = await logCount(env, projectId, q, userId);
  const rows = await logRows(env, projectId, q, userId, ACTIVITY_PAGE_SIZE, (q.page - 1) * ACTIVITY_PAGE_SIZE);
  return {
    period: { from: q.from, to: q.to, days: q.days },
    previous_period: { from: prevFrom, to: prevTo },
    filters: { investor: q.investor, action: q.action },
    daily: [...byDay.entries()].map(([day, f]) => ({ day, ...f })),
    totals,
    previous,
    investors: [...investors.values()]
      .sort((a, b) => (b.opened + b.downloaded + b.blocked) - (a.opened + a.downloaded + a.blocked) || b.last_at.localeCompare(a.last_at)),
    log: {
      total, page: q.page, page_size: ACTIVITY_PAGE_SIZE, pages: Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE)),
      rows: rows.map((r) => ({
        at: r.created_at, action: r.action,
        investor: { grant_uid: r.grant_uid, name: r.investor_name, email: r.investor_email },
        file: r.file_uid ? { uid: r.file_uid, name: r.file_name } : null,
      })),
    },
  };
}

export const ACTION_WORDS: Record<ActivityAction, string> = {
  open_room: 'Opened the room', download: 'Downloaded', blocked: 'Blocked: NDA not signed',
};
export const CSV_HEADER = ['When (UTC)', 'What', 'Investor', 'Email', 'File'];

/** The CSV of the same rows, newest first, or null when there are more than `CSV_MAX_ROWS`. */
export async function activityCsv(env: Env, projectId: number, q: ActivityQuery, userId: number | null) {
  const total = await logCount(env, projectId, q, userId);
  if (total > CSV_MAX_ROWS) return { tooMany: total };
  const rows = await logRows(env, projectId, q, userId, CSV_MAX_ROWS, 0);
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r.created_at, ACTION_WORDS[r.action as ActivityAction] ?? r.action, r.investor_name, r.investor_email, r.file_name]
      .map(csvCell).join(','));
  }
  return { csv: lines.join('\r\n') + '\r\n', rows: rows.length };
}

// ---------------------------------------------------------------------------
// The checklist
// ---------------------------------------------------------------------------

type ChecklistFile = {
  uid: string; name: string; folder_id: number | null; visibility: string; access_tier: string | null;
  access_expires_at: string | null; checklist_item: string; source_kind: string | null; source_ref: string | null;
};

export const NO_ONE_REASONS = {
  no_file: 'No file in the room answers it yet.',
  private_only: 'Only files private to you answer it, so no investor can open them.',
  not_shared: 'The room is not shared with anyone yet, so no investor can open the files that answer it.',
  no_grant_admits: 'No investor with access can open the files that answer it: their tier, end date, folders or NDA keep every grant out.',
} as const;

/**
 * Per checklist item: its files, and for each how many grants in force can
 * open it. A grant is in force while it is active and its end date has not
 * passed; it opens a file its tier, expiry and folders admit, and an `nda`
 * file only with the investor's NDA signed.
 */
export async function checklistRead(env: Env, projectId: number, now: number = Date.now()) {
  const grants = ((await env.DB.prepare(
    `SELECT g.id, g.investor_user_id,
            EXISTS (SELECT 1 FROM raise_prospects rp
                     WHERE rp.project_id = g.project_id AND rp.stage = 'committed'
                       AND rp.email IS NOT NULL AND u.email IS NOT NULL AND LOWER(rp.email) = LOWER(u.email)) AS committed,
            EXISTS (SELECT 1 FROM pairwise_ndas n
                     WHERE n.party_a_user_id IN (SELECT owner.id FROM users owner WHERE owner.founder_id = p.founder_id)
                       AND n.party_b_user_id = g.investor_user_id AND n.status = 'active'
                       AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))) AS nda
       FROM data_room_grants g
       JOIN users u ON u.id = g.investor_user_id
       JOIN projects p ON p.id = g.project_id
      WHERE g.project_id = ? AND g.status = 'active'
        AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))`,
  ).bind(projectId).all<{ id: number; investor_user_id: number; committed: number; nda: number }>()).results || []);
  const scoped: Array<{ committed: boolean; nda: boolean; scope: FolderScope }> = [];
  for (const g of grants) scoped.push({ committed: !!g.committed, nda: !!g.nda, scope: await grantFolderScope(env, Number(g.id)) });

  const files = ((await env.DB.prepare(
    `SELECT uid, name, folder_id, visibility, access_tier, access_expires_at, checklist_item, source_kind, source_ref
       FROM data_room_files WHERE project_id = ? AND checklist_item IS NOT NULL ORDER BY name`,
  ).bind(projectId).all<ChecklistFile>()).results || []);

  const opensFor = (f: ChecklistFile) => scoped
    .filter((g) => tierAdmits(f, g.committed, now, g.scope) && (f.visibility !== 'nda' || g.nda)).length;

  const items = DILIGENCE_CHECKLIST.map((c) => {
    const mine = files.filter((f) => f.checklist_item === c.key).map((f) => ({
      uid: f.uid, name: f.name, visibility: f.visibility, access_tier: f.access_tier || 'invited',
      source: { kind: f.source_kind || 'document', ref: f.source_ref ?? null },
      grants_that_open: opensFor(f),
    }));
    const openable = mine.some((f) => f.grants_that_open > 0);
    let reason: string | null = null;
    if (!mine.length) reason = NO_ONE_REASONS.no_file;
    else if (!openable) {
      reason = mine.every((f) => f.access_tier === 'nobody') ? NO_ONE_REASONS.private_only
        : scoped.length === 0 ? NO_ONE_REASONS.not_shared : NO_ONE_REASONS.no_grant_admits;
    }
    return {
      key: c.key, area: c.area, label: c.label,
      state: !mine.length ? 'no_file' as const : openable ? 'open' as const : 'no_one_can_open' as const,
      reason, files: mine,
    };
  });
  return {
    grants_in_force: scoped.length,
    totals: {
      items: items.length,
      answered: items.filter((i) => i.state !== 'no_file').length,
      openable: items.filter((i) => i.state === 'open').length,
    },
    items,
  };
}
