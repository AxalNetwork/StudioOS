/** D4440 (#4440): real Worker reads/writes with the client's dirty choices, over baseline + migration 710. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router from '../src/routes/event_syndication.ts';
import { clearSyndicationChannelsForTest } from '../src/services/eventSyndication/channels.ts';
import { fakeAdapter } from './_syndication_fake.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { choicesOf } from '../../frontend/src/pages/hq/eventSyndication/syndicationModel.js';

const secret = 'synthetic-syndication-review-secret-'.repeat(2);
async function fixture() {
  clearSyndicationChannelsForTest(); fakeAdapter('eventbrite'); fakeAdapter('linkedin');
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  for (const name of ['users', 'events']) db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  db.exec(tableFromBaseline(readFileSync(new URL('../sql/migrations/241_advisor_money_model.sql', import.meta.url), 'utf8'), 'platform_settings'));
  db.exec(readFileSync(new URL('../sql/migrations/710_event_syndication.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users (id,email,name,role) VALUES (1,'host@synthetic.test','Host','founder');
    INSERT INTO events (id,slug,title,type,host_user_id,visibility,status,starts_at) VALUES (42,'synthetic','Synthetic','meetup',1,'public','draft','2099-03-01T18:00:00Z');
    INSERT INTO event_channel_accounts (id,uid,channel,owner_kind,external_account_id,display_name,credentials_enc,connected_by)
    VALUES (1,'old','eventbrite','hq','old','Old account','synthetic',1),(2,'live','linkedin','hq','live','Live account','synthetic',1);
    INSERT INTO event_syndications (uid,event_id,account_id,channel,status,overrides_json,external_url,posted_at)
    VALUES ('s-old',42,1,'eventbrite','withdrawn','{"title":"History"}','https://listing.synthetic.test/old','2026-10-01'),
      ('s-live',42,2,'linkedin','selected','{"title":"Accepted through Ask","description":"Kept"}',NULL,NULL)`);
  const app = new Hono<any>().route('/api/events', router);
  const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  async function call(method = 'GET', channels?: any[]) {
    const res = await app.request('/api/events/42/syndication', { method, headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(channels ? { body: JSON.stringify({ channels }) } : {}) }, { DB: d1Over(db), JWT_SECRET: secret, APP_URL: 'https://synthetic.test' } as any);
    return { status: res.status, body: await res.json() as any };
  }
  return { db, call };
}

test('2: an unrelated choice preserves every terminal row, its listing URL and posted history', async () => {
  const { db, call } = await fixture();
  try {
    for (const status of ['withdrawn', 'cancelled', 'skipped', 'posted']) {
      db.prepare('UPDATE event_syndications SET status=? WHERE uid=?').run(status, 's-old');
      const before = db.prepare("SELECT * FROM event_syndications WHERE uid='s-old'").get();
      const read = await call();
      const choices = choicesOf(read.body.rows, new Set(['live']), new Set());
      const result = await call('PUT', choices);
      assert.equal(result.status, 200);
      assert.deepEqual(db.prepare("SELECT * FROM event_syndications WHERE uid='s-old'").get(), before, status);
    }
  } finally { db.close(); clearSyndicationChannelsForTest(); }
});

test('3: the historical disconnected account is visible, unavailable and omitted from a valid Save', async () => {
  const { db, call } = await fixture();
  try {
    db.exec("UPDATE event_channel_accounts SET status='disconnected' WHERE uid='old'");
    const read = await call(); const old = read.body.rows.find((r: any) => r.account_uid === 'old');
    assert.equal(old.external_url, 'https://listing.synthetic.test/old');
    assert.equal(old.adapter_ready, false);
    const choices = choicesOf(read.body.rows, new Set(['old', 'live']), new Set());
    assert.deepEqual(choices.map((r: any) => r.account_uid), ['live']);
    assert.equal((await call('PUT', choices)).status, 200);
  } finally { db.close(); clearSyndicationChannelsForTest(); }
});

test('4: a choice-only PUT omitting overrides keeps the latest accepted copy in the Worker', async () => {
  const { db, call } = await fixture();
  try {
    const result = await call('PUT', [{ account_uid: 'live', on: true }]);
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(String(db.prepare("SELECT overrides_json FROM event_syndications WHERE uid='s-live'").get()!.overrides_json)), { title: 'Accepted through Ask', description: 'Kept' });
  } finally { db.close(); clearSyndicationChannelsForTest(); }
});
