/**
 * D5585 part 6 (#5585, WorkGraph P1 under the #5577 epic) — the `website_cdn` and `external_distribution` release
 * adapters, on part 2's `lookup` / `send` contract and part 3's rules. Preview-only, like every adapter: they run only
 * inside `drainReleaseEffects`, which is off unless `WORK_GRAPH_RELEASE_DELIVERY` is `preview`, and nothing schedules
 * it. No new binding, secret, route or flag. Decision: `documentation/architecture/decisions/D5585-p6.md`.
 *
 * WEBSITE / CDN (`websiteCdnAdapter`). The release's site record is written into the existing R2 `FILES` bucket under
 * its own prefix, `release-sites/t<tenant>/c<company>/<site>/<manifest>.json` (classed `replaceable` in the D6650
 * inventory; never under `wg/v1/`, whose record objects only #6651's helpers may write or delete, and never where
 * #5581's reconcile lists blobs). One write-once object per (site, manifest): a later release is
 * a new object, so a late effect can never overwrite a newer release's record, and which record a site shows is still
 * the line's publication pointer (`servedRelease`). The object holds ids only (manifest uid and digest, line, audience,
 * each pinned piece's asset, revision, digest and role) and carries the effect's key in its custom metadata, so
 * `lookup` is one `head`. A website is a public surface: a non-`public` audience is refused before any call. R2 is
 * private; serving the record at the edge is the Super-Admin route's part, after the owner's approval.
 *
 * EXTERNAL DISTRIBUTION (`externalDistributionAdapter`). The Worker has no outside channel a drain may send to without
 * a person's confirm (D5585-p3 §2), and adding one needs an account, a secret and the owner's approval. So the adapter
 * is built over injected `ReleaseDistributionChannel`s, keyed by the ref's channel (`<channel>:<destination>`). The
 * real registry is empty: every effect refuses `target_not_configured` and calls nothing, as before. Tests inject fakes.
 * The adapter, not the channel, enforces the rules: the destination must belong to the effect's tenant and company
 * (`ref_out_of_scope`), the channel must carry the audience (`audience_forbidden`), a record found under the key must
 * be the effect's own tenant and digest (`wrong_tenant`, `digest_conflict`), and absence must be proven by a complete
 * read (`lookup_incomplete`).
 *
 * Both count every provider request in the drain's meter, and throw part 2's `DeliveryRetry` codes, which the outbox
 * records (`effect_retry`, `effect_dead`) and retries with backoff.
 */
import type { Env } from '../types';
import { ChannelError } from './eventSyndication/channelError';
import { canonical, type Audience, type EffectTarget } from './workGraphReleases';
import { DeliveryRetry, type ReleaseDeliveryAdapter, type ReleaseDeliveryRequest } from './workGraphReleaseDelivery';

const refuse = (code: string): never => { throw new DeliveryRetry(code); };

/** What an adapter counts: one per provider request. */
export interface DistributionMeter { count(t: EffectTarget): void }

/** The ids a release sends to a website or a channel. Never content, never a source locator. */
export function releaseRecord(req: ReleaseDeliveryRequest) {
  return {
    v: 1, release_key: req.idempotencyKey, line: req.lineAssetUid, manifest: req.manifestUid, digest: req.digest, audience: req.audience,
    components: req.components.map((c) => ({ asset: c.asset, revision: c.revision, digest: c.digest, role: c.role })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Website / CDN: a write-once site record in WorkGraph's R2 prefix
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The site records' own prefix in `FILES`, classed `replaceable` in the D6650 inventory
 * (`documentation/operations/R2_INVENTORY.json`, `files-release-sites`): a record is regenerable from D1 (the manifest
 * and its delivery rows are the evidence), and a takedown deletes it. Never `wg/v1/`, whose objects are write-once
 * `record`s (D6651) that only `recordErasure.ts` may delete.
 */
export const SITE_RECORD_PREFIX = 'release-sites/';
/** A site's name: a DNS label. */
export const SITE_REF = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** The custom metadata a site record carries. */
export const SITE_META = Object.freeze({ key: 'studioos_release_key', manifest: 'studioos_release_manifest', digest: 'studioos_release_digest', tenant: 'studioos_tenant', company: 'studioos_company' });

export function siteRecordKey(req: Pick<ReleaseDeliveryRequest, 'tenantId' | 'companyId' | 'ref' | 'manifestUid'>): string {
  return `${SITE_RECORD_PREFIX}t${req.tenantId}/c${req.companyId}/${req.ref}/${req.manifestUid}.json`;
}

export function websiteCdnAdapter(env: Pick<Env, 'FILES'>, meter: DistributionMeter): ReleaseDeliveryAdapter {
  const objectKey = (req: ReleaseDeliveryRequest) => {
    if (!env.FILES) refuse('target_not_configured');
    if (!SITE_REF.test(req.ref) || !/^[A-Za-z0-9_-]{1,80}$/.test(req.manifestUid)) refuse('malformed_ref');
    if (!Number.isSafeInteger(req.tenantId) || req.tenantId <= 0 || !Number.isSafeInteger(req.companyId) || req.companyId <= 0) refuse('wrong_tenant');
    // A website is public: a release for any other audience never reaches one (part 1 refuses it at publication too).
    if (req.op === 'publish' && req.audience !== 'public') refuse('audience_forbidden');
    return siteRecordKey(req);
  };
  const call = async <T>(f: () => Promise<T>): Promise<T> => {
    meter.count('website_cdn');
    try { return await f(); } catch { return refuse('provider_unavailable'); }
  };
  /** The record under `key`, checked to be this tenant's and this release's; null when there is none. */
  const held = async (req: ReleaseDeliveryRequest, key: string) => {
    const o = await call(() => env.FILES!.head(key));
    if (!o) return null;
    const meta = o.customMetadata ?? {};
    if (meta[SITE_META.tenant] !== String(req.tenantId) || meta[SITE_META.company] !== String(req.companyId)) refuse('wrong_tenant');
    if (meta[SITE_META.manifest] !== req.manifestUid) refuse('provider_malformed');
    return meta;
  };
  const ext = (req: ReleaseDeliveryRequest) => `site:${req.ref}:${req.manifestUid}`;
  return {
    async lookup(req) {
      const key = objectKey(req);
      const meta = await held(req, key);
      if (req.op === 'retract') return meta ? { status: 'absent' } : { status: 'confirmed', externalRef: null };
      if (!meta) return { status: 'absent' };
      // Write-once: a record of this manifest under another key or digest is never overwritten, and never taken as ours.
      if (meta[SITE_META.key] !== req.idempotencyKey || meta[SITE_META.digest] !== req.digest) refuse('digest_conflict');
      return { status: 'confirmed', externalRef: ext(req) };
    },
    async send(req) {
      const key = objectKey(req);
      if (req.op === 'retract') {
        if (!(await held(req, key))) return { status: 'absent' };
        await call(() => env.FILES!.delete(key));
        return { status: 'confirmed', externalRef: ext(req) };
      }
      const body = canonical(releaseRecord(req));
      const put = await call(() => env.FILES!.put(key, body, {
        httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: {
          [SITE_META.key]: req.idempotencyKey, [SITE_META.manifest]: req.manifestUid, [SITE_META.digest]: req.digest,
          [SITE_META.tenant]: String(req.tenantId), [SITE_META.company]: String(req.companyId),
        },
      }));
      // No object back: the write's outcome is unknown, and the next attempt's lookup settles it.
      if (!put) refuse('provider_unavailable');
      return { status: 'confirmed', externalRef: ext(req) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// External distribution: injected channels, none registered on main
// ---------------------------------------------------------------------------------------------------------------------

/** What a channel holds for a release: its own id, and the tenant, key and digest it was sent under. */
export interface DistributionRecord { externalId: string; key: string; manifestUid: string; digest: string; tenantId: number; companyId: number }
/**
 * One outside channel. Its calls throw `ChannelError` with the platform's status on a refusal; anything else thrown is
 * an unknown outcome. `find` reads every record the destination holds for the key or manifest and says whether it read
 * them all.
 */
export interface ReleaseDistributionChannel {
  /** The audiences this channel may carry. */
  audiences: readonly Audience[];
  /** Whether this destination (an account, a list) belongs to the tenant and company. A configuration read, no request. */
  owns(destination: string, scope: { tenantId: number; companyId: number }): boolean;
  find(destination: string, q: { key: string } | { manifestUid: string }): Promise<{ complete: boolean; records: DistributionRecord[] }>;
  post(destination: string, record: ReturnType<typeof releaseRecord> & { tenantId: number; companyId: number }): Promise<DistributionRecord>;
  withdraw(destination: string, externalId: string): Promise<void>;
}
export type ReleaseDistributionChannels = Readonly<Record<string, ReleaseDistributionChannel>>;
/** The channels on main: none (D5585-p6 §2). A channel is added in its own task, with its account and the owner's approval. */
export const RELEASE_DISTRIBUTION_CHANNELS: ReleaseDistributionChannels = Object.freeze({});

export const DISTRIBUTION_REF = /^([a-z][a-z0-9_]{1,31}):([A-Za-z0-9][A-Za-z0-9_.-]{0,79})$/;

export function externalDistributionAdapter(channels: ReleaseDistributionChannels, meter: DistributionMeter): ReleaseDeliveryAdapter {
  const route = (req: ReleaseDeliveryRequest) => {
    if (!Object.keys(channels).length) refuse('target_not_configured');
    const m = DISTRIBUTION_REF.exec(req.ref);
    if (!m) refuse('malformed_ref');
    const channel = Object.prototype.hasOwnProperty.call(channels, m![1]) ? channels[m![1]] : null;
    if (!channel) refuse('target_not_configured');
    const scope = { tenantId: req.tenantId, companyId: req.companyId };
    if (!channel!.owns(m![2], scope)) refuse('ref_out_of_scope');
    if (req.op === 'publish' && (!req.audience || !channel!.audiences.includes(req.audience))) refuse('audience_forbidden');
    return { channel: channel!, name: m![1], dest: m![2] };
  };
  /** One channel request. A 404 answers `gone` only where the caller allows it (a withdraw); elsewhere it is a refusal. */
  const call = async <T>(f: () => Promise<T>, gone?: T): Promise<T> => {
    meter.count('external_distribution');
    try { return await f(); } catch (e) {
      const status = e instanceof ChannelError ? e.status ?? 0 : 0;
      if (status === 404 && gone !== undefined) return gone;
      if (!status || status >= 500 || status === 429) return refuse('provider_unavailable');
      return refuse(status === 401 || status === 403 ? 'provider_unauthorized' : 'provider_rejected');
    }
  };
  /** Every record of the query, all of them this tenant's; absence only after a complete read. */
  const find = async (req: ReleaseDeliveryRequest, r: ReturnType<typeof route>, q: { key: string } | { manifestUid: string }) => {
    const got = await call(() => r.channel.find(r.dest, q));
    if (!got || !Array.isArray(got.records)) return refuse('provider_malformed');
    if (got.records.some((x) => x.tenantId !== req.tenantId || x.companyId !== req.companyId)) refuse('wrong_tenant');
    if (!got.complete) refuse('lookup_incomplete');
    return got.records;
  };
  const ext = (name: string, id: string) => `dist:${name}:${id}`;
  return {
    async lookup(req) {
      const r = route(req);
      if (req.op === 'retract') return (await find(req, r, { manifestUid: req.manifestUid })).length ? { status: 'absent' } : { status: 'confirmed', externalRef: null };
      const [hit, ...more] = await find(req, r, { key: req.idempotencyKey });
      if (!hit) return { status: 'absent' };
      if (more.length || hit.key !== req.idempotencyKey || hit.manifestUid !== req.manifestUid || hit.digest !== req.digest) refuse('digest_conflict');
      return { status: 'confirmed', externalRef: ext(r.name, hit.externalId) };
    },
    async send(req) {
      const r = route(req);
      if (req.op === 'publish') {
        const out = await call(() => r.channel.post(r.dest, { ...releaseRecord(req), tenantId: req.tenantId, companyId: req.companyId }));
        if (!out || out.key !== req.idempotencyKey || typeof out.externalId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(out.externalId)) {
          return refuse('provider_malformed');
        }
        return { status: 'confirmed', externalRef: ext(r.name, out.externalId) };
      }
      const found = await find(req, r, { manifestUid: req.manifestUid });
      if (!found.length) return { status: 'absent' };
      for (const x of found) {
        await call(async () => { await r.channel.withdraw(r.dest, x.externalId); return 'withdrawn'; }, 'gone'); // 404: already withdrawn
      }
      return { status: 'confirmed', externalRef: ext(r.name, found[0].externalId) };
    },
  };
}
