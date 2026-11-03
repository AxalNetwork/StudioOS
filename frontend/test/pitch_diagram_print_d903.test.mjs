// D903 §11 (#3660) — the print page (which the PDF and the PowerPoint
// pictures photograph), Present and the editor's card draw a typed diagram
// from its layout, not a "Graphic · …" line.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_diagram_print_d903.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockGrid } from '../src/pages/raise/pitch/BlockGrid.jsx';

const COLOURS = { muted: '#64748b', accent: '#7c3aed' };
const FLOW = { v: 1, type: 'flow', items: [{ label: 'Hire engineers' }, { label: 'Ship the API', detail: 'Public docs' }, { label: 'Win pilots' }] };
const MATRIX = { v: 1, type: 'matrix', axes: { x: 'Price', y: 'Depth' }, items: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'Us' }] };

const draw = (blocks, size = 'print') => renderToStaticMarkup(React.createElement(BlockGrid, { blocks, colours: COLOURS, live: true, size }));

test('D903 §11: a typed diagram is drawn with its words and arrows; a graphic without one keeps its name', () => {
  // Mutation checked: BlockGrid's diagram branch removed → "Graphic · flow" comes back and data-diagram is gone.
  const html = draw([
    { id: 'f', kind: 'graphic', graphic: 'flow', diagram: FLOW, grid: { c1: 1, c2: 12, r1: 1, r2: 3 } },
    { id: 'm', kind: 'graphic', graphic: 'matrix', diagram: MATRIX, grid: { c1: 1, c2: 6, r1: 4, r2: 6 } },
    { id: 'g', kind: 'graphic', graphic: 'star', grid: { c1: 7, c2: 12, r1: 4, r2: 6 } },
  ]);
  assert.match(html, /data-diagram="flow"/);
  assert.match(html, /aria-label="Flow diagram"/);
  for (const w of ['Hire engineers', 'Ship the API', 'Public docs', 'Win pilots', 'Price', 'Depth', 'Us']) assert.ok(html.includes(`>${w}<`), w);
  assert.equal((html.match(/<line /g) || []).length, 2 + 2, "the flow's two arrows and the matrix's two axes");
  assert.equal((html.match(/marker-end="url\(#dga-f\)"/g) || []).length, 2);
  assert.ok(html.includes('writing-mode:vertical-rl'), "the matrix's y axis reads up its side");
  assert.ok(!html.includes('Graphic · flow') && html.includes('Graphic · star'));
});

test('D903 §11: a diagram that does not sanitize stays a name line', () => {
  const html = draw([{ id: 'x', kind: 'graphic', graphic: 'flow', diagram: { v: 1, type: 'flow', items: [{ label: 'Only one' }] }, grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }]);
  assert.ok(html.includes('Graphic · flow') && !html.includes('data-diagram'));
});
