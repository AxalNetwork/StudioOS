/**
 * D9289 (#9289) — the Eadwyn panel for a keyboard, a screen reader and a
 * phone: the tab strip's keys and ARIA, the composer's name and growth, the
 * transcript's log region and announcements, and focus back from fullscreen.
 *
 * `PersonalAdvisor` reaches `lib/advisor/router.js`, which a Node test cannot
 * import, so its wiring is pinned in the source (as the D701 test does); the
 * rules it calls live in `eadwynChatA11y.js` and are run here. The browser
 * half (390 px with long text, the real keys, the real focus) is
 * `frontend/tests/visual/eadwyn_panel_a11y_9289.spec.mjs`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_panel_a11y_9289.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement as h, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { codeOnly } from './_codeOnly.mjs';
import { installDocument } from './_contracts_dom.mjs';
import {
  PANEL_TABS, PanelTabs, panelPanelId, panelTabAfterKey, panelTabId, tabPanelProps,
} from '../src/components/advisor/EadwynPanels.jsx';
import {
  fitHeight, nearBottom, newAssistantLine, shouldFollow, useFocusOnReturn,
} from '../src/lib/eadwynChatA11y.js';

const ADVISOR = codeOnly(readFileSync('frontend/src/components/advisor/PersonalAdvisor.jsx', 'utf8'));
const slice = (from, to) => ADVISOR.slice(ADVISOR.indexOf(from), ADVISOR.indexOf(to));
// #9282 adds Teams: the strip must take a fourth tab with no key code of its own.
const FOUR = [...PANEL_TABS, { id: 'teams', label: 'Teams' }];

test('the keys walk the tabs in order, wrap at both ends, and Home and End go to the ends', () => {
  const ids = FOUR.map((t) => t.id);
  assert.deepEqual(ids, ['conversation', 'tasks', 'tickets', 'teams']);
  // Right, from each tab in turn, visits every tab once and comes back round.
  const right = [];
  for (let at = 'conversation', i = 0; i < 4; i += 1) { at = panelTabAfterKey(FOUR, at, 'ArrowRight'); right.push(at); }
  assert.deepEqual(right, ['tasks', 'tickets', 'teams', 'conversation']);
  const left = [];
  for (let at = 'conversation', i = 0; i < 4; i += 1) { at = panelTabAfterKey(FOUR, at, 'ArrowLeft'); left.push(at); }
  assert.deepEqual(left, ['teams', 'tickets', 'tasks', 'conversation']);
  assert.equal(panelTabAfterKey(FOUR, 'tickets', 'Home'), 'conversation');
  assert.equal(panelTabAfterKey(FOUR, 'tasks', 'End'), 'teams');
  assert.equal(panelTabAfterKey(PANEL_TABS, 'tasks', 'End'), 'tickets', 'End is the last of the tabs given');
  for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'a']) assert.equal(panelTabAfterKey(FOUR, 'tasks', key), null, key);
  assert.equal(panelTabAfterKey([], 'tasks', 'ArrowRight'), null);
});

test('the strip is a tablist of tabs with ids, a roving tabindex, and aria-controls on the selected tab', () => {
  const out = renderToStaticMarkup(h(PanelTabs, { tab: 'tickets', onTab() {}, tabs: FOUR, idBase: 'x1' }));
  assert.match(out, /^<div role="tablist" aria-label="Eadwyn panel"/);
  const tabs = [...out.matchAll(/<button [^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 4, 'one button per tab given, Teams included');
  for (const [i, t] of FOUR.entries()) {
    const b = tabs[i];
    const on = t.id === 'tickets';
    assert.match(b, /role="tab"/);
    assert.match(b, new RegExp(`id="${panelTabId('x1', t.id)}"`));
    assert.match(b, new RegExp(`aria-selected="${on}"`));
    assert.match(b, new RegExp(`tabindex="${on ? 0 : -1}"`), `${t.id}: only the selected tab is in the Tab order`);
    if (on) assert.match(b, new RegExp(`aria-controls="${panelPanelId('x1', t.id)}"`));
    else assert.doesNotMatch(b, /aria-controls=/, `${t.id}: its panel is not drawn, so it names none`);
  }
  assert.equal(panelTabId('x1', 'tasks'), 'x1-tab-tasks');
  assert.equal(panelPanelId('x1', 'tasks'), 'x1-panel-tasks');
  // The panel names its tab back, and is a stop in the Tab order.
  assert.deepEqual(tabPanelProps('x1', 'tasks'), { role: 'tabpanel', id: 'x1-panel-tasks', 'aria-labelledby': 'x1-tab-tasks', tabIndex: 0 });
});

async function mountStrip(start = 'conversation') {
  const restore = installDocument('', { focus: true });
  const picked = [];
  function Strip() {
    const [tab, setTab] = useState(start);
    return h(PanelTabs, { tab, tabs: FOUR, idBase: 's', onTab: (next) => { picked.push(next); setTab(next); } });
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(Strip)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const list = () => walk(container).find((n) => props(n).role === 'tablist');
  // Identity checks use `assert.ok(a === b)`: a failing `equal` would print the stub DOM's React fibers.
  const button = (id) => walk(container).find((n) => props(n)['data-testid'] === `eadwyn-tab-${id}`);
  const press = async (key) => {
    let prevented = false;
    await act(async () => { props(list()).onKeyDown({ key, preventDefault() { prevented = true; } }); });
    return prevented;
  };
  return { picked, props, button, press, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('a key selects the tab it lands on and moves focus to it; any other key is left to the browser', async () => {
  const m = await mountStrip();
  try {
    assert.equal(await m.press('ArrowRight'), true);
    assert.deepEqual(m.picked, ['tasks']);
    assert.ok(document.activeElement === m.button('tasks'), 'focus follows the selection');
    assert.equal(m.props(m.button('tasks')).tabIndex, 0);
    assert.equal(m.props(m.button('conversation')).tabIndex, -1, 'the roving tabindex moved with it');
    await m.press('End');
    assert.ok(document.activeElement === m.button('teams'));
    await m.press('ArrowRight');
    assert.ok(document.activeElement === m.button('conversation'), 'Right from the last wraps to the first');
    await m.press('ArrowLeft');
    await m.press('Home');
    assert.deepEqual(m.picked, ['tasks', 'teams', 'conversation', 'teams', 'conversation']);
    assert.equal(await m.press('Enter'), false, 'Enter is not the strip\'s');
    assert.equal(m.picked.length, 5);
  } finally { await m.unmount(); }
});

test('every view of the chat draws its selected panel as the tabpanel the strip names', () => {
  // The card below 1024px, the desktop rail and the fullscreen rail.
  assert.match(ADVISOR, /\{!isDesktop && <PanelTabs tab=\{panelTab\} onTab=\{setPanelTab\} idBase=\{panelIds\} \/>\}/);
  assert.match(ADVISOR, /\{\.\.\.\(!isDesktop && panelTab === 'conversation' \? tabPanelProps\(panelIds, 'conversation'\) : \{\}\)\}/);
  assert.match(ADVISOR, /data-testid="eadwyn-panel" \{\.\.\.tabPanelProps\(panelIds, panelTab\)\}/);
  assert.match(ADVISOR, /<PanelTabs tab=\{panelTab\} onTab=\{setPanelTab\} idBase=\{panelIds\} \/>\n\s+<div \{\.\.\.tabPanelProps\(panelIds, panelTab\)\}>/);
  assert.match(ADVISOR, /<PanelTabs tab=\{panelTab\} onTab=\{onPanelTab\} idBase=\{panelIds\} \/>\}\n\s+<div \{\.\.\.\(onPanelTab \? tabPanelProps\(panelIds, panelTab\) : \{\}\)\}>/);
  assert.match(ADVISOR, /panelIds=\{panelIds\}/, 'the fullscreen view is handed the same ids');
});

test('the composer has a name of its own, not only a placeholder', () => {
  const composer = slice('function Composer(', 'function TutorPanel(');
  assert.match(composer, /const fieldId = useId\(\);/);
  assert.match(composer, /<label htmlFor=\{fieldId\} className="sr-only">Message Eadwyn<\/label>\n\s+<textarea\n\s+ref=\{field\}\n\s+id=\{fieldId\}/);
  assert.match(composer, /useAutoGrow\(field, input\);/, 'it grows with its text');
  assert.match(composer, /max-h-40 max-sm:min-h-\[58px\]/, 'two lines at least on a phone (2 × 20px + 16px padding + 2px border), and a cap');
});

test('the composer grows to its text and its border', () => {
  const el = { style: { height: '30px' }, offsetHeight: 0, clientHeight: 0, scrollHeight: 0 };
  // After `height: auto` the browser reports the content's height.
  Object.defineProperty(el, 'scrollHeight', { get() { return el.style.height === 'auto' ? 96 : 40; } });
  el.offsetHeight = 60; el.clientHeight = 58;
  fitHeight(el);
  assert.equal(el.style.height, '98px', 'measured at auto, so it can shrink as well as grow; border added');
  assert.doesNotThrow(() => fitHeight(null));
});

test('the transcript is a log; what Eadwyn adds is announced politely, once, and nothing else is', () => {
  const transcript = slice('const Transcript = React.forwardRef', 'function Bubble(');
  assert.match(transcript, /<div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="eadwyn-announce">\{said\}<\/div>/);
  assert.match(transcript, /role="log" aria-live="off" aria-label="Conversation with Eadwyn"/);
  assert.match(transcript, /const said = useAssistantAnnouncement\(messages\);/);
  assert.match(transcript, /onScroll=\{onScroll\}/);

  const a = { role: 'assistant', content: '  Which market first? ' };
  const u = { role: 'user', content: 'B2B' };
  assert.equal(newAssistantLine(0, [a]), 'Which market first?', 'the first line of a new chat');
  assert.equal(newAssistantLine(1, [a, u]), null, 'the member\'s own line is not read back');
  assert.equal(newAssistantLine(2, [a, u, { role: 'assistant', content: 'Thanks.' }, { role: 'assistant', content: 'Next: pricing?' }]), 'Next: pricing?', 'the newest of the lines added');
  assert.equal(newAssistantLine(0, [a, u, a]), null, 'a history read on load is not announced');
  assert.equal(newAssistantLine(3, [a, u, a]), null, 'nothing added');
  assert.equal(newAssistantLine(1, [a, { role: 'tool', content: '{"cta":1}' }]), null, 'a tool card is not prose');
  assert.equal(newAssistantLine(1, [a, { role: 'assistant', content: '   ' }]), null);
});

test('the transcript follows only a reader at its foot, or one who just sent', () => {
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), true);
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 552, clientHeight: 400 }), true, '48px from the foot still counts');
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 551, clientHeight: 400 }), false);
  assert.equal(nearBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 }), false, 'reading the top');
  assert.equal(nearBottom(null), true);
  assert.equal(shouldFollow({ wasNearBottom: true, added: 1, last: { role: 'assistant' } }), true);
  assert.equal(shouldFollow({ wasNearBottom: false, added: 1, last: { role: 'assistant' } }), false, 'reading older lines is not interrupted');
  assert.equal(shouldFollow({ wasNearBottom: false, added: 1, last: { role: 'user' } }), true, 'their own send brings them down');
  assert.equal(shouldFollow({ wasNearBottom: false, added: 0, last: { role: 'user' } }), false, 'an explanation streaming in is not their send');
  // The parent no longer scrolls on every change.
  assert.doesNotMatch(ADVISOR, /el\.scrollTop = el\.scrollHeight;\n\s+\}, \[messages, question, tutor, viewMode\]\);/);
  assert.match(slice('const Transcript = React.forwardRef', 'function Bubble('), /const onScroll = useTranscriptFollow\(own, messages, tutor\);/);
});

test('fullscreen uses the lightbox shell\'s focus trap, and focus comes back to the button that opened it', () => {
  const view = slice('function FullscreenView(', 'function FullscreenHeader(');
  assert.match(view, /const onTab = useLightboxFocus\(box, \{ onClose: onExit \}\);/);
  assert.match(view, /ref=\{box\}\n\s+role="dialog"\n\s+aria-modal="true"\n\s+aria-label="Eadwyn AI"\n\s+tabIndex=\{-1\}\n\s+onKeyDown=\{onTab\}/);
  assert.doesNotMatch(view, /useEscapeClose\(onExit\)/, 'Escape is the shell\'s, on the shared stack');
  assert.match(ADVISOR, /useFocusOnReturn\(viewMode === 'normal', maximizeRef\);/);
  assert.match(slice('function Header(', 'function FullscreenView('), /<button\n\s+ref=\{maximizeRef\}/);
  // Lightbox and the fullscreen view run the same hook.
  const shell = codeOnly(readFileSync('frontend/src/ui/Lightbox.jsx', 'utf8'));
  assert.match(shell, /const onTab = useLightboxFocus\(dialog, \{ id, off: page, onClose, onEscape, initialFocus, returnFocusTo, keep \}\);/);
});

test('closing fullscreen focuses the card\'s button; opening the card for the first time does not', async () => {
  const restore = installDocument('', { focus: true });
  function Card({ normal }) {
    const target = useRef(null);
    useFocusOnReturn(normal, target);
    return normal ? h('button', { ref: target, 'data-testid': 'max' }, 'max') : h('div', null, 'fullscreen');
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const button = () => walk(container).find((n) => n.tagName === 'BUTTON');
  try {
    await act(async () => { root.render(h(Card, { normal: true })); });
    assert.ok(document.activeElement !== button(), 'a first mount does not take focus');
    await act(async () => { root.render(h(Card, { normal: false })); });
    await act(async () => { root.render(h(Card, { normal: true })); });
    assert.ok(document.activeElement === button(), 'the new button, drawn as the card comes back, has focus');
    document.activeElement = null;
    await act(async () => { root.render(h(Card, { normal: true })); });
    assert.ok(document.activeElement === null, 'a re-render that is not a return leaves focus alone');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test('the active question wraps to two lines instead of one cut line', () => {
  const q = slice('function CurrentQuestion(', 'const MIC = ');
  assert.match(q, /line-clamp-2 break-words/);
  assert.doesNotMatch(q, /\btruncate\b/);
});
