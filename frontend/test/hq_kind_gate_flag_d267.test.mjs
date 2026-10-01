/**
 * D267 — what HQ's content lane draws when the kind gate has failed.
 *
 * The Worker flags a row with the rule `recordEscalation` applies, against the
 * row's own kind (cloudflare-worker/test/escalation_gate_flag_d267.test.ts).
 * This file holds what the page does with that flag:
 *
 *   - a flagged row says, on the row, what it means;
 *   - any other row draws nothing — including a row whose licence kind is
 *     unknown, which is not a failed gate, and a row that was not checked;
 *   - a lane whose rows could not be checked says so ONCE, never per row;
 *   - the scope note says the lane checks, rather than "no white-label
 *     submission can reach this lane", which nothing checked.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_kind_gate_flag_d267.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { KindGateFailedRow, KindsUncheckedNote } from '../src/pages/hq/ContentPage.jsx';

const PAGE = readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/ContentPage.jsx'), 'utf8');
const CODE = codeOnly(PAGE);
const row = (item) => renderToStaticMarkup(createElement(KindGateFailedRow, { item }));
const note = (lane, count) => renderToStaticMarkup(createElement(KindsUncheckedNote, { lane, count }));

const BASE = { uid: 'esc_1', branch_code: 'lyon', kind: 'content', subject: 'Rebranded pitch template' };

test('D267: a flagged row says on the row that the gate failed, and what that can mean', () => {
  const html = row({ ...BASE, licence_kind: 'white_label', kind_gate_failed: true });
  assert.match(html, /data-testid="hq-localisation-gate-failed"/);
  const text = renderedText(html);
  assert.match(text, /Kind gate failed/);
  assert.match(text, /lyon runs a white-label licence, which cannot raise content/);
  assert.match(text, /HQ should have refused this before recording it/);
  assert.match(text, /A gate regression, a row inserted by hand, or a row older than D206\./);
});

test('D267: every row that is not flagged draws nothing — a subsidiary, an unknown kind, an unchecked row', () => {
  for (const [what, item] of [
    ['a subsidiary row', { ...BASE, branch_code: 'fr', licence_kind: 'subsidiary', kind_gate_failed: false }],
    // THE MUTATION THIS EXISTS FOR: flagging on "not a subsidiary" would flag
    // every orphan, whose kind nobody knows.
    ['an orphan row (kind unknown)', { ...BASE, branch_code: 'nice', licence_kind: null, kind_gate_failed: false }],
    ['a row not checked', { ...BASE, licence_kind: null, kind_gate_failed: null }],
    ['a white-label moderation row', { ...BASE, kind: 'moderation', licence_kind: 'white_label', kind_gate_failed: false }],
    ['a row from a build with no flag', { ...BASE }],
  ]) {
    assert.equal(row(item), '', `${what} drew a gate-failed line`);
  }
  assert.equal(row(null), '');
});

test('D267: a lane whose kinds could not be read says "not checked" once, with the server\'s reason', () => {
  const lane = {
    available: true,
    licence_kinds_available: false,
    licence_kinds_reason: 'The licence ledger could not be read on this database (migrations 258 and 279), so no row here was checked against the kind of licence its branch runs under.',
  };
  const html = note(lane, 3);
  assert.match(html, /data-testid="hq-localisation-kinds-unchecked"/);
  assert.equal((html.match(/data-testid=/g) || []).length, 1);
  const text = renderedText(html);
  assert.match(text, /^Not checked against the kind gate\./);
  assert.match(text, /no row here was checked/);

  // Nothing to say when the kinds were read, when the build sends no verdict,
  // or when there is no row to check.
  assert.equal(note({ ...lane, licence_kinds_available: true }, 3), '');
  assert.equal(note({ available: true }, 3), '');
  assert.equal(note(lane, 0), '');
});

test('D267: the lane mounts the flag on every row and the "not checked" sentence once, outside the rows', () => {
  const lane = CODE.indexOf('data-testid="hq-localisation-lane"');
  const laneEnd = CODE.indexOf('</ul>', lane);
  assert.ok(lane > 0 && laneEnd > lane, 'the lane list moved');
  assert.match(CODE.slice(lane, laneEnd), /<KindGateFailedRow item=\{it\} \/>/, 'a lane row does not carry the flag');
  const mounts = [...CODE.matchAll(/<KindsUncheckedNote\b/g)];
  assert.equal(mounts.length, 1, 'the "not checked" sentence is mounted more than once');
  assert.ok(mounts[0].index < lane, 'the "not checked" sentence sits inside the rows, which makes it a per-row absence');
  // The flag is the SERVER's: the component reads `kind_gate_failed`, never a
  // licence kind of its own choosing.
  const at = CODE.indexOf('export function KindGateFailedRow');
  const body = CODE.slice(at, CODE.indexOf('\nexport function', at + 1));
  assert.match(body, /item\.kind_gate_failed !== true/);
  assert.doesNotMatch(body, /licence_kind\s*[!=]==?\s*'/, 'the page decides the gate from the licence kind itself');
});

test('D267: the scope note says the lane checks each row, and no longer that nothing can reach it', () => {
  const at = PAGE.indexOf('data-testid="hq-brand-desk-scope"');
  assert.ok(at > 0);
  const scope = PAGE.slice(at, PAGE.indexOf('</p>', at)).replace(/\s+/g, ' ');
  assert.match(scope, /each row is checked against the kind of licence its branch runs under/);
  assert.match(scope, /marked on the row rather than hidden/);
  assert.doesNotMatch(scope, /no white-label submission can reach this lane/,
    'the note still claims what nothing checked');
});
