// D717 (#1782) decisions 3, 4 and 7 — the Templates tab's rules, before its
// screens (PR 2a): frontend/src/lib/templateCatalogModel.js and
// frontend/src/lib/fundIDocuments.js. PR 2b (#1851) adds the rendered tab below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  LAYER_ORDER, STATE_FILTERS, templateState, matchesStateFilter, filterCatalog, layerSections, stateCounts,
} from '../src/lib/templateCatalogModel.js';
import { FUND_I_DOCUMENTS, FUND_I_SLUGS, FUND_I_TOTAL, fundIPanel } from '../src/lib/fundIDocuments.js';
import React from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { createThumbnailQueue } from '../src/lib/thumbnailQueue.js';
import { mountContracts } from './_contracts_dom.mjs';

// Rows as GET /templates/store?recorded=true answers them. Synthetic titles.
const row = (slug, layer, o = {}) => ({
  slug, title: o.title || slug.replace(/_/g, ' '), layer, layer_label: `Layer ${layer}`, body_md: 'Body.', is_stub: 0,
  version: 1, published_version: null, has_unpublished_changes: true, usage_count: 0, ...o,
});
const ROWS = [
  row('gp_partnership', 'gp', { published_version: 2, version: 2, has_unpublished_changes: false }),
  row('gp_carry', 'gp', { published_version: 1, version: 3, has_unpublished_changes: true }),
  row('ppm', 'fund', { body_md: '   ', is_stub: 0 }),
  row('lpa_initial', 'fund', { body_md: '', is_stub: 1 }),
  row('safe_note', 'portfolio'),
  row('aml_policy', 'compliance', { is_stub: 1, body_md: '', published_version: 1, has_unpublished_changes: true }),
  row('house_rule', 'branch_only'),
];

test('D717 each row has one state; a publication replaces "has a body" but never "stub"', () => {
  const s = Object.fromEntries(ROWS.map((r) => [r.slug, templateState(r)]));
  assert.equal(s.gp_partnership.state, 'published');
  assert.equal(s.gp_partnership.changesNotPublished, false);
  assert.equal(s.gp_carry.state, 'published');
  assert.equal(s.gp_carry.changesNotPublished, true, 'shown beside Published');
  assert.equal(s.ppm.state, 'stub', 'a blank body is a stub');
  assert.equal(s.lpa_initial.state, 'stub');
  assert.equal(s.safe_note.state, 'has_body');
  assert.equal(s.safe_note.changesNotPublished, false, 'nothing to compare without a publication');
  assert.equal(s.aml_policy.state, 'stub');
  assert.equal(s.aml_policy.publishedVersion, 1, 'a stub keeps its publication, so the screen can offer Withdraw');
  assert.deepEqual(ROWS.map((r) => templateState(r).action), ['open', 'open', 'add_body', 'add_body', 'open', 'add_body', 'open']);
});

test('D717 the five state filters select the right rows', () => {
  assert.deepEqual(STATE_FILTERS, ['all', 'has_body', 'stub', 'unpublished', 'published']);
  const pick = (f) => ROWS.filter((r) => matchesStateFilter(r, f)).map((r) => r.slug);
  assert.deepEqual(pick('all'), ROWS.map((r) => r.slug));
  assert.deepEqual(pick('has_body'), ['gp_partnership', 'gp_carry', 'safe_note', 'house_rule']);
  assert.deepEqual(pick('stub'), ['ppm', 'lpa_initial', 'aml_policy']);
  assert.deepEqual(pick('unpublished'), ['gp_carry', 'ppm', 'lpa_initial', 'safe_note', 'aml_policy', 'house_rule']);
  assert.deepEqual(pick('published'), ['gp_partnership', 'gp_carry', 'aml_policy']);
  assert.throws(() => matchesStateFilter(ROWS[0], 'draft'), RangeError);
  const counts = stateCounts(ROWS);
  assert.equal(counts.all, ROWS.length);
  assert.equal(counts.has_body + counts.stub, counts.all, 'every row is a stub or has a body');
});

test('D717 search, layer and state combine; the layer sections keep the tab\'s order and their counts add up', () => {
  assert.deepEqual(filterCatalog(ROWS, { q: 'GP ', state: 'published' }).map((r) => r.slug), ['gp_partnership', 'gp_carry']);
  assert.deepEqual(filterCatalog(ROWS, { layer: 'fund' }).map((r) => r.slug), ['ppm', 'lpa_initial']);
  assert.deepEqual(filterCatalog(ROWS, { q: 'PPM' }).map((r) => r.slug), ['ppm'], 'search is case-insensitive');
  const titled = [row('ppm', 'fund', { title: 'Private Placement Memorandum' })];
  assert.deepEqual(filterCatalog(titled, { q: 'placement memo' }).map((r) => r.slug), ['ppm'], 'a lower-case query finds a title-case title');
  assert.deepEqual(filterCatalog(ROWS, { layer: 'fund', state: 'has_body' }), []);

  assert.deepEqual(LAYER_ORDER, ['gp', 'fund', 'portfolio', 'compliance']);
  const shuffled = [...ROWS].reverse();
  const sections = layerSections(shuffled);
  assert.deepEqual(sections.map((s) => s.layer), ['gp', 'fund', 'portfolio', 'compliance', 'branch_only'], 'a layer outside the order follows');
  assert.deepEqual(sections.map((s) => s.count), [2, 2, 1, 1, 1]);
  assert.equal(sections.reduce((n, s) => n + s.count, 0), shuffled.length);
  assert.deepEqual(layerSections(filterCatalog(ROWS, { state: 'stub' })).map((s) => [s.layer, s.count]), [['fund', 2], ['compliance', 1]],
    'a section with no rows is left out');
});

test('D717 the Fund I panel keeps its signing order and its 41 documents, every one seeded by a migration', () => {
  assert.deepEqual(FUND_I_DOCUMENTS.map((s) => s.stage), ['formation', 'offering', 'booklet', 'closing', 'operations', 'compliance']);
  assert.deepEqual(FUND_I_DOCUMENTS.map((s) => s.slugs.length), [6, 4, 9, 7, 7, 8]);
  assert.equal(FUND_I_TOTAL, 41);
  assert.equal(new Set(FUND_I_SLUGS).size, 41, 'no document twice');
  // Decision 7's order, every stage in full.
  assert.deepEqual(FUND_I_DOCUMENTS.map((s) => s.slugs), [
    ['certificate_of_limited_partnership_de', 'gp_llc_agreement', 'gp_fund_formation_consent', 'lpa_initial', 'investment_management_agreement', 'mgmt_company'],
    ['investor_nda_axal', 'ppm', 'lpa_amended_restated', 'lpa'],
    ['Subscription Booklet & LPA', 'subscription', 'investor_subscription_pro', 'investor_subscription_inst', 'lp_investor_questionnaire',
      'accreditation_v1', 'lp_aml_kyc_certification', 'lp_tax_status_certification', 'lp_electronic_delivery_consent'],
    ['lp_side_letter', 'Co-Investment Side Letter', 'mfn_election_form', 'gp_closing_certificate', 'carried_interest', 'carried_interest_award_letter',
      'clawback_guarantee'],
    ['capital_call_notice', 'distribution_notice', 'default_notice', 'lp_interest_transfer', 'lpac_charter', 'management_rights_letter',
      'pro_rata_information_rights_side_letter'],
    ['form_d_filing_kit', 'bad_actor_questionnaire_506d', 'compliance_manual_code_of_ethics', 'investor_privacy_notice_reg_sp', 'valuation_policy',
      'conflicts_allocation_policy', 'form_adv', 'aml_kyc'],
  ]);
  const dir = new URL('../../cloudflare-worker/sql/migrations/', import.meta.url);
  const sql = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  for (const slug of FUND_I_SLUGS) assert.ok(sql.includes(`'${slug.replace(/'/g, "''")}'`), `${slug} is seeded`);
});

test('D717 the panel counts only published rows "of 41" and flags a slug the catalog does not return', () => {
  const rows = [
    row('gp_llc_agreement', 'gp', { published_version: 1 }),
    row('ppm', 'fund', { published_version: 3, version: 4, has_unpublished_changes: true }),
    row('lpa_initial', 'fund', { is_stub: 1, body_md: '' }),
    row('investor_nda_axal', 'fund'),
  ];
  const panel = fundIPanel(rows);
  assert.equal(panel.total, 41);
  assert.equal(panel.ready, 2, 'only a recorded publication is ready to send');
  const items = panel.stages.flatMap((s) => s.items);
  assert.equal(items.length, 41);
  assert.deepEqual(items.map((i) => i.slug), FUND_I_SLUGS, 'signing order');
  const by = Object.fromEntries(items.map((i) => [i.slug, i]));
  assert.deepEqual([by.gp_llc_agreement.ready, by.gp_llc_agreement.action], [true, 'open']);
  assert.deepEqual([by.lpa_initial.state, by.lpa_initial.action, by.lpa_initial.ready], ['stub', 'add_body', false]);
  assert.deepEqual([by.investor_nda_axal.state, by.investor_nda_axal.ready], ['has_body', false]);
  assert.deepEqual([by.mgmt_company.missing, by.mgmt_company.row, by.mgmt_company.action], [true, null, null]);
  assert.equal(items.filter((i) => i.missing).length, 41 - rows.length);
  assert.equal(fundIPanel([]).ready, 0);
});

// ── PR 2b (#1851): the rendered tab ────────────────────────────────────────
// Every title, slug and branch code below is synthetic, except the Fund I
// slugs the panel is keyed on.

const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
function setup(contractAnswers = {}, answers = {}) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...args) => { calls.push([key, args]); return (answers[key] || never)(...args); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const HQ = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
const desk = () => React.createElement(AuthProvider, null, React.createElement(Desk));
const card = (slug, layer, o = {}) => ({
  slug, title: o.title || `Synthetic ${slug}`, layer, layer_label: `Layer ${layer}`, category: layer, body_md: 'Body.', is_stub: 0,
  version: 2, published_version: null, has_unpublished_changes: true, usage_count: 1, kind: 'agreement', party: 'gp',
  format_source: 'row', counsel_draft: false, updated_by: 7, updated_at: '2026-10-01T10:00:00Z', ...o,
});
// Nine rows across the four layers: two stubs (one counsel draft), three with a
// body, three published (one changed since), one published stub.
const NINE = [
  card('syn_stub_counsel', 'gp', { body_md: '', is_stub: 1, counsel_draft: true, has_unpublished_changes: false }),
  card('syn_stub_plain', 'fund', { body_md: '', is_stub: 1, has_unpublished_changes: false }),
  card('syn_body_a', 'gp', { format_source: 'slug' }),
  card('syn_body_b', 'portfolio', { party: 'fund' }),
  card('syn_body_c', 'compliance', { kind: 'policy', party: 'none' }),
  card('syn_pub_a', 'fund', { published_version: 2, has_unpublished_changes: false }),
  card('syn_pub_b', 'portfolio', { published_version: 3, has_unpublished_changes: false, version: 3 }),
  card('syn_pub_changed', 'compliance', { published_version: 1, version: 2, has_unpublished_changes: true }),
  card('syn_pub_stub', 'gp', { body_md: '', is_stub: 1, published_version: 1, has_unpublished_changes: true }),
];
const tiles = (view) => view.nodes().filter((n) => String(view.props(n)?.['data-testid'] || '').startsWith('template-tile-'))
  .map((n) => view.props(n)['data-testid'].slice('template-tile-'.length));
const testid = (view, id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const inTiles = (view) => view.nodes().filter((n) => String(view.props(n)?.['data-testid'] || '').startsWith('template-tile-'))
  .flatMap(function walk(n) { return [n, ...(n.childNodes || []).flatMap(walk)]; });
const buttons = (view) => view.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => textOf(n).trim());
async function open(contract = {}, user = HQ, legacy = {}) {
  const calls = setup({ stats: never, templates: async () => ({ items: NINE }), ...contract }, legacy);
  const view = await mountContracts(desk(), '/admin/contracts?tab=templates', user);
  await view.flush();
  return { view, calls };
}

test('D717 #1851 each state segment shows its rows and counts what search and layer leave', async () => {
  const { view } = await open();
  try {
    const counts = stateCounts(NINE);
    for (const f of STATE_FILTERS) {
      const label = { all: 'All', has_body: 'Has a body', stub: 'Stub', unpublished: 'Unpublished', published: 'Published' }[f];
      await view.click(`${label} · ${counts[f]}`);
      assert.deepEqual(tiles(view).sort(), NINE.filter((r) => matchesStateFilter(r, f)).map((r) => r.slug).sort(), f);
    }
    await view.click(`All · ${counts.all}`);
    await view.fill('Search templates', 'syn_pub');
    const searched = stateCounts(filterCatalog(NINE, { q: 'syn_pub' }));
    assert.ok(buttons(view).includes(`All · ${searched.all}`) && buttons(view).includes(`Stub · ${searched.stub}`), 'decision 2: the counts follow search');
    assert.equal(searched.all, 4);
    await view.fill('Search templates', '');
    // A layer header counts its cards under "Layer · All".
    assert.match(textOf(testid(view, 'layer-gp')), /Layer gp · 3/);
    assert.equal(tiles(view).filter((s) => NINE.find((r) => r.slug === s).layer === 'gp').length, 3);
  } finally { await view.unmount(); restore(); }
});

test('D717 #1851 "Published · none yet" with no publication', async () => {
  const { view } = await open({ templates: async () => ({ items: NINE.map((r) => ({ ...r, published_version: null })) }) });
  try { assert.ok(buttons(view).includes('Published · none yet')); assert.ok(!buttons(view).includes('Published · 0')); }
  finally { await view.unmount(); restore(); }
});

test('D717 #1851 "Show all n →" selects the layer and lists every card', async () => {
  const six = Array.from({ length: 6 }, (_, i) => card(`syn_gp_${i}`, 'gp'));
  const { view } = await open({ templates: async () => ({ items: [...six, card('syn_fund_x', 'fund')] }) });
  try {
    assert.equal(tiles(view).filter((s) => s.startsWith('syn_gp_')).length, 4);
    assert.ok(!buttons(view).some((b) => b.startsWith('Show all 1')), 'no link at four or fewer');
    await view.click('Show all 6 →');
    assert.equal(tiles(view).filter((s) => s.startsWith('syn_gp_')).length, 6);
    assert.ok(!buttons(view).includes('Show all 6 →'), 'hidden once the layer is selected');
    assert.deepEqual(tiles(view).filter((s) => !s.startsWith('syn_gp_')), [], 'one layer selected');
  } finally { await view.unmount(); restore(); }
});

test('D717 #1851 card copy: stubs, the counsel mark, states, the slug mark and the Fund party', async () => {
  const { view } = await open();
  try {
    const tile = (slug) => textOf(testid(view, `template-tile-${slug}`));
    assert.match(tile('syn_stub_counsel'), /No body in the store yet\..*Stub — counsel to draft\..*Add body/);
    assert.match(tile('syn_stub_plain'), /No body in the store yet\./);
    assert.doesNotMatch(tile('syn_stub_plain'), /counsel to draft/);
    assert.match(tile('syn_body_a'), /Has a body/);
    assert.match(tile('syn_body_a'), /agreement · Axal VC GP LLC · from the slug/);
    assert.doesNotMatch(tile('syn_body_b'), /from the slug/);
    assert.match(tile('syn_body_b'), /Axal VC GP LLC \(for the Fund\)/);
    assert.match(tile('syn_body_c'), /policy · publisher only, no signatures/);
    assert.match(tile('syn_pub_b'), /Published v3/);
    assert.doesNotMatch(tile('syn_pub_b'), /Changes not published/);
    assert.match(tile('syn_pub_changed'), /Published v1.*Changes not published/);
    assert.match(tile('syn_pub_stub'), /No body in the store yet\..*Published v1/);
    // Decision 9: "last edited" is the v[N] pill's hover.
    assert.ok(view.nodes().some((n) => view.props(n)?.title === 'Last edited ' + new Date('2026-10-01T10:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' · Admin #7'));
  } finally { await view.unmount(); restore(); }
});

test('D717 #1851 Add body opens the editor on the body', async () => {
  const stub = NINE[0];
  const { view } = await open({}, HQ, { adminTemplateStoreGet: async () => ({ template: stub }), adminTemplateStoreVersions: async () => ({ versions: [] }) });
  try {
    const add = view.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Add body' && textOf(n.parentNode.parentNode).includes('counsel to draft'));
    await view.flush();
    // The test DOM has no focus(); autoFocus calls it on mount.
    const make = document.createElement.bind(document);
    document.createElement = (tag) => Object.assign(make(tag), { focus() {} });
    const { act } = await import('react');
    await act(async () => { view.props(add).onClick({ stopPropagation() {} }); });
    await view.flush();
    const body = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'template-body');
    assert.ok(body, 'the editor is open');
    assert.equal(view.props(body).autoFocus, true);
  } finally { await view.unmount(); restore(); }
});

test('D717 #1851 the Fund I panel: six stages in order, ready counts publications, a missing slug is flagged', async () => {
  const items = [card('certificate_of_limited_partnership_de', 'fund', { title: 'Synthetic certificate', published_version: 1 }),
    card('gp_llc_agreement', 'gp', { title: 'Synthetic GP agreement' }),
    card('lpa_initial', 'fund', { title: 'Synthetic initial LPA', body_md: '', is_stub: 1 })];
  const { view } = await open({ templates: async () => ({ items }) });
  try {
    const panel = textOf(testid(view, 'fund-i-panel'));
    assert.match(panel, /Fund I documents1 of 41 ready to send · signing order/, 'a has_body row is not ready');
    const heads = ['Formation · 6', 'Offering · 4', 'Booklet · 9', 'Closing · 7', 'Operations · 7', 'Compliance · 8'];
    let at = -1;
    for (const h of heads) { const i = panel.indexOf(h); assert.ok(i > at, h); at = i; }
    assert.ok(panel.indexOf('Synthetic certificate') < panel.indexOf('Synthetic GP agreement'), 'signing order');
    assert.match(textOf(testid(view, 'fund-i-row-certificate_of_limited_partnership_de')), /Published v1Open/);
    assert.match(textOf(testid(view, 'fund-i-row-gp_llc_agreement')), /Has a bodyOpen/);
    assert.match(textOf(testid(view, 'fund-i-row-lpa_initial')), /StubAdd body/);
    const missing = testid(view, 'fund-i-row-ppm');
    assert.equal(textOf(missing), 'ppmNot in the catalog');
    assert.ok(!view.nodes().some((n) => n.tagName === 'BUTTON' && n.parentNode === missing), 'no action on a missing row');
  } finally { await view.unmount(); restore(); }
});

test('D717 #1851 thumbnails: four at a time, every one in the end, the version in the URL, the Worker\'s sentence and Retry', async () => {
  const pending = [];
  let peak = 0, inFlight = 0;
  const thumbnailBlob = () => new Promise((resolve) => { inFlight += 1; peak = Math.max(peak, inFlight); pending.push(() => { inFlight -= 1; resolve({ url: `blob:syn-${pending.length}` }); }); });
  const { view, calls } = await open({ thumbnailBlob });
  try {
    await view.flush();
    assert.ok(peak <= 4 && peak > 0, `at most four in flight (peak ${peak})`);
    const { act } = await import('react');
    for (let i = 0; i < 20 && pending.length; i += 1) await act(async () => { pending.shift()(); await new Promise((r) => setTimeout(r, 0)); });
    const drawn = calls.filter(([k]) => k === 'thumbnailBlob');
    const shown = new Set(tiles(view));
    assert.equal(drawn.length, shown.size, 'one call per card shown');
    assert.ok(peak <= 4);
    const pages = view.nodes().filter((n) => n.tagName === 'IMG' && /^Page 1 of Synthetic /.test(view.props(n).alt));
    assert.equal(pages.length, shown.size, 'every thumbnail resolves');
    assert.equal(inTiles(view).filter((n) => n.tagName === 'SVG').length, 0, 'no icon in place of a page');
    assert.deepEqual(drawn.find(([, a]) => a[0] === 'syn_pub_b')[1], ['syn_pub_b', 3]);
  } finally { await view.unmount(); restore(); }
  const src = readFileSync(new URL('../src/lib/api/contracts.js', import.meta.url), 'utf8');
  assert.match(src, /thumbnail\.png\?v=\$\{encodeURIComponent\(version/, 'the URL names the version');
});

test('D717 #1851 a thumbnail that was not drawn says why and retries', async () => {
  let n = 0;
  const thumbnailBlob = async () => { n += 1; const e = new Error('Thumbnail not drawn: the page renderer did not answer.'); e.code = 'thumbnail_unavailable'; throw e; };
  const { view } = await open({ templates: async () => ({ items: [NINE[2]] }), thumbnailBlob });
  try {
    await view.flush();
    assert.match(textOf(testid(view, 'template-tile-syn_body_a')), /Thumbnail not drawn: the page renderer did not answer\.Retry/);
    const before = n;
    await view.click('Retry'); await view.flush();
    assert.equal(n, before + 1);
    assert.equal(inTiles(view).filter((x) => x.tagName === 'SVG').length, 0, 'no icon in place of a page');
  } finally { await view.unmount(); restore(); }
});

test('D717 #1851 the queue never runs more than its limit and skips a cancelled key', async () => {
  const q = createThumbnailQueue(2);
  let live = 0, peak = 0; const started = [];
  const release = [];
  const job = (k) => () => { started.push(k); live += 1; peak = Math.max(peak, live); return new Promise((r) => release.push(() => { live -= 1; r(k); })); };
  const done = ['a', 'b', 'c', 'd'].map((k) => q.enqueue(k, job(k)));
  q.cancel('c');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(started, ['a', 'b']);
  while (release.length) { release.shift()(); await new Promise((r) => setTimeout(r, 0)); }
  assert.deepEqual(started, ['a', 'b', 'd'], 'c never starts');
  assert.equal(peak, 2);
  assert.deepEqual(await Promise.all([done[0], done[1], done[3]]), ['a', 'b', 'd']);
});

test('D717 #1851 "Not in the catalog" lists the outside keys, and draws nothing while empty, pending or unreadable', async () => {
  const outside = async () => ({ items: [
    { key: 'syn_outside_a', title: 'Synthetic outside A', doc_type: 'x', counted_under: { slug: 'syn_body_a', title: 'Synthetic counted' } },
    { key: 'syn_outside_b', title: 'Synthetic outside B', doc_type: 'y', counted_under: { slug: 'syn_body_b', title: null } }] });
  // The store's thumbnails answer, so the queue frees up for the outside keys.
  const thumbnailBlob = async (slug) => ({ url: `blob:syn-${slug}` });
  const { view, calls } = await open({ outside, thumbnailBlob });
  try {
    await view.flush();
    const g = textOf(testid(view, 'outside-group'));
    assert.match(g, /Not in the catalog · 2/);
    assert.match(g, /Synthetic outside A.*Counted under Synthetic counted/);
    assert.match(g, /Counted under syn_body_b/);
    assert.deepEqual(calls.filter(([k]) => k === 'outsideThumbnailBlob').map(([, a]) => a[0]).sort(), ['syn_outside_a', 'syn_outside_b']);
  } finally { await view.unmount(); restore(); }
  for (const answer of [async () => ({ items: [] }), never, async () => { throw new Error('controlled outside failure'); }]) {
    const { view: v } = await open({ outside: answer });
    try { await v.flush(); assert.equal(testid(v, 'outside-group'), undefined); assert.doesNotMatch(v.text(), /Not in the catalog ·/); }
    finally { await v.unmount(); restore(); }
  }
});

test('D717 #1851 Push to branches reports Reached, Failed and Not reached, and Retry re-runs the push', async () => {
  const push = async () => ({ ok: true, template_count: 3, answered: 1, total: 4, pushed_at: '2026-10-18T09:05:00Z', branches: [
    { code: 'syn-ok', status: 'ok', stored: 3, withdrawn: 0 },
    { code: 'syn-no', status: 'unreadable', reason: 'branch said no.' },
    { code: 'syn-slow', status: 'unreadable', reason: 'BRANCH_SYN_SLOW.publishTemplate did not answer within 2000ms', timed_out: true },
    { code: 'syn-new', status: 'not_deployed', reason: 'No binding.' }] });
  const { view, calls } = await open({ push });
  try {
    await view.click('Push to branches'); await view.flush();
    const row = (c) => textOf(testid(view, `push-row-${c}`));
    assert.match(row('syn-ok'), /Reached3 templates updated$/);
    assert.match(row('syn-no'), /FailedThis branch could not save the library: branch said no\. Retry this branch\.Retry/);
    assert.doesNotMatch(row('syn-no'), /no\.\./);
    assert.match(row('syn-slow'), /Not reachedThe branch did not answer\. Retry when it is online\.Retry/);
    assert.match(row('syn-new'), /Not reachedThe branch did not answer\. Retry when it is online\./);
    assert.match(textOf(testid(view, 'push-results')), /^Push to branches · .*The library is unchanged by any branch result\./);
    assert.equal(calls.filter(([k]) => k === 'push').length, 1);
    await view.click('Retry'); await view.flush();
    assert.equal(calls.filter(([k]) => k === 'push').length, 2);
  } finally { await view.unmount(); restore(); }
  const none = await open({ push: async () => ({ ok: true, template_count: 0, answered: 0, total: 0, branches: [], branches_reason: 'Synthetic no-branch sentence.', pushed_at: '2026-10-18T09:05:00Z' }) });
  try { await none.view.click('Push to branches'); await none.view.flush(); assert.match(textOf(testid(none.view, 'push-results')), /Synthetic no-branch sentence\.$/); }
  finally { await none.view.unmount(); restore(); }
  const refused = await open({ push: async () => { const e = new Error('Published templates are unreadable. Try again.'); e.code = 'publications_unreadable'; throw e; } });
  try { await refused.view.click('Push to branches'); await refused.view.flush(); assert.equal(textOf(testid(refused.view, 'push-error')), 'Published templates are unreadable. Try again.'); }
  finally { await refused.view.unmount(); restore(); }
  const src = readFileSync(new URL('../src/pages/admin/contracts/PushResults.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /No branch Worker is bound/, 'D131: the server supplies the sentence');
});

test('D717 #1851 on a branch Worker the tab is read-only, and a card still opens', async () => {
  const { view, calls } = await open({}, { ...HQ, branch: { code: 'fr' } }, { adminTemplateStoreGet: async () => ({ template: NINE[2] }), adminTemplateStoreVersions: async () => ({ versions: [] }) });
  try {
    const b = buttons(view);
    for (const hidden of ['New template', 'Push to branches', 'Add body', 'Publish']) assert.ok(!b.includes(hidden), hidden);
    assert.doesNotMatch(view.text(), /templates have unpublished changes/);
    const fundStub = { ...NINE[0], slug: 'lpa_initial', title: 'Synthetic initial LPA' };
    await view.unmount(); restore();
    const again = await open({ templates: async () => ({ items: [fundStub] }) }, { ...HQ, branch: { code: 'fr' } });
    try { assert.match(textOf(testid(again.view, 'fund-i-row-lpa_initial')), /StubOpen$/); }
    finally { await again.view.unmount(); restore(); }
    const third = await open({}, { ...HQ, branch: { code: 'fr' } }, { adminTemplateStoreGet: async () => ({ template: NINE[2] }), adminTemplateStoreVersions: async () => ({ versions: [] }) });
    try {
      await third.view.click(NINE[2].title); await third.view.flush();
      assert.ok(third.calls.some(([k, a]) => k === 'adminTemplateStoreGet' && a[0] === 'syn_body_a'), 'the card opens the template to read');
    } finally { await third.view.unmount(); restore(); }
  } finally { restore(); }
  void calls;
});

test('D717 #1851 decision 8: the interim library Publish stays on HQ until #1852 lands', async () => {
  const { view } = await open();
  try { assert.ok(buttons(view).includes('Publish')); assert.ok(buttons(view).includes('New template')); assert.ok(buttons(view).includes('Push to branches')); }
  finally { await view.unmount(); restore(); }
});
