/**
 * D4961 — the leave guard's controller, branch by branch, on a fake window. The same controller is also
 * driven through a real Chromium's history (see D4961), because a fake cannot prove the event order a browser
 * gives `popstate`; the first version of the guard passed every test here and did not block Back there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaveGuard, installLeaveGate, LEAVE_MESSAGE } from '../src/lib/leaveGuard.js';

/** A window with listeners run in the order they were added (what a real Chromium does on `window`), `history.go` and `PopStateEvent`. */
function fakeWindow(startIdx = 5) {
  const listeners = [];
  const win = {
    history: { state: { idx: startIdx }, goCalls: [], go(n) { this.goCalls.push(n); } },
    PopStateEvent: class { constructor(type, init = {}) { this.type = type; this.state = init.state; this.stopped = false; } preventDefault() { this.prevented = true; } stopImmediatePropagation() { this.stopped = true; } },
    addEventListener(type, fn, capture = false) { listeners.push({ type, fn, capture: Boolean(capture) }); },
    removeEventListener(type, fn, capture = false) {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === Boolean(capture));
      if (at >= 0) listeners.splice(at, 1);
    },
    dispatchEvent(ev) {
      for (const l of listeners.filter((x) => x.type === ev.type)) { if (ev.stopped) break; l.fn(ev); }
      return true;
    },
    listenerCount: (type) => listeners.filter((l) => l.type === type).length,
  };
  return win;
}
const navigatorOf = () => {
  const calls = [];
  return { calls, push: (...a) => calls.push(['push', ...a]), replace: (...a) => calls.push(['replace', ...a]), go: (...a) => calls.push(['go', ...a]) };
};

test('off by default: nothing is listened to and the navigator is untouched', () => {
  const win = fakeWindow(); const navigator = navigatorOf(); const push = navigator.push;
  createLeaveGuard({ win, navigator, confirmLeave: () => true });
  assert.equal(win.listenerCount('popstate') + win.listenerCount('beforeunload'), 0);
  assert.equal(navigator.push, push);
});

test('the gate is one listener however many guards come and go, and it is installed once per window', () => {
  const win = fakeWindow();
  installLeaveGate(win); installLeaveGate(win);
  const a = createLeaveGuard({ win, confirmLeave: () => true }); a.set(true); a.set(false); a.set(true);
  const b = createLeaveGuard({ win, confirmLeave: () => true }); b.set(true);
  assert.equal(win.listenerCount('popstate'), 1);
});

test('the gate must be ahead of the router: a listener the router added FIRST sees the move before a late guard can stop it', () => {
  // This is why `main.jsx` installs the gate before the router mounts. Browsers run listeners in the order added.
  const early = fakeWindow(5); const lateSeen = []; early.addEventListener('popstate', (e) => lateSeen.push(e.state));
  const lateGuard = createLeaveGuard({ win: early, confirmLeave: () => false }); lateGuard.set(true);
  early.history.state = { idx: 4 };
  early.dispatchEvent(new early.PopStateEvent('popstate', { state: { idx: 4 } }));
  assert.deepEqual(lateSeen, [{ idx: 4 }], 'a gate added after the router is behind it and stops nothing');
});

test('a reload or a closed tab: beforeunload asks, with the message', () => {
  const win = fakeWindow(); const guard = createLeaveGuard({ win, confirmLeave: () => true });
  guard.set(true);
  const ev = new win.PopStateEvent('beforeunload');
  win.dispatchEvent(ev);
  assert.equal(ev.prevented, true);
  assert.equal(ev.returnValue, LEAVE_MESSAGE);
});

test('a link or navigate(): push, replace and go ask first, and only then go through', () => {
  const win = fakeWindow(); const navigator = navigatorOf(); const answers = [false, true]; const asked = [];
  const guard = createLeaveGuard({ win, navigator, confirmLeave: (m) => { asked.push(m); return answers.shift(); } });
  guard.set(true);
  // Mutation checked: no wrapper → the first push goes through unasked and `calls` is not empty.
  navigator.push('/account/portfolio/nl/legal');
  assert.deepEqual(navigator.calls, [], 'declined: the page stays and the router never hears of it');
  navigator.replace('/x');
  assert.deepEqual(navigator.calls, [['replace', '/x']], 'accepted: it goes through');
  assert.deepEqual(asked, [LEAVE_MESSAGE, LEAVE_MESSAGE]);
});

test('Back, declined: the router never sees it and the history is walked back by the distance it moved', () => {
  const win = fakeWindow(5); const seen = []; const guard = createLeaveGuard({ win, confirmLeave: () => false });
  installLeaveGate(win); // at boot, as main.jsx does
  win.addEventListener('popstate', (e) => seen.push(e.state)); // the router's, added at mount, after the gate
  guard.set(true);
  win.history.state = { idx: 4 };
  win.dispatchEvent(new win.PopStateEvent('popstate', { state: { idx: 4 } }));
  assert.deepEqual(seen, [], 'the router did not take the move');
  assert.deepEqual(win.history.goCalls, [1], 'one step forward undoes one step back');
  // The return trip arrives as a popstate for the entry already shown: let through, not asked again.
  win.history.state = { idx: 5 };
  win.dispatchEvent(new win.PopStateEvent('popstate', { state: { idx: 5 } }));
  assert.deepEqual(seen, [{ idx: 5 }]);
});

test('Back, accepted: the router hears the same move exactly once', () => {
  const win = fakeWindow(5); const seen = []; const guard = createLeaveGuard({ win, confirmLeave: () => true });
  installLeaveGate(win);
  win.addEventListener('popstate', (e) => seen.push(e.state));
  guard.set(true);
  win.history.state = { idx: 3 };
  win.dispatchEvent(new win.PopStateEvent('popstate', { state: { idx: 3 } }));
  assert.deepEqual(seen, [{ idx: 3 }], 'passed on once');
  assert.deepEqual(win.history.goCalls, []);
});

test('Forward is the same door: declined walks back the other way', () => {
  const win = fakeWindow(5); const guard = createLeaveGuard({ win, confirmLeave: () => false });
  installLeaveGate(win);
  guard.set(true);
  win.history.state = { idx: 7 };
  win.dispatchEvent(new win.PopStateEvent('popstate', { state: { idx: 7 } }));
  assert.deepEqual(win.history.goCalls, [-2]);
});

test('turning it off puts everything back, and a confirm that throws never traps the reader', () => {
  const win = fakeWindow(); const navigator = navigatorOf(); const push = navigator.push;
  const guard = createLeaveGuard({ win, navigator, confirmLeave: () => { throw new Error('no dialog'); } });
  guard.set(true);
  navigator.push('/ok');
  assert.deepEqual(navigator.calls, [['push', '/ok']], 'an unavailable dialog lets the move through');
  guard.set(false);
  assert.equal(win.listenerCount('beforeunload'), 0);
  assert.equal(navigator.push, push, 'the original is restored');
  // Off, the gate still stands but stops nothing.
  const seen = []; win.addEventListener('popstate', (e) => seen.push(e.state));
  win.dispatchEvent(new win.PopStateEvent('popstate', { state: { idx: 1 } }));
  assert.deepEqual(seen, [{ idx: 1 }]);
  guard.set(true); guard.dispose();
  assert.equal(win.listenerCount('beforeunload'), 0);
});
