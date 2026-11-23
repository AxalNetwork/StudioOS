/**
 * #4844 (D4844) — Offers audit 4/5: one interaction system across Catalog,
 * Proof, Audience fit and Product testing, MOUNTED.
 *
 * What is proved:
 *   1. The Catalog and Proof editors are the shared `Sheet`: a dialog, modal,
 *      named by its visible title; focus moves to the first field, Tab and
 *      Shift+Tab stay inside, Escape and the × close, everything outside is
 *      inert, and focus returns to the control that opened it. A Catalog sheet
 *      holding unsaved entries asks before Escape throws them away.
 *   2. Fields: every control sits in a visible `<label>`; a field's own error
 *      is tied to it (`aria-describedby`, `aria-invalid`) and leads with a
 *      cross; a refusal naming a field lands on that field.
 *   3. A failed save keeps every entry, says so with the fixed sentence (never
 *      the response's text), and Try again sends the same write.
 *   4. Empty states name the commercial outcome and offer exactly one action;
 *      each zone draws one filled primary; status chips carry an icon and a
 *      word; the loading and failed-read wording is #5129's.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/offers_interaction_4844.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { stubApi, httpError } from './_offers_4688.mjs';
import { MineTab, offeringErrors } from '../src/pages/ServiceCatalogPage.jsx';
import ProofZone, { proofErrors } from '../src/pages/partner/offers/ProofZone.jsx';
import AudienceFitZone from '../src/pages/partner/offers/AudienceFitZone.jsx';
import TestingZone from '../src/pages/partner/offers/TestingZone.jsx';
import { OFFER_STATUS } from '../src/pages/partner/kit.jsx';
import { writeFailureField } from '../src/pages/partner/offers/useGuardedWrite.jsx';

const h = React.createElement;

// ── A stub DOM with attributes, focus and the selectors `Sheet` asks for ──────

function matches(n, selector) {
  return selector.split(',').some((part) => {
    const sel = part.trim();
    const tag = /^[a-z]+/i.exec(sel)?.[0];
    if (tag && n.tagName !== tag.toUpperCase()) return false;
    const nots = [...sel.matchAll(/:not\(\[([\w-]+)(?:="([^"]*)")?\]\)/g)];
    const rest = sel.replace(/:not\([^)]*\)/g, '');
    const has = [...rest.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    const attr = (name) => n.attrs?.get(name);
    for (const [, name, value] of has) {
      if (!n.attrs?.has(name) || (value !== undefined && attr(name) !== value)) return false;
    }
    for (const [, name, value] of nots) {
      if (n.attrs?.has(name) && (value === undefined || attr(name) === value)) return false;
    }
    return Boolean(tag || has.length);
  });
}

async function mount(element) {
  const restoreDoc = installDocument();
  const keydown = [];
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.attrs = new Map();
    n.setAttribute = function setAttribute(k, v) { this.attrs.set(k, String(v)); };
    n.getAttribute = function getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; };
    n.hasAttribute = function hasAttribute(k) { return this.attrs.has(k); };
    n.removeAttribute = function removeAttribute(k) { this.attrs.delete(k); };
    n.querySelectorAll = function querySelectorAll(sel) { return walk(this).slice(1).filter((c) => c.nodeType === 1 && matches(c, sel)); };
    n.querySelector = function querySelector(sel) { return this.querySelectorAll(sel)[0] || null; };
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(o) { for (let p = o; p; p = p.parentNode) if (p === this) return true; return false; };
    Object.defineProperty(n, 'children', { get() { return this.childNodes.filter((c) => c.nodeType === 1); } });
    Object.defineProperty(n, 'isConnected', { get() { let p = this; while (p.parentNode) p = p.parentNode; return p === document.body; } });
    return n;
  };
  document.body = document.createElement('body');
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);
  document.addEventListener = (type, fn) => { if (type === 'keydown') keydown.push(fn); };
  document.removeEventListener = (type, fn) => { const i = keydown.indexOf(fn); if (i >= 0) keydown.splice(i, 1); };
  const page = document.createElement('div');
  document.body.appendChild(page);
  const container = document.createElement('div');
  page.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/offers'] }, element)); });
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const nodes = () => walk(container);
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const button = (label) => nodes().find((n) => n.tagName === 'BUTTON' && text(n).trim() === label);
  const labelled = (label) => {
    const l = nodes().find((n) => n.tagName === 'LABEL' && text(n).trim().startsWith(label));
    return l?.childNodes.find((n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName));
  };
  const v = {
    page, nodes, props, byTestId, button, labelled,
    text: () => text(container),
    textOf: text,
    // Settles the stubbed API's promises and React's updates; no timer, no clock.
    async flush() { for (let i = 0; i < 2; i += 1) await act(async () => { for (let j = 0; j < 10; j += 1) await Promise.resolve(); }); },
    async press(label) {
      const b = button(label);
      if (!b) throw new Error(`Missing button: ${label}`);
      b.focus();
      await act(async () => { props(b).onClick?.({ stopPropagation() {}, preventDefault() {} }); });
    },
    async fill(label, value) {
      const c = labelled(label);
      if (!c) throw new Error(`Missing field: ${label}`);
      await act(async () => { props(c).onChange({ target: { value } }); });
    },
    value: (label) => props(labelled(label)).value,
    async key(key, extra = {}) {
      let prevented = false;
      await act(async () => { for (const fn of [...keydown]) fn({ key, defaultPrevented: false, preventDefault() { prevented = true; }, ...extra }); });
      return prevented;
    },
    async tab(dialog, shiftKey = false) {
      await act(async () => { props(dialog).onKeyDown({ key: 'Tab', shiftKey, preventDefault() {} }); });
    },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
  await v.flush();
  return v;
}

const idsOf = (v, n) => String(v.props(n)['aria-describedby'] || '').split(' ').filter(Boolean);
const nodeWithId = (v, id) => v.nodes().find((n) => v.props(n).id === id);
const tabbables = (v, dialog) => dialog.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');

/** The dialog contract every moved editor keeps (D1317, D685). */
async function assertDialog(v, testId, { title, firstField }) {
  const dialog = v.byTestId(testId);
  assert.ok(dialog, `${testId} is open`);
  const p = v.props(dialog);
  assert.equal(p.role, 'dialog');
  assert.equal(p['aria-modal'], 'true');
  const heading = nodeWithId(v, p['aria-labelledby']);
  assert.ok(heading?.tagName === 'H2', 'named by its own heading');
  assert.equal(v.textOf(heading).trim(), title, 'the accessible name is the visible title');
  assert.ok(document.activeElement === v.labelled(firstField), `focus moved to ${firstField}`);
  assert.equal(v.page.getAttribute('inert') === '' || v.nodes().some((n) => n !== dialog && n.hasAttribute?.('inert')), true, 'the page behind is inert');
  // Tab from the last control wraps to the first, Shift+Tab from the first to the last.
  const list = tabbables(v, dialog);
  list[list.length - 1].focus();
  await v.tab(dialog);
  assert.ok(document.activeElement === list[0], 'Tab stays inside the sheet');
  list[0].focus();
  await v.tab(dialog, true);
  assert.ok(document.activeElement === list[list.length - 1], 'Shift+Tab stays inside the sheet');
  return dialog;
}

// ── Catalog ───────────────────────────────────────────────────────────────────

function catalogStore(rows = []) {
  const s = { rows, creates: [], fails: [] };
  s.restore = stubApi({
    listServiceOfferings: async () => ({ items: s.rows.map((o) => ({ ...o })), page: 1, page_size: 50, total: s.rows.length }),
    createServiceOffering: async (body) => {
      s.creates.push(JSON.parse(JSON.stringify(body)));
      const f = s.fails.shift();
      if (f) throw f;
      const row = { id: s.rows.length + 1, ...body, price_cents: body.price_usd == null ? null : Math.round(body.price_usd * 100), is_active: 1 };
      s.rows.push(row);
      return row;
    },
  });
  return s;
}

test('Catalog: the empty state names the outcome, with one action that opens the service sheet', async () => {
  const s = catalogStore();
  const v = await mount(h(MineTab, { user: { role: 'partner' } }));
  try {
    assert.match(v.textOf(v.byTestId('catalog-empty')), /Show founders what your firm sells/);
    const actions = v.byTestId('catalog-empty').querySelectorAll('button');
    assert.deepEqual(actions.map((b) => v.textOf(b).trim()), ['Add your first service'], 'one direct action');
    assert.ok(!/No services yet/.test(v.text()), 'the storage sentence is gone');
    await v.press('Add your first service');
    const opener = v.button('Add your first service');
    await assertDialog(v, 'offering-sheet', { title: 'New service', firstField: 'Service name' });
    // Every control has a visible label.
    for (const label of ['Service name', 'Category', 'Price (USD)', 'How is it sold?']) assert.ok(v.labelled(label), `${label} is labelled`);
    const summary = v.nodes().find((n) => n.tagName === 'TEXTAREA');
    assert.equal(v.textOf(v.nodes().find((n) => n.tagName === 'LABEL' && v.props(n).htmlFor === v.props(summary).id)).trim(), 'What do you deliver?');
    // A clean sheet closes on Escape and gives focus back to its opener.
    assert.equal(await v.key('Escape'), true);
    assert.equal(v.byTestId('offering-sheet'), undefined, 'Escape closed it');
    assert.ok(document.activeElement === opener, 'focus returned to the opener');
  } finally { await v.unmount(); s.restore(); }
});

test('Catalog: field errors are tied to their field, and nothing is sent until they are fixed', async () => {
  const s = catalogStore();
  const v = await mount(h(MineTab, { user: { role: 'partner' } }));
  try {
    await v.press('Add your first service');
    await v.fill('Price (USD)', 'forty');
    await v.press('Add service');
    assert.equal(s.creates.length, 0, 'an invalid form sends nothing');
    for (const [label, sentence] of [['Service name', 'Give the service a name.'], ['Price (USD)', 'Enter the price in dollars']]) {
      const c = v.labelled(label);
      assert.equal(v.props(c)['aria-invalid'], 'true', `${label} is marked invalid`);
      const err = idsOf(v, c).map((id) => nodeWithId(v, id)).find((n) => v.props(n)['data-field-error'] !== undefined);
      assert.ok(err, `${label}'s error is in its aria-describedby`);
      assert.match(v.textOf(err), new RegExp(`^✕${sentence}`), `${label}'s error leads with a cross, not colour alone`);
    }
    assert.equal(v.value('Price (USD)'), 'forty', 'the entry is kept');
    await v.fill('Service name', 'Go-to-market sprint');
    assert.equal(v.props(v.labelled('Service name'))['aria-invalid'], undefined, 'typing clears that field’s error');
    // A refusal that names a field lands on that field.
    await v.fill('Price (USD)', '48000');
    s.fails.push(Object.assign(httpError(422, 'Use a shorter name.'), { field: 'title' }));
    await v.press('Add service');
    await v.flush();
    const title = v.labelled('Service name');
    assert.equal(v.props(title)['aria-invalid'], 'true');
    assert.ok(idsOf(v, title).some((id) => /Use a shorter name\./.test(v.textOf(nodeWithId(v, id)))), 'the Worker’s field sentence is on its field');
  } finally { await v.unmount(); s.restore(); }
});

test('Catalog: a failed save keeps every entry, says so in fixed words, and Try again sends the same write', async () => {
  const s = catalogStore();
  const v = await mount(h(MineTab, { user: { role: 'partner' } }));
  try {
    await v.press('Add your first service');
    await v.fill('Service name', 'Go-to-market sprint');
    await v.fill('Price (USD)', '48000');
    await v.fill('How is it sold?', 'fixed');
    s.fails.push(httpError(500, 'SQLITE private detail'));
    await v.press('Add service');
    await v.flush();
    assert.ok(v.byTestId('offering-sheet'), 'the sheet stays open');
    assert.deepEqual(['Service name', 'Price (USD)', 'How is it sold?'].map(v.value), ['Go-to-market sprint', '48000', 'fixed'], 'every entry is kept');
    const failure = v.byTestId('offering-failure');
    assert.equal(v.props(failure).role, 'alert');
    assert.match(v.textOf(failure), /Couldn’t save\. Everything you typed is still here\. Axal could not save this right now\. Try again\./);
    assert.ok(!v.text().includes('SQLITE'), 'the response text stays out of the page');
    await v.press('Try again');
    await v.flush();
    assert.equal(s.creates.length, 2);
    assert.deepEqual(s.creates[1], s.creates[0], 'the same write, without retyping');
    assert.equal(v.byTestId('offering-sheet'), undefined, 'the success closes the sheet');
    assert.match(v.textOf(v.byTestId('catalog-saved')), /✓Go-to-market sprint is saved\./, 'saved is said, with a tick');
    assert.equal(v.props(v.byTestId('catalog-saved')).role, 'status');
    assert.equal(s.creates[0].price_usd, 48000);
  } finally { await v.unmount(); s.restore(); }
});

test('Catalog: a sheet with unsaved entries asks before Escape discards them', async () => {
  const s = catalogStore();
  const asked = [];
  const confirm = globalThis.confirm;
  const v = await mount(h(MineTab, { user: { role: 'partner' } }));
  try {
    await v.press('Add your first service');
    await v.fill('Service name', 'Draft name');
    window.confirm = (q) => { asked.push(q); return false; };
    await v.key('Escape');
    assert.equal(asked.length, 1, 'it asked');
    assert.ok(v.byTestId('offering-sheet'), 'declining keeps the sheet');
    assert.equal(v.value('Service name'), 'Draft name', 'and the entry');
    window.confirm = (q) => { asked.push(q); return true; };
    await v.key('Escape');
    assert.equal(v.byTestId('offering-sheet'), undefined, 'confirming closes it');
  } finally { globalThis.confirm = confirm; await v.unmount(); s.restore(); }
});

test('Catalog: an edit sheet keeps Delete away from Save, and the status chip is an icon and a word', async () => {
  const rows = [
    { id: 1, title: 'Go-to-market sprint', category: 'gtm', engagement_model: 'fixed', price_cents: 4800000, is_active: 1, summary: 'x' },
    { id: 2, title: 'Data room', category: 'legal', engagement_model: null, price_cents: null, is_active: 1, summary: '' },
    { id: 3, title: 'Pitch day', category: 'design', engagement_model: 'seat', price_cents: 1000, is_active: 0, summary: '' },
  ];
  const s = catalogStore(rows);
  const v = await mount(h(MineTab, { user: { role: 'partner' } }));
  try {
    for (const [id, word] of [[1, 'Live'], [2, 'Draft'], [3, 'Unlisted']]) {
      const chip = v.byTestId(`catalog-state-${id}`);
      const icon = chip.childNodes.find((n) => v.props(n)['data-status-icon'] !== undefined);
      assert.equal(v.textOf(icon), OFFER_STATUS[word].icon, `${word} carries its icon`);
      assert.equal(v.props(icon)['aria-hidden'], 'true');
      assert.match(v.textOf(chip), new RegExp(`${word}$`), `${word} carries its word`);
    }
    assert.notEqual(OFFER_STATUS.Live.icon, OFFER_STATUS.Draft.icon);
    assert.notEqual(OFFER_STATUS.Draft.icon, OFFER_STATUS.Unlisted.icon);
    v.byTestId('catalog-edit-1').focus();
    await act(async () => { v.props(v.byTestId('catalog-edit-1')).onClick(); });
    await assertDialog(v, 'offering-sheet', { title: 'Go-to-market sprint', firstField: 'Service name' });
    const footer = v.byTestId('offering-sheet-footer');
    const order = footer.querySelectorAll('button').map((b) => v.textOf(b).trim());
    assert.deepEqual(order, ['Delete service…', 'Cancel', 'Save service'], 'Delete leads, Save ends: they are apart');
    assert.match(v.props(v.button('Delete service…')).className, /text-red-700/);
    assert.doesNotMatch(v.props(v.button('Delete service…')).className, /bg-amber-700/, 'Delete is not a primary');
  } finally { await v.unmount(); s.restore(); }
});

test('Catalog: a failed read is #5129’s Unavailable state, never the empty state', async () => {
  const restore = stubApi({ listServiceOfferings: async () => { throw httpError(503, 'down'); } });
  const v = await mount(h(MineTab, { user: { role: 'partner' } }));
  try {
    const err = v.byTestId('catalog-error');
    assert.equal(v.props(err)['data-platform-state'], 'unavailable');
    assert.match(v.textOf(err), /Unavailable.*Your catalog could not be read\./s);
    assert.equal(v.byTestId('catalog-empty'), undefined, 'an unreadable catalog is not empty');
  } finally { await v.unmount(); restore(); }
});

// ── Proof ─────────────────────────────────────────────────────────────────────

const proofRow = (o = {}) => ({ id: 1, title: 'Seed round', kind: 'case_study', detail: '', outcome_note: null, is_published: 0, consents: [], ...o });

function proofStore(rows = []) {
  const s = { rows, creates: [], updates: [], fails: [] };
  s.restore = stubApi({
    listPartnerProof: async () => ({ items: s.rows.map((r) => ({ ...r })), published_count: 0, page: 1 }),
    createPartnerProof: async (p) => { s.creates.push({ ...p }); const f = s.fails.shift(); if (f) throw f; s.rows.push(proofRow({ id: s.rows.length + 1, ...p })); return {}; },
    updatePartnerProof: async (id, p) => { s.updates.push([id, { ...p }]); const f = s.fails.shift(); if (f) throw f; return {}; },
  });
  return s;
}

test('Proof: the add editor is the shared Sheet, with labelled fields and its own error', async () => {
  const s = proofStore();
  const v = await mount(h(ProofZone));
  try {
    const empty = v.byTestId('proof-empty');
    assert.match(v.textOf(empty), /Show founders why they should hire you/);
    assert.deepEqual(empty.querySelectorAll('button').map((b) => v.textOf(b).trim()), ['Add your first proof']);
    await v.press('Add your first proof');
    const opener = v.button('Add your first proof');
    await assertDialog(v, 'proof-editor', { title: 'Add proof', firstField: 'Title' });
    for (const label of ['Title', 'Kind', 'What the work was', 'Result claimed']) assert.ok(v.labelled(label), `${label} is labelled`);
    await v.press('Save proof');
    assert.equal(s.creates.length, 0, 'an untitled result is not sent');
    const title = v.labelled('Title');
    assert.equal(v.props(title)['aria-invalid'], 'true');
    assert.ok(idsOf(v, title).some((id) => v.textOf(nodeWithId(v, id)) === '✕Give the result a title.'), 'the error is tied to Title');
    // A refusal naming a field puts the fixed-length Worker sentence on it, and keeps the entries.
    await v.fill('Title', 'Seed round for a fintech');
    await v.fill('Result claimed', 'Closed in nine weeks');
    s.fails.push(Object.assign(httpError(422, 'Keep the result under 1000 characters.'), { field: 'outcome_note' }));
    await v.press('Save proof');
    await v.flush();
    const outcome = v.labelled('Result claimed');
    assert.equal(v.props(outcome)['aria-invalid'], 'true');
    assert.ok(idsOf(v, outcome).some((id) => /under 1000 characters/.test(v.textOf(nodeWithId(v, id)))), 'the sentence is on Result claimed');
    assert.equal(v.value('Title'), 'Seed round for a fintech');
    assert.equal(v.value('Result claimed'), 'Closed in nine weeks');
    // Escape closes it and focus goes home; the entries survive closing (they are the zone's).
    await v.key('Escape');
    assert.equal(v.byTestId('proof-editor'), undefined);
    assert.ok(document.activeElement === opener, 'focus returned to the opener');
    await v.press('Add your first proof');
    assert.equal(v.value('Title'), 'Seed round for a fintech', 'closing threw nothing away');
  } finally { await v.unmount(); s.restore(); }
});

test('Proof: a card’s Edit opens a Sheet with Delete apart from Save, and a failed save keeps the edit', async () => {
  const s = proofStore([proofRow()]);
  const v = await mount(h(ProofZone));
  try {
    await v.press('View proof');
    await v.press('Edit');
    const dialog = await assertDialog(v, 'proof-edit-1', { title: 'Edit “Seed round”', firstField: 'Title' });
    assert.deepEqual(v.byTestId('proof-edit-1-footer').querySelectorAll('button').map((b) => v.textOf(b).trim()), ['Delete', 'Cancel', 'Save']);
    await v.fill('Title', 'Seed round, revised');
    s.fails.push(httpError(500, 'raw server text'));
    await v.press('Save');
    await v.flush();
    assert.ok(v.byTestId('proof-edit-1'), 'the sheet stays open');
    assert.equal(v.value('Title'), 'Seed round, revised', 'the edit is kept');
    const note = dialog.querySelectorAll('p').find((n) => v.props(n)['data-save-status'] === 'not-saved');
    assert.ok(note, 'the failure is said inside the sheet');
    assert.equal(v.props(note).role, 'alert');
    assert.match(v.textOf(note), /^✕Axal could not save this right now\. Try again\.$/, 'a cross, then the fixed sentence');
    assert.ok(!v.text().includes('raw server text'));
    await v.press('Retry');
    await v.flush();
    assert.deepEqual(s.updates[1], s.updates[0], 'Retry sends the same write');
    assert.equal(v.byTestId('proof-edit-1'), undefined, 'the success closes it');
  } finally { await v.unmount(); s.restore(); }
});

test('Proof: Ask for consent opens the shared Sheet; the zone’s one primary is + Add proof', async () => {
  const s = proofStore([proofRow()]);
  const v = await mount(h(ProofZone));
  try {
    const primaries = v.nodes().filter((n) => n.tagName === 'BUTTON' && /(^|\s)bg-amber-700(\s|$)/.test(v.props(n).className || ''));
    assert.deepEqual(primaries.map((b) => v.textOf(b).trim()), ['+ Add proof'], 'one filled primary');
    assert.ok(v.button('Ask for consent'), 'the toolbar op is still there');
    await v.press('Ask for consent');
    await assertDialog(v, 'proof-ask-sheet', { title: 'Ask a client for consent', firstField: 'Which outcome' });
    for (const label of ['Which outcome', 'Who is being asked', 'Email', 'Their role']) assert.ok(v.labelled(label), `${label} is labelled`);
    assert.ok(!v.text().includes('fixed inset-0'));
    await v.key('Escape');
    assert.equal(v.byTestId('proof-ask-sheet'), undefined, 'Escape closes it');
  } finally { await v.unmount(); s.restore(); }
});

test('Proof and Audience fit: a failed read is #5129’s Unavailable state', async () => {
  const restore = stubApi({
    listPartnerProof: async () => { throw httpError(503, 'down'); },
    listPartnerFitRules: async () => { throw httpError(503, 'down'); },
  });
  try {
    for (const Zone of [ProofZone, AudienceFitZone]) {
      const v = await mount(h(Zone));
      try {
        const state = v.nodes().find((n) => v.props(n)['data-platform-state'] === 'unavailable');
        assert.ok(state, 'the shared Unavailable state is drawn');
        assert.match(v.textOf(state), /Unavailable/);
        assert.ok(v.button('Try again'));
        assert.ok(!v.byTestId('proof-empty') && !v.byTestId('fit-empty'), 'never the empty state');
      } finally { await v.unmount(); }
    }
  } finally { restore(); }
});

// ── Audience fit and Product testing ─────────────────────────────────────────

test('Audience fit: the empty state has one action; the sheet’s fields carry their own errors', async () => {
  const restore = stubApi({
    listPartnerFitRules: async () => ({ items: [], unstated_count: 0 }),
    createPartnerFitRule: async () => { throw Object.assign(httpError(422, 'Name who this is for.'), { field: 'value' }); },
  });
  const v = await mount(h(AudienceFitZone));
  try {
    const empty = v.byTestId('fit-empty');
    assert.deepEqual(empty.querySelectorAll('button').map((b) => v.textOf(b).trim()), ['Add your first fit rule']);
    await v.press('Add your first fit rule');
    await v.fill('Client type or sector', 'Pre-seed fintech');
    await v.press('Save rule');
    await v.flush();
    const who = v.labelled('Client type or sector');
    assert.equal(v.props(who)['aria-invalid'], 'true');
    assert.ok(idsOf(v, who).some((id) => /Name who this is for\./.test(v.textOf(nodeWithId(v, id)))), 'the sentence is on the field it names');
    assert.equal(v.value('Client type or sector'), 'Pre-seed fintech');
  } finally { await v.unmount(); restore(); }
});

const prog = (o = {}) => ({ uid: 'p1', product_name: 'Pilot', status: 'draft', places: 5, picked_count: 0, applicant_count: 0, opens_at: null, closes_at: null, ...o });
const testingApi = (items) => ({
  programmes: async () => ({ items }), create: async () => ({}), edit: async () => ({}), submit: async () => ({}),
  applicants: async () => ({ items: [] }), pick: async () => ({}), decline: async () => ({}), uploadLogo: async () => ({}), removeLogo: async () => ({}),
});

test('Product testing: New programme is drawn once, the empty state once, and the current stage has a mark', async () => {
  const empty = await mount(h(TestingZone, { api: testingApi([]) }));
  try {
    const labels = empty.nodes().filter((n) => n.tagName === 'BUTTON' || n.tagName === 'A').map((b) => empty.textOf(b).trim());
    assert.equal(labels.filter((l) => /programme/i.test(l)).length, 1, `one create action in the empty state: ${labels.join(' | ')}`);
    assert.ok(labels.includes('Create a testing programme'));
  } finally { await empty.unmount(); }
  const v = await mount(h(TestingZone, { api: testingApi([prog({ status: 'open', applicant_count: 2 })]) }));
  try {
    const labels = v.nodes().filter((n) => n.tagName === 'BUTTON' || n.tagName === 'A').map((b) => v.textOf(b).trim());
    assert.deepEqual(labels.filter((l) => /New programme/.test(l)), ['+ New programme'], 'the toolbar no longer repeats it');
    const current = v.byTestId('testing-life-p1').childNodes.find((n) => v.props(n)['aria-current'] === 'step');
    assert.match(v.textOf(current), /^● Recruiting$/, 'the current stage is marked, not only coloured');
    assert.match(v.textOf(v.byTestId('testing-stage-p1')), /…Recruiting/, 'the phone chip is an icon and a word');
  } finally { await v.unmount(); }
});

// ── The rules, read once ─────────────────────────────────────────────────────

test('the shared pieces: client checks, the field a refusal names, and the type scale', () => {
  assert.deepEqual(offeringErrors({ title: ' ', price_usd: '' }), { title: 'Give the service a name.' });
  assert.equal(Object.keys(offeringErrors({ title: 'x', price_usd: '-1' }))[0], 'price_usd');
  assert.deepEqual(offeringErrors({ title: 'x', price_usd: '48000' }), {});
  assert.deepEqual(proofErrors({ title: 'x' }), {});
  assert.equal(writeFailureField(Object.assign(httpError(422, 'x'), { field: 'title' })), 'title');
  assert.equal(writeFailureField(Object.assign(httpError(500, 'x'), { field: 'title' })), null, 'a server failure names no field');
  assert.equal(writeFailureField(Object.assign(httpError(422, 'x'), { field: 'a b; drop' })), null, 'a malformed field name is ignored');
  const kit = readFileSync(new URL('../src/pages/partner/kit.jsx', import.meta.url), 'utf8');
  const body = (name) => kit.slice(kit.indexOf(`export function ${name}(`), kit.indexOf('\n}\n', kit.indexOf(`export function ${name}(`)));
  assert.match(body('OfferHeading'), /<h2 className="text-\[18px\][^"]*">\{title\}<\/h2>[\s\S]*text-\[14px\]/, 'section 18px, body 14px');
  assert.match(body('OfferEmpty'), /text-\[18px\][\s\S]*text-\[14px\]/);
  assert.match(body('OfferField'), /<span className="block text-\[13px\] font-semibold/, 'labels are 13px, not tiny uppercase');
  assert.doesNotMatch(body('OfferField'), /uppercase/);
  for (const file of ['ServiceCatalogPage.jsx', 'partner/offers/ProofZone.jsx']) {
    const src = readFileSync(new URL(`../src/pages/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /fixed inset-0/, `${file} draws no bespoke fixed overlay`);
    assert.doesNotMatch(src, /text-\[(?:9|10|11)(?:\.\d)?px\]/, `${file} draws no text below 12px`);
  }
});
