/**
 * D6909 part 2 (#6909, PRM20 to PRM23): Request a mark as Prepare → Review →
 * Confirm → Receipt with optional evidence, the investor's requests for one
 * company newest first, and HQ's queue above the register with Decline as
 * Scope → Review → Result. Sample data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mark_request_boards_6909.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import MarkRequestPanel, { RequestSteps, RequestList } from '../src/pages/investor/MarkRequestPanel.jsx';
import MarkRequestQueue, { DeclineFlow } from '../src/pages/portfolio/MarkRequestQueue.jsx';
import {
  evidenceLink, evidenceProblem, evidenceWords, prepareProblem, companyRequests, requestCountWords, queueRows, declineProblem,
  requestStatusOf, EVIDENCE_MAX_BYTES,
} from '../src/pages/portfolio/markRequestModel.js';

const ROW = { key: 'p7', uid: 'p7', name: '[Sample Labs]', mark: { kind: 'marked' }, stale: true };
const LATEST = { date: '31 Mar 2026', age: '7 months old' };
const OPEN = { uid: 'r1', project_uid: 'p7', project_name: '[Sample Labs]', kind: 'mark', reason: 'Latest mark is 7 months old.', state: 'open',
  created_at: '2026-11-14T10:00:00Z', evidence: { kind: 'file', name: 'board-pack.pdf', size_bytes: 2_516_582, mime: 'application/pdf', href: '/api/mark-requests/r1/evidence' } };
const ANSWERED = { uid: 'r0', project_uid: 'p7', kind: 'mark', reason: 'Seed extension priced.', state: 'resolved', created_at: '2026-03-10T10:00:00Z',
  resolved_at: '2026-03-31T09:00:00Z', resolved_mark_uid: 'm9', evidence: null };
const DECLINED = { uid: 'rd', project_uid: 'p7', kind: 'correction', reason: 'Restate June.', state: 'declined', created_at: '2026-01-12T10:00:00Z',
  resolved_at: '2026-01-20T09:00:00Z', resolution_note: 'The June mark is the closing price.', evidence: { kind: 'link', url: 'https://example.invalid/notice' } };
const html = (el) => { const out = renderToStaticMarkup(el); return { html: out, text: renderedText(out) }; };
const file = (over = {}) => ({ name: 'pack.pdf', type: 'application/pdf', size: 1024, ...over });

test('evidence rules are the Worker’s: http(s) without credentials, one kind, four file types, 10 MB, not empty', () => {
  assert.equal(evidenceLink('https://example.invalid/a'), 'https://example.invalid/a');
  for (const bad of ['javascript:alert(1)', 'ftp://example.invalid/x', 'https://user:pw@example.invalid/', 'not a url', `https://example.invalid/${'a'.repeat(2000)}`]) {
    assert.equal(evidenceLink(bad), null, bad);
  }
  assert.equal(evidenceProblem({}), null, 'evidence is optional');
  assert.match(evidenceProblem({ link: 'https://example.invalid', file: file() }), /not both/);
  assert.match(evidenceProblem({ link: 'javascript:alert(1)' }), /http or https/);
  assert.match(evidenceProblem({ file: file({ name: 'a.docx', type: 'application/msword' }) }), /PDF, PNG, JPEG or WebP/);
  assert.match(evidenceProblem({ file: file({ size: 0 }) }), /empty/);
  assert.match(evidenceProblem({ file: file({ size: EVIDENCE_MAX_BYTES + 1 }) }), /10 MB/);
  assert.equal(evidenceProblem({ file: file({ size: EVIDENCE_MAX_BYTES }) }), null);
  assert.equal(evidenceProblem({ file: file({ type: '', name: 'scan.JPG' }) }), null, 'an extension stands in for a missing type');
  // Prepare needs a kind and a reason before evidence.
  assert.equal(prepareProblem({ kind: 'mark', reason: '' }), 'Say what is wrong or missing.');
  assert.equal(prepareProblem({ kind: 'mark', reason: 'Stale.', link: 'https://example.invalid' }), null);
  assert.equal(evidenceWords(OPEN.evidence), 'board-pack.pdf · 2.4 MB');
  assert.equal(evidenceWords(DECLINED.evidence), 'https://example.invalid/notice');
  assert.equal(evidenceWords(null), null);
});

test('PRM20 Prepare: company fixed, the latest mark with its age, kind, a required reason and optional evidence; Review is closed until the reason is given', () => {
  const p = html(h(RequestSteps, { row: ROW, latest: LATEST, onSend: async () => {}, onCancel: () => {} }));
  assert.match(p.text, /Prepare.*Review.*Confirm.*Receipt/);
  assert.match(p.html, /aria-current="step"[^>]*>Prepare</);
  assert.match(p.text, /\[Sample Labs\] · fixed/);
  assert.match(p.text, /31 Mar 2026 · 7 months old/);
  assert.match(p.text, /Reason · required/);
  assert.match(p.text, /Evidence · optional/);
  assert.match(p.html, /<button type="submit"[^>]*disabled=""[^>]*data-testid="button-review-mark-request"/);
  const none = html(h(RequestSteps, { row: ROW, latest: null, onSend: async () => {}, onCancel: () => {} }));
  assert.match(none.text, /No mark recorded/, 'no latest mark reads as such, never a blank');
  const ok = html(h(RequestSteps, { row: ROW, latest: LATEST, initialDraft: { kind: 'mark', reason: 'Stale.' }, onSend: async () => {}, onCancel: () => {} }));
  assert.doesNotMatch(ok.html, /disabled=""[^>]*data-testid="button-review-mark-request"/);
});

test('PRM20 Review says only HQ sees it; Confirm says what changes and what does not; Receipt reads the stored row', () => {
  const draft = { kind: 'mark', reason: 'Latest mark is 7 months old.', link: 'https://example.invalid/pack' };
  const review = html(h(RequestSteps, { row: ROW, latest: LATEST, initialStep: 1, initialDraft: draft, onSend: async () => {}, onCancel: () => {} }));
  assert.match(review.text, /What HQ will see\. Nobody else sees it\./);
  assert.match(review.text, /https:\/\/example\.invalid\/pack/);
  const confirm = html(h(RequestSteps, { row: ROW, latest: LATEST, initialStep: 2, initialDraft: draft, onSend: async () => {}, onCancel: () => {} }));
  assert.match(confirm.text, /Send this request to HQ\?/);
  assert.match(confirm.text, /A request is stored and HQ is told/);
  assert.match(confirm.text, /Your mark, NAV and Positions figures stay as they are until HQ records a mark/);
  assert.match(confirm.html, /data-testid="button-send-mark-request"/);
  const receipt = html(h(RequestSteps, { row: ROW, latest: LATEST, initialReceipt: OPEN, onSend: async () => {}, onCancel: () => {} }));
  assert.match(receipt.text, /✓ Requested 14 Nov 2026\. HQ is told\./);
  assert.match(receipt.text, /board-pack\.pdf · 2\.4 MB/, 'the Receipt names the stored evidence, not the draft');
  assert.match(receipt.html, /aria-current="step"[^>]*>Receipt</);
});

test('PRM21: the company’s requests newest first: Requested, Answered (mark recorded) and Declined with HQ’s reason', () => {
  const list = companyRequests([DECLINED, OPEN, { ...OPEN, uid: 'other', project_uid: 'p8' }, ANSWERED], 'p7');
  assert.deepEqual(list.map((r) => r.uid), ['r1', 'r0', 'rd']);
  assert.equal(requestCountWords(list), '3 requests · 1 open');
  const out = html(h(RequestList, { list }));
  assert.match(out.text, /Your requests · newest first/);
  assert.match(out.text, /Requested · 14 Nov 2026/);
  assert.match(out.text, /Answered · mark recorded · 31 Mar 2026/);
  assert.match(out.text, /Declined · 20 Jan 2026/);
  assert.match(out.text, /HQ’s reason: “The June mark is the closing price\.”/);
  assert.equal(requestStatusOf({ ...ANSWERED, resolved_mark_uid: null }).label, 'Answered · 31 Mar 2026', 'a follow-on answered by note links no mark');
  assert.equal(html(h(RequestList, { list: [] })).html, '', 'no list is drawn when there is none; the panel says so');
  const panel = html(h(MarkRequestPanel, { row: ROW, read: { state: 'ok' }, request: OPEN, list, onSend: async () => {}, onRetry: () => {} }));
  assert.match(panel.text, /Your requests · newest first/);
  // An open request is never followed by a second: startOpen does not open the steps over it.
  const over = html(h(MarkRequestPanel, { row: ROW, read: { state: 'ok' }, request: OPEN, startOpen: true, list, onSend: async () => {}, onRetry: () => {} }));
  assert.doesNotMatch(over.html, /mark-request-form/);
  const failed = html(h(MarkRequestPanel, { row: ROW, read: { state: 'unreadable' }, request: null, list: [], onSend: async () => {}, onRetry: () => {} }));
  assert.doesNotMatch(failed.text, /You have not asked/, 'an unread list is never “no requests”');
});

const QUEUE = [
  { ...OPEN, uid: 'q1', requester: { id: 5, name: '[Sample Capital]' }, latest_mark: { uid: 'm1', as_of_date: '2026-03-31', fmv: 2400000, basis: 'round_price' } },
  { ...DECLINED, uid: 'q2', state: 'open', project_uid: 'p9', project_name: '[Sample Pay]', created_at: '2026-11-06T10:00:00Z', requester: { id: 6, name: null },
    evidence: { kind: 'link', url: 'javascript:alert(1)' }, latest_mark: null },
];

test('PRM22: HQ’s queue, oldest first as read, with age, evidence and both actions; an unsafe link is shown, never followed', () => {
  const rows = queueRows(QUEUE, '2026-11-14');
  assert.equal(rows[0].age, '0 d'); assert.equal(rows[1].age, '8 d');
  assert.equal(rows[1].requester, 'Investor (name not recorded)');
  assert.equal(rows[1].href, null);
  assert.equal(rows[0].latestMark, '31 Mar 2026');
  assert.equal(queueRows([{ ...OPEN, state: 'resolved' }], '2026-11-14').length, 0, 'only open requests are queued');
  const out = html(h(MarkRequestQueue, { read: { state: 'ok', items: QUEUE }, today: '2026-11-14', onRetry() {}, onRecord() {}, onDecline: async () => {}, onEvidence() {} }));
  assert.match(out.text, /Open mark requests/);
  assert.match(out.text, /2 open · oldest first · investors see none of this queue/);
  assert.ok(out.text.indexOf('[Sample Labs]') < out.text.indexOf('[Sample Pay]'), 'the Worker’s oldest-first order is kept');
  assert.match(out.html, /button-queue-record-q1/); assert.match(out.html, /button-queue-decline-q1/);
  assert.match(out.html, /button-queue-evidence-q1/, 'a file downloads through the guarded route');
  assert.doesNotMatch(out.html, /href="javascript:/);
  assert.match(out.text, /Latest mark · none recorded/);
});

test('PRM23: the queue’s loading, unavailable (never “No open requests”) and empty states', () => {
  const props = { today: '2026-11-14', onRetry() {}, onRecord() {}, onDecline: async () => {} };
  const state = (o) => /data-testid="mark-request-queue" data-state="([^"]+)"/.exec(o.html)?.[1];
  const loading = html(h(MarkRequestQueue, { ...props, read: { state: 'loading', items: [] } }));
  assert.equal(state(loading), 'loading');
  const una = html(h(MarkRequestQueue, { ...props, read: { state: 'unreadable', items: [] } }));
  assert.equal(state(una), 'unreadable');
  assert.match(una.text, /Unavailable · the request queue could not be read\. The register below is current\. This is not “No open requests”\./);
  assert.match(una.html, /button-retry-mark-queue/);
  const empty = html(h(MarkRequestQueue, { ...props, read: { state: 'ok', items: [] } }));
  assert.equal(state(empty), 'empty');
  assert.match(empty.text, /No open requests\. The queue read succeeded\./);
});

test('PRM22E Decline: Scope needs a reason the investor sees; Review says nothing else changes; Result; failure keeps the reason', () => {
  const [row] = queueRows(QUEUE, '2026-11-14');
  assert.equal(declineProblem(''), 'Say why the request is declined.');
  assert.equal(declineProblem('The board pack is not final.'), null);
  const scope = html(h(DeclineFlow, { row, onDecline: async () => {}, onClose() {} }));
  assert.match(scope.text, /1\. Scope.*2\. Review.*3\. Result/);
  assert.match(scope.text, /Reason the investor will see · required/);
  assert.match(scope.html, /disabled=""[^>]*data-testid="button-decline-review"/);
  const review = html(h(DeclineFlow, { row, initialStep: 1, initialNote: 'The board pack is not final.', onDecline: async () => {}, onClose() {} }));
  assert.match(review.text, /Declining records no mark and changes no figure\. The investor sees Declined, the date and this reason, and may ask again\./);
  assert.match(review.text, /Decline request for \[Sample Labs\]/);
  const result = html(h(DeclineFlow, { row, initialStep: 2, onDecline: async () => {}, onClose() {} }));
  assert.match(result.text, /✓ Declined\./);
});

test('the pages wire it: the investor’s list and evidence; the queue above the admin register, read again on every answer', () => {
  const inv = readFileSync(new URL('../src/pages/investor/InvestorPortfolioPositions.jsx', import.meta.url), 'utf8');
  assert.match(inv, /list=\{requests\.state === 'ok' \? companyRequests\(requests\.items, row\.uid\) : \[\]\}/);
  assert.match(inv, /return stored;/, 'the Receipt reads the stored row');
  const adm = readFileSync(new URL('../src/pages/PortfolioPositionsPage.jsx', import.meta.url), 'utf8');
  assert.match(adm, /markRequestsApi\.queue\(\)/);
  assert.ok(adm.indexOf('<MarkRequestQueue') < adm.indexOf('<table className="w-full text-sm">'), 'the queue sits above the register');
  assert.match(adm, /\{isAdmin \? \(/, 'only HQ sees the queue');
  assert.match(adm, /finally \{ loadQueue\(\); \}/);
  assert.match(adm, /finally \{ loadRequests\(detail\?\.project\?\.uid\); loadQueue\(\); \}/);
});
