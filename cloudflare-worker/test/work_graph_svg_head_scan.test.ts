/**
 * Code Scanning (js/redos): `startsAsSvg` replaced a backtracking regular
 * expression in workGraphMedia.ts's sniffer. It answers as the old pattern did
 * on every head below (answers recorded from that pattern), and adversarial
 * heads are answered in linear time.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_svg_head_scan.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startsAsSvg } from '../src/services/workGraphMedia.ts';

// The answers below were recorded from the pattern startsAsSvg replaced:
//   /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^\[>]*(\[[\s\S]*?\])?\s*>\s*)?<svg[\s>]/i
// It is not compiled here: it is the exponential pattern (CodeQL js/redos).
const HEADS: [string, boolean][] = [
  ['<svg xmlns="http://www.w3.org/2000/svg">', true],
  ['<SVG>', true],
  ['<svg\n width="1">', true],
  ['<?xml version="1.0"?>\n<svg>', true],
  ['<?xml version="1.0" encoding="utf-8"?><!-- made by hand --><svg>', true],
  ['<!-- a --> <!-- b -->\n<svg>', true],
  ['<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg>', true],
  ['<!DOCTYPE svg [ <!ENTITY a "b"> ]>\n<svg>', true],
  ['<?xml version="1.0"?><!-- c --><!DOCTYPE svg><svg>', true],
  ['<svgx>', false],
  ['<html><svg>', false],
  ['<!-- unclosed <svg>', false],
  ['<!DOCTYPE html><svg>', false],
  ['<?xml?>', false],
  ['', false],
  ['svg', false],
  ['<!DOCTYPE svg [ <svg>', false],
  ['<!DOCTYPE svg [ <!ENTITY a "]"> ]>\n<svg>', true],
  ['<!DOCTYPE svg [ ] x><svg>', false],
  ['<!DOCTYPE svg [ ]  \n >  <svg>', true],
  ['<!-- a --> junk --><svg>', true],
  ['<!-- a --><!DOCTYPE svg [ ] --> ]><svg>', true],
  ['<!---->\n<svg>', true],
  ['<!-->--><svg>', true],
  ['<!--->\n<svg>', false],
  ['<?xml-stylesheet href="a"?><svg>', true],
  ['<?xml version="1.0"?><?xml-stylesheet?><svg>', false],
  ['\u00a0<svg>', false],
  ['<?xml?>\u2028<svg\t>', true],
];

test('startsAsSvg answers as the pattern it replaced did', () => {
  for (const [head, old] of HEADS) assert.equal(startsAsSvg(head), old, JSON.stringify(head));
});

test('startsAsSvg answers as the pattern it replaced did on 20,000 seeded heads', () => {
  const parts = ['<?xml?>', '<?xml', '<!--', '-->', '--', '<!DOCTYPE svg', '<!DOCTYPE', ' svg', '[', ']', '"]"', '>', '<svg', '<svg>', '<SVG ', 'x', ' ', '\n'];
  let seed = 7; // xorshift32: the same heads on every run
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % 1000003; };
  let answers = '';
  let accepted = 0;
  for (let n = 0; n < 20000; n++) {
    let head = '';
    for (let k = next() % 9; k > 0; k--) head += parts[next() % parts.length];
    const yes = startsAsSvg(head);
    answers += yes ? '1' : '0';
    if (yes) accepted++;
  }
  // The old pattern accepted 2,396 of these heads; this digests its 20,000 answers in order.
  assert.equal(accepted, 2396);
  assert.equal(createHash('sha256').update(answers).digest('hex'), '1e4473d3ae33733b0507cd35f126f85f76c7d4e347b9cf714598a6e9333da485');
});

test('a head of many unclosed comments is answered at once', () => {
  const evil = '<!--'.repeat(20000);
  const t = performance.now();
  assert.equal(startsAsSvg(evil), false);
  assert.ok(performance.now() - t < 200, 'linear in the head');
});

test('many closed comments and brackets are answered at once', () => {
  for (const evil of ['<!-- -->'.repeat(5000) + 'x', '<!-- --><!DOCTYPE svg [ ] '.repeat(1000) + 'x', '<!DOCTYPE svg [' + ']'.repeat(20000)]) {
    const t = performance.now();
    assert.equal(startsAsSvg(evil), false);
    assert.ok(performance.now() - t < 500, 'no backtracking');
  }
});
