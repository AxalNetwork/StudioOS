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

export async function ensureAdvisorStoresSchema(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    for (const stmt of TABLES) {
      try { await env.DB.prepare(stmt).run(); } catch { /* idempotent */ }
    }
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
