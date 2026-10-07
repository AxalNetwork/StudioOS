/**
 * D633 (#1391) — the Ops canvas's HQ screens Q1–Q3, each rendered from its
 * real component in its states.
 *
 *   Q1 `hq-contracts`    HQ · Contracts: a type's registry state, and a draft's
 *                        Publish that waits for the fresh sign-in check;
 *   Q2 `hq-credits`      HQ · Team → a member's credits: balance, ledger,
 *                        Adjust credits and its three refusals;
 *   Q3 `hq-obligations`  HQ · Security → trust obligations by role, from
 *                        `trustMatrix`, Unreadable on a failed read.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ops_area7_d633.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  DocTypeRegistry, DraftPublishView, PUBLISHED_SAVE_NOTE, PUBLISH_WAITING, registryState,
} from '../src/pages/hq/ContractsPage.jsx';
import { AdjustForm, BalanceCard, LedgerTable } from '../src/pages/hq/MemberCreditsPage.jsx';
import { RoleCard } from '../src/pages/hq/TrustObligationsPage.jsx';
import {
  adjustRefusal, changeText, filterLedger, newSourceRef, pageOf, planAdjust, sourceOf, submitAdjust,
} from '../src/lib/memberCredits.js';
import { ROLES, rowsFor, validity } from '../src/lib/trustObligations.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const ready = (data) => ({ status: 'ready', data });
const noop = () => {};

// ─────────────────────────────── Q1 · document types ──

const PUBLISHED = { doc_type: 'side_letter', title: 'Side letter', layer: 'gp', party_roles: ['founder'], usage_count: 2, registry_status: 'published', overlap: true,
  published: { at: '2026-10-05 09:00:00', by: 1, by_name: 'Sam Super', reason: 'Counsel approved the text' }, pending_draft: null };
const DRAFT = { doc_type: 'term_sheet', title: 'Term sheet', layer: 'gp', party_roles: ['founder', 'investor'], usage_count: 0, registry_status: 'draft', overlap: true, pending_draft: null };
const CODE = { doc_type: 'nda', title: 'NDA', layer: 'compliance', party_roles: ['partner'], usage_count: 5, registry_status: 'code', overlap: false, pending_draft: null };
const HUB = { type_count: 3, items: [PUBLISHED, DRAFT, CODE], layers: [], health: [], decisions: {} };

test('Q1: each type reads In code only, Draft, or Published with when, by whom and the reason', () => {
  assert.deepEqual(registryState(CODE), { label: 'In code only', tone: 'grey', meta: 'No draft yet' });
  assert.equal(registryState(DRAFT).label, 'Draft');
  const pub = registryState(PUBLISHED);
  assert.equal(pub.label, 'Published');
  assert.match(pub.meta, /Sam Super · “Counsel approved the text”$/);
  assert.match(registryState({ ...PUBLISHED, published: { ...PUBLISHED.published, by_name: null } }).meta, /Admin #1/);
  assert.match(registryState({ ...PUBLISHED, published: null }).nr, /went live before publishing was recorded/);
  assert.match(registryState({ ...PUBLISHED, published: { ...PUBLISHED.published, at: null } }).nr, /went live before publishing was recorded/);
  assert.match(registryState({ ...PUBLISHED, published: { ...PUBLISHED.published, reason: null } }).meta, /no reason recorded/);
});

test('Q1: the registry draws each state, the overlap mark, the published save rule, and Publish only on a draft for a Super Admin', () => {
  const sup = html(h(DocTypeRegistry, { data: HUB, onRetry: noop, canPublish: true }));
  assert.match(sup, /data-testid="registry-state-side_letter"[^]*?>Published</);
  assert.match(sup, /data-testid="registry-state-term_sheet"[^]*?>Draft</);
  assert.match(sup, /data-testid="registry-state-nda"[^]*?>In code only</);
  assert.equal((sup.match(/>OVERLAP</g) || []).length, 2, 'the two types sharing a layer and a party role are marked');
  assert.ok(sup.includes(`data-testid="registry-live-note-side_letter">${PUBLISHED_SAVE_NOTE}<`), 'the published save rule is stated on the published card');
  assert.doesNotMatch(sup, /registry-live-note-term_sheet|registry-live-note-nda/);
  assert.doesNotMatch(sup, /changes the live type at once/, 'the canvas sentence is not this app\'s rule (D615)');
  assert.match(sup, /data-testid="registry-draft-publish-term_sheet"/);
  assert.doesNotMatch(sup, /registry-draft-publish-side_letter|registry-draft-publish-nda/);
  const admin = html(h(DocTypeRegistry, { data: HUB, onRetry: noop, canPublish: false }));
  assert.doesNotMatch(admin, /registry-draft-publish-/, 'an admin without the elevation gets no Publish');
});

test('Q1: a publish waits for the fresh sign-in check, and its reason has a floor', () => {
  const idle = html(h(DraftPublishView, { row: DRAFT, reason: 'short', onReason: noop, phase: 'idle', error: '', onSubmit: noop }));
  assert.match(idle, /<button type="button"[^>]*disabled=""[^>]*data-testid="registry-draft-publish-button-term_sheet">Publish</);
  assert.match(idle, /asks you to sign in again before it goes through/);
  const ok = html(h(DraftPublishView, { row: DRAFT, reason: 'Counsel approved the text', onReason: noop, phase: 'idle', error: '', onSubmit: noop }));
  assert.doesNotMatch(ok, /disabled=""[^>]*data-testid="registry-draft-publish-button/);
  const waiting = html(h(DraftPublishView, { row: DRAFT, reason: 'Counsel approved the text', onReason: noop, phase: 'waiting', error: '', onSubmit: noop }));
  assert.match(waiting, />Waiting for sign-in…</);
  assert.ok(waiting.includes(`data-testid="registry-publish-waiting">${PUBLISH_WAITING}<`), 'the waiting line is drawn');
  assert.match(waiting, /<button type="button"[^>]*disabled=""/);
});

// ─────────────────────────────── Q2 · a member's credits ──

const LEDGER = [
  { id: 5, delta: -20, kind: 'admin_adjust', source_ref: 'revoke:1', rule_key: 'bug_low', note: 'Duplicate', created_at: '2026-10-06T10:00:00Z', revoked: false },
  { id: 4, delta: 50, kind: 'grant', source_ref: 'hq:x', rule_key: 'manual', note: 'Goodwill', created_at: '2026-10-05T10:00:00Z', revoked: false },
  { id: 3, delta: -25, kind: 'spend', source_ref: 'perk:abc', rule_key: null, note: '', created_at: '2026-08-01T10:00:00Z', revoked: false },
  { id: 1, delta: 20, kind: 'grant', source_ref: 'ticket:1', rule_key: 'bug_low', note: 'A bug', created_at: '2026-10-01T10:00:00Z', revoked: true },
];

test('Q2: each ledger line names its source, and the filters, period and pages work', () => {
  assert.deepEqual(LEDGER.map((l) => sourceOf(l).label), ['Taken back', 'Adjustment', 'Perk claimed', 'Bug bounty']);
  assert.deepEqual(['task_approved', 'lab:okrs_created', 'feature_shipped_high'].map((k) => sourceOf({ kind: 'grant', rule_key: k }).label), ['Task approved', 'Lab milestone', 'Feature shipped']);
  assert.equal(sourceOf({ kind: 'refund' }).label, 'Perk refunded');
  assert.deepEqual([changeText(10), changeText(-25)], ['+10', '−25']);
  assert.deepEqual(filterLedger(LEDGER, { source: 'perk' }).map((l) => l.id), [3]);
  assert.deepEqual(filterLedger(LEDGER, { source: 'taken_back' }).map((l) => l.id), [5]);
  assert.deepEqual(filterLedger(LEDGER, { source: 'reward' }).map((l) => l.id), [1]);
  assert.deepEqual(filterLedger(LEDGER, { q: 'goodwill' }).map((l) => l.id), [4]);
  const now = Date.parse('2026-10-07T00:00:00Z');
  assert.deepEqual(filterLedger(LEDGER, { period: '30' }, now).map((l) => l.id), [5, 4, 1]);
  assert.deepEqual(filterLedger(LEDGER, { period: '365' }, now).map((l) => l.id), [5, 4, 3, 1]);
  assert.equal(pageOf(Array.from({ length: 30 }), 2).count, '26–30 of 30');
});

test('Q2: the balance and ledger draw their states; a failed read is never a zero', () => {
  assert.match(text(h(BalanceCard, { read: ready({ balance: 50 }) })), /50 credits · US\$50 of perk value/);
  const bad = html(h(BalanceCard, { read: { status: 'unreadable', data: null } }));
  assert.match(bad, />Unreadable</);
  assert.doesNotMatch(bad, />0</);
  const lbad = html(h(LedgerTable, { read: { status: 'unreadable', data: null }, onRetry: noop }));
  assert.match(lbad, /Try again/);
  assert.doesNotMatch(lbad, /<table/);
  assert.match(text(h(LedgerTable, { read: ready({ ledger: [] }), onRetry: noop })), /No credit has been granted or spent yet/);
  const rows = html(h(LedgerTable, { read: ready({ ledger: LEDGER }), onRetry: noop }));
  assert.match(rows, /data-testid="ledger-row-3"[^]*?title="This entry was recorded without a note to the member\.">Not recorded</);
  assert.match(rows, /data-testid="ledger-row-1"[^]*?Bug bounty<span[^>]*>\(taken back\)/);
  assert.match(text(h(LedgerTable, { read: ready({ ledger: LEDGER }), onRetry: noop })), /1–4 of 4/);
});

test('Q2: an adjustment is planned before it is sent; the reason and the amount have rules', () => {
  const base = { userId: 4, amount: '+10', reason: 'Goodwill for the outage', note: 'Thanks', sourceRef: 'hq:a' };
  assert.deepEqual(planAdjust(base).body, { user_id: 4, delta: 10, reason: 'Goodwill for the outage', note: 'Thanks', source_ref: 'hq:a' });
  assert.equal(planAdjust({ ...base, amount: '−25' }).body.delta, -25);
  for (const amount of ['0', '', '1.5', 'ten', '100001', '-100001']) assert.match(planAdjust({ ...base, amount }).error, /whole number of credits, not zero/, amount);
  assert.match(planAdjust({ ...base, reason: 'too short' }).error, /at least 10 characters/);
  assert.match(planAdjust({ ...base, note: 'x'.repeat(501) }).error, /at most 500/);
  assert.equal(planAdjust({ ...base, note: '  ' }).body.note, undefined, 'an empty note is not sent');
  assert.match(newSourceRef(() => 'r1', 36), /^hq:10:r1$/);
  const minted = newSourceRef();
  assert.match(minted, /^hq:[0-9a-z]+:[0-9a-f]{8}$/);
  assert.notEqual(minted, newSourceRef());
  assert.equal(read('frontend/src/lib/memberCredits.js').includes('Math.random'), false);
  const html0 = html(h(AdjustForm, { userId: 4, onDone: noop, onCancel: noop, sourceRef: 'hq:a' }));
  assert.match(html0, /<button type="submit"[^>]*disabled=""/, 'submit waits for a reason');
});

test('Q2: the three refusals read as sentences: below zero, unknown member, the same change sent twice', async () => {
  const fail = (err) => async () => { throw err; };
  const form = { userId: 4, amount: '-30', reason: 'Reversing a duplicate', note: '', sourceRef: 'hq:a' };
  const below = await submitAdjust(form, fail(Object.assign(new Error('x'), { status: 400, code: 'would_overdraw', data: { balance: 20 } })));
  assert.deepEqual(below.refusal, { title: 'Balance would go below zero', text: 'The member has 20 credits. Nothing was changed.' });
  const unknown = await submitAdjust(form, fail(Object.assign(new Error('No such account.'), { status: 404, code: 'user_not_found' })));
  assert.deepEqual(unknown.refusal, { title: 'Unknown member', text: 'No account matches this id. Nothing was changed.' });
  const twice = await submitAdjust(form, fail(Object.assign(new Error('x'), { status: 409, code: 'already_recorded', data: { ledger_id: 9 } })));
  assert.equal(twice.refusal.title, 'Same change sent twice');
  assert.match(adjustRefusal({ status: 403 }).text, /Only the Super Admin/);
  const calls = [];
  const ok = await submitAdjust(form, async (b) => { calls.push(b); return { delta: -30, balance: 20 }; });
  assert.deepEqual([ok.ok, calls[0].source_ref, calls[0].delta], [true, 'hq:a', -30]);
  const notSent = await submitAdjust({ ...form, reason: 'short' }, async () => { throw new Error('must not be called'); });
  assert.equal(notSent.refusal.title, 'Not sent');
});

// ─────────────────────────────── Q3 · trust obligations ──

const FOUNDER = { role: 'founder', obligations: [
  { key: 'tos_v1', required: 1, ttlMs: null },
  { key: 'founder_nda_v1', required: 1, ttlMs: 2 * 365 * 24 * 60 * 60 * 1000 },
  { key: 'kyb_v1', required: 0, ttlMs: 365 * 24 * 60 * 60 * 1000 },
  { key: 'mentor_disclaimer_v1', required: 1, ttlMs: null },
] };

test('Q3: each obligation names itself, whether it is required, and how long it stays valid', () => {
  assert.deepEqual(rowsFor(FOUNDER.obligations).map((r) => [r.title, r.required, r.validity.text || null]), [
    ['Terms of service', true, 'Until the terms change'],
    ['Founder NDA', true, '24 months'],
    ['Company verification', false, '12 months'],
    ['Advisor disclaimer', true, null],
  ]);
  assert.match(validity({ key: 'mentor_disclaimer_v1', ttlMs: null }).reason, /does not expire/);
  assert.deepEqual(ROLES.map((r) => r.id), ['founder', 'investor', 'advisor', 'partner', 'admin']);
});

test('Q3: a role reads from trustMatrix, and a failed read is Unreadable with Try again, never an empty list', () => {
  const role = ROLES[0];
  const ok = html(h(RoleCard, { role, read: ready(FOUNDER), onRetry: noop }));
  assert.match(ok, /data-testid="obligation-founder-kyb_v1"[^]*?>Optional</);
  assert.match(ok, /data-testid="obligation-founder-founder_nda_v1"[^]*?>Required<[^]*?24 months/);
  assert.match(ok, /title="This obligation does not expire, so no period is recorded\.">Not recorded</);
  const bad = html(h(RoleCard, { role, read: { status: 'unreadable', data: null }, onRetry: noop }));
  assert.match(bad, /Unreadable\./);
  assert.match(bad, /Try again/);
  assert.doesNotMatch(bad, /carries no obligation/);
  assert.match(text(h(RoleCard, { role, read: ready({ obligations: [] }), onRetry: noop })), /This role carries no obligation/);
  assert.match(text(h(RoleCard, { role, read: { status: 'loading', data: null }, onRetry: noop })), /Loading/);
  const page = codeOnly(read('frontend/src/pages/hq/TrustObligationsPage.jsx'));
  assert.match(page, /read = api\.trustMatrix/);
  assert.doesNotMatch(page, /sanction/i, 'nothing writes a sanctions review, so the page offers none');
  assert.match(read('frontend/src/pages/hq/TrustObligationsPage.jsx'), /one member&apos;s list can differ from them/);
});

// ─────────────────────────────── routes, doors and the client ──

test('the routes are the Super Admin\'s, each has its door, and the client calls the Worker', async () => {
  const app = codeOnly(read('frontend/src/App.jsx'));
  assert.match(app, /<Route path="\/admin\/accounts\/credits\/:userId" element=\{guard\(\['admin'\], hqOnly\(<MemberCreditsPage \/>\)\)\} \/>/);
  assert.match(app, /<Route path="\/admin\/security\/obligations" element=\{guard\(\['admin'\], hqOnly\(<TrustObligationsPage \/>\)\)\} \/>/);
  const admin = codeOnly(read('frontend/src/pages/AdminPage.jsx'));
  assert.match(admin, /\{showCredits && \(\s*<Link to=\{`\/admin\/accounts\/credits\/\$\{u\.id\}`\}/);
  assert.match(admin, /showCredits=\{isSuperAdminUser\(viewer\)\}/);
  assert.match(codeOnly(read('frontend/src/pages/hq/SecurityPage.jsx')), /<Link to="\/admin\/security\/obligations"/);
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { memberCreditsApi } = await import('../src/lib/api/memberCredits.js');
    await memberCreditsApi.read(4);
    await memberCreditsApi.adjust({ user_id: 4, delta: 10, reason: 'Goodwill for the outage', source_ref: 'hq:a' });
    assert.deepEqual(calls, [
      ['GET', '/perks/admin/credits/4', null],
      ['POST', '/perks/admin/credits', { user_id: 4, delta: 10, reason: 'Goodwill for the outage', source_ref: 'hq:a' }],
    ]);
  } finally { globalThis.fetch = original; }
});
