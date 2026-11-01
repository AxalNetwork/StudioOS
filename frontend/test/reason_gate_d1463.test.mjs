/**
 * D1463 (#3713) — the one reason gate an admin meets before reading a
 * founder's private record (RR00–RR22), the access banner while the read
 * lasts, and the rail on a founder's record.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/reason_gate_d1463.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ReasonGate, { AccessBanner } from '../src/ui/ReasonGate.jsx';
import WorkerRail from '../src/ui/WorkerRail.jsx';
import { NarrativeHome } from '../src/pages/raise/narrative/NarrativeTool.jsx';
import {
  FOUNDER_RECORD_OFF, REASON_CHIPS, SAVE_REFUSED, bannerLine, countdown, endedLine, grantSpan, reasonCheck, refusalView, ruleLine, timeOf,
} from '../src/ui/reasonGate.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const NARRATIVE = { record: 'Investor narrative', what: 'this narrative', rule: { kind: 'grant', hours: 8 }, min: 3, max: 200 };
const CAP_TABLE = { record: 'Cap table', what: 'this cap table', rule: { kind: 'per_open' }, min: 10, max: 500 };

test('the rule line comes from the record: 8 hours for the narrative, one open for the others', () => {
  assert.equal(ruleLine({ kind: 'grant', hours: 8 }), 'Access lasts 8 hours.');
  assert.equal(ruleLine({ kind: 'grant', hours: 1 }), 'Access lasts 1 hour.');
  assert.equal(ruleLine({ kind: 'per_open' }), 'This opens once; each open asks again.');
  for (const bad of [null, {}, { kind: 'grant' }, { kind: 'grant', hours: 0 }]) assert.equal(ruleLine(bad), null, JSON.stringify(bad));
});

test('the reason is checked with the record\'s own limits: too short is a muted hint, over the limit is red', () => {
  assert.deepEqual(reasonCheck('', { min: 3, max: 200 }), { count: 0, ok: false, tone: null, message: null });
  assert.deepEqual(reasonCheck('   ', { min: 1, max: 500 }), { count: 0, ok: false, tone: null, message: null }, 'blank is not a reason');
  assert.deepEqual(reasonCheck('Q3', { min: 3, max: 200 }), { count: 2, ok: false, tone: 'hint', message: 'Write a reason of at least 3 characters.' });
  assert.equal(reasonCheck('Q3 burn', { min: 10, max: 500 }).ok, false, 'the cap table asks for 10');
  assert.equal(reasonCheck('x', { min: 1, max: 500 }).ok, true, 'the data room takes 1');
  assert.equal(reasonCheck('short', { min: 10, short: 'Own words.' }).message, 'Own words.');
  const over = reasonCheck('x'.repeat(212), { min: 3, max: 200 });
  assert.deepEqual([over.count, over.ok, over.tone, over.message], [212, false, 'error', 'A reason is at most 200 characters.']);
  assert.equal(reasonCheck('  Quarterly    review ', { min: 3, max: 200 }).count, 'Quarterly review'.length, 'spaces squashed as sent');
  // Q5 A: each quick pick clears every record's minimum.
  for (const c of REASON_CHIPS) assert.ok(reasonCheck(c, { min: 10, max: 200 }).ok, c);
});

test('the countdown: whole minutes rounded up, amber in the last minute, over at zero, nothing guessed when unread', () => {
  const end = '2026-11-01 22:00:00';
  const at = (min) => timeOf(end) - min * 60_000;
  assert.deepEqual(countdown(end, at(472)), { ms: 472 * 60_000, text: '7 h 52 m', lastMinute: false, over: false });
  assert.equal(countdown(end, at(59.5)).text, '1 h 0 m', 'rounded up, never under-stated');
  assert.equal(countdown(end, at(0.5)).text, '1 m');
  assert.equal(countdown(end, at(0.5)).lastMinute, true);
  assert.equal(countdown(end, at(-1)).over, true);
  for (const bad of [null, undefined, '', 'soon']) assert.equal(countdown(bad, Date.now()), null, String(bad));
  assert.equal(timeOf('2026-11-01 22:00:00'), Date.UTC(2026, 10, 1, 22, 0, 0), 'a D1 time is UTC');
});

test('the lines: the banner, the lapsed grant, the founder\'s span', () => {
  assert.equal(bannerLine({ access: 'HQ', reason: ' Quarterly portfolio review ' }), 'Read only · HQ access for Quarterly portfolio review');
  assert.equal(bannerLine({ access: null, reason: '' }), 'Read only');
  assert.match(endedLine(8, '2026-11-01 22:02:00'), /^Your 8-hour read ended at \d\d:\d\d\.$/);
  assert.equal(endedLine(8, null), 'Your 8-hour read ended.');
  assert.equal(grantSpan({ created_at: '2026-10-30 14:02:00', expires_at: '2026-10-30 22:02:00' }), '8 h');
  assert.equal(grantSpan({ created_at: '2026-10-30 14:02:00', expires_at: '2026-10-30 22:02:00', ended_at: '2026-10-30 15:00:00' }), 'Ended early');
  assert.equal(grantSpan({ created_at: null, expires_at: '2026-10-30 22:02:00' }), null, 'never a guessed length');
});

test('a refusal no button can clear is not offered a Try again', () => {
  assert.deepEqual(refusalView({ status: 409, data: { code: 'support_owner_unresolved', message: 'Support access cannot be recorded for this venture owner.' } }),
    { kind: 'owner', retry: false, message: 'Support access cannot be recorded for this venture owner.' });
  assert.equal(refusalView({ status: 403, data: { code: 'admins_only' } }).retry, false);
  assert.equal(refusalView({ status: 400, data: { code: 'support_reason_required', message: 'Too short.' } }).kind, 'reason');
  assert.deepEqual(refusalView({ status: 503 }), { kind: 'save', retry: true, message: SAVE_REFUSED });
  assert.deepEqual(refusalView(new Error('network')), { kind: 'save', retry: true, message: SAVE_REFUSED });
});

test('RR01, RR10a: the gate draws the venture, the record\'s rule and limits, the picks; a preview carries no record data', () => {
  const grant = html(h(ReasonGate, { ...NARRATIVE, venture: { name: 'Synthetic Labs', founder_name: 'Ada Founder' }, viewer: 'super_admin', onSubmit() {}, preview: h('span', null, 'skeleton'), back: { to: '/raise', label: 'Back to Raise' } }));
  assert.match(grant, /Why are you opening this narrative\?/);
  assert.match(grant, /Access lasts 8 hours\./);
  assert.match(grant, /The founder sees this reason, who gave it and when\./);
  assert.match(grant, /Every open is recorded\./);
  assert.match(grant, /Read only · HQ access/);
  assert.match(grant, /Founder: Ada Founder/);
  assert.match(grant, />0 \/ 200</);
  assert.equal((grant.match(/data-testid="reason-gate-chip"/g) || []).length, 4);
  assert.match(grant, /data-testid="reason-gate-open"[^>]*>Open read only</);
  assert.match(grant, /<button[^>]*disabled=""[^>]*data-testid="reason-gate-open"/, 'Open waits for a reason');
  assert.match(grant, /Opens read only after you give a reason\./);
  assert.match(grant, /aria-hidden="true"[^>]*data-testid="reason-gate-preview"/);
  const perOpen = html(h(ReasonGate, { ...CAP_TABLE, venture: { name: 'Synthetic Labs' }, viewer: 'admin', onSubmit() {} }));
  assert.match(perOpen, /This opens once; each open asks again\./);
  assert.match(perOpen, /Read only · Studio admin access/);
  assert.match(perOpen, />0 \/ 500</);
  assert.doesNotMatch(perOpen, /Founder:/, 'G2: no founder line unless the Worker names exactly one');
  assert.doesNotMatch(perOpen, /reason-gate-preview/);
  // RR13: inline — no venture header, no preview.
  const inline = html(h(ReasonGate, { ...NARRATIVE, inline: true, venture: { name: 'Synthetic Labs' }, onSubmit() {}, preview: h('span', null, 'x'), onCancel() {}, submitLabel: 'Continue' }));
  assert.doesNotMatch(inline, /reason-gate-venture|reason-gate-preview/);
  assert.match(inline, />Continue</);
  assert.match(inline, />Cancel</);
});

async function mounted(element) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const prevMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    all, props, flush, text: () => text(container), byId: (id) => all(id)[0],
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = prevMatch; restore(); },
  };
}

test('RR02: a pick fills the field and stays editable; Open sends the reason squashed; a refused save keeps the field', async () => {
  const sent = [];
  let fail = true;
  const page = await mounted(h(ReasonGate, { ...NARRATIVE, onSubmit: async (r) => { sent.push(r); if (fail) { const e = new Error('x'); e.status = 503; throw e; } } }));
  try {
    await act(async () => page.props(page.all('reason-gate-chip')[0]).onClick());
    assert.equal(page.props(page.byId('reason-gate-input')).value, 'Quarterly portfolio review');
    await act(async () => page.props(page.byId('reason-gate-input')).onChange({ target: { value: 'Quarterly portfolio review,   Q3 burn question' } }));
    assert.equal(page.props(page.byId('reason-gate-open')).disabled, false);
    await act(async () => page.props(page.byId('reason-gate')).onSubmit({ preventDefault() {} }));
    await page.flush();
    assert.deepEqual(sent, ['Quarterly portfolio review, Q3 burn question']);
    assert.match(page.text(), /The reason could not be saved\. Try again\./);
    assert.equal(page.props(page.byId('reason-gate-input')).value, 'Quarterly portfolio review,   Q3 burn question', 'the field is kept');
    fail = false;
    await act(async () => page.props(page.byId('reason-gate')).onSubmit({ preventDefault() {} }));
    await page.flush();
    assert.equal(sent.length, 2);
  } finally { await page.close(); }
});

test('RR18: an owner who cannot be resolved draws a muted line, no form and no Try again', async () => {
  const page = await mounted(h(ReasonGate, { record: 'Data room', what: 'this data room', rule: { kind: 'per_open' }, min: 1, max: 500, back: { to: '/raise', label: 'Back to Raise' },
    onSubmit: async () => { const e = new Error('x'); e.status = 409; e.data = { code: 'support_owner_unresolved', message: 'Support access cannot be recorded for this venture owner.' }; throw e; } }));
  try {
    await act(async () => page.props(page.byId('reason-gate-input')).onChange({ target: { value: 'Support request' } }));
    await act(async () => page.props(page.byId('reason-gate')).onSubmit({ preventDefault() {} }));
    await page.flush();
    assert.equal(page.props(page.byId('reason-gate-refused'))['data-kind'], 'owner');
    assert.match(page.text(), /Support access cannot be recorded for this venture owner\./);
    assert.equal(page.byId('reason-gate'), undefined, 'no form');
    assert.doesNotMatch(page.text(), /Try again/);
  } finally { await page.close(); }
});

test('RR04–RR06: the banner counts down, is amber in its last minute, re-reads at zero, and ends early only where the record can', async () => {
  const end = '2026-11-01 22:00:00';
  const t = timeOf(end);
  const running = html(h(AccessBanner, { reason: 'Quarterly portfolio review', viewer: 'super_admin', endsAt: end, now: t - 472 * 60_000 }));
  assert.match(running, /Read only · HQ access for Quarterly portfolio review · ends in <span[^>]*>7 h 52 m</);
  assert.doesNotMatch(running, /End access now/, 'no End access until the Worker can end a read (G1)');
  assert.match(html(h(AccessBanner, { reason: 'R', viewer: 'admin', endsAt: end, now: t - 30_000 })), /data-last="true"[^>]*>1 m</);
  const perOpen = html(h(AccessBanner, { reason: 'Support request', viewer: 'admin' }));
  assert.doesNotMatch(perOpen, /ends in/, 'per open: no timer');
  let expired = 0;
  const lapsed = await mounted(h(AccessBanner, { reason: 'R', viewer: 'admin', endsAt: end, now: t + 1, onExpire: () => { expired += 1; } }));
  try { assert.equal(expired, 1, 'at zero the page re-reads, so the gate returns'); } finally { await lapsed.close(); }
  let ended = 0;
  const page = await mounted(h(AccessBanner, { reason: 'R', viewer: 'admin', endsAt: end, now: t - 3_600_000, onEnd: async () => { ended += 1; } }));
  try {
    await act(async () => page.props(page.byId('access-banner-end')).onClick());
    assert.match(page.text(), /End your read now\?/);
    await act(async () => page.props(page.byId('access-banner-end-confirm')).onClick());
    await page.flush();
    assert.equal(ended, 1);
  } finally { await page.close(); }
});

test('RR03 (Q1 A): on a founder\'s record the rail keeps where, says Eadwyn is off, and draws no switch, spend, usage or suggestions', () => {
  const off = renderToStaticMarkup(h(WorkerRail, { workspace: 'Raise', readOnlyFor: 'founder-record' }));
  assert.match(off, /data-testid="text-worker-rail-founder-record"/);
  assert.ok(off.includes(FOUNDER_RECORD_OFF.replace('’', '&#x27;')) || off.includes(FOUNDER_RECORD_OFF));
  for (const gone of ['switch-worker-rail-ai-off', 'worker-rail-usage', 'worker-rail-suggestions']) assert.doesNotMatch(off, new RegExp(gone), gone);
  assert.match(off, /data-founder-record="true"/);
  const on = renderToStaticMarkup(h(WorkerRail, { workspace: 'Raise' }));
  assert.match(on, /switch-worker-rail-ai-off/, 'every other page keeps its switch');
  assert.doesNotMatch(on, /text-worker-rail-founder-record/);
  const route = read('pages/cycles/CycleRoute.jsx');
  // D1464 (#4021): a per-open read of the Data room or Capital relationships turns it off too.
  assert.match(route, /readOnlyFor=\{narrativeAdmin \|\| supportOpen \? 'founder-record' : null\}/);
});

test('RR07: a founder sees who read the narrative on Home, even with no saved version; an admin never does', () => {
  const founder = html(h(NarrativeHome, { data: { parts: {} }, projectId: 7 }));
  assert.match(founder, /data-testid="narrative-reads"/);
  assert.match(founder, /An admin gives a reason before reading\. You see each read here\./);
  assert.doesNotMatch(html(h(NarrativeHome, { data: { parts: {} }, projectId: 7, admin: true })), /narrative-reads/);
  assert.match(read('pages/cycles/CycleRoute.jsx'), /<NarrativeHome data=\{data\} admin=\{isNarrativeAdmin\(\{ role: ctx\.role \}\)\} projectId=\{ctx\.projectId\} \/>/);
});
