/**
 * Phase 0.2 / Task #23 — Per-role onboarding wizards.
 *
 * Persists wizard step state per user so login can resume the right
 * step. Mirrors backend/app/api/routes/onboarding.py — same response
 * shapes so the frontend wizard works against either backend.
 *
 *   GET  /api/onboarding/progress
 *   PUT  /api/onboarding/progress   {flow, step, total_steps, data}
 *   POST /api/onboarding/complete   {flow}
 *   POST /api/onboarding/licence    {licence}  — Auth v2 licence picker (A2)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ensureExploringSchema, getSuggestedRole, upsertSuggestedRole } from '../services/exploringSchema';

const onboarding = new Hono<{ Bindings: Env }>();

const VALID_FLOWS = new Set(['founder', 'investor', 'partner']);
const VALID_LICENCES = new Set(['founder', 'investor', 'advisor', 'partner']);
const WIZARD_LICENCES = new Set(['founder', 'investor', 'partner']);

async function enforceFlowMatch(
  env: Env,
  user: any,
  flow: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // Server-side role-flow binding. Admins can write any flow (seeding,
  // impersonation); everyone else may only touch their own role's
  // wizard. Exploring users may run the wizard for their chosen licence
  // (stored as suggested_role) while membership is under review.
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin') return { ok: true };
  if (role === flow) return { ok: true };
  if (role === 'exploring') {
    const suggested = await getSuggestedRole(env, user.id);
    if (suggested === flow) return { ok: true };
  }
  return { ok: false, status: 403, error: 'flow does not match your role' };
}

async function ensureSchema(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS onboarding_progress (
         user_id INTEGER PRIMARY KEY,
         flow TEXT NOT NULL,
         step INTEGER NOT NULL DEFAULT 0,
         total_steps INTEGER NOT NULL DEFAULT 0,
         data TEXT,
         completed_at TEXT,
         created_at TEXT DEFAULT (datetime('now')),
         updated_at TEXT DEFAULT (datetime('now'))
       )`
    ).run();
  } catch (e: any) {
    console.error('onboarding_progress schema:', e?.message);
  }
}

function rowToDto(row: any) {
  if (!row) return { flow: null, step: 0, total_steps: 0, data: {}, completed_at: null };
  let data: any = {};
  if (row.data) {
    try { data = JSON.parse(row.data); } catch { data = {}; }
  }
  return {
    flow: row.flow,
    step: row.step || 0,
    total_steps: row.total_steps || 0,
    data,
    completed_at: row.completed_at || null,
  };
}

onboarding.get('/progress', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare(
    `SELECT flow, step, total_steps, data, completed_at FROM onboarding_progress WHERE user_id = ?`
  ).bind((user as any).id).first<any>();
  // Task #24 — admins are never subject to the onboarding chatbot. A
  // leftover incomplete flow='chat' row (e.g. account created as a partner,
  // then promoted) must not report as an active chat flow, or the SPA gate
  // would pin the admin to /onboarding/chat. Treat it as no active flow.
  const role = String((user as any).role || '').toLowerCase();
  if (role === 'admin' && row?.flow === 'chat' && !row.completed_at) {
    return c.json(rowToDto(null));
  }
  return c.json(rowToDto(row));
});

onboarding.put('/progress', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  if (!VALID_FLOWS.has(body.flow)) return c.json({ error: 'invalid flow' }, 400);
  const guard = await enforceFlowMatch(c.env, user, body.flow);
  if (!guard.ok) return c.json({ error: guard.error }, guard.status as any);
  const step = Math.max(0, Number(body.step) || 0);
  const totalSteps = Math.max(0, Number(body.total_steps) || 0);
  const dataJson = JSON.stringify(body.data || {});
  if (dataJson.length > 64_000) return c.json({ error: 'data too large' }, 400);

  await ensureSchema(c.env);
  // SQLite UPSERT
  await c.env.DB.prepare(
    `INSERT INTO onboarding_progress (user_id, flow, step, total_steps, data, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       flow=excluded.flow,
       step=excluded.step,
       total_steps=excluded.total_steps,
       data=excluded.data,
       updated_at=datetime('now')`
  ).bind((user as any).id, body.flow, step, totalSteps, dataJson).run();
  return c.json({ ok: true });
});

onboarding.post('/complete', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  if (!VALID_FLOWS.has(body.flow)) return c.json({ error: 'invalid flow' }, 400);
  const guardC = await enforceFlowMatch(c.env, user, body.flow);
  if (!guardC.ok) return c.json({ error: guardC.error }, guardC.status as any);
  await ensureSchema(c.env);
  // Either UPDATE the existing row or INSERT a stub if the user finished
  // without ever PUT'ing (defensive — frontend always PUTs).
  const existing = await c.env.DB.prepare(
    `SELECT user_id FROM onboarding_progress WHERE user_id = ?`
  ).bind((user as any).id).first<any>();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE onboarding_progress SET completed_at=datetime('now'), updated_at=datetime('now') WHERE user_id=?`
    ).bind((user as any).id).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at)
       VALUES (?, ?, 0, 0, datetime('now'))`
    ).bind((user as any).id, body.flow).run();
  }
  // Task #5 — flip users.assistant_enabled so the Dashboard surfaces the
  // pinned personal-assistant chat for first-time post-onboarding users.
  // Best-effort: column may not yet exist on a partially-migrated dev
  // DB, in which case we swallow and move on (assistant route's
  // ensureSchema will add it lazily on first use).
  try {
    await c.env.DB.prepare(
      `UPDATE users SET assistant_enabled = 1 WHERE id = ?`
    ).bind((user as any).id).run();
  } catch (e: any) {
    if (!/no such column/i.test(e?.message || '')) {
      console.warn('[onboarding] assistant_enabled flip skipped:', e?.message);
    }
  }

  // Project the founder's answers onto their real project record. Until this
  // existed, `onboarding_progress.data` was written on every step and read back
  // only by the wizard rehydrating itself — so the moment a founder finished,
  // their problem / solution / why-now went unreachable and the next surface
  // asked for them again as empty textareas.
  //
  // Deliberately after `completed_at` is stamped, and deliberately swallowing:
  // onboarding is finished either way, and no projection failure may strand a
  // founder in the wizard. `applyFounderOnboarding` already returns outcomes
  // instead of throwing; the catch is for the dynamic import itself.
  let projection: string | undefined;
  if (body.flow === 'founder') {
    try {
      const { applyFounderOnboarding } = await import('../services/onboardingProjection');
      const outcome = await applyFounderOnboarding(c.env, user as any);
      projection = outcome.status;
      if (outcome.status === 'error') {
        console.warn('[onboarding] project projection failed:', outcome.reason);
      }
    } catch (e: any) {
      console.warn('[onboarding] project projection unavailable:', e?.message);
    }
  }
  return c.json({ ok: true, completed_at: true, ...(projection ? { projection } : {}) });
});

// Auth & Onboarding v2 — licence picker (A2). Records the user's chosen
// licence as suggested_role and advances onboarding_progress out of the
// `licence` gate into the role wizard (or marks complete for advisor).
onboarding.post('/licence', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const licence = String(body.licence || '').toLowerCase();
  if (!VALID_LICENCES.has(licence)) return c.json({ error: 'invalid licence' }, 400);

  await ensureExploringSchema(c.env);
  await upsertSuggestedRole(c.env, user.id, licence);
  await ensureSchema(c.env);

  if (WIZARD_LICENCES.has(licence)) {
    await c.env.DB.prepare(
      `INSERT INTO onboarding_progress (user_id, flow, step, total_steps, data, completed_at, updated_at)
       VALUES (?, ?, 0, 0, '{}', NULL, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         flow = excluded.flow,
         step = 0,
         total_steps = 0,
         data = '{}',
         completed_at = NULL,
         updated_at = datetime('now')`
    ).bind(user.id, licence).run();
  } else {
    // Advisor — no dedicated wizard; licence step is complete.
    await c.env.DB.prepare(
      `INSERT INTO onboarding_progress (user_id, flow, step, total_steps, data, completed_at, updated_at)
       VALUES (?, 'advisor', 0, 0, '{}', datetime('now'), datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         flow = 'advisor',
         step = 0,
         total_steps = 0,
         completed_at = datetime('now'),
         updated_at = datetime('now')`
    ).bind(user.id).run();
  }

  return c.json({ ok: true, licence, suggested_role: licence });
});

export default onboarding;
