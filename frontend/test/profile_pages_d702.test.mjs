/**
 * D702 PR 1 — the three /account visibility labels say what the Worker does.
 *
 * Copy that promises a behaviour must be true (decision D-s). The Worker now
 * enforces the stored value on GET /api/public/u/:handle and on the founder
 * cards of GET /api/public/startup/:handle (services/userSettings.ts
 * `visibleToViewer`):
 *
 *   public  → anyone with the address
 *   network → signed-in members only
 *   private → the owner only (not "admins only": no admin arm exists)
 *
 * so the labels name those three audiences, and the old three — which promised
 * an admin audience the read never had and a "network" the read never checked —
 * are gone. The /docs Privacy how-to says the same and says what "not chosen"
 * means (Public), because a stored 'network' nobody chose is served as Public.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/SettingsPage.jsx'));
const DOCS = read('frontend/src/pages/docs/sections/account.js');
const WORKER = codeOnly(read('cloudflare-worker/src/services/userSettings.ts'));

function privacyCard() {
  const a = PAGE.indexOf('function PrivacyCoreCard(');
  assert.ok(a >= 0, 'PrivacyCoreCard is gone');
  const b = PAGE.indexOf('\nfunction ', a + 1);
  return PAGE.slice(a, b > a ? b : undefined);
}

test('the three options carry the D702 labels, one per stored value', () => {
  const card = privacyCard();
  const options = [...card.matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, [
    ['public', 'Public — anyone with the address'],
    ['network', 'Members only — signed-in Axal VC members'],
    ['private', 'Hidden — only you'],
  ]);
});

test('the old labels are gone from the page', () => {
  for (const old of ['anyone with the link', 'Network only — Axal VC members', 'Private — admins only']) {
    assert.ok(!PAGE.includes(old), `still says "${old}"`);
  }
});

test('a change sends only the field that changed, so a toggle never stamps a visibility choice', () => {
  const card = privacyCard();
  assert.match(card, /api\.updatePrivacySettings\(delta\)/);
  assert.doesNotMatch(card, /api\.updatePrivacySettings\(next\)/);
});

test('the labels are the audiences the Worker enforces', () => {
  // public: anyone; network: any signed-in viewer; private: the owner only.
  assert.match(WORKER, /export function visibleToViewer\(/);
  assert.match(WORKER, /'public'[\s\S]{0,80}return true/);
  assert.match(WORKER, /viewerId\s*!=\s*null/);
  assert.match(WORKER, /Number\(viewerId\)\s*===\s*Number\(ownerUserId\)/);
});

test('the /docs Privacy how-to uses the same three words and says what "not chosen" means', () => {
  assert.ok(DOCS.includes('Public (anyone with the address) / Members only (signed-in Axal VC members) / Hidden (only you)'));
  assert.ok(DOCS.includes('Until you choose, your profile is public.'));
  assert.ok(!DOCS.includes('Network only'));
});
