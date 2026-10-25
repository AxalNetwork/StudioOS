/**
 * D964 (#2797, Programs part 11) — the proposal flow and HQ's decisions:
 * Propose a program (PG14), Your proposals (PG1), Proposals from studios and
 * the tab strip (PG2), Decide (PG15a), New program, and PG19b.
 *
 * Mounted on a stubbed `fetch` that answers part 2's routes (D955) as the
 * Worker does. Every studio, proposal and person is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_proposals_d964.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { pageKeyFor } from '../src/lib/railPages.js';
import ProgramsCatalogue from '../src/pages/admin/programs/ProgramsCatalogue.jsx';
import ProposePage from '../src/pages/admin/programs/ProposePage.jsx';
import ProposalsPage from '../src/pages/admin/programs/ProposalsPage.jsx';
import { LINE_SUPER } from '../src/pages/admin/programs/programsModel.js';
import {
  NOT_SAVED, PROPOSALS_CLOSED, emptyForm, fieldsFrom, formFrom, joinLine, missingSentence, newProgramFields, proposalRefusal,
  reviewRows, studioOptions, toggleReward,
} from '../src/pages/admin/programs/proposalsModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.com' };
const STAMP = '2026-10-16T09:41:00.000Z';

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const refusal = (code, status, extra = {}) => response({ error: code, code, message: 'Worker sentence', ...extra }, status);
const never = () => new Promise(() => {});

const MINE = [
  { uid: 'pp-a', name: 'Operator Fellowship', sent_at: null, status: 'draft', hq_note: null, updated_at: STAMP },
  { uid: 'pp-b', name: 'Clinic Track', sent_at: '2026-09-30T10:00:00Z', status: 'sent_back', hq_note: 'Say how cohorts are selected.', updated_at: STAMP },
  { uid: 'pp-c', name: 'Demo Night', sent_at: '2026-09-02T10:00:00Z', status: 'approved', hq_note: 'Approved for your studio.', updated_at: STAMP },
];
const QUEUE = [
  { uid: 'pp-q1', name: 'Fitness Sprint', studio: 'Studio North', licence_uid: 'lic-n', sent_at: '2026-10-16T08:00:00Z', status: 'sent' },
  { uid: 'pp-q2', name: 'Clinic Track', studio: 'Studio East', licence_uid: 'lic-e', sent_at: '2026-09-30T10:00:00Z', status: 'sent_back' },
];
const proposal = (o = {}) => ({
  uid: 'pp-new', status: 'draft', studio: 'Studio North', licence_uid: 'lic-n', name: null, purpose: null, who: null, group: null,
  join_method: null, cycle: null, cohort_weeks: null, seats: null, eligibility: null, rewards: null, template_keys: [], hq_receives: null,
  tools: null, sent_at: null, decision: null, hq_note: null, decided_at: null, program_key: null, created_at: STAMP, updated_at: STAMP, ...o,
});

/** Part 2's routes, as the Worker answers them; `o` overrides any one. */
function worker(o = {}) {
  const {
    user = null, mine = { rows: MINE, total: MINE.length, page: 1, page_size: 25 },
    queue = { rows: QUEUE, total: QUEUE.length, page: 1, page_size: 25, counts: { sent: 1, approved: 0, sent_back: 1, declined: 0 } },
    grid = { licences: [{ uid: 'lic-n', brand_name: 'Studio North' }, { uid: 'lic-e', brand_name: 'Studio East' }] },
    one = {}, templates = { items: [{ slug: 'operator-agreement', title: 'Operator agreement' }] },
    start, save, send, decide, create,
  } = o;
  const call = (v, ...a) => (typeof v === 'function' ? v(...a) : response(v));
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    const body = options.body ? JSON.parse(options.body) : null;
    if (path === '/api/auth/me') return user ? response(user) : never();
    if (method === 'POST' && path === '/api/admin/programs/proposals') return start ? start(body) : response({ proposal: proposal(fieldsOut(body)) }, 201);
    let m = /^\/api\/admin\/programs\/proposals\/([^/]+)\/send$/.exec(path);
    if (m && method === 'POST') return send ? send(m[1]) : refusal('proposals_closed', 403);
    m = /^\/api\/admin\/programs\/proposals\/([^/]+)\/decision$/.exec(path);
    if (m && method === 'POST') return decide ? decide(m[1], body) : response({ proposal: proposal({ uid: m[1], status: 'approved' }) });
    if (method === 'POST' && path === '/api/admin/programs') return create ? create(body) : response({ program: { key: 'new-key' } }, 201);
    m = /^\/api\/admin\/programs\/proposals\/([^/]+)$/.exec(path);
    if (m && method === 'PATCH') return save ? save(m[1], body) : response({ proposal: proposal({ uid: m[1], ...fieldsOut(body), updated_at: '2026-10-16T10:05:00.000Z' }) });
    if (method !== 'GET') return never();
    if (path === '/api/admin/programs/proposals/mine') return call(mine, url);
    if (path === '/api/admin/programs/proposals') return call(queue, url);
    if (m) return one[m[1]] ? call(one[m[1]]) : refusal('unknown_proposal', 404);
    if (path === '/api/admin/program-grants') return call(grid);
    if (path === '/api/admin/contracts/templates/store') return call(templates);
    return never();
  };
}
const fieldsOut = (b) => (b ? { ...b } : {});

async function mounted(url, page, handle, { user = null } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  const tree = user ? h(AuthProvider, null, h(page), h(Probe)) : [h(page, { key: 'p' }), h(Probe, { key: 'q' })];
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, tree)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, at, text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value, key = 'value') { await act(async () => { props(byId(id)).onChange({ target: { [key]: value } }); }); await flush(); },
    writes: () => requests.filter((r) => r.method !== 'GET').map((r) => ({ method: r.method, url: r.url, body: r.body ? JSON.parse(r.body) : null })),
    async close() {
      await act(async () => rootNode.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      localStorage.removeItem?.('user');
      restore();
    },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the Review lines are the playbook part 2 writes from the same fields', () => {
  const form = { ...emptyForm(), purpose: 'Operators embed in a venture.', who: ['Founders', 'Operating partners'], join_method: 'By application',
    cycle: 'cohorts', cohort_weeks: '12', seats: '12', rewards: ['Credits'], tools: { ...emptyForm().tools, application_queue: true, events: true } };
  assert.deepEqual(reviewRows(form).map((r) => [r.title, r.body]), [
    ['Purpose', 'Operators embed in a venture.'], ['Who it is for', 'Founders, operating partners'],
    ['How people join', 'By application · cohorts of 12 weeks · 12 seats'], ['Rewards', 'Credits'], ['Tools', 'Application queue, events'],
  ]);
  assert.equal(joinLine({ join_method: null, cycle: 'cohorts', cohort_weeks: '', seats: '' }), null, 'cohorts with no length say nothing, as part 2');
  assert.equal(joinLine({ join_method: 'Open', cycle: 'rolling', cohort_weeks: '', seats: '1' }), 'Open · rolling · 1 seat');
  assert.deepEqual(reviewRows(emptyForm()).map((r) => r.body), [null, null, null, null, null], 'an empty field reads Not set, never a sample');
});

test('the form saves every field, an empty one as null; New program sends Basics and How it runs only', () => {
  const f = fieldsFrom({ ...emptyForm(), name: ' Fellowship ', cycle: 'rolling', cohort_weeks: '6', seats: '' });
  assert.equal(f.name, 'Fellowship');
  assert.equal(f.cohort_weeks, null, 'weeks only count with cohorts');
  assert.equal(f.seats, null);
  assert.equal(f.who, null);
  assert.deepEqual(Object.keys(newProgramFields({ ...emptyForm(), name: 'X', group: 'Learning', rewards: ['Cash'], hq_receives: 'Report' })).sort(), ['group', 'name']);
  assert.deepEqual(formFrom(proposal({ who: ['Founders', 'Product testers'], seats: 12 })).who, ['Founders'], 'Product testers waits for #2377');
  assert.deepEqual(toggleReward(['Credits'], 'None'), ['None']);
  assert.deepEqual(toggleReward(['None'], 'Cash'), ['Cash'], 'None stands alone, as part 2 refuses it with another');
});

test('each refusal is one sentence keyed on its code', () => {
  assert.equal(proposalRefusal({ status: 403, data: { code: 'proposals_closed' } }), PROPOSALS_CLOSED);
  assert.equal(proposalRefusal({ status: 400, data: { code: 'incomplete', missing: ['purpose', 'join_method'] } }), 'Add a one-line purpose and a join method before sending to HQ.');
  assert.equal(proposalRefusal({ status: 409, code: 'program_key_taken' }), 'A program with this name already exists. Change the name and try again.');
  assert.equal(missingSentence([]), null);
  assert.deepEqual(studioOptions({ licences: [{ uid: 'b', brand_name: 'Beta' }, { uid: 'a', brand_name: 'Alpha' }] }), [['a', 'Alpha'], ['b', 'Beta'], ['hq-held', 'HQ-held']]);
});

/* ------------------------------------------------------------------ *
 * Routes and doors
 * ------------------------------------------------------------------ */

test('the two routes: any admin, never hqOnly, each an alias of Admin · Programs, each with a literal door', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/programs\/propose" element=\{guard\(\['admin'\], <AdminProposePage \/>\)\} \/>/);
  assert.match(app, /<Route path="\/admin\/programs\/proposals" element=\{guard\(\['admin'\], <AdminProposalsPage \/>\)\} \/>/);
  for (const p of ['/admin/programs/propose', '/admin/programs/proposals']) assert.equal(pageKeyFor(p), pageKeyFor('/admin/programs'), `${p} answers Admin · Programs`);
  const catalogue = codeOnly(read('frontend/src/pages/admin/programs/ProgramsCatalogue.jsx'));
  assert.ok(catalogue.includes('<Link to="/admin/programs/propose"'), 'Propose a program is a literal door');
  const tabs = codeOnly(read('frontend/src/pages/admin/programs/ProposalsPage.jsx'));
  assert.ok(tabs.includes('<NavLink to="/admin/programs/proposals"'), 'the Proposals tab is a literal door');
  assert.ok(!tabs.includes('SuperAdminOnlyNotice'), 'PG19b is the page\'s own notice');
  const reach = read('frontend/test/admin_route_reachability.test.mjs');
  assert.match(reach, /\['frontend\/src\/pages\/admin\/programs\/ProgramsCatalogue\.jsx', \[\s*'frontend\/src\/pages\/admin\/programs\/ProposalsPage\.jsx'/);
});

/* ------------------------------------------------------------------ *
 * The catalogue, an Admin's and a Super Admin's
 * ------------------------------------------------------------------ */

test('an Admin\'s catalogue: Propose a program, Your proposals with statuses, notes and Open, and no HQ tools', async () => {
  const view = await mounted('/admin/programs', ProgramsCatalogue, worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.equal(view.props('programs-propose').href, '/admin/programs/propose');
    assert.ok(!view.has('programs-new'), 'New program is HQ\'s');
    assert.ok(!view.has('programs-tabs'), 'an Admin\'s catalogue has one tab, so no strip');
    assert.ok(!view.has('proposals-queue'));
    assert.match(view.textOf('proposals-mine-row-pp-a'), /Operator Fellowship.*Not sent.*Draft.*No note yet/s);
    assert.match(view.textOf('proposals-mine-row-pp-b'), /Clinic Track.*30 Sep.*Sent back.*Say how cohorts are selected\./s);
    assert.match(view.textOf('proposals-mine-row-pp-c'), /Approved.*Approved for your studio\./s);
    assert.equal(view.props('proposals-mine-open-pp-b').href, '/admin/programs/propose?proposal=pp-b');
    assert.equal(view.textOf('proposals-mine-count'), '1–3 of 3');
    assert.ok(view.requests.some((r) => r.url === '/api/admin/programs/proposals/mine?sort=newest'));
    assert.ok(!view.requests.some((r) => r.url.startsWith('/api/admin/programs/proposals?')), 'an Admin never reads HQ\'s queue');
  } finally { await view.close(); }
});

test('Your proposals: an empty list says so with the door, a failed read says so, and the status filter is asked of the Worker', async () => {
  const empty = await mounted('/admin/programs', ProgramsCatalogue, worker({ user: ADMIN, mine: { rows: [], total: 0, page: 1, page_size: 25 } }), { user: ADMIN });
  try {
    assert.match(empty.textOf('proposals-mine-empty'), /Your studio has not proposed a program yet\.Propose a program/);
    assert.equal(empty.props('proposals-mine-propose').href, '/admin/programs/propose');
    await empty.change('proposals-mine-status', 'declined');
    assert.ok(empty.requests.some((r) => r.url === '/api/admin/programs/proposals/mine?status=declined&sort=newest'));
    assert.equal(empty.textOf('proposals-mine-empty'), 'No proposal matches these filters.', 'a filtered empty list is not "none yet"');
  } finally { await empty.close(); }
  const failed = await mounted('/admin/programs', ProgramsCatalogue, worker({ user: ADMIN, mine: () => response({ error: 'down' }, 503) }), { user: ADMIN });
  try {
    assert.ok(failed.has('proposals-mine-failed'));
    assert.ok(!failed.has('proposals-mine-empty'), 'a failed read is never an empty list');
  } finally { await failed.close(); }
});

test('a Super Admin\'s catalogue: New program, the tab strip with the amber count, the line, and Proposals from studios', async () => {
  const view = await mounted('/admin/programs', ProgramsCatalogue, worker({ user: SUPER }), { user: SUPER });
  try {
    assert.equal(view.textOf('programs-catalogue-line'), LINE_SUPER);
    assert.equal(LINE_SUPER, 'Every program on StudioOS, what needs HQ now, and what studios propose.');
    assert.ok(!view.has('programs-propose'), 'HQ does not propose to itself');
    assert.equal(view.textOf('programs-tab-catalogue'), 'Catalogue');
    assert.equal(view.textOf('programs-tab-proposals-count'), '1', 'the proposals sent to HQ');
    assert.match(view.textOf('proposals-queue-row-pp-q1'), /Fitness Sprint.*Studio North.*16 Oct.*Sent to HQ.*Decide/s);
    assert.match(view.textOf('proposals-queue-row-pp-q2'), /Studio East.*Sent back.*Open/s);
    assert.ok(view.requests.some((r) => r.url === '/api/admin/programs/proposals?sort=oldest'), 'oldest first');
    await view.change('proposals-queue-studio', 'lic-e');
    assert.ok(view.requests.some((r) => r.url === '/api/admin/programs/proposals?sort=oldest&licence=lic-e'));
  } finally { await view.close(); }
});

/* ------------------------------------------------------------------ *
 * Decide (PG15a)
 * ------------------------------------------------------------------ */

test('Decide: the note is required for Send back and Decline before anything is sent, and a refusal keeps the dialog open', async () => {
  let refuse = true;
  const view = await mounted('/admin/programs', ProgramsCatalogue, worker({
    user: SUPER,
    decide: (uid, body) => (refuse ? refusal('not_waiting', 409) : response({ proposal: proposal({ uid, status: body.outcome === 'decline' ? 'declined' : 'sent_back' }) })),
  }), { user: SUPER });
  try {
    await view.click('proposals-queue-decide-pp-q1');
    assert.ok(view.has('proposals-decide-dialog'));
    assert.match(view.text(), /Decide on Fitness Sprint/);
    assert.match(view.text(), /From Studio North · sent 16 Oct\./);
    await view.change('proposals-decide-send_back', true, 'checked');
    await view.click('proposals-decide-confirm');
    assert.equal(view.textOf('proposals-decide-refusal'), 'Write a note to the studio. It is required to send a proposal back or decline it.');
    assert.deepEqual(view.writes(), [], 'no decision is sent without its note');
    await view.change('proposals-decide-decline', true, 'checked');
    await view.click('proposals-decide-confirm');
    assert.deepEqual(view.writes(), [], 'Decline needs it too');
    await view.change('proposals-decide-note', 'It overlaps the Spin-Out Lab.');
    await view.click('proposals-decide-confirm');
    assert.deepEqual(view.writes(), [{ method: 'POST', url: '/api/admin/programs/proposals/pp-q1/decision', body: { outcome: 'decline', note: 'It overlaps the Spin-Out Lab.' } }]);
    assert.ok(view.has('proposals-decide-dialog'), 'a refusal keeps the dialog open');
    assert.equal(view.textOf('proposals-decide-refusal'), 'Another decision landed first, or this proposal is no longer waiting. Reload to see it.');
    refuse = false;
    await view.click('proposals-decide-confirm');
    assert.ok(!view.has('proposals-decide-dialog'), 'a decision that lands closes it');
  } finally { await view.close(); }
});

test('Decide: an approval needs no note, and the dialog says an approval sets no grant yet', async () => {
  const view = await mounted('/admin/programs/proposals', ProposalsPage, worker({ user: SUPER }), { user: SUPER });
  try {
    await view.click('proposals-queue-decide-pp-q1');
    assert.match(view.textOf('proposals-decide-grant'), /an approval sets no grant yet/);
    await view.change('proposals-decide-approve_catalogue', true, 'checked');
    await view.click('proposals-decide-confirm');
    assert.deepEqual(view.writes(), [{ method: 'POST', url: '/api/admin/programs/proposals/pp-q1/decision', body: { outcome: 'approve_catalogue', note: null } }]);
  } finally { await view.close(); }
});

/* ------------------------------------------------------------------ *
 * New program
 * ------------------------------------------------------------------ */

test('New program: a Super Admin\'s only, Basics and How it runs, and program_key_taken in place', async () => {
  let taken = true;
  const view = await mounted('/admin/programs', ProgramsCatalogue, worker({
    user: SUPER, create: () => (taken ? refusal('program_key_taken', 409) : response({ program: { key: 'operator-fellowship' } }, 201)),
  }), { user: SUPER });
  try {
    await view.click('programs-new');
    await view.change('programs-new-name', 'Operator Fellowship');
    await view.click('programs-new-group-Learning');
    await view.click('programs-new-join-By application');
    await view.click('programs-new-create');
    assert.deepEqual(view.writes(), [{ method: 'POST', url: '/api/admin/programs', body: { name: 'Operator Fellowship', group: 'Learning', join_method: 'By application' } }]);
    assert.equal(view.textOf('programs-new-refusal'), 'A program with this name already exists. Change the name and try again.');
    assert.ok(view.has('programs-new-dialog'), 'the dialog stays open');
    taken = false;
    await view.click('programs-new-create');
    assert.ok(!view.has('programs-new-dialog'));
    assert.match(view.textOf('programs-new-done'), /Operator Fellowship is added as Proposed, with an empty playbook draft\./);
  } finally { await view.close(); }
});

/* ------------------------------------------------------------------ *
 * PG19b
 * ------------------------------------------------------------------ */

test('PG19b: an Admin at HQ\'s proposals address reads the page\'s own notice and reads no queue; a Super Admin gets the queue', async () => {
  const admin = await mounted('/admin/programs/proposals', ProposalsPage, worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.match(admin.textOf('programs-proposals-only-hq'), /Only HQ decides on proposals\.Your own proposals are under Programs\.Back to Programs/);
    assert.equal(admin.props('programs-proposals-back').href, '/admin/programs');
    assert.ok(!admin.requests.some((r) => r.url.startsWith('/api/admin/programs/proposals')), 'an Admin asks for no queue');
  } finally { await admin.close(); }
  const hq = await mounted('/admin/programs/proposals', ProposalsPage, worker({ user: SUPER }), { user: SUPER });
  try {
    assert.ok(!hq.has('programs-proposals-only-hq'));
    assert.ok(hq.has('proposals-queue-row-pp-q1'));
    assert.equal(hq.textOf('programs-tab-proposals-count'), '1');
  } finally { await hq.close(); }
});

/* ------------------------------------------------------------------ *
 * Propose a program (PG14)
 * ------------------------------------------------------------------ */

test('Propose: "Draft saved" is drawn only from part 2\'s stored draft, never from what the browser holds', async () => {
  const view = await mounted('/admin/programs/propose', ProposePage, worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.match(view.textOf('propose-crumb'), /Programs › Propose a program/);
    assert.equal(view.textOf('propose-saved'), NOT_SAVED);
    await view.change('propose-name', 'Operator Fellowship');
    await view.click('propose-who-Founders');
    assert.equal(view.textOf('propose-saved'), NOT_SAVED, 'typing saves nothing');
    assert.deepEqual(view.writes(), []);
    await view.click('propose-save');
    const [first] = view.writes();
    assert.equal(first.method, 'POST');
    assert.equal(first.url, '/api/admin/programs/proposals');
    assert.equal(first.body.name, 'Operator Fellowship');
    assert.deepEqual(first.body.who, ['Founders']);
    assert.match(view.textOf('propose-saved'), /^Draft saved \d\d:\d\d$/);
    assert.equal(view.at.path, '/admin/programs/propose?proposal=pp-new');
    await view.click('propose-save');
    assert.equal(view.writes()[1].method, 'PATCH', 'the same draft is saved again');
    assert.equal(view.writes()[1].url, '/api/admin/programs/proposals/pp-new');
  } finally { await view.close(); }
});

test('Propose: Send to HQ asks first, and proposals_closed is one sentence under the button', async () => {
  const stored = proposal({ uid: 'pp-a', name: 'Operator Fellowship', purpose: 'Operators embed in a venture.', who: ['Founders'], group: 'Learning', join_method: 'By application' });
  const view = await mounted('/admin/programs/propose?proposal=pp-a', ProposePage, worker({ user: ADMIN, one: { 'pp-a': { proposal: stored } } }), { user: ADMIN });
  try {
    assert.equal(view.props('propose-name').value, 'Operator Fellowship');
    await view.click('propose-step-4');
    assert.match(view.textOf('propose-review-who'), /Who it is forFounders/);
    assert.match(view.textOf('propose-review-rewards'), /RewardsNot set/);
    await view.click('propose-send');
    assert.ok(view.has('propose-send-dialog'), 'a write opens a dialog');
    assert.deepEqual(view.writes(), [], 'nothing is sent until Confirm');
    await view.click('propose-send-confirm');
    assert.deepEqual(view.writes().map((w) => `${w.method} ${w.url}`), ['PATCH /api/admin/programs/proposals/pp-a', 'POST /api/admin/programs/proposals/pp-a/send']);
    assert.equal(view.textOf('propose-send-refusal'), PROPOSALS_CLOSED);
    assert.ok(!view.has('propose-send-dialog'));
  } finally { await view.close(); }
});

test('Propose: Send waits for what part 2 needs, and says what is missing', async () => {
  const view = await mounted('/admin/programs/propose', ProposePage, worker({ user: ADMIN }), { user: ADMIN });
  try {
    await view.click('propose-step-4');
    assert.ok(view.props('propose-send').disabled);
    assert.equal(view.textOf('propose-missing'), 'Add a name, a one-line purpose, who it is for, a group and a join method before sending to HQ.');
  } finally { await view.close(); }
});

test('Propose: Terms read the contracts library, and a failed read marks that field alone', async () => {
  const view = await mounted('/admin/programs/propose', ProposePage, worker({ user: ADMIN, templates: () => response({ error: 'x', code: 'templates_unreadable' }, 503) }), { user: ADMIN });
  try {
    await view.click('propose-step-2');
    assert.ok(view.has('propose-templates-failed'));
    assert.ok(view.has('propose-hq-receives'), 'the rest of Terms still draws');
    assert.match(view.textOf('propose-terms-foot'), /HQ sets your studio’s grant terms when it grants the program, on Licences\./);
    await view.click('propose-rewards-Credits');
    await view.click('propose-rewards-None');
    assert.equal(view.props('propose-rewards-Credits')['aria-pressed'], false, 'None stands alone');
  } finally { await view.close(); }
});

test('Propose: a proposal HQ has decided opens read only, with HQ\'s note; an unknown one says so', async () => {
  const approved = proposal({ uid: 'pp-c', status: 'approved', name: 'Demo Night', purpose: 'A night of demos.', sent_at: '2026-09-02T10:00:00Z', hq_note: 'Approved for your studio.' });
  const view = await mounted('/admin/programs/propose?proposal=pp-c', ProposePage, worker({ user: ADMIN, one: { 'pp-c': { proposal: approved } } }), { user: ADMIN });
  try {
    assert.ok(view.has('propose-readonly'));
    assert.ok(!view.has('propose-steps'), 'no form for a decided proposal');
    assert.ok(!view.has('propose-saved'));
    assert.match(view.textOf('propose-readonly-note'), /Approved for your studio\./);
    assert.match(view.textOf('propose-readonly-status'), /Approved/);
  } finally { await view.close(); }
  const gone = await mounted('/admin/programs/propose?proposal=pp-x', ProposePage, worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.equal(gone.textOf('propose-gone'), 'This proposal no longer exists, or belongs to another studio.');
  } finally { await gone.close(); }
});

/* ------------------------------------------------------------------ *
 * Source rules
 * ------------------------------------------------------------------ */

test('the source: no toast or confirm, no canvas sample, no Product testers audience, and the tools never read as switched on', () => {
  const files = ['ProposePage.jsx', 'ProposalsPage.jsx', 'ProposalTables.jsx', 'ProposalFields.jsx', 'DecideDialog.jsx', 'NewProgramDialog.jsx', 'proposalsModel.js']
    .map((f) => codeOnly(read(`frontend/src/pages/admin/programs/${f}`))).join('\n');
  assert.doesNotMatch(files, /window\.confirm|useToast|localStorage|sessionStorage/);
  for (const sample of ['[Studio', '[Operator', '[12]', '[10:4', 'Studio Lisbon', 'Studio Nairobi']) assert.ok(!files.includes(sample), `a canvas sample: ${sample}`);
  assert.doesNotMatch(read('frontend/src/pages/admin/programs/proposalsModel.js'), /WHO_WORDS = Object\.freeze\(\[[^\]]*Product testers/);
  assert.match(read('frontend/src/pages/admin/programs/ProposePage.jsx'), /`Needs \$\{label/, 'each tool reads as a need');
  assert.match(read('frontend/src/lib/api.js'), /\nexport \* from '\.\/api\/programProposals\.js';\n/);
});
