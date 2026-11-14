/**
 * D5060 (#5060, part 3) — the Licences registry by family (Licences and Contracts v2 addendum, board L36) and the
 * type-aware user licence detail (L37, L37B), mounted on fake Worker reads.
 *
 *   - the model: family chips, the default family, and each cell's one state (a user licence's Scope is Not
 *     applicable, never Not recorded; a failed read is Unreadable, never none);
 *   - /admin/licences opens on the operator ledger; All and the user families read the registry, and a family chip
 *     and a holder narrow the read on the server;
 *   - a user row carries no franchise field and opens /admin/licences/registry/user/:uid;
 *   - the user licence detail draws Overview, Programs, Agreement and History, adds Billing only when the licence has
 *     terms, opens each agreement in Contracts by its canonical id, and says Unreadable for a failed section.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_registry_ui_d5060.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminLicences from '../src/pages/admin/AdminLicences.jsx';
import { UserLicenceView } from '../src/pages/admin/licences/UserLicenceDetail.jsx';
import {
  DEFAULT_FAMILY, FAMILIES, agreementCell, attentionCell, contractsHref, familyFromParam, familyToParam, holderParam,
  packageCell, programsCell, renewalCell, rowHref, scopeCell, userSections,
} from '../src/pages/admin/licenceRegistryModel.js';

const h = React.createElement;

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const ok = (o = {}) => ({ available: true, ...o });
const NR = (reason) => ({ available: false, state: 'not_recorded', reason });
const UR = (what) => ({ available: false, state: 'unreadable', reason: `${what} could not be read. Retry; this is not "none".` });

/** A registry row as the Worker answers it (D5060 §1). */
function userRow(uid, o = {}) {
  return {
    uid, licence_ref: `UL-${uid}`, licence_family: 'user', licence_type: 'founder', licence_type_label: 'Founder',
    holder: { type: 'user', id: '7', name: 'Synthetic Founder', email: 'f@example.test', reason: null },
    status: 'active', revision: 2, starts_on: '2026-02-14', ends_on: null,
    renewal: { on: '2027-02-14', basis: 'renews_on' },
    agreement: { available: true, state: 'executed', state_label: 'Executed', agreement_uid: `env-${uid}`, store: 'esign', template_slug: 'founder_licence_agreement', signed_at: '2026-02-14', reason: null },
    packages: ok({ items: [] }),
    programs: NR('The ledger does not expand a user licence’s program entitlements (#5059); the licence detail reads them.'),
    attention: [],
    ...o,
  };
}
function operatorRow(uid, o = {}) {
  return {
    uid, licence_ref: `AXL-${uid}`, licence_family: 'operator', licence_type: 'territory', licence_type_label: 'Territory licence',
    holder: { type: 'entity', id: '3', name: 'Synthetic Studio SAS', email: null, reason: null },
    status: 'active', revision: 1, starts_on: '2026-03-01', ends_on: null,
    renewal: { on: '2027-03-01', basis: 'renews_on' },
    agreement: { available: true, state: 'awaiting_signature', state_label: 'Awaiting signature', agreement_uid: `lc-${uid}`, store: 'licence_contracts', template_slug: 'x', signed_at: null, reason: null },
    packages: ok({ items: ['venture_building'] }),
    programs: ok({ items: [{ program_key: 'spinout-lab', state: 'granted' }, { program_key: 'perks', state: 'paused' }] }),
    attention: [{ code: 'agreement_not_executed', label: 'Agreement: Awaiting signature' }],
    territory: { available: true, territory_licence_id: 9, kind: 'subsidiary', brand_name: 'Synthetic', legal_entity_name: 'Synthetic Studio SAS', countries: ['FR'], countries_state: 'recorded' },
    ...o,
  };
}

const COUNTS = { all: 3, operator: 1, founder: 2, investor: 0, operating_partner: 0, advisor: 0 };

/** The Worker, as far as these pages read it. `registry` answers the registry page read. */
function worker({ registry, detail } = {}) {
  return (url) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    if (p === '/admin/licence-registry') {
      if (typeof registry === 'function') return registry(u.searchParams);
      return response(registry ?? { available: true, family: 'all', items: [], total: 0, limit: 50, next_cursor: null, counts: COUNTS });
    }
    const one = p.match(/^\/admin\/licence-registry\/([^/]+)$/);
    if (one) return typeof detail === 'function' ? detail(decodeURIComponent(one[1])) : response(detail);
    if (p === '/admin/licences') return response({ items: [], total: 0, next_cursor: null, limit: 50, seats_used_available: true });
    if (p === '/admin/licences/summary') return response({ coverage: [], renewals: { items: [], total: 0, complete: true }, counts: { total: 0, by_status: {}, by_kind: {} } });
    if (p === '/admin/licences/territories') return response({ items: [] });
    return response({ error: 'not_found' }, 404);
  };
}

async function mount(url, handle, element) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const loc = useLocation(); at.path = `${loc.pathname}${loc.search}`; return null; }
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] },
    h(Routes, null,
      h(Route, { path: '/admin/licences', element: h(React.Fragment, null, h(AdminLicences), h(Probe)) }),
      h(Route, { path: '/admin/licences/:uid', element: h(Probe) }),
      h(Route, { path: '/admin/licences/registry/user/:uid', element: h(React.Fragment, null, element, h(Probe)) })))));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const allById = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {} };
  return {
    requests, at, props, byId, allById,
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    textNode: text,
    has: (id) => Boolean(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async clickNode(n) { await act(async () => { await props(n).onClick(event); }); await flush(); },
    registryReads: () => requests.filter((r) => /\/admin\/licence-registry(\?|$)/.test(r)).map((r) => new URL(r, 'http://x').searchParams),
    async close() {
      await act(async () => rootNode.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      restore();
    },
  };
}

// ── The model ────────────────────────────────────────────────────────────

test('#5060 the family chips are the issue’s six, in the canvas order; a bare address is the operator ledger', () => {
  assert.deepEqual(FAMILIES.map((f) => f.label), ['All', 'Operator / territory', 'Founder', 'Investor', 'Operating Partner', 'Advisor']);
  assert.equal(DEFAULT_FAMILY, 'operator');
  assert.equal(familyFromParam(null), 'operator');
  assert.equal(familyFromParam('advisor'), 'advisor');
  assert.equal(familyFromParam('franchise'), 'operator', 'an unknown family is not invented');
  assert.equal(familyToParam('operator'), null);
  assert.equal(familyToParam('all'), 'all');
});

// Mutation checked: scopeCell reading a user row's missing territory as Not recorded (fails); the operator row's
// countries dropped (fails); unreadable countries read as "No countries" (fails).
test('#5060 Scope / territory: a user licence’s cell is Not applicable, never Not recorded; an operator’s is its countries', () => {
  const u = scopeCell(userRow('u1'));
  assert.deepEqual([u.state, u.label, u.aria], ['not_applicable', '', 'Not applicable']);
  assert.deepEqual(scopeCell(operatorRow('o1')), { state: 'value', label: 'FR' });
  assert.equal(scopeCell(operatorRow('o2', { territory: NR('This operator licence has no territory row.') })).state, 'not_recorded');
  assert.equal(scopeCell(operatorRow('o3', { territory: { ...operatorRow('x').territory, countries: null, countries_state: 'unreadable' } })).state, 'unreadable');
});

// Mutation checked: a failed agreement read shown as "None on file" (fails); a user row's programs shown as the
// Worker's Not recorded instead of opening the licence (fails); a paused grant counted as granted (fails).
test('#5060 each registry cell is one state: none, not recorded and unreadable stay three things', () => {
  assert.deepEqual(agreementCell(userRow('u').agreement), { state: 'value', label: 'Executed', tone: 'executed' });
  assert.equal(agreementCell({ available: true, state: 'none', state_label: 'None on file', reason: 'No Founder Licence Agreement has been sent to this holder.' }).state, 'none');
  assert.equal(agreementCell(UR('The user licence agreements')).state, 'unreadable');
  assert.equal(agreementCell(NR('E-sign envelopes are not on this database.')).state, 'not_recorded');
  assert.deepEqual(programsCell(userRow('u')), { state: 'not_on_ledger', label: 'Open the licence to see them' });
  assert.deepEqual(programsCell(operatorRow('o')), { state: 'value', label: '1 of 2 granted' });
  assert.equal(programsCell(operatorRow('o', { programs: UR('The program grants') })).state, 'unreadable');
  assert.deepEqual(packageCell(operatorRow('o')), { state: 'value', label: 'venture_building' });
  assert.deepEqual(packageCell(userRow('u')), { state: 'none', label: 'None' });
  assert.equal(renewalCell(userRow('u', { renewal: { on: null, basis: null, reason: 'No date.' } })).state, 'not_recorded');
  assert.equal(renewalCell(userRow('u', { renewal: { on: '2027-01-31', basis: 'ends_on' } })).label, 'Ends 31 Jan 2027');
  assert.deepEqual(attentionCell(userRow('u')), { state: 'none', label: 'None' });
  assert.equal(attentionCell(operatorRow('o')).label, 'Agreement: Awaiting signature');
  assert.equal(holderParam(userRow('u')), 'user:7');
  assert.equal(rowHref(userRow('a/b')), '/admin/licences/registry/user/a%2Fb');
  assert.equal(rowHref(operatorRow('o1')), '/admin/licences/o1');
  assert.equal(contractsHref('env-1'), '/admin/contracts/agreements/doc/env-1');
});

// Mutation checked: Billing always drawn (the L37B case fails); Billing never drawn (the terms case fails).
test('#5060 the user licence sections: Billing only when the licence has commercial terms (L37B leaves it out)', () => {
  assert.deepEqual(userSections({ billing: NR('No commercial terms are recorded on a user licence in the registry.') }).map((s) => s.key),
    ['overview', 'programs', 'agreement', 'history']);
  assert.deepEqual(userSections({ billing: { available: true, annual_fee: '€6,000' } }).map((s) => s.key),
    ['overview', 'programs', 'agreement', 'billing', 'history']);
});

// ── The Licences page ───────────────────────────────────────────────────

test('#5060 /admin/licences opens on the operator ledger with the family chips; the registry is not read', async () => {
  const v = await mount('/admin/licences', worker());
  try {
    assert.ok(v.has('licence-family-filter'), 'the chips are drawn on the operator ledger too');
    assert.equal(v.props(v.byId('licence-family-operator'))['aria-checked'], true);
    assert.equal(v.registryReads().length, 0);
    assert.ok(v.requests.some((r) => /\/admin\/licences(\?|$)/.test(r)), 'the operator ledger is read');
  } finally { await v.close(); }
});

// Mutation checked: the family left out of the read (the Founder chip still reads all: fails); the holder left out
// (fails); the operator chip not returning to the ledger (fails).
test('#5060 All reads the registry across families; a family chip and a holder narrow the read on the server', async () => {
  const items = [operatorRow('o1'), userRow('u1')];
  const v = await mount('/admin/licences?family=all', worker({
    registry: (q) => response({ available: true, family: q.get('family'), items: q.get('family') === 'founder' ? [items[1]] : items, total: 2, limit: 50, next_cursor: null, counts: COUNTS }),
  }));
  try {
    assert.equal(v.registryReads().at(-1).get('family'), 'all');
    assert.deepEqual(v.allById('registry-row').map((n) => v.props(n)['data-family']), ['operator', 'user']);
    assert.match(v.textOf('licence-family-founder'), /Founder\s*2/, 'each chip carries its count from the read');
    await v.click('licence-family-founder');
    assert.equal(v.at.path, '/admin/licences?family=founder');
    assert.equal(v.registryReads().at(-1).get('family'), 'founder');
    const holder = v.allById('registry-holder')[0];
    await v.clickNode(holder);
    assert.equal(v.registryReads().at(-1).get('holder'), 'user:7');
    assert.match(v.textOf('registry-holder-filter'), /Holder: Synthetic Founder/);
    await v.click('registry-holder-clear');
    assert.equal(v.registryReads().at(-1).get('holder'), null);
    await v.click('licence-family-operator');
    assert.equal(v.at.path, '/admin/licences');
  } finally { await v.close(); }
});

// Mutation checked: the reloaded holder chip falling back to the raw `user:7` (fails).
test('#5060 a holder filter opened from its link names the holder from the rows, not as a raw id', async () => {
  const v = await mount('/admin/licences?family=all&holder=user:7', worker({
    registry: { available: true, family: 'all', items: [userRow('u1')], total: 1, limit: 50, next_cursor: null, counts: COUNTS },
  }));
  try {
    assert.equal(v.registryReads().at(-1).get('holder'), 'user:7');
    assert.equal(v.textOf('registry-holder-filter').replace('Clear holder', ''), 'Holder: Synthetic Founder');
  } finally { await v.close(); }
});

// Mutation checked: the user row's scope cell given a "Not recorded" word (fails); the user row opening the
// territory licence page (fails).
test('#5060 a user row carries no franchise field, says Scope as Not applicable, and opens the user licence detail', async () => {
  const v = await mount('/admin/licences?family=all', worker({
    registry: { available: true, family: 'all', items: [operatorRow('o1'), userRow('u1')], total: 2, limit: 50, next_cursor: null, counts: COUNTS },
  }));
  try {
    const [opRow, uRow] = v.allById('registry-row');
    const cellIn = (row, id) => {
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      return walk(row).find((n) => v.props(n)['data-testid'] === id);
    };
    const scope = cellIn(uRow, 'registry-scope');
    assert.equal(v.props(scope)['data-state'], 'not_applicable');
    assert.equal(v.textNode(scope), 'Not applicable', 'heard by a screen reader, drawn as an empty cell');
    assert.ok(!/Not recorded/.test(v.textNode(uRow)), 'a user row never says Not recorded for a field it does not have');
    assert.equal(v.textNode(cellIn(opRow, 'registry-scope')), 'FR');
    assert.equal(v.props(cellIn(uRow, 'registry-open')).href, '/admin/licences/registry/user/u1');
    assert.equal(v.props(cellIn(opRow, 'registry-open')).href, '/admin/licences/o1');
    assert.equal(v.textNode(cellIn(uRow, 'registry-programs')), 'Open the licence to see them');
    assert.equal(v.textNode(cellIn(opRow, 'registry-programs')), '1 of 2 granted');
  } finally { await v.close(); }
});

// Mutation checked: a failed registry read drawn as "No licence … has been issued" (fails); `available: false`
// drawn as an empty table (fails).
test('#5060 a failed registry read is Unreadable, and a database without the registry is Not recorded; neither is "none issued"', async () => {
  const failed = await mount('/admin/licences?family=advisor', worker({ registry: () => response({ error: 'down' }, 500) }));
  try {
    assert.match(failed.text(), /The licence registry could not be read\. This is not a claim that no licences exist\./);
    assert.ok(!failed.has('registry-none'));
  } finally { await failed.close(); }
  const missing = await mount('/admin/licences?family=all', worker({ registry: { available: false, state: 'not_recorded', reason: 'The licence registry (D5057) is not on this database, so no licence family can be listed.', items: null, total: null } }));
  try {
    assert.match(missing.textOf('registry-not-recorded'), /Not recorded\. The licence registry \(D5057\) is not on this database/);
    assert.ok(!missing.has('registry-table') && !missing.has('registry-none'));
  } finally { await missing.close(); }
  const empty = await mount('/admin/licences?family=investor', worker());
  try {
    assert.match(empty.textOf('registry-none'), /No Investor licence has been issued\./);
  } finally { await empty.close(); }
});

// ── The user licence detail ─────────────────────────────────────────────

function userDetail(o = {}) {
  const base = userRow('u1');
  return {
    available: true,
    layout: 'user',
    overview: {
      uid: 'u1', licence_ref: base.licence_ref, licence_family: 'user', licence_type: 'founder', licence_type_label: 'Founder',
      holder: base.holder, status: 'active', revision: 2, starts_on: '2026-02-14', ends_on: null, renewal: base.renewal, attention: [],
      account: { available: true, user_id: 7, name: 'Synthetic Founder', email: 'f@example.test', role: 'founder', is_active: true },
      entitlements: ok({ items: [{ program_key: 'spinout-lab', program_name: 'Spin-Out Lab', in_force: true }] }),
    },
    programs: ok({ items: [] }),
    packages: ok({ items: [] }),
    agreement: {
      primary: base.agreement,
      versions: ok({ template_slug: 'founder_licence_agreement', items: [
        // D5060 §3: an amendment out for signature is newer, and does not displace the executed version as primary.
        { agreement_uid: 'env-amend', store: 'esign', template_version: 3, legal_status: 'awaiting_signature', legal_status_label: 'Awaiting signature', is_current: false, sent_at: '2026-03-01', signed_at: null, envelope_uuid: 'env-amend' },
        { agreement_uid: 'env-u1', store: 'esign', template_version: 2, legal_status: 'executed', legal_status_label: 'Executed', is_current: true, sent_at: '2026-02-10', signed_at: '2026-02-14', envelope_uuid: 'env-u1' },
      ] }),
      related: ok({ items: [] }),
    },
    billing: NR('No commercial terms are recorded on a user licence in the registry.'),
    history: ok({ items: [{ id: 3, licence_uid: 'u1', action: 'activate', from_status: 'draft', to_status: 'active', revision: 2, reason: 'Accepted into the cohort', created_at: '2026-02-14 10:00:00' }] }),
    ...o,
  };
}

const detailAt = (uid, section) => `/admin/licences/registry/user/${uid}${section ? `?section=${section}` : ''}`;

// Mutation checked: Billing drawn with no terms (the section list fails); the territory tabs reused (fails).
test('#5060 the user licence detail: Overview, Programs, Agreement and History; no Billing without terms; no territory tabs', async () => {
  const v = await mount(detailAt('u1'), worker({ detail: () => response(userDetail()) }), h(UserLicenceView, { uid: 'u1' }));
  try {
    assert.deepEqual(v.allById('user-licence-sections')[0].childNodes.map((n) => v.textNode(n)), ['Overview', 'Programs', 'Agreement', 'History']);
    assert.ok(!/Terms|Access|Operations/.test(v.textOf('user-licence-sections')));
    assert.match(v.text(), /Synthetic Founder · Founder licence/);
    assert.match(v.text(), /UL-u1 · user licence · held by a person · Active/);
    assert.equal(v.textOf('user-licence-entitlements'), 'Spin-Out Lab');
    assert.match(v.textOf('user-licence-account'), /Synthetic Founder · f@example\.test · active/);
  } finally { await v.close(); }
  const billed = await mount(detailAt('u1'), worker({ detail: () => response(userDetail({ billing: { available: true, annual_fee: '€6,000' } })) }), h(UserLicenceView, { uid: 'u1' }));
  try {
    assert.ok(billed.has('user-licence-section-billing'));
  } finally { await billed.close(); }
});

// Mutation checked: the agreement link built from the Contracts list (`?agreement=`) instead of the workspace
// (fails); the newer amendment out for signature drawn as primary (fails).
test('#5060 Agreement: the primary first, then amendments and history, each opening the same record in Contracts', async () => {
  const v = await mount(detailAt('u1', 'agreement'), worker({ detail: () => response(userDetail()) }), h(UserLicenceView, { uid: 'u1' }));
  try {
    const rows = v.allById('user-licence-agreement-version');
    assert.equal(rows.length, 2);
    assert.match(v.textNode(rows[0]), /Founder Licence Agreement · v2user licence · primaryExecuted/);
    assert.match(v.textNode(rows[1]), /v3user licence · amendment \/ historyAwaiting signatureNot signed/);
    const links = v.allById('user-licence-open-contract').map((n) => v.props(n).href);
    assert.deepEqual(links, ['/admin/contracts/agreements/doc/env-u1', '/admin/contracts/agreements/doc/env-amend']);
  } finally { await v.close(); }
});

// Mutation checked: an unreadable history drawn as "No lifecycle event is recorded" (fails); an unreadable
// programs read drawn as an empty table (fails).
test('#5060 a section that fails to read is Unreadable, never "none"; the rest of the licence still answers', async () => {
  const d = userDetail({ history: UR('The user licence history'), programs: UR('The program entitlements') });
  const hist = await mount(detailAt('u1', 'history'), worker({ detail: () => response(d) }), h(UserLicenceView, { uid: 'u1' }));
  try {
    assert.equal(hist.props(hist.byId('user-licence-history-missing'))['data-state'], 'unreadable');
    assert.match(hist.textOf('user-licence-history-missing'), /^! The user licence history could not be read/);
    assert.ok(!hist.has('user-licence-history-none'));
  } finally { await hist.close(); }
  const prog = await mount(detailAt('u1', 'programs'), worker({ detail: () => response(d) }), h(UserLicenceView, { uid: 'u1' }));
  try {
    assert.ok(prog.has('user-licence-programs-missing'));
    assert.ok(!prog.has('user-licence-programs') && !prog.has('user-licence-programs-none'));
    assert.equal(prog.props(prog.byId('user-licence-manage-grants')).href, '/admin/licences/programs/licence/u1');
  } finally { await prog.close(); }
  const events = await mount(detailAt('u1', 'history'), worker({ detail: () => response(userDetail()) }), h(UserLicenceView, { uid: 'u1' }));
  try {
    assert.match(events.textOf('user-licence-event'), /14 Feb 2026 · revision 2Activate · Draft → ActiveAccepted into the cohort/);
  } finally { await events.close(); }
});

test('#5060 an operator licence’s uid goes to its own page; an unknown uid says so; a failed read is Unreadable', async () => {
  const op = await mount(detailAt('o1'), worker({ detail: () => response({ available: true, layout: 'operator', overview: { licence_ref: 'AXL-o1' } }) }), h(UserLicenceView, { uid: 'o1' }));
  try { assert.equal(op.at.path, '/admin/licences/o1'); } finally { await op.close(); }
  const gone = await mount(detailAt('zz'), worker({ detail: () => response({ code: 'not_found' }, 404) }), h(UserLicenceView, { uid: 'zz' }));
  try { assert.match(gone.textOf('user-licence-missing'), /There is no licence with that id\./); } finally { await gone.close(); }
  const down = await mount(detailAt('u1'), worker({ detail: () => response({ error: 'down' }, 500) }), h(UserLicenceView, { uid: 'u1' }));
  try { assert.match(down.text(), /This licence could not be read\. This is not a claim that the licence does not exist\./); } finally { await down.close(); }
});
