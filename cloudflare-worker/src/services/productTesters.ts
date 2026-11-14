/**
 * D1042 (#2890, Approvals part 4 of #2390) — the product tester store.
 *
 * A member who applies to test products is one `product_testers` row
 * (migration 576), whatever their profile. HQ decides it: approve, decline,
 * pause, resume and remove. Each change is one conditional UPDATE and one
 * `product_tester_events` row in the same batch, and the member is told by
 * email and in their inbox. `../routes/admin_product_testers.ts` is the only
 * caller; the member's apply route waits on #2318.
 */
import type { Env } from '../types';

export const TESTER_STATUSES = ['applied', 'active', 'paused', 'declined', 'removed'] as const;
export type TesterStatus = typeof TESTER_STATUSES[number];

/** A declined member may apply again this many days after the decision. */
export const REAPPLY_DAYS = 90;
/** The shortest decline reason, as a void's (D802). */
export const DECLINE_REASON_MIN = 10;
export const REASON_MAX = 500;
export const NOTE_MAX = 2000;
export const PAGE_SIZE = 25;
export const PAGE_SIZE_MAX = 100;

export type TesterAction = 'approve' | 'decline' | 'pause' | 'resume' | 'remove';

interface Transition {
  from: TesterStatus[];
  to: TesterStatus;
  event: 'approved' | 'declined' | 'paused' | 'resumed' | 'removed';
  /** 'min' needs DECLINE_REASON_MIN characters; 'any' needs one; 'none' takes none. */
  reason: 'min' | 'any' | 'none';
}

export const TRANSITIONS: Record<TesterAction, Transition> = {
  approve: { from: ['applied'], to: 'active', event: 'approved', reason: 'none' },
  decline: { from: ['applied'], to: 'declined', event: 'declined', reason: 'min' },
  pause: { from: ['active'], to: 'paused', event: 'paused', reason: 'any' },
  resume: { from: ['paused'], to: 'active', event: 'resumed', reason: 'none' },
  remove: { from: ['active', 'paused'], to: 'removed', event: 'removed', reason: 'any' },
};

/** What the member is told, by email and in their inbox. */
export function messageFor(action: TesterAction, reason: string | null, reapplyAfter: string | null): { title: string; body: string } {
  switch (action) {
    case 'approve':
      return { title: 'You are now an Axal product tester', body: 'HQ approved your application. Testing programs can now pick you, and you will be told when one does.' };
    case 'decline':
      return { title: 'Your product tester application', body: `HQ did not approve your application this time. ${reason} You can apply again from ${reapplyAfter}.` };
    case 'pause':
      return { title: 'Your product testing is paused', body: `HQ paused your place in the tester pool. ${reason} No new program will pick you while it is paused; the programs you are already in carry on.` };
    case 'resume':
      return { title: 'Your product testing is back on', body: 'HQ resumed your place in the tester pool. Testing programs can pick you again.' };
    case 'remove':
      return { title: 'You are no longer an Axal product tester', body: `HQ removed you from the tester pool. ${reason} Your open program places have ended.` };
  }
}

function present(row: any) {
  let answers: unknown = [];
  try { answers = JSON.parse(row.answers || '[]'); } catch { answers = []; }
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    status: row.status as TesterStatus,
    applied_at: row.applied_at,
    decided_at: row.decided_at ?? null,
    decided_by: row.decided_by == null ? null : Number(row.decided_by),
    // D1200 (#3150): who decided, as a name, for the Product testing page, which never draws an email.
    decided_by_name: row.decided_by == null ? null : (row.decided_by_name ?? null),
    note: row.note ?? null,
    reason: row.reason ?? null,
    reapply_after: row.status === 'declined' && row.decided_at ? reapplyAfter(row.decided_at) : null,
    answers,
    availability: row.availability ?? null,
    consent_email_at: row.consent_email_at ?? null,
    consent_version: row.consent_version ?? null,
    updated_at: row.updated_at,
    member: {
      id: Number(row.user_id),
      name: row.member_name ?? null,
      email: row.member_email,
      role: row.member_role ?? null,
      email_verified: Number(row.member_email_verified) === 1,
      kyc_status: row.member_kyc_status ?? null,
    },
  };
}
export type Tester = ReturnType<typeof present>;

/** The day a declined member may apply again: `decided_at` plus 90 days, as D1 stores it. */
export function reapplyAfter(decidedAt: string): string {
  const at = new Date(`${String(decidedAt).replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(decidedAt) ? '' : 'Z'}`);
  at.setUTCDate(at.getUTCDate() + REAPPLY_DAYS);
  return at.toISOString().slice(0, 10);
}

export function isTesterStatus(s: string): s is TesterStatus {
  return (TESTER_STATUSES as readonly string[]).includes(s);
}

export type ListQuery = {
  status?: string | undefined; page?: string | undefined; page_size?: string | undefined;
  /** D1200: the member's role, as `users.role` stores it. */
  role?: string | undefined;
  /** D1200: `yes` for testers who gave their availability, `no` for those who did not. */
  availability_given?: string | undefined;
  /** D1200: `yes` for testers holding a picked place in a programme that has not closed, `no` for the rest. */
  in_programme?: string | undefined;
};

/** A role as `users.role` stores one: lower case, letters and underscores. */
export const isRoleWord = (s: string) => /^[a-z_]{1,30}$/.test(s);
export const YES_NO = ['yes', 'no'] as const;
export const isYesNo = (s: string) => (YES_NO as readonly string[]).includes(s);

/**
 * D1200 (#3150): the filters, as one fixed WHERE in which each is off when its
 * value is ''. A place is "in a programme" while the application is `picked`
 * in a programme that has not closed or been rejected (D1132's open place,
 * picked only). The WHERE is written out in both queries below, word for
 * word: no SQL text is assembled.
 */


export async function listTesters(env: Env, q: ListQuery) {
  const status = q.status && isTesterStatus(q.status) ? q.status : '';
  const role = q.role && isRoleWord(q.role) ? q.role : '';
  const availability = q.availability_given && isYesNo(q.availability_given) ? q.availability_given : '';
  const inProgramme = q.in_programme && isYesNo(q.in_programme) ? q.in_programme : '';
  const filters = [status, status, role, role, availability, availability, inProgramme, inProgramme];
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(q.page_size) || PAGE_SIZE)));
  const rows = await env.DB.prepare(
    `SELECT t.id, t.user_id, t.status, t.applied_at, t.decided_at, t.decided_by, t.note, t.reason,
            t.answers, t.availability, t.consent_email_at, t.consent_version, t.updated_at,
            u.name AS member_name, u.email AS member_email, u.role AS member_role,
            u.email_verified AS member_email_verified, u.kyc_status AS member_kyc_status,
            d.name AS decided_by_name,
            (SELECT COUNT(*) FROM testing_applications pa WHERE pa.user_id = t.user_id AND pa.status <> 'withdrawn') AS programmes_applied,
            (SELECT COUNT(*) FROM testing_applications pa WHERE pa.user_id = t.user_id AND pa.status = 'picked') AS programmes_picked
       FROM product_testers t JOIN users u ON u.id = t.user_id
       LEFT JOIN users d ON d.id = t.decided_by
      WHERE (? = '' OR t.status = ?)
        AND (? = '' OR u.role = ?)
        AND (? = '' OR (? = 'yes') = (t.availability IS NOT NULL AND trim(t.availability) <> ''))
        AND (? = '' OR (? = 'yes') = EXISTS (
              SELECT 1 FROM testing_applications ia JOIN testing_programmes ip ON ip.id = ia.programme_id
               WHERE ia.user_id = t.user_id AND ia.status = 'picked' AND ip.status NOT IN ('closed', 'rejected')))
      ORDER BY t.applied_at ASC, t.id ASC LIMIT ? OFFSET ?`,
  ).bind(...filters, pageSize, (page - 1) * pageSize).all<any>();
  const counted = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM product_testers GROUP BY status').all<any>();
  const totals: Record<TesterStatus | 'total', number> = { applied: 0, active: 0, paused: 0, declined: 0, removed: 0, total: 0 };
  for (const r of counted.results || []) {
    if (isTesterStatus(r.status)) totals[r.status as TesterStatus] = Number(r.n);
    totals.total += Number(r.n);
  }
  const filtered = role || availability || inProgramme;
  const matching = !filtered ? (status ? totals[status] : totals.total) : Number((await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM product_testers t JOIN users u ON u.id = t.user_id
      WHERE (? = '' OR t.status = ?)
        AND (? = '' OR u.role = ?)
        AND (? = '' OR (? = 'yes') = (t.availability IS NOT NULL AND trim(t.availability) <> ''))
        AND (? = '' OR (? = 'yes') = EXISTS (
              SELECT 1 FROM testing_applications ia JOIN testing_programmes ip ON ip.id = ia.programme_id
               WHERE ia.user_id = t.user_id AND ia.status = 'picked' AND ip.status NOT IN ('closed', 'rejected')))`,
  ).bind(...filters).first<any>())?.n ?? 0);
  return {
    rows: (rows.results || []).map((r: any) => ({
      ...present(r),
      // D1200: the programmes this member applied to (any not withdrawn) and was picked for, all time.
      programmes: { applied: Number(r.programmes_applied ?? 0), picked: Number(r.programmes_picked ?? 0) },
    })),
    page, page_size: pageSize, matching, totals,
  };
}

export async function readTester(env: Env, id: number): Promise<Tester | null> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.user_id, t.status, t.applied_at, t.decided_at, t.decided_by, t.note, t.reason,
            t.answers, t.availability, t.consent_email_at, t.consent_version, t.updated_at,
            u.name AS member_name, u.email AS member_email, u.role AS member_role,
            u.email_verified AS member_email_verified, u.kyc_status AS member_kyc_status, d.name AS decided_by_name
       FROM product_testers t JOIN users u ON u.id = t.user_id
       LEFT JOIN users d ON d.id = t.decided_by
      WHERE t.id = ?`,
  ).bind(id).first<any>();
  return row ? present(row) : null;
}

/** One tester with the programs they applied to and their history, newest event last. */
export async function testerDetail(env: Env, id: number) {
  const tester = await readTester(env, id);
  if (!tester) return null;
  const programs = await env.DB.prepare(
    `SELECT a.uid AS application_uid, a.status AS application_status, a.created_at AS applied_at,
            p.uid AS program_uid, p.product_name, p.status AS program_status
       FROM testing_applications a JOIN testing_programmes p ON p.id = a.programme_id
      WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`,
  ).bind(tester.user_id).all<any>();
  const events = await env.DB.prepare(
    `SELECT e.id, e.action, e.from_status, e.to_status, e.actor_user_id, a.name AS actor_name, e.note, e.reason, e.created_at
       FROM product_tester_events e LEFT JOIN users a ON a.id = e.actor_user_id
      WHERE e.tester_id = ? ORDER BY e.id ASC`,
  ).bind(id).all<any>();
  return { tester, programs: programs.results || [], events: events.results || [] };
}

/** Admins and Super Admins cannot be testers. */
export async function isAdminAccount(env: Env, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT (u.role = 'admin' OR EXISTS (SELECT 1 FROM super_admins s WHERE s.user_id = u.id)) AS admin FROM users u WHERE u.id = ?`,
  ).bind(userId).first<any>();
  return Number(row?.admin) === 1;
}

/**
 * D1132 (#3012): a program place is open while its application is `applied`
 * or `picked` in a programme that has not closed or been rejected. Removing a
 * tester ends each one: the application becomes `withdrawn` (the only ended
 * state migration 516 allows) and the programme's log gets a `place_ended`
 * row saying HQ removed the tester. A closed programme's picks are its
 * record, so they are left as they were.
 */
export const PLACE_OPEN_APPLICATION = ['applied', 'picked'] as const;
export const PLACE_CLOSED_PROGRAMME = ['closed', 'rejected'] as const;

/**
 * Apply one transition. The UPDATE names the status it read, so a second
 * decision in between changes nothing; the event row is written by the same
 * batch only when the UPDATE stamped this decision. A removal ends the
 * member's open places in that batch too, under the same stamp, so the places
 * end exactly when the removal lands and never without it.
 */
export async function applyTransition(env: Env, tester: Tester, action: TesterAction, actorId: number,
  input: { note: string | null; reason: string | null }): Promise<{ changed: boolean; decidedAt: string | null; placesEnded: number }> {
  const t = TRANSITIONS[action];
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  // Approve and resume take no reason, so a pause's reason is cleared with it.
  const reason = t.reason === 'none' ? null : input.reason;
  // Each of these runs only when the removal above it stamped this decision
  // (the EXISTS, written out in both: no SQL text is assembled).
  const endPlaces = action === 'remove' ? [
    // The log rows first, while the places still read as open.
    env.DB.prepare(
      `INSERT INTO testing_events (programme_id, application_id, actor_user_id, action, detail)
       SELECT a.programme_id, a.id, ?, 'place_ended', ? FROM testing_applications a
        WHERE a.user_id = ? AND a.status IN ('applied', 'picked')
          AND a.programme_id IN (SELECT p.id FROM testing_programmes p WHERE p.status NOT IN ('closed', 'rejected'))
          AND EXISTS (SELECT 1 FROM product_testers t WHERE t.id = ? AND t.status = 'removed' AND t.decided_at = ? AND t.decided_by = ? AND t.updated_at = ?)`,
    ).bind(actorId, JSON.stringify({ reason: 'tester_removed', tester_id: tester.id }), tester.user_id, tester.id, stamp, actorId, stamp),
    env.DB.prepare(
      `UPDATE testing_applications SET status = 'withdrawn', updated_at = ?
        WHERE user_id = ? AND status IN ('applied', 'picked')
          AND programme_id IN (SELECT p.id FROM testing_programmes p WHERE p.status NOT IN ('closed', 'rejected'))
          AND EXISTS (SELECT 1 FROM product_testers t WHERE t.id = ? AND t.status = 'removed' AND t.decided_at = ? AND t.decided_by = ? AND t.updated_at = ?)`,
    ).bind(stamp, tester.user_id, tester.id, stamp, actorId, stamp),
  ] : [];
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE product_testers SET status = ?, decided_at = ?, decided_by = ?, note = COALESCE(?, note),
              reason = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
    ).bind(t.to, stamp, actorId, input.note, reason, stamp, tester.id, tester.status),
    env.DB.prepare(
      `INSERT INTO product_tester_events (tester_id, user_id, action, from_status, to_status, actor_user_id, note, reason, created_at)
       SELECT id, user_id, ?, ?, ?, ?, ?, ?, ? FROM product_testers
        WHERE id = ? AND status = ? AND decided_at = ? AND decided_by = ? AND updated_at = ?`,
    ).bind(t.event, tester.status, t.to, actorId, input.note, reason, stamp, tester.id, t.to, stamp, actorId, stamp),
    ...endPlaces,
  ]);
  const changed = Number(results?.[0]?.meta?.changes ?? 0) > 0;
  const placesEnded = endPlaces.length ? Number(results?.[3]?.meta?.changes ?? 0) : 0;
  return { changed, decidedAt: changed ? stamp : null, placesEnded };
}
