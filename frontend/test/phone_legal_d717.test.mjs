/**
 * D717 (#1854) — Contracts › Templates on a phone (board L12, frames p-list,
 * p-sheet, p-preview): the list by layer with every row's thumbnail, kind and
 * state; the filter sheet that applies only on "Show [n] templates"; and the
 * read-only paged preview. Every title, slug and figure is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_legal_d717.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { api, contractsApi } from '../src/lib/api.js';
import AdminTemplates from '../src/pages/admin/AdminTemplates.jsx';
import TemplatePreviewPhone from '../src/pages/admin/contracts/TemplatePreviewPhone.jsx';
import { FALLBACK_NOTE } from '../src/pages/admin/contracts/PdfPages.jsx';
import { PhoneSheet } from '../src/ui/phone/PhoneSheet.jsx';
import { BELOW_MD_QUERY, usePhoneWidth } from '../src/ui/phone/usePhoneWidth.js';
import { KIND_FILTERS, activeFilterCount, filterCatalog } from '../src/lib/templateCatalogModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const SRC = new URL('../src/', import.meta.url).pathname;
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');
const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); delete globalThis.matchMedia; };

const LABEL = { gp: 'Internal Management (GP Level)', fund: 'Fund Formation (LP Level)', portfolio: 'Investment Execution (Portfolio Level)', compliance: 'Compliance & Regulatory' };
const row = (slug, layer, o = {}) => ({
  slug, title: o.title || `Fixture ${slug}`, layer, layer_label: LABEL[layer], kind: 'agreement', body_md: 'Body.', is_stub: 0,
  version: 1, published_version: null, has_unpublished_changes: true, usage_count: 0, counsel_draft: false, ...o,
});
const ROWS = [
  row('gp_counsel', 'gp', { kind: 'policy', is_stub: 1, body_md: '', counsel_draft: true }),
  row('gp_stub', 'gp', { is_stub: 1, body_md: '' }),
  row('gp_body', 'gp'),
  row('gp_pub', 'gp', { version: 3, published_version: 3, has_unpublished_changes: false }),
  row('gp_pub_changed', 'gp', { version: 4, published_version: 2, has_unpublished_changes: true }),
  row('gp_extra', 'gp', { title: 'Fixture Sixth Row' }),
  row('fund_stub', 'fund', { is_stub: 1, body_md: '' }),
  row('fund_body', 'fund'),
  row('fund_pub', 'fund', { version: 2, published_version: 2, has_unpublished_changes: false }),
  row('folio_body', 'portfolio', { kind: 'unilateral' }),
  row('comp_notice', 'compliance', { kind: 'notice', title: 'Fixture Capital Notice' }),
];

// The stub DOM's text nodes take React's updates on `nodeValue`.
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
function LocationProbe() { const l = useLocation(); return React.createElement('i', { 'data-testid': 'probe', 'data-search': l.search }); }

function stubClients({ thumb, pdf } = {}) {
  const calls = [];
  const pending = { now: 0, max: 0 };
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...a) => { calls.push([key, a]); return never(); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...a) => { calls.push([key, a]); return never(); };
  contractsApi.templates = async () => ({ items: ROWS });
  contractsApi.thumbnailBlob = (...a) => {
    calls.push(['thumbnailBlob', a]);
    pending.now += 1; pending.max = Math.max(pending.max, pending.now);
    return (thumb ? thumb(...a) : Promise.resolve({ url: `blob:thumb-${a[0]}` })).finally(() => { pending.now -= 1; });
  };
  api.adminTemplateStorePreviewPdfBlob = (...a) => { calls.push(['adminTemplateStorePreviewPdfBlob', a]); return pdf ? pdf(...a) : never(); };
  return { calls, pending };
}

async function mountTab({ query = BELOW_MD_QUERY, ...opts } = {}) {
  const clients = stubClients(opts);
  if (query) globalThis.matchMedia = (q) => ({ matches: q === query, addEventListener() {}, removeEventListener() {} });
  const view = await mountContracts(React.createElement(React.Fragment, null,
    React.createElement(AdminTemplates, { recordedPublication: true }), React.createElement(LocationProbe)), '/admin/contracts?tab=templates');
  for (let i = 0; i < 4; i++) await view.flush();
  const text = () => textOf(view.nodes()[0]);
  const byTestId = (id) => view.nodes().find(n => view.props(n)?.['data-testid'] === id);
  const clickNode = async (n) => { if (!n) throw new Error('missing node'); await act(async () => { view.props(n).onClick({ stopPropagation() {} }); }); await view.flush(); };
  const button = (label, scope) => (scope ? walk(scope) : view.nodes()).find(n => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
  const group = (label) => view.nodes().find(n => view.props(n)?.role === 'group' && view.props(n)['aria-label'] === label);
  const chips = (label) => walk(group(label)).filter(n => n.tagName === 'BUTTON').map(n => [textOf(n), view.props(n)['aria-pressed']]);
  const rows = () => view.nodes().filter(n => String(view.props(n)?.['data-testid'] || '').startsWith('template-phone-row-')).map(n => view.props(n)['data-testid'].slice('template-phone-row-'.length));
  const search = () => byTestId('probe') && view.props(byTestId('probe'))['data-search'];
  return { ...clients, view, text, byTestId, clickNode, button, group, chips, rows, search, walk };
}

test('List: every layer in order with its eyebrow, every row (not three), and each row\'s kind and state', async () => {
  const t = await mountTab();
  try {
    assert.match(t.text(), /^Templates\s*Filters/);
    const words = t.text();
    const at = Object.values(LABEL).map(l => words.indexOf(l));
    assert.ok(at.every(i => i >= 0) && at.every((v, i) => i === 0 || v > at[i - 1]), 'four eyebrows in LAYER_ORDER');
    assert.deepEqual(t.rows().filter(s => s.startsWith('gp_')), ['gp_counsel', 'gp_stub', 'gp_body', 'gp_pub', 'gp_pub_changed', 'gp_extra']);
    const sub = (slug) => textOf(t.byTestId(`template-phone-row-${slug}`)).replace(/›$/, '').replace(ROWS.find(r => r.slug === slug).title, '');
    assert.equal(sub('gp_counsel'), 'policy · Stub — counsel to draft');
    assert.equal(sub('gp_stub'), 'agreement · Stub · no body in the store');
    assert.equal(sub('gp_body'), 'agreement · Has a body');
    assert.equal(sub('gp_pub'), 'agreement · Published v3');
    assert.equal(sub('gp_pub_changed'), 'agreement · Published v2 · Changes not published');
    // Nothing to author.
    // Whole words: "Published v3" is a state label, not the Publish control.
    assert.doesNotMatch(words, /New template|Push to branches|\bPublish\b|Add body|\buses\b|\bDelete\b/);
    assert.ok(!t.view.nodes().some(n => String(t.view.props(n)?.['data-testid'] || '').startsWith('template-card-')));
    assert.ok(!t.view.nodes().some(n => n.tagName === 'TEXTAREA'));
  } finally { await t.view.unmount(); restore(); }
});

test('Width: no matchMedia, or a tablet matching only (max-width: 1023px), draws the desktop catalog', async () => {
  for (const query of [null, '(max-width: 1023px)']) {
    const t = await mountTab({ query });
    try {
      assert.ok(t.byTestId('template-card-gp_counsel'), `desktop under ${query}`);
      assert.equal(t.byTestId('template-catalog-phone'), undefined);
    } finally { await t.view.unmount(); restore(); }
  }
});

test('Thumbnails: every row asks for its version, four at a time, alt=""; a failure is an empty frame with the sentence as its title, no icon', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const t = await mountTab({ thumb: (slug) => gate.then(() => ({ url: `blob:thumb-${slug}` })) });
  try {
    assert.ok(t.pending.max <= 4 && t.pending.max >= 1, `max in flight ${t.pending.max}`);
    release();
    for (let i = 0; i < 8; i++) await t.view.flush();
    const asked = t.calls.filter(([k]) => k === 'thumbnailBlob').map(([, a]) => a);
    assert.deepEqual(asked.map(a => a[0]).sort(), ROWS.map(r => r.slug).sort());
    assert.ok(asked.every(([slug, version]) => version === ROWS.find(r => r.slug === slug).version));
    const imgs = t.view.nodes().filter(n => n.tagName === 'IMG');
    assert.equal(imgs.length, ROWS.length);
    assert.ok(imgs.every(n => t.view.props(n).alt === ''));
  } finally { await t.view.unmount(); restore(); }
  const sentence = 'Thumbnail not drawn: the page renderer did not answer.';
  const f = await mountTab({ thumb: () => Promise.reject(Object.assign(new Error(sentence), { code: 'thumbnail_unavailable' })) });
  try {
    for (let i = 0; i < 6; i++) await f.view.flush();
    const frames = f.view.nodes().filter(n => f.view.props(n)?.['data-testid'] === 'template-thumbnail');
    assert.equal(frames.length, ROWS.length);
    assert.ok(frames.every(n => f.view.props(n).title === sentence));
    assert.ok(!f.view.nodes().some(n => n.tagName === 'svg' || n.tagName === 'SVG' || n.tagName === 'IMG'));
    assert.ok(!f.view.nodes().some(n => n.tagName === 'BUTTON' && textOf(n).trim() === 'Retry'), 'no Retry in a 32 px frame');
  } finally { await f.view.unmount(); restore(); }
});

test('Search filters as you type and drops empty sections', async () => {
  const t = await mountTab();
  try {
    await t.view.fill('Search templates', 'Sixth');
    await t.view.flush();
    assert.deepEqual(t.rows(), ['gp_extra']);
    assert.doesNotMatch(t.text(), /Fund Formation \(LP Level\)/);
    await t.view.fill('Search templates', 'zzz-nothing');
    assert.match(t.text(), /No template matches these filters\./);
  } finally { await t.view.unmount(); restore(); }
});

test('Filter sheet: three groups, a draft until "Show [n] templates", "Filters · n", and closing any other way drops the draft', async () => {
  const t = await mountTab();
  try {
    await t.clickNode(t.byTestId('template-filters'));
    assert.ok(t.view.nodes().some(n => t.view.props(n)?.role === 'dialog'));
    const groups = t.view.nodes().filter(n => t.view.props(n)?.role === 'group').map(n => t.view.props(n)['aria-label']);
    assert.deepEqual(groups, ['Layer', 'State', 'Kind']);
    assert.deepEqual(t.chips('Layer').map(c => c[0]), ['All', 'Internal Management', 'Fund Formation', 'Investment Execution', 'Compliance']);
    assert.deepEqual(t.chips('State').map(c => c[0]), ['All', 'Has a body', 'Stub', 'Unpublished', 'Published']);
    assert.deepEqual(t.chips('Kind').map(c => c[0]), ['All', 'agreement', 'corporate', 'resolution', 'unilateral', 'policy', 'notice', 'booklet']);
    for (const g of ['Layer', 'State', 'Kind']) assert.equal(t.chips(g)[0][1], true, `${g} starts on All`);
    await t.clickNode(t.button('Fund Formation', t.group('Layer')));
    await t.clickNode(t.button('Stub', t.group('State')));
    const n = filterCatalog(ROWS, { layer: 'fund', state: 'stub' }).length;
    assert.equal(textOf(t.byTestId('template-filter-show')), n === 1 ? 'Show 1 template' : `Show ${n} templates`);
    assert.equal(t.rows().length, ROWS.length, 'the list behind is unfiltered: the chips are a draft');
    await t.clickNode(t.byTestId('template-filter-show'));
    assert.ok(!t.view.nodes().some(n => t.view.props(n)?.role === 'dialog'), 'the sheet closed');
    assert.deepEqual(t.rows(), ['fund_stub']);
    assert.equal(textOf(t.byTestId('template-filters')), 'Filters · 2');
    // Reopen, pick a kind, close by the scrim: nothing changes.
    await t.clickNode(t.byTestId('template-filters'));
    await t.clickNode(t.button('notice', t.group('Kind')));
    const scrim = t.view.nodes().find(n => t.view.props(n)?.['aria-hidden'] === 'true' && typeof t.view.props(n)?.onClick === 'function' && /inset-0/.test(t.view.props(n).className || ''));
    assert.match(t.view.props(scrim).className, /rgba\(24,24,27,\.35\)/);
    assert.doesNotMatch(t.view.props(scrim).className, /\.42/);
    await t.clickNode(scrim);
    assert.deepEqual(t.rows(), ['fund_stub']);
    assert.equal(textOf(t.byTestId('template-filters')), 'Filters · 2');
  } finally { await t.view.unmount(); restore(); }
});

test('Filter sheet: the count includes the search; kind "notice" leaves only the notice; chips and CTA keep their sizes', async () => {
  const t = await mountTab();
  try {
    await t.view.fill('Search templates', 'Fixture fund');
    await t.clickNode(t.byTestId('template-filters'));
    const n = filterCatalog(ROWS, { q: 'Fixture fund' }).length;
    assert.equal(textOf(t.byTestId('template-filter-show')), `Show ${n} templates`);
    assert.ok(n < ROWS.length);
    await t.view.fill('Search templates', '');
    await t.clickNode(t.button('notice', t.group('Kind')));
    await t.clickNode(t.byTestId('template-filter-show'));
    assert.deepEqual(t.rows(), ['comp_notice']);
    assert.equal(textOf(t.byTestId('template-filters')), 'Filters · 1');
  } finally { await t.view.unmount(); restore(); }
  const sheet = read('pages/admin/contracts/FilterSheet.jsx');
  assert.match(sheet, /min-h-\[36px\]/);
  assert.match(sheet, /min-h-\[50px\]/);
  const plain = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PhoneSheet, { label: 'x', onClose() {} }, 'body')));
  assert.match(plain, /rgba\(24,24,27,\.42\)/, 'the default scrim is unchanged');
});

test('Preview through the list: a row pushes ?preview=<slug>, asks for the PDF once with no options, and Back returns', async () => {
  const t = await mountTab();
  try {
    assert.equal(t.calls.filter(([k]) => k === 'adminTemplateStorePreviewPdfBlob').length, 0, 'no PDF per row on load');
    await t.clickNode(t.byTestId('template-phone-row-gp_pub'));
    assert.match(t.search(), /preview=gp_pub/);
    assert.match(t.text(), /‹ Fixture gp_pub/);
    assert.match(t.text(), /Read-only/);
    assert.match(t.text(), /Loading…/);
    assert.deepEqual(t.calls.filter(([k]) => k === 'adminTemplateStorePreviewPdfBlob').map(([, a]) => a), [['gp_pub']]);
    await t.clickNode(t.byTestId('template-preview-back'));
    assert.equal(t.byTestId('template-preview-phone'), undefined);
    assert.ok(t.byTestId('template-phone-row-gp_pub'), 'the list is still there');
  } finally { await t.view.unmount(); restore(); }
});

function fakePdfjs(pages = 3) {
  const log = { getDocument: 0 };
  const lib = {
    AnnotationMode: { DISABLE: 0 },
    getDocument() {
      log.getDocument += 1;
      return {
        promise: Promise.resolve({
          numPages: pages,
          getPage: async () => ({ getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), render() { return { promise: Promise.resolve(), cancel() {} }; } }),
        }),
        destroy() {},
      };
    },
  };
  return { lib, log };
}
const fakeBlob = () => ({ arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer });

async function mountPreview(loadPdf, pdfLoader) {
  const view = await mountContracts(React.createElement(TemplatePreviewPhone, { slug: 'gp_pub', title: 'Fixture Title', onClose() {}, loadPdf, pdfLoader }));
  for (let i = 0; i < 5; i++) await view.flush();
  const text = () => textOf(view.nodes()[0]);
  const button = (label) => view.nodes().find(n => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const click = async (label) => { const n = button(label); if (!n) throw new Error('Missing ' + label); await act(async () => { view.props(n).onClick({}); }); for (let i = 0; i < 3; i++) await view.flush(); };
  return { view, text, button, click };
}

test('Preview alone: "Page X of Y" with Previous and Next stopping at each end, Pinch to zoom, Edit on a larger screen, drawn by the stub loader', async () => {
  const { lib, log } = fakePdfjs(3);
  let asked = 0;
  const p = await mountPreview(async () => { asked += 1; return { blob: fakeBlob(), url: 'blob:fixture', renderer: 'browser_run' }; }, async () => lib);
  try {
    assert.match(p.text(), /Page 1 of 3/);
    assert.match(p.text(), /Pinch to zoom/);
    assert.match(p.text(), /Edit on a larger screen\./);
    assert.doesNotMatch(p.text(), new RegExp(FALLBACK_NOTE.slice(0, 30)));
    assert.equal(p.view.props(p.button('‹ Previous')).disabled, true);
    await p.click('Next ›');
    assert.match(p.text(), /Page 2 of 3/);
    await p.click('Next ›');
    assert.match(p.text(), /Page 3 of 3/);
    assert.equal(p.view.props(p.button('Next ›')).disabled, true);
    assert.equal(log.getDocument, 1, 'the stub loader drew it');
    assert.equal(asked, 1);
  } finally { await p.view.unmount(); }
});

test('Preview alone: the fallback renderer says so in PdfPages\' own words; a refusal shows its sentence and Retry asks again', async () => {
  const { lib } = fakePdfjs(1);
  const fb = await mountPreview(async () => ({ blob: fakeBlob(), url: 'blob:fixture', renderer: 'pdf_lib' }), async () => lib);
  try { assert.ok(fb.text().includes(FALLBACK_NOTE)); } finally { await fb.view.unmount(); }
  let asked = 0;
  const sentence = 'The preview could not be drawn. Try again.';
  const bad = await mountPreview(async () => { asked += 1; throw Object.assign(new Error(sentence), { code: 'preview_unrenderable', status: 503 }); }, async () => lib);
  try {
    assert.ok(bad.text().includes(sentence), 'the Worker\'s sentence is drawn as it came');
    await bad.click('Retry');
    assert.equal(asked, 2);
  } finally { await bad.view.unmount(); }
  assert.ok(!read('pages/admin/contracts/TemplatePreviewPhone.jsx').includes('These page breaks come from'), 'the sentence is imported, never retyped');
});

test('Model: the kind filter, activeFilterCount, and KIND_FILTERS read back against the Worker\'s TEMPLATE_KINDS', () => {
  assert.deepEqual(filterCatalog(ROWS).map(r => r.slug), ROWS.map(r => r.slug));
  assert.deepEqual(filterCatalog(ROWS, { q: 'fixture fund', layer: 'fund', state: 'all' }).map(r => r.slug), ['fund_stub', 'fund_body', 'fund_pub']);
  assert.deepEqual(filterCatalog(ROWS, { kind: 'notice' }).map(r => r.slug), ['comp_notice']);
  assert.deepEqual(filterCatalog(ROWS, { kind: 'policy', layer: 'gp' }).map(r => r.slug), ['gp_counsel']);
  assert.equal(activeFilterCount({ layer: 'all', state: 'all', kind: 'all' }), 0);
  assert.equal(activeFilterCount({ layer: 'fund', state: 'stub', kind: 'all' }), 2);
  assert.equal(activeFilterCount({ layer: 'fund', state: 'stub', kind: 'notice' }), 3);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/templateFormat.ts', import.meta.url), 'utf8');
  const kinds = worker.match(/export const TEMPLATE_KINDS[^=]*=\s*\[([^\]]*)\]/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(KIND_FILTERS.slice(1), kinds);
  assert.equal(KIND_FILTERS[0], 'all');
});

test('Hook: usePhoneWidth(BELOW_MD_QUERY) answers the phone query, not the 1024 px one', async () => {
  let seen = null;
  function Probe() { seen = usePhoneWidth(BELOW_MD_QUERY); return null; }
  for (const [query, want] of [['(max-width: 767px)', true], ['(max-width: 1023px)', false]]) {
    globalThis.matchMedia = (q) => ({ matches: q === query, addEventListener() {}, removeEventListener() {} });
    const view = await mountContracts(React.createElement(Probe));
    try { assert.equal(seen, want, query); } finally { await view.unmount(); delete globalThis.matchMedia; }
  }
});

test('Source checks: the phone files author nothing, only PdfPages names pdfjs-dist, and AdminTemplates gates on phone && !editing', () => {
  for (const f of ['TemplatePreviewPhone.jsx', 'TemplateCatalogPhone.jsx', 'FilterSheet.jsx']) {
    const s = read(`pages/admin/contracts/${f}`);
    for (const bad of ['dangerouslySetInnerHTML', 'adminTemplateStoreUpdate', 'adminTemplateStoreCreate', 'publishOne', 'withdraw(', 'push(', 'setEditing']) {
      assert.ok(!s.includes(bad), `${f} holds ${bad}`);
    }
  }
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(p)) files.push(p); } };
  walk(SRC);
  assert.deepEqual(files.filter(p => readFileSync(p, 'utf8').includes('pdfjs-dist')).map(p => relative(SRC, p)), ['pages/admin/contracts/PdfPages.jsx']);
  assert.match(read('pages/admin/AdminTemplates.jsx'), /recordedPublication && phone && !editing/);
});
