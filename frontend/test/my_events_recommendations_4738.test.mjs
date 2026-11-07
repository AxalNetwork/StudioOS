// #4738 (D1487, D1488, D3724): My events' "Recommended for you" reaches the
// recommendation routes. The adapter calls `eventRecommendationsApi`, answers
// `{ available, value }` or the Worker's refusal (never `e.message`), keeps the
// quote's `quote_uid` for Explain (D4450), and no screen says "pending owner".
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/my_events_recommendations_4738.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm } from './_form_d695.mjs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const adapter = await import('../src/pages/events/recommendationsAdapter.js');
const { default: RecommendedRow } = await import('../src/pages/events/RecommendedRow.jsx');
const model = await import('../src/pages/events/recommendationsModel.js');

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hdr = (init, k) => {
  const x = init?.headers;
  if (!x) return null;
  if (typeof x.get === 'function') return x.get(k);
  const hit = Object.keys(x).find((n) => n.toLowerCase() === k.toLowerCase());
  return hit ? x[hit] : null;
};

/** Runs `fn` with fetch answering from `reply(method, path, body)`; returns what was sent. */
async function withRoutes(reply, fn) {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*?\/api\//, '/api/');
    const call = { method: init.method || 'GET', path, body: init.body ? JSON.parse(init.body) : null, key: hdr(init, 'Idempotency-Key') };
    seen.push(call);
    const r = reply(call, seen);
    if (r instanceof Error) throw r;
    return r;
  };
  try { await fn(seen); } finally { globalThis.fetch = orig; }
  return seen;
}

test('each adapter export calls its route, and none answers the old "not switched on" stub', async () => {
  const seen = await withRoutes(() => json({ ok: true }), async () => {
    const results = [
      await adapter.recommended(8),
      await adapter.prefs(),
      await adapter.savePrefs({ enabled: true, interests: ['ai'], goals: ' Raise a seed ', formats: ['virtual'], home_city: '', travel_km: '' }),
      await adapter.feedback(7, { verdict: 'not_for_me', reason: 'timing' }),
      await adapter.explainQuote(7),
      await adapter.explain(7, 'q-1'),
    ];
    for (const r of results) { assert.equal(r.available, true); assert.deepEqual(r.value, { ok: true }); }
  });
  assert.deepEqual(seen.map((c) => [c.method, c.path]), [
    ['GET', '/api/events/recommended?limit=8'],
    ['GET', '/api/events/recommendation-prefs'],
    ['PUT', '/api/events/recommendation-prefs'],
    ['POST', '/api/events/7/recommendation-feedback'],
    ['POST', '/api/events/7/recommendation/explain/quote'],
    ['POST', '/api/events/7/recommendation/explain'],
  ]);
  assert.equal('RECS_OFF_REASON' in adapter, false, 'the stub reason is gone');
  assert.doesNotMatch(read('frontend/src/pages/events/recommendationsAdapter.js'), /switched on yet.*recommend|Recommendations aren’t switched on/i);
});

test('recommended sends ?limit=8 whether it is given 8 or { limit: 8 }, never [object Object]', async () => {
  const seen = await withRoutes(() => json({ events: [] }), async () => {
    await adapter.recommended(8);
    await adapter.recommended({ limit: 8 });
    await adapter.recommended();
    await adapter.recommended({ limit: 'many' });
  });
  assert.deepEqual(seen.map((c) => c.path), Array(4).fill('/api/events/recommended?limit=8'));
  assert.ok(!seen.some((c) => /object/i.test(c.path)));
  const page = read('frontend/src/pages/events/MyEventsPage.jsx');
  assert.match(page, /recommendations\.recommended\(8\)/);
  assert.match(page, /explain: \(id, quoteUid\) => recommendations\.explain\(id, quoteUid\)/, 'the page passes the quote on to Explain');
  assert.match(page, /prefs: \(\) => recommendations\.prefs\(\)/, 'Tune can read the saved preferences');
});

test('feedback sends { verdict, reason }; Undo sends a null verdict', async () => {
  const seen = await withRoutes(() => json({ verdict: null }), async () => {
    await adapter.feedback(7, { verdict: 'not_for_me', reason: 'timing' });
    await adapter.feedback(7, { verdict: 'saved' });
    await adapter.feedback(7, { verdict: null });
  });
  assert.deepEqual(seen.map((c) => c.body), [{ verdict: 'not_for_me', reason: 'timing' }, { verdict: 'saved' }, { verdict: null }]);
});

test('explain sends the quote_uid the quote returned, in the body and as the Idempotency-Key', async () => {
  const seen = await withRoutes((c) => (c.path.endsWith('/quote') ? json({ microusd: 40000, quote_uid: 'uid-abc' }) : json({ text: 'It matches your round.' })), async () => {
    const q = await adapter.explainQuote(7);
    assert.equal(q.value.quote_uid, 'uid-abc');
    const r = await adapter.explain(7, q.value.quote_uid);
    assert.equal(r.value.text, 'It matches your round.');
  });
  assert.equal(seen[1].body.quote_uid, 'uid-abc');
  assert.equal(seen[1].key, 'uid-abc');
  // No quote, no run: nothing is sent and nothing is charged.
  const none = await withRoutes(() => json({}), async () => {
    const r = await adapter.explain(7);
    assert.equal(r.available, false);
    assert.equal(r.stale, true);
  });
  assert.deepEqual(none, []);
});

test('a refusal is the Worker\'s sentence or a plain one, never e.message; a read that did not answer is unreadable', async () => {
  await withRoutes((c) => {
    if (c.path.includes('limit')) return json({ error: 'unreadable', detail: 'Recommendations could not be read. That is not the same as having none.' }, 503);
    if (c.method === 'PUT') return json({ error: 'bad_field', field: 'goals_90d' }, 400);
    if (c.path.endsWith('/explain')) return json({ error: 'insufficient_tokens', message: 'You need more AI tokens for that.' }, 402);
    return new Error('socket hang up: secret-host.internal');
  }, async () => {
    const list = await adapter.recommended(8);
    assert.equal(list.available, false);
    assert.equal(list.unreadable, true);
    assert.match(list.reason, /not the same as having none/);
    const put = await adapter.savePrefs({ goals: 'x' });
    assert.equal(put.reason, 'Goals can be at most 500 characters.');
    assert.equal(put.field, 'goals_90d');
    assert.equal(put.unreadable, false, 'a 400 is a refusal, not an unreadable read');
    const paid = await adapter.explain(7, 'q');
    assert.equal(paid.reason, 'You need more AI tokens for that.');
    const down = await adapter.prefs();
    assert.equal(down.available, false);
    assert.equal(down.reason, adapter.PLAIN_REFUSAL);
    assert.doesNotMatch(JSON.stringify(down), /socket|secret-host/);
    assert.equal(down.unreadable, true, 'a network failure is not an empty answer');
  });
});

test('Why this?: an expired quote (409 quote_stale) shows a new price and asks again, never a raw error and never a blind retry', async () => {
  let quotes = 0;
  const runs = [];
  const seen = await withRoutes((c) => {
    if (c.path.endsWith('/quote')) { quotes++; return json({ microusd: quotes === 1 ? 40000 : 50000, quote_uid: `q-${quotes}` }); }
    runs.push(c.body.quote_uid);
    return c.body.quote_uid === 'q-1'
      ? json({ error: 'quote_stale', message: 'This price has expired. Get a new quote.' }, 409)
      : json({ text: 'It matches your round.' });
  }, async () => {
    const ev = [{ id: 7, title: 'Pricing Workshop', starts_at: '2026-12-02T18:00:00Z', registration_eligible: true, reasons: [{ code: 'x', text: 'You have a Seed round open.' }] }];
    const ready = { status: 'ready', data: { available: true, value: { enabled: true, signals: {}, events: ev } } };
    const ui = await mountForm(h(RecommendedRow, { read: ready, act: adapter }), { modal: true });
    try {
      await ui.click('Why this?');
      await ui.click('See the cost');
      assert.match(ui.text(), /Costs \$0\.04/);
      await ui.click('Ask Eadwyn');
      assert.match(ui.text(), /Costs \$0\.05/, 'the new price is shown');
      assert.match(ui.text(), /That price had expired/);
      assert.doesNotMatch(ui.text(), /quote_stale|Get a new quote/);
      assert.deepEqual(runs, ['q-1'], 'the expired quote was not retried');
      await ui.click('Ask Eadwyn');
      assert.match(ui.text(), /It matches your round\./);
      assert.deepEqual(runs, ['q-1', 'q-2'], 'the run used the new quote');
    } finally { await ui.unmount(); }
  });
  assert.equal(seen.filter((c) => c.path.endsWith('/quote')).length, 2);
});

test('Tune reads the saved preferences before anything can be saved over them, and saves the Worker\'s shape', async () => {
  const seen = await withRoutes((c) => (c.method === 'GET'
    ? json({ prefs: { enabled: true, interests: ['ai'], goals_90d: 'Raise a seed', formats: ['hybrid'], types: [], home_city: null, travel_km: null }, saved: [] })
    : json({ prefs: {} })), async () => {
    const ev = [{ id: 7, title: 'Pricing Workshop', reasons: [] }];
    const ready = { status: 'ready', data: { available: true, value: { enabled: true, signals: {}, events: ev } } };
    const ui = await mountForm(h(RecommendedRow, { read: ready, act: adapter }), { modal: true });
    try {
      await ui.click('Tune recommendations');
      await new Promise((r) => setTimeout(r, 0));
      assert.match(ui.text(), /488 characters left/, 'the saved goals were loaded into the form');
      await ui.click('Fundraising');
      await ui.click('Save preferences');
    } finally { await ui.unmount(); }
  });
  const put = seen.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, { enabled: true, interests: ['ai', 'fundraising'], goals_90d: 'Raise a seed', formats: ['hybrid'], home_city: null, travel_km: null });
  assert.equal('goals' in put.body, false, 'the Worker has no `goals` field');

  const failed = await withRoutes(() => json({ error: 'unreadable', detail: 'Preferences could not be read.' }, 503), async () => {
    const ev = [{ id: 7, title: 'Pricing Workshop', reasons: [] }];
    const ready = { status: 'ready', data: { available: true, value: { enabled: true, signals: {}, events: ev } } };
    const ui = await mountForm(h(RecommendedRow, { read: ready, act: adapter }), { modal: true });
    try {
      await ui.click('Tune recommendations');
      await new Promise((r) => setTimeout(r, 0));
      assert.match(ui.text(), /Preferences could not be read\./);
      const save = ui.nodes().find((n) => ui.props(n)['data-testid'] === 'my-events-tune-save');
      assert.equal(ui.props(save).disabled, true, 'Save is off while the saved preferences are unread');
    } finally { await ui.unmount(); }
  });
  assert.equal(failed.filter((c) => c.method === 'PUT').length, 0, 'nothing is saved over preferences that could not be read');
});

test('the form and the Worker\'s prefs convert both ways; a blank is null, never 0', () => {
  assert.deepEqual(model.formToPrefs({ enabled: false, interests: ['ai'], goals: '  ', formats: [], home_city: ' Oslo ', travel_km: '' }),
    { enabled: false, interests: ['ai'], goals_90d: null, formats: [], home_city: 'Oslo', travel_km: null });
  assert.equal(model.formToPrefs({ travel_km: '0' }).travel_km, 0, 'a recorded zero is a zero');
  assert.deepEqual(model.prefsToForm({ enabled: true, interests: ['ai'], goals_90d: null, formats: ['virtual'], home_city: null, travel_km: null }),
    { enabled: true, interests: ['ai'], goals: '', formats: ['virtual'], home_city: '', travel_km: '' });
  assert.equal(model.prefsToForm({ travel_km: 0 }).travel_km, '0');
});

test('the topics and formats on screen are the Worker\'s own', () => {
  const topics = read('cloudflare-worker/src/services/eventTopics.ts').match(/EVENT_TOPICS = \[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1));
  assert.deepEqual(model.TOPICS.map((t) => t.key), topics);
  const formats = read('cloudflare-worker/src/services/eventRecommendations.ts').match(/REC_FORMATS = \[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1));
  assert.deepEqual(model.FORMATS.map((f) => f.key), formats);
});

test('no screen or model says an owner question is pending, and D3724 points to D1487', () => {
  for (const f of ['RecommendedRow.jsx', 'recommendationsModel.js', 'MyEventsPage.jsx']) {
    assert.doesNotMatch(read('frontend/src/pages/events/' + f), /Pending owner|question \d on #3724|PENDING_OWNER/, f);
  }
  assert.match(read('documentation/architecture/decisions/D3724.md'), /decided, D1487/);
  assert.doesNotMatch(read('documentation/architecture/route-map/canvases/part-5/0350-my-events.md'), /screens await approval/);
});
