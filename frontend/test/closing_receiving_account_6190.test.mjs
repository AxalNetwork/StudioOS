// #6190 — the founder sets and changes the company's receiving account from
// the closing room (CP1), on D1217's route
// (`GET`/`PUT /api/closings/company-receiving-accounts/:projectId`). The card
// shows the Worker's mask or No account set, with Set or Change for the
// founder the Worker lets read it; the dialog says first who is told; field
// errors are the Worker's sentences; a revision conflict asks to reload; a
// failed read is never "No account set"; no full account number is drawn
// after a save, and none is logged.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closing_receiving_account_6190.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ClosingRoom, { FounderClosing } from '../src/pages/closing/ClosingRoom.jsx';
import {
  ACCOUNT_FIELDS, ACCOUNT_WORDS, ROOM_WAITS, accountBody, accountFieldOf, accountForm, accountView, isAccountConflict, savedNote,
} from '../src/pages/closing/roomModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
/** A refusal as the Worker's `refuse` writes it. */
const refused = (status, code, message) => ({ __status: status, body: { error: code, message, detail: message } });

const NUMBER = '1234567890124821';
const ROUTING = '021000021';
const ACCOUNT_PATH = '/closings/company-receiving-accounts/5';
const SET = { recorded: true, account: {
  uid: 'cra-1', revision: 3, created_at: '2026-10-12T09:02:00.000Z', payee_name: 'Acme Robotics, Inc.', bank_name: 'Fixture Bank',
  account_number: '••••4821', routing_number: ROUTING, swift_code: null, currency: 'USD', payment_reference: 'ACME-SEED', warning: 'Before you pay, call the company.',
} };
const NONE = { recorded: false, reason: 'The company has not recorded a receiving account.' };

const L2 = { uid: 'l2', commitment_id: 12, prospect_id: null, investor_name: 'Harbor Ventures', route: 'direct', amount_cents: 30000000, currency: 'USD', status: 'open', vehicle_ref: null, evidence: [] };
const CLOSING = { uid: 'c7', deal_id: 7, project_id: 5, round_label: 'Seed', instrument: 'Post-money SAFE', currency: 'USD', status: 'open', deadline: '2026-11-30',
  reach: 'all', total_cents: 30000000, line_count: 1, captable: { state: 'not_ready' }, lines: [L2], events: [], closed_at: null };
const ENTRY = { uid: 'c7', deal_id: 7, project_id: 5, project_name: 'Acme Robotics', round_label: 'Seed', instrument: 'Post-money SAFE', status: 'open' };
const ROUTES = (account) => ({
  '/closings': { closings: [ENTRY] },
  '/closings/c7': CLOSING,
  '/legal/esign/staged/line/12': { envelopes: [] },
  [`GET ${ACCOUNT_PATH}`]: account,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the card’s state: a failed read or an answer with no account shape is unreadable, never no account', () => {
  assert.equal(accountView({ status: 'loading' }).state, 'reading');
  assert.equal(accountView({ status: 'off' }).state, 'reading');
  assert.deepEqual(accountView({ status: 'ok', data: NONE }), { state: 'none', revision: 0 });
  const v = accountView({ status: 'ok', data: SET });
  assert.equal(v.state, 'set'); assert.equal(v.revision, 3); assert.equal(v.number, '••••4821'); assert.equal(v.setOn, '12 Oct 2026');
  for (const data of [{}, null, { recorded: true }, { recorded: true, account: { ...SET.account, account_number: NUMBER } }, { recorded: true, account: { ...SET.account, revision: '3' } }]) {
    assert.equal(accountView({ status: 'ok', data }).state, 'unreadable', JSON.stringify(data));
  }
  assert.equal(accountView({ status: 'error', error: { status: 503 } }).state, 'unreadable');
  assert.deepEqual(accountView({ status: 'error', error: { status: 404, message: 'That receiving account is not available here.' } }), { state: 'refused', text: 'That receiving account is not available here.' });
  assert.equal(accountView({ status: 'error', error: { status: 403, message: 'Not in a support session.' } }).state, 'refused');
});

test('the form and the body: the Worker’s field names, the revision read, and no account number prefilled', () => {
  assert.deepEqual(ACCOUNT_FIELDS.map((f) => f.key), ['payee_name', 'bank_name', 'account_number', 'account_number_confirm', 'routing_number', 'swift_code', 'currency', 'payment_reference']);
  // Each key is one the Worker's parse reads.
  const service = read('cloudflare-worker/src/services/companyReceivingAccounts.ts');
  for (const f of ACCOUNT_FIELDS) assert.match(service, new RegExp(`input\\.${f.key}\\b`), f.key);
  assert.match(service, /input\.expected_revision/);
  const form = accountForm(accountView({ status: 'ok', data: SET }), 'EUR');
  assert.equal(form.account_number, ''); assert.equal(form.account_number_confirm, '');
  assert.equal(form.payee_name, 'Acme Robotics, Inc.'); assert.equal(form.routing_number, ROUTING); assert.equal(form.currency, 'USD');
  assert.equal(accountForm({ state: 'none', revision: 0 }, 'EUR').currency, 'EUR');
  assert.deepEqual(accountBody({ ...form, account_number: NUMBER, account_number_confirm: NUMBER }, 3), {
    expected_revision: 3, payee_name: 'Acme Robotics, Inc.', bank_name: 'Fixture Bank', account_number: NUMBER, account_number_confirm: NUMBER,
    routing_number: ROUTING, swift_code: '', currency: 'USD', payment_reference: 'ACME-SEED',
  });
  // Every field refusal the Worker's parse throws names a field here.
  const parse = service.slice(service.indexOf('function parse('), service.indexOf('async function plain('));
  assert.ok(parse.length > 200);
  for (const [, code] of parse.matchAll(/fail\(400, '([a-z_]+)'/g)) {
    assert.ok(accountFieldOf(code), code);
  }
  assert.equal(accountFieldOf('company_account_changed'), null);
  assert.equal(accountFieldOf('account_revision_required'), null);
  assert.ok(isAccountConflict({ status: 409, code: 'company_account_changed' }));
  assert.ok(!isAccountConflict({ status: 409, code: 'company_account_currency_mismatch' }));
  assert.match(savedNote({ changed: false }, true), /Nothing changed/);
  assert.match(savedNote({ changed: true }, true), /unpaid line/);
  assert.match(savedNote({ changed: true }, false), /No investor was notified/);
});

test('who is told is what the Worker does: a change notifies investors with an unpaid line, the first account nobody', () => {
  const service = read('cloudflare-worker/src/services/companyReceivingAccounts.ts');
  // The recipients query runs only when an account was already active (`? = 1` bound to `before ? 1 : 0`).
  assert.match(service, /WHERE \? = 1 AND EXISTS[\s\S]*?\.bind\(scope\.company_id, scope\.company_id, before \? 1 : 0, uid\)/);
  assert.match(service, /k\.status = 'pending'[\s\S]*?l\.status IN \('open', 'sent'\)/);
  assert.match(service, /channels: \['in_app', 'email'\]/);
  assert.match(ACCOUNT_WORDS.changeNotice, /every investor with an unpaid line, in the app and by email/);
  assert.match(ACCOUNT_WORDS.firstNotice, /no investor is notified/);
  // The gate the room mirrors: the GET admits a founder only on the PUT's own owner test.
  assert.match(service, /OR \(u\.role = 'investor'/);
  assert.match(service, /\(\(u\.role = 'founder' AND u\.founder_id = p\.founder_id AND EXISTS\s*\(SELECT 1 FROM user_company_links l WHERE l\.company_id = p\.company_id AND l\.user_id = u\.id AND l\.is_primary_admin = 1\)\)/);
  assert.ok(!('account' in ROOM_WAITS), 'the old wait is gone');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount({ role = 'founder', routes = {}, phone = false, node = null } = {}) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, log: console.log, warn: console.warn, error: console.error, info: console.info };
  const asked = [];
  const logged = [];
  for (const k of ['log', 'warn', 'error', 'info']) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[`${method} ${path.split('?')[0]}`] ?? routes[path.split('?')[0]];
    const out = typeof hit === 'function' ? await hit(path, opts) : hit;
    if (out instanceof Error) return response({ detail: out.message }, Number(out.status) || 500);
    if (out && out.__status) return response(out.body, out.__status);
    if (out && out.__pending) return new Promise(() => {});
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role, name: 'U' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(MemoryRouter, null, node || h(ClosingRoom, { dealId: 7, role, deal: { id: 7, project_name: 'Acme Robotics' } }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(document.body);
  const by = (id) => all().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, logged, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    writes: () => asked.filter((a) => a.method !== 'GET'),
    accountReads: () => asked.filter((a) => a.method === 'GET' && a.path === ACCOUNT_PATH).length,
    clickText: async (label) => {
      const n = all().find((x) => String(x.tagName).toUpperCase() === 'BUTTON' && txt(x).replace(/\s+/g, ' ').trim() === label);
      assert.ok(n, `no button ${label}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush();
    },
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); assert.ok(!pr(n).disabled, `${id} is disabled`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    type: async (key, value) => { const n = by(`closing-account-${key}`); assert.ok(n, `no field ${key}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { fetch: prev.fetch, matchMedia: prev.matchMedia });
      Object.assign(console, { log: prev.log, warn: prev.warn, error: prev.error, info: prev.info });
      localStorage.removeItem('user'); restore();
    },
  };
}

async function fill(v) {
  for (const [k, val] of [['payee_name', 'Acme Robotics, Inc.'], ['bank_name', 'Fixture Bank'], ['account_number', NUMBER], ['account_number_confirm', NUMBER], ['routing_number', ROUTING]]) await v.type(k, val);
}

test('empty: No account set, Set in the card and in CP1’s header strip, and the first save tells nobody', async () => {
  const saved = { recorded: true, changed: true, account: { ...SET.account, revision: 1 } };
  let n = 0;
  const v = await mount({ routes: { ...ROUTES(() => (n++ === 0 ? NONE : SET)), [`PUT ${ACCOUNT_PATH}`]: saved } });
  try {
    assert.equal(v.props('closing-account')['data-state'], 'none');
    assert.match(v.text('closing-account'), /No account set.*see no payment instructions until it is set/);
    assert.ok(v.has('closing-account-set') && !v.has('closing-account-change'));
    assert.match(v.text('closing-head'), /Set the receiving account/, 'CP1: the header strip carries the door before it is set');
    await v.click('closing-head-account-set');
    assert.equal(v.props('closing-account-dialog').role, 'dialog');
    assert.match(v.text('closing-account-notice'), /first receiving account, so no investor is notified now/);
    assert.equal(v.props('closing-account-account_number').value, '');
    assert.equal(v.props('closing-account-account_number').autoComplete, 'off');
    assert.equal(v.props('closing-account-currency').value, 'USD');
    await fill(v);
    await v.click('closing-account-save');
    const [put] = v.writes();
    assert.equal(put.method, 'PUT'); assert.equal(put.path, ACCOUNT_PATH);
    assert.equal(put.body.expected_revision, 0, 'the revision it was read at');
    assert.equal(put.body.account_number_confirm, NUMBER);
    assert.ok(!v.has('closing-account-dialog'));
    assert.match(v.text('closing-account-saved'), /No investor was notified/);
    assert.equal(v.props('closing-account')['data-state'], 'set', 'the card re-reads after the save');
    assert.ok(!v.text().includes(NUMBER), 'the full number is never drawn after the save');
    assert.ok(!v.has('closing-head-account-set'));
    assert.ok(!v.logged.some((l) => l.includes(NUMBER)), 'no account number is logged');
  } finally { await v.close(); }
});

test('set: the Worker’s mask and bank, Change, the notice to investors first, and the numbers typed again', async () => {
  const v = await mount({ routes: { ...ROUTES(SET), [`PUT ${ACCOUNT_PATH}`]: { recorded: true, changed: true, account: { ...SET.account, revision: 4 } } } });
  try {
    assert.match(v.text('closing-account-number'), /^••••4821$/);
    assert.match(v.text('closing-account'), /Fixture Bank.*Set 12 Oct 2026/);
    assert.ok(v.has('closing-account-change') && !v.has('closing-account-set') && !v.has('closing-head-account-set'));
    await v.click('closing-account-change');
    const t = v.text('closing-account-dialog');
    assert.ok(t.indexOf('every investor with an unpaid line') >= 0 && t.indexOf('every investor with an unpaid line') < t.indexOf('Payee'), 'the notice comes before the fields');
    assert.equal(v.props('closing-account-payee_name').value, 'Acme Robotics, Inc.');
    assert.equal(v.props('closing-account-account_number').value, '', 'never prefilled');
    assert.equal(v.props('closing-account-account_number_confirm').value, '');
    await v.type('account_number', NUMBER); await v.type('account_number_confirm', NUMBER);
    await v.click('closing-account-save');
    assert.equal(v.writes()[0].body.expected_revision, 3);
    assert.match(v.text('closing-account-saved'), /unpaid line are sent a notice/);
    assert.ok(!v.text().includes(NUMBER));
    assert.ok(!v.logged.some((l) => l.includes(NUMBER)), 'no account number is logged');
  } finally { await v.close(); }
});

test('field errors are the Worker’s sentences, under their field', async () => {
  const v = await mount({ routes: { ...ROUTES(SET), [`PUT ${ACCOUNT_PATH}`]: refused(400, 'account_number_mismatch', 'Type the same account number twice.') } });
  try {
    await v.click('closing-account-change');
    await v.type('account_number', NUMBER); await v.type('account_number_confirm', '1234');
    await v.click('closing-account-save');
    assert.equal(v.text('closing-account-error-account_number_confirm'), 'Type the same account number twice.');
    assert.equal(v.props('closing-account-account_number_confirm')['aria-invalid'], true);
    assert.ok(!v.has('closing-account-error'), 'a field refusal is not repeated for the dialog');
    assert.ok(v.has('closing-account-dialog'), 'the dialog stays open with what was typed');
  } finally { await v.close(); }
});

test('conflict: a revision conflict asks to reload, and reloading re-reads the account', async () => {
  const v = await mount({ routes: { ...ROUTES(SET), [`PUT ${ACCOUNT_PATH}`]: refused(409, 'company_account_changed', 'The account changed. Read the current details before saving.') } });
  try {
    const before = v.accountReads();
    await v.click('closing-account-change');
    await fill(v);
    await v.click('closing-account-save');
    assert.match(v.text('closing-account-error'), /The account changed\. Read the current details before saving\..*Reload the account/);
    assert.equal(v.props('closing-account-save').disabled, true, 'no second save on a stale revision');
    await v.click('closing-account-reload');
    assert.ok(!v.has('closing-account-dialog'));
    assert.equal(v.accountReads(), before + 1);
  } finally { await v.close(); }
});

test('refused: a founder the Worker does not let read sees no Set or Change, and a refused save says the Worker’s sentence', async () => {
  const r = await mount({ routes: ROUTES(refused(404, 'company_account_not_found', 'That receiving account is not available here.')) });
  try {
    assert.equal(r.props('closing-account')['data-state'], 'refused');
    assert.match(r.text('closing-account'), /That receiving account is not available here\..*Only the venture founder who administers this company/);
    assert.ok(!r.has('closing-account-set') && !r.has('closing-account-change') && !r.has('closing-head-account-set'));
    assert.doesNotMatch(r.text('closing-account'), /No account set/);
  } finally { await r.close(); }
  const owner = 'Only the venture founder who administers this company can change its receiving account.';
  const v = await mount({ routes: { ...ROUTES(NONE), [`PUT ${ACCOUNT_PATH}`]: refused(403, 'company_account_owner_required', owner) } });
  try {
    await v.click('closing-account-set');
    await fill(v);
    await v.click('closing-account-save');
    assert.equal(v.text('closing-account-error-text'), owner);
    assert.ok(!v.has('closing-account-reload'));
  } finally { await v.close(); }
  // An investor and an Admin never read it in the room.
  for (const role of ['investor', 'admin']) {
    const w = await mount({ role, routes: { ...ROUTES(SET), '/closings/c7': { ...CLOSING, reach: role === 'investor' ? 'own' : 'all' } } });
    try {
      assert.ok(!w.has('closing-account-change') && !w.has('closing-account-set'), role);
      assert.equal(w.accountReads(), 0, `${role} makes no account read`);
    } finally { await w.close(); }
  }
});

test('unreadable: a failed read is never No account set, offers no Set, and retries', async () => {
  let n = 0;
  const v = await mount({ routes: ROUTES(() => (n++ === 0 ? refused(503, 'company_account_unreadable', 'These instructions cannot be read.') : SET)) });
  try {
    assert.equal(v.props('closing-account')['data-state'], 'unreadable');
    assert.match(v.text('closing-account'), /could not be read\. This is not a claim that none is set\./);
    assert.ok(!v.has('closing-account-set') && !v.has('closing-account-change') && !v.has('closing-head-account-set'));
    assert.doesNotMatch(v.text('closing-account'), /No account set/);
    assert.ok(v.has('closing-tiles') && v.has('closing-lines'), 'the rest of the room still draws');
    await v.clickText('Retry');
    assert.equal(v.props('closing-account')['data-state'], 'set');
  } finally { await v.close(); }
});

test('phone: Set and Change are full-width 44px targets, and the fields too', async () => {
  const v = await mount({ phone: true, routes: ROUTES(SET) });
  try {
    assert.match(v.props('closing-account-change').className, /min-h-\[44px\].*w-full/);
    await v.click('closing-account-change');
    for (const f of ACCOUNT_FIELDS) assert.match(v.props(`closing-account-${f.key}`).className, /min-h-\[44px\]/, f.key);
  } finally { await v.close(); }
});

test('the same card is reached from /raise/capital-relationships/closing', async () => {
  const v = await mount({ node: h(FounderClosing, { projectId: 5, search: '' }), routes: { ...ROUTES(SET), '/deals': [{ id: 7, project_id: 5, project_name: 'Acme Robotics' }] } });
  try {
    assert.match(v.text('closing-head'), /Raise › Capital relationships › Closing/);
    assert.match(v.text('closing-account-number'), /••••4821/);
    assert.ok(v.has('closing-account-change'));
  } finally { await v.close(); }
});

test('the wiring: the Worker routes exist, no browser pop-up, light classes carry their dark pair, and the docs', () => {
  const route = read('cloudflare-worker/src/routes/company_receiving_accounts.ts');
  assert.match(route, /accounts\.get\('\/:projectId'/);
  assert.match(route, /accounts\.put\('\/:projectId'/);
  const client = read('frontend/src/lib/api/companyReceivingAccounts.js');
  assert.match(client, /read: \(projectId\)/); assert.match(client, /save: \(projectId, body\)/);
  for (const f of ['RecordRoom.jsx', 'RoomDialogs.jsx', 'roomModel.js']) {
    const src = read(`frontend/src/pages/closing/${f}`);
    assert.doesNotMatch(src, /\b(confirm|alert|prompt)\(/);
    assert.doesNotMatch(src, /console\.(log|info|warn|error)\([^)]*account_number/, 'no account number is logged');
    for (const m of src.matchAll(/className="([^"]+)"/g)) {
      if (/\bbg-(white|amber-100|emerald-50)\b/.test(m[1])) assert.match(m[1], /dark:bg-/, m[1]);
      if (/\btext-(emerald|amber)-[89]00\b/.test(m[1])) assert.match(m[1], /dark:text-/, m[1]);
    }
  }
  assert.match(read('frontend/src/pages/closing/README.md'), /#6190/);
  assert.match(read('documentation/architecture/route-map/canvases/part-1/0180-closing-room.md'), /#6190/);
});
