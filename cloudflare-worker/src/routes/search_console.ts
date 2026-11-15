/**
 * D5839 (#5839) — the Search Console property a venture reads.
 *
 *   GET    /api/search-console/properties?project=   the venture's binding and, for a writer
 *                                                    with their own connection, the properties
 *                                                    Google lists for them
 *   PUT    /api/search-console/property              { project, site_url | null } bind, change or unbind
 *   POST   /api/search-console/property/check        { project } re-verify the binding's access now
 *
 * One property per venture, through one member's own `google_search_console`
 * connection, switched on for the venture's company. A binding another
 * member's connection holds is never replaced. A property is bound only after
 * `sites.get` on its exact identifier reports a usable permission level for
 * the signed-in principal; the check repeats that and marks the selection `denied` (D5840's state)
 * when Google no longer grants it. The browser receives the capability, the
 * status and the chosen property's identifier and level: never a token.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { isSupportSession } from '../services/companyAccess';
import { projectEnabled } from '../integrations/companyScope';
import type { IntegrationRow } from '../integrations/registry';
import { SEARCH_CONSOLE_KEY, searchConsoleAccessToken } from '../integrations/providers/google_search_console';
import {
  SearchConsoleError, getSearchConsoleSite, isPropertyId, listSearchConsoleSites, type SearchConsoleSite,
} from '../integrations/searchConsoleOAuth';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

/** Each refusal's sentence, written here: never Google's text. */
export const SEARCH_CONSOLE_REFUSALS: Record<string, string> = {
  project_required: 'Choose a venture first.',
  project_not_found: 'That venture was not found.',
  forbidden: 'You cannot see this venture.',
  read_only: 'You can read this venture but not change it.',
  support_session_refused: 'A support session cannot read or change a member’s Search Console.',
  not_connected: 'Search Console is not connected. Sign in with Google on the Search Console connector page first.',
  company_not_enabled: 'Your Search Console is not switched on for this venture’s company. Switch it on on the connector page.',
  venture_served: 'A teammate’s Search Console already serves this venture. They can unbind it.',
  property_malformed: 'That is not a Search Console property. Choose one from the list.',
  property_not_accessible: 'Your Google account cannot see that property. Choose one from the list.',
  property_unusable: 'Your Google account is not a verified user of that property. Ask its owner to add you, or choose another.',
  property_mismatch: 'Google answered for a different property. Nothing was bound; try again.',
  not_bound: 'Choose a Search Console property for this venture first.',
  not_your_binding: 'Only the member whose Search Console serves this venture can do this.',
  sign_in_again: 'Google asked you to sign in to Search Console again.',
  search_console_busy: 'Search Console is refreshing this connection. Try again in a moment.',
  search_console_unreadable: 'Search Console could not be read. Nothing changed; try again.',
};

class Refused extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** Google's answers, as a refusal the browser reads. Lost access is the caller's to decide on. */
function refusalOf(e: SearchConsoleError): Refused {
  switch (e.code) {
    case 'search_console_grant_revoked':
    case 'search_console_grant_changed':
    case 'search_console_connection_unreadable':
      return new Refused(409, 'sign_in_again');
    case 'search_console_not_connected': return new Refused(409, 'not_connected');
    case 'search_console_refresh_busy': return new Refused(503, 'search_console_busy');
    case 'property_not_accessible': return new Refused(409, 'property_not_accessible');
    case 'property_malformed': return new Refused(400, 'property_malformed');
    case 'property_mismatch': return new Refused(502, 'property_mismatch');
    default: return new Refused(502, 'search_console_unreadable');
  }
}

const handle = (fn: (c: C, user: User) => Promise<Response>) => async (c: C) => {
  try {
    const user = await requireAuth(c);
    if (await isSupportSession(c)) throw new Refused(403, 'support_session_refused');
    return await fn(c, user);
  } catch (e) {
    const refused = e instanceof Refused ? e : e instanceof SearchConsoleError ? refusalOf(e) : null;
    if (!refused) throw e;
    if (refused.code === 'sign_in_again' || refused.code === 'search_console_unreadable') {
      console.warn('[search_console] google refused', { outcome: (e as Error).message });
    }
    return c.json({ error: refused.code, detail: SEARCH_CONSOLE_REFUSALS[refused.code] }, refused.status as 400);
  }
};

async function body(c: C): Promise<Record<string, unknown>> {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {};
}

/** The venture and whether the caller may change it. */
async function ventureOf(c: C, user: User, raw: unknown): Promise<{ id: number; writer: boolean }> {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Refused(400, 'project_required');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new Refused(404, 'project_not_found');
  if (!(await canAccessProject(c.env, user, p, { write: false }))) throw new Refused(403, 'forbidden');
  return { id: p.id, writer: await canAccessProject(c.env, user, p, { write: true }) };
}

/** The caller's own active Search Console connection, or null. */
function ownConnection(c: C, user: User): Promise<IntegrationRow | null> {
  return c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' AND auth_type = 'oauth2' LIMIT 1")
    .bind(user.id, SEARCH_CONSOLE_KEY).first<IntegrationRow>();
}

/**
 * The venture's selection, in D5840's `search_console_selections`: the one table the sync reads
 * (`services/searchConsoleSync.ts`). The member who bound it (`user_id`) is whose grant the sync uses.
 */
interface Binding {
  owner_id: number; owner_name: string | null; site_url: string;
  property_kind: 'domain' | 'url_prefix'; permission_level: string | null; access_state: 'ok' | 'denied' | 'revoked'; checked_at: string;
}

function bindingOf(env: Env, projectId: number): Promise<Binding | null> {
  return env.DB.prepare(
    `SELECT b.user_id AS owner_id, COALESCE(u.display_name, u.name) AS owner_name, b.site_url,
            b.property_kind, b.permission_level, b.access_state, b.updated_at AS checked_at
       FROM search_console_selections b LEFT JOIN users u ON u.id = b.user_id
      WHERE b.project_id = ?`,
  ).bind(projectId).first<Binding>();
}

const kindOf = (siteUrl: string): 'domain' | 'url_prefix' => siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix';
const choiceOf = (s: SearchConsoleSite) => ({ ...s, property_kind: kindOf(s.site_url) });
const publicBinding = (b: Binding) => ({
  site_url: b.site_url, property_kind: b.property_kind, permission_level: b.permission_level,
  access_state: b.access_state, checked_at: b.checked_at,
});

async function logBinding(env: Env, userId: number, action: string, projectId: number, kind: string | null) {
  try {
    await env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, actor, action, details) VALUES (?, ?, ?, ?, ?)')
      .bind(projectId, userId, String(userId), action, JSON.stringify({ provider_key: SEARCH_CONSOLE_KEY, property_kind: kind })).run();
  } catch { console.warn('[search_console] activity log failed'); }
}

r.get('/properties', handle(async (c, user) => {
  const venture = await ventureOf(c, user, c.req.query('project'));
  const binding = await bindingOf(c.env, venture.id);
  const row = await ownConnection(c, user);
  const enabled = !!row && await projectEnabled(c.env, Number(row.id), venture.id);
  const own = !!binding && !!row && binding.owner_id === Number(user.id);
  let choices: ReturnType<typeof choiceOf>[] | null = null;
  let choicesError: string | null = null;
  if (venture.writer && row && enabled) {
    try { choices = (await listSearchConsoleSites(await searchConsoleAccessToken(c.env, row))).map(choiceOf); }
    catch (e) {
      if (!(e instanceof SearchConsoleError)) throw e;
      choicesError = refusalOf(e).code;
      console.warn('[search_console] properties unreadable', { outcome: e.code });
    }
  }
  return c.json({
    ok: true, project_id: venture.id,
    capability: {
      connected: !!row,
      company_enabled: enabled,
      can_bind: venture.writer && enabled && (!binding || own),
    },
    binding: binding ? { ...publicBinding(binding), own } : null,
    served_by: binding && !own ? { name: binding.owner_name } : null,
    choices,
    choices_error: choicesError ? { code: choicesError, detail: SEARCH_CONSOLE_REFUSALS[choicesError] } : null,
  });
}));

/** The writer's own connection, switched on for the venture's company. */
async function writerConnection(c: C, user: User, raw: unknown) {
  const venture = await ventureOf(c, user, raw);
  if (!venture.writer) throw new Refused(403, 'read_only');
  const row = await ownConnection(c, user);
  if (!row) throw new Refused(409, 'not_connected');
  if (!(await projectEnabled(c.env, Number(row.id), venture.id))) throw new Refused(409, 'company_not_enabled');
  return { venture, row };
}

r.put('/property', handle(async (c, user) => {
  const b = await body(c);
  const { venture, row } = await writerConnection(c, user, b.project);
  const existing = await bindingOf(c.env, venture.id);
  if (existing && existing.owner_id !== Number(user.id)) throw new Refused(409, 'venture_served');
  if (b.site_url === null) {
    const del = await c.env.DB.prepare('DELETE FROM search_console_selections WHERE project_id = ? AND user_id = ?').bind(venture.id, user.id).run();
    if (Number(del.meta?.changes ?? 0) > 0) await logBinding(c.env, Number(user.id), 'search_console_property_unbound', venture.id, existing?.property_kind ?? null);
    return c.json({ ok: true, binding: null });
  }
  if (!isPropertyId(b.site_url)) throw new Refused(400, 'property_malformed');
  // Verified at selection, on the exact identifier: a listed name alone is not proof of access.
  const site = await getSearchConsoleSite(await searchConsoleAccessToken(c.env, row), b.site_url);
  if (!site.usable) throw new Refused(409, 'property_unusable');
  const kind = kindOf(site.site_url);
  const write = await c.env.DB.prepare(
    `INSERT INTO search_console_selections (project_id, user_id, site_url, property_kind, permission_level)
       VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       site_url = excluded.site_url, property_kind = excluded.property_kind, permission_level = excluded.permission_level,
       access_state = 'ok', selected_at = datetime('now'), updated_at = datetime('now')
     WHERE search_console_selections.user_id = excluded.user_id`,
  ).bind(venture.id, user.id, site.site_url, kind, site.permission_level).run();
  // A teammate bound it between the read above and this write.
  if (Number(write.meta?.changes ?? 0) === 0) throw new Refused(409, 'venture_served');
  await logBinding(c.env, Number(user.id), existing ? 'search_console_property_changed' : 'search_console_property_bound', venture.id, kind);
  const bound = await bindingOf(c.env, venture.id);
  return c.json({ ok: true, binding: bound ? { ...publicBinding(bound), own: true } : null });
}));

r.post('/property/check', handle(async (c, user) => {
  const b = await body(c);
  const { venture, row } = await writerConnection(c, user, b.project);
  const binding = await bindingOf(c.env, venture.id);
  if (!binding) throw new Refused(409, 'not_bound');
  if (binding.owner_id !== Number(user.id)) throw new Refused(403, 'not_your_binding');
  let level: string | null = null;
  try {
    const site = await getSearchConsoleSite(await searchConsoleAccessToken(c.env, row), binding.site_url);
    level = site.usable ? site.permission_level : null;
  } catch (e) {
    if (!(e instanceof SearchConsoleError) || e.code !== 'property_not_accessible') throw e;
  }
  if (level) {
    await c.env.DB.prepare("UPDATE search_console_selections SET permission_level = ?, access_state = 'ok', updated_at = datetime('now') WHERE project_id = ? AND user_id = ?")
      .bind(level, venture.id, user.id).run();
  } else {
    // The binding stays, marked: the founder decides whether to choose another or ask for access back.
    // `denied` is D5840's state for a property the grant no longer reaches; the sync lands nothing for it.
    await c.env.DB.prepare("UPDATE search_console_selections SET access_state = 'denied', updated_at = datetime('now') WHERE project_id = ? AND user_id = ?")
      .bind(venture.id, user.id).run();
    if (binding.access_state !== 'denied') await logBinding(c.env, Number(user.id), 'search_console_property_access_lost', venture.id, binding.property_kind);
  }
  const now = await bindingOf(c.env, venture.id);
  return c.json({ ok: true, binding: now ? { ...publicBinding(now), own: true } : null });
}));

export const mount: RouteMount = { path: '/api/search-console', router: r };
export default r;
