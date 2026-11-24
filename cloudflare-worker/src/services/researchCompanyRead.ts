/** D7819 (#7819): public company relations and UID reads over the review ledger, with no review-author or private-note projection. */
import type { Env } from '../types';

export const COMPANY_REVIEW_REASONS = Object.freeze({
  verified: 'The recorded evidence has been checked.',
  quality_hold: 'This record is held while its quality is checked.',
  identity_uncertain: 'This company’s identity needs confirmation.',
  source_unavailable: 'The source could not be checked.',
  out_of_scope: 'This record is outside the directory’s scope.',
  source_withdrawn: 'The source has been withdrawn.',
});
export const NO_COMPANY_REVIEW = 'No review recorded';

// Explicit public projection: a future directory column does not silently become public.
const COLUMNS = `d.id,d.uid,d.name,d.website,d.country,d.founded_year,d.sector,
 d.source_name,d.source_url,d.source_license,d.as_of,d.created_at,d.updated_at,
 d.sic_codes,d.competitor_status,d.diligence_status,d.employee_as_of,d.employee_count,
 d.employee_growth_pct,d.funding_currency,d.funding_total,d.last_funding_amount,
 d.last_funding_currency,d.last_funding_date,d.last_funding_type,d.market_share_as_of,
 d.market_share_pct,d.metrics_confidence,d.metrics_evidence_json,d.metrics_source_name,
 d.metrics_source_url,d.metrics_updated_at,d.revenue,d.revenue_as_of,d.revenue_currency,
 d.valuation,d.valuation_as_of,d.valuation_currency,d.website_verified_at`;

// Fixed member sentences; no request data contributes to this SQL fragment.
const REVIEW_REASON = `CASE r.reason_code
 WHEN 'verified' THEN 'The recorded evidence has been checked.'
 WHEN 'quality_hold' THEN 'This record is held while its quality is checked.'
 WHEN 'identity_uncertain' THEN 'This company’s identity needs confirmation.'
 WHEN 'source_unavailable' THEN 'The source could not be checked.'
 WHEN 'out_of_scope' THEN 'This record is outside the directory’s scope.'
 WHEN 'source_withdrawn' THEN 'The source has been withdrawn.'
 ELSE 'No review recorded' END AS reason,
 CASE WHEN r.status IS NULL THEN 'No review recorded' ELSE r.status END AS review_label`;

// These are literals, not request SQL. Review lookup is the UID primary key.
export const REACHABLE_COMPANIES = `(SELECT ${COLUMNS},${REVIEW_REASON},
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('excluded','withdrawn')))`;
export const COUNTED_COMPANIES = `(SELECT ${COLUMNS},${REVIEW_REASON},
 COALESCE(r.status,'not_recorded') AS review_status,r.reason_code,r.next_review_on,r.withdrawn_on
 FROM research_company_directory d LEFT JOIN research_company_reviews r ON r.uid=d.uid
 WHERE NOT EXISTS (SELECT 1 FROM research_company_reviews blocked
   WHERE blocked.uid=d.uid AND blocked.status IN ('held','excluded','withdrawn')))`;

const reason = (code: string | null) =>
  code
    ? COMPANY_REVIEW_REASONS[code as keyof typeof COMPANY_REVIEW_REASONS]
    : NO_COMPANY_REVIEW;

/** Bound bulk lookup; the unreachable record's values are never selected. Errors propagate, including a missing review table. */
export async function readCompaniesByUid(
  env: Pick<Env, 'DB'>,
  uids: readonly string[],
) {
  if (
    uids.length > 500 ||
    uids.some((uid) => typeof uid !== 'string' || !uid || uid.length > 64)
  )
    throw new Error('invalid_company_uids');
  if (!uids.length) return [];
  const selected = await env.DB.prepare(
    `WITH requested AS (SELECT DISTINCT value AS uid FROM json_each(?))
    SELECT q.uid AS requested_uid,d.*,r.status AS saved_status,r.reason_code AS saved_reason
    FROM requested q LEFT JOIN ${REACHABLE_COMPANIES} d ON d.uid=q.uid
    LEFT JOIN research_company_reviews r ON r.uid=q.uid`,
  )
    .bind(JSON.stringify(uids))
    .all<Record<string, any>>();
  const byUid = new Map(
    (selected.results || []).map((row) => [row.requested_uid as string, row]),
  );
  return Promise.all(
    uids.map(async (uid) => {
      const row = byUid.get(uid);
      if (!row || (!row.uid && !row.saved_status)) return null;
      if (
        !row.uid ||
        row.saved_status === 'withdrawn' ||
        row.saved_status === 'excluded'
      ) {
        return {
          uid,
          review_status: row.saved_status,
          reason_code: row.saved_reason,
          reason: reason(row.saved_reason),
        };
      }
      const {
        requested_uid: _requested,
        saved_status: _status,
        saved_reason: _reason,
        ...record
      } = row;
      const evidence = await env.DB.prepare(
        `SELECT field_name,source_name,source_url,publication_date,retrieved_at,verified_at
      FROM company_sources WHERE company_id=? ORDER BY source_id`,
      )
        .bind(row.id)
        .all();
      const checks = await env.DB.prepare(
        `SELECT kind,checked_at,outcome,what_changed,proof_url
      FROM research_company_checks WHERE uid=? ORDER BY datetime(checked_at),id`,
      )
        .bind(uid)
        .all<Record<string, any>>();
      const failed = (checks.results || [])
        .filter((check) => check.outcome === 'failed')
        .at(-1);
      return {
        ...record,
        reason: reason(row.reason_code),
        review_label:
          row.review_status === 'not_recorded'
            ? NO_COMPANY_REVIEW
            : row.review_status,
        dates: {
          source_effective: row.as_of || null,
          retrieved: null,
          verified: row.website_verified_at || null,
          last_failed_check: failed?.checked_at || null,
          next_review: row.next_review_on || null,
          withdrawn_on: row.withdrawn_on || null,
        },
        evidence: evidence.results || [],
        checks: checks.results || [],
      };
    }),
  );
}

export async function readCompanyByUid(env: Pick<Env, 'DB'>, uid: string) {
  return (await readCompaniesByUid(env, [uid]))[0];
}
