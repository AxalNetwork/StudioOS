// D5205 (#5205) — the Worker's calendar registry is the one list of Calendar sources.
//
// `/calendar` showed 32 kinds while its header said six sources were aggregated and "Nothing else", and its
// "Not read here yet" card said cohort dates, deal closings and interview calls were not read, beside those very
// items. The frontend kept its own kinds, families and waits beside `services/calendar/registry.ts`, and they
// drifted. The page now builds them from the registry itself; this file holds every piece of presentation the
// frontend still keeps to it, and fails the day a registry change leaves the page behind.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_registry_truth_5205.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  FAMILY_LABELS, SOURCES, SOURCE_FAMILIES, SOURCE_KINDS, pushableKinds,
} from '../../cloudflare-worker/src/services/calendar/registry.ts';
import { COLOURS as WORKER_COLOURS } from '../../cloudflare-worker/src/services/calendar/prefs.ts';
import {
  CHIP_LABEL, EXPLORER_KINDS, FAMILIES, KINDS, KIND_LABEL, NOT_YET, PUSHABLE_KINDS, WAITS, familiesOf, kindsOf, waitsOf,
} from '../src/pages/calendarViews.js';
import { familiesFor, kindsOfFamilies } from '../src/pages/calendarGrid.js';
import { COLOURS } from '../src/pages/calendarSourcesModel.js';
import { AGENT_FAMILY, AGENT_KIND } from '../src/pages/calendarAgentModel.js';
import { EXTERNAL_KINDS } from '../src/pages/calendarItemModel.js';
import CalendarPage from '../src/pages/CalendarPage.jsx';

const read = (p) => readFileSync(p, 'utf8');
const h = React.createElement;

/* ------------------------------------------------------------------ *
 * One list: the page's kinds and families are the registry's
 * ------------------------------------------------------------------ */

test('the page has every registry kind, in its order, with its module, family, page-only and push flags', () => {
  assert.deepEqual(KINDS.map((k) => k.id), SOURCE_KINDS);
  for (const k of KINDS) {
    const s = SOURCES[k.id];
    assert.equal(k.from, s.module, `${k.id}: module`);
    assert.equal(k.family, s.family, `${k.id}: family`);
    assert.equal(k.page_only, s.page_only, `${k.id}: page only`);
    assert.equal(k.pushable, s.pushable, `${k.id}: pushable`);
    assert.equal(k.label, CHIP_LABEL[k.id] || s.label, `${k.id}: label`);
    assert.equal(KIND_LABEL[k.id], k.label);
  }
  assert.deepEqual([...PUSHABLE_KINDS].sort(), pushableKinds().sort(), 'push is drawn for a kind the registry does not push, or not for one it does');
});

test('a source added to the registry reaches the Kinds filter, its family and its legend with no second list', () => {
  // The builders the page uses, given a registry with one more kind: the kind is there with no frontend edit.
  const more = { ...SOURCES, board_meeting: { family: 'meetings', module: 'Governance › Board', label: 'Board meeting', page_only: true, pushable: false } };
  const kinds = kindsOf(more);
  assert.deepEqual(kinds.at(-1), { id: 'board_meeting', label: 'Board meeting', from: 'Governance › Board', family: 'meetings', page_only: true, pushable: false });
  assert.ok(familiesOf(kinds).find((f) => f.key === 'meetings').kinds.includes('board_meeting'));
  // A new family, too: it is drawn with the registry's name, in the registry's order.
  const famKinds = kindsOf({ ...SOURCES, x: { family: 'board', module: 'Board', label: 'X', page_only: true, pushable: false } });
  const fams = familiesOf(famKinds, [...SOURCE_FAMILIES, 'board'], { ...FAMILY_LABELS, board: 'Board' });
  assert.deepEqual(fams.at(-1), { key: 'board', label: 'Board', kinds: ['x'] });
});

test('the families are the registry\'s, every kind in exactly one, so the counts the page prints are the registry\'s', () => {
  const withKinds = SOURCE_FAMILIES.filter((f) => SOURCE_KINDS.some((k) => SOURCES[k].family === f));
  assert.deepEqual(FAMILIES.map((f) => f.key), withKinds);
  for (const f of FAMILIES) assert.equal(f.label, FAMILY_LABELS[f.key], `${f.key}: label`);
  const all = FAMILIES.flatMap((f) => f.kinds);
  assert.equal(all.length, SOURCE_KINDS.length, 'a kind is in two families, or in none');
  assert.deepEqual([...all].sort(), [...SOURCE_KINDS].sort());
});

test('no frontend file keeps a kind table or a family list of its own', () => {
  const page = codeOnly(read('frontend/src/pages/CalendarPage.jsx'));
  const views = codeOnly(read('frontend/src/pages/calendarViews.js'));
  assert.doesNotMatch(page, /const KINDS = \[/, 'CalendarPage.jsx has its own kind table again');
  assert.doesNotMatch(page, /\{ id: '[a-z_]+', label: '[^']+', from: '/, 'CalendarPage.jsx lists a kind\'s label and module again');
  assert.doesNotMatch(page, /const (KIND_LABEL|PUSHABLE_KINDS) = /, 'CalendarPage.jsx keeps its own labels or push list again');
  assert.doesNotMatch(views, /kinds: \['/, 'calendarViews.js lists a family\'s kinds by hand again');
  assert.match(views, /from '\.\.\/\.\.\/\.\.\/cloudflare-worker\/src\/services\/calendar\/registry\.ts'/, 'calendarViews.js no longer reads the registry');
});

/* ------------------------------------------------------------------ *
 * What the frontend still keeps, held to the registry
 * ------------------------------------------------------------------ */

test('the presentation kept in the frontend names only registry kinds and families', () => {
  for (const k of Object.keys(CHIP_LABEL)) {
    assert.ok(SOURCES[k], `CHIP_LABEL names ${k}, which the registry does not have`);
    assert.notEqual(CHIP_LABEL[k], SOURCES[k].label, `CHIP_LABEL.${k} repeats the registry's label: delete it`);
  }
  for (const k of EXPLORER_KINDS) assert.ok(SOURCES[k], `EXPLORER_KINDS names ${k}, which the registry does not have`);
  assert.equal(AGENT_FAMILY.label, FAMILY_LABELS[AGENT_FAMILY.key]);
  assert.equal(SOURCES[AGENT_KIND].family, AGENT_FAMILY.key);
  for (const k of EXTERNAL_KINDS) assert.equal(SOURCES[k]?.family, 'external', `${k} is not one of the registry's other calendars`);
  // Colours: the panel's palette is the Worker's, token for token.
  assert.deepEqual([...COLOURS], [...WORKER_COLOURS]);
  // Each kind's mark: one light and one dark hue, and a dot rule names only a registry kind.
  const css = read('frontend/src/pages/calendarPage.css');
  for (const k of SOURCE_KINDS) {
    assert.equal((css.match(new RegExp(`--k-${k}: #[0-9a-f]{6};`, 'g')) || []).length, 2, `${k} has no light and dark hue`);
  }
  for (const [, k] of css.matchAll(/data-kind='([a-z_]+)'/g)) assert.ok(SOURCES[k], `calendarPage.css draws ${k}, which the registry does not have`);
});

test('each profile keeps the sources it had: an Explorer\'s six kinds, everyone else every kind', () => {
  assert.deepEqual(kindsOfFamilies(familiesFor('exploring')).sort(),
    ['calendly_event', 'event_hosted', 'event_ticket', 'external_google', 'external_microsoft', 'manual']);
  for (const role of ['founder', 'investor', 'advisor', 'partner', 'admin']) {
    assert.deepEqual(kindsOfFamilies(familiesFor(role)).sort(), [...SOURCE_KINDS].sort(), role);
  }
});

test('no live kind stands under "Not read here yet"', () => {
  const live = SOURCE_KINDS;
  for (const w of WAITS) {
    assert.ok(Array.isArray(w.kinds) && w.kinds.length, `the wait ${w.key} names no kind, so nothing can retire it`);
    for (const k of w.kinds) assert.ok(!live.includes(k), `the wait ${w.key} says ${k} is not read, and the registry reads it`);
  }
  // The rule itself: a wait naming a live kind is dropped, one naming an unread kind stays.
  const waits = [
    { key: 'interviews', kinds: ['interview_call'], text: 'Interview calls are not on the calendar yet.' },
    { key: 'board', kinds: ['board_meeting'], text: 'Board meetings are not read yet.' },
  ];
  assert.deepEqual(waitsOf(waits, live).map((w) => w.key), ['board']);
  assert.deepEqual(waitsOf(waits, [...live, 'board_meeting']), []);
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

async function mounted(role) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const ok = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    if (path.startsWith('/calendar/events')) return ok({ items: [], sources: SOURCE_KINDS.map((kind) => ({ kind, ok: true, error: null })), coverage: { attempted: SOURCE_KINDS.length, hidden: 0 } });
    return ok({ configured: false, connected: false });
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify({ id: 3, role, name: 'F', email: 'f@example.com' }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/calendar'] }, h(CalendarPage))));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    by,
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('the page: no stale source copy, a legend row per registry kind, its count from the registry, no empty wait card', async () => {
  const v = await mounted('founder');
  try {
    const all = v.text();
    for (const stale of ['Nothing else is aggregated', 'six sources', 'Cohort week dates and deal closing dates are not read', 'Interview calls are not on the calendar']) {
      assert.ok(!all.includes(stale), `the page still says "${stale}"`);
    }
    assert.ok(v.text('cal-head-about').length > 20, 'the header lost its line');
    for (const k of SOURCE_KINDS) assert.ok(v.by(`cal-rail-dot-${k}`), `the legend has no row for ${k}`);
    assert.ok(all.includes(`${SOURCE_KINDS.length} kinds in ${FAMILIES.length} families`), 'the rail does not count the registry');
    assert.equal(v.by('cal-waits'), undefined);
    assert.ok(!all.includes(NOT_YET));
  } finally { await v.close(); }
  const e = await mounted('exploring');
  try {
    const fams = familiesFor('exploring');
    assert.ok(e.text().includes(`${kindsOfFamilies(fams).length} kinds in ${fams.length} families`), 'an Explorer\'s rail does not count its own sources');
    assert.equal(e.by('cal-rail-dot-ic_meeting'), undefined, 'an Explorer sees a source its profile does not read');
  } finally { await e.close(); }
});
