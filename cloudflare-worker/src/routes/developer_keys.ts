/**
 * D841 (#2464) — a member's own API keys (plan §3):
 *
 *   GET  /api/developer/keys              the caller's keys (never a secret), what they may grant
 *   POST /api/developer/keys              { name, scopes[], companies[], expires_in_days?, monthly_limit_microusd? }
 *                                          → 201 { key, secret }: the only response that carries a secret
 *   PATCH /api/developer/keys/:uid        { name?, monthly_limit_microusd? } → { key } (a live key's name or cap)
 *   POST /api/developer/keys/:uid/revoke  → { key }
 *   POST /api/developer/keys/:uid/rotate  → 201 { key, secret, replaced }
 *
 * Signed in with a session only (`requireAuth`): an `axk_` bearer is not a
 * session, so a key can never manage keys. A support session (impersonation)
 * cannot create, rotate or revoke. With API_KEYS_ENABLED anything but "true",
 * every route answers 404.
 *
 * Every write records an `activity_logs` line naming the key's uid, never its
 * secret or hash.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { logActorAct } from '../services/actorLog';
import { grantableCompanies } from '../mcp/grants';
import {
  KeyInputError, MAX_LIVE_KEYS, apiKeysEnabled, checkCreateInput, createKey, listKeys, liveKeyCount,
  looksLikeKey, revokeKey, rotateKey, viewOf, ownKey, scopeOptions, updateKey,
} from '../services/apiKeys';

type C = Context<{ Bindings: Env }>;
export const developerKeys = new Hono<{ Bindings: Env }>();

async function signedIn(c: C): Promise<User | Response> {
  if (!apiKeysEnabled(c.env)) return c.json({ detail: 'Not found' }, 404);
  const bearer = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (looksLikeKey(bearer)) return c.json({ detail: 'Sign in to manage API keys. A key cannot manage keys.', code: 'session_required' }, 401);
  try { return await requireAuth(c); } catch { return c.json({ detail: 'Unauthorized' }, 401); }
}

async function notSupport(c: C): Promise<Response | null> {
  if ((await selectJwt(c))?.payload.impersonated_by) return c.json({ detail: 'A support session cannot change API keys.' }, 403);
  return null;
}

async function names(c: C, user: User) {
  return new Map((await grantableCompanies(c.env, user)).map((p) => [p.id, p.name] as [number, string | null]));
}

developerKeys.get('/', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const companies = await grantableCompanies(c.env, user);
  const byId = new Map(companies.map((p) => [p.id, p.name] as [number, string | null]));
  const rows = await listKeys(c.env, user.id);
  return c.json({
    enabled: true,
    keys: rows.map((r) => viewOf(r, byId)),
    scopes_available: scopeOptions(),
    companies_available: companies,
    max_live_keys: MAX_LIVE_KEYS,
  });
});

developerKeys.post('/', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const refused = await notSupport(c); if (refused) return refused;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'Send the key as JSON.', code: 'invalid_body' }, 400);
  let spec;
  try { spec = await checkCreateInput(c.env, user, body); } catch (e) {
    if (e instanceof KeyInputError) return c.json({ detail: e.sentence, code: e.code }, 400);
    throw e;
  }
  if ((await liveKeyCount(c.env, user.id)) >= MAX_LIVE_KEYS) {
    return c.json({ detail: `You have ${MAX_LIVE_KEYS} live keys. Revoke one before creating another.`, code: 'too_many_keys' }, 409);
  }
  const { row, secret } = await createKey(c.env, user.id, spec);
  await logActorAct(c.env, user, 'api_key_created', { key_uid: row.uid, scopes: spec.scopes, companies: spec.companies });
  return c.json({ key: viewOf(row, spec.grantable), secret }, 201);
});

developerKeys.patch('/:uid', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const refused = await notSupport(c); if (refused) return refused;
  const uid = c.req.param('uid');
  if (!(await ownKey(c.env, user.id, uid))) return c.json({ detail: 'Not found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'Send the change as JSON.', code: 'invalid_body' }, 400);
  let row;
  try { row = await updateKey(c.env, user.id, uid, body); } catch (e) {
    if (e instanceof KeyInputError) return c.json({ detail: e.sentence, code: e.code }, 400);
    throw e;
  }
  if (!row) return c.json({ detail: 'Only a live key can be changed.', code: 'not_live' }, 409);
  await logActorAct(c.env, user, 'api_key_updated', { key_uid: row.uid });
  return c.json({ key: viewOf(row, await names(c, user)) });
});

developerKeys.post('/:uid/revoke', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const refused = await notSupport(c); if (refused) return refused;
  const uid = c.req.param('uid');
  if (!(await ownKey(c.env, user.id, uid))) return c.json({ detail: 'Not found' }, 404);
  const row = await revokeKey(c.env, user.id, uid);
  if (!row) return c.json({ detail: 'Not found' }, 404);
  await logActorAct(c.env, user, 'api_key_revoked', { key_uid: row.uid });
  return c.json({ key: viewOf(row, await names(c, user)) });
});

developerKeys.post('/:uid/rotate', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const refused = await notSupport(c); if (refused) return refused;
  const uid = c.req.param('uid');
  if (!(await ownKey(c.env, user.id, uid))) return c.json({ detail: 'Not found' }, 404);
  let out;
  try { out = await rotateKey(c.env, user, uid); } catch (e) {
    if (e instanceof KeyInputError) return c.json({ detail: e.sentence, code: e.code }, 400);
    throw e;
  }
  if (!out) return c.json({ detail: 'Only a live key can be rotated.', code: 'not_live' }, 409);
  await logActorAct(c.env, user, 'api_key_rotated', { key_uid: out.row.uid, replaced_uid: out.replaced.uid });
  const byId = await names(c, user);
  return c.json({ key: viewOf(out.row, byId), secret: out.secret, replaced: { uid: out.replaced.uid, revoked_at: out.replaced.revoked_at } }, 201);
});
