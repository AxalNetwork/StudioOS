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

export const mount: RouteMount = { path: '/api/admin/ai-agents/roster', router: r };
export default r;
