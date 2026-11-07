/**
 * D4711 (#4711, Expertise P3) — what a person hears and where focus goes in
 * Expertise, and the write paths that used to lose what was on screen.
 *
 * The zones are the real files, mounted with only `lib/api` replaced; every
 * other import (kit, paged list, toolbar, fill bar, router) is the one the page
 * ships. Fixtures are synthetic. Each test names the defect it pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import { SaveNote, ZoneBody, Field, StaleNote } from '../src/pages/advisor/expertise/kit.jsx';
import { SERVICE_FAILED, serviceRemoveLines } from '../src/pages/advisor/expertise/expertiseModel.js';
import { completenessText } from '../src/pages/advisor/expertise/ProfileZone.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const zoneSrc = (name) => read(`frontend/src/pages/advisor/expertise/${name}`);
const API_IMPORT = "import { api } from '../../../lib/api';";

async function zone(name) {
  const page = zoneSrc(name);
  assert.ok(page.includes(API_IMPORT), `${name} imports lib/api`);
  return sourceModule(page.replace(API_IMPORT, 'const { api } = globalThis.__api4711;'), `pages/advisor/expertise/${name}`);
}
const deferred = () => { let resolve; let reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const click = async (f, id) => { const n = f.by(id); assert.ok(n, id); assert.ok(!f.props(n).disabled, `${id} is enabled`); await act(async () => f.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); };
// Fires a handler without waiting for its promise: for a write whose re-read the test holds open.
const press = async (f, id) => { const n = f.by(id); assert.ok(n, id); await act(async () => { void f.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); };
const submitNow = async (f, id) => { await act(async () => { void f.props(f.by(id)).onSubmit({ preventDefault() {} }); }); };
const type = async (f, id, value) => { const n = f.by(id); assert.ok(n, id); await act(async () => f.props(n).onChange({ target: { value } })); };
const submit = async (f, id) => { await act(async () => f.props(f.by(id)).onSubmit({ preventDefault() {} })); };
const escape = async (f, id) => { await act(async () => f.props(f.by(id)).onKeyDown({ key: 'Escape', preventDefault() {} })); };
const testidOf = (node) => node && Object.entries(node).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.['data-testid'];

// ─────────────────────────────────────────────────────────── the kit

test('a save note is a live region that exists before its sentence, and a failure interrupts', async () => {
  // The region announced only when it already exists. Mutation checked: SaveNote returning null
  // when empty → the empty mount has no status region; a failure without role="alert" → no alert.
  const f = await mountForm(h(SaveNote, { note: null, testid: 'n' }));
  try {
    const empty = f.by('n');
    assert.ok(empty, 'the region is mounted with nothing in it');
    assert.equal(f.props(empty).role, 'status');
    assert.equal(f.props(empty)['aria-live'], 'polite');
    assert.equal(f.props(empty)['aria-atomic'], 'true');
    assert.equal(textOf(empty), '');
    await f.render(h(SaveNote, { note: { ok: false, text: 'Nothing was saved.' }, testid: 'n' }));
    assert.equal(f.by('n'), empty, 'the same region receives the sentence');
    const alert = f.nodes().find((n) => f.props(n).role === 'alert');
    assert.ok(alert, 'a failure interrupts: its sentence is an alert (#4698)');
    assert.equal(textOf(alert), 'Nothing was saved.');
    assert.equal(textOf(f.by('n')), 'Nothing was saved.');
    await f.render(h(SaveNote, { note: { ok: true, text: 'Saved.' }, testid: 'n' }));
    assert.equal(f.props(f.by('n'))['aria-live'], 'polite');
    assert.ok(!f.nodes().some((n) => f.props(n).role === 'alert'), 'a save is not an alert');
  } finally { await f.unmount(); }
});

test('loading says so to a screen reader, a failed read is an alert, and a field hint describes its field', async () => {
  const f = await mountForm(h('div', null,
    h(ZoneBody, { loading: true }, 'rows'),
    h(ZoneBody, { error: 'Your services could not be read.' }, 'rows'),
    h(Field, { label: 'Price', hint: 'Blank reads as not recorded, not as free.' }, h('input', { 'data-testid': 'price' })),
    h(StaleNote, { error: 'The list may be out of date.', testid: 'stale' })));
  try {
    const nodes = f.nodes();
    const busy = nodes.find((n) => f.props(n)['aria-busy'] === 'true');
    assert.equal(f.props(busy).role, 'status');
    assert.match(textOf(busy), /Loading…/);
    const alert = nodes.find((n) => f.props(n).role === 'alert' && /This did not load/.test(textOf(n)));
    assert.ok(alert, 'the unreadable card is announced');
    const input = f.by('price');
    const hint = nodes.find((n) => n.tagName === 'SPAN' && /Blank reads as/.test(textOf(n)));
    assert.ok(f.props(input)['aria-describedby'], 'the input points at its hint');
    assert.equal(f.props(input)['aria-describedby'], f.props(hint).id);
    assert.equal(f.props(f.by('stale')).role, 'alert');
  } finally { await f.unmount(); }
});

test('the completeness meter is a progressbar with its figure and its gaps as words', async () => {
  // Mutation checked: the bar without role="progressbar" → the attribute check fails.
  const src = zoneSrc('ProfileZone.jsx');
  assert.match(src, /role="progressbar" aria-label="Profile completeness"/);
  assert.match(src, /aria-valuemin=\{0\} aria-valuemax=\{100\} aria-valuenow=\{profileCompleteness\(state\.profile\)\.pct\}/);
  assert.equal(completenessText({ complete: 6, total: 8, gaps: ['timezone', 'availability window'] }),
    '6 of 8 match fields filled; missing timezone, availability window');
  assert.equal(completenessText({ complete: 8, total: 8, gaps: [] }), '8 of 8 match fields filled; nothing missing');
});

// ─────────────────────────────────────────────────────────── Services, mounted

const svc = (id, extra = {}) => ({ id, uid: `svc-${id}`, title: `Synthetic service ${id}`, kind: 'fixed', duration_note: null, price_cents: 100000 * id, currency: 'USD', scope: null, is_active: true, units_sold: null, ...extra });

async function servicesZone(apiImpl, opts) {
  globalThis.__api4711 = { api: apiImpl };
  const mod = await zone('ServicesZone.jsx');
  const f = await mountForm(h(mod.default), opts);
  await f.flush();
  return f;
}

test('Remove asks first, keeps on "Keep it" or Escape, and removes once however often it is pressed', async () => {
  // The defect: the trash button deleted at once, and a second press sent a second delete.
  // Mutation checked: trash calling remove() directly → a delete before the question;
  // the per-row claim removed → two deletes.
  let rows = [svc(1), svc(2)];
  const calls = [];
  const gate = deferred();
  const f = await servicesZone({
    async listMyAdvisorServices() { calls.push('list'); return { items: rows, page: { offset: 0, limit: 200, total: rows.length, next_offset: null } }; },
    async deleteMyAdvisorService(id) { calls.push(`delete ${id}`); await gate.p; rows = rows.filter((r) => r.id !== id); return { ok: true, id }; },
  }, { modal: true });
  try {
    await click(f, 'advisor-service-remove-1');
    assert.ok(f.by('advisor-service-confirm-1'), 'the question is on the row');
    assert.equal(calls.filter((c) => c.startsWith('delete')).length, 0, 'asking deletes nothing');
    assert.equal(testidOf(f.doc.activeElement), 'advisor-service-keep-1', 'focus starts on the safe answer');
    assert.match(textOf(f.by('advisor-service-confirm-1')), /nothing else changes/);
    await escape(f, 'advisor-service-confirm-1');
    assert.ok(!f.by('advisor-service-confirm-1'), 'Escape keeps it');
    assert.equal(testidOf(f.doc.activeElement), 'advisor-service-remove-1', 'focus returns to the trash button');

    await click(f, 'advisor-service-remove-1');
    const confirm = f.by('advisor-service-remove-confirm-1');
    await act(async () => { f.props(confirm).onClick(); f.props(confirm).onClick(); });
    gate.resolve();
    await f.flush();
    assert.deepEqual(calls.filter((c) => c.startsWith('delete')), ['delete 1'], 'one delete for two presses');
    assert.equal(textOf(f.by('advisor-services-note')), 'Removed “Synthetic service 1”.');
    assert.ok(!f.by('advisor-service-edit-1'), 'the row is gone');
    assert.ok(f.by('advisor-service-edit-2'), 'the other row stays');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

test('a remove that finds the service gone says so; a failed one says nothing was removed, in a fixed sentence', async () => {
  // Mutation checked: the 404 branch removed → "Nothing was removed" for a row that is gone;
  // refusalText swapped for err.message → the raw driver text reaches the page.
  let rows = [svc(1), svc(2)];
  const f = await servicesZone({
    async listMyAdvisorServices() { return { items: rows, page: { offset: 0, limit: 200, total: rows.length, next_offset: null } }; },
    async deleteMyAdvisorService(id) {
      if (id === 1) { rows = rows.filter((r) => r.id !== 1); throw Object.assign(new Error('Service not found'), { status: 404 }); }
      throw Object.assign(new Error('D1_ERROR: SQLITE_BUSY synthetic'), { status: 500 });
    },
  });
  try {
    await click(f, 'advisor-service-remove-1');
    await click(f, 'advisor-service-remove-confirm-1');
    await f.flush();
    assert.equal(textOf(f.by('advisor-services-note')), '“Synthetic service 1” was already removed.');
    assert.ok(!f.by('advisor-service-edit-1'));
    await click(f, 'advisor-service-remove-2');
    await click(f, 'advisor-service-remove-confirm-2');
    await f.flush();
    assert.equal(textOf(f.by('advisor-services-note')), SERVICE_FAILED.remove);
    assert.doesNotMatch(f.text(), /D1_ERROR|SQLITE/, 'no raw error text');
    assert.ok(f.by('advisor-service-edit-2'), 'the row is still drawn');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

test('editing moves focus to Title, Escape closes it and hands focus back to Edit', async () => {
  // Mutation checked: the focus effect removed → focus stays on Edit when the form opens.
  const f = await servicesZone({
    async listMyAdvisorServices() { return { items: [svc(3)], page: { offset: 0, limit: 200, total: 1, next_offset: null } }; },
  }, { modal: true });
  try {
    await click(f, 'advisor-service-edit-3');
    assert.equal(f.props(f.by('advisor-service-edit-3'))['aria-expanded'], true);
    assert.equal(testidOf(f.doc.activeElement), 'advisor-service-edit-title', 'the cursor is in Title');
    await escape(f, 'advisor-service-form-3');
    assert.ok(!f.by('advisor-service-form-3'));
    assert.equal(testidOf(f.doc.activeElement), 'advisor-service-edit-3', 'focus is back on Edit');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

test('a blank price is sent as not recorded and a malformed one is refused before any write', async () => {
  // Mutation checked: dollarsToCents('') → 0 → the body carries price_cents 0, a free service.
  const calls = [];
  const f = await servicesZone({
    async listMyAdvisorServices() { return { items: [], page: { offset: 0, limit: 200, total: 0, next_offset: null } }; },
    async createMyAdvisorService(body) { calls.push(body); return { id: 9 }; },
  });
  try {
    await type(f, 'advisor-service-title', 'Synthetic review');
    await type(f, 'advisor-service-price', '12.345');
    await submit(f, 'advisor-service-add');
    assert.equal(calls.length, 0, 'a malformed amount writes nothing');
    assert.match(textOf(f.by('advisor-services-note')), /Enter an amount like/);
    await type(f, 'advisor-service-price', '');
    await submit(f, 'advisor-service-add');
    await f.flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].price_cents, null, 'blank is not recorded, never 0');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

test('a write keeps every row read so far, and a failed re-read keeps them and says the list may be stale', async () => {
  // The defect: a write called load(), which drew the skeleton and re-read only the first page,
  // so a row reached through "Show more" vanished after an unrelated edit.
  // Mutation checked: refresh() reading one page only → service 3 is gone after the toggle;
  // the refresh catch clearing rows → nothing is left on screen.
  const all = [svc(1), svc(2), svc(3)];
  let failReads = false;
  const f = await servicesZone({
    async listMyAdvisorServices({ offset = 0 } = {}) {
      if (failReads) throw new Error('synthetic read failure');
      const items = all.slice(offset, offset + 2);
      const next = offset + 2 < all.length ? offset + 2 : null;
      return { items, page: { offset, limit: 2, total: all.length, next_offset: next } };
    },
    async updateMyAdvisorService(id, body) { const i = all.findIndex((r) => r.id === id); all[i] = { ...all[i], ...body }; return {}; },
  });
  try {
    const moreButton = f.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n) === 'Show more');
    await act(async () => f.props(moreButton).onClick());
    await f.flush();
    assert.ok(f.by('advisor-service-edit-3'), 'the third service is on screen');
    await click(f, 'advisor-service-state-1');
    await f.flush();
    assert.ok(f.by('advisor-service-edit-3'), 'still there after the write');
    assert.match(textOf(f.by('advisor-services-note')), /is now inactive/);
    failReads = true;
    await click(f, 'advisor-service-state-2');
    await f.flush();
    assert.ok(f.by('advisor-service-edit-1') && f.by('advisor-service-edit-3'), 'the rows stay when the re-read fails');
    assert.match(textOf(f.by('advisor-services-stale')), /may be out of date/);
    failReads = false;
    const again = f.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n) === 'Read it again');
    await act(async () => f.props(again).onClick());
    await f.flush();
    assert.ok(!f.by('advisor-services-stale'), 'recovered');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

test('the newest re-read wins: an older answer that lands last does not redraw the list as it was', async () => {
  // Mutation checked: the seq guard removed from refresh() → the stale answer redraws the old title.
  let version = 0;
  const answers = [];
  const f = await servicesZone({
    async listMyAdvisorServices() {
      if (version === 0) return { items: [svc(1, { title: 'Old title' })], page: { offset: 0, limit: 200, total: 1, next_offset: null } };
      const d = deferred(); answers.push(d); return d.p;
    },
    async updateMyAdvisorService() { version += 1; return {}; },
  });
  try {
    await press(f, 'advisor-service-state-1');
    await f.flush();
    await click(f, 'advisor-service-edit-1');
    await type(f, 'advisor-service-edit-title', 'New title');
    await submitNow(f, 'advisor-service-form-1');
    await f.flush();
    assert.equal(answers.length, 2, 'two re-reads in flight');
    await act(async () => { answers[1].resolve({ items: [svc(1, { title: 'New title' })], page: { offset: 0, limit: 200, total: 1, next_offset: null } }); });
    await f.flush();
    await act(async () => { answers[0].resolve({ items: [svc(1, { title: 'Old title' })], page: { offset: 0, limit: 200, total: 1, next_offset: null } }); });
    await f.flush();
    assert.ok(f.text().includes('New title'));
    assert.ok(!f.text().includes('Old title'), 'the older answer is dropped');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

// ─────────────────────────────────────────────────────────── Proof, mounted

const proof = (id, consents = []) => ({ id, uid: `p-${id}`, kind: 'engagement', title: `Synthetic claim ${id}`, detail: null, organization: null, period_note: null, is_public: false, attested: false, status: 'self_stated', consents });

test('asking for consent keeps the form and its answer on screen while the claim refreshes with the pending ask', async () => {
  // The defect: onDone called load(), which drew the skeleton, unmounted the form and its
  // "Request recorded" line, and lost focus. Mutation checked: onDone={load} restored →
  // the note is gone after the ask.
  let consents = [];
  const calls = [];
  const reread = deferred();
  const answer = () => ({ items: [proof(5, consents)], page: { offset: 0, limit: 200, total: 1, next_offset: null } });
  globalThis.__api4711 = { api: {
    // The first read answers at once; the re-read after the ask is held open, as a network is.
    async listMyAdvisorProof() { calls.push('list'); if (calls.filter((c) => c === 'list').length === 1) return answer(); await reread.p; return answer(); },
    async getMyAdvisor() { return { uid: 'adv-synthetic' }; },
    async requestAdvisorProofConsent(id, body) {
      calls.push(`ask ${id}`);
      consents = [{ id: 1, attester_name: body.attester_name, consent_given: false, state: 'pending', withdrawn_at: null }];
      return { ok: true, invite_token: 'synthetic-token' };
    },
  } };
  const mod = await zone('ProofZone.jsx');
  const f = await mountForm(h(mod.default), { modal: true });
  try {
    await f.flush();
    await click(f, 'advisor-proof-ask-toggle-5');
    assert.equal(testidOf(f.doc.activeElement), 'advisor-proof-ask-name-5', 'the form opens on its first field');
    await type(f, 'advisor-proof-ask-name-5', 'Sam Example');
    const email = f.nodes().find((n) => n.tagName === 'INPUT' && f.props(n).type === 'email');
    await act(async () => f.props(email).onChange({ target: { value: 'sam@example.test' } }));
    await submitNow(f, 'advisor-proof-ask-5');
    await f.flush();
    assert.deepEqual(calls, ['list', 'ask 5', 'list'], 'the ask, then one re-read');
    // While the re-read is in flight: the claim, the form and its answer are all still drawn.
    assert.ok(f.by('advisor-proof-ask-5'), 'the form is still open while the list re-reads');
    assert.match(textOf(f.by('advisor-proof-ask-note-5')), /Request recorded/);
    await act(async () => { reread.resolve(); });
    await f.flush();
    assert.ok(f.by('advisor-proof-ask-5'), 'and after');
    assert.match(textOf(f.by('advisor-proof-ask-note-5')), /Request recorded/);
    assert.match(f.text(), /Sam Example/, 'the pending ask is drawn on the claim');
    await escape(f, 'advisor-proof-ask-5');
    assert.ok(!f.by('advisor-proof-ask-5'));
    assert.equal(testidOf(f.doc.activeElement), 'advisor-proof-ask-toggle-5', 'focus is back on the toggle');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

test('the delete question takes focus on "Keep it" and Escape hands it back', async () => {
  globalThis.__api4711 = { api: {
    async listMyAdvisorProof() { return { items: [proof(6)], page: { offset: 0, limit: 200, total: 1, next_offset: null } }; },
    async getMyAdvisor() { return { uid: 'adv-synthetic' }; },
  } };
  const mod = await zone('ProofZone.jsx');
  const f = await mountForm(h(mod.default), { modal: true });
  try {
    await f.flush();
    await click(f, 'advisor-proof-delete-6');
    const dialog = f.by('advisor-proof-confirm-6');
    assert.equal(f.props(dialog).role, 'alertdialog');
    assert.equal(f.props(dialog)['aria-describedby'], 'advisor-proof-confirm-lines-6');
    assert.equal(testidOf(f.doc.activeElement), 'advisor-proof-keep-6');
    await escape(f, 'advisor-proof-confirm-6');
    assert.ok(!f.by('advisor-proof-confirm-6'));
    assert.equal(testidOf(f.doc.activeElement), 'advisor-proof-delete-6');
  } finally { await f.unmount(); delete globalThis.__api4711; }
});

// ─────────────────────────────────────────────────────────── copy and navigation

test('the Expertise rail says what Ask drafts on Services, and that no price is drafted', () => {
  // The rail said nothing on the bucket is drafted, beside a form that offers Ask (D1329).
  const routes = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');
  const at = routes.indexOf("'/expertise': {");
  const block = routes.slice(at, routes.indexOf('},\n  }[prefix]', at));
  assert.match(block, /Ask can draft its title and what it covers, only when you ask/);
  assert.match(block, /No positioning line, price, claim or attestation is drafted/);
  assert.doesNotMatch(block, /every word on your storefront is one you typed/);
  assert.doesNotMatch(block, /\bFill\b/, '#4473: copy says Ask, never Fill');
  assert.match(read('frontend/src/lib/fillScoped.js'), /service: Object\.freeze\(\['Price · Eadwyn never fills what you charge\.'\]\)/,
    'the rail and the form agree: the price is never drafted');
  for (const line of serviceRemoveLines(svc(1))) assert.ok(line.length > 10);
});

test('the Expertise routes admit the Advisor licence, and no Expertise file carries a licence switcher', () => {
  // #4473 (S18) makes the guard accept a held licence; these routes must name `advisor` for that
  // to reach an additional Advisor licence. No zone may grow its own switcher meanwhile.
  const app = read('frontend/src/App.jsx');
  for (const slug of ['profile', 'services', 'proof', 'thinking', 'visibility']) {
    assert.match(app, new RegExp(`<Route path="/expertise/${slug}" element=\\{guard\\(\\['admin', 'advisor'\\]`), `/expertise/${slug} admits advisor`);
  }
  for (const f of ['ProfileZone.jsx', 'ServicesZone.jsx', 'ProofZone.jsx', 'ThinkingZone.jsx', 'VisibilityZone.jsx', 'kit.jsx']) {
    assert.doesNotMatch(zoneSrc(f), /LicenceSwitcher|ProfileSwitcher|activeLicence|active_profile/, `${f} has no switcher`);
  }
  assert.match(zoneSrc('kit.jsx'), /advisor_licence_required: 'Expertise needs the Advisor licence on this account\.'/);
});
