/**
 * D431 — the settings page draws carry only where the server served it, and
 * draws the lock where it did not.
 *
 * The worker half (cloudflare-worker/test/carry_bps_gate_d431.test.ts) proves
 * the field is absent for a refused reader. This half holds the page to
 * branching on that absence: an editor gets the input, the member gets their
 * own figure read-only, everyone else gets a locked chip — visible as locked,
 * in canvas T4's words, because a hidden section teaches the wrong shape of
 * the org. Before D431 the input was drawn on every row for every viewer,
 * disabled for non-editors but showing the value.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/carry_gate_d431.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE_RAW = read('frontend/src/pages/CompanySettingsPage.jsx');
const PAGE = codeOnly(PAGE_RAW);
const CANVAS = read('design/canvases/backlog/Team · Authority.dc.html');

/** The members row, bounded at both ends. */
function memberRow() {
  const a = PAGE.indexOf('{members.map((m) => {');
  assert.ok(a >= 0, 'the members map is gone');
  const b = PAGE.indexOf('Make primary', a);
  assert.ok(b > a, 'the row no longer ends at the Make primary control');
  return PAGE.slice(a, b);
}

test('D431: the row branches on whether carry_bps ARRIVED, not on its value', () => {
  const row = memberRow();
  assert.match(row, /!Object\.prototype\.hasOwnProperty\.call\(m, 'carry_bps'\) \? \(/,
    'the row does not test for the field’s presence — null and absent must draw differently');
  // The three outcomes, in order: locked, input, read-only.
  const lock = row.indexOf('data-testid="carry-locked"');
  const input = row.indexOf('placeholder="carry bps"');
  const ro = row.indexOf('data-testid="carry-readonly"');
  assert.ok(lock > 0 && input > lock && ro > input, 'the lock, the input and the read-only figure are not the three arms of the branch');
  assert.match(row, /\) : canChange \? \(\s*<input/, 'the input is not gated on canChange');
  // The input no longer needs `disabled={busy || !canChange}`: a non-editor
  // never reaches it.
  const inputBlock = row.slice(input, ro);
  assert.match(inputBlock, /disabled=\{busy\}/, 'the input is still drawn for a non-editor and merely disabled');
});

test('D431: the lock says who can see through it, in the canvas’s words', () => {
  const phrase = 'You see that carry exists and not what it is';
  assert.ok(CANVAS.includes(phrase), 'canvas T4 no longer carries the sentence the page quotes');
  assert.match(PAGE, new RegExp(`const CARRY_LOCKED_NOTE = '[^']*${phrase}[^']*';`), 'the lock note is not the canvas’s sentence');
  assert.match(PAGE, /const CARRY_LOCKED_LABEL = 'Economics · locked';/);
  const row = memberRow();
  assert.match(row, /title=\{CARRY_LOCKED_NOTE\}/, 'the lock does not explain itself');
  assert.match(row, /\{CARRY_LOCKED_LABEL\}/);
  assert.match(row, /<Lock size=\{11\} aria-hidden="true" \/>/, 'the lock has no lock');
  assert.match(PAGE, /import \{ Lock \} from 'lucide-react';/);
  // T4's wording: visible as a locked section, not hidden.
  assert.ok(CANVAS.includes('visible as a locked section'), 'canvas T4 changed its mind about hiding versus locking');
});

test('D431: the member’s own figure reads as a value, and null reads as not recorded — never as a lock', () => {
  const row = memberRow();
  const ro = row.slice(row.indexOf('data-testid="carry-readonly"'));
  assert.match(ro, /Carry \{m\.carry_bps === null \|\| m\.carry_bps === undefined \? '— not recorded' : bpsPercent\(m\.carry_bps\)\}/,
    'the read-only figure does not distinguish not-recorded from a value, or does not use the one bps formatter');
  assert.doesNotMatch(ro, /carry-locked/, 'the read-only arm draws the lock');
});

test('D431: the rights the page draws from are the server’s (EDIT_ROLES), and the server gate is the same rule', () => {
  assert.match(PAGE, /const EDIT_ROLES = \['Owner', 'Admin', 'Founder'\];/);
  const route = codeOnly(read('cloudflare-worker/src/routes/company.ts'));
  assert.match(route, /\['Owner', 'Admin', 'Founder'\]\.includes\(link\.role_in_company\)/, 'canEdit’s role list moved');
  assert.match(route, /const editor = await canEdit\(env, c, viewer\);/, 'the server’s read gate is not canEdit');
  // The note names the same three roles, so the page cannot promise a wider
  // audience than the server serves.
  assert.match(PAGE_RAW, /CARRY_LOCKED_NOTE = 'Visible to the member and to an Owner, Admin or Founder only\./);
});
