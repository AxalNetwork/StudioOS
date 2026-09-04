/**
 * Lazy schema-bootstrap helper for the discovery_interviews.featured
 * column (Task #18). Mirrors `ensurePartnerDirectoryColumns()` /
 * `ensureAdvisorWeekColumn()` — the canonical migration is
 * `072_discovery_interview_featured.sql`, but this helper guarantees the
 * column exists on first request so the worker is self-healing on
 * environments where the migration has not been applied yet.
 *
 * Cached per isolate so the PRAGMA round-trip only happens once.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();
const RATING_READY = new WeakMap<object, boolean>();
const ICP_READY = new WeakMap<object, boolean>();

/**
 * Ensure `discovery_interviews.icp_fit` (TEXT, nullable) exists. Canonical
 * migration is `161_discovery_icp_fit.sql`. Stores the founder's ICP-fit
 * judgement per interview ('strong' | 'partial' | 'none'); null means "not
 * yet assessed" and is never counted as "not ICP" by any consumer.
 *
 * Unlike the featured/rating helpers this one reports whether the column is
 * actually usable, so a caller can degrade to "ICP fit unavailable" instead
 * of emitting SQL that would fail with `no such column`. Readiness is cached
 * only on success — a failed ALTER must not be remembered as ready.
 */
export async function ensureDiscoveryIcpFitColumn(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (ICP_READY.get(key)) return true;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    if (!have.has('icp_fit')) {
      try {
        await env.DB.prepare(`ALTER TABLE discovery_interviews ADD COLUMN icp_fit TEXT`).run();
      } catch (e) {
        // Column is KNOWN absent here, so this is a real bootstrap failure,
        // not an "already applied" race. Swallowed, but not cached as ready.
        console.warn('[discoveryInterviewSchema] icp_fit ALTER failed', e);
        const recheck = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
        if (!(recheck.results || []).some((r) => r.name === 'icp_fit')) return false;
      }
    }
    ICP_READY.set(key, true);
    return true;
  } catch (e) {
    console.warn('[discoveryInterviewSchema] icp_fit bootstrap failed', e);
    return false;
  }
}

const EVIDENCE_READY = new WeakMap<object, boolean>();

/**
 * Ensure migration 211's two interview columns exist: `quote_consent`
 * (INTEGER, nullable) and `interviewee_company` (TEXT, nullable). Canonical
 * migration is `211_founder_validate_evidence.sql`; this keeps the worker
 * self-healing on an environment where it has not been applied, the same way
 * `ensureDiscoveryIcpFitColumn` does for 161.
 *
 * Same contract as the icp_fit helper: reports whether the columns are usable,
 * and caches readiness only on success. Both columns are nullable ON PURPOSE —
 * NULL is "not recorded", and for consent that is a different fact from "no".
 * No DEFAULT is added here for the same reason none is in the migration.
 */
export async function ensureDiscoveryEvidenceColumns(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (EVIDENCE_READY.get(key)) return true;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    // Two literal statements rather than a loop over names: `check-sql-prepare`
    // refuses any `${}` inside `DB.prepare`, and it is right to — a column name
    // built at runtime is exactly the shape that guard exists to keep out, even
    // when the only source is a const tuple three lines up. The icp_fit helper
    // above is written the same way for the same reason.
    if (!have.has('quote_consent')) {
      try {
        await env.DB.prepare(`ALTER TABLE discovery_interviews ADD COLUMN quote_consent INTEGER`).run();
      } catch (e) {
        console.warn('[discoveryInterviewSchema] quote_consent ALTER failed', e);
        const recheck = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
        if (!(recheck.results || []).some((r) => r.name === 'quote_consent')) return false;
      }
    }
    if (!have.has('interviewee_company')) {
      try {
        await env.DB.prepare(`ALTER TABLE discovery_interviews ADD COLUMN interviewee_company TEXT`).run();
      } catch (e) {
        console.warn('[discoveryInterviewSchema] interviewee_company ALTER failed', e);
        const recheck = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
        if (!(recheck.results || []).some((r) => r.name === 'interviewee_company')) return false;
      }
    }
    EVIDENCE_READY.set(key, true);
    return true;
  } catch (e) {
    console.warn('[discoveryInterviewSchema] evidence columns bootstrap failed', e);
    return false;
  }
}

/**
 * Task #14 sibling: ensure `discovery_interviews.validation_rating`
 * (INTEGER 0-5) and `validation_comment` (TEXT) exist. Canonical
 * migration is `074_discovery_validation_rating.sql`; this helper
 * keeps the worker self-healing on prod where 074 has not been applied
 * yet so the Spin-Out Demo Day deck's RatingDistribution component
 * renders without a 500.
 */
export async function ensureDiscoveryValidationRatingColumns(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (RATING_READY.get(key)) return;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    if (!have.has('validation_rating')) {
      try {
        await env.DB.prepare(
          `ALTER TABLE discovery_interviews ADD COLUMN validation_rating INTEGER`,
        ).run();
      } catch (e) {
        console.warn('[discoveryInterviewSchema] validation_rating ALTER failed', e);
      }
    }
    if (!have.has('validation_comment')) {
      try {
        await env.DB.prepare(
          `ALTER TABLE discovery_interviews ADD COLUMN validation_comment TEXT`,
        ).run();
      } catch (e) {
        console.warn('[discoveryInterviewSchema] validation_comment ALTER failed', e);
      }
    }
    RATING_READY.set(key, true);
  } catch (e) {
    console.warn('[discoveryInterviewSchema] rating bootstrap failed', e);
  }
}

export async function ensureDiscoveryInterviewFeaturedColumn(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(discovery_interviews)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    if (!have.has('featured')) {
      try {
        await env.DB.prepare(
          `ALTER TABLE discovery_interviews ADD COLUMN featured INTEGER NOT NULL DEFAULT 0`,
        ).run();
      } catch (e) {
        console.warn('[discoveryInterviewSchema] ALTER failed (likely already applied)', e);
      }
    }
    try {
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project_featured
           ON discovery_interviews (project_id, featured)`,
      ).run();
    } catch { /* idempotent */ }
    READY.set(key, true);
  } catch (e) {
    console.warn('[discoveryInterviewSchema] bootstrap failed', e);
  }
}
