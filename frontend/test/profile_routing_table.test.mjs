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

test('esc round-trips every metacharacter shape the source can hold', async () => {
  // Asserting BEHAVIOUR, not the text of the helper. The first version of this
  // guard matched a regex against a regex literal — four levels of escaping,
  // and it had stopped asserting what I meant. The second matched substrings,
  // which broke the moment the helper legitimately changed. Cases do neither.
  const { esc } = await import('../../scripts/build-profile-routing.mjs');
  const cases = [
    ['a|b',    'a\\|b', 'a bare pipe is escaped once'],
    ['a\\|b',   'a\\|b', "the source's own escape is normalised, not doubled"],
    ['a\\\\|b',  'a\\\\\\|b', 'a real backslash before a pipe keeps both, each escaped'],
    ['a\\b',    'a\\\\b', 'a lone backslash is escaped rather than handed over bare'],
    ['plain',  'plain', 'text with no metacharacter is untouched'],
  ];
  for (const [input, want, why] of cases) {
    assert.equal(esc(input), want, `${why} — esc(${JSON.stringify(input)})`);
  }
  // Idempotence is the property that makes the order right: running it on its
  // own output must not keep adding backslashes.
  assert.equal(esc(esc('a|b')), esc('a|b'), 'esc is not idempotent — escaping compounds');
});

test('no escaped output can end a table row early', () => {
  // The failure mode in one sentence: `\\|` reads as escaped-backslash plus a
  // LIVE separator. Whatever esc emits, it must never produce that shape.
  const doc = readFileSync(resolve(process.cwd(), DOC), 'utf8');
  for (const row of doc.split('\n').filter((l) => l.startsWith('|'))) {
    assert.doesNotMatch(row, /(?<!\\)\\\\\|/,
      `row ends early on an escaped backslash + pipe:\n  ${row.slice(0, 120)}`);
  }
});
