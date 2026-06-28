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

const captable = new Hono<{ Bindings: Env }>();

type ScenarioRow = {
  id: number; uid: string; owner_user_id: number; project_id: number | null;
  name: string; inputs_json: string; result_json: string | null;
  computed_at: string | null; created_at: string; updated_at: string;
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

class HttpError extends Error { constructor(public status: number, public body: any) { super(typeof body === 'string' ? body : 'http_error'); } }

function asJsonError(c: any, err: unknown) {
  if (err instanceof HttpError) {
    const body = typeof err.body === 'string' ? { detail: err.body } : err.body;
    return c.json(body, err.status);
  }
  throw err;
}

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
      'SELECT * FROM cap_table_scenarios WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1',
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
  await c.env.DB.prepare(
    `INSERT INTO cap_table_scenarios
       (uid, owner_user_id, project_id, name, inputs_json, result_json, computed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, user.id, projectId, name, JSON.stringify(inputs), JSON.stringify(result), now, now, now).run();
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
    'SELECT * FROM cap_table_scenarios WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1',
  ).bind(projectId).first<ScenarioRow>();
  return c.json({ scenario: row ? serialize(row) : null });
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
    const clash = await c.env.DB.prepare(
      'SELECT uid FROM cap_table_scenarios WHERE project_id = ? AND uid != ? LIMIT 1',
    ).bind(body.project_id, row.uid).first<{ uid: string }>();
    if (clash) {
      return c.json({ detail: { code: 'project_has_cap_table', message: 'This project already has a cap table. Edit that one instead.' } }, 409);
    }
  }
  const result = simulate(inputs);
  const now = new Date().toISOString();
  const projectId = body?.project_id !== undefined ? body.project_id : row.project_id;
  await c.env.DB.prepare(
    `UPDATE cap_table_scenarios
        SET name = ?, inputs_json = ?, result_json = ?, computed_at = ?,
            updated_at = ?, project_id = ?
      WHERE uid = ?`,
  ).bind(name, JSON.stringify(inputs), JSON.stringify(result), now, now, projectId, row.uid).run();
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
