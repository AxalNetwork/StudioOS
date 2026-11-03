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
//     was the window's;
//   - the column ending mid-page on an edge-to-edge page (the cycle pages);
//   - on the hosts that draw their own rail frame, the rail's rules styling the
//     panel (`.inw-rail section` boxed it, `.a6-rail>div` pushed it down).
// So the docked panel is no longer drawn inside the rail: it is fixed at the
// document's level and placed from the rail's box (`askDock`).
// Measured in Chromium at 1650×1000 on /build before and after; the browser
// run is not part of this suite, which holds the declarations and the maths.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ask_dock_fit_4260.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASK_ROOM_MIN, ASK_WIDTH, askDock, askRoom } from '../src/ui/askPanelModel.js';

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

test('askDock: under the header to the footer, at the seam when the column took the panel, else against its edge', () => {
  const view = { scrollTop: 56, scrollLeft: 256, viewHeight: 1000 };
  // The owner's Build page, rail open at 1650px: the column widened to 700px.
  assert.deepEqual(askDock({ left: 950, width: 700 }, 1, { ...view, footTop: 951 }, 'dock'), { room: true, top: 56, left: 951, height: 895 });
  // Collapsed: the 44px spine plus the panel.
  assert.deepEqual(askDock({ left: 1186, width: 464 }, 1, { ...view, footTop: 951 }, 'dock'), { room: true, top: 56, left: 1187, height: 895 });
  // A long page: the footer below the window, so the panel is the window under the header.
  assert.equal(askDock({ left: 950, width: 700 }, 1, { ...view, footTop: 2503 }, 'dock').height, 944);
  // The end of a long page: the footer in view, so the head stays under the header and the composer above the footer.
  assert.equal(askDock({ left: 950, width: 700 }, 1, { ...view, footTop: 951 }, 'dock').top, 56);
  // 1024 to 1439px: over the content, against the column's outer edge.
  assert.deepEqual(askDock({ left: 1000, width: 280 }, 1, { ...view, footTop: 951 }, 'overlay'), { room: false, top: 56, left: 1000 - ASK_WIDTH, height: 895 });
  // Room is a 1440px matter: below it the track never widened for the panel, however wide the rail.
  // Mutation checked: room computed without the layout → this fails.
  assert.equal(askDock({ left: 950, width: 700 }, 1, { ...view, footTop: 951 }, 'overlay').room, false);
  // A host whose track does not widen keeps the overlay at 1440px and up too.
  assert.equal(askDock({ left: 1362, width: 288 }, 1, { ...view, footTop: 951 }, 'dock').room, false);
  // Never left of the scroll area, never a negative height, no footer means the window's foot.
  assert.equal(askDock({ left: 300, width: 280 }, 0, { ...view, footTop: 951 }, 'overlay').left, 256);
  assert.equal(askDock({ left: 950, width: 700 }, 1, { ...view, footTop: 20 }, 'dock').height, 0);
  assert.equal(askDock({ left: 950, width: 700 }, 1, { ...view, footTop: null }, 'dock').height, 944);
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

test('an edge-to-edge page grows its rail to the footer, whoever draws the frame', () => {
  assert.match(rule(RAIL_CSS, '[data-app-main].edge-to-edge-surface:has(aside.fwr)'), /flex: 1 0 auto; display: flex; flex-direction: column;/);
  assert.match(rule(RAIL_CSS, '[data-app-main].edge-to-edge-surface:has(aside.fwr) > :has(aside.fwr)'), /flex: 1 0 auto;/);
});

test('the panel: fixed at the document level, clipping its own content; the rail moves clear on an attribute', () => {
  // Mutation checked: the dock put back inside the aside → the WorkerRail test fails; `overflow: hidden` dropped → this one does.
  assert.match(rule(ASK_CSS, '.ead-ask'), /overflow: hidden;/, 'nothing is drawn outside the panel\'s ground');
  assert.match(rule(ASK_CSS, '  .ead-ask-dock'), /display: block; position: fixed;/);
  assert.match(rule(ASK_CSS, '  .ead-ask-dock > .ead-ask'), /height: 100%;/);
  assert.match(rule(ASK_CSS, '  aside.fwr[data-ask-room="true"] > *'), /margin-left: 420px;/);
  assert.doesNotMatch(ASK_CSS, /@container|:has\(|fwr-ask-dock/, 'neither a container query, a :has() nor a dock inside the rail decides where the panel sits');
});

test('WorkerRail: measures its rail, places the panel as the page scrolls, and draws it outside the rail', () => {
  assert.match(RAIL, /<aside\s+ref=\{asideRef\}/);
  assert.match(RAIL, /\{\.\.\.\(askPanel && askDocked && askHasRoom \? \{ 'data-ask-room': 'true' \} : \{\}\)\}/);
  assert.match(RAIL, /<\/aside>\s*\{portalReady && askPanel && askDocked && createPortal\(\s*<div ref=\{setDock\} className="ead-ask-dock"/, 'drawn after the aside, at the document level');
  assert.doesNotMatch(RAIL, /className="fwr-ask-dock"/, 'never inside the rail again');
  assert.match(RAIL, /const scroller = el\.closest\('\[data-app-scroll\]'\);/);
  assert.match(RAIL, /const foot = scroller \? \[\.\.\.scroller\.children\]\.find\(\(n\) => n\.tagName === 'FOOTER'\) : null;/, 'the app footer, a child of the scroll area');
  assert.match(RAIL, /askDock\(el\.getBoundingClientRect\(\), el\.clientLeft, \{\s*scrollTop: view\.top, scrollLeft: view\.left, footTop: foot \? foot\.getBoundingClientRect\(\)\.top : null, viewHeight: window\.innerHeight,\s*\}, askAt\);/);
  assert.match(RAIL, /Object\.assign\(dock\.style, \{ top: `\$\{at\.top\}px`, left: `\$\{at\.left\}px`, height: `\$\{at\.height\}px` \}\);/);
  assert.match(RAIL, /target\.addEventListener\('scroll', queue, \{ passive: true \}\);/);
  assert.match(RAIL, /watch\?\.observe\(el\);/, 'the rail widening for the panel re-places it');
  assert.match(RAIL, /const setDock = useCallback\(\(node\) => \{ dockRef\.current = node; if \(node\) placeRef\.current\?\.\(\); \}, \[\]\);/, 'placed the moment it mounts');
});
