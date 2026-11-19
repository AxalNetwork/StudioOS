/**
 * Code Scanning (js/redos): `startsAsSvg` replaced a backtracking regular
 * expression in workGraphMedia.ts's sniffer. It answers as the old pattern did
 * on every head below, and a head of many unclosed comments is linear.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_svg_head_scan.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startsAsSvg } from '../src/services/workGraphMedia.ts';

// The pattern it replaced, kept here only as the oracle for ordinary heads.
const OLD = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^\[>]*(\[[\s\S]*?\])?\s*>\s*)?<svg[\s>]/i;

const HEADS = [
  '<svg xmlns="http://www.w3.org/2000/svg">', '<SVG>', '<svg\n width="1">',
  '<?xml version="1.0"?>\n<svg>', '<?xml version="1.0" encoding="utf-8"?><!-- made by hand --><svg>',
  '<!-- a --> <!-- b -->\n<svg>', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg>',
  '<!DOCTYPE svg [ <!ENTITY a "b"> ]>\n<svg>', '<?xml version="1.0"?><!-- c --><!DOCTYPE svg><svg>',
  '<svgx>', '<html><svg>', '<!-- unclosed <svg>', '<!DOCTYPE html><svg>', '<?xml?>', '', 'svg', '<!DOCTYPE svg [ <svg>',
];

test('startsAsSvg agrees with the pattern it replaced', () => {
  for (const head of HEADS) assert.equal(startsAsSvg(head), OLD.test(head), JSON.stringify(head));
});

test('a head of many unclosed comments is answered at once', () => {
  const evil = '<!--'.repeat(20000);
  const t = performance.now();
  assert.equal(startsAsSvg(evil), false);
  assert.ok(performance.now() - t < 200, 'linear in the head');
});
