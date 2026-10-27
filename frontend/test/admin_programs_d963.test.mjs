/**
 * D963 (#2796) — Programs part 10: Referral partners and Custom terms (PG7,
 * PG8), Investor cohort access and Give access (PG11, PG11d), AI-native
 * Venture (PG13, PG13s), the two catalogue cards' figures, and migration 593.
 *
 * What this file holds the pages to (#2796's "Done when"):
 *   · each block's Reading…, Unreadable and figure;
 *   · the two catalogue cards' figures, and Investor's "Not running" until the
 *     registry says it runs;
 *   · an Admin's money tiles under O-MONEY: "Not read here yet", never 0;
 *   · one currency per chart;
 *   · flat or share, never both, in PG8;
 *   · an open pair refused in PG11d;
 *   · "Not running yet", never 0;
 *   · no sample value drawn;
 *   · 593 changes only the seed, and the words match part 5's and the constant.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_programs_d963.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import {
  AI_NATIVE_FOOT, AI_NATIVE_PURPOSE, HQ_READS_MONEY, NOT_READ_YET, PAGES, PARTNERS_JOIN, PARTNERS_TERMS, PARTNERS_WHO, PROGRAMS, routeFor,
} from '../src/pages/admin/programs/programsModel.js';
import {
  FIRING_TRIGGERS, PARTNER_REFUSALS, commissionChart, introductionsChart, moneyLines, partnerTiles, rowActions, termsBody,
  termsInDialog, termsSentence,
} from '../src/pages/admin/programs/referralPartnersModel.js';
import {
  INVESTOR_REFUSALS, NDA_TEMPLATE_LINE, giveBody, investorTiles,
} from '../src/pages/admin/programs/investorCohortsModel.js';
import { investorsFigure, partnersFigure } from '../src/pages/admin/programs/catalogueModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const ready = (data) => ({ status: 'ready', data, error: null, at: Date.now() });
const failed = (status = 503) => ({ status: 'error', data: null, error: { status }, at: null });
const loading = { status: 'loading', data: null };
const HQ = { available: false, reason: 'hq_reads', message: 'HQ reads these figures.' };

/* ------------------------------------------------------------------ *
 * The words: part 5's, OD-AIN's, and migration 593's
 * ------------------------------------------------------------------ */

test('the facts strip is part 5’s FACTS word for word, and the card and the page carry them', () => {
  const svc = read('cloudflare-worker/src/services/referralPartnerTerms.ts');
  for (const [k, v] of [['who', PARTNERS_WHO], ['join', PARTNERS_JOIN], ['terms', PARTNERS_TERMS]]) {
    assert.ok(svc.includes(`  ${k}: '${v}',`), `FACTS.${k} differs from the frontend's`);
  }
  assert.deepEqual(PAGES['referral-partners'].facts, [`Who: ${PARTNERS_WHO}`, `Join: ${PARTNERS_JOIN}`, `Terms: ${PARTNERS_TERMS}`]);
  const card = PROGRAMS.find((p) => p.key === 'referral-partners');
  assert.deepEqual([card.who, card.join], [PARTNERS_WHO, PARTNERS_JOIN]);
  // OD-AIN A: the purpose, Who and Join, on the card and the page.
  const ai = PROGRAMS.find((p) => p.key === 'ai-native-venture');
  assert.deepEqual([ai.purpose, ai.who, ai.join], [AI_NATIVE_PURPOSE, 'Founders', 'By application']);
  assert.equal(PAGES['ai-native-venture'].line, AI_NATIVE_PURPOSE);
});

test('the triggers PG8 offers are part 5’s FIRING_RULES, exactly', () => {
  const svc = read('cloudflare-worker/src/services/referralPartnerTerms.ts');
  const m = /FIRING_RULES: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(svc);
  assert.ok(m, 'FIRING_RULES is where the test reads it');
  const keys = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(FIRING_TRIGGERS.map((t) => t.key).sort(), keys);
});

function seeded() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE learning_programs(id INTEGER PRIMARY KEY); CREATE TABLE learning_enrollments(program_id, user_id, enrolled_by, enrolled_at, status, updated_at);');
  db.exec(read('cloudflare-worker/sql/migrations/560_program_registry.sql'));
  return db;
}
const M593 = read('cloudflare-worker/sql/migrations/593_referral_partners_copy.sql');

test('593 writes the words where 560’s seed still stands, both playbook versions with it, and re-runs as a no-op', () => {
  const db = seeded();
  db.exec(M593);
  const row = (k) => ({ ...db.prepare('SELECT purpose, who, join_method, status FROM programs WHERE key = ?').get(k) });
  assert.deepEqual(row('referral-partners'), {
    purpose: PROGRAMS.find((p) => p.key === 'referral-partners').purpose, who: PARTNERS_WHO, join_method: PARTNERS_JOIN, status: 'partly_built',
  });
  assert.deepEqual(row('ai-native-venture'), { purpose: AI_NATIVE_PURPOSE, who: 'Founders', join_method: 'By application', status: 'proposed' });
  assert.equal(row('investor-cohorts').status, 'not_built', 'the status is HQ’s to set, and gates offering to studios');
  const body = (k, s, v) => db.prepare('SELECT body FROM program_playbook_sections WHERE program_key = ? AND section_key = ? AND version = ?').get(k, s, v).body;
  for (const v of [0, 1]) {
    assert.match(body('referral-partners', 'terms', v), /the Super Admin approves them, and they take effect only once the partner signs/);
    assert.doesNotMatch(body('investor-cohorts', 'design', v), /not decided yet/);
    assert.match(body('investor-cohorts', 'design', v), /one per grant/);
  }
  const before = JSON.stringify(db.prepare('SELECT * FROM programs ORDER BY id').all());
  db.exec(M593);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM programs ORDER BY id').all()), before, 'a second run changes nothing');
});

test('593 never overwrites an HQ edit', () => {
  const db = seeded();
  db.exec("UPDATE programs SET purpose = 'HQ wrote this.' WHERE key = 'referral-partners'");
  db.exec("UPDATE programs SET who = 'HQ picked.' WHERE key = 'ai-native-venture'");
  db.exec("UPDATE program_playbook_sections SET body = 'HQ terms.' WHERE program_key = 'referral-partners' AND section_key = 'terms' AND version = 0");
  db.exec(M593);
  assert.equal(db.prepare("SELECT purpose FROM programs WHERE key = 'referral-partners'").get().purpose, 'HQ wrote this.');
  assert.equal(db.prepare("SELECT purpose FROM programs WHERE key = 'ai-native-venture'").get().purpose, null, 'one field edited holds the whole row');
  assert.equal(db.prepare("SELECT body FROM program_playbook_sections WHERE program_key = 'referral-partners' AND section_key = 'terms' AND version = 0").get().body, 'HQ terms.');
  assert.match(db.prepare("SELECT body FROM program_playbook_sections WHERE program_key = 'referral-partners' AND section_key = 'terms' AND version = 1").get().body, /custom terms/);
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

const SUMMARY_ADMIN = { quarter: '2026-Q4', from: '2026-10-01', to: '2027-01-01', active_partners: 12, with_signed_terms: 9, waiting_to_sign: 3, introductions: 31, money: HQ };
const SUMMARY_SUPER = { ...SUMMARY_ADMIN, money: { available: true, accrued: [{ currency: 'EUR', cents: 50000 }, { currency: 'USD', cents: 425000 }], paid: [{ currency: 'USD', cents: 200000 }] } };

test('the tiles: Reading…, Unreadable and the figure; an Admin’s money is "Not read here yet", never 0; one line per currency', () => {
  assert.ok(partnerTiles(loading).every((t) => t.state === 'loading'));
  assert.ok(partnerTiles(failed()).every((t) => t.state === 'unreadable' && /not the same as none/.test(t.reason)));
  const admin = partnerTiles(ready(SUMMARY_ADMIN));
  assert.deepEqual(admin.slice(0, 3).map((t) => t.value), ['12', '9', '31']);
  assert.equal(admin[1].sub, '3 waiting to sign');
  assert.deepEqual([admin[3].state, admin[3].word, admin[3].reason], ['placeholder', NOT_READ_YET, HQ_READS_MONEY]);
  // Mutation checked: drop the O-MONEY branch → the Admin's tile draws a figure.
  assert.ok(!('value' in admin[3]));
  const sup = partnerTiles(ready(SUMMARY_SUPER));
  assert.equal(sup[3].value, '€500 accrued · €0 paid');
  assert.deepEqual(sup[3].extra, ['$4,250 accrued · $2,000 paid'], 'never summed across currencies');
  assert.deepEqual(moneyLines(HQ), []);
});

const SERIES = {
  weeks_from: '2026-08-10', months_from: '2025-11-01', outcomes: ['pending', 'converted'],
  introductions: [
    { week_start: '2026-10-19', segment: 'event_organisers', outcome: 'pending', n: 4 },
    { week_start: '2026-10-19', segment: 'event_organisers', outcome: 'converted', n: 2 },
    { week_start: '2026-10-12', segment: 'deal_makers', outcome: 'pending', n: 1 },
  ],
  commission: { available: true,
    accrued: [{ month: '2026-09', currency: 'USD', cents: 40000 }, { month: '2026-10', currency: 'USD', cents: 50000 }, { month: '2026-10', currency: 'EUR', cents: 99900 }],
    paid: [{ month: '2026-10', currency: 'USD', cents: 30000 }] },
};

test('Introductions by outcome: a bar per segment stacked by the two outcomes part 5 records; the other two read "Not recorded"', () => {
  const c = introductionsChart(ready(SERIES));
  assert.equal(c.state, 'ready');
  assert.deepEqual(c.chart.rows.map((r) => [r.key, r.n]), [['event_organisers', 6], ['venture_scouts', 0], ['deal_makers', 1]]);
  assert.deepEqual(c.chart.rows[0].parts.map((p) => [p.label, p.value]), [['Signed up', 4], ['Converted', 2]]);
  assert.deepEqual(c.missing.map((m) => m.word), ['Not recorded'], 'In conversation and Closed are never a zero bar');
  assert.deepEqual(introductionsChart(ready(SERIES), 'deal_makers').chart.rows.map((r) => r.key), ['deal_makers'], 'the chip filters the chart');
  assert.equal(introductionsChart(failed()).state, 'unreadable');
  assert.equal(introductionsChart(loading).state, 'loading');
});

test('Commission by month: one currency per chart, USD first; an Admin’s is "Not read here yet"', () => {
  const c = commissionChart(ready(SERIES));
  assert.equal(c.currency, 'USD');
  assert.deepEqual(c.currencies, ['USD', 'EUR']);
  const accrued = c.chart.series[0].values;
  assert.equal(accrued.length, 12);
  // Mutation checked: drop the currency filter → October reads 1,499 (USD + EUR summed).
  assert.deepEqual(accrued.slice(-2), [400, 500]);
  assert.deepEqual(c.chart.series[1].values.slice(-1), [300]);
  assert.match(c.lines[0], /in USD only/);
  const eur = commissionChart(ready(SERIES), 'EUR');
  assert.deepEqual(eur.chart.series[0].values.slice(-1), [999]);
  const admin = commissionChart(ready({ ...SERIES, commission: HQ }));
  assert.deepEqual([admin.state, admin.word, admin.reason], ['pending', NOT_READ_YET, HQ_READS_MONEY]);
});

const form = (o = {}) => ({
  contract_slug: 'partner_custom', triggers: [{ rule_key: 'referral_kyc_approved', kind: 'flat', value: '50' }], cap_per_intro: '', overall_cap: '25000',
  currency: 'USD', starts_on: '2026-11-01', ends_on: '2027-10-31', sectors: 'Fintech, Climate', ...o,
});

test('PG8: each trigger pays a flat amount or a share, never both; an identity check is flat only; the live sentence', () => {
  const b = termsBody(form()).body;
  assert.deepEqual(b.triggers, [{ rule_key: 'referral_kyc_approved', amount_cents: 5000, percentage_bps: null }]);
  assert.ok(b.triggers.every((t) => (t.amount_cents === null) !== (t.percentage_bps === null)), 'exactly one of the two');
  assert.deepEqual([b.cap_per_intro_cents, b.overall_cap_cents, b.sectors], [null, 2500000, ['Fintech', 'Climate']]);
  // Mutation checked: allow a share on the identity check → the body carries a share the Worker refuses.
  assert.match(termsBody(form({ triggers: [{ rule_key: 'referral_kyc_approved', kind: 'share', value: '2' }] })).error, /flat amount/);
  assert.match(termsBody(form({ triggers: [{ rule_key: 'referral_kyc_approved', kind: 'flat', value: '' }] })).error, /above 0/);
  assert.match(termsBody(form({ triggers: [{ rule_key: 'referral_deal_closed', kind: 'flat', value: '9' }] })).error, /an event pays today/);
  assert.match(termsBody(form({ ends_on: '2026-10-01' })).error, /on or after/);
  assert.equal(termsSentence('Ada Quill', b), 'Ada Quill earns $50 when a referred member completes KYC, $25,000 in all, from 1 Nov 2026 to 31 Oct 2027.');
  assert.equal(termsSentence('Ada', { ...b, ends_on: null, cap_per_intro_cents: 1000 }), 'Ada earns $50 when a referred member completes KYC, up to $10 per introduction and $25,000 in all, from 1 Nov 2026, with no end date.');
});

test('the dialog opens the newest draft to edit, live terms to read, else a new draft; the row menu follows the state', () => {
  assert.equal(termsInDialog([{ uid: 'a', state: 'ended' }, { uid: 'b', state: 'draft' }]).terms.uid, 'b');
  assert.equal(termsInDialog([{ uid: 'a', state: 'active' }]).mode, 'read');
  assert.equal(termsInDialog([{ uid: 'a', state: 'expired' }]).mode, 'new');
  const keys = (s, sa = false) => rowActions({ terms_state: s }, sa).map((a) => a.key);
  assert.deepEqual(keys('none'), ['terms']);
  assert.deepEqual(keys('submitted'), ['terms']);
  assert.deepEqual(keys('submitted', true), ['terms', 'approve']);
  assert.deepEqual(keys('approved'), ['terms', 'send']);
  assert.deepEqual(keys('active'), ['terms', 'end']);
  assert.ok(!rowActions({ terms_state: 'active' }, true).some((a) => /Pause/.test(a.label)), 'no Pause (OD-PAUSE)');
});

test('Investor tiles: a hidden count the Worker could not read is "Could not be read", never 0; intros with accepted', () => {
  const t = investorTiles(ready({ investors_with_access: 8, cohorts_open: 2, founders_hidden: null, intro_requests: 11, intros_accepted: 6, nda_template: 'missing' }));
  assert.deepEqual(t.map((x) => x.state), ['ready', 'ready', 'unreadable', 'ready']);
  assert.equal(t[3].sub, '6 accepted');
  assert.ok(investorTiles(loading).every((x) => x.state === 'loading'));
  assert.ok(investorTiles(failed()).every((x) => x.state === 'unreadable'));
});

test('PG11d: an open pair is refused before anything is sent; the body carries only the served scopes', () => {
  const cohort = { id: 7, label: 'November 2026' };
  const base = { cohort, endsOn: '2026-11-28', scope: { summary: true, weekly_progress: false }, note: '', today: '2026-10-26' };
  // Mutation checked: drop the open-pair check → a body is built for a held pair.
  assert.match(giveBody({ ...base, investor: { id: 5, has_open_grant: true } }).error, /already has open access/);
  assert.deepEqual(giveBody({ ...base, investor: { id: 5, has_open_grant: false } }).body,
    { investor_user_id: 5, cohort_cycle_id: 7, ends_at: '2026-11-28', scope: ['summary'], note: null });
  assert.match(giveBody({ ...base, investor: { id: 5 }, endsOn: '2026-10-01' }).error, /today or later/);
  assert.match(giveBody({ ...base, investor: { id: 5 }, scope: {} }).error, /what they see/);
});

test('the catalogue cards: Referral partners from part 5’s summary; Investor "Not running" until the registry says Live', () => {
  assert.equal(partnersFigure(loading).state, 'loading');
  assert.equal(partnersFigure(failed()).state, 'unreadable');
  assert.deepEqual(partnersFigure(failed(403)), { state: 'pending', reason: 'HQ holds referral partners.' });
  assert.equal(partnersFigure(ready(SUMMARY_ADMIN)).text, '12 partners · 9 with signed terms');
  assert.equal(partnersFigure(ready(SUMMARY_ADMIN), { perStudio: true }).state, 'pending', 'no per-studio form');
  assert.equal(partnersFigure(ready({})).state, 'unreadable', 'a summary without its counts is never 0');
  const summary = ready({ investors_with_access: 3, cohorts_open: 1 });
  // Mutation checked: drop the Live check → the card draws figures for a program that does not run.
  assert.deepEqual(investorsFigure(summary, { status: 'Not built yet' }), { state: 'not_running' });
  assert.equal(investorsFigure(summary, { status: 'Live' }).text, '3 investors with access · 1 cohort open to investors');
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const refusal = (status, code, message = code) => response({ error: code, code, message, detail: message }, status);
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };

const partner = (id, o = {}) => ({
  user_id: id, name: `Partner ${id}`, email: `p${id}@example.com`, active: true, segment: 'deal_makers', segment_label: 'Deal makers', terms_state: 'none',
  code: `LIS-DM-${id}`, introductions: 3, converted: 1, last_activity: '2026-10-12 10:00:00', added_at: '2026-09-01 10:00:00', money: HQ, ...o,
});
const terms = (uid, state, o = {}) => ({
  uid, partner_user_id: 41, partner_name: 'Partner 41', segment: 'deal_makers', segment_label: 'Deal makers', stored_status: state, state,
  starts_on: '2026-11-01', ends_on: null, cap_per_intro_cents: null, overall_cap_cents: null, currency: 'USD', sectors: null,
  contract_slug: 'partner_custom', envelope_id: null, note: null, triggers: [{ rule_key: 'referral_kyc_approved', amount_cents: 5000, percentage_bps: null }],
  created: { by: 1, at: '2026-10-20 10:00:00' }, submitted: state === 'submitted' ? { by: 1, at: '2026-10-21 10:00:00' } : null, ...o,
});
const detail = (key, status = 'partly_built') => ({
  program: { key, status },
  playbook: { published: key !== 'ai-native-venture', version: key === 'ai-native-venture' ? null : 1, published_at: null,
    sections: key === 'ai-native-venture' ? [] : [{ key: 'terms', title: 'Terms', body: 'Signed terms pay instead of the standard rule.', computed: false, template_keys: [] }] },
  ...(key === 'ai-native-venture' ? { draft: { sections: [{ key: 'thesis', title: 'Thesis', body: null, computed: false, template_keys: [] }, { key: 'tools', title: 'Tools included', body: null, computed: false, template_keys: [] }], edited_at: null, differs: false } } : {}),
});
const GRANT = (uid, o = {}) => ({
  uid, investor: { id: 5, name: 'Ivy Investor', email: 'ivy@example.com', firm: 'Fund I' }, verified_now: true, cohort: { id: 7, label: 'November 2026' },
  state: 'waits_for_nda', nda_state: 'not_sent', scope: ['summary'], note: null, intro_requests: 4, intros_accepted: 2, granted_at: '2026-10-20 10:00:00', ends_at: '2026-11-28', ended_at: null, end_reason: null, ...o,
});
const NOW = Date.now();
const CYCLES = [{ id: 7, year: 2026, month: 11, status: 'scheduled', start_at: new Date(NOW + 5 * 864e5).toISOString(), end_at: new Date(NOW + 33 * 864e5).toISOString(), windows: [] }];

function worker(o = {}) {
  const {
    user = null, summary = SUMMARY_ADMIN, series = { ...SERIES, commission: HQ }, list = () => ({ items: [partner(41), partner(42, { terms_state: 'approved' })], total: 2 }),
    queue = { items: [], total: 0 }, partnerTerms = { items: [] }, rules = [{ rule_key: 'referral_kyc_approved', amount_cents: 5000, percentage_bps: null, description: 'A referred member completes KYC', active: 1, fires: true },
      { rule_key: 'referral_deal_closed', amount_cents: null, percentage_bps: 200, description: 'A referred startup closes a deal', active: 1, fires: false }],
    invSummary = { investors_with_access: 1, cohorts_open: 1, founders_hidden: 0, intro_requests: 4, intros_accepted: 2, intros_pending: 2, nda_template: 'missing' },
    grants = { items: [GRANT('g1'), GRANT('g2', { verified_now: false, state: 'waits_for_verification', investor: { id: 6, name: 'Al Angel', firm: null } })], total: 2 },
    assignable = (q) => ({ items: [{ id: 5, name: 'Ivy Investor', firm: 'Fund I', ...(q.get('cycle_id') ? { has_open_grant: true } : {}) }, { id: 9, name: 'Noa New', firm: 'Fund II', ...(q.get('cycle_id') ? { has_open_grant: false } : {}) }], total: 2 }),
    details = {}, writes = {},
  } = o;
  const call = (v, ...a) => { const out = typeof v === 'function' ? v(...a) : v; return out && typeof out.json === 'function' ? out : response(out); };
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (method !== 'GET') {
      const w = Object.entries({
        draft: /^\/api\/admin\/referral-partners\/terms$/, edit: /^\/api\/admin\/referral-partners\/terms\/[^/]+$/, submit: /\/submit$/, approve: /\/approve$/,
        preview: /\/terms\/[^/]+\/preview$/, send: /\/terms\/[^/]+\/send$/, endTerms: /\/terms\/[^/]+\/end$/, give: /^\/api\/admin\/investor-cohorts$/, endAccess: /^\/api\/admin\/investor-cohorts\/[^/]+\/end$/,
      }).find(([, re]) => re.test(path));
      if (w && writes[w[0]]) return writes[w[0]](options, path);
      if (w?.[0] === 'draft' || w?.[0] === 'edit') return response(terms('t-new', 'draft'));
      if (w?.[0] === 'submit') return response(terms('t-new', 'submitted'));
      if (w?.[0] === 'give') return response({ grant: GRANT('g9'), founders_notified: null, nda_template: 'missing' }, 201);
      if (w) return response({ ok: true });
      return never();
    }
    if (path === '/api/auth/me') return user ? response(user) : never();
    if (path === '/api/admin/referral-partners') return call(list, q);
    if (path === '/api/admin/referral-partners/summary') return call(summary);
    if (path === '/api/admin/referral-partners/series') return call(series);
    if (path === '/api/admin/referral-partners/terms') return call(q.get('limit') === '1' ? { items: [], total: queue.total } : queue);
    if (/^\/api\/admin\/referral-partners\/\d+\/terms$/.test(path)) return call(partnerTerms);
    if (path === '/api/network/admin/commission-rules') return call(rules);
    if (path === '/api/admin/investor-cohorts/summary') return call(invSummary);
    if (path === '/api/admin/investor-cohorts/assignable') return call(assignable, q);
    if (path === '/api/admin/investor-cohorts') return call(grants, q);
    if (path === '/api/admin/cohort/timeline') return call({ cycles: CYCLES });
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return call({ rows: [], next_before: null, not_audited: null });
    const key = /^\/api\/admin\/programs\/([^/]+)$/.exec(path)?.[1];
    if (key) return call(details[key] ?? detail(key, key === 'investor-cohorts' ? 'not_built' : key === 'ai-native-venture' ? 'proposed' : 'partly_built'));
    return never();
  };
}

async function mounted(url, handle, { user = null } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const tree = user ? h(AuthProvider, null, h(ProgramPage)) : h(ProgramPage);
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, tree)));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 340)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, text: () => text(container),
    textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async settle() { await settle(); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; restore(); },
  };
}
const sent = (view, re, method = 'POST') => view.requests.filter((r) => r.method === method && re.test(r.url));

test('Referral partners · Overview for an Admin: tiles with money "Not read here yet", both charts, the rules locked, and the table without money', async () => {
  const view = await mounted('/admin/programs/referral-partners', worker());
  try {
    assert.equal(view.textOf('programs-tile-active-value'), '12');
    assert.match(view.textOf('programs-tile-money'), /Not read here yet.*HQ reads these figures\./);
    assert.ok(!/\$|0 accrued/.test(view.textOf('programs-tile-money')), 'never a zero for an Admin');
    assert.match(view.textOf('programs-partners-intros'), /Not recorded/);
    assert.match(view.textOf('programs-partners-commission'), /Not read here yet/);
    assert.ok(!view.has('programs-partners-rule-referral_kyc_approved'), 'the rules read is the Super Admin’s');
    assert.match(view.textOf('programs-partners-rules-foot'), /HQ sets the standard rules\./);
    assert.equal(view.textOf('programs-partner-row-41-accrued'), NOT_READ_YET);
    assert.match(view.textOf('programs-partners-count'), /^1–2 of 2$/);
    assert.ok(!view.requests.some((r) => r.url.startsWith('/api/network/admin/commission-rules')), 'no rules read for an Admin');
    // The segment chip filters the table's read.
    await view.click('programs-partners-segment-deal_makers');
    await view.settle();
    assert.ok(view.requests.some((r) => r.url === '/api/admin/referral-partners?segment=deal_makers&limit=25&offset=0'));
    // One request per search, from two characters.
    await view.change('programs-partners-search', { value: 'P' });
    await view.settle();
    // Mutation checked: search from one character → `q=P` is sent.
    assert.equal(view.requests.filter((r) => /[?&]q=P(&|$)/.test(r.url)).length, 0, 'one character is not a search');
    await view.change('programs-partners-search', { value: 'Pa' });
    await view.change('programs-partners-search', { value: 'Par' });
    await view.settle();
    assert.equal(view.requests.filter((r) => /[?&]q=Pa(&|$)/.test(r.url)).length, 0, 'the first keystroke is not sent');
    assert.equal(view.requests.filter((r) => /[?&]q=Par&/.test(r.url)).length, 1);
    // No canvas sample reached the page.
    assert.ok(!/\[\d|\[Name\]|\[\$/.test(view.text()));
  } finally { await view.close(); }
});

test('Referral partners · Overview for a Super Admin: money by currency, the rules with "No event pays this yet", and a failed read marks only its block', async () => {
  const view = await mounted('/admin/programs/referral-partners', worker({ user: SUPER, summary: SUMMARY_SUPER, series: SERIES, list: () => response({}, 503) }), { user: SUPER });
  try {
    assert.match(view.textOf('programs-tile-money'), /€500 accrued · €0 paid.*\$4,250 accrued · \$2,000 paid/);
    assert.ok(view.has('programs-partners-currency-EUR'), 'a second currency is chosen, never summed');
    assert.equal(view.textOf('programs-partners-rule-referral_deal_closed-nofire'), 'No event pays this yet');
    assert.ok(!view.has('programs-partners-rule-referral_kyc_approved-nofire'));
    assert.match(view.textOf('programs-partners-table-unreadable'), /not the same as none/);
    assert.equal(view.textOf('programs-tile-active-value'), '12', 'the tiles stand');
  } finally { await view.close(); }
});

test('Custom terms: from the row menu, the live sentence, Send to HQ saves then submits; a refusal sits in place', async () => {
  let submit = () => refusal(409, 'terms_overlap');
  const view = await mounted('/admin/programs/referral-partners', worker({ writes: { submit: () => submit() } }));
  try {
    await view.click('programs-partner-row-41-menu');
    await view.click('programs-partner-row-41-terms');
    assert.ok(view.has('programs-terms-dialog'));
    assert.match(view.textOf('programs-terms-steps'), /1\. Draft.*5\. Active/);
    assert.match(view.textOf('programs-terms-foot'), /Terms take effect only when signed\./);
    assert.equal(view.props('programs-terms-trigger-referral_kyc_approved-share').disabled, true, 'an identity check pays a flat amount');
    await view.change('programs-terms-trigger-referral_kyc_approved-value', { value: '50' });
    await view.change('programs-terms-starts', { value: '2026-11-01' });
    assert.equal(view.textOf('programs-terms-sentence'), 'Partner 41 earns $50 when a referred member completes KYC, from 1 Nov 2026, with no end date.');
    await view.click('programs-terms-submit');
    const draft = sent(view, /\/api\/admin\/referral-partners\/terms$/);
    assert.equal(draft.length, 1);
    assert.deepEqual(JSON.parse(draft[0].body).triggers, [{ rule_key: 'referral_kyc_approved', amount_cents: 5000, percentage_bps: null }]);
    assert.equal(JSON.parse(draft[0].body).user_id, 41);
    assert.equal(view.textOf('programs-terms-refusal'), PARTNER_REFUSALS.terms_overlap);
    submit = () => response(terms('t-new', 'submitted'));
    await view.click('programs-terms-submit');
    assert.equal(sent(view, /\/api\/admin\/referral-partners\/terms\/t-new$/, 'PATCH').length, 1, 'the second press edits the saved draft');
    assert.match(view.textOf('programs-terms-done'), /^Sent to HQ for approval\./);
  } finally { await view.close(); }
});

test('Queue: empty says who sends terms; for a Super Admin a waiting row opens Approve, which posts once', async () => {
  const empty = await mounted('/admin/programs/referral-partners/queue', worker());
  try {
    assert.match(empty.textOf('programs-partners-queue-empty'), /^Nothing is waiting\.An admin sends a partner’s custom terms to HQ/);
    assert.equal(empty.textOf('programs-tab-queue-count'), '0, Terms waiting for HQ');
  } finally { await empty.close(); }
  const waiting = { items: [terms('t1', 'submitted')], total: 1 };
  const admin = await mounted('/admin/programs/referral-partners/queue', worker({ queue: waiting }));
  try {
    assert.ok(!admin.has('programs-partners-queue-t1-approve'), 'an Admin does not approve');
    assert.equal(admin.textOf('programs-partners-queue-hq'), 'The Super Admin approves terms.');
    assert.match(admin.props('programs-tab-queue-count').className, /amber/);
  } finally { await admin.close(); }
  const hq = await mounted('/admin/programs/referral-partners/queue', worker({ user: SUPER, queue: waiting }), { user: SUPER });
  try {
    await hq.click('programs-partners-queue-t1-approve');
    assert.match(hq.textOf('programs-approve-lines'), /Partner 41 earns \$50/);
    await hq.click('programs-approve-go');
    assert.equal(sent(hq, /\/terms\/t1\/approve$/).length, 1);
    assert.match(hq.textOf('programs-approve-go-done'), /^Approved\./);
  } finally { await hq.close(); }
});

test('Investor cohort access: the banner until Live, the NDA template’s state, four tiles, the table, and End access as a dialog', async () => {
  const view = await mounted('/admin/programs/investor-cohorts', worker());
  try {
    assert.ok(view.has('programs-investor-banner'));
    assert.equal(view.textOf('programs-investor-nda-template'), NDA_TEMPLATE_LINE.missing);
    assert.equal(view.textOf('programs-tile-investors-value'), '1');
    assert.equal(view.textOf('programs-tile-hidden-value'), '0', 'a real 0 the Worker counted');
    assert.equal(view.textOf('programs-investor-row-g1-verified'), 'Verified');
    assert.equal(view.textOf('programs-investor-row-g2-verified'), 'Not verified');
    assert.equal(view.textOf('programs-investor-row-g2-access'), 'Waits for verification');
    assert.ok(!/ivy@example\.com/.test(view.text()), 'no email drawn');
    await view.click('programs-investor-row-g1-end');
    assert.match(view.textOf('programs-investor-end-lines'), /Ivy Investor can no longer read November 2026’s ventures\./);
    await view.click('programs-investor-end-go');
    assert.equal(sent(view, /\/investor-cohorts\/g1\/end$/).length, 1);
  } finally { await view.close(); }
  const live = await mounted('/admin/programs/investor-cohorts', worker({ details: { 'investor-cohorts': detail('investor-cohorts', 'live') }, invSummary: { investors_with_access: 1, cohorts_open: 1, founders_hidden: null, intro_requests: 0, intros_accepted: 0, nda_template: 'published' } }));
  try {
    // Mutation checked: drop `running` → the banner stands on a Live program.
    assert.ok(!live.has('programs-investor-banner'));
    assert.equal(live.textOf('programs-header-status'), '✓Live', 'the registry’s status');
    assert.match(live.textOf('programs-tile-hidden'), /Could not be read/);
  } finally { await live.close(); }
});

test('Give access: verified investors only, an open pair marked and not picked, one body, and part 6’s refusal in place', async () => {
  let give = () => refusal(400, 'not_verified');
  const view = await mounted('/admin/programs/investor-cohorts', worker({ writes: { give: () => give() } }));
  try {
    await view.click('programs-investor-give');
    await view.change('programs-give-cohort', { value: '7' });
    assert.equal(view.props('programs-give-investor-5').disabled, true, 'an open pair cannot be picked');
    assert.ok(view.has('programs-give-investor-5-open'));
    await view.click('programs-give-investor-9');
    await view.change('programs-give-ends', { value: '2099-11-28' });
    await view.change('programs-give-scope-weekly_progress', { checked: false });
    assert.match(view.textOf('programs-give-told'), /Founders in November 2026 are told that Noa New can read their ventures\./);
    assert.match(view.textOf('programs-give-scope-closed'), /Pitch deck and Demo Day room are not open yet/);
    await view.click('programs-give-go');
    assert.equal(view.textOf('programs-give-go-refusal'), INVESTOR_REFUSALS.not_verified);
    assert.deepEqual(JSON.parse(sent(view, /^\/api\/admin\/investor-cohorts$/)[0].body),
      { investor_user_id: 9, cohort_cycle_id: 7, ends_at: '2099-11-28', scope: ['summary'], note: null });
    give = () => response({ grant: GRANT('g9'), founders_notified: null, nda_template: 'missing' }, 201);
    await view.click('programs-give-go');
    assert.match(view.textOf('programs-give-go-done'), /^Access given\./);
  } finally { await view.close(); }
});

test('AI-native Venture: four tiles "Not running yet", never 0; an Admin reads the foot; a Super Admin edits the draft, every section "Not set"', async () => {
  const admin = await mounted('/admin/programs/ai-native-venture', worker());
  try {
    for (const k of ['founders', 'cohorts', 'applications', 'studios-offered']) {
      assert.match(admin.textOf(`programs-tile-${k}`), /Not running yet/);
      assert.ok(!admin.has(`programs-tile-${k}-value`), `${k} draws no figure`);
    }
    assert.equal(admin.textOf('programs-ai-native-foot'), AI_NATIVE_FOOT);
    assert.equal(admin.textOf('programs-header-status'), '✎Proposed');
    assert.match(admin.textOf('programs-facts'), /Who: Founders.*Join: By application/);
  } finally { await admin.close(); }
  const hq = await mounted('/admin/programs/ai-native-venture', worker({ user: SUPER }), { user: SUPER });
  try {
    assert.ok(hq.has('programs-ai-native-how-thesis-edit'), 'Edit playbook');
    assert.ok(hq.has('programs-ai-native-how-publish'), 'Publish');
    assert.match(hq.textOf('programs-ai-native-how-tools'), /Not set/);
    assert.ok(!/\[to be set\]|Offer to studios/.test(hq.text()), 'no sample, and Offer to studios waits for #2376');
  } finally { await hq.close(); }
});

test('wiring: the new sub-paths are routed under today’s guard, are tabs of their pages, and resolve to Admin · Programs', async () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/programs/referral-partners/queue', '/admin/programs/referral-partners/activity', '/admin/programs/investor-cohorts/activity']) {
    assert.ok(app.includes(`\n      <Route path="${p}" element={guard(['admin'], <AdminProgramPage />)} />`), p);
  }
  assert.deepEqual(routeFor('/admin/programs/referral-partners/activity'), { program: 'referral-partners', tab: 'activity' });
  const { pageKeyFor } = await import('../src/lib/railPages.js');
  for (const p of ['/admin/programs/referral-partners/queue', '/admin/programs/investor-cohorts/activity']) assert.equal(pageKeyFor(p, 'admin'), 'Admin · Programs');
  const api = read('frontend/src/lib/api.js');
  assert.ok(api.includes("export * from './api/investorCohorts.js';") && api.includes("export * from './api/referralPartners.js';"));
});
