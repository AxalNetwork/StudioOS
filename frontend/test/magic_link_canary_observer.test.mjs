// A scheduled check must certify its own Worker invocation using read-only D1 observations.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { latestCanarySlot, observeCanary } from '../../scripts/check-magic-link-canary.mjs';

const address = 'canary@example.invalid';
const slot = Date.UTC(2026, 10, 17, 3, 45);
const now = slot + 15 * 60_000;
const receipt = { slot, state: 'complete', startedAt: slot + 10_000, startMs: 123, startStatus: 202, tokenId: 10, sendId: 20 };

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE platform_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE magic_link_tokens (id INTEGER PRIMARY KEY, email TEXT, created_at TEXT);
    CREATE TABLE email_send_log (id INTEGER PRIMARY KEY, to_addr TEXT, template_key TEXT, status TEXT, enqueued_at TEXT, sent_at TEXT);
  `);
  db.prepare("INSERT INTO magic_link_tokens VALUES (10, ?, datetime(?, 'unixepoch'))").run(address, slot / 1000 + 10);
  db.prepare("INSERT INTO email_send_log VALUES (20, ?, 'auth_magic_link', 'sent', datetime(?, 'unixepoch'), datetime(?, 'unixepoch'))")
    .run(address, slot / 1000 + 11, slot / 1000 + 20);
  const write = (value) => db.prepare("INSERT OR REPLACE INTO platform_settings VALUES ('magic_link_insert_canary_v1', ?)").run(value);
  write(JSON.stringify(receipt));
  const observe = (at = now) => observeCanary((sql, params) => {
    assert.match(sql.trim(), /^SELECT\s/i);
    assert.ok(params.every((value) => typeof value === 'string'), 'D1 REST query params must all be strings');
    return db.prepare(sql).all(...params);
  }, address, at);
  return { db, observe, write };
}

test('the observer selects the previous scheduled Worker slot including across midnight', () => {
  assert.equal(latestCanarySlot(slot), slot);
  assert.equal(latestCanarySlot(now), slot);
  assert.equal(latestCanarySlot(slot - 1), Date.UTC(2026, 10, 16, 23, 45));
  assert.equal(latestCanarySlot(Date.UTC(2026, 10, 17)), Date.UTC(2026, 10, 16, 23, 45));
  assert.equal(latestCanarySlot(slot + 4 * 3_600_000), slot + 4 * 3_600_000);
});

test('only matching token, address and template can pass despite other successful sign-ins', async (t) => {
  const { db, observe, write } = fixture(t);
  assert.equal((await observe()).code, 0);
  for (const changed of [{ tokenId: 11 }, { sendId: 21 }, { sendId: null }, { tokenId: null }]) {
    write(JSON.stringify({ ...receipt, ...changed }));
    assert.equal((await observe()).code, 1);
  }
  write(JSON.stringify(receipt));
  db.prepare("UPDATE email_send_log SET template_key = 'other'").run();
  assert.equal((await observe()).code, 1);
  db.prepare("UPDATE email_send_log SET template_key = 'auth_magic_link', to_addr = 'other@example.invalid'").run();
  assert.equal((await observe()).code, 1);
  db.prepare('UPDATE email_send_log SET to_addr = ?').run(address);
  db.prepare("UPDATE magic_link_tokens SET email = 'other@example.invalid'").run();
  assert.equal((await observe()).code, 1);
});

test('stale, future, malformed, unfinished and unreadable observations fail closed', async (t) => {
  const { db, observe, write } = fixture(t);
  db.exec('DELETE FROM platform_settings');
  assert.equal((await observe()).code, 2);
  for (const value of ['{', 'null', JSON.stringify({ ...receipt, slot: slot - 4 * 3_600_000 }),
    JSON.stringify({ ...receipt, slot: slot + 4 * 3_600_000 })]) {
    write(value);
    assert.equal((await observe()).code, 2);
  }
  for (const change of [{ state: 'running' }, { state: 'unknown' }, { state: 'error', startedAt: null },
    { state: 'error', startedAt: now + 1 }, { startedAt: now + 1 }, { startMs: -1 },
    { tokenId: '10' }, { sendId: -1 }, { startStatus: null }]) {
    write(JSON.stringify({ ...receipt, ...change }));
    assert.equal((await observe()).code, 2);
  }
  const record = await observeCanary(() => null, address, now);
  assert.equal(record.code, 2);
  const rows = await observeCanary((sql) => sql.includes('platform_settings') ? [{ value: JSON.stringify(receipt) }] : null, address, now);
  assert.equal(rows.code, 2);
});

test('the observer distinguishes an origin failure from incomplete observation and enforces timing budgets', async (t) => {
  const { db, observe, write } = fixture(t);
  for (const change of [{ state: 'error', startStatus: null }, { startStatus: 403 }, { startMs: 5001 }]) {
    write(JSON.stringify({ ...receipt, ...change }));
    assert.equal((await observe()).code, 1);
  }
  write(JSON.stringify(receipt));
  const epoch = slot / 1000;
  db.prepare("UPDATE email_send_log SET sent_at = datetime(?, 'unixepoch')").run(epoch + 190);
  assert.equal((await observe()).code, 0); // Within exactly 180 s of actual dispatch.
  db.prepare("UPDATE email_send_log SET sent_at = datetime(?, 'unixepoch')").run(epoch + 191);
  assert.equal((await observe()).code, 1);
  db.prepare("UPDATE magic_link_tokens SET created_at = datetime(?, 'unixepoch')").run(epoch + 26);
  db.prepare("UPDATE email_send_log SET enqueued_at = datetime(?, 'unixepoch'), sent_at = datetime(?, 'unixepoch')").run(epoch + 26, epoch + 27);
  assert.match((await observe()).detail, /token_row_written exceeded/);
  db.prepare("UPDATE magic_link_tokens SET created_at = datetime(?, 'unixepoch')").run(epoch + 10);
  db.prepare("UPDATE email_send_log SET status = 'queued', sent_at = NULL").run();
  assert.equal((await observe(slot + 30_000)).code, 2);
  assert.equal((await observe()).code, 1);
  for (const state of ['failed', 'dlq']) {
    db.prepare('UPDATE email_send_log SET status = ?').run(state);
    assert.equal((await observe()).code, 1);
  }
  db.prepare("UPDATE email_send_log SET status = 'sent'").run();
  assert.equal((await observe()).code, 2); // Missing provider timestamp.
  db.prepare("UPDATE email_send_log SET sent_at = datetime(?, 'unixepoch')").run(epoch + 5);
  assert.equal((await observe()).code, 2); // A send predating the request.
});

test('the scheduled CLI sends read queries only and reports its coverage in the Actions summary', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduled-magic-link-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stub = join(dir, 'cloudflare.mjs');
  const summary = join(dir, 'summary.md');
  writeFileSync(stub, `
    import assert from 'node:assert/strict';
    const receipt = JSON.parse(process.env.CANARY_RECEIPT);
    Date.now = () => ${now};
    globalThis.fetch = async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://api.cloudflare.com');
      let result;
      if (url.pathname.endsWith('/d1/database')) {
        result = [{ name: 'studioos-db', uuid: 'fixture' }];
      } else {
        assert.ok(url.pathname.endsWith('/d1/database/fixture/query'));
        const { sql, params } = JSON.parse(options.body);
        assert.match(sql.trimStart(), /^SELECT /i);
        const rows = sql.includes('platform_settings') ? [{ value: JSON.stringify(receipt) }] : [{
          token_id: 10, send_id: 20, created_ms: receipt.startedAt,
          enqueued_ms: receipt.startedAt, sent_ms: receipt.startedAt + 1000, status: 'sent',
        }];
        if (sql.includes('magic_link_tokens')) assert.deepEqual(params, ['10', '${address}', '20', '${address}', 'auth_magic_link']);
        result = [{ success: true, results: rows }];
      }
      return Response.json({ success: true, result });
    };
  `);
  for (const [state, status] of [['complete', 0], ['running', 2]]) {
    writeFileSync(summary, '');
    const result = spawnSync(process.execPath, ['--import', stub, 'scripts/check-magic-link-canary.mjs'], {
      encoding: 'utf8', timeout: 5_000,
      env: {
        GITHUB_STEP_SUMMARY: summary, MAGIC_PROBE_EMAIL: address.toUpperCase(),
        CLOUDFLARE_ACCOUNT_ID: 'fixture', CLOUDFLARE_API_TOKEN: 'fixture',
        CANARY_RECEIPT: JSON.stringify({ ...receipt, state }),
      },
    });
    assert.equal(result.status, status, result.stdout + result.stderr);
    const report = readFileSync(summary, 'utf8');
    assert.match(report, /Public-edge access, inbox delivery, and sign-in remain unverified/);
    assert.match(report, state === 'complete' ? /Application checks passed/ : /Incomplete observation/);
  }
});
