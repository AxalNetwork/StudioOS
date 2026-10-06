/**
 * D565 (#1169) — the Advisor Program came into scope on #975, so its canvas,
 * its ROUTE_MAP row and the folder counts must all say so together.
 *
 * "If you move a file, move the number" (design/incoming/README.md) has been
 * broken three times by hand; this reads the folders rather than trusting the
 * prose, so a count that does not follow its file fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const count = (dir) => readdirSync(resolve(ROOT, 'design/canvases', dir)).filter((f) => f.endsWith('.dc.html')).length;

test('the Advisor Studio canvas is in backlog/, its row is NEW and names D565, and the design exists', () => {
  assert.ok(existsSync(resolve(ROOT, 'design/canvases/backlog/Advisor Studio.dc.html')), 'the canvas is in backlog/');
  assert.ok(!existsSync(resolve(ROOT, 'design/canvases/out-of-scope/Advisor Studio.dc.html')), 'and no longer in out-of-scope/');
  const row = read('documentation/architecture/ROUTE_MAP.md').split('\n').find((l) => l.startsWith('| Advisor Studio |'));
  assert.ok(row, 'ROUTE_MAP has the Advisor Studio row');
  assert.equal(row.split('|')[6].trim(), 'NEW', 'graded as backlog/ holds it');
  assert.match(row, /D565/);
  const d = read('documentation/architecture/decisions/D565.md');
  assert.match(d, /^## D565 — /);
  for (const q of ['**A. ', '**B. ', '**C. ', '**D. ', '**E. ', '**F. ']) assert.ok(d.includes(q), `D565 asks question ${q}`);
});

test('both READMEs state the folder counts the folders hold', () => {
  const backlog = count('backlog');
  const out = count('out-of-scope');
  const canvases = read('design/canvases/README.md');
  assert.ok(canvases.includes(`| \`backlog/\` | ${backlog} |`), `design/canvases/README.md says backlog/ holds ${backlog}`);
  assert.ok(canvases.includes(`| \`out-of-scope/\` | ${out} |`), `design/canvases/README.md says out-of-scope/ holds ${out}`);
  const incoming = read('design/incoming/README.md');
  assert.ok(incoming.includes(`| \`canvases/backlog/\` | ${backlog} — `), `design/incoming/README.md says backlog/ holds ${backlog}`);
  assert.ok(incoming.includes(`| \`canvases/out-of-scope/\` | ${out} — `), `design/incoming/README.md says out-of-scope/ holds ${out}`);
});
