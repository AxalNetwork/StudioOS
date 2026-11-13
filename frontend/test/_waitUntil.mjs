/** D5504 (#5504): observable readiness with a real monotonic deadline. */
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';

export async function waitUntil(ready, { label = 'observable result', timeoutMs = 5000, advance = setImmediate, describe = () => '' } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('waitUntil needs a finite nonnegative deadline');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (await ready()) return;
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}: ${String(describe()).slice(0, 1000)}`);
    await advance();
  }
}
