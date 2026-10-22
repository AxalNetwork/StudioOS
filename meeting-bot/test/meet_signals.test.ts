/**
 * D886 B3 (#2581): the Meet adapter's pure rules — the page state, the link
 * check, the roster and the active speaker. No browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { REFUSAL, RosterTracker, SpeakerTracker, classify, isMeetLink, isOut } from '../src/adapters/meet/signals.ts';
import { HOOKS } from '../src/adapters/meet/selectors.ts';
import { readFileSync } from 'node:fs';

test('the page state, from its hooks', () => {
  const cases: Array<[string[], string]> = [
    [['ask_to_join'], 'prejoin'], [['join_now'], 'prejoin'], [['lobby'], 'lobby'], [['leave'], 'in_call'],
    [['denied'], 'not_admitted'], [['blocked', 'blocked_org'], 'platform_blocked'], [['link_invalid'], 'link_invalid'],
    [['ended'], 'ended'], [['removed'], 'removed'], [[], 'unknown'],
  ];
  for (const [hooks, state] of cases) assert.equal(classify(new Set(hooks)), state, hooks.join('+'));
});

test('removal and the end win over a stale Leave button; a block needs its reason line', () => {
  assert.equal(classify(new Set(['leave', 'removed'])), 'removed');
  assert.equal(classify(new Set(['leave', 'ended'])), 'ended');
  // "You can't join this video call" alone is not proof the organization blocks guests.
  assert.equal(classify(new Set(['blocked'])), 'unknown');
  assert.deepEqual(REFUSAL, { not_admitted: 'not_admitted', platform_blocked: 'platform_blocked', link_invalid: 'link_invalid' });
  assert.deepEqual(['ended', 'removed', 'in_call'].map((s) => isOut(s as never)), [true, true, false]);
});

test('only an https link on meet.google.com itself, with a meeting code', () => {
  assert.equal(isMeetLink('https://meet.google.com/abc-defg-hij'), true);
  for (const bad of ['http://meet.google.com/abc-defg-hij', 'https://meet.google.com/', 'https://meet.google.com.evil.test/abc',
    'https://evil.test/meet.google.com/abc', 'https://user@meet.google.com/abc', 'https://evil.meet.google.com/abc', 'https://notmeet.google.com/abc', 'meet.google.com/abc', '', 'https://[bad']) {
    assert.equal(isMeetLink(bad), false, bad);
  }
});

test('roster: joins and leaves, never the bot; an unreadable panel and a rename change nothing', () => {
  const r = new RosterTracker();
  assert.deepEqual(r.update([['a', 'A', false], ['me', 'Eadwyn AI', true]]), [{ kind: 'join', key: 'a', name: 'A' }]);
  assert.deepEqual(r.update([['a', 'A', false], ['b', 'B', false]]), [{ kind: 'join', key: 'b', name: 'B' }]);
  assert.equal(r.count, 2);
  assert.deepEqual(r.update(null), []);
  assert.deepEqual(r.update([['a', 'A2', false], ['b', 'B', false]]), []);
  assert.deepEqual(r.current(), [{ kind: 'join', key: 'a', name: 'A2' }, { kind: 'join', key: 'b', name: 'B' }]);
  assert.deepEqual(r.update([['b', 'B', false], ['', 'Nameless', false]]), [{ kind: 'leave', key: 'a', name: 'A2' }]);
});

test('speaker: one active speaker, kept while lit; nobody is null; an unreadable read changes nothing', () => {
  const s = new SpeakerTracker();
  assert.equal(s.update(new Set(['b'])), 'b');
  assert.equal(s.update(new Set(['a', 'b'])), undefined, 'b stays while lit');
  assert.equal(s.update(new Set(['a'])), 'a');
  assert.equal(s.update(null), undefined);
  assert.equal(s.update(new Set()), null);
  assert.equal(s.update(new Set()), undefined);
  assert.equal(s.update(new Set(['c', 'a'])), 'a', 'the first by key');
});

test('every hook names its fixture state and purpose; the adapter names hooks, never selectors', () => {
  const adapter = readFileSync(new URL('../src/adapters/meet.ts', import.meta.url), 'utf8');
  for (const [name, hook] of Object.entries(HOOKS)) {
    assert.ok(hook.selector && hook.purpose && hook.page, name);
    assert.ok(!adapter.includes(hook.selector), `${name}'s selector is written into the adapter`);
  }
});
