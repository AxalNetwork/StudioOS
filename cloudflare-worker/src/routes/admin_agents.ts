/**
 * #3851 (E7 of #3742, under D1528) — HQ's switches for the agent engine:
 * the platform halt and a scope's rebuild. Platform admins only.
 *
 *   GET  /api/admin/agents/halt              { halted, reason, by: { uid, name } | null, at }
 *   POST /api/admin/agents/halt              body { halted: boolean, reason? } → the same; 400 invalid_halt
 *   POST /api/admin/agents/rebuild/:scope    `project:<id>` or `company:<id>` → { ok, schedules, status }; 404 not_found
 *
 * THE HALT is the KV key `agents:halt` (`RATE_LIMITS`), which every run reads
 * at every step (`haltedAll`, `src/agents/runtime.ts`): set, a run ends at its
 * next step and nothing is admitted; cleared, admissions resume. The value is
 * `{ reason, by, at }` as JSON; an older plain-text value (the runtime's own
 * `halt('all', reason)`) reads as the reason with no author. HQ hears each
 * change (`services/agents/alerts.ts`). The runbook is
 * `documentation/operations/AGENT_RUNTIME_SWITCH.md`.
 *
 * THE REBUILD is the runbook's step 3: the scope's object (of the runtime in
 * force) forgets its cache and restores it from D1 alone. `schedules` is how
 * many duty timers it now holds.
 *
 * Mounted by the route registry (#4105). No email, no numeric user id.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { HALT_KEY, agentRuntime, type AgentRuntime } from '../agents/runtime';
import { scopeOf } from '../agents/doRuntime';
import { haltAlert } from '../services/agents/alerts';

export type HaltState = { halted: boolean; reason: string | null; by: { uid: string; name: string } | null; at: string | null };
export const REASON_MAX = 64;

/** The halt as stored. A value that is not our JSON is a reason with no author; an unreadable key reads as halted (the runtime's rule). */
export async function readHalt(env: Pick<Env, 'RATE_LIMITS'>): Promise<HaltState> {
  let raw: string | null;
  try { raw = await env.RATE_LIMITS.get(HALT_KEY); } catch { return { halted: true, reason: 'unreadable', by: null, at: null }; }
  if (!raw) return { halted: false, reason: null, by: null, at: null };
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const by = v.by && typeof v.by.uid === 'string' && typeof v.by.name === 'string' ? { uid: v.by.uid, name: v.by.name } : null;
      return { halted: true, reason: typeof v.reason === 'string' ? v.reason : null, by, at: typeof v.at === 'string' ? v.at : null };
    }
  } catch { /* plain text */ }
  return { halted: true, reason: raw.slice(0, REASON_MAX), by: null, at: null };
}

export type AdminAgentsDeps = { runtime: (env: Env) => Promise<AgentRuntime>; now: () => Date };
const DEFAULT_DEPS: AdminAgentsDeps = { runtime: agentRuntime, now: () => new Date() };
let deps: AdminAgentsDeps = DEFAULT_DEPS;
/** Tests only. */
export function __setAdminAgentsDeps(d: Partial<AdminAgentsDeps> | null) { deps = d ? { ...DEFAULT_DEPS, ...d } : DEFAULT_DEPS; }

const adminAgents = new Hono<{ Bindings: Env }>();

adminAgents.get('/halt', async (c) => {
  try {
    await requireAdmin(c);
    return c.json(await readHalt(c.env));
  } catch (e) { return mapError(c, e); }
});

adminAgents.post('/halt', async (c) => {
  try {
    const admin = await requireAdmin(c);
    let b: any = null;
    try { b = await c.req.json(); } catch { /* invalid below */ }
    const bad = () => refuse(c, 400, { code: 'invalid_halt', message: `Send halted (true or false) and, to halt, a reason of at most ${REASON_MAX} characters.` });
    if (!b || typeof b !== 'object' || typeof b.halted !== 'boolean') return bad();
    if (b.reason != null && (typeof b.reason !== 'string' || b.reason.trim().length > REASON_MAX)) return bad();
    const before = await readHalt(c.env);
    if (b.halted) {
      const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : 'halt';
      const at = deps.now().toISOString();
      await c.env.RATE_LIMITS.put(HALT_KEY, JSON.stringify({ reason, by: { uid: admin.uid, name: admin.name }, at }));
    } else {
      await c.env.RATE_LIMITS.delete(HALT_KEY);
    }
    const after = await readHalt(c.env);
    if (after.halted !== before.halted) {
      try { await haltAlert(c.env, after.halted, after.reason, admin.name); } catch { console.warn('[agents] halt_alert_failed'); }
    }
    return c.json(after);
  } catch (e) { return mapError(c, e); }
});

adminAgents.post('/rebuild/:scope', async (c) => {
  try {
    await requireAdmin(c);
    const ref = scopeOf(c.req.param('scope'));
    const missing = () => refuse(c, 404, { code: 'not_found', message: 'There is no such team.' });
    if (!ref) return missing();
    const row = ref.kind === 'project'
      ? await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(ref.id).first()
      : await c.env.DB.prepare('SELECT id FROM company_profiles WHERE id = ?').bind(ref.id).first();
    if (!row) return missing();
    const status = await (await deps.runtime(c.env)).rebuild(ref);
    return c.json({ ok: true, schedules: status.schedules.length, status });
  } catch (e) { return mapError(c, e); }
});

export default adminAgents;

export const mount: RouteMount = { path: '/api/admin/agents', router: adminAgents };
