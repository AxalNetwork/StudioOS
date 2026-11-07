/**
 * #4707 — the HQ licence API's contracts, on the SPA's side.
 *
 * The values here mirror `cloudflare-worker/src/services/licenceContracts.ts`,
 * which is the authority (and reads the migrations' CHECKs where a list is
 * one); `cloudflare-worker/test/licence_contracts_4707.test.ts` fails when the
 * two disagree. The shapes are JSDoc types: the SPA's `.js` is not
 * type-checked, so they document what the client modules return and what the
 * pages may read, and the parity test pins the field names.
 *
 * No imports, on purpose: the Worker's test loads this file directly.
 */

export const LICENCE_STATUSES = Object.freeze(['draft', 'pending_activation', 'active', 'suspended', 'terminated']);
export const LICENCE_KINDS = Object.freeze(['subsidiary', 'white_label']);
export const SEAT_TYPES = Object.freeze(['founder', 'investor', 'advisor', 'partner']);
export const EVENT_OUTCOMES = Object.freeze(['committed', 'partial']);
export const ACTOR_STATES = Object.freeze(['known', 'unknown', 'none']);
export const EVENTS_PAGE_DEFAULT = 50;
export const EVENTS_PAGE_MAX = 100;

/**
 * @typedef {'draft'|'pending_activation'|'active'|'suspended'|'terminated'} LicenceStatus
 * @typedef {'committed'|'partial'} EventOutcome
 *
 * @typedef {{ state: 'known', id: number, name: string }
 *   | { state: 'unknown', id: number }
 *   | { state: 'none' }} LicenceEventActor
 *
 * @typedef {{ recorded: false }
 *   | { recorded: true, readable: false }
 *   | { recorded: true, before: unknown, after: unknown }} LicenceEventChange
 *
 * @typedef {object} LicenceEventItem
 * @property {number} id
 * @property {string} event
 * @property {string|null} note
 * @property {string} created_at
 * @property {LicenceEventActor} actor
 * @property {LicenceEventChange} change
 * @property {unknown} detail
 * @property {EventOutcome|null} outcome  null: not recorded
 *
 * @typedef {object} LicenceEventsPage
 * @property {LicenceEventItem[]} items
 * @property {number|null} next_before  pass back as `before` for the next page; null at the start
 *
 * @typedef {{ ok: boolean, code?: string|null, reason?: string }} LicencePushResult
 *
 * @typedef {object} LicenceTransitionResult
 * @property {true} ok
 * @property {LicenceStatus} status
 * @property {LicencePushResult} pushed
 */

/** The fields each answer carries, by route, as the parity test reads them. */
export const LICENCE_RESPONSE_FIELDS = Object.freeze({
  events: Object.freeze(['items', 'next_before']),
  event_item: Object.freeze(['id', 'event', 'note', 'created_at', 'actor', 'change', 'detail', 'outcome']),
  transition: Object.freeze(['ok', 'status', 'pushed']),
  suspend: Object.freeze(['ok', 'status', 'territory_released', 'pushed']),
  renew: Object.freeze(['ok', 'renews_on', 'pushed']),
  territories: Object.freeze(['ok', 'countries', 'pushed']),
  seats: Object.freeze(['ok', 'seats', 'pushed']),
  terms: Object.freeze(['ok', 'term_years', 'annual_fee_cents', 'currency', 'revenue_share_bps', 'token_split_bps', 'starts_on', 'renews_on', 'pushed']),
});

/** A history row's outcome, or null when the value is not one the contract names. */
export const eventOutcomeOf = (value) => (EVENT_OUTCOMES.includes(value) ? value : null);
