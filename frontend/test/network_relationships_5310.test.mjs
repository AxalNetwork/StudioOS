/**
 * #5310 part 2 — NW2 "My relationships" and NW2.1 the Person Sheet
 * (`design/incoming/network-workspace/NW2-Relationships.dc.html`), on stubbed reads.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_relationships_5310.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  NOT_RECORDED, bookCountLine, bookRows, contextLine, followUpBody, followUpCell, followUpRows, historyRows, lastActivity, noteBody, rangeLabel, sourceLine,
} from '../src/pages/founder/relationshipBookModel.js';

const h = React.createElement;
const ADA = {
  id: 21, name: 'Example Ada', company: 'Example Seed', title: 'Partner', linkedin_url: 'https://www.linkedin.com/in/example-ada',
  connected_on: '2021-03-14', created_at: '2026-10-30 09:00:00', sources: ['linkedin_csv'],
  notes: 2, open_tasks: 1, overdue_tasks: 1, next_due_on: '2026-10-28', last_note_at: '2026-09-28 10:00:00', last_done_at: '2026-09-30 08:00:00',
};
const BEN = { id: 22, name: 'Example Ben', company: null, title: null, created_at: '2026-09-01 10:00:00', sources: ['typed'], notes: 0, open_tasks: 2, overdue_tasks: 0, next_due_on: '2026-11-20', last_note_at: '2026-11-05 12:00:00', last_done_at: null };
const CARA = { id: 23, name: 'Example Cara', company: 'Example Co', title: 'Angel', created_at: null, sources: [], notes: 0, open_tasks: 0, overdue_tasks: 0, next_due_on: null, last_note_at: null, last_done_at: null };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

// Mutation checked: overdue not ahead of open (fails); open count without next due (fails); a missing org drawn as blank (fails);
// last activity taken from created_at when a later note exists (fails); no activity drawn as a date (fails).
test('NW2 rows: organization and role or Not recorded, last activity is the latest recorded, follow-ups say overdue first', () => {
  const rows = Object.fromEntries(bookRows([ADA, BEN, CARA]).map((r) => [r.name, r]));
  assert.deepEqual([rows['Example Ada'].organization, rows['Example Ada'].role, rows['Example Ada'].source], ['Example Seed', 'Partner', 'LinkedIn import']);
  assert.deepEqual([rows['Example Ben'].organization, rows['Example Ben'].role, rows['Example Ben'].source], [NOT_RECORDED, NOT_RECORDED, 'Added by you']);
  assert.equal(rows['Example Ada'].lastActivity, '2026-10-30 imported', 'entering the book after the last note is the latest');
  assert.equal(rows['Example Ben'].lastActivity, '2026-11-05 note');
  assert.equal(rows['Example Cara'].lastActivity, NOT_RECORDED, 'no stamp at all is Not recorded, never today');
  assert.deepEqual(followUpCell(ADA), { tone: 'overdue', text: '1 overdue' });
  assert.deepEqual(followUpCell(BEN), { tone: 'open', text: '2 · due 2026-11-20' });
  assert.deepEqual(followUpCell({ open_tasks: 1, overdue_tasks: 0, next_due_on: null }), { tone: 'open', text: '1 open · no due date' });
  assert.deepEqual(followUpCell(CARA), { tone: 'none', text: 'None' });
  assert.equal(lastActivity({ ...BEN, last_done_at: '2026-11-05 13:00:00' }).text, '2026-11-05 follow-up done', 'the full stamp decides within one day');
  assert.equal(sourceLine(['linkedin_csv', 'csv']), 'LinkedIn import · CSV import');
});

// Mutation checked: range counting from 0 (fails); the count line combining leads (no such input; asserted wording only).
test('NW2 counts: the range is the read\'s page, and the book count is the read\'s total', () => {
  assert.equal(rangeLabel({ total: 142, page: 1, page_size: 50 }), '1–50 of 142');
  assert.equal(rangeLabel({ total: 142, page: 3, page_size: 50 }), '101–142 of 142');
  assert.equal(rangeLabel({ total: 0, page: 1, page_size: 50 }), '0 people');
  assert.equal(bookCountLine({ total: 1 }), '1 person · private to you');
  assert.equal(bookCountLine(null), 'Private to you', 'no read: no number');
});

// Mutation checked: a done follow-up drawn overdue (fails); due today drawn overdue (fails); history not newest first (fails);
// the LinkedIn connection date dropped (fails).
test('NW2.1 sheet: follow-up states, the history newest first, and the context line', () => {
  const rows = followUpRows([
    { uid: 'a', title: 'Send Q3 update', due_on: '2026-10-28', done_at: null },
    { uid: 'b', title: 'Due today', due_on: '2026-11-15', done_at: null },
    { uid: 'c', title: 'No date', due_on: null, done_at: null },
    { uid: 'd', title: 'Thank-you after intro', due_on: '2026-09-29', done_at: '2026-09-30 08:00:00' },
  ], '2026-11-15');
  assert.deepEqual(rows.map((r) => [r.tone, r.line]), [['overdue', 'Overdue · due 2026-10-28'], ['open', 'due 2026-11-15'], ['open', 'No due date'], ['done', 'done 2026-09-30']]);
  const hist = historyRows(ADA, [{ uid: 'n1', created_at: '2026-09-28 10:00:00' }], [{ uid: 'd', title: 'Thank-you', done_at: '2026-09-30 08:00:00' }]);
  assert.deepEqual(hist.map((x) => [x.day, x.text]), [
    ['2026-10-30', 'Imported from LinkedIn'], ['2026-09-30', 'Follow-up done · Thank-you'], ['2026-09-28', 'Private note added'], ['2021-03-14', 'Connected on LinkedIn'],
  ]);
  assert.equal(contextLine(ADA), 'Imported from LinkedIn on 2026-10-30 · connected since 2021-03-14.');
  assert.equal(contextLine(BEN), 'Added by you on 2026-09-01.');
  assert.deepEqual(followUpBody('  ', ''), { error: 'Write what to follow up on.' });
  assert.deepEqual(followUpBody('Call', '2026-12-01'), { title: 'Call', due_on: '2026-12-01' });
  assert.deepEqual(followUpBody('Call', ''), { title: 'Call', due_on: null });
  assert.deepEqual(noteBody('x'.repeat(4001)), { error: 'Keep a note to 4,000 characters.' });
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount(books) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ people: [] }), text: async () => '{"people":[]}' });
  const { default: Book } = await import('../src/pages/founder/FounderRelationshipBook.jsx');
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/network/relationships'] }, h(Book, { books }))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  return {
    settle, has: (id) => !!byId(id), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async submit(id) { const n = byId(id); await act(async () => { props(n).onSubmit?.({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
function stubBooks(over = {}) {
  const calls = [];
  const books = {
    book: async (q, page, filters) => { calls.push(['book', q, page, filters]); return { total: 142, page, page_size: 50, contacts: [ADA, BEN] }; },
    notes: async (id) => { calls.push(['notes', id]); return { notes: [{ uid: 'n1', body: 'Met at Web Summit.', created_at: '2026-09-28 10:00:00' }] }; },
    tasks: async (id) => { calls.push(['tasks', id]); return { tasks: [{ uid: 't1', title: 'Send Q3 update', due_on: '2020-10-28', done_at: null }] }; },
    addNote: async (id, body) => { calls.push(['addNote', id, body]); return {}; },
    addTask: async (id, title, due) => { calls.push(['addTask', id, title, due]); return {}; },
    setTaskDone: async (id, uid, done) => { calls.push(['done', id, uid, done]); return {}; },
    ...over,
  };
  return { books, calls };
}

// Mutation checked: the source filter not sent (fails); "Has open follow-up" not sent as follow_up=open (fails);
// a failed book read drawn as the empty book (fails); Add person enabled (fails).
test('NW2 mounted: the table from the book read, the filters go to the Worker, and a failed read is not an empty book', async () => {
  const { books, calls } = stubBooks();
  const v = await mount(books);
  try {
    assert.match(v.textOf('nw2-book-count'), /^142 people · private to you$/);
    assert.match(v.textOf('nw2-row-21'), /Example Ada[\s\S]*Example Seed[\s\S]*Partner[\s\S]*2026-10-30 imported[\s\S]*1 overdue[\s\S]*LinkedIn import/);
    assert.match(v.textOf('nw2-row-22'), /Not recorded[\s\S]*Not recorded[\s\S]*2 · due 2026-11-20/);
    assert.equal(v.textOf('nw2-range'), '1–50 of 142');
    assert.equal(v.props('nw2-add-person').disabled, true, 'Add person waits on #6558');
    await v.change('nw2-source', 'linkedin_csv');
    await v.change('nw2-open-only', true);
    assert.deepEqual(calls.filter((c) => c[0] === 'book').at(-1), ['book', '', 1, { source: 'linkedin_csv', follow_up: 'open' }]);
    await v.click('nw2-next');
    assert.equal(calls.filter((c) => c[0] === 'book').at(-1)[2], 2, 'the next page is asked of the Worker');
  } finally { await v.close(); }
  const failed = await mount(stubBooks({ book: async () => { throw new Error('down'); } }).books);
  try {
    assert.ok(failed.has('nw2-unreadable'));
    assert.equal(failed.has('nw2-empty'), false, 'a failed read is never "your book is empty"');
  } finally { await failed.close(); }
});

// Mutation checked: notes or follow-ups read for another contact (fails); the unsaved-note guard closing at once (fails);
// a follow-up added without its due date (fails); done toggled with the wrong value (fails).
test('NW2.1 mounted: the Person Sheet reads that person, writes a note and a follow-up, and never drops an unsaved note', async () => {
  const { books, calls } = stubBooks();
  const v = await mount(books);
  try {
    await v.click('nw2-open-21');
    assert.ok(v.has('nw2-sheet'));
    assert.deepEqual(calls.filter((c) => c[0] === 'notes' || c[0] === 'tasks'), [['notes', 21], ['tasks', 21]]);
    assert.match(v.textOf('nw2-sheet-context'), /Imported from LinkedIn on 2026-10-30 · connected since 2021-03-14/);
    assert.match(v.textOf('nw2-sheet-follow'), /Send Q3 update[\s\S]*Overdue · due 2020-10-28/);
    assert.match(v.textOf('nw2-sheet-history'), /2026-10-30 · Imported from LinkedIn[\s\S]*2026-09-28 · Private note added[\s\S]*2021-03-14 · Connected on LinkedIn/);

    await v.change('nw2-sheet-follow-title', 'Call about the pilot');
    await v.change('nw2-sheet-follow-due', '2026-12-01');
    await v.submit('nw2-sheet-follow-form');
    assert.deepEqual(calls.find((c) => c[0] === 'addTask'), ['addTask', 21, 'Call about the pilot', '2026-12-01']);

    await v.change('nw2-sheet-note', 'Wants quarterly updates');
    // The sheet's × calls onClose: with a draft it warns and stays open.
    await v.click('nw2-sheet-close');
    assert.ok(v.has('nw2-sheet'), 'an unsaved note keeps the sheet open');
    assert.ok(v.has('nw2-sheet-unsaved'));
    await v.click('nw2-sheet-note-save');
    assert.deepEqual(calls.find((c) => c[0] === 'addNote'), ['addNote', 21, 'Wants quarterly updates']);
    assert.equal(v.has('nw2-sheet-unsaved'), false, 'saved: no warning');
  } finally { await v.close(); }
});
