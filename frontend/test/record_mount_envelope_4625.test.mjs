/**
 * D4625 (#4625) — RecordMount reads the Worker's real `{ project_id, interviews }`
 * envelope, opens the requested interview, and never silently falls into the
 * new-person flow.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_mount_envelope_4625.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { RecordMount } from '../src/pages/cycles/CycleRoute.jsx';
import { interviewListOf, interviewsOf } from '../src/lib/discoveryEvidence.js';

const h = React.createElement;
const MODELS = {
  live: [{ model: 'nova', label: 'Nova-3 live', price_usd_per_minute: 0.0092, choosable: true }],
  final: [{ model: 'whisper', label: 'Whisper', price_usd_per_minute: 0.0005, choosable: true }],
  defaults: { live: 'nova', final: 'whisper' },
  languages: [{ code: 'en', name: 'English' }],
};
const BOARD = { hypotheses: [] };
const envelope = (projectId, interviews) => ({ project_id: projectId, interviews });
const DANA = { id: 7, interviewee_name: 'Dana Ruiz', interviewee_company: 'Acme', project_id: 3, stage: 'booked' };

function spies(read) {
  const calls = { create: [], open: [], read: [] };
  return {
    calls,
    props: {
      projectId: 3, interviewId: '7', onClose() {}, onStarted() {},
      read: async (pid) => { calls.read.push(pid); return read(pid); },
      lightboxProps: {
        initialModels: MODELS, initialBoard: BOARD,
        api: { createInterview: async () => ({ id: 41 }), deleteInterview: async () => {}, getValidationBoard: async () => BOARD },
        sessions: {
          models: async () => MODELS,
          create: async (id, body) => { calls.create.push([id, body]); return { session: { id: 501, interview_id: id } }; },
          open: async (body) => { calls.open.push(body); return { session: { id: 502, interview_id: 41 }, interview: { id: 41, project_id: 3, stage: 'booked' } }; },
        },
        channelsSource: { overview: async () => { throw new Error('unread'); }, threads: async () => ({ items: [] }), assign: async () => ({ ok: true }) },
        cycle: { module: async () => ({ records: { rows: [] } }), setInterviewStage: async () => ({}) },
      },
    },
  };
}

async function mount(props) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const draw = (p) => act(async () => { root.render(h(MemoryRouter, null, h(RecordMount, p))); });
  await draw(props);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, pr, draw, text: () => text(container).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); },
    async type(id, value) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const consent = async (m) => { await m.click('record-consents-verbal'); };

test('the decoder: the envelope, a bare list, and a malformed answer that is a failure, not an empty list', () => {
  assert.deepEqual(interviewListOf(envelope(3, [DANA])), [DANA]);
  assert.deepEqual(interviewListOf([DANA]), [DANA]);
  assert.equal(interviewListOf({ project_id: 3 }), null);
  assert.equal(interviewListOf(null), null);
  assert.equal(interviewsOf({ ok: true, data: { nope: 1 } }).length, 0);
});

test('the real envelope: the requested interview is selected, Who is pre-filled, and Start attaches to it', async () => {
  const s = spies(() => envelope(3, [{ id: 6, interviewee_name: 'Other' }, DANA]));
  const m = await mount(s.props);
  try {
    assert.ok(m.by('record-lightbox'), 'the lightbox opened');
    assert.match(m.text(), /Dana Ruiz/);
    assert.equal(s.calls.read.length, 1);
    await consent(m);
    await m.click('record-start');
    assert.equal(s.calls.open.length, 0, 'not the new-person call');
    assert.equal(s.calls.create.length, 1);
    assert.equal(s.calls.create[0][0], 7, 'the original interview id is submitted');
  } finally { await m.unmount(); }
});

test('an unreadable read is retryable and never becomes the new-person flow', async () => {
  let fail = true;
  const s = spies(() => { if (fail) throw new Error('network'); return envelope(3, [DANA]); });
  const m = await mount(s.props);
  try {
    assert.ok(m.by('record-unavailable-message'));
    assert.equal(m.by('record-lightbox'), undefined);
    assert.equal(m.by('record-unavailable-new'), undefined, 'no way into new-person from a failed read');
    assert.match(m.text(), /Nothing was recorded/);
    fail = false;
    await m.click('record-unavailable-retry');
    assert.ok(m.by('record-lightbox'));
    assert.match(m.text(), /Dana Ruiz/);
    assert.equal(s.calls.open.length + s.calls.create.length, 0);
  } finally { await m.unmount(); }
});

test('a malformed answer is the same failed read', async () => {
  const s = spies(() => ({ project_id: 3 }));
  const m = await mount(s.props);
  try {
    assert.ok(m.by('record-unavailable-retry'));
    assert.equal(m.by('record-lightbox'), undefined);
  } finally { await m.unmount(); }
});

test('a missing or out-of-scope interview is said so; new-person only on an explicit choice', async () => {
  const s = spies(() => envelope(3, [{ id: 6, interviewee_name: 'Other' }]));
  const m = await mount(s.props);
  try {
    assert.match(m.text(), /not in this venture, or you cannot open it/);
    assert.equal(m.by('record-lightbox'), undefined);
    assert.equal(m.by('record-unavailable-retry'), undefined);
    await m.click('record-unavailable-new');
    assert.ok(m.by('record-lightbox'));
    assert.doesNotMatch(m.text(), /Other/);
    await m.type('record-name', 'Eve Chen');
    await consent(m);
    await m.click('record-start');
    assert.equal(s.calls.create.length, 0);
    assert.equal(s.calls.open.length, 1);
  } finally { await m.unmount(); }
});

test('an intentional new person asks for no interview and reads nothing', async () => {
  const s = spies(() => { throw new Error('must not read'); });
  const m = await mount({ ...s.props, interviewId: null });
  try {
    assert.ok(m.by('record-lightbox'));
    assert.equal(s.calls.read.length, 0);
    await m.type('record-name', 'Eve Chen');
    await consent(m);
    await m.click('record-start');
    assert.equal(s.calls.create.length, 0);
    assert.equal(s.calls.open.length, 1);
    assert.equal(s.calls.open[0].interview_id, undefined);
  } finally { await m.unmount(); }
});

test('switching interview while a read is in flight never applies the earlier result', async () => {
  const gates = {};
  const s = spies((pid) => new Promise((res) => { gates[`${pid}`] = res; }));
  const m = await mount(s.props); // interview 7, read pending
  try {
    const firstGate = gates['3'];
    s.props.read = undefined;
    const seen = [];
    const slow = (resolve) => seen.push(resolve);
    await m.draw({ ...s.props, interviewId: '8', read: () => new Promise(slow) });
    // the first read (for 7) resolves late, after the switch
    await act(async () => { firstGate(envelope(3, [DANA])); });
    assert.equal(m.by('record-lightbox'), undefined, 'the stale answer for 7 is not shown for 8');
    await act(async () => { seen[0](envelope(3, [{ id: 8, interviewee_name: 'Hal Moss' }])); });
    assert.match(m.text(), /Hal Moss/);
    assert.doesNotMatch(m.text(), /Dana Ruiz/);
  } finally { await m.unmount(); }
});
