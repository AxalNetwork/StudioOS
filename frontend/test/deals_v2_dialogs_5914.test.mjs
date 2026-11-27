/**
 * D5914 (#5914, Deals v2 board DE14, canvas section DX14): the five
 * consequential deal dialogs (Pass, Move to diligence, Commit, Withdraw,
 * Record transfer) in one shell. Each traps focus and returns it to the
 * control that opened it, keeps a refusal in the Worker's words, and in Super
 * Admin Investor preview offers Return to HQ instead of the action (D5915).
 * Every read and write is a stub: no test reaches the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_dialogs_5914.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { ViewModeProvider } from '../src/contexts/ViewModeContext.js';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { api } from '../src/lib/api.js';
import { dealStaffApi } from '../src/lib/api/dealStaff.js';
import { dealWorkroomApi } from '../src/lib/api/dealWorkroom.js';
import { MoveToDiligenceDialog, PassDialog } from '../src/pages/investor/dealflow/StageDialogs.jsx';
import { MOVE_DILIGENCE_LINE, PASS_REASONS } from '../src/pages/investor/dealflow/movesModel.js';
import { CommitModal } from '../src/pages/DealRoomPage.jsx';
import { DealCommitment } from '../src/pages/deal/DealWorkTabs.jsx';
import { TransfersView } from '../src/components/deals/DealTransfersTab.jsx';
import {
  COMMIT_ACK, PREVIEW_ACT, commitActLabel, commitCheck, firmLine, previewActive, refusalWords, saysNothingChanged, transferGateLine, withdrawLine,
} from '../src/components/deals/dealActionModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const DEAL = { id: 7, project_name: 'Example Robotics', minimum_check: 100000, currency: 'EUR', status: 'active' };
const PENDING = { uid: 'c-p', deal_id: 7, amount: 120000, status: 'pending', notes: null, created_at: '2026-11-01T10:00:00Z' };
const PREVIEW = { superAdmin: true, viewMode: 'investor', isImpersonating: false };
const refused = (message, code = 'refused', status = 409) => Object.assign(new Error(message), { code, status });

/**
 * A DOM shim with what the shared Lightbox manages: focus, containment,
 * `querySelector(FOCUSABLE)`, the modal scope, and document listeners (Escape).
 * The test DOM keeps no attributes, so a node's React props stand in for them.
 */
async function mount() {
  const restore = installDocument('', { focus: true });
  const pr = (n) => (n ? Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {} : {});
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const focusable = (n) => {
    const p = pr(n);
    if (p.disabled) return false;
    if (['BUTTON', 'SELECT', 'TEXTAREA'].includes(n.tagName)) return true;
    if (n.tagName === 'INPUT') return p.type !== 'hidden';
    if (n.tagName === 'A') return p.href != null;
    return p.tabIndex != null && Number(p.tabIndex) !== -1;
  };
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    n.querySelectorAll = (sel) => walk(n).slice(1).filter((x) => (sel.includes('aria-modal') ? pr(x)['aria-modal'] === 'true' || pr(x)['aria-modal'] === true : focusable(x)));
    n.querySelector = (sel) => n.querySelectorAll(sel)[0] || null;
    Object.defineProperty(n, 'children', { configurable: true, get() { return this.childNodes.filter((c) => c.nodeType === 1); } });
    return n;
  };
  document.body = document.createElement('body');
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const listeners = new Map();
  document.addEventListener = (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); };
  document.removeEventListener = (type, fn) => { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.sessionStorage = globalThis.localStorage;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const need = (id) => { const n = by(id); assert.ok(n, `missing ${id}`); return n; };
  const testIdOf = (n) => { for (let x = n; x; x = x.parentNode) { const id = pr(x)['data-testid']; if (id) return id; } return null; };
  return {
    by, need, pr, settle, document,
    has: (id) => Boolean(by(id)),
    text: (id) => txt(id ? need(id) : container),
    focused: () => testIdOf(document.activeElement),
    async render(el, { mode = null, company = null } = {}) {
      const tree = h(ActiveCompanyContext.Provider, { value: { company, loading: false, error: null, setCompany() {}, refresh() {} } }, el);
      await act(async () => { root.render(h(MemoryRouter, null, mode ? h(ViewModeProvider, { value: mode }, tree) : tree)); });
      await settle();
    },
    async click(id) { const p = pr(need(id)); assert.ok(p.onClick, `${id} has no click`); await act(async () => { await p.onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await settle(); },
    async tick(id, checked = true) { await act(async () => { pr(need(id)).onChange({ target: { checked } }); }); await settle(); },
    async key(key, extra = {}) {
      const e = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      await act(async () => { for (const fn of listeners.get('keydown') || []) fn(e); }); await settle();
    },
    async tab(dialogId, shiftKey = false) {
      const e = { key: 'Tab', shiftKey, preventDefault() {} };
      await act(async () => { pr(need(dialogId)).onKeyDown(e); }); await settle();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

// ---------------------------------------------------------------- the rules (pure)

test('the pass reasons are the Worker’s own list, which is the canvas’s five, in its order', () => {
  const worker = read('cloudflare-worker/src/services/dealPassTaxonomy.ts');
  const keys = [...worker.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  const labels = [...worker.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(PASS_REASONS.map((r) => r.key), keys);
  assert.deepEqual(PASS_REASONS.map((r) => r.label), labels);
  assert.deepEqual(labels, ['Too early', 'Valuation', 'Outside thesis', 'Team', 'Competitive dynamics'], 'D5914: the brief’s five match the Worker’s list');
});

test('a refusal is the Worker’s sentence; a failure with none is the fallback, never a raw error', () => {
  assert.equal(refusalWords(refused('Choose why you are passing.', 'reason_required', 400), 'x'), 'Choose why you are passing.');
  assert.equal(refusalWords(Object.assign(new Error('Closing follows a commitment.'), { code: 'closing_needs_commitment' }), 'x'), 'Closing follows a commitment.');
  assert.equal(refusalWords(new TypeError('Failed to fetch'), 'The pass could not be saved. Try again.'), 'The pass could not be saved. Try again.');
  assert.equal(refusalWords('Write why you are withdrawing.', 'x'), 'Write why you are withdrawing.');
  assert.equal(saysNothingChanged('This deal moved meanwhile. Reload and try again. Nothing was saved.'), true);
  assert.equal(saysNothingChanged('Nothing was recorded.'), true);
  assert.equal(saysNothingChanged('Return to HQ to make this change.'), false);
  assert.equal(previewActive(PREVIEW), true);
  assert.equal(previewActive({ ...PREVIEW, isImpersonating: true }), false, 'a support session is not the preview');
  assert.equal(previewActive({ ...PREVIEW, viewMode: 'admin' }), false);
  assert.equal(previewActive({ ...PREVIEW, superAdmin: false }), false);
  assert.equal(previewActive(null), false);
});

test('Commit asks for an amount at the minimum and the confirmation; it names the firm or says none is chosen', () => {
  assert.equal(commitCheck({ amount: '', minimum: 100000, currency: 'EUR', confirmed: true }), 'Enter a positive amount.');
  assert.equal(commitCheck({ amount: 50000, minimum: 100000, currency: 'EUR', confirmed: true }), 'Minimum check is €100,000.');
  assert.equal(commitCheck({ amount: 100000, minimum: 100000, currency: 'EUR', confirmed: false }), 'Tick the confirmation to commit.');
  assert.equal(commitCheck({ amount: 100000, minimum: 100000, currency: 'EUR', confirmed: true }), null);
  assert.equal(commitActLabel(100000, 'EUR'), 'Commit €100,000');
  assert.equal(commitActLabel('', 'EUR'), 'Commit');
  assert.equal(commitActLabel(100000, 'EUR', true), 'Save the change');
  assert.deepEqual(firmLine({ company_name: 'Example Ventures' }), { named: true, text: 'Example Ventures' });
  assert.equal(firmLine(null).named, false);
  assert.match(firmLine(null).text, /None chosen in the company switcher/);
  assert.match(withdrawLine({ amount: '€120,000', venture: 'Example Robotics', confirmed: false }), /^€120,000 to Example Robotics · Pending\. It stops counting toward the round\./);
});

test('Record transfer warns when an open IC condition holds it, and says when that could not be read', () => {
  assert.match(transferGateLine({ state: 'loading' }).text, /Checking/);
  assert.equal(transferGateLine({ state: 'ready', value: { held: false, open_conditions: null } }), null);
  assert.deepEqual(transferGateLine({ state: 'ready', value: { held: true, open_conditions: 1 } }), { tone: 'warn', text: '1 IC condition is still open on this deal. The transfer is refused until it is resolved in the commit room.' });
  assert.match(transferGateLine({ state: 'ready', value: { held: true, open_conditions: 2 } }).text, /^2 IC conditions are still open/);
  assert.match(transferGateLine({ state: 'ready', value: { held: true, open_conditions: null } }).text, /a decision you cannot see/);
  assert.match(transferGateLine({ state: 'unreadable' }).text, /could not be read/);
});

// ---------------------------------------------------------------- focus

test('a dialog takes focus, keeps Tab inside, and Escape returns focus to the control that opened it', async () => {
  const m = await mount();
  function Page() {
    const [open, setOpen] = useState(false);
    return h('div', null,
      h('button', { type: 'button', onClick: () => setOpen(true), 'data-testid': 'opener' }, 'Pass…'),
      open && h(PassDialog, { row: { id: 7, name: 'Example Robotics' }, onClose: () => setOpen(false), onPassed() {} }));
  }
  try {
    await m.render(h(Page));
    m.need('opener').focus();
    assert.equal(m.focused(), 'opener');
    await m.click('opener');
    assert.ok(m.has('dealflow-pass'));
    assert.equal(m.focused(), 'dealflow-pass-close', 'focus moves into the dialog');
    // Shift+Tab from the first control wraps to the last (the action), never out to the page.
    await m.tab('dealflow-pass', true);
    assert.equal(m.focused(), 'dealflow-pass-go');
    await m.tab('dealflow-pass');
    assert.equal(m.focused(), 'dealflow-pass-close');
    await m.key('Escape');
    assert.equal(m.has('dealflow-pass'), false, 'Escape closes it');
    assert.equal(m.focused(), 'opener', 'focus returns to Pass…');
  } finally { await m.unmount(); }
});

// ---------------------------------------------------------------- Pass and Move to diligence

test('Pass: a reason is required; the Worker’s refusal stays in the dialog with “Nothing was recorded.”', async () => {
  const m = await mount();
  const sent = [];
  const api = { pass: async (id, body) => { sent.push([id, body]); throw refused('This deal moved meanwhile. Reload and try again.', 'flow_changed'); } };
  try {
    await m.render(h(PassDialog, { row: { id: 7, name: 'Example Robotics' }, api, onClose() {}, onPassed() {} }));
    assert.match(m.text('dealflow-pass'), /^Pass on Example Robotics×Reason · required/);
    assert.match(m.text('dealflow-pass'), /Private note · optional/);
    await m.click('dealflow-pass-go');
    assert.equal(m.text('dealflow-pass-refused'), 'Choose why you are passing.', 'a local check sends nothing');
    assert.equal(sent.length, 0);
    await m.tick('dealflow-pass-reason-thesis');
    await m.type('dealflow-pass-note', 'Outside our region for now.');
    await m.click('dealflow-pass-go');
    assert.deepEqual(sent, [[7, { reason: 'thesis', revisit: 'next_round', note: 'Outside our region for now.' }]]);
    assert.equal(m.text('dealflow-pass-refused'), 'This deal moved meanwhile. Reload and try again. Nothing was recorded.');
    assert.ok(m.has('dealflow-pass'), 'the dialog stays open');
    // A failure with no sentence is the dialog's own words, never the raw error.
    api.pass = async () => { throw new TypeError('Failed to fetch'); };
    await m.click('dealflow-pass-go');
    assert.equal(m.text('dealflow-pass-refused'), 'The pass could not be saved. Try again. Nothing was recorded.');
  } finally { await m.unmount(); }
});

test('Move to diligence states what it does before it is made, and a refusal stays in the dialog', async () => {
  const m = await mount();
  const moved = [];
  let move = async () => { throw refused('This deal moved meanwhile. Reload and try again. Nothing was saved.', 'flow_changed'); };
  try {
    await m.render(h(MoveToDiligenceDialog, { row: { id: 7, name: 'Example Robotics' }, onClose() {}, onMove: () => move(), onMoved: (r) => moved.push(r) }));
    assert.match(m.text('dealflow-diligence'), /^Move Example Robotics to diligence/);
    assert.equal(m.text('dealflow-diligence-line'), MOVE_DILIGENCE_LINE);
    assert.match(MOVE_DILIGENCE_LINE, /It leaves Screening[\s\S]*does not open a diligence case[\s\S]*The founder is not notified\./);
    await m.click('dealflow-diligence-go');
    assert.equal(m.text('dealflow-diligence-refused'), 'This deal moved meanwhile. Reload and try again. Nothing was saved.', 'not said twice');
    assert.deepEqual(moved, []);
    move = async () => ({ deal_id: 7, stage: 'diligence' });
    await m.click('dealflow-diligence-go');
    assert.deepEqual(moved, [{ deal_id: 7, stage: 'diligence' }]);
  } finally { await m.unmount(); }
});

// ---------------------------------------------------------------- Commit

test('Commit: amount in the deal currency, the firm, a note, and nothing sent until the confirmation is ticked', async () => {
  const m = await mount();
  const saved = api.createCommitment;
  const sent = [];
  api.createCommitment = async (id, body) => { sent.push([id, body]); return { ok: true }; };
  const done = [];
  try {
    await m.render(h(CommitModal, { deal: DEAL, user: { id: 30, role: 'investor', branch: { code: 'ldn' } }, onClose() {}, onDone: (o) => done.push(o) }), { company: { id: 4, company_name: 'Example Ventures' } });
    assert.match(m.text('commit'), /^Commit to Example Robotics×/);
    assert.match(m.text('commit'), /Amount \(EUR\)[\s\S]*Minimum check: €100,000/);
    assert.equal(m.text('commit-firm'), 'Example Ventures');
    assert.match(m.text('commit'), new RegExp(COMMIT_ACK.replace('.', '\\.')));
    assert.equal(m.text('commit-go'), 'Commit €100,000');
    await m.type('commit-notes', 'Subject to our partners’ meeting.');
    await m.click('commit-go');
    assert.equal(m.text('commit-refused'), 'Tick the confirmation to commit.');
    assert.deepEqual(sent, [], 'nothing is sent before the confirmation');
    await m.tick('commit-ack');
    await m.click('commit-go');
    assert.deepEqual(sent, [[7, { amount: 100000, notes: 'Subject to our partners’ meeting.', route_preference: null }]]);
    assert.deepEqual(done, [undefined]);
  } finally { await m.unmount(); api.createCommitment = saved; }
});

// ---------------------------------------------------------------- Withdraw

test('Withdraw: a reason is required, the Worker’s refusal stays, and a withdrawal reloads the tab', async () => {
  const m = await mount();
  const saved = { list: api.dealCommitments, withdraw: dealWorkroomApi.withdraw };
  const sent = [];
  let reads = 0;
  api.dealCommitments = async () => { reads += 1; return [PENDING]; };
  dealWorkroomApi.withdraw = async (...a) => { sent.push(a); if (sent.length === 1) throw refused('This commitment changed meanwhile. Nothing was withdrawn.', 'commitment_changed'); return { ok: true }; };
  try {
    await m.render(h(DealCommitment, { deal: DEAL, user: { id: 30, role: 'investor' }, onChangeAmount() {}, onShare() {} }));
    await m.click('deal-withdraw');
    assert.match(m.text('deal-withdraw-dialog'), /^Withdraw your commitment×/);
    assert.match(m.text('deal-withdraw-line'), /^€120,000 to Example Robotics · Pending\./);
    assert.equal(m.text('deal-withdraw-dialog-cancel'), 'Keep commitment');
    assert.equal(m.text('deal-withdraw-dialog-confirm'), 'Withdraw €120,000');
    await m.click('deal-withdraw-dialog-confirm');
    assert.equal(m.text('deal-withdraw-dialog-refused'), 'Write why you are withdrawing.');
    assert.equal(sent.length, 0);
    await m.type('deal-withdraw-reason', 'Our allocation closed.');
    await m.click('deal-withdraw-dialog-confirm');
    assert.equal(m.text('deal-withdraw-dialog-refused'), 'This commitment changed meanwhile. Nothing was withdrawn. Nothing was recorded.');
    const before = reads;
    await m.click('deal-withdraw-dialog-confirm');
    assert.deepEqual(sent.at(-1), [7, 'c-p', 'Our allocation closed.']);
    assert.equal(m.has('deal-withdraw-dialog'), false);
    assert.ok(reads > before, 'the commitment is read again');
  } finally { await m.unmount(); api.dealCommitments = saved.list; dealWorkroomApi.withdraw = saved.withdraw; }
});

// ---------------------------------------------------------------- Record transfer

test('Record transfer: the open-condition warning, phone verification with its verifier, and the Worker’s refusal', async () => {
  const m = await mount();
  const saved = { gate: dealStaffApi.transferGate, users: api.listUsers, record: api.dealTransferRecord };
  const sent = [];
  dealStaffApi.transferGate = async () => ({ held: true, open_conditions: 1 });
  api.listUsers = async () => [{ id: 3, role: 'admin', name: 'Admin A' }, { id: 9, role: 'admin', name: 'Admin B' }];
  api.dealTransferRecord = async (id, body) => {
    sent.push([id, body]);
    throw Object.assign(new Error('1 open IC condition on this deal. Resolve it in the commit room before recording a transfer.'), { code: 'open_conditions_block_transfer', status: 409, data: { open_conditions: 1 } });
  };
  try {
    await m.render(h(TransfersView, { dealId: 7, currency: 'EUR', state: { loading: false, error: false, rows: [] }, canRecord: true, initialFormOpen: true }));
    assert.equal(m.text('dr-transfer-gate'), '!1 IC condition is still open on this deal. The transfer is refused until it is resolved in the commit room.');
    await m.type('dr-transfer-amount', '100,000');
    await m.type('dr-transfer-reference', 'REF-0001');
    assert.equal(m.has('dr-transfer-verifier'), false, 'the verifier is asked only once phone-verified');
    await m.tick('dr-transfer-verified');
    await m.type('dr-transfer-verifier', '9');
    assert.equal(m.text('dr-transfer-submit'), 'Record €100,000.00 transfer');
    await m.click('dr-transfer-submit');
    assert.deepEqual(sent, [[7, { amount_cents: 10000000, reference: 'REF-0001', phone_verified: true, note: null, phone_verified_by: 9 }]]);
    assert.equal(m.text('dr-transfer-form-refused'), '1 open condition' + '1 open IC condition on this deal. Resolve it in the commit room before recording a transfer. Nothing was recorded.', 'the Worker’s words');
    assert.ok(m.has('dr-transfer-form'), 'the dialog stays open');
  } finally {
    await m.unmount();
    dealStaffApi.transferGate = saved.gate; api.listUsers = saved.users; api.dealTransferRecord = saved.record;
  }
});

// ---------------------------------------------------------------- Super Admin Investor preview (D5915)

test('in Super Admin Investor preview each dialog offers Return to HQ instead of the action, and sends nothing', async () => {
  const savedCommit = api.createCommitment;
  const writes = [];
  api.createCommitment = async () => { writes.push('commit'); return {}; };
  const flow = { pass: async () => { writes.push('pass'); return {}; } };
  const cases = [
    ['dealflow-pass', h(PassDialog, { row: { id: 7, name: 'Example Robotics' }, api: flow, onClose: () => closed.push('pass'), onPassed() {} })],
    ['dealflow-diligence', h(MoveToDiligenceDialog, { row: { id: 7, name: 'Example Robotics' }, onClose: () => closed.push('diligence'), onMove: async () => { writes.push('move'); } })],
    ['commit', h(CommitModal, { deal: DEAL, onClose: () => closed.push('commit'), onDone() {} })],
  ];
  const closed = [];
  try {
    for (const [id, el] of cases) {
      const m = await mount();
      let exits = 0;
      try {
        await m.render(el, { mode: { ...PREVIEW, exitPreview() { exits += 1; } } });
        assert.match(m.text(`${id}-preview`), /You are previewing the Investor interface as Super Admin\.[\s\S]*Return to HQ to perform this action\./, id);
        assert.equal(m.has(`${id}-go`), false, `${id}: the action is not offered`);
        assert.equal(m.text(`${id}-hq`), PREVIEW_ACT);
        await m.click(`${id}-hq`);
        assert.equal(exits, 1, `${id}: Return to HQ leaves the preview`);
      } finally { await m.unmount(); }
    }
    assert.deepEqual(closed, ['pass', 'diligence', 'commit'], 'each dialog closes as it returns to HQ');
    assert.deepEqual(writes, [], 'nothing is sent from the preview');
    // Outside the preview (an HQ tab, or a support session) the action is offered.
    const m = await mount();
    try {
      await m.render(h(CommitModal, { deal: DEAL, onClose() {}, onDone() {} }), { mode: { ...PREVIEW, isImpersonating: true, exitPreview() {} } });
      assert.ok(m.has('commit-go'));
      assert.equal(m.has('commit-preview'), false);
    } finally { await m.unmount(); }
  } finally { api.createCommitment = savedCommit; }
});

test('in preview, Withdraw and Record transfer offer Return to HQ too', async () => {
  const saved = { list: api.dealCommitments, gate: dealStaffApi.transferGate };
  api.dealCommitments = async () => [PENDING];
  dealStaffApi.transferGate = async () => ({ held: false, open_conditions: null });
  try {
    let m = await mount();
    try {
      await m.render(h(DealCommitment, { deal: DEAL, user: { id: 30, role: 'investor' }, onChangeAmount() {}, onShare() {} }), { mode: { ...PREVIEW, exitPreview() {} } });
      await m.click('deal-withdraw');
      assert.ok(m.has('deal-withdraw-dialog-preview'));
      assert.equal(m.has('deal-withdraw-dialog-confirm'), false);
      assert.ok(m.has('deal-withdraw-dialog-hq'));
    } finally { await m.unmount(); }
    m = await mount();
    try {
      await m.render(h(TransfersView, { dealId: 7, state: { loading: false, error: false, rows: [] }, canRecord: true, initialFormOpen: true }), { mode: { ...PREVIEW, exitPreview() {} } });
      assert.ok(m.has('dr-transfer-form-preview'));
      assert.equal(m.has('dr-transfer-submit'), false);
      assert.equal(m.has('dr-transfer-gate'), false, 'no warning when nothing holds the wire');
    } finally { await m.unmount(); }
  } finally { api.dealCommitments = saved.list; dealStaffApi.transferGate = saved.gate; }
});

// ---------------------------------------------------------------- wiring

test('wiring: one shell, no browser prompt, dark pairs, and the decision file', () => {
  const files = [
    'frontend/src/components/deals/DealActionDialog.jsx',
    'frontend/src/pages/investor/dealflow/StageDialogs.jsx',
    'frontend/src/pages/deal/DealCommitDialog.jsx',
    'frontend/src/pages/deal/DealWorkTabs.jsx',
    'frontend/src/components/deals/DealTransfersTab.jsx',
  ];
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(|\bprompt\(/, f);
    for (const m of src.matchAll(/'([^']*\bbg-white\b[^']*)'/g)) assert.match(m[1], /dark:bg-/, `${f}: ${m[1]}`);
  }
  for (const f of files.slice(1)) assert.match(read(f), /DealActionDialog/, `${f} draws in the DX14 shell`);
  assert.match(read('frontend/src/pages/investor/deals/ScreeningZone.jsx'), /<MoveToDiligenceDialog/);
  assert.match(read('frontend/src/pages/DealRoomPage.jsx'), /export \{ CommitModal \};/);
  const decision = read('documentation/architecture/decisions/D5914.md');
  assert.match(decision, /^## D5914 — .+ \(#5914\)$/m);
  assert.match(decision, /Too early, Valuation, Outside thesis, Team, Competitive dynamics/);
});
