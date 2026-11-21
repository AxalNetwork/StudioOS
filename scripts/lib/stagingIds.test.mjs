/**
 * #7147 step 5 (D7147-p3): the staging id writer and the all-or-none rule the
 * static isolation check now enforces. Runs on the real wrangler.toml with
 * synthetic ids; nothing here reaches Cloudflare.
 *
 *   node --test scripts/lib/stagingIds.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredBindings, preflight, provisioningState } from './previewIsolation.mjs';
import { BARE_PREVIEW_HOST, PREVIEW_PLACEHOLDERS, previewBlock, writePreviewIds } from './stagingIds.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOML = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
const IDS = Object.freeze({
  d1: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  tokens: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
  rateLimits: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
  oauth: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3',
});
const outsidePreview = (src) => { const { lines, start, end } = previewBlock(src); return [...lines.slice(0, start), ...lines.slice(end)].join('\n'); };

test('main today: every preview id is a placeholder, so the static check passes as unprovisioned', () => {
  const s = provisioningState(TOML, 'preview');
  assert.equal(s.state, 'unprovisioned');
  assert.deepEqual(s.placeholders.sort(), ['DB', 'OAUTH_KV', 'RATE_LIMITS', 'TOKENS']);
  assert.equal(preflight(TOML, { static: true }).ok, true);
});

test('the writer fills all four ids in [env.preview] only, and the result is provisioned and passes', () => {
  // Mutations checked: replace outside the block; skip one placeholder; accept the result without the preflight.
  const { src, changed } = writePreviewIds(TOML, IDS);
  assert.equal(changed, true);
  assert.equal(outsidePreview(src), outsidePreview(TOML), 'nothing outside [env.preview] changes');
  for (const p of Object.values(PREVIEW_PLACEHOLDERS)) assert.equal(src.includes(p), false, `${p} is replaced`);
  const kv = Object.fromEntries(declaredBindings(src, 'preview').bindings.filter((b) => b.kind === 'kv_namespaces').map((b) => [b.binding, b.identity.id]));
  assert.deepEqual(kv, { TOKENS: IDS.tokens, RATE_LIMITS: IDS.rateLimits, OAUTH_KV: IDS.oauth });
  const r = preflight(src, { static: true });
  assert.equal(r.provisioning, 'provisioned');
  assert.equal(r.ok, true);
  assert.equal(writePreviewIds(src, IDS).changed, false, 'the same ids again change nothing');
});

test('a half-written config fails the static check: no placeholder once any id is real', () => {
  // Mutations checked: treat partial as consistent; drop the partial problem from unsafe.
  const half = TOML.replace(`"${PREVIEW_PLACEHOLDERS.d1}"`, `"${IDS.d1}"`);
  assert.equal(provisioningState(half, 'preview').state, 'partial');
  const r = preflight(half, { static: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsafe.filter((u) => u.kind === 'provisioning').map((u) => u.status), ['partial']);
});

test('a malformed id is refused by the writer and by the static check', () => {
  assert.throws(() => writePreviewIds(TOML, { ...IDS, d1: 'studioos-db-preview' }), /not a Cloudflare D1 database id/);
  assert.throws(() => writePreviewIds(TOML, { ...IDS, tokens: 'xyz' }), /not a Cloudflare KV namespace id/);
  // Mutation checked: unanchored patterns would accept an id inside other text.
  assert.throws(() => writePreviewIds(TOML, { ...IDS, d1: `x${IDS.d1}` }), /not a Cloudflare D1 database id/);
  assert.throws(() => writePreviewIds(TOML, { ...IDS, oauth: `${IDS.oauth}0` }), /not a Cloudflare KV namespace id/);
  const bad = TOML.replace(`"${PREVIEW_PLACEHOLDERS.tokens}"`, '"not-an-id"');
  assert.ok(preflight(bad, { static: true }).unsafe.some((u) => u.kind === 'provisioning' && u.status === 'malformed' && u.binding === 'TOKENS'));
});

test('a production id, a repeated KV id or a missing id is refused and nothing is returned', () => {
  // Mutations checked: drop the post-write preflight; drop the distinct-KV check.
  const prodTokens = declaredBindings(TOML, 'production').bindings.find((b) => b.binding === 'TOKENS').identity.id;
  assert.throws(() => writePreviewIds(TOML, { ...IDS, tokens: prodTokens }), /fails the isolation preflight .*shared/);
  assert.throws(() => writePreviewIds(TOML, { ...IDS, oauth: IDS.tokens }), /three different ids/);
  assert.throws(() => writePreviewIds(TOML, { ...IDS, rateLimits: undefined }), /missing the RATE_LIMITS id/);
});

test('an id already written can only be written again unchanged; a different one needs a tear-down', () => {
  const { src } = writePreviewIds(TOML, IDS);
  assert.throws(() => writePreviewIds(src, { ...IDS, d1: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }), /DB already holds .* tear-down/);
});

test('the workers.dev subdomain fixes the preview vars that name a host that does not exist', () => {
  assert.ok(TOML.includes(BARE_PREVIEW_HOST), 'main still names the bare host');
  const { src } = writePreviewIds(TOML, { ...IDS, subdomain: 'synthetic-sub' });
  assert.equal(previewBlock(src).lines.slice(previewBlock(src).start, previewBlock(src).end).join('\n').includes(BARE_PREVIEW_HOST), false);
  // The whole quoted value, so no other host can sit before or after it (CodeQL incomplete-url-substring-sanitization).
  assert.match(src, /= "https:\/\/studioos-preview\.synthetic-sub\.workers\.dev"/);
  assert.equal(outsidePreview(src), outsidePreview(TOML));
  assert.throws(() => writePreviewIds(TOML, { ...IDS, subdomain: 'Bad_Sub' }), /not a workers.dev subdomain/);
});
