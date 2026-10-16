/**
 * D405 — the Eadwyn AI rail on a phone (canvas M5): a floating button above
 * the tab bar, opening the rail's blocks in a bottom sheet. Since D698 this is
 * the phone form for every viewer the Eadwyn panel does not serve; a founder
 * on a founder page gets the panel (`airail_d698.test.mjs`).
 *
 * This repository renders without a DOM, so the button and the sheet are
 * rendered with react-dom/server and read as markup, and every way the sheet
 * opens and closes is driven through `railSheetReducer`, the one place the
 * component decides it. The CSS checks at the end are the breakpoint rules a
 * render cannot show.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_mobile_d405.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import WorkerRail, {
  RailFab, RailSheet, railSheetReducer, RAIL_FAB_BOTTOM, RAIL_SWIPE_DISMISS_PX,
} from '../src/ui/WorkerRail.jsx';

const html = (C, props, ...children) => renderToStaticMarkup(React.createElement(C, props, ...children));
const CSS = readFileSync(resolve(process.cwd(), 'frontend/src/ui/workerRail.css'), 'utf8');

// ───────────────────────────────────────────────────────── the button ──

test('the button sits 16px above the tab bar, reading the bar\'s own height', () => {
  assert.equal(RAIL_FAB_BOTTOM, 'calc(var(--mobile-tabbar-h, 0px) + 16px)');
  const h = html(RailFab, { workspace: 'Build', aiOn: false, onOpen: () => {} });
  const style = /style="([^"]*)"/.exec(h)?.[1] || '';
  assert.match(style, /bottom:calc\(var\(--mobile-tabbar-h, 0px\) \+ 16px\)/,
    'the button does not clear the tab bar');
});

test('the badge states the mode, and the label says it in words', () => {
  const manual = html(RailFab, { workspace: 'Build', aiOn: false, onOpen: () => {} });
  assert.match(manual, /aria-label="Open Eadwyn AI · Build · Manual"/);
  assert.match(manual, /class="fwr-fab-badge" data-mode="manual"/);
  assert.match(manual, /aria-haspopup="dialog"/);
  const ai = html(RailFab, { workspace: 'Validate', aiOn: true, onOpen: () => {} });
  assert.match(ai, /aria-label="Open Eadwyn AI · Validate · Eadwyn"/);
  assert.match(ai, /class="fwr-fab-badge" data-mode="ai"/);
});

// ─────────────────────────────────────────────────────────── the sheet ──

test('the sheet is a labelled dialog with a close button and a backdrop, holding the rail\'s blocks', () => {
  const h = html(RailSheet, { id: 's', workspace: 'Build', onEvent: () => {} },
    React.createElement('p', null, 'Usage this month'));
  assert.match(h, /role="dialog"/);
  assert.match(h, /aria-modal="true"/);
  assert.match(h, /aria-labelledby="s-title"/);
  assert.match(h, /<h2 id="s-title"[^>]*>Eadwyn AI<\/h2>/);
  assert.match(h, /data-testid="button-worker-rail-sheet-close"/);
  assert.match(h, /data-testid="button-worker-rail-sheet-backdrop"/);
  assert.match(renderedText(h), /Usage this month/, 'the sheet does not carry the rail\'s content');
});

test('opening: the button opens the sheet, and a second open changes nothing', () => {
  const closed = { open: false };
  const open = railSheetReducer(closed, { type: 'open' });
  assert.deepEqual(open, { open: true });
  assert.equal(railSheetReducer(open, { type: 'open' }), open);
});

test('closing: backdrop, Escape and the close button each close it — and so do a route change and the desktop breakpoint', () => {
  for (const type of ['backdrop', 'escape', 'close', 'route', 'desktop']) {
    assert.deepEqual(railSheetReducer({ open: true }, { type }), { open: false }, `${type} left the sheet open`);
  }
});

test('a swipe closes it only past the threshold, and only downward', () => {
  const open = { open: true };
  assert.deepEqual(railSheetReducer(open, { type: 'swipe', dy: RAIL_SWIPE_DISMISS_PX + 1 }), { open: false });
  assert.equal(railSheetReducer(open, { type: 'swipe', dy: RAIL_SWIPE_DISMISS_PX }), open, 'a short drag closed the sheet');
  assert.equal(railSheetReducer(open, { type: 'swipe', dy: -200 }), open, 'an upward drag closed the sheet');
  assert.equal(railSheetReducer(open, { type: 'swipe', dy: undefined }), open);
  assert.equal(RAIL_SWIPE_DISMISS_PX, 60, 'the More sheet dismisses at 60px; one sheet, one gesture');
});

test('a closed sheet ignores closers, and no unknown event opens it', () => {
  const closed = { open: false };
  for (const type of ['backdrop', 'escape', 'close', 'route', 'desktop', 'swipe', 'nonsense']) {
    assert.equal(railSheetReducer(closed, { type, dy: 500 }), closed);
  }
  assert.equal(railSheetReducer({ open: true }, { type: 'nonsense' }).open, true);
});

// ─────────────────────────────────────────────── the rail and the page ──

test('a server render draws the panel and no floating button: the portal waits for the client', () => {
  const h = html(WorkerRail, { workspace: 'Build' });
  assert.match(h, /data-testid="worker-rail"/);
  // The canvas's blocks (D698): the line in place of a switch, the
  // suggestions with the safety line, and Usage.
  assert.match(renderedText(h), /Suggested for this page[\s\S]*Eadwyn drafts; you send\.[\s\S]*Usage/, 'the panel lost its blocks');
  assert.match(h, /data-testid="text-worker-rail-safety"/, 'the panel lost its safety line');
  assert.doesNotMatch(h, /button-worker-rail-fab/, 'the button rendered on the server, where there is no document');
  assert.doesNotMatch(h, /worker-rail-sheet/);
});

test('below 1024px the panel gives way to the button; at and above it the button is hidden', () => {
  const at = CSS.indexOf('@media (max-width: 1023.98px)');
  assert.ok(at > 0, 'no phone breakpoint in workerRail.css');
  const phone = CSS.slice(at, CSS.indexOf('\n}\n', at));
  assert.match(phone, /aside\.fwr \{ display: none; \}/, 'the panel still draws under the page on a phone');
  assert.match(phone, /\.fwr-fab \{[^}]*position: fixed/);
  assert.match(phone, /\.fwr-sheet-layer \{ display: block;/);
  const base = CSS.slice(0, at);
  assert.match(base, /\.fwr-fab,\s*\.fwr-sheet-layer \{ display: none; \}/, 'the button shows on desktop');
});
