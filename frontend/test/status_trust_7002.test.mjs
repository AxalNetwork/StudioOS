/**
 * #7002 (X20): Trust and Status read one status record, and the trust pages
 * show only what is recorded.
 *
 *   1  The shared summary (lib/statusSummary.js): headline, affected functions
 *      with their impact, the newest open incident with its /status link, and
 *      its last update. A probe outage with no incident says so and its last
 *      update is Not recorded, never a made-up time. Never a percentage.
 *   2  With one status fixture, /status and /trust show the same affected
 *      function and the same last update, and Trust links to the incident.
 *   3  The documents register: the interview notice's version and date are the
 *      notice page's own (version 2, 2026-10-22).
 *   4  No tick without a check date: a recorded line with no date reads Not
 *      recorded with the reason; a dated line keeps its tick.
 *   5  The actions are labelled: Request the subprocessor list; the disclosure
 *      names GitHub and says "Report a security concern privately"; the two
 *      data buttons differ in label and destination, each its own account
 *      section after sign-in.
 *
 * Mutation checked (each broke a test below, then was restored):
 *   · statusSummary keeps a resolved incident as open → test 1 fails.
 *   · lastUpdate takes the oldest stamp, not the newest → tests 1 and 2 fail.
 *   · summaryLines drops the affected line → test 2 fails.
 *   · Trust's tile goes back to its own headline wording → test 2 fails.
 *   · documentRows drops the notice's date → test 3 fails.
 *   · lineMark ticks any recorded line → test 4 fails.
 *   · both data requests point at /account → test 5 fails.
 *   · the advisory action reads "Open an advisory" again → test 5 fails.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/status_trust_7002.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { LAST_UPDATE_NOT_RECORDED, NO_INCIDENT_RECORDED, statusSummary, summaryLines, stampWords } from '../src/lib/statusSummary.js';
import {
  DATA_REQUESTS, REPORT_WAYS, SUBPROCESSORS_REQUEST, UNCHECKED_WHY, dataRequestHref, documentTable, lineMark,
} from '../src/pages/site/trustCenterModel.js';
import { currentInterviewNotice } from '../src/pages/InterviewNoticePage.jsx';
import StatusPage from '../src/pages/StatusPage.jsx';
import TrustCenter from '../src/pages/site/TrustCenter.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const STATUS = {
  services: [
    { name: 'API and database', status: 'down', history: [], records_since: '2026-10-25' },
    { name: 'File storage', status: 'operational', history: [], records_since: '2026-10-25' },
    { name: 'MCP', status: 'unknown', monitoring: 'not_monitored', history: [] },
  ],
  incidents: [
    { id: 7, title: 'Reads failing on the database', status: 'investigating', severity: 'critical', affected_services: ['d1'], created_at: '2026-11-16 09:00:00',
      updates: [{ id: 1, incident_id: 7, status: 'investigating', body: 'Looking.', created_at: '2026-11-16 09:05:00' }, { id: 2, incident_id: 7, status: 'identified', body: 'Found it.', created_at: '2026-11-16 09:40:00' }] },
    { id: 6, title: 'An old one', status: 'resolved', severity: 'minor', affected_services: [], created_at: '2026-11-10 08:00:00', updates: [] },
  ],
};
const TRUST = { blocks: { glance: null, security: null, data: null, subprocessors: null, certifications: null, documents: null, disclosure: null }, subprocessors: { items: [], last_change: null }, changes: { items: [], complete: true } };

async function mount(element, url, status = STATUS) {
  const restore = installDocument();
  const meta = { getAttribute: () => '', setAttribute() {}, remove() {} };
  document.head = { querySelector: () => meta, appendChild() {} };
  document.getElementById = () => null;
  const classes = new Set();
  document.documentElement = { dataset: {}, classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => {
    const p = new URL(String(u), 'http://x').pathname.replace(/^\/api/, '');
    if (p === '/public/status') return json(status);
    if (p === '/public/trust') return json(TRUST);
    if (p === '/public/trust/matrix') return json({ profiles: [], rows: [] });
    if (p === '/public/trust/changes') return json(TRUST.changes);
    return json({}, 404);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (globalThis.window) { window.matchMedia = globalThis.matchMedia; window.innerWidth = 1440; }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, element)); });
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    textOf: (id) => textOf(byId(id)),
    has: (id) => Boolean(byId(id)),
    linkIn: (id) => { const a = walk(byId(id) || { childNodes: [] }).find((n) => String(n.tagName).toUpperCase() === 'A'); return a ? props(a).href : null; },
    text: () => textOf(container),
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; restore(); },
  };
}

test('1: the summary names the affected function, the open incident and its newest update, and never makes one up', () => {
  const s = statusSummary(STATUS);
  assert.equal(s.headline, 'Outage');
  assert.deepEqual(s.affected, [{ name: 'API and database', impact: 'Outage' }], 'operational and inventory-only rows are not affected');
  assert.deepEqual(s.incident, { id: 7, title: 'Reads failing on the database', href: '/status#incident-7' }, 'the open incident, not the resolved one');
  assert.equal(s.lastUpdate, '16 Nov 2026, 09:40 UTC');
  assert.deepEqual(summaryLines(s).map((l) => l.text), ['Affected: API and database (Outage)', 'Reads failing on the database', 'Last update 16 Nov 2026, 09:40 UTC']);
  // A resolved incident is never the open one, even when it is the newest.
  const newerResolved = { id: 9, title: 'Fixed already', status: 'resolved', severity: 'minor', created_at: '2026-11-16 12:00:00', updates: [] };
  assert.equal(statusSummary({ ...STATUS, incidents: [newerResolved, ...STATUS.incidents] }).incident.id, 7);
  assert.equal(statusSummary({ services: STATUS.services, incidents: [newerResolved] }).incident, null);
  const probeOnly = statusSummary({ services: STATUS.services, incidents: [] });
  assert.equal(probeOnly.incident, null);
  assert.equal(probeOnly.lastUpdate, null);
  assert.deepEqual(summaryLines(probeOnly).map((l) => l.text), ['Affected: API and database (Outage)', NO_INCIDENT_RECORDED, LAST_UPDATE_NOT_RECORDED]);
  const fine = statusSummary({ services: [{ name: 'API', status: 'operational' }], incidents: [] });
  assert.equal(fine.headline, 'All monitored services operational');
  assert.deepEqual(summaryLines(fine), [], 'nothing to explain when all is operational');
  assert.equal(statusSummary({}).state, 'unreadable');
  assert.equal(stampWords('2026-13-01 10:00'), null);
  assert.doesNotMatch(JSON.stringify(summaryLines(s)), /%/, 'never a percentage');
});

test('2: with one status record, /status and /trust show the same affected function and last update', async () => {
  const status = await mount(h(StatusPage), '/status');
  let statusAffected; let statusUpdated;
  try {
    statusAffected = status.textOf('status-summary-affected');
    statusUpdated = status.textOf('status-summary-updated');
    assert.equal(statusAffected, 'Affected: API and database (Outage)');
    assert.equal(statusUpdated, 'Last update 16 Nov 2026, 09:40 UTC');
  } finally { await status.close(); }
  const trust = await mount(h(TrustCenter), '/trust');
  try {
    assert.equal(trust.textOf('trust-status-line'), 'Outage');
    assert.equal(trust.textOf('trust-status-affected'), statusAffected, 'the same affected function');
    assert.equal(trust.textOf('trust-status-updated'), statusUpdated, 'the same last update');
    assert.equal(trust.linkIn('trust-status-incident'), '/status#incident-7', 'the incident link');
    assert.doesNotMatch(trust.text(), /A major outage is reported/);
  } finally { await trust.close(); }
});

test('3: the interview notice row shows the notice page\'s own version and date', async () => {
  const notice = currentInterviewNotice();
  assert.deepEqual(notice, { version: 2, updated: '2026-10-22' });
  const row = documentTable({ terms: 'July 8, 2026', privacy: 'October 29, 2026', risk: 'March 31, 2026', interview: notice }).find((r) => r.name === 'Interview notice');
  assert.equal(row.version, 'Version 2');
  assert.equal(row.updated, '2026-10-22');
  assert.deepEqual(currentInterviewNotice({ 1: { updated: 'not yet published' } }, 1), { version: 1, updated: null }, 'an unpublished notice has no date');
  const v = await mount(h(TrustCenter), '/trust/documents');
  try {
    assert.match(v.text(), /Interview notice\s*Version 2\s*2026-10-22/);
  } finally { await v.close(); }
});

test('4: a tick only beside a recorded check date', async () => {
  assert.equal(lineMark({ text: 'x', recorded: true, checked_at: '2026-10-14' }), 'checked');
  assert.equal(lineMark({ text: 'x', recorded: true, checked_at: null }), 'unchecked');
  assert.equal(lineMark({ text: 'x', recorded: true, checked_at: 'soon' }), 'unchecked', 'a date that is not a day is not a check');
  assert.equal(lineMark({ text: 'x', recorded: false, why: 'y' }), 'gap');
  const v = await mount(h(TrustCenter), '/trust/security');
  try {
    assert.ok(!v.has('trust-fact'), 'the page\'s own lines have no check date, so no tick');
    assert.ok(v.has('trust-fact-unchecked'));
    assert.match(v.text(), new RegExp(`HTTPS only, with HSTS for two years and preload\\. Not recorded${UNCHECKED_WHY.replace('.', '\\.')}`));
    assert.doesNotMatch(v.text(), /✓/);
  } finally { await v.close(); }
});

test('5: subprocessors, disclosure and data actions say what they do, and the two data requests differ', async () => {
  assert.deepEqual(SUBPROCESSORS_REQUEST, { label: 'Request the subprocessor list', href: 'mailto:privacy@axal.vc?subject=Subprocessor%20list' });
  const advisory = REPORT_WAYS.find((w) => w.key === 'advisory');
  assert.equal(advisory.title, 'Private advisory on GitHub');
  assert.equal(advisory.action, 'Report a security concern privately');
  const [copy, del] = DATA_REQUESTS;
  assert.equal(copy.title, 'Request a copy of your data');
  assert.equal(del.title, 'Request deletion');
  assert.notEqual(copy.path, del.path);
  assert.equal(dataRequestHref(copy, false), '/login?next=%2Faccount%23account-data-export');
  assert.equal(dataRequestHref(del, false), '/login?next=%2Faccount%23account-deletion');
  assert.equal(dataRequestHref(copy, true), '/account#account-data-export');
  const settings = (await import('node:fs')).readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
  for (const id of ['account-data-export', 'account-deletion']) assert.match(settings, new RegExp(`id="${id}"`), `the account section ${id} exists`);
  const data = await mount(h(TrustCenter), '/trust/data');
  try {
    assert.equal(data.textOf('trust-data-copy'), 'Request a copy of your data');
    assert.equal(data.textOf('trust-data-delete'), 'Request deletion');
  } finally { await data.close(); }
  const subs = await mount(h(TrustCenter), '/trust/subprocessors');
  try {
    assert.equal(subs.textOf('trust-subprocessors-request'), 'Request the subprocessor list');
  } finally { await subs.close(); }
  const disc = await mount(h(TrustCenter), '/trust/disclosure');
  try {
    assert.equal(disc.textOf('trust-report-advisory-action'), 'Report a security concern privately');
    assert.match(disc.textOf('trust-report-advisory'), /GitHub/);
  } finally { await disc.close(); }
});
