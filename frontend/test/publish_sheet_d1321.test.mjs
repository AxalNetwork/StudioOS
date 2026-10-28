/**
 * D1321 (#3482, part 3 of #2400) — Publish to…, its confirm and result, and
 * "Published outside": the model's rules and words, and the sheet and the
 * history mounted over a stand-in `publishApi`. No test reaches the Worker;
 * every account, company and post is made up.
 *
 * What #3482 says must be tested, each below by name: the confirm names
 * every account and audience; nothing is pre-ticked; Review and send is off
 * with a finding; every state draws, phone and dark included; Escape, focus
 * return and a history deep link close to the list.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/publish_sheet_d1321.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  MODULE_LABELS, NOT_KNOWN, accountOn, actionsOf, audienceLine, confirmRows, counterOf, destinationRows, detailFacts, failedLine, filterRows,
  findingRows, footState, highlightRuns, historyHref, historyRow, idempotencyKey, mediaLine, providerOf, resultSummary, retractNote, statusOf, viewLink,
} from '../src/pages/cycles/publish/publishModel.js';
import PublishSheet from '../src/pages/cycles/publish/PublishSheet.jsx';
import PublishedOutside from '../src/pages/cycles/publish/PublishedOutside.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const P = 701;

// ---------------------------------------------------------------- fixtures

const dest = (uid, provider_key, account, audience, enabled = true, retract = 'delete') => ({ uid, provider_key, account, audience, enabled, retract });
const DESTS = {
  can_publish: true,
  connections: [
    { uid: 'int-x', provider_key: 'x', destinations: [dest('d-x', 'x', '@northwind_demo', 'Public')] },
    { uid: 'int-bh', provider_key: 'beehiiv', destinations: [dest('d-bh', 'beehiiv', 'Northwind Notes', 'Draft only: not sent to subscribers', true, 'unknown')] },
    { uid: 'int-fb', provider_key: 'facebook', destinations: [dest('d-fb', 'facebook', 'Northwind Data', 'Public', true, 'none')] },
    { uid: 'int-tt', provider_key: 'tiktok', destinations: [dest('d-tt', 'tiktok', '@northwind.demo', 'Inbox draft', false, 'none')] },
  ],
};
const lint = (findings = []) => ({ ok: findings.length === 0, findings, kinds: [...new Set(findings.map((f) => f.kind))] });
const previewOf = (d, text, findings = [], problems = []) => ({
  destination_uid: d.uid, provider_key: d.provider_key, account: d.account, audience: d.audience, retract: d.retract,
  preview: { target: d.provider_key, audience: d.audience, fields: [], counts: [{ name: 'characters', used: text.length, limit: 280 }], media: { count: 0, limit: 4, types: ['image/jpeg', 'image/png'] }, problems },
  problems, lint: lint(findings), envelope_hash: `hash-${d.uid}-${text.length}`, sendable: findings.length === 0 && problems.length === 0,
});
const allDests = DESTS.connections.flatMap((c) => c.destinations);
const EMAIL = (text) => ({ kind: 'email', severity: 'high', match: 'ops@northwind-demo.example', offset: text.indexOf('ops@'), length: 'ops@northwind-demo.example'.length });
const NAMED = (text) => ({ kind: 'private_in_public', severity: 'high', match: 'Avery Example', user_id: 7, offset: text.indexOf('Avery'), length: 13 });

/** A stand-in publishApi: records every call; `lintFor(text, draftBody)` decides the findings. */
function stubApi(over = {}) {
  const calls = [];
  let body = { text: '', named_consent: [], team_only_included: false };
  const sendFor = (d, status = 'sent', extra = {}) => ({
    uid: `s-${d.uid}`, module: 'product-improvement', provider_key: d.provider_key, destination: d.account, audience: d.audience, status,
    confirmed_by: 1, confirmed_at: '2026-10-26 14:01:00', sent_at: status === 'sent' ? '2026-10-26 14:02:00' : null,
    external_post_id: status === 'sent' ? '1849273650012345678' : null, external_url: status === 'sent' ? `https://example.test/${d.uid}` : null,
    error_code: null, retry_after: null, retract: d.retract, text: body.text, ...extra,
  });
  const api = {
    destinations: async (project) => { calls.push(['destinations', project]); if (over.destinations instanceof Error) throw over.destinations; return over.destinations || DESTS; },
    createDraft: async (b) => { calls.push(['createDraft', b]); body = { ...body, text: b.text }; return { draft: { uid: 'draft-1' } }; },
    saveDraft: async (uid, b) => { calls.push(['saveDraft', uid, b]); body = { ...body, ...b }; return { draft: { uid } }; },
    archiveDraft: async (uid) => { calls.push(['archiveDraft', uid]); return { archived: true }; },
    preview: async (uid, uids) => {
      calls.push(['preview', uid, uids]);
      const findings = (over.lintFor || (() => []))(body.text, body);
      return { previews: uids.map((u) => previewOf(allDests.find((d) => d.uid === u), body.text, findings)) };
    },
    confirm: async (uid, b) => {
      calls.push(['confirm', uid, b]);
      const d = allDests.find((x) => x.uid === b.destination_uid);
      const st = (over.outcome || {})[d.uid] || 'sent';
      if (st === 'refused') throw Object.assign(new Error('This place has reached its posts for today. Try again tomorrow.'), { code: 'daily_cap_reached' });
      return { send: sendFor(d, st, st === 'failed' ? { error_code: 'rate_limited', retry_after: '2026-10-26 14:20:00' } : {}), repeated: false };
    },
    retry: async (uid) => { calls.push(['retry', uid]); const d = allDests.find((x) => `s-${x.uid}` === uid); return { send: sendFor(d, 'sent') }; },
    check: async (uid) => { calls.push(['check', uid]); return { send: { ...(over.sends || []).find((s) => s.uid === uid), status: 'sent' }, found: true }; },
    markNotSent: async (uid) => { calls.push(['markNotSent', uid]); return { send: { ...(over.sends || []).find((s) => s.uid === uid), status: 'failed', error_code: 'marked_not_sent' } }; },
    retract: async (uid) => { calls.push(['retract', uid]); return { send: { ...(over.sends || []).find((s) => s.uid === uid), status: 'retracted' } }; },
    markRemoved: async (uid) => { calls.push(['markRemoved', uid]); return { send: { ...(over.sends || []).find((s) => s.uid === uid), status: 'removed_outside' } }; },
    sends: async (project, filters) => { calls.push(['sends', project, filters]); if (over.sendsError) throw over.sendsError; return { sends: over.sends || [] }; },
    send: async (uid) => { calls.push(['send', uid]); if (!over.one) throw Object.assign(new Error('That is not here, or not yours to see.'), { code: 'not_found' }); return { send: over.one }; },
  };
  return { api, calls, sendFor };
}

const HISTORY = [
  { uid: 'h1', module: 'product-improvement', provider_key: 'x', destination: '@northwind_demo', audience: 'Public', status: 'sent', confirmed_by: 1, confirmed_at: '2026-10-26 14:01:00', sent_at: '2026-10-26 14:02:00', external_post_id: '1849273650012345678', external_url: 'https://example.test/p/1', retract: 'delete', text: 'Shipped in October: bulk CSV import, faster search, and SSO for teams.' },
  { uid: 'h2', module: 'product-improvement', provider_key: 'facebook', destination: 'Northwind Data', audience: 'Public', status: 'failed', confirmed_by: 1, confirmed_at: '2026-10-26 14:01:00', sent_at: null, error_code: 'rate_limited', retry_after: '2026-10-26 14:20:00', retract: 'none', text: 'Shipped in October: bulk CSV import.' },
  { uid: 'h3', module: 'revenue-and-traction', provider_key: 'x', destination: '@northwind_demo', audience: 'Public', status: 'unknown', confirmed_by: 1, confirmed_at: '2026-10-24 09:40:00', sent_at: null, retract: 'delete', text: '38 teams now pay for Northwind.' },
  { uid: 'h4', module: 'product-improvement', provider_key: 'tiktok', destination: '@northwind.demo', audience: 'Inbox draft', status: 'sent', confirmed_by: 1, confirmed_at: '2026-10-12 11:02:00', sent_at: '2026-10-12 11:03:00', external_url: 'https://example.test/t/4', retract: 'none', text: '60 seconds on bulk CSV import.' },
];

// ---------------------------------------------------------------- mounting

function Where() { const l = useLocation(); return h('output', { 'data-testid': 'where' }, `${l.pathname}${l.search}${l.hash}`); }

async function mount(element, url = '/grow/reporting') {
  const restore = installDocument('', { focus: true });
  const keys = [];
  const add = document.addEventListener;
  document.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
  document.removeEventListener = (type, fn) => { const i = keys.indexOf(fn); if (i >= 0) keys.splice(i, 1); };
  const mk = document.createElement.bind(document);
  document.createElement = (tag) => { const n = mk(tag); n.querySelector = () => null; n.querySelectorAll = () => []; return n; };
  document.querySelectorAll = () => [];
  globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
  globalThis.removeEventListener = (type, fn) => { const i = keys.indexOf(fn); if (i >= 0) keys.splice(i, 1); };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = (pred) => walk(container).filter((n) => pred(pr(n), n));
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(React.Fragment, null, element, h(Where)) })))));
  await settle();
  const need = (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    byId, has: (id) => !!byId(id), text: (id) => text(id ? need(id) : container), props: (id) => pr(need(id)), node: need, all, settle,
    where: () => text(byId('where')),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, target: need(id) }); }); await settle(); },
    async change(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value, checked: value } }); }); await settle(); },
    async escape() { await act(async () => { const fn = keys[keys.length - 1]; fn?.({ key: 'Escape', preventDefault() {}, defaultPrevented: false }); }); await settle(); },
    async close() { await act(async () => root.unmount()); document.addEventListener = add; restore(); },
  };
}
const sheet = (api, props = {}) => h(PublishSheet, { projectId: P, module: 'product-improvement', onClose: props.onClose || (() => {}), api, delay: 0, ...props });

// ---------------------------------------------------------------- the model

test('the model: places, providers, nothing pre-ticked, an off place muted with its reason, and the audience lines', () => {
  assert.equal(Object.keys(MODULE_LABELS).length, 9);
  assert.deepEqual(providerOf('x'), { name: 'X', letter: 'X' });
  assert.deepEqual(providerOf('mastodon'), { name: 'Mastodon', letter: 'M' }, 'an unknown provider reads as itself');
  const rows = destinationRows(DESTS);
  assert.deepEqual(rows.map((r) => [r.uid, r.on]), [['d-x', true], ['d-bh', true], ['d-fb', true], ['d-tt', false]]);
  assert.equal(rows[3].reason, 'Off for this company');
  assert.equal(rows[3].href, '/account/connectors/tiktok');
  assert.ok(!rows.some((r) => 'ticked' in r), 'rows carry no tick: the sheet starts with none');
  assert.equal(destinationRows({ connections: [{ provider_key: 'x', destinations: [{ uid: 'q', account: 'a' }] }] })[0].on, false, 'a place not said to be on is off');
  assert.equal(audienceLine('Public', 'delete'), 'Public · Can be deleted later');
  assert.equal(audienceLine('Public', 'none'), 'Public · Cannot be deleted from Axal VC');
  assert.equal(audienceLine('Draft only: not sent to subscribers', 'unknown'), 'Draft only: not sent to subscribers');
  assert.equal(accountOn('@northwind_demo', 'x'), '@northwind_demo on X');
  assert.equal(historyHref('s 1'), '/grow/reporting?sent=s%201#published-outside');
});

test('the check: findings once each with their fix, a secret named by its kind, highlights at the Worker’s offsets, and no override', () => {
  const text = 'Ask ops@northwind-demo.example and thank Avery Example.';
  const f = [EMAIL(text), NAMED(text), { kind: 'secret', match: 'nd_l****', context: 'Looks like an API key.', offset: 999, length: 4 }];
  const rows = findingRows([{ lint: lint(f) }, { lint: lint([EMAIL(text)]) }]);
  assert.deepEqual(rows.map((r) => r.title), ['Email address', 'Names an Axal member', 'Looks like an API key']);
  assert.equal(rows[0].fix, 'Remove it from the text.');
  assert.equal(rows[1].consent, true);
  assert.equal(rows[2].fix, 'Remove it from the text. Keys are never posted.');
  const runs = highlightRuns(text, rows);
  assert.deepEqual(runs.filter((r) => r.mark).map((r) => r.text), ['ops@northwind-demo.example', 'Avery Example'], 'an offset past the end is dropped');
  assert.equal(runs.map((r) => r.text).join(''), text, 'the runs are the whole text');
  assert.deepEqual(highlightRuns('abcdef', [{ offset: 1, length: 3 }, { offset: 2, length: 2 }]).map((r) => [r.text, r.mark]), [['a', false], ['bcd', true], ['ef', false]], 'an overlap is dropped');
});

test('Review and send: off with no text, no place, while checking, with a finding or a problem; on only when every ticked place is sendable', () => {
  const ok = previewOf(allDests[0], 'hello');
  const bad = previewOf(allDests[1], 'hello', [EMAIL('hello ops@')]);
  const problem = previewOf(allDests[2], 'hello', [], ['281 of 280 characters: shorten it for this place.']);
  assert.deepEqual(footState({ text: ' ', ticked: ['d-x'], previews: [ok] }), { on: false, why: 'Write your post to continue.' });
  assert.equal(footState({ text: 'hi', ticked: [], previews: [] }).why, 'Tick a place to continue.');
  assert.equal(footState({ text: 'hi', ticked: ['d-x'], previews: [ok], checking: true }).why, 'Checking…');
  assert.equal(footState({ text: 'hi', ticked: ['d-x', 'd-bh'], previews: [ok] }).why, 'Checking…', 'a ticked place with no preview yet');
  assert.deepEqual(footState({ text: 'hi', ticked: ['d-x', 'd-bh'], previews: [ok, bad] }), { on: false, why: 'Remove the highlighted text to continue.' });
  assert.equal(footState({ text: 'hi', ticked: ['d-fb'], previews: [problem] }).why, 'Fix the problems the preview lists to continue.');
  assert.deepEqual(footState({ text: 'hi', ticked: ['d-x'], previews: [ok, bad] }), { on: true, why: null }, 'an unticked place’s finding does not hold it');
  assert.deepEqual(counterOf(ok), { shown: '5 / 280', spoken: '5 of 280 characters', over: false });
  assert.equal(counterOf(previewOf(allDests[0], 'x'.repeat(281))).over, true);
  assert.equal(mediaLine(ok), 'Up to 4 images · JPEG, PNG');
});

test('the confirm’s rows name every account and audience; keys are one per place and safe', () => {
  const rows = confirmRows(allDests.slice(0, 3).map((d) => previewOf(d, 'x')), destinationRows(DESTS));
  assert.deepEqual(rows.map((r) => [r.title, r.line]), [
    ['@northwind_demo on X', 'Public · Can be deleted later'],
    ['Northwind Notes on Beehiiv', 'Draft only: not sent to subscribers'],
    ['Northwind Data on Facebook', 'Public · Cannot be deleted from Axal VC'],
  ]);
  const k = idempotencyKey(() => 'a b/c');
  assert.match(k, /^pub-[A-Za-z0-9_-]+$/);
  assert.notEqual(idempotencyKey(), idempotencyKey());
});

test('sends: the statuses, the result line, a 429’s time, and an outcome not known never offered Retry', () => {
  assert.equal(statusOf('ready').word, 'Sending');
  assert.equal(statusOf('removed_outside').word, 'Removed outside');
  assert.equal(statusOf('weird').word, 'Not known', 'an unknown status is never read as sent');
  const s = (provider_key, status) => ({ provider_key, status });
  assert.deepEqual(resultSummary([s('x', 'sent'), s('beehiiv', 'sent'), s('facebook', 'failed')]), { title: 'Sent to 2 of 3', line: '2 places received it. Facebook did not. Nothing was sent anywhere else.' });
  assert.equal(resultSummary([s('x', 'unknown')]).line, 'No place received it yet. It is not known whether X did. Nothing was sent anywhere else.');
  assert.equal(resultSummary([s('x', 'sent')]).line, '1 place received it. Nothing was sent anywhere else.');
  assert.equal(failedLine({ provider_key: 'facebook', error_code: 'rate_limited', retry_after: '2026-10-26 14:20:00' }), 'Facebook is busy. Try again after 14:20.');
  assert.equal(failedLine({ provider_key: 'x', error_code: 'boom' }), 'X did not take it. Nothing was posted there.');
  const unknown = actionsOf({ status: 'unknown', retract: 'delete' }, true);
  assert.deepEqual([unknown.retry, unknown.check, unknown.markNotSent], [false, true, true]);
  assert.equal(actionsOf({ status: 'failed' }, true).retry, true);
  assert.deepEqual(actionsOf({ status: 'failed' }, false), { retry: false, check: false, markNotSent: false, retract: false, markRemoved: false, deleteOutside: false }, 'nothing for anyone but the founder');
  assert.equal(actionsOf({ status: 'sent', retract: 'delete' }, true).retract, true);
  const outside = actionsOf({ status: 'sent', retract: 'none', external_url: 'https://example.test/t' }, true);
  assert.deepEqual([outside.retract, outside.markRemoved, outside.deleteOutside], [false, true, true]);
  assert.equal(actionsOf({ status: 'sent', retract: 'none', external_url: 'javascript:alert(1)' }, true).deleteOutside, false);
  assert.equal(viewLink({ status: 'sent', provider_key: 'beehiiv', audience: 'Draft only: not sent to subscribers', external_url: 'https://example.test/b' }).label, 'Open in Beehiiv ↗');
  assert.equal(viewLink({ status: 'retracted', external_url: 'https://example.test/x' }), null);
  assert.equal(NOT_KNOWN('X'), 'Not known whether this arrived. Check X before sending again.');
  assert.equal(retractNote({ provider_key: 'tiktok', retract: 'none' }), 'Axal VC cannot delete posts on TikTok. Delete it there, then mark it here.');
});

test('a history row, the detail’s facts and the search', () => {
  const r = historyRow(HISTORY[0]);
  assert.deepEqual([r.day, r.time, r.module, r.account, r.provider, r.status.word, r.link.label], ['26 Oct 2026', '14:02', 'Product improvement', '@northwind_demo', 'X', 'Sent', 'View on X ↗']);
  assert.equal(historyRow(HISTORY[3]).audience, 'Inbox draft');
  const facts = detailFacts(HISTORY[0], 1);
  assert.deepEqual(facts.map((f) => [f.k, f.v]), [['Account', '@northwind_demo on X'], ['Audience', 'Public'], ['Confirmed by', 'You · 26 Oct 2026, 14:01'], ['Sent at', '26 Oct 2026, 14:02'], ['Post ID', '1849273650012345678']]);
  assert.equal(detailFacts(HISTORY[0], 9)[2].v, 'The founder · 26 Oct 2026, 14:01');
  assert.deepEqual(filterRows(HISTORY, { q: 'csv' }).map((s) => s.uid), ['h1', 'h2', 'h4']);
});

// ---------------------------------------------------------------- the sheet

test('PUB1: nothing is pre-ticked, an off place is muted with its link, and Review and send waits for text and a place', async () => {
  const { api, calls } = stubApi();
  const v = await mount(sheet(api));
  try {
    assert.equal(v.props('publish-sheet').style.width, 560, 'the shared Sheet at 560px');
    assert.match(v.text('publish-sheet'), /Publish from · Product improvementPublish to…/);
    for (const uid of ['d-x', 'd-bh', 'd-fb', 'd-tt']) assert.equal(v.props(`publish-dest-${uid}-box`).checked, false, `${uid} is not pre-ticked`);
    assert.equal(v.props('publish-dest-d-tt-box').disabled, true);
    assert.match(v.text('publish-dest-d-tt'), /@northwind\.demo on TikTokOff for this companyTurn on/);
    assert.equal(v.text('publish-ticked'), '0 of 3 ticked');
    assert.equal(v.props('publish-review').disabled, true);
    assert.equal(v.text('publish-why'), 'Write your post to continue.');
    assert.match(v.text('publish-preview-waits'), /A preview for each place appears when there is text\./);
    assert.match(v.text('publish-check-waits'), /The check runs when there is text to send\./);
    assert.ok(!calls.some(([k]) => k === 'createDraft'), 'no draft until there is text');
  } finally { await v.close(); }
});

test('PUB3: a finding is highlighted and listed, Review and send is off, and only fixing it (or the named member’s consent) turns it on', async () => {
  const TEXT = 'Shipped bulk CSV import. Write to ops@northwind-demo.example. Thanks to Avery Example.';
  const lintFor = (text, body) => [
    ...(text.includes('ops@') ? [EMAIL(text)] : []),
    ...(text.includes('Avery') && !(body.named_consent || []).includes(7) ? [NAMED(text)] : []),
  ];
  const { api, calls } = stubApi({ lintFor });
  const v = await mount(sheet(api));
  try {
    await v.change('publish-text', TEXT);
    await v.change('publish-dest-d-x-box', true);
    await v.change('publish-dest-d-fb-box', true);
    assert.deepEqual(calls.find(([k]) => k === 'createDraft')[1], { project_id: P, module: 'product-improvement', text: TEXT });
    assert.deepEqual(calls.filter(([k]) => k === 'preview').pop()[2], ['d-x', 'd-fb'], 'previews the ticked places, in the order ticked');
    assert.match(v.text('publish-check-findings'), /2 to fix/);
    assert.match(v.text('publish-finding-email'), /Email addressops@northwind-demo\.exampleRemove it from the text\./);
    assert.match(v.text('publish-highlight'), /ops@northwind-demo\.example/);
    assert.equal(v.props('publish-review').disabled, true, 'Review and send is off with a finding');
    assert.equal(v.text('publish-why'), 'Remove the highlighted text to continue.');
    assert.match(v.text(), /A finding is fixed in the text\. Nothing sends past one\./);
    assert.ok(!v.all((p) => /override|send anyway/i.test(p.children || '')).length);
    // Consent clears the named member, saved to the draft; the email still blocks.
    await v.change('publish-consent-7', true);
    assert.deepEqual(calls.filter(([k]) => k === 'saveDraft').pop()[2].named_consent, [7]);
    assert.match(v.text('publish-check-findings'), /1 to fix/);
    assert.match(v.text('publish-cleared'), /They agreed to be named.*Cleared/);
    assert.equal(v.props('publish-review').disabled, true);
    await v.change('publish-text', TEXT.replace(' Write to ops@northwind-demo.example.', ''));
    assert.match(v.text('publish-check-passed'), /Check passed\. No email addresses, keys, Axal member names or team-only figures in the text\./);
    assert.equal(v.props('publish-review').disabled, false);
    assert.equal(v.props('publish-counter')['aria-label'].endsWith('of 280 characters'), true, 'the counter has its text equivalent');
  } finally { await v.close(); }
});

test('PUB4 and PUB5: the confirm names every account and audience with focus on Cancel; Send confirms once per place; the result says 2 of 3, with Retry for that place only', async () => {
  const { api, calls } = stubApi({ outcome: { 'd-fb': 'failed' } });
  const v = await mount(sheet(api));
  try {
    await v.change('publish-text', 'Shipped in October: bulk CSV import, faster search, and SSO for teams.');
    for (const uid of ['d-x', 'd-bh', 'd-fb']) await v.change(`publish-dest-${uid}-box`, true);
    assert.equal(v.props('publish-review').disabled, false);
    assert.ok(!calls.some(([k]) => k === 'confirm'), 'nothing sends before the confirm');
    await v.click('publish-review');
    assert.match(v.text('publish-confirm'), /^.*Send to 3 places\?/);
    assert.match(v.text('publish-confirm-row-d-x'), /@northwind_demo on XPublic · Can be deleted later/);
    assert.match(v.text('publish-confirm-row-d-bh'), /Northwind Notes on BeehiivDraft only: not sent to subscribers/);
    assert.match(v.text('publish-confirm-row-d-fb'), /Northwind Data on FacebookPublic · Cannot be deleted from Axal VC/);
    assert.match(v.text('publish-confirm'), /This posts in your name\. Nothing else is sent\./);
    assert.equal(document.activeElement, v.node('publish-confirm-cancel'), 'focus starts on Cancel');
    // Cancel sends nothing; opening again makes new keys.
    await v.click('publish-confirm-cancel');
    assert.ok(!v.has('publish-confirm') && !calls.some(([k]) => k === 'confirm'));
    await v.click('publish-review');
    // Two presses at once: one confirm per place, each with its own key, the same on a repeat.
    await act(async () => { const go = v.props('publish-confirm-send').onClick; await Promise.all([go(), go()]); });
    await v.settle();
    const confirms = calls.filter(([k]) => k === 'confirm');
    assert.deepEqual(confirms.map(([, , b]) => b.destination_uid), ['d-x', 'd-bh', 'd-fb'], 'one confirm per place, even for two presses');
    assert.equal(new Set(confirms.map(([, , b]) => b.idempotency_key)).size, 3);
    assert.ok(confirms.every(([, uid, b]) => uid === 'draft-1' && b.envelope_hash.startsWith('hash-')));
    assert.match(v.text('publish-sheet'), /Sent to 2 of 3Confirmed by you · /);
    assert.equal(v.text('publish-result-line'), '2 places received it. Facebook did not. Nothing was sent anywhere else.');
    assert.match(v.text('publish-failed-s-d-fb'), /Facebook is busy\. Try again after 14:20\./);
    assert.match(v.text('publish-result-s-d-x'), /View on X ↗/);
    assert.match(v.text('publish-result-s-d-bh'), /Open in Beehiiv ↗/);
    await v.click('publish-retry-s-d-fb');
    assert.match(v.text('publish-confirm'), /Send to 1 place\?.*Northwind Data on Facebook/s);
    await v.click('publish-confirm-send');
    assert.deepEqual(calls.filter(([k]) => k === 'retry'), [['retry', 's-d-fb']]);
    assert.match(v.text('publish-sheet'), /Sent to 3 of 3/);
    assert.equal(v.props('publish-open-history').href, '/grow/reporting#published-outside');
  } finally { await v.close(); }
  assert.ok(!calls.some(([k]) => k === 'archiveDraft'), 'a sent draft is kept');
});

test('PUB6 in the result: an outcome not known has Check and Mark as not sent, never Retry; a refused confirm says why', async () => {
  const { api } = stubApi({ outcome: { 'd-x': 'unknown', 'd-fb': 'refused' } });
  const v = await mount(sheet(api));
  try {
    await v.change('publish-text', 'Shipped.');
    await v.change('publish-dest-d-x-box', true);
    await v.change('publish-dest-d-fb-box', true);
    await v.click('publish-review');
    await v.click('publish-confirm-send');
    assert.match(v.text('publish-sheet'), /Sent to 0 of 2/);
    assert.equal(v.text('publish-unknown-s-d-x'), 'Not known whether this arrived. Check X before sending again.');
    assert.ok(v.has('publish-check-s-d-x') && v.has('publish-mark-not-sent-s-d-x'));
    assert.ok(!v.has('publish-retry-s-d-x'), 'never Retry on an outcome not known');
    assert.equal(v.text('publish-refused-refused-d-fb'), 'This place has reached its posts for today. Try again tomorrow.');
    await v.click('publish-mark-not-sent-s-d-x');
    assert.match(v.text('publish-not-sent'), /Mark as not sent\?Do this only after you checked X and the post is not there\.If it did arrive, sending it again posts it twice\./);
  } finally { await v.close(); }
});

test('closing a draft nobody kept archives it; Save draft keeps it; a co-founder reads that only the founder publishes', async () => {
  const one = stubApi();
  const v = await mount(sheet(one.api));
  await v.change('publish-text', 'Draft words.');
  await v.close();
  assert.deepEqual(one.calls.filter(([k]) => k === 'archiveDraft'), [['archiveDraft', 'draft-1']]);
  const two = stubApi();
  const w = await mount(sheet(two.api));
  await w.change('publish-text', 'Draft words.');
  await w.click('publish-save');
  assert.match(w.text('publish-saved'), /Draft saved\./);
  await w.close();
  assert.ok(!two.calls.some(([k]) => k === 'archiveDraft'), 'a saved draft stays');
  const co = stubApi({ destinations: { can_publish: false, connections: [] } });
  const c = await mount(sheet(co.api));
  try {
    assert.match(c.text('publish-founder-only'), /Only the founder publishes for this company\./);
    await c.change('publish-text', 'x');
    assert.equal(c.props('publish-review').disabled, true);
  } finally { await c.close(); }
  const err = stubApi({ destinations: Object.assign(new Error('Your places could not be read.'), { status: 500 }) });
  const e = await mount(sheet(err.api));
  try { assert.match(e.text('publish-dest-error'), /Your places could not be read\.Try again/); } finally { await e.close(); }
});

// ---------------------------------------------------------------- the history

test('PUB9: Published outside lists the sends with their pills and links, filters through the Worker and searches here', async () => {
  const { api, calls } = stubApi({ sends: HISTORY });
  const v = await mount(h(PublishedOutside, { projectId: P, api }));
  try {
    assert.match(v.text('published-outside'), /^Published outside4/);
    assert.match(v.text('published-row-h1'), /26 Oct 202614:02Product improvement.*@northwind_demo.*Sent.*View on X ↗/s);
    assert.match(v.text('published-row-h2'), /Failed/);
    assert.ok(v.has('published-retry-h2'), 'the founder has Retry on a failed row');
    assert.match(v.text('published-row-h3'), /Not known/);
    assert.ok(!v.has('published-retry-h3'));
    await v.change('published-filter-status', 'failed');
    assert.deepEqual(calls.filter(([k]) => k === 'sends').pop(), ['sends', P, { module: '', provider: '', status: 'failed' }]);
    await v.change('published-filter-status', '');
    await v.change('published-search', 'seconds');
    assert.ok(v.has('published-row-h4') && !v.has('published-row-h1'));
    await v.change('published-search', 'nothing like this');
    assert.equal(v.text('published-none'), 'Nothing matches these filters.');
    await v.change('published-search', '');
    await v.click('published-retry-h2');
    assert.match(v.text('publish-confirm'), /Send to 1 place\?.*Northwind Data on Facebook/s);
  } finally { await v.close(); }
});

test('a deep link opens a row’s detail as a Sheet; ×, Escape and the scrim close it to the list’s address', async () => {
  const { api } = stubApi({ sends: HISTORY });
  const v = await mount(h(PublishedOutside, { projectId: P, api, viewerId: 1 }), '/grow/reporting?sent=h1');
  try {
    assert.match(v.text('published-detail'), /Published outside@northwind_demo on XProduct improvement · 26 Oct 2026, 14:02/);
    assert.equal(v.text('published-text'), HISTORY[0].text);
    assert.match(v.text('published-detail-h1'), /Confirmed byYou · 26 Oct 2026, 14:01.*Post ID1849273650012345678/s);
    assert.ok(v.has('publish-retract-open-h1'), 'X lets Axal VC delete it');
    await v.escape();
    assert.equal(v.where(), '/grow/reporting#published-outside', 'Escape closes to the list');
    assert.ok(!v.has('published-detail'));
    // A row's Open puts the uid in the address; × closes it again.
    const opener = v.node('published-open-h4');
    opener.focus();
    await v.click('published-open-h4');
    assert.equal(v.where(), '/grow/reporting?sent=h4#published-outside');
    assert.match(v.text('published-detail-h4'), /Axal VC cannot delete posts on TikTok\. Delete it there, then mark it here\./);
    await v.click('published-detail-close');
    assert.equal(v.where(), '/grow/reporting#published-outside');
    assert.equal(document.activeElement, opener, 'focus returns to the row that opened it');
  } finally { await v.close(); }
});

test('PUB7 and PUB6 in the detail: Retract asks first; Mark as removed; Check; a link to a post not in the list is read on its own', async () => {
  const { api, calls } = stubApi({ sends: HISTORY, one: { ...HISTORY[0], uid: 'h9' } });
  const v = await mount(h(PublishedOutside, { projectId: P, api }), '/grow/reporting?sent=h1');
  try {
    await v.click('publish-retract-open-h1');
    assert.match(v.text('publish-retract'), /Delete this post from @northwind_demo on X\?People who saw it may have copied it\.The row then reads Retracted\. Your text stays in the history\./);
    assert.equal(document.activeElement, v.node('publish-retract-cancel'));
    assert.ok(!calls.some(([k]) => k === 'retract'), 'opening the dialog deletes nothing');
    await v.click('publish-retract-yes');
    assert.deepEqual(calls.filter(([k]) => k === 'retract'), [['retract', 'h1']]);
    assert.match(v.text('published-row-h1'), /Retracted/);
  } finally { await v.close(); }
  const t = await mount(h(PublishedOutside, { projectId: P, api }), '/grow/reporting?sent=h4');
  try {
    await t.click('publish-mark-removed-h4');
    assert.match(t.text('published-row-h4'), /Removed outside/);
  } finally { await t.close(); }
  const u = await mount(h(PublishedOutside, { projectId: P, api }), '/grow/reporting?sent=h3');
  try {
    assert.match(u.text('published-detail-h3'), /Not known whether this arrived\. Check X before sending again\.X did not answer before the connection timed out\. Axal VC will not send it again on its own\./);
    assert.ok(!u.has('publish-retry-h3'));
    await u.click('publish-check-h3');
    assert.deepEqual(calls.filter(([k]) => k === 'check'), [['check', 'h3']]);
  } finally { await u.close(); }
  const w = await mount(h(PublishedOutside, { projectId: P, api }), '/grow/reporting?sent=h9');
  try { assert.ok(w.has('published-detail-h9')); assert.deepEqual(calls.filter(([k]) => k === 'send'), [['send', 'h9']]); } finally { await w.close(); }
});

test('the team reads without actions; outside the team the list is not drawn; an unreadable read says so', async () => {
  const co = stubApi({ sends: HISTORY, destinations: { can_publish: false, connections: [] } });
  const v = await mount(h(PublishedOutside, { projectId: P, api: co.api }), '/grow/reporting?sent=h2');
  try {
    assert.ok(v.has('published-row-h2') && !v.has('published-retry-h2'));
    assert.ok(!v.has('publish-retry-h2') && !v.has('publish-retract-open-h2'));
  } finally { await v.close(); }
  const out = stubApi({ sendsError: Object.assign(new Error('That is not here, or not yours to see.'), { code: 'not_found', status: 404 }) });
  const o = await mount(h(PublishedOutside, { projectId: P, api: out.api }));
  try { assert.ok(!o.has('published-outside')); } finally { await o.close(); }
  const bad = stubApi({ sendsError: Object.assign(new Error('Publishing could not finish that request.'), { status: 500 }) });
  const b = await mount(h(PublishedOutside, { projectId: P, api: bad.api }));
  try { assert.match(b.text('published-error'), /Unreadable: Publishing could not finish that request\.Try again/); } finally { await b.close(); }
  const none = stubApi({ sends: [] });
  const n = await mount(h(PublishedOutside, { projectId: P, api: none.api }));
  try { assert.equal(n.text('published-none'), 'Nothing published outside Axal VC yet.'); } finally { await n.close(); }
});

// ---------------------------------------------------------------- the house rules

test('phone, dark and the house rules: 44px targets, a dark pair on every surface, the shared Sheet, no browser pop-up, never push, and the desk mounts the list', () => {
  const dir = 'frontend/src/pages/cycles/publish';
  const files = readdirSync(resolve(process.cwd(), dir)).filter((f) => /\.jsx?$/.test(f));
  const src = files.map((f) => read(`${dir}/${f}`)).join('\n');
  assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(|\balert\(/, 'no browser pop-up');
  assert.doesNotMatch(src, /publishApi\.push|\bapi\.push|autopush/, 'publishing is never push');
  assert.doesNotMatch(src, /\b(claude|gpt-|openai)\b/i, 'no model name');
  const ui = files.filter((f) => f.endsWith('.jsx')).map((f) => read(`${dir}/${f}`)).join('\n');
  for (const cls of ui.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    const c = cls[1] || cls[2];
    if (/\bbg-(white|violet-50|red-50|emerald-50|amber-50|\[#f7f6fa\])\b/.test(c)) assert.match(c, /dark:/, `a light surface with no dark pair: ${c.slice(0, 80)}`);
  }
  assert.match(read(`${dir}/SendParts.jsx`), /export const BTN = 'inline-flex min-h-\[44px\]/, 'every button is 44px');
  assert.match(read(`${dir}/SendParts.jsx`), /items-end justify-center .* sm:items-center/, 'the confirm is a bottom sheet on a phone (PUB10B)');
  assert.match(read(`${dir}/PublishSheet.jsx`), /<Sheet [^>]*width=\{560\}/, 'the sheet is the shared Sheet at 560px');
  assert.match(read(`${dir}/PublishedOutside.jsx`), /sm:hidden/, 'the phone draws cards (PUB11)');
  assert.match(read('frontend/src/pages/cycles/ReportingDesk.jsx'), /<PublishedOutside projectId=\{projectId\} \/>/);
  assert.doesNotMatch(read('frontend/src/lib/api/publish.js'), /D1321/, 'part 1’s client is used as it is');
});
