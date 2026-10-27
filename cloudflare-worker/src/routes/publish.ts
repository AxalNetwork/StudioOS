/**
 * D1319 (#3480, part 1 of #2400) — `/api/publish`: founder publishing to an
 * outside service. Draft, preview, check, confirm, send, record, retract.
 * The rules are `services/publishCore.ts`'s; this file reads the request,
 * loads the rows the member may touch, and answers each refusal with its
 * code and our sentence.
 *
 *   GET    /destinations?project=                  the viewer's publish-capable connections and their places
 *   POST   /destinations/refresh/:integrationUid   { project } re-read the places the adapter lists
 *   PUT    /destinations/:uid?project=             { enabled, daily_cap? } by the connection's owner; logged
 *   POST   /drafts                                 { project_id, module, source_refs?, text? }
 *   GET    /drafts/:uid                            the venture's team
 *   PUT    /drafts/:uid                            { text?, per_destination?, alt_texts?, team_only_included?, named_consent? }
 *   DELETE /drafts/:uid                            archive
 *   POST   /drafts/:uid/preview                    { destination_uids } previews, check and envelope_hash per place
 *   POST   /drafts/:uid/confirm                    { destination_uid, envelope_hash, idempotency_key }
 *   GET    /sends?project=&module=&provider=&status=, GET /sends/:uid   the history; text for the team only
 *   POST   /sends/:uid/retry | /check | /mark-not-sent | /retract | /mark-removed
 *
 * WHO. Writes and sends: the venture's founder through their own connection,
 * never a support session (`canPublish`). Reads: the venture's team
 * (`isTeamViewer`). Use this draft (Eadwyn's proposal, part 4) and the Grow
 * draft builders (part 2) are not built here: a draft holds the founder's
 * own words.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { isSupportSession } from '../integrations/providers/mercury';
import { getProviderImpl, type IntegrationRow } from '../integrations/registry';
import { publishTarget, PUBLISH_DAILY_CAP } from '../integrations/publishTargets';
import { PUBLISH_MODULES } from '../integrations/publishSources';
import { isTeamViewer } from '../services/mercury/growFeeds';
import {
  PublishRefusal, canPublish, checkSend, confirmSend, markNotSent, markRemoved, previewFor, refused, releaseStrandedSends,
  retractSend, retrySend, sendView, type DestinationRow, type DraftRow, type SendRow,
} from '../services/publishCore';

const publish = new Hono<{ Bindings: Env }>();

type Ctx = { user: User; support: boolean };
const handle = (fn: (c: any, ctx: Ctx) => Promise<Response>) => async (c: any) => {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  try {
    return await fn(c, { user, support: await isSupportSession(c) });
  } catch (e) {
    if (e instanceof PublishRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence, audience: 'member' });
    console.error('[publish] request failed', (e as Error)?.name);
    return refuse(c, 500, { code: 'publish_failed', message: 'Publishing could not finish that request. Nothing was sent.', raw: e, audience: 'member' });
  }
};
const body = async (c: any): Promise<Record<string, any>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};
const idOf = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw refused('invalid');
  return n;
};
const loadIntegration = (env: Env, id: number) => env.DB.prepare('SELECT * FROM integrations WHERE id = ?').bind(id).first<IntegrationRow>();

async function team(env: Env, user: User, projectId: number) {
  if (!(await isTeamViewer(env, user, projectId))) throw refused('not_found');
}
async function draftOf(env: Env, uid: string): Promise<DraftRow> {
  const d = await env.DB.prepare('SELECT * FROM publish_drafts WHERE uid = ?').bind(String(uid)).first<DraftRow>();
  if (!d) throw refused('not_found');
  return d;
}
async function destinationOf(env: Env, uid: string): Promise<DestinationRow> {
  const d = await env.DB.prepare('SELECT * FROM publish_destinations WHERE uid = ?').bind(String(uid)).first<DestinationRow>();
  if (!d) throw refused('not_found');
  return d;
}
async function sendOf(env: Env, user: User, uid: string): Promise<SendRow> {
  const s = await env.DB.prepare('SELECT * FROM publish_sends WHERE uid = ?').bind(String(uid)).first<SendRow>();
  if (!s) throw refused('not_found');
  await team(env, user, s.project_id);
  await releaseStrandedSends(env, s.project_id);
  return (await env.DB.prepare('SELECT * FROM publish_sends WHERE id = ?').bind(s.id).first<SendRow>())!;
}
const draftView = (d: DraftRow) => {
  const parse = (raw: string, fb: unknown) => { try { return JSON.parse(raw); } catch { return fb; } };
  return {
    uid: d.uid, project_id: d.project_id, module: d.module, status: d.status, body: parse(d.body_json, { text: '', per_destination: {} }),
    source_refs: parse(d.source_refs_json, []), alt_texts: parse(d.alt_texts, []), team_only_included: Number(d.team_only_included) === 1,
    named_consent: parse(d.named_consent_json, []),
  };
};
const destinationView = (d: DestinationRow) => {
  const target = publishTarget(d.provider_key);
  return {
    uid: d.uid, provider_key: d.provider_key, account: d.display_name, audience: d.audience_label ?? target?.audience ?? null,
    enabled: Number(d.enabled) === 1, daily_cap: d.daily_cap ?? PUBLISH_DAILY_CAP, cap_ceiling: PUBLISH_DAILY_CAP, retract: target?.retract ?? 'unknown',
  };
};

// ---------------------------------------------------------------- destinations

publish.get('/destinations', handle(async (c, ctx) => {
  const projectId = idOf(c.req.query('project'));
  await team(c.env, ctx.user, projectId);
  const project = await c.env.DB.prepare('SELECT company_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first();
  const rows = (await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND status = 'active' ORDER BY id").bind(ctx.user.id).all()).results || [];
  const connections = [];
  for (const row of rows as IntegrationRow[]) {
    if (!publishTarget(row.provider_key) || !getProviderImpl(row.provider_key)?.publish) continue;
    const dests = project?.company_id == null ? [] : ((await c.env.DB.prepare('SELECT * FROM publish_destinations WHERE integration_id = ? AND company_id = ? ORDER BY id')
      .bind(row.id, project.company_id).all()).results || []) as DestinationRow[];
    connections.push({ uid: row.uid, provider_key: row.provider_key, destinations: dests.map(destinationView) });
  }
  let canPublishHere = true;
  try { await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId }); } catch { canPublishHere = false; }
  return c.json({ can_publish: canPublishHere, connections });
}));

publish.post('/destinations/refresh/:integrationUid', handle(async (c, ctx) => {
  const b = await body(c);
  const projectId = idOf(b.project);
  const integration = await c.env.DB.prepare('SELECT * FROM integrations WHERE uid = ?').bind(String(c.req.param('integrationUid'))).first<IntegrationRow>();
  await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId, integration: integration ?? null });
  const impl = getProviderImpl(integration!.provider_key);
  if (!publishTarget(integration!.provider_key) || !impl?.listDestinations) throw refused('not_publishable');
  const project = await c.env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(projectId).first<{ company_id: number }>();
  const listed = (await impl.listDestinations(c.env, integration!)).slice(0, 50);
  const ok = listed.filter((d) => typeof d?.external_account_id === 'string' && d.external_account_id && typeof d.display_name === 'string' && d.display_name);
  if (ok.length) {
    // New places arrive off; a place already here keeps its switch.
    await c.env.DB.batch(ok.map((d) => c.env.DB.prepare(
      `INSERT INTO publish_destinations (uid, integration_id, company_id, provider_key, external_account_id, display_name, audience_label)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (integration_id, company_id, external_account_id) DO UPDATE SET display_name = excluded.display_name, audience_label = excluded.audience_label, updated_at = datetime('now')`,
    ).bind(crypto.randomUUID(), integration!.id, project!.company_id, integration!.provider_key, d.external_account_id.slice(0, 200), d.display_name.slice(0, 200), d.audience_label ? String(d.audience_label).slice(0, 200) : null)));
  }
  return c.json({ listed: ok.length });
}));

publish.put('/destinations/:uid', handle(async (c, ctx) => {
  const projectId = idOf(c.req.query('project'));
  const dest = await destinationOf(c.env, c.req.param('uid'));
  const integration = await loadIntegration(c.env, dest.integration_id);
  await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId, integration });
  const project = await c.env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(projectId).first<{ company_id: number }>();
  if (Number(project?.company_id) !== Number(dest.company_id)) throw refused('not_found');
  const b = await body(c);
  if (typeof b.enabled !== 'boolean') throw refused('invalid');
  let cap: number | null = dest.daily_cap;
  if ('daily_cap' in b) {
    if (b.daily_cap === null) cap = null;
    else if (!Number.isSafeInteger(b.daily_cap) || b.daily_cap < 1 || b.daily_cap > PUBLISH_DAILY_CAP) throw refused('invalid');
    else cap = b.daily_cap;
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE publish_destinations SET enabled = ?, enabled_by = CASE WHEN ? = 1 THEN ? ELSE enabled_by END, enabled_at = CASE WHEN ? = 1 THEN datetime('now') ELSE enabled_at END,
              daily_cap = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(b.enabled ? 1 : 0, b.enabled ? 1 : 0, ctx.user.id, b.enabled ? 1 : 0, cap, dest.id),
    c.env.DB.prepare(`INSERT INTO activity_logs (project_id, user_id, actor, action, details, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, 'publish_destination', ?)`)
      .bind(projectId, ctx.user.id, `user:${ctx.user.id}`, b.enabled ? 'publish_destination_on' : 'publish_destination_off', cap == null ? null : `daily cap ${cap}`, dest.uid),
  ]);
  return c.json({ destination: destinationView((await destinationOf(c.env, dest.uid))) });
}));

// ---------------------------------------------------------------- drafts

publish.post('/drafts', handle(async (c, ctx) => {
  const b = await body(c);
  const projectId = idOf(b.project_id);
  await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId });
  if (!(PUBLISH_MODULES as readonly string[]).includes(String(b.module))) throw refused('invalid');
  const refs = Array.isArray(b.source_refs) ? b.source_refs.slice(0, 50) : [];
  const text = typeof b.text === 'string' ? b.text.slice(0, 20_000) : '';
  const project = await c.env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(projectId).first<{ company_id: number | null }>();
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO publish_drafts (uid, project_id, company_id, module, source_refs_json, author_user_id, body_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, projectId, project?.company_id ?? null, b.module, JSON.stringify(refs), ctx.user.id, JSON.stringify({ text, per_destination: {} })).run();
  return c.json({ draft: draftView(await draftOf(c.env, uid)) }, 201);
}));

publish.get('/drafts/:uid', handle(async (c, ctx) => {
  const d = await draftOf(c.env, c.req.param('uid'));
  await team(c.env, ctx.user, d.project_id);
  return c.json({ draft: draftView(d) });
}));

publish.put('/drafts/:uid', handle(async (c, ctx) => {
  const d = await draftOf(c.env, c.req.param('uid'));
  await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId: d.project_id });
  if (d.status !== 'draft') throw refused('wrong_state');
  const b = await body(c);
  const current = draftView(d).body as { text: string; per_destination: Record<string, string> };
  const text = typeof b.text === 'string' ? b.text.slice(0, 20_000) : current.text;
  const per = b.per_destination && typeof b.per_destination === 'object' && !Array.isArray(b.per_destination)
    ? Object.fromEntries(Object.entries(b.per_destination).filter(([k, v]) => /^[0-9a-f-]{36}$/i.test(k) && typeof v === 'string').slice(0, 20).map(([k, v]) => [k, String(v).slice(0, 20_000)]))
    : current.per_destination;
  const alts = Array.isArray(b.alt_texts) ? b.alt_texts.filter((x: unknown) => typeof x === 'string').slice(0, 10).map((x: string) => x.slice(0, 1000)) : null;
  const consent = Array.isArray(b.named_consent) ? b.named_consent.map(Number).filter(Number.isSafeInteger).slice(0, 50) : null;
  await c.env.DB.prepare(
    `UPDATE publish_drafts SET body_json = ?, alt_texts = COALESCE(?, alt_texts), team_only_included = COALESCE(?, team_only_included),
            named_consent_json = COALESCE(?, named_consent_json), updated_at = datetime('now') WHERE id = ?`,
  ).bind(JSON.stringify({ text, per_destination: per }), alts ? JSON.stringify(alts) : null,
    typeof b.team_only_included === 'boolean' ? (b.team_only_included ? 1 : 0) : null, consent ? JSON.stringify(consent) : null, d.id).run();
  return c.json({ draft: draftView(await draftOf(c.env, d.uid)) });
}));

publish.delete('/drafts/:uid', handle(async (c, ctx) => {
  const d = await draftOf(c.env, c.req.param('uid'));
  await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId: d.project_id });
  await c.env.DB.prepare(`UPDATE publish_drafts SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).bind(d.id).run();
  return c.json({ archived: true });
}));

publish.post('/drafts/:uid/preview', handle(async (c, ctx) => {
  const d = await draftOf(c.env, c.req.param('uid'));
  await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId: d.project_id });
  const b = await body(c);
  const uids = Array.isArray(b.destination_uids) ? [...new Set(b.destination_uids.map(String))].slice(0, 10) : [];
  if (!uids.length) throw refused('invalid');
  const previews = [];
  for (const uid of uids) {
    const dest = await destinationOf(c.env, uid as string);
    const integration = await loadIntegration(c.env, dest.integration_id);
    await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId: d.project_id, integration, destination: dest });
    const p = await previewFor(c.env, d, dest, integration!);
    previews.push({ ...p, envelope: undefined });
  }
  return c.json({ previews });
}));

publish.post('/drafts/:uid/confirm', handle(async (c, ctx) => {
  const d = await draftOf(c.env, c.req.param('uid'));
  await team(c.env, ctx.user, d.project_id);
  const b = await body(c);
  const dest = await destinationOf(c.env, String(b.destination_uid ?? ''));
  const integration = await loadIntegration(c.env, dest.integration_id);
  const { row, repeated } = await confirmSend(c.env, ctx, d, dest, integration!, { envelope_hash: b.envelope_hash, idempotency_key: b.idempotency_key });
  return c.json({ send: sendView(row, true), repeated }, repeated ? 200 : 201);
}));

// ---------------------------------------------------------------- sends

const SEND_STATUSES = new Set(['ready', 'sending', 'sent', 'failed', 'unknown', 'retracted', 'removed_outside']);

publish.get('/sends', handle(async (c, ctx) => {
  const projectId = idOf(c.req.query('project'));
  await team(c.env, ctx.user, projectId);
  await releaseStrandedSends(c.env, projectId);
  const module = c.req.query('module') || null;
  const provider = c.req.query('provider') || null;
  const status = c.req.query('status') || null;
  if (status && !SEND_STATUSES.has(status)) throw refused('invalid');
  const rows = (await c.env.DB.prepare(
    `SELECT * FROM publish_sends WHERE project_id = ? AND (? IS NULL OR module = ?) AND (? IS NULL OR provider_key = ?) AND (? IS NULL OR status = ?)
      ORDER BY COALESCE(sent_at, confirmed_at) DESC, id DESC LIMIT 200`,
  ).bind(projectId, module, module, provider, provider, status, status).all()).results || [];
  return c.json({ sends: (rows as SendRow[]).map((r) => sendView(r, true)) });
}));

publish.get('/sends/:uid', handle(async (c, ctx) => c.json({ send: sendView(await sendOf(c.env, ctx.user, c.req.param('uid')), true) })));

/** A send action: the founder through the connection that sent it. */
async function act(c: any, ctx: Ctx) {
  const row = await sendOf(c.env, ctx.user, c.req.param('uid'));
  const dest = row.destination_id == null ? null : await c.env.DB.prepare('SELECT * FROM publish_destinations WHERE id = ?').bind(row.destination_id).first() as DestinationRow | null;
  const integration = dest ? await loadIntegration(c.env, dest.integration_id) : null;
  await canPublish(c.env, { user: ctx.user, support: ctx.support, projectId: row.project_id, ...(integration ? { integration } : {}) });
  return { row, dest, integration };
}

publish.post('/sends/:uid/retry', handle(async (c, ctx) => {
  const { row, dest, integration } = await act(c, ctx);
  if (!dest || !integration) throw refused('destination_off');
  const draft = (await c.env.DB.prepare('SELECT * FROM publish_drafts WHERE id = ?').bind(row.draft_id).first()) as DraftRow;
  return c.json({ send: sendView(await retrySend(c.env, ctx, row, draft, dest, integration), true) });
}));
publish.post('/sends/:uid/check', handle(async (c, ctx) => {
  const { row, integration } = await act(c, ctx);
  if (!integration) throw refused('reconnect_to_retract');
  const out = await checkSend(c.env, row, integration, ctx.user.id);
  return c.json({ send: sendView(out.row, true), found: out.found });
}));
publish.post('/sends/:uid/mark-not-sent', handle(async (c, ctx) => {
  const { row } = await act(c, ctx);
  return c.json({ send: sendView(await markNotSent(c.env, row, ctx.user.id), true) });
}));
publish.post('/sends/:uid/retract', handle(async (c, ctx) => {
  const { row, integration } = await act(c, ctx);
  const b = await body(c);
  return c.json({ send: sendView(await retractSend(c.env, row, integration, ctx.user.id, b.reason), true) });
}));
publish.post('/sends/:uid/mark-removed', handle(async (c, ctx) => {
  const { row } = await act(c, ctx);
  return c.json({ send: sendView(await markRemoved(c.env, row, ctx.user.id), true) });
}));

export default publish;
