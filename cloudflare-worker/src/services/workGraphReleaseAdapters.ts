/**
 * D5585 part 3 (#5585, WorkGraph P1 under the #5577 epic) — the real provider adapters behind part 2's
 * `releaseEffectHandlers(adapters)`, and `drainReleaseEffects`, the one entry point that delivers release effects
 * through them. Preview-only: the drain delivers nothing unless `WORK_GRAPH_RELEASE_DELIVERY` is `preview`, and no cron,
 * queue consumer or route calls it. Decision: `documentation/architecture/decisions/D5585-p3.md`.
 *
 * WHAT EACH TARGET WRAPS (only integrations the Worker already has):
 *   github_pr     `services/githubSync.ts` (the ticket mirror's token and repository): a comment on the named pull
 *                 request, marked with the effect's idempotency key; retracted by deleting that comment.
 *   stream        the `STREAM` binding of `services/learningStream.ts`: the release is recorded on the named video's
 *                 `meta` under the effect's key, with signed playback kept on; retracted by removing that record.
 *   signed_document  `services/workGraphReleaseSigning.ts` (part 4, D5585-p4): an e-sign envelope the release owner
 *                 signs, through the native e-sign service; retracted by voiding it.
 *   website_cdn   `services/workGraphReleaseDistribution.ts` (part 6, D5585-p6): a write-once site record in WorkGraph's
 *                 prefix of the R2 `FILES` bucket, for a public release only; retracted by deleting it.
 *   external_distribution
 *                 `services/workGraphReleaseDistribution.ts` (part 6): over injected channels. None is registered on
 *                 main, so it refuses `target_not_configured` and calls nothing (D5585-p6 §2).
 *
 * EVERY ADAPTER:
 *   - reads its credentials from the existing bindings and refuses (`target_not_configured`) without a call when one
 *     is absent;
 *   - refuses a ref outside what those credentials reach (`ref_out_of_scope`) or not of its target's shape
 *     (`malformed_ref`), again without a call;
 *   - answers `lookup` from what the provider holds under the effect's key, reading everything before it says
 *     `absent` (a lookup it cannot finish is `lookup_incomplete`, so nothing is sent on a guess);
 *   - treats an answer that never came or a 5xx as unknown (`provider_unavailable`): the next attempt's `lookup`
 *     settles it, and part 2's handler never sends while a lookup has not said `absent`;
 *   - sends ids only: the manifest uid and digest, the audience and the pinned pieces' revisions, never content;
 *   - counts every provider request in the drain's meter (cost telemetry, beside part 2's delivery rows).
 */
import type { Env } from '../types';
import { webhookChannel } from './workGraphReleaseWebhooks';
import { deleteComment, fetchCommentsPage, githubConfigured, addComment, type GhResult } from './githubSync';
import { STREAM_UID_RE, streamOf } from './learningStream';
import { drainEffects, type DeliveryResult, type EffectHandler } from './workGraphEffects';
import type { BlobCost } from './workGraphBlobs';
import { EFFECT_TARGETS, type EffectTarget } from './workGraphReleases';
import { signedDocumentAdapter } from './workGraphReleaseSigning';
import {
  RELEASE_DISTRIBUTION_CHANNELS, externalDistributionAdapter, websiteCdnAdapter, type ReleaseDistributionChannels,
} from './workGraphReleaseDistribution';
import {
  DeliveryRetry, releaseEffectHandlers,
  type ReleaseAdapters, type ReleaseDeliveryAdapter, type ReleaseDeliveryRequest,
} from './workGraphReleaseDelivery';

/** The env value that turns the release drain on. Anything else, or unset, is off. */
export const RELEASE_DELIVERY_PREVIEW = 'preview';
export const RELEASE_ADAPTER_LIMITS = Object.freeze({ githubCommentPages: 10, githubPageSize: 100 });

/** Provider requests made through the adapters, by target: the drain's provider cost. */
export class ProviderMeter {
  requests = 0;
  byTarget: Record<EffectTarget, number> = Object.fromEntries(EFFECT_TARGETS.map((t) => [t, 0])) as Record<EffectTarget, number>;
  count(t: EffectTarget) { this.requests++; this.byTarget[t]++; }
}

const refuse = (code: string): never => { throw new DeliveryRetry(code); };

/** An adapter for a target the Worker has no integration for: every call refuses, and nothing is called. */
export function unconfiguredAdapter(): ReleaseDeliveryAdapter {
  return {
    lookup: async () => refuse('target_not_configured'),
    send: async () => refuse('target_not_configured'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// GitHub pull request: a comment on the PR, through the ticket mirror's helpers
// ---------------------------------------------------------------------------------------------------------------------

const PR_REF = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})#([1-9][0-9]{0,8})$/;
const keyMarker = (key: string) => `<!-- axal-release key=${key} -->`;
const manifestMarker = (uid: string) => `<!-- axal-release-manifest ${uid} -->`;

/** The comment a release leaves on its pull request: ids only (D600: the mirror's repository may be public). */
export function releaseCommentBody(req: ReleaseDeliveryRequest): string {
  return [
    `StudioOS release \`${req.manifestUid}\` was published for this pull request.`,
    '',
    `- Manifest digest: \`sha256:${req.digest}\``,
    `- Audience: ${req.audience ?? 'none'}`,
    `- Pinned pieces: ${req.components.length}`,
    '',
    keyMarker(req.idempotencyKey),
    manifestMarker(req.manifestUid),
  ].join('\n');
}

const unknownOutcome = (r: GhResult) => r.status === 0 || r.status >= 500;

export function githubPrAdapter(env: Env, meter: ProviderMeter): ReleaseDeliveryAdapter {
  const pr = (req: ReleaseDeliveryRequest): number => {
    if (!githubConfigured(env)) refuse('target_not_configured');
    const m = PR_REF.exec(req.ref);
    if (!m) refuse('malformed_ref');
    const [, owner, repo, num] = m!;
    // The token reaches the mirror's repository only (`ghFetch` builds every URL from it).
    if (owner.toLowerCase() !== String(env.GITHUB_REPO_OWNER).toLowerCase() || repo.toLowerCase() !== String(env.GITHUB_REPO_NAME).toLowerCase()) {
      refuse('ref_out_of_scope');
    }
    return Number(num);
  };
  /** Every comment on the PR that carries `marker`, reading all pages before answering. */
  const find = async (n: number, marker: string): Promise<number[]> => {
    const ids: number[] = [];
    for (let page = 1; page <= RELEASE_ADAPTER_LIMITS.githubCommentPages; page++) {
      meter.count('github_pr');
      const r = await fetchCommentsPage(env, n, page);
      if (!r.ok) {
        if (unknownOutcome(r)) refuse('provider_unavailable');
        refuse(r.status === 401 || r.status === 403 ? 'provider_unauthorized' : 'provider_rejected');
      }
      const list = Array.isArray(r.data) ? r.data : refuse('provider_malformed');
      for (const c of list as Array<{ id?: unknown; body?: unknown }>) {
        if (typeof c?.body === 'string' && c.body.includes(marker) && Number.isSafeInteger(c.id)) ids.push(c.id as number);
      }
      if (list.length < RELEASE_ADAPTER_LIMITS.githubPageSize) return ids;
    }
    return refuse('lookup_incomplete');
  };
  const ref = (id: number) => `github:comment:${id}`;
  return {
    async lookup(req) {
      const n = pr(req);
      if (req.op === 'publish') {
        const [id] = await find(n, keyMarker(req.idempotencyKey));
        return id ? { status: 'confirmed', externalRef: ref(id) } : { status: 'absent' };
      }
      // A retraction is done once no comment of this manifest is left on the PR.
      return (await find(n, manifestMarker(req.manifestUid))).length ? { status: 'absent' } : { status: 'confirmed', externalRef: null };
    },
    async send(req) {
      const n = pr(req);
      if (req.op === 'publish') {
        meter.count('github_pr');
        // Sent once (`retry: false`): a create that timed out may have landed, and the next lookup finds it.
        const r = await addComment(env, n, releaseCommentBody(req), { retry: false });
        if (r.ok && Number.isSafeInteger(r.data?.id)) return { status: 'confirmed', externalRef: ref(r.data.id) };
        if (r.ok || unknownOutcome(r)) refuse('provider_unavailable');
        return refuse(r.status === 401 || r.status === 403 ? 'provider_unauthorized' : 'provider_rejected');
      }
      const ids = await find(n, manifestMarker(req.manifestUid));
      if (!ids.length) return { status: 'absent' };
      for (const id of ids) {
        meter.count('github_pr');
        const r = await deleteComment(env, id);
        if (r.ok || r.status === 404) continue; // 404: already gone
        if (unknownOutcome(r)) refuse('provider_unavailable');
        refuse(r.status === 401 || r.status === 403 ? 'provider_unauthorized' : 'provider_rejected');
      }
      return { status: 'confirmed', externalRef: ref(ids[0]) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cloudflare Stream: the release recorded on the video, through the STREAM binding
// ---------------------------------------------------------------------------------------------------------------------

/** The `meta` fields a release writes on its video. Ids only. */
export const STREAM_META = Object.freeze({ key: 'studioos_release_key', manifest: 'studioos_release_manifest', digest: 'studioos_release_digest' });

export function streamAdapter(env: Env, meter: ProviderMeter): ReleaseDeliveryAdapter {
  const video = (req: ReleaseDeliveryRequest) => {
    const s = streamOf(env);
    if (!s) refuse('target_not_configured');
    if (!STREAM_UID_RE.test(req.ref)) refuse('malformed_ref');
    return s!.video(req.ref);
  };
  const call = async <T>(f: () => Promise<T>): Promise<T> => {
    meter.count('stream');
    try { return await f(); } catch { return refuse('provider_unavailable'); }
  };
  const metaOf = (d: any): Record<string, unknown> => (d && typeof d.meta === 'object' && d.meta ? { ...d.meta } : {});
  const withoutRelease = (meta: Record<string, unknown>) => {
    for (const k of Object.values(STREAM_META)) delete meta[k];
    return meta;
  };
  const ext = (uid: string) => `stream:${uid}`;
  return {
    async lookup(req) {
      const v = video(req);
      const meta = metaOf(await call(() => v.details()));
      if (req.op === 'publish') {
        return meta[STREAM_META.key] === req.idempotencyKey ? { status: 'confirmed', externalRef: ext(req.ref) } : { status: 'absent' };
      }
      return meta[STREAM_META.manifest] === req.manifestUid ? { status: 'absent' } : { status: 'confirmed', externalRef: null };
    },
    async send(req) {
      const v = video(req);
      const meta = metaOf(await call(() => v.details()));
      if (req.op === 'publish') {
        // Signed playback stays on: who may play the video is still the Worker's to decide, token by token.
        await call(() => v.update({
          requireSignedURLs: true,
          meta: { ...withoutRelease(meta), [STREAM_META.key]: req.idempotencyKey, [STREAM_META.manifest]: req.manifestUid, [STREAM_META.digest]: req.digest },
        }));
        return { status: 'confirmed', externalRef: ext(req.ref) };
      }
      if (meta[STREAM_META.manifest] !== req.manifestUid) return { status: 'absent' };
      await call(() => v.update({ requireSignedURLs: true, meta: withoutRelease(meta) }));
      return { status: 'confirmed', externalRef: ext(req.ref) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The adapters and the drain
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Part 20 (D5585-p20): the distribution channels this env offers. The signed webhook, only while its signing key is
 * set; otherwise none, as on main before part 20 (`RELEASE_DISTRIBUTION_CHANNELS`).
 */
export function releaseDistributionChannels(env: Env): ReleaseDistributionChannels {
  const webhook = webhookChannel(env);
  return webhook ? Object.freeze({ ...RELEASE_DISTRIBUTION_CHANNELS, webhook }) : RELEASE_DISTRIBUTION_CHANNELS;
}

/**
 * The real adapter of every target, over the env's existing bindings. `channels` are the external distribution
 * channels: none on main (D5585-p6 §2), so that target refuses `target_not_configured`; tests inject fakes.
 */
export function releaseAdapters(env: Env, meter: ProviderMeter, channels: ReleaseDistributionChannels = releaseDistributionChannels(env)): Required<ReleaseAdapters> {
  return {
    github_pr: githubPrAdapter(env, meter),
    stream: streamAdapter(env, meter),
    signed_document: signedDocumentAdapter(env, meter),
    website_cdn: websiteCdnAdapter(env, meter),
    external_distribution: externalDistributionAdapter(channels, meter),
  };
}

export const releaseDeliveryEnabled = (env: Pick<Env, 'WORK_GRAPH_RELEASE_DELIVERY'>) => env.WORK_GRAPH_RELEASE_DELIVERY === RELEASE_DELIVERY_PREVIEW;

export type ReleaseDrainResult =
  | { ok: false; code: 'release_delivery_off' }
  | { ok: true; results: DeliveryResult[]; cost: BlobCost; providerRequests: number; providerRequestsByTarget: Record<EffectTarget, number> };

/**
 * Deliver the due release effects through the real adapters. Off unless `WORK_GRAPH_RELEASE_DELIVERY` is `preview`:
 * off, it reads nothing and calls nothing. `handlers` are the caller's handlers for other kinds; the release handlers
 * are merged over them (a release kind is always handled by part 2's checks) and the drain claims only kinds the merged
 * map handles, so an effect of a kind it does not know is left pending, never dead-lettered. `adapters` replaces the
 * real ones (tests). Not scheduled: D5585-p3 §4 says how it would be, after the owner's approval.
 */
export async function drainReleaseEffects(
  env: Env,
  opts: {
    limit?: number; handlers?: Readonly<Record<string, EffectHandler>>; adapters?: ReleaseAdapters;
    /** External distribution channels for the real adapter (tests; none on main). */
    distributionChannels?: ReleaseDistributionChannels;
  } = {},
): Promise<ReleaseDrainResult> {
  if (!releaseDeliveryEnabled(env)) return { ok: false, code: 'release_delivery_off' };
  const meter = new ProviderMeter();
  const map: Record<string, EffectHandler> = { ...(opts.handlers ?? {}), ...releaseEffectHandlers(opts.adapters ?? releaseAdapters(env, meter, opts.distributionChannels)) };
  const r = await drainEffects(env, map, { limit: opts.limit, kinds: Object.keys(map) });
  return { ok: true, results: r.results, cost: r.cost, providerRequests: meter.requests, providerRequestsByTarget: { ...meter.byTarget } };
}

