// D1352 (#3567, part 3 of #3564) — the LinkedIn connector page and the
// import flow, and the member's contacts on Network › Relationships. Mounted
// against fake clients; no test reaches the Worker or LinkedIn.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/linkedin_page_d1352.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import LinkedInSection, { LinkedInDisconnectChoice } from '../src/pages/account/LinkedInSection.jsx';
import NetworkContacts from '../src/pages/NetworkContacts.jsx';
import {
  CAN, CANNOT, LINKEDIN_EXPORT_URL, deleteChoice, disconnectedLine, grantedScopes, lastImportLine, previewCounts, reviewActions, sourceChips,
} from '../src/pages/account/linkedinModel.js';
import { disconnectNote } from '../src/pages/account/connectorsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, null, el)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  return {
    by, pr, settle, text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, event) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onChange(event); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const PREVIEW = { rows: 5, new: 2, duplicates: 1, suggestions: 1, skipped: 1, errors: 0, truncated: false,
  sample: [{ line: 4, kind: 'new', name: 'Synthetic Ada', company: 'Acme' }, { line: 5, kind: 'suggestion', name: 'Synthetic Bob', company: 'Acme' }] };
const REVIEWS = [
  { uid: 'r1', reason: 'name_company', can_merge: true, imported: { name: 'Synthetic Bob', company: 'Acme' }, candidate: { table: 'network_connections', name: 'Bob S.', company: 'Acme' } },
  { uid: 'r2', reason: 'email', can_merge: false, imported: { name: 'Synthetic Cy', company: 'Beta' }, candidate: { table: 'raise_prospects', name: 'Cy', company: 'Beta Fund' } },
];
function fakeBooks() {
  const calls = [];
  let reviews = REVIEWS.slice();
  return {
    calls,
    previewLinkedinCsv: async (f) => { calls.push(['preview', f.name]); return { preview: PREVIEW }; },
    importLinkedinCsv: async (f) => { calls.push(['import', f.name]); return { job: { uid: 'j1' }, preview: PREVIEW }; },
    reviews: async () => ({ reviews }),
    decideReview: async (uid, decision) => { calls.push(['decide', uid, decision]); reviews = reviews.filter((r) => r.uid !== uid); return { ok: true }; },
  };
}
const STATUS = { connected: true, scopes: ['openid', 'profile', 'email'], last_import: { status: 'done', finished_at: '2026-10-20 10:00:00', rows_created: 12, rows_matched: 3, rows_skipped: 1, rows_errors: 0 }, imported: { linkedin_only: 12, kept: 3 } };

// ─────────────────────────────────────────────────────────── the words

test('the page claims no API: the Worker\'s LinkedIn page and the can / cannot lists', () => {
  const src = read('cloudflare-worker/src/integrations/connectorPages.ts');
  const block = src.slice(src.indexOf('export const FIRST_PARTY_PAGES'), src.indexOf('prompts: []', src.indexOf('export const FIRST_PARTY_PAGES')));
  assert.match(block, /tagline: 'Sign in with LinkedIn, then import your connections from LinkedIn\\'s data download\.'/);
  assert.doesNotMatch(block.replace(/^\s*\/\/.*$/gm, '').replace(/fetch\(LINKEDIN_USERINFO_URL/g, ''), /\bAPI\b/, 'no line claims API access');
  assert.match(block, /tool\('import_connections', 'your connections file'/);
  assert.deepEqual(CAN, ['Confirm who you are', 'Import the connections file you upload']);
  assert.deepEqual(CANNOT, ['Read your LinkedIn messages', 'Post on LinkedIn for you', 'See your connections without your file']);
  assert.equal(LINKEDIN_EXPORT_URL, 'https://www.linkedin.com/mypreferences/d/download-my-data');
  assert.deepEqual(grantedScopes('openid profile email w_member_social'), [
    { scope: 'openid', label: 'Sign in' }, { scope: 'profile', label: 'Your name and photo' }, { scope: 'email', label: 'Your email address' },
    { scope: 'w_member_social', label: 'w_member_social' }]);
  assert.match(disconnectNote({ key: 'linkedin', first_party: true }), /stay in your Network unless you also delete them/);
});

test('the counts, the last import, and what Disconnect deletes and keeps, in words; a missing count is never 0', () => {
  assert.deepEqual(previewCounts(PREVIEW).map((c) => [c.key, c.n]), [['new', 2], ['duplicates', 1], ['suggestions', 1], ['skipped', 1], ['errors', 0]]);
  assert.equal(previewCounts({}).every((c) => c.n === null), true);
  assert.equal(lastImportLine(STATUS.last_import), 'Last import, 20 Oct 2026: 12 added, 3 matched, 1 skipped, 0 not read.');
  assert.match(lastImportLine({ status: 'done', rows_created: null }), /not recorded added/);
  assert.match(lastImportLine({ status: 'failed', error: 'Synthetic failure.' }), /failed\. Synthetic failure\./);
  assert.equal(lastImportLine(null), null);
  assert.deepEqual(deleteChoice({ linkedin_only: 12, kept: 3 }), { label: 'Also delete the 12 contacts imported only from LinkedIn', note: '3 contacts also came from somewhere else, so they stay.' });
  assert.deepEqual(deleteChoice({ linkedin_only: 1, kept: 1 }), { label: 'Also delete the 1 contact imported only from LinkedIn', note: '1 contact also came from somewhere else, so it stays.' });
  assert.match(deleteChoice(null).note, /could not be read/);
  assert.match(deleteChoice({ linkedin_only: 4 }).note, /could not be read/, 'a half-read count is not drawn as 0');
  assert.match(deleteChoice({ kept: 2 }).note, /could not be read/);
  assert.equal(deleteChoice({ linkedin_only: 0, kept: 2 }).label, 'Also delete the contacts imported from LinkedIn (there are none)');
  assert.equal(deleteChoice({ linkedin_only: 2, kept: 0 }).note, 'Every LinkedIn contact came only from LinkedIn.');
  assert.deepEqual(sourceChips(['typed', 'linkedin_dma']).map((c) => c.key), ['linkedin', 'typed']);
  assert.equal(disconnectedLine({ deleted_imported: 12, kept_imported: 3 }), 'LinkedIn is disconnected. 12 contacts deleted; 3 contacts kept because another source has them.');
  assert.equal(disconnectedLine({ deleted_imported: 0, kept_imported: null }), 'LinkedIn is disconnected. Your contacts stay in your Network.');
  assert.deepEqual(reviewActions(REVIEWS[0]).map((a) => [a.decision, a.label]), [['merge', 'Merge'], ['keep', 'Keep both'], ['dismiss', 'Dismiss']]);
  assert.deepEqual(reviewActions(REVIEWS[1]).map((a) => a.decision), ['keep', 'dismiss'], 'a prospect is never merged into the book');
  assert.deepEqual(sourceChips(['linkedin_csv']).map((c) => c.label), ['From LinkedIn']);
  assert.deepEqual(sourceChips(['csv', 'linkedin_csv']).map((c) => c.label), ['From LinkedIn', 'From a spreadsheet']);
  assert.deepEqual(sourceChips([]).map((c) => c.label), ['Added by hand']);
});

// ─────────────────────────────────────────────────────────── the import

test('the import: granted scopes, the preview before anything is written, then Import, then the duplicates to decide', async () => {
  const books = fakeBooks();
  const m = await mount(h(LinkedInSection, { books, statusRead: async () => STATUS }));
  try {
    assert.match(m.text('linkedin-scopes'), /Sign in.*Your name and photo.*Your email address/);
    assert.match(m.text('linkedin-cannot'), /Read your LinkedIn messages/);
    assert.equal(m.text('linkedin-last-import'), 'Last import, 20 Oct 2026: 12 added, 3 matched, 1 skipped, 0 not read.');
    assert.equal(m.pr(m.by('linkedin-export-link')).href, LINKEDIN_EXPORT_URL);
    assert.equal(m.pr(m.by('linkedin-commit')).disabled, true, 'nothing to import before a preview');
    await m.change('linkedin-file', { target: { files: [{ name: 'Connections.csv' }] } });
    assert.deepEqual(books.calls, [['preview', 'Connections.csv']], 'the preview writes nothing');
    assert.match(m.text('linkedin-preview'), /Preview of 5 rows/);
    assert.match(m.text('linkedin-preview-suggestions'), /Possible duplicates to review\s*1/);
    assert.match(m.text('linkedin-preview-sample'), /Synthetic Bob · Acme\s*Possible duplicate/);
    assert.equal(m.pr(m.by('linkedin-commit')).disabled, false);
    await m.click('linkedin-commit');
    assert.deepEqual(books.calls.map((c) => c[0]), ['preview', 'import']);
    assert.match(m.text('linkedin-imported'), /Imported\. 2 added; 1 to review below/);
    assert.match(m.text('linkedin-review-r1'), /Synthetic Bob · Acme.*May be Bob S\. · Acme \(the same name and company\)/);
    assert.ok(m.by('linkedin-review-r1-merge') && !m.by('linkedin-review-r2-merge'), 'Merge only between two rows of the book');
    await m.click('linkedin-review-r2-keep');
    assert.deepEqual(books.calls.at(-1), ['decide', 'r2', 'keep']);
    assert.ok(!m.by('linkedin-review-r2'));
    await m.click('linkedin-review-r1-dismiss');
    assert.deepEqual(books.calls.at(-1), ['decide', 'r1', 'dismiss']);
    assert.equal(m.text('linkedin-reviews-empty'), 'Nothing to review.');
  } finally { await m.unmount(); }
});

test('a failed preview says so in the Worker\'s words and leaves Import off; an unreadable status says so', async () => {
  const books = { ...fakeBooks(), previewLinkedinCsv: async () => { const e = new Error('x'); e.data = { detail: 'That is not LinkedIn’s Connections.csv: it has no First Name and Last Name header.' }; throw e; } };
  const m = await mount(h(LinkedInSection, { books, statusRead: async () => { throw new Error('down'); } }));
  try {
    assert.match(m.text('linkedin-status-unreadable'), /could not be read/);
    await m.change('linkedin-file', { target: { files: [{ name: 'other.csv' }] } });
    assert.match(m.text('linkedin-error'), /not LinkedIn’s Connections\.csv/);
    assert.equal(m.pr(m.by('linkedin-commit')).disabled, true);
  } finally { await m.unmount(); }
});

test('Disconnect\'s choice says what it deletes and keeps before it is pressed', async () => {
  const seen = [];
  const m = await mount(h(LinkedInDisconnectChoice, { checked: false, onChange: (v) => seen.push(v), statusRead: async () => STATUS }));
  try {
    assert.match(m.text('linkedin-disconnect-choice'), /Also delete the 12 contacts imported only from LinkedIn/);
    assert.equal(m.text('linkedin-delete-note'), '3 contacts also came from somewhere else, so they stay.');
    await m.change('linkedin-delete-imported', { target: { checked: true } });
    assert.deepEqual(seen, [true]);
  } finally { await m.unmount(); }
});

test('the page wires the choice into Disconnect and LinkedIn\'s section into Your connection', () => {
  const page = read('frontend/src/pages/account/ConnectorPage.jsx');
  assert.match(page, /p\.key === 'linkedin' && <LinkedInSection onChanged=\{onChanged\} \/>/);
  assert.match(page, /flow\.doDisconnect\(p\.key === 'linkedin' \? \{ delete_imported: deleteImported \} : undefined\)/);
  assert.match(page, /p\.key === 'linkedin' && <LinkedInDisconnectChoice checked=\{deleteImported\} onChange=\{setDeleteImported\} \/>/);
  assert.match(read('frontend/src/pages/account/useConnectFlow.js'), /if \(p\.key === 'linkedin'\) return api\.linkedinDisconnect\(opts\);/);
  assert.match(read('frontend/src/lib/api.js'), /linkedinDisconnect: \(opts = \{\}\) => request\('\/linkedin\/disconnect', \{ method: 'POST', body: JSON\.stringify\(opts\?\.delete_imported \? \{ delete_imported: true \} : \{\}\) \}\)/);
});

// ─────────────────────────────────────────────────────────── the Network

test('the Network lists the member\'s own contacts with their source chips, notes and follow-ups', async () => {
  const calls = [];
  const books = {
    book: async (q, page) => { calls.push(['book', q, page]); return { total: 2, page: 1, page_size: 50, contacts: [
      { id: 21, name: 'Synthetic Ada', company: 'Acme', title: 'CTO', sources: ['linkedin_csv'], notes: 1, open_tasks: 1 },
      { id: 22, name: 'Synthetic Bob', company: null, title: null, sources: [], notes: 0, open_tasks: 0 }] }; },
    notes: async (id) => { calls.push(['notes', id]); return { notes: [{ uid: 'n1', body: 'Synthetic note' }] }; },
    tasks: async (id) => { calls.push(['tasks', id]); return { tasks: [{ uid: 't1', title: 'Follow up', due_on: '2026-11-01', done_at: null }] }; },
    addNote: async (id, body) => { calls.push(['addNote', id, body]); },
    addTask: async (id, title, due) => { calls.push(['addTask', id, title, due]); },
    setTaskDone: async (id, uid, done) => { calls.push(['done', id, uid, done]); },
  };
  const m = await mount(h(NetworkContacts, { books }));
  try {
    assert.equal(m.text('network-contact-21-chip-linkedin'), 'From LinkedIn');
    assert.equal(m.text('network-contact-22-chip-typed'), 'Added by hand');
    assert.match(m.text('network-contact-22'), /No title or company recorded/);
    assert.match(m.text('network-contact-21-open'), /Notes \(1\) and follow-ups \(1 open\)/);
    await m.click('network-contact-21-open');
    assert.match(m.text('network-contact-21-notes'), /Synthetic note.*Follow up · 2026-11-01/);
    await m.change('network-contact-21-note-input', { target: { value: 'Met at demo day' } });
    const form = m.by('network-contact-21-note-add').parentNode;
    await act(async () => { await m.pr(form).onSubmit({ preventDefault() {} }); });
    await m.settle();
    assert.deepEqual(calls.find((c) => c[0] === 'addNote'), ['addNote', 21, 'Met at demo day']);
    await m.change('network-task-t1', { target: { checked: true } });
    assert.deepEqual(calls.find((c) => c[0] === 'done'), ['done', 21, 't1', true]);
  } finally { await m.unmount(); }
});

test('Network › Relationships mounts the contacts; phone and dark are drawn', () => {
  assert.match(read('frontend/src/workspaces/NetworkWorkspace.jsx'), /slug === 'relationships' && <Suspense fallback=\{null\}><NetworkContacts \/><\/Suspense>/);
  for (const f of ['frontend/src/pages/account/LinkedInSection.jsx', 'frontend/src/pages/NetworkContacts.jsx']) {
    const src = read(f);
    assert.match(src, /dark:/, `${f} has dark styles`);
    assert.match(src, /(max-sm:|sm:)/, `${f} adapts to a phone`);
  }
});
