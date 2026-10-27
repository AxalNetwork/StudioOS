/**
 * D1082 (#2947, part 2 of #2398) — Build in Lovable: the dialog (LV2, LV3),
 * its check before Open in Lovable, the launch opening Lovable in a new tab,
 * LV4's "Opened in Lovable on" row, LV1's button on an experiment row, LV7's
 * beside Add must-have, and the client's four routes per cycle. Every route
 * is stood in for; no test reaches Lovable or the Worker.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_in_lovable_d1082.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { BuildInLovable, BuildInLovableDialog } from '../src/pages/cycles/lovable/BuildInLovable.jsx';
import { LEFT_OUT, OPENS_LINE, countText, openedDay, prototypeLovable, showsEntry } from '../src/pages/cycles/lovable/lovableModel.js';
import { RecordSection } from '../src/pages/cycles/RecordView.jsx';
import { lovableApi } from '../src/lib/api/lovable.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const RECORD = { kind: 'experiment', id: '1' };
const PROMPT = 'Build a one-page landing page for Fieldnote that tests one claim with real visitors.';
const OK = { ok: true, line: 'No personal data found', findings: [] };
const EMAIL = { ok: false, line: 'This prompt contains an email address. Remove it to continue.', findings: [{ kind: 'email', words: 'an email address' }] };

/** A stand-in for the client: each call recorded, each answer given by the test. */
function fakeApi(answers = {}) {
  const calls = [];
  const step = (name) => async (arg) => {
    calls.push([name, arg]);
    const a = answers[name];
    const v = typeof a === 'function' ? a(arg, calls) : a;
    if (v instanceof Error) throw v;
    return v;
  };
  const one = { draft: step('draft'), check: step('check'), launch: step('launch'), launches: step('launches') };
  return { calls, api: { validate: one, build: one } };
}
const DRAFT = { record: RECORD, prompt: PROMPT, prompt_chars: PROMPT.length, max: 4000, left_out: LEFT_OUT, check: OK, last_opened_at: null };

async function mount(node) {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async (ms = 0) => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
  await act(async () => root.render(h(MemoryRouter, null, node)));
  await settle();
  return {
    byId, settle, has: (id) => !!byId(id), text: (id) => text(id ? byId(id) : container), props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id}`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const p = props(byId(id)); await act(async () => { p.onChange({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}
const fakeTab = () => { const tab = { closed: false, opener: 'page', location: { href: '' }, close() { tab.closed = true; } }; return tab; };

// ---------------------------------------------------------------- the model

test('the words and small rules: the opens line, the count, the opened day, which entry draws', () => {
  assert.equal(OPENS_LINE, 'Lovable opens in a new tab with this prompt. Nothing is sent until you press send there. Building uses your own Lovable credits.');
  assert.equal(LEFT_OUT, 'Interview names, quotes and contacts are never included.');
  assert.deepEqual([countText(0), countText(1234), countText(4000)], ['0 / 4,000', '1,234 / 4,000', '4,000 / 4,000']);
  assert.deepEqual([openedDay('2026-10-22 09:12:00'), openedDay(null), openedDay('soon')], ['2026-10-22', null, null]);
  assert.equal(showsEntry({ record: RECORD, can_launch: false, opened_at: null }), false, 'a reader with nothing opened sees nothing');
  assert.equal(showsEntry({ record: RECORD, can_launch: false, opened_at: '2026-10-22 09:12:00' }), true);
  const part = { state: 'ok', project_id: 1, record: { kind: 'prototype', id: '1' }, can_launch: true, opened_at: null };
  assert.deepEqual(prototypeLovable('build', 'prototype-mvp', { parts: { lovable: part } }), { cycle: 'build', project_id: 1, record: part.record, can_launch: true, opened_at: null });
  assert.equal(prototypeLovable('build', 'product-roadmap', { parts: { lovable: part } }), null);
  assert.equal(prototypeLovable('validate', 'prototype-mvp', { parts: { lovable: part } }), null);
  assert.equal(prototypeLovable('build', 'prototype-mvp', { parts: {} }), null);
});

// ---------------------------------------------------------------- the dialog

test('LV2: the drafted prompt, editable, with its count, the Left out line and the PII row; Open waits for a passed check', async () => {
  const { api, calls } = fakeApi({ draft: DRAFT, check: (arg) => ({ prompt_chars: arg.prompt.length, check: /@/.test(arg.prompt) ? EMAIL : OK }) });
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, onClose() {} }));
  try {
    assert.deepEqual(calls[0], ['draft', { project_id: 1, record: RECORD }]);
    assert.equal(v.text('lovable-opens-line'), OPENS_LINE);
    assert.equal(v.props('lovable-prompt').value, PROMPT);
    assert.equal(v.text('lovable-count'), countText(PROMPT.length));
    assert.equal(v.text('lovable-left-out'), LEFT_OUT);
    assert.equal(v.text('lovable-check'), 'No personal data found');
    assert.equal(v.props('lovable-open').disabled, false, 'the draft passed its own check');
    await v.type('lovable-prompt', `${PROMPT} Write to ana@clinic.example`);
    assert.equal(v.props('lovable-open').disabled, true, 'an edit not yet checked cannot be opened');
    await v.settle(120);
    assert.deepEqual(calls.at(-1), ['check', { project_id: 1, prompt: `${PROMPT} Write to ana@clinic.example` }]);
    assert.equal(v.text('lovable-check'), 'This prompt contains an email address. Remove it to continue.');
    assert.equal(v.props('lovable-check')['data-state'], 'refused');
    assert.equal(v.props('lovable-open').disabled, true, 'a failed check keeps Open disabled');
    await v.type('lovable-prompt', `${PROMPT} Keep it calm.`);
    await v.settle(120);
    assert.equal(v.text('lovable-check'), 'No personal data found');
    assert.equal(v.props('lovable-open').disabled, false);
  } finally { await v.close(); }
});

test('LV3: over 4,000 characters, an empty prompt, or a check that fails to run each keep Open disabled', async () => {
  const { api, calls } = fakeApi({ draft: DRAFT, check: () => new Error('offline') });
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, onClose() {} }));
  try {
    await v.type('lovable-prompt', 'x'.repeat(4001));
    await v.settle(120);
    assert.equal(v.text('lovable-count'), '4,001 / 4,000');
    assert.ok(v.has('lovable-over'));
    assert.equal(v.props('lovable-open').disabled, true);
    assert.ok(!calls.some(([k]) => k === 'check'), 'an over-long prompt is not sent to be checked');
    await v.type('lovable-prompt', '   ');
    await v.settle(120);
    assert.equal(v.props('lovable-open').disabled, true);
    await v.type('lovable-prompt', 'Build a page.');
    await v.settle(120);
    assert.equal(v.props('lovable-check')['data-state'], 'error');
    assert.equal(v.props('lovable-open').disabled, true, 'an unread check is never a pass');
  } finally { await v.close(); }
});

test('Open in Lovable: the tab opens on the press, the launch is recorded once, and the tab goes to the Worker’s link', async () => {
  const url = `https://lovable.dev/#prompt=${encodeURIComponent(PROMPT)}`;
  const { api, calls } = fakeApi({ draft: DRAFT, launch: { url, handoff: { uid: 'h1', opened_at: '2026-10-22 09:12:00' } } });
  const tab = fakeTab();
  const order = [];
  const opened = [];
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, onClose() {}, onOpened: (at) => opened.push(at),
    openTab: () => { order.push('tab'); return tab; } }));
  const launch = api.validate.launch;
  api.validate.launch = async (arg) => { order.push('launch'); return launch(arg); };
  try {
    await v.click('lovable-open');
    assert.deepEqual(order, ['tab', 'launch'], 'the tab is opened on the press, before the request, so it is not blocked');
    assert.deepEqual(calls.filter(([k]) => k === 'launch'), [['launch', { project_id: 1, record: RECORD, prompt: PROMPT }]]);
    assert.equal(tab.location.href, url);
    assert.equal(tab.opener, null, 'Lovable gets no handle on this page');
    assert.deepEqual(opened, ['2026-10-22 09:12:00']);
    assert.match(v.text('lovable-opened'), /Opened in Lovable\. Press send there to start building\./);
    assert.ok(!v.has('lovable-open'), 'one press, one handoff');
  } finally { await v.close(); }
});

test('a refused launch closes the tab, shows the Worker’s sentence and its check; a blocked tab leaves a link to open', async () => {
  const refusal = Object.assign(new Error('This prompt contains an email address. Remove it to continue. Nothing was opened.'), { code: 'pii_found', data: { check: EMAIL } });
  const { api } = fakeApi({ draft: DRAFT, launch: refusal });
  const tab = fakeTab();
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, onClose() {}, openTab: () => tab }));
  try {
    await v.click('lovable-open');
    assert.equal(tab.closed, true);
    assert.equal(v.text('lovable-launch-error'), 'This prompt contains an email address. Remove it to continue. Nothing was opened.');
    assert.equal(v.props('lovable-check')['data-state'], 'refused');
    assert.equal(v.props('lovable-open').disabled, true);
  } finally { await v.close(); }
  const url = 'https://lovable.dev/#prompt=x';
  const ok = fakeApi({ draft: DRAFT, launch: { url, handoff: { uid: 'h2', opened_at: '2026-10-22 09:12:00' } } });
  const b = await mount(h(BuildInLovableDialog, { cycle: 'build', projectId: 1, record: { kind: 'prototype', id: '1' }, api: ok.api, onClose() {}, openTab: () => null }));
  try {
    await b.click('lovable-open');
    assert.equal(b.props('lovable-open-link').href, url);
    assert.equal(b.props('lovable-open-link').rel, 'noopener noreferrer');
  } finally { await b.close(); }
});

test('a draft that cannot be read says so with Try again, and opens nothing', async () => {
  let fail = true;
  const { api } = fakeApi({ draft: () => (fail ? new Error('The prompt could not be drafted just now.') : DRAFT) });
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, onClose() {} }));
  try {
    assert.match(v.text('lovable-unreadable'), /The prompt could not be drafted just now\.Try again/);
    assert.equal(v.props('lovable-open').disabled, true);
    fail = false;
    await v.click('lovable-retry');
    assert.equal(v.props('lovable-prompt').value, PROMPT);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- LV1, LV4, LV7

test('LV1 and LV4: an experiment row carries Build in Lovable for a writer on a Planned row, and “Opened in Lovable on [date]”', async () => {
  const section = { key: 'experiments', title: 'Experiments', rows: [
    { a: 'Demo landing page', b: 'Ads', c: 'Planned', tone: 'grey', lovable: { cycle: 'validate', project_id: 1, record: RECORD, can_launch: true, opened_at: null } },
    { a: 'Second test', b: '', c: 'Done', tone: 'ok', lovable: { cycle: 'validate', project_id: 1, record: { kind: 'experiment', id: '2' }, can_launch: false, opened_at: '2026-10-22 09:12:00' } },
    { a: 'Third', b: '', c: 'Running', tone: 'v1', lovable: { cycle: 'validate', project_id: 1, record: { kind: 'experiment', id: '3' }, can_launch: false, opened_at: null } },
  ] };
  const v = await mount(h(RecordSection, { section }));
  try {
    const all = v.text();
    assert.equal((all.match(/Build in Lovable/g) || []).length, 1, 'only the writer’s Planned row');
    assert.match(all, /Second test.*Opened in Lovable on 2026-10-22/s);
    assert.doesNotMatch(all, /Third.*Opened/s);
  } finally { await v.close(); }
  const { api } = fakeApi({ draft: DRAFT, launch: { url: 'https://lovable.dev/#prompt=x', handoff: { uid: 'h3', opened_at: '2026-10-23 10:00:00' } } });
  const one = await mount(h(BuildInLovable, { lovable: section.rows[0].lovable, api, openTab: fakeTab }));
  try {
    await one.click('lovable-build');
    assert.ok(one.has('lovable-dialog'));
    await one.click('lovable-open');
    await one.click('lovable-cancel');
    assert.ok(!one.has('lovable-dialog'));
    assert.equal(one.text('lovable-opened-on'), 'Opened in Lovable on 2026-10-23', 'the row says it at once, without a reload');
  } finally { await one.close(); }
});

test('the wiring: LV7 beside Add must-have, the phone sheet, the client’s routes, one api.js line, and nothing calls lovable.dev', async () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /lovable=\{narrativeAdmin \? undefined : prototypeLovable\(cycle, slug, module\)\}/);
  assert.match(read('frontend/src/pages/cycles/CycleModulePage.jsx'), /\{lovable && <BuildInLovable lovable=\{lovable\} \/>\}<\/div>/);
  assert.match(read('frontend/src/pages/cycles/PhoneModulePage.jsx'), /\{lovable && <div className="mt-3 flex justify-center"><BuildInLovable lovable=\{lovable\} \/><\/div>\}/);
  assert.match(read('frontend/src/pages/cycles/lovable/BuildInLovable.jsx'), /flex h-full w-full flex-col[^"]*sm:h-auto/, 'LV8a: full height on the phone');
  assert.equal((read('frontend/src/lib/api.js').match(/export \* from '\.\/api\/lovable\.js';/g) || []).length, 1);
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk(resolve(process.cwd(), 'frontend/src'))) {
    if (!/\.(jsx?|mjs)$/.test(f)) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /fetch\([^)]*lovable\.dev/, `${f} fetches Lovable`);
  }
  const restore = installDocument();
  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => { seen.push([String(url), init.method || 'GET', init.body]); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const b = { project_id: 1, record: RECORD, prompt: 'p' };
    for (const cycle of ['validate', 'build']) {
      await lovableApi[cycle].draft(b); await lovableApi[cycle].check(b); await lovableApi[cycle].launch(b); await lovableApi[cycle].launches(1);
    }
    assert.deepEqual(seen.map(([u, m]) => `${m} ${u}`), [
      'POST /api/cycles/validate/lovable/draft', 'POST /api/cycles/validate/lovable/check', 'POST /api/cycles/validate/lovable/launch', 'GET /api/cycles/validate/lovable/launches?project=1',
      'POST /api/cycles/build/lovable/draft', 'POST /api/cycles/build/lovable/check', 'POST /api/cycles/build/lovable/launch', 'GET /api/cycles/build/lovable/launches?project=1',
    ]);
    assert.equal(seen[2][2], JSON.stringify(b));
  } finally { globalThis.fetch = prev; restore(); }
});
