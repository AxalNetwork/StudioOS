/**
 * D710 (#1775) — the read-only sync: what is kept, idempotence, the cap, the
 * cron's scope and the run rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_sync_d710.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { syncAllMercuryEntityConnections, syncConnection, RUN_CAP } from '../src/services/mercury/sync.ts';
import { toCents } from '../src/services/mercury/parse.ts';
import {
  JTI, SUPER, TOKEN, account, appFor, call, envFor, freshDb, mercuryStub, one, rows, settled, withRegistry, type StubState,
} from './_mercury_fixture.ts';

const ACCOUNT_DIGITS = '908172631111';
const ROUTING = '000000017';
const MEMO_RUN = '445566778899';
const EIN = '98-7654321';

function state(): StubState {
  return {
    accounts: [account('acc-gp-chk', 'checking', '1111'), account('acc-gp-sav', 'savings', '2222')],
    org: { id: 'org-1', legalBusinessName: 'Axal VC GP LLC', ein: EIN, address: { line1: '1 Example Way' } },
    txns: { 'acc-gp-chk': [], 'acc-gp-sav': [] },
  };
}

async function connected(st: StubState = state()) {
  const db = freshDb();
  withRegistry(db, [['gp', 'checking', '1111'], ['gp', 'savings', '2222']]);
  const stub = mercuryStub(st);
  const app = appFor({ fetcher: stub.fetcher });
  const env = envFor(db);
  const r = await call(app, env, 'PUT', '/connections/gp', SUPER, { jti: JTI.superFresh, body: { api_token: TOKEN, confirm_read_only: true } });
  assert.equal(r.status, 200, r.text);
  await settled(db);
  const conn = one(db, 'SELECT * FROM mercury_entity_connections');
  return { db, stub, app, env, conn, st, connectBody: r.text };
}

/** Everything a test can see: every table cell, as one string. */
function everyCell(db: any): string {
  const tables = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
  return tables.map((t) => JSON.stringify(rows(db, `SELECT * FROM "${t}"`))).join('\n');
}

test('minimisation: no account or routing number, memo digit run or EIN reaches a row, response or console line', async () => {
  const st = state();
  st.txns['acc-gp-chk'] = [
    { id: 'tx-1', amount: 1500.25, createdAt: '2026-10-01T10:00:00Z', postedAt: '2026-10-02T10:00:00Z', status: 'sent', kind: 'incomingDomesticWire',
      counterpartyName: 'Example LP', externalMemo: `wire ref ${MEMO_RUN} thanks`, accountNumber: ACCOUNT_DIGITS, routingNumber: ROUTING },
    { id: 'tx-eur', amount: 10, createdAt: '2026-10-03T10:00:00Z', status: 'sent', currency: 'EUR' },
    { id: 'tx-frac', amount: 1.005, createdAt: '2026-10-03T11:00:00Z', status: 'sent' },
  ];
  const logs: string[] = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of ['log', 'info', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  let s;
  try {
    s = await connected(st);
    await call(s.app, s.env, 'POST', '/connections/gp/sync', SUPER, { jti: JTI.superFresh });
    const reads = await Promise.all(['/connections', '/accounts', '/transactions', '/matches'].map((p) => call(s!.app, s!.env, 'GET', p, SUPER, { jti: JTI.superFresh })));
    const seen = [everyCell(s.db), s.connectBody, ...reads.map((r) => r.text), ...logs].join('\n');
    for (const secret of [ACCOUNT_DIGITS, ROUTING, MEMO_RUN, EIN, TOKEN]) assert.ok(!seen.includes(secret), `${secret} leaked`);
    const tx = one(s.db, "SELECT * FROM mercury_transactions WHERE mercury_transaction_id = 'tx-1'");
    assert.deepEqual([tx.amount_cents, tx.memo, tx.created_on, tx.posted_on], [150025, 'wire ref ••••8899 thanks', '2026-10-01', '2026-10-02']);
    assert.deepEqual(rows(s.db, 'SELECT last_four FROM mercury_accounts ORDER BY last_four').map((a) => a.last_four), ['1111', '2222']);
    assert.equal(rows(s.db, "SELECT * FROM mercury_transactions WHERE mercury_transaction_id IN ('tx-eur', 'tx-frac')").length, 0, 'refused');
    assert.ok(rows(s.db, 'SELECT refused_count FROM mercury_sync_runs').some((r) => r.refused_count === 2), 'and counted');
  } finally { Object.assign(console, orig); }
  assert.deepEqual([toCents(12.3), toCents('12.30'), toCents(0.1 + 0.2), toCents(1.005), toCents('1.005'), toCents('abc')], [1230, 1230, 30, null, null, null]);
});

test('idempotence: a second sync adds nothing; a pending line that posts is updated in place, even when old; one snapshot a day', async () => {
  const st = state();
  st.txns['acc-gp-chk'] = [
    { id: 'tx-old-pending', amount: 900, createdAt: '2026-08-01T10:00:00Z', postedAt: null, status: 'pending' },
    { id: 'tx-new', amount: 50, createdAt: '2026-10-10T10:00:00Z', postedAt: '2026-10-10T12:00:00Z', status: 'sent' },
  ];
  const s = await connected(st);
  const count = () => one(s.db, 'SELECT COUNT(*) AS n FROM mercury_transactions').n;
  assert.equal(count(), 2);
  const again = await syncConnection(s.env, s.conn.id, 'cron', { fetcher: s.stub.fetcher });
  assert.equal(again.status, 'ok');
  assert.deepEqual([count(), (again as any).stored], [2, 0], 'nothing new');
  // The old pending line posts. The watermark reads back to it, though it is
  // more than ten days before the newest line.
  st.txns['acc-gp-chk'][0] = { ...st.txns['acc-gp-chk'][0], postedAt: '2026-10-12T09:00:00Z', status: 'sent' };
  await syncConnection(s.env, s.conn.id, 'cron', { fetcher: s.stub.fetcher });
  const posted = one(s.db, "SELECT * FROM mercury_transactions WHERE mercury_transaction_id = 'tx-old-pending'");
  assert.deepEqual([count(), posted.status, posted.posted_on], [2, 'sent', '2026-10-12']);
  assert.equal(one(s.db, 'SELECT COUNT(*) AS n FROM mercury_balance_snapshots').n, 2, 'one per account per day');
});

test('the cap: 2,500 lines are stored 2,000 oldest first and `partial`, then the rest on the next run', async () => {
  const st = state();
  const lines = [];
  for (let i = 0; i < 2500; i++) {
    const d = new Date(Date.UTC(2025, 0, 1, i * 6));
    lines.push({ id: `tx-${String(i).padStart(5, '0')}`, amount: i + 1, createdAt: d.toISOString(), postedAt: d.toISOString(), status: 'sent' });
  }
  st.txns['acc-gp-chk'] = lines;
  const s = await connected(st);
  const first = one(s.db, 'SELECT * FROM mercury_sync_runs ORDER BY id LIMIT 1');
  assert.deepEqual([first.status, first.transactions_seen], ['partial', RUN_CAP]);
  assert.equal(one(s.db, 'SELECT COUNT(*) AS n FROM mercury_transactions').n, 2000);
  assert.equal(one(s.db, 'SELECT MAX(mercury_transaction_id) AS m FROM mercury_transactions').m, 'tx-01999', 'oldest first');
  const second = await syncConnection(s.env, s.conn.id, 'cron', { fetcher: s.stub.fetcher });
  assert.equal(second.status, 'ok');
  assert.equal(one(s.db, 'SELECT COUNT(*) AS n FROM mercury_transactions').n, 2500, 'nothing skipped');
});

test('the cron: nothing on a branch; on HQ only active connections; an undecryptable token or a 401 stops only its own', async () => {
  const s = await connected();
  const branch = await syncAllMercuryEntityConnections(envFor(s.db, { BRANCH_CODE: 'ldn' }), { fetcher: s.stub.fetcher });
  assert.deepEqual(branch, { scanned: 0, ok: 0, failed: 0 });
  // A second, Holdings connection whose token does not decrypt.
  s.db.exec(`INSERT INTO mercury_entity_connections (uid, entity_key, status, credentials_enc, connected_by)
             VALUES ('c-holdings', 'holdings', 'active', 'v1.not-a-real-ciphertext', ${SUPER})`);
  const hq = await syncAllMercuryEntityConnections(s.env, { fetcher: s.stub.fetcher });
  assert.deepEqual(hq, { scanned: 2, ok: 1, failed: 1 });
  assert.deepEqual([one(s.db, "SELECT status, last_error FROM mercury_entity_connections WHERE uid = 'c-holdings'").status,
    one(s.db, "SELECT last_error FROM mercury_entity_connections WHERE uid = 'c-holdings'").last_error], ['error', 'token_unreadable']);
  assert.equal(one(s.db, "SELECT status FROM mercury_entity_connections WHERE entity_key = 'gp'").status, 'active', 'the GP keeps syncing');
  // A 401 turns the GP's connection `error`, and the next run skips it.
  s.st.status = 401;
  await syncAllMercuryEntityConnections(s.env, { fetcher: s.stub.fetcher });
  assert.deepEqual({ ...one(s.db, "SELECT status, last_error FROM mercury_entity_connections WHERE entity_key = 'gp'") }, { status: 'error', last_error: 'unauthorized' });
  const before = s.stub.calls.length;
  assert.deepEqual(await syncAllMercuryEntityConnections(s.env, { fetcher: s.stub.fetcher }), { scanned: 0, ok: 0, failed: 0 });
  assert.equal(s.stub.calls.length, before, 'skipped');
  // A 429 keeps a connection active.
  s.db.exec("UPDATE mercury_entity_connections SET status = 'active' WHERE entity_key = 'gp'");
  s.st.status = 429;
  await syncAllMercuryEntityConnections(s.env, { fetcher: s.stub.fetcher });
  assert.deepEqual({ ...one(s.db, "SELECT status, last_error FROM mercury_entity_connections WHERE entity_key = 'gp'") }, { status: 'active', last_error: 'rate_limited' });
});

test('one run at a time; sync now once in five minutes; a run row holds counts and a code, never a body', async () => {
  const s = await connected();
  s.db.exec(`INSERT INTO mercury_sync_runs (connection_id, trigger, status) VALUES (${s.conn.id}, 'cron', 'running')`);
  assert.deepEqual(await syncConnection(s.env, s.conn.id, 'manual', { fetcher: s.stub.fetcher }), { status: 'sync_in_progress' });
  s.db.exec("UPDATE mercury_sync_runs SET status = 'ok' WHERE status = 'running'");
  const first = await call(s.app, s.env, 'POST', '/connections/gp/sync', SUPER, { jti: JTI.superFresh });
  assert.equal(first.status, 200, first.text);
  const soon = await call(s.app, s.env, 'POST', '/connections/gp/sync', SUPER, { jti: JTI.superFresh });
  assert.equal(soon.status, 429);
  assert.ok(Number(soon.headers.get('Retry-After')) > 0);
  s.st.status = 500;
  s.db.exec("UPDATE mercury_entity_connections SET last_sync_requested_at = NULL");
  const failed = await call(s.app, s.env, 'POST', '/connections/gp/sync', SUPER, { jti: JTI.superFresh });
  assert.equal(failed.body.sync.code, 'http_error');
  const last = one(s.db, 'SELECT * FROM mercury_sync_runs ORDER BY id DESC LIMIT 1');
  assert.deepEqual([last.status, last.error_code], ['error', 'http_error']);
  assert.ok(!JSON.stringify(rows(s.db, 'SELECT * FROM mercury_sync_runs')).includes('stub'), 'no response body is stored');
  assert.equal(one(s.db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'mercury_sync_requested'").n >= 1, true);
  // The cipher is the one the connect used; a hand-written token decrypts.
  assert.match(await encryptColumn(s.env, 'mercury_entity_connections', 'credentials_enc', 'x', 'y'), /^v1\./);
});
