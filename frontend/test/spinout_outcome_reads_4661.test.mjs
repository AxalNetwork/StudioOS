// #4661: the public graduates list tells a failed read from an empty one. The real section is mounted; only the
// network is stubbed. "No graduates yet." follows only a successful empty read; a failed read says it is not a
// statement that there are none, and offers a retry that reads again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import { GraduatesSection } from '../src/pages/SpinoutLabPage.jsx';

const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const REFUSED = () => reply({ error: 'lab_outcomes_unreadable', message: 'The Lab’s graduates could not be read just now. Try again in a moment.' }, 503);
const GRADUATE = { name: 'Synthetic Robotics', sector: 'Robotics', stage: 'Seed', cohort: '2026-10', uid: null, graduated_at: '2026-10-28 10:00:00', raised: null, last_round: null };

async function mountGraduates(read) {
  const before = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('/spinout-lab/graduates')) return reply({}, 404);
    reads += 1;
    return read(reads);
  };
  const m = await mountForm(h(GraduatesSection));
  const settle = async () => { await m.flush(); await m.flush(); };
  await settle();
  return { m, settle, reads: () => reads, async close() { await m.unmount(); globalThis.fetch = before; } };
}

test('a failed read is unreadable, never "No graduates yet.", and a retry reads again', async () => {
  const t = await mountGraduates((n) => (n === 1 ? REFUSED() : reply([])));
  try {
    assert.ok(t.m.by('graduates-unreadable'), 'the failed read says so');
    assert.match(t.m.text(), /This is not a statement that there are none/);
    assert.equal(t.m.by('graduates-empty'), undefined, 'not drawn as an empty list');
    assert.doesNotMatch(t.m.text(), /No graduates yet/);
    const retry = t.m.by('graduates-retry');
    assert.ok(retry, 'a retry is offered');
    await act(async () => propsOf(retry).onClick({ preventDefault() {} })); await t.settle();
    assert.equal(t.reads(), 2, 'the retry asked again');
    assert.equal(t.m.by('graduates-unreadable'), undefined);
    assert.ok(t.m.by('graduates-empty'), 'a read that worked and found no one is the empty state');
    assert.match(t.m.text(), /No graduates yet/);
  } finally { await t.close(); }
});

test('a rejected transport is unreadable too, and a recovered read draws the graduates', async () => {
  const t = await mountGraduates((n) => (n === 1 ? Promise.reject(new TypeError('network down')) : reply([GRADUATE])));
  try {
    assert.ok(t.m.by('graduates-unreadable'));
    assert.equal(t.m.by('graduates-empty'), undefined);
    await act(async () => propsOf(t.m.by('graduates-retry')).onClick({ preventDefault() {} })); await t.settle();
    assert.equal(t.m.by('graduates-unreadable'), undefined);
    assert.match(t.m.text(), /Synthetic Robotics/);
    assert.doesNotMatch(t.m.text(), /No graduates yet/);
  } finally { await t.close(); }
});
