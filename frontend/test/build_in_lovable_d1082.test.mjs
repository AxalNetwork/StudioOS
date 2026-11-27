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
import {
  ANNOUNCE_OK, BRING_BACK, CHECKS, CHECK_OK, DRAFTED_LINE, ENTRY_LABEL, LEFT_OUT, MEMBER_CHECK, NOT_COVERED, OPENS_LINE, REVIEW, SEND_CHECKS, SEND_CHECK_OK, SEND_NOT_COVERED,
  changedLines, checkTime, countText, dialogHead, exactCount, lineDiff, linesLabel, namesVenture, openedDay, prototypeLovable, showsEntry, testsRows,
} from '../src/pages/cycles/lovable/lovableModel.js';
import { RecordSection } from '../src/pages/cycles/RecordView.jsx';
import { lovableApi } from '../src/lib/api/lovable.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const RECORD = { kind: 'experiment', id: '1' };
const PROMPT = 'Build a one-page landing page for Fieldnote that tests one claim with real visitors.';
const OK = { ok: true, line: 'No personal data found', findings: [], advisories: [], checked_at: '2026-11-26T14:31:00.000Z' };
const EMAIL = { ok: false, line: 'This prompt contains an email address, in line 1. Remove it to continue.', findings: [{ kind: 'email', words: 'an email address', lines: [1] }], advisories: [], checked_at: '2026-11-26T14:32:00.000Z' };

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
const TESTS = { code: 'H2', claim: 'Small clinics will join a waitlist for same-day invoice reconciliation.', title: 'Landing page test', target: '40 sign-ups' };
const DRAFT = { record: RECORD, prompt: PROMPT, prompt_chars: PROMPT.length, max: 4000, left_out: LEFT_OUT, check: OK, last_opened_at: null, tests: TESTS };

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
  // The owner's re-export (Lovable Page.dc.html, D1311 §3).
  assert.equal(OPENS_LINE, 'Lovable opens in a new tab with this prompt. You build there, with your own Lovable account.');
  assert.equal(LEFT_OUT, 'Interview names, quotes and contacts are never included.');
  assert.deepEqual([countText(0), countText(1234), countText(4000)], ['0 / 4,000', '1,234 / 4,000', '4,000 / 4,000']);
  assert.deepEqual([openedDay('2026-10-22 09:12:00'), openedDay(null), openedDay('soon')], ['2026-10-22', null, null]);
  assert.equal(showsEntry({ record: RECORD, can_launch: false, opened_at: null }), false, 'a reader with nothing opened sees nothing');
  assert.equal(showsEntry({ record: RECORD, can_launch: false, opened_at: '2026-10-22 09:12:00' }), true);
  const part = { state: 'ok', project_id: 1, record: { kind: 'prototype', id: '1' }, can_launch: true, opened_at: null };
  assert.deepEqual(prototypeLovable('build', 'prototype-mvp', { parts: { lovable: { state: 'ok', slots: [], launch: part } } }), { cycle: 'build', project_id: 1, record: part.record, can_launch: true, opened_at: null });
  assert.equal(prototypeLovable('build', 'product-roadmap', { parts: { lovable: { state: 'ok', slots: [], launch: part } } }), null);
  assert.equal(prototypeLovable('validate', 'prototype-mvp', { parts: { lovable: { state: 'ok', slots: [], launch: part } } }), null);
  assert.equal(prototypeLovable('build', 'prototype-mvp', { parts: {} }), null);
});

// ---------------------------------------------------------------- the dialog

test('LV2: the drafted prompt, editable, with its count, the Left out line and the PII row; Review waits for a passed check', async () => {
  const { api, calls } = fakeApi({ draft: DRAFT, check: (arg) => ({ prompt_chars: arg.prompt.length, check: /@/.test(arg.prompt) ? EMAIL : OK }) });
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, onClose() {} }));
  try {
    assert.deepEqual(calls[0], ['draft', { project_id: 1, record: RECORD }]);
    assert.equal(v.text('lovable-opens-line'), OPENS_LINE);
    assert.equal(v.props('lovable-prompt').value, PROMPT);
    assert.equal(v.text('lovable-count'), countText(PROMPT.length));
    assert.equal(v.text('lovable-check-line'), CHECK_OK);
    assert.equal(v.props('lovable-review-go').disabled, false, 'the draft passed its own check');
    await v.type('lovable-prompt', `${PROMPT} Write to ana@clinic.example`);
    assert.equal(v.props('lovable-review-go').disabled, true, 'an edit not yet checked cannot be reviewed');
    await v.settle(120);
    assert.deepEqual(calls.at(-1), ['check', { project_id: 1, prompt: `${PROMPT} Write to ana@clinic.example` }]);
    assert.equal(v.text('lovable-check-line'), 'This prompt contains an email address, in line 1. Remove it to continue.');
    assert.equal(v.props('lovable-check')['data-state'], 'refused');
    assert.equal(v.props('lovable-review-go').disabled, true, 'a failed check keeps Review off');
    assert.equal(v.text('lovable-review-why'), 'Remove what the check found to continue. Nothing has left Axal VC.');
    await v.type('lovable-prompt', `${PROMPT} Keep it calm.`);
    await v.settle(120);
    assert.equal(v.text('lovable-check-line'), CHECK_OK);
    assert.equal(v.props('lovable-review-go').disabled, false);
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
    assert.equal(v.props('lovable-review-go').disabled, true);
    assert.ok(!calls.some(([k]) => k === 'check'), 'an over-long prompt is not sent to be checked');
    await v.type('lovable-prompt', '   ');
    await v.settle(120);
    assert.equal(v.props('lovable-review-go').disabled, true);
    await v.type('lovable-prompt', 'Build a page.');
    await v.settle(120);
    assert.equal(v.props('lovable-check')['data-state'], 'error');
    assert.equal(v.props('lovable-review-go').disabled, true, 'an unread check is never a pass');
    // D8773: Unavailable offers Check again, which asks the Worker once more.
    const before = calls.filter(([k]) => k === 'check').length;
    await v.click('lovable-check-again');
    await v.settle(120);
    assert.equal(calls.filter(([k]) => k === 'check').length, before + 1);
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
    assert.ok(!v.has('lovable-open'), 'Prepare sends nothing: Open is on Review');
    await v.click('lovable-review-go');
    assert.equal(order.length, 0, 'reviewing opens nothing and asks nothing');
    await v.click('lovable-open');
    assert.deepEqual(order, ['tab', 'launch'], 'the tab is opened on the press, before the request, so it is not blocked');
    assert.deepEqual(calls.filter(([k]) => k === 'launch'), [['launch', { project_id: 1, record: RECORD, prompt: PROMPT }]]);
    assert.equal(tab.location.href, url);
    assert.equal(tab.opener, null, 'Lovable gets no handle on this page');
    assert.deepEqual(opened, ['2026-10-22 09:12:00']);
    assert.match(v.text('lovable-opened'), /^Opened Lovable in a new tab\. Nothing is built until you press send there\./);
    assert.equal(v.text('lovable-live'), 'Opened Lovable in a new tab. Nothing is built until you press send there.');
    assert.ok(!v.has('lovable-open'), 'one press, one handoff');
  } finally { await v.close(); }
});

test('a refused launch closes the tab, shows the Worker’s sentence and its check; a blocked tab leaves a link to open', async () => {
  const refusal = Object.assign(new Error('This prompt contains an email address, in line 1. Remove it to continue. Nothing was opened.'), { code: 'pii_found', data: { check: EMAIL } });
  const { api } = fakeApi({ draft: DRAFT, launch: refusal });
  const tab = fakeTab();
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, onClose() {}, openTab: () => tab }));
  try {
    await v.click('lovable-review-go');
    await v.click('lovable-open');
    assert.equal(tab.closed, true);
    assert.equal(v.text('lovable-launch-error'), 'This prompt contains an email address, in line 1. Remove it to continue. Nothing was opened.');
    assert.equal(v.props('lovable-open').disabled, true);
    assert.equal(v.props('lovable-copy').disabled, true, 'a text the launch refused is not copied either');
    await v.click('lovable-back');
    assert.equal(v.props('lovable-check')['data-state'], 'refused');
    assert.equal(v.props('lovable-prompt').value, PROMPT, 'the text is kept');
  } finally { await v.close(); }
  const url = 'https://lovable.dev/#prompt=x';
  const ok = fakeApi({ draft: DRAFT, launch: { url, handoff: { uid: 'h2', opened_at: '2026-10-22 09:12:00' } } });
  const b = await mount(h(BuildInLovableDialog, { cycle: 'build', projectId: 1, record: { kind: 'prototype', id: '1' }, api: ok.api, onClose() {}, openTab: () => null }));
  try {
    await b.click('lovable-review-go');
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
    assert.ok(!v.has('lovable-review-go') && !v.has('lovable-open'));
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
    assert.equal((all.match(new RegExp(ENTRY_LABEL, 'g')) || []).length, 1, 'only the writer’s Planned row');
    assert.equal(ENTRY_LABEL, 'Prepare a Lovable prompt', 'D8773 Q4 (A): the entry says what it does');
    assert.match(all, /Second test.*Opened in Lovable on 2026-10-22/s);
    assert.doesNotMatch(all, /Third.*Opened/s);
  } finally { await v.close(); }
  const { api } = fakeApi({ draft: DRAFT, launch: { url: 'https://lovable.dev/#prompt=x', handoff: { uid: 'h3', opened_at: '2026-10-23 10:00:00' } } });
  const one = await mount(h(BuildInLovable, { lovable: section.rows[0].lovable, api, openTab: fakeTab }));
  try {
    await one.click('lovable-build');
    assert.ok(one.has('lovable-dialog'));
    await one.click('lovable-review-go');
    await one.click('lovable-open');
    await one.click('lovable-cancel');
    assert.ok(!one.has('lovable-dialog'));
    assert.equal(one.text('lovable-opened-on'), 'Opened in Lovable on 2026-10-23', 'the row says it at once, without a reload');
  } finally { await one.close(); }
});

test('the wiring: BD8 Sources placement, the phone sheet, the client’s routes, one api.js line, and nothing calls lovable.dev', async () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /lovable=\{narrativeAdmin \? undefined : prototypeLovable\(cycle, slug, module\)\}/);
  assert.match(read('frontend/src/pages/cycles/lovable/BuildInLovable.jsx'), /flex h-full w-full flex-col[^"]*sm:h-auto/, 'LV8a: full height on the phone');
  assert.equal((read('frontend/src/lib/apiModules.generated.js').match(/export \* from '\.\/api\/lovable\.js';/g) || []).length, 1);
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

// ---------------------------------------------------------------- the owner's re-export (Lovable Page.dc.html, D1311 §3)

test('the re-export\'s words: "Build in Lovable · H2", the title per cycle, What this tests from the Worker\'s fields only', () => {
  assert.deepEqual(dialogHead('validate', TESTS), { eyebrow: 'Build in Lovable · H2', title: 'Build the landing page test in Lovable' });
  // Mutation checked: always add the code → "Build in Lovable · " with nothing after it.
  assert.deepEqual(dialogHead('build', { code: null }), { eyebrow: 'Build in Lovable', title: 'Build the prototype in Lovable' });
  assert.deepEqual(testsRows(TESTS).map((r) => r.text), ['H2 · Small clinics will join a waitlist for same-day invoice reconciliation.', 'Landing page test', 'Target 40 sign-ups']);
  // Mutation checked: prefix Target twice → "Target Target 40".
  assert.equal(testsRows({ ...TESTS, target: 'Target 40 sign-ups' })[2].text, 'Target 40 sign-ups');
  // Mutation checked: draw a missing target → "Target null".
  assert.deepEqual(testsRows({ ...TESTS, target: null, code: null }).map((r) => r.key), ['claim', 'title']);
  assert.deepEqual(testsRows(null), []);
  assert.match(DRAFTED_LINE.validate, /^Drafted from this experiment\. Edit it before you open Lovable\.$/);
  assert.doesNotMatch(Object.values(DRAFTED_LINE).join(' '), /Eadwyn/, 'a fixed template is not written by Eadwyn (D1082 §3)');
  // Part 4's form address and sign-up count wait for #3432.
  assert.doesNotMatch(JSON.stringify(BRING_BACK), /sign-up count|axal\.vc\/f\//);
});

test('the re-export mounted: eyebrow, title, What this tests, the drafted line, Copy behind the check, and Close once opened', async () => {
  const copied = [];
  const { api } = fakeApi({ draft: DRAFT, check: (arg) => ({ check: /@/.test(arg.prompt) ? EMAIL : OK }), launch: { url: 'https://lovable.dev/#prompt=x', handoff: { opened_at: '2026-10-27 10:00:00' } } });
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 1, record: RECORD, api, openTab: fakeTab, onClose() {}, clipboard: { write: async (t) => { copied.push(t); } } }));
  try {
    assert.equal(v.text('lovable-eyebrow'), 'Build in Lovable · H2');
    assert.equal(v.text('lovable-tests'), 'What this testsH2 · Small clinics will join a waitlist for same-day invoice reconciliation.Landing page testTarget 40 sign-ups');
    assert.equal(v.text('lovable-drafted'), DRAFTED_LINE.validate);
    assert.ok(!v.has('lovable-cancel'), 'the re-export has no Cancel: × closes');
    assert.ok(!v.has('lovable-copy'), 'D8773: Copy sits on Review, beside Open, under the same disclosure');
    await v.click('lovable-review-go');
    await v.click('lovable-copy');
    assert.deepEqual(copied, [PROMPT]);
    assert.equal(v.text('lovable-copy'), 'Copied');
    await v.click('lovable-back');
    await v.type('lovable-prompt', `${PROMPT} ana@clinic.example`);
    await v.settle(120);
    // Mutation checked: let Review skip the check → the email reaches Copy and the clipboard.
    assert.equal(v.props('lovable-review-go').disabled, true, 'a prompt that fails the check is not reviewed, copied or opened');
    await v.type('lovable-prompt', PROMPT);
    await v.settle(120);
    await v.click('lovable-review-go');
    await v.click('lovable-open');
    assert.equal(v.text('lovable-cancel'), 'Close');
    assert.ok(!v.has('lovable-copy'));
  } finally { await v.close(); }
});

test('Bring it back: an optional link, saved through D1083\'s route on this record, with the Worker\'s refusal in words', async () => {
  const links = [];
  let refuse = false;
  const linkApi = { link: async (...a) => { links.push(a); if (refuse) { const e = new Error('Use an https address on a public host.'); throw e; } return { ok: true }; } };
  const { api } = fakeApi({ draft: DRAFT, check: () => ({ check: OK }) });
  const v = await mount(h(BuildInLovableDialog, { cycle: 'validate', projectId: 7, record: { kind: 'experiment', id: '42' }, api, linkApi, onClose() {} }));
  try {
    assert.match(v.text('lovable-bring-back'), /Bring it back.*Paste the Lovable project link \(optional\).*Axal VC does not see what you build until you link it\./s);
    // Mutation checked: allow Link with an empty field → an empty PUT.
    assert.equal(v.props('lovable-link-save').disabled, true);
    await v.type('lovable-link-url', ' https://clinic-waitlist.lovable.app ');
    await v.click('lovable-link-save');
    // Mutation checked: send the record id as text or the untrimmed address → D1083's route refuses it.
    assert.deepEqual(links, [['validate', 7, 42, 'https://clinic-waitlist.lovable.app']]);
    assert.equal(v.text('lovable-link-saved'), 'Linked. It shows as From Lovable.');
    refuse = true;
    await v.type('lovable-link-url', 'http://x');
    await v.click('lovable-link-save');
    assert.equal(v.text('lovable-link-error'), 'Use an https address on a public host.');
    assert.ok(!v.has('lovable-link-saved'));
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- D8773 (#8773): say what the check covered, show what leaves

/**
 * Fictional ventures with the same three must-haves, so the prompts differ
 * only in line 1: [Atlas Orchard] has a regular product name; [Maya Ruiz] is
 * named after its founder, so the Worker's member scan gives an advisory.
 */
const proto = (v) => ['Build a clickable prototype of ' + v + '.', '', 'About the product: Yield planning for small orchards.', '', 'It should be ready to show by 18 December 2026.', '', 'Must-haves:', '',
  '- Block map: Draw each orchard block.', '- Harvest log: Record a pick in under a minute.', '- Yield forecast: Project the season.', '', 'Build the must-haves above first, each reachable from the first screen. Use sample data only.'].join('\n');
const PROTO = { kind: 'prototype', id: '5' };
const ATLAS = proto('Atlas Orchard');
const MAYA = proto('Maya Ruiz');
const KESTREL = proto('Project Kestrel');
const MEMBER = { ...OK, advisories: [{ kind: 'member_name', words: 'a member’s name', lines: [1] }], advisory_line: 'This prompt contains a member’s name, in line 1. Lovable will see it.' };
const draftOf = (prompt, name, check, extra = {}) => ({ record: PROTO, prompt, prompt_chars: prompt.length, max: 4000, left_out: LEFT_OUT, check, last_opened_at: null,
  tests: { code: null, claim: name, title: 'Prototype / MVP · 3 must-haves', target: null }, venture_name: name, venture_label: name, venture_lines: [1], alias: null, support_session: false, ...extra });
const buildDialog = (api, more = {}) => h(BuildInLovableDialog, { cycle: 'build', projectId: 5, record: PROTO, api, onClose() {}, openTab: fakeTab, ...more });

test('D8773 model: the five checks in the code’s terms, no certificate, the line diff, the times and counts', () => {
  assert.deepEqual(CHECKS.map((c) => c.name), ['Email addresses', 'Phone numbers', 'Tax, bank and card numbers', 'Recorded full legal names', 'This venture’s interviewees']);
  assert.deepEqual(SEND_CHECKS.map((c) => c.key), ['email', 'phone', 'numbers', 'legal_names'], 'Send to… runs lintForSend alone: four checks');
  const words = [CHECK_OK, NOT_COVERED, SEND_CHECK_OK, SEND_NOT_COVERED, ANNOUNCE_OK, ...CHECKS.map((c) => c.what), MEMBER_CHECK.what, ...Object.values(REVIEW)].join(' ');
  // Mutation checked: put back "No names, emails or interview quotes are in the prompt." → this fails.
  assert.doesNotMatch(words, /passed|no names|No names|never contains|is safe/, 'nothing certifies that no names are present');
  assert.match(NOT_COVERED, /^Not covered: names of anyone else/);
  assert.match(SEND_NOT_COVERED, /interviewees’ names/, 'the send does not look for interviewees and says so');
  assert.match(REVIEW.records, /when you press open/i);
  assert.match(REVIEW.copyInstead, /Nothing is recorded when you copy\./);
  const edited = ATLAS.split('\n'); edited[9] = '- Harvest log: Record a pick for a block in two taps.'; edited.splice(12, 0, 'Use a calm green palette.');
  // Mutation checked: count adds + dels → 3.
  assert.equal(changedLines(ATLAS, edited.join('\n')), 2);
  assert.equal(changedLines(ATLAS, ATLAS), 0);
  assert.deepEqual(lineDiff(ATLAS, edited.join('\n')).filter((o) => o.op !== 'same').map((o) => `${o.op}${o.n}`), ['add10', 'del10', 'add13']);
  assert.deepEqual([linesLabel([1]), linesLabel([3, 1]), linesLabel([7, 1, 2]), linesLabel([])], ['Line 1', 'Lines 1 and 3', 'Lines 1, 2 and 7', null]);
  assert.deepEqual([checkTime('2026-11-26T14:31:09.000Z'), checkTime(null)], ['14:31 UTC', null]);
  assert.deepEqual([namesVenture(MAYA, 'Maya Ruiz'), namesVenture(KESTREL, 'Maya Ruiz'), namesVenture('Mayan Ruiz', 'Maya Ruiz')], [true, false, false]);
  assert.equal(exactCount('a\nbc'), '4 characters · 2 lines');
});

test('D8773 regular product name: the five checks named, what they do not cover, and line 1’s venture notice; never “passed”', async () => {
  const { api } = fakeApi({ draft: draftOf(ATLAS, 'Atlas Orchard', OK) });
  const v = await mount(buildDialog(api));
  try {
    assert.equal(v.props('lovable-steps')['aria-label'], 'Step 1 of 2');
    assert.equal(v.text('lovable-prepare-sub'), 'Preparing sends nothing. Next you review exactly what leaves Axal VC before Lovable opens.');
    assert.equal(v.props('lovable-check')['data-state'], 'ok');
    assert.equal(v.text('lovable-check-line'), 'No matches for the five checks below.');
    assert.equal(v.text('lovable-check-at'), 'This exact text · checked 14:31 UTC');
    for (const c of CHECKS) assert.match(v.text('lovable-check-list'), new RegExp(`${c.name} · None found${c.what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(v.text('lovable-check-members'), /^This venture’s members · None found/);
    assert.equal(v.text('lovable-not-covered'), NOT_COVERED);
    assert.match(v.text('lovable-venture-note'), /^Line 1 names your venture: Atlas Orchard\.The checks cannot tell whether a venture’s name is a person’s name/);
    assert.equal(v.text('lovable-live'), ANNOUNCE_OK);
    assert.equal(v.props('lovable-live').role, 'status');
    assert.equal(v.props('lovable-live')['aria-live'], 'polite');
    assert.doesNotMatch(v.text('lovable-dialog'), /passed|No names/);
    assert.equal(v.props('lovable-review-go').disabled, false);
  } finally { await v.close(); }
});

test('D8773 founder-named venture: Review waits for Keep or an alias; the alias is the Worker’s draft, checked again, and the draft is one click away', async () => {
  const { api, calls } = fakeApi({
    draft: (arg) => (arg.alias ? draftOf(KESTREL, 'Maya Ruiz', OK, { venture_label: 'Project Kestrel', alias: 'Project Kestrel' }) : draftOf(MAYA, 'Maya Ruiz', MEMBER)),
    check: (arg) => ({ check: /Maya Ruiz/.test(arg.prompt) ? MEMBER : OK }),
  });
  const v = await mount(buildDialog(api));
  try {
    // Mutation checked: gate Review on `ok` alone → Review is live with a founder's name in line 1.
    assert.equal(v.props('lovable-check')['data-state'], 'choice');
    assert.equal(v.text('lovable-check-line'), 'This prompt contains a member’s name, in line 1. Lovable will see it.');
    assert.match(v.text('lovable-check-members'), /This venture’s members · Found/);
    assert.equal(v.props('lovable-review-go').disabled, true);
    assert.equal(v.text('lovable-review-why'), 'Choose how the prompt names your venture to continue.');
    assert.equal(v.text('lovable-live'), 'This prompt contains a member’s name, in line 1. Lovable will see it. Choose Keep or Use an alias.');
    assert.match(v.text('lovable-naming'), /Keep “Maya Ruiz”Lovable will see this name\.Use a neutral alias/);
    assert.doesNotMatch(v.text('lovable-dialog'), /passed|No names/);
    await v.type('lovable-naming-keep', 'on');
    await v.settle();
    assert.equal(v.props('lovable-review-go').disabled, false, 'Keep is a choice: the advisory never refuses');
    await v.click('lovable-review-go');
    assert.equal(v.text('lovable-review-named'), 'Maya Ruiz');
  } finally { await v.close(); }

  const w = await mount(buildDialog(api));
  try {
    await w.type('lovable-naming-alias', 'on');
    await w.settle();
    await w.type('lovable-alias-input', 'Project Kestrel');
    await w.settle();
    await w.click('lovable-alias-apply');
    // The client never string-replaces: the Worker drafts the template with the alias.
    assert.deepEqual(calls.at(-1), ['draft', { project_id: 5, record: PROTO, alias: 'Project Kestrel' }]);
    assert.equal(w.props('lovable-prompt').value, KESTREL);
    assert.equal(w.text('lovable-prompt-tag'), 'Alias applied');
    assert.equal(w.text('lovable-live'), 'Alias applied: Project Kestrel. Checked again: no matches.');
    assert.match(w.text('lovable-venture-note'), /^Line 1 names your venture by an alias: Project Kestrel\.Your venture is still Maya Ruiz\./);
    assert.equal(w.props('lovable-review-go').disabled, false);
    await w.click('lovable-review-go');
    assert.equal(w.text('lovable-review-named'), 'Project Kestrel (an alias; your venture is still Maya Ruiz)');
    await w.click('lovable-back');
    await w.click('lovable-restore');
    // Mutation checked: restore to the alias draft → the original name never comes back.
    assert.equal(w.props('lovable-prompt').value, MAYA, 'Restore the draft brings back the original text');
    assert.equal(w.text('lovable-live'), 'Draft restored. Checking again.');
    await w.settle(120);
    assert.deepEqual(calls.at(-1), ['check', { project_id: 5, prompt: MAYA }], 'the restored draft is checked again');
    assert.equal(w.text('lovable-live'), 'Draft restored. This prompt contains a member’s name, in line 1. Lovable will see it. Choose Keep or Use an alias.');
    assert.equal(w.props('lovable-review-go').disabled, true, 'the choice is asked again');
  } finally { await w.close(); }
});

test('D8773 changed prompt: Edited · 2 lines, Compare with the draft, a new check time, Review shows it byte for byte, Restore brings the exact draft back', async () => {
  const edited = ATLAS.split('\n'); edited[9] = '- Harvest log: Record a pick for a block in two taps.'; edited.splice(12, 0, 'Use a calm green palette.');
  const text = edited.join('\n');
  const { api, calls } = fakeApi({ draft: draftOf(ATLAS, 'Atlas Orchard', OK), check: () => ({ check: { ...OK, checked_at: '2026-11-26T14:33:00.000Z' } }) });
  const v = await mount(buildDialog(api));
  try {
    assert.equal(v.text('lovable-prompt-tag'), 'Drafted');
    assert.ok(!v.has('lovable-restore'));
    await v.type('lovable-prompt', text);
    assert.equal(v.props('lovable-check')['data-state'], 'checking');
    assert.match(v.text('lovable-check-at'), /^Changed since the last check · last checked 14:31 UTC/);
    assert.equal(v.props('lovable-review-go').disabled, true);
    await v.settle(120);
    assert.deepEqual(calls.at(-1), ['check', { project_id: 5, prompt: text }]);
    assert.equal(v.text('lovable-check-at'), 'This exact text · checked 14:33 UTC');
    assert.equal(v.text('lovable-prompt-tag'), 'Edited · 2 lines');
    await v.click('lovable-compare');
    assert.match(v.text('lovable-diff'), /Now, line 10: - Harvest log: Record a pick for a block in two taps\.Draft, line 10: - Harvest log: Record a pick in under a minute\.Now, line 13: Use a calm green palette\./);
    await v.click('lovable-review-go');
    assert.equal(v.text('lovable-review-text'), text, 'Review shows the edited text byte for byte');
    assert.equal(v.text('lovable-review-count'), `${text.length.toLocaleString('en-US')} characters · 14 lines · checked 14:33 UTC, unchanged since`);
    await v.click('lovable-back');
    await v.click('lovable-restore');
    assert.equal(v.props('lovable-prompt').value, ATLAS);
    assert.equal(v.text('lovable-prompt-tag'), 'Drafted');
  } finally { await v.close(); }
});

test('D8773 Copy and Open: the same text under the same disclosure; Copy records nothing, Open records one handoff', async () => {
  const copied = [];
  const url = `https://lovable.dev/#prompt=${encodeURIComponent(ATLAS)}`;
  const { api, calls } = fakeApi({ draft: draftOf(ATLAS, 'Atlas Orchard', OK), launch: { url, handoff: { uid: 'h9', opened_at: '2026-11-26 14:36:00' } } });
  const v = await mount(buildDialog(api, { clipboard: { write: async (t) => { copied.push(t); } } }));
  try {
    await v.click('lovable-review-go');
    assert.equal(v.props('lovable-steps')['aria-label'], 'Step 2 of 2');
    assert.equal(v.props('lovable-dialog')['data-step'], 'review');
    assert.equal(v.text('lovable-review-destination'), 'lovable.dev, in a new tab, with your own Lovable account.');
    assert.match(v.text('lovable-review-facts'), /How it travels.*after the “#”.*Axal VC never sends it to Lovable/);
    assert.equal(v.text('lovable-review-text'), ATLAS);
    assert.equal(v.text('lovable-review-records'), REVIEW.records);
    assert.equal(v.text('lovable-review-copy'), REVIEW.copyInstead);
    await v.click('lovable-copy');
    assert.deepEqual(copied, [ATLAS], 'Copy takes exactly the reviewed text');
    // Mutation checked: record the copy through launch → a launch call here.
    assert.ok(!calls.some(([k]) => k === 'launch'), 'Copy records nothing');
    assert.equal(v.text('lovable-live'), `Copied ${ATLAS.length.toLocaleString('en-US')} characters. Nothing was recorded.`);
    await v.click('lovable-open');
    assert.deepEqual(calls.filter(([k]) => k === 'launch'), [['launch', { project_id: 5, record: PROTO, prompt: ATLAS }]], 'Open sends the same text');
  } finally { await v.close(); }
});

test('D8773 a refusal names its kind and line in an alert; a support session is told up front and offered no Review', async () => {
  const lena = `${ATLAS}\nOpen with a quote from Lena Park.`;
  const found = { ok: false, line: 'This prompt contains an interviewee’s name, in line 14. Remove it to continue.', findings: [{ kind: 'interviewee_name', words: 'an interviewee’s name', lines: [14] }], advisories: [], checked_at: '2026-11-26T14:34:00.000Z' };
  const { api } = fakeApi({ draft: draftOf(ATLAS, 'Atlas Orchard', OK), check: () => ({ check: found }) });
  const v = await mount(buildDialog(api));
  try {
    await v.type('lovable-prompt', lena);
    await v.settle(120);
    assert.equal(v.props('lovable-check')['data-state'], 'refused');
    assert.equal(v.text('lovable-check-line'), found.line);
    assert.match(v.text('lovable-check-interviewees'), /This venture’s interviewees · Found/);
    assert.doesNotMatch(v.text('lovable-check'), /Lena/, 'the kind and the line, never the words');
    assert.equal(v.props('lovable-review-go').disabled, true);
  } finally { await v.close(); }
  const s = fakeApi({ draft: draftOf(MAYA, 'Maya Ruiz', OK, { support_session: true }) });
  const sv = await mount(buildDialog(s.api));
  try {
    assert.equal(sv.text('lovable-support'), 'You are in a support session. You can read this prompt and its check. Opening it in Lovable is the founder’s: Axal VC refuses to open it from a support session.');
    assert.ok(!sv.has('lovable-review-go') && !sv.has('lovable-copy') && !sv.has('lovable-open'), 'Review, Copy and Open are absent, not dimmed');
    assert.equal(sv.props('lovable-prompt').readOnly, true);
  } finally { await sv.close(); }
});
