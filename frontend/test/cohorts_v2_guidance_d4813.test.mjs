/**
 * D4813 (#4813, package 2) — Cohorts guidance: the feed, the composer, drafts
 * and responses (boards C5, C6, C14 and the C11 guidance states).
 *
 * What these pin, each a decision that could quietly go the other way:
 *   · "New guidance" is there when the cohort has none, while the feed loads
 *     or fails, and after the last note is retired; the empty state covers the
 *     feed region only;
 *   · unsaved text is kept per cohort, so switching cohort never erases
 *     another cohort's draft, and a restored edit never undoes a newer version;
 *   · a save or read that answers after the cohort changed is dropped;
 *   · a 409 is a version conflict the composer offers to compare, never a
 *     silent overwrite; a refused week is shown on the field;
 *   · the five filters, the item's title, preview, week and status;
 *   · at 390px the composer is full screen with 44px targets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import {
  DRAFT_PREFIX, GUIDANCE_FILTERS, clearLocalDraft, draftKey, filterCounts, filterGuidance, guardedWrite,
  guidancePreview, guidanceStatusOf, guidanceTitle, needsResponse, parseGuidanceFilter, readLocalDraft,
  saveStateLine, validateWeek, weekMax, writeFailure, writeLocalDraft,
} from '../src/pages/advisor/cohorts/guidanceModel.js';
import { attentionItems, createRequestGate, guidanceActivity, withCohort } from '../src/pages/advisor/cohorts/cohortModel.js';
import { CohortWorkspaceContext } from '../src/pages/advisor/cohorts/CohortWorkspace.jsx';
import { GuidanceView } from '../src/pages/advisor/cohorts/GuidanceZone.jsx';
import GuidanceComposer from '../src/pages/advisor/cohorts/GuidanceComposer.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;

const ASSIGNED = [
  { cohort_cycle_id: 12, cohort: { year: 2026, month: 11 } },
  { cohort_cycle_id: 9, cohort: { year: 2026, month: 10 } },
];

function ctx(over = {}) {
  return {
    preview: false,
    assignments: { loading: false, error: '', items: ASSIGNED },
    reloadAssignments() {}, cycleId: 12, current: ASSIGNED[0], label: 'November 2026', notice: null,
    select() {}, version: 0, refresh() {}, lastUpdated: null, markUpdated() {},
    weeks: { loading: false, error: '', data: null }, reloadWeeks() {},
    href: (path, extra) => withCohort(path, 12, extra),
    ...over,
  };
}
const readState = (payload, over = {}) => ({ loading: false, error: '', data: payload, reload() {}, ...over });
const view = (data, { path = '/cohorts/guidance?cohort=12', value = ctx(), initialComposer } = {}) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [path] },
    h(CohortWorkspaceContext.Provider, { value }, h(GuidanceView, { data, initialComposer }))));

/** A Map-backed localStorage, optionally refusing every call. */
function memoryStorage({ broken = false } = {}) {
  const m = new Map();
  const guard = () => { if (broken) throw new Error('SecurityError'); };
  return {
    getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard(); m.set(k, String(v)); },
    removeItem: (k) => { guard(); m.delete(k); },
    keys: () => [...m.keys()],
  };
}
function withWindowStorage(storage, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  globalThis.window = { localStorage: storage };
  try { return fn(); } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
}

const ITEMS = [
  { uid: 'p1', kind: 'broadcast', title: 'Week 2: talk to customers', body: 'Five conversations before Friday.', week_number: 2, status: 'published', version: 3, posted_at: '2026-11-03T14:00:00Z', retired_at: null, acted_by: [] },
  { uid: 'd1', kind: 'broadcast', title: 'Pricing test checklist', body: 'Decide the one number first.', week_number: 3, status: 'draft', is_draft: true, version: 1, posted_at: '2026-11-08T13:40:00Z', updated_at: '2026-11-08T13:40:00Z', retired_at: null, acted_by: [] },
  { uid: 'old', kind: 'broadcast', title: null, body: 'Welcome to the cohort\nHow we work together for four weeks.', week_number: null, version: 1, posted_at: '2026-11-01T14:00:00Z', retired_at: null, acted_by: [] },
  { uid: 'r1', kind: 'broadcast', title: 'Old interview template', body: 'Superseded.', week_number: 1, status: 'retired', version: 2, posted_at: '2026-11-01T10:00:00Z', retired_at: '2026-11-04T10:00:00Z', acted_by: [] },
  { uid: 'q1', kind: 'question', asked_by_user_id: 3, title: null, body: 'Should the pricing test include annual plans?', answer: null, status: 'published', version: 1, posted_at: '2026-11-07T10:00:00Z', retired_at: null, acted_by: [] },
  { uid: 'q2', kind: 'question', asked_by_user_id: 4, title: null, body: 'Answered one', answer: 'Yes.', answered_at: '2026-11-06T10:00:00Z', status: 'published', version: 2, posted_at: '2026-11-05T10:00:00Z', retired_at: null, acted_by: [] },
];
const PAYLOAD = { items: ITEMS, counts: { broadcast: 2, drafts: 1, open: 1, answered: 1, medianResponseHours: 24 }, week_limit: { max: 4, source: 'week_windows' }, acknowledgements_recorded: false };

// ── New guidance is always there ────────────────────────────────────────────

test('D4813: an empty cohort offers New guidance in the header and in the feed’s own empty state', () => {
  const html = view(readState({ items: [], counts: { broadcast: 0, drafts: 0, open: 0, answered: 0, medianResponseHours: null }, week_limit: { max: 4 } }));
  assert.match(html, /data-testid="guidance-new"/, 'the header action');
  assert.match(html, /data-testid="guidance-new-empty"/, 'and the empty state’s');
  const text = renderedText(html);
  assert.match(text, /No guidance yet/);
  assert.match(text, /Guidance feed|No guidance yet/);
  // The empty state is inside the feed region; the filters stay outside it.
  const feed = html.slice(html.indexOf('data-testid="guidance-feed"'));
  assert.ok(feed.includes('No guidance yet'), 'the empty card is the feed’s');
  assert.ok(html.indexOf('data-testid="guidance-filters"') < html.indexOf('data-testid="guidance-feed"'));
});

test('D4813: the composer renders when the cohort has no guidance yet', () => {
  const html = view(readState({ items: [], counts: null, week_limit: { max: 4 } }), { initialComposer: { mode: 'new' } });
  assert.match(html, /data-testid="guidance-composer"/);
  assert.match(html, /data-cohort="12"/);
  const text = renderedText(html);
  for (const label of ['New guidance', 'Title', 'Cohort', 'Week', 'Body', 'Preview', 'Save draft', 'Publish to November 2026']) {
    assert.ok(text.includes(label), label);
  }
  assert.match(text, /optional, 1–4/, 'the week bound is the cohort’s');
});

test('D4813: New guidance stays while the feed loads, after it fails, and after the last note is retired', () => {
  assert.match(view(readState(null, { loading: true })), /data-testid="guidance-new"/);
  const failed = view(readState(null, { error: 'This cohort’s guidance could not be read.' }));
  assert.match(failed, /data-testid="guidance-new"/);
  assert.match(renderedText(failed), /could not be read/);

  const retired = { ...PAYLOAD, items: [ITEMS[3]] };
  const all = view(readState(retired));
  assert.match(all, /data-testid="guidance-new"/);
  assert.match(renderedText(all), /Old interview template/, 'All still lists the retired note');
  assert.match(renderedText(all), /Restore/);
  const published = view(readState(retired), { path: '/cohorts/guidance?cohort=12&filter=published' });
  assert.match(published, /data-testid="guidance-new"/);
  assert.match(published, /data-testid="guidance-new-filtered"/);
  assert.match(renderedText(published), /Nothing under Published/);
});

test('D4813: with no cohort assigned the boundary is drawn, not an empty feed', () => {
  const html = view(readState(null), { value: ctx({ assignments: { loading: false, error: '', items: [] }, cycleId: null, current: null, label: null }) });
  assert.match(renderedText(html), /No cohort has been assigned to you/);
  assert.doesNotMatch(html, /data-testid="guidance-feed"/);
});

// ── Filters and items ───────────────────────────────────────────────────────

test('D4813: five filters, and each item is in the ones it belongs to', () => {
  assert.deepEqual(GUIDANCE_FILTERS.map((f) => f.label), ['All', 'Published', 'Draft', 'Retired', 'Needs response']);
  assert.deepEqual(filterCounts(ITEMS), { all: 6, published: 2, draft: 1, retired: 1, needs_response: 1 });
  assert.deepEqual(filterGuidance(ITEMS, 'needs_response').map((g) => g.uid), ['q1']);
  assert.deepEqual(filterGuidance(ITEMS, 'published').map((g) => g.uid), ['p1', 'old'], 'a founder’s question is not something you published');
  assert.equal(guidanceStatusOf({ retired_at: null }), 'published', 'a row from before drafts is published');
  assert.equal(guidanceStatusOf({ retired_at: '2026-11-01', status: 'draft' }), 'retired');
  assert.equal(needsResponse({ ...ITEMS[4], retired_at: '2026-11-08' }), false, 'a retired question needs nothing');
  assert.equal(parseGuidanceFilter('needs_response'), 'needs_response');
  assert.equal(parseGuidanceFilter('<script>'), 'all');

  const html = view(readState(PAYLOAD), { path: '/cohorts/guidance?cohort=12&filter=needs_response' });
  assert.match(html, /role="radiogroup" aria-label="Guidance filter"/);
  assert.equal((html.match(/role="radio"/g) || []).length, 5);
  assert.match(html, /aria-checked="true" data-filter="needs_response"/);
  const text = renderedText(html);
  assert.match(text, /Should the pricing test include annual plans\?/);
  assert.doesNotMatch(text, /Pricing test checklist/, 'the draft is not a question');
  assert.match(text, /Answer/);
});

test('D4813: an item shows its title, preview, cohort, week, status, date and its actions', () => {
  const text = renderedText(view(readState(PAYLOAD)));
  assert.match(text, /Week 2: talk to customers/);
  assert.match(text, /Five conversations before Friday\./);
  assert.match(text, /November 2026 · Week 2/);
  assert.match(text, /November 2026 · General/);
  assert.match(text, /✓\s*Published/);
  assert.match(text, /✎\s*Draft/);
  assert.match(text, /⦸\s*Retired/);
  assert.match(text, /Published Tue, Nov 3/);
  assert.match(text, /Saved Sun, Nov 8/);
  assert.match(text, /Acknowledgements\s*Not recorded/, 'no founder writes one yet; never “0 acknowledged”');
  for (const a of ['Edit', 'Publish', 'Retire', 'Restore', 'Answer', 'History']) assert.ok(text.includes(a), a);
  // A note written before titles is named by its first line, not "Untitled".
  assert.equal(guidanceTitle(ITEMS[2]), 'Welcome to the cohort');
  assert.equal(guidancePreview(ITEMS[2]), 'How we work together for four weeks.');
  assert.equal(guidanceTitle({ title: '', body: '' }), 'Untitled draft');
});

// ── The week ────────────────────────────────────────────────────────────────

test('D4813: the composer checks the week with the Worker’s rule and words', () => {
  assert.deepEqual(validateWeek('', 4), { ok: true, week: null });
  assert.deepEqual(validateWeek(' 3 ', 4), { ok: true, week: 3 });
  for (const bad of ['0', '5', '7', '2.5', 'abc', '-1', '1e1']) assert.equal(validateWeek(bad, 4).ok, false, bad);
  assert.equal(validateWeek('7', 4).message, 'This cohort has 4 weeks. Choose a week from 1 to 4, or leave it empty for general guidance.');
  assert.equal(weekMax({ week_limit: { max: 4 } }), 4);
  assert.equal(weekMax(null), 52, 'the Worker’s fallback when no windows are recorded');
  const refused = writeFailure(Object.assign(new Error('This cohort has 4 weeks.'), { status: 400, code: 'guidance_week_invalid' }), 'failed_save');
  assert.deepEqual(refused, { state: 'invalid', message: 'This cohort has 4 weeks.' });
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/GuidanceComposer.jsx'));
  assert.match(src, /aria-invalid=\{weekError \? 'true' : undefined\}/);
  assert.match(src, /aria-describedby=\{weekError \? ids\.weekErr : undefined\}/);
  assert.match(src, /role="alert" data-testid="guidance-week-error"/, 'the week error is announced and linked to its field');
});

// ── Drafts per cohort ───────────────────────────────────────────────────────

test('D4813: unsaved text is kept per cohort; switching never erases another cohort’s draft', () => {
  const s = memoryStorage();
  assert.equal(draftKey(12, null), `${DRAFT_PREFIX}:12:new`);
  assert.notEqual(draftKey(12, null), draftKey(9, null));
  assert.ok(writeLocalDraft(12, null, { title: 'November note', body: 'For November', week: '2' }, s));
  assert.ok(writeLocalDraft(9, null, { title: 'October note', body: 'For October', week: '' }, s));
  assert.equal(readLocalDraft(12, null, s).body, 'For November');
  assert.equal(readLocalDraft(9, null, s).body, 'For October');
  clearLocalDraft(12, null, s);
  assert.equal(readLocalDraft(12, null, s), null);
  assert.equal(readLocalDraft(9, null, s).title, 'October note', 'clearing one cohort leaves the other');
  // An edit is keyed by its guidance too, so two notes in one cohort never share text.
  writeLocalDraft(12, 'd1', { title: 'Edited', body: 'x', baseVersion: 1 }, s);
  assert.equal(readLocalDraft(12, null, s), null);
  assert.equal(readLocalDraft(12, 'd1', s).baseVersion, 1);
  // A record filed under the wrong cohort is not read as this one's.
  s.setItem(draftKey(7, null), JSON.stringify({ cycleId: 12, body: 'misfiled' }));
  assert.equal(readLocalDraft(7, null, s), null);
  // Storage that throws is a convenience lost, never a crash.
  const broken = memoryStorage({ broken: true });
  assert.equal(writeLocalDraft(12, null, { body: 'x' }, broken), false);
  assert.equal(readLocalDraft(12, null, broken), null);
  assert.doesNotThrow(() => clearLocalDraft(12, null, broken));
});

test('D4813: returning to a cohort reopens its own unsaved note, and not another cohort’s', () => {
  const s = memoryStorage();
  writeLocalDraft(12, null, { title: 'November note', body: 'Kept for November', week: '' }, s);
  writeLocalDraft(9, null, { title: 'October note', body: 'Kept for October', week: '' }, s);
  withWindowStorage(s, () => {
    const nov = renderedText(view(readState(PAYLOAD)));
    assert.match(nov, /Kept for November/);
    assert.doesNotMatch(nov, /Kept for October/);
    assert.match(nov, /Your unsaved text from this device was restored/);
    assert.match(nov, /● Unsaved changes/);
    const octValue = ctx({ cycleId: 9, current: ASSIGNED[1], label: 'October 2026', href: (p, e) => withCohort(p, 9, e) });
    const oct = renderedText(view(readState(PAYLOAD), { value: octValue, path: '/cohorts/guidance?cohort=9' }));
    assert.match(oct, /Kept for October/);
    assert.doesNotMatch(oct, /Kept for November/);
  });
  withWindowStorage(memoryStorage(), () => {
    assert.doesNotMatch(view(readState(PAYLOAD)), /data-testid="guidance-composer"/, 'nothing kept, nothing opened');
  });
});

test('D4813: a kept edit is restored only against the version it was made on', () => {
  const s = memoryStorage();
  writeLocalDraft(12, 'p1', { title: 'Stale edit', body: 'Made on version 2', baseVersion: 2 }, s);
  const render = (item) => withWindowStorage(s, () => renderedText(renderToStaticMarkup(h(GuidanceComposer, {
    cycleId: 12, cohortName: 'November 2026', weekLimit: 4, editing: item, currentCycle: () => 12,
  }))));
  assert.match(render(ITEMS[0]), /Five conversations before Friday/, 'version 3 is on screen; the version-2 text would undo it');
  assert.match(render({ ...ITEMS[0], version: 2 }), /Made on version 2/);
  // The feed marks it.
  const marked = withWindowStorage(s, () => renderedText(view(readState({ ...PAYLOAD, items: [{ ...ITEMS[0], version: 2 }] }))));
  assert.match(marked, /Unsaved changes on this device/);
});

// ── Stale answers ───────────────────────────────────────────────────────────

function deferred() {
  let res; let rej;
  const promise = new Promise((a, b) => { res = a; rej = b; });
  return { promise, resolve: res, reject: rej };
}

test('D4813: a save for cohort A that answers after the switch to B is not painted into B', async () => {
  const gate = createRequestGate();
  let on = 12;
  const heard = [];
  const slow = deferred();
  const p = guardedWrite({ gate, forCycle: 12, currentCycle: () => on, write: () => slow.promise, onState: (s) => heard.push(s) });
  on = 9; // the advisor switched cohort
  slow.resolve({ uid: 'n1', version: 1 });
  const r = await p;
  assert.equal(r.ok, true, 'the save itself succeeded');
  assert.equal(r.landed, false, 'and it did not land on the cohort now shown');
  assert.deepEqual(heard, []);

  // A failure that answers late is ignored the same way.
  const late = deferred();
  const q = guardedWrite({ gate, forCycle: 9, currentCycle: () => on, write: () => late.promise, onState: (s) => heard.push(s) });
  on = 12;
  late.reject(Object.assign(new Error('boom'), { status: 500 }));
  assert.equal((await q).landed, false);
  assert.deepEqual(heard, []);

  // A newer write on the same cohort wins over an older one.
  const first = deferred(); const second = deferred();
  const a = guardedWrite({ gate, forCycle: 12, currentCycle: () => on, write: () => first.promise, onState: (s) => heard.push(['a', s.ok]) });
  const b = guardedWrite({ gate, forCycle: 12, currentCycle: () => on, write: () => second.promise, onState: (s) => heard.push(['b', s.ok]) });
  second.resolve({}); first.resolve({});
  assert.equal((await b).landed, true);
  assert.equal((await a).landed, false);
  assert.deepEqual(heard, [['b', true]]);
});

test('D4813: the composer clears kept text on the cohort it saved for, and guards every write', () => {
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/GuidanceComposer.jsx'));
  assert.match(src, /if \(r\.ok\) clearLocalDraft\(forCycle, forUid\);\s*if \(!r\.landed\) return null;/);
  assert.equal((src.match(/guardedWrite\(\{/g) || []).length, 3, 'save, publish a new note, publish a draft');
  assert.doesNotMatch(src, /cohortGuidanceApi\.\w+\([^)]*\)\.then/, 'no write bypasses the guard');
  const zone = codeOnly(read('frontend/src/pages/advisor/cohorts/GuidanceZone.jsx'));
  assert.match(zone, /key=\{`\$\{cycleId\}:\$\{composer\.item\?\.uid \|\| 'new'\}`\}/, 'one composer per cohort');
  assert.match(zone, /useCohortRead\(\(id\) => api\.listMyAdvisorCohortGuidance\(id\)/, 'the feed reads through the guarded cohort read');
});

// ── Conflict and save states ────────────────────────────────────────────────

test('D4813: a 409 is a version conflict with the row as it stands; nothing is overwritten silently', () => {
  const current = { uid: 'p1', version: 4, title: 'Theirs', body: 'Their words' };
  const f = writeFailure(Object.assign(new Error('changed'), { status: 409, code: 'guidance_version_conflict', data: { current } }), 'failed_save');
  assert.equal(f.state, 'conflict');
  assert.deepEqual(f.current, current);
  assert.equal(writeFailure(Object.assign(new Error('x'), { status: 500 }), 'failed_publish').state, 'failed_publish');
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/GuidanceComposer.jsx'));
  assert.match(src, /role="alert" data-testid="guidance-conflict"/);
  for (const b of ['Compare', 'Load their version', 'Keep mine']) assert.ok(src.includes(b), b);
  const keepMine = src.slice(src.indexOf('const keepMine'), src.indexOf('const line ='));
  assert.doesNotMatch(keepMine, /cohortGuidanceApi/, 'Keep mine writes nothing; the next Save is the advisor’s choice');
  assert.match(src, /disabled=\{busy \|\| Boolean\(conflict\)\} data-testid="guidance-save"/, 'no save while a conflict is unresolved');
});

test('D4813: every save state is words and a glyph, and errors are announced at once', () => {
  assert.equal(saveStateLine('saved', '13:40'), '✓ Draft saved 13:40');
  assert.equal(saveStateLine('saving'), '◷ Saving…');
  assert.equal(saveStateLine('unsaved'), '● Unsaved changes');
  assert.equal(saveStateLine('publishing'), '◷ Publishing…');
  assert.equal(saveStateLine('published', '14:02'), '✓ Published 14:02');
  assert.equal(saveStateLine('conflict'), '▲ Version conflict');
  assert.equal(saveStateLine('failed_save'), '✕ Not saved · Retry');
  assert.equal(saveStateLine('failed_publish'), '✕ Publish failed · your text is kept');
  assert.equal(saveStateLine('invalid'), '✕ Not saved · check the week');
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/GuidanceComposer.jsx'));
  assert.match(src, /role=\{meta\.role\}\s*aria-live=\{meta\.role === 'alert' \? 'assertive' : 'polite'\}/);
});

// ── Mobile and accessibility ────────────────────────────────────────────────

test('D4813: at 390px the composer is full screen with 44px targets; fields are labelled', () => {
  const html = renderToStaticMarkup(h(GuidanceComposer, { cycleId: 12, cohortName: 'November 2026', weekLimit: 4, currentCycle: () => 12, onClose() {} }));
  assert.match(html, /class="fixed inset-0 z-40 [^"]*md:static/);
  assert.match(html, /<section aria-labelledby="[^"]+"/);
  assert.match(html, /aria-label="Close the composer"[^>]*class="[^"]*h-11 w-11/);
  const buttons = html.match(/<button[^>]*>/g) || [];
  for (const b of buttons) assert.match(b, /min-h-\[4[48]px\]|h-11/, `44px target: ${b}`);
  for (const inputId of [...html.matchAll(/<(?:input|textarea) id="([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(html.includes(`for="${inputId}"`), `labelled: ${inputId}`);
  }
  assert.doesNotMatch(html, /\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/, 'nothing wider than a phone');
  assert.match(html, /role="status"[^>]*data-testid="guidance-save-state"/);
  const zone = view(readState(PAYLOAD));
  for (const b of zone.match(/<button[^>]*>/g) || []) assert.match(b, /min-h-\[44px\]/, `44px target: ${b}`);
  assert.match(zone, /overflow-x-auto/, 'the filter row scrolls rather than widening the page');
  const src = codeOnly(read('frontend/src/pages/advisor/cohorts/GuidanceComposer.jsx'));
  assert.match(src, /window\.addEventListener\('beforeunload', warn\)/, 'leaving with unsaved text asks first');
  assert.match(src, /window\.confirm\(/);
});

// ── The Overview keeps working ──────────────────────────────────────────────

test('D4813: the Overview’s activity skips drafts, names notes by title, and Answer opens Needs response', () => {
  const act = guidanceActivity({ items: ITEMS.map((g) => ({ ...g, acted_by: [] })) });
  const texts = act.map((a) => a.text);
  assert.ok(texts.includes('You posted “Week 2: talk to customers”'), 'by title');
  assert.ok(texts.some((t) => t.startsWith('You posted “Welcome to the cohort')), 'an untitled note by its body');
  assert.ok(!texts.some((t) => t.includes('Pricing test checklist')), 'a draft has not been posted');
  const { items } = attentionItems({ cycleId: 12, rows: [], guidance: { items: ITEMS }, calendar: { items: [] } });
  const q = items.find((i) => i.key === 'question:q1');
  assert.equal(q.action.label, 'Answer');
  assert.equal(q.action.to, '/cohorts/guidance?cohort=12&filter=needs_response');
  assert.ok(!items.some((i) => i.key === 'question:q2'));
});
