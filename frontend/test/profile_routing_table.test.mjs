/**
 * The generated PROFILE_ROUTING table must actually be a table.
 *
 * `scripts/build-profile-routing.mjs` reads ROUTE_MAP.md — itself a markdown
 * table — and re-emits cells into a new one. Its cells therefore arrive with
 * pipes the author already escaped by hand (`screening\|commit\|transactions`),
 * and escaping those a second time produced `\\|`. GFM reads `\\` as an
 * escaped backslash and then treats the pipe as a REAL column separator, so
 * four rows of the shipped document silently split into 11-13 cells against a
 * 9-cell header. Nothing failed; the page just rendered wrong.
 *
 * `--check` cannot catch this: it only asks whether the file matches what the
 * generator would produce right now, so a generator that emits a broken table
 * consistently passes. This asks the different question — is the output
 * well-formed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOC = 'documentation/architecture/PROFILE_ROUTING.md';

/** Split a GFM table row: a pipe preceded by a backslash is content, not a cell edge. */
function cells(row) {
  const out = [];
  let cur = '';
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === '\\' && i + 1 < row.length) { cur += row.slice(i, i + 2); i += 1; continue; }
    if (row[i] === '|') { out.push(cur); cur = ''; continue; }
    cur += row[i];
  }
  out.push(cur);
  return out;
}

const isDivider = (l) => /^\|[\s|:-]+\|$/.test(l);

test('every generated table row has its header’s column count', () => {
  const lines = readFileSync(resolve(process.cwd(), DOC), 'utf8').split('\n');
  const bad = [];
  let header = null;
  let rows = 0;
  lines.forEach((line, i) => {
    if (!line.startsWith('|')) { header = null; return; }
    const n = cells(line).length;
    if (header === null) { header = n; return; }
    if (isDivider(line)) return;
    rows += 1;
    if (n !== header) bad.push(`${DOC}:${i + 1} — ${n} cells, header has ${header}`);
  });
  assert.ok(rows > 50, `only parsed ${rows} rows — the document shape changed`);
  assert.deepEqual(bad, [],
    `rows split on an unescaped pipe:\n  ${bad.join('\n  ')}`);
});

test('no cell double-escapes a pipe', () => {
  // `\\|` is the exact shape that breaks a row: escaped backslash, then a live
  // separator. `\|` (one backslash) is the correct escape and stays.
  const doc = readFileSync(resolve(process.cwd(), DOC), 'utf8');
  const hits = [...doc.matchAll(/\\\\+\|/g)].map((m) => m[0]);
  assert.deepEqual(hits, [],
    `${hits.length} double-escaped pipe(s) — each one ends its row early`);
});

test('the generator normalises before it escapes', () => {
  // Escaping the backslashes instead (Copilot Autofix #444) restores the column
  // count but leaves `screening\|commit` visible to the reader. Normalising an
  // already-escaped pipe back to a bare one, then escaping once, is idempotent
  // and renders a plain `|`.
  const src = readFileSync(resolve(process.cwd(), 'scripts/build-profile-routing.mjs'), 'utf8');
  const line = src.split('\n').find((l) => l.startsWith('const esc ='));
  assert.ok(line, 'the esc helper moved');
  // Asserted as substrings: a regex that matches a regex literal needs four
  // levels of escaping and stops being readable, which is how a guard ends up
  // asserting something other than what its author meant.
  const normalises = line.indexOf("replace(/\\\\\\|/g, '|')");
  const escapes = line.indexOf("replace(/\\|/g, '\\\\|')");
  assert.ok(normalises !== -1, 'esc no longer normalises an already-escaped pipe first');
  assert.ok(escapes !== -1, 'esc no longer escapes pipes');
  assert.ok(normalises < escapes, 'esc escapes before it normalises — order is the whole fix');
});
