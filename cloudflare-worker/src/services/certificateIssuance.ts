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
import { branchOf } from '../util/branch';
import { programRefusal } from './programEnforcement';

export type IssueOutcome =
  | 'issued'
  | 'already_issued'
  | 'not_graduated'
  | 'insufficient_data'
  // D382: the graduate holds a REVOKED credential whose id this issuance would
  // derive again. `credential_id` is UNIQUE and deterministic (cohort, date,
  // user), so a same-date reissue cannot be written; before D382 the
  // `INSERT OR IGNORE` below swallowed that conflict and reported
  // `already_issued` for a graduate who holds no live credential.
  | 'reissue_blocked'
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
  // D4659: a graduate by the one programme rule (view spinout_lab_graduates,
  // by_rule = 1), conferred when the last required step landed, and the
  // company is the enrollment's venture — never "the lowest-numbered project
  // this founder owns". No venture recorded (several projects, none chosen)
  // means the facts are incomplete and nothing is issued yet.
  try {
    const row = await env.DB.prepare(
      `SELECT
         u.id                AS user_id,
         u.name              AS name,
         u.spinout_lab_started_at AS started_at,
         g.graduated_at      AS conferred_at,
         f.spinout_lab_cohort AS cohort,
         a.company_name      AS application_company,
         a.jurisdiction      AS jurisdiction
       FROM users u
       JOIN spinout_lab_graduates g ON g.user_id = u.id AND g.by_rule = 1
       LEFT JOIN user_spinout_flags f ON f.user_id = u.id
       LEFT JOIN spinout_applications a ON a.user_id = u.id
       WHERE u.id = ?
       ORDER BY a.id DESC
       LIMIT 1`,
    ).bind(userId).first<any>();
    if (!row) return null;
    const { resolveVenture } = await import('./labVenture');
    const venture = await resolveVenture(env, userId);
    if (venture.status === 'bound') {
      return { ...base(row), project_id: venture.project.id, company: venture.project.name || row.application_company || null };
    }
    // No project at all: nothing is ambiguous, the application names the company.
    if (venture.status === 'none') return base(row);
    // Several projects and none chosen, or the chosen one deleted: wait for the choice.
    return { ...base(row), conferred_at: null, project_id: null, company: null };
  } catch {
    return null; // tables predating the Lab migrations
  }
}

function base(row: any): GraduateFacts {
  return {
    user_id: Number(row.user_id),
    name: row.name ?? null,
    conferred_at: row.conferred_at ?? null,
    cohort: row.cohort ?? null,
    company: row.application_company ?? null,
    project_id: null,
    jurisdiction: row.jurisdiction ?? null,
    started_at: row.started_at ?? null,
  };
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
export async function issueOnGraduation(
  env: Env, userId: number, issuedBy: number | null = null,
): Promise<IssueOutcome> {
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

    const taken = await env.DB.prepare(
      `SELECT id FROM spinout_certificates WHERE credential_id = ? AND status <> 'issued'`,
    ).bind(credentialId).first<{ id: number }>();
    if (taken) return 'reissue_blocked';

    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO spinout_certificates
         (credential_id, user_id, project_id, public_name, public_company, public_cohort,
          public_issued_on, public_jurisdiction, public_program_days, issued_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      credentialId, userId, facts.project_id, name,
      facts.company, facts.cohort, conferredOn, facts.jurisdiction,
      programDays(facts.started_at, facts.conferred_at),
      issuedBy,
    ).run();

    // issued_by_user_id is NULL on the automatic path deliberately: nobody
    // issued it by hand, and writing a real admin id would misattribute an
    // automatic action to a person. The admin tab's Issue (D382) runs this
    // same path and passes the admin's id, because that one WAS a person.
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
      `SELECT g.user_id
         FROM spinout_lab_graduates g
         LEFT JOIN spinout_certificates c
           ON c.user_id = g.user_id AND c.status = 'issued'
        WHERE g.by_rule = 1
          AND c.id IS NULL
        ORDER BY g.user_id ASC
        LIMIT ?`,
    ).bind(cap + 1).all<{ user_id: number }>();

    const ids = (rows.results || []).map((r) => Number(r.user_id));
    // One extra row was fetched purely to answer "is there more?" without a
    // second COUNT over the same join.
    out.remaining = Math.max(0, ids.length - cap);
    for (const id of ids.slice(0, cap)) {
      out.scanned += 1;
      const r = await issueOnGraduation(env, id);
      if (r === 'issued') {
        out.issued += 1;
        // D541 (#1104, question 1 A): a certificate the backfill issues pays
        // the graduation bonus on the same terms as one issued live.
        const { creditLabGraduation } = await import('./labMilestoneCredits');
        await creditLabGraduation(env, id);
      } else out.skipped += 1;
    }
  } catch (e) {
    console.error('[certificates] backfill failed', (e as Error)?.message);
  }
  return out;
}

/**
 * D4663 (#4663, owner decision A) — THE SCHEDULED BACKFILL.
 *
 * Graduation closes the Lab, and the progress reconciler walks only founders
 * whose Lab is on. A graduate whose final request died after the milestone
 * insert and before the credential was issued would otherwise wait for an
 * admin's "Issue all eligible". The every-minute cron runs this instead.
 *
 * WHO. A graduate by the programme rule with no certificate row at all: the
 * admin desk's "awaiting" definition. A graduate holding a REVOKED credential
 * is never picked: revocation is an admin's decision, and the scheduled path
 * must not mint a replacement behind it.
 *
 * BOUNDED. At most CERT_BACKFILL_TICK_LIMIT graduates per tick, untried ones
 * first. A graduate whose last try did not issue (no name on record, no
 * venture chosen yet) waits CERT_BACKFILL_RETRY_MS before the next, so one who
 * cannot be issued never holds the queue and is not retried every minute.
 *
 * IDEMPOTENT. Each graduate runs `issueOnGraduation` (pre-check, partial
 * UNIQUE index, INSERT OR IGNORE) and, when it issued, `creditLabGraduation`
 * (source ref `lab:<user>:graduation`). A second tick finds nobody: the
 * credential now exists.
 *
 * FROZEN AND UNGRANTED BRANCHES ISSUE NOTHING, as the admin backfill route
 * refuses: a suspended branch (D511) and a branch whose licence does not hold
 * the Spin-Out Lab (D985) only record that the tick was held.
 *
 * RECORDED. Every graduate tried has a row in
 * spinout_certificate_backfill_attempts; the tick's own result replaces the
 * one row of spinout_certificate_backfill_tick. A failed candidate read
 * throws, so the cron row reads `partial` rather than "nobody waiting".
 */
export const CERT_BACKFILL_TICK_LIMIT = 3;
export const CERT_BACKFILL_RETRY_MS = 6 * 60 * 60_000;

export type CertificateBackfillTick = {
  status: 'done' | 'frozen' | 'not_granted' | 'grants_unreadable';
  scanned: number;
  issued: number;
  skipped: number;
  /** True when more graduates were due than this tick took. */
  more_waiting: boolean;
};

const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

async function branchSuspended(env: Env): Promise<boolean> {
  if (!branchOf(env)) return false;
  try {
    const row = await env.DB.prepare('SELECT status FROM branch_licence WHERE id = 1').first<{ status: string }>();
    return String(row?.status ?? '').toLowerCase() === 'suspended';
  } catch {
    // The posture of requireBranchNotSuspended: an unreadable copy is no claim from HQ.
    return false;
  }
}

export async function runCertificateBackfillTick(
  env: Env, opts: { limit?: number; nowMs?: number } = {},
): Promise<CertificateBackfillTick> {
  const limit = Math.max(1, Math.min(10, Math.floor(Number(opts.limit ?? CERT_BACKFILL_TICK_LIMIT)) || CERT_BACKFILL_TICK_LIMIT));
  const nowMs = opts.nowMs ?? Date.now();
  const now = sqlTime(nowMs);
  const out: CertificateBackfillTick = { status: 'done', scanned: 0, issued: 0, skipped: 0, more_waiting: false };

  if (await branchSuspended(env)) out.status = 'frozen';
  else {
    const refused = await programRefusal(env, 'spinout-lab', now.slice(0, 10));
    if (refused) out.status = refused.status === 503 ? 'grants_unreadable' : 'not_granted';
  }

  if (out.status === 'done') {
    const rows = await env.DB.prepare(
      `SELECT g.user_id
         FROM spinout_lab_graduates g
         LEFT JOIN spinout_certificate_backfill_attempts a ON a.user_id = g.user_id
        WHERE g.by_rule = 1
          AND NOT EXISTS (SELECT 1 FROM spinout_certificates c WHERE c.user_id = g.user_id)
          AND (a.user_id IS NULL OR a.last_attempt_at <= ?)
        ORDER BY (a.user_id IS NOT NULL), a.last_attempt_at, g.user_id
        LIMIT ?`,
    ).bind(sqlTime(nowMs - CERT_BACKFILL_RETRY_MS), limit + 1).all<{ user_id: number }>();
    const ids = (rows.results || []).map((r) => Number(r.user_id));
    out.more_waiting = ids.length > limit;
    for (const id of ids.slice(0, limit)) {
      out.scanned += 1;
      const outcome = await issueOnGraduation(env, id);
      let bonus: string | null = null;
      if (outcome === 'issued') {
        out.issued += 1;
        // D541: a certificate the backfill issues pays the graduation bonus on the same terms.
        const { creditLabGraduation } = await import('./labMilestoneCredits');
        const b = await creditLabGraduation(env, id);
        bonus = b.status === 'skipped' ? `skipped:${b.reason}` : String(b.status);
      } else out.skipped += 1;
      try {
        await env.DB.prepare(
          `INSERT INTO spinout_certificate_backfill_attempts
             (user_id, attempts, last_outcome, bonus_outcome, first_attempt_at, last_attempt_at, issued_at)
           VALUES (?, 1, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             attempts = attempts + 1,
             last_outcome = excluded.last_outcome,
             bonus_outcome = excluded.bonus_outcome,
             last_attempt_at = excluded.last_attempt_at,
             issued_at = COALESCE(spinout_certificate_backfill_attempts.issued_at, excluded.issued_at)`,
        ).bind(id, outcome, bonus, now, now, outcome === 'issued' ? now : null).run();
      } catch (e) {
        console.error('[certificates] backfill attempt not recorded', id, (e as Error)?.message);
      }
    }
  }

  await env.DB.prepare(
    `INSERT INTO spinout_certificate_backfill_tick (id, ran_at, status, scanned, issued, skipped, more_waiting)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ran_at = excluded.ran_at, status = excluded.status, scanned = excluded.scanned,
       issued = excluded.issued, skipped = excluded.skipped, more_waiting = excluded.more_waiting`,
  ).bind(now, out.status, out.scanned, out.issued, out.skipped, out.more_waiting ? 1 : 0).run();
  return out;
}

export type CertificateBackfillState = {
  /** null: no tick has been recorded. That is "not recorded", never "nothing issued". */
  last_tick: (CertificateBackfillTick & { ran_at: string }) | null;
  /** Graduates the scheduled backfill tried and could not issue, by their last outcome. */
  not_issued: Record<string, number>;
};

/** What the scheduled backfill last did. Throws when it cannot be read; the caller says "unreadable". */
export async function readCertificateBackfillState(env: Env): Promise<CertificateBackfillState> {
  const t = await env.DB.prepare(
    `SELECT ran_at, status, scanned, issued, skipped, more_waiting FROM spinout_certificate_backfill_tick WHERE id = 1`,
  ).first<any>();
  const waiting = await env.DB.prepare(
    `SELECT a.last_outcome, COUNT(*) AS n
       FROM spinout_certificate_backfill_attempts a
      WHERE NOT EXISTS (SELECT 1 FROM spinout_certificates c WHERE c.user_id = a.user_id)
      GROUP BY a.last_outcome`,
  ).all<{ last_outcome: string; n: number }>();
  const not_issued: Record<string, number> = {};
  for (const r of waiting.results || []) not_issued[String(r.last_outcome)] = Number(r.n);
  return {
    last_tick: t ? {
      ran_at: String(t.ran_at), status: t.status, scanned: Number(t.scanned), issued: Number(t.issued),
      skipped: Number(t.skipped), more_waiting: Number(t.more_waiting) === 1,
    } : null,
    not_issued,
  };
}
