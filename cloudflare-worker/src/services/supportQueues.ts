/**
 * HQ · Support — the three queues, read from what HQ already records (D204,
 * canvas H22, which draws Y1).
 *
 * WHAT WAS WRONG. `/admin/hq-support` drew its escalation queue from
 * `hq_escalations` and marked the other two — HQ-held users, and subsidiary
 * administrators filing about the Admin product — "Not recorded", on the ground
 * that no ticket persona separated them. Every fact those two queues need is
 * already on HQ's own database:
 *
 *   · a ticket names its requester. The one INSERT (`routes/tickets.ts`) binds
 *     the signed-in user's id — although the baseline leaves `user_id` nullable,
 *     which is why `not_on_record` exists below rather than being assumed away;
 *   · `users.role` and `users.is_active` say what that account is now;
 *   · `licence_admins` (UNIQUE user_id, migration 190) says exactly which
 *     accounts administer which licence.
 *
 * And every account — every subsidiary administrator included — lives on HQ's
 * database today, because no branch has been provisioned. So the page refused
 * figures its own database holds: the class D150 corrected on Home and D152 on
 * Security.
 *
 * ONE DEFINITION OF OPEN. `OPEN_TICKET_STATUSES` is what HQ Home's "Queue
 * backlog" tile and this page both mean by an open ticket, and `ticketBacklog`
 * is HQ Home's read, moved here verbatim so there is one place it lives. The
 * five persona buckets below foot to its `open` — asserted in the tests rather
 * than assumed, because two reads that each define "open" for themselves are
 * how a tile and a desk come to disagree.
 *
 * EVERY READ HAS ITS OWN FAILURE. A read that fails answers
 * `{ available: false, reason }` and the page renders it as unreadable — never
 * as zero, never by borrowing another read's figure. A read that hits its
 * ceiling answers `complete: false`, and a count that was cut is never shown as
 * the total (D131).
 */
import type { Env } from '../types';
import { ageHours } from './approvalSources';

/**
 * What "open" means for a ticket, on every surface that counts one.
 *
 * TYPED AS A TUPLE, and the SQL writes its two `?` as literal text rather than
 * joining them from this array — `check-sql-prepare` refuses a `${}` inside
 * `DB.prepare`, and it is right to. Typing the length means a third status is a
 * compile error at the bind site rather than a silent under-bind, and a test
 * counts the placeholders against it (the `OPEN_NOTICE_STATUSES` precedent in
 * `routes/admin_hq.ts`).
 */
export const OPEN_TICKET_STATUSES: readonly ['open', 'in_progress'] = ['open', 'in_progress'];

/** How many tickets one read of the open queue will count before its count stops being a total. */
export const OPEN_TICKET_CEILING = 5000;

/** How many items a queue lists. The rest are counted, and the page says so. */
export const SUPPORT_LIST_LIMIT = 25;

export type TicketBacklog = { by_status: Record<string, number>; open: number };

/**
 * The ticket queue by status — HQ Home's read, moved here unchanged (D204).
 *
 * It throws on an unreadable table rather than answering zero; each caller
 * turns that into its own unreadable state, because HQ Home's wording and this
 * page's are different sentences about the same fact.
 */
export async function ticketBacklog(env: Env): Promise<TicketBacklog> {
  const t = await env.DB.prepare(
    'SELECT status, COUNT(*) AS n FROM tickets GROUP BY status',
  ).all<{ status: string; n: number }>();
  const byStatus: Record<string, number> = {};
  for (const row of t.results || []) byStatus[String(row.status)] = Number(row.n) || 0;
  let open = 0;
  for (const s of OPEN_TICKET_STATUSES) open += byStatus[s] || 0;
  return { by_status: byStatus, open };
}

/**
 * The five places an open ticket can land.
 *
 * Two of them are H22's queues (`hq_held`, `admin_product`); the other three are
 * tickets that are real and open but belong to neither, and the page counts
 * them under the queues so the whole backlog is accounted for.
 */
export const TICKET_PERSONAS = [
  'hq_held', 'admin_product', 'hq_staff', 'account_closed', 'not_on_record',
] as const;
export type TicketPersona = (typeof TICKET_PERSONAS)[number];

/** The two personas that are H22's queues. */
export const QUEUE_PERSONAS: readonly TicketPersona[] = ['hq_held', 'admin_product'];

/**
 * Who filed a ticket — read from the requester's account AS IT STANDS NOW.
 *
 * FIRST MATCH WINS, and the order is the decision:
 *
 *   1. No account: `user_id` is NULL, or the row it named is gone.
 *   2. The account is closed. D145's terminate demotes, deactivates and detaches
 *      a licence's administrators, so without this bucket a terminated licence's
 *      admins would be filed as HQ-held users — people HQ holds directly — when
 *      they are people HQ has just stopped holding at all.
 *   3. Bound in `licence_admins`: a subsidiary administrator, asking about the
 *      Admin product. The BINDING beats the role, which covers D134's
 *      demote-then-detach window — an account demoted and not yet detached still
 *      administers a licence as far as the ledger says.
 *   4. `role = 'admin'` with no licence: HQ's own staff, which is not a customer
 *      queue.
 *   5. Anyone else: an HQ-held user — an account HQ holds directly, in no branch.
 *
 * THE LICENCE'S KIND IS NEVER READ. A white-label's administrators are still
 * administrators filing about the Admin product, which is the queue H30 puts
 * them in; a kind filter here would hide exactly them.
 *
 * NOW, NOT AS FILED. Nothing stamps a persona when a ticket is filed, so an
 * administrator demoted since filing moves queue. A write-time stamp would be a
 * column and a change to the writer; D204 records why it was not taken.
 * H22's "HQ-held users" is also narrower than H9's "every account on HQ's
 * database": H9's groups every account that LIVES on HQ, staff and licence
 * administrators included, while this queue is the customers among them.
 */
export function personaOf(row: {
  account_id: number | null;
  requester_active: number | null;
  requester_role: string | null;
  licence_uid: string | null;
}): TicketPersona {
  if (row.account_id === null || row.account_id === undefined) return 'not_on_record';
  if (Number(row.requester_active) !== 1) return 'account_closed';
  if (row.licence_uid) return 'admin_product';
  if (row.requester_role === 'admin') return 'hq_staff';
  return 'hq_held';
}

export type OpenTicketRow = {
  id: number; title: string; status: string; priority: string; created_at: string;
  account_id: number | null; requester_name: string | null; requester_email: string | null;
  requester_role: string | null; requester_active: number | null;
  licence_uid: string | null; licence_ref: string | null; licence_brand: string | null;
};

export type OpenTicketsRead =
  | { available: true; complete: boolean; rows: OpenTicketRow[] }
  | { available: false; reason: string };

export const TICKETS_UNREADABLE =
  'The ticket queue could not be read on this database, so how many tickets are waiting is unknown — not none.';

/**
 * Every open ticket with its requester's standing, oldest first — ONE read.
 *
 * THIS READ TOUCHES NO COLUMN MIGRATION 273 ADDED. The mirror columns belong to
 * the sync strip, which reads them separately and fails on its own; a database
 * that has not applied 273 still has queues.
 *
 * `licence_admins` is UNIQUE(user_id), so the joins cannot multiply a ticket.
 * `id` breaks ties because `created_at` is one-second resolution.
 */
export async function readOpenTickets(env: Env): Promise<OpenTicketsRead> {
  try {
    const res = await env.DB.prepare(
      `SELECT t.id, t.title, t.status, t.priority, t.created_at,
              u.id AS account_id, u.name AS requester_name, u.email AS requester_email,
              u.role AS requester_role, u.is_active AS requester_active,
              tl.uid AS licence_uid, tl.licence_ref AS licence_ref, tl.brand_name AS licence_brand
         FROM tickets t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN licence_admins la ON la.user_id = u.id
         LEFT JOIN territory_licences tl ON tl.id = la.licence_id
        WHERE t.status IN (?, ?)
        ORDER BY t.created_at ASC, t.id ASC
        LIMIT ?`,
    ).bind(...OPEN_TICKET_STATUSES, OPEN_TICKET_CEILING + 1).all<{
      id: number; title: string; status: string; priority: string; created_at: string;
      account_id: number | null; requester_name: string | null; requester_email: string | null;
      requester_role: string | null; requester_active: number | null;
      licence_uid: string | null; licence_ref: string | null; licence_brand: string | null;
    }>();
    const all = res.results || [];
    const complete = all.length <= OPEN_TICKET_CEILING;
    return { available: true, complete, rows: complete ? all : all.slice(0, OPEN_TICKET_CEILING) };
  } catch {
    return { available: false, reason: TICKETS_UNREADABLE };
  }
}

export type SupportTicketItem = {
  id: number;
  title: string;
  status: string;
  priority: string;
  age_hours: number | null;
  requester: string | null;
  licence: { uid: string; licence_ref: string | null; brand_name: string | null } | null;
};

export type PersonaBucket = {
  /** Null when the read hit its ceiling: a cut count is not a total. */
  count: number | null;
  oldest_age_hours: number | null;
  /** The oldest `SUPPORT_LIST_LIMIT`, oldest first. Exact even past the ceiling, because the read is ordered. */
  items: SupportTicketItem[];
};

export type TicketQueues = {
  complete: boolean;
  /** Every open ticket, all five buckets — HQ Home's Queue backlog. Null past the ceiling. */
  open: number | null;
  buckets: Record<TicketPersona, PersonaBucket>;
};

/** Sort one read into its five buckets. Pure, so it is tested without a database. */
export function summariseTickets(
  read: { complete: boolean; rows: OpenTicketRow[] }, nowMs: number,
): TicketQueues {
  const buckets = {} as Record<TicketPersona, PersonaBucket>;
  for (const p of TICKET_PERSONAS) buckets[p] = { count: 0, oldest_age_hours: null, items: [] };
  for (const row of read.rows) {
    const bucket = buckets[personaOf(row)];
    const age = ageHours(row.created_at, nowMs);
    bucket.count = (bucket.count || 0) + 1;
    // Rows arrive oldest first, so the first dated row a bucket sees is its oldest.
    if (bucket.oldest_age_hours === null && age !== null) bucket.oldest_age_hours = age;
    if (bucket.items.length < SUPPORT_LIST_LIMIT) {
      bucket.items.push({
        id: Number(row.id),
        title: String(row.title ?? ''),
        status: String(row.status ?? ''),
        priority: String(row.priority ?? ''),
        age_hours: age,
        requester: row.requester_name || row.requester_email || null,
        licence: row.licence_uid
          ? { uid: row.licence_uid, licence_ref: row.licence_ref, brand_name: row.licence_brand }
          : null,
      });
    }
  }
  if (!read.complete) for (const p of TICKET_PERSONAS) buckets[p].count = null;
  return { complete: read.complete, open: read.complete ? read.rows.length : null, buckets };
}

// ─── The GitHub sync strip ────────────────────────────────────────────────

/** The window the strip counts over. The SQL below writes it as a literal, and a test holds the two equal. */
export const SYNC_WINDOW_HOURS = 24;

/**
 * Why the strip has no average lag.
 *
 * The mirror runs inside the request that files a ticket (`routes/tickets.ts`),
 * and a ticket keeps only its LATEST attempt — status, error, time. There is no
 * pair of moments stored for any change, so there is nothing to average; a
 * figure here would be invented.
 */
export const SYNC_LAG_REASON =
  'Not recorded: the mirror runs inside the request that files a ticket, and a ticket keeps only its latest attempt, so no delay between a change and its mirror is stored to average.';

export const SYNC_UNREADABLE =
  'The mirror status could not be read on this database. Its columns arrive with migration 273.';

export type TicketSync =
  | {
      available: true;
      window_hours: number;
      synced: number;
      failed: number;
      not_configured: number;
      lag: { value: null; reason: string };
    }
  | { available: false; reason: string };

/**
 * What the ticket→GitHub mirror did in the last day, from the tickets
 * themselves (migration 273's columns).
 *
 * NO SCHEMA BOOTSTRAP. `ensureTicketSyncSchema` runs up to ten ALTERs, which is
 * a write on a page that only reads; a database without 273 answers
 * unreadable, which is true, rather than being altered by someone looking.
 *
 * The comparison normalises BOTH sides with `datetime()`: the column is written
 * `datetime('now')` today, and wrapping it is what keeps that from mattering
 * (D124/D125 — `attempted_at` is on `check-timestamp-comparisons`' list).
 */
export async function readTicketSync(env: Env): Promise<TicketSync> {
  try {
    const res = await env.DB.prepare(
      `SELECT github_sync_status AS state, COUNT(*) AS n
         FROM tickets
        WHERE datetime(github_sync_attempted_at) > datetime('now', '-24 hours')
        GROUP BY github_sync_status`,
    ).all<{ state: string | null; n: number }>();
    const by: Record<string, number> = {};
    for (const row of res.results || []) by[String(row.state)] = Number(row.n) || 0;
    return {
      available: true,
      window_hours: SYNC_WINDOW_HOURS,
      synced: by.synced || 0,
      failed: by.failed || 0,
      not_configured: by.not_configured || 0,
      lag: { value: null, reason: SYNC_LAG_REASON },
    };
  } catch {
    return { available: false, reason: SYNC_UNREADABLE };
  }
}

/** How many of the latest attempts HQ · Platform lists (D213). */
export const RECENT_SYNC_LIMIT = 10;
/** An error is clipped here: it is GitHub's message, and one line is enough to act on. */
export const SYNC_ERROR_CLIP = 200;

export type RecentSyncAttempts =
  | {
      available: true;
      items: Array<{
        ticket_id: number;
        issue_number: number | null;
        status: string | null;
        error: string | null;
        attempted_at: string;
      }>;
    }
  | { available: false; reason: string };

/**
 * D213 — the latest mirror attempts, one per ticket, newest first.
 *
 * ONE ROW PER TICKET, BECAUSE THAT IS WHAT IS STORED. A ticket keeps only its
 * latest attempt (migration 273), so this is not a log of failures and says
 * so where it is drawn: a ticket that failed and later synced shows the sync.
 *
 * NO TITLE AND NO REQUESTER. This list is about the mirror's health; what a
 * ticket says stays on Support, which each row links to. And no schema
 * bootstrap, for `readTicketSync`'s reason: a database without 273 answers
 * unreadable, which is true, rather than being altered by a read.
 */
export async function readRecentSyncAttempts(env: Env): Promise<RecentSyncAttempts> {
  try {
    const res = await env.DB.prepare(
      `SELECT id, github_issue_number, github_sync_status, github_sync_error, github_sync_attempted_at
         FROM tickets
        WHERE github_sync_attempted_at IS NOT NULL
        ORDER BY datetime(github_sync_attempted_at) DESC, id DESC
        LIMIT ?`,
    ).bind(RECENT_SYNC_LIMIT).all<{
      id: number;
      github_issue_number: number | null;
      github_sync_status: string | null;
      github_sync_error: string | null;
      github_sync_attempted_at: string;
    }>();
    return {
      available: true,
      items: (res.results || []).map((row) => ({
        ticket_id: Number(row.id),
        issue_number: row.github_issue_number == null ? null : Number(row.github_issue_number),
        status: row.github_sync_status == null ? null : String(row.github_sync_status),
        error: row.github_sync_error ? String(row.github_sync_error).slice(0, SYNC_ERROR_CLIP) : null,
        attempted_at: String(row.github_sync_attempted_at),
      })),
    };
  } catch {
    return { available: false, reason: SYNC_UNREADABLE };
  }
}

// ─── The tenant × queue matrix ────────────────────────────────────────────

export type SupportLicence = { uid: string; licence_ref: string; brand_name: string; status: string };
export type SupportDeployment = { code: string; licence_uid: string; hostname: string };

export type LicencesRead = { available: true; rows: SupportLicence[] } | { available: false; reason: string };
export type DeploymentsRead = { available: true; rows: SupportDeployment[] } | { available: false; reason: string };

export const LICENCES_UNREADABLE =
  'The licence ledger could not be read on this database, so which tenant each item belongs to is unknown.';
export const DEPLOYMENTS_UNREADABLE =
  'The deployment registry could not be read on this database (migration 258), so which licence has a branch is unknown — not none.';

/** The licence ledger, in HQ Home's order (`routes/admin_hq.ts`). */
export async function readSupportLicences(env: Env): Promise<LicencesRead> {
  try {
    const res = await env.DB.prepare(
      `SELECT uid, licence_ref, brand_name, status FROM territory_licences ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1
                     WHEN 'pending_activation' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
         licence_ref`,
    ).all<{ uid: string; licence_ref: string; brand_name: string; status: string }>();
    return { available: true, rows: res.results || [] };
  } catch {
    return { available: false, reason: LICENCES_UNREADABLE };
  }
}

/**
 * Which licence has a branch. UNREADABLE IS ITS OWN STATE here, unlike
 * `admin_hq.ts`'s `deployedBranches`, which reads a missing registry as an empty
 * one: that is right for a fan-out that only adds `not_deployed` rows, and wrong
 * for a matrix whose cells mean "does not apply" when there is no branch.
 */
export async function readSupportDeployments(env: Env): Promise<DeploymentsRead> {
  try {
    const res = await env.DB.prepare(
      'SELECT code, licence_uid, hostname FROM licence_deployments ORDER BY code',
    ).all<{ code: string; licence_uid: string; hostname: string }>();
    return { available: true, rows: res.results || [] };
  } catch {
    return { available: false, reason: DEPLOYMENTS_UNREADABLE };
  }
}

/**
 * One cell of the matrix: a measured count with the age of its oldest item, or
 * no value and the reason there is none. Never a bare dash, never a zero that
 * was not counted.
 */
export type MatrixCell =
  | { value: number; oldest_age_hours: number | null }
  | {
      value: null;
      why: 'does_not_apply' | 'branch_database' | 'unreadable' | 'incomplete';
      reason: string;
    };

export type MatrixRow = {
  key: string;
  kind: 'hq' | 'licence' | 'unattributed';
  label: string;
  licence_ref: string | null;
  status: string | null;
  branch_code: string | null;
  escalations: MatrixCell;
  hq_held: MatrixCell;
  about_admin: MatrixCell;
};

export const MATRIX_REASONS = {
  hqEscalations: 'HQ raises no escalation to itself: an escalation is what a branch pushes up to HQ.',
  hqAboutAdmin: 'The About-Admin queue is subsidiary administrators. HQ’s own staff are counted under the queues, as staff.',
  licenceHqHeld: 'An HQ-held account belongs to no branch, so no licence has one.',
  undeployedEscalations: 'No branch is deployed for this licence, so nothing can be raised from it.',
  unattributedHqHeld: 'An HQ-held account belongs to no branch.',
  unattributedAboutAdmin: 'A ticket names its requester’s licence, so none is unattributed.',
  escalationsIncomplete: 'More open escalations than one read counts, so a per-branch count would be a cut count.',
  ticketsIncomplete: 'More open tickets than one read counts, so this cell would be a cut count.',
  deploymentUnknown: 'Whether this licence has a branch could not be read, so whether its administrators file here or on their own host is unknown.',
} as const;

type EscalationLike = { branch_code: string; created_at: string };

type Tally = { n: number; oldest: number | null };

function tally(map: Map<string, Tally>, key: string, age: number | null): void {
  const t = map.get(key) || { n: 0, oldest: null };
  t.n += 1;
  // Oldest first again, so the first dated item a key sees is its oldest.
  if (t.oldest === null && age !== null) t.oldest = age;
  map.set(key, t);
}

const counted = (t: Tally | undefined): MatrixCell => ({ value: t?.n || 0, oldest_age_hours: t?.oldest ?? null });
const absent = (why: 'does_not_apply' | 'branch_database' | 'unreadable' | 'incomplete', reason: string): MatrixCell =>
  ({ value: null, why, reason });

/**
 * Tenant × queue — H22's matrix, built from reads already made. Pure.
 *
 * THE HQ ROW COMES FIRST, and it is not decoration: Y1's own rule is that a
 * table without it totals more than its rows, because HQ-held accounts belong to
 * no licence.
 *
 * A LICENCE ROW is every licence that holds or is preparing a territory —
 * draft, pending activation, active, suspended. A terminated licence appears
 * only while an open item is still attributed to it, and the rest are counted
 * in `omitted_terminated` so the omission is stated rather than silent.
 *
 * ABOUT-ADMIN ON A DEPLOYED LICENCE IS NULL, NEVER THE SMALLER HQ-SIDE COUNT.
 * Its administrators file on their own host into that branch's database, and no
 * branch call returns tickets. The tickets filed on axal.vc are real and are in
 * the queue above; shown here they would read as the branch's whole load, which
 * understates it by construction.
 */
export function buildTenantMatrix(input: {
  licences: SupportLicence[];
  deployments: DeploymentsRead;
  escalations: { available: true; complete: boolean; items: EscalationLike[] } | { available: false; reason: string };
  tickets: OpenTicketsRead;
  nowMs: number;
}): { rows: MatrixRow[]; omitted_terminated: number } {
  const { licences, deployments, escalations, tickets, nowMs } = input;

  const deploymentByLicence = new Map<string, SupportDeployment>();
  const licenceByCode = new Map<string, string>();
  if (deployments.available) {
    for (const d of deployments.rows) {
      deploymentByLicence.set(String(d.licence_uid), d);
      licenceByCode.set(String(d.code).toLowerCase(), String(d.licence_uid));
    }
  }

  const escalationsByCode = new Map<string, Tally>();
  if (escalations.available) {
    for (const e of escalations.items) {
      tally(escalationsByCode, String(e.branch_code).toLowerCase(), ageHours(e.created_at, nowMs));
    }
  }

  const aboutByLicence = new Map<string, Tally>();
  const hqHeld: Tally = { n: 0, oldest: null };
  if (tickets.available) {
    for (const row of tickets.rows) {
      const persona = personaOf(row);
      const age = ageHours(row.created_at, nowMs);
      if (persona === 'admin_product' && row.licence_uid) tally(aboutByLicence, row.licence_uid, age);
      if (persona === 'hq_held') {
        hqHeld.n += 1;
        if (hqHeld.oldest === null && age !== null) hqHeld.oldest = age;
      }
    }
  }

  const ticketCell = (t: Tally | undefined): MatrixCell => {
    if (!tickets.available) return absent('unreadable', tickets.reason);
    if (!tickets.complete) return absent('incomplete', MATRIX_REASONS.ticketsIncomplete);
    return counted(t);
  };

  const escalationCell = (licenceUid: string): MatrixCell => {
    if (!deployments.available) return absent('unreadable', deployments.reason);
    const dep = deploymentByLicence.get(licenceUid);
    if (!dep) return absent('does_not_apply', MATRIX_REASONS.undeployedEscalations);
    if (!escalations.available) return absent('unreadable', escalations.reason);
    if (!escalations.complete) return absent('incomplete', MATRIX_REASONS.escalationsIncomplete);
    return counted(escalationsByCode.get(String(dep.code).toLowerCase()));
  };

  const aboutCell = (licenceUid: string): MatrixCell => {
    if (!tickets.available) return absent('unreadable', tickets.reason);
    if (!deployments.available) return absent('unreadable', MATRIX_REASONS.deploymentUnknown);
    const dep = deploymentByLicence.get(licenceUid);
    if (dep) {
      const here = aboutByLicence.get(licenceUid)?.n || 0;
      const filedHere = tickets.complete
        ? ` ${here} filed on axal.vc ${here === 1 ? 'is' : 'are'} in the queue above.`
        : '';
      return absent(
        'branch_database',
        `Its administrators file on ${dep.hostname || `${dep.code}.axal.vc`}, into that branch’s own database, and no branch call returns tickets.${filedHere}`,
      );
    }
    return ticketCell(aboutByLicence.get(licenceUid));
  };

  const rows: MatrixRow[] = [{
    key: 'hq',
    kind: 'hq',
    label: 'HQ',
    licence_ref: null,
    status: null,
    branch_code: null,
    escalations: absent('does_not_apply', MATRIX_REASONS.hqEscalations),
    hq_held: ticketCell(hqHeld),
    about_admin: absent('does_not_apply', MATRIX_REASONS.hqAboutAdmin),
  }];

  // A terminated licence is left out only when the reads PROVE nothing open is
  // attributed to it. A failed or cut read proves nothing, so the licence stays
  // listed and its cells say why they are blank — "omitted because empty" would
  // otherwise be a claim no read made.
  const ticketsKnown = tickets.available && tickets.complete;
  let omittedTerminated = 0;
  for (const l of licences) {
    const dep = deploymentByLicence.get(l.uid);
    if (l.status === 'terminated') {
      const escalationsKnown = !deployments.available
        ? false
        : !dep || (escalations.available && escalations.complete);
      const escalated = dep ? (escalationsByCode.get(String(dep.code).toLowerCase())?.n || 0) : 0;
      const filed = aboutByLicence.get(l.uid)?.n || 0;
      if (escalationsKnown && ticketsKnown && escalated + filed === 0) { omittedTerminated += 1; continue; }
    }
    rows.push({
      key: l.uid,
      kind: 'licence',
      label: l.brand_name,
      licence_ref: l.licence_ref,
      status: l.status,
      branch_code: dep ? dep.code : null,
      escalations: escalationCell(l.uid),
      hq_held: absent('does_not_apply', MATRIX_REASONS.licenceHqHeld),
      about_admin: aboutCell(l.uid),
    });
  }

  // An escalation whose branch maps to no listed licence. Only countable when
  // every read it needs answered in full; otherwise there is no row, because a
  // row claiming "unattributed: 0" would be a count nobody made.
  if (deployments.available && escalations.available && escalations.complete) {
    const known = new Set(licences.map((l) => l.uid));
    const orphan: Tally = { n: 0, oldest: null };
    const codes: string[] = [];
    for (const [code, t] of escalationsByCode) {
      const uid = licenceByCode.get(code);
      if (uid && known.has(uid)) continue;
      orphan.n += t.n;
      if (t.oldest !== null && (orphan.oldest === null || t.oldest > orphan.oldest)) orphan.oldest = t.oldest;
      codes.push(code);
    }
    if (orphan.n > 0) {
      rows.push({
        key: 'unattributed',
        kind: 'unattributed',
        label: `Unattributed (${codes.sort().join(', ')})`,
        licence_ref: null,
        status: null,
        branch_code: null,
        escalations: counted(orphan),
        hq_held: absent('does_not_apply', MATRIX_REASONS.unattributedHqHeld),
        about_admin: absent('does_not_apply', MATRIX_REASONS.unattributedAboutAdmin),
      });
    }
  }

  return { rows, omitted_terminated: omittedTerminated };
}
