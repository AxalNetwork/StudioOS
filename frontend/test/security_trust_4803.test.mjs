/**
 * D4803 (#4803, slice 4) — Security v2's Trust workspace (SE07a–c), read the
 * way a person reads it:
 *   - the pure model with payloads shaped like `/overview` and the Trust
 *     Center admin read;
 *   - a mounted workspace: the blocks, Review changes…, the per-block diff,
 *     and Publish's four answers (published, stale, unconfirmed, refused).
 *
 * The rules under test: sanctions and KYC are separate and each says when it
 * could not be read; a draft is compared line by line with the published
 * revision; drafts that changed since the review publish nothing (SE07c);
 * a retry resends the same key and a changed note gets a new one; notice
 * delivery is what was recorded, and mail not configured says so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import {
  bodyLines, kycBlock, lineDiff, noticesBlock, publishResultOf, publishSections, publishingBlock, sanctionsBlock,
} from '../src/pages/hq/security/trustModel.js';
import TrustWorkspace from '../src/pages/hq/security/TrustWorkspace.jsx';
import { SecurityConsole, UNAVAILABLE } from '../src/pages/hq/SecurityPage.jsx';

const h = React.createElement;
const NOW = Date.UTC(2026, 10, 9, 12);

// ───────────────────────────────────────────────────────────── fixtures ──

const SANCTIONS = (over = {}) => ({
  available: true, runs_total: 4, last_run_at: '2026-11-05 16:20:00', hits_total: 1, unreviewed_hits: 0,
  reviewed_hits: 1, last_reviewed_at: '2026-10-12 10:00:00', last_run_hit: false, path: '/trust', how: 'On request.', ...over,
});
const LINES = (lines, intro = null) => ({ intro, groups: [{ title: null, lines: lines.map((text) => ({ text, recorded: true, why: null, checked_at: '2026-10-01' })) }] });
const READ = (over = {}) => ({
  blocks: [
    { key: 'data', label: 'Data and privacy', published: { body: LINES(['Backups are kept for 30 days.', 'Data stays in the EU.']) }, draft: { body: LINES(['Backups are kept for 35 days.', 'Data stays in the EU.']) } },
    { key: 'security', label: 'Security', published: { body: LINES(['TLS everywhere.']) }, draft: null },
  ],
  subprocessors: [
    { uid: 'sp1', name: 'Resend', purpose: 'transactional email', location: 'EU and US', state: 'draft', starts_at: '2026-12-01' },
    { uid: 'sp2', name: 'Old Mail', purpose: 'email', location: 'US', state: 'removing', starts_at: '2025-01-01' },
    { uid: 'sp3', name: 'Stripe', purpose: 'payments', location: 'US', state: 'published', starts_at: '2025-01-01' },
  ],
  reports: [],
  changes: { items: [], complete: true },
  subscribers: { confirmed: 38, pending: 4, unsubscribed: 1 },
  revision: { available: true, revision: 18, published_at: '2026-10-28T09:00:00.000Z' },
  notices: { available: true, mail_configured: true, rows: [
    { uid: 'n1', name: 'Resend', starts_at: '2026-12-01', started: false, sending: 1, sent: 30, failed: 0, not_sent: 7 },
    { uid: 'n2', name: 'Stripe', starts_at: '2026-11-01', started: true, sending: 0, sent: 36, failed: 2, not_sent: 0 },
  ] },
  read_at: '2026-11-09T14:29:40.000Z',
  pending_token: 'ab'.repeat(32),
  ...over,
});
const OVERVIEW = () => ({ sanctions: SANCTIONS(), kyc: { pending: 2, approved: 9, rejected: 1 }, kyc_available: true });

// ──────────────────────────────────────────────────────────────── model ──

test('sanctions: unreviewed hits lead; zero runs is "none yet"; the last run says match or no match; unreadable says so', () => {
  const ok = sanctionsBlock(SANCTIONS());
  assert.deepEqual([ok.state, ok.label], ['measured_zero', '0 unreviewed hits']);
  assert.match(Object.fromEntries(ok.facts)['Last screening'], /5 Nov 2026, 16:20 UTC · no match/);
  assert.match(Object.fromEntries(ok.facts)['Reviewed hits'], /^1 \(latest reviewed 12 Oct 2026/);
  assert.equal(sanctionsBlock(SANCTIONS({ unreviewed_hits: 2 })).state, 'action_required');
  const never = sanctionsBlock(SANCTIONS({ runs_total: 0, last_run_at: null, last_run_hit: null }));
  assert.equal(never.state, 'no_data_yet');
  assert.equal(Object.fromEntries(never.facts)['Last screening'], 'None has been asked for');
  assert.match(Object.fromEntries(sanctionsBlock(SANCTIONS({ last_run_hit: null })).facts)['Last screening'], /result not recorded/);
  const u = sanctionsBlock({ available: false, reason: 'No table.' });
  assert.deepEqual([u.state, u.reason], ['unavailable', 'No table.']);
});

test('KYC is its own block: pending leads, unreadable is never zeros', () => {
  assert.deepEqual(kycBlock(OVERVIEW()).rows, [['Pending', 2], ['Approved', 9], ['Rejected', 1]]);
  assert.equal(kycBlock(OVERVIEW()).state, 'action_required');
  const u = kycBlock({ kyc_available: false, kyc_reason: 'down' });
  assert.deepEqual([u.state, u.rows], ['unavailable', []]);
});

test('a draft is compared line by line with what is published, repeats counted', () => {
  assert.deepEqual(bodyLines(LINES(['a', 'b'], 'intro')), ['intro', 'a', 'b']);
  assert.deepEqual(bodyLines({ items: [{ name: 'SOC 2', auditor: 'X', issued_on: '2026-01-01', expires_on: null }] }), ['SOC 2 · X · issued 2026-01-01']);
  assert.deepEqual(lineDiff(LINES(['a', 'b', 'b']), LINES(['b', 'c'])), { removed: ['a', 'b'], added: ['c'] });
  assert.deepEqual(lineDiff(LINES(['a']), LINES(['a'])), { removed: [], added: [] });
});

test('the review: one section per draft block, and the subprocessor list\'s own changes', () => {
  const r = publishSections(READ(), NOW);
  assert.deepEqual(r.sections.map((s) => s.key), ['data', 'subprocessors']);
  const data = r.sections[0];
  assert.deepEqual([data.removed, data.added, data.summary], [['Backups are kept for 30 days.'], ['Backups are kept for 35 days.'], '2 lines changed']);
  const subs = r.sections[1];
  assert.deepEqual(subs.added, ['Resend · transactional email · EU and US · from 1 Dec 2026']);
  assert.deepEqual(subs.removed, ['Old Mail']);
  assert.equal(subs.summary, '1 added · 1 removed');
  const first = publishSections(READ({ blocks: [{ key: 'data', label: 'Data and privacy', published: null, draft: { body: LINES(['x']) } }], subprocessors: [] }), NOW);
  assert.equal(first.sections[0].summary, 'First publish of this block');
});

test('publishing: drafts lead as Action required; the revision, or that it could not be read', () => {
  const p = publishingBlock(READ());
  assert.deepEqual([p.state, p.label, p.draft, p.canReview], ['action_required', '2 draft changes', '2 blocks differ from published', true]);
  assert.match(p.published, /^Revision 18 · 28 Oct 2026, 09:00 UTC$/);
  const clean = publishingBlock(READ({ blocks: [], subprocessors: [] }));
  assert.deepEqual([clean.state, clean.canReview], ['healthy', false]);
  assert.equal(publishingBlock(READ({ blocks: [], subprocessors: [], revision: { available: true, revision: 0, published_at: null } })).state, 'no_data_yet');
  assert.match(publishingBlock(READ({ revision: { available: false, reason: 'x' } })).published, /could not be read/);
  assert.equal(publishingBlock({ unreadable: true }).state, 'unavailable');
});

test('notices: what was recorded per notice; failures and late subscribers lead; mail off says so', () => {
  const n = noticesBlock(READ());
  assert.equal(n.subscribers, '38 confirmed · 4 pending');
  assert.deepEqual(n.rows.map((r) => [r.state, r.word]), [['pending', 'In progress'], ['action_required', 'Some failed']]);
  assert.deepEqual(n.rows[0].counts, [['Queued', 7], ['Sending', 1], ['Sent', 30], ['Failed', 0]]);
  const late = noticesBlock(READ({ notices: { available: true, mail_configured: true, rows: [{ uid: 'x', name: 'X', starts_at: '2026-11-01', started: true, sending: 0, sent: 3, failed: 0, not_sent: 2 }] } }));
  assert.deepEqual(late.rows[0].counts.at(-1), ['Not sent before start', 2]);
  assert.deepEqual(late.rows[0].counts[0], ['Queued', 0], 'subscribers after the start day read as still queued');
  assert.equal(late.rows[0].state, 'action_required');
  const off = noticesBlock(READ({ notices: { ...READ().notices, mail_configured: false } }));
  assert.equal(off.mailConfigured, false);
  assert.equal(off.state, 'action_required', 'undelivered notices with no mail configured read as fine');
  assert.equal(noticesBlock(READ({ notices: { available: true, mail_configured: true, rows: [] } })).state, 'measured_zero');
  assert.equal(noticesBlock(READ({ notices: { available: false, reason: 'x' } })).state, 'unavailable');
});

test('a Publish\'s answer: done, stale, unconfirmed or refused — only refusals are certain', () => {
  assert.equal(publishResultOf({ ok: true, notices: 'queued' }, null).notices, true);
  assert.equal(publishResultOf(null, Object.assign(new Error('x'), { status: 409, code: 'changed_since_review' })).result, 'stale');
  assert.equal(publishResultOf(null, new TypeError('Failed to fetch')).result, 'unconfirmed');
  assert.equal(publishResultOf(null, Object.assign(new Error('x'), { status: 503, code: 'not_confirmed' })).result, 'unconfirmed');
  const r = publishResultOf(null, Object.assign(new Error('nothing_to_publish'), { status: 409, code: 'nothing_to_publish' }));
  assert.equal(r.result, 'refused');
  assert.match(r.message, /nothing to publish/);
});

// ───────────────────────────────────────────────────────────── renders ──

const consoleHtml = (tab, data) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [`/admin/security?tab=${tab}`] },
    h(SecurityConsole, {
      tab, data, load: () => {}, feed: null, filter: 'all', setFilter: () => {},
      loadFeed: () => {}, sessionList: null, loadSessions: () => {}, onSessionAct: async () => ({}),
    })),
);

test('on the page: Trust leads, the previous zones are behind the disclosure, and unreadable is said once', () => {
  const out = consoleHtml('trust', OVERVIEW());
  assert.ok(out.indexOf('trust-workspace') < out.indexOf('trust-how'));
  assert.ok(out.indexOf('trust-how') < out.indexOf('data-testid="hq-sanctions"'), 'the previous zone is not behind the disclosure');
  const t = renderedText(consoleHtml('trust', UNAVAILABLE));
  const lead = t.slice(0, t.indexOf('How this is measured'));
  assert.match(lead, /Sanctions and KYC could not be read/);
  assert.doesNotMatch(lead, /not a claim that nothing happened/, 'the page banner was drawn as well');
});

// ───────────────────────────────────────────────────── mounted journey ──

async function mount(api) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(TrustWorkspace, { overview: OVERVIEW(), api }))); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  return {
    has: (id) => Boolean(byId(id)),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    props: (id) => props(byId(id)) || {},
    async click(id) { const p = props(byId(id)); assert.ok(p?.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const p = props(byId(id)); assert.ok(p?.onChange, `no ${id}`); await act(async () => { p.onChange({ target: { value } }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('Review changes… shows the per-block diff against revision 18, and Publish sends the token read with it', async () => {
  const sent = [];
  let reads = 0;
  const api = { read: async () => { reads += 1; return READ(); }, publish: async (note, review) => { sent.push({ note, ...review }); return { ok: true, notices: 'queued', blocks: ['data'] }; } };
  const m = await mount(api);
  try {
    assert.match(m.of('trust-sanctions'), /0 unreviewed hits/);
    assert.match(m.of('trust-kyc'), /2 awaiting review/);
    assert.match(m.of('trust-publishing'), /Revision 18/);
    assert.match(m.of('trust-notices'), /Resend · starts 1 Dec 2026/);
    await m.click('trust-review');
    assert.match(m.of('trust-scope'), /public Trust Center/);
    assert.match(m.of('trust-scope'), /38 confirmed subscribers are emailed/);
    await m.click('trust-continue');
    assert.match(m.of('trust-against'), /published revision 18/);
    assert.match(m.of('trust-diff-data'), /Removed: Backups are kept for 30 days\./);
    assert.match(m.of('trust-diff-data'), /Added: Backups are kept for 35 days\./);
    assert.match(m.of('trust-diff-subprocessors'), /Resend · transactional email/);
    assert.equal(m.of('trust-read-at'), '14:29:40 UTC');
    await m.click('trust-publish');
    assert.equal(sent.length, 0, 'a Publish went without a change note');
    await m.type('trust-note', 'Add Resend; retention 35 days');
    await m.click('trust-publish');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].pending_token, READ().pending_token, 'the Publish does not carry the reviewed token');
    assert.match(String(sent[0].publish_key), /^op_[0-9a-f]{32}$/);
    assert.equal(m.props('trust-result')['data-result'], 'done');
    assert.match(m.of('trust-result'), /notices are queued/);
    assert.equal(reads, 2, 'a published change did not re-read the Trust Center');
  } finally { await m.unmount(); }
});

test('drafts changed since the review: not published, and Reload and review re-reads (SE07c)', async () => {
  let reads = 0;
  const api = { read: async () => { reads += 1; return READ(); }, publish: async () => { throw Object.assign(new Error('changed'), { status: 409, code: 'changed_since_review' }); } };
  const m = await mount(api);
  try {
    await m.click('trust-review');
    await m.click('trust-continue');
    await m.type('trust-note', 'Add Resend; retention 35 days');
    await m.click('trust-publish');
    assert.equal(m.props('trust-result')['data-result'], 'stale');
    assert.match(m.of('trust-result'), /Not published/);
    assert.match(m.of('trust-result'), /as of 14:29:40 UTC/);
    assert.equal(m.has('trust-publish'), false, 'a second Publish of the old review is still offered');
    await m.click('trust-reload');
    assert.equal(reads, 2);
    assert.equal(m.has('trust-dialog'), false);
  } finally { await m.unmount(); }
});

test('no answer is unconfirmed; Try again resends the same key, and a changed note gets a new one', async () => {
  const sent = [];
  const api = { read: async () => READ(), publish: async (note, review) => { sent.push({ note, ...review }); throw new TypeError('Failed to fetch'); } };
  const m = await mount(api);
  try {
    await m.click('trust-review');
    await m.click('trust-continue');
    await m.type('trust-note', 'Add Resend; retention 35 days');
    await m.click('trust-publish');
    assert.equal(m.props('trust-result')['data-result'], 'unconfirmed');
    assert.match(m.of('trust-result'), /could not be confirmed/);
    await m.click('trust-retry');
    await m.click('trust-publish');
    await m.click('trust-retry');
    await m.type('trust-note', 'Add Resend; keep backups for 35 days');
    await m.click('trust-publish');
    assert.equal(sent.length, 3);
    assert.equal(sent[0].publish_key, sent[1].publish_key, 'the retry carried a new key');
    assert.notEqual(sent[1].publish_key, sent[2].publish_key, 'a different note reused the earlier Publish\'s key');
  } finally { await m.unmount(); }
});

test('an unreadable Trust Center read is its own state; sanctions and KYC still draw', async () => {
  const api = { read: async () => { throw new Error('down'); }, publish: async () => ({}) };
  const m = await mount(api);
  try {
    assert.equal(m.props('trust-publishing')['data-state'], 'unavailable');
    assert.match(m.of('trust-publishing'), /not a claim that nothing is waiting to publish/);
    assert.equal(m.props('trust-sanctions')['data-state'], 'measured_zero');
    assert.equal(m.has('trust-review'), false);
  } finally { await m.unmount(); }
});
