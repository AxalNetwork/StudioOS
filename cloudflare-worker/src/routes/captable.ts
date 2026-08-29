/**
 * T12 — Cap-table simulator routes (port of backend/app/api/routes/captable.py).
 *
 * Mounted at /api/captable. Authenticated. Scenarios are owned by their
 * creator; admin can read all.
 *
 *   POST   /simulate                     — stateless run (no persist)
 *   GET    /scenarios                    — list mine (admin: all)
 *   POST   /scenarios                    — create + simulate + persist
 *   GET    /scenarios/{uid}              — read one
 *   PUT    /scenarios/{uid}              — update inputs + re-simulate
 *   DELETE /scenarios/{uid}              — delete
 *   GET    /scenarios/{uid}/export.csv   — 409A-friendly CSV export
 */
import { Hono } from 'hono';
import { ensureTier } from '../middleware/requireTier';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { simulate, validateInputs, toCsv, type Inputs, type SimulateResult } from '../services/captable';
import {
  canReadProject, canWriteProject, canReadScenario, canWriteScenario,
  type AccessUser,
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

/**
 * Build queue #120 — lazy bootstrap for the share tables. Canonical
 * record is migration 170; this self-heals a database that has the
 * deploy but not the migration yet, matching the pattern used by
 * ensureCapTableVariantColumn above. Cached per isolate.
 */
let _shareSchemaReady = false;
async function ensureCapTableShareSchema(env: Env): Promise<void> {
  if (_shareSchemaReady) return;
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
  _shareSchemaReady = true;
}

const captable = new Hono<{ Bindings: Env }>();

// Task #29 — guarantee cap_table_scenarios.is_variant exists before any handler
// queries it (prod migrations can lag behind the deploy). Cached after the
// first call per isolate, so this is a no-op on the warm path.
captable.use('*', async (c, next) => {
  await ensureCapTableVariantColumn(c.env);
  return next();
});

type ScenarioRow = {
  id: number; uid: string; owner_user_id: number; project_id: number | null;
  name: string; inputs_json: string; result_json: string | null;
  computed_at: string | null; created_at: string; updated_at: string;
  // Task #29 — 0 = canonical (project cap table), 1 = draft variant.
  is_variant: number | null;
};

function isAdmin(role: string): boolean { return (role || '').toLowerCase() === 'admin'; }

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

async function loadByUid(env: Env, uid: string): Promise<ScenarioRow | null> {
  return env.DB.prepare('SELECT * FROM cap_table_scenarios WHERE uid = ?')
    .bind(uid).first<ScenarioRow>();
}

type AuthUser = AccessUser & { id: number; role: string };

async function loadProject(env: Env, projectId: number): Promise<{ id: number; founder_id: number | null } | null> {
  return env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first<{ id: number; founder_id: number | null }>();
}

/** Read-gate a scenario by uid: owner / admin / (project-bound → project read). */
async function ensureScenarioReadOr404(env: Env, uid: string, user: AuthUser): Promise<ScenarioRow> {
  const row = await loadByUid(env, uid);
  if (!row) throw new HttpError(404, 'Scenario not found');
  const proj = row.project_id != null ? await loadProject(env, row.project_id) : null;
  if (!canReadScenario(user, row, proj)) throw new HttpError(403, 'Not your scenario');
  return row;
}

/** Write-gate a scenario by uid: owner / admin / (project-bound → project write). */
async function ensureScenarioWriteOr404(env: Env, uid: string, user: AuthUser): Promise<ScenarioRow> {
  const row = await loadByUid(env, uid);
  if (!row) throw new HttpError(404, 'Scenario not found');
  const proj = row.project_id != null ? await loadProject(env, row.project_id) : null;
  if (!canWriteScenario(user, row, proj)) throw new HttpError(403, 'Not your scenario');
  return row;
}

/** Attaching a cap table to a project requires project WRITE access. */
async function ensureProjectWriteAccess(env: Env, projectId: number | null | undefined, user: AuthUser) {
  if (projectId == null) return;
  const proj = await loadProject(env, projectId);
  if (!proj) throw new HttpError(404, 'Project not found');
  if (!canWriteProject(user, proj)) throw new HttpError(403, "You don't have access to that project");
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

/** D1/SQLite surfaces a unique-index violation as "UNIQUE constraint failed". */
function isUniqueViolation(err: unknown): boolean {
  return /unique constraint failed/i.test(String((err as any)?.message ?? err ?? ''));
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
 * Scoped by `user_id`, which is how both tables are keyed — there is no
 * project_id on either, so this is a per-account view and does not need the
 * tenancy module.
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
  const user = await requireAuth(c);
  const pools = await c.env.DB.prepare(
    `SELECT id, name, shares_authorized, shares_issued, shares_available, source, updated_at
       FROM cap_table_option_pools WHERE user_id = ? ORDER BY name`,
  ).bind(user.id).all<any>().catch(() => ({ results: [] as any[] }));
  const vesting = await c.env.DB.prepare(
    `SELECT id, holder_id, security_id, start_date, cliff_months, total_months,
            total_shares, vested_shares, source, updated_at
       FROM cap_table_vesting WHERE user_id = ? ORDER BY start_date DESC`,
  ).bind(user.id).all<any>().catch(() => ({ results: [] as any[] }));

  const poolRows = pools.results || [];
  const vestRows = vesting.results || [];
  const num = (v: any) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (num(r[k]) ?? 0), 0);

  const totalGranted = sum(vestRows, 'total_shares');
  const totalVested = sum(vestRows, 'vested_shares');

  return c.json({
    pools: poolRows.map((p) => ({
      id: p.id,
      name: p.name,
      shares_authorized: num(p.shares_authorized),
      shares_issued: num(p.shares_issued),
      shares_available: num(p.shares_available),
      source: p.source,
      as_of: p.updated_at,
    })),
    grants: vestRows.map((v) => ({
      id: v.id,
      holder_id: v.holder_id,
      security_id: v.security_id,
      start_date: v.start_date,
      cliff_months: num(v.cliff_months),
      total_months: num(v.total_months),
      total_shares: num(v.total_shares),
      vested_shares: num(v.vested_shares),
      source: v.source,
      as_of: v.updated_at,
    })),
    // Totals are sums of what is recorded, nothing modelled. Null when there
    // is nothing to sum, so the UI shows "Not recorded" rather than a
    // confident zero.
    summary: {
      pool_count: poolRows.length,
      grant_count: vestRows.length,
      shares_authorized: poolRows.length ? sum(poolRows, 'shares_authorized') : null,
      shares_issued: poolRows.length ? sum(poolRows, 'shares_issued') : null,
      shares_available: poolRows.length ? sum(poolRows, 'shares_available') : null,
      granted_shares: vestRows.length ? totalGranted : null,
      vested_shares: vestRows.length ? totalVested : null,
      unvested_shares: vestRows.length ? Math.max(0, totalGranted - totalVested) : null,
    },
  });
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
  const rows = isAdmin(user.role)
    ? await c.env.DB.prepare(
        'SELECT * FROM cap_table_scenarios ORDER BY updated_at DESC',
      ).all<ScenarioRow>()
    : await c.env.DB.prepare(
        'SELECT * FROM cap_table_scenarios WHERE owner_user_id = ? ORDER BY updated_at DESC',
      ).bind(user.id).all<ScenarioRow>();
  return c.json({ items: (rows.results || []).map((r) => serialize(r as any, false)) });
});

captable.post('/scenarios', async (c) => {
  // Task #6 — captable scenario writes are Growth-tier (read paths stay free).
  ensureTier(await requireAuth(c), 'growth');
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name || name.length > 200) return c.json({ detail: 'name must be 1..200 chars' }, 400);
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  const projectId = body?.project_id ?? null;
  try { await ensureProjectWriteAccess(c.env, projectId, user); }
  catch (e) { return asJsonError(c, e); }
  const result = simulate(inputs);
  const now = new Date().toISOString();

  // Task #28 — one cap table per project. When a project is provided and a
  // scenario already exists for it, UPDATE that row instead of inserting a
  // duplicate (guards against stale frontend state). Access to the existing
  // project's scenario is already gated by ensureProjectAccess above.
  if (projectId != null) {
    const existing = await c.env.DB.prepare(
      'SELECT * FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant,0) = 0 ORDER BY updated_at DESC LIMIT 1',
    ).bind(projectId).first<ScenarioRow>();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE cap_table_scenarios
            SET name = ?, inputs_json = ?, result_json = ?, computed_at = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(name, JSON.stringify(inputs), JSON.stringify(result), now, now, existing.id).run();
      const updated = await loadByUid(c.env, existing.uid);
      if (!updated) return c.json({ detail: 'Update failed' }, 500);
      return c.json(serialize(updated));
    }
  }

  const uid = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO cap_table_scenarios
         (uid, owner_user_id, project_id, name, inputs_json, result_json, computed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, user.id, projectId, name, JSON.stringify(inputs), JSON.stringify(result), now, now, now).run();
  } catch (e) {
    // Task #32 — DB-level "one canonical cap table per project" guard (partial
    // unique index). Two saves for the same project can race between the SELECT
    // above and this INSERT (double-click / two tabs / a retry); the index
    // rejects the second INSERT. Recover exactly like the upsert branch — load
    // the row the winner created and UPDATE it — so a lost race is a silent edit,
    // not a 500.
    if (projectId != null && isUniqueViolation(e)) {
      const winner = await c.env.DB.prepare(
        'SELECT * FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant,0) = 0 ORDER BY updated_at DESC LIMIT 1',
      ).bind(projectId).first<ScenarioRow>();
      if (winner) {
        await c.env.DB.prepare(
          `UPDATE cap_table_scenarios
              SET name = ?, inputs_json = ?, result_json = ?, computed_at = ?, updated_at = ?
            WHERE id = ?`,
        ).bind(name, JSON.stringify(inputs), JSON.stringify(result), now, now, winner.id).run();
        const merged = await loadByUid(c.env, winner.uid);
        if (merged) return c.json(serialize(merged));
      }
    }
    throw e;
  }
  const row = await loadByUid(c.env, uid);
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(serialize(row));
});

// Task #28 — load a project's single cap table (project-scoped, NOT owner-
// scoped) so partners/admins can open a founder's cap table from the dropdown.
// Returns { scenario: <serialized> | null }. Registered before /scenarios/:uid.
captable.get('/scenarios/by-project/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const proj = await loadProject(c.env, projectId);
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
// lookups AND the Demo Day deck. Gated by project WRITE access (Growth tier).
captable.post('/scenarios/by-project/:projectId/variants', async (c) => {
  ensureTier(await requireAuth(c), 'growth');
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  try { await ensureProjectWriteAccess(c.env, projectId, user); }
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
  const proj = await loadProject(c.env, projectId);
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
    const row = await ensureScenarioReadOr404(c.env, c.req.param('uid'), user);
    return c.json(serialize(row));
  } catch (e) { return asJsonError(c, e); }
});

captable.put('/scenarios/:uid', async (c) => {
  ensureTier(await requireAuth(c), 'growth');
  const user = await requireAuth(c);
  let row: ScenarioRow;
  try { row = await ensureScenarioWriteOr404(c.env, c.req.param('uid'), user); }
  catch (e) { return asJsonError(c, e); }
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name || name.length > 200) return c.json({ detail: 'name must be 1..200 chars' }, 400);
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  if (body?.project_id !== undefined && body?.project_id !== null) {
    try { await ensureProjectWriteAccess(c.env, body.project_id, user); }
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
  const result = simulate(inputs);
  const now = new Date().toISOString();
  const projectId = body?.project_id !== undefined ? body.project_id : row.project_id;
  try {
    await c.env.DB.prepare(
      `UPDATE cap_table_scenarios
          SET name = ?, inputs_json = ?, result_json = ?, computed_at = ?,
              updated_at = ?, project_id = ?
        WHERE uid = ?`,
    ).bind(name, JSON.stringify(inputs), JSON.stringify(result), now, now, projectId, row.uid).run();
  } catch (e) {
    // Task #32 — the DB partial unique index backstops the app-level clash check
    // above: if a concurrent save bound this project between that SELECT and
    // here, surface the same 409 instead of a 500.
    if (isUniqueViolation(e)) {
      return c.json({ detail: { code: 'project_has_cap_table', message: 'This project already has a cap table. Edit that one instead.' } }, 409);
    }
    throw e;
  }
  const fresh = await loadByUid(c.env, row.uid);
  return c.json(serialize(fresh as ScenarioRow));
});

captable.delete('/scenarios/:uid', async (c) => {
  ensureTier(await requireAuth(c), 'growth');
  const user = await requireAuth(c);
  try { await ensureScenarioWriteOr404(c.env, c.req.param('uid'), user); }
  catch (e) { return asJsonError(c, e); }
  await c.env.DB.prepare('DELETE FROM cap_table_scenarios WHERE uid = ?').bind(c.req.param('uid')).run();
  return c.json({ ok: true });
});

captable.get('/scenarios/:uid/export.csv', async (c) => {
  const user = await requireAuth(c);
  let row: ScenarioRow;
  try { row = await ensureScenarioReadOr404(c.env, c.req.param('uid'), user); }
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
  await ensureScenarioWriteOr404(c.env, uid, user);

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
  await ensureScenarioWriteOr404(c.env, uid, user);
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
  await ensureScenarioWriteOr404(c.env, tok.scenario_uid, user);
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

let valuation409aSchemaReady = false;
async function ensure409aSchema(env: Env): Promise<void> {
  if (valuation409aSchemaReady) return;
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
  valuation409aSchemaReady = true;
}

const TRIGGER_KINDS = new Set<TriggerKind>([
  'priced_round', 'material_change', 'secondary_transaction',
  'acquisition_discussion', 'financial_restatement',
]);
const VALUATION_METHODS = new Set([
  'income', 'market', 'asset', 'obm', 'backsolve', 'other',
]);

/** Read-gate a project the same way a project-bound scenario is read-gated. */
async function ensureProjectReadAccess(env: Env, projectId: number, user: AuthUser) {
  const proj = await loadProject(env, projectId);
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
    await ensureProjectReadAccess(c.env, projectId, user as AuthUser);
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
    await ensureProjectWriteAccess(c.env, projectId, user as AuthUser);
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
    await ensureProjectWriteAccess(c.env, projectId, user as AuthUser);
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
    await ensureProjectWriteAccess(c.env, projectId, user as AuthUser);
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
  const user = await requireAuth(c);
  const integration = await c.env.DB.prepare(
    "SELECT uid, status, last_synced_at, external_account_name, last_error FROM integrations WHERE provider_key = 'carta' AND user_id = ? ORDER BY id DESC LIMIT 1",
  ).bind(user.id).first<{ uid: string; status: string; last_synced_at: string | null; external_account_name: string | null; last_error: string | null }>();

  const holdersRes = await c.env.DB.prepare(
    'SELECT id, name, email, security_type, shares, ownership_pct, source, carta_stakeholder_id, carta_security_id, updated_at ' +
    'FROM cap_table_holders WHERE user_id = ? ORDER BY shares DESC, name ASC LIMIT 500',
  ).bind(user.id).all<{
    id: number; name: string; email: string | null; security_type: string | null;
    shares: number | null; ownership_pct: number | null; source: string;
    carta_stakeholder_id: string | null; carta_security_id: string | null; updated_at: string;
  }>();
  const securitiesRes = await c.env.DB.prepare(
    'SELECT id, name, share_class, shares_authorized, shares_issued, source, carta_id, updated_at ' +
    'FROM cap_table_securities WHERE user_id = ? ORDER BY name ASC LIMIT 200',
  ).bind(user.id).all<{
    id: number; name: string; share_class: string | null;
    shares_authorized: number | null; shares_issued: number | null;
    source: string; carta_id: string | null; updated_at: string;
  }>();

  const holders = holdersRes.results || [];
  const securities = securitiesRes.results || [];

  // Recompute ownership % off the live total so disconnected/manual rows
  // and Carta-sourced rows share the same denominator.
  const totalShares = holders.reduce((s, h) => s + (Number(h.shares) || 0), 0);
  const enriched = holders.map((h) => ({
    ...h,
    ownership_pct: totalShares > 0 ? ((Number(h.shares) || 0) / totalShares) * 100 : 0,
  }));

  return c.json({
    connected: !!integration && integration.status === 'active',
    integration_uid: integration?.uid || null,
    provider: 'carta',
    issuer_name: integration?.external_account_name || null,
    last_synced_at: integration?.last_synced_at || null,
    last_error: integration?.last_error || null,
    total_shares: totalShares,
    holders: enriched,
    securities,
  });
});

// Task #1 (AG) — spec-contract aliases. Read-only project-scoped views over
// the existing cap_table_holders / cap_table_securities tables. Founders see
// only their own project; admin/partner/investor see any.
captable.get('/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const proj = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first<{ id: number; founder_id: number | null }>();
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  if (user.role === 'founder' && user.founder_id !== proj.founder_id) {
    return c.json({ detail: 'Forbidden' }, 403);
  }
  const holders = await c.env.DB.prepare(
    'SELECT * FROM cap_table_holders WHERE project_id = ? ORDER BY id ASC',
  ).bind(projectId).all();
  const securities = await c.env.DB.prepare(
    'SELECT * FROM cap_table_securities WHERE project_id = ? ORDER BY id ASC',
  ).bind(projectId).all();
  return c.json({
    project_id: projectId,
    holders: holders.results || [],
    securities: securities.results || [],
  });
});

captable.put('/:projectId/holders', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const proj = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first<{ id: number; founder_id: number | null }>();
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  if (user.role === 'founder' && user.founder_id !== proj.founder_id) {
    return c.json({ detail: 'Forbidden' }, 403);
  }
  if (user.role !== 'admin' && user.role !== 'founder') {
    return c.json({ detail: 'Forbidden' }, 403);
  }
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const incoming = Array.isArray(body?.holders) ? body.holders as Array<Record<string, unknown>> : [];
  await c.env.DB.prepare('DELETE FROM cap_table_holders WHERE project_id = ?').bind(projectId).run();
  for (const h of incoming) {
    const name = String(h?.name || '').trim().slice(0, 200);
    if (!name) continue;
    const shares = h?.shares != null && Number.isFinite(Number(h.shares)) ? Number(h.shares) : 0;
    const kind = h?.kind ? String(h.kind).slice(0, 40) : 'common';
    await c.env.DB.prepare(
      `INSERT INTO cap_table_holders (project_id, name, shares, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(projectId, name, shares, kind).run();
  }
  return c.json({ ok: true, count: incoming.length });
});

export default captable;
