/**
 * D778 part 10 (#2103) — Research's two Ask presses name their option on the
 * run: `ask:research` (the founder's Research desk) and `ask:library` (Ask,
 * under each profile's own key). Each keeps the mounted rail's page.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_research_ask_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import AskZone from '../src/pages/research/AskZone.jsx';
import { api } from '../src/lib/api.js';
import { clearRailPage, railPageHeaders, setRailPage } from '../src/lib/railPage.js';
import { railOptionFor } from '../src/lib/railOptions/index.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { codeOnly } from './_codeOnly.mjs';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const enc = encodeURIComponent;
const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

async function mountAsk(profile) {
  const original = { research: api.research, aiPricing: api.aiPricing };
  const asked = [];
  api.aiPricing = async () => null;
  api.research = {
    ...original.research,
    documents: async () => ({ indexed: 1, items: [{ uid: 'd-1', title: 'Interview', index_state: 'indexed' }] }),
    askSessions: async () => ({ session: { uid: 's-1' }, items: [] }),
    ask: async (...args) => { asked.push(args); return { session_uid: 's-1' }; },
  };
  const token = setRailPage(`${profile} · Research · Ask`);
  const m = await mountContracts(React.createElement(RailPageProvider, { role: profile }, React.createElement(AskZone)), '/research/ask');
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  await settle();
  return {
    ...m, asked, settle,
    async ask(question) {
      const area = m.nodes().find((n) => n.tagName === 'TEXTAREA');
      await act(async () => { m.props(area).onChange({ target: { value: question } }); });
      const form = m.nodes().find((n) => n.tagName === 'FORM');
      await act(async () => { await m.props(form).onSubmit({ preventDefault() {} }); });
      await settle();
    },
    async close() { clearRailPage(token); await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; },
  };
}

test('Ask sends its profile\'s own option with the run, keeping the mounted rail\'s page', async () => {
  // Mutations checked: Ask without headers; Ask sending the founder's key on another profile's page.
  for (const profile of ['Founder', 'Advisor', 'Operating Partner']) {
    const m = await mountAsk(profile);
    try {
      const expected = railOptionFor(`${profile} · Research · Ask`, { file: 'pages/research/AskZone.jsx', control: 'ask' })?.key ?? 'ask:library';
      const page = railPageHeaders()['X-Rail-Page'];
      await m.ask('What need recurs?');
      assert.equal(m.asked.length, 1, profile);
      const [question, session, headers] = m.asked[0];
      assert.deepEqual([question, session], ['What need recurs?', 's-1']);
      assert.equal(headers['X-Rail-Option'], enc(expected), profile);
      assert.equal(headers['X-Rail-Page'], page, `${profile}: the mounted page holds the Manual switch`);
    } finally { await m.close(); }
  }
});

test('the founder\'s Research desk sends `ask:research` with its question', () => {
  // Mutation checked: the desk without headers.
  const desk = codeOnly(readFileSync('frontend/src/pages/founder/FounderResearchDesk.jsx', 'utf8'));
  assert.match(desk, /api\.research\.ask\(q, undefined, railPressHeaders\('ask:research'\)\)/);
  assert.match(desk, /import \{ railPressHeaders \} from '\.\.\/\.\.\/lib\/railPage\.js';/);
});

test('the Ask method sends the press\'s headers on the request itself', async () => {
  // Mutation checked: `headers` dropped from api.research.ask.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.research.ask('q', 's-1', { 'X-Rail-Option': enc('ask:research') });
    const h = seen[0].init.headers;
    assert.equal(h instanceof Headers ? h.get('X-Rail-Option') : h['X-Rail-Option'], enc('ask:research'));
    assert.deepEqual(JSON.parse(seen[0].init.body), { question: 'q', session_uid: 's-1' });
  } finally { globalThis.fetch = realFetch; restore(); }
});
