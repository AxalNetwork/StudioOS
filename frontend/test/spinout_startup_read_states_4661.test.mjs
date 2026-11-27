// #4661: the Startup page tells a failed read from an empty one. The real page is mounted; only the
// network is stubbed. "No startup record yet" and its Create prompt follow only a successful empty read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import SpinoutLabStartupPage from '../src/pages/SpinoutLabStartupPage.jsx';

const STATE = { active: true, admitted: true, week: 1, is_incorporated: false, milestones: [], application: { status: 'accepted', decided_at: '2026-10-01 10:00:00' } };
const PROJECT = { id: 3, name: 'Synthetic Robotics', founder_id: null, track_type: 'spin_out', sector: 'Robotics', description: 'A synthetic description.', created_at: '2026-10-02 10:00:00' };
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const down = () => Promise.reject(new TypeError('network down'));

function network(handlers) {
  const before = globalThis.fetch;
  const log = [];
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    const key = `${opts.method || 'GET'} ${path.split('?')[0]}`;
    log.push(key);
    const handler = handlers[key];
    return handler ? handler() : reply({}, 404);
  };
  return { log, restore: () => { globalThis.fetch = before; } };
}

async function mountStartup(handlers) {
  const net = network(handlers);
  const m = await mountForm(h(SpinoutLabStartupPage));
  const settle = async () => { await m.flush(); await m.flush(); };
  await settle();
  const press = async (id) => { const node = m.by(id); assert.ok(node, `no ${id}`); await act(async () => propsOf(node).onClick?.({ preventDefault() {} })); await settle(); };
  return { m, net, press, settle, count: (k) => net.log.filter((l) => l === k).length, async close() { await m.unmount(); net.restore(); } };
}

test('a failed projects read is unreadable, never "No startup record yet", and its Create prompt is not offered', async () => {
  const t = await mountStartup({ 'GET /spinout-lab/state': () => reply(STATE), 'GET /projects': down });
  try {
    assert.ok(t.m.by('startup-record-unreadable'), 'the failed read says so');
    assert.equal(t.m.by('startup-empty'), undefined, 'not drawn as an empty list');
    assert.equal(t.m.by('link-create-record'), undefined, 'no prompt to create what may already exist');
    assert.match(t.m.text(), /This is not a statement that you have none/);
    assert.ok(t.m.by('startup-identity'), 'the rest of the page still draws');
  } finally { await t.close(); }
});

test('a successful empty projects read does offer the Create prompt', async () => {
  const t = await mountStartup({ 'GET /spinout-lab/state': () => reply(STATE), 'GET /projects': () => reply([]) });
  try {
    assert.ok(t.m.by('startup-empty'));
    assert.ok(t.m.by('link-create-record'));
    assert.equal(t.m.by('startup-record-unreadable'), undefined);
  } finally { await t.close(); }
});

const within = (node) => { const out = []; const walk = (n) => { out.push(n); (n.childNodes || []).forEach(walk); }; walk(node); return out; };
const retryIn = (m, id) => { const root = m.by(id); assert.ok(root, `no ${id}`); return within(root).find((n) => n.tagName === 'BUTTON' && /retry/i.test(textOf(n))); };

test('retrying the projects read re-reads only the projects, and a recovered read draws the record', async () => {
  let projectReads = 0;
  const t = await mountStartup({
    'GET /spinout-lab/state': () => reply(STATE),
    'GET /projects': () => { projectReads += 1; return projectReads === 1 ? down() : reply([PROJECT]); },
  });
  try {
    assert.ok(t.m.by('startup-record-unreadable'));
    const button = retryIn(t.m, 'startup-record-unreadable');
    assert.ok(button, 'the unreadable record offers a retry');
    await act(async () => propsOf(button).onClick({ preventDefault() {} })); await t.settle();
    assert.equal(t.count('GET /projects'), 2, 'the projects were asked again');
    assert.equal(t.count('GET /spinout-lab/state'), 1, 'the state was not');
    assert.equal(t.m.by('startup-record-unreadable'), undefined);
    assert.equal(t.m.by('startup-empty'), undefined, 'a recovered read is not an empty one');
    assert.match(t.m.text(), /Synthetic Robotics/, 'the record is drawn');
  } finally { await t.close(); }
});

test('a failed state read keeps the projects that were read, and its retry re-reads only the state', async () => {
  let stateReads = 0;
  const t = await mountStartup({
    'GET /spinout-lab/state': () => { stateReads += 1; return stateReads === 1 ? down() : reply(STATE); },
    'GET /projects': () => reply([PROJECT]),
  });
  try {
    assert.ok(t.m.by('startup-error'), 'the page cannot draw without the Lab state');
    assert.equal(t.m.by('startup-empty'), undefined);
    await t.press('button-retry-startup');
    assert.equal(t.count('GET /spinout-lab/state'), 2, 'the state was asked again');
    assert.equal(t.count('GET /projects'), 1, 'the projects that had been read were not asked again');
    assert.equal(t.m.by('startup-error'), undefined);
    assert.match(t.m.text(), /Synthetic Robotics/, 'the earlier projects read is on the page');
  } finally { await t.close(); }
});

test('a good projects read draws the record and is not drawn as unreadable or empty', async () => {
  let projectReads = 0;
  const t = await mountStartup({
    'GET /spinout-lab/state': () => reply(STATE),
    'GET /projects': () => { projectReads += 1; return reply([PROJECT]); },
  });
  try {
    assert.match(t.m.text(), /Synthetic Robotics/);
    assert.equal(t.m.by('startup-record-unreadable'), undefined, 'a good read is not unreadable');
    assert.equal(t.m.by('startup-empty'), undefined, 'and not empty');
    assert.equal(projectReads, 1);
  } finally { await t.close(); }
});
