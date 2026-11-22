/**
 * D7816 (#7816) — the Research Project brief, mounted on the project routes: a saved brief stays saved,
 * typed text survives a switch between the project's tabs, leaving the project with unsaved text asks first,
 * and a refused save loses nothing typed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_project_brief_7816.test.mjs
 *
 * What main did before this (the same file run against 46fbef839a): the first test failed because the
 * second save was refused (the page held the read from before the first save, version 0); the second failed
 * because the typed text was gone after a tab switch; the third failed because nothing asked by link, Back
 * or reload; the fourth failed because a refused save offered no action that keeps the text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import ResearchProject from '../src/pages/research/ResearchProject.jsx';
import { researchProjectsApi } from '../src/lib/api/researchProjects.js';
import { researchProjectFindingsApi } from '../src/lib/api/researchProjectFindings.js';
import { researchProjectComparisonsApi } from '../src/lib/api/researchProjectComparisons.js';
import { researchProjectBriefsApi } from '../src/lib/api/researchProjectBriefs.js';
import { LEAVE_MESSAGE } from '../src/lib/leaveGuard.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const HEADINGS = ['Executive summary', 'Key findings', 'Market context', 'Company comparison',
  'Risks and uncertainty', 'Open questions', 'Sources', 'Methodology'];
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const settle = async (m) => { for (let i = 0; i < 6; i += 1) await m.flush(); };
const byTid = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id) || null;
const area = (m, heading) => m.nodes().find((n) => n.tagName === 'TEXTAREA' && m.props(n)?.['aria-label'] === heading) || null;
const valueOf = (m, heading) => m.props(area(m, heading))?.value;
const button = (m, pattern) => m.nodes().find((n) => n.tagName === 'BUTTON' && pattern.test(textOf(n))) || null;
const type = async (m, heading, value) => { await act(async () => { m.props(area(m, heading)).onChange({ target: { value } }); }); await settle(m); };
const save = async (m) => {
  const form = m.nodes().find((n) => n.tagName === 'FORM' && m.props(n)?.['aria-label'] === 'Research brief');
  await act(async () => { m.props(form).onSubmit({ preventDefault() {} }); });
  await settle(m);
};
const press = async (m, node) => { await act(async () => { m.props(node).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(m); };
/** A left click on a tab link, as the router's Link reads it. */
const tab = async (m, slug) => {
  const link = byTid(m, `project-tab-${slug}`);
  const ev = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  await act(async () => { m.props(link).onClick(ev); });
  await settle(m);
};

const PROJECT = { uid: 'p1', title: 'European AI Infrastructure', question: 'Q', objective: null, scope: null, exclusions: null, status: 'in_progress', archived_at: null, created_at: '2026-11-08 10:00:00', updated_at: '2026-11-12 10:00:00' };
const READ = { item: PROJECT, evidence: [], passages_unattributed: 0, collections: [], sessions: [], answers: [] };
const blank = () => HEADINGS.map(() => ({ text: '', reviewed: false }));
const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });

/** The Worker's brief store, as `research_project_briefs.ts` keeps it: a version, and a 409 for a stale one. */
function briefStore(initial = null) {
  const store = { brief: initial, saves: [], archived: false };
  store.api = {
    read: async () => ({ brief: store.brief ? structuredClone(store.brief) : null }),
    save: async (_uid, body) => {
      store.saves.push(structuredClone(body));
      if (store.archived) throw refusal(409, 'project_archived', 'Restore this project before editing its brief.');
      if (body.version !== (store.brief?.version ?? 0)) throw refusal(409, 'brief_changed', 'This brief or project changed. Read it again before saving.');
      const sections = body.sections.map((s) => ({ text: s.text.trim(), reviewed: Boolean(s.text.trim()) && s.reviewed }));
      store.brief = { sections, version: (store.brief?.version ?? 0) + 1, updated_at: '2026-11-21 10:00:00' };
      return { brief: structuredClone(store.brief) };
    },
  };
  return store;
}

/**
 * One window event table for the whole file: the leave gate is installed once per window (`installLeaveGate`),
 * so its listener has to stay in the table it was added to across tests.
 */
const events = (() => {
  const listeners = [];
  return {
    listeners,
    add(type, fn) { listeners.push({ type, fn }); },
    remove(type, fn) { const at = listeners.findIndex((l) => l.type === type && l.fn === fn); if (at >= 0) listeners.splice(at, 1); },
    dispatch(ev) { for (const l of listeners.filter((x) => x.type === ev.type)) { if (ev.stopped) break; l.fn(ev); } return true; },
  };
})();
class FakeEvent {
  constructor(type, init = {}) { this.type = type; this.state = init.state; this.stopped = false; }
  preventDefault() { this.prevented = true; }
  stopImmediatePropagation() { this.stopped = true; }
}

let navigateTo = null;
function Grab() { navigateTo = useNavigate(); return null; }

async function mount(store, path = '/research/projects/p1/brief') {
  const real = { projects: { ...researchProjectsApi }, findings: { ...researchProjectFindingsApi }, compared: { ...researchProjectComparisonsApi }, briefs: { ...researchProjectBriefsApi } };
  Object.assign(researchProjectsApi, { read: async () => READ });
  Object.assign(researchProjectFindingsApi, { list: async () => ({ items: [], proposals: [] }) });
  Object.assign(researchProjectComparisonsApi, { list: async () => ({ items: [], entities: [] }) });
  Object.assign(researchProjectBriefsApi, store.api);
  const asked = [];
  const routes = ['overview', 'evidence', 'findings', 'comparisons', 'brief'].map((slug) => h(Route, {
    key: slug, path: slug === 'overview' ? '/research/projects/:uid' : `/research/projects/:uid/${slug}`, element: h(ResearchProject, { tab: slug }),
  }));
  const tree = h(React.Fragment, null, h(Grab), h(Routes, null, ...routes, h(Route, { key: 'list', path: '/research/projects', element: h('p', null, 'My Research') })));
  const m = await mountContracts(tree, path, { id: 1, role: 'founder' });
  // After `installDocument`, which replaces these: the router's leave guard reads them off `window`.
  Object.assign(globalThis, {
    addEventListener: events.add, removeEventListener: events.remove, dispatchEvent: events.dispatch, PopStateEvent: FakeEvent,
    history: { state: { idx: 3 }, goCalls: [], go(n) { this.goCalls.push(n); } },
    confirm: (message) => { asked.push(message); return false; },
  });
  globalThis.location.pathname = path;
  await settle(m);
  return {
    m, asked,
    async done() {
      await m.unmount();
      Object.assign(researchProjectsApi, real.projects); Object.assign(researchProjectFindingsApi, real.findings);
      Object.assign(researchProjectComparisonsApi, real.compared); Object.assign(researchProjectBriefsApi, real.briefs);
    },
  };
}

test('save, open another tab, come back, edit, save: the second save is accepted with the next version', async () => {
  const store = briefStore();
  const { m, done } = await mount(store);
  try {
    await type(m, 'Executive summary', 'Nordic power sets the cost floor.');
    const before = area(m, 'Executive summary');
    await save(m);
    assert.equal(store.brief.version, 1);
    // Mutation checked: remount the editor on the refreshed copy (key it on the version) → a new node here.
    assert.equal(area(m, 'Executive summary'), before, 'the refreshed copy does not remount the editor');
    await tab(m, 'overview');
    assert.equal(area(m, 'Executive summary'), null);
    await tab(m, 'brief');
    // Mutation checked: return to the page's first read → '' and version 0 here, and the save below is refused.
    assert.equal(valueOf(m, 'Executive summary'), 'Nordic power sets the cost floor.');
    await type(m, 'Key findings', 'Two of five sites have grid contracts.');
    await save(m);
    assert.deepEqual(store.saves.map((s) => s.version), [0, 1], 'the second save names the version the first one wrote');
    assert.equal(store.brief.version, 2);
    assert.match(m.text(), /Brief saved/);
    assert.doesNotMatch(m.text(), /changed/);
  } finally { await done(); }
});

test('text typed and not saved survives a switch between the project’s tabs, and the switch asks nothing', async () => {
  const store = briefStore({ sections: blank().map((s, i) => (i === 2 ? { text: 'Saved context.', reviewed: true } : s)), version: 4, updated_at: '2026-11-20 10:00:00' });
  const { m, asked, done } = await mount(store);
  try {
    assert.equal(valueOf(m, 'Market context'), 'Saved context.');
    await type(m, 'Open questions', 'Who owns the grid connection?');
    await tab(m, 'findings');
    await tab(m, 'evidence');
    await act(async () => { navigateTo('/research/projects/p1/comparisons'); });
    await settle(m);
    // Back to another tab of the same project is not leaving it.
    globalThis.location.pathname = '/research/projects/p1';
    globalThis.history.state = { idx: 2 };
    globalThis.dispatchEvent(new FakeEvent('popstate', { state: { idx: 2 } }));
    // Mutation checked: drop the destination test → each of these four moves asks, and asked is not empty.
    assert.deepEqual(asked, [], 'moving between the project’s tabs asks nothing');
    await tab(m, 'brief');
    // Mutation checked: hold no draft (the editor's own state, as on main) → the typed text is '' here.
    assert.equal(valueOf(m, 'Open questions'), 'Who owns the grid connection?');
    assert.equal(valueOf(m, 'Market context'), 'Saved context.');
    await save(m);
    assert.equal(store.saves.at(-1).version, 4);
    assert.equal(store.brief.version, 5);
  } finally { await done(); }
});

test('leaving the project with unsaved text asks first, by link, by Back and on reload; once saved, nothing asks', async () => {
  const store = briefStore();
  const { m, asked, done } = await mount(store);
  try {
    await type(m, 'Sources', 'Ember 2025 power price series.');
    await act(async () => { navigateTo('/research/projects'); });
    await settle(m);
    assert.deepEqual(asked, [LEAVE_MESSAGE], 'a link out of the project asks');
    assert.equal(valueOf(m, 'Sources'), 'Ember 2025 power price series.', 'declined: the page and the text stay');
    // Back to My Research: the browser has moved, and the gate takes the move before the router sees it.
    globalThis.location.pathname = '/research/projects';
    globalThis.history.state = { idx: 2 };
    globalThis.dispatchEvent(new FakeEvent('popstate', { state: { idx: 2 } }));
    assert.equal(asked.length, 2, 'Back out of the project asks');
    assert.deepEqual(globalThis.history.goCalls, [1], 'declined: the history is walked back');
    globalThis.location.pathname = '/research/projects/p1/brief';
    globalThis.history.state = { idx: 3 };
    // A reload or a closed tab.
    const unload = new FakeEvent('beforeunload');
    globalThis.dispatchEvent(unload);
    assert.equal(unload.prevented, true, 'a reload asks');
    await save(m);
    asked.length = 0;
    const after = new FakeEvent('beforeunload');
    globalThis.dispatchEvent(after);
    // Mutation checked: keep the guard on after a save (dirty never cleared) → this is prevented and asks.
    assert.equal(after.prevented, undefined, 'saved: a reload asks nothing');
    await act(async () => { navigateTo('/research/projects'); });
    await settle(m);
    assert.deepEqual(asked, []);
    assert.match(m.text(), /My Research/);
  } finally { await done(); }
});

test('a save refused because the brief changed keeps every typed word; one action loads it and the next save is accepted', async () => {
  const saved = blank().map((s, i) => (i === 0 ? { text: 'Old summary.', reviewed: true } : i === 5 ? { text: 'Old question.', reviewed: false } : s));
  const store = briefStore({ sections: saved, version: 2, updated_at: '2026-11-20 10:00:00' });
  const { m, done } = await mount(store);
  try {
    await type(m, 'Executive summary', 'My new summary.');
    // Another tab of the browser saves meanwhile: version 3 changes another section.
    store.brief = { sections: saved.map((s, i) => (i === 5 ? { text: 'Their question.', reviewed: false } : s)), version: 3, updated_at: '2026-11-21 09:00:00' };
    await save(m);
    assert.equal(store.brief.version, 3, 'refused');
    assert.equal(valueOf(m, 'Executive summary'), 'My new summary.', 'nothing typed is lost');
    const load = button(m, /keep my changes/);
    // Mutation checked: offer no action on a 409 (as on main) → load is null.
    assert.ok(load, 'one action is offered');
    assert.equal(textOf(load), 'Load version 3, keep my changes');
    await press(m, load);
    assert.equal(valueOf(m, 'Executive summary'), 'My new summary.', 'a section the member changed keeps their text');
    // Mutation checked: keep every drafted section (no merge) → 'Old question.' here, and a stale version.
    assert.equal(valueOf(m, 'Open questions'), 'Their question.', 'a section the member did not change takes the saved text');
    assert.equal(button(m, /keep my changes/), null);
    await save(m);
    assert.equal(store.saves.at(-1).version, 3);
    assert.equal(store.brief.version, 4);
    assert.deepEqual(store.brief.sections.map((s) => s.text).filter(Boolean), ['My new summary.', 'Their question.']);
  } finally { await done(); }
});

test('a save refused because the project was archived meanwhile says so, keeps the text and offers no load', async () => {
  const store = briefStore();
  const { m, done } = await mount(store);
  try {
    await type(m, 'Methodology', 'Desk research only.');
    store.archived = true;
    await save(m);
    assert.match(m.text(), /archived/);
    assert.equal(valueOf(m, 'Methodology'), 'Desk research only.');
    // Mutation checked: treat every 409 as a changed brief → a load action is offered here.
    assert.equal(button(m, /keep my changes/), null, 'no load action for an archived project');
  } finally { await done(); }
});
