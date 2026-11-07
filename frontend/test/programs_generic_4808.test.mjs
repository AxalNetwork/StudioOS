/**
 * D4808 (#4808) — a synthetic custom program, end to end on the generic registry-backed page, and a proposal's review.
 *
 * "Operator Fellowship" is a program an approval made: it has no route of its own and no entry in the frontend's fixed set.
 * What is pinned: its page resolves from the registry alone (About, Availability, Declared capabilities, the Approved
 * proposal exactly as approved, each not-operational field marked); How it runs is the playbook; Activity is the activity
 * read; a key nobody holds says so; the literal addresses still outrank `/:key`; New program offers Open program; the
 * review shows every submitted field before Decide; and the catalogue's card for a dynamic key has a door.
 * Every name and id is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_generic_4808.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import adminProgramsGenericRoutes from '../src/routes/adminProgramsGeneric.jsx';
import { catalogueCards } from '../src/pages/admin/programs/catalogueModel.js';
import {
  approvedRows, capabilityRows, genericKeyFrom, genericTabFrom, metadataRows, proposalSummary, specRows,
} from '../src/pages/admin/programs/genericProgramModel.js';

const h = React.createElement;
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.test' };
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const refusal = (code, status) => response({ error: code, code, message: 'Worker sentence' }, status);
const never = () => new Promise(() => {});

const FIELDS = {
  name: 'Operator Fellowship', group: 'Network and referrals', purpose: 'Operators embedded in a venture.', who: ['Founders', 'Operating partners'],
  join_method: 'By application', cycle: 'cohorts', cohort_weeks: 12, seats: 8, eligibility: 'Nominated by a partner.', rewards: ['Credits'],
  template_keys: ['operator-agreement'], hq_receives: 'A quarterly report.', tools: { events: true, perks: false },
};
const DETAIL = {
  program: { key: 'operator-fellowship', group: 'Network and referrals', name: 'Operator Fellowship', purpose: 'Operators embedded in a venture.', who: 'Founders, operating partners', join_method: 'By application', status: 'proposed', position: 11, updated_at: '2026-11-07T10:00:00Z', studio_only: null },
  playbook: { published: false, version: null, published_at: null, sections: [] },
  draft: { sections: [{ key: 'purpose', position: 1, title: 'Purpose', body: 'Operators embedded in a venture.', computed: false, template_keys: [] }], edited_at: '2026-11-07T10:00:00Z', differs: true },
  grant: { state: 'granted_to', granted_count: 0 }, grantable: false,
  approved_proposal: { proposal_uid: 'pp-9001', decision: 'catalogue', decided_at: '2026-11-07T09:00:00Z', spec: { proposal_uid: 'pp-9001', fields: FIELDS, capabilities: [{ key: 'events', label: 'Events', operational: false }], not_operational: { keys: ['eligibility', 'rewards', 'contracts', 'tools', 'hq_obligations'], reason: 'Recorded as approved. Nothing enforces it yet.' } } },
  capabilities: [{ key: 'events', label: 'Events', operational: false }],
};
const PROPOSAL = { uid: 'pp-9001', id: 9001, status: 'sent', studio: 'Studio North', licence_uid: 'lic-n', sent_at: '2026-11-06T08:00:00Z', hq_note: null, program_key: null, ...FIELDS };

function worker(user, extra = {}) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (path === '/api/auth/me') return response(user);
    if (method !== 'GET') return extra.write ? extra.write(path, method, options) : never();
    if (path === '/api/admin/programs/operator-fellowship') return response(DETAIL);
    if (path === '/api/admin/programs/ghost') return refusal('unknown_program', 404);
    if (path === '/api/admin/programs/operator-fellowship/activity') return response({ program: 'operator-fellowship', rows: [], next_before: null, not_audited: null });
    if (path === '/api/admin/programs/proposals/pp-9001') return response({ proposal: PROPOSAL });
    return never();
  };
}

async function mounted(url, element, handle, user) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET') }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, element, h(Probe)))));
  const flush = () => act(async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 5)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, at, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

/** The real route table for the generic page, with a literal address beside it as `App.jsx` has. */
const Table = () => h(Suspense, { fallback: null }, h(Routes, null,
  h(Route, { path: '/admin/programs/perks', element: h('p', { 'data-testid': 'literal-perks' }, 'Perks page') }),
  adminProgramsGenericRoutes({ guard: (_roles, element) => element })));

test('the model: rows for the registry row and the approved spec, with the not-operational fields named', () => {
  assert.equal(genericKeyFrom('/admin/programs/operator-fellowship'), 'operator-fellowship');
  assert.equal(genericKeyFrom('/admin/programs/operator-fellowship/how-it-runs'), 'operator-fellowship');
  assert.equal(genericKeyFrom('/admin/programs/operator-fellowship/activity/'), 'operator-fellowship');
  assert.equal(genericKeyFrom('/admin/programs'), null);
  assert.equal(genericTabFrom('/admin/programs/x/how-it-runs'), 'how');
  assert.equal(genericTabFrom('/admin/programs/x/activity'), 'activity');
  assert.equal(genericTabFrom('/admin/programs/x'), 'overview');
  const meta = Object.fromEntries(metadataRows(DETAIL.program).map((r) => [r.key, r.value]));
  assert.equal(meta.status, 'Proposed');
  assert.equal(meta.studio, 'Every studio');
  const rows = Object.fromEntries(specRows(FIELDS).map((r) => [r.key, r]));
  assert.equal(rows.cycle.value, 'In cohorts · 12 weeks');
  assert.equal(rows.tools.value, 'events', 'only the tools turned on');
  for (const k of ['cycle', 'seats', 'eligibility', 'rewards', 'templates', 'tools', 'hq']) assert.equal(rows[k].operational, false, k);
  for (const k of ['name', 'group', 'purpose', 'who', 'join_method']) assert.equal(rows[k].operational, true, k);
  assert.equal(approvedRows(DETAIL.approved_proposal).length, specRows(FIELDS).length);
  assert.deepEqual(specRows({}).map((r) => r.value), Array(12).fill(null), 'a field nobody set is null, never 0');
  assert.deepEqual(capabilityRows(DETAIL.capabilities), [{ key: 'events', label: 'Events', operational: false }]);
  assert.equal(proposalSummary({ state: 'ready', count: 0 }).text, 'No proposal is waiting on HQ.');
  assert.equal(proposalSummary({ state: 'ready', count: 3 }).text, '3 proposals are waiting on HQ.');
  assert.match(proposalSummary({ state: 'unreadable' }).text, /not the same as none/);
});

test('a custom program: create → open → edit → publish → revisit resolves from the registry with no route for its key', async () => {
  const view = await mounted('/admin/programs/operator-fellowship', h(Table), worker(SUPER), SUPER);
  try {
    assert.ok(view.has('programs-generic-overview'));
    assert.match(view.textOf('programs-header'), /Operator Fellowship/);
    assert.match(view.textOf('programs-generic-meta-purpose'), /Operators embedded in a venture\./);
    assert.match(view.textOf('programs-generic-meta-status'), /Proposed/);
    assert.match(view.textOf('programs-generic-availability'), /Granted to 0 studios/);
    assert.match(view.textOf('programs-generic-availability'), /not switched on to be offered to studios/);
    // Declared capabilities, none of them operating.
    assert.match(view.textOf('programs-generic-cap-events'), /Events · Not operational yet/);
    assert.match(view.textOf('programs-generic-screens'), /No operating screen exists for this program yet/);
    // The approved proposal, exactly as approved, with the not-operational fields marked.
    for (const k of ['name', 'group', 'purpose', 'who', 'join_method', 'cycle', 'seats', 'eligibility', 'rewards', 'templates', 'tools', 'hq']) {
      assert.ok(view.has(`programs-generic-spec-${k}`), `spec row ${k}`);
    }
    assert.match(view.textOf('programs-generic-spec-eligibility'), /Nominated by a partner\..*Not operational yet/s);
    assert.match(view.textOf('programs-generic-spec-hq'), /A quarterly report\..*Not operational yet/s);
    assert.ok(!view.has('programs-generic-spec-purpose-marker'), 'purpose operates');
    assert.match(view.textOf('programs-generic-spec-foot'), /Nothing enforces it yet/);
    assert.ok(view.has('programs-generic-approved-link'));
    // The three tabs are the same shell for any program.
    for (const t of ['overview', 'how', 'activity']) assert.ok(view.has(`programs-tab-${t}`), t);
    assert.ok(view.requests.some((r) => r.url === '/api/admin/programs/operator-fellowship'));
  } finally { await view.close(); }

  const how = await mounted('/admin/programs/operator-fellowship/how-it-runs', h(Table), worker(SUPER), SUPER);
  try {
    assert.ok(how.has('programs-generic-how'), 'How it runs is the playbook editor');
    assert.match(how.text(), /Purpose/);
  } finally { await how.close(); }

  const activity = await mounted('/admin/programs/operator-fellowship/activity', h(Table), worker(SUPER), SUPER);
  try {
    assert.ok(activity.has('programs-generic-activity'));
    assert.ok(activity.requests.some((r) => r.url.startsWith('/api/admin/programs/operator-fellowship/activity')));
  } finally { await activity.close(); }
});

test('a key nobody holds says so with a way back; a literal address still outranks /:key', async () => {
  const ghost = await mounted('/admin/programs/ghost', h(Table), worker(ADMIN), ADMIN);
  try {
    assert.ok(ghost.has('programs-generic-problem'));
    assert.match(ghost.textOf('programs-generic-problem'), /No such program/);
    assert.match(ghost.textOf('programs-generic-problem'), /No program has that key\./);
    assert.ok(ghost.has('programs-generic-back'));
  } finally { await ghost.close(); }
  const perks = await mounted('/admin/programs/perks', h(Table), worker(ADMIN), ADMIN);
  try {
    assert.ok(perks.has('literal-perks'), 'the nine keep their own pages');
    assert.ok(!perks.has('programs-generic-overview'));
  } finally { await perks.close(); }
});

test('the review before Decide shows every submitted field; Decide is on the page, not a click away in a list', async () => {
  const view = await mounted('/admin/programs/proposals/pp-9001', h(Table), worker(SUPER), SUPER);
  try {
    assert.ok(view.has('proposal-review-spec'));
    for (const k of ['name', 'group', 'purpose', 'who', 'join_method', 'cycle', 'seats', 'eligibility', 'rewards', 'templates', 'tools', 'hq']) {
      assert.ok(view.has(`proposal-review-${k}`), `review row ${k}`);
    }
    assert.match(view.textOf('proposal-review-cycle'), /In cohorts · 12 weeks/);
    assert.match(view.textOf('proposal-review-hq'), /A quarterly report\./);
    assert.match(view.textOf('proposal-review-sent'), /Studio North/);
    assert.ok(view.has('proposal-review-decide'));
  } finally { await view.close(); }
  const admin = await mounted('/admin/programs/proposals/pp-9001', h(Table), worker(ADMIN), ADMIN);
  try {
    assert.ok(admin.has('proposal-review-only-hq'), 'only HQ decides');
    assert.ok(!admin.requests.some((r) => r.url.includes('/proposals/pp-9001')), 'an Admin reads no proposal here');
  } finally { await admin.close(); }
});

test('the catalogue keeps a registry key the nine do not include, with an Open door', () => {
  const read = { status: 'ready', data: { programs: { available: true, rows: [{ key: 'operator-fellowship', group: 'Network and referrals', name: 'Operator Fellowship', purpose: 'Operators.', who: null, join_method: null, status: 'proposed', figures: {} }] } } };
  const { cards } = catalogueCards(read);
  assert.deepEqual(cards.map((c) => [c.key, c.name, c.status]), [['operator-fellowship', 'Operator Fellowship', 'Proposed']]);
});
