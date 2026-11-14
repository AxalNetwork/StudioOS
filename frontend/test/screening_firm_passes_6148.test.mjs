/**
 * D6148 (#6148) — Pass reasons on Screening is the investor firm's own record,
 * and a pass with a date comes back in New for you on that date.
 *
 * The Worker side (scope, counts, the return's date) is proven in
 * cloudflare-worker/test/deal_flow_passes_6148.test.ts. This file holds the
 * words and the states: when a pass comes back, how a return is labelled,
 * that Next round is said to be undetected, and that no passes, no investor
 * licence and an unreadable read are three different sentences, none of them 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { NEXT_ROUND_LINE, dayWithYear, passReturnWord } from '../src/lib/dealFlow.js';
import { inboxActions, inboxChip, inboxIntro, inboxLine, nextRoundLine, unreadSources } from '../src/pages/investor/dealflow/movesModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = read('frontend/src/pages/investor/deals/ScreeningZone.jsx');
const Z = codeOnly(ZONE);
const PEEK = codeOnly(read('frontend/src/pages/investor/dealflow/PeekDrawer.jsx'));
const CARD = codeOnly(read('frontend/src/pages/investor/dealflow/FlowBoard.jsx'));
const NEW = codeOnly(read('frontend/src/pages/investor/dealflow/NewForYou.jsx'));
const API = read('frontend/src/lib/api/dealFlow.js');
const MODEL = read('frontend/src/pages/investor/dealflow/flowModel.js');

test('a pass says when it comes back: a date with its year, Next round, or nothing guessed', () => {
  assert.equal(passReturnWord({ revisit: 'date', revisit_at: '2027-03-12' }), 'Back on 12 Mar 2027');
  assert.equal(passReturnWord({ revisit: 'next_round', revisit_at: null }), 'Next round');
  assert.equal(passReturnWord({ revisit: 'date', revisit_at: 'soon' }), null, 'a malformed date was printed');
  assert.equal(passReturnWord({ revisit: null }), null);
  assert.equal(passReturnWord(null), null);
  assert.equal(dayWithYear('2026-11-14 09:30:00'), '14 Nov 2026');
  assert.equal(dayWithYear('2026-13-01'), null);
  assert.match(NEXT_ROUND_LINE, /not detected/);
});

test('a return in New for you is labelled as one, moves back to Screening, and never offers Add or Pass', () => {
  const item = { key: 'revisit:7:20270312', source: 'revisit', entered_via: 'invited', deal_id: 101, can_open: true,
    return: { reason: 'valuation', passed_at: '2026-11-01 10:00:00', revisit_at: '2027-03-12' } };
  assert.equal(inboxChip(item), 'Back from your pass');
  assert.equal(inboxLine(item), 'You passed on 1 Nov 2026 (Valuation) and asked to see it again on 12 Mar 2027.');
  assert.deepEqual(inboxActions(item), { add: false, pass: false, reopen: true, dismiss: true, open: true });
  assert.match(inboxIntro(2), /^2 new, newest first\. Ventures already in Mine are not listed\. A pass whose date to come back has arrived is the one exception\./);
  assert.deepEqual(unreadSources({ revisit: { unreadable: true } }), ['passes due back']);
  assert.match(nextRoundLine({ next_round: { detected: false, reason: 'Not detected here.' } }), /Not detected here\./);
  assert.equal(nextRoundLine({}), null);
  // The page's control is a move off Passed through the flow's own PATCH, and
  // the section prints the Next round sentence.
  assert.match(NEW, /a\.reopen && <button/);
  assert.match(NEW, /dealFlowApi\.update\(i\.deal_id, \{ stage: 'screening' \}\)/);
  assert.match(NEW, /data-testid="dealflow-new-next-round"/);
});

test('Screening reads the firm\'s passes through the one new method, and each reason opens its deals', () => {
  assert.match(API, /passes: \(\) => request\('\/deals\/flow\/passes'\)/);
  assert.match(Z, /dealFlowApi\.passes\(\)\.then\(setPasses/);
  assert.match(Z, /onClick=\{\(\) => setReason\(reason === b\.reason \? null : b\.reason\)\}/, 'a reason no longer opens its deals');
  assert.match(Z, /\(passes\.items \|\| \[\]\)\.filter\(\(i\) => i\.reason === reason\)/, 'the opened list is not the reason\'s deals');
  assert.match(Z, /passReturnWord\(i\)/, 'a passed deal no longer says when it comes back');
  assert.match(Z, /head=\{\['Venture', 'Passed on', 'Comes back'\]\}/);
});

test('no passes, no investor licence and an unreadable read are three sentences, never a 0 for the unknown', () => {
  // No passes: a readable, empty record says so in the instrument's note.
  assert.match(Z, /passes\.total === 0\s*\?\s*`No passes in \$\{whose\} deal flow yet\./);
  // No investor licence: the Worker's refusal code, not an outage.
  assert.match(Z, /e\?\.code === 'investor_required' \? NOT_INVESTOR : UNAVAILABLE/);
  assert.match(Z, /data-testid="screening-passes-not-investor"/);
  // Unreadable: Not recorded, and the tile has no figure.
  assert.match(Z, /data-testid="screening-passes-unreadable"/);
  assert.match(Z, /value=\{passesReady \? String\(passes\.total\) : null\}/);
  assert.doesNotMatch(Z, /\|\|\s*0\b|\?\?\s*0\b/, 'an absent figure falls back to 0');
});

test('a passed deal shows when it comes back on the peek and the card', () => {
  assert.match(MODEL, /pass: f\?\.pass \?\? null/, 'the row dropped the flow\'s pass');
  assert.match(PEEK, /data-testid="dealflow-peek-return">\{passReturnWord\(row\.pass\) \|\| 'Not recorded'\}/);
  assert.match(CARD, /row\.stage === 'passed' && <span[^>]*>\{passReturnWord\(row\.pass\)/);
});
