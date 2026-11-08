/**
 * D4493 (#4493): outreach sequences on real migrated SQLite. Consent, suppression,
 * quiet hours, stop on reply or opt-out, blocked channels with fixed reasons,
 * drafts that never reach the mail adapter, the signed public opt-out and the
 * venture filter. Nothing sends.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/grow_sequences_4493.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router, { optoutRouter } from '../src/routes/grow_sequences.ts';
import { ADAPTERS } from '../src/services/mail/adapters/index.ts';
import { BLOCKED_REASONS, dueSteps, optoutToken, sequenceSendGate, SequenceRefused } from '../src/services/distribution/sequences.ts';
import { suppressionHash, suppressionKeyTag } from '../src/services/growProspects.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1, ADVISOR = 3, OTHER = 6, PA = 7, PB = 8;
const ALICE = 'a'.repeat(32), BOB = 'b'.repeat(32), FOREIGN = 'f'.repeat(32);

let pristine: DatabaseSync | undefined;
function build(): DatabaseSync {
  if (pristine) { pristine.exec('ROLLBACK TO sequence_fixture'); return pristine; }
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  loadSchema(db);
  db.exec('SAVEPOINT sequence_fixture');
  pristine = db;
  return db;
}
function fixture() {
  const db = build();
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (1, 'founder@example.test', 'Fay Founder', 'founder', 10),
      (3, 'advisor@example.test', 'Ada Advisor', 'founder', NULL), (6, 'other@example.test', 'Oli Other', 'founder', 20);
    INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO contacts (id, uid, project_id, audience, name, email, status) VALUES
      (11, '${ALICE}', ${PA}, 'customer', 'Alice Prospect', 'alice@example.test', 'new'),
      (12, '${BOB}', ${PA}, 'customer', 'Bob Prospect', 'bob@example.test', 'new'),
      (13, '${FOREIGN}', ${PB}, 'customer', 'Foreign Prospect', 'foreign@example.test', 'new');`);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), PUBLIC_BASE_URL: 'https://app.example.test' } as any };
}
const app = new Hono<any>();
app.route('/api/grow/sequences', router);
app.route('/api/grow/optout', optoutRouter);

async function call(f: { env: any }, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const res = await app.fetch(new Request(`http://t${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}
const consent = (f: any, contact: number, channel: string, basis = 'opted_in') => f.db.prepare(
  "INSERT INTO contact_marketing_consents (contact_id, channel, basis, proof, recorded_by) VALUES (?, ?, ?, ?, 1) ON CONFLICT(contact_id, channel) DO UPDATE SET basis = excluded.basis, proof = excluded.proof").run(contact, channel, basis, basis === 'none' ? null : 'Signed up on the site');
/** Quiet hours that do not cover the real clock now, so a route call can be due. */
function openQuiet(f: any) {
  const h = new Date().getUTCHours();
  const hh = (n: number) => `${String((h + n) % 24).padStart(2, '0')}:00`;
  f.db.prepare("INSERT INTO venture_outreach_settings (project_id, quiet_from, quiet_to, tz_mode, updated_by) VALUES (?, ?, ?, 'recipient', 1)").run(PA, hh(3), hh(5));
}
async function sequence(f: any, steps: unknown[] = [{ channel: 'email', subject: 'Late shipments', body: 'You said a late shipment costs a day a week.' }], state = 'active') {
  const made = await call(f, FOUNDER, 'POST', '/api/grow/sequences', { project: PA, name: 'Ops leads outreach', steps });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  if (state !== 'draft') assert.equal((await call(f, FOUNDER, 'PATCH', `/api/grow/sequences/${made.body.sequence.uid}`, { project: PA, state })).status, 200);
  return made.body.sequence.uid as string;
}
async function enrol(f: any, uid: string, contacts = [{ uid: ALICE, time_zone: 'UTC' }]) {
  const r = await call(f, FOUNDER, 'POST', `/api/grow/sequences/${uid}/enrol`, { project: PA, contacts });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const rowFor = async (f: any, now?: Date) => (await dueSteps(f.env, PA, now ? { now } : {})).rows.find((r) => r.contact_uid === ALICE)!;

test('a step without consent is blocked with its reason; with consent it is due', async () => {
  // Mutation checked: dropping the `!ctx.consents.has('email')` check in evaluate() makes this row due.
  const f = fixture(); openQuiet(f);
  const uid = await sequence(f); await enrol(f, uid);
  consent(f, 11, 'email', 'none');
  const blocked = await rowFor(f);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.reason, 'Not sent: Alice Prospect has no consent recorded for email. The step was skipped.');
  const draft = await call(f, FOUNDER, 'POST', `/api/grow/sequences/due/${blocked.enrolment_uid}/draft`, { project: PA });
  assert.equal(draft.status, 409);
  assert.match(draft.body.detail, /no consent recorded for email/);
  consent(f, 11, 'email', 'wrote_first');
  assert.equal((await rowFor(f)).state, 'due');
  const route = await call(f, FOUNDER, 'GET', `/api/grow/sequences/due?project=${PA}`);
  assert.equal(route.status, 200); assert.equal(route.body.due, 1);
});

test('a voice-note step needs a recorded voice consent as well as email consent, and its recording', async () => {
  const f = fixture(); openQuiet(f);
  const uid = await sequence(f, [{ channel: 'voice', subject: 'A quick note', body: '' }]);
  await enrol(f, uid); consent(f, 11, 'email');
  const r = await rowFor(f);
  assert.equal(r.state, 'blocked'); assert.match(r.reason!, /no consent recorded for a voice note/);
  consent(f, 11, 'voice');
  assert.equal((await rowFor(f)).reason, 'Record your voice note before this step is due.');
});

test('a suppressed contact is never due, whatever the consent', async () => {
  // Mutation checked: dropping the suppression branch in evaluate() makes this row due.
  const f = fixture(); openQuiet(f);
  const uid = await sequence(f); await enrol(f, uid); consent(f, 11, 'email');
  f.db.prepare("INSERT INTO venture_suppressions (project_id, address_hash, key_tag, reason) VALUES (?, ?, ?, 'manual')")
    .run(PA, await suppressionHash(f.env, PA, 'alice@example.test'), await suppressionKeyTag(f.env, PA));
  const r = await rowFor(f);
  assert.equal(r.state, 'suppressed'); assert.equal(r.reason, 'On your suppression list. Never due.');
  const route = await call(f, FOUNDER, 'GET', `/api/grow/sequences/due?project=${PA}`);
  assert.equal(route.body.due, 0);
  assert.doesNotMatch(JSON.stringify(route.body), /alice@example\.test/);
});

test('a quiet-hours step is not due: "Due after 08:00 their time"', async () => {
  // Mutation checked: dropping the inQuietHours branch makes the 22:00 reading due.
  const f = fixture();
  f.db.prepare("INSERT INTO venture_outreach_settings (project_id, quiet_from, quiet_to, tz_mode, updated_by) VALUES (?, '20:00', '08:00', 'recipient', 1)").run(PA);
  const uid = await sequence(f); await enrol(f, uid, [{ uid: ALICE, time_zone: 'Asia/Tokyo' }]); consent(f, 11, 'email');
  f.db.prepare("UPDATE outreach_enrolments SET next_due_at = '2026-11-01T00:00:00Z'").run();
  // 13:00 UTC is 22:00 in Tokyo; 01:00 UTC is 10:00 there.
  const night = await rowFor(f, new Date('2026-11-07T13:00:00Z'));
  assert.equal(night.state, 'held'); assert.equal(night.reason, 'Due after 08:00 their time');
  assert.equal((await rowFor(f, new Date('2026-11-08T01:00:00Z'))).state, 'due');
  f.db.prepare('UPDATE outreach_enrolments SET recipient_tz = NULL').run();
  assert.equal((await rowFor(f, new Date('2026-11-08T01:00:00Z'))).reason, 'Not due: their time zone is not recorded.');
  f.db.prepare('DELETE FROM venture_outreach_settings').run();
  assert.equal((await rowFor(f, new Date('2026-11-08T01:00:00Z'))).state, 'held');
});

test('a reply stops the enrolment, and the stop is kept', async () => {
  const f = fixture(); openQuiet(f);
  const uid = await sequence(f); await enrol(f, uid); consent(f, 11, 'email');
  f.db.prepare("INSERT INTO contact_replies (contact_id, direction, body, created_at) VALUES (11, 'inbound', 'Interested', datetime('now', '+1 minute'))").run();
  const r = await rowFor(f);
  assert.equal(r.state, 'stopped_replied');
  const draft = await call(f, FOUNDER, 'POST', `/api/grow/sequences/due/${r.enrolment_uid}/draft`, { project: PA });
  assert.equal(draft.status, 409);
  assert.equal(f.db.prepare('SELECT state FROM outreach_enrolments WHERE uid = ?').get(r.enrolment_uid).state, 'stopped_replied');
  f.db.prepare('DELETE FROM contact_replies').run();
  assert.equal((await rowFor(f)).state, 'stopped_replied');
});

test('LinkedIn, WhatsApp and Telegram steps are blocked with their fixed reasons, and cannot be built', async () => {
  const f = fixture(); openQuiet(f);
  const uid = await sequence(f);
  const seq = f.db.prepare('SELECT id FROM outreach_sequences WHERE uid = ?').get(uid).id;
  for (const [i, channel] of ['linkedin', 'whatsapp', 'telegram'].entries()) f.db.prepare('INSERT INTO outreach_steps (sequence_id, position, channel, wait_days, body) VALUES (?, ?, ?, 0, ?)').run(seq, i + 2, channel, 'Following up');
  await enrol(f, uid); consent(f, 11, 'email'); for (const c of ['linkedin', 'whatsapp', 'telegram']) consent(f, 11, c);
  f.db.prepare("UPDATE outreach_enrolments SET current_step = 2, next_due_at = '2026-11-01T00:00:00Z'").run();
  const r = await rowFor(f);
  assert.equal(r.state, 'blocked');
  assert.deepEqual(r.skipped.map((s) => s.reason), ['Needs LinkedIn’s approval.', 'Only to contacts who wrote first or opted in · after counsel’s review.', 'Only to contacts who wrote first or opted in · after counsel’s review.']);
  assert.equal(BLOCKED_REASONS.linkedin, 'Needs LinkedIn’s approval.');
  for (const channel of ['linkedin', 'whatsapp', 'telegram', 'sms']) {
    const add = await call(f, FOUNDER, 'POST', `/api/grow/sequences/${uid}/steps`, { project: PA, channel, body: 'x' });
    assert.equal(add.status, 400);
    assert.equal(add.body.detail, channel === 'sms' ? 'There is no SMS step.' : BLOCKED_REASONS[channel as 'linkedin']);
  }
  const detail = await call(f, FOUNDER, 'GET', `/api/grow/sequences/${uid}?project=${PA}`);
  assert.deepEqual(detail.body.steps.map((s: any) => s.blocked_reason), [null, BLOCKED_REASONS.linkedin, BLOCKED_REASONS.whatsapp, BLOCKED_REASONS.telegram]);
  assert.deepEqual(detail.body.enrolments[0].consent.map((c: any) => c.basis), ['opted_in', 'blocked', 'blocked', 'blocked']);
});

test('the draft endpoint writes a composer draft with the opt-out line and never calls the mail adapter', async (t) => {
  // Mutation checked: calling ADAPTERS.imap.send from the draft handler fails the spy count below.
  const f = fixture(); openQuiet(f);
  const spies: string[] = [];
  for (const [name, adapter] of Object.entries(ADAPTERS)) t.mock.method(adapter!, 'send', async () => { spies.push(name); return { messageId: 'x' }; });
  const uid = await sequence(f); await enrol(f, uid); consent(f, 11, 'email');
  const r = await rowFor(f);
  const made = await call(f, FOUNDER, 'POST', `/api/grow/sequences/due/${r.enrolment_uid}/draft`, { project: PA });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(spies, []);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_sent').get().n, 0);
  const d = made.body.draft;
  assert.equal(d.to, 'alice@example.test');
  assert.match(d.body, /You said a late shipment costs a day a week\./);
  assert.match(d.required_line, /^To stop these emails, open: https:\/\/app\.example\.test\/api\/grow\/optout\/a{32}\.[0-9a-f]{64}$/);
  assert.ok(d.body.endsWith(d.required_line));
  const again = await call(f, FOUNDER, 'POST', `/api/grow/sequences/due/${r.enrolment_uid}/draft`, { project: PA });
  assert.equal(again.body.draft.uid, d.uid, 'pressing twice reuses the same draft');
  // The send gate keeps the opt-out line and the recipient.
  const user = { id: FOUNDER, role: 'founder', founder_id: 10 } as any;
  await assert.rejects(sequenceSendGate(f.env, user, d.uid, d.to, 'Edited without the link'), (e: any) => e instanceof SequenceRefused && e.code === 'optout_required');
  await assert.rejects(sequenceSendGate(f.env, user, d.uid, 'bob@example.test', d.body), (e: any) => e instanceof SequenceRefused && e.code === 'sequence_recipient');
  assert.equal((await sequenceSendGate(f.env, user, d.uid, d.to, d.body))!.position, 1);
  assert.equal(await sequenceSendGate(f.env, { id: OTHER, role: 'founder', founder_id: 20 } as any, d.uid, d.to, d.body), null, 'another member’s draft is not theirs');
  // A reader may not draft.
  assert.equal((await call(f, ADVISOR, 'POST', `/api/grow/sequences/due/${r.enrolment_uid}/draft`, { project: PA })).status, 403);
});

test('the opt-out token records a suppression and stops the sequence; a forged token is 404; nothing is revealed', async () => {
  // Mutation checked: accepting any well-formed signature in readOptoutToken turns the forged call into 200.
  const f = fixture(); openQuiet(f);
  const uid = await sequence(f); await enrol(f, uid); consent(f, 11, 'email');
  const token = await optoutToken(f.env, ALICE);
  const forged = `${ALICE}.${token.slice(33).replace(/^./, (ch) => (ch === '0' ? '1' : '0'))}`;
  for (const bad of [forged, `${BOB}.${token.slice(33)}`, 'not-a-token']) {
    const r = await call(f, null, 'GET', `/api/grow/optout/${bad}`);
    assert.equal(r.status, 404, bad);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM venture_suppressions').get().n, 0);
  const ok = await call(f, null, 'GET', `/api/grow/optout/${token}`);
  assert.equal(ok.status, 200);
  assert.doesNotMatch(ok.text, /@|alice|Alice|Kestrel/i);
  const row = f.db.prepare('SELECT project_id, address_hash, reason FROM venture_suppressions').get();
  assert.deepEqual({ ...row }, { project_id: PA, address_hash: await suppressionHash(f.env, PA, 'alice@example.test'), reason: 'opted_out' });
  assert.equal(f.db.prepare('SELECT state FROM outreach_enrolments').get().state, 'stopped_optout');
  assert.equal((await rowFor(f)).state, 'stopped_optout');
  const html = await app.fetch(new Request(`http://t/api/grow/optout/${token}`, { headers: { accept: 'text/html' } }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  assert.equal(html.status, 200); assert.doesNotMatch(await html.text(), /@|Alice|Kestrel/);
});

test('another venture’s sequence is 404, and its contacts cannot be enrolled', async () => {
  // Mutation checked: dropping `AND s.project_id = ?` from sequenceOf lets venture A read B's sequence.
  const f = fixture();
  const theirs = await call(f, OTHER, 'POST', '/api/grow/sequences', { project: PB, name: 'Heron outreach', steps: [{ channel: 'email', subject: 'Hi', body: 'Hello' }] });
  assert.equal(theirs.status, 201);
  const uid = theirs.body.sequence.uid;
  for (const [method, path, body] of [['GET', `/api/grow/sequences/${uid}?project=${PA}`, undefined], ['PATCH', `/api/grow/sequences/${uid}`, { project: PA, name: 'Taken' }],
    ['DELETE', `/api/grow/sequences/${uid}`, { project: PA }], ['POST', `/api/grow/sequences/${uid}/enrol`, { project: PA, contacts: [{ uid: ALICE }] }]] as const) {
    assert.equal((await call(f, FOUNDER, method, path, body)).status, 404, `${method} ${path}`);
  }
  assert.equal((await call(f, FOUNDER, 'GET', `/api/grow/sequences/${uid}?project=${PB}`)).status, 403);
  const mine = await sequence(f, undefined, 'draft');
  const enrolled = await enrol(f, mine, [{ uid: FOREIGN, time_zone: 'UTC' }]);
  assert.equal(enrolled.enrolled, 0);
  assert.equal((await call(f, FOUNDER, 'GET', `/api/grow/sequences?project=${PA}`)).body.sequences.length, 1);
  assert.equal((await call(f, ADVISOR, 'POST', '/api/grow/sequences', { project: PA, name: 'Nope' })).status, 403);
  assert.equal((await call(f, ADVISOR, 'GET', `/api/grow/sequences?project=${PA}`)).status, 200);
});

test('Ask: a sequence proposal is email steps only, and Accept saves a draft sequence while the proposal is open', async () => {
  const { proposeRail } = await import('../src/services/railProposals.ts');
  const { DISTRIBUTION_PAGE, DISTRIBUTION_OPTION, decideDistribution, distributionOutput, distributionRequest, validDistributionPayload } = await import('../src/services/distributionDrafts.ts');
  const f = fixture();
  const input = distributionRequest({ project: PA, target: 'form', kinds: ['sequence'], sources: ['validate'] });
  assert.throws(() => distributionRequest({ project: PA, target: 'form', kinds: ['sequence', 'post'], sources: ['validate'] }), /one sequence/);
  const values = { name: 'Sign-ups who went furthest', steps: [{ subject: 'Setup', body: 'You said setup takes weeks.', wait_days: 0 }, { subject: 'Following up', body: 'Still weeks?', wait_days: 3 }] };
  assert.equal(distributionOutput(JSON.stringify({ drafts: [{ index: 0, values }] }), input, new Set())[0].kind, 'sequence');
  for (const bad of [{ ...values, steps: [{ ...values.steps[0], channel: 'whatsapp' }] }, { ...values, steps: [{ ...values.steps[0], wait_days: 2 }] }, { ...values, steps: [] }]) {
    assert.throws(() => distributionOutput(JSON.stringify({ drafts: [{ index: 0, values: bad }] }), input, new Set()), /sequence could not be read/);
  }
  const payload = { version: 1, project: PA, campaign_uid: null, target: 'form', kind: 'sequence', values, sources: [] };
  assert.ok(validDistributionPayload(payload));
  const p = await proposeRail(f.env, { userId: FOUNDER, page: DISTRIBUTION_PAGE, option: DISTRIBUTION_OPTION, record: `distribution:${PA}`, kind: 'draft', payload });
  const founder = { id: FOUNDER, role: 'founder', founder_id: 10 } as any;
  await decideDistribution(f.env, founder, PA, p.uid, 'accept');
  const seq = f.db.prepare('SELECT id, name, state, project_id FROM outreach_sequences').get();
  assert.deepEqual({ name: seq.name, state: seq.state, project_id: seq.project_id }, { name: 'Sign-ups who went furthest', state: 'draft', project_id: PA });
  assert.deepEqual(f.db.prepare('SELECT position, channel, wait_days, subject FROM outreach_steps WHERE sequence_id = ? ORDER BY position').all(seq.id).map((r: any) => ({ ...r })),
    [{ position: 1, channel: 'email', wait_days: 0, subject: 'Setup' }, { position: 2, channel: 'email', wait_days: 3, subject: 'Following up' }]);
  await assert.rejects(decideDistribution(f.env, founder, PA, p.uid, 'accept'), /already been decided|not open/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM outreach_sequences').get().n, 1, 'a decided proposal saves nothing again');
});

test('the pressed send (D1340) re-checks a sequence draft, keeps its opt-out line, then moves the enrolment on', async (t) => {
  const { default: mailAccounts } = await import('../src/routes/mail_accounts.ts');
  const { saveAccount } = await import('../src/services/mail/accounts.ts');
  const { buildMime } = await import('../src/services/mail/adapters/mime.ts');
  const f = fixture(); openQuiet(f);
  f.env.KEK_PII = 'synthetic-kek-d4493-only-'.repeat(3);
  const mail = new Hono<any>().route('/api/mail', mailAccounts);
  const sends: any[] = [];
  t.mock.method(ADAPTERS.outlook!, 'send', async (_env: any, _creds: any, msg: any) => { sends.push(msg); return { messageId: '<m@example.test>' }; });
  const acct = await saveAccount(f.env, { id: FOUNDER, role: 'founder' } as any, { provider: 'outlook', address: 'founder@example.test', display_name: null, scopes: 'Mail.Send', can_read: false, creds: { kind: 'oauth', refresh_token: 'synthetic-refresh-d4493' } });
  const uid = await sequence(f); await enrol(f, uid); consent(f, 11, 'email');
  const r = await rowFor(f);
  const d = (await call(f, FOUNDER, 'POST', `/api/grow/sequences/due/${r.enrolment_uid}/draft`, { project: PA })).body.draft;
  const press = async (body: string, to = d.to) => {
    const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const post = (path: string, json: unknown) => mail.fetch(new Request(`http://t${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(json) }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
    const nonce = (await (await post('/api/mail/send/confirm', { account_uid: acct.uid })).json() as any).nonce;
    const res = await post('/api/mail/send', { account_uid: acct.uid, to, subject: d.subject, body, draft_uid: d.uid, nonce });
    return { status: res.status, body: await res.json() as any };
  };
  const edited = await press('Edited, and the link was removed.');
  assert.equal(edited.body.error, 'optout_required', JSON.stringify(edited));
  assert.equal((await press(d.body, 'bob@example.test')).body.error, 'sequence_recipient');
  assert.equal(sends.length, 0, 'a refused sequence send reaches no adapter');
  const ok = await press(d.body);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(sends.length, 1); assert.equal(sends[0].to, 'alice@example.test'); assert.equal(sends[0].attachments, undefined);
  assert.equal(f.db.prepare('SELECT state FROM outreach_enrolments WHERE uid = ?').get(r.enrolment_uid).state, 'done');
  assert.equal((await press(d.body)).status, 409, 'the same step is not sent twice');
  assert.equal(sends.length, 1);
  // A voice note is a multipart attachment; plain mail is unchanged.
  const plain = buildMime({ from: 'a@example.test', fromName: null, to: 'b@example.test', subject: 'S', body: 'B' }, 'id@example.test');
  assert.match(plain, /Content-Type: text\/plain; charset=UTF-8/); assert.doesNotMatch(plain, /multipart/);
  const withNote = buildMime({ from: 'a@example.test', fromName: null, to: 'b@example.test', subject: 'S', body: 'B', attachments: [{ filename: 'voice-note.webm', mime: 'audio/webm', bytes: new Uint8Array([1, 2, 3]) }] }, 'id@example.test');
  assert.match(withNote, /multipart\/mixed; boundary="axal-[0-9a-f]{32}"/); assert.match(withNote, /filename="voice-note\.webm"/); assert.match(withNote, /AQID/);
});
