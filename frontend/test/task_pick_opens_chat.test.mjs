/**
 * The owner's phone pass (2026-10-21): tapping a task on Eadwyn's Tasks tab set
 * the question in the chat, but the screen stayed on Tasks, so the question
 * was nowhere in sight. Below 1024px a picked question now opens the chat, as
 * Start a task already did, and the phone thread scrolls the question into view.
 *
 * `PersonalAdvisor` reaches `lib/advisor/router.js`, which a Node test cannot
 * import, so its wiring is pinned in the source (as the D701 test does); the
 * card a founder taps is mounted and pressed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/task_pick_opens_chat.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { codeOnly } from './_codeOnly.mjs';
import { mountContracts } from './_contracts_dom.mjs';
import { PhoneBuckets } from '../src/components/advisor/eadwynPhone.jsx';

const h = React.createElement;
const ADVISOR = codeOnly(readFileSync('frontend/src/components/advisor/PersonalAdvisor.jsx', 'utf8'));
const WIDGET = codeOnly(readFileSync('frontend/src/components/advisor/AdvisorProgressWidget.jsx', 'utf8'));
const PICK_END = '}, [focusSection, isDesktop, setPanelTab]);';
const PICK = ADVISOR.slice(ADVISOR.indexOf('const handlePickQuestion = useCallback('), ADVISOR.indexOf(PICK_END) + PICK_END.length);

test('a picked question opens the chat below 1024px, and only there', () => {
  // Mutations checked: the tab switch dropped; done on desktop too (where the chat sits beside the list); isDesktop left out of the deps.
  assert.ok(PICK.length > 60, 'the pick handler moved');
  assert.match(PICK, /if \(!isDesktop\) \{\s*revealPickRef\.current = true;\s*setPanelTab\('conversation'\);\s*\}/);
  assert.match(PICK, /setQuestion\(\{\s*id: q\.id,\s*prompt: q\.prompt,/);
  assert.match(PICK, /setMessages\(\(m\) => \[\.\.\.m, \{ role: 'assistant', content: q\.prompt, question_id: q\.id \}\]\)/);
  assert.match(PICK, /\}, \[focusSection, isDesktop, setPanelTab\]\);$/);
});

test('the phone thread scrolls the picked question into view once the chat is drawn, once', () => {
  // Mutation checked: the flag not cleared (every later message would yank the page).
  const at = ADVISOR.indexOf('if (!revealPickRef.current || panelTab !== \'conversation\') return;');
  assert.ok(at > 0, 'no reveal effect');
  const effect = ADVISOR.slice(at, ADVISOR.indexOf('}, [panelTab, messages]);', at));
  assert.match(effect, /revealPickRef\.current = false;/);
  assert.match(effect, /scrollerRef\.current\?\.lastElementChild\?\.scrollIntoView\?\.\(\{ block: 'center' \}\)/);
});

test('the phone Tasks tab hands its picks to that handler, and Proposed and Pending cards pick', () => {
  const phone = ADVISOR.slice(ADVISOR.indexOf('if (phone) {'), ADVISOR.indexOf('const containerClass ='));
  const tasks = phone.slice(phone.indexOf("panelTab === 'tasks'"));
  assert.match(tasks, /<AdvisorProgressWidget\s+variant="phone"[\s\S]*?onPickQuestion=\{handlePickQuestion\}/);
  assert.match(WIDGET, /proposedItems\.map\(\(q\) => phoneCard\(q, \{ onClick: \(\) => handleClickQuestion\(q\) \}\)\)/);
  assert.match(WIDGET, /pendingItems\.map\(\(q\) => phoneCard\(q, \{ pct: q\.completion, onClick: \(\) => handleClickQuestion\(q\) \}\)\)/);
});

test('pressing a Proposed card calls its pick', async () => {
  const picked = [];
  const card = (key, title) => ({ key, title, importance: 'high', onClick: () => picked.push(key) });
  const m = await mountContracts(h(PhoneBuckets, { buckets: [{ id: 'proposed', label: 'Proposed', count: 2, cards: [card('q1', 'What is your startup called?'), card('q2', 'Which sector are you in?')] }] }), '/studio?tab=tasks');
  try {
    const buttons = m.nodes().filter((n) => m.props(n)?.type === 'button' && typeof m.props(n)?.onClick === 'function' && !('aria-expanded' in (m.props(n) || {})));
    assert.equal(buttons.length, 2, 'one press per card');
    await act(async () => { m.props(buttons[1]).onClick(); });
    assert.deepEqual(picked, ['q2']);
  } finally { await m.unmount(); }
});
