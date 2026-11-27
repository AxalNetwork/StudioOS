/**
 * D4158 (#4158, H1 of #4137) — HQ › AI agents › Roster, mounted at
 * `/api/admin/ai-agents/roster`. Super Admin only (`requireSuperAdmin`).
 *
 *   GET   /roster                 SA1: the 16 personas, each with status, team defaults and 30-day usage
 *   GET   /roster/:key            SA2: one persona, the teams using it, its most-used skills and its history
 *   PATCH /roster/:key            SA2/SA2b: status (offered | hidden | retired) and identity
 *                                 (name, tagline, story, goal, avatar); { reason, trademark_checked? }
 *   PUT   /roster/:key/defaults   SA2: { model, start_cap_usd, max_cap_usd, reason }
 *
 * D8080 (#8080) adds a second mount, `/api/admin/ai-agents/registry` (Super Admin only):
 *
 *   GET   /registry               the agent registry synced from agents/<name>.agent.yml: each name's current
 *                                 version, its live copies and the drift the last sync saw, plus the sync's
 *                                 commit and time. No sync yet answers `{ status: 'not_recorded' }`, never an
 *                                 empty catalogue.
 *
 * Every write takes a reason of at least 10 characters and writes one row to
 * H5's admin audit in the same batch. Values, risk and natural fit are never
 * writable (400 `values_fixed`). The rules live in
 * `services/agents/rosterAdmin.ts`; these handlers parse and answer. No
 * answer carries an email.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { modelRefusal } from '../services/aiRouter';
import { RosterRefusal, patchPersona, putDefaults, rosterList, rosterOne } from '../services/agents/rosterAdmin';

const r = new Hono<{ Bindings: Env }>();

const KEY = /^[a-z][a-z0-9_-]{0,39}$/;

async function body(c: Context<{ Bindings: Env }>): Promise<Record<string, unknown> | null> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : null;
  } catch { return null; }
}

function answer(c: Context<{ Bindings: Env }>, e: unknown) {
  if (e instanceof RosterRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  throw e;
}

const noSuch = (c: Context<{ Bindings: Env }>) => refuse(c, 404, { code: 'not_found', message: 'There is no such agent in the roster.' });

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  return c.json(await rosterList(c.env));
});

r.get('/:key', async (c) => {
  await requireSuperAdmin(c);
  const key = c.req.param('key');
  if (!KEY.test(key)) return noSuch(c);
  try { return c.json(await rosterOne(c.env, key)); } catch (e) { return answer(c, e); }
});

r.patch('/:key', async (c) => {
  const admin = await requireSuperAdmin(c);
  const key = c.req.param('key');
  if (!KEY.test(key)) return noSuch(c);
  const b = await body(c);
  if (!b) return refuse(c, 400, { code: 'invalid_body', message: 'Send what to change and why.' });
  try { return c.json(await patchPersona(c.env, admin, key, b)); } catch (e) { return answer(c, e); }
});

r.put('/:key/defaults', async (c) => {
  const admin = await requireSuperAdmin(c);
  const key = c.req.param('key');
  if (!KEY.test(key)) return noSuch(c);
  const b = await body(c);
  if (!b) return refuse(c, 400, { code: 'invalid_body', message: 'Send the model, both caps and why.' });
  try { return c.json(await putDefaults(c.env, admin, key, b, (id) => !modelRefusal(c.env, id))); } catch (e) { return answer(c, e); }
});

const registry = new Hono<{ Bindings: Env }>();

type RegistryRow = {
  name: string; version: string; stage: string | null; kind: string; owner: string; identity: string; runner_pool: string;
  status: string; manifest_sha: string; manifest_commit: string; capabilities_json: string; models_json: string;
  cost_profile: string | null; security_profile: string | null; synced_at: string;
};

registry.get('/', async (c) => {
  await requireSuperAdmin(c);
  const db = c.env.DB;
  const [rows, drift, copies] = await Promise.all([
    db.prepare(
      `SELECT name, version, stage, kind, owner, identity, runner_pool, status, manifest_sha, manifest_commit,
              capabilities_json, models_json, cost_profile, security_profile, synced_at
         FROM agent_registry WHERE superseded_at IS NULL ORDER BY name`,
    ).all<RegistryRow>(),
    db.prepare('SELECT name, field, manifest_value, runtime_value, agent_uid, seen_at FROM agent_registry_drift ORDER BY name, field, agent_uid')
      .all<{ name: string; field: string; manifest_value: string | null; runtime_value: string | null; agent_uid: string | null; seen_at: string }>(),
    db.prepare(
      `SELECT role_key AS name, COUNT(*) AS n FROM team_agents
        WHERE status != 'removed' AND role_key IN (SELECT name FROM agent_registry WHERE superseded_at IS NULL AND kind = 'venture')
        GROUP BY role_key`,
    ).all<{ name: string; n: number }>(),
  ]);
  const list = rows.results ?? [];
  if (!list.length) return c.json({ status: 'not_recorded', agents: [], synced_at: null, manifest_commit: null });
  const live = new Map((copies.results ?? []).map((r) => [r.name, Number(r.n)]));
  const driftBy = new Map<string, unknown[]>();
  for (const d of drift.results ?? []) driftBy.set(d.name, [...(driftBy.get(d.name) ?? []), d]);
  const latest = list.reduce((a, b) => (b.synced_at > a.synced_at ? b : a));
  return c.json({
    status: 'recorded',
    synced_at: latest.synced_at,
    manifest_commit: latest.manifest_commit,
    // #8071's budget tables are not on main: budgets are never compared, so a budget figure would be invented.
    budgets_compared: false,
    agents: list.map((a) => {
      const venture = a.kind === 'venture';
      const d = driftBy.get(a.name) ?? [];
      return {
        ...a, capabilities: JSON.parse(a.capabilities_json) as string[], models: JSON.parse(a.models_json) as string[],
        capabilities_json: undefined, models_json: undefined,
        // A platform agent has no D1 copy: its copies and drift are not recorded, never zero.
        live_copies: venture ? live.get(a.name) ?? 0 : null,
        drift: venture ? d : null,
        drift_count: venture ? d.length : null,
        last_run: null,
      };
    }),
  });
});

export const mount: RouteMount[] = [
  { path: '/api/admin/ai-agents/roster', router: r },
  { path: '/api/admin/ai-agents/registry', router: registry },
];
export default r;
