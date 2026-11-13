/**
 * Candidate sources for HQ review. These queries select account IDs only. Old activity and
 * participation in a different access system are evidence to review, never authority to grant.
 * Each query orders and pages distinct accounts before the entitlement evaluator runs.
 */
import type { Env } from '../types';
import { EntitlementError, evaluateMany, todayUtc } from './programEntitlements';

// Keep one bound parameter order for every evidence query, including those without a date filter.
const PARAMS = 'WITH params AS (SELECT ? AS after_id, ? AS report_day, ? AS page_size)';

const EVIDENCE = {
  'spinout-lab': {
    source: 'lab_enrolment_or_activation', participation: true,
    sql: `${PARAMS} SELECT u.id AS user_id FROM users u
           WHERE u.id > (SELECT after_id FROM params) AND u.is_active = 1 AND COALESCE(u.is_incorporated, 0) = 0
             AND (EXISTS (SELECT 1 FROM spinout_lab_enrollments e WHERE e.user_id = u.id)
               OR EXISTS (SELECT 1 FROM cohort_applicants a WHERE a.user_id = u.id AND a.status = 'activated'))
           ORDER BY u.id LIMIT (SELECT page_size FROM params)`,
  },
  learning: {
    source: 'active_learning_enrolment', participation: true,
    sql: `${PARAMS} SELECT DISTINCT e.user_id FROM learning_enrollments e
           JOIN learning_programs p ON p.id = e.program_id JOIN users u ON u.id = e.user_id
           WHERE e.user_id > (SELECT after_id FROM params) AND u.is_active = 1 AND e.status = 'active' AND p.status = 'published'
           ORDER BY e.user_id LIMIT (SELECT page_size FROM params)`,
  },
  'investor-cohorts': {
    source: 'open_investor_cohort_grant', participation: true,
    sql: `${PARAMS} SELECT DISTINCT g.investor_user_id AS user_id FROM investor_cohort_access g JOIN users u ON u.id = g.investor_user_id
           WHERE g.investor_user_id > (SELECT after_id FROM params) AND u.is_active = 1 AND g.ended_at IS NULL AND g.ends_at >= (SELECT report_day FROM params)
           ORDER BY g.investor_user_id LIMIT (SELECT page_size FROM params)`,
  },
  'mentor-cohorts': {
    source: 'active_mentor_assignment', participation: true,
    sql: `${PARAMS} SELECT DISTINCT a.advisor_user_id AS user_id FROM advisor_cohort_assignments a JOIN users u ON u.id = a.advisor_user_id
           WHERE a.advisor_user_id > (SELECT after_id FROM params) AND u.is_active = 1 AND a.is_active = 1
           ORDER BY a.advisor_user_id LIMIT (SELECT page_size FROM params)`,
  },
  perks: {
    source: 'prior_perk_claim', participation: false,
    sql: `${PARAMS} SELECT DISTINCT p.user_id FROM perk_claims p JOIN users u ON u.id = p.user_id
           WHERE p.user_id > (SELECT after_id FROM params) AND u.is_active = 1 ORDER BY p.user_id LIMIT (SELECT page_size FROM params)`,
  },
  'refer-and-earn': {
    source: 'prior_referral_submission', participation: false,
    sql: `${PARAMS} SELECT DISTINCT r.referrer_user_id AS user_id FROM referral_submissions r JOIN users u ON u.id = r.referrer_user_id
           WHERE r.referrer_user_id > (SELECT after_id FROM params) AND u.is_active = 1 AND r.status <> 'draft'
           ORDER BY r.referrer_user_id LIMIT (SELECT page_size FROM params)`,
  },
  'referral-partners': {
    source: 'current_referral_partner_terms', participation: true,
    sql: `${PARAMS} SELECT DISTINCT p.user_id FROM referral_partners p JOIN referral_partner_terms t ON t.partner_id = p.id
           JOIN users u ON u.id = p.user_id
           WHERE p.user_id > (SELECT after_id FROM params) AND u.is_active = 1 AND p.segment <> 'influencers'
             AND t.status = 'active' AND t.starts_on <= (SELECT report_day FROM params) AND (t.ends_on IS NULL OR t.ends_on >= (SELECT report_day FROM params))
           ORDER BY p.user_id LIMIT (SELECT page_size FROM params)`,
  },
  influencer: {
    source: 'active_influencer_membership', participation: true,
    sql: `${PARAMS} SELECT i.user_id FROM influencers i JOIN users u ON u.id = i.user_id
           WHERE i.user_id > (SELECT after_id FROM params) AND u.is_active = 1 AND i.status = 'active' ORDER BY i.user_id LIMIT (SELECT page_size FROM params)`,
  },
  'product-testing': {
    source: 'active_tester_pool_membership', participation: true,
    sql: `${PARAMS} SELECT t.user_id FROM product_testers t JOIN users u ON u.id = t.user_id
           WHERE t.user_id > (SELECT after_id FROM params) AND u.is_active = 1 AND t.status = 'active' ORDER BY t.user_id LIMIT (SELECT page_size FROM params)`,
  },
};

function evidenceFor(key: string) {
  if (!Object.hasOwn(EVIDENCE, key)) return null;
  return EVIDENCE[key as keyof typeof EVIDENCE];
}

export async function programGrantReconciliation(env: Env, query: Record<string, string | undefined>, day = todayUtc()) {
  const key = query.program ?? '';
  const cursor = query.after ?? '0';
  const size = query.limit ?? '100';
  const after = Number(cursor);
  const limit = Number(size);
  if (!/^\d+$/.test(cursor) || !/^\d+$/.test(size)
      || !Number.isSafeInteger(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new EntitlementError(400, 'invalid_reconciliation_page', 'Use a nonnegative account cursor and a page size from 1 to 200.');
  }
  if (!key) throw new EntitlementError(400, 'program_required', 'Choose a program to reconcile.');
  const evidence = evidenceFor(key);
  if (!evidence) throw new EntitlementError(400, 'evidence_not_mapped', 'No reconciliation evidence source is mapped for this program.');

  const found = await env.DB.prepare(evidence.sql).bind(after, day, limit + 1).all<{ user_id: number }>();
  const ids = found.results.slice(0, limit).map((row) => row.user_id);
  const read = await evaluateMany(env, ids, day);
  const items = ids.map((userId) => {
    const program = read.by.get(userId)?.find((p) => p.program_key === key);
    const grant = program?.grant ?? null;
    let disposition = 'review_licence';
    if (program?.in_force) disposition = 'in_force';
    else if (grant?.state === 'paused' || grant?.state === 'ended') disposition = 'preserve_grant_decision';
    else if (program?.eligible && !program.legally_ready) disposition = 'review_agreement';
    else if (program?.eligible) disposition = evidence.participation ? 'review_grant' : 'review_activity';
    return {
      user_id: userId, disposition, grant_state: grant?.state ?? null, grant_revision: grant?.revision ?? 0,
      source_licences: program?.sources.map((source) => source.licence_uid) ?? [],
      blockers: program?.blockers.map((blocker) => blocker.code) ?? ['no_eligible_licence'],
    };
  });
  return {
    on: day, program_key: key, evidence: evidence.source, agreements: read.agreements,
    items, next_after: found.results.length > limit ? ids.at(-1) : null,
  };
}
