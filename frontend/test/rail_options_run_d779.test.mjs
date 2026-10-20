/**
 * D779 (#2104), part 1 — the investor's options fill, draft and place through
 * the run path, and nothing is written without the member's Accept or Save.
 *
 * The part is every row of `lib/railOptions/investor.js` (D772, #2098): 15
 * options, at most 30 per part. Each handler has its own rule (D720 §9):
 *
 *   draft   The band drafts on the member's press, from a stubbed run, and the
 *           draft is all that is written. Accept is the only further write, and
 *           it waits while the run is checked (D770).
 *   form    The answer fills the open panel. It is stored unsaved, and only the
 *           member's Save marks it saved.
 *   upload  The member's own document is added and indexed. That is saving, so
 *           nothing is placed: the upload writes the library's own row and
 *           queues its embedding, and no other record.
 *
 * Runs are stubbed at `api.research`; nothing reaches the Worker. The Worker's
 * half (what each route writes) is read from its source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_options_run_d779.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { INVESTOR_RAIL_OPTIONS } from '../src/lib/railOptions/investor.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { api } from '../src/lib/api.js';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';
import { CHECKING } from '../src/workspaces/draftCheck.js';

const h = React.createElement;
const read = (f) => readFileSync(f, 'utf8');
const spa = (f) => codeOnly(read(`frontend/src/${f}`));
const worker = codeOnly(read('cloudflare-worker/src/routes/research.ts'));

/** One Worker handler's body, from its registration to the next one. */
function handler(method, path) {
  const at = worker.indexOf(`research.${method}('${path}'`);
  assert.ok(at >= 0, `research.${method}('${path}') is gone`);
  const next = worker.slice(at + 1).search(/\nresearch\.(get|post|patch|put|delete)\(/);
  return worker.slice(at, next < 0 ? undefined : at + 1 + next);
}

/** Every table a handler writes. */
const writes = (body) => [...body.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)].map((m) => m[1]);

// The part's rows, by key, so a row added to the inventory is a decision for a later part.
const PART_1 = [
  'Investor · Deals · Pipeline|draft:stale-deal-notes',
  'Investor · Deals · Screening|draft:screening-memo',
  'Investor · Deals · Commit|draft:ic-memo',
  'Investor · Deals · Closing|draft:closing-cover-note',
  'Investor · Portfolio · Positions|draft:multiple-narrative',
  'Investor · Portfolio · Updates|draft:updates-read',
  'Investor · Portfolio · Value-add|draft:support-summary',
  'Investor · Fund · Capital calls|draft:lp-reminder',
  'Investor · Research|ask:evidence',
  'Investor · Research · Ask|ask:question',
  'Investor · Research · Ask|draft:session-brief',
  'Investor · Research · Diligence|draft:thin-evidence',
  'Investor · Research · Library|upload:document',
  'Investor · Research · Library|reindex:document',
  'Investor · Research · Library|draft:index-gaps',
];

test('part 1 is every investor option, at most 30, each with a handler this file checks', () => {
  assert.ok(PART_1.length <= 30);
  assert.deepEqual(INVESTOR_RAIL_OPTIONS.map((o) => `${o.page}|${o.key}`), PART_1);
  for (const o of INVESTOR_RAIL_OPTIONS) {
    assert.ok(['draft', 'form', 'upload'].includes(o.handler), `${o.key}: no rule for handler ${o.handler}`);
  }
});

// ------------------------------------------------------------------ drafts

const DRAFTS = INVESTOR_RAIL_OPTIONS.filter((o) => o.handler === 'draft').map((o) => ({
  ...o, surface: /^surface="([^"]+)"$/.exec(o.source.match)?.[1],
}));

test('each draft option is a zone draft band whose Accept writes no other record', () => {
  assert.equal(DRAFTS.length, 11);
  const accept = handler('patch', '/drafts/:uid');
  // Accept stamps the draft. A surface may name an `accept` hook that writes a
  // record first; none of the investor's does.
  assert.deepEqual([...new Set(writes(accept))], ['research_zone_drafts']);
  const surfaces = worker.slice(worker.indexOf('const DRAFT_SURFACES'), worker.indexOf('\n};', worker.indexOf('const DRAFT_SURFACES')));
  for (const o of DRAFTS) {
    assert.ok(o.surface, `${o.key}: its source is not a band`);
    const at = surfaces.indexOf(`'${o.surface}': {`);
    assert.ok(at >= 0, `${o.key}: the Worker drafts no surface ${o.surface}`);
    const entry = surfaces.slice(at, surfaces.indexOf("\n  '", at + 1));
    assert.doesNotMatch(entry, /\n\s+accept:/, `${o.key}: ${o.surface}'s Accept writes a record`);
  }
  // The run itself writes the draft and nothing else.
  assert.deepEqual([...new Set(writes(handler('post', '/drafts')))], ['research_zone_drafts']);
});

for (const o of DRAFTS) {
  test(`${o.key} (${o.page}) drafts from a stubbed run, and only Accept writes again`, async () => {
    const saved = { ...api.research };
    const calls = [];
    let stored = [];
    let release;
    api.research.zoneDrafts = async (...a) => { calls.push(['zoneDrafts', ...a]); return { items: stored }; };
    api.research.zoneDraftRun = (...a) => {
      calls.push(['zoneDraftRun', ...a]);
      return new Promise((r) => { release = () => { stored = [{ uid: 'd1', body: `Draft for ${o.key}`, accepted: false }]; r({ item: stored[0] }); }; });
    };
    api.research.zoneDraftAccept = async (...a) => { calls.push(['zoneDraftAccept', ...a]); return { item: { ...stored[0], accepted: true } }; };
    api.research.zoneDraftDiscard = async (...a) => { calls.push(['zoneDraftDiscard', ...a]); return {}; };
    const restore = installDocument();
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const button = (text) => walk(container).find((n) => n.tagName?.toLowerCase() === 'button' && (n.textContent || '').includes(text));
    // The test DOM keeps text on the leaves (a text node's `nodeValue`, or an element React set whole).
    const text = () => walk(container).map((n) => (n.nodeType === 3 ? (n.nodeValue ?? n.textContent ?? '') : (n.childNodes.length ? '' : n.textContent || ''))).join(' ');
    const written = () => calls.filter(([name]) => name !== 'zoneDrafts').map(([name]) => name);
    try {
      await act(async () => {
        root.render(h(MemoryRouter, null, h(RailPageProvider, { role: 'investor' },
          h(ZoneDraft, { surface: o.surface, label: o.label, run: o.label, railOption: o.key }))));
      });
      await settle();
      assert.deepEqual(written(), [], 'the band ran or wrote on mount');

      await act(async () => { props(button(o.label)).onClick(); });
      await settle();
      assert.deepEqual(written(), ['zoneDraftRun'], 'the press runs once');
      assert.ok(text().includes(CHECKING), 'no check is shown while the run is out');
      assert.equal(button('Accept draft'), undefined, 'Accept is offered before the run is checked');

      await act(async () => { release(); });
      await settle();
      assert.ok(text().includes(`Draft for ${o.key}`), 'the stubbed draft is not shown');
      assert.deepEqual(written(), ['zoneDraftRun'], 'something was written beyond the draft before Accept');

      await act(async () => { props(button('Accept draft')).onClick(); });
      await settle();
      assert.deepEqual(written(), ['zoneDraftRun', 'zoneDraftAccept']);
      assert.deepEqual(calls.find(([name]) => name === 'zoneDraftAccept').slice(1), ['d1', undefined]);
    } finally {
      await act(async () => root.unmount());
      restore();
      Object.assign(api.research, saved);
    }
  });
}

// ------------------------------------------------------------------ forms

test('each form option asks on the press, and its answer is stored unsaved until Save', () => {
  const forms = INVESTOR_RAIL_OPTIONS.filter((o) => o.handler === 'form');
  assert.deepEqual(forms.map((o) => o.key), ['ask:evidence', 'ask:question']);
  for (const o of forms) assert.equal(o.source.match, 'api.research.ask(');

  // The desk: one call, in the submit handler, and no save of any kind.
  const desk = spa('pages/investor/InvestorResearchWorkspace.jsx');
  assert.equal(desk.split('api.research.ask(').length - 1, 1);
  assert.match(desk, /const runAsk = useCallback\(async \(\) => \{[\s\S]*?setAsked\(await api\.research\.ask\(q\)\);/);
  assert.doesNotMatch(desk, /askSaveAnswer|askUpdateAnswer/, 'the desk saves an answer');

  // Ask: the answer fills the thread; Save is its own press.
  const ask = spa('pages/research/AskZone.jsx');
  assert.match(ask, /const r = await api\.research\.ask\(q, sessionUid\);/);
  assert.match(ask, /const toggleSaved = async \(item\) => \{[\s\S]*?api\.research\.askSaveAnswer\(item\.uid, !item\.saved\)/);
  assert.match(ask, /onClick=\{\(\) => toggleSaved\(t\)\}/, 'Save is not a press');

  // The Worker stores the answer as history, unsaved: `saved` defaults to 0 and
  // the INSERT never sets it. Only the member's PATCH does.
  assert.match(read('cloudflare-worker/sql/migrations/221_research_ask_sessions.sql'), /saved\s+INTEGER NOT NULL DEFAULT 0/);
  const record = worker.slice(worker.indexOf('async function recordAnswer'), worker.indexOf('research.post(\'/ask/sessions\''));
  assert.match(record, /INSERT INTO research_ask_answers/);
  assert.doesNotMatch(record.slice(record.indexOf('INSERT INTO research_ask_answers'), record.indexOf('VALUES')), /\bsaved\b/);
  assert.match(handler('patch', '/ask/answers/:uid'), /UPDATE research_ask_answers SET saved = \?/);
  // And the run carries rail context, so the page's switch applies (D765).
  assert.match(handler('post', '/ask'), /rail: railFor\(c, \{ page: 'research', option: 'ask:library' \}\)/);
});

// ------------------------------------------------------------------ uploads

test('each upload option adds the member’s own document and places nothing', () => {
  const uploads = INVESTOR_RAIL_OPTIONS.filter((o) => o.handler === 'upload');
  assert.deepEqual(uploads.map((o) => o.key), ['upload:document', 'reindex:document']);
  const library = spa('pages/research/LibraryZone.jsx');
  for (const o of uploads) assert.ok(library.includes(o.source.match), `${o.key}: ${o.source.match} is gone`);
  // The two routes write the library's own row and queue its embedding. No
  // proposal, no placement, no other table.
  for (const [method, path] of [['post', '/documents'], ['post', '/documents/:uid/reindex']]) {
    const body = handler(method, path);
    assert.deepEqual([...new Set(writes(body))], ['research_documents'], `${path} writes beyond the library`);
    assert.match(body, /Jobs\.enqueue\(c\.env, 'embed_entity', \{ type: 'research_doc', id/);
    assert.doesNotMatch(body, /ai_rail_proposals|validate_proposals|fill_provenance/);
  }
});
