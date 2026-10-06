/**
 * D476 — the dead store is gone, and the 18 canvases load support.js
 * with a parser-blocking script tag instead of document.write.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const STATIC = '<script src="./support.js"></script>';
const LOADER = "document.write('<script src=\"./support.js'";

const CANVASES = [
  'design/canvases/backlog/Data Room.dc.html',
  'design/canvases/backlog/Perks & Products.dc.html',
  'design/canvases/integrated/Advisory Practice.dc.html',
  'design/canvases/integrated/BD Console.dc.html',
  'design/canvases/integrated/Cap Table Pro.dc.html',
  'design/canvases/integrated/Co-marketing.dc.html',
  'design/canvases/integrated/Deal Flow.dc.html',
  'design/canvases/integrated/Due Diligence.dc.html',
  'design/canvases/integrated/Fund Administration.dc.html',
  'design/canvases/integrated/Get Paid & Invoicing.dc.html',
  'design/canvases/integrated/Legal & Capital Engine.dc.html',
  'design/canvases/integrated/Liquidity & Secondaries.dc.html',
  'design/canvases/integrated/Metrics.dc.html',
  'design/canvases/integrated/Navigation Shell.dc.html',
  'design/canvases/integrated/Network.dc.html',
  'design/canvases/integrated/Portfolio.dc.html',
  'design/canvases/integrated/Round Manager.dc.html',
  'design/canvases/integrated/Scoring Engine v2.dc.html',
];

const STILL_WRITTEN = [
  'attached_assets/Advisory_Practice.dc.html',
  'attached_assets/BD_Console.dc.html',
  'attached_assets/Cap_Table_Pro.dc.html',
  'attached_assets/Deal_Flow.dc.html',
  'attached_assets/Due_Diligence.dc.html',
  'attached_assets/Fund_Administration.dc.html',
  'attached_assets/Liquidity_Secondaries.dc.html',
  'attached_assets/Metrics.dc.html',
  'attached_assets/Portfolio.dc.html',
  'attached_assets/Round_Manager.dc.html',
];

test('the 18 canvases load support.js with a blocking script tag', () => {
  assert.equal(CANVASES.length, 18);
  for (const file of CANVASES) {
    const html = read(file);
    const line = html.split('\n')[5];
    assert.equal(line, STATIC, file);
    assert.equal(html.includes('document.write'), false, file);
  }
});

test('the ten attached_assets copies still carry document.write and are not this change', () => {
  for (const file of STILL_WRITTEN) {
    assert.equal(read(file).includes(LOADER), true, file);
  }
});

test('deck-stage no longer stores kb before the try', () => {
  const src = read('design/canvases/shared/deck-stage.js');
  assert.equal(src.includes('var kb = true'), false);
  assert.match(src, /let kb;\n\s*try \{\n\s*const t = e\.target;\n\s*kb = !\(t && t\.matches && !t\.matches\(':focus-visible'\)\);/);
});

/** The same expression the handler uses, so a mouse focus still does not pin. */
function kbFor(target) {
  let kb;
  try {
    const t = target;
    kb = !(t && t.matches && !t.matches(':focus-visible'));
  } catch {
    kb = true;
  }
  return kb;
}

test('keyboard focus still pins and a mouse click still does not', () => {
  assert.equal(kbFor(null), true);
  assert.equal(kbFor({ matches: () => true }), true);
  assert.equal(kbFor({ matches: () => false }), false);
  assert.equal(kbFor({ matches: () => { throw new Error('no'); } }), true);
});
