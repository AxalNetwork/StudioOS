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
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { simulate, validateInputs, toCsv, type Inputs, type SimulateResult } from '../services/captable';

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

async function ensureOwnerOr404(env: Env, uid: string, user: { id: number; role: string }): Promise<ScenarioRow> {
  const row = await loadByUid(env, uid);
  if (!row) throw new HttpError(404, 'Scenario not found');
  if (row.owner_user_id !== user.id && !isAdmin(user.role)) throw new HttpError(403, 'Not your scenario');
  return row;
}

async function ensureProjectAccess(env: Env, projectId: number | null | undefined, user: { id: number; role: string; founder_id?: number | null }) {
  if (projectId == null) return;
  const proj = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first<{ id: number; founder_id: number | null }>();
  if (!proj) throw new HttpError(404, 'Project not found');
  if (isAdmin(user.role)) return;
  if (proj.founder_id == null || proj.founder_id !== user.founder_id) {
    throw new HttpError(403, "You don't own that project");
  }
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
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name || name.length > 200) return c.json({ detail: 'name must be 1..200 chars' }, 400);
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  const projectId = body?.project_id ?? null;
  try { await ensureProjectAccess(c.env, projectId, user); }
  catch (e) { return asJsonError(c, e); }
  const result = simulate(inputs);
  const now = new Date().toISOString();
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

captable.get('/scenarios/:uid', async (c) => {
  const user = await requireAuth(c);
  try {
    const row = await ensureOwnerOr404(c.env, c.req.param('uid'), user);
    return c.json(serialize(row));
  } catch (e) { return asJsonError(c, e); }
});

captable.put('/scenarios/:uid', async (c) => {
  const user = await requireAuth(c);
  let row: ScenarioRow;
  try { row = await ensureOwnerOr404(c.env, c.req.param('uid'), user); }
  catch (e) { return asJsonError(c, e); }
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name || '').trim();
  if (!name || name.length > 200) return c.json({ detail: 'name must be 1..200 chars' }, 400);
  const inputs: Inputs = body?.inputs || {};
  const errs = validateInputs(inputs);
  if (errs.length) return c.json({ detail: { code: 'invalid_inputs', errors: errs } }, 400);
  if (body?.project_id !== undefined && body?.project_id !== null) {
    try { await ensureProjectAccess(c.env, body.project_id, user); }
    catch (e) { return asJsonError(c, e); }
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
  const user = await requireAuth(c);
  try { await ensureOwnerOr404(c.env, c.req.param('uid'), user); }
  catch (e) { return asJsonError(c, e); }
  await c.env.DB.prepare('DELETE FROM cap_table_scenarios WHERE uid = ?').bind(c.req.param('uid')).run();
  return c.json({ ok: true });
});

captable.get('/scenarios/:uid/export.csv', async (c) => {
  const user = await requireAuth(c);
  let row: ScenarioRow;
  try { row = await ensureOwnerOr404(c.env, c.req.param('uid'), user); }
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

export default captable;
