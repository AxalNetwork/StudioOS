import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { fixtures, ledger } from './fund_admin_d1165_fixtures.mjs';

const h = React.createElement;
const pause = () => new Promise(r => setTimeout(r, 0));
async function mount(path, over = {}) {
  const s = fixtures(over);
  const restore = installDocument();
  document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const el = document.createElement('div'); document.body.appendChild(el); const root = createRoot(el);
  const props = n => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = n => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '';
  const by = id => walk(el).find(n => props(n)['data-testid'] === id);
  const flush = async fn => act(async () => { await fn?.(); for (let i = 0; i < 8; i++) await pause(); });
  await flush(() => root.render(h(MemoryRouter, { initialEntries: [path] }, h(FundAdminConsoleView, { user: { role: 'admin' }, apis: s.apis }))));
  return { ...s, by, props, text: id => text(id ? by(id) : el).replace(/\s+/g, ' ').trim(),
    click: id => flush(() => props(by(id)).onClick?.({ button: 0, preventDefault() {}, defaultPrevented: false })),
    type: (id, value) => flush(() => props(by(id)).onChange({ target: { value } })),
    submit: id => flush(() => props(by(id)).onSubmit({ preventDefault() {} })),
    changeLabel: (label, value) => flush(() => props(walk(el).find(n => props(n)['aria-label'] === label)).onChange({ target: { value } })),
    flush, close: async () => { await act(async () => root.unmount()); restore(); },
  };
}

test('D1165: Reports addresses read only their own source and retain the fund', async () => {
  for (const [part, expected] of [['', 'packs'], ['/periods', 'reportPeriods'], ['/notices', 'notices']]) {
    const m = await mount(`/admin/fund-admin/reports${part}?fund=7`);
    try {
      assert.deepEqual(m.calls.filter(([n]) => ['packs', 'reportPeriods', 'notices', 'ledgerList', 'connections'].includes(n)).map(([n]) => n), [expected]);
      assert.equal(m.props(m.by('reports-part-notices')).href, '/admin/fund-admin/reports/notices?fund=7');
      assert.ok(m.by('fund-admin-panel-reports'));
    } finally { await m.close(); }
  }
});

test('D1165: Books replaces the wait, keeps debit and credit, and never runs on Banking', async () => {
  let m = await mount('/admin/fund-admin/banking/books?fund=7');
  try {
    assert.equal(m.calls.filter(([n]) => n === 'ledgerList').length, 1);
    assert.ok(m.by('books-journal'));
    assert.ok(!m.by('fund-admin-wait-books'));
    assert.ok(!m.by('fund-admin-filter')); // Books uses the ledger’s entitled-fund selector.
    assert.match(m.text(), /Debit \$123\.45 Credit \$0\.00/);
    assert.ok(!m.calls.some(([n]) => n === 'connections'));
  } finally { await m.close(); }
  m = await mount('/admin/fund-admin/banking');
  try { assert.ok(!m.calls.some(([n]) => n.startsWith('ledger'))); } finally { await m.close(); }
});

test('D1165: a failed fee-lines read preserves terms and admissions; missing net invested is never zero', async () => {
  const m = await mount('/admin/fund-admin/fees', { feePeriod: () => { throw new Error('unavailable'); } });
  try {
    assert.match(m.text('fee-lines'), /Unreadable.*Try again/);
    assert.match(m.text('fee-terms'), /2% a year/);
    assert.match(m.text('fee-admissions'), /Net invested: Not recorded.*No dated net invested/);
    assert.doesNotMatch(m.text('fee-admissions'), /\$0\.00/);
    assert.ok(!m.by('fee-terms-confirm-terms1'));
    assert.ok(m.by('fee-terms-refused-terms1'));
  } finally { await m.close(); }
});

test('D1165: a fee statement opens as a phone sheet; writes need the preview and confirmation', async () => {
  const m = await mount('/admin/fund-admin/fees', { access: () => ({ super_admin: true, acts: [] }) });
  try {
    await m.click('fee-statement-4');
    assert.equal(m.props(m.by('fee-statement-layer'))['data-phone'], 'sheet');
    assert.match(m.text('fee-statement'), /Net fee \$123\.45/);
    await m.click('fee-statement-close');
    assert.ok(!m.calls.some(([n]) => n === 'issuePeriod'));
    await m.type('fee-quarter', '2026Q4');
    // The form owns the preview submit, with no issue request on preview.
    const button = m.by('fee-preview-submit');
    let form = button.parentNode;
    while (form && !m.props(form).onSubmit) form = form.parentNode;
    await m.flush(() => m.props(form).onSubmit({ preventDefault() {} }));
    await m.click('fee-issue');
    assert.ok(m.by('fee-confirmation'));
    assert.ok(!m.calls.some(([n]) => n === 'issuePeriod'));
    await m.click('fee-confirm-submit');
    assert.deepEqual(m.calls.find(([n]) => n === 'issuePeriod'), ['issuePeriod', 7, '2026Q4', 'digest']);
  } finally { await m.close(); }
});

test('D1165: pack figures are audited on Open, Admin gets a sentence, Return requires a reason', async () => {
  const m = await mount('/admin/fund-admin/reports');
  try {
    assert.ok(!m.calls.some(([n]) => n === 'packRead'));
    await m.click(`draft-open-${m.uid}`);
    assert.equal(m.calls.filter(([n]) => n === 'packRead').length, 1);
    assert.equal(m.props(m.by(`draft-opened-${m.uid}-layer`))['data-phone'], 'sheet');
    assert.match(m.text(`draft-opened-${m.uid}`), /Committed \$10,000\.00/);
    assert.ok(!m.by(`draft-issue-${m.uid}`));
    assert.ok(m.by(`draft-issue-refused-${m.uid}`));
    await m.click(`draft-return-${m.uid}`);
    await m.type(`draft-text-${m.uid}`, 'short');
    assert.equal(m.props(m.by(`draft-submit-${m.uid}`)).disabled, true);
    await m.type(`draft-text-${m.uid}`, 'Check the dated figures again');
    assert.equal(m.props(m.by(`draft-submit-${m.uid}`)).disabled, false);
  } finally { await m.close(); }
});

test('D1165: missing notice amount is Not recorded, frozen figures read on Open only', async () => {
  const m = await mount('/admin/fund-admin/reports/notices');
  try {
    assert.match(m.text('reports-notices'), /Not recorded/);
    assert.doesNotMatch(m.text('reports-notices'), /\$0\.00/);
    assert.ok(!m.calls.some(([n]) => n === 'noticeRead'));
    await m.click(`notice-open-${m.uid}`);
    assert.equal(m.calls.filter(([n]) => n === 'noticeRead').length, 1);
    assert.ok(m.by('notice-figures'));
    assert.ok(!m.calls.some(([n]) => n === 'pdf'));
  } finally { await m.close(); }
});

test('D1165: loading Books keeps the shared header, and failed Books offers retry', async () => {
  let release;
  const m = await mount('/admin/fund-admin/banking/books', { ledgerList: () => new Promise(r => { release = r; }) });
  try {
    assert.ok(m.by('fund-admin-header'));
    assert.ok(!m.by('books-journal'));
    await m.flush(() => release({ items: [] }));
    assert.match(m.text('banking-books'), /Not recorded: no accessible fund ledger/);
  } finally { await m.close(); }
  const n = await mount('/admin/fund-admin/banking/books', { ledgerList: () => { throw new Error('fixture'); } });
  try {
    assert.match(n.text('banking-books'), /Unreadable.*Try again/);
    assert.ok(n.by('fund-admin-header'));
  } finally { await n.close(); }
});

test('D1165: a late read cannot replace a newer retry, including Strict Mode', async () => {
  const { useRead } = await import('../src/pages/admin/fundAdmin/useRead.js');
  const restore = installDocument();
  const el = document.createElement('div'); document.body.appendChild(el); const root = createRoot(el);
  const pending = []; let reading;
  function Probe() { reading = useRead(() => new Promise(resolve => pending.push(resolve)), []); return h('p', null, reading.data?.value || reading.status); }
  try {
    await act(async () => root.render(h(React.StrictMode, null, h(Probe))));
    let newer;
    await act(async () => { newer = reading.reload(); });
    await act(async () => { pending.at(-1)({ value: 'newer' }); await newer; });
    assert.equal(reading.data.value, 'newer');
    await act(async () => { for (const resolve of pending.slice(0, -1)) resolve({ value: 'stale' }); await pause(); });
    assert.equal(reading.data.value, 'newer');
  } finally { await act(async () => root.unmount()); restore(); }
});

test('D1165: nested fund drawers inherit the phone sheet, and an explicit full-screen form wins', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Lightbox, LightboxPhoneProvider } = await import('../src/ui/index.js');
  const render = phone => renderToStaticMarkup(h(LightboxPhoneProvider, { phone: 'sheet' }, h(Lightbox, { phone, label: 'Fixture', onClose() {} }, 'Body')));
  assert.match(render(undefined), /data-phone="sheet"/);
  assert.doesNotMatch(render('full'), /data-phone="sheet"/);
  assert.match(render(undefined), /dark:bg-gray-950/);
});


test('D1165: summary-only ledger data cannot expose journal facts in the Books side card', async () => {
  const m = await mount('/admin/fund-admin/banking/books', { ledgerList: () => ({ items: [{ ...ledger, can_manage: false }] }) });
  try {
    assert.doesNotMatch(m.text('banking-books'), /Recorded receipt|CASH|CAPITAL/);
    assert.match(m.text('books-reconcile'), /summary access only/);
  } finally { await m.close(); }
});

test('D1165: pack search and period/status filters keep entity packs; the fund filter applies to the read', async () => {
  const entityUid = 'b'.repeat(32);
  const m = await mount('/admin/fund-admin/reports', { packs: () => ({ items: [
    { uid: 'a'.repeat(32), fund_id: 7, period_label: 'Q3 2026', kind: 'lp_quarterly_report', status: 'prepared' },
    { uid: entityUid, entity_key: 'management', period_label: 'Q2 2026', kind: 'entity_pack', status: 'draft' },
  ] }) });
  try {
    assert.deepEqual(m.calls.find(([n]) => n === 'packs'), ['packs', {}]);
    assert.match(m.text(), /management/);
    assert.ok(m.by('fund-admin-filter-all'));
    assert.ok(!m.by('fund-admin-filter-note'));
    await m.changeLabel('Pack period', 'Q3 2026');
    assert.ok(!m.by(`draft-${entityUid}`));
    await m.changeLabel('Pack period', '');
    await m.changeLabel('Pack status', 'draft');
    assert.ok(!m.by(`draft-${m.uid}`));
    assert.ok(m.by(`draft-${entityUid}`));
    await m.changeLabel('Search packs', 'no matching pack');
    assert.match(m.text(), /No pack matches/);
  } finally { await m.close(); }
  const n = await mount('/admin/fund-admin/reports?fund=7');
  try { assert.deepEqual(n.calls.find(([name]) => name === 'packs'), ['packs', { fund_id: 7 }]); } finally { await n.close(); }
});

test('D1165: notice filters and search distinguish no matches from no recorded notices', async () => {
  const m = await mount('/admin/fund-admin/reports/notices');
  try {
    await m.changeLabel('Search notices', 'no matching reference');
    assert.match(m.text('reports-notices'), /No notice matches/);
    await m.changeLabel('Search notices', 'EXAMPLE');
    assert.ok(m.by(`notice-open-${m.uid}`));
    await m.changeLabel('Notice type', 'fee_invoice');
    assert.ok(!m.by(`notice-open-${m.uid}`));
    await m.changeLabel('Notice type', 'capital_call_notice');
    assert.ok(m.by(`notice-open-${m.uid}`));
  } finally { await m.close(); }
});

test('D1165: transaction filters reset paging and use the existing Worker parameters; text search is page-local', async () => {
  const account = 'c'.repeat(32);
  const m = await mount('/admin/fund-admin/banking', { transactions: () => ({ total: 100, page_size: 50, items: [
    { uid: 'tx-credit', counterparty_name: 'Example sender', memo: 'Recorded wire', last_four: '1234', amount_cents: 12345 },
  ] }) });
  try {
    await m.click('transactions-next');
    assert.equal(m.calls.filter(([n]) => n === 'transactions').at(-1)[1].page, 2);
    await m.changeLabel('Transaction direction', 'credit');
    assert.deepEqual(m.calls.filter(([n]) => n === 'transactions').at(-1)[1], { page: 1, direction: 'credit' });
    await m.changeLabel('Transaction account', account);
    await m.changeLabel('Transactions from', '2026-09-01');
    assert.deepEqual(m.calls.filter(([n]) => n === 'transactions').at(-1)[1], { page: 1, direction: 'credit', account, from: '2026-09-01' });
    await m.changeLabel('Search this transaction page', 'missing');
    assert.ok(!m.by('transaction-tx-credit'));
    await m.changeLabel('Search this transaction page', 'wire');
    assert.ok(m.by('transaction-tx-credit'));
    assert.equal(m.calls.filter(([n]) => n === 'accounts').length, 1);
  } finally { await m.close(); }
});

test('D1165: journal and fee LP searches filter actual rows and can be cleared', async () => {
  const m = await mount('/admin/fund-admin/banking/books');
  try {
    await m.changeLabel('Search journal entries', 'missing');
    assert.ok(!m.by('books-journal'));
    await m.changeLabel('Search journal entries', '');
    await m.changeLabel('Journal account', 'CAPITAL');
    assert.match(m.text('books-journal'), /CAPITAL · Capital called/);
    assert.doesNotMatch(m.text('books-journal'), /CASH · Cash/);
  } finally { await m.close(); }
  const n = await mount('/admin/fund-admin/fees');
  try {
    await n.changeLabel('Search fee-line LP ids', '999');
    assert.match(n.text('fee-lines'), /No LP id matches/);
    await n.changeLabel('Search fee-line LP ids', '4');
    assert.ok(n.by('fee-statement-4'));
    await n.changeLabel('Search admission LP ids', '999');
    assert.match(n.text('fee-admissions'), /No LP id matches/);
  } finally { await n.close(); }
});


test('D1165: an entity pack is readable even when no administered fund is recorded', async () => {
  const m = await mount('/admin/fund-admin/reports', {
    overview: () => ({ funds: { state: 'ok', items: [] } }),
    packs: () => ({ items: [{ uid: 'b'.repeat(32), entity_key: 'holdings', kind: 'entity_pack', period_label: 'Q3 2026', status: 'draft' }] }),
  });
  try {
    assert.match(m.text('reports'), /holdings/);
    assert.ok(!m.by('no-administered-fund'));
  } finally { await m.close(); }
});


test('D1165: the integrated LP drawer inherits the phone sheet inside the console', async () => {
  const m = await mount('/admin/fund-admin/lps/4');
  try {
    assert.equal(m.props(m.by('lp-drawer-layer'))['data-phone'], 'sheet');
    assert.match(m.text('lp-drawer'), /Example LP/);
  } finally { await m.close(); }
});
