// D1443 (#3706, canvas AK) — the Ask panel: the store, who it serves, its
// words and states, its seam, where WorkerRail mounts it, and the canvases.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ask_panel_d1443.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  __resetEadwynPanelForTest, askPanelEvent, eadwynPanelEvent, openAskPanel, openEadwynPanel, useAskPanel, useAskRail, useEadwynRailServes,
} from '../src/ui/eadwynPanel.js';
import {
  ASK_FOOT, ASK_NOTHING, ASK_PLACEHOLDER, RUN_CHIPS, acceptAllLabel, askLayout, askServes, canSend, chargeLine, costLine,
  panelChips, proposalCard, refusalState, stateBlock,
} from '../src/ui/askPanelModel.js';
import { ASK_OFF_METHODS, askPanelAdapter } from '../src/ui/askPanelAdapter.js';
import { eadwynApi } from '../src/lib/api/eadwyn.js';
import { railProposalsApi } from '../src/lib/api/railProposals.js';
import AskPanel from '../src/ui/AskPanel.jsx';
import { PageAsk } from '../src/ui/AskButton.jsx';
import TeamAsk from '../src/pages/team/AskButton.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(el);

// The store is a module: drive it through hooks rendered on the server, and
// through its events.
function Probe({ out, serves = false, page = null, label = '' }) {
  useAskRail(serves, page, label);
  out.ask = useAskPanel();
  return null;
}

test('the store: Ask opens only for a viewer a rail serves, and every closer closes it', () => {
  __resetEadwynPanelForTest();
  openAskPanel('Build · Solution design');
  const out = {};
  html(h(Probe, { out }));
  assert.equal(out.ask.open, false, 'no rail, no panel');
  assert.equal(out.ask.available, false);
  // Server rendering runs no effects, so the rail's registration is driven here
  // by the same events a mounted rail produces.
  for (const type of ['close', 'escape', 'route', 'sheet', 'scrim', 'unavailable']) {
    assert.ok(codeOnly(read('frontend/src/ui/eadwynPanel.js')).includes(`'${type}'`), `closer ${type}`);
  }
  assert.match(codeOnly(read('frontend/src/ui/eadwynPanel.js')), /if \(!ask\.available\) return;/, 'nothing opens Ask for a viewer it does not serve');
});

test('one Eadwyn surface at a time: Ask closes the phone panel, and the phone panel closes Ask', () => {
  const src = codeOnly(read('frontend/src/ui/eadwynPanel.js'));
  assert.match(src, /askPanelEvent\(\{ type: 'close' \}\);\s*set\(\{ \.\.\.state, open: true, label \}\);/, 'opening the phone panel closes Ask');
  assert.match(src, /if \(state\.open\) set\(\{ \.\.\.state, open: false \}\);\s*setAsk\(\{ \.\.\.ask, open: true, label \}\);/, 'opening Ask closes the phone panel');
  // The two stores stay separate: D698's tests still drive `available` for founders only.
  assert.match(src, /export function useEadwynRailServes/);
  assert.equal(typeof eadwynPanelEvent, 'function');
  assert.equal(typeof openEadwynPanel, 'function');
  assert.equal(typeof askPanelEvent, 'function');
  assert.equal(typeof useEadwynRailServes, 'function');
});

test('who Ask serves: every licence on its own pages; never a support session, an Explorer, or staff previewing a member', () => {
  const page = 'Founder · Build · Solution design';
  for (const v of ['founder', 'investor', 'advisor', 'partner']) {
    assert.equal(askServes({ page, viewer: v, host: v }), true, v);
  }
  assert.equal(askServes({ page: 'Admin · Approvals', viewer: 'admin', host: 'admin' }), true, 'admin on a console');
  assert.equal(askServes({ page: 'Admin · Approvals', viewer: 'super_admin', host: 'admin' }), true, 'HQ on a console');
  assert.equal(askServes({ page, viewer: 'admin', host: 'founder' }), false, 'an admin previewing a founder page');
  assert.equal(askServes({ page, viewer: 'super_admin', host: 'investor' }), false, 'HQ previewing an investor page');
  assert.equal(askServes({ page, viewer: 'investor', host: 'founder' }), false, 'another licence');
  assert.equal(askServes({ page, viewer: 'founder', host: 'founder', supportSession: { by: 'x' } }), false, 'a support session');
  assert.equal(askServes({ page, viewer: 'exploring', host: 'founder' }), false, 'an Explorer');
  assert.equal(askServes({ page: null, viewer: 'founder', host: 'founder' }), false, 'no page key');
  // WorkerRail passes its own role as the host, and the support session from storage.
  const rail = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  // D1463 (#3713): never on a founder's record read behind a reason.
  assert.match(rail, /useAskRail\(!founderRecord && askServes\(\{ page: pageKey, supportSession: supportOn, viewer, host: role \}\), pageKey, askLabel\);/);
  assert.match(rail, /activeSupportSession\(\)/);
});

test('the words: the cost line is a hold, never "~" and never "$0.00" for an unknown', () => {
  assert.equal(costLine(30000), 'Holds up to $0.03 · you pay what it uses');
  assert.equal(costLine(null), 'The hold shows here before Send · you pay what it uses');
  assert.doesNotMatch(costLine(undefined), /\$0\.00|~/);
  assert.equal(chargeLine(21000, 30000), 'Charged $0.021 of $0.03 held');
  assert.equal(chargeLine(0, 0), 'Not charged');
  assert.equal(chargeLine(null, 30000), 'Charge not recorded');
  assert.equal(ASK_FOOT, 'Nothing is written until you accept.');
  assert.equal(ASK_PLACEHOLDER('Solution design'), 'Ask about Solution design…');
  assert.equal(ASK_NOTHING, 'Eadwyn found nothing new to propose. Nothing was guessed.');
});

test('the states, by the Worker\'s refusal codes', () => {
  for (const code of ['budget_user_day', 'budget_user_month', 'spend_limit', 'budget_review']) {
    assert.equal(refusalState({ data: { refusal: code } }), 'tok', code);
  }
  assert.equal(refusalState({ status: 402 }), 'tok');
  assert.equal(refusalState({ code: 'ai_paused' }), 'paused');
  assert.equal(refusalState({ data: { error: 'assist_off' } }), 'off');
  assert.equal(refusalState({ code: 'support_session_refused' }), 'support');
  assert.equal(refusalState(new Error('boom')), 'err');
  assert.equal(stateBlock('tok').action.label, 'Add tokens');
  assert.ok(stateBlock('tok').action.href, 'Add tokens goes somewhere');
  assert.equal(stateBlock('err').action.label, 'Try again');
  assert.equal(stateBlock('none').title, ASK_NOTHING);
  assert.equal(stateBlock('ok'), null);
  assert.equal(canSend({ text: 'Why?', state: 'ok', busy: false }), true);
  for (const state of ['tok', 'paused', 'off', 'support']) assert.equal(canSend({ text: 'Why?', state, busy: false }), false, state);
  assert.equal(canSend({ text: '  ', state: 'ok', busy: false }), false);
  assert.equal(canSend({ text: 'x'.repeat(2001), state: 'ok', busy: false }), false);
  assert.equal(canSend({ text: 'Why?', state: 'ok', busy: true }), false);
});

test('the chips: a run chip runs in the panel; every other option becomes a typed question; Studio\'s stays in Studio', () => {
  assert.deepEqual(RUN_CHIPS, ['sessions:block']);
  const chips = panelChips([
    { key: 'sessions:block', label: 'Find a free afternoon' },
    { key: 'form:mvp_features', label: 'Propose features from my interviews' },
    { key: 'studio:layout', label: 'Arrange my Studio for this stage' },
    { key: 'form:mvp_features', label: 'dup' },
    { key: '', label: 'no key' },
  ]);
  assert.deepEqual(chips, [
    { key: 'sessions:block', label: 'Find a free afternoon', run: true },
    { key: 'form:mvp_features', label: 'Propose features from my interviews', run: false },
  ]);
  assert.deepEqual(panelChips(null), [], 'Admin: no options, no chips');
  assert.equal(panelChips(Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: `L${i}` }))).length, 6);
});

test('a proposal card: the D1596 payload in words, and never an empty card', () => {
  const c = proposalCard({ uid: 'p1', status: 'proposed', payload: { kind: 'free_afternoon', from: '2026-11-04T12:00', until: '2026-11-04T18:00', open_slots: 0, source: 'Your Axal calendar' } });
  assert.deepEqual(c, { uid: 'p1', eyebrow: 'Free afternoon', text: '2026-11-04T12:00 – 2026-11-04T18:00', source: 'Your Axal calendar', status: 'proposed' });
  assert.equal(proposalCard({ uid: 'p2', payload: null }).text, 'Not recorded');
  assert.equal(acceptAllLabel([{ status: 'proposed' }]), null, 'one card: no Accept all');
  assert.equal(acceptAllLabel([{ status: 'proposed' }, { status: 'proposed' }, { status: 'accepted' }]), 'Accept all (2)');
  assert.equal(acceptAllLabel(Array.from({ length: 60 }, () => ({ status: 'proposed' }))), 'Accept all (50)');
});

test('the layout by width (AK12): docked from 1024, over the content from 640, a sheet below', () => {
  assert.equal(askLayout(1600), 'dock');
  assert.equal(askLayout(1440), 'dock');
  assert.equal(askLayout(1200), 'overlay');
  assert.equal(askLayout(1024), 'overlay');
  assert.equal(askLayout(800), 'over');
  assert.equal(askLayout(390), 'sheet');
});

test('the seam: D1442 turned the quote and the waiting count on; nothing is off, and a failed read is never a value', async () => {
  // Mutations checked (D1442): quote sending with no question; a refused quote drawn as a hold; a failed count read as 0.
  assert.deepEqual([...ASK_OFF_METHODS], [], 'every method goes to a route on main');
  const src = codeOnly(read('frontend/src/ui/askPanelAdapter.js'));
  for (const m of ['start', 'conversation', 'conversations', 'ask', 'run', 'proposals', 'decide']) {
    assert.match(src, new RegExp(`\\b${m}: through\\(`), m);
  }
  assert.match(src, /quote: guarded\(/);
  assert.match(src, /waiting: guarded\(/);

  const realQuote = eadwynApi.quote;
  const realList = railProposalsApi.list;
  const asked = [];
  try {
    eadwynApi.quote = async (uid, body) => { asked.push([uid, body]); return { ai: true, hold_microusd: 31000, model: '@cf/x', model_label: 'X' }; };
    assert.equal((await askPanelAdapter.quote(null, 'hi')).available, false, 'no conversation yet');
    assert.equal((await askPanelAdapter.quote('u1', '   ')).available, false, 'no question yet');
    assert.deepEqual(asked, [], 'a quote was asked for with nothing to price');
    const q = await askPanelAdapter.quote('u1', 'What is my MRR?', 'Founder · Build');
    assert.deepEqual([q.available, q.data.hold_microusd], [true, 31000]);
    assert.deepEqual(asked, [['u1', { question: 'What is my MRR?', page: 'Founder · Build' }]]);
    eadwynApi.quote = async () => ({ ai: false, reason: 'assist_off', message: 'AI is off on this page.' });
    assert.deepEqual(await askPanelAdapter.quote('u1', 'hi'), { available: false, reason: 'AI is off on this page.' }, 'a refusal is off, never a hold');
    eadwynApi.quote = async () => { throw new Error('The quote could not be read.'); };
    assert.equal((await askPanelAdapter.quote('u1', 'hi')).available, false, 'a failed quote is off');

    railProposalsApi.list = async (q) => { asked.push(q); return { proposals: [{ uid: 'a' }, { uid: 'b' }] }; };
    assert.deepEqual(await askPanelAdapter.waiting('Founder · Build'), { available: true, data: { count: 2 } });
    assert.deepEqual(asked.at(-1), { page: 'Founder · Build', status: 'proposed' });
    railProposalsApi.list = async () => { throw new Error('nope'); };
    assert.equal((await askPanelAdapter.waiting('Founder · Build')).available, false, 'a failed count is off, never "0 waiting"');
    assert.equal((await askPanelAdapter.waiting(null)).available, false);
  } finally { eadwynApi.quote = realQuote; railProposalsApi.list = realList; }

  // PageAsk draws the count it read, and the panel prices once typing pauses.
  const button = codeOnly(read('frontend/src/ui/AskButton.jsx'));
  assert.match(button, /askPanelAdapter\.waiting\(ask\.page\)\.then\(\(w\) => \{ if \(live\) setWaiting\(w\.available \? w\.data\?\.count \?\? null : null\); \}\)/);
  assert.match(button, /<AskButtonView onClick=\{\(\) => openAskPanel\(label\)\} expanded=\{ask\.open\} waiting=\{waiting\}/);
  const panel = codeOnly(read('frontend/src/ui/AskPanel.jsx'));
  assert.match(panel, /setTimeout\(\(\) => \{\s*askPanelAdapter\.quote\(convUid, text, page\)/);
});

test('WorkerRail mounts the panel inside its own aside at desktop, and portals it below 1024', () => {
  const rail = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  assert.match(rail, /\{askPanel && askDocked && <div className="fwr-ask-dock" data-testid="ask-dock">\{askPanel\}<\/div>\}\s*<\/aside>/, 'docked inside the aside');
  assert.match(rail, /\{portalReady && askPanel && !askDocked && createPortal\(/, 'portalled below 1024');
  assert.match(rail, /if \(sheetOpen\) askPanelEvent\(\{ type: 'sheet' \}\);/, 'a detail sheet closes Ask');
  assert.match(rail, /if \(lastPath\.current !== pathname\) askPanelEvent\(\{ type: 'route' \}\);/, 'a route change closes Ask');
  assert.match(rail, /root\.setAttribute\('data-eadwyn-ask', 'open'\)/);
  assert.match(rail, /return \(\) => root\.removeAttribute\('data-eadwyn-ask'\);/);
});

test('the CSS: sticky in the rail\'s column at 1024px and up, never fixed there; dark pairs', () => {
  const css = read('frontend/src/ui/askPanel.css');
  const desk = css.slice(css.indexOf('@media (min-width: 1024px) {\n  aside.fwr'));
  const block = desk.slice(0, desk.indexOf('\n}\n'));
  assert.match(block, /\.fwr-ask-dock \{[^}]*position: absolute;[^}]*right: 100%;/);
  assert.match(block, /\.fwr-ask-dock > \.ead-ask \{[^}]*position: sticky;[^}]*height: min\(calc\(100dvh - 56px\), 100%\)/);
  assert.doesNotMatch(block, /position: fixed/);
  assert.match(css, /\.dark \.ead-ask \{/);
  assert.match(css, /@media \(min-width: 1024px\) \{ \.ead-ask-layer, \.ead-ask-scrim \{ display: none; \} \}/);
});

test('the panel draws the canvas\'s parts, docked and as a sheet', () => {
  const dock = html(h(AskPanel, { page: 'Founder · Build · Solution design', label: 'Build · Solution design', crumb: 'Build', options: [{ key: 'form:mvp_features', label: 'Propose features from my interviews' }] }));
  assert.match(dock, /role="complementary"/);
  assert.doesNotMatch(dock, /aria-modal/);
  assert.match(dock, /aria-label="Eadwyn · Build · Solution design"/);
  assert.match(dock, /Suggested for this page/);
  assert.match(dock, /Propose features from my interviews/);
  assert.match(dock, /Ask about Build · Solution design…/);
  assert.match(dock, /The hold shows here before Send · you pay what it uses/);
  assert.match(dock, /Nothing is written until you accept\./);
  assert.match(dock, /aria-label="Close Eadwyn"/);
  assert.doesNotMatch(dock, /\$0\.00|\bFill\b/);
  const sheet = html(h(AskPanel, { page: 'p', label: 'Calendar', layout: 'sheet', options: [] }));
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /aria-modal="true"/);
  assert.doesNotMatch(sheet, /Suggested for this page/, 'no options, no chips (Admin)');
  const off = html(h(AskPanel, { page: 'p', label: 'Calendar', aiOn: false, options: [] }));
  assert.match(off, /AI is off on this page\./);
});

test('Ask buttons: PageAsk draws only where a rail serves the viewer; Team and Raise use it', () => {
  __resetEadwynPanelForTest();
  assert.equal(html(h(PageAsk, {})), '', 'no rail: no Ask');
  assert.equal(html(h(TeamAsk, { label: 'Team · Northwind' })), '');
  const btn = codeOnly(read('frontend/src/ui/AskButton.jsx'));
  assert.match(btn, /if \(!ask\.available\) return null;/);
  assert.match(btn, /onClick=\{\(\) => openAskPanel\(label\)\}/);
  assert.match(codeOnly(read('frontend/src/pages/team/AskButton.jsx')), /return <PageAsk label=\{label\} \/>;/);
  assert.match(codeOnly(read('frontend/src/pages/cycles/RaiseOverviewLead.jsx')), /<PageAsk label="Raise · Overview" testId="raise-ask" \/>/);
});

test('the canvases are in design/incoming with the one named edit, and the decisions name them', () => {
  const page = read('design/incoming/Ask Panel Page.dc.html');
  const boards = read('design/incoming/Ask Panel · Boards.dc.html');
  for (const k of ['AK1', 'AK9', 'AK12', 'AK13', 'AK14']) assert.ok(boards.includes(`'${k}'`), `board ${k}`);
  assert.ok(page.includes('Holds up to $[') && page.includes('you pay what it uses'));
  assert.ok(page.includes('Nothing is written until you accept.'));
  assert.ok(!page.includes('uploads/axal-logo-200x200.png'));
  assert.ok(page.includes('/axal-mark.png'));
  assert.match(read('design/incoming/README.md'), /## Landed 2026-11-01 — The Ask panel \(#3706\)/);
  assert.ok(existsSync(new URL('../../documentation/architecture/decisions/D1443.md', import.meta.url)));
  assert.match(read('documentation/architecture/decisions/D1444.md'), /AK9 · Studio/);
  assert.match(read('documentation/architecture/decisions/D1443.md'), /#3991/);
});
