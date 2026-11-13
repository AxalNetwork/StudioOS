/**
 * D406 — the collapsed rail's spine: the status dot and the vertical spend
 * (Founder Workspaces canvas, "Collapsed spine").
 *
 * Every state is rendered with react-dom/server and read as markup. The spend
 * has four states, and the three that are not a figure must never read as
 * one; Manual hides it altogether, as the canvas says.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_spine_d406.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { RailSpine, spineSpend } from '../src/ui/WorkerRail.jsx';

const html = (props) => renderToStaticMarkup(React.createElement(RailSpine, props));
const CSS = readFileSync(resolve(process.cwd(), 'frontend/src/ui/workerRail.css'), 'utf8');
const SPEND = { recorded: true, month: { spend_usd: 14.2, cap_usd: 40, calls: 9 } };

// ─────────────────────────────────────────────────────────────── the dot ──

test('the dot is green and says so when the advisor is on, grey and says Manual when it is not', () => {
  const on = html({ aiOn: true, spendState: spineSpend({ spend: SPEND }) });
  assert.match(on, /class="fwr-spine-dot" data-state="on"/);
  assert.match(on, /aria-label="Eadwyn on"/);
  const off = html({ aiOn: false, spendState: spineSpend({ spend: SPEND }) });
  assert.match(off, /class="fwr-spine-dot" data-state="off"/);
  assert.match(off, /aria-label="Manual"/);
});

// ───────────────────────────────────────────────────────────── the spend ──

test('the figure: the month to date, from aiSpend', () => {
  const h = html({ aiOn: true, spendState: spineSpend({ spend: SPEND }) });
  assert.match(h, /data-state="figure"/);
  assert.match(renderedText(h), /\$14\.20/);
});

test('loading is an ellipsis, never a zero', () => {
  const s = spineSpend({ spend: null, loading: true });
  assert.deepEqual([s.state, s.text], ['loading', '…']);
  const h = html({ aiOn: true, spendState: s });
  assert.match(h, /data-state="loading"/);
  assert.doesNotMatch(renderedText(h), /\$|0\.00/);
});

test('a failed request, or a usage log that could not be read, is Unreadable', () => {
  for (const args of [{ spend: null, spendError: new Error('x') }, { spend: { recorded: false } }]) {
    const s = spineSpend(args);
    assert.equal(s.state, 'unreadable');
    const h = html({ aiOn: true, spendState: s });
    assert.match(renderedText(h), /Unreadable/);
    assert.doesNotMatch(renderedText(h), /\$|Not recorded/, 'a failed read rendered as a figure or as an empty store');
  }
});

test('a log read with no month figure is Not recorded, never $0.00', () => {
  for (const spend of [{ recorded: true, month: {} }, { recorded: true }]) {
    const s = spineSpend({ spend });
    assert.equal(s.state, 'not_recorded');
    const h = html({ aiOn: true, spendState: s });
    assert.match(renderedText(h), /Not recorded/);
    assert.doesNotMatch(renderedText(h), /\$/);
  }
  // A real zero is a figure, and is drawn as one.
  const zero = spineSpend({ spend: { recorded: true, month: { spend_usd: 0 } } });
  assert.equal(zero.state, 'figure');
  assert.equal(zero.text, '$0.00');
});

test('the four states never share a look: each carries its own data-state and style', () => {
  const states = [
    spineSpend({ loading: true }),
    spineSpend({ spendError: true }),
    spineSpend({ spend: { recorded: true } }),
    spineSpend({ spend: SPEND }),
  ].map((s) => s.state);
  assert.deepEqual(states, ['loading', 'unreadable', 'not_recorded', 'figure']);
  // Read inside the spine's own desktop block, so a dark-mode override alone
  // cannot stand in for the light rule.
  const at = CSS.indexOf('aside.fwr[data-collapsed="true"] .fwr-spine {');
  const block = CSS.slice(CSS.lastIndexOf('@media (min-width: 1024px)', at), CSS.indexOf('\n}\n', at));
  for (const st of states) {
    assert.match(block, new RegExp(`\\.fwr-spine-spend\\[data-state="${st}"\\] \\{`), `${st} has no style of its own`);
  }
});

test('Manual hides the spend: a quiet strip, not a nag', () => {
  const h = html({ aiOn: false, spendState: spineSpend({ spend: SPEND }) });
  assert.doesNotMatch(h, /fwr-spine-spend/);
  assert.doesNotMatch(renderedText(h), /\$14\.20/);
});

test('the spine names no model and no price', () => {
  const h = html({ aiOn: true, spendState: spineSpend({ spend: SPEND }) });
  assert.doesNotMatch(h, /@cf\/|llama|\/ M in|per million/i);
});

test('the spine draws only on the collapsed desktop rail', () => {
  assert.match(CSS, /\.fwr-spine \{ display: none; \}/);
  const at = CSS.indexOf('aside.fwr[data-collapsed="true"] .fwr-spine {');
  assert.ok(at > 0, 'the spine is never shown');
  const media = CSS.lastIndexOf('@media (min-width: 1024px)', at);
  assert.ok(media > 0 && CSS.indexOf('\n}\n', media) > at, 'the spine shows outside the desktop breakpoint');
});
