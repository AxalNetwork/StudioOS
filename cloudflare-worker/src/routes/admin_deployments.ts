/**
 * HQ · Platform → Deployments, and the Deploy step of the issue flow (D110).
 *
 *   POST /api/admin/licences/:uid/deploy   request a branch (H3 step 6)
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
import { githubConfigured, dispatchWorkflow } from '../services/githubSync';
import { fanOut, coverage, withRegistry, type BranchResult } from '../services/branches';
import { loadBranchActionMirror, parseRange } from '../services/analyticsReports';
import { BRANCH_CODE_RE } from '../util/branch';

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
    'SELECT licence_uid, code, status FROM licence_deployments WHERE licence_uid = ? OR code = ?',
  ).bind(licence.uid, code).first<{ licence_uid: string; code: string; status: string }>();
  if (existing) {
    return c.json({
      error: existing.licence_uid === licence.uid ? 'already_deployed' : 'code_taken',
      message: existing.licence_uid === licence.uid
        ? `${licence.licence_ref} already has the deployment ${existing.code} (${existing.status}).`
        : `The code ${code} belongs to ${existing.licence_uid}.`,
      // `branch`, never `code`: from D258 the SPA reads a body's `code` as the
      // refusal's machine code (e.code), so a branch code there would read as
      // the refusal being called "fr".
      branch: existing.code,
      status: existing.status,
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

  await c.env.DB.prepare(
    `INSERT INTO licence_deployments
       (licence_uid, code, hostname, worker_name, d1_name, d1_jurisdiction, location_hint,
        residency_requested, status, requested_by_user_id, requested_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`,
  ).bind(
    licence.uid, code, hostname, `studioos-${code}`, `studioos-${code}`,
    d1 === 'none' ? null : d1, hint === 'none' ? null : hint,
    requested, admin.id, nowIso(), nowIso(),
  ).run();

  if (!githubConfigured(c.env)) {
    await c.env.DB.prepare(
      "UPDATE licence_deployments SET status = 'failed', status_note = ?, updated_at = ? WHERE code = ?",
    ).bind('GITHUB_ACCESS_TOKEN is not set on this Worker.', nowIso(), code).run();
    return c.json({
      error: 'github_not_configured',
      // Named precisely, because "not configured" covers three different
      // things and only one of them is this one.
      message:
        'The Deploy button needs GITHUB_ACCESS_TOKEN (with the actions: write scope) set as a Worker '
        + 'secret, and GITHUB_REPO_OWNER and GITHUB_REPO_NAME set in wrangler.toml\'s [vars]. Until then '
        + 'the provisioning workflow can still be '
        + 'run by hand from the repository\'s Actions tab — nothing else about a branch waits on this.',
      branch: code,
      workflow: PROVISION_WORKFLOW,
    }, 409);
  }

  const res = await dispatchWorkflow(c.env, PROVISION_WORKFLOW, PROVISION_REF, {
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

  if (!res.ok) {
    const note = res.status === 403
      // 403 here is specifically the scope: the token authenticated and was
      // refused the action. Reporting it as "not configured" would send
      // someone to set a secret that is already set.
      ? 'GitHub refused the dispatch (403). The token authenticated but lacks the actions: write scope.'
      : `GitHub refused the dispatch: ${res.error || `HTTP ${res.status}`}`;
    await c.env.DB.prepare(
      "UPDATE licence_deployments SET status = 'failed', status_note = ?, updated_at = ? WHERE code = ?",
    ).bind(note, nowIso(), code).run();
    return c.json({ error: 'dispatch_failed', message: note, branch: code, status: res.status }, 502);
  }

  return c.json({
    ok: true,
    code,
    hostname,
    status: 'requested',
    workflow: PROVISION_WORKFLOW,
    // Said plainly because the 204 does not mean what a reader assumes.
    note:
      'GitHub accepted the request. A dispatch returns no run outcome, so this says the run was asked '
      + 'for, not that the branch exists — the run itself moves the status.',
  });
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
  const asked = await fanOut<{ ok: boolean; licence_status: string | null; licence_pushed_at: string | null }>(
    env, 'health',
  );
  const live = withRegistry(asked, rows.map((d) => ({ code: d.code, hostname: d.hostname, status: d.status })));
  const byCode = new Map(live.map((l: BranchResult<unknown>) => [l.code, l]));

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
      return {
        ...d,
        // THE PROVISIONING STATUS AND THE LIVE READ ARE SEPARATE FIELDS ON
        // PURPOSE. A deployment that reached `worker_live` last week and is
        // unreachable right now has not regressed to `requested`; conflating
        // them would lose which of the two is wrong.
        live_state: l?.status ?? 'not_deployed',
        live_reason: l?.status === 'ok' ? undefined : l?.reason,
        live_as_of: l?.as_of,
        live: l?.status === 'ok' ? l.data : null,
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
