/**
 * D634 (#1392) — three HQ review screens of the Ops canvas, each rendered
 * from its real component in its states:
 *   Q4 hq-comments — "Delete" beside "Resolve", sent only from its confirmation;
 *   Q5 hq-dispute — a billing dispute's page, with both Stripe states;
 *   Q6 hq-sensitive — identity fields masked until "Show", the showing logged.
 *
 * The Worker side (the masks, the logged per-field routes, the dispute read
 * and the delete refusals) is `cloudflare-worker/test/hq_review_d634.test.ts`.
 */
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ReviewComments, { ReviewComment } from '../src/components/hqReview/ReviewComments.jsx';
import SensitiveField, { KycSensitiveFields } from '../src/components/hqReview/SensitiveField.jsx';
import { DisputeView } from '../src/pages/hq/DisputePage.jsx';
import { BillingExceptions } from '../src/pages/hq/RevenuePage.jsx';
import {
  COMMENT_DELETE_CONFIRM, DISPUTE, SENSITIVE, disputeMoney, disputeReadFailure, stripeDate, shownWhen,
} from '../src/components/hqReview/hqReviewCopy.js';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { adminConsoleSource } from './_adminConsoles.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));
const noop = () => {};

// ── Q4 · review comments ───────────────────────────────────────────────────

const C = { id: 5, author_name: 'Rae Reviewer', created_at: '2026-10-12T09:41:00Z', anchor: 'Market', body: 'Name the round.', resolved_at: null };

test('Q4: Resolve is the first action, Delete sits beside it, and the anchor or its absence is said', () => {
  const markup = html(h(ReviewComment, { comment: C, onResolve: noop, onDelete: noop }));
  const resolveAt = markup.indexOf('data-testid="hq-comment-resolve"');
  const deleteAt = markup.indexOf('data-testid="hq-comment-delete"');
  assert.ok(resolveAt > 0 && deleteAt > resolveAt, 'Resolve, then Delete');
  assert.match(renderedText(markup), /Section: Market\s*Name the round\.\s*Mark resolved\s*Delete$/);
  assert.match(text(h(ReviewComment, { comment: { ...C, anchor: null }, onResolve: noop, onDelete: noop })),
    /Not recorded: this comment is not anchored to a section\./);
  assert.match(text(h(ReviewComment, { comment: { ...C, resolved_at: '2026-10-13' }, onResolve: noop, onDelete: noop })), /Mark unresolved/);
});

test('Q4: a delete is confirmed before it is sent, and the confirmation says the author loses it too', () => {
  const before = html(h(ReviewComment, { comment: C, onResolve: noop, onDelete: noop }));
  assert.doesNotMatch(before, /hq-comment-confirm|cannot be undone/, 'the first press only asks');
  const asking = html(h(ReviewComment, { comment: C, onResolve: noop, onDelete: noop, initialConfirming: true }));
  assert.match(renderedText(asking), /Delete this comment\?\s*The author loses it too\. This cannot be undone\. To keep it on record, resolve it instead\.\s*Keep it\s*Delete for everyone/);
  assert.doesNotMatch(asking, /data-testid="hq-comment-delete"/, 'the Delete link gives way to the confirmation');
  assert.equal(COMMENT_DELETE_CONFIRM.title, 'Delete this comment?');
  // The delete is made in one place, and only the confirmation's button reaches it.
  const code = codeOnly(read('components/hqReview/ReviewComments.jsx'));
  assert.equal((code.match(/onDelete\(c\.id\)/g) || []).length, 1);
  assert.equal((code.match(/onClick=\{confirmDelete\}/g) || []).length, 1);
  assert.match(code, /onClick=\{confirmDelete\} disabled=\{busy\}[^>]*data-testid="hq-comment-confirm-delete"/);
  assert.match(code, /onClick=\{\(\) => setConfirming\(true\)\}[^>]*data-testid="hq-comment-delete"/);
  const page = codeOnly(read('pages/admin/ArticlesQueuePage.jsx'));
  assert.match(page, /const deleteComment = async \(cid\) => \{\s*await api\.deleteComment\(cid\);/);
  assert.match(page, /onDelete=\{deleteComment\}/);
});

test('Q4 states: loading, empty, and an unreadable list that is never "No comments"', () => {
  assert.match(text(h(ReviewComments, { state: { loading: true, error: false, comments: null } })), /Loading comments…/);
  assert.match(text(h(ReviewComments, { state: { loading: false, error: false, comments: [] } })), /^No comments on this article\.$/);
  const unread = text(h(ReviewComments, { state: { loading: false, error: true, comments: null }, onRetry: noop }));
  assert.match(unread, /^Unreadable\. Comments could not be read just now\. Try again$/);
  assert.equal((html(h(ReviewComments, { state: { loading: false, error: false, comments: [C, { ...C, id: 6 }] }, onResolve: noop, onDelete: noop }))
    .match(/data-testid="hq-comment"/g) || []).length, 2);
  // The page's own failed read is Unreadable with Try again, not "Select an article".
  const page = codeOnly(read('pages/admin/ArticlesQueuePage.jsx'));
  assert.match(page, /!detail && selectedId && detailFailed \?/);
  assert.match(page, /Unreadable\. The article and its review comments could not be read just now\./);
});

// ── Q5 · a billing dispute ─────────────────────────────────────────────────

const D = {
  id: 'dp_1', amount: 120000, currency: 'eur', status: 'needs_response', reason: 'fraudulent',
  charge: 'ch_1', payment_intent: 'pi_1', created: 1760000000, due_by: 1760832000, has_evidence: true, submission_count: 2,
};
const dispute = (state) => text(h(DisputeView, { disputeId: 'dp_1', state, onRetry: noop }));

test('Q5: the dispute page shows amount and currency, status, reason, due date, references and evidence', () => {
  const t = dispute({ loading: false, failure: null, dispute: D });
  assert.match(t, /Dispute dp_1\s*Read live from Stripe each time this page opens\. Nothing here is stored on the platform\./);
  assert.match(t, /Amount\s*€1,200\.00 EUR\s*Status\s*Needs response\s*Reason\s*fraudulent\s*Due\s*19 Oct 2025/);
  assert.match(t, /Charge\s*ch_1\s*Payment intent\s*pi_1/);
  assert.match(t, /Evidence sent · submitted 2 times\./);
  assert.match(dispute({ loading: false, failure: null, dispute: { ...D, submission_count: 1 } }), /submitted 1 time\./);
  const bare = dispute({ loading: false, failure: null, dispute: { ...D, due_by: null, has_evidence: false, submission_count: 0, status: 'odd_state', reason: 'bank_cannot_process' } });
  assert.match(bare, /Status\s*odd_state\s*Reason\s*bank cannot process\s*Due\s*Not recorded: Stripe returned no due date for this dispute\./);
  assert.match(bare, /No evidence has been sent for this dispute\./);
});

test('Q5: both Stripe states, and neither shows a figure', () => {
  const nc = dispute({ loading: false, failure: 'not_configured', dispute: null });
  assert.match(nc, /Stripe is not configured\s*No Stripe key is set for this tenant\. Disputes cannot be read until one is\./);
  assert.doesNotMatch(nc, /Try again|Amount/);
  const un = dispute({ loading: false, failure: 'unreadable', dispute: null });
  assert.match(un, /Stripe could not be read\s*The request failed or timed out\. Nothing is cached; try again\. Try again$/);
  assert.doesNotMatch(un, /Amount|€/);
  assert.equal(disputeReadFailure({ code: 'stripe_not_configured' }), 'not_configured');
  assert.equal(disputeReadFailure({ code: 'stripe_error' }), 'unreadable');
  assert.equal(disputeReadFailure(new Error('network')), 'unreadable');
  assert.match(dispute({ loading: true, failure: null, dispute: null }), /Reading Stripe…/);
  assert.equal(DISPUTE.notConfigured.title, 'Stripe is not configured');
});

test('Q5: money to the cent with its code, dates in UTC, and the Disputes card opens each dispute', () => {
  assert.equal(disputeMoney(120000, 'eur'), '€1,200.00 EUR');
  assert.equal(disputeMoney(50, 'usd'), 'US$0.50 USD');
  assert.match(disputeMoney(1999, 'zzz'), /^ZZZ\s19\.99$/, 'the code is said once');
  assert.equal(disputeMoney(null, 'eur'), null);
  assert.equal(stripeDate(1760832000), '19 Oct 2025');
  assert.equal(stripeDate(0), null);
  const card = html(h(BillingExceptions, {
    refunds: { available: true, window_days: 30, count: 0, by_currency: [], items: [], source: 's' },
    disputes: { disputes: [D, { ...D, id: 'dp_won', status: 'won' }] },
    nowSec: 1760000000,
  }));
  const link = /<a ([^>]*)>Dispute<\/a>/.exec(card);
  assert.ok(link, 'the dispute row is a link');
  assert.match(link[1], /href="\/admin\/revenue\/disputes\/dp_1"/);
  assert.match(link[1], /data-testid="hq-revenue-dispute-link"/);
  assert.doesNotMatch(card, /dp_won/, 'a closed dispute is not listed');
  const app = codeOnly(read('App.jsx'));
  assert.match(app, /<Route path="\/admin\/revenue\/disputes\/:disputeId" element=\{guard\(\['admin'\], hqOnly\(<HqDisputePage \/>\)\)\} \/>/);
});

// ── Q6 · sensitive fields ──────────────────────────────────────────────────

test('Q6: a field is masked until Show, and a shown one says who showed it, when, and that it is logged', () => {
  const masked = html(h(SensitiveField, { label: 'Date of birth', masked: '••••-••-••', onShow: noop }));
  assert.match(renderedText(masked), /^Date of birth••••-••-••\s*Show$/);
  assert.doesNotMatch(masked, /1990/);
  const shown = text(h(SensitiveField, {
    label: 'Date of birth', masked: '••••-••-••', onShow: noop,
    initialShown: { value: '1990-01-02', shown_at: '2026-10-12T09:41:00Z', shown_by: 'Ada Admin' },
  }));
  assert.match(shown, /^Date of birth1990-01-02Shown by Ada Admin · 12 Oct 2026, 09:41 · logged$/);
  assert.doesNotMatch(shown, /Show$|••/);
  assert.equal(shownWhen('2026-10-12T09:41:00Z'), '12 Oct 2026, 09:41');
  const nr = text(h(SensitiveField, { label: 'Phone', masked: null, onShow: noop }));
  assert.match(nr, /^PhoneNot recorded: the member did not submit this\.$/);
  // Show calls the field's own route, which logs before it returns.
  const code = codeOnly(read('components/hqReview/SensitiveField.jsx'));
  assert.match(code, /setShown\(await onShow\(\)\);/);
});

test('Q6: the KYC window masks date of birth, ID number, address and phone, says showing is logged, and has no tax ID to show', () => {
  const markup = html(h(KycSensitiveFields, {
    masked: { date_of_birth: '••••-••-••', id_number: '••••••67', address: '•• ••••••', phone: null },
    onShow: noop,
  }));
  const t = renderedText(markup);
  assert.match(t, /^Sensitive fields are masked by default\. Each showing is logged with your name and the time\./);
  assert.match(t, /Date of birth••••-••-••\s*Show\s*ID number••••••67\s*Show\s*Address•• ••••••\s*Show\s*PhoneNot recorded: the member did not submit this\.\s*Tax IDNot recorded: the KYC form does not ask for a tax ID\.$/);
  assert.equal((markup.match(/data-testid="hq-sensitive-show"/g) || []).length, 3);
  assert.equal(SENSITIVE.line, 'Sensitive fields are masked by default. Each showing is logged with your name and the time.');
  // The window draws the masks and calls the logged route; the clear values are gone from it.
  const admin = codeOnly(adminConsoleSource());
  assert.match(admin, /<KycSensitiveFields\s*masked=\{kycDetail\.kyc_data\.masked\}\s*onShow=\{\(field\) => api\.kycAdminShowField\(kycDetail\.id, field\)\}/);
  assert.doesNotMatch(admin, /kyc_data\.(date_of_birth|id_number|phone|address_line1)/);
  assert.match(admin, /onShow=\{\(\) => api\.adminShowProfileField\(profile\.email, 'ein'\)\}/);
  assert.doesNotMatch(admin, /profile\.ein\b/);
});
