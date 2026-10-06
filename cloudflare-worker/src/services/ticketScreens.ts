/**
 * D604 (#1280 step 4) — what the Help Center's ticket screens read beside
 * each ticket, and the thread as the member and the team should see it.
 *
 * The canvas (`design/canvases/integrated/Help Ticket Screen.dc.html`, H3 to
 * H7) draws three things `GET /api/tickets` did not carry:
 *
 *   - THE REVIEW of a feature request. The Super Admin's decision lives in
 *     `feature_request_reviews` (D544, migration 383): no row is "awaiting",
 *     and a declined request carries the reason the member was sent. A read
 *     that fails says so (`unreadable`) and is never drawn as awaiting.
 *   - THE SLA of a ticket, for the admin queue. The tier comes from priority
 *     and the hours from HQ's store (D482). A ticket that is resolved or closed
 *     stops its clock, and a store that cannot be read bands nothing, as the
 *     HQ Support panel does (`supportSlaPolicy.ts`).
 *   - THE THREAD, by side. Replies posted through StudioOS are all posted by
 *     one GitHub account, so the commenter's login says nothing about who
 *     wrote them. D600 signs each one by side instead, and that signature is
 *     what is read back here.
 *
 * WHO THE THREAD SAYS IS SPEAKING. The mirrored issues are in a public
 * repository, so anyone on GitHub can comment on one, and that comment then
 * reaches the member's ticket. A comment therefore counts as the team's only
 * when it comes from the account that opened the mirrored issue (the
 * StudioOS token) or from the repository's owner, members or collaborators.
 * Anyone else is `outside`, shown with their GitHub login, never as the Axal
 * team. A signature is honoured only at the very end of a reply from a team
 * account, where the Worker puts it: a member can type the team's signature
 * into their own reply, but not after the one the Worker appends.
 */
import type { Env } from '../types';
import { ageHours } from './approvalSources';
import { OPEN_TICKET_STATUSES } from './supportQueues';
import { ticketPriorityTier, ticketSlaBandForPriority, type SlaBand, type SupportSlaTier, type TierHours } from './supportSlaPolicy';
import { REPLY_SIGNATURE } from './githubSync';

// ---------------------------------------------------------------------------
// The review
// ---------------------------------------------------------------------------

export type TicketReview =
  | { state: 'awaiting' }
  | { state: 'approved'; decided_at: string | null }
  | { state: 'declined'; reason: string | null; decided_at: string | null }
  | { state: 'unreadable' };

type ReviewRow = { ticket_id: number; status: string; decided_at: string | null; decline_reason: string | null };

/** One review row, or none, as the screens state it. Pure. */
export function reviewFrom(row: ReviewRow | null | undefined): TicketReview {
  if (!row) return { state: 'awaiting' };
  if (row.status === 'declined') return { state: 'declined', reason: row.decline_reason ?? null, decided_at: row.decided_at ?? null };
  return { state: 'approved', decided_at: row.decided_at ?? null };
}

/**
 * The review of every feature request in `rows`, keyed by ticket id. Other
 * types have no review and are not in the map. One read for the whole list.
 */
export async function reviewsForTickets(
  env: Pick<Env, 'DB'>,
  rows: ReadonlyArray<{ id: number | string; type?: string | null }>,
): Promise<Map<number, TicketReview>> {
  const out = new Map<number, TicketReview>();
  const ids = rows.filter((r) => r?.type === 'feature').map((r) => Number(r.id));
  if (!ids.length) return out;
  try {
    const { results } = await env.DB.prepare(
      `SELECT ticket_id, status, decided_at, decline_reason
         FROM feature_request_reviews
        WHERE ticket_id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(ids)).all<ReviewRow>();
    const byId = new Map((results || []).map((r) => [Number(r.ticket_id), r]));
    for (const id of ids) out.set(id, reviewFrom(byId.get(id)));
  } catch (e) {
    console.warn('[tickets] feature reviews unreadable', (e as Error).message);
    for (const id of ids) out.set(id, { state: 'unreadable' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The SLA
// ---------------------------------------------------------------------------

export type TicketSla = {
  tier: SupportSlaTier;
  /** HQ's hours for the tier. Null when the store could not be read. */
  hours: number | null;
  /** Null when the clock has stopped, the hours are unknown, or the ticket has no readable date. */
  band: SlaBand | null;
  /** `running` for an open ticket, `stopped` once resolved or closed, `unreadable` when the hours are unknown. */
  clock: 'running' | 'stopped' | 'unreadable';
};

/** One ticket's tier, hours and band. Pure; `tierHours` null means the store could not be read. */
export function slaForTicket(
  row: { priority?: string | null; status?: string | null; created_at?: string | null },
  tierHours: TierHours | null,
  nowMs: number,
): TicketSla {
  const priority = String(row?.priority ?? '');
  const tier = ticketPriorityTier(priority);
  if (!tierHours) return { tier, hours: null, band: null, clock: 'unreadable' };
  const hours = tierHours[tier];
  if (!(OPEN_TICKET_STATUSES as readonly string[]).includes(String(row?.status ?? ''))) {
    return { tier, hours, band: null, clock: 'stopped' };
  }
  return { tier, hours, band: ticketSlaBandForPriority(ageHours(row?.created_at, nowMs), priority, tierHours), clock: 'running' };
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

/** GitHub's `author_association` values that are the repository's own people. */
export const TEAM_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export type ThreadEntry = {
  id: number | string | null;
  /** `member`: the member who filed the ticket. `team`: the Axal team. `outside`: anyone else on GitHub. */
  from: 'member' | 'team' | 'outside';
  /** The GitHub login, for an `outside` comment only. */
  login: string | null;
  body: string;
  created_at: string | null;
  updated_at: string | null;
};

const escapeRe = (s: string) => s.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&');
// The tail `mirrorReplyBody` writes, anchored to the end: a rule, the
// signature, the source marker. Line breaks may come back as \r\n.
const SIGNED_TAIL = new RegExp(
  '(?:\\r?\\n)*---\\r?\\n('
  + [REPLY_SIGNATURE.member, REPLY_SIGNATURE.team].map(escapeRe).join('|')
  + ')(?:\\r?\\n)+<!-- axal-sync:ticket-\\d+ -->\\s*$',
);
const SOURCE_MARKER = /<!-- axal-sync:ticket-\d+ -->/g;

/**
 * One GitHub comment as a thread entry. `mirrorLogin` is the login that opened
 * the mirrored issue: the account StudioOS posts as. Pure.
 */
export function threadEntry(cm: any, mirrorLogin: string | null): ThreadEntry {
  const raw = String(cm?.body ?? '');
  const login = typeof cm?.user?.login === 'string' ? cm.user.login : null;
  const fromTeamAccount = (!!mirrorLogin && login === mirrorLogin)
    || TEAM_ASSOCIATIONS.has(String(cm?.author_association ?? '').toUpperCase());
  const base = {
    id: cm?.id ?? null,
    created_at: cm?.created_at ?? null,
    updated_at: cm?.updated_at ?? null,
  };
  if (!fromTeamAccount) {
    return { ...base, from: 'outside', login, body: raw.replace(SOURCE_MARKER, '').trim() };
  }
  const signed = SIGNED_TAIL.exec(raw);
  const from = signed && signed[1] === REPLY_SIGNATURE.member ? 'member' : 'team';
  const body = (signed ? raw.slice(0, signed.index) : raw).replace(SOURCE_MARKER, '').trim();
  return { ...base, from, login: null, body };
}
