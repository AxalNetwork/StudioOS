/**
 * D402 — the rail's model picks are stored per workspace and per task, and the
 * rail reads the current path without a router.
 *
 * D402 also drew an INHERITED, read-only card on every zone below a workspace,
 * worked out by `ui/railInheritance.js`. D698 (#1660) removed both: the AIRail
 * canvas offers the pick on every page, and the rail's note says how far it
 * reaches ("Remembered for {workspace}. Switching changes nothing already
 * accepted."). The assertions on that card and on `railInheritance` went with
 * it; `airail_d698.test.mjs` pins that they are gone. What stays here is what
 * D402 established that still holds: a zone and its root share one stored key,
 * so the card and the run agree, and reading the path never throws.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_inherited_d402.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

// ── The rail ────────────────────────────────────────────────────────────

/** The models list itself: the cards and the compact rows. */
function modelsList() {
  const src = codeOnly(read(RAIL));
  const from = src.indexOf('<div className="fwr-models">');
  return src.slice(from, src.indexOf('</div>\n            <p className="fwr-models-note"', from));
}

test('a zone and its root read one stored pick, so the card and the run agree', () => {
  const src = codeOnly(read(RAIL));
  // The cards are built from the same per-section, per-task picks the bands
  // send (`railModelChoice.js`), on a zone as on the root (D402, kept by D698).
  assert.match(src, /chosen: \(task\) => readRailModel\(workspace, task\)/,
    'the cards are not the stored picks');
  assert.match(modelsList(), /\{view\.cards\.map\(\(card\) => \(/, 'a zone does not draw the cards in use');
  assert.match(codeOnly(read('frontend/src/workspaces/FillProposals.jsx')), /readRailModel\(workspace, task\)/,
    'the band reads a different store, so the card and the run can disagree');
});

test('reading the path never throws outside a router', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /useLocation\(/, 'useLocation throws outside a router');
  assert.match(src, /useContext\(UNSAFE_LocationContext\)/);
});
