/**
 * HQ's licence transitions, reaching the branch that runs under them (D137).
 *
 * THE DEFECT THIS CLOSES. `applyLicence` — the `HqEntrypoint` method whose
 * whole job is to hand a branch its licence — had NO CALLER anywhere in
 * `cloudflare-worker/src`, `frontend/src`, `scripts` or `.github`: only its
 * definition, its one-line delegation in `rpc/index.ts`, and tests. So
 * `POST /:uid/suspend` changed four columns in HQ's ledger and changed nothing
 * on the subsidiary. D135 made that urgent rather than theoretical: the
 * compliance sweep now suspends a licence on a clock, so without this an
 * account HQ believes is frozen belongs to a branch that goes on trading.
 *
 * THE PUSH IS REPORTED, NEVER THROWN — the D111 rule, and this is its fourth
 * instance (`routes/admin_escalations.ts` states it for the escalation answer).
 * HQ's ledger is the record. A branch that is unreachable, not yet provisioned,
 * or on an older deploy is a fact about the BRANCH; turning it into a 502 would
 * make an operator re-enter a decision that is already stored, and the second
 * attempt would find the transition already applied. So every caller keeps its
 * own write and its own 200, and carries `pushed` beside the outcome.
 *
 * ONE HELPER, FIVE CALLERS. Four licence transitions plus the compliance
 * sweep's own suspend. Copying D111's twelve lines five times is how the five
 * come to disagree about what "landed" means — the consolidation this repo has
 * now made for `likeNeedle`, the absence helpers, one `GROUP BY role`, one
 * definition of open, and one zone formatter.
 */
import { readLicenceTerms } from './licenceTerms';
import { programCopy } from './licencePrograms';
import { dealTypesForPush } from './partnerDealTypes';
import { slaPolicyForCopy } from './supportSlaPolicy';
import type { Env } from '../types';
import { branchByCode } from './branches';
import { mirrorBranchAction } from './auditMirror';

/**
 * D163 — one action name for all six callers, because the mirror groups by it
 * and five spellings would be five actions.
 */
const LICENCE_PUSH_ACTION = 'licence_pushed';

export type LicencePushResult = {
  /** Did the branch accept the copy? `false` is a real state, not an error. */
  ok: boolean;
  /** Why not, in a sentence an operator can act on. Absent when `ok`. */
  reason?: string;
  /** The branch this licence deploys to, when it has one. */
  code?: string | null;
  /**
   * #4686 — the HQ revision this attempt carried (null when HQ could not
   * allocate one, i.e. a database without the revision migration).
   */
  revision?: number | null;
  /** #4686 — a short machine word for why not; the screen maps it to a sentence. */
  failure_code?: string;
  /** #4686 — true when the failure must be retried (intent is persisted). */
  retry?: boolean;
  /** #4686 — true when there is cleanly no deployment: nothing to push, nothing owed. */
  no_deployment?: boolean;
  /** #4686 — the branch took the copy but not every section of it. */
  partial?: boolean;
  failed_sections?: string[];
  /** #4686 — the revision the branch reports holding, when it says. */
  branch_revision?: number | null;
};

type Row = Record<string, unknown>;

/**
 * Everything the branch's copy holds, in `branch_licence`'s own column
 * vocabulary — which is what `applyLicenceCopy` binds by name.
 *
 * `term_end` IS DELIBERATELY NULL. `branch_licence` has the column and HQ has
 * no such fact: `territory_licences` holds a DURATION (`term_years`) beside
 * `starts_on`. Computing an end date here would be the copy asserting something
 * HQ never said, which is the rule migration 265's header states and 257's
 * before it. The column stays written-and-unread rather than filled with a
 * derivation nobody at HQ would recognise.
 */
export function licenceRecord(
  licence: Row,
  territories: string[],
  seats: Record<string, number>,
  templateVersion: number | null,
  pushedAt: string,
): Record<string, unknown> {
  return {
    licence_uid: licence.uid,
    licence_ref: licence.licence_ref,
    legal_entity: licence.legal_entity_name,
    brand_name: licence.brand_name,
    territory: territories.join(','),
    status: licence.status,
    seats_json: JSON.stringify(seats),
    revenue_share_bps: licence.revenue_share_bps,
    token_split_bps: licence.token_split_bps,
    annual_fee_cents: licence.annual_fee_cents,
    currency: licence.currency,
    term_start: licence.starts_on,
    term_end: null,
    renewal_at: licence.renews_on,
    template_version: templateVersion,
    suspended_at: licence.suspended_at,
    suspended_note: licence.status_note,
    // Migration 265 — the five the copy never carried, so the branch's Entity
    // panel stops printing "Not recorded" about facts HQ holds.
    registered_address: licence.registered_address,
    signatory_name: licence.signatory_name,
    signatory_title: licence.signatory_title,
    term_years: licence.term_years,
    terminated_at: licence.terminated_at,
    // D206 — migration 284. Which KIND of licence the branch runs under, so
    // it can tell its own drawer which escalation kinds exist for it (H30).
    // Absent on a ledger that predates migration 279 — `SELECT *` simply has
    // no such key — and the copy stores that as unknown rather than guessing.
    kind: licence.kind ?? null,
    // HQ's clock, not the branch's: `pushed_at` is the moment HQ ASSERTED the
    // content, which migration 256 says is the whole value of the column — a
    // retry keeps the age of the fact rather than resetting it.
    pushed_at: pushedAt,
  };
}

/**
 * #4686 — a store whose migration this database has not applied holds nothing,
 * which is not the same as a store that failed to answer. The first is omitted
 * from the copy (HQ has recorded none); the second makes the push partial.
 */
function isMissingTable(e: unknown): boolean {
  return /no such table|no such column/i.test(String((e as Error)?.message ?? e));
}

/**
 * The whole copy of one licence, read fresh from HQ's ledger — the record the
 * push SENDS and the pull RETURNS (D206).
 *
 * WHY THERE IS ONE ASSEMBLER. The two used to build their records apart:
 * `pushLicenceToBranch` read `SELECT *` plus the latest contract's template
 * version, while `licenceForBranch` (the pull, `rpc/hqOps.ts`) named its own
 * column list — migration 187's — so it never carried migration 265's five
 * fields, sent `template_version: null` under a comment claiming HQ holds no
 * template version (the contract ledger does, and the push already read it),
 * and listed territories in whatever order the join returned. Two emitters of
 * one record disagreeing is the drift D137 fixed on the READ side of the copy;
 * this is the same defect on the write side, and `kind` would have been the
 * next field to reach one emitter and not the other.
 *
 * Throws when a read fails. A partial record is worse than a late one — a copy
 * without its territory would tell the branch it holds no country — so the
 * caller decides what a failure means for it.
 */
export async function assembleLicenceRecord(
  env: Env, licence: Row, pushedAt: string, revision?: number | null,
): Promise<Record<string, unknown>> {
  return (await assembleLicenceRecordDetailed(env, licence, pushedAt, revision)).record;
}

/**
 * #4686 — the same record, and WHICH optional sections HQ could not read. The
 * push used to omit an unreadable section and report the whole copy as
 * delivered; the caller now sees the list and answers partial.
 */
export async function assembleLicenceRecordDetailed(
  env: Env, licence: Row, pushedAt: string, revision?: number | null,
): Promise<{ record: Record<string, unknown>; unreadable: string[] }> {
  const unreadable: string[] = [];
  const licenceId = Number(licence.id);
  const t = await env.DB.prepare(
    'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
  ).bind(licenceId).all<{ country_code: string }>();
  const territories = (t.results || []).map((r) => String(r.country_code));
  const seats: Record<string, number> = {};
  const s = await env.DB.prepare(
    'SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ?',
  ).bind(licenceId).all<{ seat_type: string; seats_licensed: number }>();
  for (const row of s.results || []) seats[String(row.seat_type)] = Number(row.seats_licensed) || 0;
  const ct = await env.DB.prepare(
    'SELECT template_version FROM licence_contracts WHERE licence_uid = ? ORDER BY id DESC LIMIT 1',
  ).bind(String(licence.uid)).first<{ template_version: number }>();
  const templateVersion = ct ? Number(ct.template_version) : null;
  const record = licenceRecord(licence, territories, seats, templateVersion, pushedAt);
  // #4686 — the revision the branch orders this copy by. Absent when HQ has none
  // to give, in which case the branch falls back to `pushed_at` as before.
  if (revision !== undefined && revision !== null) record.hq_revision = revision;
  // D797 — the terms schedule (migration 512), as a row-shaped JSON string; the
  // JSON `null` says HQ has recorded none. Read in its own try: a ledger whose
  // terms cannot be read omits the key, so the branch keeps the terms it has
  // rather than losing the rest of the copy.
  try {
    const rec = await readLicenceTerms(env, String(licence.uid));
    record.terms_json = JSON.stringify(rec ? { ...rec.terms, sections_json: JSON.stringify(rec.sections) } : null);
  } catch (e) {
    if (!isMissingTable(e)) unreadable.push('terms');
    console.warn('[licencePush] licence_terms unreadable; the copy goes without them', (e as Error).message);
  }
  // D984 — the licence's program grants (migration 554), the same way: their
  // own try, and a store that cannot be read omits the key, so the branch keeps
  // the programs it has rather than reading an empty set as "none granted".
  try {
    record.program_grants_json = JSON.stringify(await programCopy(env, licenceId));
  } catch (e) {
    if (!isMissingTable(e)) unreadable.push('program_grants');
    console.warn('[licencePush] program_grants unreadable; the copy goes without them', (e as Error).message);
  }
  // D986 — the partner deal types this licence may offer (migration 555), the
  // same way: the JSON `null` says HQ has recorded none, and a store that
  // cannot be read omits the key so the branch keeps the set it has.
  try {
    record.partner_deal_types_json = await dealTypesForPush(env, licenceId);
  } catch (e) {
    if (!isMissingTable(e)) unreadable.push('partner_deal_types');
    console.warn('[licencePush] partner deal types unreadable; the copy goes without them', (e as Error).message);
  }
  // D5032 (#5032) — HQ's ticket SLA policy (P1/P2/P3 hours) and its version,
  // so a branch bands its tickets with the hours HQ says are current. Its own
  // try, like the sections above: a database without the store omits the key
  // and the branch keeps the hours it has; any other failure makes the push
  // partial rather than claiming the branch was sent the policy.
  try {
    record.support_sla_json = JSON.stringify(await slaPolicyForCopy(env));
  } catch (e) {
    if (!isMissingTable(e)) unreadable.push('support_sla');
    console.warn('[licencePush] support SLA policy unreadable; the copy goes without it', (e as Error).message);
  }
  return { record, unreadable };
}

/**
 * #4686 — allocate the next HQ BRANCH-SYNC revision for this licence. This is
 * `licence_sync_state.hq_revision`, which counts pushes; it is NOT
 * `territory_licences.revision` (#4678), which counts moves and edits for
 * compare-and-swap, and nothing compares the two. ATOMICALLY: one
 * statement increments and returns, so two concurrent pushes can never hold the
 * same number. Allocated BEFORE the licence is read, so a higher revision always
 * carries content read no earlier than a lower one.
 *
 * Returns null when the revision store is unavailable (a database without the
 * migration). The push then goes out unnumbered and the branch orders it by
 * `pushed_at`, exactly as it did before — a missing store loses the ordering,
 * never the push.
 */
export async function allocateRevision(env: Env, licenceId: number): Promise<number | null> {
  try {
    const row = await env.DB.prepare(
      `INSERT INTO licence_sync_state (licence_id, hq_revision) VALUES (?, 1)
       ON CONFLICT(licence_id) DO UPDATE SET hq_revision = licence_sync_state.hq_revision + 1,
                                             updated_at = datetime('now')
       RETURNING hq_revision`,
    ).bind(licenceId).first<{ hq_revision: number }>();
    const n = Number(row?.hq_revision);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch (e) {
    console.warn('[licencePush] could not allocate a revision', licenceId, (e as Error).message);
    return null;
  }
}

/**
 * Send this licence's current state to the branch deployed under it.
 *
 * Reads the licence fresh rather than taking the caller's copy, so the push
 * carries what the transition actually wrote rather than what the row looked
 * like before it.
 */
export async function pushLicenceToBranch(
  env: Env,
  licenceId: number,
  pushedAt: string = new Date().toISOString(),
): Promise<LicencePushResult> {
  const revision = await allocateRevision(env, licenceId);
  const result = { ...(await pushOnce(env, licenceId, pushedAt, revision)), revision };
  await recordPushOutcome(env, licenceId, result, pushedAt, revision);
  return result;
}

/**
 * D272 / #4686 — WHAT A PUSH LEAVES BEHIND, BOUND TO ITS REVISION.
 *
 * A push the branch acknowledged records that revision as the branch's and
 * deletes every pending row at or below it — never one above it, so an older
 * success cannot clear newer failed work. A push that failed leaves a row
 * carrying ITS revision; an older failure never overwrites a newer row's
 * revision or reason, and is not recorded at all once the branch has
 * acknowledged that revision or a later one (a late failure for a superseded
 * push). The row is written whenever the failure is retryable, including when
 * the deployment lookup or the licence reread was itself unavailable (the code
 * is then the empty string and the retry resolves it afresh). A licence with
 * cleanly no deployment writes nothing: the branch it will one day run under
 * pulls on its first read.
 *
 * Never throws, like the push itself (D111). A database without the migration
 * loses the retry, not the push.
 */
async function recordPushOutcome(
  env: Env, licenceId: number, result: LicencePushResult, at: string, revision: number | null,
): Promise<void> {
  try {
    if (result.ok || result.no_deployment) {
      if (revision === null) {
        await env.DB.prepare('DELETE FROM licence_push_pending WHERE licence_id = ?').bind(licenceId).run();
        return;
      }
      const acked = result.ok ? Math.max(revision, Number(result.branch_revision) || 0) : null;
      if (acked !== null) {
        await env.DB.prepare(
          `UPDATE licence_sync_state
              SET branch_revision = ?, last_success_at = ?, updated_at = datetime('now')
            WHERE licence_id = ? AND (branch_revision IS NULL OR branch_revision <= ?)`,
        ).bind(acked, at, licenceId, acked).run();
      }
      await env.DB.prepare('DELETE FROM licence_push_pending WHERE licence_id = ? AND revision <= ?')
        .bind(licenceId, acked ?? revision).run();
      return;
    }
    if (!result.retry && !result.code) return;
    const code = result.code ?? '';
    const reason = result.reason ?? null;
    if (revision === null) {
      // No revision store: the D272 shape, one row per licence.
      if (!result.code) return;
      await env.DB.prepare(
        `INSERT INTO licence_push_pending (licence_id, code, reason, attempts, first_failed_at, last_attempt_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(licence_id) DO UPDATE SET
           code = excluded.code, reason = excluded.reason,
           attempts = licence_push_pending.attempts + 1, last_attempt_at = excluded.last_attempt_at`,
      ).bind(licenceId, code, reason, at, at).run();
      return;
    }
    // A stale answer means the branch holds a LATER revision than HQ believes it
    // allocated (HQ's counter was lost or restored): raise the counter so the
    // next attempt is numbered above the branch, or every push would be refused.
    if (result.failure_code === 'stale_revision' && Number(result.branch_revision) > 0) {
      await env.DB.prepare(
        `UPDATE licence_sync_state SET hq_revision = ?, updated_at = datetime('now')
          WHERE licence_id = ? AND hq_revision < ?`,
      ).bind(Number(result.branch_revision), licenceId, Number(result.branch_revision)).run();
    }
    if (!result.code) {
      // A failure that never learnt which branch it was for (the licence reread
      // or the deployment lookup failed) knows nothing a row already holds does.
      // It writes a row when there is none — the intent must not be lost — and
      // otherwise leaves the existing row as it is (D4805's "queued with the
      // change" row keeps its code, reason and immediate pickup), raising only
      // the revision it stands for.
      await env.DB.prepare(
        `INSERT INTO licence_push_pending
           (licence_id, code, reason, attempts, first_failed_at, last_attempt_at, revision, failure_code)
         SELECT ?, '', ?, 1, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM licence_sync_state WHERE licence_id = ? AND branch_revision >= ?)
         ON CONFLICT(licence_id) DO UPDATE SET
           revision = MAX(licence_push_pending.revision, excluded.revision)`,
      ).bind(licenceId, reason, at, at, revision, result.failure_code ?? null, licenceId, revision).run();
      return;
    }
    await env.DB.prepare(
      `INSERT INTO licence_push_pending
         (licence_id, code, reason, attempts, first_failed_at, last_attempt_at, revision, failure_code)
       SELECT ?, ?, ?, 1, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM licence_sync_state WHERE licence_id = ? AND branch_revision >= ?)
       ON CONFLICT(licence_id) DO UPDATE SET
         attempts = licence_push_pending.attempts + 1,
         last_attempt_at = excluded.last_attempt_at,
         code = CASE WHEN excluded.revision >= licence_push_pending.revision THEN excluded.code ELSE licence_push_pending.code END,
         reason = CASE WHEN excluded.revision >= licence_push_pending.revision THEN excluded.reason ELSE licence_push_pending.reason END,
         failure_code = CASE WHEN excluded.revision >= licence_push_pending.revision THEN excluded.failure_code ELSE licence_push_pending.failure_code END,
         revision = MAX(licence_push_pending.revision, excluded.revision)`,
    ).bind(licenceId, code, reason, at, at, revision, result.failure_code ?? null, licenceId, revision).run();
  } catch (e) {
    console.warn('[licencePush] could not record the push outcome', licenceId, (e as Error).message);
  }
}

/**
 * D4805 (#4805) — THE PUSH IS OWED FROM THE COMMIT. A transition used to push inline after its write, so a
 * Worker that died between the two left the branch with an old copy and nothing to retry it. This is the
 * statement for the transition's own batch: it writes the licence's `licence_push_pending` row (D272) with
 * the change, dated so the next retry picks it up. The inline push after the commit still runs and clears the
 * row when it lands; the retry (`retryPendingLicencePushes`) sends the ones that did not, from the licence
 * as it is then, and never repeats the transition. A licence with no deployment writes nothing: the branch
 * pulls on its first read. `afterChange` makes it run only when the statement before it changed a row.
 */
export function queuePushStatement(env: Env, licenceId: number, afterChange = false): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO licence_push_pending (licence_id, code, reason, attempts, first_failed_at, last_attempt_at)
     SELECT l.id, d.code, 'queued with the change', 0, ?, '1970-01-01T00:00:00.000Z'
       FROM territory_licences l JOIN licence_deployments d ON d.licence_uid = l.uid
      WHERE l.id = ? AND (? = 0 OR changes() = 1)
     ON CONFLICT(licence_id) DO UPDATE SET reason = 'queued with the change', last_attempt_at = '1970-01-01T00:00:00.000Z'`,
  ).bind(new Date().toISOString(), licenceId, afterChange ? 1 : 0);
}

/** D272 — a pending push is retried at most once per this window. */
export const LICENCE_PUSH_RETRY_WINDOW_MINUTES = 60;
/** D272 — and at most this many per run, so one tick stays bounded. */
export const LICENCE_PUSH_RETRY_CAP = 20;

export type LicencePushRetry =
  | { available: true; tried: number; ok: number; failed: number }
  | { available: false; reason: string };

/**
 * D272 — re-send every licence push that has not landed, once per window.
 *
 * Called from HQ's scheduled handler. Each row whose last attempt is older
 * than the window is pushed again through `pushLicenceToBranch`, which reads
 * the licence FRESH — so the retry carries the current record, not the one
 * that failed — under a NEW revision, and clears or bumps the row. A row
 * attempted inside the window is left alone, which is the throttle: a binding
 * that stays broken costs one call per licence per window, not one per tick.
 * Reports, never throws.
 */
export async function retryPendingLicencePushes(env: Env, now: Date = new Date()): Promise<LicencePushRetry> {
  let rows: { licence_id: number }[];
  try {
    const cutoff = new Date(now.getTime() - LICENCE_PUSH_RETRY_WINDOW_MINUTES * 60_000).toISOString();
    const r = await env.DB.prepare(
      `SELECT licence_id FROM licence_push_pending
        WHERE datetime(last_attempt_at) <= datetime(?)
        ORDER BY datetime(last_attempt_at) LIMIT ?`,
    ).bind(cutoff, LICENCE_PUSH_RETRY_CAP).all<{ licence_id: number }>();
    rows = r.results || [];
  } catch (e) {
    return { available: false, reason: `The pending licence pushes could not be read: ${(e as Error).message}` };
  }
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const res = await pushLicenceToBranch(env, Number(row.licence_id), now.toISOString());
    if (res.ok || res.no_deployment) ok += 1; else failed += 1;
  }
  return { available: true, tried: rows.length, ok, failed };
}

/** #4686 — the code a licence deploys to; null when it cleanly has none. Throws when the registry is unreadable. */
export async function deploymentCodeFor(env: Env, licenceUid: string): Promise<string | null> {
  try {
    const dep = await env.DB.prepare('SELECT code FROM licence_deployments WHERE licence_uid = ?')
      .bind(licenceUid).first<{ code: string }>();
    return dep?.code ?? null;
  } catch (e) {
    // A database that never created the registry has no branch to reach.
    if (isMissingTable(e)) return null;
    throw e;
  }
}

async function pushOnce(
  env: Env,
  licenceId: number,
  pushedAt: string,
  revision: number | null,
): Promise<LicencePushResult> {
  let licence: Row | null = null;
  try {
    licence = await env.DB.prepare(
      'SELECT * FROM territory_licences WHERE id = ?',
    ).bind(licenceId).first<Row>();
  } catch (e) {
    return {
      ok: false, retry: true, failure_code: 'licence_unreadable',
      reason: `HQ could not re-read the licence to push it: ${(e as Error).message}`,
    };
  }
  if (!licence) return { ok: false, reason: 'No such licence at HQ.' };

  // A licence with no deployment has no branch to reach, which is the state
  // every licence is in until one is provisioned. It is not a failure and the
  // sentence says so.
  let code: string | null = null;
  try {
    code = await deploymentCodeFor(env, String(licence.uid));
  } catch (e) {
    // #4686 — a lookup that FAILED is not "no deployment". The old code treated
    // both as nothing-to-do and wrote no retry, so a transient registry error
    // during a termination left the branch unsynchronised with nothing owed.
    return {
      ok: false, code: null, retry: true, failure_code: 'deployment_unreadable',
      reason: `HQ could not read which branch this licence deploys to: ${(e as Error).message}`,
    };
  }
  if (!code) {
    return {
      ok: false,
      code: null,
      no_deployment: true,
      // D244 — the second sentence used to promise the change "will reach the
      // branch when one is provisioned", and nothing did that: provisioning
      // pushes nothing, and until D244 a branch never asked. It asks now — a
      // branch holding no copy pulls one on its first read (routes/licence.ts,
      // `pullLicenceCopy`) — so the sentence says that instead.
      reason: 'This licence has no branch deployment, so there is nothing to push to. '
        + 'The change is recorded at HQ, and a branch provisioned for this licence reads it from '
        + 'HQ the first time it asks.',
    };
  }

  const binding = branchByCode(env, code);
  if (!binding) {
    mirrorBranchAction(env, LICENCE_PUSH_ACTION, 'not_deployed', code);
    return {
      ok: false,
      code,
      retry: true,
      failure_code: 'not_bound',
      // D244 — "will reach the branch when a binding exists" was the same
      // promise: nothing re-sends a change when HQ gains a binding. What is true
      // depends on the branch. One that holds no copy pulls it the first time
      // it asks; one that already holds a copy never asks, and keeps what it
      // has until a push reaches it — which needs the binding this lacks.
      reason: `No branch Worker is bound for ${code}, so the change is recorded at HQ `
        + 'and has not reached the branch. A branch that holds no copy yet reads it from HQ the '
        + 'first time it asks; one that already holds a copy keeps it until a push reaches it '
        + 'through a binding.',
    };
  }

  let record: Record<string, unknown>;
  let unreadable: string[] = [];
  try {
    ({ record, unreadable } = await assembleLicenceRecordDetailed(env, licence, pushedAt, revision));
  } catch (e) {
    // A partial record is worse than a late one: a copy pushed without its
    // territory would tell the branch it holds no country.
    mirrorBranchAction(env, LICENCE_PUSH_ACTION, 'failed', code);
    return {
      ok: false, code, retry: true, failure_code: 'assemble_failed',
      reason: `HQ could not assemble the licence copy: ${(e as Error).message}`,
    };
  }

  try {
    const res = await binding.stub.applyLicence(record);
    // The branch answers with its own object. `{ok:false, reason}` from there is
    // a real state — a branch that refused the copy — and an operator should
    // read the branch's own sentence rather than a generic success.
    const ans = (res && typeof res === 'object' ? res : null) as Record<string, unknown> | null;
    const branchRevision = ans && Number.isFinite(Number(ans.hq_revision)) && ans.hq_revision !== null
      ? Number(ans.hq_revision) : null;
    // #4686 — the branch holds a LATER revision than this push: it kept its
    // copy. Superseded by a newer acknowledged push, or HQ's counter is behind.
    if (ans && ans.stale === true) {
      mirrorBranchAction(env, LICENCE_PUSH_ACTION, 'failed', code);
      return {
        ok: false, code, retry: true, failure_code: 'stale_revision', branch_revision: branchRevision,
        reason: 'The branch already holds a later revision of this licence, so it kept its copy.',
      };
    }
    if (ans && 'ok' in ans) {
      const answered = { ...(res as LicencePushResult), code };
      // D163 — the branch's OWN verdict, not the fact that it answered. A
      // refusal reaching HQ is a landed call and a failed push, and the mirror
      // records the second.
      mirrorBranchAction(env, LICENCE_PUSH_ACTION, answered.ok ? 'ok' : 'failed', code);
      if (!answered.ok) {
        return {
          ...answered, retry: true,
          failure_code: ans.partial === true ? 'partial' : 'refused',
          branch_revision: branchRevision,
        };
      }
      return unreadable.length ? partialAtHq(code, unreadable, branchRevision) : { ...answered, branch_revision: branchRevision };
    }
    mirrorBranchAction(env, LICENCE_PUSH_ACTION, unreadable.length ? 'failed' : 'ok', code);
    if (unreadable.length) return partialAtHq(code, unreadable, branchRevision);
    return { ok: true, code, branch_revision: branchRevision };
  } catch (e) {
    mirrorBranchAction(env, LICENCE_PUSH_ACTION, 'failed', code);
    return {
      ok: false, code, retry: true, failure_code: 'unreachable',
      reason: `The branch did not accept the licence: ${(e as Error).message}`,
    };
  }
}

/**
 * #4686 — the branch took the copy, but HQ could not read some optional
 * sections to put in it. The copy is NOT reported as delivered: it is a partial
 * push, and stays pending until HQ can send the whole.
 */
function partialAtHq(code: string, sections: string[], branchRevision: number | null): LicencePushResult {
  return {
    ok: false, code, retry: true, partial: true, failed_sections: sections, failure_code: 'partial',
    branch_revision: branchRevision,
    reason: `HQ could not read ${sections.join(', ')}, so the branch received the licence without `
      + `${sections.length === 1 ? 'that section' : 'those sections'}. It is not reported as fully delivered.`,
  };
}
