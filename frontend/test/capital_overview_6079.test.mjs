/** D6079 (#6079): Overview blocks render their own read states, retry only their source and never invent zero. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { CapRelOverviewBlocks } from '../src/pages/raise/caprel/CapRelOverview.jsx';
import { overviewPart } from '../src/pages/raise/caprel/capRelModel.js';

const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const answer = {
  meetings: { state: 'ok', items: [{ id: 1, prospect_id: 1, name: 'Example Fund', kind: 'meeting', starts_at: '2027-01-01T09:00:00Z' }] },
  activity: { state: 'ok', items: [{ id: 2, at: '2026-11-19', what: 'Investor added' }] },
  fit: { state: 'ok', counts: { fits: 1, outside: 0, unclear: 0, not_recorded: 0 }, total: 1, source: 'Served fund focus against the venture sector' },
  history: { state: 'not_recorded', reason: 'History coverage is not recorded.' },
};

test('new sources render real evidence, isolate an unreadable source and retry only that source', async () => {
  const restore = installDocument();
  const originalFetch = globalThis.fetch;
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  const calls = [];
  let releaseMeetings;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://local'); calls.push(url);
    if (url.searchParams.get('part') === 'meetings') return new Promise((resolve) => { releaseMeetings = () => resolve(json({ meetings: answer.meetings })); });
    return json(url.searchParams.has('part') ? { fit: answer.fit } : { ...answer, meetings: { state: 'unreadable', reason: 'Meeting source unavailable.' }, fit: { state: 'unreadable', reason: 'Fund source unavailable.' } });
  };
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const words = (n) => n?.childNodes?.length ? n.childNodes.map(words).join(' ') : n?.textContent || '';
  const by = (key) => nodes().find((n) => props(n)['data-testid'] === `caprel-ov-${key}`);
  async function until(check) {
    for (let i = 0; i < 100; i += 1) {
      if (check()) return;
      await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    }
    assert.fail('Overview condition never appeared');
  }
  try {
    const home = { prospects: { status: 'ready', items: [{ id: 1, name: 'Example Fund', stage: 'meeting' }], reload() {} }, commitments: { status: 'ready', data: { totals: { counted_cents: 0 } }, reload() {} } };
    await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(CapRelOverviewBlocks, { projectId: 101, home, today: '2026-11-19', search: '?project_id=101' }))));
    await until(() => props(by('fit'))['data-state'] === 'unreadable');
    assert.equal(props(by('meetings'))['data-state'], 'unreadable');
    assert.match(words(by('activity')), /Investor added/);
    assert.match(words(by('history')), /Not recorded.*History coverage/);
    assert.doesNotMatch(words(by('fit')), /Fits\s*:\s*0/);
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const meetingsRetry = walk(by('meetings')).find((n) => n.tagName === 'BUTTON');
    assert.ok(meetingsRetry);
    await act(async () => props(meetingsRetry).onClick());
    const retry = walk(by('fit')).find((n) => n.tagName === 'BUTTON');
    assert.ok(retry);
    await act(async () => props(retry).onClick());
    await until(() => props(by('fit'))['data-state'] === 'ok');
    assert.match(words(by('fit')), /Fits\s*:\s*1/);
    await act(async () => releaseMeetings());
    await until(() => props(by('meetings'))['data-state'] === 'ok');
    assert.match(words(by('meetings')), /Example Fund/);
    assert.deepEqual(calls.map((u) => u.searchParams.get('part')), [null, 'meetings', 'fit']);
  } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; restore(); }
});

test('malformed reads never become zero counts; explicit empty and refusal stay distinct', () => {
  assert.equal(overviewPart('fit', { state: 'ok', counts: {} }).state, 'unreadable');
  assert.equal(overviewPart('meetings', { state: 'ok', items: [] }).state, 'ok');
  assert.equal(overviewPart('activity', { state: 'refused', reason: 'Access refused' }).state, 'refused');
});
