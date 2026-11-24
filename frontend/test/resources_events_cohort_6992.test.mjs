/**
 * D6992 (#6992) — Resources and Events show the same open cohort, and a failed
 * read no longer looks empty.
 *
 * This pins, with both pages mounted against answered `fetch` calls:
 *   - with an open cohort and no events, `/resources` and `/events` both draw
 *     the one `LabProgramCard` and the events' own empty line, and neither
 *     draws the programmes' empty line;
 *   - a rejected list read draws "Unavailable", "We could not load this list."
 *     and Try again, never the list's empty sentence, and Try again reads again;
 *   - a failed cohort read and a failed stats read are Unavailable too, and no
 *     failure draws a 0;
 *   - no cohort value is typed: the card's name, dates and places are the
 *     record's, and a blank field reads "Not recorded";
 *   - the hub puts blocks with rows before blocks without.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/resources_events_cohort_6992.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';

const ResourcesPage = (await import('../src/pages/site/ResourcesPage.jsx')).default;
const hub = await import('../src/pages/site/ResourcesPage.jsx');
const PublicEventsPage = (await import('../src/pages/events/PublicEventsPage.jsx')).default;
const card = await import('../src/components/site/LabProgramCard.jsx');
const lib = await import('../src/lib/siteResources.js');
const { placesFromRecord } = await import('../src/lib/spinoutLab.js');

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Server error',
  headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});

const OPEN_BRIEF = {
  applications_open: true,
  cohort: { name: 'December 2026', start_date: '2026-12-01T05:00:00Z', end_date: '2026-12-29T05:00:00Z', close_at: '2026-11-25T04:59:59Z', places: 25 },
};

/** Answers per address; `over` maps an address fragment to a function of the URL. */
function handler(over = {}) {
  return (url) => {
    for (const [k, f] of Object.entries(over)) if (url.includes(k)) return f(url);
    if (url.includes('/spinout-lab/brief')) return response(OPEN_BRIEF);
    if (url.includes('/api/public/stats')) return response({});
    if (url.includes('/public/events')) return response({ events: [] });
    if (url.includes('/public/partners')) return response({ partners: [] });
    if (url.includes('/articles/sectors')) return response({ sectors: [] });
    if (url.includes('/articles')) return response({ items: [] });
    if (url.includes('/circles')) return response({ circles: [] });
    if (url.includes('/jobs')) return response({ jobs: [] });
    return response({});
  };
}

async function mounted(el, at, handle = handler()) {
  const restore = installDocument();
  // SitePage forces the light theme on <html> and writes the page's meta tags into <head>.
  const html = document.documentElement;
  html.classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
  html.dataset = {};
  const make = document.createElement;
  document.createElement = (tag) => Object.assign(make(tag), { remove() { this.parentNode?.removeChild(this); } });
  document.head = document.createElement('head');
  document.head.querySelector = () => null;
  document.head.querySelectorAll = () => [];
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, error: console.error };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // A failed read is reported (`reportError`), which logs; keep the test output quiet.
  console.error = () => {};
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [at] }, el)));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  return {
    requests,
    text: () => text(container),
    byTestId: (id) => nodes().filter((n) => props(n)['data-testid'] === id),
    textOf: (n) => text(n),
    async clickIn(n, label) {
      const walk = (x) => [x, ...(x.childNodes || []).flatMap(walk)];
      const btn = walk(n).find((x) => x.tagName === 'BUTTON' && text(x).trim() === label);
      assert.ok(btn, `no ${label} button`);
      await act(async () => { props(btn).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await flush();
    },
    async unmount() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; console.error = previous.error;
      restore();
    },
  };
}

test('with an open cohort and no events, /resources draws the cohort card and the events\' own empty line', async () => {
  const v = await mounted(h(ResourcesPage), '/resources');
  try {
    const t = v.text();
    assert.equal(v.byTestId('lab-program-card').length, 1, 'the hub draws the Lab card');
    assert.match(t, /Spin-Out Lab · December 2026/, 'named as the cohort record names it');
    assert.match(t, /Apply to December 2026/);
    assert.ok(t.includes(hub.EVENTS_EMPTY), 'the events say their own empty line');
    assert.ok(!t.includes(card.PROGRAMS_EMPTY), 'the programmes do not say they are empty');
    assert.ok(!t.includes('Nothing is scheduled right now.'), 'the old shared line is gone');
    assert.ok(v.requests.some((u) => u.includes('/spinout-lab/brief')), 'the card reads the cohort record');
  } finally { await v.unmount(); }
});

test('with an open cohort and no events, /events draws the same cohort card and the events\' own empty line', async () => {
  const v = await mounted(h(PublicEventsPage), '/events');
  try {
    const t = v.text();
    assert.equal(v.byTestId('lab-program-card').length, 1, '/events draws the Lab card');
    assert.match(t, /Spin-Out Lab · December 2026/, 'the same name the hub draws');
    assert.match(t, /No upcoming events are scheduled right now\./, 'the events say their own empty line');
    assert.ok(!t.includes(card.PROGRAMS_EMPTY));
    assert.ok(!t.includes('match your filters'), 'with no filter set, the line does not speak of filters');
  } finally { await v.unmount(); }
});

test('with no open cohort, each page says so in the programmes\' own line', async () => {
  for (const [el, at] of [[h(ResourcesPage), '/resources'], [h(PublicEventsPage), '/events']]) {
    const v = await mounted(el, at, handler({ '/spinout-lab/brief': () => response({ applications_open: false, cohort: { name: 'December 2026' } }) }));
    try {
      assert.equal(v.byTestId('lab-program-card').length, 0, `${at}: no card for a closed cohort`);
      assert.ok(v.text().includes(card.PROGRAMS_EMPTY), `${at}: the programmes' empty line`);
    } finally { await v.unmount(); }
  }
});

test('a rejected list read draws Unavailable and Try again, not the empty line, and Try again reads again', async () => {
  let failing = true;
  let jobsReads = 0;
  const v = await mounted(h(ResourcesPage), '/resources', handler({
    '/public/events': () => (failing ? response({ error: 'down' }, 500) : response({ events: [] })),
    '/jobs': () => { jobsReads += 1; return failing ? Promise.reject(new TypeError('Failed to fetch')) : response({ jobs: [{ id: 1, slug: 'r1', title: 'Role read again', startup_name: 'Rowco' }] }); },
  }));
  try {
    const t = v.text();
    const off = v.byTestId('hub-list-unavailable');
    assert.equal(off.length, 2, 'the events and jobs blocks each say Unavailable');
    for (const n of off) {
      const s = v.textOf(n);
      assert.match(s, /Unavailable/);
      assert.match(s, /We could not load this list\./);
      assert.match(s, /Try again/);
    }
    assert.ok(!t.includes(hub.EVENTS_EMPTY), 'a failed events read is not "No events are scheduled"');
    assert.ok(!t.includes('No open roles right now.'), 'a failed jobs read is not "No open roles"');
    assert.ok(t.includes('No one is listed in the directory yet.'), 'a read that answered empty still says so');

    failing = false;
    const jobsPanel = off.find((n) => v.textOf(n.parentNode).includes('All roles'));
    await v.clickIn(jobsPanel, 'Try again');
    assert.equal(jobsReads, 2, 'Try again reads the list again');
    assert.match(v.text(), /Role read again/, 'and draws its rows');
    assert.equal(v.byTestId('hub-list-unavailable').length, 1, 'the events block is still Unavailable until its own Try again');
  } finally { await v.unmount(); }
});

test('a failed cohort read is Unavailable with Try again on both pages, never the programmes\' empty line', async () => {
  for (const [el, at] of [[h(ResourcesPage), '/resources'], [h(PublicEventsPage), '/events']]) {
    const v = await mounted(el, at, handler({ '/spinout-lab/brief': () => response({ error: 'down' }, 503) }));
    try {
      const off = v.byTestId('lab-program-unavailable');
      assert.equal(off.length, 1, `${at}: the programmes slot says Unavailable`);
      assert.match(v.textOf(off[0]), /Unavailable.*We could not load the open cohort\..*Try again/s);
      assert.ok(!v.text().includes(card.PROGRAMS_EMPTY), `${at}: a failed read is not "no programme is open"`);
    } finally { await v.unmount(); }
  }
});

test('a failed stats read says the figures are unavailable and draws no 0', async () => {
  const v = await mounted(h(ResourcesPage), '/resources', handler({ '/api/public/stats': () => response({ error: 'down' }, 500) }));
  try {
    const off = v.byTestId('hub-figures-unavailable');
    assert.equal(off.length, 1, 'the header says its figures are unavailable');
    assert.match(v.textOf(off[0]), /Unavailable.*Try again/s);
    assert.doesNotMatch(v.text(), /\b0\b/, 'no failed read is drawn as 0');
  } finally { await v.unmount(); }
  // The directory keeps `useSiteStats`'s shape: null on failure, so it draws no figure at all.
  assert.match(read('frontend/src/lib/siteResources.js'), /export function useSiteStats\(\) \{\n\s*return useSiteStatsRead\(\)\.stats;/);
  assert.doesNotMatch(codeOnly(read('frontend/src/lib/siteResources.js')), /\.catch\(\(\) => \{\}\)/, 'no read swallows its failure');
});

test('the list read states: loaded, empty, unavailable, loading', () => {
  assert.deepEqual(lib.READ_STATES, ['loading', 'loaded', 'empty', 'unavailable']);
  assert.equal(lib.listRead(null).state, 'loading');
  assert.equal(lib.listRead([]).state, 'empty');
  assert.equal(lib.listRead([{ id: 1 }]).state, 'loaded');
  assert.equal(lib.listRead({ state: 'unavailable', items: null }).state, 'unavailable');
  assert.equal(lib.listRead({ nope: true }).state, 'unavailable', 'a value that is not a list is not an empty list');
  assert.equal(lib.statsRead(null).state, 'loading');
  assert.deepEqual(lib.statsRead({ countries: 3 }), { state: 'loaded', stats: { countries: 3 } });
});

test('no cohort value is typed, and a blank field reads Not recorded', () => {
  const blank = { status: 'ok', cohort: { open: true, name: 'December 2026', startLabel: null, endLabel: null, deadlineLabel: null, places: null } };
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(card.LabProgramCard, { read: blank })));
  assert.match(html, /<dt>Starts<\/dt><dd><span[^>]*data-platform-state="not_recorded"[^>]*>.*?Not recorded<\/span><\/dd>/, 'a blank start reads Not recorded');
  assert.match(html, /<dt>Applications close<\/dt><dd><span[^>]*>.*?Not recorded<\/span><\/dd>/, 'a blank deadline reads Not recorded');
  assert.match(html, /<dt>Places<\/dt><dd><span[^>]*>.*?Not recorded<\/span><\/dd>/, 'blank places read Not recorded, not 0');
  assert.doesNotMatch(html, /<dd class="ax-mono">0<\/dd>/);
  assert.deepEqual(placesFromRecord(blank), { status: 'error', places: null, retry: undefined });
  assert.equal(placesFromRecord({ status: 'ok', cohort: { places: 12 } }).places, 12);

  // The card's facts come from the record it is handed, never from the client-side cohort count.
  for (const f of ['frontend/src/components/site/LabProgramCard.jsx', 'frontend/src/pages/events/PublicEventsPage.jsx', 'frontend/src/pages/site/ResourcesPage.jsx']) {
    const src = codeOnly(read(f));
    assert.doesNotMatch(src, /openCohortCopy|resolveOpenCohort|cohortNum/, `${f} numbers the cohort on the client`);
    assert.doesNotMatch(src, /Cohort \d|\b20\d\d\b|places:\s*\d|'\d+ places'/, `${f} types a cohort value`);
  }
});

test('the hub puts blocks with rows before blocks without', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(hub.ResourcesBody, {
    stats: null, members: [], events: [], articles: [], sectors: [], circles: [],
    jobs: [{ id: 4, slug: 'job-four', title: 'Live role row', startup_name: 'Rowco' }],
    cohort: { status: 'ok', cohort: { open: false } },
  })));
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at('ax-res-jobs-h') < at('ax-res-dir-h'), 'Jobs, with rows, comes before the Directory, without');
  assert.ok(at('ax-res-dir-h') < at('ax-res-events-h') && at('ax-res-events-h') < at('ax-res-articles-h'), 'the rest keep the canvas order');
  const wide = html.slice(html.indexOf('class="ax-res-2"'), html.indexOf('class="ax-res-3"'));
  assert.ok(wide.includes('id="ax-res-jobs-h"'), 'the first block with rows fills the wide row');

  const open = renderToStaticMarkup(h(MemoryRouter, null, h(hub.ResourcesBody, {
    stats: null, members: [], events: [], articles: [], sectors: [], circles: [], jobs: [],
    cohort: { status: 'ok', cohort: { open: true, name: 'December 2026', places: 25 } },
  })));
  assert.ok(open.indexOf('id="ax-res-events-h"') < open.indexOf('id="ax-res-dir-h"'), 'an open cohort is a row: Programs & events comes first');
});
