/**
 * D542 — bounty labels on a mirrored ticket issue, as the webhook reads them.
 *
 * The route tests sign each delivery with the webhook secret and send it
 * through the real router (`routes/github.ts`) against a real `node:sqlite`
 * `tickets` table from schema_baseline.sql. The one outbound call (closing
 * the GitHub issue on a not-a-bug or duplicate outcome) is caught by a stub
 * of `fetch`, so the test sees exactly what would have been sent.
 *
 * What this PR covers of #1105: the allowlist, the tier → rule map, the
 * closing outcomes, the state a ticket's labels describe, and the signature
 * check left as it was. The grant and the revoke land with the credit grant
 * service (#1103); until then the route says nothing was granted.
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

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl('tickets'));
  for (const col of ['github_issue_number INTEGER', 'github_labels TEXT', 'github_assignees TEXT', 'github_updated_at TEXT', "type TEXT NOT NULL DEFAULT 'task'"]) {
    try { db.exec(`ALTER TABLE tickets ADD COLUMN ${col}`); } catch { /* the baseline already has it */ }
  }
  db.prepare(
    `INSERT INTO tickets (id, title, status, priority, user_id, github_issue_number, type)
     VALUES (41, 'Export button 500s', 'open', 'medium', 7, 900, 'bug')`,
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

test('a tier label from S1 names the rule and the source ref, and says nothing was granted yet', async () => {
  const db = freshDb();
  const r = await deliver(db, labelEvent('labeled', 'bounty:verified-high', S1, ['bug', 'bounty:verified-high']));
  assert.equal(r.status, 200);
  assert.equal(r.body.bounty.kind, 'tier_added');
  assert.equal(r.body.bounty.rule_key, 'bug_high');
  assert.equal(r.body.bounty.source_ref, 'bounty:ticket:41');
  assert.equal(r.body.bounty.credits, 'not_granted', 'the route claimed a grant the service cannot make yet');
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
