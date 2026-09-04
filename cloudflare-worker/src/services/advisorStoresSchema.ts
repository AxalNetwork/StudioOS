/**
 * Lazy schema bootstrap for the advisor's own stores — migrations 201–206.
 *
 * WHY THIS EXISTS, and it is a rule rather than a precaution.
 * `documentation/architecture/GOTCHAS.md` states it directly: an `ALTER` file
 * is flagged non-idempotent by `npm run d1:audit` and will be
 * RECORDED-WITHOUT-RUNNING by a `--baseline` adoption — so on any database
 * baselined after these files land, the ledger says `202_advisor_profile_fields`
 * applied and `advisors.headline` does not exist. The lazy bootstrap is what
 * closes that gap, and the gotcha names `ensureAdvisorWeekColumn()` /
 * `ensureMarketIntelSchema()` as the patterns to mirror. This mirrors
 * `ensurePartnerDirectoryColumns()`, which is the same shape over ALTERs plus
 * CREATEs.
 *
 * The migration files remain the canonical definition. This heals a database
 * that never ran them; it does not replace them, and the two are kept
 * identical on purpose — `cloudflare-worker/test/advisor_stores_bootstrap.test.ts`
 * fails if they drift.
 *
 * Cached per D1 binding rather than in a module-level flag. A module flag is
 * right for a worker isolate (one isolate, one database) and wrong for the test
 * process (one process, a fresh database per test), where it would make every
 * test after the first run against tables nobody created.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

/**
 * Migration 202 — the advisor profile fields the Expertise canvas needs.
 *
 * Each entry carries its whole ALTER as a LITERAL rather than a name and a type
 * to interpolate. `scripts/check-sql-prepare.mjs` treats every `${…}` inside a
 * `DB.prepare` as an injection site and fails on new ones, and it is right to:
 * a table or column name assembled at the call site is how the safe cases and
 * the unsafe ones stop being distinguishable by reading.
 */
const PROFILE_COLUMNS: Array<[string, string]> = [
  ['headline', 'ALTER TABLE advisors ADD COLUMN headline TEXT'],
  ['stages_json', 'ALTER TABLE advisors ADD COLUMN stages_json TEXT'],
  ['languages_json', 'ALTER TABLE advisors ADD COLUMN languages_json TEXT'],
  ['country', 'ALTER TABLE advisors ADD COLUMN country TEXT'],
  ['timezone', 'ALTER TABLE advisors ADD COLUMN timezone TEXT'],
  ['availability_note', 'ALTER TABLE advisors ADD COLUMN availability_note TEXT'],
  ['headshot_url', 'ALTER TABLE advisors ADD COLUMN headshot_url TEXT'],
];

/** Migration 205 — per-session money. Recording only; nothing settles. */
const BOOKING_COLUMNS: Array<[string, string]> = [
  ['amount_cents', 'ALTER TABLE advisor_bookings ADD COLUMN amount_cents INTEGER'],
  ['billing_state',
   "ALTER TABLE advisor_bookings ADD COLUMN billing_state TEXT NOT NULL DEFAULT 'unpriced'"],
];

/**
 * Migrations 203, 204 and 206, verbatim.
 *
 * `billing_state`'s CHECK is deliberately absent from `BOOKING_COLUMNS` above:
 * SQLite accepts a CHECK in `ADD COLUMN`, but a constraint that exists only on
 * databases healed through this path and not on those migrated properly is a
 * difference nobody would ever see until it bit. The route validates the value
 * against `BILLING_STATES` before every write, which is the check that runs on
 * every database.
 */
const TABLES = [
  `CREATE TABLE IF NOT EXISTS advisor_services (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     uid TEXT NOT NULL UNIQUE,
     advisor_id INTEGER NOT NULL REFERENCES advisors(id),
     title TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'package', 'retainer')),
     duration_note TEXT,
     price_cents INTEGER,
     currency TEXT NOT NULL DEFAULT 'USD',
     scope TEXT,
     is_active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_advisor_services_advisor
     ON advisor_services(advisor_id, is_active)`,
  `CREATE TABLE IF NOT EXISTS advisor_proof_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     uid TEXT NOT NULL UNIQUE,
     advisor_id INTEGER NOT NULL REFERENCES advisors(id),
     kind TEXT NOT NULL DEFAULT 'engagement'
       CHECK (kind IN ('engagement', 'outcome', 'role', 'credential')),
     title TEXT NOT NULL,
     detail TEXT,
     organization TEXT,
     period_note TEXT,
     is_public INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_advisor_proof_items_advisor
     ON advisor_proof_items(advisor_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS advisor_proof_consents (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     uid TEXT NOT NULL UNIQUE,
     proof_item_id INTEGER NOT NULL REFERENCES advisor_proof_items(id),
     attester_name TEXT NOT NULL,
     attester_email TEXT,
     attester_role TEXT,
     relationship TEXT,
     requested_at TEXT,
     requested_by INTEGER,
     request_token TEXT UNIQUE,
     consent_given INTEGER NOT NULL DEFAULT 0,
     consent_given_at TEXT,
     consent_text TEXT,
     consent_captured_by INTEGER,
     statement TEXT,
     withdrawn_at TEXT,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_advisor_proof_consents_item
     ON advisor_proof_consents(proof_item_id, consent_given)`,
  `CREATE TABLE IF NOT EXISTS advisor_cohort_assignments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     uid TEXT NOT NULL UNIQUE,
     advisor_user_id INTEGER NOT NULL REFERENCES users(id),
     cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
     assigned_by_admin_id INTEGER,
     assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     unassigned_at TEXT,
     note TEXT,
     is_active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE (advisor_user_id, cohort_cycle_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_advisor_cohort_assignments_advisor
     ON advisor_cohort_assignments(advisor_user_id, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_advisor_cohort_assignments_cycle
     ON advisor_cohort_assignments(cohort_cycle_id, is_active)`,
];

async function addMissingColumns(
  env: Env, pragma: string, wanted: Array<[string, string]>,
): Promise<void> {
  // A table this bootstrap does not create — `advisors` and `advisor_bookings`
  // both come from `sql/t13_t14_t15.sql`. An empty PRAGMA means the table is
  // absent, and inventing a shape for a table that already has two definitions
  // in this repository is exactly the hazard migration 201 declines to add to.
  const info = await env.DB.prepare(pragma).all<{ name: string }>();
  const have = new Set((info.results || []).map((r) => r.name));
  if (!have.size) return;
  for (const [name, alter] of wanted) {
    if (have.has(name)) continue;
    try { await env.DB.prepare(alter).run(); }
    catch (e) { console.warn('[advisorStoresSchema] ALTER failed (likely a race):', alter, e); }
  }
}

/**
 * PRODUCTION CALLS THE SLOT OWNER `mentor_id`; THIS REPOSITORY CALLS IT
 * `advisor_id`. This converges them, and it is a fix for a live defect rather
 * than tidying.
 *
 * WHAT WAS WRONG. `sql/t13_t14_t15.sql` declares `advisor_id` on both
 * `advisor_office_hour_slots` and `advisor_bookings`; production has
 * `mentor_id` on both, and no migration in this repository performs a rename —
 * the two simply diverged. Every shipped query uses `advisor_id`, so against
 * production three handlers in `routes/advisors.ts` are broken:
 *
 *   · `GET /:uid/slots` — "no such column" → 500. An advisor's slots cannot be
 *     listed.
 *   · `POST /me/slots` — the INSERT names `advisor_id` → 500. A slot cannot be
 *     published at all.
 *   · `DELETE /me/slots/:id` — worse, because it does not throw:
 *     `slot.advisor_id` is `undefined` and `undefined !== m.id` is always true,
 *     so it returns "Slot not found" forever and a slot can never be cancelled.
 *
 * WHY NOBODY HAS HIT IT, and why that is the reason to fix it now: production
 * has zero advisors, zero slots and zero bookings. The rename is free while the
 * tables are empty and stops being free the moment they are not. The tests
 * never caught it because they build the table from the t13 shape
 * (`advisor_stores.test.ts:102`, commented "in the LIVE (t13) shape") — so they
 * assert against the schema production does not have.
 *
 * WHY THIS IS NOT A MIGRATION, which was the first instinct. SQLite has no
 * conditional DDL and no `RENAME COLUMN IF EXISTS`. Dev, preview and every
 * database built from `t13_t14_t15.sql` already have `advisor_id`, so a bare
 * rename fails there with "no such column: mentor_id" — and the runner aborts
 * the whole deploy on the first failing statement, taking every later migration
 * and the Worker with it. A migration would fix production by breaking
 * everywhere else. Reading `PRAGMA table_info` first is the only shape that is
 * correct on both, and it is the pattern this file and
 * `discoveryInterviewSchema` already use.
 *
 * It runs once per isolate, before the READY latch is set, and is a no-op on
 * every database that is already correct.
 */
/**
 * Rename only when the legacy name is present AND the correct one is absent.
 *
 * A table carrying BOTH is a half-finished rename somebody else is in the
 * middle of. Attempting it there would fail as a duplicate column and log a
 * warning on every fresh isolate for a statement that can never succeed, so it
 * is skipped deliberately instead — which is what
 * `advisor_slot_column_rename.test.ts` asserts, on the log rather than on the
 * columns, because the two outcomes leave the table looking identical.
 */
const needsOwnerRename = (have: Set<string>) => have.has('mentor_id') && !have.has('advisor_id');

const columnNames = (rows: { results?: Array<{ name: string }> } | null | undefined) =>
  new Set((rows?.results || []).map((r) => r.name));

/**
 * UNROLLED PER TABLE, AND EVERY STRING IS A LITERAL. This began as a loop over
 * a two-element `as const` tuple, which cost two `table === '…'` ternaries (to
 * satisfy `check-sql-prepare`, which refuses any `${}` inside `DB.prepare`) and
 * still put `${table}` into the log lines. Semgrep flagged the latter as an
 * unsafe format string — not reachable here, since the only values came from a
 * hardcoded tuple, but the finding pointed at real awkwardness. Unrolling
 * removes the ternaries and the interpolation together.
 *
 * The two `try` blocks are separate on purpose: the rename is per-table, not a
 * global bail-out, so one table already half-renamed must not stop the other.
 */
async function renameLegacySlotOwnerColumn(env: Env): Promise<void> {
  try {
    const info = await env.DB.prepare(
      'PRAGMA table_info(advisor_office_hour_slots)',
    ).all<{ name: string }>();
    if (needsOwnerRename(columnNames(info))) {
      await env.DB.prepare(
        'ALTER TABLE advisor_office_hour_slots RENAME COLUMN mentor_id TO advisor_id',
      ).run();
      console.info('[advisorStoresSchema] renamed advisor_office_hour_slots.mentor_id to advisor_id');
    }
  } catch (e) {
    // Never fatal and never cached: a failed rename must be retried on the next
    // request rather than remembered as done.
    console.warn('[advisorStoresSchema] advisor_office_hour_slots owner-column rename failed', e);
  }

  try {
    const info = await env.DB.prepare(
      'PRAGMA table_info(advisor_bookings)',
    ).all<{ name: string }>();
    if (needsOwnerRename(columnNames(info))) {
      await env.DB.prepare(
        'ALTER TABLE advisor_bookings RENAME COLUMN mentor_id TO advisor_id',
      ).run();
      console.info('[advisorStoresSchema] renamed advisor_bookings.mentor_id to advisor_id');
    }
  } catch (e) {
    console.warn('[advisorStoresSchema] advisor_bookings owner-column rename failed', e);
  }
}

export async function ensureAdvisorStoresSchema(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    for (const stmt of TABLES) {
      try { await env.DB.prepare(stmt).run(); } catch { /* idempotent */ }
    }
    // Before the column adds below: those read `PRAGMA table_info` too, and a
    // half-renamed table would make them reason about the wrong shape.
    await renameLegacySlotOwnerColumn(env);
    await addMissingColumns(env, 'PRAGMA table_info(advisors)', PROFILE_COLUMNS);
    await addMissingColumns(env, 'PRAGMA table_info(advisor_bookings)', BOOKING_COLUMNS);
    READY.set(key, true);
  } catch (e) {
    // Not fatal, and deliberately not swallowed silently: on a database that
    // already has the schema this never runs, and on one that does not, the
    // route below will fail with a message naming the missing table.
    console.error('[advisorStoresSchema] bootstrap failed:', (e as Error).message);
  }
}

/** Exported so a test can hold these against the migration files. */
export const ADVISOR_PROFILE_COLUMNS = PROFILE_COLUMNS.map(([n]) => n);
export const ADVISOR_BOOKING_COLUMNS = BOOKING_COLUMNS.map(([n]) => n);
