/** #2411: real SQLite rows must reach the shared name/consent linter and send gates. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { tableFromBaseline } from './_baseline.mjs';
import { lintForSend } from '../src/services/telegramRedactCheck.ts';
import { sendTelegramPost } from '../src/routes/admin_telegram.ts';
import { sendXPost } from '../src/routes/admin_x.ts';
import { ensureTelegramSchema } from '../src/services/telegramSchema.ts';
import { ensureXSchema } from '../src/services/xSchema.ts';

const NAME = 'Example Member';
const TEXT = 'A milestone for EXAMPLE MEMBER today.';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  for (const table of ['users', 'user_promotion_consent', 'admin_audit_log']) db.exec(tableFromBaseline(baseline, table));
  db.prepare('INSERT INTO users (id, email, name, full_legal_name) VALUES (?, ?, ?, ?)').run(1, 'member@example.test', 'Display name', NAME);
  const DB = {
    prepare(sql: string) {
      let args: any[] = [];
      const query: any = {
        bind(...values: any[]) { args = values; return query; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return query;
    },
    async exec(sql: string) { db.exec(sql); },
    async batch(queries: any[]) { return Promise.all(queries.map(q => q.run())); },
  };
  const cache = new Map<string, string>();
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: 'synthetic-name-scan-fixture-key-'.repeat(2), TELEGRAM_BOT_TOKEN: 'fixture-bot',
    RATE_LIMITS: { async get(k: string) { return cache.get(k) ?? null; }, async put(k: string, v: string) { cache.set(k, v); } } };
  return { db, env };
}

test('#2411: canonical legal name produces a blocking finding with the correct highlight', async () => {
  const { db, env } = fixture();
  try {
    const result = await lintForSend(env, TEXT, 'public');
    assert.equal(result.ok, false);
    assert.deepEqual(result.findings.map(({ kind, severity, match, user_id, offset, length }) => ({ kind, severity, match, user_id, offset, length })), [
      { kind: 'private_in_public', severity: 'high', match: NAME, user_id: 1, offset: TEXT.indexOf('EXAMPLE MEMBER'), length: NAME.length },
    ]);
    assert.equal((await lintForSend(env, 'An aggregate milestone today.', 'public')).ok, true);
    assert.equal((await lintForSend(env, 'Display name', 'public')).ok, true, 'display name is not a legal-name match');
  } finally { db.close(); }
});

test('#2411: public mentions remain blocked even with consent; private mentions follow consent', async () => {
  const { db, env } = fixture();
  try {
    for (const consented of [null, 0, 1]) {
      db.exec('DELETE FROM user_promotion_consent');
      if (consented !== null) db.prepare('INSERT INTO user_promotion_consent (user_id, consented) VALUES (?, ?)').run(1, consented);
      const privateResult = await lintForSend(env, TEXT, 'investors');
      assert.equal(privateResult.ok, consented === 1);
      assert.deepEqual(privateResult.findings.map(f => f.kind), consented === 1 ? [] : ['consent_missing']);
      const publicResult = await lintForSend(env, TEXT, 'public');
      assert.equal(publicResult.ok, false);
      assert.deepEqual(publicResult.findings.map(f => f.kind), ['private_in_public']);
    }
  } finally { db.close(); }
});

test('#2411: email detection and deduplication survive the restored name scan', async () => {
  const { db, env } = fixture();
  try {
    const result = await lintForSend(env, `${TEXT} Contact member@example.test.`, 'public');
    assert.equal(result.ok, false);
    assert.deepEqual(result.findings.map(f => f.kind), ['email', 'private_in_public']);
    assert.equal(result.findings[1].user_id, 1);
    assert.equal(result.findings[1].match, 'member@example.test');
    db.prepare('UPDATE users SET full_legal_name = ? WHERE id = ?').run('Short', 1);
    assert.equal((await lintForSend(env, 'Short', 'public')).ok, true);
    db.prepare('UPDATE users SET full_legal_name = ? WHERE id = ?').run('Mononym', 1);
    assert.equal((await lintForSend(env, 'Mononym', 'public')).ok, true);
  } finally { db.close(); }
});

test('#2411: Telegram and X refuse name-only posts before making a provider request', async () => {
  const { db, env } = fixture();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error('Unexpected provider request'); };
  try {
    await ensureTelegramSchema(env);
    await ensureXSchema(env);
    db.exec('DELETE FROM telegram_channels');
    db.prepare("INSERT INTO telegram_channels (id, slug, label, chat_id, audience, enabled) VALUES (1, 'fixture', 'Fixture', '-100123', 'public', 1)").run();
    db.prepare("INSERT INTO x_accounts (id, handle, enabled) VALUES (1, 'fixture', 1)").run();
    for (const mode of ['click', 'clock'] as const) {
      const status = mode === 'clock' ? 'scheduled' : 'draft';
      const tg = db.prepare("INSERT INTO telegram_posts (channel_id, audience, status, body_md, created_by, scheduled_for) VALUES (1, 'public', ?, ?, 1, '2000-01-01T00:00:00Z')").run(status, TEXT);
      const xp = db.prepare("INSERT INTO x_posts (account_id, status, body, created_by, scheduled_for) VALUES (1, ?, ?, 1, '2000-01-01T00:00:00Z')").run(status, TEXT);
      const opts = { actor: { id: 1, email: 'operator@example.test' }, mode, dueBy: '2026-10-23T00:00:00Z' };
      for (const result of [await sendTelegramPost(env, Number(tg.lastInsertRowid), opts), await sendXPost(env, Number(xp.lastInsertRowid), opts)]) {
        assert.equal(result.status, 422, JSON.stringify(result.body));
        assert.equal(result.body.error, 'pii_linter_blocked');
        assert.deepEqual((result.body.findings as any[]).map(f => f.kind), ['private_in_public']);
      }
    }
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
