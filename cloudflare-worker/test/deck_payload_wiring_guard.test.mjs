/**
 * Tests for the deck payload↔consumer guard itself.
 *
 * A guard that cannot fail is decoration, and this one shipped with three
 * separate holes that each made it silently under-report. Every one was found
 * by trying to make it fail rather than by reading it:
 *
 *   1. A field named in a `//` comment counted as a read, so an orphan
 *      mentioned in prose anywhere escaped.
 *   2. The bare block name was trusted in every consumer, so `brand` in
 *      pptx.ts — the deck WATERMARK, unrelated to the payload block — vouched
 *      for payload fields nobody reads.
 *   3. The type packs several fields per line (`eyebrow: string; headline:
 *      string;`) and only the first was parsed. That alone hid 35 of 95
 *      fields, including the three genuinely-dead ones the guard was then
 *      able to find.
 *
 * So these tests exercise the guard against synthetic sources rather than
 * asserting on its current output: the point is that it still FAILS on each
 * shape above.
 *
 * Run with:  node --test cloudflare-worker/test/deck_payload_wiring_guard.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, 'scripts/check-deck-payload-wiring.mjs');
const DECKS_REL = 'cloudflare-worker/src/services/decks';
const PAYLOAD_REL = `${DECKS_REL}/axalSpinoutDemoDay.ts`;
const RENDER_REL = `${DECKS_REL}/spinoutDeckData.ts`;

/** Run the guard against a throwaway copy of the repo's deck sources. */
function runGuard(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deckguard-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, DECKS_REL), { recursive: true });
  cpSync(GUARD, join(dir, 'scripts/check-deck-payload-wiring.mjs'));
  cpSync(join(ROOT, DECKS_REL), join(dir, DECKS_REL), { recursive: true });

  const read = (rel) => readFileSync(join(dir, rel), 'utf8');
  const write = (rel, s) => writeFileSync(join(dir, rel), s);
  mutate({ read, write });

  try {
    const out = execFileSync('node', [join(dir, 'scripts/check-deck-payload-wiring.mjs')], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Insert a field into the payload type that nothing will consume. */
const plantOrphan = (name) => ({ read, write }) => {
  const s = read(PAYLOAD_REL);
  const anchor = '    brand_kit_ready: boolean;';
  assert.ok(s.includes(anchor), 'anchor moved — update the test');
  write(PAYLOAD_REL, s.replace(anchor, `${anchor}\n    ${name}: string;`, 1));
};

// ---------------------------------------------------------------------------

test('the guard passes on the repo as it stands', () => {
  const r = runGuard();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /all reach a consumer/);
});

test('a field nothing consumes fails the guard', () => {
  const r = runGuard(plantOrphan('burn_multiple_xyz'));
  assert.equal(r.code, 1, 'an orphan must fail the build');
  assert.match(r.out, /brand\.burn_multiple_xyz/);
});

test('hole #1: a field named only in a comment is not a read', () => {
  const r = runGuard((io) => {
    plantOrphan('burn_multiple_xyz')(io);
    const s = io.read(RENDER_REL);
    io.write(RENDER_REL, `// TODO: surface burn_multiple_xyz on the ask slide\n${s}`);
  });
  assert.equal(r.code, 1, 'a prose mention must not vouch for a field');
  assert.match(r.out, /burn_multiple_xyz/);
});

test('hole #2: an unrelated local sharing a block name cannot vouch', () => {
  // `const brand = ...` in a consumer that never reaches data.brand/src.brand
  // must not make brand.<field> look consumed.
  const r = runGuard((io) => {
    plantOrphan('burn_multiple_xyz')(io);
    const s = io.read(`${DECKS_REL}/pptx.ts`);
    io.write(`${DECKS_REL}/pptx.ts`,
      `${s}\nfunction __unrelated(){ const brand = { burn_multiple_xyz: 1 }; return brand.burn_multiple_xyz; }\n`);
  });
  assert.equal(r.code, 1, 'a same-named local must not satisfy the payload block');
});

test('hole #3: every field on a multi-field line is checked', () => {
  // Two declarations on one line; the SECOND is the orphan. The original
  // parser stopped after the first and never saw it.
  const r = runGuard(({ read, write }) => {
    const s = read(PAYLOAD_REL);
    const anchor = '    brand_kit_ready: boolean;';
    write(PAYLOAD_REL, s.replace(anchor, '    brand_kit_ready: boolean; orphan_second_xyz: string;', 1));
  });
  assert.equal(r.code, 1, 'the second declaration on a line must be checked too');
  assert.match(r.out, /orphan_second_xyz/);
});

test('members of an inline element type are not mistaken for block fields', () => {
  // `holders: Array<{ name: string; role: string }>` declares ONE field.
  // `role` is read as `h.role`, never `cap_table.role` — counting it produced
  // 25 false positives, which is how a guard gets switched off.
  const r = runGuard();
  assert.equal(r.code, 0, r.out);
  for (const bogus of ['cap_table.role', 'team.bio', 'mentor_network.photo_url']) {
    assert.doesNotMatch(r.out, new RegExp(bogus.replace('.', '\\.')));
  }
});

test('a genuine read through an aliased block still counts', () => {
  // `const ct = data.cap_table; … ct.holders` must resolve, or the guard
  // floods with false positives on every aliased consumer.
  const r = runGuard();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /cap_table\.holders/);
});

test('a stale allowlist entry fails rather than hiding the next orphan', () => {
  const r = runGuard(({ read, write }) => {
    const g = read('scripts/check-deck-payload-wiring.mjs') || readFileSync(GUARD, 'utf8');
    write('scripts/check-deck-payload-wiring.mjs',
      g.replace('const ALLOWED_UNREAD = {', "const ALLOWED_UNREAD = {\n  'brand.long_gone': 'field was deleted',"));
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /no longer exist/);
});

test('the guard reports how many fields it actually checked', () => {
  // A silently-shrinking denominator is how hole #3 hid for so long.
  const r = runGuard();
  const m = /(\d+) deck payload fields across (\d+) blocks/.exec(r.out);
  assert.ok(m, 'the guard must state its coverage');
  assert.ok(Number(m[1]) >= 90, `expected ~95 fields checked, got ${m[1]}`);
  assert.ok(Number(m[2]) >= 15, `expected ~17 blocks, got ${m[2]}`);
});
