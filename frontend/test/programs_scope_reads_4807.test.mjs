/**
 * D4807 (#4807) — a read's answer belongs to the request that asked for it.
 *
 * `useCatalogueReads` mounted for real, its Worker stubbed so each studio's
 * catalogue answers when the test says. Every render is recorded; the
 * invariant is read from the record, not from the final screen:
 *
 *   - no render ever pairs a studio with another studio's figures (the first
 *     render after the switch used to hold the previous answer, `ready`,
 *     until the effect reset it);
 *   - the last answer is carried only while the same studio's next read is
 *     loading, and says it is stale;
 *   - a read that failed shows its failure, not the figures from before it;
 *   - an answer that lands after the user moved on changes nothing.
 *
 * Walks HQ → studio A → studio B → HQ on the slow, success and failure paths.
 * Every name is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_scope_reads_4807.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { useCatalogueReads } from '../src/pages/admin/programs/useProgramReads.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const body = (tag) => ({ tiles: { tag }, programs: [] });

async function walk(steps) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const pending = new Map(); // scope -> [{ resolve }]
  globalThis.fetch = (u) => {
    const [path, qs] = String(u).split('?');
    if (path !== '/api/admin/programs') return new Promise(() => {});
    const scope = new URLSearchParams(qs || '').get('scope') || '';
    return new Promise((resolve) => { pending.set(scope, [...(pending.get(scope) || []), resolve]); });
  };
  const renders = [];
  function Probe({ code, weeks = 12 }) {
    const r = useCatalogueReads(false, { weeks, scopeOf: () => ({ code, canRead: true }) });
    renders.push({
      asked: code || '',
      read: r.catalogue.status, readTag: r.catalogue.data?.tiles?.tag ?? null,
      cards: r.cards.status, cardsTag: r.cards.data?.tiles?.tag ?? null, stale: Boolean(r.cards.stale),
    });
    return null;
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const show = (code, weeks) => act(async () => root.render(h(Probe, { code, weeks })));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const answer = async (scope, tag, status = 200) => {
    const resolve = (pending.get(scope) || []).shift();
    assert.ok(resolve, `no read waiting for "${scope}"`);
    resolve(response(status < 400 ? body(tag) : { error: 'down' }, status));
    await flush();
  };
  try { await steps({ show, answer, flush, renders }); } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous; restore();
  }
  return renders;
}

/** Every recorded render, checked against the studio it asked for. */
function holds(renders) {
  renders.forEach((r, i) => {
    const want = r.asked || 'hq';
    if (r.read === 'ready') assert.equal(r.readTag, want, `render ${i}: a read for "${want}" holds "${r.readTag}"'s figures`);
    if (r.cards === 'ready') assert.equal(r.cardsTag, want, `render ${i}: cards for "${want}" show "${r.cardsTag}"'s figures`);
  });
}

test('HQ → A → B → HQ, answers in order: no render shows another studio\'s figures', async () => {
  const renders = await walk(async ({ show, answer }) => {
    await show(''); await answer('', 'hq');
    await show('a'); await answer('a', 'a');
    await show('b'); await answer('b', 'b');
    await show(''); await answer('', 'hq');
  });
  holds(renders);
  assert.deepEqual(renders.at(-1), { asked: '', read: 'ready', readTag: 'hq', cards: 'ready', cardsTag: 'hq', stale: false });
});

test('slow: A\'s answer lands after B was asked for, and changes nothing', async () => {
  const renders = await walk(async ({ show, answer }) => {
    await show(''); await answer('', 'hq');
    await show('a');
    await show('b');
    await answer('a', 'a'); // late
    await answer('b', 'b');
    await show(''); await answer('', 'hq');
  });
  holds(renders);
  const b = renders.filter((r) => r.asked === 'b' && r.read === 'ready');
  assert.ok(b.length > 0 && b.every((r) => r.readTag === 'b'));
  assert.equal(renders.at(-1).readTag, 'hq');
});

test('the first render after a switch is loading, never the previous studio\'s answer', async () => {
  const renders = await walk(async ({ show, answer }) => {
    await show('a'); await answer('a', 'a');
    await show('b');
  });
  const first = renders.find((r) => r.asked === 'b');
  assert.equal(first.read, 'loading');
  assert.equal(first.readTag, null);
  assert.equal(first.cards, 'loading', 'a different studio\'s cards are not carried');
});

test('the same studio on a new period carries its last answer, marked stale, until the new one lands', async () => {
  const renders = await walk(async ({ show, answer }) => {
    await show('a', 12); await answer('a', 'a');
    await show('a', 52);
    await answer('a', 'a');
  });
  holds(renders);
  const loading = renders.filter((r) => r.read === 'loading' && r.cards === 'ready');
  assert.ok(loading.length > 0, 'the old cards stay while the new period reads');
  assert.ok(loading.every((r) => r.stale && r.cardsTag === 'a'), 'and say they are stale');
  assert.equal(renders.at(-1).stale, false, 'the new answer is not stale');
});

test('failure: a failed read for B shows its failure, not A\'s or HQ\'s figures', async () => {
  const renders = await walk(async ({ show, answer }) => {
    await show(''); await answer('', 'hq');
    await show('a'); await answer('a', 'a');
    await show('b'); await answer('b', null, 503);
    await show(''); await answer('', 'hq');
  });
  holds(renders);
  const failed = renders.filter((r) => r.asked === 'b' && r.read === 'error');
  assert.ok(failed.length > 0, 'B\'s failure is drawn');
  assert.ok(failed.every((r) => r.cards === 'error' && r.cardsTag === null), 'no figures sit under a failed read');
});
