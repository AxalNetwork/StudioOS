/**
 * Task #1 — Integrations foundation router.
 *
 * Replaces the previous 501-stub surface with a full implementation that
 * eight downstream provider tasks (#2..#9) plug into. Provider-agnostic
 * concerns live here:
 *   - registry & marketplace catalogue (`/available`)
 *   - per-user connection list, connect, disconnect, sync, push (`/`)
 *   - inbound webhook receiver (`/webhook/:provider/:uid`)
 *   - waitlist for coming-soon providers (`/waitlist`)
 *   - per-connection log feed (`/:uid/logs`)
 *
 * Tier gating: founders are gated by `subscription_tier`; admin/partner/
 * investor/advisor roles bypass via middleware/requireTier.ts.
 *
 * Credentials are encrypted at rest via integrations/secrets.ts (built on
 * services/columnCipher.ts). NEVER write a raw api_key/access_token/
 * refresh_token into D1.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { ensureTier, userMeetsTier, tierUpsell } from '../middleware/requireTier';
import { hashEmail } from '../util/hashEmail';
import {
  REGISTRY,
  publicDescriptor,
  ensureIntegrationsSchema,
  getDescriptor,
  getProviderImpl,
  readinessOf,
  pageDescriptor,
  CATEGORY_ORDER,
  FIRST_PARTY_CARDS,
  directoryKeyFor,
  type PageDescriptor,
  type IntegrationRow,
  audienceFor,
  personalHqOnlyOffHq,
  personalHqOnlySentence,
  ConnectRefusal,
  type ProviderDescriptor,
} from '../integrations/registry';
import { branchOf } from '../util/branch';
import {
  encryptCredentials,
  decryptCredentials,
  encryptWebhookSecret,
  decryptWebhookSecret,
  previewApiKey,
  type CredentialBlob,
} from '../integrations/secrets';
import { buildPkce, issueOauthState, consumeOauthState } from '../integrations/oauth';
import { refuse } from '../util/refusal';
import { MANAGED_PROVIDERS, PROVIDER_ENV_VARS, type ManagedProviderKey } from '../services/providerOauthKeys';
import { activeCompanyFor } from '../middleware/activeCompany';
import { companyEnabled, enabledCompanyIds, projectEnabled, writesProjectData } from '../integrations/companyScope';
import { hasScopeOverreach, validateConnectorSettings } from '../integrations/connectorRules';
import { fedCounts } from '../integrations/fed';
import { accessToken, accessibleRepositories, checkChoice, grantedPermissions, readProgress } from '../integrations/providers/github';

const integrations = new Hono<{ Bindings: Env }>();

const ALLOWED_ROLES = new Set(['admin', 'founder', 'partner', 'investor', 'advisor', 'operator', 'service_provider']);

export function ensureRole(c: Context<{ Bindings: Env }>, user: User) {
  if (!ALLOWED_ROLES.has((user.role || '').toLowerCase())) {
    throw new Response(JSON.stringify({ error: 'forbidden', message: 'Your role cannot manage integrations.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * D710 (#1775): how this caller may see a provider. A provider with no
 * audience fields is `open`, as before. Mercury is an `entity` connection for
 * an admin on HQ, `personal` for a founder or partner on either host and an
 * investor on HQ (D713, D752), and `none` for everyone else, who is answered
 * as if the key did not exist. An investor off HQ is `none` too, but
 * `/connect` tells them it is HQ only (403 `purpose_not_allowed`, D752).
 */
function audienceOf(c: Context<{ Bindings: Env }>, user: User, desc: ProviderDescriptor) {
  return audienceFor(desc, { role: String(user.role || ''), hq: branchOf(c.env) === null });
}

function safeJson<T>(s: string | null | undefined, def: T): T {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
}

function newUid(): string {
  // 16-byte random hex; collision-resistant across all users without DB lookup.
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function logEvent(
  env: Env,
  opts: {
    integration_id: number;
    user_id: number;
    provider_key: string;
    direction: 'inbound' | 'outbound' | 'internal';
    event_type: string;
    status: 'ok' | 'error';
    http_status?: number;
    request_summary?: string;
    response_summary?: string;
    external_id?: string | null;
    payload?: unknown;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, http_status, request_summary, response_summary, external_id, payload_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      opts.integration_id,
      opts.user_id,
      opts.provider_key,
      opts.direction,
      opts.event_type,
      opts.status,
      opts.http_status ?? null,
      (opts.request_summary ?? '').slice(0, 1000),
      (opts.response_summary ?? '').slice(0, 1000),
      opts.external_id ?? null,
      opts.payload === undefined ? null : JSON.stringify(redactPayload(opts.payload)).slice(0, 4000),
    ).run();
  } catch (e) {
    // Logging failures must never abort the request itself.
    console.warn('[integrations] logEvent failed:', (e as Error).message);
  }
}

async function loadRow(env: Env, uid: string, userId: number): Promise<IntegrationRow | null> {
  const row = await env.DB.prepare('SELECT * FROM integrations WHERE uid = ? AND user_id = ?')
    .bind(uid, userId).first<IntegrationRow>();
  return row || null;
}

// ─────────────────────────────────────────────── D753 W2 (#1878): connector pages

/**
 * The ten page fields every catalogue item carries (D753 W2 decision 2), each
 * picked by name from `pageDescriptor`, never spread, so a field the page data
 * gains later stays private until it is named here. `verified` is the page's
 * record: a recorded live connect (D753 decision 7).
 */
function pageFields(page: PageDescriptor) {
  return {
    tagline: page.tagline,
    made_by: { name: page.made_by.name },
    service: { name: page.service.name, href: page.service.href },
    sign_in: { kind: page.sign_in.kind, label: page.sign_in.label, key_help_href: page.sign_in.key_help_href },
    added: page.added,
    verified: page.verified_on !== null,
    verified_on: page.verified_on,
    read_only: page.trust.read_only,
    page_key: page.page_key,
    page_href: page.page_href,
  };
}

/**
 * The page body only `GET /directory/:key` serves (decision 4). Tools,
 * prompts and the trust notice are rebuilt key by key: a tool's `calls` are
 * source fragments the guard test checks, never published.
 */
function pageBody(page: PageDescriptor) {
  return {
    long_description: [...page.long_description],
    tools: page.tools.map((t) => ({ name: t.name, label: t.label, access: t.access, what: t.what, lands_in: t.lands_in })),
    prompts: page.prompts.map((x) => ({ name: x.name, ask: x.ask, proposes: x.proposes })),
    prompts_reason: page.prompts_reason,
    links: { help: page.links.help, developer_docs: page.links.developer_docs, support: page.links.support, privacy: page.links.privacy },
    endpoints: { sign_in: page.endpoints.sign_in, api: page.endpoints.api },
    trust: {
      built_by: page.trust.built_by, reads: [...page.trust.reads], writes: [...page.trust.writes],
      read_only: page.trust.read_only, moves_money: page.trust.moves_money, sentence: page.trust.sentence,
    },
  };
}

type Viewer = { role: string; hq: boolean };

/**
 * One catalogue entry, for `/available` and for the page read alike (decision
 * 1): the public descriptor, the spec-named fields, D751's readiness, then the
 * page fields, written last. No `already_connected`: that is the viewer's
 * connection, which only `/available` reads.
 */
async function catalogueEntry(c: Context<{ Bindings: Env }>, user: User, p: ProviderDescriptor, viewer: Viewer) {
  const lockedForUser = p.tier === 'free' ? false : !userMeetsTier(user, p.tier as 'growth' | 'studio');
  // D751: whether Axal holds each OAuth connector's client; no field where it means nothing.
  const r = await readinessOf(c.env, p);
  const page = pageDescriptor(p, viewer);
  if (!page) console.warn('[connectors] page_entry_missing', p.key);
  return {
    ...publicDescriptor(p, viewer),
    // Spec-named fields (Task #8 / AN). Existing fields kept as
    // back-compat aliases so the frontend keeps rendering during the
    // FE migration window.
    provider_name: p.key,
    required_tier: p.tier,
    icon_key: p.icon ?? null,
    locked_for_user: lockedForUser,
    // Legacy aliases — DO NOT remove until FE consumers migrate.
    tier_locked: lockedForUser,
    ...(r === undefined ? {} : { configured: r }),
    ...(page ? pageFields(page) : {}),
  };
}

/** LinkedIn's card: its facts (`FIRST_PARTY_CARDS`) and its page fields. Never in `items`. */
function linkedinCard(viewer: Viewer) {
  const page = pageDescriptor({ key: 'linkedin' }, viewer);
  return { ...FIRST_PARTY_CARDS.linkedin, ...(page ? pageFields(page) : {}) };
}

function rowToPublic(row: IntegrationRow, credPreview: string | null, companyIds: number[] = []) {
  const desc = getDescriptor(row.provider_key);
  return {
    uid: row.uid,
    provider_key: row.provider_key,
    integration_type: desc?.integration_type ?? 'custom',
    display_name: row.display_name || desc?.display_name || row.provider_key,
    status: row.status,
    auth_type: row.auth_type,
    capabilities: safeJson<string[]>(row.capabilities_json, desc?.capabilities ?? []),
    scopes: safeJson<string[]>(row.scopes_json, []),
    config: safeJson<Record<string, unknown>>(row.config_json, {}),
    external_account_id: row.external_account_id,
    external_account_name: row.external_account_name,
    api_key_preview: credPreview,
    has_webhook_secret: !!row.webhook_secret_enc,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    last_error_at: row.last_error_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    company_ids: companyIds,
  };
}

// ───────────────────────────────────────────────────────────────────── catalogue

/**
 * GET /api/integrations/available
 * Returns the full registry plus, for the calling user, which providers are
 * tier-locked. The frontend uses this to render the three-section page
 * (Connected / Available / Coming Soon) and the tier pills.
 */
// ───────────────────────────────────────────────────────────── public lookup
// Task #3 — read-only Calendly booking URL lookup for any user. No auth:
// Calendly scheduling URLs are inherently public (the user generates them
// for sharing). Returns 404 if the user hasn't connected Calendly or hasn't
// configured a `booking_url`. Used by Advisor cards + Partner profile pages
// to render a "Book via Calendly" CTA that opens their availability page.
integrations.get('/public/calendly/:userId', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const userId = parseInt(c.req.param('userId'), 10);
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'invalid_user' }, 400);
  const row = await c.env.DB.prepare(
    "SELECT config_json FROM integrations WHERE user_id = ? AND provider_key = 'calendly' AND status = 'active'",
  ).bind(userId).first<{ config_json: string | null }>();
  if (!row) return c.json({ error: 'not_connected' }, 404);
  let cfg: Record<string, unknown> = {};
  try { cfg = row.config_json ? JSON.parse(row.config_json) : {}; } catch { cfg = {}; }
  const url = (cfg.default_event_type_uri as string) || (cfg.booking_url as string) || (cfg.scheduling_url as string) || '';
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: 'no_booking_url' }, 404);
  return c.json({
    booking_url: url,
    event_type_name: (cfg.default_event_type_name as string) || null,
  });
});

integrations.get('/available', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  // Compute already_connected from the caller's existing integrations.
  // Defensive — a stale/missing `integrations` table must not collapse
  // the marketplace into a 500. Empty set just means nothing is shown
  // as "Update" instead of "Connect" until the table is ready.
  let connectedSet = new Set<string>();
  let connectionsReadable = true;
  const unreadableSources: string[] = [];
  try {
    const rows = await c.env.DB.prepare(
      "SELECT provider_key FROM integrations WHERE user_id = ? AND status = 'active'",
    ).bind(user.id).all<{ provider_key: string }>();
    connectedSet = new Set((rows.results || []).map(r => r.provider_key));
  } catch (e) {
    connectionsReadable = false;
    const msg = (e as Error).message || 'select_failed';
    console.warn('[integrations] /available connectedSet lookup failed:', msg);
    // Best-effort log to integration_logs so ops can see the read-path
    // degradation. Mirrors the listMine recovery path.
    try {
      await c.env.DB.prepare(
        'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary) ' +
        "VALUES (0, ?, '_system', 'internal', 'available_lookup_failed', 'error', ?)",
      ).bind(user.id, msg.slice(0, 500)).run();
    } catch { /* logs table may not exist either */ }
  }
  try {
    // These are calendar.ts's existing tokens; no duplicate connector row.
    if (await c.env.DB.prepare('SELECT 1 AS connected FROM google_oauth_tokens WHERE user_id = ?').bind(user.id).first()) connectedSet.add('google_calendar');
  } catch { unreadableSources.push('google_calendar'); }
  try {
    if (await c.env.DB.prepare('SELECT 1 AS connected FROM microsoft_oauth_tokens WHERE user_id = ?').bind(user.id).first()) connectedSet.add('microsoft_365');
  } catch { unreadableSources.push('microsoft_365'); }
  const viewer = { role: String(user.role || ''), hq: branchOf(c.env) === null };
  const listed = REGISTRY.filter(p => audienceOf(c, user, p) !== 'none');
  const providers = await Promise.all(listed.map(async (p) => {
    const entityOnly = audienceOf(c, user, p) === 'entity';
    return {
      ...(await catalogueEntry(c, user, p, viewer)),
      // An entity connection is read from its own store, never the caller's rows.
      already_connected: entityOnly ? false : p.key === 'google_calendar' || p.key === 'microsoft_365'
        ? unreadableSources.includes(p.key) ? null : connectedSet.has(p.key)
        : connectionsReadable ? connectedSet.has(p.key) : null,
    };
  }));
  // Task #8 (AN) spec wants the catalogue under `items`. We also return
  // `providers` for back-compat with the frontend until it migrates.
  // D753 W2: the Discover order (the SPA counts each category itself) and LinkedIn's card.
  return c.json({
    ok: true, items: providers, providers, unreadable_sources: unreadableSources,
    category_order: [...CATEGORY_ORDER], first_party: [linkedinCard(viewer)],
  });
});

// ───────────────────────────────────────────────────────────────────── list mine

const listMine = async (c: Context<{ Bindings: Env }>) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const sql = getSQL(c.env);
  // Defensive read — Task #8 (AN): a fresh D1 where ensureIntegrationsSchema
  // failed (e.g. transient lock, migration race) must NOT 5xx the page.
  // Fall back to an empty list and best-effort log to integration_logs so
  // ops can see the issue. The marketplace section still renders from the
  // static REGISTRY, so the user can recover by retrying.
  let rows: IntegrationRow[] = [];
  try {
    rows = await sql`SELECT * FROM integrations WHERE user_id = ${user.id} ORDER BY datetime(created_at) DESC` as IntegrationRow[];
  } catch (e) {
    const msg = (e as Error).message || 'select_failed';
    console.warn('[integrations] listMine select failed:', msg);
    try {
      await c.env.DB.prepare(
        'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary) ' +
        "VALUES (0, ?, '_system', 'internal', 'list_failed', 'error', ?)",
      ).bind(user.id, msg.slice(0, 500)).run();
    } catch { /* logs table may not exist either */ }
    await sql.end();
    return c.json({ error: 'connections_unreadable', message: 'Connected tools could not be read.' }, 503);
  }
  // Decrypt only enough to render a 4-char preview; bulk-decrypt is fine
  // because each row's blob is small and the page lists are short.
  // Per-row decrypt with isolation: a single unreadable credential blob
  // (e.g. the worker is missing AXAL_ENCRYPTION_SECRET, or the row was
  // written under a rotated key) must not nuke the entire integrations
  // panel with a 500. The row still renders; the api_key_preview is null
  // and the UI surfaces a "credentials unreadable — reconnect" hint via
  // the existing `last_error` channel.
  const items = await Promise.all(rows.map(async r => {
    let preview: string | null = null;
    try {
      const creds = await decryptCredentials(c.env, r.uid, r.credentials_enc);
      preview = previewApiKey(creds);
    } catch (e) {
      console.warn('[integrations] decrypt preview failed for', r.uid, (e as Error).message);
    }
    const companyIds = await enabledCompanyIds(c.env, r.id);
    return rowToPublic(r, preview, companyIds);
  }));
  return c.json({ ok: true, items });
};
integrations.get('', listMine);
integrations.get('/', listMine);

integrations.get('/suggestions', async (c) => {
  const user = await requireAuth(c);
  const companyId = await activeCompanyFor(c, user);
  if (!companyId) return c.json({ error: 'active_company_required' }, 400);
  try {
    const projects = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM projects WHERE company_id = ? AND deleted_at IS NULL',
    ).bind(companyId).first<{ n: number }>();
    if (!projects?.n) return c.json({ ok: true, items: [] });
    const metrics = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM project_metrics pm JOIN projects p ON p.id = pm.project_id ' +
      'WHERE p.company_id = ? AND p.deleted_at IS NULL',
    ).bind(companyId).first<{ n: number }>();
    const interviews = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM discovery_interviews di JOIN projects p ON p.id = di.project_id ' +
      'WHERE p.company_id = ? AND p.deleted_at IS NULL',
    ).bind(companyId).first<{ n: number }>();
    const items = [];
    if (metrics?.n === 0) items.push({ provider_key: 'stripe', module: 'revenue_and_traction', reason: 'Revenue and traction has no recorded metrics yet.' });
    if (interviews?.n === 0) items.push({ provider_key: 'calendly', module: 'customer_research', reason: 'Customer research has no recorded interviews yet.' });
    return c.json({ ok: true, items });
  } catch {
    return c.json({ error: 'suggestions_unreadable', message: 'The module data could not be read.' }, 503);
  }
});

// D753 — one connector's page, descriptive only; above `/:key` with the other literal reads.
integrations.get('/directory/:key', async (c) => {
  const user = await requireAuth(c);
  ensureRole(c, user);
  const viewer = { role: String(user.role || ''), hq: branchOf(c.env) === null };
  const k = directoryKeyFor(c.req.param('key'));
  if (!k) return c.json({ error: 'unknown_provider' }, 404);
  if (k.key === 'linkedin') {
    const page = pageDescriptor({ key: 'linkedin' }, viewer);
    if (!page) return c.json({ error: 'unknown_provider' }, 404);
    return c.json({ ok: true, connector: { ...linkedinCard(viewer), ...pageBody(page) } });
  }
  const p = getDescriptor(k.key);
  if (!p || audienceOf(c, user, p) === 'none') return c.json({ error: 'unknown_provider' }, 404);
  const page = pageDescriptor(p, viewer);
  if (!page) return c.json({ error: 'unknown_provider' }, 404);
  return c.json({ ok: true, connector: { ...(await catalogueEntry(c, user, p, viewer)), ...pageBody(page) } });
});

integrations.post('/requests', async (c) => {
  const user = await requireAuth(c);
  const companyId = await activeCompanyFor(c, user);
  if (!companyId) return c.json({ error: 'active_company_required' }, 400);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const tool = typeof body.tool === 'string' ? body.tool.trim() : '';
  const intendedUse = typeof body.use === 'string' ? body.use.trim() : '';
  if (!tool || !intendedUse || tool.length > 120 || intendedUse.length > 1000) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const actor = await hashEmail(user.email);
  const written = await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO connector_requests (user_id, company_id, tool, intended_use) VALUES (?, ?, ?, ?)',
    ).bind(user.id, companyId, tool, intendedUse),
    c.env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
      .bind(user.id, actor, 'connector_requested', JSON.stringify({ company_id: companyId, tool })),
  ]);
  return c.json({ ok: true, id: written[0].meta.last_row_id }, 201);
});

integrations.get('/requests', async (c) => {
  const user = await requireAuth(c);
  const superAdmin = await c.env.DB.prepare('SELECT 1 AS allowed FROM super_admins WHERE user_id = ?')
    .bind(user.id).first();
  if (!superAdmin) return c.json({ error: 'forbidden' }, 403);
  const page = Math.max(1, Math.min(10000, Number.parseInt(c.req.query('page') || '1', 10) || 1));
  const rows = await c.env.DB.prepare(
    'SELECT id, user_id, company_id, tool, intended_use AS use, created_at FROM connector_requests ' +
    'ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ?',
  ).bind((page - 1) * 50).all();
  return c.json({ ok: true, items: rows.results || [], page, page_size: 50 });
});

integrations.get('/:key', async (c, next) => {
  const key = c.req.param('key');
  // Hono runs matching handlers in registration order, so this one-segment
  // read would answer `GET /waitlist` (registered further down) with
  // unknown_provider. Hand that path on (D651).
  if (key === 'waitlist') return next();
  const user = await requireAuth(c);
  const known = getDescriptor(key);
  if (!known || audienceOf(c, user, known) === 'none') return c.json({ error: 'unknown_provider' }, 404);
  if (!writesProjectData(key)) return c.json({ ok: true, provider_key: key, teammate: null });
  const companyId = await activeCompanyFor(c, user);
  if (!companyId) return c.json({ error: 'active_company_required' }, 400);
  const teammate = await c.env.DB.prepare(
    "SELECT u.name FROM integrations i JOIN integration_companies ic ON ic.integration_id = i.id " +
    "JOIN users u ON u.id = i.user_id JOIN user_company_links ucl ON ucl.user_id = u.id AND ucl.company_id = ic.company_id " +
    "WHERE i.provider_key = ? AND i.status = 'active' AND ic.company_id = ? AND ic.enabled = 1 " +
    'AND i.user_id != ? ORDER BY i.id LIMIT 1',
  ).bind(key, companyId, user.id).first<{ name: string | null }>();
  return c.json({ ok: true, provider_key: key, teammate: teammate ? { name: teammate.name } : null });
});

integrations.put('/:uid/companies', async (c) => {
  const user = await requireAuth(c);
  const row = await loadRow(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.company_ids) || body.company_ids.length > 100 ||
      body.company_ids.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    return c.json({ error: 'invalid_company_ids' }, 400);
  }
  const ids = [...new Set(body.company_ids as number[])];
  for (const id of ids) {
    const member = await c.env.DB.prepare(
      'SELECT 1 AS allowed FROM user_company_links WHERE user_id = ? AND company_id = ?',
    ).bind(user.id, id).first();
    if (!member) return c.json({ error: 'company_not_linked' }, 403);
  }
  const actor = await hashEmail(user.email);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').bind(row.id),
    ...ids.map((id) => c.env.DB.prepare(
      'INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ' +
      'ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1',
    ).bind(row.id, id)),
    c.env.DB.prepare('INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)')
      .bind(user.id, actor, 'connector_company_scope_changed', JSON.stringify({ integration_id: row.id, company_ids: ids })),
  ]);
  return c.json({ ok: true, company_ids: await enabledCompanyIds(c.env, row.id) });
});

// ───────────────────────────────────────────────────────────────────── connect

interface ConnectBody {
  provider_name?: string;
  provider_key?: string;
  api_key?: string;
  webhook_secret?: string;
  display_name?: string;
  config?: Record<string, unknown>;
  oauth_code?: string;
  oauth_state?: string;
}

/** The `coming_soon` refusal, the same from `/connect` and the OAuth start (D751). */
function comingSoonBody(desc: ProviderDescriptor) {
  return {
    error: 'coming_soon',
    message: `${desc.display_name} isn't available yet — join the waitlist to be notified.`,
    notify_me_url: `/api/integrations/${desc.key}/notify-me`,
  };
}

/**
 * D751 — an OAuth connector Axal holds no client for. The sentence is true
 * for everyone; an admin also gets the names the keys go under and, where
 * the Integration keys console can hold them, where. Never a value.
 */
async function unconfiguredRefusal(c: Context<{ Bindings: Env }>, user: User, desc: ProviderDescriptor, raw?: unknown): Promise<Response> {
  const name = desc.display_name;
  const managed = (MANAGED_PROVIDERS as string[]).includes(desc.key);
  const vars = managed ? PROVIDER_ENV_VARS[desc.key as ManagedProviderKey] : null;
  // Zoom's names live with Zoom (env only); loaded here so this route does not register it.
  const envVars = vars ? [vars.id, vars.secret]
    : desc.key === 'zoom' ? [...(await import('../services/channels/zoom')).ZOOM_CLIENT_ENV_VARS] : null;
  const extra: Record<string, unknown> = { provider: desc.key };
  if (user.role === 'admin') {
    if (managed) extra.admin_href = '/admin?tab=integration-keys';
    if (envVars) extra.env_vars = envVars;
  }
  return refuse(c, 503, {
    code: 'oauth_unconfigured',
    message: `${name} isn't set up on Axal yet, so it can't be connected. Nothing was sent to ${name}.`,
    raw,
    extra,
  });
}

integrations.post('/connect', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);

  const body = (await c.req.json().catch(() => ({}))) as ConnectBody;
  const key = String(body.provider_key || body.provider_name || '').toLowerCase().trim();
  if (!key) return c.json({ error: 'provider_key is required' }, 400);

  const desc = getDescriptor(key);
  // D752: a member who followed a link learns why; every other route stays 404.
  const viewer = { role: String(user.role || ''), hq: branchOf(c.env) === null };
  if (desc && personalHqOnlyOffHq(desc, viewer)) {
    return refuse(c, 403, { code: 'purpose_not_allowed', message: personalHqOnlySentence(desc.display_name) });
  }
  if (!desc || audienceOf(c, user, desc) === 'none') return c.json({ error: 'unknown_provider', provider_key: key }, 404);
  // D710: an entity connection is added in its own console, never here.
  if (audienceOf(c, user, desc) === 'entity') {
    return c.json({ error: 'entity_connection_only', message: `${desc.display_name} is connected per Axal entity by the Super Admin, not from here.` }, 409);
  }
  const activeCompanyId = await activeCompanyFor(c, user);
  if (!activeCompanyId && writesProjectData(key)) return c.json({ error: 'active_company_required' }, 400);

  if (desc.status === 'coming_soon') {
    // Spec contract (Task #8 / AN): 503 + coming_soon + provider-scoped
    // notify_me_url. The 409 we used to return was wrong because the
    // resource isn't in conflict — it just isn't available yet.
    return c.json(comingSoonBody(desc), 503, { 'Retry-After': '86400' });
  }

  // Tier gate (founders only; admin/partner/investor/advisor bypass).
  if (desc.tier !== 'free') {
    if (!userMeetsTier(user, desc.tier as 'growth' | 'studio')) {
      return c.json(tierUpsell(desc.tier as 'growth' | 'studio'), 402);
    }
  }

  const impl = getProviderImpl(key);
  if (!impl) {
    return c.json({
      error: 'provider_rolling_out',
      message: `${desc.display_name} is rolling out — please check back shortly.`,
      retry_after_seconds: 86400,
    }, 503, { 'Retry-After': '86400' });
  }

  let result;
  try {
    result = await impl.connect(c, user, {
      api_key: body.api_key,
      oauth_code: body.oauth_code,
      oauth_state: body.oauth_state,
      display_name: body.display_name,
      config: body.config,
      webhook_secret: body.webhook_secret,
    });
  } catch (e) {
    // D713: a refusal the provider meant keeps its own status and code.
    if (e instanceof ConnectRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence });
    return refuse(c, 400, { code: 'connect_failed', message: 'The connection could not be made. Check the credentials and try again.', raw: e, audience: 'owner' });
  }
  if (desc.auth_type === 'oauth2' && hasScopeOverreach(desc, result.scopes || [])) {
    try { await impl.revokeGranted?.(c.env, result); } catch { /* refusal still wins */ }
    await logEvent(c.env, {
      integration_id: 0, user_id: user.id, provider_key: key,
      direction: 'internal', event_type: 'overreach', status: 'error',
      response_summary: 'Provider granted permissions beyond the requested set; connection refused.',
    });
    return c.json({ error: 'scope_overreach', message: 'The provider granted permissions beyond those requested. The connection was refused.' }, 403);
  }

  // Upsert. Insert with random uid, encrypt against that uid; on conflict
  // (user already has this provider) update credentials in place but keep
  // the existing uid so AAD remains valid.
  const sql = getSQL(c.env);
  const existing = await c.env.DB.prepare(
    'SELECT uid FROM integrations WHERE user_id = ? AND provider_key = ?',
  ).bind(user.id, key).first<{ uid: string }>();

  const uid = existing?.uid || newUid();
  const credsEnc = await encryptCredentials(c.env, uid, result.credentials);
  const webhookEnc = body.webhook_secret
    ? await encryptWebhookSecret(c.env, uid, body.webhook_secret)
    : null;

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE integrations SET ' +
      'display_name = ?, status = \'active\', auth_type = ?, ' +
      'credentials_enc = ?, ' +
      (webhookEnc ? 'webhook_secret_enc = ?, ' : '') +
      'config_json = ?, capabilities_json = ?, scopes_json = ?, ' +
      'external_account_id = ?, external_account_name = ?, ' +
      'last_error = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP ' +
      'WHERE uid = ?',
    ).bind(
      ...(webhookEnc
        ? [
            body.display_name || desc.display_name, desc.auth_type,
            credsEnc, webhookEnc,
            JSON.stringify(result.config ?? {}),
            JSON.stringify(result.capabilities ?? desc.capabilities),
            JSON.stringify(result.scopes ?? []),
            result.external_account_id ?? null, result.external_account_name ?? null,
            uid,
          ]
        : [
            body.display_name || desc.display_name, desc.auth_type,
            credsEnc,
            JSON.stringify(result.config ?? {}),
            JSON.stringify(result.capabilities ?? desc.capabilities),
            JSON.stringify(result.scopes ?? []),
            result.external_account_id ?? null, result.external_account_name ?? null,
            uid,
          ]),
    ).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, webhook_secret_enc, config_json, capabilities_json, scopes_json, external_account_id, external_account_name) ' +
      "VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      uid, user.id, key, body.display_name || desc.display_name, desc.auth_type,
      credsEnc, webhookEnc,
      JSON.stringify(result.config ?? {}),
      JSON.stringify(result.capabilities ?? desc.capabilities),
      JSON.stringify(result.scopes ?? []),
      result.external_account_id ?? null, result.external_account_name ?? null,
    ).run();
  }

  const row = await loadRow(c.env, uid, user.id);
  if (row) {
    if (activeCompanyId) {
    await c.env.DB.prepare(
      'INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ' +
      'ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1',
    ).bind(row.id, activeCompanyId).run();
    }
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: key,
      direction: 'outbound', event_type: existing ? 'reconnect' : 'connect', status: 'ok',
      response_summary: existing ? 'Credentials updated.' : 'Connection established.',
      external_id: result.external_account_id ?? null,
    });
    // Hash actor when writing to the global activity_logs (T22.1 convention).
    try {
      const actorHash = await hashEmail(user.email);
      await c.env.DB.prepare(
        'INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)',
      ).bind(user.id, actorHash, existing ? 'integration_reconnected' : 'integration_connected', JSON.stringify({ provider_key: key })).run();
    } catch { /* activity_logs may not exist in some schemas */ }

    // Provider-specific post-connect hook (Calendly uses this to provision
    // its webhook subscription + run a first sync immediately, eliminating
    // the otherwise-15-minute "dead period" after connect). Fire-and-forget
    // via waitUntil so failures don't block the HTTP response.
    if (impl.postConnect) {
      try {
        c.executionCtx.waitUntil(
          impl.postConnect(c, user, row).catch((e: Error) => {
            console.warn('[integrations] postConnect failed', key, e.message);
          }),
        );
      } catch { /* executionCtx may be missing in some test contexts */ }
    }
  }

  await sql.end();
  return c.json({ ok: true, item: row ? rowToPublic(row, previewApiKey(result.credentials as CredentialBlob), await enabledCompanyIds(c.env, row.id)) : null });
});

// ───────────────────────────────────────────────────────────────────── disconnect

integrations.delete('/:uid', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const row = await loadRow(c.env, uid, user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const impl = getProviderImpl(row.provider_key);
  if (impl?.disconnect) {
    try { await impl.disconnect(c, user, row); }
    catch (e) { console.warn('[integrations] provider disconnect threw:', (e as Error).message); }
  }

  await c.env.DB.prepare('DELETE FROM integration_companies WHERE integration_id = ?').bind(row.id).run();
  await c.env.DB.prepare('DELETE FROM integrations WHERE id = ?').bind(row.id).run();
  await logEvent(c.env, {
    integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
    direction: 'internal', event_type: 'disconnect', status: 'ok',
    response_summary: 'Connection removed.',
  });
  return c.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────── sync

integrations.post('/:uid/sync', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const row = await loadRow(c.env, uid, user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (writesProjectData(row.provider_key)) {
    const selectedCompany = await activeCompanyFor(c, user);
    if (!selectedCompany || !(await companyEnabled(c.env, row.id, selectedCompany))) {
      return c.json({ error: 'company_not_enabled' }, 403);
    }
  }

  // D686: an existing connection keeps syncing after a downgrade.

  const impl = getProviderImpl(row.provider_key);
  if (!impl?.sync) {
    return c.json({ error: 'sync_not_supported', message: 'This provider has no sync action.' }, 422);
  }
  try {
    const out = await impl.sync(c, user, row);
    await c.env.DB.prepare('UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL, last_error_at = NULL, status = \'active\' WHERE id = ?').bind(row.id).run();
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'sync', status: 'ok',
      response_summary: out.summary, external_id: out.external_id ?? null,
      payload: out.counts,
    });
    return c.json({ ok: true, summary: out.summary, counts: out.counts ?? {} });
  } catch (e) {
    const msg = (e as Error).message || 'sync failed';
    await c.env.DB.prepare('UPDATE integrations SET last_error = ?, last_error_at = CURRENT_TIMESTAMP, status = \'error\' WHERE id = ?').bind(msg.slice(0, 500), row.id).run();
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'sync', status: 'error', response_summary: msg,
    });
    return refuse(c, 502, { code: 'sync_failed', message: 'The sync did not complete. Check the connection and try again.', raw: msg, audience: 'owner' });
  }
});

// ─────────────────────────────────────────────── D655: progress, fed, repositories

/** The current or last sync's progress: a percentage and what it is reading. */
integrations.get('/:uid/sync-status', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const row = await loadRow(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const p = await readProgress(c.env, row.uid);
  return c.json({
    ok: true,
    state: p?.state ?? 'idle',
    pct: p ? p.pct : null,
    reading: p?.reading ?? null,
    updated_at: p?.updated_at ?? null,
    last_synced_at: row.last_synced_at,
    last_error: row.status === 'error' ? 'The last sync did not complete.' : null,
  });
});

/** "Now fed by": items delivered per module. Every connector answers. */
integrations.get('/:uid/fed', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const row = await loadRow(c.env, c.req.param('uid'), user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  try {
    return c.json({ ok: true, provider_key: row.provider_key, modules: await fedCounts(c.env, row.id, row.provider_key, user.role) });
  } catch {
    return c.json({ error: 'fed_unreadable', message: 'Unreadable: what this connector delivered could not be read.' }, 503);
  }
});

async function githubScope(c: Context<{ Bindings: Env }>) {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const row = await loadRow(c.env, c.req.param('uid') || '', user.id);
  if (!row) return { refusal: c.json({ error: 'not_found' }, 404) };
  if (row.provider_key !== 'github') return { refusal: c.json({ error: 'repositories_not_supported' }, 422) };
  const selectedCompany = await activeCompanyFor(c, user);
  if (!selectedCompany || !(await companyEnabled(c.env, row.id, selectedCompany))) {
    return { refusal: c.json({ error: 'company_not_enabled' }, 403) };
  }
  return { user, row };
}

/** The repositories the member's installations reach, and the chosen ones. */
integrations.get('/:uid/repositories', async (c) => {
  const s = await githubScope(c);
  if ('refusal' in s) return s.refusal;
  try {
    const token = await accessToken(c.env, s.row);
    const granted = await grantedPermissions(token);
    const cfg = safeJson<Record<string, unknown>>(s.row.config_json, {});
    return c.json({
      ok: true,
      available: await accessibleRepositories(token, granted.installations),
      selected: Array.isArray(cfg.repositories) ? cfg.repositories : [],
      project_id: cfg.project_id ?? null,
    });
  } catch (e) {
    return refuse(c, 502, { code: 'repositories_unreadable', message: 'GitHub did not list the repositories. Check the connection and try again.', raw: e, audience: 'owner' });
  }
});

/**
 * Choose the repositories to sync, and the project they feed. The grant is
 * read again first: if GitHub now grants anything beyond the registry's
 * read-only list (a write, say), the choice is refused and nothing is saved.
 */
integrations.put('/:uid/repositories', async (c) => {
  const s = await githubScope(c);
  if ('refusal' in s) return s.refusal;
  const body = await c.req.json().catch(() => ({})) as { repositories?: unknown; project_id?: unknown };
  const projectId = Number(body.project_id);
  if (!Number.isSafeInteger(projectId) || !(await projectEnabled(c.env, s.row.id, projectId))) {
    return c.json({ error: 'project_not_enabled' }, 403);
  }
  let token: string, granted: { scopes: string[]; installations: number[] };
  try {
    token = await accessToken(c.env, s.row);
    granted = await grantedPermissions(token);
  } catch (e) {
    return refuse(c, 502, { code: 'grant_unreadable', message: 'GitHub did not say what it grants. Nothing was saved.', raw: e, audience: 'owner' });
  }
  const desc = getDescriptor('github');
  if (!desc || hasScopeOverreach(desc, granted.scopes)) {
    await logEvent(c.env, {
      integration_id: s.row.id, user_id: s.user.id, provider_key: 'github',
      direction: 'internal', event_type: 'overreach', status: 'error',
      response_summary: 'GitHub grants more than read access; repositories were not saved.',
      payload: { granted: granted.scopes },
    });
    return c.json({
      error: 'write_scope_refused',
      message: 'GitHub grants this connection more than read access. Change the StudioOS app to read-only in GitHub, then choose again.',
      granted: granted.scopes,
    }, 403);
  }
  let available;
  try {
    available = await accessibleRepositories(token, granted.installations);
  } catch (e) {
    return refuse(c, 502, { code: 'repositories_unreadable', message: 'GitHub did not list the repositories. Nothing was saved.', raw: e, audience: 'owner' });
  }
  const choice = checkChoice(body.repositories, available);
  if (!choice.ok) return c.json(choice, 400);
  const merged = { ...safeJson<Record<string, unknown>>(s.row.config_json, {}), repositories: choice.repositories, project_id: projectId, installations: granted.installations };
  await c.env.DB.prepare('UPDATE integrations SET config_json = ?, scopes_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(JSON.stringify(merged), JSON.stringify(granted.scopes), s.row.id).run();
  await logEvent(c.env, {
    integration_id: s.row.id, user_id: s.user.id, provider_key: 'github',
    direction: 'internal', event_type: 'repositories_chosen', status: 'ok',
    response_summary: `${choice.repositories.length} repositories chosen.`,
    payload: { repositories: choice.repositories, project_id: projectId },
  });
  return c.json({ ok: true, repositories: choice.repositories, project_id: projectId });
});

// ───────────────────────────────────────────────────────────────────── push

/**
 * The one company-and-project check every write to a connector passes
 * (D650, D652): `/:uid/push` below, and Eadwyn's confirm
 * (`routes/eadwyn.ts`) before it calls the same `impl.push`. A connection
 * that writes project data writes only into the active company, and only
 * when that company is switched on for it; a payload naming a project
 * writes only into a project of an enabled company. `null` means allowed.
 */
export async function pushScopeRefusal(
  c: Context<{ Bindings: Env }>,
  user: User,
  row: IntegrationRow,
  payload: unknown,
): Promise<'company_not_enabled' | 'project_not_enabled' | null> {
  if (writesProjectData(row.provider_key)) {
    const selectedCompany = await activeCompanyFor(c, user);
    if (!selectedCompany || !(await companyEnabled(c.env, row.id, selectedCompany))) return 'company_not_enabled';
  }
  if (payload && typeof payload === 'object' && 'project_id' in payload) {
    const projectId = Number((payload as { project_id: unknown }).project_id);
    if (!Number.isSafeInteger(projectId) || !(await projectEnabled(c.env, row.id, projectId))) return 'project_not_enabled';
  }
  return null;
}

integrations.post('/:uid/push', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const row = await loadRow(c.env, uid, user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const payload = await c.req.json().catch(() => ({}));
  const refusal = await pushScopeRefusal(c, user, row, payload);
  if (refusal) return c.json({ error: refusal }, 403);

  const desc = getDescriptor(row.provider_key);
  if (desc && desc.tier !== 'free') ensureTier(user, desc.tier as 'growth' | 'studio');

  const impl = getProviderImpl(row.provider_key);
  if (!impl?.push) {
    return c.json({ error: 'push_not_supported', message: 'This provider has no push action.' }, 422);
  }

  try {
    const out = await impl.push(c, user, row, payload);
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'push', status: 'ok',
      http_status: out.http_status, response_summary: out.summary,
      external_id: out.external_id ?? null, payload,
    });
    return c.json({ ok: true, summary: out.summary, external_id: out.external_id ?? null });
  } catch (e) {
    const msg = (e as Error).message || 'push failed';
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'push', status: 'error', response_summary: msg, payload,
    });
    return refuse(c, 502, { code: 'push_failed', message: 'The update could not be sent to the connected account. Check the connection and try again.', raw: msg, audience: 'owner' });
  }
});

// ───────────────────────────────────────────────────────────────────── action / config

/**
 * Provider-specific named actions, e.g. `list_pipelines` for the HubSpot
 * pipeline picker. The provider impl decides what payload to return.
 * Tier-gated identically to /sync + /push.
 */
async function actionHandler(c: Context<{ Bindings: Env }>) {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid') || '';
  const name = c.req.param('name') || '';
  const row = await loadRow(c.env, uid, user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const desc = getDescriptor(row.provider_key);
  if (desc && desc.tier !== 'free') ensureTier(user, desc.tier as 'growth' | 'studio');

  const impl = getProviderImpl(row.provider_key);
  if (!impl?.action) {
    return c.json({ error: 'action_not_supported' }, 422);
  }
  let body: unknown = null;
  if (c.req.method === 'POST') body = await c.req.json().catch(() => ({}));
  try {
    const out = await impl.action(c, user, row, name, body);
    return c.json({ ok: true, action: name, result: out });
  } catch (e) {
    const msg = (e as Error).message || 'action failed';
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: `action:${name}`, status: 'error',
      response_summary: msg,
    });
    return refuse(c, 502, { code: 'action_failed', message: 'That action did not complete on the connected account. Check the connection and try again.', raw: msg, audience: 'owner' });
  }
}
integrations.get('/:uid/action/:name', actionHandler);
integrations.post('/:uid/action/:name', actionHandler);

/**
 * PATCH /:uid/config — shallow-merge into config_json. Used by the HubSpot
 * pipeline picker to persist the chosen pipeline + dealstage map. Only the
 * connection's owner (or admin) may update.
 */
integrations.patch('/:uid/config', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid') || '';
  const row = await loadRow(c.env, uid, user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const rawPatch = await c.req.json().catch(() => ({}));
  if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
    return c.json({ error: 'invalid_config' }, 400);
  }
  const existing = safeJson<Record<string, unknown>>(row.config_json, {});
  const checked = validateConnectorSettings(row.provider_key, rawPatch as Record<string, unknown>);
  if (!checked.ok) return c.json({ error: checked.error }, 400);
  let patch = checked.providerPatch;
  const impl = getProviderImpl(row.provider_key);
  if (impl?.validateConfig) {
    const v = impl.validateConfig(patch, existing);
    if (!v.ok) return c.json({ error: 'invalid_config', message: v.error }, 400);
    patch = v.patch;
  }
  if ('project_id' in patch) {
    const projectId = Number(patch.project_id);
    if (!Number.isSafeInteger(projectId) || !(await projectEnabled(c.env, row.id, projectId))) {
      return c.json({ error: 'project_not_enabled' }, 403);
    }
  }
  const merged = { ...existing, ...checked.settings, ...patch };
  await c.env.DB.prepare(
    'UPDATE integrations SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).bind(JSON.stringify(merged), row.id).run();
  await logEvent(c.env, {
    integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
    direction: 'internal', event_type: 'config_update', status: 'ok',
    response_summary: `keys: ${Object.keys(patch).join(',')}`,
    payload: patch,
  });
  return c.json({ ok: true, config: merged });
});

// ───────────────────────────────────────────────────────────────────── logs

integrations.get('/:uid/logs', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const uid = c.req.param('uid');
  const row = await loadRow(c.env, uid, user.id);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const page = Math.max(1, Math.min(10000, Number.parseInt(c.req.query('page') || '1', 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(c.req.query('limit') || '50', 10) || 50));
  const q = (c.req.query('q') || '').trim().slice(0, 100).toLowerCase();
  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM integration_logs WHERE integration_id = ? AND ' +
    '(? = \'\' OR instr(lower(coalesce(event_type, \'\')), ?) > 0 OR instr(lower(coalesce(request_summary, \'\')), ?) > 0 ' +
    'OR instr(lower(coalesce(response_summary, \'\')), ?) > 0)',
  ).bind(row.id, q, q, q, q).first<{ n: number }>();
  const rows = await c.env.DB.prepare(
    'SELECT id, direction, event_type, status, http_status, request_summary, response_summary, external_id, payload_json, created_at ' +
    'FROM integration_logs WHERE integration_id = ? AND ' +
    '(? = \'\' OR instr(lower(coalesce(event_type, \'\')), ?) > 0 OR instr(lower(coalesce(request_summary, \'\')), ?) > 0 ' +
    'OR instr(lower(coalesce(response_summary, \'\')), ?) > 0) ' +
    'ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?',
  ).bind(row.id, q, q, q, q, limit, (page - 1) * limit).all();
  interface LogRow {
    id: number;
    direction: string;
    event_type: string;
    status: string;
    http_status: number | null;
    request_summary: string | null;
    response_summary: string | null;
    external_id: string | null;
    payload_json: string | null;
    created_at: string;
  }
  const items = ((rows.results || []) as unknown as LogRow[]).map(r => ({
    id: r.id,
    direction: r.direction,
    event_type: r.event_type,
    status: r.status,
    http_status: r.http_status,
    request_summary: r.request_summary,
    response_summary: r.response_summary,
    external_id: r.external_id,
    payload: safeJson(r.payload_json, null),
    created_at: r.created_at,
  }));
  return c.json({ ok: true, items, total: total?.n ?? 0, page, page_size: limit });
});

// ───────────────────────────────────────────────────────────────────── webhook

/**
 * Providers whose `webhook` handler verifies the delivery's signature itself
 * and throws on anything it cannot verify, so the connection row needs no
 * stored signing key. HubSpot signs with the app's client secret (v3), which
 * `hubspot.ts`'s handler checks before it reads the body.
 */
const VERIFIED_IN_HANDLER = new Set(['hubspot']);

integrations.post('/webhook/:provider/:uid', async (c) => {
  const provider = c.req.param('provider').toLowerCase();
  // D713 decision 2: a bank connection takes no webhook. Refused before any
  // row lookup, body read or log, so a real uid and a made-up one look alike.
  if (provider === 'mercury') return c.json({ error: 'not_found' }, 404);
  await ensureIntegrationsSchema(c.env);
  const uid = c.req.param('uid');

  const row = await c.env.DB.prepare('SELECT * FROM integrations WHERE uid = ? AND provider_key = ?')
    .bind(uid, provider).first<IntegrationRow>();
  // A delivery is taken only for an active connection with a handler and
  // with a signing key to check it against (or a provider that checks its own
  // signature). Anything else gets the unknown-connection answer, before the
  // body is read: no handler runs, no fetch is made and nothing is logged.
  const impl = getProviderImpl(provider);
  if (!row || row.status !== 'active' || !impl?.webhook ||
      (!row.webhook_secret_enc && !VERIFIED_IN_HANDLER.has(provider))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const body = await c.req.text();
  // Generic signature header — providers with non-standard formats
  // (e.g. Calendly's `Calendly-Webhook-Signature`) implement
  // `verifyWebhook` and read their own header from `headers` instead.
  const signature = c.req.header('x-axal-signature')
    || c.req.header('x-hub-signature-256')
    || c.req.header('x-signature')
    || (impl.verifyWebhook ? 'provider-verified' : null);

  // HMAC verification against the connection's signing key. We compute the
  // SHA-256 HMAC over the raw body and compare with constant-time equality.
  // A missing signature header is refused just as firmly as a wrong one, so
  // only a sender holding the key gets a delivery processed.
  if (row.webhook_secret_enc) {
    const secret = await decryptWebhookSecret(c.env, row.uid, row.webhook_secret_enc);
    if (!secret) {
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: provider,
        direction: 'inbound', event_type: 'webhook', status: 'error',
        response_summary: 'webhook_secret_unreadable',
      });
      return c.json({ error: 'webhook_secret_unreadable' }, 500);
    }
    if (!signature) {
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: provider,
        direction: 'inbound', event_type: 'webhook', status: 'error',
        response_summary: 'missing_signature',
      });
      return c.json({ error: 'missing_signature' }, 401);
    }
    // Provider-specific verifier wins when present (Calendly uses a
    // Stripe-style `t=...,v1=...` format that the default check can't
    // express). Fall back to the default `sha256=hex` HMAC otherwise.
    let valid: boolean;
    if (impl.verifyWebhook) {
      try { valid = await impl.verifyWebhook(secret, body, c.req.raw.headers); }
      catch { valid = false; }
    } else {
      const expected = await hmacHex(secret, body);
      const provided = signature.replace(/^sha256=/i, '').trim().toLowerCase();
      valid = constantTimeEqual(provided, expected);
    }
    if (!valid) {
      await logEvent(c.env, {
        integration_id: row.id, user_id: row.user_id, provider_key: provider,
        direction: 'inbound', event_type: 'webhook', status: 'error',
        response_summary: 'invalid_signature',
      });
      return c.json({ error: 'invalid_signature' }, 401);
    }
  }

  const syncSetting = safeJson<Record<string, unknown>>(row.config_json, {}).sync_frequency;
  if ((syncSetting && syncSetting !== 'live') ||
      (writesProjectData(provider) && (await enabledCompanyIds(c.env, row.id)).length === 0)) {
    return c.json({ ok: true, skipped: 'company_or_sync_disabled' });
  }

  try {
    const out = await impl.webhook(c, row, body, signature);
    await logEvent(c.env, {
      integration_id: row.id, user_id: row.user_id, provider_key: provider,
      direction: 'inbound', event_type: 'webhook', status: 'ok',
      response_summary: out.summary,
    });
    return c.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message || 'webhook failed';
    await logEvent(c.env, {
      integration_id: row.id, user_id: row.user_id, provider_key: provider,
      direction: 'inbound', event_type: 'webhook', status: 'error', response_summary: msg,
    });
    return refuse(c, 500, { code: 'webhook_failed', message: 'The webhook could not be processed.', raw: msg });
  }
});

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time equality over equal-length strings; false for length mismatch. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Recursive secret-redactor for payload bodies before they hit the log
 * table. We can't trust providers to keep secrets out of webhook bodies
 * (Slack scopes, HubSpot oauth response replays, etc.) — so we match keys
 * against a denylist and replace the value with a marker before storage.
 * Also caps array/string lengths so a runaway payload can't blow up the
 * row size.
 */
// D710 (#1775): bank numbers too. `ein` only as a whole key or segment, so
// `protein` is not masked.
const SECRET_KEY_RE = /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|webhook[_-]?secret|secret|password|signing[_-]?key|private[_-]?key|bearer|authorization|x-api-key|cookie|set-cookie|session|account[_-]?number|routing[_-]?number|tax[_-]?id|(?:^|[_-])ein(?:$|[_-]))/i;
function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(v => redactPayload(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (++count > 100) { out['[truncated]'] = true; break; }
    if (SECRET_KEY_RE.test(k)) { out[k] = '[redacted]'; continue; }
    out[k] = redactPayload(v, depth + 1);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────── waitlist

integrations.post('/waitlist', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const body = await c.req.json().catch(() => ({}));
  const key = String(body?.provider_key || '').toLowerCase().trim();
  const desc = getDescriptor(key);
  if (!desc || audienceOf(c, user, desc) === 'none') return c.json({ error: 'unknown_provider' }, 404);
  const notes = body?.notes ? String(body.notes).slice(0, 1000) : null;
  try {
    await c.env.DB.prepare(
      'INSERT INTO integration_waitlist (user_id, provider_key, notes) VALUES (?, ?, ?) ' +
      'ON CONFLICT(user_id, provider_key) DO UPDATE SET notes = excluded.notes',
    ).bind(user.id, key, notes).run();
  } catch (e) {
    return refuse(c, 500, { code: 'waitlist_failed', message: 'You could not be added to the waitlist. Try again in a moment.', raw: e });
  }
  return c.json({ ok: true, joined: true, provider_key: key });
});

integrations.get('/waitlist', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const rows = await c.env.DB.prepare(
    'SELECT provider_key, notes, created_at, notified_at FROM integration_waitlist WHERE user_id = ? ORDER BY datetime(created_at) DESC',
  ).bind(user.id).all();
  return c.json({ ok: true, items: rows.results || [] });
});

// `notify-me` aliases — preferred public surface for the Coming Soon
// "Notify me" button. `/waitlist` remains for admin/list use.
integrations.post('/notify-me', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const body = await c.req.json().catch(() => ({}));
  const key = String(body?.provider_key || '').toLowerCase().trim();
  const desc = getDescriptor(key);
  if (!desc || audienceOf(c, user, desc) === 'none') return c.json({ error: 'unknown_provider' }, 404);
  const notes = body?.notes ? String(body.notes).slice(0, 1000) : null;
  await c.env.DB.prepare(
    'INSERT INTO integration_waitlist (user_id, provider_key, notes) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, provider_key) DO UPDATE SET notes = excluded.notes',
  ).bind(user.id, key, notes).run();
  return c.json({ ok: true, joined: true, provider_key: key });
});

// Per-provider POST alias — matches the `notify_me_url` we advertise
// from POST /connect when a coming_soon provider is requested. Body is
// optional; provider key comes from the URL.
integrations.post('/:provider/notify-me', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const key = c.req.param('provider').toLowerCase();
  const desc = getDescriptor(key);
  if (!desc || audienceOf(c, user, desc) === 'none') return c.json({ error: 'unknown_provider' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const notes = body?.notes ? String(body.notes).slice(0, 1000) : null;
  await c.env.DB.prepare(
    'INSERT INTO integration_waitlist (user_id, provider_key, notes) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, provider_key) DO UPDATE SET notes = excluded.notes',
  ).bind(user.id, key, notes).run();
  return c.json({ ok: true, joined: true, provider_key: key });
});

integrations.delete('/notify-me/:provider', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const key = c.req.param('provider').toLowerCase();
  await c.env.DB.prepare('DELETE FROM integration_waitlist WHERE user_id = ? AND provider_key = ?').bind(user.id, key).run();
  return c.json({ ok: true });
});

integrations.delete('/waitlist/:provider', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const key = c.req.param('provider').toLowerCase();
  await c.env.DB.prepare('DELETE FROM integration_waitlist WHERE user_id = ? AND provider_key = ?').bind(user.id, key).run();
  return c.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────── oauth (foundation only)

/**
 * Foundation OAuth handshake helpers. Provider impls implement
 * `buildAuthorizeUrl` to return a provider-specific URL with the embedded
 * `state`. The state is returned to the client so `/connect` can replay it
 * during the callback. Providers without OAuth return 404.
 */
integrations.get('/oauth/:provider/start', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const provider = c.req.param('provider').toLowerCase();
  const desc = getDescriptor(provider);
  if (!desc || desc.auth_type !== 'oauth2') return c.json({ error: 'oauth_not_supported' }, 404);
  const selectedCompany = await activeCompanyFor(c, user);
  if (!selectedCompany && writesProjectData(provider)) return c.json({ error: 'active_company_required' }, 400);
  // D751: refused as /connect refuses it, before the plan gate and any state.
  if (desc.status === 'coming_soon') return c.json(comingSoonBody(desc), 503, { 'Retry-After': '86400' });
  if (desc.tier !== 'free' && !userMeetsTier(user, desc.tier as 'growth' | 'studio')) {
    return c.json(tierUpsell(desc.tier as 'growth' | 'studio'), 402);
  }
  const impl = getProviderImpl(provider);
  if (!impl?.buildAuthorizeUrl) {
    return c.json({
      error: 'provider_rolling_out',
      message: `${desc.display_name} OAuth flow is rolling out — please check back shortly.`,
      retry_after_seconds: 86400,
    }, 503, { 'Retry-After': '86400' });
  }
  // D751: an unset (or unreadable) client is refused before any sign-in state
  // is written, so no state row is left that nobody can consume.
  const ready = await readinessOf(c.env, desc);
  if (ready === false) return await unconfiguredRefusal(c, user, desc);
  if (ready === null) {
    c.header('Retry-After', '60');
    return refuse(c, 503, {
      code: 'oauth_setup_unreadable',
      message: `Axal couldn't check whether ${desc.display_name} is set up, so it can't be connected right now. Nothing was sent to ${desc.display_name}. Try again in a minute.`,
      extra: { provider },
    });
  }
  // PKCE + signed state. The state token is bound to (user, provider) and
  // single-use; we hand it to the provider as the OAuth `state` param so
  // the callback can replay both userId and PKCE verifier.
  const pkce = await buildPkce();
  // Provider-specific extras carried through OAuth round-trip via state.
  // Salesforce uses `sandbox=1` to pick test.salesforce.com vs login; the
  // callback recovers it from state.extra and passes through to connect()
  // so we never trust the query string at callback time.
  const extra: Record<string, unknown> = { challenge: pkce.challenge, company_id: selectedCompany };
  if (c.req.query('return_to') === 'build') {
    extra.return_to = 'build';
    // The venture rides in the state, not in per-origin storage: the callback is
    // on OAUTH_CALLBACK_BASE_URL's host, so the return names it (#1597).
    const projectId = Number(c.req.query('project_id'));
    if (Number.isSafeInteger(projectId) && projectId > 0) extra.project_id = projectId;
  }
  if (provider === 'salesforce') {
    const sb = c.req.query('sandbox');
    extra.is_sandbox = sb === '1' || sb === 'true';
  }
  if (provider === 'docusign') {
    // DocuSign has separate demo (account-d.docusign.com) and prod
    // (account.docusign.com) auth hosts. The frontend passes ?demo=1
    // for sandbox connects. The callback recovers this from state.extra
    // and feeds it into connect()'s config so we never trust the query
    // string at callback time. Default = demo (matches the safest
    // posture for first-time integrators).
    const d = c.req.query('demo');
    extra.is_demo = d === undefined ? true : (d === '1' || d === 'true');
  }
  const state = await issueOauthState(c.env, user.id, provider, pkce.verifier, extra);
  // Provider impls may throw `<provider>_oauth_unconfigured: ...` when the
  // server-side OAuth client secrets are missing. Translate that into a
  // controlled 503 so the UI can render an actionable message instead of
  // a generic 500. (Task #1, 2026-05-10 — Slack relies on this path.)
  let url: string;
  try {
    url = await impl.buildAuthorizeUrl(c, user, state);
  } catch (e) {
    const msg = (e as Error).message || '';
    // D751's backstop: `ready` said true and the client went missing since.
    if (/_oauth_unconfigured/.test(msg)) return await unconfiguredRefusal(c, user, desc, msg);
    throw e;
  }
  return c.json({ ok: true, authorize_url: url, state, pkce_method: pkce.method });
});

/**
 * GET /api/integrations/oauth/:provider/callback
 * Provider redirects the browser here after consent. We verify the signed
 * state, hand the code + verifier off to /connect-style flow internally,
 * and either redirect back to the Integrations page (?integration=ok) or
 * surface an error fragment the page renders inline.
 */
export function returnBase(extra: Record<string, unknown> | null | undefined): string {
  return extra?.return_to === 'build' ? '/build/connect' : '/integrations';
}

/** The return's query: the outcome, then Build's venture when the sign-in started from Build (#1597). */
export function returnQuery(extra: Record<string, unknown> | null | undefined, outcome: string): string {
  const id = Number(extra?.project_id);
  const venture = extra?.return_to === 'build' && Number.isSafeInteger(id) && id > 0 ? `&project_id=${id}` : '';
  return `${returnBase(extra)}?${outcome}${venture}`;
}

integrations.get('/oauth/:provider/callback', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const provider = c.req.param('provider').toLowerCase();
  const desc = getDescriptor(provider);
  const code = c.req.query('code') || '';
  const state = c.req.query('state') || '';
  const errorParam = c.req.query('error') || '';
  const consumed = state ? await consumeOauthState(c.env, user.id, provider, state) : null;
  if (errorParam) {
    return c.redirect(returnQuery(consumed?.extra, `oauth=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent(/^[a-z0-9_]{1,64}$/i.test(errorParam) ? errorParam : 'callback_failed')}`));
  }
  if (!desc || desc.auth_type !== 'oauth2') {
    return c.json({ error: 'oauth_not_supported' }, 404);
  }
  if (!code || !state) {
    return c.json({ error: 'missing_code_or_state' }, 400);
  }
  if (!consumed) {
    return c.json({ error: 'invalid_or_expired_state' }, 400);
  }
  const selectedCompany = Number(consumed.extra.company_id);
  const linked = Number.isSafeInteger(selectedCompany) && selectedCompany > 0 &&
    await c.env.DB.prepare('SELECT 1 AS allowed FROM user_company_links WHERE user_id = ? AND company_id = ?')
      .bind(user.id, selectedCompany).first();
  if (!linked && writesProjectData(provider)) return c.redirect(returnQuery(consumed?.extra, `oauth=error&provider=${encodeURIComponent(provider)}&reason=company_not_linked`));
  const impl = getProviderImpl(provider);
  if (!impl) {
    return c.redirect(returnQuery(consumed?.extra, `oauth=rolling_out&provider=${encodeURIComponent(provider)}`));
  }
  const { return_to: _returnTo, project_id: _projectId, ...providerExtra } = consumed.extra;
  try {
    const result = await impl.connect(c, user, {
      oauth_code: code,
      oauth_state: state,
      config: { pkce_verifier: consumed.pkce_verifier ?? undefined, ...providerExtra },
    });
    if (hasScopeOverreach(desc, result.scopes || [])) {
      try { await impl.revokeGranted?.(c.env, result); } catch { /* refusal still wins */ }
      await logEvent(c.env, {
        integration_id: 0, user_id: user.id, provider_key: provider,
        direction: 'internal', event_type: 'overreach', status: 'error',
        response_summary: 'Provider granted permissions beyond the requested set; connection refused.',
      });
      return c.redirect(returnQuery(consumed?.extra, `oauth=error&provider=${encodeURIComponent(provider)}&reason=scope_overreach`));
    }
    const sql = getSQL(c.env);
    try {
      const existing = await c.env.DB.prepare(
        'SELECT uid FROM integrations WHERE user_id = ? AND provider_key = ?',
      ).bind(user.id, provider).first<{ uid: string }>();
      const uid = existing?.uid || newUid();
      const credsEnc = await encryptCredentials(c.env, uid, result.credentials);
      if (existing) {
        await c.env.DB.prepare(
          "UPDATE integrations SET status = 'active', credentials_enc = ?, " +
          'config_json = ?, capabilities_json = ?, scopes_json = ?, ' +
          'external_account_id = ?, external_account_name = ?, last_error = NULL, last_error_at = NULL, ' +
          'updated_at = CURRENT_TIMESTAMP WHERE uid = ?',
        ).bind(
          credsEnc,
          JSON.stringify(result.config ?? {}),
          JSON.stringify(result.capabilities ?? desc.capabilities),
          JSON.stringify(result.scopes ?? []),
          result.external_account_id ?? null, result.external_account_name ?? null,
          uid,
        ).run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, credentials_enc, config_json, capabilities_json, scopes_json, external_account_id, external_account_name) ' +
          "VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          uid, user.id, provider, desc.display_name, desc.auth_type, credsEnc,
          JSON.stringify(result.config ?? {}),
          JSON.stringify(result.capabilities ?? desc.capabilities),
          JSON.stringify(result.scopes ?? []),
          result.external_account_id ?? null, result.external_account_name ?? null,
        ).run();
      }
      const row = await loadRow(c.env, uid, user.id);
      if (row) {
        if (linked) {
        await c.env.DB.prepare(
          'INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1) ' +
          'ON CONFLICT(integration_id, company_id) DO UPDATE SET enabled = 1',
        ).bind(row.id, selectedCompany).run();
        }
        await logEvent(c.env, {
          integration_id: row.id, user_id: user.id, provider_key: provider,
          direction: 'inbound', event_type: 'oauth_callback', status: 'ok',
          response_summary: existing ? 'OAuth re-consent succeeded.' : 'OAuth consent granted; connection established.',
          external_id: result.external_account_id ?? null,
        });
        try {
          const actorHash = await hashEmail(user.email);
          await c.env.DB.prepare(
            'INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)',
          ).bind(user.id, actorHash, existing ? 'integration_reconnected' : 'integration_connected', JSON.stringify({ provider_key: provider, source: 'oauth_callback' })).run();
        } catch { /* activity_logs may not exist in some schemas */ }

        // Same post-connect hook as the JSON /connect path.
        if (impl.postConnect) {
          try {
            c.executionCtx.waitUntil(
              impl.postConnect(c, user, row).catch((e: Error) => {
                console.warn('[integrations] postConnect (oauth_callback) failed', provider, e.message);
              }),
            );
          } catch { /* executionCtx may be missing in some test contexts */ }
        }
      }
    } finally {
      await sql.end();
    }
    return c.redirect(returnQuery(consumed?.extra, `oauth=ok&provider=${encodeURIComponent(provider)}`));
  } catch (e) {
    // Best-effort failure log — we may not have an integrations row to
    // attach to (the connect threw before insert), so skip integration_logs
    // and only emit a best-effort activity_logs row.
    try {
      const actorHash = await hashEmail(user.email);
      await c.env.DB.prepare(
        'INSERT INTO activity_logs (user_id, actor, action, details) VALUES (?, ?, ?, ?)',
      ).bind(user.id, actorHash, 'integration_oauth_failed', JSON.stringify({ provider_key: provider, message: (e as Error).message?.slice(0, 200) })).run();
    } catch { /* non-fatal */ }
    // Sanitize the error code: only emit the first token (canonical
    // snake_case reason like `hubspot_token_exchange_failed`) and drop
    // any HTTP body / inner detail that callers shouldn't see and that
    // could otherwise reflect attacker-controlled content back into the
    // UI's query string.
    const rawMsg = (e as Error).message || 'callback_failed';
    // D751: a client that went missing mid-flow reads as not configured, not refused.
    const code = /_oauth_unconfigured/.test(rawMsg) ? 'not_configured'
      : /^[a-z0-9_]+$/i.test(rawMsg.split(/[:\s]/)[0])
        ? rawMsg.split(/[:\s]/)[0].slice(0, 64)
        : 'callback_failed';
    return c.redirect(returnQuery(consumed?.extra, `oauth=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent(code)}`));
  }
});

export default integrations;
