/**
 * HQ · Platform → Deployments, and the Deploy step of the issue flow (D110).
 *
 *   POST /api/admin/licences/:uid/deploy   request a branch (H3 step 6)
 *   GET  /api/admin/licences/:uid/deployment          the identity and its attempts (D4706)
 *   POST /api/admin/licences/:uid/deploy/retry        a new attempt for a failed one (D4706)
 *   POST /api/admin/licences/:uid/deploy/reconcile    read what GitHub did with the attempt (D4706)
 *   GET  /api/admin/deployments            one row per branch (H6 Platform)
 *
 * WHY THE DEPLOY ROUTE LIVES HERE AND NOT IN `admin_licences.ts`. That file is
 * the ledger: it issues, re-terms, suspends and terminates. Deploying is not a
 * licence change — the licence is unchanged by it — it is infrastructure, and
 * folding it in would put a `workflow_dispatch` beside the money writes and
 * make every reader check which was which.
 *
 * WHAT "REQUESTED" MEANS, AND WHY THE ROW IS WRITTEN BEFORE THE DISPATCH. A
 * successful `workflow_dispatch` returns **204 with no body**, and returns it
 * whether the run then succeeds, fails, or is never scheduled. So the dispatch
 * establishes only that GitHub accepted the request. Writing the row first
 * means a dispatch that fails leaves a row saying `failed` with the reason,
 * rather than leaving no trace of an attempt someone made; and a dispatch that
 * succeeds leaves `requested`, which the provisioning run itself moves.
 *
 * THE CREDENTIAL IS A STATE, NOT AN ERROR. `GITHUB_ACCESS_TOKEN` with
 * `actions: write` is task #192 and is not set in production. A button that
 * 500'd would read as broken; this answers **409 with a stable code and the
 * exact thing to set**, so H3's Deploy step renders its own reason and the
 * workflow can still be run by hand from the Actions tab. Nothing else in the
 * programme waits on that token.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { githubConfigured, dispatchWorkflow, listDispatchedRuns, listRunJobs } from '../services/githubSync';
import { fanOut, coverage, withRegistry, type BranchResult } from '../services/branches';
import { loadBranchActionMirror, parseRange } from '../services/analyticsReports';
import { BRANCH_CODE_RE } from '../util/branch';
import { refusalBody } from '../util/refusal';
import type { BranchHealth } from '../rpc/branchOps';

const r = new Hono<{ Bindings: Env }>();

/** The workflow this dispatches, and the branch it runs from. */
export const PROVISION_WORKFLOW = 'branch-provision.yml';
const PROVISION_REF = 'main';

/** Residency values Cloudflare actually offers (A.4), plus the opt-out. */
const D1_JURISDICTIONS = new Set(['eu', 'none']);
const LOCATION_HINTS = new Set(['weur', 'eeur', 'enam', 'wnam', 'apac', 'oc', 'none']);
const DO_JURISDICTIONS = new Set(['eu', 'us', 'none']);

const nowIso = () => new Date().toISOString();

type DeploymentRow = {
  licence_uid: string; code: string; hostname: string; worker_name: string; d1_name: string;
  d1_jurisdiction: string | null; location_hint: string | null;
  residency_requested: string | null; residency_granted: string | null;
  status: string; status_note: string | null; provision_run_id: string | null;
  requested_at: string; live_at: string | null;
  last_health_at: string | null; last_health_ok: number | null; last_version: string | null;
};

/**
 * Payload from each branch's `health` RPC (D452 — includes deploy_version).
 *
 * D515: derived from `BranchHealth` in `rpc/branchOps.ts` (the branch's own
 * declaration) rather than restated, so a field renamed there fails the
 * typecheck here. `deploy_version` stays optional on this side: a branch
 * deployed before D452 answers without it.
 */
type BranchHealthLive = Pick<BranchHealth, 'ok' | 'licence_status' | 'licence_pushed_at'>
  & Partial<Pick<BranchHealth, 'deploy_version'>>;

// ── D4706: attempts ─────────────────────────────────────────────────────────
//
// A DEPLOYMENT IS ITS IDENTITY; AN ATTEMPT IS ONE TRY AT PROVISIONING IT.
// `licence_deployments` holds the code, the host and the residency, once per
// licence. Every dispatch is a row in `licence_deployment_attempts` with its
// own outcome, failure reason and Actions run, so a failure is retried as a
// new attempt rather than by deleting the identity, and HQ can read the
// current attempt, the last failure and the last success side by side.

/** Minutes after which an attempt with no run of its own is called failed. */
export const NO_RUN_AFTER_MINUTES = 15;

type AttemptRow = {
  uid: string; licence_uid: string; code: string; attempt_no: number; status: string;
  failure_code: string | null; failure_note: string | null;
  run_id: string | null; run_url: string | null; run_status: string | null; run_conclusion: string | null;
  requested_by_user_id: number | null; requested_at: string; settled_at: string | null;
};

type DeploymentIdentity = {
  licence_uid: string; code: string; hostname: string; status: string; status_note: string | null;
  d1_jurisdiction: string | null; location_hint: string | null; do_jurisdiction: string | null;
  current_attempt: number; provision_run_id: string | null; requested_at: string; live_at: string | null;
  updated_at: string;
};

const newAttemptUid = () => `att_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

/** Statuses past `requested` that are not yet `linked`: the branch exists, HQ's binding does not. */
const PARTIAL_STATUSES = new Set([
  'database_created', 'schema_applied', 'secrets_present', 'principal_seeded', 'worker_live', 'hostname_active',
]);

/**
 * Where a deployment stands, in the shared mutation-outcome vocabulary the
 * SPA renders (`lib/mutationOutcome.js`): `pending` while a run is asked for
 * or running, `partial` when the branch is up but HQ is not linked to it yet
 * (HQ's write is done, the branch's is not), `committed` once linked,
 * `refused` when the last attempt failed, and `unknown` when an attempt was
 * written but GitHub's answer to it never arrived.
 */
export function deploymentPhase(status: string, attempt: Pick<AttemptRow, 'status'> | null): string {
  if (attempt?.status === 'dispatching') return 'unknown';
  if (status === 'failed') return 'refused';
  if (status === 'linked') return 'committed';
  if (PARTIAL_STATUSES.has(status)) return 'partial';
  return 'pending';
}

async function loadIdentity(env: Env, licenceUid: string): Promise<DeploymentIdentity | null> {
  return env.DB.prepare(
    `SELECT licence_uid, code, hostname, status, status_note, d1_jurisdiction, location_hint, do_jurisdiction,
            current_attempt, provision_run_id, requested_at, live_at, updated_at
       FROM licence_deployments WHERE licence_uid = ?`,
  ).bind(licenceUid).first<DeploymentIdentity>();
}

/** The identity, every attempt (newest first) and the three an operator asks about. */
async function deploymentView(env: Env, licenceUid: string) {
  const dep = await loadIdentity(env, licenceUid);
  if (!dep) return null;
  const q = await env.DB.prepare(
    `SELECT uid, licence_uid, code, attempt_no, status, failure_code, failure_note, run_id, run_url,
            run_status, run_conclusion, requested_by_user_id, requested_at, settled_at
       FROM licence_deployment_attempts WHERE licence_uid = ? ORDER BY attempt_no DESC LIMIT 50`,
  ).bind(licenceUid).all<AttemptRow>();
  const attempts = q.results || [];
  const current = attempts.find((a) => a.attempt_no === dep.current_attempt) || null;
  const phase = deploymentPhase(dep.status, current);
  return {
    ...dep,
    phase,
    current_attempt_row: current,
    last_failure: attempts.find((a) => a.status === 'failed') || null,
    last_success: attempts.find((a) => a.status === 'succeeded') || null,
    attempts,
    // What the operator may do next, decided here so the page never offers a
    // duplicate: a retry only from a failed attempt; a status check whenever
    // the outcome is still open.
    retryable: dep.status === 'failed' && current?.status !== 'dispatching',
    reconcilable: phase === 'pending' || phase === 'unknown',
  };
}

async function settleAttempt(
  env: Env, licenceUid: string, attemptNo: number,
  fields: { status: string; failure_code?: string | null; failure_note?: string | null },
) {
  await env.DB.prepare(
    `UPDATE licence_deployment_attempts
        SET status = ?, failure_code = ?, failure_note = ?, settled_at = CASE WHEN ? = 'dispatched' THEN NULL ELSE ? END
      WHERE licence_uid = ? AND attempt_no = ?`,
  ).bind(
    fields.status, fields.failure_code ?? null, fields.failure_note ?? null, fields.status, nowIso(),
    licenceUid, attemptNo,
  ).run();
}

async function failDeployment(env: Env, licenceUid: string, attemptNo: number, code: string, note: string) {
  await env.DB.prepare(
    "UPDATE licence_deployments SET status = 'failed', status_note = ?, updated_at = ? WHERE licence_uid = ? AND current_attempt = ?",
  ).bind(note, nowIso(), licenceUid, attemptNo).run();
  await settleAttempt(env, licenceUid, attemptNo, { status: 'failed', failure_code: code, failure_note: note });
}

const GITHUB_NOT_CONFIGURED_MESSAGE =
  'The Deploy button needs GITHUB_ACCESS_TOKEN (with the actions: write scope) set as a Worker '
  + 'secret, and GITHUB_REPO_OWNER and GITHUB_REPO_NAME set in wrangler.toml\'s [vars]. Until then '
  + 'the provisioning workflow can still be '
  + 'run by hand from the repository\'s Actions tab — nothing else about a branch waits on this.';

/**
 * Dispatch one attempt and record how GitHub answered, on the attempt and on
 * the identity. Returns the response to send.
 */
async function dispatchAttempt(
  c: any,
  dep: { licence_uid: string; code: string; hostname: string },
  attemptNo: number,
  inputs: Record<string, string>,
) {
  const env: Env = c.env;
  const res = await dispatchWorkflow(env, PROVISION_WORKFLOW, PROVISION_REF, inputs);
  if (!res.ok && (res.status === 0 || res.status >= 500)) {
    // OUTCOME UNKNOWN. No answer, or GitHub's own error: the run may or may
    // not have been queued. The attempt stays `dispatching` and the identity
    // `requested`, so neither Deploy nor Retry is offered; the page offers a
    // status check, which finds the run or, after NO_RUN_AFTER_MINUTES with
    // none, settles the attempt as failed and makes it retryable.
    return c.json(refusalBody({
      code: 'outcome_unknown',
      message: `GitHub did not say whether it accepted attempt ${attemptNo} for ${dep.code}. Nothing will be sent again until a status check finds the run or shows there is none.`,
      raw: res.error || null,
      audience: 'admin',
      extra: { branch: dep.code, attempt: attemptNo, outcome: 'unknown', deployment: await deploymentView(env, dep.licence_uid) },
    }), 504);
  }
  if (!res.ok) {
    const note = res.status === 403
      // 403 here is specifically the scope: the token authenticated and was
      // refused the action. Reporting it as "not configured" would send
      // someone to set a secret that is already set.
      ? 'GitHub refused the dispatch (403). The token authenticated but lacks the actions: write scope.'
      : `GitHub refused the dispatch (HTTP ${res.status}). The upstream field says why.`;
    await failDeployment(env, dep.licence_uid, attemptNo, 'dispatch_failed', note);
    // D278 — GitHub's text rides on `upstream` (an admin console about one
    // of Axal's own providers); `message` and the stored note are ours.
    return c.json(refusalBody({
      code: 'dispatch_failed',
      message: note,
      raw: res.error || null,
      audience: 'admin',
      extra: { branch: dep.code, status: res.status, attempt: attemptNo, deployment: await deploymentView(env, dep.licence_uid) },
    }), 502);
  }
  await settleAttempt(env, dep.licence_uid, attemptNo, { status: 'dispatched' });
  return c.json({
    ok: true,
    code: dep.code,
    hostname: dep.hostname,
    status: 'requested',
    attempt: attemptNo,
    workflow: PROVISION_WORKFLOW,
    // Said plainly because the 204 does not mean what a reader assumes.
    note:
      'GitHub accepted the request. A dispatch returns no run outcome, so this says the run was asked '
      + 'for, not that the branch exists — the run itself moves the status.',
    deployment: await deploymentView(env, dep.licence_uid),
  });
}

// POST /api/admin/licences/:uid/deploy
r.post('/licences/:uid/deploy', async (c) => {
  const admin = await requireSuperAdmin(c);
  const uid = String(c.req.param('uid') || '').trim();

  const licence = await c.env.DB.prepare(
    'SELECT id, uid, licence_ref, brand_name, legal_entity_name, status FROM territory_licences WHERE uid = ?',
  ).bind(uid).first<{ id: number; uid: string; licence_ref: string; brand_name: string; legal_entity_name: string; status: string }>();
  if (!licence) return c.json({ error: 'not_found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // VALIDATED AS TYPED, NOT NORMALISED FIRST. `FR` is refused rather than
  // lowercased, because `write-branch-registry.mjs` and
  // `check-branch-config.mjs` both refuse it: a code HQ silently rewrote
  // would be accepted here and rejected by the workflow it dispatched to,
  // which is two definitions of a valid branch code. There is one (D105).
  const code = String(body.code ?? '').trim();
  // `hq` passes the charset and is still refused, with its own sentence: it is
  // HQ's own code in the metrics store, so a branch given it would be counted
  // into HQ's line on Analytics (D211). The regex carries the same
  // reservation; this line only says why in words a person can act on.
  if (code === 'hq') {
    return c.json({
      error: 'bad_code',
      message: 'The code "hq" is HQ\'s own deployment in the metrics store, so no branch may take it.',
    }, 400);
  }
  if (!BRANCH_CODE_RE.test(code)) {
    return c.json({
      error: 'bad_code',
      message: 'A branch code is 2 to 16 characters: a lowercase letter, then lowercase letters, digits or hyphens.',
    }, 400);
  }
  const d1 = String(body.d1_jurisdiction ?? 'none').toLowerCase();
  const hint = String(body.location_hint ?? 'none').toLowerCase();
  const dojur = String(body.do_jurisdiction ?? 'none').toLowerCase();
  if (!D1_JURISDICTIONS.has(d1) || !LOCATION_HINTS.has(hint) || !DO_JURISDICTIONS.has(dojur)) {
    return c.json({ error: 'bad_residency', message: 'residency values are not ones Cloudflare offers' }, 400);
  }

  // A licence has AT MOST ONE deployment (D.5, migration 258's UNIQUE). Both
  // directions are checked because the two collisions need different answers:
  // this licence already has one, or this code belongs to another licence.
  const existing = await c.env.DB.prepare(
    'SELECT licence_uid, code, status, current_attempt FROM licence_deployments WHERE licence_uid = ? OR code = ?',
  ).bind(licence.uid, code).first<{ licence_uid: string; code: string; status: string; current_attempt: number }>();
  if (existing) {
    const mine = existing.licence_uid === licence.uid;
    return c.json({
      error: mine ? 'already_deployed' : 'code_taken',
      message: mine
        ? (existing.status === 'failed'
          // D4706 — a failed deployment is retried, not re-created: the
          // identity stays and a new attempt is dispatched under it.
          ? `${licence.licence_ref} already has the deployment ${existing.code}, and its attempt ${existing.current_attempt} failed. Retry it rather than deploying again.`
          : `${licence.licence_ref} already has the deployment ${existing.code} (${existing.status}).`)
        : `The code ${code} belongs to ${existing.licence_uid}.`,
      // `branch`, never `code`: from D258 the SPA reads a body's `code` as the
      // refusal's machine code (e.code), so a branch code there would read as
      // the refusal being called "fr".
      branch: existing.code,
      status: existing.status,
      ...(mine ? { retryable: existing.status === 'failed', current_attempt: existing.current_attempt } : {}),
    }, 409);
  }

  const territory = await c.env.DB.prepare(
    'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
  ).bind(licence.id).all<{ country_code: string }>();
  const codes = (territory.results || []).map((t) => t.country_code);
  if (!codes.length) {
    return c.json({
      error: 'no_territory',
      message: 'A licence with no country holds no territory, so there is nothing for a branch to serve.',
    }, 409);
  }

  const hostname = `${code}.axal.vc`;
  // What was ASKED for, kept apart from what is granted. Cloudflare guarantees
  // `eu` and nothing else (D.1); a Dubai branch asks for in-country and gets a
  // hint, and a record that stored only the request would misreport residency.
  const requested = d1 === 'eu' ? 'eu' : (hint === 'none' ? 'none' : `hint:${hint}`);

  // The identity and its first attempt, written together and BEFORE the
  // dispatch, so an attempt whose answer never arrives still leaves a trace
  // (`dispatching`) that a status check can settle.
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO licence_deployments
         (licence_uid, code, hostname, worker_name, d1_name, d1_jurisdiction, location_hint, do_jurisdiction,
          residency_requested, status, current_attempt, requested_by_user_id, requested_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', 1, ?, ?, ?)`,
    ).bind(
      licence.uid, code, hostname, `studioos-${code}`, `studioos-${code}`,
      d1 === 'none' ? null : d1, hint === 'none' ? null : hint, dojur,
      requested, admin.id, now, now,
    ),
    c.env.DB.prepare(
      `INSERT INTO licence_deployment_attempts (uid, licence_uid, code, attempt_no, status, requested_by_user_id, requested_at)
       VALUES (?, ?, ?, 1, 'dispatching', ?, ?)`,
    ).bind(newAttemptUid(), licence.uid, code, admin.id, now),
  ]);

  if (!githubConfigured(c.env)) {
    await failDeployment(c.env, licence.uid, 1, 'github_not_configured', 'GITHUB_ACCESS_TOKEN is not set on this Worker.');
    return c.json({
      error: 'github_not_configured',
      // Named precisely, because "not configured" covers three different
      // things and only one of them is this one.
      message: GITHUB_NOT_CONFIGURED_MESSAGE,
      branch: code,
      workflow: PROVISION_WORKFLOW,
      attempt: 1,
    }, 409);
  }

  return dispatchAttempt(c, { licence_uid: licence.uid, code, hostname }, 1, {
    code,
    name: licence.brand_name || licence.legal_entity_name || code,
    licence_uid: licence.uid,
    territory: codes.join(','),
    principal_email: String(body.principal_email ?? ''),
    principal_name: String(body.principal_name ?? 'Licence principal'),
    d1_jurisdiction: d1,
    location_hint: hint,
    do_jurisdiction: dojur,
  });
});

// GET /api/admin/licences/:uid/deployment — the identity and its attempts.
r.get('/licences/:uid/deployment', async (c) => {
  await requireSuperAdmin(c);
  const view = await deploymentView(c.env, String(c.req.param('uid') || '').trim());
  if (!view) return c.json({ deployment: null });
  return c.json({ deployment: view });
});

/**
 * POST /api/admin/licences/:uid/deploy/retry — a new attempt for a failed one.
 *
 * IDEMPOTENT BY COMPARE-AND-SET. The body names `expected_attempt`, the
 * attempt the operator saw fail. The identity moves to attempt N+1 only if it
 * is still failed AND still at N, in one UPDATE; the loser of a double click,
 * or a replay after a lost response, finds the counter already moved and is
 * answered with the current state (`replayed: true`) — never a second
 * dispatch. The provisioning workflow is idempotent by step and holds one run
 * per code (its `concurrency` group), so a retry resumes rather than
 * duplicating infrastructure, and the D1 rows are kept, not deleted.
 */
r.post('/licences/:uid/deploy/retry', async (c) => {
  const admin = await requireSuperAdmin(c);
  const uid = String(c.req.param('uid') || '').trim();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const expected = Number(body.expected_attempt);
  if (!Number.isInteger(expected) || expected < 1) {
    return c.json({
      error: 'bad_attempt',
      message: 'A retry names the attempt it is retrying (expected_attempt), so two retries of one failure cannot both run.',
    }, 400);
  }

  const licence = await c.env.DB.prepare(
    'SELECT id, uid, licence_ref, brand_name, legal_entity_name FROM territory_licences WHERE uid = ?',
  ).bind(uid).first<{ id: number; uid: string; licence_ref: string; brand_name: string; legal_entity_name: string }>();
  if (!licence) return c.json({ error: 'not_found' }, 404);
  const dep = await loadIdentity(c.env, licence.uid);
  if (!dep) {
    return c.json({ error: 'no_deployment', message: `${licence.licence_ref} has no deployment to retry. Deploy it first.` }, 404);
  }

  const answerState = async () => {
    const view = await deploymentView(c.env, licence.uid);
    if (dep.current_attempt > expected || (view && view.current_attempt > expected)) {
      // Already retried — by this request's twin or by someone else. The
      // state is the answer; nothing is dispatched twice.
      return c.json({ ok: true, replayed: true, attempt: view?.current_attempt, status: view?.status, deployment: view });
    }
    if (view && view.current_attempt < expected) {
      return c.json({
        error: 'stale_attempt',
        message: `There is no attempt ${expected} yet; the current one is ${view.current_attempt}. Reload and retry what is shown.`,
        deployment: view,
      }, 409);
    }
    return c.json({
      error: 'not_failed',
      message: `Attempt ${expected} of ${dep.code} is ${view?.status ?? dep.status}, not failed, so there is nothing to retry. Check its status instead.`,
      deployment: view,
    }, 409);
  };

  if (dep.current_attempt !== expected || dep.status !== 'failed') return answerState();

  const dojur = String(dep.do_jurisdiction ?? body.do_jurisdiction ?? '').toLowerCase();
  if (!DO_JURISDICTIONS.has(dojur)) {
    // Written before this value was stored. It is write-once on the branch,
    // so it is asked for, never guessed.
    return c.json({
      error: 'do_jurisdiction_required',
      message: 'This deployment was requested before its Durable Object jurisdiction was recorded. Choose the one the first attempt used (eu, us or none) and retry.',
    }, 409);
  }
  const territory = await c.env.DB.prepare(
    'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
  ).bind(licence.id).all<{ country_code: string }>();
  const codes = (territory.results || []).map((t) => t.country_code);
  if (!codes.length) {
    return c.json({
      error: 'no_territory',
      message: 'A licence with no country holds no territory, so there is nothing for a branch to serve.',
    }, 409);
  }
  // Refused BEFORE the attempt counter moves: a retry that cannot dispatch
  // would only add a second identical failure to the history.
  if (!githubConfigured(c.env)) {
    return c.json({
      error: 'github_not_configured', message: GITHUB_NOT_CONFIGURED_MESSAGE, branch: dep.code, workflow: PROVISION_WORKFLOW,
    }, 409);
  }

  const next = expected + 1;
  const now = nowIso();
  const cas = await c.env.DB.prepare(
    `UPDATE licence_deployments
        SET status = 'requested', status_note = NULL, current_attempt = current_attempt + 1,
            do_jurisdiction = ?, updated_at = ?
      WHERE licence_uid = ? AND status = 'failed' AND current_attempt = ?`,
  ).bind(dojur, now, licence.uid, expected).run();
  if (!cas.meta?.changes) return answerState();

  await c.env.DB.prepare(
    `INSERT INTO licence_deployment_attempts (uid, licence_uid, code, attempt_no, status, requested_by_user_id, requested_at)
     VALUES (?, ?, ?, ?, 'dispatching', ?, ?)`,
  ).bind(newAttemptUid(), licence.uid, dep.code, next, admin.id, now).run();

  return dispatchAttempt(c, { licence_uid: licence.uid, code: dep.code, hostname: dep.hostname }, next, {
    code: dep.code,
    name: licence.brand_name || licence.legal_entity_name || dep.code,
    licence_uid: licence.uid,
    territory: codes.join(','),
    principal_email: String(body.principal_email ?? ''),
    principal_name: String(body.principal_name ?? 'Licence principal'),
    d1_jurisdiction: dep.d1_jurisdiction ?? 'none',
    location_hint: dep.location_hint ?? 'none',
    do_jurisdiction: dojur,
  });
});

const minutesSince = (iso: string) => (Date.now() - Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)) / 60000;

/**
 * POST /api/admin/licences/:uid/deploy/reconcile — read what GitHub did.
 *
 * WHY THIS EXISTS. A dispatch answers 204 with no run id, and an answer that
 * never arrives (a timeout) leaves the attempt `dispatching`: GitHub may or
 * may not have queued a run. Offering a second Deploy there is how two runs
 * get asked for one branch. So the page offers this instead: list the
 * workflow's dispatched runs since the attempt, match the one whose job is
 * `provision <code>` (the job name the workflow declares) and that no earlier
 * attempt has claimed, and record its outcome. Only a run that concluded, or
 * no run at all after NO_RUN_AFTER_MINUTES, settles the attempt; anything
 * else is still pending and says so. Read-only towards GitHub.
 */
r.post('/licences/:uid/deploy/reconcile', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;
  const uid = String(c.req.param('uid') || '').trim();
  const dep = await loadIdentity(env, uid);
  if (!dep) return c.json({ error: 'no_deployment', message: 'This licence has no deployment to check.' }, 404);
  const attempt = await env.DB.prepare(
    `SELECT uid, licence_uid, code, attempt_no, status, failure_code, failure_note, run_id, run_url,
            run_status, run_conclusion, requested_by_user_id, requested_at, settled_at
       FROM licence_deployment_attempts WHERE licence_uid = ? AND attempt_no = ?`,
  ).bind(uid, dep.current_attempt).first<AttemptRow>();

  const answer = async (checked: string) =>
    c.json({ ok: true, checked, deployment: await deploymentView(env, uid) });

  if (!attempt || attempt.status === 'failed' || attempt.status === 'succeeded') return answer('settled');
  if (!githubConfigured(env)) {
    return c.json({ error: 'github_not_configured', message: GITHUB_NOT_CONFIGURED_MESSAGE, deployment: await deploymentView(env, uid) }, 409);
  }

  const since = new Date(Date.parse(attempt.requested_at.includes('T') ? attempt.requested_at : `${attempt.requested_at.replace(' ', 'T')}Z`) - 60_000)
    .toISOString().replace(/\.\d{3}Z$/, 'Z');
  const runs = await listDispatchedRuns(env, PROVISION_WORKFLOW, since);
  if (!runs.ok) {
    // Nothing is changed on a read that failed: the attempt keeps the state it
    // had, and the operator reads that GitHub could not be asked.
    return c.json(refusalBody({
      code: 'github_unreadable',
      message: `GitHub could not be asked about the run (HTTP ${runs.status}). Nothing was changed; check again shortly.`,
      raw: runs.error || null,
      audience: 'admin',
      extra: { deployment: await deploymentView(env, uid) },
    }), 502);
  }
  const claimed = new Set(
    ((await env.DB.prepare(
      'SELECT run_id FROM licence_deployment_attempts WHERE code = ? AND attempt_no <> ? AND run_id IS NOT NULL',
    ).bind(dep.code, attempt.attempt_no).all<{ run_id: string }>()).results || []).map((x) => String(x.run_id)),
  );
  let match: any = null;
  let unidentified = 0;
  for (const run of (runs.data as any[])) {
    if (claimed.has(String(run.id))) continue;
    const jobs = await listRunJobs(env, run.id);
    const list = jobs.ok ? (jobs.data as any[]) : [];
    if (!list.length) { unidentified++; continue; }
    if (list.some((j) => j?.name === `provision ${dep.code}`)) { match = run; break; }
  }

  if (!match) {
    if (unidentified === 0 && minutesSince(attempt.requested_at) >= NO_RUN_AFTER_MINUTES) {
      const note = attempt.status === 'dispatching'
        ? `GitHub's answer to attempt ${attempt.attempt_no} never arrived, and no run for ${dep.code} appeared within ${NO_RUN_AFTER_MINUTES} minutes. It can be retried.`
        : `GitHub accepted attempt ${attempt.attempt_no}, but no run for ${dep.code} appeared within ${NO_RUN_AFTER_MINUTES} minutes. It can be retried.`;
      await failDeployment(env, uid, attempt.attempt_no, 'run_not_found', note);
      return answer('no_run');
    }
    return answer('no_run_yet');
  }

  const runId = String(match.id);
  const runUrl = typeof match.html_url === 'string' ? match.html_url : null;
  const runStatus = match.status ? String(match.status) : null;
  const conclusion = match.conclusion ? String(match.conclusion) : null;
  await env.DB.prepare(
    `UPDATE licence_deployment_attempts SET run_id = ?, run_url = ?, run_status = ?, run_conclusion = ?,
            status = CASE WHEN status = 'dispatching' THEN 'dispatched' ELSE status END
      WHERE licence_uid = ? AND attempt_no = ?`,
  ).bind(runId, runUrl, runStatus, conclusion, uid, attempt.attempt_no).run();
  await env.DB.prepare(
    'UPDATE licence_deployments SET provision_run_id = ?, updated_at = ? WHERE licence_uid = ? AND current_attempt = ?',
  ).bind(runId, nowIso(), uid, attempt.attempt_no).run();

  if (runStatus !== 'completed') return answer('running');
  if (conclusion === 'success') {
    // The run's last checks are the smoke test on the new host and the PR
    // that gives HQ its binding. So the branch answers; HQ reaches it only
    // once that PR merges and HQ redeploys — a partial outcome, said so.
    await env.DB.prepare(
      `UPDATE licence_deployments SET status = 'hostname_active', status_note = ?, live_at = COALESCE(live_at, ?), updated_at = ?
        WHERE licence_uid = ? AND current_attempt = ?`,
    ).bind(
      `The provisioning run succeeded and ${dep.hostname} answered its smoke test. HQ reaches it once the linking PR merges and HQ redeploys.`,
      nowIso(), nowIso(), uid, attempt.attempt_no,
    ).run();
    await settleAttempt(env, uid, attempt.attempt_no, { status: 'succeeded' });
    return answer('succeeded');
  }
  await failDeployment(
    env, uid, attempt.attempt_no, 'run_failed',
    `The provisioning run ended ${conclusion ?? 'without a conclusion'}.${runUrl ? ` Its log: ${runUrl}` : ''} It can be retried; each step resumes rather than duplicating.`,
  );
  return answer('failed');
});

// GET /api/admin/deployments — H6 Platform's Deployments zone.
r.get('/deployments', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  let rows: DeploymentRow[] = [];
  let registryReadable = true;
  try {
    const q = await env.DB.prepare(
      `SELECT licence_uid, code, hostname, worker_name, d1_name, d1_jurisdiction, location_hint,
              residency_requested, residency_granted, status, status_note, provision_run_id,
              requested_at, live_at, last_health_at, last_health_ok, last_version
         FROM licence_deployments ORDER BY code`,
    ).all<DeploymentRow>();
    rows = q.results || [];
  } catch {
    registryReadable = false;
  }

  // Live health, per branch, with the same isolation every other cross-branch
  // read uses: one unreachable branch reports itself and nothing else (D108).
  const asked = await fanOut<BranchHealthLive>(env, 'health');
  const live = withRegistry(asked, rows.map((d) => ({ code: d.code, hostname: d.hostname, status: d.status })));
  const byCode = new Map(live.map((l) => [l.code, l] as const));

  // D452 — persist the last successful health read (version + ok + time).
  // Best-effort: a failed write must not block the console response.
  if (registryReadable && rows.length) {
    const now = nowIso();
    try {
      const stmts = [];
      for (const d of rows) {
        const l = byCode.get(d.code);
        if (l?.status !== 'ok' || !l.data) continue;
        const ok = l.data.ok ? 1 : 0;
        const ver = l.data.deploy_version ? String(l.data.deploy_version).slice(0, 120) : null;
        stmts.push(
          env.DB.prepare(
            `UPDATE licence_deployments
                SET last_health_at = ?, last_health_ok = ?,
                    last_version = COALESCE(?, last_version), updated_at = ?
              WHERE code = ?`,
          ).bind(now, ok, ver, now, d.code),
        );
      }
      if (stmts.length) await env.DB.batch(stmts);
    } catch (e) {
      console.warn('[deployments] last_version persist failed', (e as Error).message);
    }
  }

  // D163 — HQ's own acts against each branch over the last 30 days, from the
  // one store that is not the branch. `live_state` above says whether a branch
  // answers RIGHT NOW; this says what HQ tried while it was not answering, and
  // survives the branch being down because Analytics Engine does not live on
  // it. A fixed window rather than a query parameter: this zone is a console,
  // not a date-ranged report, and nothing here interpolates a request value
  // into AE's query-text-only SQL.
  const branchActions = await loadBranchActionMirror(env, parseRange(null, null, 30));

  return c.json({
    registry_available: registryReadable,
    ...(registryReadable ? {} : {
      registry_reason: 'The licence_deployments table could not be read on this database (migration 258).',
    }),
    deployments: rows.map((d) => {
      const l = byCode.get(d.code);
      const live = l?.status === 'ok' ? l.data : null;
      const version_display = live?.deploy_version
        ? String(live.deploy_version)
        : (d.last_version ? String(d.last_version) : null);
      return {
        ...d,
        // THE PROVISIONING STATUS AND THE LIVE READ ARE SEPARATE FIELDS ON
        // PURPOSE. A deployment that reached `worker_live` last week and is
        // unreachable right now has not regressed to `requested`; conflating
        // them would lose which of the two is wrong.
        live_state: l?.status ?? 'not_deployed',
        live_reason: l?.status === 'ok' ? undefined : l?.reason,
        live_as_of: l?.as_of,
        live,
        // D457 — when the branch answered ok, its live deploy_version wins over
        // a stale row in licence_deployments.last_version.
        version_display,
      };
    }),
    // COVERAGE IS OVER THE BRANCHES HQ ACTUALLY ASKED, not over the registry.
    // A row with no binding was never asked, so counting it as `unreadable`
    // would report a deploy HQ owes itself as a branch that is down — the
    // exact conflation the three-state design exists to prevent. It is
    // reported beside them, under its own name.
    coverage: {
      ...coverage(asked),
      not_deployed: live
        .filter((l: BranchResult<unknown>) => l.status === 'not_deployed')
        .map((l: BranchResult<unknown>) => l.code),
    },
    // D163 — SAID ONCE RATHER THAN ONCE PER ROW. An unreadable telemetry store
    // is one fact about HQ's own instrumentation, not a fact about each
    // branch; repeating it per deployment would read as every branch being
    // unreachable, which is the conflation the three-state design exists to
    // prevent. The rows carry their own branch and the page joins on it.
    branch_actions_available: branchActions.available,
    ...(branchActions.available ? {} : { branch_actions_reason: branchActions.reason }),
    branch_actions_as_of: branchActions.as_of,
    branch_actions: branchActions.rows,
    // The button's own precondition, so the page can disable it with a reason
    // rather than letting someone press it and read a 409.
    dispatch_available: githubConfigured(env),
    dispatch_reason: githubConfigured(env)
      ? undefined
      : 'GITHUB_ACCESS_TOKEN (actions: write, a Worker secret) and GITHUB_REPO_OWNER and GITHUB_REPO_NAME '
        + '(wrangler.toml vars) are not all set, so a branch is provisioned by running the workflow by hand '
        + 'from the Actions tab.',
  });
});

export default r;
