/**
 * Pins the advisor shell's zone archetypes to the canvas that specifies them.
 *
 * WHY THIS EXISTS, and it is not hypothetical. `investor_shell_canvas.test.mjs`
 * has pinned the investor shell to its canvases since those zones were built;
 * the advisor shell had no equivalent, and **three of the five Practice zones
 * had drifted** — Opportunities advertised MATCH ENGINE, Delivery and Sessions
 * advertised WORK BOARD, where the canvas says FEED, COLLECTION and FEED.
 *
 * Nothing crashed, which is the whole problem. The archetype is read by
 * `ZoneNav` and the archetype badge, so a wrong one makes the nav describe the
 * wrong kind of page and no test, build or render objects. The investor test
 * says it in one line — *"drift here means the nav advertises the wrong page
 * type"* — and the advisor shell simply had nobody saying it.
 *
 * IT READS THE CANVAS RATHER THAN REMEMBERING IT. A hand-copied expectation
 * table would be a second thing to keep in step, and the canvas would drift
 * from its own copy exactly as the shell drifted from the canvas. The canvas
 * states each archetype twice — once in the artboard's own header chip and
 * once in `setIndex` — so this asserts the two agree with each other first,
 * and then that the shell agrees with them.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_shell_canvas.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHELLS } from '../src/workspaces/shellConfig.js';

const CANVAS = resolve(
  import.meta.dirname, '../../design/canvases/integrated/Advisor Detail · Practice.dc.html',
);
const canvas = readFileSync(CANVAS, 'utf8');

/**
 * Each artboard's own header chip, in document order:
 *   <a class="ab-id" href="#pr4">PR4</a><span class="ab-nm">Sessions</span>
 *   <span class="arch" style="{{ chipFeed }}">FEED</span>
 */
function artboardChips() {
  const re = /<span class="ab-nm">([^<]+)<\/span><span class="arch"[^>]*>([A-Z ]+)<\/span>/g;
  const out = [];
  let m;
  while ((m = re.exec(canvas))) out.push([m[1].trim(), m[2].trim()]);
  return out;
}

/** The canvas's own summary of the same five, from its data block. */
function setIndexPairs() {
  const start = canvas.indexOf('setIndex: [');
  assert.ok(start > 0, 'the canvas no longer declares setIndex');
  const block = canvas.slice(start, canvas.indexOf(']', canvas.indexOf('].map', start)));
  const re = /\['([^']+)','([^']+)'\]/g;
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push([m[1], m[2]]);
  return out;
}

test('the canvas agrees with itself about the five Practice archetypes', () => {
  // Asserted FIRST because everything below trusts the canvas. If its header
  // chips and its own index disagree, the canvas is the thing to fix and no
  // conclusion about the shell is available yet.
  const chips = artboardChips();
  const index = setIndexPairs();
  assert.equal(chips.length, 5, `expected 5 artboards, parsed ${chips.length}`);
  assert.deepEqual(chips, index, 'the artboard chips and setIndex disagree');
});

test('the advisor Practice zones advertise the page type the canvas draws', () => {
  const practice = SHELLS.advisor.rows.find((r) => r.kind === 'bucket' && r.label === 'Practice');
  assert.ok(practice, 'the advisor shell has no Practice bucket');

  const fromCanvas = artboardChips();
  const fromShell = practice.zones.map((z) => [z.label, z.archetype?.label]);
  // Same order, same names, same archetypes. Order matters: the zone pills are
  // rendered in this sequence and the canvas draws PR1–PR5 in that sequence.
  assert.deepEqual(fromShell, fromCanvas);
});

test('every Practice zone has an archetype at all', () => {
  // A missing archetype renders as an empty badge rather than a wrong one, so
  // the deepEqual above would catch it — but the failure would read as a name
  // mismatch. This says what actually happened.
  const practice = SHELLS.advisor.rows.find((r) => r.kind === 'bucket' && r.label === 'Practice');
  for (const z of practice.zones) {
    assert.ok(z.archetype?.label, `${z.slug} has no archetype`);
  }
});

test('the Practice bucket tagline is the canvas’s own', () => {
  const practice = SHELLS.advisor.rows.find((r) => r.kind === 'bucket' && r.label === 'Practice');
  assert.equal(practice.tagline, 'Run my advisory business');
});

test('the five zone slugs are the five routes the canvas names', () => {
  // The canvas puts the route under each artboard name (`/practice/sessions`),
  // so the slug set is checkable rather than assumed.
  const practice = SHELLS.advisor.rows.find((r) => r.kind === 'bucket' && r.label === 'Practice');
  for (const z of practice.zones) {
    assert.ok(
      canvas.includes(`/practice/${z.slug}`),
      `the canvas never names /practice/${z.slug}`,
    );
  }
});
