/**
 * D5583 part 3 — checksummed, resumable multipart media upload over the existing blob service, media admission and
 * member guard. Synthetic bytes, the in-memory R2 and the #5581 SQLite world only; the clock is the world's variable.
 * Parts are 256 bytes here (the limits are an argument), so every rule runs on files of a few hundred bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MEDIA_MULTIPART_DEPS, MEDIA_MULTIPART_LIMITS, abandonMediaMultipart, beginMediaMultipart, finishMediaMultipart,
  sweepMediaMultiparts, uploadMediaPart, type BeginMultipartInput,
} from '../src/services/workGraphMediaMultipart.ts';
import { storeMediaUpload } from '../src/services/workGraphMediaStorage.ts';
import { Sha256, sha256OfStream } from '../src/services/sha256Incremental.ts';
import { admitMedia, admitStreamPart, beginStreamAdmission, type MediaKind, type ObjectClass } from '../src/services/workGraphMedia.ts';
import { WORK_GRAPH_BLOB_LIMITS, blobKey, readRevisionBytes, recordFinishedBlob, verifyBlob } from '../src/services/workGraphBlobs.ts';
import {
  abortContentAddressedMultipart, completeContentAddressedMultipart, createContentAddressedMultipart, uploadContentAddressedPart,
} from '../src/services/recordStore.ts';
import {
  ALICE, BOB, CTX, DAY, OTHER_CTX, SCOPE, advance, agent, asset, blobRev, bytesOf, clock, count, headOf, rows, world, type W,
} from './_work_graph_world_5581.ts';

const PART = 256;
const L = { ...MEDIA_MULTIPART_LIMITS, partBytes: PART, minBytes: PART + 1, maxOpenPerCompany: 3 };
let ids = 0;
MEDIA_MULTIPART_DEPS.newId = () => `mpu${++ids}`;

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const fill = (n: number, seed: number) => Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);
const pngChunk = (type: string, len: number) => [...be32(len), ...bytesOf(type), ...fill(len, len), 0, 0, 0, 0];
const png = (...chunks: [string, number][]) => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunks.flatMap(([t, l]) => pngChunk(t, l))]);
/** 1000 bytes: four parts (256, 256, 256, 232). */
const PNG = png(['IHDR', 13], ['IDAT', 943], ['IEND', 0]);
const jpeg = (total: number, app: number[] = []) => {
  const head = [0xff, 0xd8, ...app, 0xff, 0xda, 0, 2];
  return Uint8Array.from([...head, ...fill(total - head.length - 2, 3), 0xff, 0xd9]);
};
const EXIF_GPS = [0xff, 0xe1, 0, 12, ...bytesOf('Exif\0\0'), 0, 0, 0x88, 0x25];
const glb = (total: number, declared = total) => Uint8Array.from([...bytesOf('glTF'), ...le32(2), ...le32(declared), ...fill(total - 12, 5)]);

const provenance = () => ({ origin: 'upload' as const, rights: { basis: 'owned' as const, usageScope: ['deck'] } as Record<string, unknown> });
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function request(assetUid: string, bytes: Uint8Array, over: Partial<BeginMultipartInput> = {}): BeginMultipartInput {
  return { assetUid, expectedHead: null, by: ALICE, kind: 'image', objectClass: 'master', declaredMime: 'image/png',
    provenance: provenance() as never, use: 'deck', digest: hex(bytes), byteLength: bytes.byteLength, ...over };
}
const partOf = (bytes: Uint8Array, n: number) => bytes.slice((n - 1) * PART, n * PART);
const send = (w: W, uploadUid: string, bytes: Uint8Array, n: number, by = ALICE, body = partOf(bytes, n)) =>
  uploadMediaPart(w.env, CTX, { uploadUid, partNumber: n, bytes: body, partDigest: hex(body), by });
async function sendAll(w: W, uploadUid: string, bytes: Uint8Array) {
  for (let n = 1; n <= Math.ceil(bytes.byteLength / PART); n++) { const r = await send(w, uploadUid, bytes, n); assert.ok(r.ok, JSON.stringify(r)); }
}
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);
const session = (w: W, uid: string) => rows(w, 'SELECT status, close_code, next_part FROM work_graph_media_uploads WHERE upload_uid = ?', uid)[0];

function owners(w: W) {
  w.db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER);
    INSERT INTO users VALUES (11,'admin',101),(12,'founder',102);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, company_id INTEGER, founder_id INTEGER);
    INSERT INTO projects VALUES (700,70,101),(701,70,101);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER,is_primary_admin INTEGER,created_at TEXT);
    INSERT INTO user_company_links VALUES (1,70,11,1,'2026-01-01');`);
}
function fresh() { const w = world(); owners(w); return w; }

// ── the hash ─────────────────────────────────────────────────────────────────

test('incremental SHA-256 matches the platform digest for any chunking, resumes at a block boundary, and refuses a bad state', async () => {
  for (let n = 0; n < 200; n++) {
    const b = Uint8Array.from(fill(n * 5 + (n % 7), n));
    const h = new Sha256();
    for (let i = 0; i < b.length;) { const k = Math.min(b.length - i, 1 + ((i * 13 + n) % 70)); h.update(b.subarray(i, i + k)); i += k; }
    assert.equal(h.hex(), hex(b), `length ${b.length}`);
  }
  const b = Uint8Array.from(fill(64 * 9 + 17, 1));
  const first = new Sha256().update(b.subarray(0, 64 * 4)).exportState();
  assert.equal(first.bytes, 256); assert.match(first.words, /^[0-9a-f]{64}$/);
  assert.equal(Sha256.resume(first).update(b.subarray(256)).hex(), hex(b));
  assert.equal(new Sha256().exportState().words, '6a09e667bb67ae853c6ef372a54ff53a510e527f9b05688c1f83d9ab5be0cd19');
  assert.throws(() => new Sha256().update(b.subarray(0, 65)).exportState(), /sha256_unaligned/);
  assert.throws(() => Sha256.resume({ words: first.words, bytes: 65 }), /sha256_state/);
  assert.throws(() => Sha256.resume({ words: 'z'.repeat(64), bytes: 64 }), /sha256_state/);
  const stream = () => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < b.length; i += 100) c.enqueue(b.slice(i, i + 100)); c.close(); } });
  assert.deepEqual(await sha256OfStream(stream()), { hex: hex(b), bytes: b.length });
  // The native path (Workers' crypto.DigestStream) is used when the runtime has it.
  let fed = 0;
  class FakeDigestStream {
    private h = new Sha256(); digest: Promise<ArrayBuffer>; private done!: (v: ArrayBuffer) => void;
    constructor(algorithm: string) { assert.equal(algorithm, 'SHA-256'); this.digest = new Promise((r) => { this.done = r; }); }
    getWriter() {
      return { write: async (c: Uint8Array) => { fed += c.byteLength; this.h.update(c); },
        close: async () => { this.done(Uint8Array.from(this.h.hex().match(/../g)!.map((x) => parseInt(x, 16))).buffer); } } as never;
    }
  }
  Object.defineProperty(crypto, 'DigestStream', { value: FakeDigestStream, configurable: true });
  try { assert.deepEqual(await sha256OfStream(stream()), { hex: hex(b), bytes: b.length }); assert.equal(fed, b.length); }
  finally { delete (crypto as unknown as Record<string, unknown>).DigestStream; }
});

// ── streamed admission ───────────────────────────────────────────────────────

function streamAdmit(bytes: Uint8Array, mime: string, kind: MediaKind = 'image', objectClass: ObjectClass = 'master') {
  const begun = beginStreamAdmission({ kind, objectClass, declaredMime: mime, byteLength: bytes.byteLength });
  if (!begun.ok) return begun.code;
  let state = begun.state;
  for (let offset = 0; offset < bytes.byteLength; offset += PART) {
    const r = admitStreamPart(state, bytes.subarray(offset, offset + PART), { offset, total: bytes.byteLength, declaredMime: mime });
    if (!r.ok) return r.code;
    state = r.state;
  }
  return 'ok';
}

test('admission in parts reaches the whole-file verdict for every rule it checks, including chunks across part boundaries', () => {
  // eXIf whose 8-byte header starts seven bytes before a part boundary (offset 505), and one deep in part 3.
  const straddle = png(['IHDR', 13], ['IDAT', 460], ['eXIf', 4], ['IDAT', 200], ['IEND', 0]);
  assert.equal(8 + 25 + 472, 505);
  const cases: [string, Uint8Array, string, string][] = [
    ['png', PNG, 'image/png', 'ok'],
    ['png whose last part is one byte', png(['IHDR', 13], ['IDAT', 712], ['IEND', 0]), 'image/png', 'ok'],
    ['png eXIf across a boundary', straddle, 'image/png', 'unsafe_metadata'],
    ['png eXIf in part 3', png(['IHDR', 13], ['IDAT', 600], ['eXIf', 4], ['IDAT', 100], ['IEND', 0]), 'image/png', 'unsafe_metadata'],
    ['png eXIf after IEND is not read', png(['IHDR', 13], ['IDAT', 600], ['IEND', 0], ['eXIf', 4], ['IEND', 0]), 'image/png', 'ok'],
    ['png without IEND', png(['IHDR', 13], ['IDAT', 900], ['IDAT', 0]), 'image/png', 'corrupt'],
    ['png without IHDR', png(['IDAT', 13], ['IDAT', 900], ['IEND', 0]), 'image/png', 'corrupt'],
    ['jpeg', jpeg(700), 'image/jpeg', 'ok'],
    ['jpeg with GPS', jpeg(700, EXIF_GPS), 'image/jpeg', 'unsafe_metadata'],
    ['jpeg without end-of-image', jpeg(700).slice(0, -1), 'image/jpeg', 'corrupt'],
    ['glb', glb(600), 'model/gltf-binary', 'ok'],
    ['glb whose header lies about its length', glb(600, 601), 'model/gltf-binary', 'corrupt'],
    ['declared png, bytes are jpeg', jpeg(700), 'image/png', 'mime_mismatch'],
    ['unrecognised bytes', Uint8Array.from(fill(700, 9)), 'image/png', 'unsupported_format'],
  ];
  for (const [name, bytes, mime, expected] of cases) {
    const kind: MediaKind = mime.startsWith('model/') ? 'model_3d' : 'image';
    assert.equal(streamAdmit(bytes, mime, kind), expected, name);
    const whole = admitMedia({ kind, objectClass: 'master', declaredMime: mime, bytes });
    assert.equal(whole.ok ? 'ok' : whole.code, expected, `${name}: admitMedia agrees`);
  }
  // Stricter than whole-file only where a part cannot see enough: JPEG metadata that runs past the first part.
  const longApp = [0xff, 0xe2, 1, 44, ...fill(298, 1)];
  assert.equal(admitMedia({ kind: 'image', objectClass: 'master', declaredMime: 'image/jpeg', bytes: jpeg(900, longApp) }).ok, true);
  assert.equal(streamAdmit(jpeg(900, longApp), 'image/jpeg'), 'unsafe_metadata');
  // Before any byte: text formats are parsed whole, and type, kind, class and class size are the declared object's.
  const begin = (mime: string, kind: MediaKind, objectClass: ObjectClass, byteLength = 1000) => {
    const r = beginStreamAdmission({ kind, objectClass, declaredMime: mime, byteLength }); return r.ok ? 'ok' : r.code;
  };
  assert.equal(begin('image/svg+xml', 'image', 'master'), 'oversized');
  assert.equal(begin('model/gltf+json', 'model_3d', 'master'), 'oversized');
  assert.equal(begin('text/html', 'image', 'master'), 'unsupported_format');
  assert.equal(begin('model/gltf-binary', 'image', 'master'), 'wrong_kind');
  assert.equal(begin('image/gif', 'image', 'rendition'), 'wrong_class');
  assert.equal(begin('image/png', 'image', 'thumbnail', 2 * 1024 * 1024 + 1), 'oversized');
  assert.equal(begin('image/png', 'image', 'thumbnail', 2 * 1024 * 1024), 'ok');
  assert.equal(begin('image/png', 'image', 'master', 0), 'empty');
  assert.equal(begin('IMAGE/PNG; x=1', 'image', 'master'), 'ok');
});

// ── the whole path ───────────────────────────────────────────────────────────

test('a multipart master lands at its content-addressed class key, enters the one ledger once, and becomes a verified head', async () => {
  const w = fresh(); const id = await asset(w, 'mp');
  const begun = await beginMediaMultipart(w.env, CTX, request(id, PNG), L);
  assert.ok(begun.ok, JSON.stringify(begun));
  assert.equal(begun.partCount, 4); assert.equal(begun.partBytes, PART); assert.equal(begun.key, blobKey(SCOPE, hex(PNG), 'master'));
  assert.equal(begun.expiresAt, new Date(clock.t + DAY).toISOString()); assert.equal(begun.quota.passed, 'staff');
  assert.equal(w.r2.ops.mpCreate, 1); assert.equal(w.r2.objects.size, 0); assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 0);
  for (let n = 1; n <= 4; n++) {
    const r = await send(w, begun.uploadUid, PNG, n); assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.nextPart, n + 1); assert.equal(r.duplicate, false); assert.equal(r.cost.r2ClassA, 1);
    assert.equal(w.r2.objects.size, 0, 'parts are invisible until finished');
  }
  const done = await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: begun.uploadUid });
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(done.reused, false); assert.equal(done.digest, hex(PNG)); assert.equal(done.size, PNG.length);
  assert.equal(done.ownerUserId, 11); assert.equal(done.mediaProfile, 'image/png'); assert.equal(done.objectClass, 'master');
  assert.ok(done.cost.r2ClassA >= 1 && done.cost.r2ClassB >= 2 && done.cost.d1Statements > done.cost.d1Batches);
  assert.deepEqual(w.r2.objects.get(done.key)!.bytes, PNG); assert.equal(w.r2.objects.get(done.key)!.sha256, null);
  assert.equal(w.r2.ops.mpComplete, 1);
  assert.deepEqual(rows(w, 'SELECT object_class, project_id, byte_length, admitted_owner_user_id, deleted_at FROM work_graph_blobs'),
    [{ object_class: 'master', project_id: 700, byte_length: PNG.length, admitted_owner_user_id: 11, deleted_at: null }]);
  assert.deepEqual(session(w, begun.uploadUid), { status: 'completed', close_code: 'stored', next_part: 5 });
  assert.deepEqual(rows(w, "SELECT action FROM work_graph_integrity_events WHERE outcome = 'applied' ORDER BY id").map((r) => r.action),
    ['blob_put']);
  assert.deepEqual(rows(w, 'SELECT tenant_id, company_id, project_id, object_class, author_user_id, agent_run_id, part_count FROM work_graph_media_uploads'),
    [{ tenant_id: 7, company_id: 70, project_id: 700, object_class: 'master', author_user_id: 11, agent_run_id: null, part_count: 4 }]);
  // The bytes become a revision and, through the revision store's own CAS and verification, the head.
  const rev = await blobRev(w, id, 'mp-rev', done.digest, done.size, { source: done.source });
  const head = await advance(w, id, null, rev, 'mp', { actor: ALICE, approval: { ref: 'synthetic-review', contentDigest: done.digest, reviewer: ALICE, decidedAt: new Date(clock.t).toISOString() } });
  assert.ok(head.ok, JSON.stringify(head)); assert.equal(headOf(w, id).h, rev);
  const read = await readRevisionBytes(w.env, CTX, { revisionUid: rev, actor: ALICE }); assert.ok(read.ok); assert.deepEqual(read.bytes, PNG);
  // A closed session takes nothing more.
  assert.equal(code(await send(w, begun.uploadUid, PNG, 4)), 'upload_closed');
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: begun.uploadUid })), 'upload_closed');
  w.db.close();
});

test('duplicate and retried parts are idempotent; gaps, wrong sizes, bad part hashes and conflicting bytes are refused without losing the upload', async () => {
  const w = fresh(); const id = await asset(w, 'retry');
  const b = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(b.ok);
  assert.ok((await send(w, b.uploadUid, PNG, 1)).ok);
  const again = await send(w, b.uploadUid, PNG, 1);
  assert.ok(again.ok && again.duplicate); assert.equal(again.nextPart, 2); assert.equal(w.r2.ops.mpPart, 2);
  const other = Uint8Array.from(fill(PART, 77));
  assert.equal(code(await send(w, b.uploadUid, PNG, 1, ALICE, other)), 'part_conflict');
  assert.equal(code(await send(w, b.uploadUid, PNG, 3)), 'out_of_order');
  assert.equal(code(await send(w, b.uploadUid, PNG, 2, ALICE, partOf(PNG, 2).slice(1))), 'part_size');
  assert.equal(code(await send(w, b.uploadUid, PNG, 5)), 'malformed');
  const lying = await uploadMediaPart(w.env, CTX, { uploadUid: b.uploadUid, partNumber: 2, bytes: partOf(PNG, 2), partDigest: 'f'.repeat(64), by: ALICE });
  assert.equal(code(lying), 'digest_mismatch');
  assert.equal(code(await uploadMediaPart(w.env, CTX, { uploadUid: b.uploadUid, partNumber: 2, bytes: new Uint8Array(8 * 1024 * 1024 + 1), partDigest: 'f'.repeat(64), by: ALICE })), 'oversized');
  assert.deepEqual(session(w, b.uploadUid), { status: 'open', close_code: null, next_part: 2 }, 'every refusal above left the upload open');
  assert.equal(w.r2.ops.mpPart, 2, 'no refused part reached R2');
  for (let n = 2; n <= 4; n++) assert.ok((await send(w, b.uploadUid, PNG, n)).ok);
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: b.uploadUid })), 'ok');
  assert.deepEqual(w.r2.objects.get(blobKey(SCOPE, hex(PNG), 'master'))!.bytes, PNG);
  // Two requests racing for the same next part: one advances the session, the other is told to retry.
  const c = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(c.ok);
  const rival = partOf(png(['IHDR', 13], ['IDAT', 942], ['IEND', 0]), 1); assert.notDeepEqual(rival, partOf(PNG, 1));
  const raced = await Promise.all([send(w, c.uploadUid, PNG, 1), send(w, c.uploadUid, PNG, 1, ALICE, rival)]);
  assert.deepEqual(raced.map(code).sort(), ['ok', 'part_conflict']);
  assert.equal(session(w, c.uploadUid).next_part, 2);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_media_upload_parts WHERE upload_uid = ?', c.uploadUid), 1);
  assert.deepEqual(rows(w, 'SELECT refusal_code FROM work_graph_integrity_events WHERE action = ? AND refusal_code <> ? ORDER BY id', 'blob_refused', 'part_conflict').map((r) => r.refusal_code),
    ['out_of_order', 'part_size', 'malformed', 'digest_mismatch']);
  w.db.close();
});

test('a lost race under an acknowledged part number cannot land: R2 refuses the commit, and resending that part repairs it', async () => {
  const w = fresh(); const id = await asset(w, 'race');
  const b = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(b.ok);
  await sendAll(w, b.uploadUid, PNG);
  const r2Upload = rows(w, 'SELECT r2_upload_id FROM work_graph_media_uploads WHERE upload_uid = ?', b.uploadUid)[0].r2_upload_id;
  w.r2.replacePart(r2Upload, 2, Uint8Array.from(fill(PART, 99)));
  const refused = await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: b.uploadUid });
  assert.equal(code(refused), 'part_conflict'); assert.equal(w.r2.objects.size, 0);
  assert.equal(session(w, b.uploadUid).status, 'open');
  const resent = await send(w, b.uploadUid, PNG, 2); assert.ok(resent.ok && resent.duplicate);
  const done = await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: b.uploadUid });
  assert.ok(done.ok, JSON.stringify(done)); assert.deepEqual(w.r2.objects.get(done.key)!.bytes, PNG);
  w.db.close();
});

test('parts whose chained hash is not the declared digest fail closed at the last part: aborted, nothing at the key, no ledger row', async () => {
  const w = fresh(); const id = await asset(w, 'mismatch');
  const claimed = png(['IHDR', 13], ['IDAT', 942], ['IEND', 0]);
  const b = await beginMediaMultipart(w.env, CTX, request(id, PNG, { digest: hex(claimed) }), L); assert.ok(b.ok);
  for (let n = 1; n <= 3; n++) assert.ok((await send(w, b.uploadUid, PNG, n)).ok);
  const last = await send(w, b.uploadUid, PNG, 4);
  assert.equal(code(last), 'digest_mismatch');
  assert.deepEqual(session(w, b.uploadUid), { status: 'failed', close_code: 'digest_mismatch', next_part: 4 });
  assert.equal(w.r2.ops.mpPart, 3, 'the last part never reached R2'); assert.equal(w.r2.ops.mpAbort, 1);
  assert.equal(w.r2.objects.size, 0); assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 0);
  assert.equal(code(await send(w, b.uploadUid, PNG, 4)), 'upload_closed');
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...request(id, PNG, { digest: hex(claimed) }), uploadUid: b.uploadUid })), 'upload_closed');
  // A part that fails admission (an eXIf chunk) also closes the upload before R2 sees it.
  const exif = png(['IHDR', 13], ['IDAT', 460], ['eXIf', 4], ['IDAT', 200], ['IEND', 0]);
  const e = await beginMediaMultipart(w.env, CTX, request(id, exif), L); assert.ok(e.ok);
  // Its header starts at 505 and ends past the boundary at 512: seen whole only once part 3 arrives.
  assert.ok((await send(w, e.uploadUid, exif, 1)).ok); assert.ok((await send(w, e.uploadUid, exif, 2)).ok);
  assert.equal(code(await send(w, e.uploadUid, exif, 3)), 'unsafe_metadata');
  assert.deepEqual(session(w, e.uploadUid), { status: 'failed', close_code: 'unsafe_metadata', next_part: 3 });
  const notPng = jpeg(700);
  const j = await beginMediaMultipart(w.env, CTX, request(id, notPng), L); assert.ok(j.ok);
  assert.equal(code(await send(w, j.uploadUid, notPng, 1)), 'mime_mismatch');
  assert.equal(w.r2.objects.size, 0);
  w.db.close();
});

test('an abandoned upload expires: later parts and finish refuse, the sweep aborts it once, and only its uploader or a company-wide caller can close it', async () => {
  const w = fresh(); const id = await asset(w, 'abandon');
  const a = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(a.ok);
  assert.ok((await send(w, a.uploadUid, PNG, 1)).ok);
  const t0 = clock.t;
  clock.t = t0 + DAY - 1;
  assert.ok((await send(w, a.uploadUid, PNG, 2)).ok, 'still open just before expiry');
  assert.deepEqual((await sweepMediaMultiparts(w.env, CTX, { scope: SCOPE }) as { abandoned: string[] }).abandoned, []);
  clock.t = t0 + DAY;
  assert.equal(code(await send(w, a.uploadUid, PNG, 3)), 'upload_expired');
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: a.uploadUid })), 'upload_expired');
  assert.equal(code(await sweepMediaMultiparts(w.env, OTHER_CTX, { scope: SCOPE })), 'wrong_tenant');
  assert.equal(code(await sweepMediaMultiparts(w.env, { scope: SCOPE }, { scope: SCOPE })), 'wrong_tenant', 'a project caller cannot sweep the company');
  assert.equal(code(await sweepMediaMultiparts(w.env, CTX, { scope: SCOPE, limit: 501 })), 'malformed');
  const swept = await sweepMediaMultiparts(w.env, CTX, { scope: SCOPE });
  assert.ok(swept.ok); assert.deepEqual(swept.abandoned, [a.uploadUid]); assert.equal(w.r2.ops.mpAbort, 1);
  assert.deepEqual(session(w, a.uploadUid), { status: 'abandoned', close_code: 'expired', next_part: 3 });
  assert.equal((await sweepMediaMultiparts(w.env, CTX, { scope: SCOPE }) as { abandoned: string[] }).abandoned.length, 0);
  assert.equal(rows(w, 'SELECT closed_at FROM work_graph_media_uploads WHERE upload_uid = ?', a.uploadUid)[0].closed_at, new Date(clock.t).toISOString());
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 0); assert.equal(w.r2.objects.size, 0);
  // An explicit abandon: never by another member or tenant; by the uploader, once.
  const b = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(b.ok);
  assert.equal(code(await abandonMediaMultipart(w.env, CTX, { uploadUid: b.uploadUid, by: BOB })), 'not_uploader');
  assert.equal(code(await abandonMediaMultipart(w.env, OTHER_CTX, { uploadUid: b.uploadUid, by: ALICE })), 'wrong_tenant');
  const closed = await abandonMediaMultipart(w.env, CTX, { uploadUid: b.uploadUid, by: ALICE }); assert.ok(closed.ok && closed.changed);
  assert.equal(code(await abandonMediaMultipart(w.env, CTX, { uploadUid: b.uploadUid, by: ALICE })), 'upload_closed');
  assert.equal(code(await abandonMediaMultipart(w.env, CTX, { uploadUid: 'absent', by: ALICE })), 'not_found');
  w.db.close();
});

test('open uploads are bounded per company; expired sessions no longer count', async () => {
  const w = fresh(); const id = await asset(w, 'bounded');
  for (let i = 0; i < 3; i++) assert.ok((await beginMediaMultipart(w.env, CTX, request(id, PNG), L)).ok);
  assert.equal(code(await beginMediaMultipart(w.env, CTX, request(id, PNG), L)), 'too_many_open');
  assert.equal(w.r2.ops.mpCreate, 3);
  clock.t += DAY;
  assert.equal(code(await beginMediaMultipart(w.env, CTX, request(id, PNG), L)), 'ok');
  w.db.close();
});

test('begin refuses before any R2 upload opens: buffered sizes, scope, author, head, rights, residency, binding and shape', async () => {
  const w = fresh(); const id = await asset(w, 'begin');
  const cases: [Parameters<typeof beginMediaMultipart>[1], Partial<BeginMultipartInput>, string][] = [
    [CTX, { byteLength: PART, digest: hex(PNG.slice(0, PART)) }, 'use_buffered'],
    [CTX, { declaredMime: 'image/svg+xml' }, 'oversized'],
    [CTX, { declaredMime: 'application/zip' }, 'unsupported_format'],
    [CTX, { objectClass: 'thumbnail', byteLength: 3 * 1024 * 1024 }, 'oversized'],
    [OTHER_CTX, {}, 'wrong_tenant'],
    [{ scope: { ...SCOPE, projectId: 701 } }, {}, 'wrong_tenant'],
    [{ ...CTX, revokedUserIds: new Set([11]) }, {}, 'revoked_author'],
    [CTX, { expectedHead: 'not-the-head' }, 'stale_head'],
    [CTX, { kind: 'model_3d', declaredMime: 'model/gltf-binary' }, 'wrong_kind'],
    [CTX, { provenance: { ...provenance(), rights: { basis: 'owned', usageScope: ['deck'], revokedAt: '2026-11-01T00:00:00Z' } } as never }, 'provenance'],
    [CTX, { residency: 'eu' }, 'residency_mismatch'],
    [CTX, { digest: 'A'.repeat(64) }, 'malformed'],
    [CTX, { assetUid: 'absent' }, 'not_found'],
  ];
  for (const [ctx, over, expected] of cases) assert.equal(code(await beginMediaMultipart(w.env, ctx, request(id, PNG, over), L)), expected, expected);
  assert.equal(code(await beginMediaMultipart(w.env, CTX, request(id, PNG), { ...L, partBytes: 100 })), 'malformed', 'parts end on a hash block');
  assert.equal(code(await beginMediaMultipart(w.env, CTX, request(id, PNG), { ...L, partBytes: 16 * 1024 * 1024, minBytes: 16 * 1024 * 1024 + 1 })), 'malformed', 'never a part above the buffered cap');
  const unbound = world({ files: false }); owners(unbound); const id2 = await asset(unbound, 'unbound');
  assert.equal(code(await beginMediaMultipart(unbound.env, CTX, request(id2, PNG), L)), 'no_binding');
  assert.equal(w.r2.ops.mpCreate, 0); assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_media_uploads'), 0);
  assert.equal(count(w, "SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE action = 'blob_refused'"), 11, 'audited after the shape checks');
  w.db.close(); unbound.db.close();
});

test('finish re-admits on the current head and clock and requires the declared context; a stale or revoked upload closes, a mismatched one stays open', async () => {
  const w = fresh(); const id = await asset(w, 'finish');
  const expiring = provenance(); expiring.rights.expiresAt = new Date(clock.t + 2 * 60 * 60 * 1000).toISOString();
  const r = request(id, PNG, { provenance: expiring as never });
  const a = await beginMediaMultipart(w.env, CTX, r, L); assert.ok(a.ok);
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...r, uploadUid: a.uploadUid })), 'incomplete');
  await sendAll(w, a.uploadUid, PNG);
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...r, use: 'web', uploadUid: a.uploadUid })), 'context_mismatch');
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...r, by: BOB, uploadUid: a.uploadUid })), 'not_uploader');
  assert.equal(code(await finishMediaMultipart(w.env, OTHER_CTX, { ...r, uploadUid: a.uploadUid })), 'wrong_tenant');
  assert.equal(session(w, a.uploadUid).status, 'open');
  clock.t += 3 * 60 * 60 * 1000;
  const revoked = await finishMediaMultipart(w.env, CTX, { ...r, uploadUid: a.uploadUid });
  assert.ok(!revoked.ok && revoked.code === 'provenance'); assert.deepEqual(revoked.provenance, ['license_expired']);
  assert.deepEqual(session(w, a.uploadUid), { status: 'failed', close_code: 'provenance', next_part: 5 });
  assert.equal(w.r2.objects.size, 0); assert.equal(w.r2.ops.mpAbort, 1);
  // The head moved between begin and finish: the upload was for a head that is gone.
  const b = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(b.ok);
  await sendAll(w, b.uploadUid, PNG);
  const seed = await storeMediaUpload(w.env, CTX, { ...request(id, PNG), bytes: PNG, objectClass: 'snapshot' } as never); assert.ok(seed.ok);
  const rev = await blobRev(w, id, 'moved', seed.digest, seed.size, { source: seed.source });
  assert.ok((await advance(w, id, null, rev, 'moved', { actor: ALICE, approval: { ref: 'synthetic', contentDigest: seed.digest, reviewer: ALICE, decidedAt: new Date(clock.t).toISOString() } })).ok);
  assert.equal(code(await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: b.uploadUid })), 'stale_head');
  assert.equal(session(w, b.uploadUid).status, 'failed');
  assert.equal(w.r2.objects.has(blobKey(SCOPE, hex(PNG), 'master')), false);
  w.db.close();
});

test('dedup stays inside the exact namespace: bytes already intact at the key are reused (the upload aborted), another project stores its own', async () => {
  const w = fresh(); const id = await asset(w, 'dedup');
  const buffered = await storeMediaUpload(w.env, CTX, { ...request(id, PNG), bytes: PNG } as never); assert.ok(buffered.ok);
  const a = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(a.ok);
  assert.equal(a.quota.incoming, 0, 'bytes already live in the namespace are not charged again');
  await sendAll(w, a.uploadUid, PNG);
  const done = await finishMediaMultipart(w.env, CTX, { ...request(id, PNG), uploadUid: a.uploadUid });
  assert.ok(done.ok && done.reused, JSON.stringify(done)); assert.equal(done.key, buffered.key);
  assert.equal(w.r2.ops.mpComplete, 0); assert.equal(w.r2.ops.mpAbort, 1);
  assert.equal(w.r2.objects.get(done.key)!.sha256, hex(PNG), 'the buffered object, with its R2 checksum, is kept');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 1);
  assert.deepEqual(session(w, a.uploadUid), { status: 'completed', close_code: 'reused', next_part: 5 });
  const other = await asset(w, 'dedup-701', { scope: { ...SCOPE, projectId: 701 } });
  const b = await beginMediaMultipart(w.env, CTX, request(other, PNG), L); assert.ok(b.ok);
  assert.equal(b.quota.incoming, PNG.length); assert.match(b.key, /media\/p701\/master/);
  await sendAll(w, b.uploadUid, PNG);
  const separate = await finishMediaMultipart(w.env, CTX, { ...request(other, PNG), uploadUid: b.uploadUid });
  assert.ok(separate.ok && !separate.reused); assert.notEqual(separate.key, done.key);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 2);
  // The same bytes again in 701: the multipart object has no R2 checksum to prove it intact, so the parts are
  // committed over it (the same bytes), and the live ledger row makes it a reuse, charged nothing.
  const c = await beginMediaMultipart(w.env, CTX, request(other, PNG), L); assert.ok(c.ok); assert.equal(c.quota.incoming, 0);
  await sendAll(w, c.uploadUid, PNG);
  const repeat = await finishMediaMultipart(w.env, CTX, { ...request(other, PNG), uploadUid: c.uploadUid });
  assert.ok(repeat.ok && repeat.reused, JSON.stringify(repeat)); assert.equal(w.r2.ops.mpComplete, 2);
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 2);
  assert.deepEqual(w.r2.objects.get(repeat.key)!.bytes, PNG);
  w.db.close();
});

test('an agent upload stays the agent run\'s: the same person outside the run cannot continue it', async () => {
  const w = fresh(); const id = await asset(w, 'agent');
  const run = agent('run_mp');
  const a = await beginMediaMultipart(w.env, CTX, request(id, PNG, { by: run }), L); assert.ok(a.ok);
  assert.equal(code(await send(w, a.uploadUid, PNG, 1, ALICE)), 'not_uploader');
  assert.equal(code(await send(w, a.uploadUid, PNG, 1, agent('run_other'))), 'not_uploader');
  assert.ok((await send(w, a.uploadUid, PNG, 1, run)).ok);
  assert.equal(code(await uploadMediaPart(w.env, { ...CTX, revokedAgentRunIds: new Set(['run_mp']) }, { uploadUid: a.uploadUid, partNumber: 2, bytes: partOf(PNG, 2), partDigest: hex(partOf(PNG, 2)), by: run })), 'revoked_author');
  w.db.close();
});

test('verify streams a media object R2 holds no checksum for; generic objects and objects past the bound stay unverifiable', async () => {
  const w = fresh();
  const digest = hex(PNG); const key = blobKey(SCOPE, digest, 'master');
  const small = { ...WORK_GRAPH_BLOB_LIMITS, deepVerifyMaxBytes: 64 };
  w.r2.plant(key, PNG.slice());
  assert.deepEqual(await verifyBlob(w.env, SCOPE, digest, PNG.length, small, 'master'), { ok: true, method: 'stream', size: PNG.length, r2ClassB: 2 });
  assert.deepEqual(await verifyBlob(w.env, SCOPE, digest, PNG.length, { ...small, streamVerifyMaxBytes: PNG.length - 1 }, 'master'),
    { ok: false, code: 'digest_mismatch', detail: 'unverifiable', r2ClassB: 1 });
  w.r2.plant(blobKey(SCOPE, digest), PNG.slice());
  assert.equal((await verifyBlob(w.env, SCOPE, digest, PNG.length, small) as { detail: string }).detail, 'unverifiable');
  w.r2.rot(key);
  assert.deepEqual(await verifyBlob(w.env, SCOPE, digest, PNG.length, small, 'master'), { ok: false, code: 'digest_mismatch', detail: 'stream', r2ClassB: 2 });
  // recordFinishedBlob verifies before it records, and records only media classes in scope.
  const id = await asset(w, 'record');
  const base = { scope: SCOPE, objectClass: 'master' as const, digest, size: PNG.length, storageOwnerUserId: 11, accessClass: 'confidential' as const, actor: ALICE, assetUid: id, reused: false };
  assert.equal(code(await recordFinishedBlob(w.env, CTX, base, small)), 'digest_mismatch');
  assert.equal(code(await recordFinishedBlob(w.env, OTHER_CTX, base, small)), 'wrong_tenant');
  assert.equal(code(await recordFinishedBlob(w.env, CTX, { ...base, objectClass: 'generic' as never }, small)), 'malformed');
  assert.equal(code(await recordFinishedBlob(w.env, CTX, { ...base, digest: 'e'.repeat(64) }, small)), 'missing_bytes');
  assert.equal(count(w, 'SELECT COUNT(*) AS n FROM work_graph_blobs'), 0);
  w.db.close();
});

test('the session tables keep identity and part digests fixed, and a closed session cannot be reopened', async () => {
  const w = fresh(); const id = await asset(w, 'schema');
  const a = await beginMediaMultipart(w.env, CTX, request(id, PNG), L); assert.ok(a.ok);
  assert.ok((await send(w, a.uploadUid, PNG, 1)).ok);
  assert.throws(() => w.db.prepare('UPDATE work_graph_media_uploads SET digest = ?').run('0'.repeat(64)), /only an open session/);
  assert.throws(() => w.db.prepare('UPDATE work_graph_media_uploads SET byte_length = 1').run(), /only an open session/);
  assert.throws(() => w.db.prepare('UPDATE work_graph_media_upload_parts SET digest = ?').run('0'.repeat(64)), /keeps its digest/);
  w.db.prepare("UPDATE work_graph_media_upload_parts SET etag = 'refreshed'").run();
  assert.ok((await abandonMediaMultipart(w.env, CTX, { uploadUid: a.uploadUid, by: ALICE })).ok);
  assert.throws(() => w.db.prepare("UPDATE work_graph_media_uploads SET status = 'open'").run(), /only an open session/);
  assert.equal(rows(w, 'SELECT hash_words FROM work_graph_media_uploads')[0].hash_words, Sha256.resume({ words: new Sha256().exportState().words, bytes: 0 }).update(partOf(PNG, 1)).exportState().words);
  w.db.close();
});

test('the record-store multipart helpers refuse a key that is not its digest, and a commit whose chained hash is not the key', async () => {
  const w = fresh();
  const digest = hex(PNG); const key = blobKey(SCOPE, digest, 'master');
  await assert.rejects(createContentAddressedMultipart(w.r2 as never, key, 'e'.repeat(64)), /content_address_mismatch/);
  await assert.rejects(uploadContentAddressedPart(w.r2 as never, `${key}x`, digest, 'u', 1, PNG), /content_address_mismatch/);
  await assert.rejects(abortContentAddressedMultipart(w.r2 as never, key, 'e'.repeat(64), 'u'), /content_address_mismatch/);
  const upload = await createContentAddressedMultipart(w.r2 as never, key, digest);
  const part = await uploadContentAddressedPart(w.r2 as never, key, digest, upload.uploadId, 1, PNG);
  await assert.rejects(completeContentAddressedMultipart(w.r2 as never, key, digest, 'e'.repeat(64), upload.uploadId, [part]), /content_address_mismatch/);
  assert.equal(w.r2.ops.mpComplete, 0); assert.equal(w.r2.objects.size, 0);
  await completeContentAddressedMultipart(w.r2 as never, key, digest, digest, upload.uploadId, [part]);
  assert.deepEqual(w.r2.objects.get(key)!.bytes, PNG);
  w.db.close();
});
