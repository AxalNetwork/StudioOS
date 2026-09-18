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
import type { Env } from '../types';
import { branchByCode } from './branches';

export type LicencePushResult = {
  /** Did the branch accept the copy? `false` is a real state, not an error. */
  ok: boolean;
  /** Why not, in a sentence an operator can act on. Absent when `ok`. */
  reason?: string;
  /** The branch this licence deploys to, when it has one. */
  code?: string | null;
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
    // HQ's clock, not the branch's: `pushed_at` is the moment HQ ASSERTED the
    // content, which migration 256 says is the whole value of the column — a
    // retry keeps the age of the fact rather than resetting it.
    pushed_at: pushedAt,
  };
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
  let licence: Row | null = null;
  try {
    licence = await env.DB.prepare(
      'SELECT * FROM territory_licences WHERE id = ?',
    ).bind(licenceId).first<Row>();
  } catch (e) {
    return { ok: false, reason: `HQ could not re-read the licence to push it: ${(e as Error).message}` };
  }
  if (!licence) return { ok: false, reason: 'No such licence at HQ.' };

  // A licence with no deployment has no branch to reach, which is the state
  // every licence is in until one is provisioned. It is not a failure and the
  // sentence says so.
  let code: string | null = null;
  try {
    const dep = await env.DB.prepare(
      'SELECT code FROM licence_deployments WHERE licence_uid = ?',
    ).bind(String(licence.uid)).first<{ code: string }>();
    code = dep?.code ?? null;
  } catch {
    // The table is missing on this database. Same answer as no row: there is
    // no branch to reach. Distinguishing them would be a claim about
    // provisioning that this function is not the place to make.
    code = null;
  }
  if (!code) {
    return {
      ok: false,
      code: null,
      reason: 'This licence has no branch deployment, so there is nothing to push to. '
        + 'The change is recorded at HQ and will reach the branch when one is provisioned.',
    };
  }

  const binding = branchByCode(env, code);
  if (!binding) {
    return {
      ok: false,
      code,
      reason: `No branch Worker is bound for ${code}, so the change is recorded at HQ `
        + 'and will reach the branch when a binding exists.',
    };
  }

  let territories: string[] = [];
  const seats: Record<string, number> = {};
  let templateVersion: number | null = null;
  try {
    const t = await env.DB.prepare(
      'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
    ).bind(licenceId).all<{ country_code: string }>();
    territories = (t.results || []).map((r) => String(r.country_code));
    const s = await env.DB.prepare(
      'SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ?',
    ).bind(licenceId).all<{ seat_type: string; seats_licensed: number }>();
    for (const row of s.results || []) seats[String(row.seat_type)] = Number(row.seats_licensed) || 0;
    const ct = await env.DB.prepare(
      'SELECT template_version FROM licence_contracts WHERE licence_uid = ? ORDER BY id DESC LIMIT 1',
    ).bind(String(licence.uid)).first<{ template_version: number }>();
    templateVersion = ct ? Number(ct.template_version) : null;
  } catch (e) {
    // A partial record is worse than a late one: a copy pushed without its
    // territory would tell the branch it holds no country.
    return { ok: false, code, reason: `HQ could not assemble the licence copy: ${(e as Error).message}` };
  }

  try {
    const res = await binding.stub.applyLicence(
      licenceRecord(licence, territories, seats, templateVersion, pushedAt),
    );
    // The branch answers with its own object. `{ok:false, reason}` from there is
    // a real state — a branch that refused the copy — and an operator should
    // read the branch's own sentence rather than a generic success.
    if (res && typeof res === 'object' && 'ok' in (res as Record<string, unknown>)) {
      return { ...(res as LicencePushResult), code };
    }
    return { ok: true, code };
  } catch (e) {
    return { ok: false, code, reason: `The branch did not accept the licence: ${(e as Error).message}` };
  }
}
