/**
 * The relationship book's two derived facts: how long since a contact was
 * touched, and whether that makes them "going cold".
 *
 * ONE DEFINITION, THREE READERS. The Network desk (A6), `/network/relationships`
 * and `/network/organizations` each carried their own `daysSince` and their own
 * `> 60`, so the desk could flag a contact the zone did not — or the reverse —
 * the first time one copy was edited. The canvas's cold window is 60 days
 * (`network_relationship_book.test.mjs` pins it against the canvas).
 *
 * WHAT IT READS IS `last_activity_at` AND NOTHING ELSE. That column is stamped
 * when a contact is created, so an untouched contact ages into "going cold" on
 * its 61st day. The flag is honest about the column; the column does not yet
 * tell a touch from an arrival, and no strength, note or reminder store exists
 * to refine it.
 */

/** Days after the last recorded activity at which a contact reads as going cold. */
export const COLD_AFTER_DAYS = 60;

/** Whole days since a stored timestamp, or null when nothing parseable is stored. */
export function daysSince(value, now = Date.now()) {
  if (!value) return null;
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, Math.floor((now - stamp) / 86400000));
}

/**
 * Going cold: last activity recorded, and more than the window ago.
 *
 * A contact with NO recorded activity is not cold — it is unknown, and calling
 * it cold would flag every imported contact the day it arrived.
 */
export function isCold(row, now = Date.now()) {
  const days = daysSince(row?.last_activity_at, now);
  return days !== null && days > COLD_AFTER_DAYS;
}

/** The organization a contact recorded, or '' — never inferred from an email domain. */
export function organizationOf(row) {
  return String(row?.organization || row?.company || row?.firm || '').trim();
}
