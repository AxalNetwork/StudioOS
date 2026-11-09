/**
 * D4819 (#4819), Build part 2 — a licence's Terms section (Licences v2 boards
 * L05 read, L06 amendment, L07 conflict), its model and the section mounted on
 * fake Worker reads and writes.
 *
 *   - L05: read-only by default; Not recorded, Unreadable and 0 are three things;
 *   - L06: Amend terms is a session; changed fields show before → after;
 *     Review N changes, the effects the reads can know, a required reason tied
 *     to its field; Apply sends only what changed, with the revision it read;
 *   - L07: a 409 shows start, now and yours, says who and when only when the
 *     Worker does, keeps every typed value, and Reapply moves them onto the
 *     current terms at the current revision;
 *   - no browser dialog.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_terms_amend_d4819.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import TermsWorkspace from '../src/pages/admin/licences/TermsWorkspace.jsx';
import { deepLinkTarget } from '../src/pages/admin/licences/LicenceDeepLink.jsx';
import {
  UNREADABLE, amendmentEffects, applyOutcome, conflictRows, conflictWho, coreApplied, planApply, readValue, rebaseSession,
  sectionOf, sessionChanges, startSession, termsGroups,
} from '../src/pages/admin/licenceTermsAmendModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const h = React.createElement;

const LICENCE = {
  uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', legal_entity_name: 'Axal VC France SAS', kind: 'subsidiary',
  status: 'active', territories: ['FR'], seats: { founder: 25, investor: 10, advisor: 5, partner: 0 },
  signatory_name: null, signatory_title: null,
  term_years: 3, annual_fee_cents: 9000000, currency: 'EUR', revenue_share_bps: 1200, token_split_bps: 5000,
  starts_on: '2026-03-02', renews_on: '2027-03-01', terms_revision: 4,
  deployment: { hostname: 'fr.axal.vc', status: 'active' }, deployment_available: true,
};
const STORED = { terms: { payment_terms_days: 30, governing_law: null }, sections: { payment_terms_days: '§4.6' }, revision: 3 };
const REASON = 'Annual licence review';
const row = (id) => termsGroups().flatMap((g) => g.rows).find((r) => r.id === id);
const fieldsOf = (s) => ({ ...s, core: { ...s.core, form: { ...s.core.form } } });

/** A session with the canvas's two changes: the fee 90,000 → 100,000 and payment terms 30 → 45 days. */
function twoChanges(licence = LICENCE, stored = STORED) {
  const s = fieldsOf(startSession(licence, stored, '2026-11-08T14:20:00Z'));
  s.core.form.annual_fee = '100000';
  s.schedule = { ...s.schedule, form: { ...s.schedule.form, values: { ...s.schedule.form.values, payment_terms_days: '45' } } };
  return s;
}

// ── the model ───────────────────────────────────────────────────────────────

test('L05: the schedule reads Not recorded, Unreadable and 0 as three things, with each term\'s contract section', () => {
  // Mutations checked: a null term read as 0; an unreadable schedule read as Not recorded; the default section dropped.
  const ctx = { licence: { ...LICENCE, annual_fee_cents: 0 }, stored: STORED };
  assert.equal(readValue(row('core.annual_fee'), ctx), 'EUR 0', 'a recorded fee of 0 is 0');
  assert.equal(readValue(row('core.annual_fee'), { ...ctx, licence: { ...LICENCE, annual_fee_cents: null } }), 'Not recorded');
  assert.equal(readValue(row('core.currency'), { ...ctx, licence: { ...LICENCE, currency: null } }), 'Not recorded', 'no currency is not EUR');
  assert.equal(readValue(row('core.revenue_share_bps'), ctx), '12%');
  assert.equal(readValue(row('schedule.governing_law'), ctx), 'Not recorded');
  assert.equal(readValue(row('schedule.payment_terms_days'), ctx), '30 days');
  assert.equal(readValue(row('schedule.payment_terms_days'), { ...ctx, stored: null }), UNREADABLE);
  assert.equal(readValue(row('schedule.payment_terms_days'), { ...ctx, stored: undefined }), 'Reading…');
  assert.equal(readValue(row('fixed.territories'), { licence: { ...LICENCE, territories: [] } }), 'None', 'a successful read of no countries is None');
  assert.equal(readValue(row('fixed.signatory'), ctx), 'Not recorded');
  assert.equal(readValue(row('fixed.seats.partner'), ctx), '0');
  assert.equal(sectionOf(STORED, 'payment_terms_days'), '§4.6');
  assert.equal(sectionOf({ terms: null, sections: {} }, 'governing_law'), '§22', 'no schedule row still reads the canvas default');
  assert.equal(sectionOf(STORED, 'annual_fee'), null);
  const titles = termsGroups().map((g) => g.title);
  assert.deepEqual(titles.slice(0, 4), ['Parties', 'Territory and exclusivity', 'Term and renewal', 'Fees and revenue share']);
});

test('L06: the session lists each change before → after, and Apply sends only what changed with the revision each record was read at', () => {
  // Mutations checked: every core field sent; expected_revision taken from the wrong record; the reason not required;
  // a field error keyed so it cannot reach its input.
  const s = twoChanges();
  assert.deepEqual(sessionChanges(s).map((c) => [c.id, c.before, c.after]), [
    ['core.annual_fee', 'EUR 90,000', 'EUR 100,000'],
    ['schedule.payment_terms_days', '30 days', '45 days'],
  ]);
  assert.deepEqual(planApply(s, '  ').errors, { reason: 'Say why these terms are changing. It is kept in the licence\'s history.' });
  const plan = planApply(s, REASON);
  assert.ok(plan.ok);
  assert.deepEqual(plan.core, { annual_fee_cents: 10000000, reason: REASON, expected_revision: 4 });
  assert.deepEqual(plan.schedule, { terms: { payment_terms_days: 45 }, reason: REASON, expected_revision: 3 });
  const none = startSession(LICENCE, STORED);
  assert.deepEqual(planApply(none, REASON).errors, { form: 'Nothing has changed.' });
  const bad = twoChanges(); bad.core.form.revenue_share_bps = '12x';
  assert.deepEqual(planApply(bad, '', { requireReason: false }).errors, { 'core.revenue_share_bps': 'must be a number' }, 'Review checks the fields before a reason is typed');
  const unread = startSession(LICENCE, null);
  assert.equal(unread.schedule, null, 'an unreadable schedule cannot be amended');
  unread.core.form.term_years = '5';
  assert.equal(planApply(unread, REASON).schedule, null);
});

test('L06: what else this affects says only what the reads know, and says when a fact is not known', () => {
  // Mutations checked: the replacement shown with no executed agreement; an unreadable agreement read as "none";
  // the branch line drawn from nothing.
  const effects = (o) => Object.fromEntries(amendmentEffects(o).map((e) => [e.id, [e.known, e.text]]));
  const signed = { contracts_available: true, contracts: [
    { status: 'draft', template_title: 'Draft v2', template_version: 2, superseded_at: null },
    { status: 'signed', template_title: 'Subsidiary Licence Agreement', template_version: 4, signed_at: '2026-03-02T10:00:00Z', superseded_at: null },
  ] };
  const e1 = effects({ licence: LICENCE, agreement: signed });
  assert.match(e1.ledger[1], /^The ledger’s terms change as soon as you apply/);
  assert.match(e1.branch[1], /fr\.axal\.vc is sent a new revision/);
  assert.match(e1.agreement[1], /Subsidiary Licence Agreement \(template v4\), signed 2026-03-02.*no longer match these terms/);
  assert.match(e1.replacement[1], /A replacement agreement is needed/);
  const e2 = effects({ licence: { ...LICENCE, deployment: null }, agreement: { contracts_available: true, contracts: [] } });
  assert.match(e2.branch[1], /No branch is deployed/);
  assert.match(e2.agreement[1], /No agreement has been issued/);
  assert.equal(e2.replacement, undefined, 'no replacement without an executed agreement');
  const e3 = effects({ licence: { ...LICENCE, deployment_available: false }, agreement: false });
  assert.deepEqual([e3.branch[0], e3.agreement[0]], [false, false]);
  assert.match(e3.agreement[1], /not known: the agreements could not be read/);
  assert.equal(effects({ licence: LICENCE, agreement: { contracts_available: false, contracts: [] } }).agreement[0], false);
  const sent = effects({ licence: LICENCE, agreement: { contracts: [{ status: 'sent', template_title: 'A', template_version: 1 }] } });
  assert.match(sent.agreement[1], /out for signature/);
  assert.equal(sent.replacement, undefined);
  const superseded = effects({ licence: LICENCE, agreement: { contracts: [{ status: 'signed', template_title: 'Old', template_version: 1, superseded_at: '2026-01-01' }] } });
  assert.match(superseded.agreement[1], /No agreement has been issued/, 'a superseded agreement is not the current one');
  assert.equal(effects({ licence: LICENCE, agreement: undefined }).agreement[0], false, 'still reading is not "none"');
});

test('L07: the conflict rows show start, now and yours; Reapply rebases onto the current terms; who and when only as the Worker says', () => {
  // Mutations checked: a server-only change left out of the table; Reapply keeping the stale revision; your value
  // dropped by Reapply; who/when invented.
  const s = twoChanges();
  const conflict = { core: { current: { ...LICENCE, revenue_share_bps: 1000 }, current_revision: 5, changed_by: 'M. Okafor', changed_at: '2026-11-08T14:24:00Z' } };
  assert.deepEqual(conflictRows(s, conflict).map((r) => [r.label, r.start, r.now, r.mine, r.theirs]), [
    ['Annual licence fee', 'EUR 90,000', 'EUR 90,000', 'EUR 100,000', false],
    ['Revenue share', '12%', '10%', null, true],
  ]);
  assert.equal(conflictWho(conflict.core), 'M. Okafor changed them at 8 Nov 2026, 14:24 UTC.');
  assert.match(conflictWho({ changed_by: null, changed_at: null }), /^Who changed them, and when, is not recorded yet/);
  assert.match(conflictWho({ changed_by: null, changed_at: '2026-11-08 14:24:00' }), /^They were changed at 8 Nov 2026, 14:24 UTC; who changed them is not recorded/);
  const next = rebaseSession(s, conflict);
  assert.equal(next.core.revision, 5);
  assert.deepEqual(sessionChanges(next).map((c) => [c.id, c.before, c.after]), [
    ['core.annual_fee', 'EUR 90,000', 'EUR 100,000'],
    ['schedule.payment_terms_days', '30 days', '45 days'],
  ], 'yours on top of now; the schedule, not in conflict, is unchanged');
  assert.deepEqual(planApply(next, REASON).core, { annual_fee_cents: 10000000, reason: REASON, expected_revision: 5 });
  // Your change now equals the current value: no longer a change.
  const same = rebaseSession(s, { core: { current: { ...LICENCE, annual_fee_cents: 10000000 }, current_revision: 6 } });
  assert.deepEqual(sessionChanges(same).map((c) => c.id), ['schedule.payment_terms_days']);
  // Core committed, then the schedule conflicted: only the schedule is still to apply, at its new revision.
  const after = coreApplied(s, { ...LICENCE, annual_fee_cents: 10000000, terms_revision: 5 });
  const sched = { schedule: { current: { terms: { payment_terms_days: 60 }, sections: {} }, current_revision: 4, changed_by: null, changed_at: null } };
  assert.deepEqual(conflictRows(after, sched).map((r) => [r.label, r.start, r.now, r.mine]), [['Payment terms', '30 days', '60 days', '45 days']]);
  assert.deepEqual(planApply(rebaseSession(after, sched), REASON), { ok: true, errors: {}, core: null, schedule: { terms: { payment_terms_days: 45 }, reason: REASON, expected_revision: 4 } });
});

test('L06: an apply whose branch push did not land is partial, never "done"', () => {
  // Mutations checked: a missed push reported as committed.
  assert.equal(applyOutcome([{ pushed: { ok: false, code: 'fr' } }], 2).outcome, 'partial');
  assert.match(applyOutcome([{ pushed: { ok: false, code: 'fr' } }], 2).message, /Branch fr has not received them yet/);
  assert.match(applyOutcome([{ pushed: { ok: true, code: 'fr' } }, { pushed: { ok: true, code: 'fr' } }], 2).message, /^2 changes applied and sent to branch fr\./);
  assert.equal(applyOutcome([{ pushed: { ok: false, code: null, no_deployment: true } }], 1).message, '1 change applied. Each is in the licence’s History with your reason.');
});

// ── the section, mounted ──────────────────────────────────────────────────

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});
const SIGNED = { contracts_available: true, templates: [], contracts: [
  { uid: 'c1', status: 'signed', template_title: 'Subsidiary Licence Agreement', template_version: 4, signed_at: '2026-03-02', superseded_at: null },
] };

function worker({ stored = STORED, scheduleStatus = 200, patch, put } = {}) {
  const writes = [];
  const handle = (url, options = {}) => {
    const p = new URL(url, 'http://x').pathname.replace(/^\/api/, '');
    const method = options.method || 'GET';
    if (p === '/admin/licences/lic_fr/terms' && method === 'GET') {
      return scheduleStatus === 200 ? response({ licence_uid: 'lic_fr', ...stored }) : response({ error: 'down' }, scheduleStatus);
    }
    if (p === '/admin/licences/lic_fr/contract') return response(SIGNED);
    if (p === '/admin/licences/lic_fr/terms' && (method === 'PATCH' || method === 'PUT')) {
      const body = JSON.parse(options.body);
      writes.push([method, body]);
      const answer = method === 'PATCH' ? patch : put;
      return answer ? answer(body, writes) : response({ ok: true, pushed: { ok: true, code: 'fr' } });
    }
    return response({ error: 'not_found' }, 404);
  };
  return { handle, writes };
}

async function mount(handle, licence = LICENCE) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const calls = { saved: 0, tabs: [] };
  await act(async () => rootNode.render(h(TermsWorkspace, { licence, onSaved: () => { calls.saved += 1; }, onOpenTab: (k) => calls.tabs.push(k) })));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const byDomId = (id) => nodes().find((n) => props(n).id === id);
  return {
    calls, flush, props, byId, byDomId,
    text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    inputs: () => nodes().filter((n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(domId, value) { const n = byDomId(domId); assert.ok(n, `no input ${domId}`); await act(async () => { props(n).onChange({ target: { value } }); }); await flush(); },
    async typeTest(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('L05 mounted: the terms are read-only until Amend terms; an unreadable schedule says so with Retry and the core terms still read', async () => {
  // Mutations checked: inputs drawn in read mode; the Unreadable notice dropped; the core rows hidden with the schedule.
  const w = worker();
  const v = await mount(w.handle);
  try {
    assert.match(v.text(), /Read-only · current ledger terms/);
    assert.equal(v.inputs().length, 0, 'no field is editable until Amend terms');
    assert.match(v.textOf('terms-row-core.annual_fee'), /EUR 90,000/);
    assert.match(v.textOf('terms-row-schedule.payment_terms_days'), /30 days§4\.6/);
    assert.equal(w.writes.length, 0);
  } finally { await v.close(); }
  const down = await mount(worker({ scheduleStatus: 500 }).handle);
  try {
    assert.match(down.text(), /The terms schedule could not be read\. This is not a sign that no terms are recorded\./);
    assert.match(down.textOf('terms-row-schedule.payment_terms_days'), /Unreadable/);
    assert.match(down.textOf('terms-row-core.annual_fee'), /EUR 90,000/);
  } finally { await down.close(); }
});

test('L06 mounted: Amend terms, two changes before → after, Review 2 changes, a required reason, then Apply sends both writes with their revisions', async () => {
  // Mutations checked: a Save button in place of Review N changes; Apply without a reason sending; the reason not
  // associated with its field; a write sent before Apply.
  const w = worker();
  const v = await mount(w.handle);
  try {
    await v.click('licence-terms-amend');
    assert.match(v.textOf('licence-terms-session'), /Amendment in progress · started \d\d:\d\d by you · nothing changes until you review and apply/);
    assert.equal(v.props(v.byId('licence-terms-review')).disabled, true, 'nothing to review yet');
    assert.doesNotMatch(v.text(), /Save terms/);
    await v.type('terms-input-core-annual_fee', '100000');
    await v.type('terms-input-schedule-payment_terms_days', '45');
    assert.match(v.textOf('terms-diff-core.annual_fee'), /^Changed from EUR 90,000 → +to EUR 100,000$/);
    assert.equal(v.textOf('licence-terms-review'), 'Review 2 changes');
    assert.equal(w.writes.length, 0, 'nothing is written while editing');
    await v.click('licence-terms-review');
    assert.match(v.textOf('licence-terms-diff'), /Annual licence fee: EUR 90,000.*Annual licence fee: EUR 100,000.*Payment terms: 30 days.*Payment terms: 45 days/);
    assert.match(v.textOf('licence-terms-effects'), /fr\.axal\.vc is sent a new revision/);
    assert.match(v.textOf('terms-effect-replacement'), /A replacement agreement is needed/);
    const reason = v.byDomId('terms-amend-reason');
    assert.equal(v.props(reason)['aria-required'], 'true');
    await v.click('licence-terms-apply');
    assert.equal(w.writes.length, 0, 'no reason, no write');
    assert.equal(v.props(v.byDomId('terms-amend-reason'))['aria-describedby'], 'terms-amend-reason-err');
    assert.match(v.text(), /Say why these terms are changing/);
    await v.typeTest('licence-terms-reason', REASON);
    await v.click('licence-terms-apply');
    assert.deepEqual(w.writes, [
      ['PATCH', { annual_fee_cents: 10000000, reason: REASON, expected_revision: 4 }],
      ['PUT', { terms: { payment_terms_days: 45 }, reason: REASON, expected_revision: 3 }],
    ]);
    assert.match(v.textOf('licence-terms-outcome'), /2 changes applied and sent to branch fr\./);
    assert.equal(v.props(v.byId('licence-terms-workspace'))['data-mode'], 'read');
    assert.ok(v.calls.saved >= 1, 'the page re-reads the licence');
  } finally { await v.close(); }
});

test('L07 mounted: another admin changed the record; the 409 shows start, now and yours, keeps your values, and Reapply sends the current revision', async () => {
  // Mutations checked: the conflict shown as a generic error; typed values lost on a 409; Reapply applying without review;
  // Reapply keeping the stale revision.
  let first = true;
  const w = worker({
    patch: (body) => {
      if (first) {
        first = false;
        return response({ error: 'terms_conflict', message: 'These terms changed since you opened them, so nothing was saved.',
          current_revision: 5, current: { ...LICENCE, revenue_share_bps: 1000 }, changed_by: 'M. Okafor', changed_at: '2026-11-08T14:24:00.000Z' }, 409);
      }
      return response({ ok: true, ...LICENCE, annual_fee_cents: body.annual_fee_cents, revenue_share_bps: 1000, terms_revision: 6, pushed: { ok: true, code: 'fr' } });
    },
  });
  const v = await mount(w.handle);
  try {
    await v.click('licence-terms-amend');
    await v.type('terms-input-core-annual_fee', '100000');
    await v.click('licence-terms-review');
    await v.typeTest('licence-terms-reason', REASON);
    await v.click('licence-terms-apply');
    assert.equal(w.writes.length, 1, 'the schedule write is not sent after the core write was refused');
    assert.match(v.text(), /These terms changed while you were editing\./);
    assert.equal(v.textOf('licence-terms-conflict-who'), 'M. Okafor changed them at 8 Nov 2026, 14:24 UTC. Nothing of yours was saved.');
    assert.equal(v.textOf('terms-conflict-core.revenue_share_bps'), 'Revenue share12%10% · changed since you started—No change of yours');
    assert.match(v.textOf('terms-conflict-core.annual_fee'), /EUR 90,000EUR 90,000EUR 100,000/);
    assert.equal(v.textOf('licence-terms-reapply'), 'Reapply my 1 change on the current terms');
    await v.click('licence-terms-reapply');
    assert.equal(v.props(v.byId('licence-terms-workspace'))['data-mode'], 'review', 'Reapply opens the review; nothing is sent yet');
    assert.equal(w.writes.length, 1);
    assert.equal(v.props(v.byId('licence-terms-reason')).value, REASON, 'the reason survived the conflict');
    await v.click('licence-terms-apply');
    assert.deepEqual(w.writes[1], ['PATCH', { annual_fee_cents: 10000000, reason: REASON, expected_revision: 5 }]);
    assert.match(v.textOf('licence-terms-outcome'), /1 change applied/);
  } finally { await v.close(); }
});

test('L07 mounted: the core write commits and the schedule conflicts: partly done, and only the schedule is left to reapply', async () => {
  // Mutations checked: the partial outcome said as done or as nothing saved; the applied core change offered again.
  const w = worker({
    patch: (body) => response({ ok: true, ...LICENCE, annual_fee_cents: body.annual_fee_cents, terms_revision: 5, pushed: { ok: true, code: 'fr' } }),
    put: () => response({ error: 'terms_conflict', message: 'x', current_revision: 4, current: { terms: { payment_terms_days: 60 }, sections: {} }, changed_by: null, changed_at: null }, 409),
  });
  const v = await mount(w.handle);
  try {
    await v.click('licence-terms-amend');
    await v.type('terms-input-core-annual_fee', '100000');
    await v.type('terms-input-schedule-payment_terms_days', '45');
    await v.click('licence-terms-review');
    await v.typeTest('licence-terms-reason', REASON);
    await v.click('licence-terms-apply');
    assert.equal(v.props(v.byId('licence-terms-outcome'))['data-outcome'], 'partial');
    assert.match(v.textOf('licence-terms-conflict-who'), /^Who changed them, and when, is not recorded yet\..*Your core terms were applied; your schedule changes were not saved\.$/);
    assert.equal(v.has('terms-conflict-core.annual_fee'), false, 'the applied change is not in the conflict');
    assert.match(v.textOf('terms-conflict-schedule.payment_terms_days'), /30 days60 days · changed since you started45 days/);
    assert.equal(v.textOf('licence-terms-reapply'), 'Reapply my 1 change on the current terms');
  } finally { await v.close(); }
});

test('the section is the Terms tab at /admin/licences/:uid/terms, uses no browser dialog, and offers fixed facts their own tabs', async () => {
  // Mutations checked: step 4 still drawing the old form; a window.confirm for Discard; the Discard ask dropped.
  assert.equal(deepLinkTarget('lic_fr', 'terms'), '/admin/licences?licence=lic_fr&tab=terms');
  const detail = read('frontend/src/pages/admin/licences/LicenceDetail.jsx');
  assert.match(detail, /\{step === 4 && <TermsWorkspace licence=\{d\} onSaved=\{refresh\} onOpenTab=/);
  const src = read('frontend/src/pages/admin/licences/TermsWorkspace.jsx') + read('frontend/src/pages/admin/licenceTermsAmendModel.js');
  assert.doesNotMatch(src, /window\.(confirm|prompt|alert)|\bconfirm\(|\bprompt\(/);
  const v = await mount(worker().handle);
  try {
    await v.click('licence-terms-amend');
    await v.type('terms-input-core-term_years', '5');
    await v.click('licence-terms-discard');
    assert.match(v.textOf('licence-terms-discard-ask'), /Discard 1 change\? Nothing has been saved\./, 'an in-page ask, not a browser dialog');
    await v.click('licence-terms-discard-yes');
    assert.equal(v.props(v.byId('licence-terms-workspace'))['data-mode'], 'read');
    await v.click('licence-terms-amend');
    assert.equal(v.byDomId('terms-input-fixed-territories'), undefined, 'the countries are not amended here');
    await v.click('terms-open-fixed.territories');
    assert.deepEqual(v.calls.tabs, ['territory'], 'they open their own tab');
  } finally { await v.close(); }
});
