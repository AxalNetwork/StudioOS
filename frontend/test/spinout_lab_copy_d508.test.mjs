/**
 * D508 — three places still sold "idea to incorporated" and an unbacked
 * company count after D380 retired both from the page itself (D380 §4
 * covers the share card and the certificate verifier; these three were
 * missed):
 *
 *   1. `spinout_admitted`'s email (registry.ts) — the admission email framed
 *      the whole Lab as one linear arc ending in incorporation, which is one
 *      of nineteen working tools, not the whole programme (LabIntro.jsx's
 *      own repositioning note explains why that undersells it and quietly
 *      excludes founders who already have an entity).
 *   2. SpinoutDemoDayPage's "What Is the Spin-Out Lab" subhead — same claim,
 *      same fix.
 *   3. FounderHomePage's testimonial sub — "the 38 companies" was never
 *      backed by anything. Its guards left with the page (#2321: `/lp/founder`
 *      now forwards to `/for-founders`).
 *
 * Run with: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_lab_copy_d508.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const REGISTRY = read('cloudflare-worker/src/templates/email/registry.ts');
const DEMO_DAY = codeOnly(read('frontend/src/pages/templates/SpinoutDemoDayPage.jsx'));

test('spinout_admitted email no longer sells a single idea-to-incorporated arc', () => {
  // Scoped to the spinout_admitted entry, not the whole registry file, so a
  // different template using the phrase legitimately (there is none today,
  // but the scope should stay narrow) would not hide behind this guard.
  const start = REGISTRY.indexOf("spinout_admitted: t({");
  assert.ok(start > 0, 'spinout_admitted entry not found — did it move or get renamed?');
  const entry = REGISTRY.slice(start, start + 2000);
  assert.doesNotMatch(entry, /idea to incorporated/i);
  assert.doesNotMatch(entry, /idea\s*(→|->)\s*customer discovery/i, 'the HTML highlight box kept the same linear-arc framing as prose');
});

test('SpinoutDemoDayPage no longer sells "idea to incorporated company"', () => {
  assert.doesNotMatch(DEMO_DAY, /idea to incorporated/i);
});
