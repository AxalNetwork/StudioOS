/**
 * D1353 (#3568, part 4 of #3564) — Refer & Earn's "Import from LinkedIn", end to end.
 *
 *   · the file read: rows with an email, the count with none (never dropped
 *     without a word), a quoted comma kept, a file with no email column;
 *   · the sheet's three steps, mounted: the export link and its path, the file,
 *     the preview's two counts; Add hands over only the rows with an email;
 *   · the page: no dead-end toast and no sign-in before the upload; the
 *     `localStorage` hand-off stays for the connector page's import;
 *   · phone and dark: the sheet is D1317's Sheet, and every surface it draws has
 *     its dark pair.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/referrals_linkedin_import_d1353.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { parseLinkedInCsv, readLinkedInCsv } from '../src/lib/linkedinCsv.js';
import LinkedInImportSheet, { EXPORT_PATH, EXPORT_URL, NO_EMAIL_LINE, previewOf } from '../src/pages/referrals/LinkedInImportSheet.jsx';
import { codeOnly } from './_codeOnly.mjs';

const h = React.createElement;
// LinkedIn's export: a notes preamble, then the header. Ben hid his email; Cara's name has a quoted comma.
const CONNECTIONS = [
  'Notes:', '"When exporting your connection data, you may notice that some of the email addresses are missing."', '',
  'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
  'Ada,Quill,https://www.linkedin.com/in/synthetic-ada,ada@example.invalid,Synthetic Co,CEO,01 Oct 2026',
  'Ben,Hidden,https://www.linkedin.com/in/synthetic-ben,,Synthetic Co,CTO,02 Oct 2026',
  '"Cara, Jr",Lane,https://www.linkedin.com/in/synthetic-cara,cara@example.invalid,"Co ""Big""",COO,03 Oct 2026',
  'Dan,NoMail,https://www.linkedin.com/in/synthetic-dan,,Synthetic Co,CFO,04 Oct 2026',
].join('\n');

test('the file read counts rows with no email instead of dropping them, and keeps a quoted comma', () => {
  assert.deepEqual(readLinkedInCsv(CONNECTIONS), {
    rows: [{ email: 'ada@example.invalid', name: 'Ada Quill' }, { email: 'cara@example.invalid', name: 'Cara, Jr Lane' }],
    no_email: 2, header: true,
  });
  assert.deepEqual(parseLinkedInCsv(CONNECTIONS), readLinkedInCsv(CONNECTIONS).rows, 'the connector page\'s reader is unchanged in shape');
  assert.deepEqual(readLinkedInCsv('name,email\n"Lee, Ann",ann@example.invalid\nNo One,\n'), { rows: [{ email: 'ann@example.invalid', name: 'Lee, Ann' }], no_email: 1, header: true });
  assert.deepEqual(readLinkedInCsv('name,phone\nA,1'), { rows: [], no_email: 0, header: false });
  assert.deepEqual(readLinkedInCsv(''), { rows: [], no_email: 0, header: false });
});

test('the preview says both counts in words', () => {
  assert.deepEqual(previewOf(readLinkedInCsv(CONNECTIONS)), { ok: true, can: '2 have an email and can be invited', cannot: '2 have no email' });
  assert.deepEqual(previewOf({ rows: [{ email: 'a@example.invalid' }], no_email: 1, header: true }), { ok: true, can: '1 has an email and can be invited', cannot: '1 has no email' });
  assert.deepEqual(previewOf({ rows: [], no_email: 3, header: true }), { ok: false, can: '0 have an email and can be invited', cannot: '3 have no email' });
  assert.match(previewOf({ rows: [], no_email: 0, header: false }).text, /no email column/);
  assert.equal(previewOf(null), null);
});

async function mount(props) {
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; n.querySelectorAll = () => []; n.querySelector = () => null; return n; };
  document.querySelectorAll = () => [];
  document.body.style = {};
  const realReader = globalThis.FileReader;
  globalThis.FileReader = class { readAsText(f) { this.result = f.text; this.onload(); } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(LinkedInImportSheet, props)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const choose = async (file) => { await act(async () => { pr(by('rf-linkedin-file')).onChange({ target: { files: [file], value: 'x' } }); }); };
  return { by, pr, text, choose, async unmount() { await act(async () => root.unmount()); globalThis.FileReader = realReader; restore(); } };
}

test('the sheet\'s three steps: the export, the file, the preview; Add hands over only rows with an email', async () => {
  const added = [];
  const m = await mount({ onAdd: (rows, noEmail) => added.push({ rows, noEmail }), onClose() {} });
  try {
    assert.ok(m.by('rf-linkedin-sheet'), 'the shared right Sheet (D1317)');
    assert.match(m.text(m.by('rf-linkedin-step-1')), /^1Download your connections from LinkedIn/);
    assert.ok(m.text(m.by('rf-linkedin-step-1')).includes(EXPORT_PATH));
    assert.equal(EXPORT_PATH, 'Settings → Data privacy → Get a copy of your data → Connections');
    const link = m.pr(m.by('rf-linkedin-export'));
    assert.equal(link.href, EXPORT_URL); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
    assert.match(m.text(m.by('rf-linkedin-step-2')), /Drop or choose Connections\.csv/);
    assert.equal(m.pr(m.by('rf-linkedin-add')).disabled, true, 'nothing to add before a file');
    await m.choose({ name: 'Connections.csv', size: CONNECTIONS.length, text: CONNECTIONS });
    assert.equal(m.text(m.by('rf-linkedin-can')), '2 have an email and can be invited');
    assert.equal(m.text(m.by('rf-linkedin-cannot')), `2 have no email. ${NO_EMAIL_LINE}`);
    assert.equal(NO_EMAIL_LINE, 'LinkedIn didn’t include an email for these; invite them by sharing your link on LinkedIn.');
    assert.equal(m.text(m.by('rf-linkedin-add')), 'Add 2 to your invite list');
    await act(async () => { m.pr(m.by('rf-linkedin-add')).onClick(); });
    assert.deepEqual(added, [{ rows: [{ email: 'ada@example.invalid', name: 'Ada Quill' }, { email: 'cara@example.invalid', name: 'Cara, Jr Lane' }], noEmail: 2 }]);
  } finally { await m.unmount(); }
});

test('a file with no email column, or too large, says why and adds nothing', async () => {
  const m = await mount({ onAdd: () => assert.fail('nothing to add'), onClose() {} });
  try {
    await m.choose({ name: 'people.csv', size: 20, text: 'name,phone\nA,1' });
    assert.match(m.text(m.by('rf-linkedin-preview')), /This file has no email column/);
    assert.equal(m.pr(m.by('rf-linkedin-add')).disabled, true);
    await m.choose({ name: 'huge.csv', size: 3 * 1024 * 1024, text: CONNECTIONS });
    assert.match(m.text(m.by('rf-linkedin-error')), /larger than 2 MB/);
    assert.equal(m.pr(m.by('rf-linkedin-add')).disabled, true);
  } finally { await m.unmount(); }
});

test('the page: no dead-end toast, no sign-in before the upload, and the connector page\'s hand-off kept', () => {
  const page = codeOnly(readFileSync('frontend/src/pages/ReferralsPage.jsx', 'utf8'));
  assert.doesNotMatch(page, /Upload Connections\.csv using Upload CSV/, 'the dead-end toast is gone');
  assert.match(page, /const importLinkedin = \(\) => setLinkedinSheet\(true\);/, 'Import from LinkedIn opens the sheet');
  assert.doesNotMatch(page, /linkedinOAuthStart|linkedinStatus/, 'signing in is never a step before the upload');
  assert.match(page, /<LinkedInImportSheet onClose=\{\(\) => setLinkedinSheet\(false\)\} onAdd=\{\(rows, noEmail\) => \{ addContacts\(rows, noEmail\); setLinkedinSheet\(false\); \}\} \/>/);
  assert.match(page, /readLinkedInCsv\(String\(reader\.result \|\| ''\)\)/, 'Upload CSV reads with the counting reader too');
  assert.match(page, /localStorage\.getItem\(PENDING_LINKEDIN_IMPORT_KEY\)/, 'the connector page still hands its import over');
  assert.match(readFileSync('frontend/src/pages/account/useConnectFlow.js', 'utf8'), /safeWriteJSON\(PENDING_LINKEDIN_IMPORT_KEY/);
});

test('phone and dark: the sheet is D1317\'s Sheet at 520px, and every surface and text it draws has its dark pair', () => {
  const src = readFileSync('frontend/src/pages/referrals/LinkedInImportSheet.jsx', 'utf8');
  assert.match(src, /<Sheet label="Import from LinkedIn"[^>]*width=\{520\}/, 'a full-height page under 640px, as every Sheet is');
  for (const cls of ['text-axal-ink', 'text-axal-muted', 'bg-white', 'border-axal-hairline', 'bg-axal-lavender', 'text-red-700', 'text-axal-violet']) {
    const lines = src.split('\n').filter((l) => l.includes(cls));
    assert.ok(lines.length, cls);
    for (const l of lines) assert.match(l, /dark:/, `${cls} without a dark pair: ${l.trim().slice(0, 80)}`);
  }
});
