/**
 * Automatic graduation-certificate issuance.
 *
 * The `spinout_certificates` registry (routes/spinout_certificates.ts) has
 * shipped with issue, revoke, list, mine and sharing routes, and the public
 * verifier is live — but nothing ever CALLED the issue route. No admin surface
 * binds it and no server path invoked it, so the registry had never allocated
 * a single credential and every graduate's page correctly read "not yet
 * issued". This module closes that: graduation itself issues the credential.
 *
 * WHAT COUNTS AS GRADUATION. The `incorporation_completed` milestone, which is
 * already the definition everywhere else in the product — the public graduate
 * list, GET /spinout-lab/stats, week-4 gating and the deck's completion note
 * all key on exactly that row. Using anything else here would create a second,
 * competing definition of "graduated", which is the class of bug this codebase
 * keeps finding.
 *
 * THE SNAPSHOT IS DELIBERATE. Every public_* column is copied at issue time
 * rather than joined at read time. A credential asserts a fact about a moment:
 * that this founder, with this company, completed this cohort on this date. If
 * the public verifier joined live rows, renaming a project two years later
 * would retroactively rewrite what the credential says — and a verifier
 * checking it would see something the holder never earned. The snapshot is
 * also what lets the public route avoid joining `users` at all, which is what
 * keeps emails and internal ids off an unauthenticated endpoint.
 *
 * ISSUANCE IS BEST-EFFORT AND NEVER THROWS. It hangs off the milestone write,
 * and a founder finishing the program must not see their completion fail
 * because a certificate insert did. Failures are logged and left for the
 * backfill to pick up.
 */
import type { Env } from '../types';
import { credentialRefFor } from '../routes/spinout_certificates';

export type IssueOutcome =
  | 'issued'
  | 'already_issued'
  | 'not_graduated'
  | 'insufficient_data'
  | 'error';

type GraduateFacts = {
  user_id: number;
  name: string | null;
  conferred_at: string | null;
  cohort: string | null;
  company: string | null;
  project_id: number | null;
  jurisdiction: string | null;
  started_at: string | null;
};

/**
 * Everything the credential snapshot needs, in one read.
 *
 * Mirrors the frontend's `buildCertificateViewModel` field-for-field so an
 * issued credential says exactly what the founder's own page showed them
 * before issuance: company from their Lab project (falling back to the
 * application's company name), cohort from their spinout flags, jurisdiction
 * from their application, conferral date from the milestone row itself.
 */
async function loadGraduateFacts(env: Env, userId: number): Promise<GraduateFacts | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT
         u.id                AS user_id,
         u.name              AS name,
         u.spinout_lab_started_at AS started_at,
         m.completed_at      AS conferred_at,
         f.spinout_lab_cohort AS cohort,
         p.id                AS project_id,
         p.name              AS project_name,
         a.company_name      AS application_company,
         a.jurisdiction      AS jurisdiction
       FROM users u
       JOIN spinout_lab_milestones m
         ON m.user_id = u.id AND m.milestone_key = 'incorporation_completed'
       LEFT JOIN user_spinout_flags f ON f.user_id = u.id
       LEFT JOIN projects p
         ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       LEFT JOIN spinout_applications a
         ON a.user_id = u.id
       WHERE u.id = ?
       ORDER BY p.id ASC, a.id DESC
       LIMIT 1`,
    ).bind(userId).first<any>();
    if (!row) return null;
    return {
      user_id: Number(row.user_id),
      name: row.name ?? null,
      conferred_at: row.conferred_at ?? null,
      cohort: row.cohort ?? null,
      company: (row.project_name || row.application_company || null),
      project_id: row.project_id ?? null,
      jurisdiction: row.jurisdiction ?? null,
      started_at: row.started_at ?? null,
    };
  } catch {
    return null; // tables predating the Lab migrations
  }
}

/**
 * Days from start to conferral, INCLUSIVE.
 *
 * Byte-for-byte the rule in lib/graduationCertificate.js `programDays`:
 * floor of the elapsed days plus one, floored at 1. It has to be — the founder
 * sees that number on their certificate page before issuance, and the snapshot
 * stored here is what the public verifier reports afterwards. A different
 * rounding rule on the two sides means the page and the credential state
 * different durations for the same graduation.
 *
 * Both timestamps are normalised the same way, so whether the strings carry a
 * zone only shifts both endpoints together and cancels out of the difference.
 */
function programDays(startedAt: string | null, conferredAt: string | null): number | null {
  if (!startedAt || !conferredAt) return null;
  const ms = (s: string) => Date.parse(
    s.includes('T') ? s : `${s.replace(' ', 'T')}Z`,
  );
  const a = ms(String(startedAt));
  const b = ms(String(conferredAt));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(1, Math.floor((b - a) / 86_400_000) + 1);
}

/**
 * Issue this founder's credential if they have graduated and don't have one.
 *
 * Idempotent on three levels, because it runs from a side-effect path that can
 * fire more than once: an explicit pre-check, the registry's partial UNIQUE
 * index on (user_id) WHERE status='issued', and an INSERT that tolerates the
 * conflict. Re-running it is always safe.
 */
export async function issueOnGraduation(env: Env, userId: number): Promise<IssueOutcome> {
  try {
    if (!Number.isFinite(userId) || userId <= 0) return 'insufficient_data';

    const existing = await env.DB.prepare(
      `SELECT id FROM spinout_certificates WHERE user_id = ? AND status = 'issued'`,
    ).bind(userId).first<{ id: number }>().catch(() => null);
    if (existing) return 'already_issued';

    const facts = await loadGraduateFacts(env, userId);
    // No milestone row means the JOIN found nothing: not a graduate.
    if (!facts) return 'not_graduated';
    if (!facts.conferred_at) return 'not_graduated';

    // A certificate with no name on it is not a certificate. Better to leave
    // it unissued and let the backfill retry once the profile is filled in
    // than to mint a credential reading "null".
    const name = String(facts.name || '').trim();
    if (!name) return 'insufficient_data';

    const conferredOn = String(facts.conferred_at).slice(0, 10);
    const credentialId = credentialRefFor(facts.cohort, conferredOn, userId);
    if (!credentialId) return 'insufficient_data';

    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO spinout_certificates
         (credential_id, user_id, project_id, public_name, public_company, public_cohort,
          public_issued_on, public_jurisdiction, public_program_days, issued_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      credentialId, userId, facts.project_id, name,
      facts.company, facts.cohort, conferredOn, facts.jurisdiction,
      programDays(facts.started_at, facts.conferred_at),
    ).run();

    // issued_by_user_id stays NULL deliberately: nobody issued this by hand,
    // and writing a real admin id would misattribute an automatic action to a
    // person in the audit trail.
    return (res.meta?.changes ?? 0) > 0 ? 'issued' : 'already_issued';
  } catch (e) {
    console.error('[certificates] auto-issue failed', userId, (e as Error)?.message);
    return 'error';
  }
}

/**
 * Issue credentials for graduates who finished before auto-issuance existed.
 *
 * Everyone carrying `incorporation_completed` without an issued row. Runs the
 * same single-founder path per graduate, so it cannot mint anything the live
 * path wouldn't, and re-running it is a no-op.
 *
 * Bounded per call: this is a catch-up job, not a migration, and an unbounded
 * loop over a growing table inside a Worker request is how you find the CPU
 * limit. It reports what it did rather than assuming it finished.
 */
export async function backfillCertificates(
  env: Env, limit = 100,
): Promise<{ scanned: number; issued: number; skipped: number; remaining: number }> {
  const out = { scanned: 0, issued: 0, skipped: 0, remaining: 0 };
  try {
    const cap = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = await env.DB.prepare(
      `SELECT DISTINCT m.user_id
         FROM spinout_lab_milestones m
         LEFT JOIN spinout_certificates c
           ON c.user_id = m.user_id AND c.status = 'issued'
        WHERE m.milestone_key = 'incorporation_completed'
          AND c.id IS NULL
        ORDER BY m.user_id ASC
        LIMIT ?`,
    ).bind(cap + 1).all<{ user_id: number }>();

    const ids = (rows.results || []).map((r) => Number(r.user_id));
    // One extra row was fetched purely to answer "is there more?" without a
    // second COUNT over the same join.
    out.remaining = Math.max(0, ids.length - cap);
    for (const id of ids.slice(0, cap)) {
      out.scanned += 1;
      const r = await issueOnGraduation(env, id);
      if (r === 'issued') out.issued += 1;
      else out.skipped += 1;
    }
  } catch (e) {
    console.error('[certificates] backfill failed', (e as Error)?.message);
  }
  return out;
}
