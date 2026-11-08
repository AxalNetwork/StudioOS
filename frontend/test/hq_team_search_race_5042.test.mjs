/**
 * D5042 (#5042) — HQ Team's branch search is race-safe and follows one contract.
 *
 * Every branch result the table draws can be tied to the exact query the operator sees
 * in the field: an older answer never overwrites a newer one, a cleared or changed query
 * never leaves the previous hits shown as current, and a query the Worker would decline
 * (below two characters, above sixty-four) is never sent.
 *
 * The table is mounted over a stubbed `api.hqAdmins` whose answers the test releases by
 * hand; real timers for the 250 ms debounce. No network. Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_team_search_race_5042.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { mountForm, textOf } from './_form_d695.mjs';
import { api } from '../src/lib/api.js';
import HqTeamTable from '../src/pages/hq/HqTeamTable.jsx';
import ViewAsBranchContext from '../src/contexts/ViewAsBranchContext.js';
import {
  TEAM_SEARCH_MAX, TEAM_SEARCH_MIN, branchQueryFor, normalizeTeamSearch, searchStatus,
} from '../src/pages/hq/teamSearchPolicy.js';

const h = React.createElement;
const ADMIN = { user_id: 1, name: 'Sue', email: 'sue@axal.example', is_active: 1 };
const hit = (id, name) => ({ id, name, email: `${name.toLowerCase()}@es.example`, role: 'founder', is_active: 1 });
const answer = (q, results, extra = {}) => ({
  items: [ADMIN], total: 1, active: 1, ladder_readable: true, licences_available: true,
  registry_available: true, no_branches: false,
  searched: q.length >= 2,
  search: { state: q.length >= 2 ? 'asked' : q ? 'too_short' : 'none', query: q, min_length: 2, max_length: 64 },
  branches: [q.length >= 2
    ? { code: 'es', binding: 'BRANCH_ES', status: 'ok', data: { results, truncated: false }, as_of: '2026-11-08T10:00:00Z' }
    : { code: 'es', binding: 'BRANCH_ES', status: 'not_asked' }],
  branches_coverage: { total: 1, asked: q.length >= 2 ? 1 : 0, answered: q.length >= 2 ? 1 : 0, complete: q.length >= 2, unreadable: [], not_deployed: [], not_asked: q.length >= 2 ? [] : ['es'] },
  ...extra,
});

/** A hqAdmins stub whose answers are released by the test. */
function controlled() {
  const calls = [];
  api.hqAdmins = (q, branch) => new Promise((resolve, reject) => {
    calls.push({ q, branch, resolve, reject });
  });
  return calls;
}
const sleep = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function mount(provider) {
  const calls = controlled();
  const el = provider ? h(ViewAsBranchContext.Provider, { value: provider }, h(HqTeamTable, {})) : h(HqTeamTable, {});
  const page = await mountForm(el);
  // the first read, for no query
  await act(async () => calls[0].resolve(answer('', [])));
  await page.flush();
  return { page, calls };
}
async function type(page, value) {
  await act(async () => page.props(page.by('hq-team-search')).onChange({ target: { value } }));
  await sleep(300); // the 250 ms debounce
}
const release = async (call, value) => { await act(async () => call.resolve(value)); };

test('a slow answer for "gu" that lands after the answer for "gui" does not overwrite it', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].q, 'gu');
  await type(page, 'gui');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].q, 'gui');

  await release(calls[2], answer('gui', [hit(11, 'Guillaume')]));
  assert.match(page.text(), /Guillaume/);

  await release(calls[1], answer('gu', [hit(12, 'Gustave')])); // the late, older answer
  await page.flush();
  assert.match(page.text(), /Guillaume/, 'the newer answer was replaced');
  assert.doesNotMatch(page.text(), /Gustave/, 'a stale branch hit is on screen');
  assert.match(page.text(), /1 match on the branches for “gui”/);
  await page.unmount();
});

test('the older answer landing first is replaced by the newer one, as before', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  await type(page, 'gui');
  await release(calls[1], answer('gu', [hit(12, 'Gustave')]));
  await release(calls[2], answer('gui', [hit(11, 'Guillaume')]));
  assert.match(page.text(), /Guillaume/);
  assert.doesNotMatch(page.text(), /Gustave/);
  await page.unmount();
});

test('an older read that FAILS after a newer one succeeded does not turn the table unreadable', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  await type(page, 'gui');
  await release(calls[2], answer('gui', [hit(11, 'Guillaume')]));
  await act(async () => calls[1].reject(new Error('older read failed')));
  await page.flush();
  assert.match(page.text(), /Guillaume/);
  assert.doesNotMatch(page.text(), /older read failed/);
  assert.doesNotMatch(page.text(), /could not be read/i);
  await page.unmount();
});

test('while a newer query is in flight the last answer stays, marked as not current, and the status says what is happening', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  await release(calls[1], answer('gu', [hit(12, 'Gustave')]));
  await type(page, 'gui');
  assert.match(page.text(), /Gustave/, 'the last committed result was blanked while the next one loads');
  assert.ok(page.by('hq-team-search-stale'), 'stale hits are presented as current');
  assert.match(page.text(), /Showing the last answer \(for “gu”\) while the branches answer for “gui”/);
  assert.match(page.text(), /Searching the branches for “gui”…/);
  const group = page.by('hq-team-group-branch');
  assert.equal(page.props(group)['aria-busy'], true);
  await release(calls[2], answer('gui', [hit(11, 'Guillaume')]));
  assert.ok(!page.by('hq-team-search-stale'));
  assert.equal(page.props(page.by('hq-team-group-branch'))['aria-busy'], false);
  await page.unmount();
});

test('clearing the query while a request is in flight hides the old hits at once and a late answer cannot bring them back', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  await release(calls[1], answer('gu', [hit(12, 'Gustave')]));
  assert.match(page.text(), /Gustave/);
  await type(page, 'gui');                      // in flight
  await type(page, '');                         // cleared before it answered
  assert.doesNotMatch(page.text(), /Gustave/, 'hits for a query nobody is asking are still shown');
  assert.match(page.text(), /Updating…/);
  const cleared = calls[calls.length - 1];
  assert.equal(cleared.q, '');
  await release(cleared, answer('', []));
  assert.match(page.text(), /Ready to search/);
  await release(calls[2], answer('gui', [hit(11, 'Guillaume')]));   // late
  await page.flush();
  assert.doesNotMatch(page.text(), /Guillaume/, 'a late answer for a cleared query repopulated the branches');
  assert.match(page.text(), /Ready to search/);
  await page.unmount();
});

// ── the contract ────────────────────────────────────────────────────────────

test('nothing below two characters is sent, and the field says why', async () => {
  const { page, calls } = await mount();
  await type(page, 'g');
  assert.equal(calls.length, 1, 'a one-character query was sent');
  assert.match(page.text(), /Type at least 2 characters to search the branches\./);
  await type(page, '   ');
  assert.equal(calls.length, 1, 'a whitespace-only query was sent');
  assert.doesNotMatch(page.text(), /to search the branches\./);
  await page.unmount();
});

test('two characters are sent, trimmed and collapsed', async () => {
  const { page, calls } = await mount();
  await type(page, '  gu  ');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].q, 'gu');
  await type(page, 'hana    lee');
  assert.equal(calls[calls.length - 1].q, 'hana lee');
  await page.unmount();
});

test('the longest query is sent in full; one character more is not sent', async () => {
  const { page, calls } = await mount();
  assert.equal(page.props(page.by('hq-team-search')).maxLength, TEAM_SEARCH_MAX);
  const longest = 'a'.repeat(TEAM_SEARCH_MAX);
  await type(page, longest);
  assert.equal(calls[calls.length - 1].q, longest);
  await type(page, `${longest}a`);
  assert.ok(calls.every((c) => Array.from(c.q).length <= TEAM_SEARCH_MAX), 'an over-limit query was sent');
  assert.equal(calls[calls.length - 1].q, '', 'the over-limit text was truncated or sent instead of asking nobody');
  assert.match(page.text(), new RegExp(`limited to ${TEAM_SEARCH_MAX} characters`));
  await page.unmount();
});

test('a branch unreadable for the current query says so, with a retry that asks for the same query', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  await release(calls[1], answer('gu', [], {
    branches: [{ code: 'es', binding: 'BRANCH_ES', status: 'unreadable', reason: 'binding refused' }],
    branches_coverage: { total: 1, asked: 1, answered: 0, complete: false, unreadable: ['es'], not_deployed: [], not_asked: [] },
  }));
  assert.match(page.text(), /1 branch could not be read for “gu”/);
  assert.doesNotMatch(page.text(), /Nothing on this branch matched/, 'an unreadable branch was reported as empty');
  const before = calls.length;
  // Not `page.click`: the retry IS the read, which this test releases by hand, and `click` waits on the handler.
  const retry = page.nodes().find((n) => n.tagName === 'BUTTON' && /Retry/.test(textOf(n)));
  await act(async () => { void page.props(retry).onClick({ preventDefault() {}, stopPropagation() {} }); });
  assert.equal(calls.length, before + 1);
  assert.equal(calls[calls.length - 1].q, 'gu');
  assert.match(page.text(), /Searching the branches for “gu”…/, 'a retry in flight was announced as a result');
  await release(calls[calls.length - 1], answer('gu', [hit(12, 'Gustave')]));
  assert.match(page.text(), /1 match on the branches for “gu”/);
  await page.unmount();
});

test('an older read finishing while a retry of the same query is in flight does not end the search', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');                                  // read A for "gu"
  await release(calls[1], answer('gu', [hit(12, 'Gustave')]));
  await type(page, 'gui');                                 // read B
  await type(page, 'gu');                                  // read C: "gu" again, B still pending
  await release(calls[3], answer('gu', [hit(12, 'Gustave')]));
  await release(calls[2], answer('gui', [hit(11, 'Guillaume')]));   // B lands late and is ignored
  assert.doesNotMatch(page.text(), /Guillaume/);
  assert.match(page.text(), /1 match on the branches for “gu”/);
  await page.unmount();
});

test('a retry superseded by a second retry does not end the search when it finishes first', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  await release(calls[1], answer('gu', [], {
    branches: [{ code: 'es', binding: 'BRANCH_ES', status: 'unreadable', reason: 'binding refused' }],
    branches_coverage: { total: 1, asked: 1, answered: 0, complete: false, unreadable: ['es'], not_deployed: [], not_asked: [] },
  }));
  const retry = () => page.nodes().find((n) => n.tagName === 'BUTTON' && /Retry/.test(textOf(n)));
  await act(async () => { void page.props(retry()).onClick({ preventDefault() {}, stopPropagation() {} }); });   // R1
  await act(async () => { void page.props(retry()).onClick({ preventDefault() {}, stopPropagation() {} }); });   // R2
  assert.equal(calls.length, 4);
  await release(calls[2], answer('gu', [hit(12, 'Gustave')]));                // R1 lands first and is superseded
  assert.match(page.text(), /Searching the branches for “gu”…/, 'a superseded read ended the search');
  assert.doesNotMatch(page.text(), /Gustave/);
  await release(calls[3], answer('gu', [hit(13, 'Gustav')]));                 // R2
  assert.match(page.text(), /Gustav/);
  assert.match(page.text(), /1 match on the branches for “gu”/);
  await page.unmount();
});

test('a stale empty answer is not read as "nothing matched" for the query that is loading', async () => {
  const { page, calls } = await mount();
  await type(page, 'gu');
  await release(calls[1], answer('gu', []));
  assert.match(page.text(), /Nothing on this branch matched/);
  await type(page, 'gui');                                 // in flight
  assert.doesNotMatch(page.text(), /Nothing on this branch matched/, 'an answer for "gu" was read as the answer for "gui"');
  await release(calls[2], answer('gui', []));
  assert.match(page.text(), /Nothing on this branch matched/);
  await page.unmount();
});

test('view-as asks the scoped branch with the same normalized query', async () => {
  const { page, calls } = await mount({ branch: 'es', setBranch: () => {} });
  assert.equal(calls[0].branch, 'es');
  await type(page, ' g ');
  assert.equal(calls.length, 1, 'view-as sent a one-character query');
  await type(page, '  gu ');
  assert.equal(calls[1].q, 'gu');
  assert.equal(calls[1].branch, 'es');
  await page.unmount();
});

test('local filtering of the HQ roster is immediate and independent of the branch request', async () => {
  const { page, calls } = await mount();
  await act(async () => page.props(page.by('hq-team-search')).onChange({ target: { value: 'zz' } }));
  assert.match(page.text(), /No administrator here matches that/, 'the local filter waited for the debounce');
  assert.equal(calls.length, 1, 'the branch request went out before the debounce');
  await page.unmount();
});

test('the search status is one polite live region tied to the field', async () => {
  const { page } = await mount();
  const region = page.by('hq-team-search-status');
  assert.equal(page.props(region).role, 'status');
  assert.equal(page.props(region)['aria-live'], 'polite');
  assert.equal(page.props(page.by('hq-team-search'))['aria-describedby'], page.props(region).id);
  await page.unmount();
});

// ── the pure policy ─────────────────────────────────────────────────────────

test('the browser\'s policy equals the Worker\'s numbers and its normalization', () => {
  const worker = readFileSync(fileURLToPath(new URL('../../cloudflare-worker/src/util/teamSearch.ts', import.meta.url)), 'utf8');
  assert.match(worker, new RegExp(`TEAM_SEARCH_MIN = ${TEAM_SEARCH_MIN};`));
  assert.match(worker, new RegExp(`TEAM_SEARCH_MAX = ${TEAM_SEARCH_MAX};`));
  assert.deepEqual(normalizeTeamSearch('  hana   lee '), { state: 'asked', query: 'hana lee' });
  assert.deepEqual(normalizeTeamSearch(' a '), { state: 'too_short', query: 'a' });
  assert.deepEqual(normalizeTeamSearch(''), { state: 'none', query: '' });
  assert.equal(normalizeTeamSearch('😀'.repeat(64)).state, 'asked');
  assert.equal(normalizeTeamSearch('😀'.repeat(65)).state, 'too_long');
  assert.equal(branchQueryFor(' gu '), 'gu');
  assert.equal(branchQueryFor('g'), '');
  assert.equal(branchQueryFor('x'.repeat(65)), '');
});

test('searchStatus: hint, pending, result and failure', () => {
  assert.equal(searchStatus({ typed: '', sent: '' }).kind, 'idle');
  assert.equal(searchStatus({ typed: 'g', sent: '' }).kind, 'hint');
  assert.equal(searchStatus({ typed: 'x'.repeat(65), sent: '' }).kind, 'hint');
  assert.equal(searchStatus({ typed: 'gu', sent: 'gu', pending: true, answeredFor: '' }).kind, 'pending');
  assert.equal(searchStatus({ typed: 'gu', sent: 'gu', pending: false, answeredFor: '' }).kind, 'pending', 'a result for another query was announced as this one');
  assert.equal(searchStatus({ typed: 'gu', sent: 'gu', pending: false, answeredFor: 'gu', hits: 1, failed: 0 }).text, '1 match on the branches for “gu”.');
  assert.equal(searchStatus({ typed: 'gu', sent: 'gu', pending: false, answeredFor: 'gu', hits: 0, failed: 2 }).text, '2 branches could not be read for “gu”.');
});
