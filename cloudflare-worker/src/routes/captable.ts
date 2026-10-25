import { canAccessProject, getProjectMembershipRole } from '../services/projectAccess';
/**
 * T12 — Cap-table simulator routes (port of backend/app/api/routes/captable.py).
 *
 * Mounted at /api/captable. Authenticated. Scenarios are owned by their
 * creator; project-bound data additionally requires current project access.
 *
 *   POST   /simulate                     — stateless run (no persist)
 *   GET    /scenarios                    — list mine (including admin)
 *   POST   /scenarios                    — create + simulate + persist
 *   GET    /scenarios/{uid}              — read one
 *   PUT    /scenarios/{uid}              — update inputs + re-simulate
 *   DELETE /scenarios/{uid}              — delete
 *   GET    /scenarios/{uid}/export.csv   — 409A-friendly CSV export
 *
 * D1020 (#2857) — the recorded register, per venture:
 *   GET    /equity-plan?project_id=      — one venture's pools and grants (none: the account's)
 *   GET    /live?project_id=             — one venture's holders and securities (none: the account's)
 *   PUT    /carta/venture                — the venture a founder's Carta connection is the record for
 *   GET    /register/{projectId}/export.csv — the recorded cap table as CSV, one audit row
 *   POST   /register/{projectId}/snapshot   — a PDF "As of" snapshot into the data room, NDA, seen by nobody
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { projectInActiveCompany } from '../services/tenancyScope';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { ensureTier } from '../middleware/requireTier';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { simulate, validateInputs, toCsv, type Inputs, type SimulateResult } from '../services/captable';
import {
  canReadProject, canWriteProject, canReadScenario, canWriteScenario,
  type AccessUser, type AccessProject,
} from '../services/captableAccess';
import { ensureCapTableVariantColumn } from '../services/captableSchema';
import {
  mintShareToken, verifyShareToken, claimShareToken, sha256Hex, hashViewerField,
} from '../services/shareLink';
import {
  redactForAudience, isShareAudience, AUDIENCE_SCOPE, type ShareAudience,
} from '../services/captableShare';
import {
  safeHarbourStatus, triggerChecklist, commonToPreferredRatio, type TriggerKind,
} from '../services/valuation409a';
import { bindingKey } from '../util/schemaBootstrap';
import { refuse } from '../util/refusal';
import {
  saveScenario, logScenarioAct, loadScenarioByUid as loadByUid, type ScenarioRow,
} from '../services/capTableWrites';
import {
  actorHash, auditStatement, equityPlanBody, num, readEquityPlan, readRegister, registerCsv, snapshotPdf, withOwnership,
  type RegisterScope,
} from '../services/capTableRegister';

/**
 * Build queue #120 — lazy bootstrap for the share tables. Canonical
 * record is migration 170; this self-heals a database that has the
 * deploy but not the migration yet, matching the pattern used by
 * ensureCapTableVariantColumn above. Cached per isolate.
 */
const SHARE_SCHEMA_READY = new WeakMap<object, boolean>();
async function ensureCapTableShareSchema(env: Env): Promise<void> {
  if (SHARE_SCHEMA_READY.get(bindingKey(env))) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS captable_share_tokens (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       scenario_uid TEXT NOT NULL,
       audience TEXT NOT NULL DEFAULT 'summary',
       token_hash TEXT NOT NULL UNIQUE,
       expires_at TEXT NOT NULL,
       used_at TEXT,
       view_limit INTEGER NOT NULL DEFAULT 1,
       view_count INTEGER NOT NULL DEFAULT 0,
       last_viewed_at TEXT,
       label TEXT,
       revoked_at TEXT,
       created_by INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_captable_share_hash ON captable_share_tokens(token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_captable_share_scenario ON captable_share_tokens(scenario_uid, created_at)`,
    `CREATE TABLE IF NOT EXISTS captable_share_views (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       share_token_id INTEGER NOT NULL,
       scenario_uid TEXT NOT NULL,
       ip_hash TEXT,
       ua_fingerprint TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_captable_share_views_token ON captable_share_views(share_token_id)`,
    `CREATE INDEX IF NOT EXISTS idx_captable_share_views_scenario ON captable_share_views(scenario_uid, created_at)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) { console.warn('[captable] share schema bootstrap:', (e as Error).message); }
  }
  SHARE_SCHEMA_READY.set(bindingKey(env), true);
}

const captable = new Hono<{ Bindings: Env }>();

// Task #29 — guarantee cap_table_scenarios.is_variant exists before any handler
// queries it (prod migrations can lag behind the deploy). Cached after the
// first call per isolate, so this is a no-op on the warm path.
captable.use('*', async (c, next) => {
  await ensureCapTableVariantColumn(c.env);
  return next();
});

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function serialize(s: ScenarioRow, withResult = true): any {
  const out: any = {
    uid: s.uid,
    name: s.name,
    owner_user_id: s.owner_user_id,
    project_id: s.project_id,
    is_variant: s.is_variant ? 1 : 0,
    inputs: safeJson<Inputs>(s.inputs_json, {} as Inputs),
    computed_at: s.computed_at || null,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
  if (withResult) out.result = s.result_json ? safeJson<SimulateResult>(s.result_json, null as any) : null;
  return out;
}

type AuthUser = AccessUser & { id: number; role: string };

type ProjectRow = { id: number; founder_id: number | null; company_id?: number | null } & AccessProject;
type Ctx = Context<{ Bindings: Env }>;

/** The project row as stored — no company narrowing. Only the gates below read this. */
async function loadProjectRow(env: Env, projectId: number): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ?')
    .bind(projectId).first<ProjectRow>();
}

/** Membership paths are independent of the member's own active company. */
function isCompanyExempt(user: AuthUser, project: ProjectRow): boolean {
  return !(user.role.toLowerCase() === 'founder' && !!user.founder_id && user.founder_id === project.founder_id);
}
async function computeProjectPermissions(env: Env, user: AuthUser, project: ProjectRow): Promise<ProjectRow> {
  const principal = { ...user, role: user.role.toLowerCase() } as any;
  if (principal.role === 'admin') return { ...project, capRead: true, capWrite: true };
  if (principal.role === 'investor') return { ...project, capRead: false, capWrite: false };
  const owner = principal.role === 'founder' && !!principal.founder_id && principal.founder_id === project.founder_id;
  // A recorded membership first, for every non-owner. Since D889 (#2438)
  // canAccessProject requires one of a partner too; this check stays explicit.
  const member = owner ? null : await getProjectMembershipRole(env, project.id, principal.id);
  if (!owner && !['owner','cofounder','advisor'].includes(member ?? '')) return { ...project, capRead: false, capWrite: false };
  return { ...project,
    capRead: await canAccessProject(env, principal, project),
    capWrite: (owner || member !== 'advisor') && await canAccessProject(env, principal, project, { write: true }),
  };
}

async function projectPermissions(c: Ctx, user: AuthUser, project: ProjectRow): Promise<ProjectRow> {
  const key = `captable_permissions:${project.id}`;
  const cached = c.get(key as never) as ProjectRow | undefined;
  if (cached) return cached;
  const answer = await computeProjectPermissions(c.env, user, project);
  c.set(key as never, answer as never);
  return answer;
}

/** The caller's active company for this request, verified once and memoised. */
async function activeCompanyFor(c: Ctx, user: any): Promise<number | null> {
  const cached = (c as any).get?.(ACTIVE_COMPANY_KEY);
  if (cached !== undefined) return cached as number | null;
  const id = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  (c as any).set?.(ACTIVE_COMPANY_KEY, id);
  return id;
}
const ACTIVE_COMPANY_KEY = '__activeCompanyId';

/**
 * Load a project, narrowed to the caller's active company — stage 2 of
 * company scoping, the shape progress.ts/financials.ts/compliance.ts share.
 * Null for a project outside the active company, which every direct call
 * site already turns into 404 'Project not found': exactly what a
 * `companyScope` query would produce.
 */
async function loadProject(c: Ctx, projectId: number, user: AuthUser): Promise<ProjectRow | null> {
  const row = await loadProjectRow(c.env, projectId);
  if (!row) return null;
  if (isCompanyExempt(user, row)) {
    const answer = await projectPermissions(c, user, row);
    if (!answer.capRead && user.role.toLowerCase() === 'founder'
      && !projectInActiveCompany(await activeCompanyFor(c, user), row)) return null;
    return answer;
  }
  return projectInActiveCompany(await activeCompanyFor(c, user), row) ? projectPermissions(c, user, row) : null;
}

/** Project-bound scenarios inherit current membership and owner-company gates.
 * Missing projects never turn a bound scenario into a private ownership bypass.
 */
async function projectForScenario(c: Ctx, row: ScenarioRow, user: AuthUser): Promise<ProjectRow | null> {
  if (row.project_id == null) return null;
  const proj = await loadProjectRow(c.env, row.project_id);
  if (!proj) return null;
  if (isCompanyExempt(user, proj)) {
    const answer = await projectPermissions(c, user, proj);
    if (!answer.capRead && user.role.toLowerCase() === 'founder'
      && !projectInActiveCompany(await activeCompanyFor(c, user), proj)) throw new HttpError(404, 'Scenario not found');
    return answer;
  }
  if (!projectInActiveCompany(await activeCompanyFor(c, user), proj)) {
    throw new HttpError(404, 'Scenario not found');
  }
  return projectPermissions(c, user, proj);
}

/** Read-gate a scenario by uid: owner / admin / (project-bound → project read). */
async function ensureScenarioReadOr404(c: Ctx, uid: string, user: AuthUser): Promise<ScenarioRow> {
  const row = await loadByUid(c.env, uid);
  if (!row) throw new HttpError(404, 'Scenario not found');
  const proj = await projectForScenario(c, row, user);
  if (!canReadScenario(user, row, proj)) throw new HttpError(403, 'Not your scenario');
  return row;
}

async function auditMemberWrite(c: Ctx, user: AuthUser, project: ProjectRow | null) {
  if (!project || user.role.toLowerCase() === 'admin' ||
    (user.role.toLowerCase() === 'founder' && !!user.founder_id && user.founder_id === project.founder_id)) return;
  const key = `captable_write:${project.id}`;
  if (c.get(key as never)) return;
  await c.env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, ?, ?)')
    .bind(project.id, user.id, 'captable_member_write_authorized', JSON.stringify({ method: c.req.method, route: c.req.routePath }), `user:${user.id}`).run();
  c.set(key as never, true as never);
}

/** Write-gate a scenario by uid: owner / admin / (project-bound → project write). */
async function ensureScenarioWriteOr404(c: Ctx, uid: string, user: AuthUser): Promise<ScenarioRow> {
  const row = await loadByUid(c.env, uid);
  if (!row) throw new HttpError(404, 'Scenario not found');
  const proj = await projectForScenario(c, row, user);
  if (!canWriteScenario(user, row, proj)) throw new HttpError(403, 'Not your scenario');
  await auditMemberWrite(c, user, proj);
  return row;
}

/** Attaching a cap table to a project requires project WRITE access. */
async function ensureProjectWriteAccess(c: Ctx, projectId: number | null | undefined, user: AuthUser) {
  if (projectId == null) return;
  const proj = await loadProject(c, projectId, user);
  if (!proj) throw new HttpError(404, 'Project not found');
  if (!canWriteProject(user, proj)) throw new HttpError(403, "You don't have access to that project");
  await auditMemberWrite(c, user, proj);
}

class HttpError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(typeof body === 'string' ? body : 'http_error');
    this.status = status;
    this.body = body;
  }
}

function asJsonError(c: any, err: unknown) {
  if (err instanceof HttpError) {
    const body = typeof err.body === 'string' ? { detail: err.body } : err.body;
    return c.json(body, err.status);
  }
  throw err;
}

/**
 * D1020 — which register a read names: `?project_id=` is one venture, read
 * through the venture's own gate; no parameter is the caller's account.
 */
async function registerScope(c: Ctx, user: AuthUser): Promise<RegisterScope> {
  const raw = c.req.query('project_id');
  if (raw === undefined || raw === '') return { kind: 'account', userId: user.id };
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new HttpError(400, 'project_id must be a venture id');
  const projectId = Number(raw);
  await ensureProjectReadAccess(c, projectId, user);
  return { kind: 'venture', projectId };
}
const scopeBody = (scope: RegisterScope) => (scope.kind === 'venture'
  ? { kind: 'venture', project_id: scope.projectId }
  : { kind: 'account', project_id: null });

/** A venture's permissions, for the holder email rule and the write gates. */
async function ventureFor(c: Ctx, projectId: number, user: AuthUser): Promise<ProjectRow> {
  const proj = await loadProject(c, projectId, user);
  if (!proj) throw new HttpError(404, 'Project not found');
  if (!canReadProject(user as AccessUser, proj)) throw new HttpError(403, "You don't have access to that project");
  return proj;
}

/**
 * Wave 2 — GET /api/captable/equity-plan
 *
 * The Cap Table Pro canvas asks for a grant-level pool burn-down with vesting.
 * Both tables have existed since migration 057 and are populated on every Carta
 * sync — `cap_table_option_pools` (authorized / issued / available) and
 * `cap_table_vesting` (start, cliff, term, total and vested shares). Nothing
 * has ever read them: the ONLY file in the worker that names either table is
 * `integrations/providers/carta.ts`, which writes them. A founder who connected
 * Carta has this data in D1 and has never been shown it.
 *
 * D1020 (#2857): `?project_id=` reads ONE venture's pools and grants, gated
 * like the venture's cap table (`ensureProjectReadAccess`); migration 574 gave
 * both tables `project_id`. Without it, the account's rows as before, for the
 * Spin-Out Lab's card; that answer says `scope.kind = 'account'`. A row whose
 * venture is unset is never shown under a venture.
 *
 * SHARES, NOT MONEY. Every figure here is a share count (REAL in the schema,
 * as Carta reports fractional grants). No money crosses this endpoint, so the
 * integer-cents rule does not apply and no cents column is introduced.
 *
 * Vested share counts are returned AS IMPORTED and never recomputed from the
 * dates: a cliff that has not been reflected by the provider yet is the
 * provider's answer, and second-guessing it here would put two different
 * vested numbers in front of the same founder. `as_of` reports when the row was
 * last written so the UI can say how fresh the answer is.
 */
captable.get('/equity-plan', async (c) => {
  const user = await requireAuth(c) as AuthUser;
  let scope: RegisterScope;
  try { scope = await registerScope(c, user); } catch (e) { return asJsonError(c, e); }
  // D366: a failed SELECT is a refusal, never an empty plan. "No pools or
  // grants recorded" is only said when both stores were actually read.
  let plan: Awaited<ReturnType<typeof readEquityPlan>>;
  try {
    plan = await readEquityPlan(c.env, scope);
  } catch (e) {
    return refuse(c, 500, {
      code: 'equity_plan_read_failed',
      message: 'Your option pools and vesting grants could not be read. This is not a claim that none are recorded; try again in a moment.',
      raw: e,
    });
  }
  // D1020: totals are sums of what is recorded, nothing modelled, and null
  // unless every row records the figure (`knownSum`).
  return c.json({ scope: scopeBody(scope), ...equityPlanBody(plan.pools, plan.vesting) });
});

captable.post('/simulate', async (c) => {
  await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  return c.json(simulate(inputs));
});

captable.get('/scenarios', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM cap_table_scenarios WHERE owner_user_id = ? ORDER BY updated_at DESC',
  ).bind(user.id).all<ScenarioRow>();
  const visible: ScenarioRow[] = [];
  const projects = new Map<number, ProjectRow | null>();
  for (const row of rows.results || []) {
    if (row.project_id == null || user.role.toLowerCase() === 'admin') { visible.push(row); continue; }
    if (!projects.has(row.project_id)) {
      try { projects.set(row.project_id, await projectForScenario(c, row, user)); }
      catch (e) { if (e instanceof HttpError && e.status === 404) projects.set(row.project_id, null); else throw e; }
    }
    if (canReadScenario(user, row, projects.get(row.project_id) ?? null)) visible.push(row);
  }
  return c.json({ items: visible.map((r) => serialize(r as any, false)) });
});

captable.post('/scenarios', async (c) => {
  // Task #6 — captable scenario writes (read paths stay free). D683: the cap
  // table is Raise work, on the Raise + Grow plan (`studio`).
  ensureTier(await requireAuth(c), 'studio');
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name || name.length > 200) return c.json({ detail: 'name must be 1..200 chars' }, 400);
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  const projectId = body?.project_id ?? null;
  try { await ensureProjectWriteAccess(c, projectId, user); }
  catch (e) { return asJsonError(c, e); }
  // D691 — the save, the one-per-project upsert (Task #28), its unique-index
  // recovery (Task #32) and the entry keys live in saveScenario().
  const saved = await saveScenario(c.env, { actor: user, name, inputs, projectId });
  if (!saved.ok) return c.json({ detail: saved.reason === 'update_failed' ? 'Update failed' : 'Insert failed' }, 500);
  return c.json(serialize(saved.row));
});

// Task #28 — load a project's single cap table (project-scoped, NOT owner-
// scoped) so partners/admins can open a founder's cap table from the dropdown.
// Returns { scenario: <serialized> | null }. Registered before /scenarios/:uid.
captable.get('/scenarios/by-project/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const proj = await loadProject(c, projectId, user);
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  if (!canReadProject(user, proj)) return c.json({ detail: "You don't have access to that project" }, 403);
  const row = await c.env.DB.prepare(
    'SELECT * FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant,0) = 0 ORDER BY updated_at DESC LIMIT 1',
  ).bind(projectId).first<ScenarioRow>();
  return c.json({ scenario: row ? serialize(row) : null });
});

// Task #29 — create a named DRAFT variant for a project. Always INSERTs a fresh
// row with is_variant=1 (never upserts), so it stays distinct from the project's
// canonical cap table and is excluded from the one-per-project upsert/by-project
// lookups AND the Demo Day deck. Gated by project WRITE access (Raise + Grow plan, D683).
captable.post('/scenarios/by-project/:projectId/variants', async (c) => {
  ensureTier(await requireAuth(c), 'studio');
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  try { await ensureProjectWriteAccess(c, projectId, user); }
  catch (e) { return asJsonError(c, e); }
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name || name.length > 200) return c.json({ detail: 'name must be 1..200 chars' }, 400);
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  const result = simulate(inputs);
  const now = new Date().toISOString();
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO cap_table_scenarios
       (uid, owner_user_id, project_id, name, inputs_json, result_json, computed_at, created_at, updated_at, is_variant)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).bind(uid, user.id, projectId, name, JSON.stringify(inputs), JSON.stringify(result), now, now, now).run();
  const row = await loadByUid(c.env, uid);
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  await logScenarioAct(c.env, user as any, 'captable_variant_created', row);
  return c.json(serialize(row));
});

// Task #29 — read-only compare: the project's canonical cap table plus all its
// draft variants, each with its computed result, so the UI can lay ownership /
// dilution out side-by-side. Gated by project READ access (no tier gate; reads
// stay free).
captable.get('/scenarios/by-project/:projectId/compare', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const proj = await loadProject(c, projectId, user);
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  if (!canReadProject(user, proj)) return c.json({ detail: "You don't have access to that project" }, 403);
  const res = await c.env.DB.prepare(
    'SELECT * FROM cap_table_scenarios WHERE project_id = ? ORDER BY COALESCE(is_variant,0) ASC, updated_at DESC',
  ).bind(projectId).all<ScenarioRow>();
  const all = res.results || [];
  const canonical = all.find((r) => !r.is_variant) || null;
  const variants = all.filter((r) => !!r.is_variant);
  return c.json({
    canonical: canonical ? serialize(canonical) : null,
    variants: variants.map((r) => serialize(r)),
  });
});

captable.get('/scenarios/:uid', async (c) => {
  const user = await requireAuth(c);
  try {
    const row = await ensureScenarioReadOr404(c, c.req.param('uid'), user);
    return c.json(serialize(row));
  } catch (e) { return asJsonError(c, e); }
});

captable.put('/scenarios/:uid', async (c) => {
  ensureTier(await requireAuth(c), 'studio');
  const user = await requireAuth(c);
  let row: ScenarioRow;
  try { row = await ensureScenarioWriteOr404(c, c.req.param('uid'), user); }
  catch (e) { return asJsonError(c, e); }
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name || name.length > 200) return c.json({ detail: 'name must be 1..200 chars' }, 400);
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  if (body?.project_id !== undefined && body?.project_id !== null) {
    try { await ensureProjectWriteAccess(c, body.project_id, user); }
    catch (e) { return asJsonError(c, e); }
    // Task #28 — one cap table per project: refuse to bind this scenario to a
    // project that a DIFFERENT scenario already owns (prevents PUT duplicates).
    // Task #29 — only CANONICAL scenarios are unique per project; draft variants
    // (is_variant=1) coexist freely, so a variant edit never clashes and only an
    // existing canonical row counts as the clash.
    if (!row.is_variant) {
      const clash = await c.env.DB.prepare(
        'SELECT uid FROM cap_table_scenarios WHERE project_id = ? AND uid != ? AND COALESCE(is_variant,0) = 0 LIMIT 1',
      ).bind(body.project_id, row.uid).first<{ uid: string }>();
      if (clash) {
        return c.json({ detail: { code: 'project_has_cap_table', message: 'This project already has a cap table. Edit that one instead.' } }, 409);
      }
    }
  }
  const projectId = body?.project_id !== undefined ? body.project_id : row.project_id;
  // D691 — the save, the entry keys and D632's activity row live in saveScenario().
  const saved = await saveScenario(c.env, { actor: user, name, inputs, projectId, row });
  if (!saved.ok) {
    return c.json({ detail: { code: 'project_has_cap_table', message: 'This project already has a cap table. Edit that one instead.' } }, 409);
  }
  return c.json(serialize(saved.row));
});

captable.delete('/scenarios/:uid', async (c) => {
  ensureTier(await requireAuth(c), 'studio');
  const user = await requireAuth(c);
  let gone: ScenarioRow;
  try { gone = await ensureScenarioWriteOr404(c, c.req.param('uid'), user); }
  catch (e) { return asJsonError(c, e); }
  await c.env.DB.prepare('DELETE FROM cap_table_scenarios WHERE uid = ?').bind(c.req.param('uid')).run();
  await logScenarioAct(c.env, user as any, 'captable_scenario_deleted', gone);
  return c.json({ ok: true });
});

captable.get('/scenarios/:uid/export.csv', async (c) => {
  const user = await requireAuth(c);
  let row: ScenarioRow;
  try { row = await ensureScenarioReadOr404(c, c.req.param('uid'), user); }
  catch (e) { return asJsonError(c, e); }
  const result: SimulateResult = row.result_json
    ? safeJson(row.result_json, simulate(safeJson<Inputs>(row.inputs_json, {} as Inputs)) as SimulateResult)
    : simulate(safeJson<Inputs>(row.inputs_json, {} as Inputs)) as SimulateResult;
  const csv = toCsv(result);
  const safeName = (row.name || 'scenario').replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="captable-${safeName}.csv"`,
    },
  });
});

// =====================================================================
// Build queue #120 — audience-scoped share links.
//
// ROUTE ORDER MATTERS: `/share/:token` and the scenario-scoped share
// endpoints are registered here, ABOVE the `/:projectId` catch-all
// further down this file. Hono matches in registration order, so moving
// these below it would route `/api/captable/share/abc` into the
// project handler and 404 (or worse, treat "share" as a project id).
// =====================================================================

const SHARE_TTL_HOURS_DEFAULT = 168;   // 7 days
const SHARE_TTL_HOURS_MAX = 24 * 90;   // 90 days
const SHARE_VIEW_LIMIT_MAX = 500;

/** POST /api/captable/scenarios/:uid/share — mint an audience-scoped link. */
captable.post('/scenarios/:uid/share', async (c) => {
  try {
  const user = await requireAuth(c);
  await ensureCapTableShareSchema(c.env);
  const uid = c.req.param('uid');
  // Sharing is a WRITE-level act: it hands the cap table to an outsider,
  // so scenario READ access is deliberately not enough. Reuses the
  // existing gate so project-bound scenarios follow project write rules.
  await ensureScenarioWriteOr404(c, uid, user);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const audience: ShareAudience = isShareAudience(body.audience) ? body.audience : 'summary';
  const ttlHours = Math.min(
    SHARE_TTL_HOURS_MAX,
    Math.max(1, Number(body.expires_in_hours) || SHARE_TTL_HOURS_DEFAULT),
  );
  const viewLimit = Math.min(
    SHARE_VIEW_LIMIT_MAX,
    Math.max(1, Number(body.view_limit) || 25),
  );
  const label = body.label ? String(body.label).slice(0, 120) : null;

  const minted = await mintShareToken(c.env, `captable:${uid}:${audience}`, ttlHours * 3600, user.email);
  await c.env.DB.prepare(
    `INSERT INTO captable_share_tokens (scenario_uid, audience, token_hash, expires_at, view_limit, label, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, audience, await sha256Hex(minted.token), minted.expires_at, viewLimit, label, user.id,
  ).run();

  return c.json({
    token: minted.token,
    audience,
    expires_at: minted.expires_at,
    expires_in_seconds: minted.expires_in_seconds,
    view_limit: viewLimit,
    share_path: `/share/captable/${minted.token}`,
    scope: AUDIENCE_SCOPE[audience],
  }, 201);
  } catch (e) { return asJsonError(c, e); }
});

/** GET /api/captable/scenarios/:uid/shares — live links for this scenario. */
captable.get('/scenarios/:uid/shares', async (c) => {
  try {
  const user = await requireAuth(c);
  await ensureCapTableShareSchema(c.env);
  const uid = c.req.param('uid');
  await ensureScenarioWriteOr404(c, uid, user);
  const rows = await c.env.DB.prepare(
    `SELECT id, audience, expires_at, used_at, view_limit, view_count, last_viewed_at,
            label, revoked_at, created_at
       FROM captable_share_tokens
      WHERE scenario_uid = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(uid).all<Record<string, unknown>>();
  // The token itself is unrecoverable by design — only its hash was
  // stored — so the list shows status, never a re-copyable link.
  return c.json({ items: rows.results || [] });
  } catch (e) { return asJsonError(c, e); }
});

/** DELETE /api/captable/shares/:id — revoke a link before it expires. */
captable.delete('/shares/:id', async (c) => {
  try {
  const user = await requireAuth(c);
  await ensureCapTableShareSchema(c.env);
  const id = Number(c.req.param('id'));
  const tok = await c.env.DB.prepare(
    'SELECT id, scenario_uid FROM captable_share_tokens WHERE id = ?',
  ).bind(id).first<{ id: number; scenario_uid: string }>();
  if (!tok) return c.json({ detail: 'Not found' }, 404);
  await ensureScenarioWriteOr404(c, tok.scenario_uid, user);
  // Revoke by expiring rather than deleting, so the view history stays
  // attributable to a link the owner can still see they created.
  await c.env.DB.prepare(
    `UPDATE captable_share_tokens
        SET revoked_at = datetime('now'), expires_at = datetime('now')
      WHERE id = ?`,
  ).bind(id).run();
  return c.json({ ok: true, id });
  } catch (e) { return asJsonError(c, e); }
});

/**
 * GET /api/captable/share/:token — PUBLIC. No auth.
 *
 * Redaction runs server-side before serialisation (services/
 * captableShare.ts), so data the audience may not see never reaches the
 * browser at all rather than being hidden by the client.
 */
captable.get('/share/:token', async (c) => {
  await ensureCapTableShareSchema(c.env);
  const token = c.req.param('token');
  const verified = await verifyShareToken(c.env, token);
  if ('error' in verified) {
    // 410 for a link that WAS valid and has aged out, 403 for one that
    // never was — a viewer can act on the difference.
    return verified.error === 'expired'
      ? c.json({ detail: 'This link has expired. Ask for a fresh one.' }, 410)
      : c.json({ detail: 'This link is not valid.' }, 403);
  }
  const m = /^captable:([A-Za-z0-9_-]+):(summary|investor|full)$/.exec(String(verified.k));
  if (!m) return c.json({ detail: 'This link is not valid.' }, 403);
  const [, uid, audienceRaw] = m;
  const audience = audienceRaw as ShareAudience;

  const claim = await claimShareToken(c.env, 'captable_share_tokens', await sha256Hex(token));
  if (!claim.ok) {
    return claim.reason === 'exhausted_or_expired'
      ? c.json({ detail: 'This link has been used its maximum number of times, or has expired.' }, 410)
      : c.json({ detail: 'This link is not valid.' }, 403);
  }

  const row = await c.env.DB.prepare(
    'SELECT uid, name, result_json FROM cap_table_scenarios WHERE uid = ?',
  ).bind(uid).first<{ uid: string; name: string; result_json: string | null }>();
  if (!row) return c.json({ detail: 'This cap table is no longer available.' }, 404);

  let result: SimulateResult | null = null;
  try { result = row.result_json ? JSON.parse(row.result_json) as SimulateResult : null; }
  catch { result = null; }

  // Best-effort impression log; never block or fail the read on it.
  try {
    const tok = await c.env.DB.prepare(
      'SELECT id FROM captable_share_tokens WHERE token_hash = ? LIMIT 1',
    ).bind(await sha256Hex(token)).first<{ id: number }>();
    if (tok) {
      await c.env.DB.prepare(
        `INSERT INTO captable_share_views (share_token_id, scenario_uid, ip_hash, ua_fingerprint)
         VALUES (?, ?, ?, ?)`,
      ).bind(
        tok.id, uid,
        await hashViewerField(c.env, c.req.header('cf-connecting-ip') || null),
        await hashViewerField(c.env, c.req.header('user-agent') || null),
      ).run();
    }
  } catch (e) {
    console.warn('[captable] share view log failed:', (e as Error).message);
  }

  return c.json(redactForAudience(result, audience, row.name || 'Cap table'));
});

/**
 * Task #5 — Live cap table (Carta-synced or manually-promoted rows).
 *
 * Returns the user's `cap_table_holders` + `cap_table_securities` plus the
 * Carta integration's last sync timestamp + connection state so the
 * CapTablePage can render a banner ("Synced from Carta — last sync N min ago")
 * and a read-only badge on Carta-sourced rows.
 *
 * Read-only — admin sees own rows only here (their privileged read of other
 * tenants is intentionally NOT exposed at this surface).
 */
// ---------------------------------------------------------------------------
// 409A safe harbour
//
// services/valuation409a.ts decides whether a company's option grants sit
// behind a §409A presumption of reasonableness. It is pure — no clock, no
// storage — so these routes supply both: the appraisals and material
// events from D1 (migration 172), and today's date.
//
// The valuation table is HISTORY, never overwritten. An auditor asks what
// the FMV was on a grant date, not what it is today, and the current
// status is just the latest row by valuation_date.
//
// Access rides on the project, exactly like a cap table scenario:
// founders on their own project, plus admins and partners. Reading a
// company's FMV is reading its cap table by another route, so the two
// gates have to agree.
//
// These are registered above `/:projectId`. Their paths carry two
// segments so Hono would not confuse them today, but the catch-all below
// makes that a matter of luck rather than design.
// ---------------------------------------------------------------------------

const VALUATION409A_SCHEMA_READY = new WeakMap<object, boolean>();
async function ensure409aSchema(env: Env): Promise<void> {
  if (VALUATION409A_SCHEMA_READY.get(bindingKey(env))) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS valuations_409a (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       valuation_date TEXT NOT NULL,
       fmv_per_share REAL NOT NULL,
       provider TEXT,
       method TEXT,
       preferred_price_per_share REAL,
       report_url TEXT,
       notes TEXT,
       created_by INTEGER REFERENCES users(id),
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS valuation_409a_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       kind TEXT NOT NULL,
       occurred_on TEXT NOT NULL,
       note TEXT,
       created_by INTEGER REFERENCES users(id),
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
  VALUATION409A_SCHEMA_READY.set(bindingKey(env), true);
}

const TRIGGER_KINDS = new Set<TriggerKind>([
  'priced_round', 'material_change', 'secondary_transaction',
  'acquisition_discussion', 'financial_restatement',
]);
const VALUATION_METHODS = new Set([
  'income', 'market', 'asset', 'obm', 'backsolve', 'other',
]);

/** Read-gate a project the same way a project-bound scenario is read-gated. */
async function ensureProjectReadAccess(c: Ctx, projectId: number, user: AuthUser) {
  const proj = await loadProject(c, projectId, user);
  if (!proj) throw new HttpError(404, 'Project not found');
  if (!canReadProject(user as AccessUser, proj)) {
    throw new HttpError(403, "You don't have access to that project");
  }
}

function isoDateOrThrow(value: unknown, field: string): string {
  const s = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new HttpError(400, `${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return s;
}

// GET /api/captable/409a/:projectId — status, history and trigger checklist.
captable.get('/409a/:projectId', async (c) => {
  try {
    const user = await requireAuth(c);
    const projectId = parseInt(c.req.param('projectId'), 10);
    if (!Number.isFinite(projectId)) throw new HttpError(400, 'Invalid project id');
    await ensureProjectReadAccess(c, projectId, user as AuthUser);
    await ensure409aSchema(c.env);

    const [valuations, events] = await Promise.all([
      c.env.DB.prepare(
        `SELECT * FROM valuations_409a WHERE project_id = ?
          ORDER BY valuation_date DESC, id DESC LIMIT 50`,
      ).bind(projectId).all(),
      c.env.DB.prepare(
        `SELECT * FROM valuation_409a_events WHERE project_id = ?
          ORDER BY occurred_on DESC, id DESC LIMIT 100`,
      ).bind(projectId).all(),
    ]);

    const history = (valuations.results || []) as any[];
    const eventRows = ((events.results || []) as any[]).map((e) => ({
      kind: e.kind as TriggerKind,
      occurred_on: String(e.occurred_on).slice(0, 10),
      note: e.note ?? null,
    }));
    // Latest by valuation_date — the appraisal currently in force.
    const current = history[0]
      ? {
          valuation_date: String(history[0].valuation_date).slice(0, 10),
          fmv_per_share: Number(history[0].fmv_per_share),
          provider: history[0].provider ?? null,
          method: history[0].method ?? null,
        }
      : null;

    const today = new Date().toISOString().slice(0, 10);
    return c.json({
      ok: true,
      project_id: projectId,
      as_of: today,
      current,
      status: safeHarbourStatus(current, eventRows, today),
      triggers: triggerChecklist(current, eventRows, today),
      // Null rather than a fabricated ratio when either side is missing.
      common_to_preferred: commonToPreferredRatio(
        history[0]?.fmv_per_share ?? null,
        history[0]?.preferred_price_per_share ?? null,
      ),
      history,
      events: events.results || [],
    });
  } catch (e) { return asJsonError(c, e); }
});

// POST /api/captable/409a/:projectId — record an appraisal.
captable.post('/409a/:projectId', async (c) => {
  try {
    const user = await requireAuth(c);
    const projectId = parseInt(c.req.param('projectId'), 10);
    if (!Number.isFinite(projectId)) throw new HttpError(400, 'Invalid project id');
    await ensureProjectWriteAccess(c, projectId, user as AuthUser);
    await ensure409aSchema(c.env);

    const body: any = await c.req.json().catch(() => ({}));
    const valuationDate = isoDateOrThrow(body?.valuation_date, 'valuation_date');
    const fmv = Number(body?.fmv_per_share);
    // Zero is rejected along with negatives and junk: a zero FMV would
    // report every grant as free and is never a real appraisal result.
    if (!Number.isFinite(fmv) || fmv <= 0) {
      throw new HttpError(400, 'fmv_per_share must be a positive number');
    }
    const method = body?.method ? String(body.method) : null;
    if (method && !VALUATION_METHODS.has(method)) {
      throw new HttpError(400, `method must be one of ${[...VALUATION_METHODS].join(', ')}`);
    }
    const preferred = body?.preferred_price_per_share == null
      ? null : Number(body.preferred_price_per_share);
    if (preferred !== null && (!Number.isFinite(preferred) || preferred <= 0)) {
      throw new HttpError(400, 'preferred_price_per_share must be a positive number when supplied');
    }

    const res = await c.env.DB.prepare(
      `INSERT INTO valuations_409a
         (project_id, valuation_date, fmv_per_share, provider, method,
          preferred_price_per_share, report_url, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).bind(
      projectId, valuationDate, fmv,
      body?.provider ? String(body.provider).slice(0, 200) : null,
      method, preferred,
      body?.report_url ? String(body.report_url).slice(0, 1000) : null,
      body?.notes ? String(body.notes).slice(0, 2000) : null,
      user.id,
    ).first<{ id: number }>();

    return c.json({ ok: true, id: res?.id ?? null }, 201);
  } catch (e) { return asJsonError(c, e); }
});

// POST /api/captable/409a/:projectId/events — record a material event.
captable.post('/409a/:projectId/events', async (c) => {
  try {
    const user = await requireAuth(c);
    const projectId = parseInt(c.req.param('projectId'), 10);
    if (!Number.isFinite(projectId)) throw new HttpError(400, 'Invalid project id');
    await ensureProjectWriteAccess(c, projectId, user as AuthUser);
    await ensure409aSchema(c.env);

    const body: any = await c.req.json().catch(() => ({}));
    const kind = String(body?.kind || '') as TriggerKind;
    if (!TRIGGER_KINDS.has(kind)) {
      throw new HttpError(400, `kind must be one of ${[...TRIGGER_KINDS].join(', ')}`);
    }
    const occurredOn = isoDateOrThrow(body?.occurred_on, 'occurred_on');

    const res = await c.env.DB.prepare(
      `INSERT INTO valuation_409a_events (project_id, kind, occurred_on, note, created_by)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    ).bind(
      projectId, kind, occurredOn,
      body?.note ? String(body.note).slice(0, 2000) : null,
      user.id,
    ).first<{ id: number }>();

    return c.json({ ok: true, id: res?.id ?? null }, 201);
  } catch (e) { return asJsonError(c, e); }
});

// DELETE /api/captable/409a/:projectId/events/:id — undo a mis-entered event.
//
// Events only, never valuations. A wrong event date silently changes
// whether grants are covered, so it has to be correctable; an appraisal
// is a document that existed, and deleting one destroys the answer to
// "what was the FMV when you granted these options".
captable.delete('/409a/:projectId/events/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const projectId = parseInt(c.req.param('projectId'), 10);
    const eventId = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(projectId) || !Number.isFinite(eventId)) {
      throw new HttpError(400, 'Invalid id');
    }
    await ensureProjectWriteAccess(c, projectId, user as AuthUser);
    await ensure409aSchema(c.env);
    // project_id in the WHERE clause, not just the event id — otherwise
    // anyone with write access to any project could delete any event.
    const res = await c.env.DB.prepare(
      `DELETE FROM valuation_409a_events WHERE id = ? AND project_id = ?`,
    ).bind(eventId, projectId).run();
    if (!Number(res?.meta?.changes || 0)) throw new HttpError(404, 'Event not found');
    return c.json({ ok: true });
  } catch (e) { return asJsonError(c, e); }
});

captable.get('/live', async (c) => {
  const user = await requireAuth(c) as AuthUser;
  let scope: RegisterScope;
  let showEmail = true;
  try {
    scope = await registerScope(c, user);
    if (scope.kind === 'venture') showEmail = canWriteProject(user, await ventureFor(c, scope.projectId, user));
  } catch (e) { return asJsonError(c, e); }
  let integration: { uid: string; status: string; last_synced_at: string | null; external_account_name: string | null; last_error: string | null; config_json: string | null } | null;
  let register: Awaited<ReturnType<typeof readRegister>>;
  try {
    integration = await c.env.DB.prepare(
      "SELECT uid, status, last_synced_at, external_account_name, last_error, config_json FROM integrations WHERE provider_key = 'carta' AND user_id = ? ORDER BY id DESC LIMIT 1",
    ).bind(user.id).first();
    register = await readRegister(c.env, scope);
  } catch (e) {
    return refuse(c, 500, {
      code: 'cap_register_read_failed',
      message: 'The recorded cap table could not be read. This is not a claim that nothing is recorded; try again in a moment.',
      raw: e,
    });
  }
  // D1020: a holder with no recorded shares is null, never 0%, and while any
  // holder's shares are missing no one's share of the total is known.
  const owned = withOwnership(register.holders);
  const venture = integration ? cartaVenture(integration.config_json) : null;
  return c.json({
    scope: scopeBody(scope),
    connected: !!integration && integration.status === 'active',
    integration_uid: integration?.uid || null,
    provider: 'carta',
    // D1020 §4: while Carta is connected for this venture, its rows are the record, read only here.
    carta_project_id: venture,
    carta_is_record: !!integration && integration.status === 'active' && scope.kind === 'venture' && venture === scope.projectId,
    issuer_name: integration?.external_account_name || null,
    last_synced_at: integration?.last_synced_at || null,
    last_error: integration?.last_error || null,
    total_shares: owned.total_shares,
    holders: owned.holders.map((h) => (showEmail ? h : { ...h, email: undefined })),
    securities: register.securities.map((s) => ({ ...s, shares_authorized: num(s.shares_authorized), shares_issued: num(s.shares_issued) })),
  });
});

/**
 * D1020 §4 — the venture a founder's Carta connection is the record for.
 * Carta's sync writes the account's issuer; this names which venture it is.
 * Setting it moves the connector's rows to that venture, and the next sync
 * writes there. `null` makes them account-level again. One audit row.
 */
captable.put('/carta/venture', async (c) => {
  const user = await requireAuth(c) as AuthUser;
  const body = await c.req.json().catch(() => ({}));
  const raw = (body as any)?.project_id;
  const projectId = raw === null ? null : Number(raw);
  if (projectId !== null && !(Number.isSafeInteger(projectId) && projectId > 0)) return c.json({ detail: 'project_id must be a venture id or null' }, 400);
  try {
    if (projectId !== null) await ensureProjectWriteAccess(c, projectId, user);
  } catch (e) { return asJsonError(c, e); }
  const row = await c.env.DB.prepare(
    "SELECT id, config_json FROM integrations WHERE provider_key = 'carta' AND user_id = ? LIMIT 1",
  ).bind(user.id).first<{ id: number; config_json: string | null }>();
  if (!row) return c.json({ detail: 'Carta is not connected to this account' }, 404);
  const cfg = safeJson<Record<string, unknown>>(row.config_json, {});
  if (cfg.audience === 'investor') return c.json({ detail: 'An investor Carta connection imports no cap table' }, 409);
  const before = cartaVenture(row.config_json);
  const next = { ...cfg, project_id: projectId };
  const hash = await actorHash(user as { email?: string | null });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE integrations SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify(next), row.id),
    ...['cap_table_holders', 'cap_table_securities', 'cap_table_option_pools', 'cap_table_vesting'].map((t) => c.env.DB.prepare(
      CARTA_RETAG[t as keyof typeof CARTA_RETAG],
    ).bind(projectId, user.id)),
    auditStatement(c.env, user, hash, projectId ?? before, 'cap_table_carta_venture_set', { from: before, to: projectId }),
  ]);
  return c.json({ ok: true, project_id: projectId });
});

/** Static statements: the table is chosen from this map, never spliced from input. `connector_carta` is CARTA_SOURCE. */
const CARTA_RETAG = {
  cap_table_holders: `UPDATE cap_table_holders SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND source = 'connector_carta'`,
  cap_table_securities: `UPDATE cap_table_securities SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND source = 'connector_carta'`,
  cap_table_option_pools: `UPDATE cap_table_option_pools SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND source = 'connector_carta'`,
  cap_table_vesting: `UPDATE cap_table_vesting SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND source = 'connector_carta'`,
} as const;

/** The venture a Carta connection's config names, or null. */
function cartaVenture(configJson: string | null | undefined): number | null {
  const v = Number(safeJson<Record<string, unknown>>(configJson, {}).project_id);
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * D1020 §5 — the recorded cap table of one venture as CSV. Read gate; a reader
 * who may not write gets no holder emails. One audit row, written before the
 * file is answered: no audit, no export.
 */
captable.get('/register/:projectId/export.csv', async (c) => {
  const user = await requireAuth(c) as AuthUser;
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return c.json({ detail: 'Invalid project_id' }, 400);
  let proj: ProjectRow;
  try { proj = await ventureFor(c, projectId, user); } catch (e) { return asJsonError(c, e); }
  const withEmail = canWriteProject(user, proj);
  const asOf = today();
  let csv: string;
  try {
    const register = await readRegister(c.env, { kind: 'venture', projectId });
    csv = registerCsv(register, asOf, withEmail);
    await auditStatement(c.env, user, await actorHash(user as { email?: string | null }), projectId, 'cap_table_register_exported', {
      format: 'csv', as_of: asOf, holders: register.holders.length, securities: register.securities.length, emails: withEmail,
    }).run();
  } catch (e) {
    return refuse(c, 500, { code: 'cap_register_export_failed', message: 'The cap table could not be exported. Nothing was downloaded; try again in a moment.', raw: e });
  }
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cap-table-${projectId}-${asOf}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

/**
 * D1020 §5 — a PDF snapshot of the recorded cap table, stamped "As of [date]",
 * added to the venture's data room under NDA and seen by nobody until the
 * founder shares it (`visibility = 'nda'`, `access_tier = 'nobody'`). Write
 * gate. The file row and its audit row are one batch; if either fails the
 * stored object is removed.
 */
captable.post('/register/:projectId/snapshot', async (c) => {
  const user = await requireAuth(c) as AuthUser;
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return c.json({ detail: 'Invalid project_id' }, 400);
  try { await ensureProjectWriteAccess(c, projectId, user); } catch (e) { return asJsonError(c, e); }
  if (!c.env.FILES) return c.json({ code: 'storage_not_configured', detail: 'The data room’s storage is not configured here.' }, 503);
  const venture = await c.env.DB.prepare('SELECT uid, name FROM projects WHERE id = ?').bind(projectId).first<{ uid: string | null; name: string | null }>();
  if (!venture?.uid) return c.json({ detail: 'This venture has no data room' }, 404);
  const asOf = today();
  let bytes: Uint8Array;
  let counts: { holders: number; securities: number };
  try {
    const register = await readRegister(c.env, { kind: 'venture', projectId });
    counts = { holders: register.holders.length, securities: register.securities.length };
    bytes = await snapshotPdf(venture.name || 'This venture', asOf, register);
  } catch (e) {
    return refuse(c, 500, { code: 'cap_register_read_failed', message: 'The recorded cap table could not be read, so no snapshot was made.', raw: e });
  }
  const uid = crypto.randomUUID().replace(/-/g, '');
  const key = `data-room/${venture.uid}/${uid}`;
  const name = `Cap table as of ${asOf}.pdf`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { project_uid: venture.uid, uploaded_by: String(user.id) } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO data_room_files (uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id,
           created_at, updated_at, access_tier)
         VALUES (?, ?, NULL, ?, ?, 'application/pdf', ?, 'nda', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'nobody')`,
      ).bind(uid, projectId, name, key, bytes.byteLength, user.id),
      auditStatement(c.env, user, await actorHash(user as { email?: string | null }), projectId, 'cap_table_snapshot_filed', {
        format: 'pdf', as_of: asOf, file_uid: uid, ...counts,
      }),
    ]);
  } catch (e) {
    await c.env.FILES.delete(key).catch(() => {});
    return refuse(c, 500, { code: 'cap_snapshot_not_filed', message: 'The snapshot could not be added to the data room. Nothing was filed; try again in a moment.', raw: e });
  }
  return c.json({ ok: true, file: { uid, name, as_of: asOf, visibility: 'nda', access_tier: 'nobody' } }, 201);
});

// Task #1 (AG) — spec-contract aliases. Read-only project-scoped views over
// the existing cap_table_holders / cap_table_securities tables. Founders see
// only their own project; admin/partner/investor see any.
captable.get('/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const proj = await loadProject(c, projectId, user);
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  if (!canReadProject(user, proj)) return c.json({ detail: 'Forbidden' }, 403);
  const holders = await c.env.DB.prepare(
    'SELECT * FROM cap_table_holders WHERE project_id = ? ORDER BY id ASC',
  ).bind(projectId).all();
  const securities = await c.env.DB.prepare(
    'SELECT * FROM cap_table_securities WHERE project_id = ? ORDER BY id ASC',
  ).bind(projectId).all();
  return c.json({
    project_id: projectId,
    holders: (holders.results || []).map((row: any) => {
      const out = { ...row };
      if (!canWriteProject(user, proj)) delete out.email;
      return out;
    }),
    securities: securities.results || [],
  });
});

export default captable;
