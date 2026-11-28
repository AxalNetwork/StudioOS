/**
 * #5343 batch 5 (#4568 R2-04 follow-up): ten service bootstraps off blind runtime ALTERs.
 *
 *   services/deckReviewSchema.ts        the pitch deck reviewer (`deck_id`, `deck_version`)
 *   services/telegramSchema.ts          Telegram channels and posts (`signature`, `scheduled_by`)
 *   services/subscriptionPlans.ts       the plan catalog (`currency`, `native_amount`, `native_interval`)
 *   services/authorWebsites.ts          author profile fields
 *   services/partnerDirectorySchema.ts  the service-provider directory flags
 *   services/promos.ts                  promo codes (migrations 629 and 630)
 *   services/networkProfilesSchema.ts   the network roster (dev and preview only)
 *   services/waitlistCrmSchema.ts       the waitlist CRM columns
 *   services/newsSchema.ts              articles (migrations 092 and 635)
 *   services/section83b.ts              the 83(b) filing record (migration 310)
 *
 * As batches 1 to 3: no ALTER and no duplicate-column error on the migrated schema across
 * fresh isolates; each missing column added once; a genuine failure is never remembered as
 * ready, is retried and recovers; two isolates together both succeed.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/runtime_ddl_5343_batch5.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { ensureDeckReviewSchema } from '../src/services/deckReviewSchema.ts';
import { ensureTelegramSchema } from '../src/services/telegramSchema.ts';
import { ensureSubscriptionPlansSchema } from '../src/services/subscriptionPlans.ts';
import { ensureAuthorWebsites } from '../src/services/authorWebsites.ts';
import { ensurePartnerDirectoryColumns } from '../src/services/partnerDirectorySchema.ts';
import { ensurePromoSchema } from '../src/services/promos.ts';
import { ensureNetworkProfilesSchema } from '../src/services/networkProfilesSchema.ts';
import { ensureWaitlistCrmColumns } from '../src/services/waitlistCrmSchema.ts';
import { ensureNewsSchema } from '../src/services/newsSchema.ts';
import { ensureSection83bSchema } from '../src/services/section83b.ts';

afterAll(() => removeMigratedDatabases());

/** A fresh isolate's binding over `db`: it records statements, ALTERs and errors, and may fail chosen statements. */
function isolate(db: DatabaseSync, fail?: (sql: string) => string | null) {
  const base = d1Over(db);
  const log = { alters: [] as string[], errors: [] as string[], sql: [] as string[] };
  const seen = (sql: string) => {
    log.sql.push(sql);
    if (/^\s*ALTER\b/i.test(sql)) log.alters.push(sql);
    const forced = fail?.(sql);
    if (forced) { log.errors.push(forced); throw new Error(forced); }
  };
  const wrap = (sql: string, st: any) => {
    const track = (f: () => Promise<any>) => async () => {
      seen(sql);
      try { return await f(); } catch (e) { log.errors.push(String((e as Error).message)); throw e; }
    };
    const api: any = { bind: (...a: unknown[]) => { st.bind(...a); return api; } };
    api.run = track(() => st.run()); api.all = track(() => st.all()); api.first = (c?: string) => track(() => st.first(c))();
    // `batch` runs each statement synchronously (the network-profiles CREATE goes this way).
    api.runSync = () => { seen(sql); return st.runSync(); };
    return api;
  };
  const DB = {
    prepare: (sql: string) => wrap(sql, base.prepare(sql)),
    batch: (s: any[]) => base.batch(s),
    exec: async (s: string) => {
      seen(s);
      try { return await base.exec(s); } catch (e) { log.errors.push(String((e as Error).message)); throw e; }
    },
  };
  return { env: { DB, ENVIRONMENT: 'development' } as any, log };
}
const columns = (db: DatabaseSync, t: string) => (db.prepare('SELECT name FROM pragma_table_info(?)').all(t) as any[]).map((r) => String(r.name));
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [e, w] = [console.error, console.warn];
  console.error = () => {}; console.warn = () => {};
  try { return await f(); } finally { console.error = e; console.warn = w; }
};
const BAD = /duplicate column|too many columns/i;

async function all(env: any) {
  await ensureDeckReviewSchema(env);
  await ensureTelegramSchema(env);
  await ensureSubscriptionPlansSchema(env);
  await ensureAuthorWebsites(env);
  await ensurePartnerDirectoryColumns(env);
  await ensurePromoSchema(env);
  await ensureNetworkProfilesSchema(env);
  await ensureWaitlistCrmColumns(env);
  await ensureNewsSchema(env);
  await ensureSection83bSchema(env);
}

/** Each table as it stood before the columns these bootstraps add, with what their indexes and seeds need. */
const PRE_COLUMN_TABLES = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);
  CREATE TABLE deck_reviews (id TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT, updated_at TEXT);
  CREATE TABLE telegram_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
    audience TEXT NOT NULL, is_invite_only INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE telegram_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER, status TEXT, created_at TEXT);
  CREATE TABLE subscription_plans (plan_id TEXT PRIMARY KEY, monthly_price_usd REAL NOT NULL, display_name TEXT, is_active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE author_websites (user_id INTEGER PRIMARY KEY, website_url TEXT NOT NULL);
  CREATE TABLE partners (id INTEGER PRIMARY KEY);
  CREATE TABLE promo_codes (id TEXT PRIMARY KEY, code TEXT, code_normalized TEXT, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE network_profiles (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER);
  CREATE TABLE articles (id INTEGER PRIMARY KEY, status TEXT, published_at TEXT, author_user_id INTEGER, updated_at TEXT, submitted_at TEXT);
  CREATE TABLE section_83b_trackers (id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, grant_date TEXT, deadline_date TEXT);`;

/** How many columns each bootstrap adds to a table that predates them. */
const ADDED: Record<string, number> = {
  deck_reviews: 2, telegram_channels: 1, telegram_posts: 1, subscription_plans: 3, author_websites: 4, partners: 4,
  promo_codes: 13, network_profiles: 4, waitlist_signups: 5, articles: 5, section_83b_trackers: 5,
};

test('#5343 batch 5: on an up-to-date database the ten bootstraps issue no ALTER and no duplicate-column error, across fresh isolates', async () => {
  const db = migratedDatabase();
  try {
    for (let k = 0; k < 3; k++) {
      const { env, log } = isolate(db);
      await quiet(() => all(env));
      await quiet(() => all(env));
      // Mutation checked: promos' 629 loop back on blind execs → nine ALTERs on every isolate.
      assert.deepEqual(log.alters, [], `isolate ${k}: no ALTER against an up-to-date database`);
      assert.deepEqual(log.errors.filter((e) => BAD.test(e)), [], `isolate ${k}: no duplicate-column error`);
      assert.equal(log.sql.filter((s) => /UPDATE telegram_channels SET signature/.test(s)).length, 0,
        `isolate ${k}: the signature backfill runs only when the column is added`);
    }
  } finally { db.close(); }
});

test('#5343 batch 5: a database missing each column gets it once; the next isolate issues none', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(PRE_COLUMN_TABLES);
    db.exec("INSERT INTO telegram_channels (slug, label, audience) VALUES ('fixture-channel', 'Fixture', 'public')");
    const first = isolate(db);
    await quiet(() => all(first.env));
    const added = (t: string) => first.log.alters.filter((a) => a.includes(`ALTER TABLE ${t} `)).length;
    assert.deepEqual(Object.fromEntries(Object.keys(ADDED).map((t) => [t, added(t)])), ADDED);
    for (const [t, c] of [
      ['deck_reviews', 'deck_version'], ['telegram_channels', 'signature'], ['telegram_posts', 'scheduled_by'],
      ['subscription_plans', 'native_interval'], ['author_websites', 'photo_url'], ['partners', 'directory_decided_by'],
      ['promo_codes', 'replaced_by'], ['promo_codes', 'first_purchase_only'], ['network_profiles', 'archived_at'],
      ['waitlist_signups', 'promoted_interview_id'], ['articles', 'approved_by'], ['section_83b_trackers', 'tax_return_copy_at'],
    ]) assert.ok(columns(db, t).includes(c), `${t}.${c}`);
    const fixture = db.prepare("SELECT signature FROM telegram_channels WHERE slug = 'fixture-channel'").get() as any;
    assert.notEqual(fixture.signature, null, 'the signature backfill ran once the column was added');
    const next = isolate(db);
    await quiet(() => all(next.env));
    assert.deepEqual(next.log.alters, [], 'the next fresh isolate finds them and issues none');
  } finally { db.close(); }
});

test('#5343 batch 5: a failing ALTER leaves each bootstrap unready; the next call tries again and adds the column', async () => {
  for (const [name, table, column, run] of [
    ['deck review', 'deck_reviews', 'deck_id', ensureDeckReviewSchema],
    ['telegram', 'telegram_posts', 'scheduled_by', ensureTelegramSchema],
    ['plans', 'subscription_plans', 'currency', ensureSubscriptionPlansSchema],
    ['author websites', 'author_websites', 'bio', ensureAuthorWebsites],
    ['partner directory', 'partners', 'directory_listed', ensurePartnerDirectoryColumns],
    ['promos', 'promo_codes', 'paused_at', ensurePromoSchema],
    ['network profiles', 'network_profiles', 'company', ensureNetworkProfilesSchema],
    ['waitlist crm', 'waitlist_signups', 'crm_status', ensureWaitlistCrmColumns],
    ['news', 'articles', 'excerpt', ensureNewsSchema],
    ['83(b)', 'section_83b_trackers', 'filing_method', ensureSection83bSchema],
  ] as const) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(PRE_COLUMN_TABLES);
      let broken = true;
      const { env } = isolate(db, (sql) => (broken && sql.trimStart().startsWith(`ALTER TABLE ${table} ADD COLUMN ${column} `) ? 'disk I/O error' : null));
      await quiet(async () => { try { await (run as any)(env); } catch { /* the failure itself */ } });
      assert.equal(columns(db, table).includes(column), false, `${name}: not added`);
      broken = false;
      // Mutation checked: waitlistCrm's per-ALTER warn-and-continue restored → the first call latches and this fails.
      await quiet(() => (run as any)(env));
      assert.equal(columns(db, table).includes(column), true, `${name}: the next call tried again and added it`);
    } finally { db.close(); }
  }
});

test('#5343 batch 5: the 83(b) bootstrap still throws a genuine failure, and is not remembered as ready', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(PRE_COLUMN_TABLES);
    let broken = true;
    const { env, log } = isolate(db, (sql) => (broken && /^ALTER TABLE section_83b_trackers ADD COLUMN tracking_number /.test(sql.trimStart()) ? 'disk I/O error' : null));
    await assert.rejects(ensureSection83bSchema(env), /disk I\/O error/);
    broken = false;
    const before = log.sql.length;
    await ensureSection83bSchema(env);
    assert.ok(log.sql.length > before, 'tried again rather than trusting a failed bootstrap');
    assert.ok(columns(db, 'section_83b_trackers').includes('tracking_number'));
  } finally { db.close(); }
});

test('#5343 batch 5: a missing table leaves the directory and waitlist bootstraps unready; they recover once it exists', async () => {
  for (const [name, table, create, column, run] of [
    ['partner directory', 'partners', 'CREATE TABLE partners (id INTEGER PRIMARY KEY)', 'directory_featured', ensurePartnerDirectoryColumns],
    ['waitlist crm', 'waitlist_signups', 'CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER)', 'followed_up_at', ensureWaitlistCrmColumns],
  ] as const) {
    const db = new DatabaseSync(':memory:');
    try {
      const { env, log } = isolate(db);
      // Mutation checked: partnerDirectory's ALTERs back inside a warn-and-continue → the binding latches ready here.
      await quiet(() => run(env));
      const before = log.sql.length;
      db.exec(create);
      await quiet(() => run(env));
      assert.ok(log.sql.length > before, `${name}: tried again rather than trusting a failed bootstrap`);
      assert.ok(columns(db, table).includes(column), `${name}: added once the table exists`);
    } finally { db.close(); }
  }
});

test('#5343 batch 5: two isolates starting together both succeed and add each column once', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(PRE_COLUMN_TABLES);
    const a = isolate(db), b = isolate(db);
    const some = (env: any) => Promise.all([ensureNewsSchema(env), ensureWaitlistCrmColumns(env), ensurePartnerDirectoryColumns(env), ensureSection83bSchema(env)]);
    await quiet(() => Promise.all([some(a.env), some(b.env)]));
    for (const [t, c] of [['articles', 'views'], ['waitlist_signups', 'crm_status'], ['partners', 'directory_listed'], ['section_83b_trackers', 'filing_method']]) {
      assert.equal(columns(db, t).filter((x) => x === c).length, 1, `${t}.${c}`);
    }
    const next = isolate(db);
    await quiet(() => some(next.env));
    assert.deepEqual(next.log.alters, [], 'a later isolate issues none');
  } finally { db.close(); }
});
