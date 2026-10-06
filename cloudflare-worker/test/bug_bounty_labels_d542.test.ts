/**
 * D542 — bounty labels on a mirrored ticket issue, as the webhook reads them.
 *
 * The route tests sign each delivery with the webhook secret and send it
 * through the real router (`routes/github.ts`) against a real `node:sqlite`
 * `tickets` table from schema_baseline.sql. The one outbound call (closing
 * the GitHub issue on a not-a-bug or duplicate outcome) is caught by a stub
 * of `fetch`, so the test sees exactly what would have been sent.
 *
 * Covered here: the allowlist, the tier → rule map, the closing outcomes,
 * the state a ticket's labels describe, and the signature check left as it
 * was. The grant and the revoke themselves are `bug_bounty_grants_d542`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';

import github from '../src/routes/github.ts';
import {
  bountyLabelEvent, bountyStateFromLabels, bountySourceRef, parseGranters, BOUNTY_TIER_RULES,
} from '../src/services/bugBounties.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { freshDb as perksDb, FOUNDER } from './_perks_harness.ts';

// Generated per run: a webhook secret written into source is one Semgrep
// rightly flags, even in a test.
const SECRET = randomBytes(32).toString('hex');
const S1 = 'guillaumelauzier';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const WRANGLER = readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

// The perk ledger, the reward rules (migration 381) and the users come from
// the Perks harness, so a verified tier is paid by the real grant service.
function freshDb() {
  const db = perksDb();
  db.exec(ddl('tickets'));
  for (const col of ['github_issue_number INTEGER', 'github_labels TEXT', 'github_assignees TEXT', 'github_updated_at TEXT', "type TEXT NOT NULL DEFAULT 'task'"]) {
    try { db.exec(`ALTER TABLE tickets ADD COLUMN ${col}`); } catch { /* the baseline already has it */ }
  }
  db.prepare(
    `INSERT INTO tickets (id, title, status, priority, user_id, github_issue_number, type)
     VALUES (41, 'Export button 500s', 'open', 'medium', ${FOUNDER}, 900, 'bug')`,
  ).run();
  return db;
}

const env = (db: any, over: Record<string, unknown> = {}) => ({
  DB: d1Over(db),
  GITHUB_WEBHOOK_SECRET: SECRET,
  GITHUB_ACCESS_TOKEN: 'unit-test-token',
  GITHUB_REPO_OWNER: 'AxalNetwork',
  GITHUB_REPO_NAME: 'StudioOS',
  BOUNTY_GRANTERS: S1,
  ...over,
}) as any;

let delivery = 0;
async function deliver(db: any, body: Record<string, unknown>, opts: { env?: any; sign?: string | null; id?: string } = {}) {
  const raw = JSON.stringify(body);
  const sig = opts.sign === undefined
    ? `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`
    : opts.sign;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'X-GitHub-Event': 'issues',
    'X-GitHub-Delivery': opts.id ?? `delivery-${++delivery}`,
  };
  if (sig) headers['X-Hub-Signature-256'] = sig;
  const res = await github.fetch(new Request('http://x/webhook', { method: 'POST', headers, body: raw }), opts.env ?? env(db));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

function labelEvent(action: 'labeled' | 'unlabeled', label: string, sender: string, labels: string[], state = 'open') {
  return {
    action,
    label: { name: label },
    sender: { login: sender },
    issue: {
      number: 900,
      state,
      state_reason: null,
      labels: labels.map((name) => ({ name })),
      assignees: [],
      updated_at: new Date().toISOString(),
    },
  };
}

const ticket = (db: any) => db.prepare('SELECT status, github_labels FROM tickets WHERE id = 41').get() as any;

/** Every outbound GitHub call the route makes, captured instead of sent. */
function captureFetch() {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ number: 900, state: 'closed' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// ───────────────────────────────────────────────────────── pure rules ──

test('each verified tier maps to its rule, and the source ref is one per ticket', () => {
  const granters = parseGranters(S1);
  for (const [label, rule] of [['bounty:verified-high', 'bug_high'], ['bounty:verified-medium', 'bug_medium'], ['bounty:verified-low', 'bug_low']]) {
    const e = bountyLabelEvent({ action: 'labeled', label, sender: S1, granters });
    assert.deepEqual(e, { kind: 'tier_added', label, ruleKey: rule });
    const r = bountyLabelEvent({ action: 'unlabeled', label, sender: S1, granters });
    assert.deepEqual(r, { kind: 'tier_removed', label, ruleKey: rule });
  }
  assert.equal(Object.keys(BOUNTY_TIER_RULES).length, 3);
  assert.equal(bountySourceRef(41), 'bounty:ticket:41');
});

test('the allowlist: empty means nobody, logins match case-insensitively, a stranger is refused', () => {
  assert.equal(parseGranters('').size, 0);
  assert.equal(parseGranters(undefined).size, 0);
  assert.deepEqual([...parseGranters(' GuillaumeLauzier , other-bot\nthird ')].sort(), ['guillaumelauzier', 'other-bot', 'third']);
  const nobody = bountyLabelEvent({ action: 'labeled', label: 'bounty:verified-high', sender: S1, granters: parseGranters('') });
  assert.equal(nobody.kind, 'refused', 'an unset allowlist let a label through');
  const stranger = bountyLabelEvent({ action: 'labeled', label: 'bounty:verified-high', sender: 'drive-by', granters: parseGranters(S1) });
  assert.equal(stranger.kind, 'refused');
  const noSender = bountyLabelEvent({ action: 'labeled', label: 'bounty:verified-high', sender: null, granters: parseGranters(S1) });
  assert.equal(noSender.kind, 'refused');
  const ordinary = bountyLabelEvent({ action: 'labeled', label: 'priority: high', sender: 'drive-by', granters: parseGranters(S1) });
  assert.equal(ordinary.kind, 'ignored', 'an ordinary label is not a bounty matter');
});

test('a ticket\'s bounty state comes from its labels, most decisive first', () => {
  assert.deepEqual(bountyStateFromLabels([], 'bug'), { state: 'under_review' });
  assert.equal(bountyStateFromLabels([], 'feature'), null, 'a feature request is not a bounty candidate');
  assert.deepEqual(bountyStateFromLabels(['bounty:confirmed'], 'bug'), { state: 'confirmed' });
  assert.deepEqual(bountyStateFromLabels(['bounty:confirmed', 'bounty:verified-medium'], 'bug'),
    { state: 'fixed', tier: 'medium', ruleKey: 'bug_medium' });
  assert.deepEqual(bountyStateFromLabels(['bounty:verified-low', 'bounty:not-a-bug'], 'bug'), { state: 'not_a_bug' });
  assert.deepEqual(bountyStateFromLabels(['bounty:duplicate'], 'bug'), { state: 'duplicate' });
});

// ─────────────────────────────────────────────────────────── the route ──

test('a tier label from a sender NOT on the allowlist grants nothing and changes nothing', async () => {
  const db = freshDb();
  const r = await deliver(db, labelEvent('labeled', 'bounty:verified-high', 'drive-by', ['bug', 'bounty:verified-high']));
  assert.equal(r.status, 200);
  assert.equal(r.body.bounty.kind, 'refused');
  assert.equal(r.body.bounty.reason, 'sender_not_allowed');
  assert.ok(!('rule_key' in r.body.bounty), 'a refused label still named a rule to grant');
  assert.equal(ticket(db).status, 'open');
});

test('a tier label from S1 names the rule and the source ref, and pays it', async () => {
  const db = freshDb();
  const r = await deliver(db, labelEvent('labeled', 'bounty:verified-high', S1, ['bug', 'bounty:verified-high']));
  assert.equal(r.status, 200);
  assert.equal(r.body.bounty.kind, 'tier_added');
  assert.equal(r.body.bounty.rule_key, 'bug_high');
  assert.equal(r.body.bounty.source_ref, 'bounty:ticket:41');
  assert.equal(r.body.bounty.credits, 'granted');
  assert.equal(r.body.bounty.amount, 150);
  assert.ok(JSON.parse(ticket(db).github_labels).includes('bounty:verified-high'), 'the label snapshot lost the tier');
  const removed = await deliver(db, labelEvent('unlabeled', 'bounty:verified-high', S1, ['bug']));
  assert.equal(removed.body.bounty.kind, 'tier_removed');
  assert.equal(removed.body.bounty.rule_key, 'bug_high');
});

test('a redelivered webhook is not processed twice', async () => {
  const db = freshDb();
  const body = labelEvent('labeled', 'bounty:verified-low', S1, ['bug', 'bounty:verified-low']);
  const first = await deliver(db, body, { id: 'same-guid' });
  assert.equal(first.body.bounty.kind, 'tier_added');
  const again = await deliver(db, body, { id: 'same-guid' });
  assert.equal(again.body.ignored, 'duplicate_delivery');
  assert.ok(!again.body.bounty, 'a redelivery reached the bounty handling again');
});

test('not-a-bug and duplicate from S1 close the ticket, and close the GitHub issue as not planned', async () => {
  for (const label of ['bounty:not-a-bug', 'bounty:duplicate']) {
    const db = freshDb();
    const gh = captureFetch();
    try {
      const r = await deliver(db, labelEvent('labeled', label, S1, ['bug', label]));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.bounty.kind, 'outcome');
      assert.equal(ticket(db).status, 'closed', `${label} left the ticket open`);
      const close = gh.calls.find((x) => x.method === 'PATCH' && x.url.endsWith('/issues/900'));
      assert.ok(close, `${label} did not close the GitHub issue`);
      assert.deepEqual(close!.body, { state: 'closed', state_reason: 'not_planned' });
      assert.equal(r.body.bounty.github_closed, true);
    } finally { gh.restore(); }
  }
});

test('the same outcome label from a stranger closes nothing', async () => {
  const db = freshDb();
  const gh = captureFetch();
  try {
    const r = await deliver(db, labelEvent('labeled', 'bounty:not-a-bug', 'drive-by', ['bug', 'bounty:not-a-bug']));
    assert.equal(r.body.bounty.kind, 'refused');
    assert.equal(ticket(db).status, 'open');
    assert.equal(gh.calls.length, 0, 'a refused label still wrote to GitHub');
  } finally { gh.restore(); }
});

test('the signature check is unchanged: unsigned and mis-signed deliveries are refused before anything runs', async () => {
  const db = freshDb();
  const body = labelEvent('labeled', 'bounty:not-a-bug', S1, ['bug', 'bounty:not-a-bug']);
  const unsigned = await deliver(db, body, { sign: null });
  assert.equal(unsigned.status, 401);
  const forged = await deliver(db, body, { sign: `sha256=${'0'.repeat(64)}` });
  assert.equal(forged.status, 401);
  assert.equal(ticket(db).status, 'open', 'an unsigned delivery changed the ticket');
});

test('BOUNTY_GRANTERS is declared in both var tables of wrangler.toml', () => {
  const prodAt = WRANGLER.indexOf('\n[env.production.vars]');
  assert.ok(prodAt > 0);
  const top = WRANGLER.slice(WRANGLER.indexOf('\n[vars]'), prodAt);
  const prod = WRANGLER.slice(prodAt, WRANGLER.indexOf('\n[', prodAt + 5));
  assert.match(top, /^BOUNTY_GRANTERS = "guillaumelauzier"$/m);
  assert.match(prod, /^BOUNTY_GRANTERS = "guillaumelauzier"$/m, 'the production table does not inherit the top-level vars');
});

// ─────────────────────────────────────── follow-up: review findings ──

/** A fetch stub that answers every call with one status, counting the calls. */
function failingFetch(status: number) {
  const calls: Array<{ url: string; method: string }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return new Response(JSON.stringify({ message: 'nope' }), { status, headers: { 'content-type': 'application/json' } });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// ghFetch waits 750 ms before its one retry of a 5xx or 429; the tests do not.
function instantTimers() {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: any) => real(fn, 0)) as any;
  return () => { globalThis.setTimeout = real; };
}

test('when the sync bot IS the granter, its bounty label added or removed is processed; its other events are still dropped as echoes', async () => {
  const sameAccount = (db: any) => env(db, { GITHUB_SYNC_BOT_LOGIN: 'GuillaumeLauzier' });
  // A tier label from the shared account.
  const db = freshDb();
  const tier = await deliver(db, labelEvent('labeled', 'bounty:verified-medium', S1, ['bug', 'bounty:verified-medium']), { env: sameAccount(db) });
  assert.notEqual(tier.body.ignored, 'sync_bot_actor', 'the coordinator\'s bounty label was dropped as a sync echo');
  assert.equal(tier.body.bounty?.kind, 'tier_added');
  assert.equal(tier.body.bounty?.rule_key, 'bug_medium');

  // An outcome label from the shared account closes the ticket and the issue.
  const db2 = freshDb();
  const gh = captureFetch();
  try {
    const out = await deliver(db2, labelEvent('labeled', 'bounty:not-a-bug', S1, ['bug', 'bounty:not-a-bug']), { env: sameAccount(db2) });
    assert.equal(out.body.bounty?.kind, 'outcome');
    assert.equal(ticket(db2).status, 'closed');
    assert.equal(gh.calls.length, 1);
  } finally { gh.restore(); }

  // A tier removed by the shared account is a decision too (D542): the
  // outbound label PUT never removes a bounty label, and dropping the removal
  // would leave the 30-day revoke unreachable in production.
  const removed = await deliver(db, labelEvent('unlabeled', 'bounty:verified-medium', S1, ['bug']), { env: sameAccount(db) });
  assert.notEqual(removed.body.ignored, 'sync_bot_actor', 'the coordinator\'s tier removal was dropped as a sync echo');
  assert.equal(removed.body.bounty?.kind, 'tier_removed');
  assert.equal(removed.body.bounty?.credits, 'revoked');

  // Everything else from the bot is an echo, as before: an ordinary label
  // added or removed, and the close our own PATCH caused.
  const db3 = freshDb();
  const closedEcho = labelEvent('labeled', 'x', S1, ['bug'], 'closed') as any;
  closedEcho.action = 'closed';
  delete closedEcho.label;
  for (const body of [
    labelEvent('labeled', 'priority: high', S1, ['bug', 'priority: high']),
    labelEvent('unlabeled', 'priority: high', S1, ['bug']),
    closedEcho,
  ]) {
    const r = await deliver(db3, body, { env: sameAccount(db3) });
    assert.equal(r.body.ignored, 'sync_bot_actor', `a bot ${body.action} event was not dropped`);
  }
  assert.equal(ticket(db3).status, 'open');
  assert.equal(ticket(db3).github_labels, null, 'a dropped echo wrote the label snapshot');

  // A bounty label from the bot account when the bot is NOT a granter is still an echo.
  const db4 = freshDb();
  const notGranter = await deliver(db4, labelEvent('labeled', 'bounty:not-a-bug', 'sync-bot', ['bug', 'bounty:not-a-bug']),
    { env: env(db4, { GITHUB_SYNC_BOT_LOGIN: 'sync-bot' }) });
  assert.equal(notGranter.body.ignored, 'sync_bot_actor');
  assert.equal(ticket(db4).status, 'open');
});

test('an issue number that is not a positive safe integer is refused before any fetch or write', async () => {
  for (const bad of ['900', '900/../../orgs', -900, 0, 900.5, 2 ** 53, 1e300, true, [900], { n: 900 }]) {
    const db = freshDb();
    const gh = captureFetch();
    try {
      const body = labelEvent('labeled', 'bounty:not-a-bug', S1, ['bug', 'bounty:not-a-bug']);
      (body.issue as any).number = bad;
      const r = await deliver(db, body);
      assert.equal(r.status, 400, `issue number ${JSON.stringify(bad)} was accepted`);
      assert.equal(r.body.error, 'invalid_issue_number');
      assert.equal(gh.calls.length, 0, `issue number ${JSON.stringify(bad)} reached a GitHub URL`);
      assert.equal(ticket(db).status, 'open');
      assert.equal(ticket(db).github_labels, null);
    } finally { gh.restore(); }
  }
  // Missing is acknowledged and ignored, as before.
  const db = freshDb();
  const gh = captureFetch();
  try {
    const body = labelEvent('labeled', 'bounty:not-a-bug', S1, ['bug', 'bounty:not-a-bug']);
    delete (body.issue as any).number;
    const r = await deliver(db, body);
    assert.equal(r.body.ignored, 'no_issue_number');
    assert.equal(gh.calls.length, 0);
    assert.equal(ticket(db).status, 'open');
  } finally { gh.restore(); }
});

test('a failed GitHub close leaves the ticket open, releases the claim and asks for a retry', async () => {
  const restoreTimers = instantTimers();
  try {
    for (const status of [401, 403, 429, 500]) {
      const db = freshDb();
      const body = labelEvent('labeled', 'bounty:duplicate', S1, ['bug', 'bounty:duplicate']);
      const id = `close-fails-${status}`;
      const gh = failingFetch(status);
      let r: { status: number; body: any };
      try { r = await deliver(db, body, { id }); } finally { gh.restore(); }
      assert.ok(gh.calls.length >= 1 && gh.calls.every((x) => x.method === 'PATCH'));
      assert.ok(r.status >= 500, `a ${status} from GitHub was answered ${r.status}`);
      assert.equal(r.body.error, 'github_close_failed');
      assert.equal(ticket(db).status, 'open', `the ticket closed locally though GitHub answered ${status}`);
      assert.equal(ticket(db).github_labels, null, 'a half-done delivery wrote the label snapshot');

      // GitHub's redelivery of the same GUID runs again and now succeeds.
      const ok = captureFetch();
      try {
        const again = await deliver(db, body, { id });
        assert.notEqual(again.body.ignored, 'duplicate_delivery', 'the failed delivery\'s claim was not released');
        assert.equal(again.status, 200);
        assert.equal(again.body.bounty.github_closed, true);
        assert.equal(ticket(db).status, 'closed');
        assert.equal(ok.calls.length, 1);
      } finally { ok.restore(); }
    }
  } finally { restoreTimers(); }
});

test('an outcome on an issue already closed on GitHub closes the ticket with no outbound call', async () => {
  const db = freshDb();
  const gh = captureFetch();
  try {
    const r = await deliver(db, labelEvent('labeled', 'bounty:not-a-bug', S1, ['bug', 'bounty:not-a-bug'], 'closed'));
    assert.equal(r.status, 200);
    assert.equal(r.body.bounty.github_closed, null);
    assert.equal(ticket(db).status, 'closed');
    assert.equal(gh.calls.length, 0);
  } finally { gh.restore(); }
});

test('every bounty decision acted on is recorded with the GitHub sender, including one from the sync-bot account', async () => {
  const audits = (db: any) => db.prepare(`SELECT action, actor, user_id, details FROM activity_logs WHERE action = 'github.bounty_label' ORDER BY id`).all() as any[];
  // An outcome from the shared sync-bot account closes the ticket and is recorded.
  const db = freshDb();
  const gh = captureFetch();
  try {
    const out = await deliver(db, labelEvent('labeled', 'bounty:duplicate', S1, ['bug', 'bounty:duplicate']),
      { env: env(db, { GITHUB_SYNC_BOT_LOGIN: S1 }) });
    assert.equal(out.status, 200);
    assert.equal(ticket(db).status, 'closed');
  } finally { gh.restore(); }
  const a = audits(db);
  assert.equal(a.length, 1, 'a ticket was closed with no actor recorded');
  assert.equal(a[0].actor, `github:${S1}`);
  assert.equal(a[0].user_id, null);
  const d = JSON.parse(a[0].details);
  assert.deepEqual(
    { ticket_id: d.ticket_id, issue_number: d.issue_number, label: d.label, kind: d.kind, outcome: d.outcome,
      github_sender: d.github_sender, via_sync_bot_account: d.via_sync_bot_account, status_before: d.status_before, status_after: d.status_after },
    { ticket_id: 41, issue_number: 900, label: 'bounty:duplicate', kind: 'outcome', outcome: 'duplicate',
      github_sender: S1, via_sync_bot_account: true, status_before: 'open', status_after: 'closed' });

  // A tier label is recorded too; a refused label and an ordinary one are not.
  const db2 = freshDb();
  await deliver(db2, labelEvent('labeled', 'bounty:verified-medium', S1, ['bug', 'bounty:verified-medium']));
  await deliver(db2, labelEvent('labeled', 'bounty:verified-high', 'stranger', ['bug', 'bounty:verified-high']));
  await deliver(db2, labelEvent('labeled', 'priority: high', S1, ['bug', 'priority: high']));
  const b = audits(db2);
  assert.equal(b.length, 1);
  assert.equal(JSON.parse(b[0].details).rule_key, 'bug_medium');
  assert.equal(JSON.parse(b[0].details).via_sync_bot_account, false);

  // If the record cannot be written, the delivery is not acknowledged: the
  // claim is released and the response asks for a redelivery.
  const db3 = freshDb();
  db3.exec('DROP TABLE activity_logs');
  const gh3 = captureFetch();
  try {
    const r = await deliver(db3, labelEvent('labeled', 'bounty:verified-low', S1, ['bug', 'bounty:verified-low']), { id: 'audit-fail-1' });
    assert.ok(r.status >= 500, `an unrecorded decision was acknowledged with ${r.status}`);
    db3.exec(ddl('activity_logs'));
    const again = await deliver(db3, labelEvent('labeled', 'bounty:verified-low', S1, ['bug', 'bounty:verified-low']), { id: 'audit-fail-1' });
    assert.equal(again.status, 200, 'the redelivery was taken for a duplicate');
    assert.equal(audits(db3).length, 1);
  } finally { gh3.restore(); }
});

// ──────────────────────────────────────────── the grant and the revoke ──

const bountyLedger = (db: any) => db.prepare(
  `SELECT id, user_id, delta, kind, source_ref, rule_key FROM perk_credit_ledger
    WHERE source_ref = 'bounty:ticket:41' OR source_ref LIKE 'revoke:%' ORDER BY id`,
).all().map((x: any) => ({ ...x }));
const credited = (db: any) => bountyLedger(db).reduce((a: number, r: any) => a + Number(r.delta), 0);
const quietly = async <T>(fn: () => Promise<T>) => {
  const w = console.warn; console.warn = () => {};
  try { return await fn(); } finally { console.warn = w; }
};
const add = (tier: string) => labelEvent('labeled', `bounty:verified-${tier}`, S1, ['bug', `bounty:verified-${tier}`]);
const drop = (tier: string) => labelEvent('unlabeled', `bounty:verified-${tier}`, S1, ['bug']);

test('each verified tier pays its rule\'s amount from migration 381 to the ticket\'s owner', async () => {
  for (const [tier, credits] of [['high', 150], ['medium', 60], ['low', 20]] as const) {
    const db = freshDb();
    const r = await quietly(() => deliver(db, add(tier)));
    assert.equal(r.status, 200);
    assert.equal(r.body.bounty.credits, 'granted', tier);
    assert.equal(r.body.bounty.amount, credits, tier);
    assert.deepEqual(bountyLedger(db).map((x: any) => [x.user_id, x.delta, x.kind, x.rule_key]),
      [[FOUNDER, credits, 'grant', `bug_${tier}`]]);
  }
});

test('the grant is idempotent across webhook redeliveries and a second tier on the same ticket', async () => {
  const db = freshDb();
  await quietly(() => deliver(db, add('high')));
  // GitHub's redeliver button sends a NEW delivery id, so the dedupe table
  // does not catch it; the source ref does.
  const again = await quietly(() => deliver(db, add('high')));
  assert.equal(again.body.bounty.credits, 'already_granted');
  const other = await quietly(() => deliver(db, add('low')));
  assert.equal(other.body.bounty.credits, 'already_granted', 'a second tier paid the same ticket twice');
  assert.equal(credited(db), 150);
});

test('removing the paid tier within 30 days revokes it, once; the system is the recorded actor', async () => {
  const db = freshDb();
  await quietly(() => deliver(db, add('medium')));
  const r = await quietly(() => deliver(db, drop('medium')));
  assert.equal(r.body.bounty.credits, 'revoked');
  assert.equal(r.body.bounty.amount, 60);
  assert.equal(credited(db), 0);
  const again = await quietly(() => deliver(db, drop('medium')));
  assert.equal(again.body.bounty.credits, 'already_revoked');
  assert.equal(credited(db), 0);
  const log = db.prepare(`SELECT actor, details FROM activity_logs WHERE action = 'credit_grant_revoke'`).all() as any[];
  assert.equal(log.length, 1);
  assert.equal(log[0].actor, 'system:github_bounty');
  assert.match(JSON.parse(log[0].details).reason, /bounty:verified-medium label was removed/);
  const decided = db.prepare(`SELECT details FROM activity_logs WHERE action = 'github.bounty_label' ORDER BY id`).all() as any[];
  assert.deepEqual(decided.map((d) => JSON.parse(d.details).credits), ['granted', 'revoked', 'already_revoked']);
});

test('a tier put back after a revoke does not pay again, and says so', async () => {
  const db = freshDb();
  await quietly(() => deliver(db, add('low')));
  await quietly(() => deliver(db, drop('low')));
  const back = await quietly(() => deliver(db, add('low')));
  assert.equal(back.body.bounty.credits, 'revoked_earlier');
  assert.equal(credited(db), 0);
});

test('the revoke window: a tier removed after 30 days, or a tier that was never paid, takes nothing back', async () => {
  const db = freshDb();
  await quietly(() => deliver(db, add('high')));
  // Removing a different tier than the one paid keeps the grant.
  const wrong = await quietly(() => deliver(db, drop('low')));
  assert.equal(wrong.body.bounty.credits, 'kept');
  assert.equal(wrong.body.bounty.reason, 'paid_under_another_tier');
  // Thirty-one days on, in SQLite's own date shape (D162).
  db.prepare(`UPDATE perk_credit_ledger SET created_at = datetime('now', '-31 days') WHERE source_ref = 'bounty:ticket:41'`).run();
  const late = await quietly(() => deliver(db, drop('high')));
  assert.equal(late.body.bounty.credits, 'kept');
  assert.equal(late.body.bounty.reason, 'revoke_window_passed');
  assert.equal(credited(db), 150);
  // Twenty-nine days is inside it.
  db.prepare(`UPDATE perk_credit_ledger SET created_at = datetime('now', '-29 days') WHERE source_ref = 'bounty:ticket:41'`).run();
  const inside = await quietly(() => deliver(db, drop('high')));
  assert.equal(inside.body.bounty.credits, 'revoked');
  const fresh = freshDb();
  const none = await quietly(() => deliver(fresh, drop('high')));
  assert.equal(none.body.bounty.credits, 'nothing_to_revoke');
});

test('the grant service\'s refusals are answered, not retried: staff, the monthly cap, spent credits', async () => {
  const staff = freshDb();
  staff.prepare(`UPDATE tickets SET user_id = 22 WHERE id = 41`).run(); // ADMIN
  const s = await quietly(() => deliver(staff, add('high')));
  assert.equal(s.status, 200);
  assert.equal(s.body.bounty.credits, 'refused');
  assert.equal(s.body.bounty.code, 'not_eligible');
  assert.equal(credited(staff), 0);

  const capped = freshDb();
  capped.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, rule_key, created_at)
                  VALUES (?, 400, 'grant', 'bounty:ticket:other', 'bug_high', ?)`).run(FOUNDER, new Date().toISOString());
  const c = await quietly(() => deliver(capped, add('high')));
  assert.equal(c.body.bounty.code, 'cap_reached');
  assert.equal(credited(capped), 0);

  const spent = freshDb();
  await quietly(() => deliver(spent, add('high')));
  spent.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref) VALUES (?, -100, 'spend', 'perk:x')`).run(FOUNDER);
  const k = await quietly(() => deliver(spent, drop('high')));
  assert.equal(k.body.bounty.credits, 'kept');
  assert.equal(k.body.bounty.reason, 'would_overdraw');
});

test('a ticket with no owner grants nothing; a failed grant releases the claim so the delivery can be redelivered', async () => {
  const orphan = freshDb();
  orphan.prepare(`UPDATE tickets SET user_id = NULL WHERE id = 41`).run();
  const o = await quietly(() => deliver(orphan, add('high')));
  assert.equal(o.body.bounty.credits, 'not_granted');
  assert.equal(o.body.bounty.reason, 'no_ticket_owner');

  const db = freshDb();
  db.exec('ALTER TABLE perk_credit_ledger RENAME TO perk_credit_ledger_away');
  const failed = await quietly(() => deliver(db, add('high'), { id: 'retry-me' }));
  assert.equal(failed.status, 500);
  db.exec('ALTER TABLE perk_credit_ledger_away RENAME TO perk_credit_ledger');
  const retried = await quietly(() => deliver(db, add('high'), { id: 'retry-me' }));
  assert.equal(retried.body.bounty?.credits, 'granted', 'the failed delivery was swallowed as a duplicate');
  assert.equal(credited(db), 150);
});
