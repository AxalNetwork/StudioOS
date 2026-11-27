/**
 * D5581 part 3 (#5581): the shared world of the WorkGraph integrity tests — one real SQLite database built from the
 * three #5581 migration files, an in-memory R2 bucket that keeps SHA-256 checksums the way R2 does, and the part 2
 * lease Durable Object over a storage map. The clock is one variable every service reads (D5614).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { WorkGraphLease } from '../src/durable-objects/work-graph-lease.ts';
import { sha256Hex, type Actor, type Scope, type ValidationContext } from '../src/services/workGraphContracts.ts';
import { WORK_GRAPH_BLOB_DEPS, blobSourceRef } from '../src/services/workGraphBlobs.ts';
import { WORK_GRAPH_EFFECT_DEPS } from '../src/services/workGraphEffects.ts';
import {
  WORK_GRAPH_DEPS, advanceHead, createRevision, registerAsset, type CreateRevisionInput,
} from '../src/services/workGraphRevisions.ts';
import { applySuppressionLedger } from './_suppression_ledger.mjs';

const read = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
export const SCHEMA = read('202611140007_5581_work_graph_revisions.sql')
  + read('202611140122_5581_work_graph_lease_events.sql')
  + read('202611140924_5581_work_graph_integrity.sql')
  + read('202611220358_5583_media_blob_classes.sql')
  + read('202611252327_5583_media_multipart_uploads.sql');

export const T0 = Date.parse('2026-11-14T09:30:00Z');
export const clock = { t: T0 };
WORK_GRAPH_DEPS.now = () => new Date(clock.t);
WORK_GRAPH_BLOB_DEPS.now = () => new Date(clock.t);
let n = 0;
WORK_GRAPH_DEPS.newId = () => `id${++n}`;
WORK_GRAPH_EFFECT_DEPS.newToken = () => `tok${++n}`;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const SCOPE: Scope = { tenantId: 7, companyId: 70, projectId: 700 };
export const OTHER: Scope = { tenantId: 8, companyId: 80, projectId: 800 };
export const CTX: ValidationContext = { scope: { tenantId: 7, companyId: 70, projectId: null } };
export const OTHER_CTX: ValidationContext = { scope: { tenantId: 8, companyId: 80, projectId: null } };
export const ALICE: Actor = { kind: 'person', userId: 11 };
export const BOB: Actor = { kind: 'person', userId: 12 };
export const agent = (run: string): Actor => ({ kind: 'agent', agentRunId: run, onBehalfOfUserId: 11, chargeId: `chg_${run}` });
export const bytesOf = (s: string) => new TextEncoder().encode(s);

const hexToBuf = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16))).buffer;

interface Stored { bytes: Uint8Array; sha256: string | null; customMetadata: Record<string, string>; uploaded: Date }

/** A stream that yields `bytes` in uneven chunks, as R2's body does, so a hash fed from it must chain chunks. */
const chunked = (bytes: Uint8Array, size = 1000) => new ReadableStream<Uint8Array>({
  start(c) { for (let i = 0; i < bytes.byteLength; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); },
});
interface Upload { key: string; parts: Map<number, { bytes: Uint8Array; etag: string }>; state: 'open' | 'completed' | 'aborted'; customMetadata: Record<string, string> }

/**
 * R2, in memory: put checks `sha256` like R2 does and keeps it as the object's checksum; list pages by key. D5583
 * part 3 adds multipart uploads the way R2 keeps them: parts are invisible until `complete`, which needs every
 * part's current etag; a completed multipart object has no SHA-256 checksum.
 */
export class FakeR2 {
  objects = new Map<string, Stored>();
  uploads = new Map<string, Upload>();
  ops = { put: 0, head: 0, get: 0, delete: 0, list: 0, mpCreate: 0, mpPart: 0, mpComplete: 0, mpAbort: 0 };
  /** The next put's body arrives torn: only its first half reaches the bucket. */
  tearNext = false;
  private view(key: string, o: Stored) {
    return {
      key, size: o.bytes.byteLength, uploaded: o.uploaded, customMetadata: { ...o.customMetadata },
      checksums: { sha256: o.sha256 ? hexToBuf(o.sha256) : undefined },
      arrayBuffer: async () => o.bytes.slice().buffer,
      get body() { return chunked(o.bytes); },
    };
  }
  async createMultipartUpload(key: string, opts: { customMetadata?: Record<string, string> } = {}) {
    this.ops.mpCreate++;
    const id = `r2u${this.uploads.size + 1}`;
    this.uploads.set(id, { key, parts: new Map(), state: 'open', customMetadata: { ...(opts.customMetadata ?? {}) } });
    return this.resumeMultipartUpload(key, id);
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    const open = () => {
      const u = this.uploads.get(uploadId);
      if (!u || u.key !== key || u.state !== 'open') throw new Error('multipart: upload is not open');
      return u;
    };
    return {
      key, uploadId,
      uploadPart: async (partNumber: number, value: Uint8Array) => {
        this.ops.mpPart++;
        const u = open();
        const bytes = new Uint8Array(value).slice();
        const etag = (await sha256Hex(bytes)).slice(0, 32);
        u.parts.set(partNumber, { bytes, etag });
        return { partNumber, etag };
      },
      complete: async (parts: { partNumber: number; etag: string }[]) => {
        this.ops.mpComplete++;
        const u = open();
        const chunks = parts.map((p, i) => {
          const stored = u.parts.get(p.partNumber);
          if (p.partNumber !== i + 1 || !stored || stored.etag !== p.etag) throw new Error('multipart: InvalidPart');
          return stored.bytes;
        });
        const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
        let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
        u.state = 'completed';
        const o: Stored = { bytes, sha256: null, customMetadata: u.customMetadata, uploaded: new Date(clock.t) };
        this.objects.set(key, o);
        return this.view(key, o);
      },
      abort: async () => { this.ops.mpAbort++; const u = open(); u.state = 'aborted'; u.parts.clear(); },
    };
  }
  /** Test hook: another body lands under an acknowledged part number (a lost race), with its own etag. */
  replacePart(uploadId: string, partNumber: number, bytes: Uint8Array) {
    this.uploads.get(uploadId)!.parts.set(partNumber, { bytes, etag: `other${partNumber}` });
  }
  async put(key: string, value: Uint8Array, opts: { sha256?: string; customMetadata?: Record<string, string> } = {}) {
    this.ops.put++;
    let bytes = new Uint8Array(value);
    if (this.tearNext) { this.tearNext = false; bytes = bytes.slice(0, Math.floor(bytes.byteLength / 2)); }
    if (opts.sha256 && (await sha256Hex(bytes)) !== opts.sha256) throw new Error('put: the SHA-256 checksum does not match');
    const o: Stored = { bytes, sha256: opts.sha256 ?? null, customMetadata: { ...(opts.customMetadata ?? {}) }, uploaded: new Date(clock.t) };
    this.objects.set(key, o);
    return this.view(key, o);
  }
  async head(key: string) { this.ops.head++; const o = this.objects.get(key); return o ? this.view(key, o) : null; }
  async get(key: string) { this.ops.get++; const o = this.objects.get(key); return o ? this.view(key, o) : null; }
  async delete(keys: string | string[]) { this.ops.delete++; for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k); }
  async list(opts: { prefix?: string; limit?: number; cursor?: string }) {
    this.ops.list++;
    const all = [...this.objects.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    const start = opts.cursor ? all.indexOf(opts.cursor) + 1 : 0;
    const page = all.slice(start, start + (opts.limit ?? 1000));
    const truncated = start + page.length < all.length;
    return { objects: page.map((k) => this.view(k, this.objects.get(k)!)), truncated, cursor: truncated ? page[page.length - 1] : undefined };
  }
  /** Test hooks: an object written outside WorkGraph, rotted bytes, a truncated object. */
  plant(key: string, bytes: Uint8Array, sha256: string | null = null, customMetadata: Record<string, string> = {}) {
    this.objects.set(key, { bytes, sha256, customMetadata, uploaded: new Date(clock.t) });
  }
  rot(key: string) { const o = this.objects.get(key)!; const b = o.bytes.slice(); b[0] ^= 0xff; o.bytes = b; }
  truncate(key: string) { const o = this.objects.get(key)!; o.bytes = o.bytes.slice(0, o.bytes.byteLength - 1); }
  totalOps() { return Object.values(this.ops).reduce((a, b) => a + b, 0); }
}

/** The part 2 lease object over a storage map that outlives the instance. */
function leaseNamespace(flag: () => string) {
  const stores = new Map<string, Map<string, unknown>>();
  const instances = new Map<string, WorkGraphLease>();
  const env = { get WORK_GRAPH_LEASES() { return flag(); } } as any;
  const instance = (name: string) => {
    let o = instances.get(name);
    if (!o) {
      let m = stores.get(name);
      if (!m) { m = new Map(); stores.set(name, m); }
      const store = m;
      o = new WorkGraphLease({
        id: { name },
        storage: {
          get: async (k: string) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
          put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); },
          setAlarm: async () => {}, deleteAlarm: async () => {},
        },
      } as any, env);
      instances.set(name, o);
    }
    return o;
  };
  let calls = 0;
  const ns: any = {
    idFromName: (name: string) => ({ name, toString: () => name }),
    get: (id: { name: string }) => ({ fetch: async (url: string, init?: RequestInit) => { calls++; return instance(id.name).fetch(new Request(url, init)); } }),
  };
  return { ns, calls: () => calls };
}

export function world(opts: { leases?: 'on' | 'off'; files?: boolean } = {}) {
  const { DB, db } = makeD1(SCHEMA);
  applySuppressionLedger(db); // D6654: the record-erasure path writes its ledger row.
  const r2 = new FakeR2();
  const state = { leases: opts.leases ?? 'off' };
  const lease = leaseNamespace(() => state.leases);
  const env: any = { DB, WORK_GRAPH_LEASES: state.leases, WORK_GRAPH_LEASE: lease.ns };
  if (opts.files !== false) env.FILES = r2;
  return { env, db, r2, lease, setLeases: (v: 'on' | 'off') => { state.leases = v; env.WORK_GRAPH_LEASES = v; } };
}
export type W = ReturnType<typeof world>;

export const count = (w: W, sql: string, ...b: any[]) => Number((w.db.prepare(sql).get(...b) as any).n);
export const rows = (w: W, sql: string, ...b: any[]) => (w.db.prepare(sql).all(...b) as any[]).map((r) => ({ ...r }));
export const headOf = (w: W, a: string) => (w.db.prepare('SELECT head_revision_uid AS h, head_seq AS s FROM work_graph_assets WHERE asset_uid = ?').get(a) as any);

export async function asset(w: W, key: string, over: Partial<Parameters<typeof registerAsset>[2]> = {}, ctx = CTX) {
  const r = await registerAsset(w.env, ctx, {
    scope: SCOPE, kind: 'image', accessClass: 'confidential', approvalPolicy: 'team_review', actor: ALICE,
    idempotencyKey: `asset-${key}`, ...over,
  });
  assert.ok(r.ok, JSON.stringify(r));
  return r.assetUid;
}

/** A revision of WorkGraph-held bytes (an image), whether or not the bytes were put. */
export async function blobRev(w: W, assetUid: string, key: string, digest: string, size: number, over: Partial<CreateRevisionInput> = {}, scope: Scope = SCOPE) {
  const r = await createRevision(w.env, CTX, {
    assetUid, parents: [], digest, byteLength: size, mediaProfile: 'image/png', source: blobSourceRef(scope, digest),
    author: agent('run_a'), idempotencyKey: `rev-${key}`, ...over,
  });
  assert.ok(r.ok, JSON.stringify(r));
  return r.revisionUid;
}

export function advance(w: W, assetUid: string, expected: string | null, revisionUid: string, key: string, extra: Partial<Parameters<typeof advanceHead>[2]> = {}) {
  return advanceHead(w.env, CTX, { assetUid, expectedRevisionUid: expected, revisionUid, actor: agent('run_a'), approval: null, idempotencyKey: `adv-${key}`, ...extra });
}
