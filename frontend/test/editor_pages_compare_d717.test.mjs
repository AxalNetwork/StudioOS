/**
 * D717 (#1853) — the template editor's Pages view and Compare versions: the
 * page viewer (pdf.js, pinned, canvas only), the draft's PDF from
 * render.pdf, one request body for both middle-pane views, and the version
 * compare with its save dates. Every title, slug, name and id is synthetic.
 * pdf.js itself is never loaded here: each PdfPages gets a stub `load`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/editor_pages_compare_d717.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { RENDER_BODY_MAX } from '../src/lib/api/contracts.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import PdfPages, { pdfjsSource, pinchScale } from '../src/pages/admin/contracts/PdfPages.jsx';
import VersionCompare from '../src/pages/admin/contracts/VersionCompare.jsx';
import { paperRequest } from '../src/components/PaperPreview.jsx';
import { defaultPair, metaLines, pickPair, savedLine, versionEntries, NO_EDITOR } from '../src/lib/templateVersions.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (rel) => readFileSync(join(root, rel), 'utf8');
const originals = { ...api }, contractOriginals = { ...contractsApi }, sourceOriginal = pdfjsSource.load;
const never = () => new Promise(() => {});
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); pdfjsSource.load = sourceOriginal; };
const user = { id: 2, role: 'admin', name: 'Test Admin', is_super_admin: 1 };

// The stub DOM's text nodes take React's updates on `nodeValue`.
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
function helpers(view) {
  const text = () => textOf(view.nodes()[0]);
  const buttons = () => view.nodes().filter(n => n.tagName === 'BUTTON');
  const button = (label) => buttons().find(b => textOf(b).trim() === label);
  const click = async (label) => {
    const n = button(label);
    if (!n) throw new Error('Missing button: ' + label);
    if (view.props(n).disabled) throw new Error('Disabled button: ' + label);
    await act(async () => { view.props(n).onClick({ stopPropagation() {} }); });
    await view.flush();
  };
  const byTestId = (id) => view.nodes().find(n => view.props(n)?.['data-testid'] === id);
  return { text, buttons, button, click, byTestId };
}

/** A fake pdf.js: a `pages`-page document, every call recorded. */
function fakePdfjs(pages = 3) {
  const log = { getDocument: [], render: [], destroyed: 0 };
  const lib = {
    AnnotationMode: { DISABLE: 0, ENABLE: 1 },
    getDocument(opts) {
      log.getDocument.push(opts);
      return {
        promise: Promise.resolve({
          numPages: pages,
          getPage: async (n) => ({
            getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
            render(o) { log.render.push({ page: n, ...o }); return { promise: Promise.resolve(), cancel() {} }; },
          }),
        }),
        destroy() { log.destroyed += 1; },
      };
    },
  };
  return { lib, log };
}
function fakeBlob() {
  const blob = { reads: 0, arrayBuffer: async () => { blob.reads += 1; return new Uint8Array([37, 80, 68, 70]).buffer; } };
  return blob;
}

async function mountPages(props) {
  const view = await mountContracts(React.createElement(PdfPages, props));
  await view.flush(); await view.flush();
  return { view, ...helpers(view) };
}

// ---------------------------------------------------------------- PdfPages

test('PdfPages: Page 1 of 3, Next and Previous move the counter and stop at each end', async () => {
  const { lib } = fakePdfjs(3);
  const p = await mountPages({ blob: fakeBlob(), title: 'Test Agreement', load: async () => lib });
  try {
    assert.match(p.text(), /Page 1 of 3/);
    assert.equal(p.view.props(p.button('‹ Previous')).disabled, true);
    assert.equal(p.view.props(p.button('Next ›')).disabled, false);
    await p.click('Next ›');
    assert.match(p.text(), /Page 2 of 3/);
    await p.click('Next ›');
    assert.match(p.text(), /Page 3 of 3/);
    assert.equal(p.view.props(p.button('Next ›')).disabled, true);
    await p.click('‹ Previous');
    assert.match(p.text(), /Page 2 of 3/);
    const canvas = p.view.nodes().find(n => n.tagName === 'CANVAS');
    assert.equal(p.view.props(canvas)['aria-label'], 'Page 2 of 3 of Test Agreement');
    assert.equal(p.view.props(canvas).role, 'img');
  } finally { await p.view.unmount(); }
});

test('PdfPages: opens with no eval and no XFA, draws on a canvas with annotations off', async () => {
  const { lib, log } = fakePdfjs(2);
  const p = await mountPages({ blob: fakeBlob(), load: async () => lib });
  try {
    assert.equal(log.getDocument.length, 1);
    const opts = log.getDocument[0];
    assert.equal(opts.isEvalSupported, false);
    assert.equal(opts.enableXfa, false);
    assert.ok(opts.data instanceof Uint8Array);
    assert.ok(log.render.length >= 1);
    const r = log.render.at(-1);
    assert.equal(r.annotationMode, 0);
    assert.equal(r.canvas?.tagName, 'CANVAS');
    assert.ok(!('canvasContext' in r), 'the canvas is handed over, never a 2D context');
  } finally { await p.view.unmount(); }
});

test('PdfPages: a failed load says so with Try again, which loads again and reads the blob afresh', async () => {
  const { lib, log } = fakePdfjs(1);
  let loads = 0;
  const load = async () => { loads += 1; if (loads === 1) throw new Error('chunk failed'); return lib; };
  const blob = fakeBlob();
  const p = await mountPages({ blob, load });
  try {
    assert.match(p.text(), /The pages could not be drawn\. Try again\./);
    assert.ok(p.button('Try again'));
    await p.click('Try again');
    await p.view.flush();
    assert.equal(loads, 2);
    assert.match(p.text(), /Page 1 of 1/);
    assert.equal(blob.reads, 1, 'the failed load never reached the blob');
    assert.equal(log.getDocument.length, 1);
  } finally { await p.view.unmount(); }
});

test('PdfPages: every open reads the blob again, so pdf.js never gets moved bytes twice', async () => {
  const { lib, log } = fakePdfjs(1);
  let opens = 0;
  const flaky = { ...lib, getDocument(opts) { opens += 1; if (opens === 1) { log.getDocument.push(opts); return { promise: Promise.reject(new Error('bad')), destroy() {} }; } return lib.getDocument(opts); } };
  const blob = fakeBlob();
  const p = await mountPages({ blob, load: async () => flaky });
  try {
    await p.click('Try again');
    await p.view.flush();
    assert.equal(blob.reads, 2);
    assert.equal(log.getDocument.length, 2);
    assert.notEqual(log.getDocument[0].data, log.getDocument[1].data);
  } finally { await p.view.unmount(); }
});

test('PdfPages: the fallback renderer gets its note; Browser Run gets none', async () => {
  const note = 'These page breaks come from the fallback renderer. A sent copy may break differently.';
  let p = await mountPages({ blob: fakeBlob(), renderer: 'pdf_lib', load: async () => fakePdfjs(1).lib });
  try { assert.ok(p.text().includes(note)); } finally { await p.view.unmount(); }
  for (const renderer of ['browser_run', null]) {
    p = await mountPages({ blob: fakeBlob(), renderer, load: async () => fakePdfjs(1).lib });
    try { assert.ok(!p.text().includes(note), String(renderer)); } finally { await p.view.unmount(); }
  }
});

test('pinchScale: scales by finger distance, held to 1–3', () => {
  assert.equal(pinchScale(1, 100, 200), 2);
  assert.equal(pinchScale(2, 100, 400), 3);
  assert.equal(pinchScale(2, 100, 10), 1);
  assert.equal(pinchScale(1.5, 0, 200), 1.5);
});

// ---------------------------------------------------------------- source and package guards

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test('pdf.js: only PdfPages names it, never statically, and no text, annotation or XFA layer', () => {
  const files = walk(join(root, 'src')).filter(f => /\.(jsx?|mjs|tsx?)$/.test(f));
  const naming = files.filter(f => readFileSync(f, 'utf8').includes('pdfjs-dist')).map(f => f.slice(root.length));
  assert.deepEqual(naming, ['src/pages/admin/contracts/PdfPages.jsx']);
  const pages = src('src/pages/admin/contracts/PdfPages.jsx');
  assert.ok(!/^\s*import\s[^(]*from\s+['"]pdfjs-dist/m.test(pages), 'no static import');
  assert.ok(!/TextLayer|AnnotationLayer|XfaLayer/.test(pages));
  assert.ok(/import\('pdfjs-dist\/legacy\/build\/pdf\.min\.mjs'\)/.test(pages), 'the legacy build');
});

test('pdf.js: pinned exactly in package.json and the lock, and the installed legacy bundles hold no eval path', () => {
  const pkg = JSON.parse(src('package.json'));
  assert.equal(pkg.dependencies['pdfjs-dist'], '6.4.299');
  const lock = JSON.parse(src('package-lock.json'));
  assert.equal(lock.packages['node_modules/pdfjs-dist'].version, '6.4.299');
  assert.equal(lock.packages[''].dependencies['pdfjs-dist'], '6.4.299');
  for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    const code = src(`node_modules/pdfjs-dist/legacy/build/${file}`);
    assert.ok(!code.includes('new Function('), `${file}: new Function`);
    assert.ok(!/(^|[^.\w$])eval\s*\(/.test(code), `${file}: eval(`);
  }
});

test('paperRequest: the one body both views post; Kind and party left undefined send no key, null sends "from the slug"', () => {
  assert.deepEqual(
    paperRequest({ title: 'Test Agreement', body: 'Text', docType: 'd717_test_agreement', category: 'gp', version: 3, resolveTokens: false, pageSize: 'a4', cover: 'light' }),
    { title: 'Test Agreement', body: 'Text', slug: 'd717_test_agreement', category: 'gp', version: 3, resolve: 'raw', page_size: 'a4', cover: 'light' },
  );
  const fromSlug = paperRequest({ title: 'T', body: 'B', docKind: null, axalParty: null });
  assert.ok('doc_kind' in fromSlug && fromSlug.doc_kind === null);
  assert.ok('axal_party' in fromSlug && fromSlug.axal_party === null);
  assert.equal(paperRequest({ title: 'T', body: 'B', version: 'x' }).version, null);
});

// ---------------------------------------------------------------- renderPdfBlob

test('renderPdfBlob: POSTs the body to render.pdf with the CSRF header, and returns the blob and its renderer', async () => {
  const undo = installDocument();
  const fetchOriginal = globalThis.fetch;
  const sent = [];
  try {
    globalThis.location.hostname = 'axal.vc';
    document.cookie = 'studioos_csrf=csrf-fixture';
    globalThis.fetch = async (url, init) => {
      sent.push([url, init]);
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'Content-Type': 'application/pdf', 'X-Axal-Renderer': 'pdf_lib' } });
    };
    const body = paperRequest({ title: 'Test Agreement', body: 'Text', docType: 'd717_test_agreement', version: 3 });
    const out = await contractsApi.renderPdfBlob(body);
    assert.equal(sent.length, 1);
    const [url, init] = sent[0];
    assert.equal(url, '/api/admin/contracts/templates/render.pdf');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers['X-CSRF-Token'], 'csrf-fixture');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), body);
    assert.equal(out.renderer, 'pdf_lib');
    assert.equal((await out.blob.arrayBuffer()).byteLength, 4);
  } finally { globalThis.fetch = fetchOriginal; undo(); }
});

test('renderPdfBlob: a 413 answer is refused with its status; an over-long body is refused before any request', async () => {
  const undo = installDocument();
  const fetchOriginal = globalThis.fetch;
  let fetched = 0;
  try {
    globalThis.fetch = async () => { fetched += 1; return new Response(JSON.stringify({ error: 'The body is over 256 KB, so it cannot be previewed.', code: 'body_too_large' }), { status: 413, headers: { 'Content-Type': 'application/json' } }); };
    await assert.rejects(contractsApi.renderPdfBlob({ body: 'short' }),
      e => e.status === 413 && e.code === 'body_too_large' && e.message === 'The body is over 256 KB, so it cannot be previewed.');
    assert.equal(fetched, 1);
    const long = 'é'.repeat(RENDER_BODY_MAX / 2 + 1); // two bytes each: just over the limit in UTF-8
    await assert.rejects(contractsApi.renderPdfBlob({ body: long }), e => e.status === 413 && e.code === 'body_too_large' && /over 256 KB/.test(e.message));
    assert.equal(fetched, 1, 'no request for a body over the limit');
    globalThis.fetch = async () => { fetched += 1; return new Response(new Uint8Array([1]), { status: 200 }); };
    await contractsApi.renderPdfBlob({ body: 'x'.repeat(RENDER_BODY_MAX) });
    assert.equal(fetched, 2, 'a body at the limit is sent');
  } finally { globalThis.fetch = fetchOriginal; undo(); }
});

// ---------------------------------------------------------------- the editor

const OPTIONS = (derived, entity) => ({
  kinds: ['agreement', 'corporate', 'resolution', 'unilateral', 'policy'],
  parties: ['management', 'holdings', 'gp', 'fund', 'none'],
  partyless_kinds: ['unilateral', 'corporate', 'policy'],
  derived, entity,
});
const ROW = {
  category: 'gp', doc_kind: null, axal_party: null, format_fixed: false, usage_count: 0, published_version: null, is_stub: 0,
  slug: 'd717_test_agreement', title: 'Test Agreement', version: 3, body_md: '# Test Agreement\n## One {{a.b}}\nText',
  kind: 'agreement', party: 'gp', format_options: OPTIONS({ kind: 'agreement', party: 'gp' }, 'gp'),
  created_at: '2026-01-01 10:00:00', created_by: 4, updated_at: '2026-03-01 10:00:00', updated_by: 7,
};
const SNAPSHOTS = [
  { version: 2, title: 'Test Agreement', body_md: '# Test Agreement\n## One {{a.b}}\nOld text', doc_kind: null, axal_party: null, created_at: '2026-03-01 10:00:00', created_by: 7 },
  { version: 1, title: 'Test Agreement', body_md: '# Test Agreement\nFirst text', doc_kind: null, axal_party: null, created_at: '2026-02-01 10:00:00', created_by: 5 },
];

function setupEditor({ contract = {}, legacy = {} } = {}) {
  const calls = [];
  const { lib } = fakePdfjs(2);
  pdfjsSource.load = async () => lib;
  const answers = {
    adminTemplateStoreGet: async () => ({ template: { ...ROW } }),
    adminTemplateStoreVersions: async () => ({ current: { ...ROW }, versions: SNAPSHOTS }),
    adminTemplateStoreUpdate: async (slug, payload) => ({ template: { ...ROW, ...payload, version: ROW.version + 1 } }),
    getMe: never,
    ...legacy,
  };
  const contractAnswers = {
    templates: async () => ({ items: [ROW] }),
    stats: never,
    renderPaper: async () => ({ html: '<p>paper</p>', paper_sha256: 'sha-fixture', fields: [] }),
    paperFonts: async () => ({ paper_sha256: 'sha-fixture', css: '' }),
    renderPdfBlob: async () => ({ blob: fakeBlob(), renderer: 'browser_run' }),
    ...contract,
  };
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...args) => { calls.push([key, args]); return (answers[key] || never)(...args); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  return calls;
}
const of = (calls, key) => calls.filter(([k]) => k === key);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 560)); });

async function openEditor(opts = {}) {
  const calls = setupEditor(opts);
  const view = await mountContracts(React.createElement(AuthProvider, null, React.createElement(Desk)), '/admin/contracts?tab=templates', user);
  await view.flush();
  await view.click(ROW.title);
  await view.flush();
  await settle();
  const h = helpers(view);
  const pane = async (text) => {
    const group = view.nodes().find(n => view.props(n)?.role === 'group' && view.props(n)['aria-label'] === 'Middle pane');
    const b = (group?.childNodes || []).find(n => textOf(n) === text);
    if (!b) throw new Error('Missing pane option: ' + text);
    await act(async () => { view.props(b).onClick(); });
    await view.flush(); await view.flush();
  };
  const type = async (value) => { await act(async () => { view.props(h.byTestId('template-body')).onChange({ target: { value } }); }); };
  return { calls, view, pane, type, ...h };
}

test('Pages: one draw on opening, the same body the live paper posts apart from fonts, and none per keystroke', async () => {
  const e = await openEditor();
  try {
    const paper = of(e.calls, 'renderPaper').at(-1)[1][0];
    assert.equal(of(e.calls, 'renderPdfBlob').length, 0, 'the live paper never draws pages');
    await e.pane('Pages');
    assert.equal(of(e.calls, 'renderPdfBlob').length, 1);
    const pages = of(e.calls, 'renderPdfBlob')[0][1][0];
    const { fonts, ...rest } = paper;
    assert.equal(fonts, 'omit');
    assert.deepEqual(pages, rest, 'decision 8: one request body for both views');
    assert.equal(pages.slug, 'd717_test_agreement');
    assert.ok('doc_kind' in pages && pages.doc_kind === null, 'From the slug is sent as null');
    assert.ok('axal_party' in pages && pages.axal_party === null);
    assert.match(e.text(), /Page 1 of 2/);
    await e.type('# Test Agreement\nChanged');
    await e.view.flush();
    assert.equal(of(e.calls, 'renderPdfBlob').length, 1, 'no draw per keystroke');
    assert.match(e.text(), /The draft changed since these pages were drawn\./);
    await e.click('Redraw pages');
    assert.equal(of(e.calls, 'renderPdfBlob').length, 2);
    assert.equal(of(e.calls, 'renderPdfBlob')[1][1][0].body, '# Test Agreement\nChanged');
    assert.ok(!/The draft changed since/.test(e.text()));
  } finally { await e.view.unmount(); restore(); }
});

test('Pages: a 413 says why with no Try again; another failure offers Try again', async () => {
  const tooLarge = Object.assign(new Error('The body is over 256 KB, so it cannot be previewed.'), { status: 413, code: 'body_too_large' });
  let e = await openEditor({ contract: { renderPdfBlob: async () => { throw tooLarge; } } });
  try {
    await e.pane('Pages');
    assert.match(e.text(), /over 256 KB/);
    assert.ok(!e.button('Try again'));
  } finally { await e.view.unmount(); restore(); }
  e = await openEditor({ contract: { renderPdfBlob: async () => { throw Object.assign(new Error('The pages could not be drawn.'), { status: 502 }); } } });
  try {
    await e.pane('Pages');
    assert.ok(e.button('Try again'));
    await e.click('Try again');
    assert.equal(of(e.calls, 'renderPdfBlob').length, 2);
  } finally { await e.view.unmount(); restore(); }
});

test('Compare versions: takes the place of the panes; Restore copies a body into the draft and saves nothing', async () => {
  const e = await openEditor();
  try {
    await e.click('Compare versions');
    await e.view.flush();
    assert.ok(e.byTestId('version-compare'));
    assert.ok(!e.byTestId('template-body'), 'the panes give way to the compare');
    const restoreV1 = e.view.nodes().filter(n => n.tagName === 'BUTTON' && textOf(n) === 'Restore')
      .find(n => textOf(n.parentNode).includes('v1'));
    await act(async () => { e.view.props(restoreV1).onClick(); });
    await e.view.flush();
    assert.ok(!e.byTestId('version-compare'));
    assert.equal(e.view.props(e.byTestId('template-body')).value, SNAPSHOTS[1].body_md);
    assert.equal(of(e.calls, 'adminTemplateStoreUpdate').length, 0, 'Restore saves nothing');
  } finally { await e.view.unmount(); restore(); }
});

// ---------------------------------------------------------------- templateVersions

const T1 = '2026-01-01 10:00:00', T2 = '2026-02-01 10:00:00', T3 = '2026-03-01 10:00:00';
const FIXTURE = {
  current: { version: 3, title: 'T', body_md: 'alpha beta gamma', doc_kind: null, axal_party: null, created_at: T1, created_by: 4, updated_at: T3, updated_by: 7 },
  versions: [
    { version: 2, title: 'T', body_md: 'alpha beta delta', doc_kind: null, axal_party: null, created_at: T3, created_by: 7 },
    { version: 1, title: 'T', body_md: 'alpha', doc_kind: null, axal_party: null, created_at: T2, created_by: 5 },
  ],
};

test('templateVersions: each version is dated by the save that made it, not by its snapshot row', () => {
  const entries = versionEntries(FIXTURE);
  assert.deepEqual(entries.map(e => [e.key, e.saved.at, e.saved.by]), [['v3', T3, 7], ['v2', T2, 5], ['v1', T1, 4]]);
  assert.equal(savedLine(entries[0].saved), `Saved · ${T3} · Admin #7`);
  assert.equal(savedLine(null), 'Not saved');
  assert.equal(savedLine({ at: null, by: null }), `Saved · date not recorded · ${NO_EDITOR}`);
  const gap = versionEntries({ current: FIXTURE.current, versions: [FIXTURE.versions[0]] });
  assert.deepEqual(gap.find(e => e.key === 'v2').saved, { at: null, by: null }, 'v1 missing: v2 is not guessed');
  const withDraft = versionEntries(FIXTURE, { title: 'T', body_md: 'draft' });
  assert.equal(withDraft[0].key, 'draft');
  assert.equal(withDraft[0].saved, null);
});

test('templateVersions: the default pair, picking, and the meta lines', () => {
  const entries = versionEntries(FIXTURE);
  assert.deepEqual(defaultPair(entries, false), ['v2', 'v3']);
  const drafted = versionEntries(FIXTURE, { title: 'T', body_md: 'x' });
  assert.deepEqual(defaultPair(drafted, true), ['v3', 'draft']);
  assert.equal(defaultPair(versionEntries({ current: FIXTURE.current, versions: [] }), false), null);
  let s = pickPair(entries, ['v2', 'v3'], null, 'v1');
  assert.deepEqual(s.pair, ['v1', 'v3'], 'the side picked earlier gives way');
  s = pickPair(entries, s.pair, s.picked, 'v2');
  assert.deepEqual(s.pair, ['v1', 'v2'], 'the pair is always the last two clicks, older first');
  assert.deepEqual(pickPair(drafted, ['v1', 'v2'], null, 'draft').pair, ['v2', 'draft'], 'the draft is always newer');
  assert.deepEqual(pickPair(drafted, ['v3', 'draft'], null, 'v1').pair, ['v1', 'draft'], 'the draft stays newer when it is the side kept');
  assert.deepEqual(
    metaLines({ title: 'A', doc_kind: null, axal_party: 'gp' }, { title: 'B', doc_kind: 'corporate', axal_party: 'fund' },
      { derived: { kind: 'agreement', party: 'gp' }, partyLabel: p => ({ gp: 'GP', fund: 'GP for the Fund' })[p] }),
    ['Title: "A" → "B"', 'Kind: From the slug (agreement) → corporate', 'Axal VC party: GP → GP for the Fund'],
  );
});

// ---------------------------------------------------------------- VersionCompare

async function mountCompare(props, answer = async () => FIXTURE) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...args) => { calls.push([key, args]); return never(); };
  api.adminTemplateStoreVersions = (...args) => { calls.push(['adminTemplateStoreVersions', args]); return answer(...args); };
  const view = await mountContracts(React.createElement(VersionCompare, { slug: 'd717_test_agreement', draftChanged: false, ...props }));
  await view.flush(); await view.flush();
  const rows = () => view.nodes().filter(n => view.props(n)?.['data-version-row']);
  const pressed = () => rows().filter(n => view.props(n)['aria-pressed']).map(n => view.props(n)['data-version-row']);
  return { calls, view, rows, pressed, ...helpers(view) };
}

test('VersionCompare: one row per version; the two newest saved shown; one changed word struck and underlined', async () => {
  const c = await mountCompare({});
  try {
    assert.deepEqual(c.rows().map(n => c.view.props(n)['data-version-row']), ['v3', 'v2', 'v1']);
    assert.deepEqual(c.pressed(), ['v3', 'v2']);
    const dels = c.view.nodes().filter(n => n.tagName === 'DEL').map(textOf);
    const inss = c.view.nodes().filter(n => n.tagName === 'INS').map(textOf);
    assert.deepEqual(dels.map(t => t.trim()), ['delta']);
    assert.deepEqual(inss.map(t => t.trim()), ['gamma']);
    assert.ok(textOf(c.byTestId('version-compare-older')).includes('alpha beta'));
    await act(async () => { c.view.props(c.rows()[2]).onClick(); });
    assert.deepEqual(c.pressed(), ['v3', 'v1']);
    assert.ok(!c.button('Restore'), 'no Restore without authoring');
    assert.ok(!c.calls.some(([k]) => k === 'adminTemplateStoreUpdate'));
  } finally { await c.view.unmount(); restore(); }
});

test('VersionCompare: the draft is compared with the current version when it changed', async () => {
  const c = await mountCompare({ draftChanged: true, draft: { title: 'T', body_md: 'alpha beta epsilon', doc_kind: null, axal_party: null } });
  try {
    assert.deepEqual(c.rows().map(n => c.view.props(n)['data-version-row']), ['draft', 'v3', 'v2', 'v1']);
    assert.deepEqual(c.pressed(), ['draft', 'v3']);
    assert.match(textOf(c.byTestId('version-compare-newer')), /Draft · not saved/);
    assert.match(c.text(), /Not saved/);
  } finally { await c.view.unmount(); restore(); }
});

test('VersionCompare: Restore hands the body to the editor and calls nothing', async () => {
  const restored = [];
  const c = await mountCompare({ authoring: true, onRestore: (b) => restored.push(b) });
  try {
    const buttons = c.buttons().filter(b => textOf(b) === 'Restore');
    assert.equal(buttons.length, 3);
    await act(async () => { c.view.props(buttons[2]).onClick(); });
    assert.deepEqual(restored, ['alpha']);
    assert.deepEqual(c.calls.map(([k]) => k), ['adminTemplateStoreVersions']);
  } finally { await c.view.unmount(); restore(); }
});

test('VersionCompare: over 20,000 words a side compares line by line, and says so', async () => {
  const big = { ...FIXTURE, current: { ...FIXTURE.current, body_md: 'w '.repeat(20001) + 'end' }, versions: [{ ...FIXTURE.versions[0], body_md: 'w '.repeat(20001) + 'stop' }] };
  const c = await mountCompare({}, async () => big);
  try {
    assert.match(textOf(c.byTestId('version-compare-notes')), /Over 20,000 words a side, so this compares line by line\./);
  } finally { await c.view.unmount(); restore(); }
});

test('VersionCompare: a failed read says Unreadable; one version alone says there is nothing to compare', async () => {
  let c = await mountCompare({}, async () => { throw new Error('down'); });
  try {
    assert.match(c.text(), /Unreadable\./);
    assert.ok(!/\b0\b/.test(c.text()));
  } finally { await c.view.unmount(); restore(); }
  c = await mountCompare({}, async () => ({ current: FIXTURE.current, versions: [] }));
  try {
    assert.match(c.text(), /There is one saved version and no unsaved change to compare it with\./);
  } finally { await c.view.unmount(); restore(); }
});

test('VersionCompare: no hex colour in the compare or its model; marks carry a strike and an underline', () => {
  for (const rel of ['src/pages/admin/contracts/VersionCompare.jsx', 'src/lib/templateVersions.js']) {
    // Comments cite issues (#1853); the code is what must carry no colour literal.
    const code = src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(code), rel);
  }
  const compare = src('src/pages/admin/contracts/VersionCompare.jsx');
  assert.match(compare, /const del = '[^']*line-through/);
  assert.match(compare, /const ins = '[^']*underline/);
  assert.ok(!/dangerouslySetInnerHTML/.test(compare));
});
