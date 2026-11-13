/**
 * D4803 (#4803, Security v2 slice 4, canvas SE07 Trust): the Worker half,
 * against the real migrations (584 and the sanctions table's own).
 *
 *   · per-notice delivery from the rows the sweep writes: sending, sent,
 *     failed, and confirmed subscribers not attempted yet; a notice whose
 *     subprocessor has started says so; old notices drop off; whether mail is
 *     configured at all, so "0 sent" never reads as delivery working; an
 *     unreadable store is `available: false`;
 *   · the published revision: the change log's count (it is append-only) and
 *     the newest publish; 0 is a measured "never published";
 *   · the sanctions summary adds reviewed hits, the latest review and whether
 *     the newest run matched;
 *   · the admin Trust Center read carries them.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/security_trust_4803.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOTICE_SUMMARY_DAYS, noticeDeliveries } from '../src/services/subprocessorNotices.ts';
import { publishedRevision } from '../src/services/trustContent.ts';
import { screeningSummary } from '../src/services/sanctions.ts';

const NOW = Date.UTC(2026, 10, 9, 12);
const DAY = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
const migration = (name: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', name), 'utf8');

function d1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(q: string) {
      let b: unknown[] = [];
      const api: any = {
        bind: (...x: unknown[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(q).get(...(b as any[])) ?? null; },
        async all() { return { results: db.prepare(q).all(...(b as any[])) }; },
      };
      return api;
    },
  };
}

function store() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
  db.exec(migration('584_trust_content.sql'));
  db.exec(migration('202611072220_trust_publish_key.sql'));
  db.exec(migration('202611092240_subprocessor_notice_recovery.sql')); // D4683
  const sub = db.prepare("INSERT INTO trust_subprocessors (uid, name, purpose, data_seen, location, state, starts_at, published_at) VALUES (?, ?, 'p', 'd', 'EU', ?, ?, '2026-11-01')");
  const person = db.prepare("INSERT INTO subprocessor_subscribers (uid, email_hash, email_enc, status, confirmed_at) VALUES (?, ?, 'x', ?, ?)");
  const delivery = db.prepare('INSERT INTO subprocessor_notice_deliveries (subprocessor_id, subscriber_id, outcome) VALUES (?, ?, ?)');
  return { db, env: { DB: d1(db) } as any, sub, person, delivery };
}

test('per-notice delivery: sending, sent, failed and not yet sent, newest start first', async () => {
  const { env, sub, person, delivery } = store();
  const resend = Number(sub.run('sp_resend', 'Resend', 'published', DAY(8), ).lastInsertRowid);
  const stripe = Number(sub.run('sp_stripe', 'Stripe', 'published', DAY(-5)).lastInsertRowid);
  sub.run('sp_old', 'Old Co', 'published', DAY(-(NOTICE_SUMMARY_DAYS + 5)));
  sub.run('sp_draft', 'Draft Co', 'draft', null);
  sub.run('sp_gone', 'Gone Co', 'removed', DAY(2)); // taken off the list: its notice is not a current one
  const ids = ['a', 'b', 'c', 'd'].map((k) => Number(person.run(`u_${k}`, `h_${k}`, 'confirmed', '2026-10-01').lastInsertRowid));
  person.run('u_p', 'h_p', 'pending', null);
  delivery.run(resend, ids[0], 'sent');
  delivery.run(resend, ids[1], 'failed');
  delivery.run(resend, ids[2], 'sending');
  delivery.run(stripe, ids[0], 'sent');

  const got = await noticeDeliveries(env, NOW) as any;
  assert.equal(got.available, true);
  assert.equal(got.mail_configured, false, 'no mail credentials read as configured');
  assert.deepEqual(got.rows.map((r: any) => [r.name, r.started, r.sending, r.sent, r.failed, r.not_sent]), [
    ['Resend', false, 1, 1, 1, 1],
    ['Stripe', true, 0, 1, 0, 3],
  ], 'wrong counts, order, or a draft / long-started notice listed');
});

test('mail configured is read from the credentials the sweep itself needs', async () => {
  const { db } = store();
  const env = { DB: d1(db), GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z' } as any;
  assert.equal(((await noticeDeliveries(env, NOW)) as any).mail_configured, true);
});

test('an unreadable delivery store is available: false, never "none sent"', async () => {
  const env = { DB: { prepare() { throw new Error('no such table'); } } } as any;
  const got = await noticeDeliveries(env, NOW) as any;
  assert.equal(got.available, false);
  assert.match(got.reason, /not a claim that none were sent/);
});

test('the published revision is the change log\'s count, with the newest publish; 0 is never published', async () => {
  const { db, env } = store();
  assert.deepEqual(await publishedRevision(env), { available: true, revision: 0, published_at: null });
  const add = db.prepare("INSERT INTO trust_content_changes (uid, published_at, change_note) VALUES (?, ?, 'a note long enough')");
  add.run('c1', '2026-10-01T10:00:00.000Z');
  add.run('c2', '2026-10-28T09:00:00.000Z');
  add.run('c3', '2026-10-15T09:00:00.000Z');
  assert.deepEqual(await publishedRevision(env), { available: true, revision: 3, published_at: '2026-10-28T09:00:00.000Z' });
  const broken = await publishedRevision({ DB: { prepare() { throw new Error('x'); } } } as any) as any;
  assert.equal(broken.available, false);
});

test('sanctions: reviewed hits, the latest review, and whether the newest run matched', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sanctions_screenings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
    run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, hit INTEGER NOT NULL DEFAULT 0, severity TEXT NOT NULL DEFAULT 'none',
    match_count INTEGER NOT NULL DEFAULT 0, payload_json TEXT, reviewed_by INTEGER, reviewed_at TIMESTAMP, review_notes TEXT)`);
  const env = { DB: d1(db) } as any;
  const none = await screeningSummary(env) as any;
  assert.equal(none.runs_total, 0);
  assert.equal(none.last_run_hit, null, 'no run read as "no match"');
  const run = db.prepare('INSERT INTO sanctions_screenings (user_id, provider, run_at, hit, reviewed_at) VALUES (1, ?, ?, ?, ?)');
  run.run('aggregate', '2026-10-12 09:00:00', 1, '2026-10-12 10:00:00');
  run.run('aggregate', '2026-10-20 09:00:00', 1, null);
  run.run('aggregate', '2026-11-05 16:20:00', 0, null);
  const s = await screeningSummary(env) as any;
  assert.deepEqual([s.runs_total, s.hits_total, s.unreviewed_hits, s.reviewed_hits, s.last_reviewed_at, s.last_run_hit],
    [3, 2, 1, 1, '2026-10-12 10:00:00', false]);
  run.run('aggregate', '2026-11-06 08:00:00', 1, null);
  assert.equal(((await screeningSummary(env)) as any).last_run_hit, true);
});

test('the admin Trust Center read carries the revision, the notices and when it was read', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_trust_center.ts'), 'utf8');
  assert.match(src, /publishedRevision\(c\.env\),\s*noticeDeliveries\(c\.env\),\s*\]\);/);
  assert.match(src, /revision,\s*notices,[\s\S]{0,200}read_at: new Date\(\)\.toISOString\(\),/);
});
