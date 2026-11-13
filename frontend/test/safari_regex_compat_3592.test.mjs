// #3592: the old expressions are test-only oracles; nothing here enters the SPA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimSegments, FOUNDERS_FIGURE } from '../src/pages/raise/narrative/storyModel.js';
import { defaultDescription } from '../src/pages/raise/pitch/imageModel.js';

const LEGACY_NUMBER = /(?<![A-Za-z0-9])(?:[$€£]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|bn\b|k\b|K\b|m\b|M\b|x\b))?(?![A-Za-z0-9])/g;
const NUMBER_CASES = [
  ['', []],
  ['No figures', []],
  ['42', [[0, '42']]],
  ['$1.5M', [[0, '$1.5M']]],
  ['€ 1,234.50 and £2bn', [[0, '€ 1,234.50'], [15, '£2bn']]],
  ['1 2 3', [[0, '1'], [2, '2'], [4, '3']]],
  ['1,2;3/4', [[0, '1'], [2, '2'], [4, '3'], [6, '4']]],
  ['1%2% 3x4', [[0, '1'], [2, '2%']]],
  ['B2B Q3 v2 10abc abc10', []],
  ['A$1 1$2 1 $2$3', [[2, '1'], [4, '1'], [6, '2'], [8, '1'], [10, '$2'], [13, '3']]],
  ['1.2.3 1,234,567 12,34', [[0, '1.2'], [4, '3'], [6, '1,234,567'], [16, '12'], [19, '34']]],
  ['🚀42\n(7)\t8\u00a09', [[2, '42'], [6, '7'], [9, '8'], [11, '9']]],
  ['1 k 2 K 3 m 4 M 5 bn 6 x', [[0, '1 k'], [4, '2 K'], [8, '3 m'], [12, '4 M'], [16, '5 bn'], [21, '6 x']]],
  ['20% 1.5 k 7.2bn', [[0, '20%'], [4, '1.5 k'], [10, '7.2bn']]],
  ['B2 2B B2B Q3 2 3Q', [[13, '2']]],
  ['1000 999,999 1,234.56%', [[0, '1000'], [5, '999,999'], [13, '1,234.56%']]],
];
function expectedSegments(text, matches) {
  const parts = []; let end = 0;
  for (const [index, value] of matches) {
    if (index > end) parts.push({ text: text.slice(end, index), claim: false });
    parts.push({ text: value, claim: true, state: FOUNDERS_FIGURE });
    end = index + value.length;
  }
  if (end < text.length) parts.push({ text: text.slice(end), claim: false });
  return parts;
}
test('typed-number matches, positions and intervening text stay identical to the old expression', () => {
  for (const [text, matches] of NUMBER_CASES) {
    assert.deepEqual(Array.from(text.matchAll(LEGACY_NUMBER), m => [m.index, m[0]]), matches, `legacy: ${text}`);
    assert.deepEqual(claimSegments(text), expectedSegments(text, matches), text);
  }
  // Adjacent boundaries exercise global-regex progress and backtracking together.
  const atoms = ['1', '$2', '3%', '4.5', '6k', '7bn', 'B2B', 'Q3'];
  for (const left of atoms) for (const right of atoms) for (const gap of ['', ' ', ',', '.', '%', '\n']) {
    const text = `${left}${gap}${right}`;
    const matches = Array.from(text.matchAll(LEGACY_NUMBER), m => [m.index, m[0]]);
    assert.deepEqual(claimSegments(text), expectedSegments(text, matches), text);
  }
});

const card = (heading, paragraph) => ({ blocks: [{ kind: 'text', style: 'heading', text: heading }, { kind: 'text', text: paragraph }] });
const DESCRIPTION_CASES = [
  [undefined, ''],
  [{ title: 'Team' }, 'Team'],
  [card('Calm', 'Stay focused. Move ahead! Plan carefully? Keep going.'), 'Calm. Stay focused. Move ahead. Plan carefully. Keep going'],
  [card('Raise $5M', 'Build with care. Teams save 12 hours. Keep control.'), 'Build with care. Keep control'],
  [card('Close the month', 'We cut 5.5 hours. Teams work calmly? Always. Still here!'), 'Close the month. Teams work calmly. Always. Still here'],
  [card('', 'No heading. Still a paragraph.'), 'No heading. Still a paragraph'],
  [card('Pause...', 'Work...   Rest!!\tGo??\nKeep.it together.'), 'Pause. Work. Rest. Go. Keep.it together'],
  [card(' Calm  ', '  First.\u00a0Second!\u2028Third?  '), 'Calm  . First. Second. Third'],
  [card('No split', 'Names.like.this stay; punctuation!without spaces stays?too.'), 'No split. Names.like.this stay; punctuation!without spaces stays?too'],
  [card('2026', 'Revenue $1M. 42 teams. Growth 6%.'), ''],
  [card('A'.repeat(405), ''), 'A'.repeat(400)],
];
function legacyDescription(value) {
  const blocks = Array.isArray(value?.blocks) ? value.blocks : [];
  const heading = blocks.find(b => b?.kind === 'text' && b.style === 'heading')?.text || value?.title || '';
  const paragraph = blocks.find(b => b?.kind === 'text' && b.style !== 'heading')?.text || '';
  return `${heading}. ${paragraph}`.split(/(?<=[.!?])\s+/).map(s => s.trim().replace(/[.!?]+$/, '')).filter(s => s && !/\d/.test(s)).join('. ').slice(0, 400);
}
test('image descriptions preserve sentence boundaries, figure exclusion and the length limit', () => {
  for (const [value, expected] of DESCRIPTION_CASES) {
    assert.equal(legacyDescription(value), expected, `legacy: ${JSON.stringify(value)}`);
    assert.equal(defaultDescription(value), expected, JSON.stringify(value));
  }
});

// Conservative source-text guard: catches literals and RegExp strings, even in
// lazy chunks. Examples and compatibility oracles belong in tests, not src.
const LOOKBEHIND_ALLOWLIST = new Set([]);
function lookbehinds(root, allowlist = LOOKBEHIND_ALLOWLIST) {
  const found = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const name = relative(root, path).split(sep).join('/');
        if (allowlist.has(name)) continue;
        readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
          if (line.includes('(?<=') || line.includes('(?<!')) found.push(`${name}:${i + 1}`);
        });
      }
    }
  }
  visit(root); return found;
}
test('the guard finds both kinds, nested lazy files and constructor strings, with exact-file exceptions', () => {
  const root = mkdtempSync(join(tmpdir(), 'studioos-lookbehind-'));
  try {
    mkdirSync(join(root, 'lazy'));
    writeFileSync(join(root, 'entry.js'), 'const number = /(?<!x)y/g;\n');
    writeFileSync(join(root, 'lazy', 'view.jsx'), 'export const sentence = /(?<=x)y/;\n');
    writeFileSync(join(root, 'lazy', 'constructor.ts'), '\nconst pattern = new RegExp("(?<=x)y");\n');
    writeFileSync(join(root, 'safe.js'), 'const next = /x(?=y)/; const other = /x(?!y)/;\n');
    assert.deepEqual(lookbehinds(root), ['entry.js:1', 'lazy/constructor.ts:2', 'lazy/view.jsx:1']);
    assert.deepEqual(lookbehinds(root, new Set(['entry.js'])), ['lazy/constructor.ts:2', 'lazy/view.jsx:1']);
    rmSync(join(root, 'entry.js')); rmSync(join(root, 'lazy'), { recursive: true });
    assert.deepEqual(lookbehinds(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('frontend/src has no regex lookbehind; the allowlist starts empty', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  assert.deepEqual(lookbehinds(root), [], 'Lookbehind cannot parse in Safari/iOS before 16.4. Rewrite it without a lookbehind.');
});
