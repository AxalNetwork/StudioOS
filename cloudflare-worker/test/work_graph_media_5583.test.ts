/**
 * D5583 part 1 (#5583) — the media rules, pure:
 *
 *   1. Every admitted format is recognised from its bytes; the declared type, the asset kind and the object class
 *      must all agree.
 *   2. Oversized, empty, corrupt (truncated or mis-sized), unsupported and unsafe files fail closed with a fixed code:
 *      SVG scripts, handlers, entities and external references; glTF external or escaping URIs; JPEG EXIF location;
 *      a PNG eXIf chunk.
 *   3. Provenance: missing rights, a revoked or expired licence, a use out of scope, a licence with no reference, a
 *      generation with no model, a derivation with no source, unverified reproducibility, and (at publication) a
 *      person shown without consent. `deck_images`' own columns read as provenance.
 *   4. Pins: fonts by family and licence only; a font binary or an unknown licence is refused; linked media become
 *      pinned `read` edges.
 *   5. Renditions live in their own classes; native opaque formats need external compute.
 *   6. Brand tokens: different tokens merge; one token changed twice is a conflict.
 *
 * Every byte sequence is built here; nothing is a real image of anyone.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_media_5583.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLASS_MAX_BYTES, admitMedia, brandKitUnits, checkProvenance, pinDependencies, provenanceFromDeckImage, renditionPlan,
  sniffFormat, type MediaProvenance,
} from '../src/services/workGraphMedia.ts';
import { planMerge, type MergePlan } from '../src/services/workGraphMerge.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[])[]) => {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrs) { out.set(a, i); i += a.length; }
  return out;
};
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const chunk = (type: string, data: Uint8Array = new Uint8Array()) => cat(u32be(data.length), enc(type), data, [0, 0, 0, 0]);

const png = (...extra: Uint8Array[]) => cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', new Uint8Array(13)), ...extra, chunk('IEND'));
const jpeg = (...segments: Uint8Array[]) => cat([0xff, 0xd8], ...segments, [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
const app1 = (body: Uint8Array) => cat([0xff, 0xe1], [((body.length + 2) >> 8) & 255, (body.length + 2) & 255], body);
const webp = (payload = new Uint8Array(12)) => cat(enc('RIFF'), u32le(4 + payload.length), enc('WEBP'), payload);
const gif = () => cat(enc('GIF89a'), new Uint8Array(10), [0x3b]);
const glb = (len?: number) => { const body = new Uint8Array(8); const total = 12 + body.length; return cat(enc('glTF'), u32le(2), u32le(len ?? total), body); };
const gltf = (doc: object) => enc(JSON.stringify({ asset: { version: '2.0' }, ...doc }));
const svg = (inner = '<rect width="1" height="1"/>') => enc(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>\n`);

const admit = (kind: any, objectClass: any, declaredMime: string, bytes: Uint8Array) => admitMedia({ kind, objectClass, declaredMime, bytes });
const code = (r: ReturnType<typeof admitMedia>) => (r.ok ? 'ok' : r.code);

test('1. each format is recognised from its bytes and admitted where it belongs', () => {
  assert.equal(code(admit('image', 'master', 'image/png', png())), 'ok');
  assert.equal(code(admit('image', 'master', 'image/jpeg', jpeg())), 'ok');
  assert.equal(code(admit('image', 'rendition', 'image/webp', webp())), 'ok');
  assert.equal(code(admit('image', 'master', 'image/gif', gif())), 'ok');
  assert.equal(code(admit('brand', 'master', 'image/svg+xml', svg())), 'ok');
  assert.equal(code(admit('model_3d', 'master', 'model/gltf-binary', glb())), 'ok');
  assert.equal(code(admit('model_3d', 'master', 'model/gltf+json', gltf({ buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }] }))), 'ok');
  assert.equal(code(admit('image', 'master', 'image/vnd.adobe.photoshop', cat(enc('8BPS'), new Uint8Array(20)))), 'ok');
  assert.equal(sniffFormat(enc('hello'))?.id ?? null, null);

  // The declared type, the kind and the class must agree with the bytes.
  assert.equal(code(admit('image', 'master', 'image/jpeg', png())), 'mime_mismatch');
  assert.equal(code(admit('image', 'master', 'image/png; charset=binary', png())), 'ok', 'parameters on the type are ignored');
  assert.equal(code(admit('model_3d', 'master', 'image/png', png())), 'wrong_kind');
  assert.equal(code(admit('image', 'thumbnail', 'image/gif', gif())), 'wrong_class', 'a GIF is a master only');
  assert.equal(code(admit('image', 'rendition', 'image/svg+xml', svg())), 'wrong_class');
  assert.equal(code(admit('image', 'nope' as any, 'image/png', png())), 'wrong_class');
});

test('2. oversized, empty, corrupt, unsupported and unsafe files fail closed', () => {
  assert.equal(code(admit('image', 'master', 'image/png', new Uint8Array())), 'empty');
  const big = new Uint8Array(CLASS_MAX_BYTES.thumbnail + 1); big.set(png().subarray(0, 8));
  assert.equal(code(admit('image', 'thumbnail', 'image/png', big)), 'oversized');
  assert.equal(code(admit('image', 'master', 'application/octet-stream', enc('just some text'))), 'unsupported_format');

  // Corrupt: truncated or mis-sized.
  assert.equal(code(admit('image', 'master', 'image/png', png().subarray(0, 40))), 'corrupt', 'png without IEND');
  assert.equal(code(admit('image', 'master', 'image/png', cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('tEXt'), chunk('IEND')))), 'corrupt', 'png without IHDR first');
  assert.equal(code(admit('image', 'master', 'image/jpeg', jpeg().subarray(0, 6))), 'corrupt');
  assert.equal(code(admit('image', 'master', 'image/webp', cat(webp(), [0, 0]))), 'corrupt', 'RIFF size does not match');
  assert.equal(code(admit('image', 'master', 'image/gif', gif().subarray(0, 12))), 'corrupt');
  assert.equal(code(admit('model_3d', 'master', 'model/gltf-binary', glb(999))), 'corrupt');
  assert.equal(code(admit('model_3d', 'master', 'model/gltf+json', enc('{"asset": {"version": "1.0"}}'))), 'corrupt');
  assert.equal(code(admit('brand', 'master', 'image/svg+xml', enc('<svg xmlns="http://www.w3.org/2000/svg"><rect/>'))), 'corrupt', 'svg not closed');

  // Unsafe metadata.
  for (const inner of [
    '<script>alert(1)</script>', '<script/>', '<rect onload="x()"/>', '<a href="javascript:x()"/>', '<foreignObject/>',
    '<image href="https://elsewhere.example/x.png"/>', '<image xlink:href="//elsewhere.example/x.png"/>',
    '<style>@import "x.css";</style>', '<rect style="fill:url(https://elsewhere.example/p)"/>',
  ]) {
    assert.equal(code(admit('brand', 'master', 'image/svg+xml', svg(inner))), 'unsafe_metadata', inner);
  }
  assert.equal(code(admit('brand', 'master', 'image/svg+xml', enc('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"></svg>'))), 'unsafe_metadata');
  // An in-document reference is fine.
  assert.equal(code(admit('brand', 'master', 'image/svg+xml', svg('<use href="#a"/>'))), 'ok');
  for (const uri of ['https://elsewhere.example/b.bin', 'file:///etc/passwd', '../outside.bin', '/abs.bin']) {
    assert.equal(code(admit('model_3d', 'master', 'model/gltf+json', gltf({ images: [{ uri }] }))), 'unsafe_metadata', uri);
  }
  const exifGps = app1(cat(enc('Exif\0\0'), enc('MM'), [0, 42, 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1]));
  assert.equal(code(admit('image', 'master', 'image/jpeg', jpeg(exifGps))), 'unsafe_metadata');
  const exifNoGps = app1(cat(enc('Exif\0\0'), enc('MM'), [0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x0f, 0, 2, 0, 0, 0, 1]));
  assert.equal(code(admit('image', 'master', 'image/jpeg', jpeg(exifNoGps))), 'ok', 'EXIF without location is fine');
  assert.equal(code(admit('image', 'master', 'image/png', png(chunk('eXIf', new Uint8Array(4))))), 'unsafe_metadata');
  assert.equal(code(admit('image', 'master', 'image/png', png(chunk('tEXt', enc('Title\0Logo'))))), 'ok');
});

const NOW = new Date('2026-11-14T12:00:00Z');
const licensed = (over: Partial<MediaProvenance['rights']> = {}): MediaProvenance => ({
  origin: 'upload', rights: { basis: 'licensed', licensor: 'Stock Co', licenseRef: 'LIC-1', usageScope: ['deck', 'site'], ...over },
});

test('3. provenance refuses what its rights cannot support', () => {
  const ok = (p: MediaProvenance, stage: 'draft' | 'publish' = 'publish', use = 'deck') => checkProvenance(p, { stage, use, now: NOW });
  assert.deepEqual(ok(licensed()), []);
  assert.deepEqual(ok({ origin: 'upload', rights: { basis: null, usageScope: ['deck'] } }), ['rights_missing']);
  assert.deepEqual(ok(licensed({ revokedAt: '2026-11-01T00:00:00Z' })), ['license_revoked']);
  assert.deepEqual(ok(licensed({ expiresAt: '2026-11-14T11:59:59Z' })), ['license_expired']);
  assert.deepEqual(ok(licensed({ expiresAt: '2026-12-01T00:00:00Z' })), []);
  assert.deepEqual(ok(licensed(), 'publish', 'print'), ['usage_out_of_scope']);
  assert.deepEqual(ok(licensed({ licenseRef: null })), ['license_ref_missing']);
  assert.deepEqual(ok({ origin: 'generated', generation: null, rights: { basis: 'platform_generated', usageScope: ['deck'] } }), ['generation_missing']);
  assert.deepEqual(ok({ origin: 'derived', rights: { basis: 'owned', usageScope: ['deck'] } }), ['source_missing']);
  assert.deepEqual(ok({
    origin: 'generated', rights: { basis: 'platform_generated', usageScope: ['deck'] },
    generation: { provider: 'p', model: 'm', recipe: null, seed: '7', reproducible: true, reproducibilityVerifiedAt: null },
  }), ['reproducibility_unverified']);
  // Consent is a publication rule: a draft may show a person; publishing it needs recorded consent.
  const person: MediaProvenance = { ...licensed(), consent: { showsPerson: true, consentAt: null, consentByUserId: null } };
  assert.deepEqual(ok(person, 'draft'), []);
  assert.deepEqual(ok(person, 'publish'), ['consent_missing']);
  assert.deepEqual(ok({ ...person, consent: { showsPerson: true, consentAt: '2026-11-10T00:00:00Z', consentByUserId: 3 } }), []);

  // deck_images' own columns are the provenance: scoped to decks, consent as recorded.
  const gen = provenanceFromDeckImage({ uid: 'img_1', source: 'generated', model: 'img-model', prompt: 'a calm office', shows_person: 1, person_consent_at: null, person_consent_by: null });
  assert.equal(gen.generation?.model, 'img-model');
  assert.deepEqual(checkProvenance(gen, { stage: 'publish', use: 'deck', now: NOW }), ['consent_missing']);
  assert.deepEqual(checkProvenance(gen, { stage: 'draft', use: 'site', now: NOW }), ['usage_out_of_scope'], 'a deck image is not licensed for the site');
  const up = provenanceFromDeckImage({ uid: 'img_2', source: 'upload', model: null, prompt: null, shows_person: 0, person_consent_at: null, person_consent_by: null });
  assert.deepEqual(checkProvenance(up, { stage: 'publish', use: 'deck', now: NOW }), []);
});

test('4. pins: fonts by name and licence, never a binary; linked media pinned to a revision', () => {
  const r = pinDependencies([
    { kind: 'font', family: 'Space Grotesk', license: 'OFL-1.1' },
    { kind: 'texture', assetUid: 'tex', revisionUid: 'tex_r1' },
    { kind: 'brand_tokens', assetUid: 'kit', revisionUid: 'kit_r3' },
  ]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.fonts, [{ family: 'Space Grotesk', license: 'OFL-1.1', foundry: null }]);
    assert.deepEqual(r.edges, [{ kind: 'read', assetUid: 'tex', revisionUid: 'tex_r1' }, { kind: 'read', assetUid: 'kit', revisionUid: 'kit_r3' }]);
  }
  assert.equal((pinDependencies([{ kind: 'font', family: 'X', license: 'OFL-1.1', assetUid: 'font_bytes' }]) as any).code, 'font_binary');
  assert.equal((pinDependencies([{ kind: 'font', family: 'X', license: 'proprietary' }]) as any).code, 'font_license_unknown');
  assert.equal((pinDependencies([{ kind: 'texture', assetUid: 'tex' }]) as any).code, 'malformed_dependency');
  assert.equal((pinDependencies([{ kind: 'sound' }]) as any).code, 'malformed_dependency');
});

test('5. renditions never replace a master; opaque natives need external compute', () => {
  const p = renditionPlan('png');
  assert.equal(p.externalCompute, false);
  assert.ok(p.renditions.every((r) => r.objectClass === 'rendition' || r.objectClass === 'thumbnail'));
  assert.ok(p.renditions.some((r) => r.objectClass === 'thumbnail'));
  for (const id of ['psd', 'blend', 'usdz', 'glb']) assert.equal(renditionPlan(id).externalCompute, true, id);
  assert.deepEqual(renditionPlan('unknown'), { renditions: [], externalCompute: false });
});

test('6. brand tokens: different tokens merge, one token twice is a conflict', () => {
  const kit = (palette: object, display = 'Space Grotesk') => brandKitUnits({
    project_id: 9, display_font: display, body_font: 'Inter', palette_json: JSON.stringify(palette), image_style: 'photo',
    reference_uids_json: '[]', logo_uid: null, updated_at: '2026-11-14T00:00:00Z',
  });
  const base = kit({ primary: '#7c3aed', accent: '#0ea5e9' });
  assert.deepEqual(base.source, { store: 'd1_record', locator: 'deck_brand_kits', id: '9', revision: '2026-11-14T00:00:00Z' });
  assert.deepEqual(base.units.map((u) => u.id), ['display_font', 'body_font', 'palette.accent', 'palette.primary', 'image_style', 'reference_uids', 'logo_uid']);
  const ours = kit({ primary: '#6d28d9', accent: '#0ea5e9' });
  const theirs = kit({ primary: '#7c3aed', accent: '#10b981' });
  const p = planMerge('brand', base.units, ours.units, theirs.units) as MergePlan;
  assert.deepEqual(p.conflicts, []);
  assert.equal(p.outcomes['palette.primary'], 'ours');
  assert.equal(p.outcomes['palette.accent'], 'theirs');
  const clash = planMerge('brand', base.units, ours.units, kit({ primary: '#000000', accent: '#0ea5e9' }).units) as MergePlan;
  assert.deepEqual(clash.conflicts.map((c) => [c.unitId, c.reason]), [['palette.primary', 'not_text_mergeable']]);
});
