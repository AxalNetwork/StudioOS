/**
 * D5051 (#5051, part 1) — legal readiness in Licences and Program access: the package agreement, the program
 * agreements with their canonical Contracts record, package readiness ("1 of 3 programs in force"), the legal
 * Needs HQ signals, and Program access's grant / agreement / in force split. Every read is a stubbed fetch, so
 * the client modules, the model and the page run as they do in the browser. Every name is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_legal_readiness_5051.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import LicenceAgreements from '../src/pages/admin/licences/LicenceAgreements.jsx';
import ProgramLegalAccess from '../src/pages/admin/grants/ProgramLegalAccess.jsx';
import {
  contractsHref, documentState, legalSignals, packageReadiness, programReadiness,
} from '../src/lib/licenceLegalReadiness.js';
import { waitingWord } from '../src/pages/admin/grants/grantsModel.js';

const LIC = 'lic_fr';
const doc = (o) => ({ package_key: null, gating: true, executed_agreement_uid: null, in_flight_agreement_uid: null, awaiting_signature: false, satisfied: false, ...o });
const LEGAL = {
  licence_uid: LIC,
  holdings: [{
    uid: 'h1', scope_kind: 'package', scope_key: 'venture_building', policy_version: 1, latest_version: 2, behind_latest: true, current: true,
    origin: 'package_offer_accepted', frozen_at: '2026-12-01T09:00:00Z', superseded_at: null,
    policy: { strategy: 'per_program', legal_gate: 'required_before_in_force', programs: ['spinout-lab', 'mentor-cohorts', 'referral-partners'], required_schedules: null },
  }],
  programs: [
    { program_key: 'spinout-lab', status: 'in_force', word: 'In force', legally_in_force: true, missing: [],
      requirement: { basis: 'package', strategy: 'per_program', legal_gate: 'required_before_in_force', package_key: 'venture_building', documents: [
        doc({ slot_key: 'program_licence:spinout-lab', kind: 'program_licence', label: 'Program licence agreement', executed_agreement_uid: 'ag1', satisfied: true }),
        doc({ slot_key: 'program_schedule:spinout-lab', kind: 'program_schedule', label: 'Program schedule', executed_agreement_uid: 'ag2', satisfied: true }),
      ] } },
    { program_key: 'mentor-cohorts', status: 'awaiting_signature', word: 'Awaiting signature', legally_in_force: false, missing: ['program_licence:mentor-cohorts'],
      requirement: { basis: 'package', strategy: 'per_program', legal_gate: 'required_before_in_force', package_key: 'venture_building', documents: [
        doc({ slot_key: 'program_licence:mentor-cohorts', kind: 'program_licence', label: 'Program licence agreement', in_flight_agreement_uid: 'ag3', awaiting_signature: true }),
        // Signed on the grant (a legacy schedule with no canonical row): not missing, so executed on the grant's word.
        doc({ slot_key: 'program_schedule:mentor-cohorts', kind: 'program_schedule', label: 'Program schedule' }),
      ] } },
    { program_key: 'referral-partners', status: 'granted_agreement_required', word: 'Granted — agreement required', legally_in_force: false, missing: ['program_licence:referral-partners'],
      requirement: { basis: 'package', strategy: 'per_program', legal_gate: 'required_before_in_force', package_key: 'venture_building', documents: [
        doc({ slot_key: 'program_licence:referral-partners', kind: 'program_licence', label: 'Program licence agreement', in_flight_agreement_uid: 'ag4' }),
      ] } },
    { program_key: 'perks', status: 'granted_agreement_required', word: 'Granted — agreement required', legally_in_force: false, missing: ['program_schedule:perks'],
      requirement: { basis: 'not_recorded', strategy: null, legal_gate: null, package_key: null, documents: [
        doc({ slot_key: 'program_schedule:perks', kind: 'program_schedule', label: 'Program schedule' }),
      ] } },
  ],
  replacements_required: [{ agreement_uid: 'ag1', slot_key: 'program_licence:spinout-lab', why: 'grant_terms_changed', detail: {}, replacement_in_flight_uid: null }],
};
const row = (o) => ({ envelope_uuid: null, package_key: null, effective_from: null, signed_at: null, sent_at: null, unresolved_fields_json: '[]', ...o });
const AGREEMENTS = {
  licence_uid: LIC,
  agreements: [
    row({ id: 1, uid: 'ag1', slot_key: 'program_licence:spinout-lab', agreement_kind: 'program_licence', program_key: 'spinout-lab', status: 'executed', envelope_uuid: 'env-1', effective_from: '2026-12-01' }),
    row({ id: 2, uid: 'ag2', slot_key: 'program_schedule:spinout-lab', agreement_kind: 'program_schedule', program_key: 'spinout-lab', status: 'executed', envelope_uuid: 'env-2', signed_at: '2026-12-02T10:00:00Z' }),
    row({ id: 3, uid: 'ag3', slot_key: 'program_licence:mentor-cohorts', agreement_kind: 'program_licence', program_key: 'mentor-cohorts', status: 'sent', envelope_uuid: 'env-3', sent_at: '2026-12-03T10:00:00Z' }),
    row({ id: 4, uid: 'ag4', slot_key: 'program_licence:referral-partners', agreement_kind: 'program_licence', program_key: 'referral-partners', status: 'draft', unresolved_fields_json: '["licence.signatory_title"]' }),
  ],
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const never = () => new Promise(() => {});
/** A fetch that answers the two Worker reads; `answers` overrides one by its path. */
function stubFetch(answers = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    calls.push(path);
    for (const [k, v] of Object.entries(answers)) if (path.includes(k)) return v();
    if (path.endsWith(`/api/admin/licence-agreement-policies/licences/${LIC}`)) return json(LEGAL);
    if (path.endsWith(`/api/admin/licence-agreements/licences/${LIC}`)) return json(AGREEMENTS);
    if (path.endsWith(`/api/admin/licence-agreement-policies/licences/${LIC}/history`)) return json({ items: [] });
    return json({ error: 'unexpected', message: path }, 404);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
async function mount(element, answers) {
  const f = stubFetch(answers);
  const view = await mountContracts(element);
  await view.flush(); await view.flush();
  const unmount = view.unmount;
  view.unmount = async () => { await unmount(); f.restore(); };
  view.calls = f.calls;
  return view;
}
const byTestId = (view, id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
const textIn = (view, id) => {
  const n = byTestId(view, id);
  const walk = (x) => (!x ? '' : x.nodeType === 3 || !(x.childNodes || []).length ? (x.textContent || '') : x.childNodes.map(walk).join(''));
  return walk(n);
};
const hrefOf = (view, id) => view.props(byTestId(view, id))?.href ?? view.props(byTestId(view, id))?.to;

test('D5051 a document reads one of the six states, and a replacement never reads plainly executed', () => {
  assert.equal(documentState(doc({ slot_key: 's', kind: 'program_licence', executed_agreement_uid: 'x' })), 'executed');
  assert.equal(documentState(doc({ slot_key: 's', kind: 'program_licence', executed_agreement_uid: 'x' }), { replacements: [{ agreement_uid: 'x' }] }), 'replacement_required');
  assert.equal(documentState(doc({ slot_key: 's', kind: 'program_licence', in_flight_agreement_uid: 'y', awaiting_signature: true })), 'awaiting_signature');
  assert.equal(documentState(doc({ slot_key: 's', kind: 'program_licence', in_flight_agreement_uid: 'y' })), 'prepared');
  assert.equal(documentState(doc({ slot_key: 's', kind: 'program_licence' })), 'not_prepared');
  // A schedule the grant records as signed is executed; one the read names missing is not.
  assert.equal(documentState(doc({ slot_key: 's', kind: 'program_schedule' }), { missing: [] }), 'executed');
  assert.equal(documentState(doc({ slot_key: 's', kind: 'program_schedule' }), { missing: ['s'] }), 'not_prepared');
  assert.equal(documentState(null), 'not_recorded');
  // Unknown is Not recorded, never assumed.
  const p = programReadiness(LEGAL.programs[3], { licenceUid: LIC, agreements: AGREEMENTS });
  assert.equal(p.required, 'Yes');
  assert.equal(p.policyRecorded, false);
  const none = programReadiness({ ...LEGAL.programs[3], missing: [], status: 'in_force', requirement: { basis: 'not_recorded', documents: [] } }, { licenceUid: LIC });
  assert.equal(none.agreementState, 'not_recorded');
  assert.equal(none.required, 'Not recorded');
});

test('D5051 one canonical record: an envelope opens its workspace, an unsent version its licence\'s filtered list', () => {
  assert.equal(contractsHref({ row: AGREEMENTS.agreements[0], licenceUid: LIC }), '/admin/contracts/agreements/doc/env-1');
  assert.equal(contractsHref({ row: AGREEMENTS.agreements[3], licenceUid: LIC }), '/admin/contracts?licence=lic_fr&agreement_type=program_licence&program=referral-partners');
  assert.equal(contractsHref({ licenceUid: LIC, kind: 'package_master', packageKey: 'venture_building' }), '/admin/contracts?licence=lic_fr&agreement_type=package&package=venture_building');
  // The desk keeps those filters in its address, so the link lands on them (they were dropped before D5051).
  const desk = readFileSync('frontend/src/pages/admin/contracts/ContractsDesk.jsx', 'utf8');
  const keys = desk.match(/const filterKeys = \[([^\]]+)\]/)[1];
  for (const k of ['agreement_type', 'licence', 'program', 'package', 'agreement_status']) assert.match(keys, new RegExp(`'${k}'`));
});

test('D5051 package readiness counts only what the legal read says is in force', () => {
  const pkg = packageReadiness(LEGAL, { licenceUid: LIC, agreements: AGREEMENTS });
  assert.equal(pkg.recorded, true);
  assert.equal(pkg.name, 'Venture Building');
  assert.equal(pkg.master, null, 'per program: no master agreement');
  assert.deepEqual([pkg.inForce, pkg.total], [1, 3]);
  assert.deepEqual(pkg.standalone, ['Perks']);
  assert.equal(packageReadiness({ ...LEGAL, holdings: [] }, { licenceUid: LIC }).recorded, false);
  const master = packageReadiness({ ...LEGAL, holdings: [{ ...LEGAL.holdings[0], policy: { ...LEGAL.holdings[0].policy, strategy: 'package_master' } }] }, { licenceUid: LIC, agreements: AGREEMENTS });
  assert.equal(master.master.state, 'not_prepared');
});

test('D5051 Needs HQ names each actionable legal state, in the canvas order, with where to act', () => {
  const s = legalSignals(LEGAL, { licenceUid: LIC, agreements: AGREEMENTS });
  assert.deepEqual(s.map((x) => x.kind), ['not_prepared', 'missing_fields', 'awaiting_signature', 'stale']);
  assert.equal(s[0].href, '/admin/licences/programs/studio/lic_fr', 'a schedule is sent from Program access');
  assert.match(s[1].detail, /licence\.signatory_title/);
  const ready = legalSignals(LEGAL, { licenceUid: LIC, agreements: { agreements: [{ ...AGREEMENTS.agreements[3], status: 'ready', unresolved_fields_json: '[]' }] } });
  assert.ok(ready.some((x) => x.kind === 'awaiting_send'));
  assert.equal(waitingWord(['agreement_executed']), 'its agreement to be executed');
});

test('mounted: the Agreement section shows package, program agreements, readiness and Needs HQ, each linking to Contracts', async () => {
  const view = await mount(React.createElement(LicenceAgreements, { licence: { uid: LIC } }));
  try {
    const text = view.text();
    assert.match(textIn(view, 'licence-package-agreement'), /Venture Building Package Agreement/);
    assert.match(textIn(view, 'licence-package-agreement'), /No master agreement · per program/);
    assert.match(textIn(view, 'licence-package-agreement'), /v2 is the latest; this licence keeps the version it froze/);
    assert.equal(textIn(view, 'licence-readiness-summary'), 'Legal readiness1 of 3 programs in force');
    assert.match(textIn(view, 'licence-program-state-spinout-lab-program_licence'), /Replacement required/);
    assert.match(textIn(view, 'licence-program-state-mentor-cohorts-program_licence'), /Awaiting signature/);
    assert.match(textIn(view, 'licence-program-state-referral-partners-program_licence'), /Prepared · not sent/);
    assert.match(textIn(view, 'licence-program-state-perks-program_schedule'), /Not prepared/);
    assert.match(textIn(view, 'licence-program-row-perks-program_schedule'), /Agreement policy not recorded/);
    assert.equal(hrefOf(view, 'licence-program-link-spinout-lab-program_licence'), '/admin/contracts/agreements/doc/env-1');
    assert.equal(hrefOf(view, 'licence-program-link-referral-partners-program_licence'), '/admin/contracts?licence=lic_fr&agreement_type=program_licence&program=referral-partners');
    assert.match(textIn(view, 'licence-program-row-spinout-lab-program_licence'), /2026-12-01/);
    assert.ok(byTestId(view, 'licence-legal-signal-stale'));
    assert.ok(byTestId(view, 'licence-legal-signal-missing_fields'));
    assert.match(text, /Perks is a standalone extra, outside this package\./);
    // Nothing on the page creates or sends a document.
    assert.equal(view.calls.filter((c) => /drafts|\/send|\/void|package-acceptances/.test(c)).length, 0);
    for (const b of view.nodes().filter((n) => n.tagName === 'BUTTON')) assert.doesNotMatch(String(view.props(b)?.children), /Prepare|Send|Draft/);
  } finally { await view.unmount(); }
});

test('mounted: loading, an unreadable readiness read, and an unreadable versions read each say so', async () => {
  let view = await mount(React.createElement(LicenceAgreements, { licence: { uid: LIC } }), { 'licence-agreement-policies/licences': never, 'licence-agreements/licences': never });
  try {
    assert.match(view.text(), /Reading…/);
    assert.doesNotMatch(view.text(), /programs in force/);
  } finally { await view.unmount(); }
  view = await mount(React.createElement(LicenceAgreements, { licence: { uid: LIC } }), { 'licence-agreement-policies/licences/lic_fr': () => json({ error: 'boom', message: 'down' }, 500) });
  try {
    assert.ok(byTestId(view, 'licence-programs-unreadable'));
    assert.ok(byTestId(view, 'licence-package-unreadable'));
    assert.ok(byTestId(view, 'licence-legal-needs-unreadable'));
    assert.doesNotMatch(view.text(), /programs in force|No Axal VC package recorded|Nothing legal needs HQ/);
  } finally { await view.unmount(); }
  view = await mount(React.createElement(LicenceAgreements, { licence: { uid: LIC } }), { 'licence-agreements/licences/lic_fr': () => json({ error: 'boom', message: 'down' }, 500) });
  try {
    assert.ok(byTestId(view, 'licence-versions-unreadable'));
    // The legal read still answers; links fall back to the licence's list (no envelope is known).
    assert.equal(textIn(view, 'licence-readiness-summary'), 'Legal readiness1 of 3 programs in force');
    assert.equal(hrefOf(view, 'licence-program-link-spinout-lab-program_licence'), '/admin/contracts?licence=lic_fr&agreement_type=program_licence&program=spinout-lab', 'with no envelope known, the link is the licence\'s filtered list');
  } finally { await view.unmount(); }
});

test('mounted: no package recorded reads Not recorded, never "none" programs', async () => {
  const view = await mount(React.createElement(LicenceAgreements, { licence: { uid: LIC } }), { 'licence-agreement-policies/licences/lic_fr': () => json({ ...LEGAL, holdings: [] }) });
  try {
    assert.match(textIn(view, 'licence-package-none'), /No Axal VC package recorded/);
    assert.equal(byTestId(view, 'licence-package-readiness'), undefined);
    assert.ok(byTestId(view, 'licence-program-row-spinout-lab-program_licence'));
  } finally { await view.unmount(); }
});

test('mounted: Program access separates the commercial grant from legal in force', async () => {
  const view = await mount(React.createElement(ProgramLegalAccess, { uid: LIC }));
  try {
    assert.match(textIn(view, 'program-legal-grant-mentor-cohorts'), /Granted/);
    assert.match(textIn(view, 'program-legal-inforce-mentor-cohorts'), /Not in force/);
    assert.match(textIn(view, 'program-legal-inforce-mentor-cohorts'), /Waiting on program licence signed/);
    assert.equal(view.props(byTestId(view, 'program-legal-row-mentor-cohorts'))['data-waiting'], 'true');
    assert.match(textIn(view, 'program-legal-inforce-spinout-lab'), /In force/);
    assert.equal(view.props(byTestId(view, 'program-legal-row-spinout-lab'))['data-waiting'], 'false');
    assert.match(textIn(view, 'program-legal-agreement-perks'), /Not prepared/);
    assert.equal(hrefOf(view, 'program-legal-link-mentor-cohorts'), '/admin/contracts/agreements/doc/env-3');
    // The filter shows only the granted programs that are not in force.
    await act(async () => { view.props(byTestId(view, 'program-legal-filter-waiting')).onClick(); });
    assert.equal(byTestId(view, 'program-legal-row-spinout-lab'), undefined);
    assert.ok(byTestId(view, 'program-legal-row-referral-partners'));
    assert.match(textIn(view, 'program-legal-filter-waiting'), /Granted, not in force · 3/);
  } finally { await view.unmount(); }
  const failed = await mount(React.createElement(ProgramLegalAccess, { uid: LIC }), { 'licence-agreement-policies/licences/lic_fr': () => json({ error: 'boom' }, 500) });
  try {
    assert.ok(byTestId(failed, 'program-legal-unreadable'));
    assert.doesNotMatch(failed.text(), /Not in force|In force ·|Waiting on/);
  } finally { await failed.unmount(); }
});

test('mounted: a licence\'s "Open in Contracts" address lands on the Agreements list filtered to it', async () => {
  const { api, contractsApi } = await import('../src/lib/api.js');
  const { AuthProvider } = await import('../src/hooks/useAuthSync.jsx');
  const { default: Desk } = await import('../src/pages/admin/contracts/ContractsDesk.jsx');
  const originals = { ...api }, contractOriginals = { ...contractsApi };
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = () => never();
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return never(); };
  const user = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
  const view = await mountContracts(React.createElement(AuthProvider, null, React.createElement(Desk)),
    '/admin/contracts?licence=lic_fr&agreement_type=program_licence&program=referral-partners', user);
  try {
    await view.flush();
    // The list's read (the attention queues read agreements too, three at a time).
    const list = calls.find(([k, a]) => k === 'agreements' && a[0]?.limit === 25);
    assert.ok(list, 'the Agreements list is read');
    assert.equal(list[1][0].licence, 'lic_fr');
    assert.equal(list[1][0].agreement_type, 'program_licence');
    assert.equal(list[1][0].program, 'referral-partners');
  } finally { await view.unmount(); Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); }
});
