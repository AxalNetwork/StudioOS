/**
 * The subsidiary administrator's read of their OWN territory licence.
 *
 * WHY THIS IS SEPARATE FROM admin_licences.ts. That file is HQ's ledger: every
 * licence, and every write. This is one licence, read-only, for the person who
 * administers it. A subsidiary admin is not a super admin — the design is
 * explicit that they have "their own profile and a different dashboard" — and
 * the cleanest expression of that is a different route with a different guard,
 * not a `role === 'admin'` branch inside HQ's endpoints.
 *
 * WHAT IT WILL NOT SHOW, and why the endpoint says so instead of leaving a
 * hole for the UI to fill. Migration 187 built the licence LEDGER and was
 * explicit that it is not the tenancy SCOPE: no account, project, deal or
 * document carries a licence_id. So accounts in territory, revenue per
 * subsidiary and the whole approval queue in the canvas cannot be computed —
 * not "are zero", cannot be computed. Every one of them would need
 * account→licence attribution.
 *
 * SEATS USED IS THE ONE THAT CAME OFF THAT LIST (D127), and only on a branch.
 * A branch does not need account→licence attribution to count its own
 * accounts: every user in its database *is* its own. So on a branch this
 * returns a number, counted from active accounts whose role is one a licence
 * sells a seat for — a definition rather than a seat ledger, which
 * `seats_used_basis` states in the payload. On HQ it stays null, because there
 * the attribution really is what is missing.
 *
 * The response therefore carries `derived_metrics_available: false` and a
 * reason — a DIFFERENT reason per tier, since the same sentence cannot be true
 * on both — in the same spirit as the fund-analytics rule: an unmeasured number
 * is unknown, and a surface that says so is worth more than one that shows a
 * plausible zero. Seats LICENSED is in the ledger and IS shown.
 *
 * Migration 190 supplies the one thing that was missing to make any of this
 * addressable: `licence_admins`, which says who administers what. Before it,
 * "which licence is this admin's?" had no answer at all.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { hydrate, type LicenceRow } from './admin_licences';
import { nowIso } from './_t13t14t15_helpers';
// D197 — the host the licence's own admin binds. The validator, the two
// records and the resolver check all live in the service so this router and
// HQ's strip cannot derive them differently.
import {
  domainPayload, loadDomainRow, mintChallengeToken, validateHostname, verifyRecords,
} from '../services/licenceDomain';
// The roles a licence sells a seat for. Imported rather than re-listed, so the
// branch overview and this page cannot disagree about what a seat is (D127).
// D244 — and the push's own writer, which the pull reuses so a pulled copy and
// a pushed one are one row written one way.
import { SEAT_ROLES, applyLicenceCopy } from '../rpc/branchOps';
import { withDeadline, DeadlineExceeded } from '../util/deadline';

const r = new Hono<{ Bindings: Env }>();

/** The `branch_licence` singleton (migration 256), or null. */
type BranchLicenceRow = {
  licence_uid: string;
  licence_ref: string | null;
  legal_entity: string | null;
  brand_name: string | null;
  territory: string;
  status: string;
  seats_json: string | null;
  revenue_share_bps: number | null;
  token_split_bps: number | null;
  annual_fee_cents: number | null;
  currency: string | null;
  term_start: string | null;
  term_end: string | null;
  renewal_at: string | null;
  template_version: string | null;
  suspended_at: string | null;
  suspended_note: string | null;
  // Migration 265 — the five `MyLicencePage` reads and the copy never carried.
  registered_address: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  term_years: number | null;
  terminated_at: string | null;
  // Migration 284 (D206) — which kind of licence this is, as HQ pushed it.
  kind: string | null;
  pushed_at: string;
};

/** The copy, or null when there is none — and a failed read kept apart from both. */
async function readBranchLicence(
  env: Env,
): Promise<{ readable: true; row: BranchLicenceRow | null } | { readable: false }> {
  try {
    const row = await env.DB.prepare(
      `SELECT licence_uid, licence_ref, legal_entity, brand_name, territory, status, seats_json,
              revenue_share_bps, token_split_bps, annual_fee_cents, currency, term_start, term_end,
              renewal_at, template_version, suspended_at, suspended_note,
              registered_address, signatory_name, signatory_title, term_years, terminated_at,
              kind, pushed_at
         FROM branch_licence WHERE id = 1`,
    ).first<BranchLicenceRow>();
    return { readable: true, row: row ?? null };
  } catch (e) {
    console.warn('[licence] branch_licence unreadable', (e as Error).message);
    return { readable: false };
  }
}

/**
 * D244 — what one attempt to fetch this branch's licence from HQ did.
 *
 * `called` says whether THIS request reached HQ at all, which is not the same
 * as whether a pull has ever been tried: a request inside the throttle window
 * reports the earlier attempt it is waiting on, with `called: false`. `ok` is
 * true only when a copy was written. Every refusal carries its own sentence,
 * because "HQ has not pushed this branch its licence yet" is true in all of
 * them and tells an administrator nothing about what to do next.
 */
export type LicencePull = {
  called: boolean;
  ok: boolean;
  at: string | null;
  reason?: string;
  retry_after?: string;
};

/**
 * One pull per branch per five minutes.
 *
 * WHY FIVE MINUTES. The throttle exists so a branch whose HQ binding is broken
 * does not call HQ on every page load, and it has to be long enough for that
 * and short enough that a fix at HQ (a secret set, a licence row restored) is
 * picked up while someone is still looking. It is also bounded from below by
 * KV itself: the shortest expiry KV accepts is 60 seconds and a write can take
 * about as long to be seen from another location, so anything much under a
 * few minutes would be a window the store cannot honour. `lastActive.ts` stamps
 * on the same five-minute cadence over the same binding, which is the other
 * reason to pick it: one number for "how often this deployment may do a thing
 * on its own" rather than two.
 */
export const LICENCE_PULL_WINDOW_SECONDS = 300;
const LICENCE_PULL_DEADLINE_MS = 3_000;
const LICENCE_PULL_KV_DEADLINE_MS = 2_000;
const licencePullKey = (code: string) => `licence_pull:${code}`;

/** The one shape a missing copy is reported in, with the pull beside it. */
function notPushed(code: string, pull: LicencePull) {
  return {
    error: 'licence_not_pushed',
    message: 'HQ has not pushed this branch its licence yet.',
    branch: code,
    pull,
  } as const;
}

/**
 * D244 — ask HQ for this branch's licence, once, and store what it answers.
 *
 * THE ORDER IS THE POLICY. Each check that can refuse without calling HQ runs
 * before the one that costs something:
 *   1. only a branch pulls — HQ holds the ledger itself;
 *   2. no `RPC_SECRET` refuses before anything else, because HQ refuses a
 *      licence request that does not carry it (D244 made `licence()`
 *      money-adjacent) and calling anyway would spend a round trip to be told
 *      what this branch already knows;
 *   3. no HQ binding, likewise;
 *   4. NO THROTTLE STORE REFUSES — it does not fall back to calling. A branch
 *      that cannot record its own attempts cannot bound them, and bounding
 *      them is the one thing a broken HQ binding needs from this code. The
 *      page says so, and HQ's next push still reaches the branch the old way;
 *   5. an attempt inside the window reports that attempt and waits;
 *   6. only then is HQ called, under a deadline, and the attempt recorded
 *      whatever it produced.
 *
 * A FAILED PULL NEVER THROWS. It is a sentence on a page that is otherwise
 * working; an exception here would turn "your licence has not arrived" into a
 * 500 on the page that exists to say so. The one throw left is `branchOf`'s on
 * a malformed BRANCH_CODE, which is deliberate everywhere (util/branch.ts) and
 * cannot reach this function from the route — the route has already resolved
 * the code before it asks.
 */
export async function pullLicenceCopy(env: Env): Promise<LicencePull> {
  const code = branchOf(env);
  if (!code) {
    return {
      called: false, ok: false, at: null,
      reason: 'HQ holds the licence ledger itself, so there is nothing for it to pull.',
    };
  }
  const secret = String(env.RPC_SECRET ?? '').trim();
  if (!secret) {
    return {
      called: false, ok: false, at: null,
      reason:
        'No pull was attempted: this branch has no RPC_SECRET, and HQ hands a branch its licence '
        + 'terms only when the request carries it. branch-provision.yml sets it — re-run it for '
        + 'this code, or set the secret the provisioning run generated.',
    };
  }
  // A LOCAL ALIAS, NOT `env.HQ.licence(…)` INLINE. The call harvest in
  // scripts/lib/rpcSurface.mjs recognises this form, which is how the RPC
  // surface table (services/topology.ts) and its guard know `licence` has a
  // caller at all.
  const hq = (env as { HQ?: { licence?: (callerCode: string, rpcSecret: string) => Promise<unknown> } }).HQ;
  if (!hq || typeof hq.licence !== 'function') {
    return {
      called: false, ok: false, at: null,
      reason:
        'No pull was attempted: this deployment has no HQ service binding, so it cannot ask HQ for '
        + 'its licence. It keeps waiting for HQ to push one.',
    };
  }
  const kv = env.RATE_LIMITS;
  if (!kv) {
    return {
      called: false, ok: false, at: null,
      reason:
        'No pull was attempted: the store that limits how often this branch may ask HQ '
        + '(RATE_LIMITS) is not bound here, and an unlimited pull is what a broken HQ link would '
        + 'turn into a call on every page load.',
    };
  }

  const key = licencePullKey(code);
  let prior: string | null;
  try {
    prior = await withDeadline(kv.get(key), LICENCE_PULL_KV_DEADLINE_MS, 'licence-pull-get');
  } catch (e) {
    console.warn('[licence] pull throttle unreadable', (e as Error).message);
    return {
      called: false, ok: false, at: null,
      reason:
        'No pull was attempted: the record of this branch\'s last attempt could not be read, and '
        + 'without it the attempts cannot be limited. The next page load will try again.',
    };
  }
  if (prior) {
    let last: { at?: unknown; until?: unknown; ok?: unknown; reason?: unknown } = {};
    try { last = JSON.parse(prior); } catch { /* an unreadable record still means "wait" */ }
    const at = typeof last.at === 'string' ? last.at : null;
    const until = typeof last.until === 'string' ? last.until : undefined;
    const outcome = last.ok === true
      ? 'HQ answered it'
      : `it did not bring the licence back${typeof last.reason === 'string' ? ` — ${last.reason}` : ''}`;
    return {
      called: false, ok: false, at,
      reason: `A pull was already tried${at ? ` at ${at}` : ' in the last few minutes'} and ${outcome}. `
        + `This branch asks HQ at most once every ${LICENCE_PULL_WINDOW_SECONDS / 60} minutes.`,
      ...(until ? { retry_after: until } : {}),
    };
  }

  const at = nowIso();
  const until = new Date(Date.parse(at) + LICENCE_PULL_WINDOW_SECONDS * 1000).toISOString();
  let ok = false;
  let reason: string | undefined;
  try {
    const answer = await withDeadline(hq.licence(code, secret), LICENCE_PULL_DEADLINE_MS, 'licence-pull');
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      reason = 'HQ answered with something that is not a licence.';
    } else if ('error' in answer) {
      // `no_licence_for_branch` — HQ knows this deployment and holds no licence
      // row for it. Said as that, and never applied: an error object written
      // through `applyLicenceCopy` would become a copy with an empty uid and
      // every term null, which the page would render as a licence.
      reason = (answer as { error?: unknown }).error === 'no_licence_for_branch'
        ? 'HQ has this branch\'s deployment on record but no licence row for it, so there was nothing to send.'
        : `HQ declined: ${String((answer as { error?: unknown }).error)}.`;
    } else if (typeof (answer as { licence_uid?: unknown }).licence_uid !== 'string'
      || !(answer as { licence_uid: string }).licence_uid) {
      reason = 'HQ answered without a licence id, so the answer was not stored.';
    } else {
      try {
        await applyLicenceCopy(env, answer as Record<string, unknown>);
        ok = true;
      } catch (e) {
        reason = `HQ answered, but the copy could not be stored: ${(e as Error).message}`;
      }
    }
  } catch (e) {
    reason = e instanceof DeadlineExceeded
      ? `HQ did not answer within ${LICENCE_PULL_DEADLINE_MS / 1000} seconds.`
      : `HQ did not return the licence: ${(e as Error).message}`;
  }
  if (!ok) console.warn('[licence] pull failed', code, reason);

  // RECORDED WHATEVER IT PRODUCED, a success included: the throttle limits
  // calls to HQ, not failures, and a success that somehow did not read back
  // must not turn into a pull on every load either. A failed write is logged
  // and nothing more — the attempt has already happened, and refusing to show
  // its outcome because it could not be recorded would hide the one thing
  // this request learnt.
  try {
    await withDeadline(
      kv.put(key, JSON.stringify({ at, until, ok, ...(reason ? { reason } : {}) }), {
        expirationTtl: LICENCE_PULL_WINDOW_SECONDS,
      }),
      LICENCE_PULL_KV_DEADLINE_MS, 'licence-pull-put',
    );
  } catch (e) {
    console.warn('[licence] pull throttle not recorded', (e as Error).message);
  }

  return ok
    ? { called: true, ok: true, at }
    : { called: true, ok: false, at, ...(reason ? { reason } : {}), retry_after: until };
}

/**
 * The same payload, read from the copy HQ pushed (D106, migration 256).
 *
 * WHY A BRANCH CANNOT USE THE QUERY BELOW. `licence_admins` and
 * `territory_licences` exist in a branch database — it is bootstrapped from
 * the same baseline — and they are EMPTY, because the ledger is HQ's. So the
 * normal path would answer 404 "You do not administer a territory licence" to
 * the one person on the deployment who does. That is not a missing row, it is
 * a row in another database, and the two must not read alike.
 *
 * `source` and `as_of` ride the response because everything a branch shows
 * from HQ shows its age (S6, D.10). A screen that renders this without the
 * stamp is showing a copy as though it were live.
 */
// D210 — exported because the branch's Analytics page reads the same seats and
// the same revenue-share rate this page shows. One payload, two readers: a
// second query for "seats licensed" is how the two screens would come to
// disagree about it.
export async function branchLicencePayload(env: Env, code: string) {
  let read = await readBranchLicence(env);
  if (!read.readable) {
    // A branch whose migrations 256/265/284 have not all been applied. Say so
    // rather than reading as "no licence": provisioning has not finished, and
    // the two states need different answers from support. NO PULL HERE — the
    // copy is written into the very table that could not be read, so a pull
    // would call HQ for a record with nowhere to go and then report a storage
    // failure that is really this one.
    return notPushed(code, {
      called: false,
      ok: false,
      at: null,
      reason:
        'No pull was attempted: the table this branch keeps its licence copy in could not be read '
        + '(migrations 256, 265 and 284), so a licence fetched from HQ would have nowhere to go. '
        + 'Finish applying this branch\'s migrations.',
    });
  }

  // D244 — A MISSING COPY IS FETCHED ONCE, NOT WAITED FOR. Until this, a
  // freshly provisioned branch held no copy until HQ's next licence transition
  // happened to push one, and nothing guarantees there will be one: a licence
  // that is simply active has no next transition. So the first read of a
  // missing copy asks HQ for it (`pullLicenceCopy`), applies the answer through
  // the push's own writer, and reads again. The pull is bounded, throttled and
  // authenticated, and every way it can fail is reported as its own sentence
  // beside the unchanged `licence_not_pushed` answer rather than instead of it.
  let pull: LicencePull | null = null;
  if (!read.row) {
    pull = await pullLicenceCopy(env);
    if (pull.ok) {
      read = await readBranchLicence(env);
      if (!read.readable || !read.row) {
        // HQ answered and the write went through, yet nothing reads back. Not
        // reported as a success: the page would then render a licence that is
        // not there. Says what was seen instead.
        pull = {
          ...pull,
          ok: false,
          reason: 'HQ answered and the copy was written, but it could not be read back afterwards.',
        };
      }
    }
    if (!read.readable || !read.row) return notPushed(code, pull);
  }
  const row = read.row;

  const territories = row.territory.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  let seats: Record<string, number> = {};
  try {
    const parsed = row.seats_json ? JSON.parse(row.seats_json) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) seats[k] = n;
      }
    }
  } catch { seats = {}; }

  // SEATS USED, COUNTED THE ONE WAY THIS TIER CAN (D127). Its own try/catch,
  // because a failed count must not blank the licence summary beside it — the
  // whole page exists to show terms, and an unreadable `users` table is a
  // different and smaller problem. `null` on failure keeps the distinction the
  // canvas draws between "unknown" and "zero".
  //
  // NO `IN (…)` AND NO INTERPOLATION. A first draft built the placeholder list
  // with `${SEAT_ROLES.map(() => '?').join(', ')}`, which `check-sql-prepare`
  // refused — correctly, even though that particular expression can only emit
  // `?, ?, ?, ?`: the rule is that nothing reaches the query TEXT, and a rule
  // with a "provably safe" exemption is one somebody widens later. Counting by
  // role and summing in JS removes the question, and it has a better property
  // besides — this is byte-for-byte the query `branchOverview` runs, so the
  // two readers of this figure cannot drift into asking different things.
  //
  // THE BREAKDOWN IS THE SAME ROWS UN-SUMMED (D129). S2 draws one tile per
  // licence type, so the page needs used-per-type beside licensed-per-type;
  // deriving that from a total would mean a second query asking a subtly
  // different question, which is the drift the paragraph above exists to
  // prevent. `seats_used` stays the sum of exactly these entries, so the tiles
  // and the total cannot disagree — asserted rather than assumed.
  let seatsUsedHere: number | null = null;
  let seatsUsedByType: Record<string, number> | null = null;
  try {
    const seated = await env.DB.prepare(
      'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role',
    ).all<{ role: string; n: number }>();
    // EVERY SEAT ROLE GETS A KEY, INCLUDING THE ZEROES. A role with no active
    // account returns no row at all, and a map missing that key would make the
    // page choose between rendering nothing and inventing a zero. Here the zero
    // is measured: the query ran, the role has none. That is a different claim
    // from `seats_used_by_type: null`, which is what an unreadable table gives.
    const byType: Record<string, number> = {};
    for (const role of SEAT_ROLES) byType[role] = 0;
    let sum = 0;
    for (const row of seated.results || []) {
      const role = String(row.role);
      if (!(SEAT_ROLES as readonly string[]).includes(role)) continue;
      const n = Number(row.n) || 0;
      byType[role] = n;
      sum += n;
    }
    seatsUsedHere = sum;
    seatsUsedByType = byType;
  } catch (e) {
    console.warn('[licence] seats used unreadable', (e as Error).message);
  }

  return {
    licence: {
      uid: row.licence_uid,
      // THE KEYS ARE HQ'S, NOT THE TABLE'S. `branch_licence` stores
      // `legal_entity`; the HQ payload this is a copy of calls the same fact
      // `legal_entity_name`, and `MyLicencePage` reads the HQ name. A copy
      // that renamed its own fields would render blank on exactly the tier it
      // was built for — which is what it did until this line, and is why the
      // page's fields are read off this object in its test rather than
      // assumed to line up.
      licence_ref: row.licence_ref,
      legal_entity_name: row.legal_entity,
      brand_name: row.brand_name,
      status: row.status,
      territories,
      seats,
      seats_licensed: Object.values(seats).reduce((a, b) => a + b, 0),
      // D127 — THIS IS NOW A NUMBER, and the comment it replaces was wrong on
      // its own terms: it said "PR 5 builds `seat_assignments`", PR 5 shipped,
      // and it built none. A branch can count its own seats because every user
      // in this database *is* this branch's; what it counts is roles, which is
      // a definition rather than a seat ledger — `seats_used_basis` below says
      // so on the screen rather than leaving the number to be read as more
      // than it is.
      seats_used: seatsUsedHere,
      // D129 — what S2's four tiles read. `null` only when the count failed;
      // a role with no account is a measured 0, not a missing key.
      seats_used_by_type: seatsUsedByType,
      seats_used_basis:
        'Active accounts whose role is one a licence sells a seat for. Role is not a licensed seat: '
        + 'no seat has an id, and none is assigned or released.',
      revenue_share_bps: row.revenue_share_bps,
      token_split_bps: row.token_split_bps,
      annual_fee_cents: row.annual_fee_cents,
      currency: row.currency,
      // D137 — THE REST OF THE RENAME THE COMMENT ABOVE STARTED. That comment
      // was applied to `legal_entity` alone and stopped, so seven more fields
      // went on being emitted under the TABLE's names while `MyLicencePage`
      // read HQ's. Every one of them rendered blank on exactly the tier the
      // copy exists for — including `status_note`, which is the sentence
      // saying WHY a licence was suspended, on the page a suspended
      // administrator goes to find out.
      //
      // The mapping is `LicenceRow` (routes/admin_licences.ts), which is what
      // `hydrate` spreads verbatim into HQ's payload, so the two tiers now
      // answer with one vocabulary. A test asserts that set-equality rather
      // than this comment.
      starts_on: row.term_start,
      renews_on: row.renewal_at,
      status_note: row.suspended_note,
      term_years: row.term_years,
      registered_address: row.registered_address,
      signatory_name: row.signatory_name,
      signatory_title: row.signatory_title,
      suspended_at: row.suspended_at,
      terminated_at: row.terminated_at,
      template_version: row.template_version,
      // D206 — `LicenceRow`'s own key, like every field above, so the tier
      // parity D137 asserts holds for this one too. Null when HQ's push
      // predates migration 284: unknown, never a guessed 'subsidiary'.
      kind: row.kind ?? null,
      admin_role: 'principal',
      // D197 — THE HOST REGISTER IS HQ'S AND A BRANCH HAS NO READ OF IT, so
      // this is "unknown", never "no host bound". HQ's `hydrate` sends the same
      // three keys with the real answer; a branch sending nothing at all would
      // leave the wizard rendering its bind form on a tier where every write
      // answers 501, which is the `still_an_admin` mistake D134 named.
      domain: null,
      domain_available: false,
      domain_reason: DOMAIN_HQ_ONLY_MESSAGE,
    },
    // NOT an empty history. `licence_events` is HQ's append-only trail and is
    // not pushed, so an empty array here would say "nothing has happened to
    // your licence", which is a different and false claim.
    events: [],
    events_available: false,
    events_reason:
      'The licence event trail is held at HQ and is not copied to a branch. Ask HQ for the '
      + 'history of a licence change.',
    source: 'hq_copy' as const,
    as_of: row.pushed_at,
    branch: code,
    // D244 — present only when THIS request fetched the copy, so the page can
    // say it has just arrived. `as_of` stays HQ's stamp either way.
    ...(pull ? { pull } : {}),
  };
}

/**
 * Said once, in one place, so the callers cannot word it differently. Exported
 * for the HQ overview (routes/admin_hq.ts), which reports the same absence
 * platform-wide and must not develop a second phrasing of it.
 *
 * SEATS USED CAME OFF THIS LIST (D127) RATHER THAN THE LIST BEING DELETED.
 * A branch counts its own seats now, so a payload carrying both a number and a
 * sentence saying that number is "not shown" would contradict itself — which
 * is what it did for the length of one commit, caught by
 * `branch_licence_copy.test.ts`. What is still genuinely unavailable on BOTH
 * tiers is narrower, and saying the narrower true thing is the point: the
 * D111 pattern, where `budget_reason` survived in a smaller and still-true
 * form rather than being dropped.
 */
export const DERIVED_UNAVAILABLE = {
  derived_metrics_available: false,
  derived_metrics_reason:
    'Accounts in territory and revenue per subsidiary need every account to name the licence it '
    + 'belongs to. No account carries one yet — migration 187 built the licence ledger, not the '
    + 'tenancy scope — so these are not shown rather than shown as zero.',
} as const;

/**
 * The same absence on a BRANCH, where seats used is a figure and the rest is
 * not (D127).
 *
 * A branch does not need the tenancy scope to count its own accounts — every
 * user in its database is its own — so the sentence above is wrong there in
 * the one direction that matters: it would tell a branch admin their seat
 * figure is unavailable while the page beside it shows one.
 */
export const DERIVED_UNAVAILABLE_BRANCH = {
  derived_metrics_available: false,
  derived_metrics_reason:
    'Seats used is shown, counted from active accounts by role. Revenue per subsidiary is not: this '
    + 'branch reports its quarter to HQ every morning (D266), every stream in that report is '
    + 'unmeasured because this database records no revenue amounts, so nothing is shown rather '
    + 'than a zero.',
} as const;

/**
 * The licence this user administers, or null.
 *
 * `licence_admins` has a UNIQUE index on user_id, so "the" licence is
 * well-defined by the schema rather than by this query picking one.
 */
async function licenceForUser(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT l.*, la.admin_role
       FROM licence_admins la
       JOIN territory_licences l ON l.id = la.licence_id
      WHERE la.user_id = ?`,
  ).bind(userId).first<LicenceRow & { admin_role: string }>();
}

// GET /api/licence/mine — the subsidiary dashboard's only source.
//
// 404 rather than 403 when the caller administers nothing: they are not
// forbidden from a licence, there is no licence of theirs to return, and the
// UI needs to tell those two apart.
r.get('/mine', async (c) => {
  const user = await requireAuth(c);

  // D106 — on a branch the ledger is in another database; read the copy.
  // Placed after requireAuth so an anonymous caller still gets 401 rather
  // than the branch's licence terms.
  const code = branchOf(c.env);
  if (code) {
    // D244 — AND ONLY AN ADMIN GETS THEM. On HQ this route answers 404 to
    // anyone not bound in `licence_admins`, so a founder never reads a
    // licence's fees. On a branch there is no binding to consult — the copy is
    // the whole deployment's — and until now any signed-in member of the
    // branch received the fees, the revenue share and the signatory. That was
    // latent while no branch was provisioned; D244 also makes this read the
    // trigger for a call to HQ, which settles it. Every screen that calls it is
    // already an admin route. The role is read off the user `requireAuth` just
    // loaded rather than through `requireAdmin`, which would load it again —
    // and whose freeze check is a no-op on a branch and for a GET in any case.
    if (user.role !== 'admin') throw new Error('Admin required');
    const payload = await branchLicencePayload(c.env, code);
    if ('error' in payload) return c.json(payload, 404);
    return c.json({ ...payload, ...DERIVED_UNAVAILABLE_BRANCH });
  }

  const row = await licenceForUser(c.env, user.id);
  if (!row) {
    return c.json({
      error: 'no_licence',
      message: 'You do not administer a territory licence.',
    }, 404);
  }
  const [licence] = await hydrate(c.env, [row]);

  // Append-only history. The whole point of licence_events is that a contract
  // dispute is exactly the case where an overwritten status is useless, so the
  // holder gets the same trail HQ does.
  const events = await c.env.DB.prepare(
    `SELECT event, note, detail_json, created_at
       FROM licence_events WHERE licence_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 50`,
  ).bind(row.id).all<{ event: string; note: string | null; detail_json: string | null; created_at: string }>();

  // D287 — the deployment record, read by licence_uid IN ITS OWN TRY, so a
  // table this read cannot reach costs the strip its answer and nothing else
  // on the page. The field never carries a time: `requested_at` is the
  // request and `updated_at` is bumped by the RPC-hash write and by the
  // failure paths, so neither is a step's time, and nothing records one.
  const deployment = await deploymentField(c.env, row.uid);

  return c.json({
    licence: { ...licence, admin_role: row.admin_role },
    events: events.results || [],
    deployment,
    ...DERIVED_UNAVAILABLE,
  });
});

/* ------------------------------------------------------------------ *
 * The deployment on the licence — S21's strip reads this (D287)        *
 * ------------------------------------------------------------------ */

/**
 * The one status that counts as live: `linked`, migration 258's last step,
 * the point at which HQ knows the branch and the branch knows HQ. A Worker
 * that answers (`worker_live`) on a hostname that resolves (`hostname_active`)
 * but is not yet linked is a deployment in progress, and the administrator is
 * still working on axal.vc until it is. `failed` is never live.
 */
export const DEPLOYMENT_LIVE_STATUS = 'linked';
export const deploymentIsLive = (status: string | null | undefined): boolean =>
  String(status ?? '') === DEPLOYMENT_LIVE_STATUS;

export type DeploymentField =
  | { readable: true; requested: false; live: false }
  | { readable: true; requested: true; live: boolean; code: string; hostname: string; status: string; status_note: string | null }
  | { readable: false; reason: string };

/**
 * "not requested" MEANS THERE IS NO ROW — never a stored value. Migration
 * 258's nine statuses start at `requested`, and the INSERT writes that
 * word; a row is a request by construction. A failed read is its own
 * answer, distinct from "no row", because the strip renders the two
 * differently and an unreadable ledger rendered as "not requested" would
 * tell an administrator whose branch is half-built that nobody asked.
 */
export async function deploymentField(env: Env, licenceUid: string): Promise<DeploymentField> {
  try {
    const d = await env.DB.prepare(
      'SELECT code, hostname, status, status_note FROM licence_deployments WHERE licence_uid = ?',
    ).bind(licenceUid).first<{ code: string; hostname: string; status: string; status_note: string | null }>();
    if (!d) return { readable: true, requested: false, live: false };
    return {
      readable: true,
      requested: true,
      live: deploymentIsLive(d.status),
      code: d.code,
      hostname: d.hostname,
      status: d.status,
      status_note: d.status_note ?? null,
    };
  } catch (e) {
    console.warn('[licence] deployment unreadable', (e as Error).message);
    return { readable: false, reason: 'The deployment record on this licence could not be read.' };
  }
}

/* ------------------------------------------------------------------ *
 * The compliance ladder — the addressee's half (D135)                  *
 * ------------------------------------------------------------------ */

// THESE TWO ROUTES LIVE HERE PRECISELY BECAUSE THIS FILE IS NOT AN ADMIN
// ROUTER, and that is what lets the ladder work without an exception list.
//
// The freeze lives inside `requireAdmin` (auth.ts), so every admin write on HQ
// refuses with 423 while a notice is outstanding. Put the reply behind
// `requireAdmin` and the freeze locks the addressee out of the one action that
// lifts it; the usual patch — a list of paths the gate skips — is the thing
// that rots, because the next route added to it is the one nobody remembers.
// `requireAuth` plus "you are this notice's addressee" is also the honest
// description of what is happening: an admin answering their own warning is not
// exercising admin power, they are the person the letter was addressed to.
//
// IT IS ALSO WHY THIS FILE STOPS BEING READ-ONLY. Its header says "one licence,
// read-only, for the person who administers it" — true until the ladder needed
// somewhere for that person to answer from, and the answer belongs beside the
// licence they are answering about rather than in a third router with a third
// gate. Reading stays the bulk of it; there is exactly one write.
//
// WHAT A RESPONSE IS NOT: it is not compliance. Writing "paid it" does not
// settle anything — the notice moves to `responded` and waits for HQ, because a
// click by the person who owes a fee is not evidence the fee was paid. The lift
// is HQ's, at POST /api/admin/licences/:uid/notices/:noticeUid/review.

const noticeText = (v: unknown, max = 5000): string => String(v ?? '').trim().slice(0, max);

r.get('/notices', async (c) => {
  const user = await requireAuth(c);
  let items: Array<Record<string, unknown>> = [];
  let readable = true;
  try {
    const res = await c.env.DB.prepare(
      `SELECT n.uid, n.kind, n.subject, n.body, n.respond_by, n.status,
              n.response, n.responded_at, n.review_note, n.reviewed_at,
              n.froze_at, n.created_at,
              l.licence_ref, l.brand_name, l.status AS licence_status
         FROM admin_notices n
         LEFT JOIN territory_licences l ON l.id = n.licence_id
        WHERE n.user_id = ?
        ORDER BY n.id DESC`,
    ).bind(user.id).all<Record<string, unknown>>();
    items = res.results || [];
  } catch { readable = false; }
  return c.json({
    items: readable ? items : [],
    // An unreadable store is not an empty inbox. Telling somebody whose account
    // is frozen that they have no notices would be the worst possible version
    // of a missing table — the #204 distinction, on the surface it matters most.
    notices_available: readable,
    ...(readable ? {} : {
      notices_reason: 'The admin_notices table could not be read on this database (migration 264).',
    }),
  });
});

r.post('/notices/:uid/respond', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const response = noticeText((body as Record<string, unknown>)?.response);
  if (response.length < 10) {
    return c.json({
      error: 'A response of at least 10 characters is required — it is what HQ reads when deciding whether this is settled.',
      code: 'response_too_short',
    }, 400);
  }
  // OWNERSHIP IS IN THE WHERE, not a check after the read: a notice addressed
  // to somebody else answers 404 rather than 403, because 403 confirms that it
  // exists. Same reasoning `mapError`'s header gives for the ownership helpers.
  const notice = await c.env.DB.prepare(
    'SELECT id, uid, status, subject FROM admin_notices WHERE uid = ? AND user_id = ?',
  ).bind(c.req.param('uid'), user.id).first<{ id: number; uid: string; status: string; subject: string }>();
  if (!notice) return c.json({ error: 'not_found' }, 404);
  // ANSWERABLE FROM BOTH `issued` AND `overdue`. Answering late is the whole
  // point of the middle rung — "frozen until they act on things from what they
  // have been notified" describes somebody acting AFTER the deadline, and a
  // ladder that refused a late answer would have no way back up it.
  if (notice.status !== 'issued' && notice.status !== 'overdue') {
    return c.json({
      error: `this notice is ${notice.status} and is not waiting on you`,
      code: 'not_answerable',
    }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE admin_notices
        SET status = 'responded', response = ?, responded_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
  ).bind(response, notice.id, user.id).run();

  // THE FREEZE LIFTS ON RESPONDING, NOT ON HQ ACCEPTING, and that is a choice
  // rather than an oversight. `responded` is not in FREEZING_STATUSES, so an
  // admin who answers can write again while HQ reads it. Holding the freeze
  // through a review of unknown length would punish the person for doing
  // exactly what they were asked; if HQ rejects, `rejected` freezes them again,
  // and that refusal is a decision somebody made rather than a queue they sat
  // in. "Frozen until they act" is the owner's sentence, and acting is this.
  try {
    const { notify } = await import('../services/notify');
    const hq = await c.env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>();
    for (const h of (hq.results || [])) {
      await notify(c.env, {
        userId: Number(h.user_id),
        type: 'compliance_response',
        title: 'A compliance notice has been answered',
        body: `${user.name || user.email} responded to "${notice.subject}". It is waiting on your review.`,
        link: '/admin/licences',
        category: 'compliance',
        payload: { notice_uid: notice.uid },
      });
    }
  } catch (e) { console.warn('[compliance] HQ notification failed', (e as Error).message); }

  return c.json({ ok: true, status: 'responded' });
});

/* ------------------------------------------------------------------ *
 * The custom host the licence's own admin binds (D197, S17–S19)        *
 * ------------------------------------------------------------------ */

// THESE WRITES ARE NOT ADMIN WRITES, and that is why they are here rather
// than in HQ's ledger. Binding a hostname is the licence holder configuring
// their own tenancy — the same act as answering a compliance notice two
// blocks up, and gated the same way: `requireAuth` plus "you administer this
// licence". Putting them behind `requireAdmin` would mean the compliance
// freeze (D135) locks a holder out of their own settings, which is the
// exception-list problem that file's header already refuses to reintroduce.
//
// H31 IS THE OTHER HALF OF THE SAME RULE. HQ's strip is read-only: "There is
// no Approve, no Add domain, and no DNS editor for HQ to complete on a
// tenant's behalf." The only HQ write is Detach, and it lives in
// `admin_licences.ts` behind the super-admin write bar, because taking a host
// away from an operator is an admin act and has to be audited as one.

const DOMAIN_HQ_ONLY_MESSAGE =
  'The host register is held at HQ, because "one host, one licence" is a rule no single branch '
  + 'can check — a branch is its own deployment over its own database and cannot see what '
  + 'another tenant bound. Binding a host from a branch needs the branch-to-HQ leg, which is '
  + 'not built. Ask HQ.';

/** The licence this caller administers, refusing a branch before it looks. */
async function ownLicenceForDomain(c: Context<{ Bindings: Env }>) {
  const user = await requireAuth(c);
  const code = branchOf(c.env);
  // THE KEYS ARE WRITTEN OUT AND NOT SPREAD FROM A CONST, because
  // `check-api-drift` reads the literal to prove the SPA can render a reason
  // rather than "Request failed" — and a spread hides it from exactly the
  // check that exists to see it.
  if (code) {
    return {
      refusal: c.json({
        error: 'domain_hq_only',
        message: DOMAIN_HQ_ONLY_MESSAGE,
        branch: code,
      }, 501),
    } as const;
  }
  const row = await licenceForUser(c.env, user.id);
  if (!row) {
    return {
      refusal: c.json({
        error: 'no_licence',
        message: 'You do not administer a territory licence.',
      }, 404),
    } as const;
  }
  return { user, licence: row } as const;
}

/** The sentence a licence with no host, or an unreadable register, reads. */
const NO_DOMAIN_BOUND = {
  error: 'no_domain',
  message: 'This licence has no custom host bound.',
} as const;

// POST /mine/domain — bind one, and mint the token it will publish.
r.post('/mine/domain', async (c) => {
  const own = await ownLicenceForDomain(c);
  if ('refusal' in own) return own.refusal;
  const { user, licence } = own;

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const checked = validateHostname((body as Record<string, unknown>)?.hostname);
  if (!checked.ok) return c.json({ error: checked.error, code: checked.code }, 400);
  const hostname = checked.hostname;

  // ONE HOST PER LICENCE IN THIS PASS, checked before the collision so the
  // operator who is simply re-typing their own host reads that rather than a
  // sentence about somebody else. `licence_id UNIQUE` is what enforces it; this
  // is the readable refusal.
  let existing: Awaited<ReturnType<typeof loadDomainRow>> = null;
  try {
    existing = await loadDomainRow(c.env, licence.id);
  } catch (e) {
    console.warn('[licence] licence_domains unreadable', (e as Error).message);
    return c.json({
      error: 'domain_store_unreadable',
      message: 'The host register could not be read on this database (migration 280).',
    }, 503);
  }
  if (existing) {
    return c.json({
      error: existing.hostname === hostname
        ? `${hostname} is already bound to this licence.`
        : `This licence already has ${existing.hostname} bound. Remove it before binding another — `
          + 'one host per licence in this pass.',
      code: 'domain_already_bound',
      hostname: existing.hostname,
    }, 409);
  }

  // H33 — THE COLLISION NAMES THE OTHER OPERATOR'S PUBLIC NAME AND NEVER ITS
  // LEGAL ENTITY. Who trades under a brand is public; which company holds the
  // licence behind it is the other tenant's commercial business, and a refusal
  // is not the place to disclose it.
  const clash = await c.env.DB.prepare(
    `SELECT d.licence_id AS licence_id, d.state AS state, l.brand_name AS brand_name
       FROM licence_domains d
       JOIN territory_licences l ON l.id = d.licence_id
      WHERE d.hostname = ?`,
  ).bind(hostname).first<{ licence_id: number; state: string; brand_name: string | null }>();
  if (clash) {
    // A DETACHED ROW STILL HOLDS THE HOST, on purpose: Super Admin took it
    // away, and letting the next licence claim it immediately would re-create
    // whatever the detach resolved. Nobody is named, because nobody holds it.
    if (clash.state === 'detached') {
      return c.json({
        error: `${hostname} was detached by Super Admin and is not available. Ask Super Admin to release it.`,
        code: 'host_detached_elsewhere',
      }, 409);
    }
    return c.json({
      error: `${hostname} is already bound to ${clash.brand_name || 'another operator'}. `
        + 'One host, one licence — bind a name you control.',
      code: 'host_taken',
      held_by: clash.brand_name || null,
    }, 409);
  }

  const token = mintChallengeToken();
  try {
    await c.env.DB.prepare(
      `INSERT INTO licence_domains (licence_id, hostname, challenge_token, created_by_user_id)
       VALUES (?,?,?,?)`,
    ).bind(licence.id, hostname, token, user.id).run();
  } catch (e) {
    // The UNIQUE index is the final word, not the SELECT above — two admins
    // binding the same host in the same second race past a check and cannot
    // race past a constraint. Same argument migration 187 makes for territory.
    console.warn('[licence] domain insert refused', (e as Error).message);
    return c.json({
      error: `${hostname} is already bound to another licence. One host, one licence.`,
      code: 'host_taken',
    }, 409);
  }
  const row = await loadDomainRow(c.env, licence.id);
  return c.json({ ok: true, domain: row ? domainPayload(row) : null }, 201);
});

// POST /mine/domain/check — S19's Check now.
r.post('/mine/domain/check', async (c) => {
  const own = await ownLicenceForDomain(c);
  if ('refusal' in own) return own.refusal;
  const { licence } = own;

  let row: Awaited<ReturnType<typeof loadDomainRow>> = null;
  try {
    row = await loadDomainRow(c.env, licence.id);
  } catch (e) {
    console.warn('[licence] licence_domains unreadable', (e as Error).message);
    return c.json({
      error: 'domain_store_unreadable',
      message: 'The host register could not be read on this database (migration 280).',
    }, 503);
  }
  if (!row) return c.json(NO_DOMAIN_BOUND, 404);
  if (row.state === 'detached') {
    return c.json({
      error: 'This host was detached by Super Admin. There is nothing to check until it is restored.',
      code: 'domain_detached',
    }, 409);
  }

  const now = nowIso();
  const result = await verifyRecords(row.hostname, row.challenge_token, now);
  const txt = result.records.find((x) => x.kind === 'ownership');
  const cname = result.records.find((x) => x.kind === 'traffic');

  // A STAMP IS WRITTEN ONCE AND KEPT. `txt_verified_at` says when the record
  // was seen, not that it is still published — and the two are different
  // claims. Most registrars expect an ownership TXT to be removed once it has
  // done its job, so re-writing the stamp on every pass would make a tenant who
  // tidied up look unverified.
  const txtAt = row.txt_verified_at ?? (txt?.ok ? now : null);
  const cnameAt = row.cname_verified_at ?? (cname?.ok ? now : null);

  // STATE DOES NOT DEMOTE IN THIS PASS, and that is a decision rather than an
  // omission. `verified` here records that both records were confirmed; nothing
  // downstream acts on it — no certificate is issued and no member is routed —
  // so demoting on a later miss would be a state change with no consequence
  // that punishes the tidy-up above. The per-record verdict below is the live
  // view, and the screen shows it beside the stamp, so nothing on the page
  // claims more than was measured. When Cloudflare for SaaS lands it owns the
  // live view of whether a host still reaches us, and that is what should
  // demote.
  const next = row.state === 'pending' && txtAt && cnameAt ? 'verified' : row.state;

  await c.env.DB.prepare(
    `UPDATE licence_domains
        SET state = ?, txt_verified_at = ?, cname_verified_at = ?,
            last_checked_at = ?, last_check_json = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(next, txtAt, cnameAt, now, JSON.stringify(result), row.id).run();

  const fresh = await loadDomainRow(c.env, licence.id);
  return c.json({
    ok: true,
    verified: next === 'verified',
    check: result,
    domain: fresh ? domainPayload(fresh) : null,
  });
});

// DELETE /mine/domain — S18's Remove.
r.delete('/mine/domain', async (c) => {
  const own = await ownLicenceForDomain(c);
  if ('refusal' in own) return own.refusal;
  const { licence } = own;

  let row: Awaited<ReturnType<typeof loadDomainRow>> = null;
  try {
    row = await loadDomainRow(c.env, licence.id);
  } catch (e) {
    console.warn('[licence] licence_domains unreadable', (e as Error).message);
    return c.json({
      error: 'domain_store_unreadable',
      message: 'The host register could not be read on this database (migration 280).',
    }, 503);
  }
  if (!row) return c.json(NO_DOMAIN_BOUND, 404);
  // AN OPERATOR MAY REMOVE A HOST THEY BOUND AND NOT ONE HQ TOOK AWAY. A
  // detached row is what keeps the host out of circulation; deleting it here
  // would let the same licence re-bind it in the next request and undo the
  // detach without anyone deciding to.
  if (row.state === 'detached') {
    return c.json({
      error: 'Super Admin detached this host. Removing the record is Super Admin\'s to do — '
        + 'ask them to release it.',
      code: 'domain_detached',
    }, 409);
  }
  await c.env.DB.prepare('DELETE FROM licence_domains WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true, removed: row.hostname });
});

export default r;
