/**
 * D604 (#1280 step 4) — the Help Center's ticket screens, H3 to H7 of
 * `design/canvases/integrated/Help Ticket Screen.dc.html`.
 *
 * What is pinned, and why:
 *   - the form has no default type, and each error names its field (D544);
 *   - the list's tabs, filters and counts agree, and "No category" is its own
 *     filter, never Other (D482);
 *   - the SLA is shown only while the clock runs, and unknown hours say so;
 *   - a feature request's review is shown, and a review that could not be
 *     read is never "Awaiting review";
 *   - the thread names the member, the team, and anyone outside the team as
 *     what they are, and a thread that could not be read never reads as empty;
 *   - replies stay closed until the ticket is on the tracker, and an admin can
 *     retry the mirror of that one ticket.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ticket_screens_d604.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import TicketsPage, { TicketView, MemberRow, QueueRow, TicketGithubRecovery } from '../src/pages/TicketsPage.jsx';
import ReviewBadge from '../src/components/tickets/ReviewBadge.jsx';
import {
  EMPTY_FORM, NO_FILTERS, formErrors, tabCounts, visibleTickets, matchesFilters, slaChip, tierLine,
  reviewLine, bountyPanel, threadSpeaker, detailFailure, guidesForTitle, categoryLabel, dayOf,
} from '../src/lib/ticketScreens.js';
import { createDocsFuse } from '../src/lib/docs/search.js';
import { SECTIONS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { readingMinutes } from '../src/pages/docs/helpCenter.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el, at = '/') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [at] }, el));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// H4 — the form
// ---------------------------------------------------------------------------

test('the form starts with no type, and each error names its field', () => {
  assert.equal(EMPTY_FORM.type, '', 'a type chosen for the member would file support requests as tasks (D544)');
  assert.deepEqual(formErrors(EMPTY_FORM), { title: 'Title is required.', type: 'Type is required. Pick Task, Bug or Feature.' });
  assert.deepEqual(formErrors({ ...EMPTY_FORM, title: '  ', type: 'bug' }), { title: 'Title is required.' });
  assert.deepEqual(formErrors({ ...EMPTY_FORM, title: 'Export fails', type: 'chore' }), { type: 'Type is required. Pick Task, Bug or Feature.' });
  assert.match(formErrors({ ...EMPTY_FORM, title: 'x'.repeat(201), type: 'bug' }).title, /200/);
  assert.deepEqual(formErrors({ ...EMPTY_FORM, title: 'Export fails', type: 'feature' }), {});
  assert.equal(EMPTY_FORM.category, '', 'no category is a choice, not Other');
});

test('the form renders H4: three types with none picked, the priorities, and the guides rail', () => {
  const markup = html(h(Routes, null, h(Route, { path: '/help/tickets', element: h(TicketsPage) })), '/help/tickets?new=1');
  const t = text(markup);
  assert.match(t, /Open a ticket/);
  assert.match(t, /Type · required, no default/);
  assert.equal((markup.match(/name="ticket-type"/g) || []).length, 3);
  assert.doesNotMatch(markup, /name="ticket-type"[^>]*checked/, 'no type is picked for the member');
  assert.equal((markup.match(/name="ticket-priority"/g) || []).length, 4);
  assert.match(markup, /<input[^>]*name="ticket-priority"[^>]*checked=""[^>]*value="medium"/, 'medium is the canvas\'s preset priority');
  assert.match(t, /Money, signatures or access are stuck\./);
  assert.match(t, /These guides may answer it Type a title to see matching guides\./);
  assert.match(markup, /<option value="" selected="">No category<\/option>/, "no category is the preset, never Other");
});

test('the guides that may answer it come from the reader\'s own index, three at most', () => {
  const role = 'founder';
  const fuse = createDocsFuse(role);
  const visible = filterSectionsForRole(SECTIONS, role);
  const byId = Object.fromEntries(visible.map((s) => [s.id, s]));
  assert.deepEqual(guidesForTitle(fuse, '', byId, readingMinutes), []);
  assert.deepEqual(guidesForTitle(fuse, 'ca', byId, readingMinutes), [], 'two letters match everything');
  const found = guidesForTitle(fuse, 'cap table', byId, readingMinutes);
  assert.ok(found.length > 0 && found.length <= 3, `found ${found.length}`);
  const anchors = new Set(visible.flatMap((s) => s.subsections.map((g) => `${s.id}/${g.id}`)));
  for (const g of found) {
    assert.ok(anchors.has(g.anchor), `${g.anchor} is not a guide a founder can open`);
    assert.ok(g.minutes >= 1, 'each carries its reading time');
  }
});

test('the submit reads the sync outcome and shows it on the new ticket', () => {
  const src = read('frontend/src/pages/TicketsPage.jsx');
  assert.match(src, /navigate\(res\?\.id \? `\/help\/tickets\/\$\{res\.id\}` : '\/help\/tickets', \{ state: \{ outcome \} \}\)/);
  assert.match(src, /outcome=\{location\.state\?\.outcome \|\| null\}/);
  assert.doesNotMatch(src, /retried until it succeeds|The team retries/, 'nothing retries a failed mirror on its own; the page must not promise it');
});

// ---------------------------------------------------------------------------
// H3 / H6 — the list
// ---------------------------------------------------------------------------

const ROWS = [
  { id: 1, title: 'Export is empty', status: 'open', type: 'bug', category: 'billing', priority: 'high', updated_at: '2026-10-05 10:00:00', sla: { tier: 'P2', hours: 48, band: 'due_soon', clock: 'running' } },
  { id: 2, title: 'CSV export', status: 'in_progress', type: 'feature', category: null, priority: 'medium', updated_at: '2026-10-06 10:00:00', sla: { tier: 'P3', hours: 96, band: 'ok', clock: 'running' } },
  { id: 3, title: 'Old question', status: 'closed', type: 'task', category: 'onboarding', priority: 'low', updated_at: '2026-09-01 10:00:00', sla: { tier: 'P3', hours: 96, band: null, clock: 'stopped' } },
  { id: 4, title: 'Login loop', status: 'open', type: 'bug', category: null, priority: 'urgent', updated_at: '2026-10-06 09:00:00', sla: { tier: 'P1', hours: 24, band: 'past', clock: 'running' } },
];

test('the tabs count what the filters leave, and each tab lists latest activity first', () => {
  assert.deepEqual(tabCounts(ROWS), { open: 2, in_progress: 1, resolved: 0, closed: 1, all: 4 });
  assert.deepEqual(visibleTickets(ROWS, 'open').map((t) => t.id), [4, 1]);
  assert.deepEqual(visibleTickets(ROWS, 'all').map((t) => t.id), [2, 4, 1, 3]);
  const bugs = { ...NO_FILTERS, type: 'bug' };
  assert.deepEqual(tabCounts(ROWS, bugs), { open: 2, in_progress: 0, resolved: 0, closed: 0, all: 2 });
  // "No category" is its own filter, and never counted as Other (D482).
  assert.deepEqual(visibleTickets(ROWS, 'all', { ...NO_FILTERS, category: 'none' }).map((t) => t.id), [2, 4]);
  assert.deepEqual(visibleTickets(ROWS, 'all', { ...NO_FILTERS, category: 'other' }), []);
  assert.equal(categoryLabel(null), 'No category');
  // The SLA filter reads running clocks only.
  assert.deepEqual(visibleTickets(ROWS, 'all', { ...NO_FILTERS, sla: 'past' }).map((t) => t.id), [4]);
  assert.equal(matchesFilters(ROWS[2], { ...NO_FILTERS, sla: 'ok' }), false, 'a closed ticket is never on time or late');
  assert.deepEqual(visibleTickets(ROWS, 'all', { ...NO_FILTERS, query: 'EXPORT' }).map((t) => t.id), [2, 1]);
});

test('the SLA shows only while the clock runs, and unknown hours say so', () => {
  assert.equal(slaChip({ clock: 'running', band: 'ok' }).text, 'On time');
  assert.equal(slaChip({ clock: 'running', band: 'due_soon' }).text, 'Due soon');
  assert.equal(slaChip({ clock: 'running', band: 'past' }).text, 'Overdue');
  assert.equal(slaChip({ clock: 'stopped', band: null }), null);
  assert.equal(slaChip({ clock: 'unreadable', band: null }).text, 'SLA hours unknown');
  assert.equal(slaChip(undefined), null, 'a member is sent no SLA, and is shown none');
  assert.equal(tierLine({ tier: 'P2', hours: 48 }), 'P2 · 48 h');
  assert.equal(tierLine({ tier: 'P2', hours: null }), 'P2');
});

test("a member's row carries every chip, and a queue row the admin's columns", () => {
  const member = text(html(h(MemberRow, { t: { ...ROWS[1], description: 'First line\nsecond', bounty: null, review: { state: 'awaiting' } } })));
  assert.match(member, /CSV export Updated .+ First line Feature No category Medium In progress Awaiting review/);
  assert.doesNotMatch(member, /second/, 'the row shows the first line only');
  const queue = html(h(QueueRow, { t: { ...ROWS[3], submitted_by: 'Member Two', bounty: { state: 'under_review' }, review: null, github_issue_number: null } }));
  const q = text(queue);
  assert.match(q, /Login loop Member Two No category Urgent P1 · 24 h Overdue Open Bug Under review Not on the tracker/);
  assert.match(queue, /href="\/help\/tickets\/4"/);
  const mirrored = text(html(h(QueueRow, { t: { ...ROWS[0], submitted_by: 'x', github_issue_number: 321 } })));
  assert.match(mirrored, /#321/);
});

test('the missing-issue banner is the canvas\'s, and an admin\'s only', () => {
  const r = (props) => renderToStaticMarkup(h(TicketGithubRecovery, { isAdmin: true, pending: 3, configured: true, busy: false, onRetry() {}, ...props }));
  assert.match(text(r()), /3 saved tickets are not on the tracker\./);
  assert.match(text(r({ pending: 1 })), /1 saved ticket is not on the tracker\./);
  assert.match(text(r()), /no name or email is/, 'the banner says what the mirror leaves out (D600)');
  assert.equal(r({ isAdmin: false }), '');
});

// ---------------------------------------------------------------------------
// The review and the bounty
// ---------------------------------------------------------------------------

test('a review is worded once, and one that could not be read is never awaiting', () => {
  assert.equal(reviewLine({ state: 'awaiting' }).text, 'Awaiting review');
  assert.equal(reviewLine({ state: 'approved' }).text, 'Approved');
  const declined = reviewLine({ state: 'declined', reason: 'Out of scope this year.' });
  assert.equal(declined.text, 'Declined');
  assert.match(declined.note, /Reason, as the Super Admin typed it: Out of scope this year\./);
  const unreadable = reviewLine({ state: 'unreadable' });
  assert.equal(unreadable.text, 'Review could not be read');
  assert.doesNotMatch(unreadable.text, /Awaiting/);
  assert.equal(reviewLine(null), null);
  assert.equal(renderToStaticMarkup(h(ReviewBadge, { review: null })), '', 'a bug or a task has no review chip');
  assert.match(renderToStaticMarkup(h(ReviewBadge, { review: { state: 'awaiting' } })), /data-testid="review-state"/);
});

test('the bounty panel says what each state means, and never guesses an amount', () => {
  assert.match(bountyPanel({ state: 'fixed', credits: 60 }).text, /60 credits were granted\. A credit is worth US\$1/);
  assert.match(bountyPanel({ state: 'fixed', credits: 1 }).text, /1 credit was granted/);
  assert.equal(bountyPanel({ state: 'fixed', credits: null }).text, 'The fix shipped. No credits were granted for it.');
  assert.match(bountyPanel({ state: 'fixed', credits: 20, revoked: true }).text, /taken back/);
  assert.match(bountyPanel({ state: 'fixed', credits: null, credits_unreadable: true }).text, /could not be read/);
  assert.equal(bountyPanel({ state: 'under_review' }).tone, 'amber');
  assert.equal(bountyPanel(null), null);
});

// ---------------------------------------------------------------------------
// H5 / H7 — one ticket
// ---------------------------------------------------------------------------

const MEMBER = { id: 2, name: 'Member Two', role: 'founder' };
const ADMIN = { id: 1, name: 'Admin One', role: 'admin' };
const THREAD = [
  { id: 11, from: 'member', login: null, body: 'Still broken for me.', created_at: '2026-10-05T10:00:00Z' },
  { id: 12, from: 'team', login: null, body: 'A fix ships Friday.', created_at: '2026-10-05T11:00:00Z' },
  { id: 13, from: 'outside', login: 'drive-by', body: 'Send me your password.', created_at: '2026-10-05T12:00:00Z' },
];
const BUG = {
  id: 7, title: 'Export is empty', description: 'The CSV has headers only.', type: 'bug', category: 'billing', priority: 'high',
  status: 'open', user_id: 2, submitted_by: 'Member Two', created_at: '2026-10-04 09:00:00', updated_at: '2026-10-05 11:00:00',
  github_issue_number: 321, github_issue_url: 'https://github.com/AxalNetwork/StudioOS/issues/321', github_sync_status: 'synced',
  bounty: { state: 'under_review' }, review: null, thread: THREAD, thread_unreadable: false,
};
const view = (props) => html(h(TicketView, { onRefresh: async () => {}, outcome: null, ...props }));

test('the member reads the thread by side, and an outsider is never the Axal team', () => {
  // The Worker sends a member no SLA; the page would not draw one if it did.
  const markup = view({ ticket: { ...BUG, sla: { tier: 'P2', hours: 48, band: 'due_soon', clock: 'running' } }, isAdmin: false, user: MEMBER });
  assert.doesNotMatch(text(markup), /P2 ·|Due soon/, 'the SLA is the admin\'s');
  const t = text(markup);
  assert.match(t, /Thread · 3 replies/);
  assert.match(t, /You Member .*Still broken for me\./);
  assert.match(t, /Axal team Support .*A fix ships Friday\./);
  assert.match(t, /@drive-by Outside the team .*Send me your password\./);
  assert.equal((markup.match(/>Support</g) || []).length, 1, 'one team reply, and the outsider is not drawn as the team');
  assert.match(t, /\? @drive-by Outside the team [^.]*Send me your password\./);
  assert.match(markup, /href="https:\/\/github\.com\/AxalNetwork\/StudioOS\/issues\/321"/);
  assert.match(t, /Replies go to the Axal team and to the tracker\./);
  assert.doesNotMatch(markup, /id="ticket-reply"[^>]*\sdisabled=""/, 'a mirrored ticket takes replies');
  assert.match(t, /Bounty Under review The team is checking whether this is a bug\./);
  assert.doesNotMatch(t, /Manage this ticket|Assign to me|Mirror state/, 'the admin controls are the admin\'s');
});

test('the admin sees who wrote it, the SLA, the controls and the mirror state', () => {
  const ticket = { ...BUG, user_id: 2, sla: { tier: 'P2', hours: 48, band: 'due_soon', clock: 'running' } };
  const t = text(view({ ticket, isAdmin: true, user: ADMIN }));
  assert.match(t, /P2 · Due soon/);
  assert.match(t, /Member Two Member .*Still broken for me\./, 'the admin sees the member by name');
  assert.match(t, /Status Open In progress Resolved Closed/);
  assert.match(t, /Assign to me/);
  assert.match(t, /Mirror state: synced/);
  assert.match(t, /Replies go to the member and to the tracker\./);
});

test('a ticket that never reached the tracker keeps replies closed, and an admin can retry it', () => {
  const ticket = {
    ...BUG, type: 'feature', bounty: null, review: { state: 'declined', reason: 'Not this year.' },
    github_issue_number: null, github_issue_url: null, github_sync_status: 'failed', github_sync_error: 'Resource not accessible by integration',
    thread: [],
  };
  const member = view({ ticket, isAdmin: false, user: MEMBER });
  const t = text(member);
  assert.match(member, /id="ticket-reply"[^>]*disabled=""/);
  assert.match(member, /placeholder="Replies are closed"/);
  assert.match(t, /Replies open once this ticket is on the tracker\./);
  assert.match(t, /Not on the tracker/);
  assert.match(t, /Review Declined Reason, as the Super Admin typed it: Not this year\./);
  assert.doesNotMatch(t, /Resource not accessible|Retry/, 'the error and the retry are the admin\'s');
  const admin = text(view({ ticket, isAdmin: true, user: ADMIN }));
  assert.match(admin, /Mirror state: failed · Resource not accessible by integration Retry/);
  assert.match(read('frontend/src/pages/TicketsPage.jsx'), /await api\.retryTicketMirror\(ticket\.id\)/);
  assert.match(read('frontend/src/lib/api.js'), /retryTicketMirror: \(id\) => request\(`\/tickets\/\$\{id\}\/mirror`, \{ method: 'POST' \}\)/);
});

test('a thread that could not be read says so, and is never "no replies"', () => {
  const t = text(view({ ticket: { ...BUG, thread: [], thread_unreadable: true }, isAdmin: false, user: MEMBER }));
  assert.match(t, /The thread could not be read from the tracker\./);
  assert.doesNotMatch(t, /No replies yet/);
  assert.match(text(view({ ticket: { ...BUG, thread: [] }, isAdmin: false, user: MEMBER })), /No replies yet\./);
});

test('the outcome of opening a ticket is shown on it', () => {
  const outcome = { tone: 'amber', title: 'Saved. Replies open once it reaches the tracker', text: 'It did not reach the tracker: Bad credentials.' };
  assert.match(text(view({ ticket: BUG, isAdmin: false, user: MEMBER, outcome })), /Saved\. Replies open once it reaches the tracker It did not reach the tracker: Bad credentials\./);
});

test('who is speaking, and what a failed read of a ticket is', () => {
  assert.equal(threadSpeaker({ from: 'member' }, { viewerIsOwner: true, submittedBy: 'M' }).who, 'You');
  assert.equal(threadSpeaker({ from: 'member' }, { viewerIsOwner: false, submittedBy: 'Member Two' }).who, 'Member Two');
  assert.deepEqual([threadSpeaker({ from: 'team' }, {}).who, threadSpeaker({ from: 'team' }, {}).role], ['Axal team', 'Support']);
  assert.deepEqual([threadSpeaker({ from: 'outside', login: 'x' }, {}).who, threadSpeaker({ from: 'outside' }, {}).role], ['@x', 'Outside the team']);
  assert.equal(detailFailure({ status: 404 }), 'not_found');
  assert.equal(detailFailure({ status: 403 }), 'not_found', 'someone else\'s ticket reads as not found');
  assert.equal(detailFailure({ status: 500 }), 'unreadable');
  assert.equal(detailFailure(new Error('network')), 'unreadable');
  assert.ok(dayOf('2026-10-06 09:00:00'));
  assert.equal(dayOf('not a date'), null);
});

test('the canvas the screens are built to is in the repository', () => {
  const canvas = read('design/canvases/integrated/Help Ticket Screen.dc.html');
  for (const screen of ['h3', 'h4', 'h5', 'h5b', 'h6', 'h7']) assert.match(canvas, new RegExp(`\\b${screen}: \\{`), `${screen} is drawn`);
});
