/**
 * D5070 (#5070) — no founder-facing Raise surface renders a raw error.
 * Every catch in these folders shows `userFacingRaiseError(...)`, never `e.message`/`e.detail`/`e.data.message`.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_no_raw_error_5070.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['pages/raise/caprel', 'pages/raise/narrative', 'pages/raise/dataroom', 'pages/raise/captable', 'pages/raise/useoffunds', 'pages/raise/pitch', 'pages/cycles/evidence'];
const TOP = ['pages/raise/AdvisorGrantSection.jsx', 'pages/raise/RoundClosesPanel.jsx', 'pages/raise/SupportReadsCard.jsx'];
const RAW = /\b(?:e|err|error)\??\.(?:message|detail)\b|\.data\??\.(?:message|detail)\b/;
// A line may read a raw field only to test it with `isSentence` first (the Worker-refusal contract).
const ALLOWED = new Map([['pages/raise/dataroom/accessModel.js', /isSentence|raw = String/]]);

const walk = (d) => readdirSync(join('frontend/src', d)).flatMap((f) => {
  const rel = `${d}/${f}`;
  return statSync(join('frontend/src', rel)).isDirectory() ? walk(rel) : /\.(jsx?|mjs)$/.test(f) ? [rel] : [];
});

test('no Raise surface reads e.message / e.detail / e.data.message directly', () => {
  const files = [...DIRS.flatMap(walk), ...TOP];
  assert.ok(files.length > 60, `read ${files.length} files`);
  const hits = [];
  for (const rel of files) {
    readFileSync(join('frontend/src', rel), 'utf8').split('\n').forEach((line, i) => {
      if (!RAW.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      const ok = ALLOWED.get(rel);
      if (ok && ok.test(line)) return;
      hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], `raw error text reaches the page:\n${hits.join('\n')}`);
});
