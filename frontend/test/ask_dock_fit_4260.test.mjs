// #4260 — the docked Ask panel meets its column: under the header, above the
// footer, flush with the seam, beside an open rail or a collapsed spine.
//
// What the owner saw on Build › Overview, and what each test holds:
//   - a gap above and below the panel and at the seam: `RailFrame` padded the
//     column around the rail, and the panel is docked to the rail's box. The
//     inset is the rail's own now, and the rail fills the column;
//   - beside the collapsed rail, a 202px panel whose composer spilled over the
//     page: the panel's height came from the rail, which was as tall as its
//     spine. The panel clips its own content, and the rail fills the column;
//   - the panel over the content beside an empty 464px column: the move into
//     the column hung on a container query. `WorkerRail` measures its aside;
//   - the panel's head under the header at the end of a long page: its height
//     was the window's. It is the visible part of the column (`askFit`);
//   - the column ending mid-page on an edge-to-edge page (the cycle pages).
// Measured in Chromium at 1650×1000 on /build before and after; the browser
// run is not part of this suite, which holds the declarations and the maths.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ask_dock_fit_4260.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASK_ROOM_MIN, askFit, askRoom } from '../src/ui/askPanelModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const RAIL_CSS = code(read('ui/workerRail.css'));
const ASK_CSS = code(read('ui/askPanel.css'));
const RAIL = code(read('ui/WorkerRail.jsx'));
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  return css.slice(at + selector.length + 2, css.indexOf('}', at));
};

test('askFit: the visible part of the column, never the window when the footer is in view', () => {
  // The owner's first screenshot: the end of a long page, the column's foot at
  // the footer's top (951) in a 1000px window under a 56px header.
  assert.equal(askFit({ top: -1496, bottom: 951 }, 56, 1000), 895, 'header to footer, so the head stays in view');
  assert.equal(askFit({ top: 56, bottom: 2503 }, 56, 1000), 944, 'the top of a long page: the window under the header');
  assert.equal(askFit({ top: 120, bottom: 2503 }, 56, 1000), 880, 'a column that starts lower starts the panel there');
  assert.equal(askFit({ top: -900, bottom: 40 }, 56, 1000), 0, 'a column scrolled away leaves nothing, never a negative height');
  assert.equal(askFit({ top: 56.4, bottom: 950.6 }, 56, 1000), 894, 'whole pixels');
});

test('askRoom: only a column that took the panel\'s width has room for it', () => {
  assert.equal(ASK_ROOM_MIN, 400);
  assert.equal(askRoom(464), true, 'the 44px spine plus the 420px panel');
  assert.equal(askRoom(700), true, 'the open rail plus the panel');
  assert.equal(askRoom(288), false, 'the widest rail that did not widen');
  assert.equal(askRoom(undefined), false);
});

test('the frame: the rail carries the inset and fills its column; the spine stays at the top', () => {
  // Mutation checked: the padding put back on `.fwr-frame-rail` → the first assertion fails.
  const col = RAIL_CSS.match(/\.fwr-frame-rail \{([^}]*width:[^}]*)\}/)?.[1];
  assert.ok(col, 'the frame column rule');
  assert.doesNotMatch(col, /padding/, 'a padded column insets the docked panel from the header, the foot and the seam');
  assert.match(col, /display: flex; flex-direction: column;/);
  assert.match(rule(RAIL_CSS, '.fwr-frame-dock'), /flex: 1 0 auto; display: flex; flex-direction: column;/);
  assert.match(rule(RAIL_CSS, '.fwr-frame-dock > aside.fwr'), /flex: 1 0 auto;[^}]*padding: 18px 18px 28px;/);
  assert.match(rule(RAIL_CSS, '.fwr-frame-dock > aside.fwr[data-collapsed="true"]'), /padding-left: 0; padding-right: 0;/);
  assert.match(rule(RAIL_CSS, '.fwr-frame-dock > aside.fwr[data-collapsed="true"] > .fwr-title'), /height: auto;/, 'a column-high reversed title packs the spine to the foot');
});

test('an edge-to-edge page grows its rail frame to the footer', () => {
  assert.match(rule(RAIL_CSS, '[data-app-main].edge-to-edge-surface:has(> .fwr-frame[data-rail="true"])'), /flex: 1 0 auto; display: flex; flex-direction: column;/);
  assert.match(rule(RAIL_CSS, '[data-app-main].edge-to-edge-surface > .fwr-frame[data-rail="true"]'), /flex: 1 0 auto;/);
});

test('the panel: its height is the measured fit, it clips its own content, and the move hangs on attributes', () => {
  assert.match(rule(ASK_CSS, '.ead-ask'), /overflow: hidden;/, 'nothing is drawn outside the panel\'s ground');
  assert.match(rule(ASK_CSS, '.fwr-ask-dock > .ead-ask'), /position: sticky; top: 0; height: min\(var\(--ask-fit, calc\(100dvh - 56px\)\), 100%\);/);
  assert.match(rule(ASK_CSS, 'aside.fwr[data-ask-docked="true"]'), /position: relative;/);
  assert.match(rule(ASK_CSS, 'aside.fwr[data-ask-room="true"] > .fwr-ask-dock'), /right: auto; left: 0;/);
  assert.match(rule(ASK_CSS, 'aside.fwr[data-ask-room="true"] > :not(.fwr-ask-dock)'), /margin-left: 420px;/);
  assert.doesNotMatch(ASK_CSS, /@container|:has\(/, 'neither a container query nor :has() decides where the panel sits');
});

test('WorkerRail: marks the aside, measures its room, and fits the panel as the page scrolls', () => {
  // Mutation checked: `askHasRoom` dropped from the room attribute → the attribute assertion fails.
  assert.match(RAIL, /<aside\s+ref=\{asideRef\}/);
  assert.match(RAIL, /\{\.\.\.\(askPanel && askDocked \? \{ 'data-ask-docked': 'true' \} : \{\}\)\}/);
  assert.match(RAIL, /\{\.\.\.\(askPanel && askDocked && askHasRoom \? \{ 'data-ask-room': 'true' \} : \{\}\)\}/);
  assert.match(RAIL, /if \(!el \|\| !askState\.open \|\| askAt !== 'dock'\) \{ setAskHasRoom\(false\); return undefined; \}/, 'room only where the panel docks at 1440px and up');
  assert.match(RAIL, /setAskHasRoom\(askRoom\(el\.getBoundingClientRect\(\)\.width\)\)/);
  assert.match(RAIL, /const scroller = el\.closest\('\[data-app-scroll\]'\);/);
  assert.match(RAIL, /askFit\(el\.getBoundingClientRect\(\), scroller \? scroller\.getBoundingClientRect\(\)\.top : 0, window\.innerHeight\)/);
  assert.match(RAIL, /el\.style\.setProperty\('--ask-fit', `\$\{fitted\}px`\);/);
  assert.match(RAIL, /target\.addEventListener\('scroll', queue, \{ passive: true \}\);/);
  assert.match(RAIL, /el\.style\.removeProperty\('--ask-fit'\);/, 'a closed panel leaves no stale height');
});
