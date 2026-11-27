/**
 * D5582 part 5 (#5582): the D5583 media revisions a deck embeds, pinned beside the deck when it is frozen for export.
 *
 *   EMBEDDED   `embeddedMediaRefs`: a deck card names a WorkGraph media version by a `workgraph_media` object,
 *              `{ asset_uid, revision_uid }`, on an image block, a card background or anywhere else in the card. The
 *              refs are read from the deck's units, so they are exactly what the approved deck digest covers: a ref
 *              changed in the deck is a deck edit, which needs a renewed adoption before any freeze.
 *   CHECKED    `checkEmbeddedMedia`: each ref must name a media revision (`image`, `brand`, `model_3d`) of the deck's
 *              own tenant and company, in the deck's project or company-wide; anything else reads as absent. It must
 *              not be revoked (an offline flag, an applied takedown of that revision, or an author whose account is
 *              revoked), it must be readable (not tombstoned, no missing, deleted or misplaced bytes, WorkGraph-held at
 *              its typed key, and R2 answering that key with the revision's size and checksum), and it must still be
 *              its asset's accepted head. A media edit (a new master or a selected variant) moves the head, so a deck
 *              embedding the old revision is refused until the deck embeds the new one and is approved again.
 *
 * The pins go into the same D5585 manifest as the deck (one `component` edge each, at the revision's digest), so a
 * later media edit leaves the frozen export `reapproval_required` through D5585's own status, and its impact walk
 * names the manifest. Reads only: no domain table, revision, flag or blob is written here, and the media and blob
 * services are not changed (D5583 owns them). Bytes are never read: R2 is asked for the object's head only.
 */
import type { Env } from '../types';
import { BLOB_BINDING, blobKey, isWorkGraphBlobSource, parseBlobKey } from './workGraphBlobs';
import type { SourceRef } from './workGraphContracts';
import { WORK_GRAPH_RELEASE_LIMITS } from './workGraphReleases';
import type { Unit } from './workGraphUnits';

/** The field a deck card uses to embed a WorkGraph media version. */
export const EMBED_FIELD = 'workgraph_media';
/** The manifest role every embedded media component carries. */
export const EMBEDDED_MEDIA_ROLE = 'embedded_media';
/** The kinds D5583 registers as media. */
export const EMBEDDABLE_KINDS: readonly string[] = ['image', 'brand', 'model_3d'];
/** One manifest holds the deck and its media; the deck takes one place. */
export const EMBEDDED_MEDIA_MAX = WORK_GRAPH_RELEASE_LIMITS.maxComponents - 1;
const UID = /^[A-Za-z0-9_.:-]{1,80}$/;
const WALK_DEPTH = 8;

export interface MediaRef { assetUid: string; revisionUid: string; units: string[] }
export type MediaRefusalCode =
  | 'embedded_media_malformed' | 'embedded_media_ambiguous' | 'embedded_media_too_many'
  | 'embedded_media_not_found' | 'embedded_media_revoked' | 'embedded_media_unreadable' | 'embedded_media_stale';
export interface MediaRefusal { ok: false; code: MediaRefusalCode; ids: string[]; cost: MediaCost }
export interface MediaCost { d1Statements: number; r2ClassB: number }
export interface MediaPin {
  assetUid: string; revisionUid: string; kind: string;
  /** SHA-256 of the bytes: the revision's digest, also the checksum R2 holds for the object. */
  digest: string;
  byteLength: number; mediaProfile: string; objectClass: string;
  /** The deck units that embed it. */
  units: string[];
}

/** Every media ref in a deck's units, one per revision, in a stable order. */
export function embeddedMediaRefs(units: readonly Unit[]): { ok: true; refs: MediaRef[] } | Omit<MediaRefusal, 'cost'> {
  const byRevision = new Map<string, MediaRef>();
  const state: { bad: string | null } = { bad: null };
  const walk = (v: unknown, depth: number, unit: string) => {
    if (state.bad !== null || depth > WALK_DEPTH || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1, unit); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k !== EMBED_FIELD) { walk(x, depth + 1, unit); continue; }
      const ref = x as Record<string, unknown> | null;
      if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).sort().join(',') !== 'asset_uid,revision_uid'
        || typeof ref.asset_uid !== 'string' || !UID.test(ref.asset_uid) || typeof ref.revision_uid !== 'string' || !UID.test(ref.revision_uid)) {
        state.bad = unit;
        return;
      }
      const seen = byRevision.get(ref.revision_uid);
      if (seen) {
        if (seen.assetUid !== ref.asset_uid) { state.bad = unit; return; }
        if (!seen.units.includes(unit)) seen.units.push(unit);
      } else {
        byRevision.set(ref.revision_uid, { assetUid: ref.asset_uid, revisionUid: ref.revision_uid, units: [unit] });
      }
    }
  };
  for (const u of units) {
    let parsed: unknown;
    try { parsed = JSON.parse(u.value); } catch { parsed = null; }
    walk(parsed, 0, u.id);
    if (state.bad !== null) return { ok: false, code: 'embedded_media_malformed', ids: [state.bad] };
  }
  const refs = [...byRevision.values()].sort((a, b) => (a.assetUid < b.assetUid ? -1 : a.assetUid > b.assetUid ? 1 : 0));
  // A manifest pins one revision of each asset: two versions of one image in one deck cannot both be frozen.
  for (let i = 1; i < refs.length; i++) {
    if (refs[i].assetUid === refs[i - 1].assetUid) return { ok: false, code: 'embedded_media_ambiguous', ids: [refs[i].assetUid] };
  }
  if (refs.length > EMBEDDED_MEDIA_MAX) return { ok: false, code: 'embedded_media_too_many', ids: [String(refs.length)] };
  return { ok: true, refs };
}

interface Row {
  revision_uid: string; asset_uid: string; digest: string; byte_length: number; media_profile: string; source_store: string;
  source_locator: string; source_id: string; tombstoned_at: string | null; tenant_id: number; company_id: number;
  project_id: number | null; kind: string; head_revision_uid: string | null; flags: string | null; taken_down: number;
  author_revoked: number;
}

const toHex = (b: ArrayBuffer | ArrayBufferView | undefined | null): string | null => {
  if (!b) return null;
  const u8 = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return u8.byteLength ? [...u8].map((x) => x.toString(16).padStart(2, '0')).join('') : null;
};

/**
 * Check each embedded ref against the deck's scope and return the pins, or the first refusal. One D1 read for all refs;
 * then one R2 head per ref, only once every ref has passed the D1 checks.
 */
export async function checkEmbeddedMedia(
  env: Pick<Env, 'DB'> & { FILES?: R2Bucket }, deck: { tenantId: number; companyId: number; projectId: number | null }, refs: readonly MediaRef[],
): Promise<{ ok: true; pins: MediaPin[]; cost: MediaCost } | MediaRefusal> {
  const cost: MediaCost = { d1Statements: 0, r2ClassB: 0 };
  const refuse = (code: MediaRefusalCode, ids: string[]): MediaRefusal => ({ ok: false, code, ids, cost: { ...cost } });
  if (!refs.length) return { ok: true, pins: [], cost };
  cost.d1Statements++;
  const rows = (await env.DB.prepare(
    `SELECT r.revision_uid, r.asset_uid, r.digest, r.byte_length, r.media_profile, r.source_store, r.source_locator, r.source_id,
            r.tombstoned_at, a.tenant_id, a.company_id, a.project_id, a.kind, a.head_revision_uid,
            (SELECT group_concat(f.flag) FROM work_graph_revision_flags f
              WHERE f.revision_uid = r.revision_uid AND f.cleared_at IS NULL) AS flags,
            EXISTS (SELECT 1 FROM work_graph_release_takedowns t
              WHERE t.revision_uid = r.revision_uid AND t.scope = 'component' AND t.outcome = 'applied'
                AND t.tenant_id = a.tenant_id AND t.company_id = a.company_id) AS taken_down,
            EXISTS (SELECT 1 FROM users u WHERE u.id = r.actor_user_id AND u.is_active = 0) AS author_revoked
       FROM work_graph_revisions r JOIN work_graph_assets a ON a.asset_uid = r.asset_uid
      WHERE r.revision_uid IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(refs.map((r) => r.revisionUid))).all<Row>()).results ?? [];
  const byUid = new Map(rows.map((r) => [r.revision_uid, r]));

  const held: { ref: MediaRef; row: Row }[] = [];
  for (const ref of refs) {
    const r = byUid.get(ref.revisionUid);
    // Another tenant's, company's or project's media reads exactly as absent: nothing about it is answered.
    if (!r || r.asset_uid !== ref.assetUid || Number(r.tenant_id) !== deck.tenantId || Number(r.company_id) !== deck.companyId
      || (r.project_id !== null && Number(r.project_id) !== deck.projectId)) {
      return refuse('embedded_media_not_found', [ref.assetUid, ref.revisionUid]);
    }
    const flags = new Set((r.flags ?? '').split(',').filter(Boolean));
    if (flags.has('offline') || Number(r.taken_down) === 1 || Number(r.author_revoked) === 1) {
      const why = flags.has('offline') ? 'offline' : Number(r.taken_down) === 1 ? 'taken_down' : 'author_revoked';
      return refuse('embedded_media_revoked', [ref.assetUid, ref.revisionUid, why]);
    }
    if (!EMBEDDABLE_KINDS.includes(r.kind)) return refuse('embedded_media_unreadable', [ref.assetUid, ref.revisionUid, 'kind']);
    if (r.tombstoned_at !== null) return refuse('embedded_media_unreadable', [ref.assetUid, ref.revisionUid, 'tombstoned']);
    if (flags.size) return refuse('embedded_media_unreadable', [ref.assetUid, ref.revisionUid, [...flags].sort()[0]]);
    const source = { store: r.source_store as SourceRef['store'], locator: r.source_locator, id: r.source_id };
    const objectClass = parseBlobKey(r.source_id)?.objectClass;
    if (!isWorkGraphBlobSource(source) || !objectClass || objectClass === 'generic'
      || r.source_id !== blobKey({ tenantId: Number(r.tenant_id), companyId: Number(r.company_id), projectId: r.project_id }, r.digest, objectClass)) {
      return refuse('embedded_media_unreadable', [ref.assetUid, ref.revisionUid, 'source']);
    }
    if (r.head_revision_uid !== ref.revisionUid) return refuse('embedded_media_stale', [ref.assetUid, ref.revisionUid, String(r.head_revision_uid)]);
    held.push({ ref, row: r });
  }

  const bucket = env.FILES;
  if (!bucket) return refuse('embedded_media_unreadable', [BLOB_BINDING]);
  const pins: MediaPin[] = [];
  for (const { ref, row: r } of held) {
    cost.r2ClassB++;
    const head = await bucket.head(r.source_id);
    const checksum = toHex(head?.checksums?.sha256 as ArrayBuffer | undefined);
    const meta = head?.customMetadata?.digest;
    if (!head || head.size !== Number(r.byte_length) || (checksum !== null && checksum !== r.digest) || (meta !== undefined && meta !== r.digest)) {
      return refuse('embedded_media_unreadable', [ref.assetUid, ref.revisionUid, head ? 'bytes_mismatch' : 'bytes_missing']);
    }
    pins.push({
      assetUid: r.asset_uid, revisionUid: r.revision_uid, kind: r.kind, digest: r.digest, byteLength: Number(r.byte_length),
      mediaProfile: r.media_profile, objectClass: String(parseBlobKey(r.source_id)?.objectClass), units: [...ref.units].sort(),
    });
  }
  return { ok: true, pins, cost };
}
