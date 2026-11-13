/**
 * D5050 (#5050) part 2 — the Contracts v2 addendum on the Agreements list: CT-17 (the filter row, several
 * agreement types at once, removable chips, Clear all), CT-18 (the context line, the legal-state word beside the
 * lifecycle pill, the deep links), CT-19 (the never-sent version) and CT-20 (None, Unavailable, Refused, and the
 * phone cards). The desk is mounted whole, so a filter goes through the address (ContractsDesk's filter keys) and
 * through the real `contractsApi.agreements` to a stubbed `fetch`: what the Worker would be asked is asserted as
 * the URL it receives. Every reference, name and uid is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contracts_agreement_filters_5050_p2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import {
  activeAgreementChips, agreementContextLine, checkFilterText, documentLink, filterButtonValue, isNeverSent, toggleType,
  withoutAgreementFilters, withoutChip,
} from '../src/lib/contractAgreements.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api }, contractOriginals = { ...contractsApi };
const realFetch = globalThis.fetch;
const never = () => new Promise(() => {});
const user = { id: 2, role: 'admin', name: 'Test Admin', is_super_admin: 1 };
const element = () => React.createElement(AuthProvider, null, React.createElement(Desk));
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const context = (o = {}) => ({
  agreement_uid: 'lpa_1', store: 'licence_program_agreements', agreement_kind: 'program_licence', agreement_type: 'program_licence',
  agreement_type_label: 'Program licence', licence_uid: 'lic_1', licence_ref: 'AXL-001', licence_reason: null, holder: null,
  territory: ['FR'], package_key: 'venture_building', package_name: 'Venture Building', package_version: 1, program_key: 'spinout-lab',
  program_name: 'Spin-Out Lab', counterparty: 'Studio North SAS', template_slug: 'program_licence', template_version: 3,
  legal_status: 'executed', legal_status_label: 'Executed', is_current: true, sent_at: '2026-10-01T10:00:00Z', signed_at: '2026-10-03T10:00:00Z',
  envelope_uuid: 'env-1', provider: 'native', document_available: true, document_reason: null,
  links: { licence: '/admin/licences/lic_1', program_access: '/admin/licences/programs/studio/lic_1', package: null, package_reason: 'There is no package page yet (#5021 builds the package store).' },
  ...o,
});
const executed = { id: 1, uid: 'env-1', source: 'esign', title: 'Spin-Out Lab Programme Licence', doc_type: 'program_licence', status: 'signed', raw_status: 'completed',
  signed_at: '2026-10-03T10:00:00Z', sent_at: '2026-10-01T10:00:00Z', envelope_uuid: 'env-1', provider: 'native', recipient_name: 'Studio North SAS', agreement: context() };
const neverSent = { id: 2, uid: 'licence_agreement:lpa_2', source: 'licence_agreement', title: 'Perks — Program licence — AXL-001', doc_type: 'program_licence', status: 'draft', raw_status: 'draft',
  envelope_uuid: null, recipient_name: 'Studio North SAS',
  agreement: context({ agreement_uid: 'lpa_2', package_key: null, package_name: null, package_version: null, program_key: 'perks', program_name: 'Perks', legal_status: 'draft', legal_status_label: 'Draft',
    sent_at: null, signed_at: null, envelope_uuid: null, provider: null, document_available: false, document_reason: 'Not sent: there is no envelope or signed document yet.' }) };
const superseded = { id: 3, uid: 'env-3', source: 'esign', title: 'Learning Programme Schedule', doc_type: 'program_schedule', status: 'signed', raw_status: 'completed',
  signed_at: '2026-09-01T10:00:00Z', sent_at: '2026-08-28T10:00:00Z', envelope_uuid: 'env-3', provider: 'native', recipient_name: 'Studio North SAS',
  agreement: context({ agreement_uid: 'lpa_3', agreement_type: 'program_schedule_addendum', agreement_type_label: 'Program schedule / addendum', package_key: null, package_name: null, package_version: null,
    program_key: 'learning', program_name: 'Learning', legal_status: 'superseded', legal_status_label: 'Superseded', is_current: false, envelope_uuid: 'env-3', document_available: false,
    document_reason: 'No signed PDF is on file for this envelope yet.', links: { licence: '/admin/licences/lic_1', program_access: '/admin/licences/programs/studio/lic_1', package: null, package_reason: null } }) };
const plain = { id: 4, uid: 'doc-1', source: 'documents', title: 'SAFE — Acme', doc_type: 'safe', status: 'sent', raw_status: 'sent', created_at: '2026-07-01T00:00:00Z' };

/**
 * Every API method waits forever except the agreements read, which is the real one, so its URL reaches the
 * stubbed fetch. `answer(url)` returns `{ status, body }` for each call; the URLs are recorded.
 */
function setup(answer) {
  const urls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = () => never();
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = () => never();
  contractsApi.agreements = contractOriginals.agreements;
  globalThis.fetch = async (input) => {
    const url = String(input);
    // The list asks for pages of 25; the attention queues' own small reads (QUEUE_ROWS) are left waiting.
    if (!/\/admin\/contracts\?/.test(url) || new URL(url, 'https://x.test').searchParams.get('limit') !== '25') return never();
    urls.push(url);
    const { status = 200, body } = await answer(url);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return urls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); globalThis.fetch = realFetch; };
const paramsOf = (url) => Object.fromEntries([...new URL(url, 'https://x.test').searchParams].filter(([k]) => !['limit', 'offset', 'recorded'].includes(k)));
const settle = async (view) => { for (let i = 0; i < 4; i += 1) await view.flush(); };
const byTestId = (view, id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
const press = async (view, id) => { const n = byTestId(view, id); assert.ok(n, id); await act(async () => { view.props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(view); };
const pressLabel = async (view, label) => {
  const n = view.nodes().find((x) => x.tagName === 'BUTTON' && view.props(x)?.['aria-label'] === label);
  assert.ok(n, label); await act(async () => { view.props(n).onClick({ preventDefault() {} }); }); await settle(view);
};
/** A checkbox or radio inside the open panel, by the words of its label. */
const choose = async (view, words) => {
  const panel = view.nodes().find((n) => view.props(n)?.id === 'agreement-filter-panel');
  assert.ok(panel, 'a filter panel is open');
  const walkIn = (n) => [n, ...(n.childNodes || []).flatMap(walkIn)];
  const label = walkIn(panel).find((n) => n.tagName === 'LABEL' && walk(n).trim() === words);
  assert.ok(label, words);
  const input = label.childNodes.find((n) => n.tagName === 'INPUT');
  await act(async () => { view.props(input).onChange({ target: {} }); });
  await settle(view);
};

/* ── the rules ────────────────────────────────────────────────────────────── */

test('CT-17 rules: chips per value, a removed type keeps the others, Clear all keeps search, typed values are checked', () => {
  const f = { agreement_type: 'package,program_licence', licence: 'AXL-001', territory: 'fr', signed_from: '2026-01-01', q: 'north', status: 'signed' };
  // Mutation checked: one chip for the whole type list → the first two labels read "Type: package,program_licence".
  assert.deepEqual(activeAgreementChips(f).map((c) => c.label),
    ['Type: Package agreement', 'Type: Program licence', 'Licence: AXL-001', 'Territory: FR', 'Executed from 2026-01-01']);
  assert.equal(withoutChip(f, activeAgreementChips(f)[0]).agreement_type, 'program_licence', 'removing one type keeps the other');
  assert.equal(withoutChip(f, { key: 'licence' }).licence, '');
  const cleared = withoutAgreementFilters(f);
  assert.deepEqual([cleared.agreement_type, cleared.licence, cleared.territory, cleared.signed_from, cleared.q, cleared.status], ['', '', '', '', 'north', 'signed']);
  // The multi-select keeps the Worker's order whatever order a person ticks in.
  assert.equal(toggleType('program_licence', 'territory_licence'), 'territory_licence,program_licence');
  assert.equal(toggleType('territory_licence,package', 'territory_licence'), 'package');
  // A set button reads its value, or the count when several types are chosen.
  assert.deepEqual(['type', 'licence', 'state', 'signed'].map((id) => filterButtonValue(id, f)), ['2', 'FR · AXL-001', null, '2026-01-01 – …']);
  assert.equal(filterButtonValue('type', { agreement_type: 'package' }), 'Package agreement');
  // Mutation checked: accept any two letters without upper-casing → the territory reads "fr".
  assert.deepEqual(checkFilterText('territory', 'fr'), { ok: true, value: 'FR' });
  assert.equal(checkFilterText('territory', 'FRA').ok, false);
  assert.equal(checkFilterText('licence', 'a b').ok, false);
  assert.equal(checkFilterText('signed_from', '1 Jan').ok, false);
});

test('CT-18/19 rules: the context line in the canvas\'s order; a never-sent version; where a document opens', () => {
  // Mutation checked: put the program before the package → "… · Spin-Out Lab · Venture Building v1".
  assert.equal(agreementContextLine(context()), 'FR · AXL-001 · Venture Building v1 · Spin-Out Lab');
  assert.equal(agreementContextLine(context({ territory: [], holder: { type: 'user', id: '5', name: 'Lea Example' }, package_name: null, program_name: null, licence_ref: 'UL-FND-0042' })),
    'Lea Example · UL-FND-0042');
  // An envelope created but not yet sent is a draft too, yet it has an envelope: it is not "no envelope".
  const envelopeDraft = { ...executed, uid: 'env-5', status: 'draft', raw_status: 'created', sent_at: null, signed_at: null,
    agreement: context({ envelope_uuid: 'env-5', sent_at: null, signed_at: null, legal_status: 'draft', legal_status_label: 'Draft' }) };
  // Mutation checked: drop the envelope test from isNeverSent → the envelope's draft reads as never sent.
  assert.deepEqual([isNeverSent(neverSent), isNeverSent(envelopeDraft), isNeverSent(executed), isNeverSent(plain)], [true, false, false, false]);
  assert.deepEqual(documentLink(executed), { to: '/admin/contracts/agreements/doc/env-1', label: 'View / download agreement' });
  assert.equal(documentLink(superseded).label, 'View agreement', 'no signed PDF on file: view, not download');
  assert.equal(documentLink(neverSent), null, 'a version with no envelope has no document to open');
  assert.equal(documentLink(plain), null);
});

/* ── mounted ──────────────────────────────────────────────────────────────── */

test('CT-17 mounted: two agreement types at once reach the Worker as one list, survive the address, and come off one chip at a time', async () => {
  const urls = setup(() => ({ body: { total: 1, items: [executed] } }));
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await settle(view);
    await press(view, 'agreement-filter-type');
    assert.ok(byTestId(view, 'agreement-filter-panel-type'), 'the type panel opens under the row');
    await choose(view, 'Package agreement');
    await choose(view, 'Program licence');
    // Mutation checked: drop 'agreement_type' from ContractsDesk's filterKeys → the URL loses the filter after the round trip.
    assert.deepEqual(paramsOf(urls.at(-1)), { agreement_type: 'package,program_licence' });
    assert.equal(view.props(byTestId(view, 'agreement-filter-type'))['aria-label'], 'Agreement type: 2');
    const chips = byTestId(view, 'agreement-active-filters');
    assert.match(walk(chips), /Active filters.*Type: Package agreement.*Type: Program licence.*Clear all.*1 agreement/);
    await pressLabel(view, 'Remove filter Type: Package agreement');
    assert.deepEqual(paramsOf(urls.at(-1)), { agreement_type: 'program_licence' }, 'the other type stays');
    // Legal state is one value; choosing it closes the panel.
    await press(view, 'agreement-filter-state');
    await choose(view, 'Superseded');
    assert.deepEqual(paramsOf(urls.at(-1)), { agreement_type: 'program_licence', agreement_status: 'superseded' });
    assert.equal(byTestId(view, 'agreement-filter-panel-state'), undefined);
  } finally { await view.unmount(); restore(); }
});

test('CT-17 mounted: licence and territory, signed dates; a value the Worker would refuse is caught first; Clear all', async () => {
  const urls = setup(() => ({ body: { total: 1, items: [executed] } }));
  const view = await mountContracts(element(), '/admin/contracts?q=north', user);
  try {
    await settle(view);
    await press(view, 'agreement-filter-licence');
    await view.fill('Licence reference or uid', 'AXL-001');
    await view.fill('Territory (country code)', 'FRA');
    const before = urls.length;
    await view.click('Apply'); await settle(view);
    assert.match(view.text(), /A territory is a two-letter country code, such as FR\./);
    assert.equal(urls.length, before, 'nothing is asked of the Worker');
    await view.fill('Territory (country code)', 'fr');
    await view.click('Apply'); await settle(view);
    // Mutation checked: drop 'territory' from the desk's filters line → territory is missing here.
    assert.deepEqual(paramsOf(urls.at(-1)), { q: 'north', licence: 'AXL-001', territory: 'FR' });
    await press(view, 'agreement-filter-signed');
    assert.match(view.text(), /Effective date is not a filter/);
    await view.fill('Executed on or after', '2026-09-01');
    await view.click('Apply'); await settle(view);
    assert.deepEqual(paramsOf(urls.at(-1)), { q: 'north', licence: 'AXL-001', territory: 'FR', signed_from: '2026-09-01' });
    await view.click('Clear all'); await settle(view);
    assert.deepEqual(paramsOf(urls.at(-1)), { q: 'north' }, 'Clear all removes the CT-17 filters and keeps the search');
    assert.equal(byTestId(view, 'agreement-active-filters'), undefined);
  } finally { await view.unmount(); restore(); }
});

test('CT-18/19 mounted: context, legal state beside the pill, deep links; the never-sent version is neither signed nor a document', async () => {
  setup(() => ({ body: { total: 4, items: [executed, neverSent, superseded, plain] } }));
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await settle(view);
    const text = view.text();
    assert.match(text, /FR · AXL-001 · Venture Building v1 · Spin-Out Lab/);
    assert.match(text, /From template program_licence v3/);
    // Mutation checked: show the union status instead of the legal state → the schedule reads "executed" here.
    const words = view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'agreement-legal-state').map(walk);
    assert.deepEqual([...new Set(words)], ['legal state · executed', 'legal state · draft', 'legal state · superseded · history']);
    const hrefs = (label) => view.nodes().filter((n) => n.tagName === 'A' && walk(n) === label).map((n) => view.props(n).href);
    assert.ok(hrefs('Open licence ›').includes('/admin/licences/lic_1'));
    assert.ok(hrefs('Open Program access ›').includes('/admin/licences/programs/studio/lic_1'));
    assert.ok(hrefs('View / download agreement ›').includes('/admin/contracts/agreements/doc/env-1'));
    assert.ok(hrefs('View agreement ›').includes('/admin/contracts/agreements/doc/env-3'));
    assert.match(text, /Open package context: Not recorded.*no package page yet/s);
    // CT-19: the never-sent version.
    // Mutation checked: draw the lifecycle badge for it → "Prepared · not sent · no envelope" is gone.
    assert.match(text, /○Prepared · not sent · no envelope/);
    assert.ok(byTestId(view, 'agreement-no-envelope'), 'No envelope where the provider would be');
    assert.match(text, /Not sent: there is no envelope or signed document yet\./);
    assert.equal(view.nodes().some((n) => n.tagName === 'BUTTON' && walk(n) === neverSent.title), false, 'its title opens nothing: there is no envelope');
    assert.equal(hrefs('View / download agreement ›').concat(hrefs('View agreement ›')).some((h) => h.includes('lpa_2')), false);
    // The executed seal is only ever on executed rows; the never-sent one is never sealed.
    const sealed = view.nodes().filter((n) => view.props(n)?.['data-treatment'] === 'seal').map(walk);
    assert.ok(sealed.every((w) => /Executed/.test(w)));
    // CT-20 phone: the same rows as cards, each with its pill and legal state.
    const cards = view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'agreement-card');
    assert.equal(cards.length, 4);
    assert.match(walk(cards[1]), /Program licence.*FR · AXL-001 · Spin-Out Lab|Program licence.*FR · AXL-001 · Perks/);
    assert.match(walk(cards[1]), /Prepared · not sent · no envelope.*legal state · draft/);
  } finally { await view.unmount(); restore(); }
});

test('CT-20 mounted: None names the filters and says the read succeeded; Unavailable retries; Refused and an unknown value say so', async () => {
  let reply = { status: 200, body: { total: 0, items: [] } };
  const urls = setup(() => reply);
  const view = await mountContracts(element(), '/admin/contracts?agreement_type=program_licence&territory=IE', user);
  try {
    await settle(view);
    // Mutation checked: drop the filters summary → "Type: Program licence · Territory: IE" is missing.
    assert.match(view.text(), /No agreements match these filters.*Type: Program licence · Territory: IE\. Read succeeded\./s);
    reply = { status: 500, body: { error: 'down' } };
    await view.click('Clear filters'); await settle(view);
    assert.match(view.text(), /Agreements couldn’t be read.*The list is never shown as empty/s);
    assert.doesNotMatch(view.text(), /No agreements/);
    reply = { status: 200, body: { total: 1, items: [executed] } };
    const before = urls.length;
    await view.click('Retry'); await settle(view);
    assert.equal(urls.length, before + 1);
    assert.match(view.text(), /Spin-Out Lab Programme Licence/);
  } finally { await view.unmount(); restore(); }

  setup(() => ({ status: 403, body: { error: 'Admin required' } }));
  const refused = await mountContracts(element(), '/admin/contracts', user);
  try {
    await settle(refused);
    // Mutation checked: treat 403 as Unavailable → "You can’t view these agreements" is missing.
    assert.match(refused.text(), /Refused.*You can’t view these agreements/s);
    assert.doesNotMatch(refused.text(), /Retry/);
  } finally { await refused.unmount(); restore(); }

  setup(() => ({ status: 400, body: { error: 'invalid_contract_query', message: 'Choose a valid agreement type.', field: 'agreement_type' } }));
  const invalid = await mountContracts(element(), '/admin/contracts?agreement_type=lease', user);
  try {
    await settle(invalid);
    assert.match(invalid.text(), /Contracts doesn’t know one of these filter values.*Choose a valid agreement type\./s);
  } finally { await invalid.unmount(); restore(); }
});
