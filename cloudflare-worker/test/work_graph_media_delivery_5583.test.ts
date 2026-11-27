/**
 * D5583 part 4 — short-lived signed delivery of media revisions, streamed through the existing blob service.
 * Synthetic bytes, the in-memory R2 and the #5581 SQLite world only; the clock is the world's variable. The signing
 * secret below is a synthetic test value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  MEDIA_DELIVERY_DEPS, MEDIA_DELIVERY_LIMITS, MEDIA_DELIVERY_PURPOSE, mintMediaDelivery, openMediaDelivery,
} from '../src/services/workGraphMediaDelivery.ts';
import { blobKey, blobSourceRef, setRevisionOffline, streamRevisionBytes } from '../src/services/workGraphBlobs.ts';
import { tombstoneRevision } from '../src/services/workGraphRevisions.ts';
import { verifyingStream } from '../src/services/sha256Incremental.ts';
import { mintDownloadToken, signPurposeToken, verifyAndConsumeToken, verifyPurposeToken } from '../src/services/signedDownload.ts';
import {
  ALICE, BOB, CTX, OTHER_CTX, SCOPE, advance, asset, blobRev, bytesOf, clock, rows, world, type W,
} from './_work_graph_world_5581.ts';

const SECRET = 'synthetic-test-secret-5583-p4';
let ids = 0;
MEDIA_DELIVERY_DEPS.newId = () => `dl${++ids}`;

const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const fill = (n: number, seed: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed + (i >>> 10)) & 255; return b; };
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);
const approval = (digest: string) => ({ ref: 'synthetic-review', contentDigest: digest, reviewer: ALICE, decidedAt: new Date(clock.t).toISOString() });

function fresh(): W { const w = world(); w.env.JWT_SECRET = SECRET; return w; }

/** A media revision of `bytes` that is its asset's head. `checksum: false` is how a completed multipart object sits in R2. */
async function headed(w: W, key: string, bytes: Uint8Array, o: { checksum?: boolean; objectClass?: 'master' | 'snapshot' | 'generic'; assetUid?: string; expected?: string | null; parents?: string[] } = {}) {
  const id = o.assetUid ?? await asset(w, key);
  const digest = hex(bytes);
  const cls = o.objectClass ?? 'master';
  w.r2.plant(blobKey(SCOPE, digest, cls), bytes, o.checksum === false ? null : digest, { digest });
  const rev = await blobRev(w, id, key, digest, bytes.byteLength, { source: blobSourceRef(SCOPE, digest, cls), parents: o.parents ?? [] });
  const h = await advance(w, id, o.expected ?? null, rev, key, { actor: ALICE, approval: approval(digest) });
  assert.ok(h.ok, JSON.stringify(h));
  return { id, rev, digest, key: blobKey(SCOPE, digest, cls) };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<{ bytes: Uint8Array; error: unknown }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let error: unknown = null;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); } } catch (e) { error = e; }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0; for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return { bytes: out, error };
}
const events = (w: W) => rows(w, "SELECT action, outcome, refusal_code, revision_uid, detail_json FROM work_graph_integrity_events WHERE action IN ('bytes_read','read_refused') ORDER BY id");
/** A token signed with the real key over claims the minter never issued: what a leaked key or a minting bug would produce. */
async function forged(w: W, claims: Record<string, unknown>) {
  const t = await signPurposeToken(w.env, MEDIA_DELIVERY_PURPOSE, claims); assert.ok(t); return t!;
}
const claimsOf = async (w: W, token: string) => (await verifyPurposeToken(w.env, MEDIA_DELIVERY_PURPOSE, token))!;

const BYTES = fill(5000, 1);

test('a minted link streams the head revision once verified, may be reopened before expiry, and is audited per open', async () => {
  const w = fresh(); const m = await headed(w, 'ok', BYTES);
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE });
  assert.ok(link.ok, JSON.stringify(link));
  assert.equal(link.digest, m.digest); assert.equal(link.size, BYTES.byteLength); assert.equal(link.objectClass, 'master');
  assert.equal(link.expiresAt, new Date(clock.t + MEDIA_DELIVERY_LIMITS.maxTtlSec * 1000).toISOString());
  assert.equal(link.cost.d1Statements, 1); assert.equal(link.cost.r2ClassB, 0);
  // The token names ids, a digest and numbers; never the object key or any content.
  const claims = await claimsOf(w, link.token);
  assert.deepEqual(Object.keys(claims).sort(), ['a', 'c', 'd', 'exp', 'iat', 'jti', 'k', 'n', 'p', 'pr', 'r', 'run', 's', 'sub', 't', 'v']);
  assert.ok(!link.token.includes(m.key));
  for (let i = 0; i < 2; i++) {
    const open = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB });
    assert.ok(open.ok, JSON.stringify(open));
    assert.equal(open.method, 'checksum'); assert.equal(open.mediaProfile, 'image/png'); assert.equal(open.revisionUid, m.rev);
    const got = await readAll(open.body); assert.equal(got.error, null); assert.deepEqual(got.bytes, BYTES);
  }
  const ev = events(w);
  assert.equal(ev.length, 2);
  for (const e of ev) {
    assert.equal(e.action, 'bytes_read'); assert.equal(e.revision_uid, m.rev);
    const d = JSON.parse(e.detail_json); assert.equal(d.link, claims.jti); assert.equal(d.minted_by, 11); assert.equal(d.delivery, 'signed'); assert.equal(d.streamed, true);
  }
  // A media link and a download link are separate purposes: neither redeems as the other.
  const asDownload = await verifyAndConsumeToken(w.env, link.token);
  assert.ok('error' in asDownload);
  const dl = await mintDownloadToken(w.env, { key: m.key, audience: 'admin', userId: 11 });
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: dl.token, reader: BOB })), 'bad_signature');
  w.db.close();
});

test('wrong tenant: minting and opening outside the bound scope, and a validly signed token naming another tenant, fail closed', async () => {
  const w = fresh(); const m = await headed(w, 'tenant', BYTES);
  assert.equal(code(await mintMediaDelivery(w.env, OTHER_CTX, { revisionUid: m.rev, actor: BOB })), 'wrong_tenant');
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE }); assert.ok(link.ok);
  const get = w.r2.ops.get;
  const foreign = await openMediaDelivery(w.env, OTHER_CTX, { token: link.token, reader: BOB });
  assert.equal(code(foreign), 'wrong_tenant');
  assert.equal(foreign.cost.d1Statements, 1, 'refused on the claims alone: only the audit row, no revision read');
  // Another project of the same company does not cover this project's revision.
  const otherProject = { scope: { tenantId: SCOPE.tenantId, companyId: SCOPE.companyId, projectId: 701 } };
  assert.equal(code(await openMediaDelivery(w.env, otherProject, { token: link.token, reader: BOB })), 'wrong_tenant');
  // Claims rewritten to the other tenant (and signed with the real key) still meet the revision's own scope.
  const claims = await claimsOf(w, link.token);
  const moved = await forged(w, { ...claims, t: 8, c: 80, pr: null });
  assert.equal(code(await openMediaDelivery(w.env, OTHER_CTX, { token: moved, reader: BOB })), 'wrong_tenant');
  // Claims widened to the company (project null) for a reader who covers it: the binding no longer names the revision's scope.
  const widened = await openMediaDelivery(w.env, CTX, { token: await forged(w, { ...claims, pr: null }), reader: BOB });
  assert.equal(code(widened), 'wrong_tenant'); assert.ok(!widened.ok && widened.ids.includes('binding'));
  assert.equal(w.r2.ops.get, get, 'no byte was fetched for a wrong tenant');
  const refused = events(w).filter((e) => e.action === 'read_refused');
  assert.deepEqual(refused.map((e) => e.refusal_code), ['wrong_tenant', 'wrong_tenant', 'wrong_tenant', 'wrong_tenant', 'wrong_tenant']);
  w.db.close();
});

test('an expired link is refused; the TTL is capped at five minutes and a claim widening it is refused', async () => {
  const w = fresh(); const m = await headed(w, 'expiry', BYTES);
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE, ttlSec: MEDIA_DELIVERY_LIMITS.maxTtlSec + 1 })), 'malformed');
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE, ttlSec: 0 })), 'malformed');
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE, ttlSec: 60 }); assert.ok(link.ok);
  clock.t += 59_000;
  const open = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB }); assert.ok(open.ok); await open.body.cancel();
  clock.t += 1_000;
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB })), 'expired');
  // A signed claim set whose lifetime exceeds the cap is not a link this service issues.
  const claims = await claimsOf(w, link.token);
  const long = await forged(w, { ...claims, iat: Math.floor(clock.t / 1000), exp: Math.floor(clock.t / 1000) + MEDIA_DELIVERY_LIMITS.maxTtlSec + 1 });
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: long, reader: BOB })), 'malformed');
  assert.equal(events(w).at(-2)!.refusal_code, 'expired');
  w.db.close();
});

test('a tampered signature, a tampered payload, another key and a missing key are all refused before any read', async () => {
  const w = fresh(); const m = await headed(w, 'tamper', BYTES);
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE }); assert.ok(link.ok);
  const [p, sig] = link.token.split('.');
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  const get = w.r2.ops.get;
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: `${p}.${flip(sig, 3)}`, reader: BOB })), 'bad_signature');
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: `${flip(p, 10)}.${sig}`, reader: BOB })), 'bad_signature');
  // A payload re-encoded with one claim changed, under the old signature.
  const claims = await claimsOf(w, link.token);
  const swapped = Buffer.from(JSON.stringify({ ...claims, s: 99 })).toString('base64url');
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: `${swapped}.${sig}`, reader: BOB })), 'bad_signature');
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: `${p}.${sig}.x`, reader: BOB })), 'bad_signature');
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: 'x'.repeat(5000), reader: BOB })), 'bad_signature');
  // Signed for another purpose with the same secret.
  const other = await signPurposeToken(w.env, 'learning-other', { ...claims });
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: other!, reader: BOB })), 'bad_signature');
  // The key is derived for this purpose: the raw secret's HMAC is not the signature, and a payload of another purpose
  // signed under this purpose's key is still refused.
  assert.notEqual(createHmac('sha256', SECRET).update(p).digest('base64url'), sig);
  const otherP = Buffer.from(JSON.stringify({ ...claims, p: 'learning-other' })).toString('base64url');
  const otherSig = createHmac('sha256', `${MEDIA_DELIVERY_PURPOSE}:${SECRET}`).update(otherP).digest('base64url');
  assert.equal(createHmac('sha256', `${MEDIA_DELIVERY_PURPOSE}:${SECRET}`).update(p).digest('base64url'), sig);
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: `${otherP}.${otherSig}`, reader: BOB })), 'bad_signature');
  // Too short a secret signs and verifies nothing; an oversized token is refused even when its signature is valid.
  assert.equal(await signPurposeToken({ JWT_SECRET: 'fifteen-chars!!' } as never, MEDIA_DELIVERY_PURPOSE, { a: 1 }), null);
  assert.equal(await verifyPurposeToken({ JWT_SECRET: 'fifteen-chars!!' } as never, MEDIA_DELIVERY_PURPOSE, `${otherP}.${otherSig}`), null);
  assert.equal(await signPurposeToken(w.env, MEDIA_DELIVERY_PURPOSE, { pad: 'x'.repeat(3000) }), null);
  const bigP = Buffer.from(JSON.stringify({ ...claims, pad: 'x'.repeat(3000) })).toString('base64url');
  const bigSig = createHmac('sha256', `${MEDIA_DELIVERY_PURPOSE}:${SECRET}`).update(bigP).digest('base64url');
  assert.equal(await verifyPurposeToken(w.env, MEDIA_DELIVERY_PURPOSE, `${bigP}.${bigSig}`), null);
  const smallP = Buffer.from(JSON.stringify({ ...claims, pad: 'x' })).toString('base64url');
  assert.ok(await verifyPurposeToken(w.env, MEDIA_DELIVERY_PURPOSE, `${smallP}.${createHmac('sha256', `${MEDIA_DELIVERY_PURPOSE}:${SECRET}`).update(smallP).digest('base64url')}`));
  w.env.JWT_SECRET = 'another-synthetic-secret-5583';
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB })), 'bad_signature');
  w.env.JWT_SECRET = 'short';
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB })), 'no_signing_key');
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE })), 'no_signing_key');
  assert.equal(w.r2.ops.get, get);
  w.db.close();
});

test('a stale revision stops its link: superseded by a newer head or another head sequence, revoked offline, tombstoned or by a revoked minter', async () => {
  const w = fresh(); const v1 = await headed(w, 'v1', BYTES);
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: v1.rev, actor: ALICE }); assert.ok(link.ok);
  // Revoked minter: the reader's context says the person who minted it lost access.
  assert.equal(code(await openMediaDelivery(w.env, { ...CTX, revokedUserIds: new Set([11]) }, { token: link.token, reader: BOB })), 'revoked');
  assert.equal(code(await mintMediaDelivery(w.env, { ...CTX, revokedUserIds: new Set([11]) }, { revisionUid: v1.rev, actor: ALICE })), 'revoked');
  // Offline (revoked by a person): refused now, served again once back online.
  assert.ok((await setRevisionOffline(w.env, CTX, { revisionUid: v1.rev, offline: true, actor: ALICE, reason: 'synthetic' })).ok);
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB })), 'offline');
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: v1.rev, actor: ALICE })), 'offline');
  assert.ok((await setRevisionOffline(w.env, CTX, { revisionUid: v1.rev, offline: false, actor: ALICE, reason: 'synthetic' })).ok);
  const back = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB }); assert.ok(back.ok); await back.body.cancel();
  // Superseded: the head moves to v2.
  const v2 = await headed(w, 'v2', fill(3000, 2), { assetUid: v1.id, expected: v1.rev, parents: [v1.rev] });
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB })), 'superseded');
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: v1.rev, actor: ALICE })), 'superseded');
  // A v1 link claiming the current head sequence still names a revision that is no longer the head.
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: await forged(w, { ...(await claimsOf(w, link.token)), s: 2 }), reader: BOB })), 'superseded');
  // The head sequence is bound too: a link claiming v2 at any other sequence than the current one is superseded.
  const v2link = await mintMediaDelivery(w.env, CTX, { revisionUid: v2.rev, actor: ALICE }); assert.ok(v2link.ok);
  const c2 = await claimsOf(w, v2link.token);
  assert.equal(c2.s, 2);
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: await forged(w, { ...c2, s: 1 }), reader: BOB })), 'superseded');
  const fine = await openMediaDelivery(w.env, CTX, { token: v2link.token, reader: BOB }); assert.ok(fine.ok); await fine.body.cancel();
  // Tombstoned: v1 is no longer the head and is tombstoned; a token forged at its old head sequence names a revoked revision.
  assert.ok((await tombstoneRevision(w.env, CTX, { revisionUid: v1.rev, actor: ALICE, reason: 'synthetic' })).ok);
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: v1.rev, actor: ALICE })), 'revoked');
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB })), 'revoked');
  w.db.close();
});

test('a checksum mismatch is refused: in the claims before any byte is fetched, in R2 before the first byte, and in the body before the last byte', async () => {
  const w = fresh(); const m = await headed(w, 'sum', BYTES);
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE }); assert.ok(link.ok);
  const claims = await claimsOf(w, link.token);
  const get = w.r2.ops.get;
  for (const over of [{ d: hex(bytesOf('other')) }, { n: BYTES.byteLength + 1 }]) {
    const r = await openMediaDelivery(w.env, CTX, { token: await forged(w, { ...claims, ...over }), reader: BOB });
    assert.equal(code(r), 'digest_mismatch'); assert.ok(!r.ok && r.ids.includes('binding'));
  }
  // A class the revision does not have.
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: await forged(w, { ...claims, k: 'thumbnail' }), reader: BOB })), 'not_media');
  assert.equal(w.r2.ops.get, get, 'a mismatched binding fetches nothing');
  // R2's own checksum disagrees with the digest: refused before a byte is handed out.
  const o = w.r2.objects.get(m.key)!;
  o.sha256 = hex(bytesOf('not these bytes'));
  const early = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB });
  assert.equal(code(early), 'digest_mismatch'); assert.ok(!early.ok && early.ids.includes('checksum'));
  o.sha256 = m.digest;
  // The body rotted under an intact checksum record: the stream errors and the last chunk is never released.
  w.r2.rot(m.key);
  const late = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB }); assert.ok(late.ok);
  const got = await readAll(late.body);
  assert.ok(got.error instanceof Error); assert.ok(got.bytes.byteLength < BYTES.byteLength);
  const last = events(w).at(-1)!;
  assert.equal(last.action, 'read_refused'); assert.equal(last.refusal_code, 'digest_mismatch'); assert.equal(JSON.parse(last.detail_json).phase, 'digest');
  // A truncated object is caught by size before any byte.
  w.r2.truncate(m.key);
  const short = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB });
  assert.equal(code(short), 'digest_mismatch'); assert.ok(!short.ok && short.ids.includes('size'));
  w.db.close();
});

test('only a typed media head is deliverable: a generic blob and a revision of bytes a domain holds are refused', async () => {
  const w = fresh();
  const g = await headed(w, 'generic', BYTES, { objectClass: 'generic' });
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: g.rev, actor: ALICE })), 'not_media');
  const r = await headed(w, 'snapshot', fill(700, 9), { objectClass: 'snapshot' });
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: r.rev, actor: ALICE }); assert.ok(link.ok); assert.equal(link.objectClass, 'snapshot');
  assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: 'nope', actor: ALICE })), 'not_found');
  // A revision row whose source is another digest's media key is not served as this digest.
  const other = fill(800, 11); const od = hex(other);
  w.r2.plant(blobKey(SCOPE, od, 'master'), other, od, { digest: od });
  const lie = await headed(w, 'lie', fill(900, 12));
  w.db.prepare("INSERT INTO work_graph_revisions (revision_uid, asset_uid, tenant_id, company_id, project_id, seq, digest, byte_length, media_profile, source_store, source_locator, source_id, source_revision, actor_kind, actor_user_id, idempotency_key, request_hash, created_at) VALUES ('wgr_lie', ?, 7, 70, 700, 2, ?, 900, 'image/png', 'r2_object', 'FILES', ?, ?, 'person', 11, 'lie-2', ?, ?)")
    .run(lie.id, lie.digest, blobKey(SCOPE, od, 'master'), lie.digest, 'f'.repeat(64), new Date(clock.t).toISOString());
  w.db.prepare("UPDATE work_graph_assets SET head_revision_uid = 'wgr_lie', head_seq = head_seq + 1 WHERE asset_uid = ?").run(lie.id);
  const refused = await mintMediaDelivery(w.env, CTX, { revisionUid: 'wgr_lie', actor: ALICE });
  assert.equal(code(refused), 'digest_mismatch'); assert.ok(!refused.ok && refused.ids.includes('key'));
  assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: { kind: 'person', userId: 0 } as never })), 'malformed');
  w.db.close();
});

test('a large multipart-shaped object streams in bounded memory: bytes flow before the body is read whole, and a rotted last byte never completes', async () => {
  const SIZE = 40 * 1024 * 1024 + 123; // above the 8 MiB buffered cap and the deep-verify bound
  const big = fill(SIZE, 7);
  const digest = hex(big);
  const w = fresh();
  // R2 with a pull-based body: count what has been pulled, and refuse any whole-object read.
  let pulled = 0;
  const files = w.env.FILES;
  w.env.FILES = new Proxy(files, { get(t, prop) {
    const v = Reflect.get(t, prop, t);
    if (prop !== 'get') return typeof v === 'function' ? v.bind(t) : v;
    return async (key: string) => {
      const o = await t.get(key);
      if (!o) return o;
      const bytes = w.r2.objects.get(key)!.bytes;
      let at = 0;
      return { ...o, arrayBuffer: async () => { throw new Error('buffered read'); },
        body: new ReadableStream<Uint8Array>({ pull(c) {
          if (at >= bytes.byteLength) { c.close(); return; }
          const n = Math.min(64 * 1024, bytes.byteLength - at); c.enqueue(bytes.slice(at, at + n)); at += n; pulled += n;
        } }, { highWaterMark: 0 }) };
    };
  } });
  const m = await headed(w, 'big', big);
  assert.equal(m.digest, digest);
  const link = await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE }); assert.ok(link.ok);
  pulled = 0;
  const open = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB }); assert.ok(open.ok, JSON.stringify(open));
  assert.equal(open.size, SIZE);
  const reader = open.body.getReader();
  const first = await reader.read();
  assert.ok(!first.done && first.value.byteLength > 0);
  assert.ok(pulled < 1024 * 1024, `only a few chunks pulled before the first byte left (${pulled})`);
  const h = createHash('sha256').update(first.value); let total = first.value.byteLength;
  for (;;) { const { done, value } = await reader.read(); if (done) break; h.update(value); total += value.byteLength; }
  assert.equal(total, SIZE); assert.equal(h.digest('hex'), digest);
  // The last byte rots: everything but the held-back chunk may flow, and the stream errors instead of closing.
  const stored = w.r2.objects.get(m.key)!; stored.bytes[SIZE - 1] ^= 0xff;
  const bad = await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB }); assert.ok(bad.ok);
  const r2 = bad.body.getReader(); let seen = 0; let err: unknown = null;
  try { for (;;) { const { done, value } = await r2.read(); if (done) break; seen += value.byteLength; } } catch (e) { err = e; }
  assert.ok(err instanceof Error); assert.ok(seen < SIZE && seen >= SIZE - 64 * 1024, `held back one chunk (${SIZE - seen})`);
  w.db.close();
});

test('streamRevisionBytes without a binding streams a multipart-shaped object with no R2 checksum and verifies it as it passes', async () => {
  const w = fresh(); const bytes = fill(9 * 1024 * 1024 + 5, 4);
  const m = await headed(w, 'nosum', bytes, { checksum: false });
  const s = await streamRevisionBytes(w.env, CTX, { revisionUid: m.rev, actor: ALICE }); assert.ok(s.ok);
  assert.equal(s.method, 'stream');
  const got = await readAll(s.body); assert.equal(got.error, null); assert.equal(hex(got.bytes), m.digest);
  assert.equal(code(await streamRevisionBytes(w.env, OTHER_CTX, { revisionUid: m.rev, actor: BOB })), 'wrong_tenant');
  w.db.close();
});

test('verifyingStream: passes exact bytes, errors on extra bytes as they arrive, and on a short or wrong body at the end', async () => {
  const b = fill(3000, 3); const want = { hex: hex(b), bytes: b.byteLength };
  const src = (x: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < x.byteLength; i += 700) c.enqueue(x.slice(i, i + 700)); c.close(); } });
  const seen: string[] = [];
  const note = async (r: { ok: boolean; detail?: string }) => { seen.push(r.ok ? 'ok' : r.detail!); };
  assert.deepEqual((await readAll(verifyingStream(src(b), want, note))).bytes, b);
  // Extra bytes stop the stream at the chunk that crosses the declared size, not at the end of a longer body.
  const long = new Uint8Array(10_000); long.set(b);
  const extra = await readAll(verifyingStream(src(long), want, note)); assert.ok(extra.error); assert.equal(extra.bytes.byteLength, 2100);
  const short = await readAll(verifyingStream(src(b.slice(0, 2999)), want, note)); assert.ok(short.error);
  const wrong = b.slice(); wrong[0] ^= 1;
  const bad = await readAll(verifyingStream(src(wrong), want, note)); assert.ok(bad.error); assert.equal(bad.bytes.byteLength, 2800);
  assert.deepEqual(seen, ['ok', 'size', 'size', 'digest']);
});

test('a head with a live integrity flag (bytes missing, residency mismatch) is neither linked nor served', async () => {
  for (const [flag, want] of [['bytes_missing', 'missing_bytes'], ['residency_mismatch', 'residency_mismatch']] as const) {
    const w = fresh(); const m = await headed(w, flag, BYTES);
    const link = await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE }); assert.ok(link.ok);
    w.db.prepare('INSERT INTO work_graph_revision_flags (revision_uid, flag, tenant_id, company_id, asset_uid, set_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.rev, flag, SCOPE.tenantId, SCOPE.companyId, m.id, new Date(clock.t).toISOString());
    assert.equal(code(await mintMediaDelivery(w.env, CTX, { revisionUid: m.rev, actor: ALICE })), want);
    assert.equal(code(await openMediaDelivery(w.env, CTX, { token: link.token, reader: BOB })), want);
    w.db.close();
  }
});
