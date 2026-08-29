/**
 * One list of event types, on both sides of the wire.
 *
 * There were three, and they disagreed:
 *
 *   migration 109 / EventEditorPage   7 types — what you could create
 *   PublicEventsPage filter          10 types — four nothing could create
 *   preferredEventTypes (worker)      keyed off 'conference' and 'social'
 *
 * That was not cosmetic. `/events/suggested` recommends by assessment track,
 * and the partner track asked for `['conference', 'meetup', 'social']`. Two of
 * those could never exist, so a partner's suggestions quietly collapsed to
 * meetups alone; the investor track lost 'conference' the same way. Nothing
 * errored — the sets just intersected with almost nothing.
 *
 * These tests are the reason that cannot come back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVENT_TYPE_IDS, EVENT_TYPES, EVENT_TYPE_FILTERS } from '../src/lib/eventTypes.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** The worker's list, read as text — this test may not import TypeScript. */
function workerIds() {
  const src = read('cloudflare-worker/src/services/eventTypes.ts');
  const block = src.slice(src.indexOf('EVENT_TYPE_IDS = ['), src.indexOf('] as const'));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test('the two canonical lists are identical, in the same order', () => {
  assert.deepEqual(workerIds(), EVENT_TYPE_IDS,
    'frontend/src/lib/eventTypes.js and cloudflare-worker/src/services/eventTypes.ts have drifted');
});

test('every type carries a human label, and none is a raw id', () => {
  for (const t of EVENT_TYPES) {
    assert.ok(t.label && t.label !== t.id, `${t.id} has no label`);
    assert.doesNotMatch(t.label, /_/, `${t.id}'s label looks like an id`);
  }
});

test('the public filter is the canonical list plus "All types"', () => {
  assert.equal(EVENT_TYPE_FILTERS[0].id, '');
  assert.deepEqual(EVENT_TYPE_FILTERS.slice(1).map((t) => t.id), EVENT_TYPE_IDS);
});

test('both pages read the shared list rather than declaring their own', () => {
  const editor = read('frontend/src/pages/events/EventEditorPage.jsx');
  const publicPage = read('frontend/src/pages/events/PublicEventsPage.jsx');
  assert.match(editor, /import \{ EVENT_TYPE_IDS \} from '\.\.\/\.\.\/lib\/eventTypes'/);
  assert.match(publicPage, /import \{ EVENT_TYPE_FILTERS \} from '\.\.\/\.\.\/lib\/eventTypes'/);
  // A literal array of type ids in either page means the split came back.
  for (const [name, src] of [['EventEditorPage', editor], ['PublicEventsPage', publicPage]]) {
    assert.doesNotMatch(src, /\[\s*'demo_day'/, `${name} declares its own type list again`);
  }
});

test('every type a suggestion set asks for is one that can exist', () => {
  // This is the actual bug. A track whose preferred types cannot be created
  // gets an empty intersection and silently degrades.
  const src = read('cloudflare-worker/src/routes/events.ts');
  const fn = src.slice(src.indexOf('function preferredEventTypes'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  // Only the contents of `new Set([...])` — the bare strings beside them are
  // assessment-track prefixes ('founder', 'investor'), not event types.
  const asked = [...body.matchAll(/new Set\(\[([^\]]*)\]\)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  assert.ok(asked.length >= 12, `only found ${asked.length} type references — the parse went stale`);
  const unknown = [...new Set(asked)].filter((t) => !EVENT_TYPE_IDS.includes(t));
  assert.deepEqual(unknown, [], 'a suggestion set names a type nothing can create');
});

test('lp_briefing exists, and investors are offered it', () => {
  // The Events canvas types an LP briefing distinctly from a demo day.
  assert.ok(EVENT_TYPE_IDS.includes('lp_briefing'));
  const src = read('cloudflare-worker/src/routes/events.ts');
  assert.match(src, /startsWith\('investor'\)[^;]*'lp_briefing'/);
});
