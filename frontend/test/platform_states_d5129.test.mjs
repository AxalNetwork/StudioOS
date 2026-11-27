/**
 * D5129 (#5129) — the platform data states: DataState, StateChip,
 * PartialBanner, ProvenanceLine and stateFromRead (board ST-13 of
 * `design/incoming/Platform States Page.dc.html`), and the two old names,
 * Unrecorded and Unreadable, as aliases that draw the new treatment.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_states_d5129.test.mjs
 *
 * MUTATIONS CHECKED (each made by hand in the source, each turned this file red, each reverted):
 *   1. dataState.js: a ready read's `0` mapped as absent (`absent` also true for 0) → "a measured 0 is a Value" fails.
 *   2. dataState.js: `isRefusal` always false (403 read as a failed read) → the Refused mapping fails.
 *   3. dataState.js: a partial read's null field mapped to not_recorded → the partial mapping fails.
 *   4. dataState.js: `ready` with an empty list mapped to value → the None mapping fails.
 *   5. Honesty.jsx: Unavailable's role set to "alert" on first load → the ST-09 announcement test fails.
 *   6. Honesty.jsx: the refused chip's border made dashed like Unavailable → the no-colour-only test fails.
 *   7. dataState.js: STATE_WORDS.unavailable kept as "Unreadable" → the alias test fails.
 *   8. Honesty.jsx: a `dark:` pair dropped from one chip → the dark-mode pair test fails.
 *   9. Honesty.jsx: Retry drawn on Refused → the Refused test fails.
 * Fixtures are invented: no real fund, company or person.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DataState, StateChip, PartialBanner, ProvenanceLine, Unrecorded, Unreadable, CHIP_CLASSES,
  stateFromRead, staleAge, normalizeState, STATE_WORDS, VALUE_STATES, MODIFIERS,
} from '../src/ui/Honesty.jsx';
import * as barrel from '../src/ui/index.js';

const html = (el) => renderToStaticMarkup(el);
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const SRC = readFileSync(resolve(process.cwd(), 'frontend/src/ui/Honesty.jsx'), 'utf8');
const NOW = Date.parse('2026-11-10T15:00:00Z');
const read = (over = {}) => ({
  status: 'ready', read_at: '2026-11-10 14:30:00', source_updated_at: '2026-11-10 09:12:00',
  complete: true, completeness_reason: null, source: 'Ledger', data: { committed: 120000, zero: 0, calls: [{ id: 1 }], empty: [], none: null }, ...over,
});

test('the vocabulary is six value states and three modifiers, with the decided words', () => {
  assert.deepEqual([...VALUE_STATES], ['value', 'none', 'not_recorded', 'not_applicable', 'unavailable', 'refused']);
  assert.deepEqual([...MODIFIERS], ['stale', 'partial', 'provisional']);
  assert.equal(STATE_WORDS.unavailable, 'Unavailable', 'Q2 = A: the screen says Unavailable');
  assert.equal(STATE_WORDS.not_recorded, 'Not recorded');
  assert.equal(normalizeState('unreadable'), 'unavailable', 'unreadable stays the code name for the same state');
  assert.equal(normalizeState('unrecorded'), 'not_recorded');
  assert.equal(normalizeState('nonsense'), null);
});

test('stateFromRead maps each OperationalRead status', () => {
  const r = read();
  assert.equal(stateFromRead(r, 'committed').state, 'value');
  const zero = stateFromRead(r, 'zero');
  assert.equal(zero.state, 'value', 'a measured 0 is a Value');
  assert.equal(zero.value, 0);
  assert.equal(stateFromRead(r, 'calls').state, 'value');
  assert.equal(stateFromRead(r, 'empty').state, 'none', 'ready + empty list is None');
  assert.equal(stateFromRead(r, 'none').state, 'not_recorded', 'ready + null field is Not recorded');
  assert.equal(stateFromRead(r, 'missing.deep').state, 'not_recorded');
  assert.equal(stateFromRead(r, 'none', { notRecordedReason: 'Set on the Round tab' }).reason, 'Set on the Round tab');
  assert.equal(stateFromRead(r, 'committed').sourceTime, 'recorded');
  assert.equal(stateFromRead(read({ source_updated_at: null }), 'committed').sourceTime, 'not_recorded');

  const un = stateFromRead(read({ status: 'unavailable', data: null, completeness_reason: 'Ledger did not answer.' }), 'committed');
  assert.equal(un.state, 'unavailable');
  assert.equal(un.reason, 'Ledger did not answer.');
  assert.equal(stateFromRead(read({ status: 'unavailable', data: null }), 'x').reason, 'This source could not be read.');

  const part = read({ status: 'partial', complete: false, completeness_reason: 'Health could not be read.' });
  const pv = stateFromRead(part, 'committed');
  assert.equal(pv.state, 'value');
  assert.equal(pv.partial, true);
  assert.equal(pv.partialReason, 'Health could not be read.');
  assert.equal(stateFromRead(part, 'none').state, 'unavailable', 'a gap in a partial read is not a record of nothing');
  assert.equal(stateFromRead(part, 'empty').state, 'unavailable', 'an empty list in a partial read is not None');
  assert.equal(stateFromRead(r, 'committed').partial, false);

  assert.equal(stateFromRead(null, 'x', { error: { status: 403 } }).state, 'refused');
  assert.equal(stateFromRead(null, 'x', { error: { status: 404 } }).state, 'refused');
  assert.equal(stateFromRead(null, 'x', { error: { status: 500 } }).state, 'unavailable');
  assert.equal(stateFromRead(null, 'x', { error: new Error('network') }).state, 'unavailable');
  assert.equal(stateFromRead({ data: { x: 1 } }, 'x').state, 'unavailable', 'a body outside the contract is not evidence');
  assert.equal(stateFromRead(read({ data: null }), 'x').state, 'unavailable', 'ready with no data breaks the contract');
});

test('Stale only where a last-good time exists, and always with an age', () => {
  const r = read();
  assert.equal(stateFromRead(r, 'committed').stale, null, 'no last-good time, no Stale');
  const old = stateFromRead(r, 'committed', { lastGood: '2026-03-31 00:00:00', staleAfterMs: 30 * 86400000, now: NOW });
  assert.deepEqual(old.stale, { age: '7 months old', lastGood: '2026-03-31 00:00:00' });
  assert.equal(stateFromRead(r, 'committed', { lastGood: '2026-11-09 00:00:00', staleAfterMs: 30 * 86400000, now: NOW }).stale, null);
  assert.equal(staleAge('not a time', NOW), null);
  assert.equal(staleAge(NOW - 3 * 86400000, NOW), '3 days old');
  assert.equal(staleAge(NOW - 3600000, NOW), '1 hour old');
  assert.match(html(h(StateChip, { kind: 'stale', age: '7 months old' })), /Stale · 7 months old/);
  assert.match(html(h(StateChip, { kind: 'stale' })), /Stale · age not recorded/, 'never a guessed age');
  assert.match(html(h(StateChip, { kind: 'stale', lastGood: '2026-03-31 00:00:00', now: NOW })), /Stale · 7 months old/);
});

test('every state and modifier is told apart without colour: glyph, border and word', () => {
  const kinds = ['not_recorded', 'not_applicable', 'unavailable', 'refused', 'stale', 'partial', 'provisional'];
  const sig = kinds.map((k) => {
    const out = html(h(StateChip, { kind: k }));
    const glyph = (out.match(/<svg[\s\S]*?<\/svg>/) || ['none'])[0];
    const border = (CHIP_CLASSES[k].match(/border-(dotted|dashed)/) || ['solid'])[0]
      + (/border-transparent/.test(CHIP_CLASSES[k]) ? ':none' : '');
    const word = text(out);
    assert.ok(word.length > 0, `${k} has a word`);
    return { k, glyph, border, word };
  });
  for (const field of ['glyph', 'word']) {
    const seen = new Set(sig.map((s) => s[field]));
    assert.equal(seen.size, kinds.length, `each kind has its own ${field}`);
  }
  // Two shapes may share a border style only if their glyphs differ — still checked
  // pairwise, so no two kinds share both glyph and border.
  const pairs = new Set(sig.map((s) => `${s.glyph}|${s.border}`));
  assert.equal(pairs.size, kinds.length);
  // Unavailable and Refused, the two that are most often confused, differ in border style too.
  assert.notEqual(sig.find((s) => s.k === 'unavailable').border, sig.find((s) => s.k === 'refused').border);
  assert.notEqual(sig.find((s) => s.k === 'not_recorded').border, sig.find((s) => s.k === 'unavailable').border);
  // Glyphs are decoration; the word is the accessible name.
  assert.match(html(h(StateChip, { kind: 'refused' })), /<svg aria-hidden="true"/);
});

test('Value: a measured 0 is drawn in ink, with nothing beside it', () => {
  const out = html(h(DataState, { state: 'value' }, '0'));
  assert.equal(text(out), '0');
  assert.match(out, /text-gray-900/);
  assert.doesNotMatch(out, /Not recorded|Unavailable/);
  const stale = html(h(DataState, { state: 'value', stale: { age: '7 months old', lastGood: '2026-03-31' }, provisional: true }, '€1.50m'));
  assert.match(text(stale), /^€1\.50m Stale · 7 months old Modelled$/, 'Value, then Stale, then Provisional');
});

test('None names the thing, never "No data"', () => {
  assert.equal(text(html(h(DataState, { state: 'none' }, 'No open capital calls.'))), 'No open capital calls.');
  assert.equal(text(html(h(DataState, { state: 'none', what: 'Open calls' }))), 'No open calls.');
  assert.doesNotMatch(html(h(DataState, { state: 'none', what: 'Open calls' })), /No data|>0</);
});

test('Not recorded and Not applicable carry their reason as visible text, not a hover', () => {
  const out = html(h(DataState, { state: 'not_recorded', reason: 'Set on the Round tab' }));
  assert.equal(text(out), 'Not recorded · Set on the Round tab');
  assert.doesNotMatch(out, /title=/, 'no hover-only reason');
  assert.match(out, /border-dotted/);
  const na = html(h(DataState, { state: 'not_applicable', reason: 'Grants have no committed capital' }));
  assert.equal(text(na), 'Not applicable · Grants have no committed capital');
  assert.doesNotMatch(na, /border-dotted|border-dashed/);
  assert.match(html(h(DataState, { state: 'not_recorded', size: 'tile' })), /aria-hidden="true"[^>]*>—</, 'the dash is decoration beside the word');
});

test('Unavailable: the word, what failed, the claim, Retry, and no alert on first load', () => {
  const out = html(h(DataState, { state: 'unavailable', what: 'Payments', claim: 'This is not a claim that none exist.', onRetry: () => {} }));
  assert.equal(text(out), 'Unavailable Payments could not be read. This is not a claim that none exist. Retry');
  assert.doesNotMatch(out, /role="alert"/, 'a page of failures does not shout on first load (ST-09)');
  assert.match(out, /min-h-\[44px\]/, 'Retry is a 44px target');
  assert.doesNotMatch(out, />0</);
  assert.doesNotMatch(text(html(h(DataState, { state: 'unavailable', what: 'Payments' }))), /Retry/, 'Retry only when retrying can help');
  const block = html(h(DataState, { state: 'unavailable', size: 'block', what: 'Capital calls', claim: 'This is not a claim that there are none.' }));
  assert.match(block, /border-dashed/);
  assert.match(text(block), /Capital calls could not be read\. This is not a claim that there are none\./);
  assert.match(text(html(h(DataState, { state: 'unavailable', size: 'tile', what: 'Commitments' }))), /Unavailable Commitments could not be read\./);
  assert.match(text(html(h(DataState, { state: 'unavailable' }))), /This source could not be read\./, 'never an empty failure');
});

test('Refused is an answer: its claim and access route, never Retry', () => {
  const out = html(h(DataState, {
    state: 'refused', what: 'this round', onRetry: () => {}, accessRoute: h('a', { href: '#share' }, 'Ask the founder to share'),
  }));
  assert.match(text(out), /^Refused Nothing of this round is shown here, because the read was refused\. The read was refused\. That is not a claim that nothing is recorded\. Ask the founder to share$/);
  assert.doesNotMatch(out, /Retry/);
  const block = html(h(DataState, { state: 'refused', size: 'block', claim: 'That is not a claim that nothing is recorded.' }));
  assert.match(text(block), /^Refused\. That is not a claim that nothing is recorded\.$/);
});

test('Provisional is one shape: dashed, ◇, the word Modelled or the surface word', () => {
  assert.equal(text(html(h(StateChip, { kind: 'provisional' }))), 'Modelled');
  assert.equal(text(html(h(StateChip, { kind: 'provisional', label: 'Provisional' }))), 'Provisional');
  assert.match(CHIP_CLASSES.provisional, /border-dashed/);
  assert.match(CHIP_CLASSES.provisional, /italic/);
});

test('PartialBanner: one banner, the count, the names, Retry only for a failed read', () => {
  const out = html(h(PartialBanner, { of: 4, sources: [{ name: 'Health', state: 'unavailable' }], onRetry: () => {} }));
  assert.match(out, /role="status"/);
  assert.equal(text(out), 'Partial: 1 of 4 sources unavailable · Health. The rest is current. Retry');
  const refused = html(h(PartialBanner, { of: 4, sources: [{ name: 'Founder notes', state: 'refused' }], onRetry: () => {} }));
  assert.match(text(refused), /1 of 4 sources refused · Founder notes\./);
  assert.doesNotMatch(refused, /Retry/, 'a refusal is not retried');
  const withheld = html(h(PartialBanner, {
    of: 4, sources: [{ name: 'Commitments', state: 'unreadable' }], rest: 'Positions, distributions and NAV are current.',
    withheld: ['Remaining is not shown while commitments cannot be read.'],
  }));
  assert.match(text(withheld), /1 of 4 sources unavailable · Commitments\. Positions, distributions and NAV are current\. Remaining is not shown while commitments cannot be read\./);
});

test('ProvenanceLine reads the OperationalReadMeta and never invents a time', () => {
  const meta = read();
  assert.equal(text(html(h(ProvenanceLine, { meta, now: NOW }))), 'Read 14:30 UTC · source last changed 09:12 UTC · from Ledger');
  assert.equal(text(html(h(ProvenanceLine, { meta: read({ source_updated_at: null }), now: NOW }))), 'Read 14:30 UTC · source time not recorded · from Ledger');
  assert.equal(
    text(html(h(ProvenanceLine, { meta: read({ status: 'unavailable', data: null }), now: NOW, onRetry: () => {} }))),
    'Tried 14:30 UTC · Unavailable · from Ledger Retry',
  );
  assert.match(text(html(h(ProvenanceLine, { meta, now: NOW, lastGood: '2026-03-31 00:00:00' }))), /Stale · 7 months old · last good 31 Mar 2026/);
  assert.match(text(html(h(ProvenanceLine, { meta, now: NOW, stale: true }))), /Stale · age not recorded · this store records no last-good time/);
  assert.match(
    text(html(h(ProvenanceLine, { meta: read({ status: 'partial', completeness_reason: '3 of 4 sources; Health could not be read.' }), now: NOW }))),
    /Partial · 3 of 4 sources; Health could not be read\. · from Ledger/,
  );
  assert.match(text(html(h(ProvenanceLine, { meta: read({ read_at: null }), now: NOW }))), /^Read time not recorded/);
});

test('Loading is a skeleton, never a word or a 0', () => {
  for (const size of ['inline', 'tile', 'block']) {
    const out = html(h(DataState, { state: 'loading', size }));
    assert.match(out, /aria-busy="true"/);
    assert.equal(text(out), '', `${size} skeleton draws no text`);
  }
});

test('the old names are aliases that draw the new treatment', () => {
  const un = html(h(Unreadable, { what: 'The ledger', claim: 'This is not a claim that none exist.', onRetry: () => {} }));
  assert.match(un, /^<p /, 'still a paragraph where it was one');
  assert.match(un, /data-platform-state="unavailable"/);
  assert.equal(text(un), 'Unavailable The ledger could not be read. This is not a claim that none exist. Retry');
  assert.doesNotMatch(text(un), /Unreadable/, 'the screen word is Unavailable (Q2 = A)');
  assert.match(un, /role="alert"/, 'the alias keeps the alert every shipped failed read had');
  assert.doesNotMatch(html(h(Unreadable, { what: 'The ledger', announce: 'after-action' })), /role="alert"/);
  // No glyph draws a <path>: pages check "no <p> inside a <p>" by reading markup as text.
  assert.doesNotMatch(un, /<p(?:ath|oly)/);
  const nr = html(h(Unrecorded, { reason: 'No store records this yet.' }));
  assert.match(nr, /data-platform-state="not_recorded"/);
  assert.match(nr, /border-dotted/, 'the alias draws the Not recorded chip');
  // The alias keeps the reason on its title (about 45 call sites already print it beside the chip);
  // `reasonVisible` draws it as text, as DataState does by default.
  assert.equal(text(nr), 'Not recorded');
  assert.match(nr, /title="No store records this yet\."/);
  assert.equal(text(html(h(Unrecorded, { reason: 'No store records this yet.', reasonVisible: true }))), 'Not recorded · No store records this yet.');
  assert.equal(text(html(h(Unrecorded, null, 'Not yet measured'))), 'Not yet measured');
  assert.equal(barrel.Unreadable, Unreadable);
  assert.equal(barrel.Unrecorded, Unrecorded);
  for (const name of ['DataState', 'StateChip', 'PartialBanner', 'ProvenanceLine', 'stateFromRead']) {
    assert.ok(barrel[name], `the ui barrel exports ${name}`);
  }
});

test('every colour in the primitive has its dark: pair', () => {
  const literals = [...SRC.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2]).filter((s) => /\b(text|bg|border)-/.test(s));
  const offenders = [];
  for (const lit of literals) {
    for (const prop of ['text', 'bg', 'border']) {
      const light = new RegExp(`(^|\\s)${prop}-(white|black|(gray|red|amber|violet|zinc)-\\d+)`);
      const dark = new RegExp(`dark:${prop}-`);
      if (light.test(lit) && !dark.test(lit)) offenders.push(`${prop}: ${lit}`);
    }
  }
  assert.deepEqual(offenders, []);
  for (const [k, cls] of Object.entries(CHIP_CLASSES)) {
    assert.match(cls, /dark:text-/, `${k} chip has a dark text colour`);
  }
});
