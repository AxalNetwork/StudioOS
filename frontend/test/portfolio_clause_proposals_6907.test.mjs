/**
 * D6907 part 2 (#6907, canvas PRM18 rail): Eadwyn proposes a right that is in the investor's signed paper but not
 * recorded, on Ownership & rights. The model is checked directly; `OwnershipRights` is mounted against a stubbed
 * `fetch` with the rights read (D6868) and the clause read (D6907 part 1).
 *
 * Acceptance (#6907):
 *   - no proposal for a recorded right, or for a right with an open request;
 *   - Accept posts one request and nothing else;
 *   - a document that cannot be read leaves the rail saying so, not "none found".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_clause_proposals_6907.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import OwnershipRights from '../src/pages/portfolio/OwnershipRights.jsx';
import { DESCRIPTION_MAX, RIGHT_TYPES } from '../src/pages/portfolio/rightsModel.js';
import {
  CLAUSES_SHAPE, CLAUSES_UNREADABLE, clauseLocation, noneFoundLine, proposalsOf, railState, unreadableDocs,
} from '../src/pages/portfolio/clauseProposalModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ---------------------------------------------------------------- fixtures, in the Worker's shapes

const none = (type) => ({ type, recorded: false });
const PRO_RATA = { uid: 'g1', type: 'pro_rata', recorded: true, document_title: 'Investors’ Rights Agreement', clause: '§2.1', terms: 'Buy up to your share', signed_on: '2026-03-31', recorded_at: '2026-04-01T10:00:00Z' };
const OPEN_BOARD = { uid: 'q1', project_uid: 'p-abc', type: 'board_seat', description: 'IRA §3.1', state: 'open', created_at: '2026-11-14T09:00:00Z', answered_at: null, right_uid: null, answer_note: null };
const rightsRead = (requests = [OPEN_BOARD]) => ({ scope: 'own_rights', project: { uid: 'p-abc' }, rights: RIGHT_TYPES.map((t) => (t === 'pro_rata' ? PRO_RATA : none(t))), requests });
const clause = (right_type, o = {}) => ({ right_type, number: '3.3', heading: 'Board Observer', text: 'The Company shall invite one representative of the Investor to attend all meetings of the Board in a nonvoting observer capacity.', line: 42, page: 9, ...o });
const IRA = {
  envelope_uuid: 'env-ira', title: 'Investors’ Rights Agreement', document_type: 'ira', signed_at: '2026-03-31 10:00:00', readable: true, unreadable_reason: null,
  clauses: [
    clause('observer_seat'),
    clause('pro_rata', { number: '2.1', heading: 'Right of First Offer', text: 'Pro rata participation in new securities.', line: 20, page: 5 }),
    clause('board_seat', { number: '3.1', heading: 'Board Composition', text: 'The Investor may designate one director.', line: 30, page: 8 }),
    clause('information_rights', { number: '4.1', heading: 'Delivery of Financial Statements', text: 'The Company shall deliver annual financial statements.', line: 50, page: null }),
  ],
};
const SIDE = { envelope_uuid: 'env-side', title: 'Side letter', document_type: 'side_letter', signed_at: '2026-04-02T09:00:00Z', readable: true, unreadable_reason: null, clauses: [clause('observer_seat', { number: null, heading: null, line: 3, page: null })] };
const BROKEN = { envelope_uuid: 'env-x', title: 'Voting Agreement', document_type: 'voting', signed_at: null, readable: false, unreadable_reason: 'The stored text does not match what was signed, so it is not read.', clauses: [] };
const ASKABLE = ['information_rights', 'observer_seat', 'liquidation_preference', 'anti_dilution'];

// ---------------------------------------------------------------- the model

test('model: only the askable types are proposed: never a recorded right, never one with an open request', () => {
  const ps = proposalsOf({ documents: [IRA] }, ASKABLE);
  assert.deepEqual(ps.map((p) => p.type), ['observer_seat', 'information_rights']);
  assert.ok(!ps.some((p) => p.type === 'pro_rata'), 'pro rata is recorded');
  assert.ok(!ps.some((p) => p.type === 'board_seat'), 'the board seat has an open request');
  assert.deepEqual(proposalsOf({ documents: [IRA] }, []), []);
  assert.deepEqual(proposalsOf({ documents: [IRA] }, ['constructor', 'observer_seat']).map((p) => p.type), ['observer_seat']);
});

test('model: the sentence and the citation name the document, the clause and the page, as PRM18 draws them', () => {
  const [obs, info] = proposalsOf({ documents: [IRA] }, ASKABLE);
  assert.equal(obs.sentence, 'This Investors’ Rights Agreement §3.3 grants you an observer seat; it is not recorded here. Add it?');
  assert.equal(obs.cite, 'Source: signed Investors’ Rights Agreement · 31 Mar 2026 · §3.3, page 9');
  assert.match(obs.description, /^Investors’ Rights Agreement, §3\.3, page 9, signed 31 Mar 2026: “The Company shall invite/);
  assert.equal(info.cite, 'Source: signed Investors’ Rights Agreement · 31 Mar 2026 · §4.1');
  // One proposal per type, from the first document that grants it.
  assert.equal(proposalsOf({ documents: [SIDE, IRA] }, ['observer_seat'])[0].cite, 'Source: signed Side letter · 2 Apr 2026 · line 3');
  assert.equal(proposalsOf({ documents: [SIDE, IRA] }, ['observer_seat']).length, 1);
  assert.equal(proposalsOf({ documents: [SIDE] }, ['observer_seat'])[0].sentence, 'This Side letter grants you an observer seat; it is not recorded here. Add it?');
  assert.equal(clauseLocation({ heading: 'Observer', line: 4, page: 2 }), '“Observer”, page 2');
  assert.equal(clauseLocation({}), 'clause not located');
});

test('model: the description fits the request’s limit; an unreadable document is never proposed from', () => {
  const long = { ...IRA, clauses: [clause('observer_seat', { text: 'x '.repeat(3000) })] };
  const [p] = proposalsOf({ documents: [long] }, ['observer_seat']);
  assert.ok(p.description.length <= DESCRIPTION_MAX);
  assert.match(p.description, /…”$/);
  // Even a title longer than the limit cannot push the request past it.
  const huge = proposalsOf({ documents: [{ ...IRA, title: 'T'.repeat(DESCRIPTION_MAX + 500) }] }, ['observer_seat'])[0];
  assert.equal(huge.description.length, DESCRIPTION_MAX);
  assert.deepEqual(proposalsOf({ documents: [{ ...BROKEN, clauses: [clause('observer_seat')] }] }, ['observer_seat']), []);
  assert.deepEqual(unreadableDocs({ documents: [IRA, BROKEN] }), [{ key: 'env-x', title: 'Voting Agreement', reason: BROKEN.unreadable_reason }]);
});

test('model: the rail’s states keep a failed read, no documents, nothing found and nothing to ask apart', () => {
  assert.equal(railState({ askable: [], read: { state: 'ok', value: { documents: [IRA] } } }), 'nothing_to_ask');
  assert.equal(railState({ askable: null, read: null }), 'nothing_to_ask');
  assert.equal(railState({ askable: ASKABLE, read: { state: 'loading' } }), 'loading');
  assert.equal(railState({ askable: ASKABLE, read: { state: 'unreadable' } }), 'unreadable');
  assert.equal(railState({ askable: ASKABLE, read: { state: 'ok', value: { documents: [] } } }), 'no_documents');
  assert.equal(railState({ askable: ASKABLE, read: { state: 'ok', value: { documents: [IRA] } } }), 'proposals');
  assert.equal(railState({ askable: ['anti_dilution'], read: { state: 'ok', value: { documents: [IRA, BROKEN] } } }), 'none_found');
  assert.equal(railState({ askable: ['anti_dilution'], read: { state: 'ok', value: { documents: [BROKEN] } } }), 'unreadable_all');
  assert.equal(noneFoundLine({ documents: [IRA, BROKEN] }), 'Eadwyn read 1 signed document and found no clause granting a right that is not recorded or requested.');
  assert.equal(CLAUSES_SHAPE({ documents: [IRA] }), true);
  assert.equal(CLAUSES_SHAPE({ documents: [{ title: 'x' }] }), false);
  assert.equal(CLAUSES_SHAPE({}), false);
});

// ---------------------------------------------------------------- the page

async function mount(routes, props = {}) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    const out = typeof hit === 'function' ? await hit(opts, path) : hit;
    if (out && out.__status) return response({ error: out.code, message: 'refused' }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 14; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(OwnershipRights, {
    uid: 'p-abc', position: { rounds: 1, total_invested: 100000 }, route: 'direct', duties: { state: 'ok', count: 2 }, reportsHref: null, ...props,
  }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}
const clausesOf = (documents) => ({ project_uid: 'p-abc', types: ASKABLE, documents, summary: {} });

test('page: the clause read asks only for the askable types, and proposes only those', async () => {
  const t = await mount({ 'GET /portfolio-rights/p-abc': rightsRead(), 'GET /portfolio-clauses/p-abc': clausesOf([IRA]) });
  try {
    const read = t.asked.find((a) => a.path.startsWith('/portfolio-clauses/'));
    assert.equal(decodeURIComponent(read.path.split('?type=')[1]), 'information_rights,observer_seat,liquidation_preference,anti_dilution');
    assert.ok(t.has('clause-proposal-observer_seat'));
    assert.ok(t.has('clause-proposal-information_rights'));
    assert.ok(!t.has('clause-proposal-pro_rata'), 'recorded');
    assert.ok(!t.has('clause-proposal-board_seat'), 'already requested');
    assert.match(t.text('clause-proposal-cite-observer_seat'), /§3\.3, page 9/);
    assert.match(t.text('clause-proposals'), /never records a right/);
  } finally { await t.close(); }
});

test('page: Accept posts one request with the clause as its description, and nothing else', async () => {
  let rights = rightsRead();
  const posted = [];
  const t = await mount({
    'GET /portfolio-rights/p-abc': () => rights,
    'GET /portfolio-clauses/p-abc': clausesOf([IRA]),
    'POST /portfolio-rights/requests': (opts) => {
      const b = JSON.parse(opts.body); posted.push(b);
      rights = rightsRead([OPEN_BOARD, { ...OPEN_BOARD, uid: 'q2', type: b.type, description: b.description }]);
      return { uid: 'q2', type: b.type, state: 'open' };
    },
  });
  try {
    const before = t.asked.length;
    await t.click('button-clause-accept-observer_seat');
    const writes = t.asked.slice(before).filter((a) => a.method !== 'GET');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, '/portfolio-rights/requests');
    assert.deepEqual(Object.keys(posted[0]).sort(), ['description', 'project_uid', 'type']);
    assert.equal(posted[0].type, 'observer_seat');
    assert.equal(posted[0].project_uid, 'p-abc');
    assert.match(posted[0].description, /^Investors’ Rights Agreement, §3\.3, page 9, signed 31 Mar 2026: “/);
    // The right is now requested: no proposal for it, and the page says what was sent.
    assert.ok(!t.has('clause-proposal-observer_seat'));
    assert.ok(t.has('rights-open-observer_seat'));
    assert.match(t.text('rights-ask-sent'), /Sent to HQ: Observer seat, from Eadwyn’s proposal/);
    assert.ok(t.has('clause-proposal-information_rights'));
  } finally { await t.close(); }
});

test('page: Edit wording sends the investor’s words in the same one request; Discard sends nothing', async () => {
  const posted = [];
  const t = await mount({
    'GET /portfolio-rights/p-abc': rightsRead(),
    'GET /portfolio-clauses/p-abc': clausesOf([IRA]),
    'POST /portfolio-rights/requests': (opts) => { posted.push(JSON.parse(opts.body)); return { uid: 'q3', state: 'open' }; },
  });
  try {
    await t.click('button-clause-discard-information_rights');
    assert.ok(!t.has('clause-proposal-information_rights'));
    assert.equal(posted.length, 0);
    await t.click('button-clause-edit-observer_seat');
    await t.change('clause-proposal-edit-observer_seat', '   ');
    await t.click('button-clause-send-observer_seat');
    assert.equal(posted.length, 0, 'an empty description is caught before sending');
    assert.match(t.text('clause-proposal-error-observer_seat'), /Say where the right is written/);
    await t.change('clause-proposal-edit-observer_seat', 'IRA §3.3, page 9: observer seat');
    await t.click('button-clause-send-observer_seat');
    assert.deepEqual(posted, [{ project_uid: 'p-abc', type: 'observer_seat', description: 'IRA §3.3, page 9: observer seat' }]);
  } finally { await t.close(); }
});

test('page: a refused Accept says why and keeps the proposal; nothing is recorded', async () => {
  const t = await mount({
    'GET /portfolio-rights/p-abc': rightsRead(),
    'GET /portfolio-clauses/p-abc': clausesOf([IRA]),
    'POST /portfolio-rights/requests': { __status: 409, code: 'request_open' },
  });
  try {
    await t.click('button-clause-accept-observer_seat');
    assert.match(t.text('clause-proposal-error-observer_seat'), /You already asked HQ to record this right/);
    assert.ok(t.has('clause-proposal-observer_seat'));
  } finally { await t.close(); }
});

test('page: an unreadable document, or a failed read, says so, never "none found"', async () => {
  const t = await mount({ 'GET /portfolio-rights/p-abc': rightsRead(), 'GET /portfolio-clauses/p-abc': clausesOf([BROKEN]) });
  try {
    assert.ok(t.has('clause-proposals-unreadable-all'));
    assert.match(t.text('clause-unread-env-x'), /Not read: Voting Agreement ?\. The stored text does not match/);
    assert.ok(!t.has('clause-proposals-none'));
  } finally { await t.close(); }
  const mixed = await mount({ 'GET /portfolio-rights/p-abc': rightsRead(), 'GET /portfolio-clauses/p-abc': { ...clausesOf([BROKEN, { ...IRA, clauses: [] }]) } });
  try {
    assert.match(mixed.text('clause-proposals-none'), /Eadwyn read 1 signed document/);
    assert.ok(mixed.has('clause-unread-env-x'), 'the unread one is listed beside "none found"');
  } finally { await mixed.close(); }
  const failed = await mount({ 'GET /portfolio-rights/p-abc': rightsRead(), 'GET /portfolio-clauses/p-abc': { __status: 500, code: 'boom' } });
  try {
    assert.match(failed.text('clause-proposals-unreadable'), new RegExp(CLAUSES_UNREADABLE.slice(0, 40)));
    assert.ok(failed.has('button-retry-clauses'));
    // The rights stay readable when the clause read fails.
    assert.ok(failed.has('rights-table'));
  } finally { await failed.close(); }
});

test('page: nothing is read or drawn when every right is recorded or requested, or for a viewer who cannot ask', async () => {
  const full = { ...rightsRead([]), rights: RIGHT_TYPES.map((t) => ({ ...PRO_RATA, uid: t, type: t })) };
  const t = await mount({ 'GET /portfolio-rights/p-abc': full });
  try {
    assert.ok(!t.asked.some((a) => a.path.startsWith('/portfolio-clauses/')));
    assert.ok(!t.has('clause-proposals'));
  } finally { await t.close(); }
  const viewer = await mount({ 'GET /portfolio-rights/p-abc': rightsRead() }, { canAsk: false });
  try {
    assert.ok(!viewer.asked.some((a) => a.path.startsWith('/portfolio-clauses/')));
    assert.ok(!viewer.has('clause-proposals'));
  } finally { await viewer.close(); }
});

test('wiring: Ownership & rights mounts the card outside the rights body, with the askable types', () => {
  const src = readFileSync(new URL('../src/pages/portfolio/OwnershipRights.jsx', import.meta.url), 'utf8');
  assert.match(src, /const proposable = read\.state === 'ok' && canAsk \? askableTypes\(rightsRows\(read\.value, duties\)\) : null;/);
  assert.match(src, /<ClauseProposals uid=\{uid\} askable=\{proposable\}/);
  const card = readFileSync(new URL('../src/pages/portfolio/ClauseProposals.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /portfolioRightsApi\.record|method: 'PUT'/, 'Eadwyn never records a right');
});
