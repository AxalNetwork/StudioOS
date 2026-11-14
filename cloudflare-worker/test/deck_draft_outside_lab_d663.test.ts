/**
 * D663 (#1476) — a founder outside the Lab never got a final deck.
 *
 * `daysRemaining(null)` returned 28, so the programme day was 0, and
 * `draft = programDay < 28 || gaps.length > 0` marked every such deck DRAFT
 * forever. This drives the real fill → map pipeline against a fake D1 for a
 * founder with no Lab start date, and for a member, and checks the programme
 * clock holds only the member.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_draft_outside_lab_d663.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillAxalSpinoutDemoDay } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { mapToSpinoutDeckData } from '../src/services/decks/spinoutDeckData.ts';

function makeEnv(user: Record<string, unknown>) {
  const project = { id: 1, founder_id: 1, name: 'Test Co', sector: 'B2B SaaS' };
  const resolve = (sql: string) => {
    const s = sql.toLowerCase();
    if (s.includes('from projects')) return { first: async () => project, all: async () => ({ results: [project] }) };
    if (s.includes('from users')) return { first: async () => user, all: async () => ({ results: [user] }) };
    return { first: async () => null, all: async () => ({ results: [] }) };
  };
  return {
    DB: {
      prepare(sql: string) {
        const r = resolve(sql);
        return {
          bind: () => ({ first: r.first, all: r.all, run: async () => ({ success: true }) }),
          first: r.first,
          all: r.all,
          run: async () => ({ success: true }),
        };
      },
      batch: async () => [],
      exec: async () => ({ count: 0, duration: 0 }),
    },
  } as any;
}

const base = { id: 1, name: 'Founder', display_name: 'Founder', email: 'f@test.co', spinout_lab_week: 1 };

test('a founder who never joined the Lab: lab_member false, and the programme clock does not hold the deck', async () => {
  const src = await fillAxalSpinoutDemoDay(makeEnv({ ...base, spinout_lab_active: 0, spinout_lab_started_at: null }), 1, 1);
  assert.equal(src.meta.lab_active, false);
  assert.equal(src.meta.lab_member, false);
  assert.equal(src.meta.days_remaining, 28, 'no start date still reads 28 days left');
  const b = mapToSpinoutDeckData(src);
  assert.equal(b.programmeHolds, false);
  assert.equal(b.draft, b.gaps.length > 0, 'a draft only because of its gaps');
  assert.equal(b.data.cover.eyebrowRight, 'DEMO DAY');
});

test('a former member (a start date, no longer active) keeps the programme clock', async () => {
  const started = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const src = await fillAxalSpinoutDemoDay(makeEnv({ ...base, spinout_lab_active: 0, spinout_lab_started_at: started }), 1, 1);
  assert.equal(src.meta.lab_member, true);
  const b = mapToSpinoutDeckData(src);
  assert.equal(b.programDay, 5);
  assert.equal(b.programmeHolds, true, 'Day 5 of 28 holds a member deck in draft');
  assert.equal(b.draft, true);
});
