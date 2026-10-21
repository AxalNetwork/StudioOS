/**
 * D778 part 12 (#2103) — the Studio interview's Send and Explain name the
 * mounted profile's own option: `ask:studio` and `explain:question` for the
 * founder, `answer:interview` and `explain:question` for the advisor and the
 * partner. The rail lights that option while the press runs, and the press
 * sends it with the run, keeping the mounted rail's page.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/studio_presses_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api } from '../src/lib/api.js';
import { railOptionFor } from '../src/lib/railOptions/index.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import { codeOnly } from './_codeOnly.mjs';
import { installDocument } from './_contracts_dom.mjs';

const FILE = 'components/advisor/PersonalAdvisor.jsx';
const enc = encodeURIComponent;

test('each profile\'s Studio page resolves Send and Explain to its own inventory\'s keys', () => {
  // Mutations checked: controlOf without the Studio markers (every lookup null); Explain read as Send.
  const look = (role) => {
    const page = pageKeyFor('/studio', role);
    return [railOptionFor(page, { file: FILE, control: 'send' })?.key ?? null, railOptionFor(page, { file: FILE, control: 'explain' })?.key ?? null];
  };
  assert.deepEqual(look('founder'), ['ask:studio', 'explain:question']);
  assert.deepEqual(look('advisor'), ['answer:interview', 'explain:question']);
  assert.deepEqual(look('partner'), ['answer:interview', 'explain:question']);
  // The investor's Studio has no interview presses: the founder's keys are the component's fallback.
  assert.deepEqual(look('investor'), [null, null]);
});

test('the presses light and send the looked-up option, with the founder\'s keys as the fallback', () => {
  // Mutations checked: Send without headers; Explain's stream without them; the rail lit on a fixed key.
  const src = codeOnly(readFileSync('frontend/src/components/advisor/PersonalAdvisor.jsx', 'utf8'));
  assert.match(src, /const STUDIO_FILE = 'components\/advisor\/PersonalAdvisor\.jsx';/);
  assert.match(src, /const railPage = useRailPage\(\)\?\.page \?\? null;/);
  assert.match(src, /const sendOption = railOptionFor\(railPage, \{ file: STUDIO_FILE, control: 'send' \}\);/);
  assert.match(src, /const explainOption = railOptionFor\(railPage, \{ file: STUDIO_FILE, control: 'explain' \}\);/);
  assert.match(src, /const sendKey = sendOption\?\.key \?\? 'ask:studio';/);
  assert.match(src, /const explainKey = explainOption\?\.key \?\? 'explain:question';/);
  assert.match(src, /useRailOption\(asking \? sendKey : null, sendOption\?\.label \?\? 'Send'\);/);
  assert.match(src, /useRailOption\(tutor \? explainKey : null, explainOption\?\.label \?\? 'Explain'\);/);
  assert.match(src, /const r = await api\.advisor\.toolAuto\(raw, railPressHeaders\(sendKey\)\);/);
  assert.match(src, /fetch\(api\.advisor\.explainUrl\(\), \{[\s\S]*?headers: \{ 'Content-Type': 'application\/json', Accept: 'text\/event-stream', \.\.\.authHeaders\(\), \.\.\.railPressHeaders\(explainKey\) \}/);
  // The callbacks re-read the key when the mounted page changes.
  assert.match(src, /\}, \[conversationId, question, explainKey\]\);/);
  assert.match(src, /setAsking\(false\);\s*\}\s*\}, \[sendKey\]\);/);
});

test('the Send method sends the press\'s headers on the request itself', async () => {
  // Mutation checked: `headers` dropped from api.advisor.toolAuto.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.advisor.toolAuto('find my cap table', { 'X-Rail-Option': enc('answer:interview') });
    const h = seen[0].init.headers;
    assert.equal(h instanceof Headers ? h.get('X-Rail-Option') : h['X-Rail-Option'], enc('answer:interview'));
    assert.match(seen[0].url, /\/advisor\/tool\/auto$/);
    assert.deepEqual(JSON.parse(seen[0].init.body), { message: 'find my cap table' });
    // With no headers it is the request it always was.
    await api.advisor.toolAuto('again');
    const plain = seen[1].init.headers;
    assert.equal(plain instanceof Headers ? plain.get('X-Rail-Option') : plain?.['X-Rail-Option'], plain instanceof Headers ? null : undefined);
  } finally { globalThis.fetch = realFetch; restore(); }
});
