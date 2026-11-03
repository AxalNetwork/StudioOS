// D4254 P4 (#4272, ps7, ps7x, ps7b) — Share & analytics, the board on the daily read (D4272).
//
//   1. The model: the tile's states (loading, unreadable, no links, no views, ready), the two
//      series per day, each funnel's steps with null as "Not recorded" (and "No NDA" on open
//      links), the drop-off rows, and the PostHog line (quiet when not connected, neutral on a
//      failed read).
//   2. The mounted board: it reads the deck's daily read with the version and NDA filters the
//      member picks, and draws each state.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/share_board_4272.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ShareBoard from '../src/pages/raise/pitch/ShareBoard.jsx';
import { deckSlideAnalyticsApi } from '../src/lib/api/deckSlideAnalytics.js';
import { posthogApi } from '../src/lib/api/posthog.js';
import {
  NO_LINKS, NO_VIEWS, UNREADABLE, boardState, dailyBars, dropRows, dropTitle, funnelRows, posthogLine,
} from '../src/pages/raise/pitch/shareBoardModel.js';

const h = React.createElement;
const ok = (data) => ({ status: 'ok', data });
const DAILY = {
  days: [
    { date: '2026-10-01', nda: 2, open: 1, first_nda: 1, first_open: 1 },
    { date: '2026-10-02', nda: 0, open: 0, first_nda: 0, first_open: 0 },
    { date: '2026-10-03', nda: 0, open: 4, first_nda: 0, first_open: 0 },
  ],
  funnels: {
    nda: { sent: 4, opened: 2, nda_shown: 2, accepted: 1, reached_ask: null },
    open: { sent: 2, opened: 2, nda_shown: null, accepted: null, reached_ask: 0 },
  },
  dropoff: {
    current: { version: 7, cards: [{ index: 0, title: 'Cover', seconds: 40, drop_pct: 0 }, { index: 1, title: null, seconds: null, drop_pct: 50 }, { index: 2, title: 'Ask', seconds: 5, drop_pct: null }] },
    previous: { version: 6, cards: [{ index: 0, title: 'Cover', seconds: 30, drop_pct: 10 }] },
  },
  versions: [],
};

test('#4272 the tile\'s states: unreadable, no links, no views, ready', () => {
  assert.equal(boardState({ status: 'loading' }), 'loading');
  assert.equal(boardState({ status: 'error' }), 'unreadable');
  const none = { ...DAILY, days: DAILY.days.map((d) => ({ ...d, nda: 0, open: 0 })), funnels: { nda: { sent: 0 }, open: { sent: 0 } } };
  assert.equal(boardState(ok(none)), 'no-links');
  // Mutation checked: counting only views → links sent and nobody opened read as "no links".
  assert.equal(boardState(ok({ ...none, funnels: { nda: { sent: 3 }, open: { sent: 0 } } })), 'no-views', 'links sent, none opened');
  assert.equal(boardState(ok(DAILY)), 'ready');
});

test('#4272 the two series per day, scaled to the busiest day, first views kept', () => {
  const b = dailyBars(DAILY.days);
  assert.deepEqual(b.map((x) => [x.date, x.nda, x.open, x.first, x.ndaPct, x.openPct]), [
    ['2026-10-01', 2, 1, 2, 50, 25], ['2026-10-02', 0, 0, 0, 0, 0], ['2026-10-03', 0, 4, 0, 0, 100],
  ]);
});

test('#4272 each funnel\'s steps: null is "Not recorded", never 0; an open link has no NDA step', () => {
  const nda = funnelRows(DAILY.funnels.nda, true);
  assert.deepEqual(nda.map((r) => [r.label, r.n, r.note, r.width]), [
    ['Sent', 4, null, 100], ['Opened', 2, null, 50], ['NDA shown', 2, null, 50], ['Accepted', 1, null, 25], ['Reached the ask', null, 'Not recorded', 0],
  ]);
  const open = funnelRows(DAILY.funnels.open, false);
  // Mutation checked: drop the open-link note → the NDA steps read "Not recorded" and this fails.
  assert.deepEqual(open.map((r) => [r.label, r.n, r.note]), [
    ['Sent', 2, null], ['Opened', 2, null], ['NDA shown', null, 'No NDA on these links'], ['Accepted', null, 'No NDA on these links'], ['Reached the ask', 0, null],
  ], 'a counted 0 stays 0');
});

test('#4272 drop-off rows and their heading', () => {
  const r = dropRows(DAILY.dropoff.current);
  assert.deepEqual(r.map((x) => [x.title, x.seconds, x.drop, x.pct]), [['Cover', 40, 0, 100], ['Card 2', null, 50, 0], ['Ask', 5, null, 13]]);
  assert.equal(dropTitle(DAILY.dropoff), 'Where readers drop off · v7 against v6');
  assert.equal(dropTitle({ current: { version: 1 }, previous: null }), 'Where readers drop off · v1');
  assert.deepEqual(dropRows(null), []);
});

test('#4272 ps7b: PostHog only when connected; a failed read is neutral, never red', () => {
  assert.equal(posthogLine({ status: 'loading' }), null);
  assert.equal(posthogLine({ status: 'error' }).kind, 'neutral');
  assert.equal(posthogLine(ok({ link: { linked: false } })).kind, 'connect');
  assert.equal(posthogLine(ok({ link: { linked: true, active: false } })).kind, 'connect', 'a disconnected link is not connected');
  assert.equal(posthogLine(ok({ link: { linked: true, active: true }, tracked: [] })).kind, 'neutral');
  const t = posthogLine(ok({ link: { linked: true, active: true }, tracked: [{ name: 'Visits', value: 120, unit: 'count' }] }));
  assert.deepEqual([t.kind, t.tracked.length], ['tracked', 1]);
});

async function mount(answers) {
  const calls = [];
  const orig = { daily: deckSlideAnalyticsApi.daily, ph: posthogApi.fromPosthog };
  deckSlideAnalyticsApi.daily = (...a) => { calls.push(a); return answers.daily(...a); };
  posthogApi.fromPosthog = answers.posthog ?? (async () => ({ link: { linked: false } }));
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(ShareBoard, { deckId: 41, projectId: 7, versions: [{ id: 40, version: 6 }, { id: 41, version: 7 }] }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, settle,
    text: () => text(container).replace(/\s+/g, ' '),
    async change(id, value) { await act(async () => { pr(by(id)).onChange({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); deckSlideAnalyticsApi.daily = orig.daily; posthogApi.fromPosthog = orig.ph; },
  };
}

test('#4272 the mounted board reads the daily read with the member\'s filters, and draws it', async () => {
  const m = await mount({ daily: async () => DAILY, posthog: async () => ({ link: { linked: false } }) });
  try {
    assert.deepEqual(m.calls[0], [41, { version: '', nda: 'all' }]);
    assert.ok(m.by('share-board-daily') && m.by('share-board-funnel-nda') && m.by('share-board-funnel-open') && m.by('share-board-dropoff'));
    assert.match(m.text(), /The NDA is set per link\. Each investor gets their own link\./);
    assert.match(m.text(), /Where readers drop off · v7 against v6/);
    assert.ok(m.by('share-board-posthog-connect'), 'not connected: one quiet line');
    await m.change('share-board-version', '6');
    await m.change('share-board-nda', 'yes');
    // Mutation checked: leave `nda` out of the read → the last call carries 'all' and this fails.
    assert.deepEqual(m.calls.at(-1), [41, { version: '6', nda: 'yes' }]);
  } finally { await m.unmount(); }
});

test('#4272 the mounted board\'s states: unreadable with Try again, no links, no views', async () => {
  let fail = true;
  const m = await mount({ daily: async () => { if (fail) throw new Error('x'); return DAILY; } });
  try {
    assert.match(m.text(), new RegExp(UNREADABLE));
    fail = false;
    const btn = (n) => n.tagName === 'BUTTON';
    await act(async () => { Object.entries([...[m.by('share-board-unreadable')].flatMap((n) => [n, ...(n.childNodes || [])])].find(btn) || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1].onClick(); });
    await m.settle();
    assert.ok(m.by('share-board-daily'), 'Try again reads again');
  } finally { await m.unmount(); }
  const none = { ...DAILY, days: [], funnels: { nda: { sent: 0 }, open: { sent: 0 } } };
  const n = await mount({ daily: async () => none });
  try { assert.ok(n.text().includes(NO_LINKS), 'no links'); } finally { await n.unmount(); }
  const quiet = { ...DAILY, days: DAILY.days.map((d) => ({ ...d, nda: 0, open: 0 })) };
  const q = await mount({ daily: async () => quiet });
  try { assert.ok(q.text().includes(NO_VIEWS), 'no views'); } finally { await q.unmount(); }
});
