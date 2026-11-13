/**
 * D4811 (#4811) part 1 — HQ › Contracts v2: the three lifecycles, the
 * Restricted / Incomplete gating render rule, and the agreements row
 * semantics. Every title, slug, name and address is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contracts_v2_4811.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import Wizard from '../src/pages/admin/contracts/EnvelopeWizard.jsx';
import { AgreementCells } from '../src/pages/admin/contracts/AgreementList.jsx';
import { LifecycleBadge } from '../src/pages/admin/contracts/LifecycleBadge.jsx';
import { STATUS_LABELS } from '../src/pages/admin/contracts/governanceModel.js';
import {
  AGREEMENT_STATES, GOVERNANCE_STATES, TEMPLATE_STATES, INCOMPLETE_LINE,
  agreementLifecycle, agreementRowSemantics, governanceLifecycle, templateActions, templateLifecycle,
  templateRefusalMessage,
} from '../src/lib/contractLifecycle.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const user = { id: 2, role: 'admin', name: 'Test Admin', is_super_admin: 1 };
const clean = { restricted: false, restricted_reason: null, incomplete: false, incomplete_reason: null };
const RESTRICTED = { ...clean, restricted: true, restricted_reason: 'Counsel has not reviewed this template’s text. It cannot be used.' };
const INCOMPLETE = { ...clean, incomplete: true, incomplete_reason: 'The template has no body in the library yet.' };

/* ── the lifecycle map ──────────────────────────────────────────────── */

test('D4811 each object kind maps its stored values to its own lifecycle words', () => {
  // Mutation checked: map agreement 'generated' to 'sent' → the second entry reads "Sent".
  assert.deepEqual(['draft', 'generated', 'sent', 'signed', 'void'].map((status) => agreementLifecycle({ status }).label),
    ['Prepared', 'Ready for signature', 'Sent · awaiting signature', 'Executed', 'Voided']); // D4811 part 22: the canvas's Sent pill
  // Mutation checked: leave review → "In review" in GOVERNANCE_KEYS → the second entry fails.
  assert.deepEqual(['draft', 'review', 'approved', 'executed', 'archived'].map((s) => governanceLifecycle(s).label),
    ['Draft', 'In review', 'Approved', 'Executed', 'Archived']);
  assert.deepEqual(STATUS_LABELS, { draft: 'Draft', review: 'In review', approved: 'Approved', executed: 'Executed', archived: 'Archived' },
    'the governance tab reads the same words');
  assert.deepEqual(Object.values(TEMPLATE_STATES).map((s) => s.label), ['Draft', 'Under legal review', 'Approved for use', 'Superseded', 'Archived']);
  assert.equal(agreementLifecycle({ status: 'mystery' }), null, 'an unknown stored value is not given a state');
});

test('D4811 only executed instruments carry the filled seal; "Approved for use" is an outline, never filled', () => {
  const sealed = [TEMPLATE_STATES, AGREEMENT_STATES, GOVERNANCE_STATES].flatMap((m) => Object.values(m).filter((s) => s.treatment === 'seal').map((s) => s.label));
  // Mutation checked: give TEMPLATE_STATES.approved treatment 'seal' → this list gains "Approved for use".
  assert.deepEqual(sealed, ['Executed', 'Executed']);
  assert.equal(TEMPLATE_STATES.approved.treatment, 'outline');
  for (const m of [TEMPLATE_STATES, AGREEMENT_STATES, GOVERNANCE_STATES]) {
    for (const s of Object.values(m)) assert.ok(s.glyph && s.label, `${s.label} has a glyph and words`);
  }
  const approved = renderToStaticMarkup(React.createElement(LifecycleBadge, { badge: templateLifecycle({ published_version: 2, safety: clean }) }));
  assert.match(approved, /data-treatment="outline"/);
  assert.match(approved, /border-dashed/);
  assert.match(approved, /<span aria-hidden="true">✓<\/span>Approved for use/, 'the glyph is hidden; the words are read');
  const executed = renderToStaticMarkup(React.createElement(LifecycleBadge, { badge: agreementLifecycle({ status: 'signed' }) }));
  assert.match(executed, /data-treatment="seal"/);
  assert.doesNotMatch(executed, /border-dashed/);
});

test('D4811 a template\'s lifecycle comes from stored values: publication, version, active, restriction', () => {
  // Mutation checked: drop the `!o.incomplete` guard → a published stub reads "Approved for use".
  assert.equal(templateLifecycle({ published_version: 3, safety: clean }).label, 'Approved for use');
  assert.equal(templateLifecycle({ published_version: 3, safety: INCOMPLETE }).label, 'Draft');
  assert.equal(templateLifecycle({ published_version: null, safety: clean }).label, 'Draft');
  assert.equal(templateLifecycle({ published_version: 3, safety: RESTRICTED }).label, 'Under legal review');
  assert.equal(templateLifecycle({ published_version: 3, safety: clean }, { version: 2 }).label, 'Superseded');
  assert.equal(templateLifecycle({ is_active: 0, published_version: 3, safety: clean }).label, 'Archived');
  // A row read before the Worker sent `safety` falls back to the same rule.
  assert.equal(templateLifecycle({ counsel_review: true, published_version: 1 }).label, 'Under legal review');
});

/* ── the gating render rule ─────────────────────────────────────────── */

test('D4811 restricted or incomplete: Generate, Use template and Publish are withheld, with the reason', () => {
  // Mutation checked: let templateActions ignore `incomplete` → canPublish is true for the stub.
  const r = templateActions({ safety: RESTRICTED });
  assert.deepEqual([r.canGenerate, r.canUseTemplate, r.canPublish], [false, false, false]);
  assert.equal(r.banner.title, 'Restricted — Legal review required');
  assert.match(r.banner.reason, /Counsel has not reviewed/);
  assert.deepEqual(r.unavailable, ['Generate agreement', 'Use template', 'Publish']);
  const i = templateActions({ safety: INCOMPLETE });
  assert.deepEqual([i.canGenerate, i.canUseTemplate, i.canPublish], [false, false, false]);
  assert.deepEqual([i.banner.title, i.banner.reason], ['Template incomplete', INCOMPLETE_LINE]);
  assert.equal(INCOMPLETE_LINE, 'This document has not yet been completed and cannot be used to generate an agreement.');
  const both = templateActions({ safety: { ...RESTRICTED, incomplete: true } });
  assert.deepEqual(both.overlays, ['restricted', 'incomplete'], 'both overlays show, beside the state');
  assert.equal(both.banner.kind, 'restricted');
  const ok = templateActions({ safety: clean });
  assert.deepEqual([ok.canGenerate, ok.canUseTemplate, ok.canPublish, ok.banner], [true, true, true, null]);
  assert.equal(templateActions({ is_stub: 1 }).canPublish, false, 'fallback: a stub row without `safety`');
  assert.match(templateRefusalMessage({ code: 'template_has_no_body' }), /Template incomplete\. This document has not yet been completed/);
  assert.match(templateRefusalMessage({ code: 'template_restricted', data: { message: 'Restricted — Legal review required. Words.' } }), /^Restricted — Legal review required\. Words\.$/);
  assert.equal(templateRefusalMessage({ code: 'published_version_changed' }), null);
});

const base = { category: 'gp', layer: 'gp', layer_label: 'Internal Management (GP Level)', doc_kind: null, axal_party: null, format_fixed: false,
  usage_count: 0, kind: 'agreement', party: 'gp', is_stub: 0, format_options: { kinds: ['agreement'], parties: ['gp', 'none'], partyless_kinds: [], derived: { kind: 'agreement', party: 'gp' }, entity: 'gp' } };
const ROWS = {
  restricted: { ...base, slug: 'syn_restricted', title: 'Restricted Synthetic', version: 2, body_md: 'Body text', published_version: null, counsel_review: true, safety: RESTRICTED },
  stub: { ...base, slug: 'syn_stub', title: 'Stub Synthetic', version: 1, body_md: '', is_stub: 1, published_version: null, safety: INCOMPLETE },
  ready: { ...base, slug: 'syn_ready', title: 'Ready Synthetic', version: 3, body_md: 'Ready text', published_version: 2, safety: clean },
};

async function openEditor(key) {
  for (const k of Object.keys(originals)) if (typeof originals[k] === 'function') api[k] = () => never();
  api.adminTemplateStoreGet = async (slug) => ({ template: { ...Object.values(ROWS).find((r) => r.slug === slug) } });
  api.adminTemplateStoreVersions = async () => ({ versions: [] });
  for (const k of Object.keys(contractOriginals)) contractsApi[k] = () => never();
  contractsApi.templates = async () => ({ items: Object.values(ROWS) });
  contractsApi.renderPaper = async () => ({ html: '<p>paper</p>', paper_sha256: 'sha-fixture', fields: [] });
  contractsApi.paperFonts = async () => ({ paper_sha256: 'sha-fixture', css: '' });
  const view = await mountContracts(React.createElement(AuthProvider, null, React.createElement(Desk)), '/admin/contracts?tab=templates', user);
  await view.flush();
  await view.click(ROWS[key].title);
  await view.flush();
  await act(async () => { await new Promise((r) => setTimeout(r, 560)); });
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const byTestId = (id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
  return { view, text: () => textOf(view.nodes()[0]), byTestId };
}

test('D4811 the editor does not render Publish for a restricted template, and says why', async () => {
  // Mutation checked: drop `|| !actions.canPublish` in TemplateEditor → template-publish-one renders.
  const e = await openEditor('restricted');
  try {
    assert.equal(!!e.byTestId('template-publish-one'), false, 'Publish is not rendered, not merely disabled');
    assert.ok(e.byTestId('safety-banner-restricted'));
    assert.match(e.text(), /Restricted — Legal review required/);
    assert.match(e.text(), /Counsel has not reviewed this template’s text/);
    assert.match(e.text(), /Not available while restricted: Generate agreement · Use template · Publish/);
    assert.match(e.text(), /Under legal review/);
  } finally { await e.view.unmount(); restore(); }
});

test('D4811 the editor shows "Template incomplete" for a stub, with no Publish', async () => {
  const e = await openEditor('stub');
  try {
    assert.equal(!!e.byTestId('template-publish-one'), false);
    assert.ok(e.byTestId('safety-banner-incomplete'));
    assert.match(e.text(), /Template incomplete/);
    assert.match(e.text(), /This document has not yet been completed and cannot be used to generate an agreement\./);
  } finally { await e.view.unmount(); restore(); }
});

test('D4811 a complete, approved template keeps Publish and shows "Approved for use" as an outline', async () => {
  const e = await openEditor('ready');
  try {
    assert.ok(e.byTestId('template-publish-one'), 'Publish v3 is offered');
    assert.equal(!!e.byTestId('safety-banner-restricted'), false);
    assert.equal(!!e.byTestId('safety-banner-incomplete'), false);
    const badge = e.view.nodes().find((n) => e.view.props(n)?.['data-testid'] === 'lifecycle-template' && e.view.props(n)?.['data-treatment'] === 'outline');
    assert.ok(badge, 'the editor header carries the outline "Approved for use" badge');
  } finally { await e.view.unmount(); restore(); }
});

test('D4811 New envelope does not offer a restricted publication as a choice, and does offer a complete one', async () => {
  // Mutation checked: render every item as a button again → the gated row is a BUTTON and the banner text is gone.
  for (const k of Object.keys(contractOriginals)) contractsApi[k] = () => never();
  contractsApi.published = async () => ({ items: [
    { slug: 'syn_restricted', title: 'Restricted Synthetic', version: 2, fields: [], safety: RESTRICTED },
    { slug: 'syn_ready', title: 'Ready Synthetic', version: 3, fields: [], safety: clean },
  ] });
  contractsApi.recipients = async () => ({ items: [], total: 0 });
  contractsApi.deals = async () => ({ items: [], total: 0 });
  contractsApi.providers = async () => ({ native: { available: true }, docusign: { available: false, reason: 'Not on this plan.' } });
  const view = await mountContracts(React.createElement(Wizard, { onClose() {}, onTemplates() {}, onSent() {} }));
  try {
    await view.flush();
    const gated = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'envelope-template-gated-syn_restricted');
    assert.ok(gated, 'the restricted publication is drawn as a note');
    assert.notEqual(String(gated.tagName), 'BUTTON');
    assert.match(view.text(), /Restricted — Legal review required/);
    const choices = view.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => view.props(n)?.children).flat().join('|');
    assert.match(choices, /Ready Synthetic/);
    assert.doesNotMatch(choices, /Restricted Synthetic/);
  } finally { await view.unmount(); restore(); }
});

/* ── the agreements row ─────────────────────────────────────────────── */

const cells = (row) => renderToStaticMarkup(React.createElement('table', null, React.createElement('tbody', null,
  React.createElement('tr', null, React.createElement(AgreementCells, { row })))));

test('D4811 an agreement awaiting signature reads "Sent <date> · Awaiting signature", with no missing-date warning', () => {
  const row = { status: 'sent', source: 'esign', provider: 'native', sent_at: '2026-05-12T09:00:00Z', signed_at: null, project_name: 'Synthetic Co', recipient_name: 'Signer One' };
  const m = agreementRowSemantics(row);
  // Mutation checked: return the badge label instead of the sent line → this reads "Sent".
  assert.equal(m.line, 'Sent 12 May 2026 · Awaiting signature');
  assert.equal(m.warning, null);
  const html = cells(row);
  assert.match(html, /Sent 12 May 2026 · Awaiting signature/);
  assert.doesNotMatch(html, /No signature date|Both dates are needed|Not recorded/);
  // A send that was never recorded is a neutral note, never a warning.
  const unsent = agreementRowSemantics({ ...row, sent_at: null });
  assert.deepEqual([unsent.line, unsent.sentMissing, unsent.warning], ['Awaiting signature', true, null]);
  assert.match(cells({ ...row, sent_at: null }), /Not recorded.*No send event\./);
  assert.equal(agreementRowSemantics({ ...row, status: 'generated', sent_at: null }).sentMissing, false, 'ready, not yet sent, misses nothing');
});

test('D4811 a missing company link reads "Unlinked recipient", with no repair action (no link flow exists)', () => {
  // Mutation checked: keep D647's <Recorded reason="No company link."> → "Unlinked recipient" is missing.
  const html = cells({ status: 'sent', source: 'documents', project_name: null, recipient_email: 'signer@example.test' });
  assert.match(html, /Unlinked recipient/);
  assert.doesNotMatch(html, /No company link/);
  assert.doesNotMatch(html, /<button/, 'no repair control is drawn');
  assert.deepEqual(agreementRowSemantics({ status: 'sent', project_name: 'Synthetic Co' }).company, { name: 'Synthetic Co' });
});

test('D4811 warnings are reserved for contradictions: marked signed with no execution evidence', () => {
  // Mutation checked: make hasExecutionEvidence always true → no warning for the bare signed row.
  const bare = { status: 'signed', source: 'pairwise_nda', signed_at: null, file_key: null, file_sha256: null, envelope_uuid: null, project_name: 'Synthetic Co' };
  const m = agreementRowSemantics(bare);
  assert.equal(m.warning, 'Marked executed · no execution evidence'); // D4811 part 22: Executed everywhere
  assert.equal(m.badge, null, 'a contradiction never wears the Executed seal');
  const html = cells(bare);
  assert.match(html, /data-testid="agreement-contradiction"/);
  assert.doesNotMatch(html, /data-treatment="seal"/);
  // Each kind of evidence clears it; an executed row wears the seal.
  for (const evidence of [{ signed_at: '2026-06-03T10:00:00Z' }, { file_key: 'k' }, { envelope_uuid: 'syn-env' }, { source: 'esign', raw_status: 'completed' }]) {
    const ok = agreementRowSemantics({ ...bare, ...evidence });
    assert.equal(ok.warning, null, JSON.stringify(evidence));
    assert.equal(ok.badge.label, 'Executed');
  }
  assert.equal(agreementRowSemantics({ ...bare, signed_at: '2026-06-03T10:00:00Z' }).line, 'Executed 3 Jun 2026');
  assert.match(cells({ ...bare, signed_at: '2026-06-03T10:00:00Z' }), /data-treatment="seal"/);
  // No other state warns.
  for (const status of ['draft', 'generated', 'sent', 'void']) assert.equal(agreementRowSemantics({ status }).warning, null, status);
});
