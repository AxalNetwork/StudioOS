/**
 * D5059 (#5059) — program entitlements from held user licences: the client's routes, the user licence detail's
 * Programs card (L37: Eligible, Granted, In force, Source licence and blockers) and Program access › User licences
 * with its licence type and holder filters. Mounted on a stubbed fetch.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_entitlements_5059.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { programEntitlementsApi } from '../src/lib/api/programEntitlements.js';
import { filterQuery, inForceWord, sourceWords } from '../src/pages/admin/grants/entitlementsModel.js';
import { viewOf } from '../src/pages/admin/grants/grantsModel.js';
import AccountProgramAccess from '../src/pages/account/AccountProgramAccess.jsx';
import ProgramGrants from '../src/pages/admin/grants/ProgramGrants.jsx';
import { UserLicenceEntitlements } from '../src/pages/admin/grants/EntitlementViews.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(routes) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    seen.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
    const hit = routes[u.pathname];
    return hit ? hit(u) : json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

async function render(el, url) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, el)); });
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const allByTestId = (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    rows: () => allByTestId('entitlement-row').map(textOf),
    has: (id) => Boolean(byTestId(id)),
    async click(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); },
    async submit(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onSubmit({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const src = (uid, ref, type, label) => ({ licence_uid: uid, licence_ref: ref, licence_type: type, licence_type_label: label, status: 'active', rule: { version: 1 }, agreement: { state: 'not_required' }, legally_ready: true });
const LEARNING = {
  program_key: 'learning', program_name: 'Learning', eligible: true, sources: [src('ul_a', 'UL-ADV-0031', 'advisor', 'Advisor'), src('ul_f', 'UL-FND-0042', 'founder', 'Founder')],
  held_not_valid: [], grant: { uid: 'g1', state: 'granted', revision: 1 }, granted: true, legally_ready: true, in_force: true, in_force_via: 'ul_a', status: 'in_force', blockers: [],
};
const MENTOR = {
  program_key: 'mentor-cohorts', program_name: 'Mentor cohort access', eligible: true, sources: [{ ...src('ul_a', 'UL-ADV-0031', 'advisor', 'Advisor'), agreement: { state: 'missing' }, legally_ready: false }],
  held_not_valid: [], grant: { uid: 'g2', state: 'granted', revision: 1 }, granted: true, legally_ready: false, in_force: false, in_force_via: null, status: 'granted_not_in_force',
  blockers: [{ code: 'agreement_missing', sentence: 'Mentor cohort access needs an executed program licence agreement on UL-ADV-0031. None is on file.' }],
};
const PERKS = {
  program_key: 'perks', program_name: 'Perks', eligible: false, sources: [], held_not_valid: [{ licence_uid: 'ul_f', licence_ref: 'UL-FND-0042', licence_type: 'founder', licence_type_label: 'Founder', status: 'suspended' }],
  grant: null, granted: false, legally_ready: false, in_force: false, in_force_via: null, status: 'not_eligible',
  blockers: [{ code: 'licence_suspended', sentence: 'Founder licence UL-FND-0042 is suspended, so it is no source for Perks.' }],
};
const DETAIL = {
  on: '2026-11-12', agreements: 'read',
  licence: { uid: 'ul_a', licence_ref: 'UL-ADV-0031', licence_type: 'advisor', licence_type_label: 'Advisor', status: 'active', revision: 2, valid_source: true },
  account: { id: 31, name: 'Dr. Anke Vogel', email: 'anke@example.test', role: 'admin' },
  other_licences: [{ uid: 'ul_f', licence_ref: 'UL-FND-0042', licence_type: 'founder', licence_type_label: 'Founder', status: 'suspended' }],
  programs: [{ ...MENTOR, source_is_this_licence: true }, { ...LEARNING, source_is_this_licence: true }],
};

test('the client calls only its mounted Worker routes, with encoded ids and no blank filters', async () => {
  // Mutations checked: a blank q sent; "all" sent as a licence_type; the program left unencoded.
  const s = stub({});
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  try {
    await programEntitlementsApi.list({ licence_type: 'all', q: '', holder: 'user:12' });
    await programEntitlementsApi.rules();
    await programEntitlementsApi.account(12);
    await programEntitlementsApi.licence('ul/a');
    await programEntitlementsApi.changeGrant(12, 'learning', { action: 'grant', expected_revision: 0, reason: 'Agreed at review.' });
    await programEntitlementsApi.addRuleVersion({ program_key: 'perks' });
    assert.deepEqual(s.seen, [
      'GET /api/admin/program-entitlements?holder=user%3A12',
      'GET /api/admin/program-entitlements/rules',
      'GET /api/admin/program-entitlements/accounts/12',
      'GET /api/admin/program-entitlements/licences/ul%2Fa',
      'POST /api/admin/program-entitlements/accounts/12/programs/learning',
      'POST /api/admin/program-entitlements/rules',
    ]);
  } finally { s.restore(); globalThis.localStorage = oldStorage; }
  assert.deepEqual(filterQuery({ type: 'all', q: '  ' }), {});
  assert.deepEqual(filterQuery({ type: 'advisor', q: ' Vogel ' }), { licence_type: 'advisor', q: 'Vogel' });
  assert.equal(viewOf('/admin/licences/programs/holders').view, 'holders');
});

test('the model never reads a granted program as in force, and names the source licence', () => {
  // Mutations checked: inForceWord answering "In force" from granted alone; "This licence" for another licence.
  assert.equal(inForceWord(MENTOR), 'Not in force');
  assert.equal(inForceWord(LEARNING), 'In force');
  assert.equal(inForceWord(PERKS), '—');
  assert.deepEqual(sourceWords(LEARNING, 'ul_a'), ['This licence', 'UL-FND-0042 · Founder']);
  assert.deepEqual(sourceWords(LEARNING), ['UL-ADV-0031 · Advisor', 'UL-FND-0042 · Founder']);
  assert.deepEqual(sourceWords(PERKS), ['No valid licence (UL-FND-0042 · suspended)']);
});

test('mounted user licence detail: type, eligible, granted, in force, the source of each, and what blocks it', async () => {
  const s = stub({ '/api/admin/program-entitlements/licences/ul_a': () => json(DETAIL) });
  const v = await render(h(Routes, null, h(Route, { path: '/admin/licences/programs/licence/:uid', element: h(UserLicenceEntitlements) })), '/admin/licences/programs/licence/ul_a');
  try {
    assert.match(v.of('user-licence-header'), /Dr\. Anke Vogel · Advisor licence/);
    assert.match(v.of('user-licence-overview'), /Type\s*Advisor.*UL-FND-0042 · Founder.*suspended/s);
    const rows = v.rows();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^Mentor cohort access\s*Yes\s*Granted\s*Not in force.*needs an executed program licence agreement on UL-ADV-0031.*This licence$/s);
    assert.match(rows[1], /^Learning\s*Yes\s*Granted\s*In force\s*This licence\s*UL-FND-0042 · Founder$/s);
    assert.ok(!v.has('user-licence-agreements-note'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted user licence detail: an unreadable agreement store is said, and a failed read offers Try again', async () => {
  let fail = true;
  const s = stub({ '/api/admin/program-entitlements/licences/ul_a': () => (fail ? json({ detail: 'down' }, 503) : json({ ...DETAIL, agreements: 'unreadable' })) });
  const v = await render(h(Routes, null, h(Route, { path: '/admin/licences/programs/licence/:uid', element: h(UserLicenceEntitlements) })), '/admin/licences/programs/licence/ul_a');
  try {
    assert.match(v.of('user-licence-error'), /could not be read/);
    assert.equal(v.rows().length, 0, 'a failed read is never an empty list of programs');
    fail = false;
    await v.click('user-licence-error-retry');
    assert.match(v.of('user-licence-agreements-note'), /could not be read, so no agreement-required program is shown in force/);
    assert.match(v.rows()[0], /Not in force/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Program access › User licences: filter by licence type and by holder', async () => {
  // Mutations checked: the chip not sending licence_type; the search sending on every keystroke; Clear keeping q.
  const all = [{ holder: { id: 31, name: 'Dr. Anke Vogel' }, ...LEARNING }, { holder: { id: 42, name: 'Léa Martin' }, ...PERKS }];
  const s = stub({
    '/api/admin/program-entitlements': (u) => {
      const type = u.searchParams.get('licence_type');
      const q = u.searchParams.get('q');
      let items = all;
      if (type === 'founder') items = all.filter((r) => [...r.sources, ...r.held_not_valid].some((x) => x.licence_type === 'founder'));
      if (type === 'advisor') items = all.filter((r) => r.sources.some((x) => x.licence_type === 'advisor'));
      if (q) items = items.filter((r) => r.holder.name.includes(q));
      return json({ on: '2026-11-12', items, holders: new Set(items.map((r) => r.holder.id)).size, truncated: false, agreements: 'read' });
    },
  });
  const v = await render(h(Routes, null, h(Route, { path: '/admin/licences/programs/holders', element: h(ProgramGrants) })), '/admin/licences/programs/holders');
  try {
    assert.match(v.of('grants-tab-holders'), /User licences/);
    assert.match(v.of('holder-count'), /2 programs across 2 holders/);
    assert.match(v.rows()[0], /Dr\. Anke Vogel\s*Learning\s*Yes\s*Granted\s*In force/);
    assert.match(v.rows()[1], /Léa Martin\s*Perks\s*No\s*Not granted.*suspended, so it is no source for Perks.*No valid licence \(UL-FND-0042 · suspended\)/s);
    await v.click('holder-type-advisor');
    assert.ok(s.seen.includes('GET /api/admin/program-entitlements?licence_type=advisor'));
    assert.equal(v.rows().length, 1);
    assert.match(v.of('holder-programs'), /Dr\. Anke Vogel/);
    await v.click('holder-type-all');
    await v.type('holder-search-input', 'Léa');
    assert.ok(!s.seen.some((p) => p.includes('q=')), 'typing alone sends nothing');
    await v.submit('holder-search');
    assert.ok(s.seen.includes('GET /api/admin/program-entitlements?q=L%C3%A9a'));
    assert.deepEqual(v.rows().length, 1);
    assert.match(v.rows()[0], /Léa Martin/);
    await v.click('holder-search-clear');
    assert.equal(v.rows().length, 2);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Account program access shows the member’s status, source licences and blockers', async () => {
  const s = stub({
    '/api/member/program-entitlements': () => json({ programs: [LEARNING, MENTOR] }),
  });
  const view = await render(h(AccountProgramAccess), '/account');
  try {
    assert.deepEqual(s.seen, ['GET /api/member/program-entitlements']);
    assert.match(view.of('account-program-access'), /Learning.*In force.*Advisor · UL-ADV-0031/);
    assert.match(view.of('account-program-access'), /Mentor cohort access.*Granted · not in force.*needs an executed program licence agreement/);
  } finally {
    await view.unmount();
    s.restore();
  }
});
