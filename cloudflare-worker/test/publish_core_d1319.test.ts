/**
 * D1319 (#3480, part 1 of #2400) — the Worker core of founder publishing, on
 * the migrated schema (migration 642 with every other), the route mounted on
 * a bare Hono, and `_publish_fake.mjs` as the provider. Nothing reaches the
 * network.
 *
 * What #3480 says must be tested, each below by name: a double confirm sends
 * once and the same key returns the same row; `unknown` is never retried;
 * `content_changed`; the refused roles and a support session; a switch that
 * is off; the cap under two concurrent confirms; a 429; retract where
 * supported and refused where not; `autopush` and `automaticSendAllowed`
 * never reach `publish` and `send_modes` refuses a publish target; the lint
 * blocks a secret, a card and an email, and the name scan finds a seeded
 * member; the raw-SQL count is unchanged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/publish_core_d1319.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { publishFake } from './_publish_fake.mjs';
import publishRoutes from '../src/routes/publish.ts';
import { registerProvider, CONNECTOR_METADATA, PUBLISHERS } from '../src/integrations/registry.ts';
import { PUBLISH_TARGETS, PUBLISH_DAILY_CAP, publishTarget, registerPublishTarget } from '../src/integrations/publishTargets.ts';
import { PUBLISH_MODULES, PUBLISH_SOURCES } from '../src/integrations/publishSources.ts';
import { automaticSendAllowed, validateConnectorSettings } from '../src/integrations/connectorRules.ts';
import { publishLint, scanSecrets } from '../src/services/publishLint.ts';
import { lintForSend } from '../src/services/telegramRedactCheck.ts';
import { STRANDED_MINUTES } from '../src/services/publishCore.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 's'.repeat(40); // in-memory test signing seed only
const FOUNDER = 1, COFOUNDER = 2, ADMIN = 3, PARTNER = 4, ADVISOR = 5, INVESTOR = 6;
const P = 701;

const fake = publishFake();
const draftOnly = publishFake({ key: 'fakedraft', retract: 'none' });
for (const f of [fake, draftOnly]) { registerProvider(f.impl as any); registerPublishTarget(f.target as any); }

const app = new Hono<any>();
app.route('/api/publish', publishRoutes);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'F','f@example.test'),(202,'C','c@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active,full_legal_name) VALUES
      (1,'Founder','founder@example.test','founder',101,1,NULL),(2,'Cofounder','co@example.test','founder',202,1,NULL),
      (3,'Admin','admin@example.test','admin',101,1,NULL),(4,'Partner','partner@example.test','partner',NULL,1,NULL),
      (5,'Advisor','advisor@example.test','advisor',NULL,1,NULL),(6,'Investor','investor@example.test','investor',NULL,1,NULL),
      (7,'Seeded','seeded@example.test','founder',NULL,1,'Avery Quinlan Marsh');
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-1','Northwind Data');
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (${P},'p-1','Northwind',101,1);
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,1,1),('l2',1,2,0),('l3',1,3,0);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES
      (10,'int-own',1,'fakepub','active','oauth2'),(11,'int-co',2,'fakepub','active','oauth2'),(12,'int-draft',1,'fakedraft','active','oauth2');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (10,1,1),(11,1,1),(12,1,1);
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  async function call(who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
    const token = await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`https://unit.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  return { db, env, call };
}

/** Refresh the places, switch the first on, write a draft and preview it. */
async function ready(f: ReturnType<typeof fixture>, text = 'Shipped in October: bulk CSV import and faster search.', integration = 'int-own') {
  assert.equal((await f.call(FOUNDER, 'POST', `/api/publish/destinations/refresh/${integration}`, { project: P })).status, 200);
  const dests = (await f.call(FOUNDER, 'GET', `/api/publish/destinations?project=${P}`)).body.connections
    .find((x: any) => x.uid === integration).destinations;
  const dest = dests[0];
  assert.equal(dest.enabled, false, 'a new place arrives off');
  assert.equal((await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: true })).status, 200);
  const draft = (await f.call(FOUNDER, 'POST', '/api/publish/drafts', { project_id: P, module: 'product-improvement', text })).body.draft;
  const preview = (await f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/preview`, { destination_uids: [dest.uid] })).body.previews[0];
  return { dest, draft, preview };
}
const confirm = (f: ReturnType<typeof fixture>, draft: any, dest: any, hash: string, key: string, who = FOUNDER) =>
  f.call(who, 'POST', `/api/publish/drafts/${draft.uid}/confirm`, { destination_uid: dest.uid, envelope_hash: hash, idempotency_key: key });
const reset = () => { for (const f of [fake, draftOnly]) { Object.assign(f.state, { mode: 'accept', deleteMode: 'accept', gate: null, calls: [], posts: [], seq: 0 }); } };

test('a double confirm sends once, and the same key returns the same row, sequential or at once', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  assert.equal(preview.sendable, true);
  const first = await confirm(f, draft, dest, preview.envelope_hash, 'key-aaaaaaaa');
  assert.equal(first.status, 201); assert.equal(first.body.send.status, 'sent');
  assert.equal(first.body.send.external_post_id, 'post-1');
  const again = await confirm(f, draft, dest, preview.envelope_hash, 'key-aaaaaaaa');
  assert.equal(again.status, 200); assert.equal(again.body.repeated, true);
  assert.equal(again.body.send.uid, first.body.send.uid);
  assert.equal(fake.publishes(), 1);
  // The same key returns the same row even once the draft has changed: it is that confirm, already made.
  await f.call(FOUNDER, 'PUT', `/api/publish/drafts/${draft.uid}`, { text: 'Changed after sending.' });
  const late = await confirm(f, draft, dest, preview.envelope_hash, 'key-aaaaaaaa');
  assert.deepEqual([late.status, late.body.send.uid], [200, first.body.send.uid]);
  await f.call(FOUNDER, 'PUT', `/api/publish/drafts/${draft.uid}`, { text: 'Shipped in October: bulk CSV import and faster search.' });
  // Two presses of one key at the same moment: one send.
  const [a, b] = await Promise.all([confirm(f, draft, dest, preview.envelope_hash, 'key-bbbbbbbb'), confirm(f, draft, dest, preview.envelope_hash, 'key-bbbbbbbb')]);
  assert.equal(a.body.send.uid, b.body.send.uid);
  assert.equal(fake.publishes(), 2);
  assert.equal(Number((f.db.prepare("SELECT COUNT(*) n FROM publish_sends").get() as any).n), 2);
  // Logs keep codes, never the text.
  const logs = JSON.stringify(f.db.prepare("SELECT * FROM integration_logs").all()) + JSON.stringify(f.db.prepare("SELECT * FROM activity_logs").all());
  assert.doesNotMatch(logs, /bulk CSV import/);
});

test('unknown is never retried: a timeout after the request is unknown, Retry refuses, Check finds it, Mark as not sent is the founder’s word; a stranded row becomes unknown', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  fake.state.mode = 'timeout';
  const r = await confirm(f, draft, dest, preview.envelope_hash, 'key-unknown1');
  assert.equal(r.body.send.status, 'unknown');
  fake.state.mode = 'accept';
  const uid = r.body.send.uid;
  assert.equal((await f.call(FOUNDER, 'POST', `/api/publish/sends/${uid}/retry`)).body.error, 'outcome_unknown');
  assert.equal((await confirm(f, draft, dest, preview.envelope_hash, 'key-unknown1')).body.send.status, 'unknown', 'the same key never re-sends');
  assert.equal(fake.publishes(), 1);
  const check = await f.call(FOUNDER, 'POST', `/api/publish/sends/${uid}/check`);
  assert.deepEqual([check.body.found, check.body.send.status, check.body.send.external_post_id], [true, 'sent', 'post-1']);

  // A throw after the provider said yes is unknown too, never failed.
  fake.state.mode = 'throw_after';
  const t = await confirm(f, draft, dest, preview.envelope_hash, 'key-unknown2');
  assert.equal(t.body.send.status, 'unknown');
  fake.state.posts = [];
  assert.equal((await f.call(FOUNDER, 'POST', `/api/publish/sends/${t.body.send.uid}/check`)).body.found, false);
  const marked = await f.call(FOUNDER, 'POST', `/api/publish/sends/${t.body.send.uid}/mark-not-sent`);
  assert.deepEqual([marked.body.send.status, marked.body.send.error_code], ['failed', 'marked_not_sent']);

  // A row left `sending` STRANDED_MINUTES after its claim is unknown on read.
  f.db.prepare(`UPDATE publish_sends SET status = 'sending', claimed_at = datetime('now', ?) WHERE uid = ?`).run(`-${STRANDED_MINUTES + 1} minutes`, uid);
  const fresh = await confirm(f, draft, dest, preview.envelope_hash, 'key-sending1');
  f.db.prepare(`UPDATE publish_sends SET status = 'sending', claimed_at = datetime('now') WHERE uid = ?`).run(fresh.body.send.uid);
  const list = (await f.call(FOUNDER, 'GET', `/api/publish/sends?project=${P}`)).body.sends;
  assert.equal(list.find((s: any) => s.uid === uid).status, 'unknown');
  assert.equal(list.find((s: any) => s.uid === fresh.body.send.uid).status, 'sending', 'a recent claim is left alone');
});

test('content_changed: an edit after the preview refuses the old hash; a preview of the new text sends it', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  await f.call(FOUNDER, 'PUT', `/api/publish/drafts/${draft.uid}`, { text: 'Shipped in October: SSO for teams.' });
  assert.equal((await confirm(f, draft, dest, preview.envelope_hash, 'key-changed1')).body.error, 'content_changed');
  // A per-destination edit is what that place gets.
  await f.call(FOUNDER, 'PUT', `/api/publish/drafts/${draft.uid}`, { per_destination: { [dest.uid]: 'Shipped SSO for teams.' } });
  const p2 = (await f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/preview`, { destination_uids: [dest.uid] })).body.previews[0];
  assert.equal(p2.preview.fields[0].value, 'Shipped SSO for teams.');
  assert.equal((await confirm(f, draft, dest, p2.envelope_hash, 'key-changed2')).body.send.status, 'sent');
  assert.equal(fake.publishes(), 1);
  // Over the limit is a problem line and no send; nothing is cut.
  await f.call(FOUNDER, 'PUT', `/api/publish/drafts/${draft.uid}`, { per_destination: { [dest.uid]: 'x'.repeat(281) } });
  const long = (await f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/preview`, { destination_uids: [dest.uid] })).body.previews[0];
  assert.deepEqual([long.sendable, long.problems[0]], [false, '281 of 280 characters: shorten it for this place.']);
  assert.equal((await confirm(f, draft, dest, long.envelope_hash, 'key-changed3')).body.error, 'not_publishable');
});

test('who may: only the venture’s founder through their own connection; admin, partner, advisor, investor, a co-founder and a support session are refused', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  for (const who of [ADMIN, PARTNER, ADVISOR, INVESTOR, COFOUNDER]) {
    const r = await confirm(f, draft, dest, preview.envelope_hash, `key-role-${who}xx`, who);
    assert.ok([403, 404].includes(r.status), `user ${who} refused`);
    assert.notEqual(r.body.send?.status, 'sent');
    assert.equal((await f.call(who, 'POST', '/api/publish/drafts', { project_id: P, module: 'updates', text: 'x' })).status, who === ADMIN || who === COFOUNDER ? 403 : 403);
  }
  // A co-founder with their own connection is still refused (decision A, (a)).
  assert.equal((await f.call(COFOUNDER, 'POST', '/api/publish/destinations/refresh/int-co', { project: P })).body.error, 'publish_not_allowed');
  // The founder never publishes through a teammate's connection.
  assert.equal((await f.call(FOUNDER, 'POST', '/api/publish/destinations/refresh/int-co', { project: P })).body.error, 'publish_not_allowed');
  // A support session, even as the founder.
  const support = await f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/confirm`, { destination_uid: dest.uid, envelope_hash: preview.envelope_hash, idempotency_key: 'key-support1' }, { impersonated_by: 99 });
  assert.equal(support.body.error, 'support_session');
  assert.equal(fake.publishes(), 0);
  // A co-founder on the team reads the history; nobody outside it does.
  assert.equal((await f.call(COFOUNDER, 'GET', `/api/publish/sends?project=${P}`)).status, 200);
  assert.equal((await f.call(INVESTOR, 'GET', `/api/publish/sends?project=${P}`)).status, 404);
  assert.equal((await f.call(COFOUNDER, 'GET', `/api/publish/destinations?project=${P}`)).body.can_publish, false);
  assert.equal((await f.call(FOUNDER, 'GET', `/api/publish/destinations?project=${P}`)).body.can_publish, true);
});

test('a switch that is off refuses, and so does a company the connection is not on for', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: false });
  assert.equal((await confirm(f, draft, dest, preview.envelope_hash, 'key-off00001')).body.error, 'destination_off');
  await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: true });
  f.db.exec('UPDATE integration_companies SET enabled = 0 WHERE integration_id = 10');
  assert.equal((await confirm(f, draft, dest, preview.envelope_hash, 'key-off00002')).body.error, 'company_not_enabled');
  assert.equal(fake.publishes(), 0);
  const logged = f.db.prepare("SELECT action FROM activity_logs WHERE entity_type = 'publish_destination' ORDER BY id").all().map((r: any) => r.action);
  assert.deepEqual(logged, ['publish_destination_on', 'publish_destination_off', 'publish_destination_on']);
  // The cap may be lowered, never raised past the owner's ceiling.
  f.db.exec('UPDATE integration_companies SET enabled = 1 WHERE integration_id = 10');
  // A refresh keeps each place's switch as the founder left it.
  assert.equal((await f.call(FOUNDER, 'POST', '/api/publish/destinations/refresh/int-own', { project: P })).status, 200);
  assert.equal((await f.call(FOUNDER, 'GET', `/api/publish/destinations?project=${P}`)).body.connections.find((x: any) => x.uid === 'int-own').destinations[0].enabled, true);
  assert.equal((await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: true, daily_cap: PUBLISH_DAILY_CAP + 1 })).body.error, 'invalid');
});

test('the cap holds under two concurrent confirms; a capped send stays ready with its reason', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: true, daily_cap: 1 });
  let open!: () => void;
  fake.state.gate = new Promise<void>((r) => { open = r; });
  const both = Promise.all([confirm(f, draft, dest, preview.envelope_hash, 'key-cap00001'), confirm(f, draft, dest, preview.envelope_hash, 'key-cap00002')]);
  await new Promise((r) => setTimeout(r, 50));
  open();
  const [a, b] = await both;
  const statuses = [a, b].map((r) => r.body.send?.status ?? r.body.error).sort();
  assert.deepEqual(statuses, ['daily_cap_reached', 'sent']);
  assert.equal(fake.publishes(), 1);
  const capped = f.db.prepare("SELECT status, error_code FROM publish_sends WHERE error_code = 'daily_cap_reached'").get() as any;
  assert.deepEqual({ ...capped }, { status: 'ready', error_code: 'daily_cap_reached' });
});

test('a 429 is failed and rate_limited with retry_after; Retry, pressed, sends it on the same row', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  fake.state.mode = 'rate_limited';
  const r = await confirm(f, draft, dest, preview.envelope_hash, 'key-429aaaaa');
  assert.deepEqual([r.body.send.status, r.body.send.error_code, r.body.send.retry_after], ['failed', 'rate_limited', '2026-10-27T14:20:00Z']);
  fake.state.mode = 'reject';
  const v = await confirm(f, draft, dest, preview.envelope_hash, 'key-400aaaaa');
  assert.deepEqual([v.body.send.status, v.body.send.error_code], ['failed', 'validation']);
  fake.state.mode = 'accept';
  const again = await f.call(FOUNDER, 'POST', `/api/publish/sends/${r.body.send.uid}/retry`);
  assert.deepEqual([again.body.send.uid, again.body.send.status, again.body.send.attempts], [r.body.send.uid, 'sent', 2]);
  // Nothing retries on its own.
  assert.equal(fake.publishes(), 3);
});

test('retract where the provider deletes, refused where it cannot; a refused delete stays sent with its code; Mark as removed', async () => {
  reset(); const f = fixture();
  const { dest, draft, preview } = await ready(f);
  const sent = (await confirm(f, draft, dest, preview.envelope_hash, 'key-retract1')).body.send;
  fake.state.deleteMode = 'refuse';
  const kept = await f.call(FOUNDER, 'POST', `/api/publish/sends/${sent.uid}/retract`, { reason: 'Posted too early' });
  assert.deepEqual([kept.body.send.status, kept.body.send.retract_error], ['sent', 'delete_refused']);
  fake.state.deleteMode = 'accept';
  const gone = await f.call(FOUNDER, 'POST', `/api/publish/sends/${sent.uid}/retract`, { reason: 'Posted too early' });
  assert.deepEqual([gone.body.send.status, gone.body.send.retraction_reason, gone.body.send.retract_error], ['retracted', 'Posted too early', null]);
  // A draft-only place (retract `none`) cannot be deleted from Axal VC.
  const d2 = await ready(f, 'Shipped in October: faster search.', 'int-draft');
  const s2 = (await confirm(f, d2.draft, d2.dest, d2.preview.envelope_hash, 'key-retract2')).body.send;
  assert.equal(s2.retract, 'none');
  assert.equal((await f.call(FOUNDER, 'POST', `/api/publish/sends/${s2.uid}/retract`, {})).body.error, 'not_retractable');
  assert.equal((await f.call(FOUNDER, 'POST', `/api/publish/sends/${s2.uid}/mark-removed`)).body.send.status, 'removed_outside');
});

test('never automatic: no publish target is a sends row, send_modes refuses one, automaticSendAllowed is false, and only publishCore calls publish', () => {
  for (const meta of Object.values(CONNECTOR_METADATA)) {
    for (const p of meta.publishes ?? []) assert.ok(!meta.sends.some((s) => s.target === p.target), 'a publish target is never a sends row');
  }
  assert.deepEqual(validateConnectorSettings('fakepub', { send_modes: { '@northwind_demo': 'auto' } }), { ok: false, error: 'invalid_send_modes' });
  for (const ev of ['auto_push:project_created', 'auto_push:deal_stage', 'publish']) assert.equal(automaticSendAllowed('fakepub', ev, '{"send_modes":{"x":"auto"}}'), false);
  const src = new URL('../src/', import.meta.url);
  const walk = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.ts$/.test(e.name) ? [new URL(e.name, dir).pathname] : []);
  const files = walk(src);
  const callers = files.filter((p) => /\.publish\(\s*env/.test(readFileSync(p, 'utf8')) || /impl\.publish\(/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(callers.map((p) => p.split('/src/')[1]), ['services/publishCore.ts']);
  assert.doesNotMatch(readFileSync(new URL('integrations/autopush.ts', src), 'utf8'), /publish/);
  assert.deepEqual(files.filter((p) => readFileSync(p, 'utf8').includes('registerPublishTarget(') && !p.endsWith('publishTargets.ts')), [], 'only tests register a fake target');
  // Part 1 adds no provider: nothing can be published yet.
  // D1333 (#3481, part 2) fills PUBLISH_SOURCES: twelve store rows across the nine places (`publish_sources_d1333.test.ts`).
  assert.deepEqual([PUBLISH_TARGETS.length, PUBLISH_SOURCES.length, PUBLISHERS.size], [0, 12, 0]);
  assert.ok(Object.isFrozen(PUBLISH_TARGETS) && Object.isFrozen(PUBLISH_SOURCES));
  assert.equal(PUBLISH_MODULES.length, 9);
  assert.equal(publishTarget('fakepub')!.retract, 'delete');
  assert.equal(publishTarget('hubspot'), null);
});

/** Secret-shaped fixtures, built at run time so no literal key sits in the source (push protection). */
const FAKE_STRIPE = ['sk', 'live', '51HabcdEFGhijKLmnopQRstu'].join('_');
const FAKE_STRIPE_LOWER = ['sk', 'test', 'abcdefghijklmnopqrstuv'].join('_');
// A JWT-shaped string, built from its parts so no line of this file is one.
const FAKE_JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N'].join('.');

test('the check: a secret, a card and an email block; the name scan finds a seeded member, who passes once they agreed to be named; a team-only figure blocks unless ticked', async () => {
  reset(); const f = fixture();
  for (const [text, kind] of [
    [`Our key is ${FAKE_STRIPE}, do not share`, 'secret'],
    [`A test key ${FAKE_STRIPE_LOWER} here`, 'secret'],
    ['Paid with 4242 4242 4242 4242 today', 'card_like'],
    ['Write to hello@northwind.example', 'email'],
    [`Token ${FAKE_JWT}`, 'secret'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'secret'],
    ['See https://admin:hunter22@northwind.example/admin', 'secret'],
  ]) {
    const r = await publishLint(f.env, text);
    assert.equal(r.ok, false, text);
    assert.ok(r.kinds.includes(kind), `${text} → ${kind}`);
  }
  const secret = scanSecrets(`key ${FAKE_STRIPE}`);
  assert.doesNotMatch(JSON.stringify(secret), /51HabcdEFGhijKLmnop/, 'a secret is never echoed back');
  assert.equal((await publishLint(f.env, 'Shipped bulk CSV import and faster search for teams.')).ok, true);
  // The name scan reads full_legal_name and finds the seeded member.
  const named = await publishLint(f.env, 'Welcome Avery Quinlan Marsh to the team!');
  assert.deepEqual([named.ok, named.findings[0].kind, named.findings[0].user_id], [false, 'private_in_public', 7]);
  assert.equal((await publishLint(f.env, 'Welcome Avery Quinlan Marsh to the team!', { namedConsent: [7] })).ok, true);
  assert.equal((await lintForSend(f.env, 'avery quinlan marsh joined', 'members')).findings[0].user_id, 7, 'case-insensitive');
  // Team-only figures block unless ticked in.
  assert.equal((await publishLint(f.env, 'Cash on hand $412,000.', { teamOnly: ['$412,000'] })).kinds[0], 'team_only');
  assert.equal((await publishLint(f.env, 'Cash on hand $412,000.', { teamOnly: ['$412,000'], teamOnlyIncluded: true })).ok, true);
  // Through the route: the preview says so, and the confirm refuses.
  const { dest, draft } = await ready(f, 'Write to hello@northwind.example for a demo');
  const p = (await f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/preview`, { destination_uids: [dest.uid] })).body.previews[0];
  assert.deepEqual([p.sendable, p.lint.kinds], [false, ['email']]);
  assert.equal((await confirm(f, draft, dest, p.envelope_hash, 'key-lint0001')).body.error, 'lint_blocked');
  assert.equal(fake.publishes(), 0);
});

test('the raw-SQL budget: no new interpolated SQL in the publish files', () => {
  for (const file of ['src/routes/publish.ts', 'src/services/publishCore.ts', 'src/services/publishLint.ts']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/prepare\(\s*`([^`]*)`/g)) assert.doesNotMatch(m[1], /\$\{/, `${file}: ${m[1].slice(0, 60)}`);
  }
});
