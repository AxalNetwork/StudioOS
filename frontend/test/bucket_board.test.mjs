/**
 * The board registries, and the one rule that makes them safe.
 *
 * A board section states a count in its header — "4 open · 38% win rate" — over
 * a table of that zone's real rows. The failure this file exists to prevent is
 * the easy one: the canvases hardcode every figure they draw ("3 inbound · 1
 * expires tomorrow", "148 · 11 going cold", "6 pieces · 14,200 reads"), and a
 * registry transcribed from a canvas would put those numbers on screen as if
 * they were the reader's own. They are the designer's placeholders.
 *
 * So `summary`, `rows` and `footnote` are called with the section's source
 * payload as their ONLY argument. They close over nothing, which means a
 * section with no `source` is handed nothing and CANNOT compute a figure — the
 * guarantee is in the signature rather than in anyone's care. These tests hold
 * the other half: that no literal digit reaches a registry string, and that a
 * section never declares both a store and the absence of one.
 *
 * The registries are plain `.js` object literals with no JSX, deliberately:
 * `_codeOnly.mjs` strips block comments at column 0 and whole-line `//` but
 * CANNOT strip a JSX `{/* … *\/}`, so prose in a `.jsx` file can match a ban
 * before the code does. Keeping the copy in `.js` sidesteps that entirely.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHELLS, bucketsFor } from '../src/workspaces/shellConfig.js';
import BOARDS, { boardFor } from '../src/workspaces/boards/index.js';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const DIR = 'frontend/src/workspaces/boards';
const registryFiles = () =>
  (existsSync(resolve(process.cwd(), DIR)) ? readdirSync(resolve(process.cwd(), DIR)) : [])
    .filter((f) => f.endsWith('.js') && f !== 'index.js');

/**
 * A stand-in for the API client. The registries take it as an argument rather
 * than importing it, which is the only reason this file can load them at all:
 * `lib/api.js` resolves its own imports extensionlessly through the bundler and
 * Node cannot follow that. Every property answers with a thunk, so a source
 * naming a method that does not exist still yields a function here — which is
 * why the source test asserts the shape rather than the method name, and why
 * `check-api-drift.mjs` remains the guard that a method is real.
 */
const STUB = new Proxy({}, { get: () => () => Promise.resolve({}) });

const entries = () => Object.keys(BOARDS).map((key) => {
  const [role, prefix] = key.split(':');
  return { key, role, prefix, board: boardFor(role, prefix, STUB) };
});

test('every registered board key names a real bucket of that role', () => {
  for (const { key, role, prefix } of entries()) {
    assert.ok(SHELLS[role], `${key} names no shell`);
    assert.ok(bucketsFor(role).some((b) => b.prefix === prefix),
      `${key} names no bucket of that role`);
  }
});

test('a board section declares either a source or a gap, never both, never neither', () => {
  for (const { key, board } of entries()) {
    for (const s of board.sections) {
      const hasSource = Boolean(s.source);
      const hasGap = Boolean(s.gap);
      const isCard = s.kind === 'card';
      assert.ok(!(hasSource && hasGap),
        `${key} · ${s.slug} declares a source AND a gap — it cannot both read a store and have none`);
      assert.ok(hasSource || hasGap || isCard,
        `${key} · ${s.slug} declares neither a source, a gap nor kind:'card'`);
      if (hasGap) {
        // A gapped section is handed no payload, so these could only be
        // closures over something else — which is the leak this forbids.
        for (const fn of ['summary', 'rows', 'footnote']) {
          assert.equal(s[fn], undefined,
            `${key} · ${s.slug} is gapped but declares ${fn}() — it has nothing to read`);
        }
      }
    }
  }
});

test('every section source resolves to a fetch the board declares', () => {
  for (const { key, board } of entries()) {
    for (const s of board.sections) {
      if (!s.source) continue;
      assert.equal(typeof board.sources[s.source], 'function',
        `${key} · ${s.slug} names source "${s.source}", which the board does not declare`);
    }
  }
});

test('a gap is referenced from the shared copy, never written in the registry', () => {
  // This is the assertion that keeps a board section from being kinder than
  // the page behind it. The copy lives in `workspaces/noStoreCopy.js` and both
  // the route module and the registry import it; a registry that wrote its own
  // heading/what/why could soften the reason without the page ever changing.
  const offenders = [];
  for (const file of registryFiles()) {
    const src = codeOnly(read(`${DIR}/${file}`));
    for (const [, value] of src.matchAll(/gap:\s*([^,\n]+)/g)) {
      if (/^\{/.test(value.trim())) offenders.push(`${DIR}/${file}: inline gap literal`);
    }
    if (/gap:/.test(src) && !/from '\.\.\/noStoreCopy\.js'/.test(src)) {
      offenders.push(`${DIR}/${file}: declares a gap without importing the shared copy`);
    }
  }
  assert.deepEqual(offenders, [],
    'a gap must reference workspaces/noStoreCopy.js, so the board and the zone page cannot drift');
});

test('the shared no-store copy has exactly one definition of each reason', () => {
  // `AdvisorBucketRoutes` used to declare this object itself. If it grows a
  // second copy, the two can drift and only one of them is on the screen the
  // reader happens to be looking at.
  const routes = codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'));
  assert.match(routes, /const COPY = ADVISOR_COPY;/,
    'AdvisorBucketRoutes must read the shared copy rather than declaring its own');
  assert.doesNotMatch(routes, /heading: 'Nothing counts profile views'/,
    'the reason belongs in workspaces/noStoreCopy.js and nowhere else');
});

test('every api method a registry calls exists on the client', () => {
  // The STUB above answers any property, which is what lets this file load the
  // registries at all — and it means a typo'd method name would pass the
  // runtime tests and fail only in a browser, as an error state on a section
  // that should have had rows. So the names are checked against the client
  // itself, statically. This is the local half of `check-api-drift.mjs`.
  const client = read('frontend/src/lib/api.js');
  const declared = new Set(
    [...client.matchAll(/^\s{2}(\w+):\s*(?:\(|async\b)/gm)].map((m) => m[1]),
  );
  const offenders = [];
  for (const file of registryFiles()) {
    const src = codeOnly(read(`${DIR}/${file}`));
    for (const [, method] of src.matchAll(/\bapi\.(\w+)\s*\(/g)) {
      if (!declared.has(method)) offenders.push(`${DIR}/${file}: api.${method}()`);
    }
  }
  assert.deepEqual(offenders, [],
    'a registry calls an api method the client does not declare — it would render as a dead section, not as an error');
});

test("a board's sections are its bucket's zones, in zone order", () => {
  for (const { key, role, prefix, board } of entries()) {
    const bucket = bucketsFor(role).find((b) => b.prefix === prefix);
    assert.deepEqual(
      board.sections.map((s) => s.slug),
      bucket.zones.map((z) => z.slug),
      `${key} must carry one section per zone, in order — a zone missing from its own bucket root is how a zone quietly disappears`,
    );
  }
});

test('no registry string carries a literal figure', () => {
  // Every count on screen must come back from `summary(payload)`. A digit typed
  // into a registry is a canvas placeholder that has escaped onto the page.
  const offenders = [];
  for (const file of registryFiles()) {
    // `cols` is a CSS grid track list lifted verbatim from the canvas
    // (`cols:'1.2fr 1fr 1fr .9fr 1.7fr'`). Its digits are column widths, not
    // figures, so it is removed before the scan — and constrained separately
    // below, so the exemption cannot be used to smuggle copy through.
    const src = codeOnly(read(`${DIR}/${file}`)).replace(/cols:\s*'[^']*'/g, 'cols:');
    for (const [, quoted] of src.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)) {
      if (quoted && /\d/.test(quoted)) offenders.push(`${file}: "${quoted}"`);
    }
  }
  assert.deepEqual(offenders, [],
    'a figure in a registry string is the designer\'s placeholder, not the reader\'s number');
});

test('a section\'s cols value is a grid track list and nothing else', () => {
  // The digit ban exempts `cols`. This is what stops that exemption widening:
  // a track list is fractions, lengths and minmax(), never words a reader sees.
  const offenders = [];
  for (const file of registryFiles()) {
    const src = read(`${DIR}/${file}`);
    for (const [, value] of src.matchAll(/cols:\s*'([^']*)'/g)) {
      if (!/^[\d.\s]*(?:(?:[\d.]+(?:fr|px|%|em|rem)|auto|min-content|max-content|minmax\([^)]*\))\s*)+$/.test(value)) {
        offenders.push(`${file}: cols "${value}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'cols must be a CSS grid track list');
});

test('no registry restates a claim the product has already refused', () => {
  // Each of these is drawn on an artboard and refused in code, with the reason
  // recorded where the refusal lives. Moving prose into a new file must not
  // repeal a ban that a sibling guard already holds over the old one.
  const BANNED = [
    /platform cut/i,        // AdvisorBucketRoutes ZONE_BLURB.earnings says the opposite
    /over-committed/i,      // no capacity cap is stored; the canvas hardcodes 40
    /going cold/i,          // needs a last-touch threshold nothing sets
    /referrals in motion/i, // needs a person→organisation edge ORG_BACKED denies
    /slots open/i,          // Sessions is about booked sessions, not availability
    /sent and opened/i,     // opened_at is the client's to set; no surface lets them
    /shipped and acknowledged/i,
    /conversion per surface/i, // partner_offers.ts returns lead_ratio: null, with its reason
    /lead scoring reads against/i,
  ];
  const offenders = [];
  for (const file of registryFiles()) {
    const src = codeOnly(read(`${DIR}/${file}`));
    for (const pattern of BANNED) {
      if (pattern.test(src)) offenders.push(`${DIR}/${file}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], 'a registry restated a claim the product refuses elsewhere');
});

test('the four route modules dispatch through boardFor, identically', () => {
  // One expression in four files. If they diverge, a root can render a board on
  // one licence and a grid on another for no reason a reader could discover.
  for (const [file, expr] of [
    ['frontend/src/workspaces/partner/PartnerBucketRoutes.jsx', /boardFor\('partner', prefix, api\)/],
    ['frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx', /boardFor\('advisor', prefix, api\)/],
    ['frontend/src/workspaces/NetworkWorkspace.jsx', /boardFor\(role, '\/network', api\)/],
    ['frontend/src/workspaces/ResearchWorkspace.jsx', /boardFor\(role, '\/research', api\)/],
  ]) {
    const src = codeOnly(read(file));
    assert.match(src, expr, `${file} must ask the registry which body to render`);
    assert.match(src, /<BucketBoard/, `${file} must be able to render a board`);
    assert.match(src, /<BucketOverview/,
      `${file} must still fall back to the card grid — six roots have no artboard`);
  }
});

test('BucketBoard hands a section only its own payload', () => {
  const src = codeOnly(read('frontend/src/workspaces/BucketBoard.jsx'));
  for (const call of ['summary?.(payload)', 'section.rows(payload)', 'section.footnote(payload)']) {
    assert.ok(src.includes(call),
      `BucketBoard must call ${call} with the payload alone — an extra argument would give a gapped section something to count`);
  }
});
