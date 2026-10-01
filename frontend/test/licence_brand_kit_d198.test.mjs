/**
 * D198 — the brand kit's three surfaces, and the two sentences it corrects.
 *
 * WHAT THIS FILE IS FOR. Migration 281 gives a white-label licence a store for
 * its mark and its colours, and the same commit has to move every sentence
 * that said there was none. Two of those sentences were live copy — one on the
 * branch's own Settings page, one on HQ's Studio card — so this guards the new
 * surface AND pins the corrections, because a refusal that outlives its fact
 * is the class this programme has now corrected five times.
 *
 * EVERY SCAN RUNS OVER `codeOnly` SOURCE. The corrections are explained in
 * comments that necessarily quote the sentence they replaced, and a whole-file
 * scan would be satisfied by the explanation — a lexical scan cannot tell a
 * rule from its violation. Stripping comments is what makes these assertions
 * able to fail.
 *
 * AND THE KIND-GATE IS ASSERTED IN BOTH HALVES. H26 is explicit — "Unique to
 * this kind · an Axal subsidiary never sees this step" — and the gate exists
 * twice for a reason: the tab is what an operator clicks, the mount is what
 * decides what renders. One without the other is a half-gate.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_brand_kit_d198.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const PAGE = codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx'));
const SETTINGS = codeOnly(read('frontend/src/pages/branch/BranchSettings.jsx'));
const STUDIO = codeOnly(read('frontend/src/pages/admin/AdminStudioOverview.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));
const ROUTE = read('cloudflare-worker/src/routes/admin_licences.ts');
const BRAND = read('cloudflare-worker/src/routes/brand.ts');
const MIGRATION = read('cloudflare-worker/sql/migrations/281_licence_brand_kits.sql');

/** One element's own markup, bounded at both ends — D150's lesson. */
function block(src, testid, closer) {
  const needle = `data-testid="${testid}"`;
  const count = src.split(needle).length - 1;
  assert.equal(count, 1, `${testid} occurs ${count} times, so its block cannot be bounded`);
  const at = src.indexOf(needle);
  const end = src.indexOf(closer, at);
  assert.ok(end > at, `${testid} never reaches its closing ${closer}`);
  return src.slice(at + needle.length, end);
}

/* ------------------------------------------------------------------ */

test('the brand kit is an UNNUMBERED tab, and it is gated on the kind in both halves', () => {
  // A numbered step only some licences have would renumber the flow per
  // licence, which `licence_admins_ui_d134` and `hq_licences_h2h3` both pin.
  assert.match(PAGE, /const STEPS = \['Entity', 'Territory', 'Seats', 'Terms', 'Contract', 'Deploy'\]/,
    'the six numbered steps moved');
  assert.match(PAGE, /const BRAND_STEP = STEPS\.length \+ 4;/,
    'the brand kit is not an unnumbered tab beside History, Administrators and Notices');

  // THE TAB — drawn only for a white-label.
  assert.match(PAGE, /\{d\.kind === 'white_label' && \(\s*<button[\s\S]{0,240}?data-testid="licence-brand-tab"/,
    'the Brand kit tab is drawn for every licence, which H26 forbids in its own words');
  // THE MOUNT — re-checked, so a kind that changed while the tab was open
  // falls back to nothing rather than to an editor for a store it has no row in.
  assert.match(PAGE, /step === BRAND_STEP && d\.kind === 'white_label'/,
    'the editor mounts without re-checking the kind');
});

test('Step 1 states what a SUBSIDIARY trades under, rather than four unrecorded fields', () => {
  // The four `value={null}` fields moved to the tab. What Entity keeps is the
  // one sentence it needs, and it differs by kind.
  assert.match(PAGE, /This is an Axal subsidiary, so it trades under Axal\\u2019s brand\./,
    'Step 1 stopped saying what a subsidiary trades under');
  assert.match(PAGE, /only a white-label licence has one of its own/,
    'Step 1 does not say why a subsidiary has no brand-kit tab');
  assert.doesNotMatch(PAGE, /These fields are not a store yet/,
    'Step 1 still claims the brand-kit fields have no store, which migration 281 made false');
});

test('the editor names whose brand it is, and mirrors the server on both colours', () => {
  const kit = block(PAGE, 'licence-brand-kit', '</p>');
  assert.match(kit, /A white-label operator sets their own mark\. HQ does not approve it\./,
    'the editor stopped saying whose mark it is');

  // The save is gated on BOTH colours, the same condition the route enforces
  // and the same one `activationBlockers` reads. A form that offered a save the
  // server refuses teaches the operator that one of its buttons is a lie.
  assert.match(PAGE, /const canSave = HEX\.test\(primary\.trim\(\)\) && HEX\.test\(accent\.trim\(\)\)/,
    'the colour save is not gated on both colours');
  assert.match(PAGE, /disabled=\{busy \|\| !canSave\}/, 'the Save colours button ignores canSave');
});

test('the client hex rule and `cleanHex` admit exactly the same shapes', () => {
  // The two are written in two languages, so they are compared rather than
  // assumed: a client stricter than the server refuses a value the server
  // would take, and a client looser offers a save that 400s.
  const client = PAGE.match(/const HEX = (\/\^#[^;]+\/);/);
  assert.ok(client, 'the editor no longer declares its hex rule');
  const server = BRAND.match(/const HEX_RE = (\/\^#[^;]+\/);/);
  assert.ok(server, 'brand.ts no longer declares HEX_RE');
  assert.equal(client[1], server[1],
    `the SPA admits ${client[1]} and the worker admits ${server[1]}`);
});

test('the mark control offers exactly the three types the worker allows', () => {
  const allow = [...BRAND.matchAll(/'image\/(png|jpeg|svg\+xml)'/g)].map((m) => `image/${m[1]}`);
  const declared = new Set(allow);
  assert.equal(declared.size, 3, 'the worker allowlist is no longer three types');
  const accept = PAGE.match(/accept="([^"]+)"/);
  assert.ok(accept, 'the mark upload has no accept list');
  assert.deepEqual(
    accept[1].split(',').map((s) => s.trim()).sort(),
    [...declared].sort(),
    'the file picker offers a different set from the one the worker accepts',
  );
  // And the cap is named to the operator rather than discovered by a 400.
  assert.match(MIGRATION, /licence_brand_kits/);
  assert.match(PAGE, /up to 512 KB/, 'the upload does not name the size cap');
  assert.match(BRAND, /export const LOGO_MAX_BYTES = 512 \* 1024;/,
    'the cap the copy names is no longer the cap the worker enforces');
});

test('UNREADABLE and ABSENT are two different renders, with two different testids', () => {
  assert.match(PAGE, /licence\.brand_kit_available === false/,
    'the editor does not branch on whether the store could be read');
  const bad = block(PAGE, 'licence-brand-kit-unreadable', '</p>');
  assert.match(bad, /Brand kit/);
  assert.match(PAGE, /\{licence\.brand_kit_reason \|\|/,
    'the unreadable state does not print the reason the server supplied');
  assert.match(PAGE, /it is a statement about this database/,
    'the unreadable state does not say the absence is about the database, not the licence');
  // And ABSENT is the ordinary render: no mark reads "Not recorded".
  assert.match(PAGE, /<div className="mt-0\.5 text-sm text-gray-400">Not recorded<\/div>/,
    'a licence with no mark stopped reading as unrecorded');
});

test('the row swatch is a COLOUR and is white-label only — never the Axal wordmark', () => {
  assert.match(PAGE, /l\.kind === 'white_label' && l\.brand_kit\?\.primary_hex && \(/,
    'the row swatch is drawn without checking the kind, so a subsidiary gets a mark of its own');
  const swatch = block(PAGE, 'licence-row-swatch', '/>');
  assert.match(swatch, /backgroundColor: l\.brand_kit\.primary_hex/,
    'the row mark is not the licence’s own colour');
  assert.doesNotMatch(swatch, /<img/, 'the row draws an image where H28 draws a colour');
  assert.match(swatch, /aria-hidden="true"/, 'the decorative swatch is announced to a screen reader');
});

test('the three writes exist in api.js with their routes, and there is NO read method', () => {
  for (const [name, verb, path] of [
    ['licenceBrandSet', 'PUT', '/brand'],
    ['licenceBrandMarkUpload', 'POST', '/brand/mark'],
    ['licenceBrandMarkRemove', 'DELETE', '/brand/mark'],
  ]) {
    assert.match(API, new RegExp(`${name}:`), `${name} is missing from api.js`);
    assert.match(ROUTE, new RegExp(`r\\.${verb.toLowerCase()}\\('/:uid${path.replace('/', '\\/')}'`),
      `${name} has no worker route at ${verb} ${path}`);
  }
  // THE KIT RIDES `hydrate`, D197's rule one table over. A read method would
  // be a second fetch that can disagree with the payload the page already has.
  assert.doesNotMatch(API, /licenceBrandKit:|licenceBrandGet:/,
    'a brand-kit read method appeared; the kit rides the licence payload');
  // The upload posts a FormData, because the worker reads multipart.
  assert.match(API, /const fd = new FormData\(\);\s*fd\.append\('file', file\);/,
    'the mark upload does not post multipart');
});

test('BranchSettings no longer says HQ has no brand-kit store', () => {
  // BOUNDED TO THE ROWS ARRAY. The comment above the row necessarily quotes the
  // sentence it replaced, so a whole-file scan would pass on a page that had
  // not changed at all — which is exactly the failure this bound prevents.
  const at = SETTINGS.indexOf("field: 'Brand kit'");
  assert.ok(at > 0, 'the Brand kit row is gone from Settings');
  const row = SETTINGS.slice(at, SETTINGS.indexOf('},', at));
  assert.doesNotMatch(row, /HQ has no brand-kit store/,
    'the Settings row still claims HQ has no brand-kit store, which migration 281 made false');
  assert.match(row, /A brand kit belongs to a white-label licence/,
    'the Settings row does not say which kind has a kit');
  assert.match(row, /nothing pushes it to a branch yet/,
    'the Settings row does not say why there is still no file to fetch');
  // The chip does not move: `wlCompare` puts a subsidiary's brand at HQ either way.
  assert.match(row, /who: 'HQ'/, 'the Brand kit row changed owner, which wlCompare does not');

  // The rail's own list says the same thing, and for the same reason.
  assert.doesNotMatch(SETTINGS, /HQ has no brand-kit store \(D\.10\)/,
    'the rail still cites a store that now exists');
});

test('the Studio card stops saying the mark and the colours have no store', () => {
  assert.doesNotMatch(STUDIO, /Mark, colours and the powered-by line have no store yet/,
    'the Studio card still denies a store migration 281 built');
  // Four states, mirroring the hostname block beside it: unread, not
  // applicable, unreadable, absent. Unread and unreadable are different claims.
  assert.match(STUDIO, /Brand kit not read/, 'the unread state is gone');
  assert.match(STUDIO, /lic\.kind !== 'white_label'/, 'the card offers a kit to a subsidiary');
  assert.match(STUDIO, /lic\.brand_kit_available === false/, 'the unreadable state is gone');
  assert.match(STUDIO, /data-testid="studio-brand-kit"/, 'a set kit has nothing to render');
  // The half that is STILL TRUE stays true: nothing renders a platform credit.
  assert.match(PAGE, /Nothing in the shell renders a platform credit at\s+all/,
    'the powered-by refusal lost the reason that makes it honest');
});
