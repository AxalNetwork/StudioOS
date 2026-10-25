/**
 * D886 B3 (#2581): one test per Meet page hook. A hook that stops matching
 * fails its own named test.
 *
 * Each `hook <name>` test checks the hook matches on its fixture state, and
 * not on every state (a hook matching everywhere would decide nothing).
 * UNVERIFIED: the fixture is constructed (see `src/adapters/meet/selectors.ts`);
 * when Meet is measured, recorded pages replace it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOKS, type HookName } from '../src/adapters/meet/selectors.ts';
import { NO_BROWSER, withMeetPage } from './_meet_browser.ts';

const STATES = [...new Set(Object.values(HOOKS).map((h) => h.page))].sort();

let counts: Record<string, Record<string, number>> | null = null;

async function matchCounts(): Promise<Record<string, Record<string, number>>> {
  if (counts) return counts;
  counts = await withMeetPage(async (_page, raw) => {
    const out: Record<string, Record<string, number>> = {};
    for (const state of STATES) {
      await raw.goto(`https://meet.google.com/${state}-fixture`);
      if (state === 'in_call') {
        await raw.evaluate(() => {
          const m = (globalThis as unknown as { __meet: { join(k: string, n: string, s?: boolean): void; speak(k: string, on: boolean): void } }).__meet;
          m.join('p1', 'Participant A'); m.join('me', 'Eadwyn AI', true); m.speak('p1', true);
        });
      }
      out[state] = {};
      for (const [name, hook] of Object.entries(HOOKS)) out[state][name] = await raw.locator(hook.selector).count();
    }
    return out;
  });
  return counts;
}

for (const name of Object.keys(HOOKS) as HookName[]) {
  const hook = HOOKS[name];
  test(`hook ${name}: ${hook.purpose}`, { skip: NO_BROWSER || false }, async () => {
    const c = await matchCounts();
    assert.ok(c[hook.page][name] > 0, `${name} matches nothing on the ${hook.page} page`);
    const elsewhere = STATES.filter((s) => s !== hook.page && c[s][name] > 0);
    assert.ok(elsewhere.length < STATES.length - 1, `${name} matches on every page`);
  });
}
