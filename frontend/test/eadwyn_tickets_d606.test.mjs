/**
 * D606 (#1107, #1108) — the owner's Eadwyn Tickets canvas
 * (`design/canvases/integrated/Eadwyn Tickets Screen.dc.html`): the Super
 * Admin's review queue at /hq/review (T1, T1b) and the Eadwyn chat's Tasks and
 * My tickets panels (T2, T3).
 *
 * What is pinned, and why:
 *   - a tab's count is the number waiting, and it is withheld (never 0) while
 *     a list is loading or could not be read;
 *   - the queue's filters, order and "1–25 of [N]" agree, and a queue past the
 *     200 the Worker returns says so;
 *   - a decision needs a typed reason of the Worker's length, approvals too;
 *   - the reward on a task's Approve comes from the credit rules, never code;
 *   - a suggestion shows what its grant paid; a balance that could not be
 *     read is withheld, never 0;
 *   - the chat's ticket form has no default type except from "Suggest a task".
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_tickets_d606.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  AUDIENCES, NO_QUEUE_FILTERS, QUEUE_PAGE, REASON_MIN, approveCopy, approveLabel, balanceLine, bountyRatesNote,
  decisionOutcome, decisionRefusal, matchesQueue, panelTickets, queueView, reasonHint, reasonReady, rewardNote,
  sortQueue, startPrompt, suggestNote, suggestionLine, tabCount, tabFromSearch, taskLine, taskReward,
} from '../src/lib/eadwynTickets.js';
import { QueueList, DecisionPanel } from '../src/pages/hq/ReviewQueuePage.jsx';
import { TasksPanelView, TicketsPanelView, PANEL_TABS } from '../src/components/advisor/EadwynPanels.jsx';
import { TicketView } from '../src/pages/TicketsPage.jsx';
import { ticketReviewsApi } from '../src/lib/api/ticketReviews.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const NOW = Date.parse('2026-10-06T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();
const ready = (data) => ({ status: 'ready', data });
const RULES = (o = {}) => ready({ rewards: {
  task_approved: { credits: 10, active: true },
  bug_high: { credits: 150, active: true },
  bug_medium: { credits: 60, active: true },
  bug_low: { credits: 20, active: true },
  ...o,
} });

// ---------------------------------------------------------------------------
// T1, T1b — the queue's logic
// ---------------------------------------------------------------------------

test('the reason floor is the Worker\'s, and a short reason cannot be sent', () => {
  const worker = read('cloudflare-worker/src/routes/admin_ticket_reviews.ts');
  assert.match(worker, new RegExp(`export const REVIEW_REASON_MIN = ${REASON_MIN};`));
  assert.equal(reasonReady('Too short'), false);
  assert.equal(reasonReady('   ten chars! '), true);
  assert.equal(reasonHint(''), `At least ${REASON_MIN} characters (0 so far). It is recorded with the decision.`);
  assert.equal(reasonHint('Clear enough now'), null);
});

test('?tab=tasks opens T1b and anything else T1; the audiences are the Worker\'s, in its order', () => {
  assert.equal(tabFromSearch('?tab=tasks'), 'tasks');
  assert.equal(tabFromSearch('?tab=features'), 'features');
  assert.equal(tabFromSearch(''), 'features');
  const worker = read('cloudflare-worker/src/routes/admin_ticket_reviews.ts');
  const listed = JSON.parse(worker.match(/export const AUDIENCES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(AUDIENCES.map((a) => a.id), listed);
});

test('search, priority and date filter the queue; the most pressing come first', () => {
  const items = [
    { ticket_id: 1, title: 'Export to CSV', priority: 'medium', created_at: daysAgo(40) },
    { ticket_id: 2, title: 'Dark charts', priority: 'urgent', created_at: daysAgo(2) },
    { ticket_id: 3, title: 'Export to PDF', priority: 'urgent', created_at: daysAgo(10) },
    { ticket_id: 4, title: 'No date on record', priority: 'low', created_at: null },
  ];
  assert.deepEqual(sortQueue(items).map((x) => x.ticket_id), [3, 2, 1, 4], 'urgent first, oldest first within it');
  const pick = (f) => items.filter((x) => matchesQueue(x, { ...NO_QUEUE_FILTERS, ...f }, NOW)).map((x) => x.ticket_id);
  assert.deepEqual(pick({ query: 'export' }), [1, 3]);
  assert.deepEqual(pick({ priority: 'urgent' }), [2, 3]);
  assert.deepEqual(pick({ window: '7' }), [2]);
  assert.deepEqual(pick({ window: '30' }), [2, 3]);
  assert.deepEqual(pick({ window: 'older' }), [1], 'a row with no date matches no window');
});

test('"1–25 of [N]" names the number waiting, and past the loaded 200 says so', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ ticket_id: i + 1, title: `Ask ${i}`, priority: 'low', created_at: daysAgo(i) }));
  const first = queueView(items, { total: 30, now: NOW });
  assert.equal(first.rows.length, QUEUE_PAGE);
  assert.equal(first.label, '1–25 of 30');
  assert.equal(first.partial, null);
  const second = queueView(items, { total: 30, page: 2, now: NOW });
  assert.equal(second.label, '26–30 of 30');
  const capped = queueView(items, { total: 412, now: NOW });
  assert.equal(capped.label, '1–25 of 412');
  assert.equal(capped.partial, 'The oldest 30 of 412 waiting are loaded. Decide some to reach the rest.');
  const filtered = queueView(items, { filters: { ...NO_QUEUE_FILTERS, query: 'Ask 1' }, total: 412, now: NOW });
  assert.equal(filtered.label.endsWith(` of ${filtered.matched}`), true, 'a filtered view counts what matched, not what waits');
});

test('a tab\'s count is withheld while loading or unreadable, never 0', () => {
  assert.equal(tabCount({ status: 'loading' }), null);
  assert.equal(tabCount({ status: 'unreadable' }), null);
  assert.equal(tabCount(ready({ items: [], count: 0, total: 0 })), 0);
  assert.equal(tabCount(ready({ items: [], count: 200, total: 236 })), 236);
});

test('a task\'s reward is read from the rules: on, off, absent or unreadable', () => {
  assert.deepEqual(taskReward(RULES()), { state: 'on', credits: 10 });
  assert.equal(approveLabel('tasks', taskReward(RULES({ task_approved: { credits: 25, active: true } }))), 'Approve · +25 credits');
  assert.equal(approveLabel('features', taskReward(RULES())), 'Approve', 'a feature earns nothing (#1102 Q2 A)');
  const off = taskReward(RULES({ task_approved: { credits: 10, active: false } }));
  assert.equal(off.state, 'off');
  assert.equal(approveLabel('tasks', off), 'Approve');
  assert.match(rewardNote(off), /switched off/);
  assert.equal(taskReward(RULES({ task_approved: null })).state, 'none');
  const unread = taskReward({ status: 'unreadable' });
  assert.equal(unread.state, 'unreadable');
  assert.match(rewardNote(unread), /could not be read/);
  assert.equal(rewardNote(taskReward(RULES())), null);
});

test('the confirm sentence and the outcome say what the route did', () => {
  assert.equal(approveCopy('features', { title: 'Dark charts' }), 'Sends “Dark charts” to the build queue. The requester sees “Approved” on their ticket.');
  assert.equal(
    approveCopy('tasks', { title: 'Share a template' }, { audience: 'founder', reward: { state: 'on', credits: 10 } }),
    'Publishes “Share a template” to the Task list of founders and rewards the suggester 10 credits.',
  );
  assert.equal(
    decisionOutcome('features', 'approved', { label_status: 'added', notified: true }),
    'Approved. It goes to the build queue. The GitHub issue is labelled feature:approved. The requester was told in their inbox.',
  );
  assert.match(decisionOutcome('features', 'declined', { label_status: 'not_configured', notified: false }), /no label was added\. The requester could not be told/);
  assert.equal(
    decisionOutcome('tasks', 'approved', { audience: 'all', reward: { status: 'granted', credits: 10 } }),
    'Approved and published to all users. The suggester was paid 10 credits.',
  );
  assert.equal(
    decisionOutcome('tasks', 'approved', { audience: 'investor', reward: { status: 'refused', code: 'rule_inactive', message: 'The task_approved reward is switched off, so nothing was granted.' } }),
    'Approved and published to investors. No credits were paid: The task_approved reward is switched off, so nothing was granted.',
  );
  assert.match(decisionRefusal({ status: 409, message: 'This request was already approved; nothing was changed.' }), /already approved; nothing was changed\. Reload the queue/);
});

// ---------------------------------------------------------------------------
// T1, T1b — rendered
// ---------------------------------------------------------------------------

const FEATURE = {
  ticket_id: 41, title: 'Dark charts on the dashboard', body: 'The charts are hard to read at night.', priority: 'high',
  created_at: daysAgo(3), asked_by: { user_id: 7, name: 'Fay Founder', email: 'fay@example.test' },
  github_issue_number: 1301, github_issue_url: 'https://github.com/AxalNetwork/StudioOS/issues/1301',
};
const TASK = { ...FEATURE, id: 5, ticket_id: 42, title: 'Share a cap-table template', github_issue_number: null, github_issue_url: null };
const list = (tab, read, extra = {}) => html(h(QueueList, {
  tab, read, reward: taskReward(RULES()), filters: NO_QUEUE_FILTERS, page: 1, onPage() {}, onClearFilters() {},
  outcomes: {}, onDecide: async () => {}, onRetry() {}, now: NOW, ...extra,
}));

test('the queue renders its loading, unreadable and empty states, each in its own words', () => {
  assert.match(list('features', { status: 'loading' }), /data-testid="review-loading"/);
  const bad = text(list('features', { status: 'unreadable' }));
  assert.match(bad, /Unreadable The queue could not be read\. The count on the tab is withheld, not zero\. Try again/);
  assert.match(text(list('features', ready({ items: [], count: 0, total: 0 }))), /No feature requests are waiting for review\./);
  assert.match(text(list('tasks', ready({ items: [], count: 0, total: 0 }))), /No suggested tasks are waiting for review\./);
});

test('a feature request shows its text, who asked, the date and its GitHub issue', () => {
  const markup = list('features', ready({ items: [FEATURE], count: 1, total: 1 }));
  const t = text(markup);
  assert.match(t, /Dark charts on the dashboard High Feature/);
  assert.match(t, /The charts are hard to read at night\./);
  assert.match(t, /Asked by Fay Founder · fay@example\.test/);
  assert.match(markup, /href="https:\/\/github\.com\/AxalNetwork\/StudioOS\/issues\/1301"[^>]*>GitHub #1301/);
  assert.match(t, /1–1 of 1/);
  assert.doesNotMatch(markup, /review-audience/, 'a feature has no audience picker');
  assert.match(markup, /data-testid="review-approve"[^>]*>Approve</);
});

test('a suggested task has the audience picker and the reward on its button; one off the tracker says so', () => {
  const markup = list('tasks', ready({ items: [TASK], count: 1, total: 1 }));
  const opts = [...markup.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(opts, AUDIENCES.map((a) => a.id));
  assert.match(markup, /data-testid="review-approve"[^>]*>Approve · \+10 credits</);
  assert.match(text(markup), /Not on the GitHub tracker/);
  const off = list('tasks', ready({ items: [TASK], count: 1, total: 1 }), { reward: taskReward(RULES({ task_approved: { credits: 10, active: false } })) });
  assert.match(off, /data-testid="review-approve"[^>]*>Approve</);
  assert.match(text(off), /The task reward is switched off in the credit rules, so approving pays nothing\./);
});

test('a decided item shows its outcome instead of its buttons', () => {
  const markup = list('features', ready({ items: [FEATURE], count: 1, total: 1 }), {
    outcomes: { 41: { decision: 'declined', text: 'Declined, with your reason. The requester was told in their inbox.' } },
  });
  assert.match(text(markup), /Declined, with your reason\. The requester was told in their inbox\./);
  assert.doesNotMatch(markup, /data-testid="review-approve"/);
});

test('both confirm panels ask for the reason, and stay closed to a click until it is long enough', () => {
  const approve = html(h(DecisionPanel, { kind: 'approve', tab: 'tasks', item: TASK, audience: 'partner', reward: { state: 'on', credits: 10 }, busy: false, error: null, onCancel() {}, onConfirm() {} }));
  const a = text(approve);
  assert.match(a, /Approve · confirm Publishes “Share a cap-table template” to the Task list of partners and rewards the suggester 10 credits\./);
  assert.match(a, /Audience: Partners · suggester Fay Founder receives \+10 credits/);
  assert.match(a, /Why approve\? Recorded with the decision; the requester is not sent it\./);
  assert.match(approve, /<button type="button" disabled=""[^>]*data-testid="review-approve-confirm"/);
  const decline = html(h(DecisionPanel, { kind: 'decline', tab: 'features', item: FEATURE, audience: 'all', reward: null, busy: false, error: 'This request was already approved; nothing was changed.', onCancel() {}, onConfirm() {} }));
  const d = text(decline);
  assert.match(d, /Decline · reason required The user sees this reason on their ticket\./);
  assert.match(d, /At least 10 characters \(0 so far\)\./);
  assert.match(decline, /role="alert"[^>]*>This request was already approved; nothing was changed\./);
  assert.match(decline, /<button type="button" disabled=""[^>]*data-testid="review-decline-confirm"/);
});

// ---------------------------------------------------------------------------
// T2 — Tasks
// ---------------------------------------------------------------------------

test('a suggestion\'s state names what its grant paid, never the rule', () => {
  assert.deepEqual(suggestionLine({ status: 'pending' }), { text: 'Pending review', tone: 'amber' });
  assert.deepEqual(suggestionLine({ status: 'approved', reward: { credits: 12, revoked: false } }), { text: 'Approved · +12 credits', tone: 'green' });
  assert.equal(suggestionLine({ status: 'approved', reward: { credits: 12, revoked: true } }).text, 'Approved · credits taken back');
  assert.equal(suggestionLine({ status: 'approved', reward: { credits: null, revoked: false } }).text, 'Approved · no credits paid');
  assert.equal(suggestionLine({ status: 'approved', reward: { credits: null, credits_unreadable: true } }).text, 'Approved · credits could not be read');
  assert.deepEqual(suggestionLine({ status: 'declined', decline_reason: 'Not useful to others' }), { text: 'Declined', tone: 'red', reason: 'Not useful to others' });
  assert.equal(taskLine('  Share it\n\nwith the cohort  '), 'Share it with the cohort');
  assert.equal(taskLine(''), null);
  assert.equal(startPrompt({ title: 'Post your first update' }), 'Help me with Post your first update');
  assert.match(read('frontend/src/components/advisor/PersonalAdvisor.jsx'), /const m = raw\.match\(\/\^\\s\*\(\?:explain\|what is\|what's\|tell me about\|help me with\|/,
    '"Start" relies on the chat reading "help me with" as an explanation, not an answer');
});

test('the Tasks panel: community tasks with Start, my suggestions with their states, and the note', () => {
  const data = {
    tasks: [{ id: 1, title: 'Share a cap-table template', body: 'Upload the one you use.', audience: 'all' }],
    my_suggestions: [
      { id: 3, title: 'Post a weekly update', status: 'approved', decline_reason: null, reward: { credits: 10, revoked: false } },
      { id: 2, title: 'Record a demo', status: 'declined', decline_reason: 'Decks are private by default here' },
      { id: 4, title: 'Join a cohort call', status: 'pending', decline_reason: null, reward: null },
    ],
    my_suggestions_next: 2,
  };
  const t = text(html(h(TasksPanelView, { list: ready(data), rewards: RULES(), onSuggest() {}, onStart() {}, onRetry() {}, onOlder() {} })));
  assert.match(t, /Community tasks Suggest a task Share a cap-table template Upload the one you use\. Start →/);
  assert.match(t, /My suggestions Post a weekly update Approved · \+10 credits Record a demo Declined Decks are private by default here Join a cohort call Pending review/);
  assert.match(t, /Show older suggestions/);
  assert.match(t, /“Suggest a task” opens the ticket form with Type set to Task\. An approved suggestion earns 10 credits\./);
  assert.equal(suggestNote({ status: 'unreadable' }), '“Suggest a task” opens the ticket form with Type set to Task.');
});

test('the Tasks panel says "No tasks yet" only for an empty list, and unreadable for a failed one', () => {
  const empty = text(html(h(TasksPanelView, { list: ready({ tasks: [], my_suggestions: [], my_suggestions_next: null }), rewards: RULES(), onSuggest() {}, onStart() {}, onRetry() {}, onOlder() {} })));
  assert.match(empty, /No tasks yet\./);
  assert.match(empty, /You have not suggested a task yet\./);
  const bad = text(html(h(TasksPanelView, { list: { status: 'unreadable' }, rewards: RULES(), onSuggest() {}, onStart() {}, onRetry() {}, onOlder() {} })));
  assert.match(bad, /Unreadable\. The task list could not be read\. This is not a sign there are none\. Try again/);
  assert.doesNotMatch(bad, /No tasks yet/);
});

// ---------------------------------------------------------------------------
// T3 — My tickets
// ---------------------------------------------------------------------------

test('the balance is a number once read, and withheld, never 0, when it could not be', () => {
  assert.deepEqual(balanceLine(ready({ balance: 12 })), { state: 'ready', text: '12 credits' });
  assert.equal(balanceLine(ready({ balance: 1 })).text, '1 credit');
  assert.equal(balanceLine(ready({ balance: 0 })).text, '0 credits', 'a read zero is a real zero');
  for (const r of [{ status: 'unreadable' }, ready({})]) {
    const b = balanceLine(r);
    assert.equal(b.state, 'unreadable');
    assert.doesNotMatch(b.text, /\b0\b/);
  }
});

test('what a fixed bug earns is by graded tier, from the rules; an off or missing rule says so', () => {
  assert.equal(bountyRatesNote(RULES()), 'A confirmed bug earns credits when the fix ships, by the tier it is graded at: High +150, Medium +60, Low +20.');
  assert.equal(
    bountyRatesNote(RULES({ bug_high: { credits: 175, active: true }, bug_low: { credits: 20, active: false }, bug_medium: null })),
    'A confirmed bug earns credits when the fix ships, by the tier it is graded at: High +175, Medium: not set, Low: not paid now.',
  );
  assert.equal(bountyRatesNote({ status: 'unreadable' }), 'What a fixed bug earns could not be read just now.');
  assert.equal(bountyRatesNote({ status: 'loading' }), null);
});

test('My tickets lists the five most recent with type, priority and bounty or review', () => {
  const rows = [
    { id: 1, title: 'Old one', type: 'task', priority: 'low', updated_at: '2026-09-01 10:00:00', bounty: null, review: null },
    { id: 2, title: 'Export is empty', type: 'bug', priority: 'high', updated_at: '2026-10-05 10:00:00', bounty: { state: 'fixed', credits: 150, revoked: false }, review: null },
    { id: 3, title: 'Not reproducible', type: 'bug', priority: 'low', updated_at: '2026-10-04 10:00:00', bounty: { state: 'not_a_bug' }, review: null },
    { id: 4, title: 'Dark charts', type: 'feature', priority: 'medium', updated_at: '2026-10-03 10:00:00', bounty: null, review: { state: 'declined', reason: 'Not now' } },
    { id: 5, title: 'Same as #2', type: 'bug', priority: 'medium', updated_at: '2026-10-02 10:00:00', bounty: { state: 'duplicate' }, review: null },
    { id: 6, title: 'Mid', type: 'task', priority: 'medium', updated_at: '2026-09-20 10:00:00', bounty: null, review: null },
  ];
  assert.deepEqual(panelTickets(rows).map((t) => t.id), [2, 3, 4, 5, 6]);
  const markup = html(h(TicketsPanelView, { tickets: ready(rows), balance: ready({ balance: 170 }), rewards: RULES(), onRetry() {} }));
  const t = text(markup);
  assert.match(t, /170 credits US\$1 each · spent on Perks Perks →/);
  assert.match(t, /Export is empty Bug High Fixed: 150 credits #2/);
  assert.match(t, /Not reproducible Bug Low Not a bug The reason is in the ticket’s comments\. Open the ticket →/);
  assert.match(t, /Dark charts Feature Medium Declined/);
  assert.match(t, /Same as #2 Bug Medium Duplicate The original is named in the ticket’s comments\. Open the ticket →/);
  assert.doesNotMatch(t, /Old one/);
  assert.match(markup, /href="\/help\/tickets"[^>]*>All tickets →/);
  assert.match(markup, /href="\/perks"/);
});

test('My tickets: a failed read is said as one, and the balance stays withheld on its own', () => {
  const t = text(html(h(TicketsPanelView, { tickets: { status: 'unreadable' }, balance: { status: 'unreadable' }, rewards: RULES(), onRetry() {} })));
  assert.match(t, /Your balance could not be read\. It is withheld, not zero\./);
  assert.match(t, /Unreadable\. Your tickets could not be read\. This is not a sign that you have none\. Try again/);
  assert.doesNotMatch(t, /\b0 credits\b/);
  const none = text(html(h(TicketsPanelView, { tickets: ready([]), balance: ready({ balance: 0 }), rewards: RULES(), onRetry() {} })));
  assert.match(none, /You have not opened a ticket\./);
});

// ---------------------------------------------------------------------------
// Where it is wired
// ---------------------------------------------------------------------------

test('/hq/review is a route, the Super Admin\'s, under Support', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/hq\/review" element=\{guard\(\['admin'\], hqOnly\(<ReviewQueuePage \/>\)\)\} \/>/);
  const sidebar = read('frontend/src/sidebarConfig.js');
  assert.match(sidebar, /\{ to: '\/admin\/hq-support', icon: Inbox, label: 'Support', match: \['\/admin\/hq-support', '\/hq\/review'\] \}/);
  assert.match(read('frontend/src/pages/hq/HqSupportPage.jsx'), /<Link to="\/hq\/review"/);
});

test('the client calls the review routes the Worker mounts', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /['"]\/api\/admin\/ticket-reviews['"]/);
  const src = read('frontend/src/lib/api/ticketReviews.js');
  for (const path of ['/admin/ticket-reviews/features', '/admin/ticket-reviews/tasks']) assert.ok(src.includes(`'${path}'`), path);
  for (const m of ['features', 'tasks', 'approveFeature', 'declineFeature', 'approveTask', 'declineTask']) assert.equal(typeof ticketReviewsApi[m], 'function', m);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/ticketReviews\.js';/);
});

test('the chat carries the panel\'s three tabs, and "Suggest a task" opens the form on Task', () => {
  assert.deepEqual(PANEL_TABS.map((t) => t.label), ['Conversation', 'Tasks', 'My tickets']);
  const pa = read('frontend/src/components/advisor/PersonalAdvisor.jsx');
  assert.match(pa, /const suggestTask = useCallback\(\(\) => \{ setTicketPreset\('task'\); setTicketOpen\(true\); \}, \[\]\);/);
  assert.match(pa, /setInput\(startPrompt\(task\)\);/);
  assert.match(pa, /<AdvisorTicketPanel key=\{ticketPreset \|\| 'any'\} initialType=\{ticketPreset\}/);
  assert.match(pa, /\{!isDesktop && <PanelTabs tab=\{panelTab\} onTab=\{setPanelTab\} \/>\}/, 'the phone has no tabs');
  assert.ok((pa.match(/<TasksPanel onSuggest=/g) || []).length >= 3, 'a view lost its Tasks panel');
  assert.match(pa, /<option value="" disabled>Choose a type<\/option>/);
});

test('H7 links an awaiting feature request to the queue for the Super Admin only', () => {
  const feature = {
    id: 9, title: 'Dark charts', description: 'Please.', type: 'feature', category: null, priority: 'medium', status: 'open',
    user_id: 2, submitted_by: 'Member Two', created_at: '2026-10-04 09:00:00', updated_at: '2026-10-05 11:00:00',
    github_issue_number: 77, github_issue_url: 'https://github.com/AxalNetwork/StudioOS/issues/77', github_sync_status: 'synced',
    bounty: null, review: { state: 'awaiting' }, thread: [], thread_unreadable: false,
  };
  const render = (user) => html(h(TicketView, { ticket: feature, isAdmin: user.role === 'admin', user, outcome: null, onRefresh: async () => {} }));
  assert.match(render({ id: 1, role: 'admin', is_super_admin: 1 }), /href="\/hq\/review"[^>]*>Feature review queue →/);
  assert.doesNotMatch(render({ id: 3, role: 'admin', is_super_admin: 0 }), /Feature review queue/);
  assert.doesNotMatch(render({ id: 2, role: 'founder' }), /Feature review queue/);
  const decided = html(h(TicketView, { ticket: { ...feature, review: { state: 'approved' } }, isAdmin: true, user: { id: 1, role: 'admin', is_super_admin: 1 }, outcome: null, onRefresh: async () => {} }));
  assert.doesNotMatch(decided, /Feature review queue/, 'a decided request has nothing left to review');
});

test('the canvas is committed beside its routes, and draws the four screens built here', () => {
  const shell = 'design/canvases/integrated/Eadwyn Tickets.dc.html';
  const screen = 'design/canvases/integrated/Eadwyn Tickets Screen.dc.html';
  assert.ok(existsSync(resolve(ROOT, shell)) && existsSync(resolve(ROOT, screen)));
  const s = read(shell);
  for (const id of ['T1', 'T1b', 'T2', 'T3']) assert.match(s, new RegExp(`id: '${id}'`));
  assert.match(s, /<dc-import name="Eadwyn Tickets Screen"/);
  const c = read(screen);
  for (const id of ['queue-features', 'queue-tasks', 'chat-tasks', 'chat-tickets']) assert.ok(c.includes(id), id);
  assert.match(c, /The queue could not be read\. The count on the tab is withheld, not zero\./);
  assert.doesNotMatch(c, /__bundler|data:font/);
});
