/**
 * D4707 (#4707) — the licence page's URL state, filter reconciliation, tab
 * semantics, reason dialogs and attributable history.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_navigation_d4707.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  LICENCE_TABS, kindFromParam, reconcileSelection, stepOfTab, tabFromParam, tabKeyMove, tabOfStep, tabsFor,
} from '../src/pages/admin/licenceNavModel.js';
import { LICENCE_REASONS, checkReason } from '../src/pages/admin/licenceReasonModel.js';
import { actorLabel, changeRows, outcomeLabel } from '../src/pages/admin/licenceHistoryModel.js';
import { HistoryRow } from '../src/pages/admin/LicenceHistory.jsx';
import { LicenceReasonDialog } from '../src/pages/admin/LicenceReasonDialog.jsx';
import { adminLicenceHistoryApi } from '../src/lib/api/adminLicenceHistory.js';
import { renderedText } from './_renderedText.mjs';

const PAGE = readFileSync(new URL('../src/pages/admin/AdminLicences.jsx', import.meta.url), 'utf8');

// ── URL state ──────────────────────────────────────────────────────────────

test('every tab has a URL key that round-trips to the page step it opens', () => {
  for (const t of LICENCE_TABS) {
    assert.equal(tabOfStep(stepOfTab(t.key)), t.key, t.key);
  }
  assert.equal(new Set(LICENCE_TABS.map((t) => t.key)).size, LICENCE_TABS.length);
  assert.equal(new Set(LICENCE_TABS.map((t) => t.step)).size, LICENCE_TABS.length);
  // The model's numbers are the page's: STEPS has six, then the named steps.
  const named = { history: 'HISTORY_STEP', admins: 'ADMINS_STEP', notices: 'NOTICES_STEP', brand: 'BRAND_STEP', schedule: 'SCHEDULE_STEP', 'fee-invoices': 'FEE_INVOICES_STEP' };
  for (const [key, constant] of Object.entries(named)) {
    const m = PAGE.match(new RegExp(`const ${constant} = STEPS\\.length \\+ (\\d+);`));
    assert.ok(m, constant);
    assert.equal(stepOfTab(key), 6 + Number(m[1]), `${key} opens ${constant}`);
  }
});

test('a URL tab the licence does not have falls back to the first tab; the brand tab is white-label only', () => {
  assert.equal(tabFromParam('history', 'subsidiary').key, 'history');
  assert.equal(tabFromParam('brand', 'subsidiary').key, 'entity');
  assert.equal(tabFromParam('brand', 'white_label').key, 'brand');
  assert.equal(tabFromParam('nonsense', 'subsidiary').key, 'entity');
  assert.ok(!tabsFor('subsidiary').some((t) => t.key === 'brand'));
  assert.equal(kindFromParam('white_label'), 'white_label');
  assert.equal(kindFromParam('<script>'), 'all');
});

test('the page reads licence, tab and kind from the URL, and writes them back', () => {
  assert.match(PAGE, /const \[params, setParams\] = useSearchParams\(\);/);
  assert.match(PAGE, /kindFromParam\(params\.get\('kind'\)\)/);
  assert.match(PAGE, /const wanted = params\.get\('licence'\);/);
  assert.match(PAGE, /tabFromParam\(params\.get\('tab'\), open\?\.kind\)\.key/);
  assert.match(PAGE, /tab=\{tab\} onTab=\{\(t\) => setParam\(\{ tab: t === DEFAULT_TAB \? null : t \}\)\}/);
  assert.match(PAGE, /const step = stepOfTab\(tab\);/);
  assert.doesNotMatch(PAGE, /const \[step, setStep\] = useState\(1\);/, 'the tab is not local state any more');
});

// ── filters never leave a hidden row selected ──────────────────────────────

test('a selection the filter hides moves to the first row still shown, or to none', () => {
  const rows = [{ uid: 'a' }, { uid: 'b' }];
  assert.equal(reconcileSelection('b', rows), 'b');
  assert.equal(reconcileSelection('hidden', rows), 'a');
  assert.equal(reconcileSelection(null, rows), 'a');
  assert.equal(reconcileSelection('b', []), null);
  assert.equal(reconcileSelection('b', null), null);
});

test('the editor is fed the reconciled selection, computed from the visible rows', () => {
  assert.match(PAGE, /const visible = filterByKind\(allItems, kindFilter\);/);
  assert.match(PAGE, /const sel = data && data !== UNAVAILABLE \? reconcileSelection\(wanted, visible\) : null;/);
  assert.match(PAGE, /if \(sel !== wanted\) setParam\(\{ licence: sel \}, \{ replace: true \}\);/);
  // Opening a hidden licence widens the filter instead of editing an invisible row.
  assert.match(PAGE, /setParam\(shown \? \{ licence: uid \} : \{ licence: uid, kind: 'all' \}\);/);
});

// ── semantics ──────────────────────────────────────────────────────────────

test('tabs are a tablist with selection, roving focus and arrow keys; filters and rows say what is pressed and current', () => {
  assert.match(PAGE, /role="tablist" aria-label="Licence sections"/);
  assert.match(PAGE, /role="tab"\s+aria-selected=\{step === t\.step\} aria-controls="licence-tabpanel" tabIndex=\{step === t\.step \? 0 : -1\}/);
  assert.match(PAGE, /role="tabpanel" id="licence-tabpanel"/);
  assert.match(PAGE, /overflow-x-auto whitespace-nowrap/, 'a narrow screen scrolls the tab row rather than wrapping it');
  assert.match(PAGE, /aria-pressed=\{kindFilter === id\}/);
  assert.match(PAGE, /aria-pressed=\{form\.kind === id\}/);
  assert.match(PAGE, /aria-current=\{sel === l\.uid \? 'true' : undefined\}/);
  for (const label of ['Licence reference', 'Legal entity name', 'Brand name in product']) {
    assert.ok(PAGE.includes(`aria-label="${label}"`), label);
  }
  assert.equal(tabKeyMove('ArrowRight', 2, 5), 3);
  assert.equal(tabKeyMove('ArrowRight', 4, 5), 0);
  assert.equal(tabKeyMove('ArrowLeft', 0, 5), 4);
  assert.equal(tabKeyMove('Home', 3, 5), 0);
  assert.equal(tabKeyMove('End', 0, 5), 4);
  assert.equal(tabKeyMove('Enter', 0, 5), null);
});

// ── reasons ────────────────────────────────────────────────────────────────

test('no licence write asks with window.prompt or window.confirm any more', () => {
  assert.doesNotMatch(PAGE, /window\.(prompt|confirm)\(/);
  for (const k of ['demoteAdmin', 'acceptNotice', 'rejectNotice', 'suspendLicence', 'terminateLicence']) {
    assert.ok(PAGE.includes(`await ask(LICENCE_REASONS.${k})`), k);
  }
});

test('a reason is checked before it is sent, with the Worker\'s own minimums', () => {
  assert.equal(LICENCE_REASONS.demoteAdmin.min, 10, 'demote-admin refuses fewer than 10 characters');
  assert.deepEqual(checkReason('too short', { min: 10 }), { ok: false, message: 'At least 10 characters (9 so far).' });
  assert.equal(checkReason('  ', { min: 1 }).message, 'A reason is required.');
  assert.equal(checkReason('', { min: 0 }).ok, true, 'an acceptance note is optional');
  assert.equal(checkReason('x'.repeat(1001), { min: 1 }).ok, false);
});

test('the reason dialog is a labelled dialog whose field states its rule', () => {
  const html = renderToStaticMarkup(h(LicenceReasonDialog, { ask: LICENCE_REASONS.demoteAdmin, onDone: () => {} }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  const label = html.match(/<label for="([^"]+)"/);
  assert.ok(label, 'the field has a label');
  assert.match(html, new RegExp(`<textarea id="${label[1]}"`));
  const described = html.match(/aria-describedby="([^"]+)"/);
  assert.match(html, new RegExp(`id="${described[1]}"[^>]*>Required, at least 10 characters\\.`));
  assert.match(html, /data-testid="licence-reason-confirm" disabled=""/, 'confirm waits for a valid reason');
});

// ── history ────────────────────────────────────────────────────────────────

test('a history row names who did it, what changed and how it ended', () => {
  const html = renderToStaticMarkup(h(HistoryRow, { e: {
    id: 4, event: 'seats_changed', created_at: '2026-11-06 21:00:00', note: null, outcome: 'partial',
    actor: { state: 'known', id: 1, name: 'Sue' },
    change: { recorded: true, before: { founder: 5, investor: 2 }, after: { founder: 8, investor: 2 } },
  } }));
  const text = renderedText(html);
  assert.match(text, /seats changed/);
  assert.match(text, /by Sue/);
  assert.match(text, /HQ done · branch pending/);
  assert.match(text, /founder58/, 'before then after');
  assert.doesNotMatch(text, /investor/, 'an unchanged field is not listed as a change');
});

test('Not recorded and Unreadable stay two different things', () => {
  assert.equal(changeRows({ recorded: false }).state, 'not_recorded');
  assert.equal(changeRows({ recorded: true, readable: false }).state, 'unreadable');
  assert.equal(changeRows({ recorded: true, before: { a: 1 }, after: { a: 1 } }).state, 'none');
  assert.deepEqual(changeRows({ recorded: true, before: { status: 'active' }, after: { status: 'suspended' } }).rows,
    [{ field: 'status', label: 'Status', before: 'active', after: 'suspended' }]);
  assert.equal(outcomeLabel(null), 'Not recorded');
  assert.equal(actorLabel({ state: 'unknown', id: 9 }), 'Unknown account');
  assert.equal(actorLabel({ state: 'none' }), 'System');
  const legacy = renderedText(renderToStaticMarkup(h(HistoryRow, { e: { id: 1, event: 'created', actor: { state: 'none' }, change: { recorded: false }, outcome: null } })));
  assert.match(legacy, /Change: Not recorded\./);
  const broken = renderedText(renderToStaticMarkup(h(HistoryRow, { e: { id: 2, event: 'renewed', actor: { state: 'none' }, change: { recorded: true, readable: false }, outcome: 'committed' } })));
  assert.match(broken, /Change: Unreadable\./);
});

test('history pages through the Worker route with the cursor it was given', async () => {
  const store = new Map();
  globalThis.localStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response('{"items":[],"next_before":null}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    await adminLicenceHistoryApi.events('lic 1');
    await adminLicenceHistoryApi.events('lic 1', { before: 40, limit: 50 });
  } finally { globalThis.fetch = real; }
  assert.match(seen[0], /\/api\/admin\/licences\/lic%201\/events\?limit=50$/);
  assert.match(seen[1], /\/api\/admin\/licences\/lic%201\/events\?limit=50&before=40$/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/admin_licences.ts', import.meta.url), 'utf8');
  assert.ok(worker.includes("r.get('/:uid/events'"));
  assert.match(PAGE, /\{step === HISTORY_STEP && <LicenceHistory licence=\{d\} \/>\}/);
});
