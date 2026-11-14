/**
 * D4820 part 5 (#4820, CM08) — the activity read's `by_kind`: each kind's count
 * under the same dates and search, for the Activity lightbox's kind chips. Only
 * when no kind is chosen; a kind whose source failed is null, never 0; and it
 * adds no statement. Every record is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/community_activity_kinds_4820.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { communityActivity } from '../src/services/communityActivity.ts';

const Q = { kind: null, from: null, to: null, q: null, limit: 10, offset: 0 };

async function db() {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  await loadSchema(d);
  d.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (1, 'admin', 'Synthetic Admin', 'a@example.invalid', 1)`).run();
  d.prepare(`INSERT INTO events (id, slug, title, starts_at, status) VALUES (10, 'demo', 'Demo Night', '2026-11-01 18:00:00', 'published')`).run();
  d.prepare(`INSERT INTO job_postings (id, slug, title, status, updated_at) VALUES (20, 'ops', 'Ops Lead', 'closed', '2026-10-19 11:00:00')`).run();
  d.prepare(`INSERT INTO circles (id, slug, name, published, featured) VALUES (30, 'climate', 'Climate Founders', 1, 0)`).run();
  const audit = d.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at) VALUES (1, ?, ?, ?, ?)`);
  audit.run('event_approved', 'events', JSON.stringify({ event_id: 10 }), '2026-10-22 08:00:00');
  audit.run('event_featured', 'events', JSON.stringify({ event_id: 10, featured: true }), '2026-10-23 09:00:00');
  audit.run('circle_published', 'circles', JSON.stringify({ circle_id: 30 }), '2026-10-18 10:00:00');
  audit.run('expert_verified', 'wellbeing', JSON.stringify({ expert_uid: 'x' }), '2026-10-17 10:00:00');
  const reg = d.prepare(`INSERT INTO event_registrations (event_id, email, status, registered_at) VALUES (10, ?, 'registered', ?)`);
  reg.run('r1@example.invalid', '2026-10-24 09:00:00');
  reg.run('r2@example.invalid', '2026-10-23 07:00:00');
  return d;
}

/** Counts the statements a read makes, so a change that adds one is seen. */
function counted(d: DatabaseSync) {
  const inner = d1Over(d) as any;
  let n = 0;
  return { env: { DB: { ...inner, prepare: (sql: string) => { n += 1; return inner.prepare(sql); } } } as any, n: () => n };
}

test('D4820 part 5: with no kind chosen, by_kind counts each kind, and they add up to the total', async () => {
  const d = await db();
  try {
    const a = await communityActivity({ DB: d1Over(d) } as any, Q) as any;
    // Events are the two admin acts plus one registration row per event per day (two days).
    // Mutation checked: events without the registration rows → 2 and this fails.
    assert.deepEqual(a.by_kind, { events: 4, jobs: 1, circles: 1, wellbeing: 1 });
    assert.equal(a.by_kind.events + a.by_kind.jobs + a.by_kind.circles + a.by_kind.wellbeing, a.total);
  } finally { d.close(); }
});

test('D4820 part 5: the counts honour the dates and the search, like the rows', async () => {
  const d = await db();
  try {
    const dated = await communityActivity({ DB: d1Over(d) } as any, { ...Q, from: '2026-10-22', to: '2026-10-24' }) as any;
    assert.deepEqual(dated.by_kind, { events: 4, jobs: 0, circles: 0, wellbeing: 0 });
    const searched = await communityActivity({ DB: d1Over(d) } as any, { ...Q, q: 'Climate' }) as any;
    assert.equal(searched.by_kind.circles, 1);
    assert.equal(searched.by_kind.events, 0);
  } finally { d.close(); }
});

test('D4820 part 5: a chosen kind carries no by_kind, so no stale count is drawn for the others', async () => {
  const d = await db();
  try {
    // Mutation checked: by_kind built for every query → the jobs read carries one and this fails.
    for (const kind of ['jobs', 'admin'] as const) {
      const a = await communityActivity({ DB: d1Over(d) } as any, { ...Q, kind }) as any;
      assert.ok(!('by_kind' in a), `${kind} carried by_kind`);
    }
  } finally { d.close(); }
});

test('D4820 part 5: a kind whose source failed is null, never 0, and the others still count', async () => {
  const d = await db();
  try {
    d.exec('DROP TABLE event_registrations');
    const a = await communityActivity({ DB: d1Over(d) } as any, Q) as any;
    // Mutation checked: `sum` treating a failed source as 0 → events is 2 and this fails.
    assert.equal(a.by_kind.events, null, 'events is half-counted when its registrations failed');
    assert.equal(a.by_kind.circles, 1);
    assert.equal(a.unreadable[0].source, 'event_registrations');
  } finally { d.close(); }
});

test('D4820 part 5: by_kind adds no statement to the read', async () => {
  const d = await db();
  try {
    const c = counted(d);
    await communityActivity(c.env, Q);
    const withKinds = c.n();
    const k = counted(d);
    await communityActivity(k.env, { ...Q, kind: 'jobs' });
    // The unfiltered read already asks every source for its count; by_kind only adds them up.
    assert.ok(withKinds > k.n(), 'the unfiltered read reads more sources than one kind');
    assert.equal(withKinds, 15, 'the unfiltered read\'s statements (D932) are unchanged');
  } finally { d.close(); }
});
