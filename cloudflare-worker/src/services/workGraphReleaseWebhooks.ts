/**
 * D5585 part 20 (#5585, WorkGraph P1 under the #5577 epic): the signed-webhook external distribution channel. A Super
 * Admin registers a company's named webhooks (an https URL and the audiences it may carry); a published release's
 * `external_distribution` effect whose ref is `webhook:t<tenant>.c<company>.<name>` is POSTed there, signed, and a takedown
 * POSTs its withdrawal. It runs only inside part 3's drain (`WORK_GRAPH_RELEASE_DELIVERY=preview`), and the channel is
 * offered only when the Worker secret `RELEASE_WEBHOOK_SIGNING_KEY` is set. Decision:
 * `documentation/architecture/decisions/D5585-p20.md`.
 *
 * THE REQUEST. `POST <url>` with a JSON body of ids and digests only (part 6's `releaseRecord`, plus the event and
 * tenant and company), and the headers:
 *   X-StudioOS-Event        release.published | release.withdrawn
 *   X-StudioOS-Release-Key  the effect's idempotency key: a receiver must treat a repeat of it as the same delivery
 *   X-StudioOS-Signature    t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" under the signing key>
 * The receiver answers 2xx to accept. Redirects are not followed (a 3xx is a refusal); the URL and every address it
 * resolves to must be public (`publicHostRefusal`); a request waits at most 10 seconds.
 *
 * THE LEDGER. A receiver has no read API, so each accepted request is a row in `work_graph_release_webhook_sends`, and
 * the channel's `find` reads that ledger (always complete). A request whose answer is lost is not recorded, so the next
 * attempt sends it again under the same release key; the key is what makes that safe at the receiver.
 */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';
import { WORK_GRAPH_DEPS, type Cost } from './workGraphRevisions';
import { AUDIENCES, Meter, hashOf, keyOk, type Audience } from './workGraphReleases';
import { companyUnderOtherTenant } from './workGraphReleaseAuthorities';
import { ChannelError } from './eventSyndication/channelError';
import { publicHostRefusal } from './webFetch';
import type { DistributionRecord, ReleaseDistributionChannel } from './workGraphReleaseDistribution';

export const WEBHOOK_LIMITS = Object.freeze({ perCompany: 10, urlMax: 500, timeoutMs: 10_000 });
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** The URL as stored, or null: https, a public host name (no IP literal, no credentials, no fragment), at most 500. */
export function normaliseWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > WEBHOOK_LIMITS.urlMax) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^[0-9.]+$/.test(host)) return null;
  const s = u.toString();
  return s.length <= WEBHOOK_LIMITS.urlMax ? s : null;
}

/** The destination a ref names: `t<tenant>.c<company>.<name>`, so every call knows its own scope from the ref itself. */
export const webhookDestination = (scope: { tenantId: number; companyId: number }, name: string) => `t${scope.tenantId}.c${scope.companyId}.${name}`;
const parseDestination = (dest: string) => {
  const m = /^t([1-9][0-9]{0,15})\.c([1-9][0-9]{0,15})\.([a-z0-9-]{1,40})$/.exec(dest);
  return m && NAME.test(m[3]) ? { tenantId: Number(m[1]), companyId: Number(m[2]), name: m[3] } : null;
};

export interface Webhook { name: string; url: string | null; audiences: Audience[]; active: boolean; seq: number; changedByUserId: number; changedAt: string }

/** The company's webhooks now: each name's latest row, by name. */
export async function webhooksOf(env: Pick<Env, 'DB'>, m: Meter, scope: Scope): Promise<Webhook[]> {
  const rows = await m.all<{ name: string; url: string | null; audiences_json: string; op: string; seq: number; actor_user_id: number; created_at: string }>(env.DB.prepare(
    `SELECT w.name, w.url, w.audiences_json, w.op, w.seq, w.actor_user_id, w.created_at FROM work_graph_release_webhooks w
      WHERE w.tenant_id = ? AND w.company_id = ?
        AND w.seq = (SELECT MAX(x.seq) FROM work_graph_release_webhooks x WHERE x.tenant_id = w.tenant_id AND x.company_id = w.company_id AND x.name = w.name)
      ORDER BY w.name`,
  ).bind(scope.tenantId, scope.companyId));
  return rows.map((r) => ({
    name: r.name, url: r.op === 'register' ? r.url : null, audiences: r.op === 'register' ? (JSON.parse(r.audiences_json) as Audience[]) : [],
    active: r.op === 'register', seq: Number(r.seq), changedByUserId: Number(r.actor_user_id), changedAt: r.created_at,
  }));
}

export interface WebhookChangeInput {
  scope: Scope; op: 'register' | 'disable'; name: string; url?: string | null; audiences?: string[];
  /** The `seq` of this webhook the Super Admin saw: 0 for a new name. */
  expectedSeq: number; actorUserId: number; idempotencyKey: string;
}
export type WebhookRefusalCode =
  | 'malformed' | 'webhook_invalid' | 'wrong_tenant' | 'stale_webhook' | 'not_registered' | 'webhook_limit' | 'idempotency_conflict';
export type WebhookChangeResult =
  | { ok: true; op: 'register' | 'disable'; name: string; seq: number; replayed: boolean; cost: Cost }
  | { ok: false; code: WebhookRefusalCode; ids: string[]; current?: Webhook | null; cost: Cost };

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/** Register (or re-register with a new URL or audiences) or disable one named webhook, from the `seq` seen. */
export async function changeWebhook(env: Pick<Env, 'DB'>, input: WebhookChangeInput): Promise<WebhookChangeResult> {
  const m = new Meter(env);
  const no = (code: WebhookRefusalCode, ids: string[], current?: Webhook | null): WebhookChangeResult =>
    ({ ok: false, code, ids, cost: { ...m.cost }, ...(current !== undefined ? { current } : {}) });
  if (!input?.scope || !posInt(input.scope.tenantId) || !posInt(input.scope.companyId) || (input.op !== 'register' && input.op !== 'disable')
    || typeof input.name !== 'string' || !posInt(input.actorUserId) || !keyOk(input.idempotencyKey)
    || !Number.isSafeInteger(input.expectedSeq) || input.expectedSeq < 0) {
    return no('malformed', []);
  }
  if (!NAME.test(input.name)) return no('webhook_invalid', [String(input.name).slice(0, 40)]);
  let url: string | null = null;
  let audiences: Audience[] = [];
  if (input.op === 'register') {
    url = normaliseWebhookUrl(input.url);
    const raw = Array.isArray(input.audiences) ? input.audiences : null;
    if (!url || !raw || !raw.length || raw.some((a) => !(AUDIENCES as readonly string[]).includes(a))) return no('webhook_invalid', [input.name]);
    audiences = [...new Set(raw as Audience[])].sort();
  }
  const { tenantId, companyId } = input.scope;
  const requestHash = await hashOf({ op: `webhook_${input.op}`, name: input.name, url, audiences, expectedSeq: input.expectedSeq });
  const replay = async (): Promise<WebhookChangeResult | null> => {
    const prior = await m.first<{ op: 'register' | 'disable'; name: string; seq: number; request_hash: string }>(env.DB.prepare(
      'SELECT op, name, seq, request_hash FROM work_graph_release_webhooks WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
    ).bind(tenantId, companyId, input.idempotencyKey));
    if (!prior) return null;
    return prior.request_hash === requestHash
      ? { ok: true, op: prior.op, name: prior.name, seq: Number(prior.seq), replayed: true, cost: { ...m.cost } }
      : no('idempotency_conflict', [input.name]);
  };
  const first = await replay();
  if (first) return first;
  if (await companyUnderOtherTenant(env, m, input.scope)) return no('wrong_tenant', [String(companyId)]);

  const all = await webhooksOf(env, m, input.scope);
  const current = all.find((w) => w.name === input.name) ?? null;
  if ((current?.seq ?? 0) !== input.expectedSeq) return no('stale_webhook', [input.name], current);
  if (input.op === 'disable' && !current?.active) return no('not_registered', [input.name], current);
  if (input.op === 'register' && !current?.active && all.filter((w) => w.active).length >= WEBHOOK_LIMITS.perCompany) return no('webhook_limit', [input.name]);

  const seq = (current?.seq ?? 0) + 1;
  try {
    const res = await m.run(env.DB.prepare(
      `INSERT INTO work_graph_release_webhooks (tenant_id, company_id, name, seq, op, url, audiences_json, actor_user_id, idempotency_key, request_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT MAX(x.seq) FROM work_graph_release_webhooks x WHERE x.tenant_id = ? AND x.company_id = ? AND x.name = ?), 0) = ?`,
    ).bind(tenantId, companyId, input.name, seq, input.op, url, JSON.stringify(audiences), input.actorUserId, input.idempotencyKey, requestHash,
      WORK_GRAPH_DEPS.now().toISOString(), tenantId, companyId, input.name, seq - 1));
    if (!res.meta?.changes) {
      const later = (await webhooksOf(env, m, input.scope)).find((w) => w.name === input.name) ?? null;
      return no('stale_webhook', [input.name], later);
    }
    return { ok: true, op: input.op, name: input.name, seq, replayed: false, cost: { ...m.cost } };
  } catch (e) {
    const again = await replay();
    if (again) return again;
    throw e;
  }
}

/** The receiver's signature header for one body: `t=<unix>,v1=<hex HMAC-SHA256("<t>.<body>")>`. */
export async function webhookSignature(key: string, unixSeconds: number, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${unixSeconds}.${body}`)));
  return `t=${unixSeconds},v1=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** What the channel needs from outside, replaceable in tests. */
export const WEBHOOK_DEPS = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
  hostRefusal: (url: string) => publicHostRefusal(url),
  nowSeconds: () => Math.floor(WORK_GRAPH_DEPS.now().getTime() / 1000),
};

/**
 * The webhook channel over the env's D1 and signing key, or null when no key is set (the channel is then not offered,
 * and an effect naming it refuses `target_not_configured`, as before part 20).
 */
export function webhookChannel(env: Pick<Env, 'DB' | 'RELEASE_WEBHOOK_SIGNING_KEY'>): ReleaseDistributionChannel | null {
  const key = env.RELEASE_WEBHOOK_SIGNING_KEY;
  if (typeof key !== 'string' || key.length < 32) return null;
  const meter = new Meter(env);
  const scopeOf = (dest: string) => {
    const d = parseDestination(dest);
    if (!d) throw new ChannelError('not a webhook destination', 400);
    return d;
  };
  const registration = async (dest: string) => {
    const d = scopeOf(dest);
    const w = (await webhooksOf(env, meter, { tenantId: d.tenantId, companyId: d.companyId, projectId: null })).find((x) => x.name === d.name);
    if (!w?.active || !w.url) throw new ChannelError('webhook not registered', 404);
    return { ...d, url: w.url, audiences: w.audiences };
  };
  const send = async (url: string, event: 'release.published' | 'release.withdrawn', releaseKey: string, payload: unknown) => {
    if (await WEBHOOK_DEPS.hostRefusal(url)) throw new ChannelError('webhook host refused', 400);
    const body = JSON.stringify(payload);
    const signature = await webhookSignature(key, WEBHOOK_DEPS.nowSeconds(), body);
    let res: Response;
    try {
      res = await WEBHOOK_DEPS.fetch(url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(WEBHOOK_LIMITS.timeoutMs), body,
        headers: { 'Content-Type': 'application/json', 'X-StudioOS-Event': event, 'X-StudioOS-Release-Key': releaseKey, 'X-StudioOS-Signature': signature },
      });
    } catch {
      throw new ChannelError('webhook unreachable', 503);
    }
    try { await res.body?.cancel(); } catch { /* nothing to release */ }
    if (res.status >= 200 && res.status < 300) return res.status;
    // Anything but 2xx is the receiver's answer, a redirect included: `redirect: 'manual'` never follows one, so a signed
    // POST is never re-sent somewhere else, and part 6's adapter refuses a 3xx as `provider_rejected`.
    throw new ChannelError(`webhook answered ${res.status}`, res.status);
  };
  const ledger = async (scope: { tenantId: number; companyId: number }, name: string, where: 'key' | 'manifest', value: string): Promise<DistributionRecord[]> => {
    const rows = await meter.all<{ external_id: string; release_key: string; manifest_uid: string; digest: string }>(env.DB.prepare(
      `SELECT s.external_id, s.release_key, s.manifest_uid, s.digest FROM work_graph_release_webhook_sends s
        WHERE s.tenant_id = ? AND s.company_id = ? AND s.name = ? AND s.event = 'published'
          AND ((? = 'key' AND s.release_key = ?) OR (? = 'manifest' AND s.manifest_uid = ?))
          AND NOT EXISTS (SELECT 1 FROM work_graph_release_webhook_sends w
                           WHERE w.tenant_id = s.tenant_id AND w.company_id = s.company_id AND w.name = s.name
                             AND w.event = 'withdrawn' AND w.external_id = s.external_id)
        ORDER BY s.id`,
    ).bind(scope.tenantId, scope.companyId, name, where, value, where, value));
    return rows.map((r) => ({ externalId: r.external_id, key: r.release_key, manifestUid: r.manifest_uid, digest: r.digest, ...scope }));
  };
  const record = (scope: { tenantId: number; companyId: number }, name: string, event: 'published' | 'withdrawn', x: { externalId: string; key: string; manifestUid: string; digest: string }, status: number) =>
    meter.run(env.DB.prepare(
      `INSERT INTO work_graph_release_webhook_sends (tenant_id, company_id, name, event, external_id, release_key, manifest_uid, digest, http_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, company_id, name, event, external_id) DO NOTHING`,
    ).bind(scope.tenantId, scope.companyId, name, event, x.externalId, x.key, x.manifestUid, x.digest, status, WORK_GRAPH_DEPS.now().toISOString()));

  // Every call takes its scope from the destination; `owns` (which the adapter checks first) ties it to the effect's.
  return {
    audiences: AUDIENCES,
    owns(dest, scope) {
      const d = parseDestination(dest);
      return !!d && d.tenantId === scope.tenantId && d.companyId === scope.companyId;
    },
    async find(dest, q) {
      const d = scopeOf(dest);
      const scope = { tenantId: d.tenantId, companyId: d.companyId };
      const records = 'key' in q ? await ledger(scope, d.name, 'key', q.key) : await ledger(scope, d.name, 'manifest', q.manifestUid);
      return { complete: true, records };
    },
    async post(dest, rec) {
      const r = await registration(dest);
      if (r.tenantId !== rec.tenantId || r.companyId !== rec.companyId) throw new ChannelError('not a destination of this company', 403);
      const scope = { tenantId: r.tenantId, companyId: r.companyId };
      if (!r.audiences.includes(rec.audience as Audience)) throw new ChannelError('audience not allowed on this webhook', 422);
      const externalId = `wh_${(await hashOf({ dest, key: rec.release_key })).slice(0, 32)}`;
      const status = await send(r.url, 'release.published', rec.release_key, { event: 'release.published', id: externalId, ...rec });
      await record(scope, r.name, 'published', { externalId, key: rec.release_key, manifestUid: rec.manifest, digest: rec.digest }, status);
      return { externalId, key: rec.release_key, manifestUid: rec.manifest, digest: rec.digest, ...scope };
    },
    async withdraw(dest, externalId) {
      const r = await registration(dest);
      const scope = { tenantId: r.tenantId, companyId: r.companyId };
      const sent = (await meter.all<{ release_key: string; manifest_uid: string; digest: string }>(env.DB.prepare(
        `SELECT release_key, manifest_uid, digest FROM work_graph_release_webhook_sends
          WHERE tenant_id = ? AND company_id = ? AND name = ? AND event = 'published' AND external_id = ?`,
      ).bind(scope.tenantId, scope.companyId, r.name, externalId)))[0];
      if (!sent) throw new ChannelError('nothing sent under this id', 404);
      const status = await send(r.url, 'release.withdrawn', sent.release_key,
        { event: 'release.withdrawn', id: externalId, release_key: sent.release_key, manifest: sent.manifest_uid, digest: sent.digest, ...scope });
      await record(scope, r.name, 'withdrawn', { externalId, key: sent.release_key, manifestUid: sent.manifest_uid, digest: sent.digest }, status);
    },
  };
}
