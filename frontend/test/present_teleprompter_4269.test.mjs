// D4254 P2b (#4269): Present's teleprompter (ps5) and the phone remote (ps5b).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/present_teleprompter_4269.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import PitchPresent from '../src/pages/raise/pitch/PitchPresent.jsx';
import {
  PREFS_KEY, SIZE_DEFAULT, SIZE_MAX, SIZE_MIN, SIZE_STEP, clampSize, isRemote, mirrorStyle, nextLine, nextSize, nextSpeed,
  readPrefs, scriptOf, startView, teleprompterHref, writePrefs,
} from '../src/pages/raise/pitch/teleprompterModel.js';

const h = React.createElement;

test('the model: size bounds and steps, the speed cycle, the kept prefs, the script and the next card\'s line', () => {
  // Mutation checked: the bounds dropped → A+ past the maximum grows; the try/catch dropped → a blocked store throws.
  assert.equal(clampSize(SIZE_MAX + 40), SIZE_MAX);
  assert.equal(clampSize(SIZE_MIN - 40), SIZE_MIN);
  assert.equal(clampSize('nope'), SIZE_DEFAULT);
  assert.equal(nextSize(SIZE_DEFAULT, 1), SIZE_DEFAULT + SIZE_STEP);
  assert.equal(nextSize(SIZE_MAX, 1), SIZE_MAX, 'A+ stops at the largest');
  assert.equal(nextSize(SIZE_MIN, -1), SIZE_MIN, 'A− stops at the smallest');
  assert.deepEqual(['off', 'slow', 'steady', 'fast'].map(nextSpeed), ['slow', 'steady', 'fast', 'off']);
  assert.equal(nextSpeed('warp'), 'slow', 'an unknown speed is Off, then Slow');

  const kept = new Map();
  const store = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  assert.deepEqual(readPrefs(store), { size: SIZE_DEFAULT, speed: 'off' });
  writePrefs(store, { size: 999, speed: 'fast' });
  assert.deepEqual(JSON.parse(kept.get(PREFS_KEY)), { size: SIZE_MAX, speed: 'fast' }, 'what is kept is in bounds');
  assert.deepEqual(readPrefs(store), { size: SIZE_MAX, speed: 'fast' });
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readPrefs(blocked), { size: SIZE_DEFAULT, speed: 'off' });
  assert.doesNotThrow(() => writePrefs(blocked, { size: 40 }));
  assert.deepEqual(readPrefs(null), { size: SIZE_DEFAULT, speed: 'off' });
  kept.set(PREFS_KEY, '{not json');
  assert.deepEqual(readPrefs(store), { size: SIZE_DEFAULT, speed: 'off' });

  assert.deepEqual(scriptOf({ notes: 'Teams close in hours.\n\nMRR is from 42 teams.\nNext: how we charge.' }).paragraphs, ['Teams close in hours.', 'MRR is from 42 teams.', 'Next: how we charge.']);
  assert.deepEqual(scriptOf({ notes: '  ' }), { empty: true, paragraphs: ['No notes on this card.'] });
  assert.deepEqual(nextLine({ n: 8, title: 'Business model', notes: 'We charge per seat.\nMore.' }), { label: 'Next · 8', title: 'Business model', first: 'We charge per seat.' });
  assert.deepEqual(nextLine({ n: 9, title: 'Team', notes: null }), { label: 'Next · 9', title: 'Team', first: null });
  assert.equal(nextLine({ n: '08', title: 'Business model' }).label, 'Next · 8', 'the board\'s number, not the padded one');
  assert.equal(nextLine(null), null);
  assert.deepEqual(mirrorStyle(true), { transform: 'scaleX(-1)' });
  assert.equal(mirrorStyle(false), undefined);
  assert.equal(startView(new URLSearchParams('view=teleprompter')), 'teleprompter');
  assert.equal(startView(new URLSearchParams('view=other')), 'presenter');
  assert.equal(isRemote(new URLSearchParams('remote=1')), true);
  assert.equal(isRemote(new URLSearchParams('remote=yes')), false);
  assert.equal(teleprompterHref(7, 40), '/raise/pitch/present?project_id=7&deck=40&view=teleprompter');
});

const SLIDES = [
  { title: 'Traction', notes: 'Teams close in hours, not days.\n\nTwo of them doubled their seats this quarter.' },
  { title: 'Business model', notes: 'We charge per seat.\nAnnual plans get two months free.' },
  { title: 'Team', notes: '' },
];
const ORIGINAL = { ...api };

async function mount(url, { phone = false } = {}) {
  const calls = [];
  api.deckGet = async (id) => { calls.push(['deckGet', id]); return { id: 40, version: 4, project_id: 7, slides: SLIDES }; };
  api.deckListVersions = async () => { calls.push(['deckListVersions']); return { versions: [{ id: 40, version: 4, is_current: true }] }; };
  const restore = installDocument();
  const kept = new Map();
  const previous = { matchMedia: globalThis.matchMedia, store: Object.getOwnPropertyDescriptor(window, 'localStorage') };
  const media = () => ({ matches: phone, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.matchMedia = media; window.matchMedia = media;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) } });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(PitchPresent))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, kept, by, pr, text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    async press(n) { assert.ok(n, 'drawn'); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.matchMedia = previous.matchMedia;
      if (previous.store) Object.defineProperty(window, 'localStorage', previous.store); else delete window.localStorage;
      restore(); Object.assign(api, ORIGINAL);
    },
  };
}

test('ps5: Teleprompter shows the card\'s script, what is on screen and the next card\'s first line; Size, Speed and Mirror', async () => {
  // Mutation checked: the Teleprompter toggle dropped → no view; the size not kept → the store stays empty; Mirror not applied → no transform.
  const m = await mount('/raise/pitch/present?project_id=7&deck=40');
  try {
    assert.ok(!m.by('teleprompter-view'), 'the presenter view first');
    assert.equal(m.pr(m.by('pitch-present-teleprompter'))['aria-pressed'], false);
    await m.press(m.by('pitch-present-teleprompter'));
    assert.ok(m.by('teleprompter-view'), 'the view is drawn');
    assert.equal(m.pr(m.by('pitch-present-teleprompter'))['aria-pressed'], true);
    assert.ok(!m.by('pitch-present-notes'), 'in place of the presenter view');
    assert.match(m.text(m.by('teleprompter-script')), /^Teams close in hours, not days\. Two of them doubled their seats this quarter\.$/);
    assert.match(m.text(m.by('teleprompter-next')), /NEXT · 2 · Business model We charge per seat\./);
    assert.ok(m.by('pitch-present-budget'), 'the card\'s budget stays');
    assert.match(m.text(m.by('teleprompter-timer')), /^(\d+:)?\d\d:\d\d$/, 'Present\'s own clock');
    // Size: A+ grows the script and is kept for this viewer.
    assert.equal(m.pr(m.by('teleprompter-text'))['data-size'], SIZE_DEFAULT);
    await m.press(m.by('teleprompter-larger'));
    assert.equal(m.pr(m.by('teleprompter-text'))['data-size'], SIZE_DEFAULT + SIZE_STEP);
    assert.equal(m.pr(m.by('teleprompter-text')).style.fontSize, `${SIZE_DEFAULT + SIZE_STEP}px`);
    assert.deepEqual(JSON.parse(m.kept.get(PREFS_KEY)), { size: SIZE_DEFAULT + SIZE_STEP, speed: 'off' });
    for (let k = 0; k < 20; k += 1) if (!m.pr(m.by('teleprompter-larger')).disabled) await m.press(m.by('teleprompter-larger'));
    assert.equal(m.pr(m.by('teleprompter-text'))['data-size'], SIZE_MAX, 'A+ stops at the largest');
    assert.equal(m.pr(m.by('teleprompter-larger')).disabled, true);
    // Speed cycles and is kept.
    await m.press(m.by('teleprompter-speed'));
    assert.equal(m.pr(m.by('teleprompter-script'))['data-speed'], 'slow');
    assert.equal(JSON.parse(m.kept.get(PREFS_KEY)).speed, 'slow');
    // Mirror flips the words, for this screen only.
    await m.press(m.by('teleprompter-mirror'));
    assert.equal(m.pr(m.by('teleprompter-text'))['data-mirror'], 'true');
    assert.equal(m.pr(m.by('teleprompter-text')).style.transform, 'scaleX(-1)');
    assert.equal(JSON.parse(m.kept.get(PREFS_KEY)).mirror, undefined, 'Mirror is not kept');
    // Nothing is written to the Worker.
    assert.deepEqual([...new Set(m.calls.map(([c]) => c))], ['deckGet']);
  } finally { await m.close(); }
});

test('ps5: P2a\'s Open teleprompter opens on it, with the kept size', async () => {
  const m = await mount('/raise/pitch/present?project_id=7&deck=40&view=teleprompter');
  try {
    assert.ok(m.by('teleprompter-view') && m.by('teleprompter-script'), 'opens on the teleprompter');
    assert.equal(m.pr(m.by('pitch-present-teleprompter'))['aria-pressed'], true);
  } finally { await m.close(); }
});

test('ps5b: on a phone, ?remote=1 is the phone remote — the card and its script, the next line, Back and Next card', async () => {
  // Mutation checked: the remote branch dropped → the phone viewer instead; Next card stepping an entrance → the card does not move.
  const m = await mount('/raise/pitch/present?project_id=7&deck=40&remote=1', { phone: true });
  try {
    assert.equal(m.pr(m.by('pitch-present'))['data-view'], 'remote');
    assert.match(m.text(), /^Phone remote /);
    assert.equal(m.text(m.by('remote-card')), '1 · Traction');
    assert.match(m.text(m.by('remote-script')), /Teams close in hours, not days\./);
    assert.equal(m.text(m.by('remote-next')), 'Next · 2 · Business model — We charge per seat.');
    assert.equal(m.pr(m.by('remote-back')).disabled, true, 'nothing before the first card');
    await m.press(m.by('remote-next-card'));
    assert.equal(m.text(m.by('remote-card')), '2 · Business model');
    assert.equal(m.text(m.by('remote-next')), 'Next · 3 · Team', 'a next card with no script names its title only');
    await m.press(m.by('remote-next-card'));
    assert.equal(m.text(m.by('remote-card')), '3 · Team');
    assert.match(m.text(m.by('remote-script')), /No notes on this card\./);
    assert.equal(m.text(m.by('remote-next')), 'This is the last card.');
    assert.equal(m.pr(m.by('remote-next-card')).disabled, true);
    await m.press(m.by('remote-back'));
    assert.equal(m.text(m.by('remote-card')), '2 · Business model');
    assert.deepEqual([...new Set(m.calls.map(([c]) => c))], ['deckGet'], 'the remote writes nothing to the Worker');
  } finally { await m.close(); }
  const viewer = await mount('/raise/pitch/present?project_id=7&deck=40', { phone: true });
  try { assert.notEqual(viewer.pr(viewer.by('pitch-present'))['data-view'], 'remote', 'without remote=1 the phone is the viewer'); assert.ok(viewer.by('pitch-present-swipe')); } finally { await viewer.close(); }
});
