/**
 * D544 (#1107; S1's decision Q1 B) — a ticket's type is a required choice with
 * no default. Before this, a ticket sent with no type was filed as `task`, so
 * an ordinary support request reached the Super Admin's suggested-task queue
 * (migration 383's trigger turns every `task` ticket into a pending suggestion).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ticket_type_required_d544.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import tickets from '../src/routes/tickets.ts';
import { validateTicketCreate } from '../src/services/githubSync.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const M333 = readFileSync('cloudflare-worker/sql/migrations/333_ticket_category_sla_tiers.sql', 'utf8');
const FOUNDER = 3;

function fresh() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'tickets', 'activity_logs', 'mi_pro_subscriptions']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M333);
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', 'Fay Founder', 'fay@example.test', 1)").run(FOUNDER);
  return db;
}

const app = new Hono<any>().route('/api/tickets', tickets);
async function post(db: DatabaseSync, body: unknown) {
  const jwt = await new SignJWT({ user_id: FOUNDER }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const w = console.warn; console.warn = () => {};
  try {
    const res = await app.request('/api/tickets', {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; }
}

test('the validator refuses a ticket with no type, an empty one, or a blank one', () => {
  for (const type of [undefined, null, '', '   ']) {
    const r = validateTicketCreate({ title: 'Help', priority: 'low', ...(type === undefined ? {} : { type }) });
    assert.equal(r.ok, false, JSON.stringify(type));
    if (!r.ok) assert.equal(r.error, 'type is required: one of bug|feature|task');
  }
  assert.equal(validateTicketCreate({ title: 'Help', type: 'chore' }).ok, false);
  for (const [sent, kept] of [['task', 'task'], ['Bug', 'bug'], [' FEATURE ', 'feature']]) {
    const r = validateTicketCreate({ title: 'Help', type: sent });
    assert.ok(r.ok, sent);
    if (r.ok) assert.equal(r.value.type, kept);
  }
});

test('POST /api/tickets refuses a missing type and stores nothing', async () => {
  const db = fresh();
  const r = await post(db, { title: 'My invoice is wrong', priority: 'medium', description: 'd' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'type is required: one of bug|feature|task' });
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n), 0, 'a typeless ticket was stored as a task');
  const ok = await post(db, { title: 'My invoice is wrong', priority: 'medium', type: 'bug' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((db.prepare('SELECT type FROM tickets').get() as any).type, 'bug');
});

test('both callers that create tickets send a type', () => {
  const tp = readFileSync('frontend/src/pages/TicketsPage.jsx', 'utf8');
  assert.match(tp, /api\.createTicket\(form\)/);
  assert.match(tp, /type: '[a-z]+'/, 'the Tickets page form no longer carries a type');
  const pa = readFileSync('frontend/src/components/advisor/PersonalAdvisor.jsx', 'utf8');
  assert.match(pa, /const \[type, setType\] = useState\('task'\);/);
});
