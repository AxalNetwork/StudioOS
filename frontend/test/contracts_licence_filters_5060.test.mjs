/**
 * D5060 part 4 (#5060, board CT-17): the Licence family, Licence type and Holder filters on the Contracts
 * Agreements list. Each is a GET /api/admin/contracts parameter the Worker already accepts and matches against
 * the shared licence (services/contractAgreementSources.ts `agreementFilters`). The desk is mounted whole, as in
 * D5050 part 2's test, so each filter goes through the address and the real `contractsApi.agreements` to a
 * stubbed `fetch`. Every reference, name and uid is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contracts_licence_filters_5060.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import {
  AGREEMENT_FILTER_KEYS, FILTER_BUTTONS, activeAgreementChips, filterButtonValue, holderLabel, holderOptions,
  withoutAgreementFilters,
} from '../src/lib/contractAgreements.js';
import { readFileSync } from 'node:fs';
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


const founder = { id: 11, uid: 'env-11', source: 'esign', title: 'Founder Licence Agreement', doc_type: 'founder_licence_agreement', status: 'signed', raw_status: 'completed',
  signed_at: '2026-10-03T10:00:00Z', sent_at: '2026-10-01T10:00:00Z', envelope_uuid: 'env-11', provider: 'native', recipient_name: 'Synthetic Founder',
  agreement: context({ agreement_uid: 'env-11', agreement_kind: 'user_licence_agreement', agreement_type: 'founder_licence', agreement_type_label: 'Founder Licence Agreement',
    territory: [], package_key: null, package_name: null, package_version: null, program_key: null, program_name: null, licence_ref: 'UL-FND-0001',
    licence_family: 'user', licence_type: 'founder', holder: { type: 'user', id: '42', name: 'Synthetic Founder' }, envelope_uuid: 'env-11' }) };
const territory = { ...executed, agreement: { ...executed.agreement, licence_family: 'operator', licence_type: 'territory', holder: { type: 'entity', id: '7', name: 'Studio North SAS' } } };

test('#5060 CT-17 rules: three filters in the canvas order, each with words for its value, never a raw key', () => {
  const canvas = readFileSync(new URL('../../design/incoming/Licences and Contracts v2 Addendum Page.dc.html', import.meta.url), 'utf8');
  const drawn = /J\(\['Agreement type', ([^\]]+)\]/.exec(canvas)[1];
  const order = ['Agreement type', ...[...drawn.matchAll(/'([^']+)'/g)].map((m) => m[1])];
  const built = FILTER_BUTTONS.map(([, name]) => name);
  // The canvas draws "Licence / territory" and "Signed / effective"; Effective is not a filter (D5050 part 2).
  assert.deepEqual(built, order.map((n) => (n === 'Signed / effective' ? 'Signed date' : n)));
  for (const k of ['licence_family', 'licence_type', 'holder']) assert.ok(AGREEMENT_FILTER_KEYS.includes(k), k);
  const f = { licence_family: 'user', licence_type: 'operating_partner', holder: 'user:42' };
  const names = { 'user:42': 'Synthetic Founder' };
  assert.equal(filterButtonValue('family', f), 'User licence');
  assert.equal(filterButtonValue('licence_type', f), 'Operating Partner');
  assert.equal(filterButtonValue('holder', f, names), 'Synthetic Founder');
  assert.equal(holderLabel('user:42'), 'Member #42', 'a holder no row named is still words');
  assert.equal(holderLabel('entity:7'), 'Entity 7');
  assert.deepEqual(activeAgreementChips(f, names).map((c) => c.label),
    ['Licence family: User licence', 'Licence type: Operating Partner', 'Holder: Synthetic Founder']);
  assert.deepEqual(withoutAgreementFilters({ ...f, q: 'x' }), { licence_family: '', licence_type: '', holder: '', agreement_type: '', agreement_status: '', licence: '',
    territory: '', program: '', package: '', template: '', signed_from: '', signed_to: '', q: 'x', offset: 0 });
  // The first row naming a holder names them; a later row that does not name them leaves the name alone.
  const unnamed = { ...founder, agreement: { ...founder.agreement, holder: { type: 'user', id: '42', name: null } } };
  assert.deepEqual(holderOptions([founder, territory, unnamed, plain]), [['entity:7', 'Studio North SAS'], ['user:42', 'Synthetic Founder']]);
});

test('#5060 CT-17 mounted: family and type reach the Worker and survive the address; a holder is chosen by name', async () => {
  const urls = setup(() => ({ body: { total: 2, items: [founder, territory] } }));
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await settle(view);
    await press(view, 'agreement-filter-family');
    await choose(view, 'User licence');
    assert.deepEqual(paramsOf(urls.at(-1)), { licence_family: 'user' });
    await press(view, 'agreement-filter-licence_type');
    await choose(view, 'Founder');
    assert.deepEqual(paramsOf(urls.at(-1)), { licence_family: 'user', licence_type: 'founder' });
    await press(view, 'agreement-filter-holder');
    assert.match(walk(byTestId(view, 'agreement-holder-note')), /The holders on this page of agreements/);
    await choose(view, 'Synthetic Founder');
    assert.deepEqual(paramsOf(urls.at(-1)), { licence_family: 'user', licence_type: 'founder', holder: 'user:42' });
    assert.equal(view.props(byTestId(view, 'agreement-filter-holder'))['aria-label'], 'Holder: Synthetic Founder');
    assert.match(walk(byTestId(view, 'agreement-active-filters')), /Licence family: User licence.*Licence type: Founder.*Holder: Synthetic Founder/);
    await pressLabel(view, 'Remove filter Holder: Synthetic Founder');
    assert.deepEqual(paramsOf(urls.at(-1)), { licence_family: 'user', licence_type: 'founder' });
  } finally { await view.unmount(); restore(); }
});

test('#5060 CT-17 mounted: a holder’s name on a row filters to them, and the filter survives a fresh load', async () => {
  const urls = setup(() => ({ body: { total: 2, items: [founder, territory] } }));
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await settle(view);
    const only = view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'agreement-holder-filter');
    assert.ok(only.length >= 2, 'each row naming a holder offers it');
    const studio = only.find((n) => walk(n) === 'Only Studio North SAS');
    await act(async () => { view.props(studio).onClick(); }); await settle(view);
    assert.deepEqual(paramsOf(urls.at(-1)), { holder: 'entity:7' });
  } finally { await view.unmount(); restore(); }
  // Mutation checked: drop 'holder' from the desk's persisted filter list → the address does not carry it.
  const urls2 = setup(() => ({ body: { total: 1, items: [territory] } }));
  const fresh = await mountContracts(element(), '/admin/contracts?holder=entity:7&licence_type=territory&licence_family=operator', user);
  try {
    await settle(fresh);
    assert.deepEqual(paramsOf(urls2.at(-1)), { holder: 'entity:7', licence_type: 'territory', licence_family: 'operator' });
    assert.equal(fresh.props(byTestId(fresh, 'agreement-filter-holder'))['aria-label'], 'Holder: Studio North SAS');
  } finally { await fresh.unmount(); restore(); }
});

test('#5060 CT-17 mounted: a page naming no holder says so, and None names the holder filter in words', async () => {
  const urls = setup((url) => ({ body: new URL(url, 'https://x.test').searchParams.get('holder') ? { total: 0, items: [] } : { total: 1, items: [plain] } }));
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await settle(view);
    await press(view, 'agreement-filter-holder');
    assert.match(walk(byTestId(view, 'agreement-holder-note')), /No agreement on this page names a licence holder\./);
  } finally { await view.unmount(); restore(); }
  setup(() => ({ body: { total: 0, items: [] } }));
  const none = await mountContracts(element(), '/admin/contracts?holder=user:42', user);
  try {
    await settle(none);
    assert.match(walk(byTestId(none, 'agreements-none')), /Holder: Member #42\. Read succeeded\./);
  } finally { await none.unmount(); restore(); }
  void urls;
});
