// D1614 W6 (#3974, CAL10): a Calendar agent session's last runs open W3's run sheet.
//   - each run the read names by uid has "Open run ›"; a run with no uid (a skip that never ran) has none;
//     without a handler nothing is drawn;
//   - mounted: pressing it hands the run's uid to the sheet;
//   - the sheet opens `RunSheet` (W3's `GET /api/teams/runs/:uid`, with Retry) over the session sheet.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_run_open_3974.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { AgentSessionView } from '../src/pages/CalendarAgentSessions.jsx';

const h = React.createElement;
/** Synthetic only. */
const SESSION = {
  id: 7, state: 'done', cadence: 'weekly', title: 'Synthetic weekly update',
  agent: { name: 'Finch' }, skill: { name: 'Synthetic update', version: 3 }, sponsor: { name: 'Synthetic Sponsor' },
  schedule: { cadence: 'weekly', weekday: 'Monday', time: '08:00', zone: 'UTC' },
  scope: { kind: 'project', id: 7 },
  last_runs: [
    { uid: 'run-a', date: 'Mon 9 Nov', state: 'done', proposals: 3, cost_cents: 38 },
    { uid: null, date: 'Mon 2 Nov', state: 'skipped', proposals: 0 },
    { uid: 'run-c', date: 'Mon 26 Oct', state: 'failed', proposals: 0, cost_cents: null },
  ],
  can: {},
};
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const count = (s, re) => (s.match(re) || []).length;

test('CAL10: each run with a uid has Open run; a skip that never ran has none; no handler, no button', () => {
  const on = html(h(AgentSessionView, { session: SESSION, onOpenRun: () => {} }));
  assert.equal(count(on, /data-testid="cal-agent-run-open"/g), 2, 'two runs ran');
  assert.match(on, /aria-label="Open the run of Mon 9 Nov"/);
  assert.doesNotMatch(on, /Open the run of Mon 2 Nov/, 'the skipped one never ran');
  assert.equal(count(html(h(AgentSessionView, { session: SESSION })), /cal-agent-run-open/g), 0);
});

test('CAL10 mounted: Open run hands the run\'s uid to the sheet', async () => {
  const restore = installDocument();
  const opened = [];
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(AgentSessionView, { session: SESSION, onOpenRun: (uid) => opened.push(uid) }))));
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const buttons = walk(container).filter((n) => props(n)['data-testid'] === 'cal-agent-run-open');
    for (const b of buttons) await act(async () => { props(b).onClick({ preventDefault() {} }); });
    assert.deepEqual(opened, ['run-a', 'run-c']);
  } finally { await act(async () => root.unmount()); restore(); }
});

test('CAL10: the session sheet opens W3\'s RunSheet over itself, and a retry re-reads the session', () => {
  const src = codeOnly(readFileSync('frontend/src/pages/CalendarAgentSessions.jsx', 'utf8'));
  assert.match(src, /import \{ RunSheet \} from '\.\/work\/WorkPage\.jsx';/);
  assert.match(src, /<AgentSessionView session=\{s\} onAct=\{act\} busy=\{busy\} onOpenRun=\{setRunUid\} \/>/);
  assert.match(src, /\{runUid \? <RunSheet uid=\{runUid\} onClose=\{\(\) => setRunUid\(null\)\} onRetried=\{\(\) => \{ onChanged\?\.\(\); load\(\); \}\} \/> : null\}/);
});
