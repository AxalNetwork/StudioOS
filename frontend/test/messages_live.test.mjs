/**
 * Messages: membership is the only key, and "unified" is not claimed (Wave 4).
 *
 * The canvas calls this a "unified inbox across intro / co-founder match /
 * role search / engagement / advisory threads". Unified implies merging
 * conversations that exist. They do not. D1 holds exactly two message-shaped
 * stores and neither is a peer conversation:
 *
 *   - `advisor_messages`, the AI assistant transcript (roles: user |
 *     assistant | tool | system)
 *   - `customer_chat_threads`/`_messages`, a Slack-bridged support thread
 *
 * So this inbox is genuinely new, starts empty, and the empty state says where
 * those two live instead of implying they were folded in. If a future change
 * really does merge them, the last test here fails and this file is the note
 * explaining what to reconsider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const PAGE = 'frontend/src/pages/MessagesPage.jsx';
const ROUTE = 'cloudflare-worker/src/routes/messages.ts';

test('every read and write is gated on participation', () => {
  const w = read(ROUTE);
  // The one helper, joining participants on the caller.
  assert.match(w, /JOIN message_thread_participants p ON p\.thread_id = t\.id AND p\.user_id = \?/);
  // Each handler that takes a :uid must resolve through it.
  const handlers = [...w.matchAll(/r\.(get|post)\('\/:uid[^']*'/g)].length;
  const memberChecks = (w.match(/await memberThread\(c\.env/g) || []).length;
  assert.equal(memberChecks, handlers,
    'every :uid handler must resolve the thread through memberThread');
});

test('there is no admin override on a private conversation', () => {
  // Deliberate divergence from the other tenancy scopes: a fund or a project
  // has an oversight reading, a two-person conversation does not. An operator
  // who needs one has the audit log.
  const w = read(ROUTE);
  assert.ok(!/isAdmin|role === 'admin'|UNSCOPED/.test(w),
    'no role check may widen access to someone else’s messages');
});

test('a thread you are not in is indistinguishable from one that does not exist', () => {
  const w = read(ROUTE);
  const notFound = (w.match(/detail: 'Conversation not found' \}, 404/g) || []).length;
  assert.ok(notFound >= 4, 'every :uid handler must 404 rather than 403');
  // The rationale comment names 403 to explain why it is not used, so the ban
  // has to look at code only.
  assert.ok(!/403/.test(codeOnly(w)), 'a 403 would confirm the conversation is real');
});

test('unread is derived, never stored', () => {
  const w = read(ROUTE);
  assert.match(w, /p\.last_read_at IS NULL OR m\.created_at > p\.last_read_at/);
  // A stored counter is a second source of truth that drifts on a half-failed
  // write, so no such column exists.
  const sql = readdirSync(resolve(root, 'cloudflare-worker/sql/migrations'))
    .map((f) => readFileSync(join(root, 'cloudflare-worker/sql/migrations', f), 'utf8')).join('\n');
  const i = sql.indexOf('CREATE TABLE IF NOT EXISTS message_thread_participants');
  const ddl = sql.slice(i, sql.indexOf(');', i));
  assert.ok(!/unread/i.test(ddl), 'unread must not be a column');
  assert.match(ddl, /last_read_at TEXT/);
});

test('sending marks read, so your own message never counts against you', () => {
  const w = read(ROUTE);
  const send = w.slice(w.indexOf("r.post('/:uid/messages'"), w.indexOf("r.post('/:uid/read'"));
  assert.match(send, /UPDATE message_thread_participants SET last_read_at = \?/);
});

test('a thread may only be pinned to an object that exists as a type', () => {
  const w = read(ROUTE);
  assert.match(w, /const SUBJECT_TYPES = new Set\(\['introduction', 'match', 'engagement', 'service', 'session', 'job'\]\)/);
  assert.match(w, /!SUBJECT_TYPES\.has\(String\(body\.subject_type\)\)/,
    'a free-text subject_type would let the UI invent context rails');
  // …and a thread pinned to nothing is legitimate, not a defect.
  const sql = read('cloudflare-worker/sql/migrations/185_messages.sql');
  assert.match(sql, /subject_type\s+TEXT,/, 'nullable — a direct message is about nothing');
});

test('starting a conversation does not promise an invitation', () => {
  assert.match(read(ROUTE), /No account with that address/);
  assert.match(read(PAGE), /does not send an invitation/i);
});

test('the route is reachable — guard([]) would deny everyone', () => {
  // RoleGuard tests `allowedRoles.includes(effectiveRole)`, which is always
  // false on an empty array. A route registered that way exists, passes any
  // "is it registered" assertion, and is unreachable by every user. The first
  // draft of this route had exactly that.
  const app = read('frontend/src/App.jsx');
  const line = app.split('\n').find((l) => l.includes('path="/messages"'));
  assert.ok(line, '/messages must be registered');
  assert.ok(!/guard\(\[\]/.test(line), 'an empty allowedRoles denies every caller');
  for (const role of ['admin', 'founder', 'partner', 'investor', 'advisor']) {
    assert.ok(line.includes(`'${role}'`), `${role} must be able to reach their own inbox`);
  }
});

test('the empty state does not claim to have unified anything', () => {
  const s = read(PAGE);
  assert.match(s, /No conversations yet/);
  // It names where the other two conversation stores actually live.
  assert.match(s, /Eadwyn/, 'the assistant transcript is not folded in');
  assert.match(s, /Tickets/, 'support is not folded in');
  // The page's doc header quotes the canvas's own word to explain why the
  // claim is NOT made, so check the rendered copy rather than the file.
  assert.ok(!/unified|all your conversations in one place/i.test(codeOnly(s)));
});

test('the AI transcript and the support bridge are still separate stores', () => {
  // The premise of the copy above. If a later change merges them, this fails
  // and the empty state needs rewriting.
  const dir = resolve(root, 'cloudflare-worker/sql/migrations');
  const sql = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS advisor_messages'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS customer_chat_threads'));
  const w = read(ROUTE);
  assert.ok(!/advisor_messages|customer_chat/.test(w),
    'the inbox must not read the assistant transcript or the Slack bridge');
});

test('every api.* the page calls exists on both sides', () => {
  const called = new Set([...read(PAGE).matchAll(/\bapi\.([A-Za-z0-9_]+)\(/g)].map((m) => m[1]));
  const apiSrc = read('frontend/src/lib/api.js');
  const missing = [...called].filter((m) => !new RegExp(`^\\s{2}${m}:`, 'm').test(apiSrc));
  assert.deepEqual(missing, [], `api.js does not define: ${missing.join(', ')}`);
});
