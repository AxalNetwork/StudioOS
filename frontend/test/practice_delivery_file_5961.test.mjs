/**
 * #5961 (D4833-p3): a deliverable version's summary and stored file, on the
 * advisor's Delivery page and on the client's received list.
 *
 *   · Add version matches the canvas (PX-06): "Change note · required",
 *     "Document or URL · required", "Summary · optional". It saves note plus
 *     link (JSON) or note plus file (a form), and refuses a missing note or a
 *     missing document, as before (D4712, D5960);
 *   · the summary is optional: a version without one shows nothing for it, and
 *     never "Not recorded" (D5959);
 *   · a file the Worker refuses shows the Worker's sentence and saves nothing;
 *   · a file version shows its name, size and a Download, in the latest card,
 *     the history and the client's received list; a failed or empty download
 *     shows an alert with Retry and hands the browser no file;
 *   · history rows stay read-only;
 *   · the send confirmation names a file by its file name;
 *   · the client methods match mounted Worker routes.
 *
 * Every record below is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_delivery_file_5961.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';
import AdvisorGrantSection from '../src/pages/raise/AdvisorGrantSection.jsx';
import {
  DELIVERABLE_FILE, DELIVERABLE_FILE_LIMITS_LINE, fileRefusal, readyAction, sendConfirmation, versionDocument,
  versionDraft, versionSummary,
} from '../src/pages/advisor/practice/deliveryTrail.js';
import { sendPreview } from '../src/pages/advisor/practice/practiceTools.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});
/** A binary answer, as the Worker's file routes give one. */
const binary = (bytes, name = 'memo-v2.pdf') => ({
  ok: true, status: 200,
  headers: { get: (k) => (/disposition/i.test(k) ? `attachment; filename="${name}"` : /type/i.test(k) ? 'application/pdf' : null) },
  blob: async () => new Blob([bytes], { type: 'application/pdf' }),
  json: async () => ({}),
});
const pdf = (name = 'memo-v3.pdf', size = 2048, type = 'application/pdf') => {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  // The size the browser reports, without allocating it.
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

// ---------------------------------------------------------------- fixtures

const V = (version, over = {}) => ({
  uid: `u${version}`, version, label: null, summary: `Change ${version}`, version_summary: null,
  link_url: `https://docs.example/v${version}`, document: 'link', file: null,
  sent_at: null, opened_at: null, signed_off_at: null, recipient_user_id: null, recipient_name: null, ...over,
});
const FILE_V = (version, over = {}) => V(version, {
  link_url: null, document: 'file', file: { name: `memo-v${version}.pdf`, type: 'application/pdf', size: 2516582 }, ...over,
});
const ITEM = (id, versions, over = {}) => ({
  id, title: `Work ${id}`, client_name: 'Acme', engagement_id: 9, client_user_id: 50,
  client_user_name: 'J. Park', client_user_email: 'jpark@example.test', state: 'not_started',
  version_count: versions.length, latest_version: versions[0] || null, versions, ...over,
});
const SENT = { sent_at: '2026-11-06T10:00:00Z', recipient_user_id: 50, recipient_name: 'J. Park' };

// v2 is a draft file with a summary; v1 a sent link without one.
const MEMO = ITEM(4, [
  FILE_V(2, { version_summary: 'Pricing moved to the appendix; the hiring plan is new.' }),
  V(1, { ...SENT }),
], { title: 'Q4 Strategy Memo' });
// v1 is a link and has no summary.
const PLAIN = ITEM(5, [V(1)], { title: 'Hiring plan' });

// ---------------------------------------------------------------- pure rules

test('a version\'s document is a stored file, an https link or nothing; its summary is its own field', () => {
  assert.deepEqual(versionDocument(FILE_V(2)), { kind: 'file', name: 'memo-v2.pdf', type: 'application/pdf', size: 2516582, sizeLabel: '2.4 MB' });
  assert.equal(versionDocument(V(1)).kind, 'link');
  assert.equal(versionDocument(V(1)).host, 'docs.example');
  assert.equal(versionDocument(V(1, { link_url: 'http://docs.example/x', document: 'link' })), null, 'a plain-http link is no document');
  assert.equal(versionDocument(V(1, { link_url: null, document: null })), null);
  assert.equal(versionSummary(V(1)), null);
  assert.equal(versionSummary(V(1, { version_summary: '   ' })), null, 'blank reads as none');
  assert.equal(versionSummary(V(1, { version_summary: ' A short read. ' })), 'A short read.');
  assert.equal(versionSummary(V(1, { summary: 'The change note' })), null, 'never the change note');
});

test('the draft: note plus link, or note plus file; a missing note or document is refused, as today', () => {
  const file = pdf();
  assert.deepEqual(versionDraft({ summary: ' Added the appendix ', link_url: ' https://docs.example/v3 ' }),
    { body: { link_url: 'https://docs.example/v3', summary: 'Added the appendix' }, file: null });
  assert.deepEqual(versionDraft({ summary: 'Added the appendix', file, version_summary: ' Reads in 5 minutes. ' }),
    { body: { summary: 'Added the appendix', version_summary: 'Reads in 5 minutes.' }, file });
  assert.deepEqual(versionDraft({ summary: 'Added', link_url: 'https://x.example', version_summary: '  ' }).body,
    { link_url: 'https://x.example', summary: 'Added' }, 'an empty summary is not sent');
  assert.deepEqual(versionDraft({ summary: ' ', file }), { error: 'Say what changed in this version.' });
  assert.match(versionDraft({ summary: 'Added' }).error, /Choose a file, or enter a web address that starts with https:\/\//);
  assert.match(versionDraft({ summary: 'Added', link_url: 'http://x.example' }).error, /https:\/\//);
  assert.match(versionDraft({ summary: 'Added', link_url: 'https://x.example', file }).error, /link or a file, not both/);
  assert.equal(versionDraft({ summary: 'Added', link_url: 'https://x.example', version_summary: 'x'.repeat(2001) }).error,
    'The summary is at most 2,000 characters.');
});

test('a file the Worker would refuse is said in the Worker\'s own sentence before a byte is sent', () => {
  assert.equal(DELIVERABLE_FILE.maxBytes, 10 * 1024 * 1024);
  assert.equal(DELIVERABLE_FILE_LIMITS_LINE, 'A PDF, JPEG or PNG of at most 10 MB.');
  assert.equal(fileRefusal(pdf('big.pdf', 10 * 1024 * 1024)), null, 'exactly 10 MB is allowed');
  assert.equal(fileRefusal(pdf('big.pdf', 10 * 1024 * 1024 + 1)), 'The file is larger than 10 MB.');
  assert.equal(fileRefusal(pdf('memo.docx', 2048, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
    'Upload a PDF, JPEG or PNG file.');
  assert.equal(fileRefusal(pdf('scan.png', 2048, 'image/png')), null);
  assert.equal(fileRefusal(pdf('empty.pdf', 0)), 'The file is empty.');
  // The Worker's sentences, word for word (D5960).
  const worker = read('cloudflare-worker/src/routes/advisors_deliverables.ts');
  for (const s of ['The file is larger than 10 MB.', 'Upload a PDF, JPEG or PNG file.', 'The file is empty.']) assert.ok(worker.includes(s), s);
});

test('send, preview and Ready treat a stored file as content, named by its file name', () => {
  const c = sendConfirmation(MEMO);
  assert.equal(c.sendable, true);
  assert.equal(c.fileName, 'memo-v2.pdf');
  assert.equal(c.host, undefined, 'a file opens no host');
  assert.equal(c.summary, 'Pricing moved to the appendix; the hiring plan is new.');
  assert.equal(sendConfirmation(PLAIN).fileName, null, 'a link is not named as a file');
  assert.equal(sendConfirmation(PLAIN).summary, null);
  assert.deepEqual(sendPreview(MEMO), { sendable: true, line: 'Sends v2 — “Change 2” · file memo-v2.pdf' });
  assert.equal(readyAction(MEMO).enabled, true);
  assert.match(sendConfirmation(ITEM(9, [V(1, { link_url: null, document: null })])).reason, /Add a version with a file or a link/);
});

test('the client methods are in their own module, each on a mounted Worker route; api.js is not touched', () => {
  const mod = read('frontend/src/lib/api/advisorDeliverableFiles.js');
  const worker = codeOnly(read('cloudflare-worker/src/routes/advisors_deliverables.ts'));
  for (const route of [
    "advisors.post('/me/deliverables'", "advisors.post('/me/deliverables/:id/versions'",
    "advisors.get('/me/deliverables/:id/versions/:version/file'", "advisors.get('/received/deliverables/:uid/file'",
  ]) assert.ok(worker.includes(route), route);
  assert.match(mod, /request\('\/advisors\/me\/deliverables', \{ method: 'POST'/);
  assert.match(mod, /request\(`\/advisors\/me\/deliverables\/\$\{id\}\/versions`, \{ method: 'POST'/);
  assert.match(mod, /`\/advisors\/me\/deliverables\/\$\{encodeURIComponent\(id\)\}\/versions\/\$\{encodeURIComponent\(version\)\}\/file`/);
  assert.match(mod, /`\/advisors\/received\/deliverables\/\$\{encodeURIComponent\(uid\)\}\/file`/);
  assert.doesNotMatch(read('frontend/src/lib/api.js'), /advisorDeliverableFiles|downloadVersionFile|version_summary/);
});

// ---------------------------------------------------------------- mounted

async function mount(handle, element = h(DeliveryZone)) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  localStorage.setItem('token', 't-90');
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  const seen = [];
  const saved = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    let body = null;
    if (init.body instanceof FormData) body = { form: Object.fromEntries([...init.body.entries()]) };
    else if (init.body) body = JSON.parse(init.body);
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname, body, headers: init.headers || {} };
    seen.push(call);
    return handle(call);
  };
  URL.createObjectURL = (blob) => { saved.push(blob); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const buttonWith = (re) => walk(document.body).find((n) => n.tagName === 'BUTTON' && typeof props(n)?.onClick === 'function' && re.test(textOf(n)));
  return {
    walk, textOf, props, byTestId, buttonWith, settle, seen, saved,
    text: () => textOf(document.body),
    writes: () => seen.filter((c) => c.method !== 'GET'),
    gets: (re) => seen.filter((c) => c.method === 'GET' && re.test(c.path)),
    async press(re) { const b = buttonWith(re); assert.ok(b, `no button ${re}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async pressId(id) { const b = byTestId(id); assert.ok(b, `no ${id}`); await act(async () => { await props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); },
    async choose(id, file) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { files: [file], value: 'C:\\fakepath' } }); }); await settle(); },
    async submit(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onSubmit({ preventDefault() {} }); }); await settle(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      URL.createObjectURL = previous.createObjectURL; URL.revokeObjectURL = previous.revokeObjectURL;
      restore();
    },
  };
}

const base = (items) => (c) => {
  if (c.path === '/api/advisors/me/deliverables' && c.method === 'GET') return json({ items, totals: { work_products: items.length } });
  if (c.path === '/api/advisors/me/engagements') return json({ items: [{ id: 9, client_name: 'Acme', title: 'Growth retainer', founder_user_id: 50 }], totals: {} });
  if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
  return json({});
};

test('mounted: Add version draws the canvas\'s three fields and saves note plus file as a form', async () => {
  // Mutation checked: sending the file version as JSON (the link method) posts no `file`, and fails below.
  const m = await mount((c) => {
    if (c.path === '/api/advisors/me/deliverables/5/versions') return json({ uid: 'n', version: 2 }, 201);
    return base([PLAIN])(c);
  });
  try {
    await m.pressId('open-pr3-5');
    await m.pressId('version-pr3-5');
    assert.match(m.text(), /Change note · required.*Document or URL · required.*Summary · optional/);
    assert.match(m.text(), /A PDF, JPEG or PNG of at most 10 MB\./);
    await m.submit('add-version-form-5');
    assert.equal(m.writes().length, 0, 'no note, no document: nothing is posted');
    assert.match(m.text(), /Say what changed/);
    await m.type('add-version-note-5', 'Added the hiring appendix');
    await m.submit('add-version-form-5');
    assert.equal(m.writes().length, 0, 'a note without a document is refused');
    assert.match(m.text(), /Choose a file, or enter a web address/);
    const file = pdf('hiring-v2.pdf');
    await m.choose('add-version-file-5', file);
    assert.match(m.textOf(m.byTestId('add-version-file-5-name')), /hiring-v2\.pdf/);
    await m.type('add-version-summary-5', 'Who to hire first, and when.');
    await m.submit('add-version-form-5');
    const writes = m.writes();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].path, '/api/advisors/me/deliverables/5/versions');
    const form = writes[0].body.form;
    assert.deepEqual(Object.keys(form).sort(), ['file', 'summary', 'version_summary']);
    assert.equal(form.summary, 'Added the hiring appendix');
    assert.equal(form.version_summary, 'Who to hire first, and when.');
    assert.equal(form.file.name, 'hiring-v2.pdf');
    assert.equal(m.byTestId('add-version-5') === undefined, true, 'a saved version closes the dialog');
    assert.match(m.text(), /Saved v2 of “Hiring plan” as a draft, not sent\./);
  } finally { await m.close(); }
});

test('mounted: note plus link still saves as JSON, with the summary only when written', async () => {
  const m = await mount((c) => {
    if (c.path === '/api/advisors/me/deliverables/5/versions') return json({ uid: 'n', version: 2 }, 201);
    return base([PLAIN])(c);
  });
  try {
    await m.pressId('open-pr3-5');
    await m.pressId('version-pr3-5');
    await m.type('add-version-note-5', 'Second pass');
    await m.type('add-version-link-5', 'https://docs.example/v2');
    await m.type('add-version-summary-5', 'A tighter read.');
    await m.submit('add-version-form-5');
    assert.deepEqual(m.writes().map((c) => [c.method, c.path, c.body]), [
      ['POST', '/api/advisors/me/deliverables/5/versions', { link_url: 'https://docs.example/v2', summary: 'Second pass', version_summary: 'A tighter read.' }],
    ]);
  } finally { await m.close(); }
});

test('mounted: a file the Worker refuses shows the Worker\'s sentence and saves nothing', async () => {
  // Mutation checked: `write` swallowing the refusal (returning null) closes the dialog with no sentence.
  for (const [status, detail, code] of [
    [413, 'The file is larger than 10 MB.', 'file_too_large'],
    [400, 'Upload a PDF, JPEG or PNG file.', 'file_type_invalid'],
  ]) {
    const m = await mount((c) => {
      if (c.path === '/api/advisors/me/deliverables/5/versions') return json({ detail, code }, status);
      return base([PLAIN])(c);
    });
    try {
      await m.pressId('open-pr3-5');
      await m.pressId('version-pr3-5');
      await m.type('add-version-note-5', 'Added the scan');
      // Passes the page's own check: only the Worker knows its bytes are not a PDF.
      await m.choose('add-version-file-5', pdf('scan.pdf'));
      const listReads = m.gets(/^\/api\/advisors\/me\/deliverables$/).length;
      await m.submit('add-version-form-5');
      assert.equal(m.writes().length, 1, 'one attempt');
      const dialog = m.byTestId('add-version-5');
      assert.ok(dialog, 'the dialog stays open');
      const alert = m.walk(dialog).find((n) => m.props(n)?.role === 'alert');
      assert.equal(alert && m.textOf(alert), detail, `${code}: the Worker's sentence`);
      assert.equal(m.gets(/^\/api\/advisors\/me\/deliverables$/).length, listReads, 'nothing was saved, so nothing is read back');
      assert.doesNotMatch(m.text(), /Saved v2/);
    } finally { await m.close(); }
  }
});

test('mounted: a file over 10 MB is refused before a byte is sent', async () => {
  const m = await mount(base([PLAIN]));
  try {
    await m.pressId('open-pr3-5');
    await m.pressId('version-pr3-5');
    await m.type('add-version-note-5', 'Added the deck');
    await m.choose('add-version-file-5', pdf('deck.pdf', 11 * 1024 * 1024));
    await m.submit('add-version-form-5');
    assert.equal(m.writes().length, 0);
    assert.match(m.text(), /The file is larger than 10 MB\./);
  } finally { await m.close(); }
});

test('mounted: the latest card shows a recorded summary and a file; a version without a summary shows nothing for it', async () => {
  // Mutation checked: drawing `<Unrecorded>Not recorded</Unrecorded>` for an absent summary fails the PLAIN half.
  const m = await mount(base([MEMO, PLAIN]));
  try {
    await m.pressId('open-pr3-4');
    const latest = m.textOf(m.byTestId('latest-version-4'));
    assert.match(latest, /“Change 2”Pricing moved to the appendix; the hiring plan is new\./);
    assert.equal(m.textOf(m.byTestId('latest-document-4-name')), 'memo-v2.pdf · 2.4 MB');
    assert.ok(m.byTestId('latest-document-4-download'));
    await m.pressId('deliverable-sheet-4-close');
    await m.pressId('open-pr3-5');
    assert.equal(m.byTestId('latest-summary-5') === undefined, true, 'no summary node at all');
    const plain = m.textOf(m.byTestId('latest-version-5'));
    assert.doesNotMatch(plain, /Not recorded|No summary|Summary/);
    assert.match(plain, /docs\.example/);
    assert.equal(m.byTestId('latest-document-5-download') === undefined, true, 'a link offers no download');
  } finally { await m.close(); }
});

test('mounted: the history shows each version\'s summary and file, and nothing in it edits them', async () => {
  // Mutation checked: dropping the history's file row removes `history-file-4-v2`, and a Remove button in it fails the control count.
  const m = await mount(base([MEMO]));
  try {
    await m.pressId('open-pr3-4');
    const list = m.byTestId('history-list-4');
    assert.match(m.textOf(m.byTestId('history-summary-4-v2')), /Pricing moved to the appendix/);
    assert.equal(m.byTestId('history-summary-4-v1') === undefined, true, 'v1 has no summary and shows nothing for it');
    assert.equal(m.textOf(m.byTestId('history-file-4-v2-name')), 'memo-v2.pdf · 2.4 MB');
    assert.equal(m.byTestId('history-file-4-v1') === undefined, true, 'a link version draws no file row');
    const controls = m.walk(list).filter((n) => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName));
    assert.deepEqual(controls.map((n) => m.textOf(n)), ['Download'], 'the one control is the download');
  } finally { await m.close(); }
});

test('mounted: Download saves the file; a failed or empty download says so with Retry and saves nothing', async () => {
  // Mutation checked: saving whatever came back (no `res.ok` check) hands the browser the 502's body;
  // dropping the empty check saves a zero-byte file.
  let answer = 'fail';
  const m = await mount((c) => {
    if (c.path === '/api/advisors/me/deliverables/4/versions/2/file') {
      if (answer === 'fail') return json({ detail: 'The file could not be read. Try again.', code: 'file_unreadable' }, 502);
      if (answer === 'empty') return binary(new Uint8Array(0));
      return binary(new Uint8Array([37, 80, 68, 70]));
    }
    return base([MEMO])(c);
  });
  try {
    await m.pressId('open-pr3-4');
    await m.pressId('latest-document-4-download');
    const call = m.gets(/\/file$/)[0];
    assert.equal(call.path, '/api/advisors/me/deliverables/4/versions/2/file');
    assert.equal(call.headers.Authorization, 'Bearer t-90', 'the authenticated request path');
    assert.equal(m.saved.length, 0, 'nothing is saved');
    assert.match(m.textOf(m.byTestId('latest-document-4-error')), /The file could not be read\. Try again\. Nothing was saved\.Retry/);
    answer = 'empty';
    await m.pressId('latest-document-4-retry');
    assert.equal(m.saved.length, 0, 'an empty body is never saved');
    assert.match(m.textOf(m.byTestId('latest-document-4-error')), /The file came back empty\./);
    answer = 'ok';
    await m.pressId('latest-document-4-retry');
    assert.equal(m.saved.length, 1);
    assert.equal(m.saved[0].size, 4);
    assert.equal(m.byTestId('latest-document-4-error') === undefined, true, 'the alert goes once it worked');
    assert.equal(m.writes().length, 0, 'a download writes nothing');
  } finally { await m.close(); }
});

test('mounted: the send confirmation names the file by its file name', async () => {
  const m = await mount(base([MEMO]));
  try {
    await m.pressId('open-pr3-4');
    assert.match(m.textOf(m.byTestId('send-preview-pr3-4')), /Sends v2 — “Change 2” · file memo-v2\.pdf/);
    await m.pressId('send-pr3-4');
    assert.equal(m.textOf(m.byTestId('send-confirm-document-4')), 'Q4 Strategy Memo v2 · file memo-v2.pdf');
    assert.match(m.textOf(m.byTestId('send-confirm-summary-4')), /Pricing moved to the appendix/);
  } finally { await m.close(); }
});

test('mounted: New work product takes a summary and a file for v1, and a refused file saves nothing', async () => {
  let refuse = true;
  const m = await mount((c) => {
    if (c.path === '/api/advisors/me/deliverables' && c.method === 'POST') {
      return refuse ? json({ detail: 'Upload a PDF, JPEG or PNG file.', code: 'file_type_invalid' }, 400) : json({ id: 7 }, 201);
    }
    return base([PLAIN])(c);
  });
  try {
    await m.pressId('action-delivery-new-work-product');
    assert.match(m.text(), /Summary · optional/);
    assert.match(m.text(), /Or a file/);
    const title = m.walk(document.body).find((n) => n.tagName === 'INPUT' && m.props(n)?.placeholder === 'Q2 advisory review');
    await act(async () => { m.props(title).onChange({ target: { value: 'Board memo' } }); });
    const engagement = m.walk(document.body).find((n) => n.tagName === 'SELECT');
    await act(async () => { m.props(engagement).onChange({ target: { value: '9' } }); });
    await m.choose('new-work-product-file', pdf('board.pdf'));
    await m.type('new-work-product-summary', 'For the March board.');
    await m.pressId('new-work-product-save');
    assert.equal(m.writes().length, 1);
    assert.deepEqual(Object.keys(m.writes()[0].body.form).sort(), ['engagement_id', 'file', 'title', 'version_summary']);
    assert.match(m.text(), /Upload a PDF, JPEG or PNG file\./);
    assert.ok(m.byTestId('new-work-product-save'), 'the form stays open');
    refuse = false;
    await m.pressId('new-work-product-save');
    assert.equal(m.writes().length, 2);
    assert.equal(m.byTestId('new-work-product-save') === undefined, true, 'created: the form closes');
  } finally { await m.close(); }
});

test('mounted: the client\'s received list offers a file version as a download, with Retry on failure', async () => {
  // Mutation checked: removing the received list's file row leaves no `received-file-u2`.
  let fail = true;
  const received = {
    items: [{
      uid: 'd1', title: 'Q4 Strategy Memo', advisor_name: 'Ada', advisor_uid: 'a1', state: 'sent', version_count: 2,
      versions: [
        FILE_V(2, { uid: 'u2', ...SENT, version_summary: 'The hiring plan is new.' }),
        V(1, { uid: 'u1', ...SENT }),
      ],
    }],
    totals: { work_products: 1, unread: 1, advisors: 1 },
  };
  const m = await mount((c) => {
    if (c.path === '/api/advisors/received/deliverables') return json(received);
    if (c.path === '/api/advisors/received/deliverables/u2/file') {
      return fail ? json({ detail: 'The file could not be read. Try again.', code: 'file_unreadable' }, 502) : binary(new Uint8Array([1, 2, 3]));
    }
    return json({ items: [] });
  }, h(AdvisorGrantSection, { projectUid: 'p1' }));
  try {
    assert.match(m.textOf(m.byTestId('received-file-u2-name')), /v2 · memo-v2\.pdf · 2\.4 MB/);
    assert.equal(m.byTestId('received-file-u1') === undefined, true, 'a link version keeps its link');
    assert.match(m.textOf(m.byTestId('received-summary-u2')), /The hiring plan is new\./);
    assert.equal(m.byTestId('received-summary-u1') === undefined, true);
    await m.pressId('received-file-u2-download');
    assert.equal(m.saved.length, 0);
    assert.match(m.textOf(m.byTestId('received-file-u2-error')), /could not be downloaded.*Nothing was saved/);
    fail = false;
    await m.pressId('received-file-u2-retry');
    assert.equal(m.saved.length, 1);
    assert.equal(m.writes().length, 0, 'a download records nothing: opening stays the client\'s own Mark open');
  } finally { await m.close(); }
});

test('every new class on the file and summary surfaces has its dark twin', () => {
  const file = read('frontend/src/pages/advisor/practice/VersionFile.jsx');
  for (const cls of file.match(/className="[^"]*"/g) || []) {
    if (/text-(red|emerald|axal-ink|axal-faint)|border-axal|bg-axal/.test(cls)) assert.match(cls, /dark:/, cls);
  }
});
