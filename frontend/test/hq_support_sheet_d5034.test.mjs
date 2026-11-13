/**
 * D5034 (#5034) part 2 — the escalation decision sheet (canvas SU02, SU03,
 * SU09). Every phase is rendered from props; what the page wires is read from
 * its source, because the page's reads and writes run in effects and handlers
 * that `renderToStaticMarkup` never runs. The mounted keyboard workflow and
 * focus after closing a sheet run in tests/visual/hq_support_5035.spec.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import { DecisionSheetView, SheetResult, SHEET_OUTCOMES, EMPTY_TEXT, raisedText } from '../src/pages/hq/support/DecisionSheet.jsx';
import { sheetFailure } from '../src/pages/hq/HqSupportPage.jsx';
import { branchLabelOf, nextUidAfter, escalationGroups } from '../src/pages/hq/support/supportWorkspaceModel.js';
import { EscalationQueue } from '../src/pages/hq/support/SupportWorkspaces.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = codeOnly(readFileSync(resolve(root, 'frontend/src/pages/hq/HqSupportPage.jsx'), 'utf8'));
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = renderedText;

const READ = '2026-11-08T14:30:00.000Z';
const ITEM = {
  uid: 'e1', branch_code: 'fr', kind: 'seat_increase', subject: 'Seat increase', sla: 'past', age_hours: 38,
  created_at: '2026-11-06T00:30:00.000Z', due_at: '2026-11-08T12:30:00.000Z',
  detail: 'Cohort 3 starts Monday and we are four seats short.', raised_by_name: 'Marie Dupont',
  subject_ref: 'licence:AXL-FR-001:seats', relation: 'changes',
};
const view = (over = {}) => render(DecisionSheetView, {
  item: ITEM, branchLabel: 'Axal VC France', readAt: READ, kindHours: { seat_increase: 72 },
  phase: 'decide', outcome: 'answered', reason: '', copy: 'COPY', onChoose() {}, onReason() {}, onSubmit() {}, onClose() {},
  ...over,
});

test('the sheet is a named modal dialog with the request first: subsidiary, who, subject, what it is about, the request', () => {
  const html = view();
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  const t = text(html);
  assert.match(t, /Escalation · Axal VC France/);
  assert.match(t, /Seat increase/);
  assert.match(t, /Past SLA · 38h/);
  assert.match(t, /72h SLA · late by 2h · raised Fri 6 Nov 00:30 UTC/);
  assert.match(t, /SubsidiaryAxal VC France/);
  assert.match(t, /Raised byMarie Dupont/);
  assert.match(t, /Aboutlicence:AXL-FR-001:seats · changes it/);
  assert.match(t, /RequestCohort 3 starts Monday and we are four seats short\./);
  const bare = text(view({ item: { ...ITEM, detail: null, raised_by_name: null, subject_ref: null } }));
  assert.match(bare, /Raised byNot recorded/);
  assert.match(bare, /AboutNot recorded/);
  assert.match(bare, /RequestNo detail recorded/);
});

test('two outcomes, as a radio group, and never withdrawn; the field says where the words go', () => {
  assert.deepEqual(SHEET_OUTCOMES.map((o) => o.value), ['answered', 'declined']);
  const html = view();
  assert.match(html, /role="radiogroup" aria-label="Outcome"/);
  assert.equal((html.match(/type="radio"/g) || []).length, 2);
  assert.doesNotMatch(text(html), /withdraw(?!n)/i);
  assert.match(text(html), /Escalations are answered or declined, never withdrawn\./);
  assert.match(text(html), /Answer · required · stored at HQ and sent to Axal VC France/);
  assert.match(text(html), /COPY/, 'what the branch will see is not said before sending');
  assert.match(html, /<textarea[^>]*maxLength="4000"/);
  assert.match(html, /<label for="hq-support-sheet-text-e1"/);
  assert.match(text(html), /Record answer$|Record answer/);
  const decline = text(view({ outcome: 'declined' }));
  assert.match(decline, /Reason for declining · required/);
  assert.match(decline, /Record the decline/);
});

test('an empty submit is refused in words tied to the field, not by a silent disabled button', () => {
  assert.equal(EMPTY_TEXT.declined, 'A decline needs its reason.');
  const idle = view();
  assert.doesNotMatch(idle.slice(idle.indexOf('data-testid="hq-support-sheet-submit"') - 200), /disabled=""[^>]*data-testid="hq-support-sheet-submit"/, 'the submit is disabled before anything is typed');
  const html = view({ outcome: 'declined', invalid: EMPTY_TEXT.declined });
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="hq-support-sheet-text-e1-error hq-support-sheet-text-e1-hint"/);
  assert.match(html, /id="hq-support-sheet-text-e1-error" role="alert"[^>]*>✕ A decline needs its reason\.</);
});

test('recording: the form is read-only and the button says HQ is recording', () => {
  const html = view({ phase: 'recording', reason: 'Granted.' });
  assert.match(html, /<fieldset[^>]*disabled=""/);
  assert.match(html, /disabled=""[^>]*aria-busy="true"[^>]*data-testid="hq-support-sheet-submit"/);
  assert.match(text(html), /Recording at HQ…/);
});

const REC = { uid: 'e1', branch_code: 'fr', status: 'answered', answered_at: '2026-11-08T14:03:00.000Z' };

test('recorded: two facts that stay two — recorded at HQ, and delivered or not', () => {
  const ok = text(render(SheetResult, { record: { ...REC, pushed: { ok: true } }, branchLabel: 'Axal VC France', onResend() {} }));
  assert.match(ok, /Answered · Recorded at HQ · 14:03 UTC/);
  assert.match(ok, /Axal VC France received it/);
  assert.doesNotMatch(ok, /Send again/);
  const failedHtml = render(SheetResult, { record: { ...REC, status: 'declined', pushed: { ok: false, reason: 'branch timed out' } }, branchLabel: 'Axal VC France', onResend() {} });
  const failed = text(failedHtml);
  assert.match(failed, /Declined · Recorded at HQ · 14:03 UTC/);
  assert.match(failed, /Not delivered to Axal VC France · branch timed out/);
  assert.match(failed, /Send again re-sends the decision HQ holds, not a new one\./);
  assert.match(failedHtml, /data-testid="hq-support-sheet-resend"/);
  const unreported = text(render(SheetResult, { record: { ...REC, pushed: undefined }, branchLabel: 'Axal VC France', onResend() {} }));
  assert.match(unreported, /Whether it reached Axal VC France was not reported/);
  assert.doesNotMatch(unreported, /received it|Not delivered/, 'an unreported push is called delivered or failed');
  // A push answer with no boolean `ok` reports nothing either way.
  const shapeless = text(render(SheetResult, { record: { ...REC, pushed: { reason: 'queued' } }, branchLabel: 'Axal VC France', onResend() {} }));
  assert.match(shapeless, /Whether it reached Axal VC France was not reported/);
  assert.doesNotMatch(shapeless, /Not delivered/);
  const sending = render(SheetResult, { record: { ...REC, pushed: { ok: false }, resend: { state: 'sending' } }, branchLabel: 'Axal VC France', onResend() {} });
  assert.match(text(sending), /Sending to Axal VC France…/);
  assert.match(sending, /disabled=""[^>]*aria-busy="true"[^>]*data-testid="hq-support-sheet-resend"/);
  const lost = render(SheetResult, { record: { ...REC, pushed: { ok: false }, resend: { state: 'unknown', text: 'Whether fr received it is not known.' } }, branchLabel: 'Axal VC France', onResend() {} });
  assert.match(lost, /role="alert"[^>]*data-state="unknown"[^>]*>Unknown: Whether fr received it is not known\.</);
  // Between the write's answer and its result landing, the sheet shows no
  // result it cannot read (the page holds it at "recording" until the record exists).
  const early = view({ phase: 'recorded', record: null });
  assert.doesNotMatch(early, /hq-support-sheet-result/);
  assert.ok(PAGE.includes("phase={sheet.phase === 'recorded' && !record ? 'recording' : sheet.phase}"), 'the sheet can reach its result before the record exists');
  const sheet = text(view({ phase: 'recorded', record: { ...REC, pushed: { ok: true } } }));
  assert.match(sheet, /Back to the queue/);
  assert.doesNotMatch(sheet, /Record answer/, 'the form is still offered after the decision was recorded');
});

test('outcome unknown never says nothing changed; a gone request says nothing was recorded here', () => {
  const unknown = view({ phase: 'unknown' });
  assert.match(text(unknown), /Outcome unknown · No response came back/);
  assert.match(text(unknown), /may or may not be recorded at HQ\. Re-read the queue before trying again: a second answer replaces the first\./);
  assert.doesNotMatch(text(unknown), /[Nn]othing (was )?changed|Nothing was recorded/);
  assert.match(unknown, /data-testid="hq-support-sheet-reread"/);
  const gone = text(view({ phase: 'gone' }));
  assert.match(gone, /This escalation is no longer on the board/);
  assert.match(gone, /Nothing was recorded here\. It was answered elsewhere or removed\./);
  const refused = view({ refusal: 'A decision needs its reason.' });
  assert.match(refused, /role="alert"[^>]*data-testid="hq-support-sheet-refused">Refused: A decision needs its reason\.</);
});

test('a failed write is read by its status: 404 gone, none or 5xx unknown, other 4xx refused with its sentence', () => {
  assert.deepEqual(sheetFailure({ status: 404 }), { phase: 'gone' });
  assert.deepEqual(sheetFailure({}), { phase: 'unknown' });
  assert.deepEqual(sheetFailure({ status: 502 }), { phase: 'unknown' });
  assert.deepEqual(sheetFailure({ status: 400, data: { message: 'Too long.' } }), { phase: 'decide', refusal: 'Too long.' });
  assert.deepEqual(sheetFailure({ status: 403, message: 'Super Admin only.' }), { phase: 'decide', refusal: 'Super Admin only.' });
});

test('names and order: a subsidiary is named from the reads, never guessed; the next row follows the queue', () => {
  const data = { branch_tickets: { lines: [{ code: 'fr', label: 'Axal VC France' }] }, matrix: { available: true, rows: [{ branch_code: 'de', label: 'Axal VC Germany' }] } };
  assert.equal(branchLabelOf(data, 'fr'), 'Axal VC France');
  assert.equal(branchLabelOf(data, 'de'), 'Axal VC Germany');
  assert.equal(branchLabelOf(data, 'xx'), 'xx');
  const esc = { available: true, items: [
    { uid: 'a', branch_code: 'fr', kind: 'other', sla: 'ok' }, { uid: 'b', branch_code: 'fr', kind: 'other', sla: 'past' }, { uid: 'c', branch_code: 'fr', kind: 'other', sla: 'due_soon' },
  ] };
  const groups = escalationGroups(esc, {});
  assert.equal(nextUidAfter(groups, 'b'), 'c', 'the next row is not the next in the banded order');
  assert.equal(nextUidAfter(groups, 'c'), 'a');
  assert.equal(nextUidAfter(groups, 'a'), null);
  assert.equal(raisedText('nope'), null);
});

test('Review opens a dialog and is named for its row', () => {
  const groups = escalationGroups({ available: true, items: [ITEM] }, { readAt: READ });
  const html = render(EscalationQueue, { escalations: { available: true, items: [ITEM] }, groups, count: 1, decide: { openUid: null, onOpen() {}, refFor: () => () => {} } });
  assert.match(html, /aria-haspopup="dialog"[^>]*aria-label="Review fr · Seat increase"/);
  assert.doesNotMatch(html, /aria-expanded/, 'Review still expands a panel in the row');
});

test('the page: one write path, the sheet stays on its outcome, and focus returns to the row or moves to the next', () => {
  assert.equal(PAGE.split('api.escalationAnswer(').length - 1, 1);
  const fn = PAGE.slice(PAGE.indexOf('export function EscalationDecision('));
  const sheetPart = fn.slice(fn.indexOf("if (variant === 'sheet') {"), fn.indexOf('const submit = async (e) => {'));
  assert.ok(sheetPart.includes("if (!reason.trim()) { setSheet({ phase: 'decide', invalid: EMPTY_TEXT[outcome], refusal: null }); return; }"),
    'an empty sheet decision is sent, or refused without saying why');
  assert.ok(sheetPart.indexOf('if (!reason.trim())') < sheetPart.indexOf('writeDecision('), 'the empty check runs after the write');
  assert.ok(sheetPart.includes('...sheetFailure(err)'), 'a failed write is not read by its status');
  assert.ok(sheetPart.includes("if (ok) setSheet({ phase: 'recorded'"), 'a failed write reaches the recorded phase');
  assert.ok(PAGE.includes('record={recorded.find((r) => r.uid === open.item.uid) || changes.find((r) => r.uid === open.item.uid) || null}'), 'the sheet lost the just-recorded decision when it left the history window');
  assert.ok(PAGE.includes('returnFocusTo={opener}'), 'focus does not return to the row on close');
  // The licence page keeps the inline panel: the sheet is the Support queue's alone.
  const licence = codeOnly(readFileSync(resolve(root, 'frontend/src/pages/admin/LicenceRequestsPanel.jsx'), 'utf8'));
  assert.match(licence, /<EscalationDecision item=\{it\} onRecorded=\{onRecorded\} onReload=\{onReload\} \/>/);
});
