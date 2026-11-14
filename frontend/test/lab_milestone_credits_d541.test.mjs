/**
 * D541 — the Lab checklist shows what each row pays, and "earned" once paid.
 *
 * `rowCredit` / `rowCreditLabel` run for real, and the two components are
 * rendered (`MilestoneCreditBadge`, `MilestoneCreditNote`). The amounts and
 * the earned state come from the Worker's `/spinout-lab/state`, which is
 * driven in cloudflare-worker/test/lab_milestone_credits_d541.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rowCredit, rowCreditLabel } from '../src/lib/labCredits.js';
import { MilestoneCreditBadge, MilestoneCreditNote } from '../src/pages/SpinoutLabWorkspace.jsx';

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const MC = {
  eligible: true, reason: null,
  milestones: {
    okrs_created: { credits: 50, usd_value_cents: 5000, earned: true, superseded: false },
    pitch_deck_drafted: { credits: 100, usd_value_cents: 10000, earned: false, superseded: false },
    customer_interview_logged_4: { credits: 10, usd_value_cents: 1000, earned: true, superseded: false },
    customer_interview_logged_5: { credits: 10, usd_value_cents: 1000, earned: false, superseded: false },
    advisor_meeting_booked: { credits: 50, usd_value_cents: 5000, earned: true, superseded: false },
    cofounder_request_sent: { credits: 50, usd_value_cents: 5000, earned: false, superseded: true },
  },
};

test('a row pays the sum of its paying keys; "earned" only once every one is paid', () => {
  assert.deepEqual(rowCredit(['pitch_deck_drafted'], MC), { credits: 100, usd_value_cents: 10000, earned: false, partly_earned: false });
  assert.equal(rowCreditLabel(rowCredit(['pitch_deck_drafted'], MC)), '+100 credits (US$100)');
  assert.equal(rowCreditLabel(rowCredit(['okrs_created'], MC)), '+50 credits (US$50) · earned');
  const interviews = ['customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3', 'customer_interview_logged_4', 'customer_interview_logged_5'];
  assert.equal(rowCreditLabel(rowCredit(interviews, MC)), '+20 credits (US$20) · partly earned', 'only the two that pay are counted');
});

test('a row that pays nothing, or the superseded half of the pair, gets no badge — never "+0"', () => {
  assert.equal(rowCredit(['project_created'], MC), null);
  assert.equal(rowCredit(['cofounder_request_sent'], MC), null);
  assert.equal(rowCredit(['okrs_created'], null), null);
  assert.equal(rowCreditLabel(null), null);
  assert.equal(render(MilestoneCreditBadge, { keys: ['project_created'], state: { milestone_credits: MC } }), '');
});

test('the badge draws the amount, and earned in its own colour', () => {
  const open = render(MilestoneCreditBadge, { keys: ['pitch_deck_drafted'], state: { milestone_credits: MC } });
  assert.match(open, /data-testid="milestone-credit"/);
  assert.equal(text(open), '+100 credits (US$100)');
  assert.match(open, /text-violet-700/);
  const done = render(MilestoneCreditBadge, { keys: ['okrs_created'], state: { milestone_credits: MC } });
  assert.equal(text(done), '+50 credits (US$50) · earned');
  assert.match(done, /text-emerald-700/);
});

test('someone who cannot earn sees no amounts, and the reason once', () => {
  const state = { milestone_credits: { ...MC, eligible: false, reason: 'Credits are earned once you are accepted into a cohort.' } };
  assert.equal(render(MilestoneCreditBadge, { keys: ['pitch_deck_drafted'], state }), '');
  assert.match(render(MilestoneCreditNote, { state }), /data-testid="milestone-credit-note"[^>]*>Credits are earned once you are accepted into a cohort\./);
  assert.equal(render(MilestoneCreditNote, { state: { milestone_credits: MC } }), '', 'no note when they can earn');
});

test('a credit read that failed is said on the row, never an empty badge', () => {
  const state = { milestone_credits: null, milestone_credits_unreadable: true };
  const html = render(MilestoneCreditBadge, { keys: ['pitch_deck_drafted'], state });
  assert.match(html, /data-testid="milestone-credit-unreadable"[^>]*>Credits unreadable</);
  assert.equal(render(MilestoneCreditNote, { state }), '');
  assert.equal(render(MilestoneCreditBadge, { keys: ['pitch_deck_drafted'], state: {} }), '', 'a server without the field draws nothing');
});
