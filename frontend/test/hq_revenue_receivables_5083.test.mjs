/**
 * D5083 (#5083, parent #5039; canvas RV05, RV05b, RV08) — HQ › Revenue with
 * Receivables and Billing exceptions apart, mounted whole with `fetch`
 * answered per address.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_revenue_receivables_5083.test.mjs
 *
 * Held here, on the mounted page rather than on a part rendered alone:
 * - Receivables and Billing exceptions are two sections, and neither holds the other's rows;
 * - no Draw action anywhere while D514 holds drawing: the policy state, and no button, form or picker;
 * - a receivable row carries one Open control and no edit form; the edits live in the drawer;
 * - the drawer's governed edits (Record a payment, Mark issued, Void) send one request each to
 *   the mounted Worker routes, draw their saving state while it is out (a deferred reply), hold
 *   the drawer open meanwhile, and draw a refusal or an unknown as what it is;
 * - Billing exceptions holds disputes and refunds only (no LTV, no token margin per branch);
 * - the empty states are one operator line ("No statements yet", "No Q4 2026 statements yet",
 *   "No billing exceptions").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import RevenuePage from '../src/pages/hq/RevenuePage.jsx';

const h = React.createElement;
const json = (body, status = 200) => ({
  ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Error',
  headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

const NOW = Date.UTC(2026, 10, 12, 12, 0); // fixed: the figures below only need to be near one another
const SUMMARY = {
  quarter: { key: '2026-Q4', label: 'Q4 2026', start: '2026-10-01', end: '2027-01-01' },
  current_period: '2026-Q4', period_requested: false, read_at: new Date(NOW - 60_000).toISOString(),
  temporal: { licence_fees: 'as_of_now', token_cost: 'period', usage_coverage: 'period', promos: 'as_of_now', subscriptions: 'not_recorded' },
  licence_fees: { available: true, basis: 'One quarter of each active annual fee.', suspended_licences: 0, active_without_fee: 0, by_currency: [{ currency: 'EUR', licences: 2, annual_cents: 4_000_000, quarter_cents: 1_000_000 }] },
  token_cost: { available: true, currency: 'USD', calls: 10, cost_usd: 0.1, billed_available: true, member_runs: 1, runs_not_recorded: 0, margin_microusd: null },
  promos: { available: true, active_codes: 0, redemptions: 0, budget_reason: 'Budget reason.' },
  usage_coverage: {
    available: true, period: '2026-Q4', revenue_reason: 'Every stream arrives unmeasured.',
    by_licence: [{ licence_uid: 'fr', licence_ref: 'AXL-FR', brand_name: 'Axal VC France', reported: true, streams_reported: 2, streams_measurable: 0, reported_at: new Date(NOW - 86_400_000).toISOString() }],
  },
  subscriptions_available: false, subscriptions_reason: 'Not totalled.', token_pl_per_subsidiary_reason: 'No account names its licence (U1).',
};
const stmt = (o) => ({
  uid: 'st_fr', licence_uid: 'fr', brand_name: 'Axal VC France', period: '2026-Q3', gross_cents: 9_500_000, revenue_share_bps: 1200,
  owed_cents: 1_140_000, paid_cents: 760_000, disputed_cents: 0, outstanding_cents: 380_000, currency: 'EUR', status: 'issued',
  complete: true, unreported_streams: 0, estimated_streams: 0, revision: 4, created_at: '2026-10-10 10:00:00', ...o,
});
const STATEMENTS = { available: true, current_period: '2026-Q4', items: [
  stmt({}),
  stmt({ uid: 'st_draft', period: '2026-Q2', status: 'draft', paid_cents: 0, outstanding_cents: 1_140_000, revision: 1 }),
] };
const DISPUTES = { ok: true, disputes: [{ id: 'dp_1', amount: 120_000, currency: 'eur', status: 'needs_response', reason: 'fraudulent', due_by: Math.floor(NOW / 1000) + 10 * 86_400, has_evidence: false, payment_intent: 'pi_1' }] };
const REFUNDS = { available: true, window_days: 30, source: 'Refunds issued through HQ, from their audit rows.', count: 1, unreadable_rows: 0, by_currency: [{ currency: 'EUR', count: 1, amount_cents: 82_000 }], items: [{ audit_id: 7, amount_cents: 82_000, currency: 'EUR', reason: 'Duplicate charge on the annual plan', status: 'succeeded', target_user_id: 12, issued_at: new Date(NOW - 86_400_000).toISOString() }] };
const CEILINGS = { available: true, current_period: '2026-Q4', items: [] };

function handler(over = {}) {
  const reads = {
    summary: SUMMARY, statements: STATEMENTS, periodStatements: { available: true, current_period: '2026-Q4', items: [] },
    disputes: DISPUTES, refunds: REFUNDS, ceilings: CEILINGS, ...over.reads,
  };
  return async (url, options = {}) => {
    const method = options.method || 'GET';
    const path = url.replace(/^.*?\/api/, '');
    if (method !== 'GET' && over.write) return over.write(path, options);
    if (path.startsWith('/admin/revenue/summary')) return json(reads.summary);
    if (path.startsWith('/admin/statements?period=')) return json(reads.periodStatements);
    if (path === '/admin/statements') return json(reads.statements);
    if (path.startsWith('/admin/billing/disputes')) return json(reads.disputes);
    if (path.startsWith('/admin/billing/refunds')) return json(reads.refunds);
    if (path.startsWith('/admin/promo-ceilings')) return json(reads.ceilings);
    return json({});
  };
}

async function mounted(handle = handler()) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, innerHeight: globalThis.innerHeight };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/revenue'] }, h(RevenuePage))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const all = (from = document.body) => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(from); };
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id, from) => all(from).find((n) => props(n)['data-testid'] === id);
  const buttons = (from) => all(from).filter((n) => n.tagName === 'BUTTON');
  const button = (label, from) => buttons(from).find((n) => text(n).trim() === label || props(n)['aria-label'] === label);
  const press = async (label, from) => {
    const n = button(label, from);
    assert.ok(n, `no button "${label}"`);
    assert.ok(!props(n).disabled, `"${label}" is disabled`);
    await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); });
    await flush();
  };
  const type = async (id, value) => {
    const n = all().find((x) => props(x).id === id);
    assert.ok(n, `no field #${id}`);
    await act(async () => { props(n).onChange({ target: { value } }); });
  };
  const submit = async (testId) => {
    const form = all(byId(testId)).find((n) => n.tagName === 'FORM');
    assert.ok(form, `no form in ${testId}`);
    await act(async () => { props(form).onSubmit({ preventDefault() {} }); });
    await flush();
  };
  return {
    requests, flush, byId, button, buttons, press, type, submit, props, all,
    text: (id) => (id ? text(byId(id)) : text(document.body)),
    writes: () => requests.filter((q) => q.method !== 'GET'),
    // The step the flow says it is on (`aria-current="step"`), not merely one it lists.
    currentStep: () => text(all(byId('hq-statement-flow-steps')).find((n) => props(n)['aria-current'] === 'step')).replace(/^\s*\S+\s+/, '').trim(),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ── the sections ────────────────────────────────────────────────────────────

test('Receivables and Billing exceptions are two sections, and each holds only its own rows', async () => {
  const v = await mounted();
  try {
    const rec = v.byId('hq-revenue-receivables');
    const exc = v.byId('hq-revenue-exceptions-section');
    assert.ok(rec && exc, 'a section is missing');
    assert.notEqual(rec, exc);
    assert.ok(!v.all(rec).includes(exc) && !v.all(exc).includes(rec), 'one section is drawn inside the other');
    assert.match(v.text('hq-revenue-receivables'), /^Receivables/);
    assert.match(v.text('hq-revenue-exceptions-section'), /^Billing exceptions/);
    assert.match(v.text('hq-revenue-receivables'), /Axal VC France/);
    assert.doesNotMatch(v.text('hq-revenue-receivables'), /Dispute · evidence|Refund ·|Stripe/, 'an exception is drawn among the receivables');
    // Exceptions only: the dispute and the refund, and nothing that is a metric.
    const kinds = v.all(v.byId('hq-revenue-exceptions')).filter((n) => n.tagName === 'TR').map((n) => v.props(n)['data-kind']);
    assert.deepEqual(kinds, ['dispute', 'refund']);
    assert.doesNotMatch(v.text('hq-revenue-exceptions-section'), /\bLTV\b|lifetime value|Token margin|margin \/ branch|Axal VC France|Revenue share/i);
    assert.doesNotMatch(v.text(), /Statements and Stripe/, 'the old mixed section is back');
  } finally { await v.close(); }
});

test('D514: no Draw action anywhere on the page; a compact policy state instead', async () => {
  const v = await mounted();
  try {
    const held = v.byId('hq-revenue-statement-draw-held');
    assert.ok(held, 'the policy state is missing');
    assert.match(v.text('hq-revenue-statement-draw-held'), /Statement creation · policy decision required/);
    assert.equal(v.all(held).filter((n) => ['BUTTON', 'A', 'FORM', 'SELECT', 'INPUT'].includes(n.tagName)).length, 0, 'the policy state offers a control');
    const draw = v.buttons().filter((n) => /\bdraw\b/i.test(String(v.props(n)['aria-label'] || '')) || /\bdraw\b/i.test(textOf(n)));
    assert.deepEqual(draw.map(textOf), [], 'a Draw button is on the page');
    // The one form on the page is #5037's refund lookup, folded inside Billing exceptions; none is in Receivables.
    const forms = v.all().filter((n) => n.tagName === 'FORM');
    assert.deepEqual(forms.map((n) => v.props(n)['data-testid']), ['refund-lookup']);
    assert.ok(v.all(v.byId('hq-revenue-exceptions-section')).includes(forms[0]), 'the refund lookup left Billing exceptions');
    // Opening a statement does not bring a Draw back either.
    await v.press('Open Axal VC France Revenue share · Q3 2026');
    assert.deepEqual(v.buttons().filter((n) => /\bdraw\b/i.test(textOf(n))).map(textOf), []);
    assert.equal(v.writes().length, 0);
  } finally { await v.close(); }
});

function textOf(n) { return !n ? '' : n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || ''; }

test('rows do not expand: each receivable is one Open control, and the edits appear only in its drawer', async () => {
  const v = await mounted();
  try {
    const table = v.byId('hq-revenue-statements');
    const rows = v.all(table).filter((n) => n.tagName === 'TR');
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const controls = v.all(row).filter((n) => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM', 'DETAILS'].includes(n.tagName));
      assert.deepEqual(controls.map((n) => `${n.tagName}:${textOf(n)}`), [`BUTTON:${textOf(controls[0])}`], 'a row carries more than its Open control');
      assert.match(textOf(controls[0]), /^Open/);
    }
    assert.equal(v.button('Record payment…'), undefined, 'an edit is on the page before a statement is opened');
    assert.equal(v.byId('hq-revenue-statement-drawer'), undefined);
    await v.press('Open Axal VC France Revenue share · Q3 2026');
    const drawer = v.byId('hq-revenue-statement-drawer');
    assert.ok(drawer, 'the drawer did not open');
    assert.ok(v.button('Record payment…', drawer), 'the drawer offers no Record payment');
    // Closing it takes the edits away again.
    await v.press('Close');
    assert.equal(v.byId('hq-revenue-statement-drawer'), undefined);
    assert.equal(v.button('Record payment…'), undefined);
  } finally { await v.close(); }
});

// ── the drawer's governed edits ─────────────────────────────────────────────

test('Record a payment in the drawer: one POST to the payments route, Authenticate while it is out, then the receipt', async () => {
  const reply = deferred();
  const v = await mounted(handler({ write: (path) => (path === '/admin/statements/st_fr/payments' ? reply.promise : json({ error: 'unexpected' }, 500)) }));
  try {
    await v.press('Open Axal VC France Revenue share · Q3 2026');
    await v.press('Record payment…');
    await v.type('rv-flow-amount', '3800');
    await v.type('rv-flow-ref', 'SEPA-FR-2290');
    await v.type('rv-flow-reason', 'Received by SEPA, matched to the Q3 statement');
    await v.submit('hq-statement-flow-record_payment');
    assert.match(v.text('hq-statement-flow-review'), /Outstanding[\s\S]*€3,800\.00[\s\S]*€0\.00/);
    assert.equal(v.writes().length, 0, 'something was sent before Confirm');
    await v.press('Continue');
    await v.press('Record €3,800.00 payment');
    // In flight: one request, the Authenticate step, the drawer held open.
    assert.equal(v.writes().length, 1);
    const [w] = v.writes();
    assert.match(w.url, /\/api\/admin\/statements\/st_fr\/payments$/);
    assert.equal(w.method, 'POST');
    assert.equal(w.body.amount_cents, 380_000);
    assert.equal(w.body.expected_revision, 4);
    assert.equal(w.body.reference, 'SEPA-FR-2290');
    assert.match(w.body.idempotency_key, /\S{8,}/);
    assert.match(v.text('hq-statement-flow-record_payment'), /Waiting for the server/);
    assert.equal(v.currentStep(), 'Authenticate', 'the flow is not on Authenticate while its request is out');
    const readsBefore = v.requests.filter((q) => q.method === 'GET' && /\/admin\/statements$/.test(q.url)).length;
    await v.press('Close'); // the drawer's ×: held while the request is out
    assert.ok(v.byId('hq-revenue-statement-drawer'), 'the drawer closed while its request was out');
    reply.resolve(json({
      outcome: 'applied', action: 'record_payment', statement_uid: 'st_fr', settled: true,
      before: { status: 'issued', paid_cents: 760_000, outstanding_cents: 380_000, revision: 4 },
      after: { status: 'paid', paid_cents: 1_140_000, outstanding_cents: 0, revision: 5 },
      receipt: { action_uid: 'sa_1', at: '2026-11-12T10:00:00Z', reason: 'Received by SEPA, matched to the Q3 statement', currency: 'EUR', amount_cents: 380_000, reference: 'SEPA-FR-2290' },
      replayed: false,
    }));
    await v.flush();
    const out = v.byId('hq-statement-flow-outcome');
    assert.equal(v.props(out)['data-outcome'], 'settled');
    assert.match(v.text('hq-statement-flow-receipt'), /€3,800\.00[\s\S]*SEPA-FR-2290[\s\S]*sa_1[\s\S]*€3,800\.00 → €0\.00[\s\S]*issued → paid/);
    assert.equal(v.writes().length, 1, 'the payment was sent twice');
    const readsAfter = v.requests.filter((q) => q.method === 'GET' && /\/admin\/statements$/.test(q.url)).length;
    assert.equal(readsAfter, readsBefore + 1, 'the ledger was not re-read after the payment');
  } finally { await v.close(); }
});

test('Mark issued in the drawer: Sending… while out; a refusal is drawn as a refusal and nothing is re-read', async () => {
  const reply = deferred();
  const v = await mounted(handler({ write: (path) => (path === '/admin/statements/st_draft/issue' ? reply.promise : json({ error: 'unexpected' }, 500)) }));
  try {
    await v.press('Open Axal VC France Revenue share · Q2 2026');
    await v.press('Mark issued…');
    await v.type('rv-flow-reason', 'Sent to the subsidiary finance lead');
    await v.submit('hq-statement-flow-issue');
    await v.press('Continue');
    await v.press('Mark issued');
    assert.equal(v.writes().length, 1);
    assert.match(v.writes()[0].url, /\/api\/admin\/statements\/st_draft\/issue$/);
    assert.equal(v.writes()[0].body.expected_revision, 1);
    const confirm = v.byId('hq-statement-flow-confirm');
    assert.equal(textOf(confirm), 'Sending…');
    assert.equal(v.props(confirm).disabled, true, 'the confirm can be pressed twice while the request is out');
    const reads = v.requests.length;
    reply.resolve(json({ error: 'incomplete_statement', message: 'A floor is not issued: two streams are unreported.' }, 409));
    await v.flush();
    const out = v.byId('hq-statement-flow-outcome');
    assert.equal(v.props(out)['data-outcome'], 'refused');
    assert.match(textOf(out), /Refused · nothing was written[\s\S]*A floor is not issued/);
    assert.equal(v.byId('hq-statement-flow-receipt'), undefined, 'a refusal drew a receipt');
    assert.equal(v.requests.length, reads, 'a refusal re-read the ledger');
    assert.ok(v.button('Back to the form'));
  } finally { await v.close(); }
});

test('Void in the drawer: Authenticate while out, no second send; an unknown outcome is never success', async () => {
  const reply = deferred();
  const v = await mounted(handler({ write: (path) => (path === '/admin/statements/st_draft/void' ? reply.promise : json({ error: 'unexpected' }, 500)) }));
  try {
    await v.press('Open Axal VC France Revenue share · Q2 2026');
    await v.press('Void Axal VC France 2026-Q2');
    await v.type('rv-flow-reason', 'Drawn against the wrong licence');
    await v.submit('hq-statement-flow-void');
    await v.press('Void statement');
    assert.equal(v.writes().length, 1);
    assert.match(v.writes()[0].url, /\/api\/admin\/statements\/st_draft\/void$/);
    // In flight: the Authenticate step says it is waiting, and nothing offers a second send.
    assert.equal(v.currentStep(), 'Authenticate', 'the flow is not on Authenticate while its request is out');
    assert.match(v.text('hq-statement-flow-void'), /Waiting for the server/);
    assert.equal(v.button('Void statement'), undefined, 'the void can be sent again while it is out');
    await v.press('Close');
    assert.ok(v.byId('hq-revenue-statement-drawer'), 'the drawer closed while the void was out');
    reply.resolve(json({ error: 'upstream' }, 503));
    await v.flush();
    const out = v.byId('hq-statement-flow-outcome');
    assert.equal(v.props(out)['data-outcome'], 'unknown');
    assert.doesNotMatch(textOf(out), /Statement voided/);
    assert.ok(v.button('Check again'));
  } finally { await v.close(); }
});

// ── empty states ────────────────────────────────────────────────────────────

test('empty states are one operator line', async () => {
  const v = await mounted(handler({ reads: {
    statements: { available: true, current_period: '2026-Q4', items: [] },
    disputes: { ok: true, disputes: [] },
    refunds: { ...REFUNDS, count: 0, by_currency: [], items: [] },
  } }));
  try {
    assert.equal(v.text('hq-revenue-statements-empty').trim(), 'No statements yet');
    assert.match(v.text('hq-revenue-streams-section') || v.text(), /No Q4 2026 statements yet/);
    assert.equal(v.text('hq-revenue-exceptions-empty').trim(), 'No billing exceptions');
    assert.doesNotMatch(v.text(), /has been drawn|store (exists|is empty)|None drawn for/);
    // The policy state stays when there is nothing to draw from.
    assert.ok(v.byId('hq-revenue-statement-draw-held'));
  } finally { await v.close(); }
});

test('a status chip with nothing under it says so in one line', async () => {
  const v = await mounted();
  try {
    await v.press('Void0');
    assert.equal(v.text('hq-revenue-statements-none-shown').trim(), 'No void statements');
    await v.press('All2');
    assert.equal(v.byId('hq-revenue-statements-none-shown'), undefined);
  } finally { await v.close(); }
});

// ── phone width ─────────────────────────────────────────────────────────────

test('390px: every scrolling table wrapper is the containing block of its visually hidden text', () => {
  // Found in the browser check at 390px: the `sr-only` state words inside a wide table are
  // `position: absolute`, and without a positioned scroll wrapper they escaped its clipping and
  // gave the whole page a horizontal scroll (851px wide at a 390px viewport).
  const dir = resolve(process.cwd(), 'frontend/src/pages/hq/revenue');
  const wrappers = readdirSync(dir).filter((f) => f.endsWith('.jsx')).flatMap((f) => {
    const src = readFileSync(resolve(dir, f), 'utf8');
    return [...src.matchAll(/className="([^"]*\boverflow-x-auto\b[^"]*)"/g)].map((m) => [f, m[1]]);
  });
  assert.ok(wrappers.length >= 5, `found only ${wrappers.length} table wrappers`);
  for (const [f, cls] of wrappers) assert.match(cls, /(^|\s)relative(\s|$)/, `${f}: "${cls}" lets sr-only text widen the page`);
});
