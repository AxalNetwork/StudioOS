/**
 * D5044 (#5044) — HQ Team's holder, roster and directory data flows are decoupled.
 *
 *   1. The page's first load makes ONE `GET /api/admin/hq/admins` (the whole page is mounted over a
 *      recording fetch). The transfer picker reads its own server-filtered candidates.
 *   2. The holders render even when the candidates read fails.
 *   3. Revoke is not a normal action: with one holder none is drawn; with several the console says
 *      the invariant is broken and offers a repair, through review → submit → result.
 *   4. Every destructive action shares one state model (idle, open, submitting, confirmed, refused,
 *      unknown); no answer is "unknown", never done and never refused.
 *   5. Acts invalidate exactly the reads they change, in place: no page reload.
 *   6. HqTeamTable is split into focused files, each named by the test helper.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_team_split_5044.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { mountForm } from './_form_d695.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { TEAM_PARTS, teamFile, unlistedParts } from './_hqTeamSource.mjs';
import { api } from '../src/lib/api.js';
import { superAdminCandidatesApi } from '../src/lib/api/superAdminCandidates.js';
import { hqAccountMovesApi } from '../src/lib/api/hqAccountMoves.js';
import HqAccountsPage from '../src/pages/hq/AccountsPage.jsx';
import SuperAdminHolders from '../src/pages/hq/SuperAdminHolders.jsx';
import HqTeamTable from '../src/pages/hq/HqTeamTable.jsx';
import HqAdminRoster from '../src/pages/hq/team/HqAdminRoster.jsx';
import {
  ACTION_STATES, UNKNOWN_TEXT, actionRefusal, failureState, useGovernedAction, withTimeout,
} from '../src/pages/hq/team/governedAction.js';
import { INVALIDATES, TEAM_READS } from '../src/pages/hq/team/teamInvalidation.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ROSTER = {
  items: [{ user_id: 1, name: 'Holder Hart', email: 'holder@axal.example', is_active: 1, super_admin: 1, rung: 'clear' }],
  total: 1, active: 1, ladder_readable: true, licences_available: true, registry_available: true,
  no_branches: true, searched: false, branches: [],
};
const HOLDER = { id: 1, name: 'Holder Hart', email: 'holder@axal.example', is_active: 1 };
const SECOND = { id: 6, name: 'Second Holder', email: 'second@axal.example', is_active: 1 };

/* ------------------------------------------------------------------ *
 * 1. One supervision read on the whole page's first load              *
 * ------------------------------------------------------------------ */

test('the HQ Team page\'s first load reads GET /api/admin/hq/admins exactly once', async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (/\/api\/admin\/hq\/admins(\?|$)/.test(u)) return json(ROSTER);
    if (/\/api\/admin\/super-admins\/candidates$/.test(u)) return json({ candidates: [{ id: 2, name: 'Sam', email: 'sam@axal.example' }] });
    if (/\/api\/admin\/super-admins$/.test(u)) return json({ holders: [HOLDER] });
    if (/\/api\/admin\/account-moves$/.test(u)) return json({ items: [] });
    return json({ detail: 'not stubbed' }, 503);
  };
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: ['/admin/hq-team'] },
        h(Routes, null, h(Route, { path: '/admin/hq-team', element: h(HqAccountsPage, { onImpersonate() {} }) }))));
    });
    // Past the 250 ms search debounce, so a debounce that re-asks would be counted too.
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const team = seen.filter((u) => /\/api\/admin\/hq\/admins(\?|$)/.test(u));
    assert.equal(team.length, 1, `the page read the supervision roster ${team.length} times: ${team.join(', ')}`);
    assert.equal(seen.filter((u) => /\/api\/admin\/super-admins\/candidates$/.test(u)).length, 1, 'the picker did not read its own candidates');
    assert.equal(seen.filter((u) => /\/api\/admin\/super-admins$/.test(u)).length, 1, 'the holders were not read once');
  } finally {
    await act(async () => root.unmount());
    restore();
    globalThis.fetch = original;
  }
});

test('in the source, only the roster hook makes the supervision read', () => {
  const files = [
    'frontend/src/pages/hq/AccountsPage.jsx', 'frontend/src/pages/hq/SuperAdminHolders.jsx',
    'frontend/src/pages/hq/HqTeamTable.jsx', 'frontend/src/pages/hq/AccountMoveRecovery.jsx',
    'frontend/src/pages/hq/HqTeamActions.jsx', 'frontend/src/pages/admin/consoles/UsersConsole.jsx',
    ...TEAM_PARTS.map((n) => `frontend/src/pages/hq/team/${n}`),
  ];
  const callers = files.filter((f) => /api\.hqAdmins\(/.test(codeOnly(read(f))));
  assert.deepEqual(callers, ['frontend/src/pages/hq/team/useHqTeamRoster.js']);
});

/* ------------------------------------------------------------------ *
 * 2 and 3. The holder console                                          *
 * ------------------------------------------------------------------ */

test('the holders render when the candidates read fails, and the picker says it could not be read', async () => {
  api.superAdmins = async () => ({ holders: [HOLDER] });
  superAdminCandidatesApi.list = async () => { const e = new Error('Request failed'); e.status = 500; throw e; };
  const page = await mountForm(h(SuperAdminHolders, {}));
  await page.flush();
  assert.match(page.text(), /Holder Hart/, 'a failed picker read discarded the holder list');
  assert.ok(page.by('super-admin-candidates-unreadable'), 'the picker\'s failure is not said');
  assert.match(page.text(), /not a claim that there is nobody to hand it to/);
  assert.ok(!page.by('super-admin-holders-unreadable'), 'the holders were drawn as unreadable');
  await page.unmount();
});

test('the picker offers the server\'s candidates, never a current holder', async () => {
  api.superAdmins = async () => ({ holders: [HOLDER] });
  superAdminCandidatesApi.list = async () => ({ candidates: [{ id: 2, name: 'Sam Successor', email: 'sam@axal.example' }, { id: 1, name: 'Holder Hart', email: 'holder@axal.example' }] });
  const page = await mountForm(h(SuperAdminHolders, {}));
  await page.flush();
  const options = page.nodes().filter((n) => n.tagName === 'OPTION').map((n) => page.props(n).value);
  assert.deepEqual(options, ['', 2]);
  await page.unmount();
});

test('with one holder no Revoke is drawn: handing it on is the transfer', async () => {
  api.superAdmins = async () => ({ holders: [HOLDER] });
  superAdminCandidatesApi.list = async () => ({ candidates: [] });
  const page = await mountForm(h(SuperAdminHolders, { viewerId: 1 }));
  await page.flush();
  const labels = page.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent || '');
  assert.ok(!labels.some((l) => /Revoke|Remove elevation/.test(l)), `a revoke is drawn in the one-holder state: ${labels}`);
  assert.ok(page.by('super-admin-one-holder'));
  assert.ok(!page.by('super-admin-repair'));
  await page.unmount();
});

test('with two holders the invariant is broken, and the repair is review, then remove, then the answer', async () => {
  api.superAdmins = async () => ({ holders: [HOLDER, SECOND] });
  superAdminCandidatesApi.list = async () => ({ candidates: [] });
  const revoked = [];
  api.superAdminRevoke = async (id) => { revoked.push(id); return { ok: true }; };
  const changed = [];
  const page = await mountForm(h(SuperAdminHolders, { viewerId: 1, onChanged: () => changed.push(1) }));
  await page.flush();
  assert.ok(page.by('super-admin-repair'), 'the broken invariant is not said');
  assert.match(page.text(), /Invariant broken: 2 accounts hold the elevation/);
  // Only the OTHER holder can be repaired from here; the viewer's own is never offered.
  assert.equal(page.nodes().filter((n) => page.props(n)['data-testid'] === 'super-admin-repair-open').length, 1);
  await page.click('Remove elevation…');
  const confirm = page.by('super-admin-repair-confirm');
  assert.ok(page.props(confirm).disabled, 'the repair can be sent before it is acknowledged');
  const box = page.nodes().find((n) => n.tagName === 'INPUT' && page.props(n).type === 'checkbox');
  await act(async () => page.props(box).onChange({ target: { checked: true } }));
  await act(async () => page.props(page.by('super-admin-repair-confirm')).onClick());
  await page.flush();
  assert.deepEqual(revoked, [6]);
  assert.ok(page.by('super-admin-repaired'), 'a confirmed repair is not drawn');
  assert.equal(changed.length, 1, 'the page was not told the elevation changed');
  await page.unmount();
});

test('a transfer whose answer never arrives is unknown: kept as typed, never handed over, with a re-read', async () => {
  api.superAdmins = async () => ({ holders: [HOLDER] });
  superAdminCandidatesApi.list = async () => ({ candidates: [{ id: 2, name: 'Sam Successor', email: 'sam@axal.example' }] });
  api.superAdminGrant = async () => { throw new TypeError('Failed to fetch'); };
  let told = 0;
  const page = await mountForm(h(SuperAdminHolders, { onTransferred: async () => { told += 1; } }));
  await page.flush();
  await act(async () => page.props(page.nodes().find((n) => n.tagName === 'SELECT')).onChange({ target: { value: '2' } }));
  await act(async () => page.props(page.by('super-admin-reason')).onChange({ target: { value: 'Guillaume steps back from operations' } }));
  await page.submit();
  await page.flush();
  assert.ok(page.by('super-admin-transfer-unknown'), 'no answer was drawn as something other than unknown');
  assert.ok(!page.by('super-admin-transfer-refused'));
  assert.ok(page.by('super-admin-reread'));
  assert.equal(told, 0);
  assert.ok(!page.by('super-admin-handed'));
  await page.unmount();
});

test('the handed-over card has no page reload', () => {
  assert.ok(!/location\.reload/.test(codeOnly(read('frontend/src/pages/hq/SuperAdminHolders.jsx'))));
});

/* ------------------------------------------------------------------ *
 * 4. The shared action state model                                     *
 * ------------------------------------------------------------------ */

test('one state model: refused needs an answer; no answer, a 5xx or a timeout is unknown', async () => {
  assert.deepEqual([...ACTION_STATES], ['idle', 'open', 'submitting', 'confirmed', 'refused', 'unknown']);
  const err = (status, message = 'x', data) => Object.assign(new Error(message), { status, data });
  assert.equal(failureState(err(409)), 'refused');
  assert.equal(failureState(err(403)), 'refused');
  assert.equal(failureState(err(500)), 'unknown');
  assert.equal(failureState(new TypeError('Failed to fetch')), 'unknown');
  assert.equal(actionRefusal(err(409, 'code_word', { message: 'The branch said no.' }), 'fallback'), 'The branch said no.');
  assert.equal(actionRefusal(err(409, 'A sentence.'), 'fallback'), 'A sentence.');
  await assert.rejects(withTimeout(new Promise(() => {}), 10), (e) => e.code === 'timeout' && failureState(e) === 'unknown');
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
});

/** A probe that drives `useGovernedAction` the way a form does. */
function Probe({ perform, timeoutMs, onReady }) {
  const action = useGovernedAction(perform, { timeoutMs, tag: 'test-probe', initial: 'open' });
  onReady(action);
  return h('p', { 'data-testid': 'probe', 'data-state': action.state }, action.error);
}

test('the hook: no answer within the timeout is unknown, and a second press while one is in flight sends nothing', async () => {
  let calls = 0;
  let action;
  const page = await mountForm(h(Probe, {
    perform: () => { calls += 1; return new Promise(() => {}); },
    timeoutMs: 30,
    onReady: (a) => { action = a; },
  }));
  assert.equal(page.props(page.by('probe'))['data-state'], 'open');
  let first;
  let second;
  await act(async () => { first = action.submit(); second = action.submit(); });
  assert.equal(calls, 1, 'a second press sent the request again');
  assert.equal(await second, null);
  await act(async () => { await first; });
  assert.equal(page.props(page.by('probe'))['data-state'], 'unknown', 'a request with no answer was not drawn as unknown');
  assert.ok(page.text().startsWith(UNKNOWN_TEXT));
  await page.unmount();
});

test('the hook: an answer is confirmed, a refusal is refused with the route\'s sentence', async () => {
  let action;
  let answer = async () => ({ ok: true });
  const page = await mountForm(h(Probe, { perform: () => answer(), timeoutMs: 1000, onReady: (a) => { action = a; } }));
  await act(async () => { await action.submit(); });
  assert.equal(page.props(page.by('probe'))['data-state'], 'confirmed');
  answer = async () => { throw Object.assign(new Error('x'), { status: 409, data: { message: 'The branch refused.' } }); };
  await act(async () => { await action.submit(); });
  assert.equal(page.props(page.by('probe'))['data-state'], 'refused');
  assert.equal(page.text(), 'The branch refused.');
  await page.unmount();
});

test('every destructive HQ Team action is on the shared model, and none reports itself', () => {
  for (const name of ['SignOutAccountAction.jsx', 'SupportSessionAction.jsx', 'MoveAccountAction.jsx', 'UnbindAdminAction.jsx']) {
    const src = codeOnly(teamFile(name));
    assert.match(src, /useGovernedAction\(/, `${name} is not on the shared action model`);
    assert.match(src, /<ActionNotice action=\{\w+\} prefix="[\w-]+" \/>/, `${name} does not draw refused and unknown`);
    assert.ok(!/useState\(false\);\s*\/\/ busy|setBusy\(|setErr\(/.test(src), `${name} keeps its own busy or error state`);
  }
  const holders = codeOnly(read('frontend/src/pages/hq/SuperAdminHolders.jsx'));
  assert.ok((holders.match(/useGovernedAction\(/g) || []).length >= 2, 'the transfer and the repair are not on the shared model');
});

test('a sign-out whose answer never arrives is unknown, not signed out', async () => {
  api.hqForceReauthUser = async () => { throw new TypeError('Failed to fetch'); };
  const row = { user_id: 1, name: 'Ada Admin', email: 'ada@axal.example', is_active: 1, rung: 'clear' };
  const page = await mountForm(h('div', null, h(HqAdminRoster, { rows: [row], ladderReadable: true, licencesReadable: true })));
  await act(async () => page.props(page.by('hq-team-revoke')).onClick());
  const input = page.by('hq-team-revoke-form').childNodes[0].childNodes.find((n) => n.tagName === 'INPUT');
  await act(async () => page.props(input).onChange({ target: { value: 'Lost laptop reported' } }));
  const box = page.nodes().find((n) => n.tagName === 'INPUT' && page.props(n).type === 'checkbox');
  await act(async () => page.props(box).onChange({ target: { checked: true } }));
  await act(async () => page.props(page.by('hq-team-revoke-form')).onSubmit({ preventDefault() {} }));
  await page.flush();
  assert.ok(page.by('hq-team-revoke-unknown'), 'an unanswered sign-out is not drawn as unknown');
  assert.ok(page.text().includes(UNKNOWN_TEXT));
  assert.doesNotMatch(page.text(), /Signed out/);
  await page.unmount();
});

/* ------------------------------------------------------------------ *
 * 5. Invalidation, in place                                            *
 * ------------------------------------------------------------------ */

test('each act names the reads it invalidates, and the page wires them', () => {
  assert.deepEqual([...TEAM_READS], ['roster', 'directory']);
  assert.deepEqual(INVALIDATES.holder_change, ['roster', 'directory']);
  assert.deepEqual(INVALIDATES.directory_change, ['roster']);
  assert.deepEqual(INVALIDATES.branch_move, ['roster']);
  for (const reads of Object.values(INVALIDATES)) for (const r of reads) assert.ok(TEAM_READS.includes(r));
  const page = codeOnly(read('frontend/src/pages/hq/AccountsPage.jsx'));
  assert.match(page, /<HqTeamTable reloadKey=\{keys\.roster\} onLoaded=\{setTeam\} onChanged=\{invalidate\} \/>/);
  assert.match(page, /onChanged=\{\(\) => invalidate\('holder_change'\)\}/);
  assert.match(page, /reloadKey=\{keys\.directory\} onChanged=\{\(\) => invalidate\('directory_change'\)\}/);
  const users = codeOnly(read('frontend/src/pages/admin/consoles/UsersConsole.jsx'));
  assert.match(users, /const reloadKey = ownKey \+ outsideKey;/, 'the directory does not re-read on the page\'s key');
  assert.match(users, /const loadAll = \(\) => \{ setOwnKey\(\(k\) => k \+ 1\); onChanged\?\.\(\); \};/, 'the directory does not report its changes');
  for (const f of ['frontend/src/pages/hq/AccountsPage.jsx', 'frontend/src/pages/hq/HqTeamTable.jsx', ...TEAM_PARTS.map((n) => `frontend/src/pages/hq/team/${n}`)]) {
    assert.ok(!/location\.reload/.test(codeOnly(read(f))), `${f} reloads the page`);
  }
});

test('a new reload key re-reads the roster in place, once', async () => {
  const calls = [];
  api.hqAdmins = async (...a) => { calls.push(a); return ROSTER; };
  hqAccountMovesApi.open = async () => ({ items: [] });
  const page = await mountForm(h(HqTeamTable, { reloadKey: 0 }));
  await page.flush();
  assert.equal(calls.length, 1);
  await page.render(h(HqTeamTable, { reloadKey: 1 }));
  await page.flush();
  assert.equal(calls.length, 2, 'the invalidation did not re-read the roster');
  assert.ok(page.by('hq-team'), 'the table is gone after the re-read');
  await page.unmount();
});

/* ------------------------------------------------------------------ *
 * 6. The split                                                         *
 * ------------------------------------------------------------------ */

test('HQ Team is split into the files its README names, and HqTeamTable composes them', () => {
  assert.deepEqual(unlistedParts(), [], 'a file in pages/hq/team/ is missing from the test helper');
  const listed = readdirSync(resolve(process.cwd(), 'frontend/src/pages/hq/team')).filter((n) => /\.jsx?$/.test(n)).sort();
  assert.deepEqual(listed, [...TEAM_PARTS].sort());
  const readme = read('frontend/src/pages/hq/team/README.md');
  for (const n of TEAM_PARTS) assert.ok(readme.includes(`\`${n}\``), `the README does not describe ${n}`);
  const table = codeOnly(read('frontend/src/pages/hq/HqTeamTable.jsx'));
  assert.ok(table.split('\n').length < 300, 'HqTeamTable still holds its parts');
  for (const part of ['useHqTeamRoster', 'HqAdminRoster', 'BranchAccountSearch']) {
    assert.match(table, new RegExp(`from './team/${part}'`), `HqTeamTable does not compose ${part}`);
  }
});
