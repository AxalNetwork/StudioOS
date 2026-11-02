/**
 * D1557 (#3804): the investor critic in the Check claims sheet (pd25), and
 * its client. Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_critic_d1557.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { askLabel, benchmarkLine, criticNote, findingGroups } from '../src/pages/raise/pitch/criticModel.js';
import { deckCriticApi } from '../src/lib/api/deckCritic.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('findings are grouped deal-breaker, will be asked, polish; empty groups are left out', () => {
  const groups = findingGroups([
    { key: 'a', severity: 'polish', message: 'p' },
    { key: 'b', severity: 'deal_breaker', message: 'd' },
    { key: 'c', severity: 'unknown', message: 'x' },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.map((r) => r.key)]), [['Deal-breaker', ['b']], ['Polish', ['a']]]);
  assert.deepEqual(findingGroups(null), []);
});

test('the benchmark line is the recorded norms, else the Worker\'s own reason', () => {
  assert.equal(benchmarkLine({ available: false, reason: 'No stage benchmark recorded' }), 'No stage benchmark recorded');
  assert.equal(benchmarkLine({ available: true, value: ['Growth: 12% (Survey, 40 companies)'] }), 'Benchmarks: Growth: 12% (Survey, 40 companies)');
  assert.equal(benchmarkLine(null), 'No stage benchmark recorded');
  assert.equal(benchmarkLine({ available: false, reason: 'The stage benchmarks could not be read.' }), 'The stage benchmarks could not be read.', 'an unreadable read is never shown as none');
});

test('the Ask shows the hold only when the quote is known, and a critic that did not run says why', () => {
  assert.equal(askLabel({ ai: true, hold_microusd: 4200 }), 'Read as an investor · holds $0.0042');
  assert.equal(askLabel({ ai: false }), 'Read as an investor');
  assert.equal(askLabel({ ai: true, hold_microusd: null }), 'Read as an investor', 'never a guessed price');
  assert.equal(criticNote({ state: 'ok' }), null);
  assert.equal(criticNote({ state: 'refused', message: 'No critic model of another family.' }), 'No critic model of another family.');
});

test('the client posts to the critic route; the sheet mounts the section and the rail option is registered', async () => {
  const previous = globalThis.fetch;
  const previousStore = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push([new URL(String(url), 'http://x').pathname.replace(/^\/api/, ''), init.method]); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); };
  try { await deckCriticApi.quote(7, {}); await deckCriticApi.run(7, {}); } finally { globalThis.fetch = previous; globalThis.localStorage = previousStore; }
  assert.deepEqual(calls, [['/decks/7/critic/quote', 'POST'], ['/decks/7/critic', 'POST']]);
  assert.match(src('pages/raise/pitch/CheckPanel.jsx'), /<CriticSection deck=\{deck\} readOnly=\{readOnly\} onGoToCard=\{onGoToCard\} \/>/);
  assert.match(src('pages/raise/pitch/CriticSection.jsx'), /if \(readOnly \|\| !deck\?\.id\) return null;/);
  assert.match(src('lib/railOptions/founder.js'), /key: 'deck:critic'[^\n]*kind: 'reason'/);
  assert.match(src('lib/api.js'), /export \* from '\.\/api\/deckCritic\.js';/);
});
