import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import Wizard from '../src/pages/admin/contracts/EnvelopeWizard.jsx';
import Detail from '../src/pages/admin/contracts/AgreementDetail.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
const fail = () => Promise.reject(new Error('controlled read failure'));
const empty = () => Promise.resolve({ items: [], total: 0 });
function setup(answers = {}, contractAnswers = {}) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...args) => { calls.push([key, args]); return (answers[key] || never)(...args); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const user = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
const element = () => React.createElement(AuthProvider, null, React.createElement(Desk));
const tabReads = [
  ['agreements', null, 'agreements', 'agreements', 'No agreement'],
  ['ndas', 'adminListPairwiseNdas', null, 'ndas', 'No NDA'],
  ['partner-deals', 'adminListPartnerDeals', null, 'partner deals', 'No partner deal'],
  ['templates', null, 'templates', '', 'No templates'],
  ['forms', 'adminListForms', null, 'forms', 'No form'],
  // D769 (#2088): this row expected 'No', which only the rail's retired line
  // "No switch here. Nothing on this page fills a blank for you." ever matched;
  // the registry draws no empty sentence of its own. It now reads what the
  // registry does draw on a successful empty read.
  ['document-types', 'adminContractRegistryHub', null, 'doc-type registry', 'registered types across the code layers'],
];
for (const [tab, legacy, domain, loading, emptyText] of tabReads) {
  test(`D647 ${tab}: renders loading, successful empty and failed reads with retry`, async () => {
    for (const phase of ['loading', 'empty', 'failure']) {
      const answer = phase === 'loading' ? never : phase === 'failure' ? fail : empty;
      const calls = setup(legacy ? { [legacy]: answer } : {}, { stats: never, ...(domain ? { [domain]: answer } : {}) });
      const view = await mountContracts(element(), `/admin/contracts?tab=${tab}`, user);
      try {
        await view.flush();
        if (phase === 'loading') assert.match(view.text(), new RegExp(`Loading${loading ? '.*' + loading : ''}`, 'i'));
        if (phase === 'empty') assert.match(view.text(), new RegExp(emptyText));
        if (phase === 'failure') {
          assert.match(view.text(), /could not be read/);
          assert.match(view.text(), /Try again/);
          assert.doesNotMatch(view.text(), new RegExp(emptyText + ' (agreement|NDA|partner deal|templates|form)'));
          const before = calls.filter(([key]) => key === (legacy || domain)).length;
          await view.click('Try again'); await view.flush();
          assert.equal(calls.filter(([key]) => key === (legacy || domain)).length, before + 1);
        }
      } finally { await view.unmount(); restore(); }
    }
  });
}

test('D647 a plain admin never renders or reads the document registry, including a direct tab URL', async () => {
  const calls = setup({}, { stats: never });
  const view = await mountContracts(element(), '/admin/contracts?tab=document-types', { ...user, is_super_admin: 0 });
  try { await view.flush(); assert.doesNotMatch(view.text(), /New document type|Document types/); assert.match(view.text(), /not available/); assert.equal(calls.filter(([key]) => key === 'adminContractRegistryHub').length, 0); }
  finally { await view.unmount(); restore(); }
});

test('D647 counted pages reach agreements beyond 200 and preserve filters', async () => {
  const calls = setup({}, { stats: never, agreements: async params => ({ total: 251, items: Array.from({ length: 25 }, (_, i) => ({ id: params.offset + i, uid: `doc-${params.offset + i}`, title: `Agreement ${params.offset + i}`, source: 'documents', status: 'sent', raw_status: 'viewed', created_at: '2026-10-01T10:00:00Z' })) }) });
  const view = await mountContracts(element(), '/admin/contracts?offset=200&template=safe&status=awaiting_signature', user);
  try {
    await view.flush(); assert.match(view.text(), /201–225 of 251/); assert.match(view.text(), /Agreement 200/); assert.match(view.text(), /Viewed/); assert.match(view.text(), /Not recorded.*No send event/);
    await view.click('Next'); await view.flush();
    assert.equal(calls.filter(([key]) => key === 'agreements').at(-1)[1][0].offset, 225);
    assert.equal(calls.filter(([key]) => key === 'agreements').at(-1)[1][0].template, 'safe');
    assert.match(view.text(), /226–250 of 251/);
  } finally { await view.unmount(); restore(); }
});

const template = { slug: 'safe', title: 'SAFE', version: 3, fields: [{ key: 'price', label: 'price', required: true }] };
const wizardAnswers = { published: async () => ({ items: [template] }), recipients: empty, deals: empty,
  providers: async () => ({ native: { available: true }, docusign: { available: false, reason: 'Not on this plan. Studio is required.' } }) };
test('D647 wizard renders no published template and retry after an unreadable read', async () => {
  for (const answer of [empty, fail]) {
    setup({}, { ...wizardAnswers, published: answer });
    const view = await mountContracts(React.createElement(Wizard, { onClose() {}, onTemplates() {}, onSent() {} }));
    try { await view.flush(); assert.match(view.text(), answer === empty ? /No published template/ : /Unreadable.*Try again/); }
    finally { await view.unmount(); restore(); }
  }
});
test('D647 wizard requires fields, shows the provider restriction, previews before sending and reports a failed send', async () => {
  const calls = setup({}, { ...wizardAnswers, preview: async () => ({ pdf_base64: btoa('%PDF-test'), body_sha256: 'approved-body' }), send: () => Promise.reject(Object.assign(new Error('refused'), { status: 422 })) });
  const view = await mountContracts(React.createElement(Wizard, { onClose() {}, onTemplates() {}, onSent() {} }));
  try {
    await view.flush(); await view.click('SAFE · v3'); await view.click('2. Recipient');
    await view.fill('Recipient name', 'Founder'); await view.fill('Recipient email', 'founder@example.test');
    await view.click('6. Preview and send'); await view.click('Preview PDF'); assert.match(view.text(), /A required field is missing: price/);
    assert.equal(calls.filter(([key]) => key === 'preview').length, 0);
    await view.click('3. Fields'); await view.fill('price', '$100'); await view.click('5. Provider'); assert.match(view.text(), /DocuSign not available.*Not on this plan/);
    await view.click('6. Preview and send'); await view.click('Preview PDF'); await view.flush();
    assert.equal(calls.filter(([key]) => key === 'preview')[0][1][0].fields.price, '$100');
    await view.click('Send'); await view.flush(); assert.match(view.text(), /The send failed. Nothing was sent. Try again/);
    assert.equal(calls.filter(([key]) => key === 'send')[0][1][0].preview_sha256, 'approved-body');
  } finally { await view.unmount(); restore(); }
});

test('D647 wizard distinguishes an existing envelope with failed invitation delivery', async () => {
  setup({}, { ...wizardAnswers, preview: async () => ({ pdf_base64: btoa('%PDF-test'), body_sha256: 'approved' }), send: async () => ({ envelope_uuid: 'env', email_sent: false }) });
  const view = await mountContracts(React.createElement(Wizard, { onClose() {}, onTemplates() {}, onSent() {} }));
  try {
    await view.flush(); await view.click('SAFE · v3'); await view.click('2. Recipient'); await view.fill('Recipient name', 'Founder'); await view.fill('Recipient email', 'founder@example.test'); await view.click('3. Fields'); await view.fill('price', '100'); await view.click('6. Preview and send'); await view.click('Preview PDF'); await view.flush(); await view.click('Send'); await view.flush();
    assert.match(view.text(), /envelope was created, but its invitation was not sent/); assert.doesNotMatch(view.text(), /Nothing was sent/);
  } finally { await view.unmount(); restore(); }
});

test('D647 tabs display a reason for data that was never recorded', async () => {
  const cases = [
    ['agreements', {}, { agreements: async () => ({ total: 1, items: [{ id: 1, uid: 'doc', title: 'SAFE', source: 'documents', status: 'sent' }] }) }, /Not recorded.*No send event/],
    ['ndas', { adminListPairwiseNdas: async () => ({ total: 1, items: [{ id: 1, status: 'active' }] }) }, {}, /Not recorded.*no recorded end date/],
    ['partner-deals', { adminListPartnerDeals: async () => ({ total: 1, items: [{ id: 1, status: 'active', redemption_count: 0 }] }) }, {}, /Not recorded.*without a recorded term/],
    ['templates', {}, { templates: async () => ({ items: [{ slug: 'safe', title: 'SAFE', category: 'gp', version: 1, usage_count: 0 }] }) }, /Not recorded: imported before editors were recorded/],
    ['forms', { adminListForms: async () => ({ items: [{ id: 'ss4', title: 'SS-4', pages: 1 }] }) }, {}, /Not recorded.*does not record editor history/],
    ['document-types', { adminContractRegistryHub: async () => ({ items: [{ doc_type: 'safe', title: 'SAFE', layer: 'portfolio', registry_status: 'published', usage_count: 0 }], layers: [], decisions: {} }) }, {}, /this type went live before publishing was recorded/],
  ];
  for (const [tab, legacy, domain, missing] of cases) {
    setup(legacy, { stats: async () => ({ total: 1, pending_signature: 1, by_status: { signed: 0 }, avg_days_to_sign: null, signed_last_30d: 0 }), ...domain });
    const view = await mountContracts(element(), `/admin/contracts?tab=${tab}`, user);
    try { await view.flush(); if (tab === 'templates') assert.ok(view.nodes().some(node => missing.test(String(view.props(node)?.title || ''))), 'D717: the template card carries its missing editor on hover'); else if (tab === 'document-types') assert.ok(view.nodes().some(node => missing.test(String(view.props(node)?.title || ''))), 'registry missing-data reason is available on hover'); else assert.match(view.text(), missing); assert.match(view.text(), /No signed agreement has both a recorded sent and signed date/); }
    finally { await view.unmount(); restore(); }
  }
});

test('D647 detail renders parties, history, fingerprint and confirmed reason/resend actions', async () => {
  const calls = setup({ adminGetContract: async () => ({ uid: 'env', title: 'SAFE', source: 'esign', status: 'sent', provider: 'native', can_resend: true }), adminResendContract: async () => ({ email_sent: false }), adminVoidContractWithReason: async () => ({ ok: true }) },
    { history: async () => ({ parties: [{ name: 'Founder', email: 'founder@example.test', signer_ip: '203.0.113.1', signed_at: '2026-10-08T00:00:00Z' }], timeline: [{ action: 'email_sent', ts: '2026-10-07T00:00:00Z' }], voids: [] }), signedPdf: async () => ({ available: true, sha256: 'signed-file-fingerprint', pdf_base64: btoa('%PDF-test') }) });
  const view = await mountContracts(React.createElement(Detail, { uid: 'env', onClose() {}, onChanged() {} }));
  try {
    await view.flush(); assert.match(view.text(), /Founder.*203\.0\.113\.1/); assert.match(view.text(), /TimelineSent/); assert.match(view.text(), /SHA-256: signed-file-fingerprint/);
    await view.click('Resend'); await view.flush(); assert.match(view.text(), /invitation could not be sent/);
    await view.click('Void…'); await view.fill('Reason for voiding', 'Sent to the wrong party'); await view.click('Confirm void'); await view.flush();
    assert.deepEqual(calls.find(([key]) => key === 'adminVoidContractWithReason')[1], ['env', 'Sent to the wrong party']); assert.match(view.text(), /reason is recorded/);
  } finally { await view.unmount(); restore(); }
});

test('D647 template usage opens filtered agreements and publication asks for a concrete confirmation', async () => {
  // D717 (#1851, #1852): publication is per template, from the editor; the tab has no library-wide Publish.
  const safe = { slug: 'safe', title: 'SAFE', version: 3, category: 'gp', body_md: 'Body', usage_count: 18 };
  const calls = setup({ adminTemplateStoreGet: async () => ({ template: safe }), adminTemplateStoreVersions: async () => ({ versions: [] }) },
    { templates: async () => ({ items: [safe] }), stats: never, agreements: empty, renderPaper: async () => ({ html: '<p>paper</p>', paper_sha256: 'sha', fields: [] }), paperFonts: async () => ({ paper_sha256: 'sha', css: '' }),
      publishOne: async () => ({ ok: true, publication: { version: 3, published_at: '2026-10-18 12:00:00', published_by: 2 } }) });
  let view = await mountContracts(element(), '/admin/contracts?tab=templates', user);
  try {
    await view.flush(); assert.ok(!view.nodes().some(n => view.props(n)?.['data-testid'] === 'template-publish'), 'no library-wide Publish');
    await view.click('SAFE'); await view.flush(); await view.click('Publish v3'); await view.flush();
    assert.equal(calls.filter(([key]) => key === 'publishOne').length, 0, 'the dialog asks first');
    const confirm = view.nodes().find(n => view.props(n)?.['data-testid'] === 'template-publish-confirm');
    const { act } = await import('react');
    await act(async () => { view.props(confirm).onClick({ stopPropagation() {} }); }); await view.flush();
    assert.deepEqual(calls.filter(([key]) => key === 'publishOne').map(([, a]) => a), [['safe', 3]]); assert.match(view.text(), /Published v3/);
  } finally { await view.unmount(); }
  view = await mountContracts(element(), '/admin/contracts?tab=templates', user);
  try {
    await view.flush(); await view.click('18 uses'); await view.flush(); assert.equal(calls.filter(([key]) => key === 'agreements').at(-1)[1][0].template, 'safe');
  } finally { await view.unmount(); restore(); }
});

test('D647 deleting a template requires confirmation and preserves the cancelled template', async () => {
  const stored = { slug: 'safe', title: 'SAFE', category: 'gp', version: 3, body_md: 'Template body', usage_count: 1 };
  const calls = setup({ adminTemplateStoreGet: async () => ({ template: stored }), adminTemplateStoreVersions: async () => ({ versions: [{ version: 2, title: 'Previous SAFE', body_md: 'Old body', category: 'gp' }] }), adminTemplateStoreDelete: async () => ({ ok: true }) },
    { stats: never, templates: async () => ({ items: [stored] }) });
  const view = await mountContracts(element(), '/admin/contracts?tab=templates', user);
  try {
    await view.flush(); await view.click('SAFE'); await view.flush(); await view.click('History (1)');
    assert.match(view.text(), /v2 ·/); await view.click('View'); assert.match(view.text(), /Previewing v2/);
    await view.click('Delete');
    assert.match(view.text(), /Agreements already sent keep their copy/); assert.equal(calls.filter(([key]) => key === 'adminTemplateStoreDelete').length, 0);
    await view.click('Cancel'); assert.doesNotMatch(view.text(), /Agreements already sent keep their copy/);
    await view.click('Delete'); await view.click('Confirm delete'); await view.flush();
    assert.deepEqual(calls.find(([key]) => key === 'adminTemplateStoreDelete')[1], ['safe']);
  } finally { await view.unmount(); restore(); }
});

test('D647 clicking a count opens the matching Worker filter', async () => {
  const calls = setup({}, { stats: async () => ({ total: 251, pending_signature: 4, by_status: { signed: 247 }, avg_days_to_sign: 2, signed_last_30d: 7 }), agreements: empty });
  const view = await mountContracts(element(), '/admin/contracts?tab=forms', user);
  try {
    await view.flush(); await view.click('Awaiting signature4'); await view.flush(); assert.equal(calls.filter(([key]) => key === 'agreements').at(-1)[1][0].status, 'awaiting_signature');
    await view.click('Signed, last 30 days7'); await view.flush(); assert.equal(calls.filter(([key]) => key === 'agreements').at(-1)[1][0].signed_recent, 'true');
  } finally { await view.unmount(); restore(); }
});
