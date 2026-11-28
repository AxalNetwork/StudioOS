/** D5504 (#5504): observable readiness with a real monotonic deadline. */
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';
import { act } from 'react';

export async function waitUntil(ready, { label = 'observable result', timeoutMs = 5000, advance = setImmediate, describe = () => '' } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('waitUntil needs a finite nonnegative deadline');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (await ready()) return;
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}: ${String(describe()).slice(0, 1000)}`);
    await advance();
  }
}

/**
 * D9211 (#9211): one act-wrapped turn of the event loop. Every timer, fetch
 * continuation and lazy chunk that resolves during it lands inside act, so
 * React applies the update (and runs its effects) before the caller looks.
 */
export const actTurn = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); // clock-ok: deadline

/**
 * D9211 (#9211): waitUntil with act-wrapped turns, for a mounted React tree.
 * It always takes one turn first, so a predicate that already holds still sees
 * the effects of the action the caller just took, then repeats until `ready`
 * holds or the deadline passes, failing with `label` and `describe()`.
 */
export async function waitForAct(ready, options = {}) {
  await actTurn();
  return waitUntil(ready, { advance: actTurn, ...options });
}

/**
 * D9211 (#9211): counts a stub's answers still out, so a wait can ask "has every read the page
 * started answered?" (`reads.out === 0`) instead of trusting a number of turns.
 * `reads.wrap(fn)` returns fn, counting each promise it returns until that promise settles.
 */
export function readCounter() {
  const reads = {
    out: 0,
    wrap: (fn) => (...args) => {
      const r = fn(...args);
      if (!r || typeof r.then !== 'function') return r;
      reads.out += 1;
      return Promise.resolve(r).finally(() => { reads.out -= 1; });
    },
  };
  return reads;
}
