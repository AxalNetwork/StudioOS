/**
 * #4707 — the HQ licence API's contracts: the values both sides must agree on
 * and the shapes the licence routes answer with.
 *
 * The SPA mirrors the constants in `frontend/src/lib/licenceContracts.js`
 * (plain JavaScript with JSDoc types, since the SPA's `.js` is not
 * type-checked); `test/licence_contracts_4707.test.ts` fails when the two
 * disagree. The routes build their answers with `satisfies` against the types
 * below, so `npm run test:types` fails when a route drifts from them.
 *
 * Where a list is also a CHECK constraint (statuses: migration 187; kinds:
 * migration 279), the migration is the authority and the test reads it.
 */
import type { LicencePushResult } from './licencePush';

/** `territory_licences.status`, migration 187's CHECK, in lifecycle order. */
export const LICENCE_STATUSES = ['draft', 'pending_activation', 'active', 'suspended', 'terminated'] as const;
export type LicenceStatus = typeof LICENCE_STATUSES[number];

/** `territory_licences.kind`, migration 279's CHECK. */
export const LICENCE_KINDS = ['subsidiary', 'white_label'] as const;
export type LicenceKind = typeof LICENCE_KINDS[number];

/** `licence_seats.seat_type`: the four seats a licence is sold in. */
export const SEAT_TYPES = ['founder', 'investor', 'advisor', 'partner'] as const;
export type SeatType = typeof SEAT_TYPES[number];
export type SeatCounts = Record<string, number>;

/** How a licence write ended (D4707): HQ's write and the branch's copy, or HQ's only. */
export const EVENT_OUTCOMES = ['committed', 'partial'] as const;
export type EventOutcome = typeof EVENT_OUTCOMES[number];

/** Who a history row names: an account, an account since deleted, or no person. */
export const ACTOR_STATES = ['known', 'unknown', 'none'] as const;
export type ActorState = typeof ACTOR_STATES[number];

/** History paging: the default page and the most one request may ask for. */
export const EVENTS_PAGE_DEFAULT = 50;
export const EVENTS_PAGE_MAX = 100;

// ── GET /api/admin/licences/:uid/events ─────────────────────────────────────

export type LicenceEventActor =
  | { state: 'known'; id: number; name: string }
  | { state: 'unknown'; id: number }
  | { state: 'none' };

export type LicenceEventChange =
  | { recorded: false }
  | { recorded: true; readable: false }
  | { recorded: true; before: unknown; after: unknown };

export type LicenceEventItem = {
  id: number;
  event: string;
  note: string | null;
  created_at: string;
  actor: LicenceEventActor;
  change: LicenceEventChange;
  detail: unknown;
  /** null: not recorded (a row from before D4707, or a writer that records none). */
  outcome: EventOutcome | null;
};

export type LicenceEventsPage = {
  items: LicenceEventItem[];
  /** The id to pass as `before` for the next (older) page; null at the start of the history. */
  next_before: number | null;
};

// ── the writes ──────────────────────────────────────────────────────────────

/** Every write that changes the branch's copy reports the push beside its own outcome (D272). */
type Pushed = { pushed: LicencePushResult };

export type LicenceTransitionResult = Pushed & { ok: true; status: LicenceStatus };
export type LicenceSuspendResult = LicenceTransitionResult & { status: 'suspended'; territory_released: false };
export type LicenceRenewResult = Pushed & { ok: true; renews_on: string };
export type LicenceTerritoriesResult = Pushed & { ok: true; countries: string[] };
export type LicenceSeatsResult = Pushed & { ok: true; seats: SeatCounts };
export type LicenceTermsResult = Pushed & {
  ok: true;
  term_years: number | null;
  annual_fee_cents: number | null;
  currency: string;
  revenue_share_bps: number | null;
  token_split_bps: number | null;
  starts_on: string | null;
  renews_on: string | null;
};
