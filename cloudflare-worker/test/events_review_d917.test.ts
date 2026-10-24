/** D917 / #2700: real review routes, migration 546, private host history and queue age. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import adminEvents from '../src/routes/admin_events.ts';
import events from '../src/routes/events.ts';
import { shapeEvent } from '../src/services/eventsCommon.ts';
import { ensureEventsSchema } from '../src/services/eventsSchema.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
const SECRET = 'synthetic-events-review-test-key-'.repeat(2);
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql', '546_events_review_columns.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE activity_logs (user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    CREATE TABLE admin_audit_log (admin_user_id INTEGER, action TEXT, report_type TEXT, filters_json TEXT, actor TEXT);
    INSERT INTO users VALUES (1, 'admin', 'admin@example.test', 'Admin fixture', 'admin', 1),
      (2, 'host', 'host@example.test', 'Host fixture', 'founder', 1),
      (3, 'other', 'other@example.test', 'Other fixture', 'founder', 1);
    INSERT INTO events (id, slug, host_user_id, title, starts_at, visibility, status, created_at)
      VALUES (1, 'fixture-event', 2, 'Fixture event', '2099-01-01T10:00:00Z', 'public', 'pending_review', '2026-01-01T00:00:00Z');`);
  let race: string | null = null;
  let failPaid = false;
  const DB: any = { prepare(sql: string) {
    let args: any[] = [];
    const statement: any = {
      bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
      async first() {
        if (race && sql.startsWith('UPDATE events')) { db.prepare('UPDATE events SET status = ? WHERE id = 1').run(race); race = null; }
        return db.prepare(sql).get(...args) || null;
      },
      async all() { if (failPaid && sql.includes('SUM(r.amount_cents)')) throw new Error('synthetic ledger unavailable'); return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };return statement;
  }, async batch(stmts: any[]) { return Promise.all(stmts.map(s => s.run())); } };
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SECRET };
  async function request(path: string, user = 1, body?: unknown, method = 'POST', router = adminEvents) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return router.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  }
  return { db, env, request, race: (s: string) => { race = s; }, failPaid: () => { failPaid = true; } };
}
const row = (db: DatabaseSync): any => db.prepare('SELECT * FROM events WHERE id = 1').get();
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('D917 migration applies to a fresh events schema and the lazy mirror exposes all four nullable fields', async () => {
  const { db } = fixture();
  for (const col of ['submitted_at', 'approved_at', 'review_note', 'changed_after_approval_at']) assert.equal(row(db)[col], null);
  const fresh = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const env: any = { DB: { prepare(sql: string) { return { async run() { fresh.exec(sql); } }; } }, ENVIRONMENT: 'development' };
  await ensureEventsSchema(env);
  const cols = fresh.prepare('PRAGMA table_info(events)').all();
  for (const col of ['submitted_at', 'approved_at', 'review_note', 'changed_after_approval_at']) {
    const c: any = cols.find(r => r.name === col);assert.equal(c?.type, 'TEXT');assert.equal(c.notnull, 0);
  }
});

test('D917 review submission stamps submission time, approval stamps approval and private reads expose the history', async () => {
  const f = fixture();f.db.exec("UPDATE events SET status='draft', changed_after_approval_at='2026-01-02T00:00:00Z'");
  const submission: any = await (await f.request('/1/submit-review', 2, {}, 'POST', events)).json();
  assert.equal(submission.event.status, 'pending_review');assert.match(submission.event.submitted_at, iso);
  const approved = await f.request('/1/approve');assert.equal(approved.status, 200);
  const body: any = await approved.json();assert.equal(body.event.status, 'published');assert.equal(body.event.admin_published, true);
  assert.match(body.event.approved_at, iso);assert.equal(body.event.changed_after_approval_at, null);
  const host: any = await (await f.request('/1', 2, undefined, 'GET', events)).json();assert.equal(host.event.approved_at, body.event.approved_at);
  for (const col of ['submitted_at','approved_at','review_note','changed_after_approval_at']) assert.equal(col in shapeEvent(row(f.db))!, false);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='event_approved'").get()!.n, 1);
});

test('D917 approve and reject refuse every non-waiting state without audit or notification', async () => {
  for (const state of ['draft','published','rejected','cancelled']) for (const action of ['approve','reject']) {
    const f = fixture();f.db.prepare('UPDATE events SET status=?').run(state);
    const res = await f.request('/1/'+action, 1, { reason: 'Reason fixture' });
    assert.equal(res.status, 409);assert.deepEqual(await res.json(), { error: 'not_waiting' });assert.equal(row(f.db).status, state);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n, 0);
  }
});

test('D917 state predicates refuse a concurrent review/unpublish/cancel decision', async () => {
  for (const action of ['approve','reject','unpublish','cancel']) {
    const f = fixture();if (action === 'unpublish') f.db.exec("UPDATE events SET status='published'");
    f.race('cancelled');const res = await f.request('/1/'+action, 1, { reason: 'Synthetic reason' });
    assert.equal(res.status, 409);assert.equal(row(f.db).status, 'cancelled');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n, 0);
  }
});

test('D917 send-back requires a nonblank string and stores a trimmed, capped reason for the host', async () => {
  const f = fixture();for (const reason of [undefined, '', '   ', 1, {}]) {
    const res = await f.request('/1/reject', 1, { reason });assert.equal(res.status, 400);assert.deepEqual(await res.json(), { error: 'reason_required' });assert.equal(row(f.db).status, 'pending_review');
  }
  const reason = 'Reason fixture '.repeat(100);const res = await f.request('/1/reject', 1, { reason: '  '+reason+'  ' });assert.equal(res.status, 200);
  const body: any = await res.json();assert.equal(body.event.status, 'rejected');assert.equal(body.event.review_note, reason.trim().slice(0,1000));
  const host: any = await (await f.request('/1', 2, undefined, 'GET', events)).json();assert.equal(host.event.review_note, body.event.review_note);
  const notice: any = f.db.prepare("SELECT * FROM notifications_inbox WHERE type='event_rejected'").get();assert.equal(notice.user_id, 2);assert.equal(notice.body, body.event.review_note);
});

test('D917 material host edits flag approval without re-queuing; nonmaterial and unchanged edits do not', async () => {
  const changes = { title: 'Changed fixture', starts_at: '2099-01-02T10:00:00Z', ends_at: '2099-01-02T12:00:00Z', timezone: 'Europe/Paris', location_kind: 'physical', location_text: 'Fixture place', location_url: 'https://example.test/fixture', price_cents: 300, currency: 'eur' };
  for (const [key, value] of Object.entries(changes)) {
    const f=fixture();f.db.exec("UPDATE events SET status='published', admin_published=1, approved_at='2026-01-03T00:00:00Z'");
    const res = await f.request('/1', 2, { [key]: value }, 'PATCH', events);assert.equal(res.status, 200);
    const body: any = await res.json();assert.match(body.event.changed_after_approval_at, iso);assert.equal(body.event.status, 'published');assert.equal(body.event.admin_published, true);
  }
  for (const [state, approved, user, body] of [
    ['published', 1, 2, { title: 'Fixture event' }], ['published',1,2,{location_kind:'unaccepted'}],
    ['published',1,2,{currency:''}], ['published',1,2,{currency:null}], ['published',1,2,{price_cents:'0'}], ['published',1,2,{ summary:'Other summary' }], ['draft',0,2,{title:'Changed fixture'}], ['published',1,1,{title:'Admin edit'}],
  ] as const) {
    const f=fixture();f.db.prepare('UPDATE events SET status=?, admin_published=?').run(state,approved);
    assert.equal((await f.request('/1',user,body,'PATCH',events)).status,200);assert.equal(row(f.db).changed_after_approval_at,null);
  }
  const legacy=fixture();legacy.db.exec("UPDATE events SET status='published', admin_published=1");
  await legacy.request('/1',2,{title:'Legacy approval edit'},'PATCH',events);assert.match(row(legacy.db).changed_after_approval_at,iso);
});

test('D917 unpublish only accepts published, notifies the host of a draft, and caps the optional note', async () => {
  const f=fixture();assert.equal((await f.request('/1/unpublish')).status,409);f.db.exec("UPDATE events SET status='published', admin_published=1");
  const note='x'.repeat(1100);const res=await f.request('/1/unpublish',1,{note});assert.equal(res.status,200);assert.equal(row(f.db).status,'draft');assert.equal(row(f.db).admin_published,0);
  const notice:any=f.db.prepare("SELECT * FROM notifications_inbox WHERE type='event_unpublished'").get();assert.equal(notice.user_id,2);assert.match(notice.title,/draft/);assert.equal(notice.body,note.slice(0,1000));
  assert.equal((await f.request('/1/unpublish')).status,409);
});

test('D917 cancellation reports only paid registrations in recorded cents by currency, retains payments, and sends capped notes', async () => {
  const f=fixture();
  f.db.exec(`INSERT INTO event_registrations (event_id,user_id,status,payment_status,amount_cents) VALUES
    (1,2,'confirmed','paid',700),(1,3,'registered','paid',300),(1,NULL,'cancelled','paid',200),
    (1,NULL,'confirmed','pending',900),(1,NULL,'confirmed','free',0),(1,NULL,'confirmed','refunded',500);`);
  f.db.exec("INSERT INTO events (id,slug,title,starts_at,currency) VALUES (2,'other-currency','Other fixture','2099-01-01','eur'); INSERT INTO event_registrations(event_id,status,payment_status,amount_cents) VALUES (2,'confirmed','paid',9000);");
  const before=f.db.prepare('SELECT * FROM event_registrations ORDER BY id').all();const note='n'.repeat(1100);
  const res=await f.request('/1/cancel',1,{note});assert.equal(res.status,200);const body:any=await res.json();
  assert.equal(body.event.status,'cancelled');assert.deepEqual(body.paid_tickets,{ count:3,by_currency:[{currency:'usd',amount_cents:1200}] });
  assert.deepEqual(f.db.prepare('SELECT * FROM event_registrations ORDER BY id').all(),before);
  const notices=f.db.prepare("SELECT * FROM notifications_inbox WHERE type='event_cancelled' ORDER BY user_id").all();assert.deepEqual(notices.map(r=>[r.user_id,r.body]),[[2,note.slice(0,1000)],[3,note.slice(0,1000)]]);
  const repeat=await f.request('/1/cancel');assert.equal(repeat.status,409);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type='event_cancelled'").get()!.n,2);
  const empty=fixture();const noPaid:any=await (await empty.request('/1/cancel')).json();assert.deepEqual(noPaid.paid_tickets,{count:0,by_currency:[]});
});

test('D917 a failed paid ledger leaves the event untouched; outsiders cannot review or edit', async () => {
  const f=fixture();f.failPaid();assert.equal((await f.request('/1/cancel')).status,500);assert.equal(row(f.db).status,'pending_review');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n,0);
  for (const action of ['approve','reject','unpublish','cancel']) assert.equal((await f.request('/1/'+action,3,{reason:'Fixture'})).status,403);
  assert.equal((await f.request('/1',3,{title:'Not permitted'},'PATCH',events)).status,403);
});

test('D917 approval lane ages and orders from submitted_at, falling back to created_at for legacy submissions', () => {
  const f=fixture();f.db.exec("UPDATE events SET submitted_at='2026-03-02T00:00:00Z'; INSERT INTO events(id,slug,host_user_id,title,starts_at,status,created_at) VALUES (2,'legacy',2,'Legacy fixture','2099-01-01','pending_review','2026-03-01T00:00:00Z')");
  const source=APPROVAL_SOURCES.find(s=>s.key==='events')!;
  const counts:any=f.db.prepare(source.countSql).get();assert.equal(counts.n,2);assert.equal(counts.oldest,'2026-03-01 00:00:00');
  const rows=f.db.prepare(source.rowsSql).all(10);assert.deepEqual(rows.map(r=>[r.id,r.created_at]),[[2,'2026-03-01T00:00:00Z'],[1,'2026-03-02T00:00:00Z']]);
  f.db.exec("UPDATE events SET submitted_at='2026-03-02T08:00:00.000Z' WHERE id=1; UPDATE events SET created_at='2026-03-02 10:00:00' WHERE id=2");
  assert.equal(f.db.prepare(source.countSql).get()!.oldest,'2026-03-02 08:00:00');
  assert.deepEqual(f.db.prepare(source.rowsSql).all(10).map(r=>r.id),[1,2]);
});


test('D917 changing a self-published event to public starts its review clock afresh', async () => {
  const f=fixture();f.db.exec("UPDATE events SET visibility='unlisted', status='published', admin_published=0, submitted_at='2026-01-02T00:00:00Z'");
  const res=await f.request('/1',2,{visibility:'public'},'PATCH',events);assert.equal(res.status,200);
  const body:any=await res.json();assert.equal(body.event.status,'pending_review');assert.match(body.event.submitted_at,iso);
  assert.notEqual(body.event.submitted_at,'2026-01-02T00:00:00Z');assert.equal(body.event.created_at,'2026-01-01T00:00:00Z');
  assert.equal(body.event.changed_after_approval_at,null);
});
