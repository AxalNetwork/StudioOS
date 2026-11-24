/**
 * D6865 part 2 (#6891) — Grow › Customers › Feedback's tab frame and body, the
 * Add feedback and Save as feedback sheets, Save as feedback from an Inbox
 * reply and an interview, and Eadwyn's placement review (the #6099 canvas,
 * GR-21, GR-21B, GR-21C, GR-24, GR-25, GR-27, GR-29). Every person, company
 * and figure below is made up.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/feedback_tab_6891.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import FeedbackTab, { FeedbackRow, PlacementReview, addFeedbackAction } from '../src/pages/cycles/FeedbackTab.jsx';
import FeedbackSheet from '../src/pages/cycles/FeedbackSheet.jsx';
import InboxTab, { MessageBubble } from '../src/pages/cycles/distribution/InboxTab.jsx';
import InterviewSaveFeedback from '../src/pages/founder/InterviewSaveFeedback.jsx';
import { GrowSubsections } from '../src/pages/cycles/CycleOverview.jsx';
import { growTabCounts } from '../src/pages/cycles/growOverviewModel.js';
import { adaptRecords } from '../src/pages/cycles/adapters/index.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
import {
  NO_THEME, blankValues, consentWord, feedbackBody, interviewValues, itemsFor, linkedWords, matchContact, originWord, placementsFrom,
  recordChip, replyValues, selectedWithin, sheetProblem, tabCount, tabState, themesOf,
} from '../src/pages/cycles/feedbackTabModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const text = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/grow/product-improvement?project_id=7'] }, el)).replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const markup = (el, url = '/grow/product-improvement?project_id=7') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, el));

const KAI = { uid: 'ca1', name: 'Kai Mori', audience: 'customer', status: 'replied' };
const READ_ROWS = [
  { uid: 'f1', body: 'A CSV per depot', source: 'customer', theme: 'Fleet CSV', status: 'planned', from_name: 'Kai Mori', from_company: 'Kite Systems', contact: KAI, origin: 'inbox_reply', created_at: '2026-11-04 10:00:00', roadmap_item_label: 'CSV export v2' },
  { uid: 'f2', body: 'Schedule the export', source: 'investor', theme: 'Fleet CSV', status: 'open', from_name: 'Jo Park', from_company: null, contact: null, origin: null, created_at: '2026-11-09 10:00:00', roadmap_item_label: null },
  { uid: 'f3', body: 'Okta sign in', source: 'customer', theme: 'SSO', status: 'shipped', from_name: 'Lin', from_company: null, contact: null, origin: 'typed', created_at: '2026-10-01 10:00:00', roadmap_item_label: null },
  { uid: 'f4', body: 'Map is slow', source: 'team', theme: null, status: 'open', from_name: null, from_company: null, contact: null, origin: 'interview', created_at: '2026-11-10 10:00:00', roadmap_item_label: null },
];
const records = (rows) => adaptRecords('grow', 'product-improvement', { cols: ['Feedback', 'Source', 'Theme', 'Roadmap item', 'Status'], rows });
const advisorRows = READ_ROWS.map(({ from_name, from_company, contact, ...r }) => r);
const COUNTS = { items: 4, open_items: 2, themes: 2, shipped_not_told: 0, period: 'all feedback recorded on this venture' };
const WRITER = { parts: { counts: COUNTS, themes: [{ theme: 'Fleet CSV', feedback: 2 }, { theme: 'SSO', feedback: 1 }] } };
const rowHref = (r) => `/grow/product-improvement/${r.recordId}?project_id=7`;
const tab = (props) => h(FeedbackTab, { data: WRITER, records: records(READ_ROWS), recordsStatus: 'ready', rowHref, projectId: 7, search: '?project_id=7', api: null, ...props });

test('the item row: the linked-customer chip, Not linked, or none for an advisor; the origin, or Origin not recorded', () => {
  assert.equal(recordChip(undefined), null, 'an advisor read sends no contact key: no chip');
  assert.deepEqual(recordChip(null), { linked: false, text: 'Not linked to a customer record' });
  assert.deepEqual(recordChip(KAI), { linked: true, text: 'Kai Mori · Customer · Replied' });
  assert.equal(originWord('inbox_reply'), 'Inbox reply');
  assert.equal(originWord(null), 'Origin not recorded');
  const t = text(h(FeedbackRow, { f: { ...READ_ROWS[0], id: 'f1', href: '/grow/product-improvement/f1?project_id=7' } }));
  assert.match(t, /Kai Mori · Kite Systems Kai Mori · Customer · Replied Inbox reply Customer · 4 Nov/);
  assert.match(t, /Planned ↗ CSV export v2/);
  assert.match(text(h(FeedbackRow, { f: { ...READ_ROWS[1], id: 'f2' } })), /Jo Park Not linked to a customer record Origin not recorded/);
  const adv = text(h(FeedbackRow, { f: { ...advisorRows[0], id: 'f1' } }));
  assert.match(adv, /Name hidden/);
  assert.doesNotMatch(adv, /Kai|Not linked/);
});

test('the adapter keeps each row\'s own feedback, and an advisor\'s absent fields stay absent', () => {
  const w = records(READ_ROWS).rows[0].feedback;
  assert.deepEqual([w.origin, w.contact, w.from_name], ['inbox_reply', KAI, 'Kai Mori']);
  const a = records(advisorRows).rows[0].feedback;
  assert.equal(Object.hasOwn(a, 'contact'), false);
  assert.equal(Object.hasOwn(a, 'from_name'), false);
});

test('a theme\'s items: by theme, No theme yet, source and status, in the chosen order', () => {
  const rows = READ_ROWS.map((r) => ({ ...r, id: r.uid }));
  assert.deepEqual(itemsFor(rows, { theme: 'Fleet CSV' }).map((r) => r.id), ['f2', 'f1'], 'newest first');
  assert.deepEqual(itemsFor(rows, { theme: 'Fleet CSV', sort: 'oldest' }).map((r) => r.id), ['f1', 'f2']);
  assert.deepEqual(itemsFor(rows, { theme: NO_THEME }).map((r) => r.id), ['f4']);
  assert.deepEqual(itemsFor(rows, { theme: 'Fleet CSV', source: 'investor' }).map((r) => r.id), ['f2']);
  assert.deepEqual(itemsFor(rows, { status: 'open' }).map((r) => r.id), ['f4', 'f2']);
  assert.deepEqual(themesOf(undefined, rows).map((t) => [t.theme, t.feedback]), [['Fleet CSV', 2], ['SSO', 1]], 'an advisor\'s themes are counted from the rows');
});

test('which body the tab draws: loading, unreadable, nothing recorded, no theme named yet, loaded', () => {
  assert.equal(tabState({ status: 'loading' }), 'loading');
  assert.equal(tabState({ status: 'ready', recordsStatus: 'unreadable', counts: COUNTS, rows: [] }), 'unreadable');
  assert.equal(tabState({ status: 'ready', recordsStatus: 'ready', counts: { ...COUNTS, items: 0, themes: 0 }, rows: [] }), 'empty');
  assert.equal(tabState({ status: 'ready', recordsStatus: 'ready', counts: { ...COUNTS, items: 1, themes: 0 }, rows: [{ theme: null }] }), 'unthemed');
  assert.equal(tabState({ status: 'ready', recordsStatus: 'ready', counts: null, rows: [{ theme: 'A' }] }), 'loaded', 'an unreadable count does not make the tab empty');
  assert.equal(tabState({ status: 'ready', recordsStatus: 'ready', counts: COUNTS, rows: [{ theme: 'A' }] }), 'loaded');
});

test('the tab frame: Pipeline · Accounts · Feedback with the Feedback count; Accounts is drawn, not linked; no count is not 0', () => {
  assert.deepEqual(growTabCounts('product-improvement', { parts: { counts: { items: 41 } } }), { 'product-improvement': 41 });
  assert.deepEqual(growTabCounts('product-improvement', { parts: { counts: { items: 0 } } }), { 'product-improvement': 0 });
  assert.equal(growTabCounts('product-improvement', { parts: { counts: null } }), null);
  assert.equal(growTabCounts('customers', { parts: { counts: { items: 3 } } }), null);
  assert.equal(tabCount(null), null);
  const html = markup(h(GrowSubsections, { search: '?project_id=7', active: 'product-improvement', counts: { 'product-improvement': 41 } }));
  assert.match(html, /aria-label="Customers pages"/);
  assert.match(html, /<a[^>]+href="\/grow\/customers\?project_id=7"[^>]*>Pipeline<\/a>/);
  assert.match(html, /<span[^>]+aria-disabled="true"[^>]*>Accounts/);
  assert.doesNotMatch(html, /href="\/grow\/accounts/);
  assert.match(html, /<a aria-current="page"[^>]+href="\/grow\/product-improvement\?project_id=7"[^>]*>Feedback<span[^>]*>41<\/span><\/a>/);
  assert.doesNotMatch(markup(h(GrowSubsections, { search: '', active: 'product-improvement', counts: null })), /grow-subsection-count/);
});

test('Add feedback is the one primary action, and none while nothing is recorded or for an advisor', () => {
  assert.deepEqual(addFeedbackAction(WRITER, '?project_id=7'), { label: 'Add feedback', href: '/grow/product-improvement?project_id=7&add=feedback' });
  assert.equal(addFeedbackAction({ parts: { counts: { ...COUNTS, items: 0 }, themes: [] } }, '?project_id=7'), null);
  assert.equal(addFeedbackAction({ parts: { counts: COUNTS } }, '?project_id=7'), null, 'an advisor has no parts.themes');
  assert.equal(addFeedbackAction(null, ''), null);
});

test('the loaded tab: counts, themes ranked, the first theme\'s items with chip and origin, record links unchanged', () => {
  const html = markup(tab());
  const t = text(tab());
  assert.match(t, /2 open items 2 themes 0 shipped and not yet told/);
  assert.match(t, /Fleet CSV 2 .* SSO 1 .* No theme yet · 1/);
  assert.match(t, /Fleet CSV · 2 items 1 open · 1 planned · 0 shipped/);
  assert.match(html, /href="\/grow\/product-improvement\/f1\?project_id=7"/);
  assert.match(t, /Kai Mori · Customer · Replied/);
  assert.doesNotMatch(t, /Okta sign in/, 'another theme\'s item is not in the list');
  assert.doesNotMatch(t, /Name hidden|You can read this venture/);
});

test('an advisor reads the themes and feedback with names hidden, and no weight or chips', () => {
  const t = text(tab({ data: { parts: { counts: COUNTS } }, records: records(advisorRows) }));
  assert.match(t, /You can read this venture’s feedback\./);
  assert.match(t, /Name hidden/);
  assert.match(t, /Fleet CSV 2/);
  assert.doesNotMatch(t, /Kai|Not linked|Reading this theme/);
});

test('nothing recorded: one primary action and two quieter sources; unreadable is never 0', () => {
  const empty = tab({ data: { parts: { counts: { ...COUNTS, items: 0, open_items: 0, themes: 0 }, themes: [] } }, records: records([]) });
  const t = text(empty);
  assert.match(t, /No feedback recorded yet/);
  assert.match(markup(empty), /data-testid="feedback-empty-add"[^>]*>Add feedback|href="\/grow\/product-improvement\?project_id=7&amp;add=feedback"/);
  assert.match(t, /Save replies from the Inbox .* Save notes from interviews/);
  assert.equal((markup(empty).match(/bg-axal-violet /g) || []).length, 1, 'one primary action');
  const bad = text(tab({ recordsStatus: 'unreadable', records: { state: 'unreadable', rows: [] } }));
  assert.match(bad, /Pipeline and Accounts still work\. Nothing is shown as 0\./);
  assert.doesNotMatch(bad, /\b0 (open|themes)/);
  assert.match(markup(tab({ status: 'loading', recordsStatus: 'loading', records: null })), /aria-busy="true"/);
});

test('after the first save: one row with no theme, Themes a measured 0, and no theme offered', () => {
  const rows = [{ uid: 'n1', body: 'The map is slow', source: 'customer', theme: null, status: 'open', from_name: 'Lena Aas', contact: null, origin: 'typed', created_at: '2026-11-14 10:00:00' }];
  const t = text(tab({ data: { parts: { counts: { ...COUNTS, items: 1, open_items: 1, themes: 0 }, themes: [] } }, records: records(rows) }));
  assert.match(t, /Themes: 0, measured · 1 item has no theme/);
  assert.match(t, /No themes yet Name a theme on an item with Change theme\. Eadwyn places later items only into themes you name\./);
  assert.match(t, /No theme yet · 1 item/);
  assert.match(t, /Lena Aas Not linked to a customer record Typed/);
});

test('the sheets\' values: an Inbox reply\'s selected words and linked record; an interviewee linked only on one match', () => {
  const thread = { contact: { uid: 'ca1', name: 'Kai Mori', organization: 'Kite Systems' } };
  const message = { key: 'contact:21', body: 'Thanks. A CSV every Monday would do it.' };
  const r = replyValues({ thread, message, selection: ' A CSV every Monday ', recipient: 'kai@kite.test' });
  assert.deepEqual([r.body, r.from_name, r.from_email, r.from_company, r.contact_uid, r.notify], ['A CSV every Monday', 'Kai Mori', 'kai@kite.test', 'Kite Systems', 'ca1', false]);
  assert.equal(replyValues({ thread, message, selection: '' }).body, message.body, 'no selection saves the whole reply');
  const contacts = [{ value: 'c1', name: 'Hanne Vik', email: 'h@ostra.test' }, { value: 'c2', name: 'Sam Lee', email: 's@a.test' }, { value: 'c3', name: 'Sam Lee', email: 's@b.test' }];
  assert.equal(matchContact(contacts, { email: 'H@OSTRA.test' }).value, 'c1');
  assert.equal(matchContact(contacts, { name: 'sam lee' }), null, 'two records with one name link neither');
  assert.equal(interviewValues({ interview: { interviewee_name: 'Hanne Vik', interviewee_company: 'Ostra' }, passage: 'A file per depot', contacts }).contact_uid, 'c1');
  assert.equal(interviewValues({ interview: { interviewee_name: 'Nobody Here' }, passage: 'x', contacts }).contact_uid, '', 'no match reads Not linked');
  assert.deepEqual([consentWord(1), consentWord(0), consentWord(null)], ['Yes', 'No', 'Not recorded']);
  assert.deepEqual(linkedWords([], ''), { linked: false, text: 'Not linked to a customer record' });
});

test('one POST body: the origin, the reply only when there is one, a new theme over a chosen one; nothing to save is said', () => {
  const v = { ...blankValues(), body: ' Weekly CSV ', contact_uid: 'ca1', theme: 'Fleet CSV', notify: true, from_email: 'kai@kite.test' };
  assert.deepEqual(feedbackBody(v, { origin: 'inbox_reply', replyKey: 'contact:21' }), {
    body: 'Weekly CSV', source: 'customer', from_name: null, from_email: 'kai@kite.test', from_company: null, contact_uid: 'ca1',
    theme: 'Fleet CSV', status: 'open', notify_on_ship: true, origin: 'inbox_reply', reply_key: 'contact:21',
  });
  assert.equal(Object.hasOwn(feedbackBody(v, { origin: 'interview' }), 'reply_key'), false);
  assert.equal(feedbackBody({ ...v, new_theme: 'Exports' }).theme, 'Exports');
  assert.equal(feedbackBody({ ...v, contact_uid: '' }).contact_uid, null);
  assert.equal(sheetProblem({ ...v, body: '  ' }), 'Say what they said before you save.');
  assert.equal(sheetProblem(v), null);
});

test('Eadwyn\'s placements: only into themes already named; any other is held back; the review writes one theme', () => {
  const proposals = [
    { id: 1, kind: 'feedback_theme', payload: { uid: 'f4', body: 'Map is slow', theme: 'Fleet CSV' } },
    { id: 2, kind: 'feedback_theme', payload: { uid: 'f5', body: 'Dark mode', theme: 'A theme nobody named' } },
    { id: 3, kind: 'pain_tag', payload: { theme: 'Fleet CSV' } },
  ];
  const p = placementsFrom(proposals, [{ theme: 'Fleet CSV', feedback: 2 }]);
  assert.deepEqual(p.shown.map((x) => x.id), [1]);
  assert.equal(p.held, 1);
  const t = text(h(PlacementReview, { p: proposals[0], index: 0, total: 1, themes: [{ theme: 'Fleet CSV', feedback: 2 }], onUse() {}, onDiscard() {}, onClose() {} }));
  assert.match(t, /Review proposal: a theme for one feedback item/);
  assert.match(t, /Eadwyn proposed · you decide · proposal 1 of 1/);
  assert.match(t, /“Map is slow” .* Fleet CSV · a theme you named · 2 items .* This item’s theme only\. Nothing else changes\./);
  assert.match(t, /Discard Use this theme/);
  assert.doesNotMatch(t, /recommend|advis/i);
});

test('the sheet: Not linked still saves; the origin is fixed; a linked record is named', () => {
  const opts = { contacts: [{ value: 'ca1', label: 'Kai Mori · Kite Systems · Customer', name: 'Kai Mori', organization: 'Kite Systems', audience: 'customer', status: 'replied' }], themes: [{ value: 'Fleet CSV', label: 'Fleet CSV' }] };
  const a = text(h(FeedbackSheet, { title: 'Add feedback', initial: blankValues(), origin: 'typed', options: opts, onSave: async () => ({}), onClose() {} }));
  assert.match(a, /Not linked to a customer record .* You can save without a link; the typed name stays\./);
  assert.match(a, /Origin Typed/);
  const s = text(h(FeedbackSheet, { title: 'Save as feedback', initial: { ...blankValues(), contact_uid: 'ca1' }, origin: 'inbox_reply', options: opts, onSave: async () => ({}), onClose() {} }));
  assert.match(s, /Customer record Kai Mori · Kite Systems · Customer · Replied/);
  assert.match(s, /Origin Inbox reply/);
});

test('a reply carries Saved as feedback once saved, and offers Save as feedback only when inbound and writable', () => {
  const inbound = { key: 'contact:21', direction: 'inbound', channel: 'email', at: '2026-10-22T10:00:00Z', body: 'A CSV every Monday' };
  const saved = text(h(MessageBubble, { message: { ...inbound, feedback: { uid: 'fx', status: 'open' } }, name: 'Kai', itemHref: (u) => `/grow/product-improvement/${u}`, onSave() {} }));
  assert.match(saved, /✓ Saved as feedback Open item/);
  assert.doesNotMatch(saved, /Saves the selected words/);
  assert.match(text(h(MessageBubble, { message: inbound, name: 'Kai', onSave() {} })), /Save as feedback Saves the selected words, or the whole reply/);
  assert.doesNotMatch(text(h(MessageBubble, { message: inbound, name: 'Kai' })), /Save as feedback/, 'a reader cannot save');
  assert.doesNotMatch(text(h(MessageBubble, { message: { ...inbound, direction: 'outbound' }, name: 'Kai', onSave() {} })), /Save as feedback/);
  assert.equal(selectedWithin(null), '');
});

test('Save as feedback from an Inbox reply posts once with the reply and the record, then the reply carries its tag', async () => {
  const thread = { contact: { uid: 'ca1', name: 'Kai Mori', organization: 'Kite Systems', status: 'replied' }, campaign: null,
    messages: [{ key: 'contact:21', direction: 'inbound', channel: 'email', at: '2026-10-22T10:00:00Z', body: 'A CSV every Monday', feedback: null }] };
  const api = { list: async () => ({ state: 'ready', threads: [thread], channels: [] }), thread: async () => ({ state: 'ready', thread, recipient: 'kai@kite.test', can_write: true, accounts: [], feedback_state: 'ready' }), read: async () => ({ ok: true }) };
  const posts = [];
  const feedback = { formOptions: async () => ({ contacts: [{ value: 'ca1', name: 'Kai Mori', organization: 'Kite Systems', audience: 'customer', status: 'replied' }], themes: [] }),
    grow: { feedbackFromReply: async (project, key, body) => { posts.push([project, key, body]); return { uid: 'fnew' }; } } };
  const m = await mountContracts(h(InboxTab, { projectId: 7, api, feedback }));
  try {
    await m.flush();
    const open = m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)?.['aria-pressed'] === false);
    await act(async () => { m.props(open).onClick(); });
    await m.flush(); await m.flush();
    await m.click('Save as feedback');
    await m.flush();
    assert.match(m.text(), /Save as feedback.*From Kai Mori’s reply/);
    assert.match(m.text(), /Customer record.*Kai Mori · Kite Systems · Customer · Replied/);
    await m.click('Save');
    await m.flush();
    assert.equal(posts.length, 1);
    assert.equal(posts[0][0], 7); assert.equal(posts[0][1], 'contact:21');
    assert.deepEqual([posts[0][2].body, posts[0][2].contact_uid, posts[0][2].origin, posts[0][2].reply_key], ['A CSV every Monday', 'ca1', 'inbox_reply', 'contact:21']);
    assert.match(m.text(), /Saved to Feedback · Open/);
    assert.match(m.text(), /✓ Saved as feedback/);
  } finally { await m.unmount(); }
});

test('Save as feedback from an interview: quote consent beside it, origin Interview, the marks with no label say so', () => {
  const t = text(h(InterviewSaveFeedback, { projectId: 7, interview: { id: 3, interviewee_name: 'Hanne Vik', quote_consent: 1 }, marks: [{ id: 1, offset_ms: 760000, label: 'export pain' }, { id: 2, offset_ms: 1085000, label: null }] }));
  assert.match(t, /Save as feedback Quote consent: Yes/);
  assert.match(t, /12:40 export pain Save as feedback 18:05 No label Save as feedback/);
  assert.match(t, /A mark without a label saves with an empty text box for you to fill\./);
  assert.match(text(h(InterviewSaveFeedback, { projectId: 7, interview: { quote_consent: null } })), /Quote consent: Not recorded/);
});

test('the client: Save as feedback from a reply posts the reply key and origin to the mounted feedback route', async () => {
  const calls = [];
  const w = makeCycleWrites((path, opts) => { calls.push([path, opts]); return Promise.resolve({ uid: 'x' }); });
  await w.grow.feedbackFromReply(7, 'contact:21', { body: 'x', origin: 'typed' });
  assert.equal(calls[0][0], '/cycles/grow/feedback');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { body: 'x', origin: 'inbox_reply', reply_key: 'contact:21', project: 7 });
});
