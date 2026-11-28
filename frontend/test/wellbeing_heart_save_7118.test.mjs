/**
 * D7118 part 4 (#7118), the acceptance's last line: "Exercise a saved daily reflection from the heart and verify
 * that history shows only the intended period." One in-memory store stands behind every read and write, so what
 * the heart saves is what Today, This week and This month then read; each history read names its cadence and the
 * store answers only that cadence, as the Worker does (`GET /?cadence=`, wellbeing_reflections.ts).
 * Also: the earlier check-ins say how each is held (`held`), so "Stored encrypted" is not put over one that is not.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_heart_save_7118.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import * as M from '../src/pages/wellbeing/reflectionsModel.js';
import { ReflectionView } from '../src/pages/wellbeing/Reflections.jsx';
import FounderWellbeingMenu, { loadReflectionEditor } from '../src/components/FounderWellbeingMenu.jsx';

const h = React.createElement;
const PERIODS = {
  day: { period_start: '2026-11-17', period_end: '2026-11-17' },
  week: { period_start: '2026-11-16', period_end: '2026-11-22' },
  month: { period_start: '2026-11-01', period_end: '2026-11-30' },
};
const END = { day: (s) => s, week: () => '2026-11-22', month: () => '2026-11-30' };

/** A member's reflections, held the way the Worker holds them: one row per cadence and period. */
function server(seed = []) {
  const rows = new Map(seed.map((r) => [`${r.cadence}/${r.period_start}`, r]));
  const writes = [];
  const reads = [];
  const today = () => ({
    today: '2026-11-17', timezone: 'UTC',
    ...Object.fromEntries(['day', 'week', 'month'].map((c) => [c, { ...PERIODS[c], reflection: rows.get(`${c}/${PERIODS[c].period_start}`) || null }])),
  });
  const answer = (method, url, body) => {
    const u = new URL(url, 'http://local');
    const path = u.pathname.replace(/^.*\/api/, '');
    if (method !== 'GET') writes.push(`${method} ${path}`); else reads.push(`${path}${u.search}`);
    if (method === 'GET' && path === '/wellbeing/reflections/today') return today();
    if (method === 'GET' && path === '/wellbeing/reflections') {
      const cadence = u.searchParams.get('cadence');
      const list = [...rows.values()].filter((r) => r.cadence === cadence).sort((a, b) => b.period_start.localeCompare(a.period_start));
      return { cadence, reflections: list, retention: 'until_member_deletes' };
    }
    if (method === 'GET' && path === '/wellbeing/reflections/earlier') return { earlier: [] };
    if (method === 'GET' && /^\/wellbeing\/reflections\/months\/[\d-]+\/summary$/.test(path)) {
      const days = [...rows.values()].filter((r) => r.cadence === 'day');
      return { month: '2026-11', days_in_month: 30, days_recorded: days.length, days, weeks: [...rows.values()].filter((r) => r.cadence === 'week'), month_reflection: null, topics: [] };
    }
    const put = method === 'PUT' && path.match(/^\/wellbeing\/reflections\/(day|week|month)\/(\d{4}-\d{2}-\d{2})$/);
    if (put) {
      const [, cadence, start] = put;
      const prev = rows.get(`${cadence}/${start}`);
      const row = { uid: `${cadence}-${start}`, cadence, period_start: start, period_end: END[cadence](start), timezone: body.timezone, scores: body.scores || {}, text: body.text ?? null, topics: body.topics || [], readable: true, revision: (prev?.revision || 0) + 1, created_at: '2026-11-17 12:00:00', updated_at: '2026-11-17 12:00:00' };
      rows.set(`${cadence}/${start}`, row);
      return { ...row, created: !prev, stored_encrypted: true };
    }
    return { __status: 404 };
  };
  return { rows, writes, reads, today, answer };
}

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
async function mount(tree, srv) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, opts = {}) => {
    const out = srv.answer(opts.method || 'GET', String(u), opts.body ? JSON.parse(opts.body) : null);
    return out && out.__status ? response({ error: 'not_found', message: 'refused' }, out.__status) : response(out);
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'founder', name: 'Synthetic' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, tree)));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(document.body);
  const by = (id) => all().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    has: (id) => !!by(id), props: (id) => pr(by(id)), text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    ids: (prefix) => all().map((n) => pr(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    submit: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await flush(); },
    radio: async (group, v) => {
      const g = by(group); assert.ok(g, `no ${group}`);
      const b = walk(g).find((x) => pr(x).role === 'radio' && String(x.textContent).trim() === String(v));
      await act(async () => { pr(b).onClick({}); });
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

const WEEK = { uid: 'w1', cadence: 'week', period_start: '2026-11-16', period_end: '2026-11-22', timezone: 'UTC', scores: { stress: 3 }, text: 'The week so far', topics: [], readable: true, revision: 1, created_at: '2026-11-16 21:40:00', updated_at: '2026-11-16 21:40:00' };
const OLD_DAY = { uid: 'd0', cadence: 'day', period_start: '2026-11-16', period_end: '2026-11-16', timezone: 'UTC', scores: { energy: 2 }, text: 'Monday', topics: [], readable: true, revision: 1, created_at: '2026-11-16 20:00:00', updated_at: '2026-11-16 20:00:00' };
const view = (cadence, srv) => h(ReflectionView, { cadence, read: { state: 'ok', value: srv.today() }, timezone: 'UTC', onRetry() {}, onChanged() {} });

test('a daily reflection saved from the heart writes today only, and each history shows only its own period', async () => {
  await loadReflectionEditor();
  const srv = server([WEEK, OLD_DAY]);

  // The heart: Today opens directly, and Save today writes today's day record and nothing else.
  const heart = await mount(h(FounderWellbeingMenu), srv);
  try {
    await heart.click('wellness-heart');
    assert.match(heart.text('wellness-popover-state'), /Not yet today/);
    await heart.radio('score-day-energy', 4);
    await heart.change('reflection-text-day', 'Saved from the heart.');
    await heart.submit('reflection-editor-day');
    assert.deepEqual(srv.writes, ['PUT /wellbeing/reflections/day/2026-11-17'], 'the heart wrote something other than today');
    assert.equal(srv.rows.get('week/2026-11-16'), WEEK, 'the week was touched');
    assert.equal(srv.rows.get('day/2026-11-16'), OLD_DAY, 'yesterday was touched');
    assert.equal(heart.props('wellness-popover-edit').href, '/wellbeing?period=today', 'after the save the heart offers Edit, a real confirmation');
  } finally { await heart.close(); }

  // Today's history: the two days, today first, and no week or month.
  const day = await mount(view('day', srv), srv);
  try {
    assert.ok(srv.reads.some((r) => r.startsWith('/wellbeing/reflections?cadence=day&')), srv.reads.join(', '));
    assert.deepEqual(day.ids('reflection-history-row-'), ['reflection-history-row-2026-11-17', 'reflection-history-row-2026-11-16']);
  } finally { await day.close(); }

  // This week's history: the week only; neither day is listed as a week.
  const week = await mount(view('week', srv), srv);
  try {
    assert.deepEqual(week.ids('reflection-history-row-'), ['reflection-history-row-2026-11-16']);
    assert.match(week.text('reflection-history-row-2026-11-16'), /16/);
  } finally { await week.close(); }

  // This month: no monthly reflection, so no history row; the saved day is counted as a day.
  const month = await mount(view('month', srv), srv);
  try {
    assert.deepEqual(month.ids('reflection-history-row-'), []);
    assert.match(month.text('reflection-month-days'), /^2 days you chose to write/);
  } finally { await month.close(); }
});

test('earlier check-ins: one held without encryption or partly unreadable says so; an encrypted one adds nothing', () => {
  assert.match(M.earlierHeldLine('not_encrypted'), /^Stored without encryption/);
  assert.match(M.earlierHeldLine('partly_unreadable'), /can’t be read/);
  assert.equal(M.earlierHeldLine('encrypted'), null);
  assert.equal(M.earlierHeldLine(undefined), null, 'an older Worker that sends no `held` is not guessed at');
});

test('earlier check-ins render the held line on the row it belongs to', async () => {
  const srv = server([WEEK]);
  const base = srv.answer;
  srv.answer = (method, url, body) => (new URL(url, 'http://l').pathname.endsWith('/reflections/earlier')
    ? { earlier: [
      { kind: 'earlier_checkin', uid: 'p1', day: '2026-09-14', week_start: '2026-09-14', label: 'Earlier check-in', held: 'not_encrypted' },
      { kind: 'earlier_checkin', uid: 'e1', day: '2026-09-07', week_start: '2026-09-07', label: 'Earlier check-in', held: 'encrypted' },
    ] }
    : base(method, url, body));
  const v = await mount(view('week', srv), srv);
  try {
    assert.match(v.text('reflection-earlier-held-p1'), /Stored without encryption/);
    assert.equal(v.has('reflection-earlier-held-e1'), false);
  } finally { await v.close(); }
});
