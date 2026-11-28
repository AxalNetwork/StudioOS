/**
 * D7118 part 4 (#7118): how Wellness check-ins and reflections are held at
 * rest, worked out row by row without keeping a single value. It serves the
 * member's "Earlier check-ins" (whether each one is encrypted, held without
 * encryption, or partly unreadable) and the Super Admin's internal storage
 * review (`routes/wellbeing_storage_review.ts`), which returns counts only.
 *
 * Three stores, three histories:
 *   - `wellbeing_reflections` (D7118): ciphertext only, no plaintext columns.
 *   - `wellbeing_daily_pulses` (Task #33, D574): ciphertext, but the writer
 *     falls back to a `*_plain` column when encryption throws.
 *   - `wellbeing_checkins`: the weekly check-ins written before Task #33. No
 *     route writes them now and no member screen reads them.
 *
 * A field is one of: ciphertext that opens with the current key; plaintext;
 * ciphertext that does not open (recoverable only if a plaintext copy is
 * there, which the writer never makes, so in practice lost); or absent.
 */
import type { Env } from '../../types';
import { decryptString } from '../cryptoBox';

type CryptoEnv = { AXAL_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };

/** The answer columns of each store, by the stem their `_enc` / `_plain` pair shares. */
export const PULSE_FIELDS = ['mood', 'stress', 'sleep', 'energy', 'focus', 'social', 'support', 'decisions', 'free_text', 'tags'] as const;
export const LEGACY_WEEKLY_FIELDS = ['stress', 'sleep', 'support', 'decisions', 'energy', 'notes'] as const;
export const REFLECTION_FIELDS = ['scores', 'text', 'topics'] as const;

/**
 * - `encrypted`: every answer is ciphertext that opens.
 * - `not_encrypted`: at least one answer is held as plaintext, none is lost.
 * - `partly_unreadable`: at least one answer is ciphertext that no longer opens.
 * - `empty`: no answer at all.
 */
export type HeldAs = 'encrypted' | 'not_encrypted' | 'partly_unreadable' | 'empty';

export type RowHolding = { held: HeldAs; encrypted: number; plain: number; unreadable: number };

const present = (v: unknown) => v !== null && v !== undefined && v !== '';

/** How one row's answers are held. Decrypts to test, keeps nothing. */
export async function holdingOf(env: CryptoEnv, row: Record<string, unknown>, fields: readonly string[]): Promise<RowHolding> {
  let encrypted = 0, plain = 0, unreadable = 0;
  for (const f of fields) {
    const enc = row[`${f}_enc`];
    const hasPlain = present(row[`${f}_plain`]);
    if (present(enc)) {
      const opened = await decryptString(env, String(enc));
      if (opened != null) encrypted += 1;
      else if (hasPlain) plain += 1;
      else unreadable += 1;
    } else if (hasPlain) {
      plain += 1;
    }
  }
  const held: HeldAs = unreadable > 0 ? 'partly_unreadable'
    : plain > 0 ? 'not_encrypted'
      : encrypted > 0 ? 'encrypted' : 'empty';
  return { held, encrypted, plain, unreadable };
}

/** At most this many rows of each store are decrypted per review; the counts say how many were. */
export const REVIEW_DECRYPT_CAP = 5000;

export type StoreReview =
  | { store: string; present: false }
  | {
    store: string; present: true;
    rows: number;
    /** Rows whose holding was tested, newest first, up to the cap. */
    checked: number;
    held: Record<HeldAs, number>;
    earliest: string | null; latest: string | null;
  };

/**
 * Each store with its own fixed SQL: nothing in a query comes from a request
 * or is built from a name. `SELECT *` reads whichever plaintext columns the
 * table has; a column it lacks reads as absent.
 */
type StoreSpec = { store: string; fields: readonly string[]; totals: string; rows: string };

export const STORES: readonly StoreSpec[] = [
  {
    store: 'wellbeing_reflections', fields: REFLECTION_FIELDS,
    totals: 'SELECT COUNT(*) AS n, MIN(period_start) AS earliest, MAX(period_start) AS latest FROM wellbeing_reflections',
    rows: 'SELECT * FROM wellbeing_reflections ORDER BY id DESC LIMIT ?',
  },
  {
    store: 'wellbeing_daily_pulses', fields: PULSE_FIELDS,
    totals: 'SELECT COUNT(*) AS n, MIN(day) AS earliest, MAX(day) AS latest FROM wellbeing_daily_pulses',
    rows: 'SELECT * FROM wellbeing_daily_pulses ORDER BY id DESC LIMIT ?',
  },
  {
    store: 'wellbeing_checkins', fields: LEGACY_WEEKLY_FIELDS,
    totals: 'SELECT COUNT(*) AS n, MIN(week_anchor) AS earliest, MAX(week_anchor) AS latest FROM wellbeing_checkins',
    rows: 'SELECT * FROM wellbeing_checkins ORDER BY id DESC LIMIT ?',
  },
];

type Db = Env['DB'];

async function exists(db: Db, table: string): Promise<boolean> {
  const rs = await db.prepare('SELECT name FROM pragma_table_info(?)').bind(table).all<{ name: string }>();
  return (rs.results || []).length > 0;
}

/** One store's review. A store that does not exist is `present: false`, never zero rows. */
export async function reviewStore(env: CryptoEnv & { DB: Db }, spec: StoreSpec, cap = REVIEW_DECRYPT_CAP): Promise<StoreReview> {
  if (!(await exists(env.DB, spec.store))) return { store: spec.store, present: false };
  const totals = await env.DB.prepare(spec.totals).first<{ n: number; earliest: string | null; latest: string | null }>();
  const rs = await env.DB.prepare(spec.rows).bind(cap).all<Record<string, unknown>>();
  const held: Record<HeldAs, number> = { encrypted: 0, not_encrypted: 0, partly_unreadable: 0, empty: 0 };
  const rows = rs.results || [];
  for (const row of rows) held[(await holdingOf(env, row, spec.fields)).held] += 1;
  return {
    store: spec.store, present: true,
    rows: Number(totals?.n ?? 0), checked: rows.length, held,
    earliest: totals?.earliest ?? null, latest: totals?.latest ?? null,
  };
}

export async function reviewWellbeingStorage(env: CryptoEnv & { DB: Db }, cap = REVIEW_DECRYPT_CAP) {
  const stores: StoreReview[] = [];
  for (const spec of STORES) stores.push(await reviewStore(env, spec, cap));
  return { stores, decrypt_cap: cap };
}
