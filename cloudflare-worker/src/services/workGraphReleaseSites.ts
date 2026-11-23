/**
 * D5585 part 9 (#5585, WorkGraph P1 under the #5577 epic) — the public read of a published release's site record: which
 * manifest a (tenant, company, site) shows now, and that manifest's ids-only record from `FILES`. OFF BY DEFAULT: unless
 * `WORK_GRAPH_RELEASE_SITES` is exactly `on`, the route (`routes/release_sites_public.ts`) refuses 404 before this file
 * is reached, so nothing here reads D1 or R2. Decision: `documentation/architecture/decisions/D5585-p9.md`.
 *
 * WHAT IT SERVES. Part 6's `website_cdn` adapter writes one write-once record per (site, manifest) under
 * `release-sites/t<tenant>/c<company>/<site>/<manifest>.json`. Which of them a site shows is never "the newest object":
 *   1. the site's release line is the line of the most recent `release_website_cdn` effect for that site in that exact
 *      tenant and company (the outbox row carries the line, `asset_uid`, and the site, `payload.ref`);
 *   2. what that line may serve is part 2's `servedRelease`: the manifest its publication pointer names, and nothing at
 *      all while a takedown covers it or one of its pinned revisions is tombstoned (`withdrawn`). It never falls back to
 *      an older manifest; a person re-pins one;
 *   3. the record read is that manifest's own key. If the pointer's manifest has no record for this site (not yet
 *      delivered, or published without this site), the answer is `not_delivered`, never the previous manifest's record;
 *   4. the record's R2 metadata must name the same tenant, company, manifest and digest, and its body the same manifest,
 *      digest, line and pinned pieces as the pointer's manifest in D1 (`record_mismatch` otherwise). The answer is
 *      rebuilt from the checked fields only: ids and digests, never content and never a source locator.
 *
 * SCOPE. The tenant and company come from the path and bind every read: the outbox query, `servedRelease`'s context
 * (`wrong_tenant` for a line of any other scope) and the R2 key. Another tenant's site of the same name is a different
 * outbox row and a different key, and is never read.
 *
 * COST. Every answer carries `cost: { d1Statements, d1Batches, r2Requests }`, like the other release reads.
 */
import type { Env } from '../types';
import type { Cost } from './workGraphRevisions';
import { Meter } from './workGraphReleases';
import { servedRelease } from './workGraphReleaseTakedowns';
import { SITE_META, SITE_REF, siteRecordKey } from './workGraphReleaseDistribution';

/** The value of `WORK_GRAPH_RELEASE_SITES` that turns the public read on. Unset, or anything else, is off. */
export const RELEASE_SITES_ON = 'on';
export const releaseSitesEnabled = (env: Pick<Env, 'WORK_GRAPH_RELEASE_SITES'>) => env.WORK_GRAPH_RELEASE_SITES === RELEASE_SITES_ON;

const ID = /^[1-9][0-9]{0,15}$/;
const MANIFEST = /^[A-Za-z0-9_-]{1,80}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export interface SiteAsk { tenant: string; company: string; site: string }

export interface SiteRecord {
  v: 1; line: string; manifest: string; digest: string; audience: 'public';
  components: { asset: string; revision: string; digest: string; role: string }[];
}

export type SiteReadCost = Cost & { r2Requests: number };
export type SiteRefusal = 'malformed' | 'not_found' | 'not_delivered' | 'withdrawn' | 'record_mismatch' | 'unavailable';
export type SiteReadResult =
  | { ok: true; tenantId: number; companyId: number; site: string; lineAssetUid: string; manifestUid: string; digest: string; headSeq: number; record: SiteRecord; cost: SiteReadCost }
  | { ok: false; code: SiteRefusal; cost: SiteReadCost };

/** The site record the pointer of the site's line names, checked against D1, or why there is none to show. */
export async function readPublishedSite(env: Pick<Env, 'DB' | 'FILES'>, ask: SiteAsk): Promise<SiteReadResult> {
  const m = new Meter(env);
  let r2Requests = 0;
  const cost = (): SiteReadCost => ({ ...m.cost, r2Requests });
  const no = (code: SiteRefusal): SiteReadResult => ({ ok: false, code, cost: cost() });

  if (!ID.test(ask.tenant) || !ID.test(ask.company) || !SITE_REF.test(ask.site)) return no('malformed');
  const tenantId = Number(ask.tenant), companyId = Number(ask.company);
  if (!Number.isSafeInteger(tenantId) || !Number.isSafeInteger(companyId)) return no('malformed');

  // 1. The site's line: the latest website effect for this site, in this tenant and company only.
  const row = await m.first<{ asset_uid: string | null }>(env.DB.prepare(
    `SELECT asset_uid FROM work_graph_effects
      WHERE tenant_id = ? AND company_id = ? AND effect_kind = 'release_website_cdn' AND json_extract(payload_json, '$.ref') = ?
      ORDER BY id DESC LIMIT 1`,
  ).bind(tenantId, companyId, ask.site));
  if (!row?.asset_uid) return no('not_found');

  // 2. What that line may serve now (part 2): the pointer's manifest, or nothing while a takedown or tombstone covers it.
  const served = await servedRelease(env, { scope: { tenantId, companyId, projectId: null } }, row.asset_uid);
  m.fold(served.cost);
  if (!served.ok) return no('not_found');
  if (served.withheld) return no('withdrawn');
  const s = served.served;
  if (!s) return no('not_found');
  // A website is public (part 1 and part 6 refuse anything else); a non-public line is never shown, whatever R2 holds.
  if (s.audience !== 'public' || !MANIFEST.test(s.manifestUid)) return no('not_found');

  // 3. That manifest's own record for this site. Never another manifest's.
  if (!env.FILES) return no('unavailable');
  const key = siteRecordKey({ tenantId, companyId, ref: ask.site, manifestUid: s.manifestUid });
  let obj: R2ObjectBody | null;
  let text: string;
  try {
    r2Requests++;
    obj = await env.FILES.get(key);
    if (!obj) return no('not_delivered');
    text = await obj.text();
  } catch {
    return no('unavailable');
  }

  // 4. The record must be this tenant's, this manifest's and this digest's, and pin exactly what D1 pins.
  const meta = obj.customMetadata ?? {};
  if (meta[SITE_META.tenant] !== String(tenantId) || meta[SITE_META.company] !== String(companyId)
    || meta[SITE_META.manifest] !== s.manifestUid || meta[SITE_META.digest] !== s.digest) return no('record_mismatch');
  let body: any;
  try { body = JSON.parse(text); } catch { return no('record_mismatch'); }
  const pinned = s.components.map((c) => ({ asset: c.asset, revision: c.revision, digest: c.digest, role: c.role }));
  const got = Array.isArray(body?.components) ? body.components : null;
  const same = body?.v === 1 && body.manifest === s.manifestUid && body.digest === s.digest && HEX64.test(s.digest)
    && body.line === row.asset_uid && body.audience === 'public' && got?.length === pinned.length
    && pinned.every((p, i) => got[i] && got[i].asset === p.asset && got[i].revision === p.revision && got[i].digest === p.digest && got[i].role === p.role);
  if (!same) return no('record_mismatch');

  return {
    ok: true, tenantId, companyId, site: ask.site, lineAssetUid: row.asset_uid, manifestUid: s.manifestUid, digest: s.digest,
    headSeq: served.headSeq,
    record: { v: 1, line: row.asset_uid, manifest: s.manifestUid, digest: s.digest, audience: 'public', components: pinned },
    cost: cost(),
  };
}
