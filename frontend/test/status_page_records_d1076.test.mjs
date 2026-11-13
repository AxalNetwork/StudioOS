/**
 * D1076 (#2968) — /status says what is recorded: days with no incident
 * reported since records began, Not recorded before that, and never a
 * percentage of uptime (owner question 7, A).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/status_page_records_d1076.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import StatusPage from '../src/pages/StatusPage.jsx';
import { DAY_WORDS, recordLine } from '../src/lib/statusHistory.js';

const h = React.createElement;

const cells = (notRecorded, recorded, incidentAt = -1) => [
  ...Array.from({ length: notRecorded }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, '0')}`, status: 'not_recorded' })),
  ...Array.from({ length: recorded }, (_, i) => ({ day: `2026-10-${String(25 + i).padStart(2, '0')}`, status: i === incidentAt ? 'degraded' : 'no_incident' })),
];

const ANSWER = {
  services: [
    { name: 'API and database', status: 'operational', history: cells(80, 11), records_since: '2026-10-25', days_recorded: 11, days_without_incident: 11 },
    { name: 'File storage', status: 'operational', history: cells(80, 11, 3), records_since: '2026-10-25', days_recorded: 11, days_without_incident: 10 },
    { name: 'Search', status: 'operational', history: cells(90, 0), records_since: '2026-12-01', days_recorded: 0, days_without_incident: 0 },
    { name: 'MCP server', status: 'unknown', monitoring: 'not_monitored', availability: 'Enabled', history: cells(0, 0), records_since: null, days_recorded: null, days_without_incident: null },
  ],
  incidents: [],
};

async function mount(answer = ANSWER) {
  const restore = installDocument();
  // The page sets its title and meta tags (`usePageMeta`); the test DOM has no head.
  const meta = { getAttribute: () => '', setAttribute() {}, remove() {} };
  document.head = { querySelector: () => meta, appendChild() {} };
  document.getElementById = () => null;
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/status'] }, h(StatusPage))); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  return {
    text: () => textOf(container),
    cells: () => walk(container).filter((n) => props(n)?.['data-day']),
    props,
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('each row counts the days with no incident reported since records began, and the page prints no percentage', async () => {
  const v = await mount();
  try {
    const t = v.text();
    assert.match(t, /11 days of 11 days with no incident reported · records began on 2026-10-25/);
    assert.match(t, /10 days of 11 days with no incident reported/);
    assert.match(t, /Not recorded yet: records begin on 2026-12-01/);
    assert.match(t, /Not monitored: no history is kept/);
    assert.doesNotMatch(t, /%/, 'no percentage anywhere on the page');
    assert.doesNotMatch(t, /uptime/i);
  } finally { await v.unmount(); }
});

test('Not recorded days are drawn as Not recorded, never as a good day', async () => {
  const v = await mount();
  try {
    const all = v.cells();
    const notRecorded = all.filter((n) => v.props(n)['data-day'] === 'not_recorded');
    assert.equal(notRecorded.length, 80 + 80 + 90);
    for (const n of notRecorded) {
      assert.match(v.props(n).title, /: Not recorded$/);
      assert.doesNotMatch(v.props(n).className, /emerald/, 'a Not recorded day is not drawn green');
      assert.match(v.props(n).className, /border-dashed/, 'a Not recorded day is drawn as an empty, dashed cell');
    }
    const good = all.filter((n) => v.props(n)['data-day'] === 'no_incident');
    assert.equal(good.length, 11 + 10);
    assert.match(v.props(good[0]).title, /: No incident reported$/);
    assert.equal(all.filter((n) => v.props(n)['data-day'] === 'degraded').length, 1);
  } finally { await v.unmount(); }
});

test('the words: a missing count is no line, never a zero; one day is singular', () => {
  assert.equal(recordLine({ records_since: '2026-10-25', days_recorded: null, days_without_incident: null }), null);
  assert.equal(recordLine({ records_since: null, days_recorded: 3, days_without_incident: 3 }), null);
  assert.equal(recordLine({ records_since: '2026-10-25', days_recorded: 1, days_without_incident: 1 }),
    '1 day of 1 day with no incident reported · records began on 2026-10-25');
  assert.deepEqual(Object.keys(DAY_WORDS).sort(), ['degraded', 'down', 'no_incident', 'not_recorded', 'unknown']);
  assert.equal(DAY_WORDS.no_incident, 'No incident reported');
});
