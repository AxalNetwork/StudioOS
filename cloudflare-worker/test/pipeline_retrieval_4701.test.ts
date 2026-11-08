/**
 * #4701 — Pipeline retrieval is complete, a failed source is not a zero, and a
 * vote reaches the other boards.
 *
 * Every case runs the real router on the real migrated schema
 * (`_storage_schema.ts`), with fixtures larger than the old caps. A fixture
 * under the cap passes against the broken build too, which is how the broken
 * build shipped.
 *
 *   * a lead list whose newest 200 needs were all passed still shows the older
 *     actionable ones (the exclusion is in the WHERE clause, not after the cap);
 *   * a pass older than the newest 200 passes still excludes its need;
 *   * pages walk a 450-row population with no gap and no repeat, and a total
 *     describes the 450, not the page;
 *   * child reads (versions, terms, usage) are bound to the returned parents;
 *   * the delivery figures say "unavailable" when their read fails, and the
 *     quote figures that did read stay;
 *   * a vote publishes its AGGREGATE tally after the row is committed, and the
 *     message carries no comment, no voter and no viewer state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import partnerPipeline from '../src/routes/partner_pipeline.ts';
import pipeline from '../src/routes/pipeline.ts';
import { quotesRouter } from '../src/routes/needs.ts';
import votes from '../src/routes/votes.ts';

test.after(() => removeMigratedDatabases());

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
type Db = ReturnType<typeof migratedDatabase>;

function coerce(a: any[]): any[] { return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v)); }
function makeD1(db: Db, hooks: { log?: { sql: string; bound: any[] }[]; failOn?: RegExp } = {}) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const guard = () => {
        hooks.log?.push({ sql, bound: b });
        if (hooks.failOn && hooks.failOn.test(sql)) throw new Error('D1_ERROR: simulated read failure');
      };
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { guard(); return db.prepare(sql).get(...b) ?? null; },
        async all() { guard(); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          guard();
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}
async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 1000).toISOString().replace('T', ' ').slice(0, 19);

const PARTNER_USER = 80;
const PARTNER_ID = 1;

function seedPartner(db: Db) {
  db.prepare("INSERT INTO partners (id, name, email) VALUES (?,?,?)").run(PARTNER_ID, 'Ours', 'ours@example.com');
  db.prepare("INSERT INTO partners (id, name, email) VALUES (?,?,?)").run(2, 'Theirs', 'theirs@example.com');
  db.prepare("INSERT INTO users (id, email, name, role, partner_id) VALUES (?,?,?,?,?)").run(PARTNER_USER, 'ours@example.com', 'Ours', 'partner', PARTNER_ID);
  db.prepare("INSERT INTO founders (id, name, email) VALUES (?,?,?)").run(5, 'Fran', 'fran@example.com');
}
function seedNeeds(db: Db, count: number, title = (i: number) => `Need ${i}`) {
  const st = db.prepare("INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description, created_at) VALUES (?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= count; i += 1) st.run(i, `n-${i}`, 9, 5, 'engineering', title(i), 'desc', stamp(i));
}
function envFor(db: Db, hooks?: Parameters<typeof makeD1>[1], extra: Record<string, unknown> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, hooks), ...extra };
}
async function get(router: { request: Function }, path: string, e: any, userId = PARTNER_USER, role = 'partner') {
  const res = await router.request(path, { headers: { Authorization: `Bearer ${await token(userId, role)}` } }, e);
  return { status: res.status as number, body: await res.json().catch(() => null) as any };
}

// ── Leads ────────────────────────────────────────────────────────────────────

test('the newest 200 needs all passed: older actionable leads are still returned', async () => {
  const db = migratedDatabase(); seedPartner(db); seedNeeds(db, 230);
  const pass = db.prepare("INSERT INTO partner_lead_passes (partner_id, need_id, reason, passed_at) VALUES (?,?,?,?)");
  // Needs 21..230 are the newest 210; all passed. Needs 1..20 are the only actionable ones.
  for (let i = 21; i <= 230; i += 1) pass.run(PARTNER_ID, i, 'timing', stamp(i));
  const r = await get(partnerPipeline, '/leads', envFor(db));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((x: any) => x.need_id).sort((a: number, b: number) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(r.body.open_count, 20);
  assert.equal(r.body.has_more, false);
});

test('a pass older than the newest 200 passes still keeps its need out of the lead list', async () => {
  const db = migratedDatabase(); seedPartner(db); seedNeeds(db, 260);
  const pass = db.prepare("INSERT INTO partner_lead_passes (partner_id, need_id, reason, passed_at) VALUES (?,?,?,?)");
  // 250 passes. Need 1's pass is the OLDEST, so it falls outside a 200-row passes read.
  for (let i = 1; i <= 250; i += 1) pass.run(PARTNER_ID, i, 'price', stamp(i));
  const r = await get(partnerPipeline, '/leads', envFor(db));
  const ids = new Set(r.body.items.map((x: any) => x.need_id));
  assert.equal(ids.has(1), false, 'a passed need came back as a lead');
  assert.equal(r.body.items.length, 10);
  assert.equal(r.body.passed_count, 250, 'the pass total describes every pass, not the page');
  assert.equal(r.body.passed.length, 200);
  assert.equal(r.body.passed_has_more, true);
  const rest = await get(partnerPipeline, `/leads?passed_cursor=${encodeURIComponent(r.body.passed_next_cursor)}`, envFor(db));
  assert.equal(rest.body.passed.length, 50);
  assert.equal(rest.body.passed_has_more, false);
});

test('pages walk 450 open leads with no gap and no repeat, and every page reports the full total', async () => {
  const db = migratedDatabase(); seedPartner(db); seedNeeds(db, 450);
  const seen: number[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const path: string = cursor ? `/leads?cursor=${encodeURIComponent(cursor)}` : '/leads';
    const r = await get(partnerPipeline, path, envFor(db));
    assert.equal(r.status, 200);
    assert.equal(r.body.open_count, 450);
    assert.equal(r.body.has_more, r.body.next_cursor !== null);
    seen.push(...r.body.items.map((x: any) => x.need_id));
    cursor = r.body.next_cursor; pages += 1;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(seen.length, 450);
  assert.equal(new Set(seen).size, 450);
});

test('the excluded count covers leads on pages the caller did not ask for', async () => {
  const db = migratedDatabase(); seedPartner(db);
  seedNeeds(db, 300, (i) => (i <= 40 ? `Native mobile app ${i}` : `Web app ${i}`));
  db.prepare("INSERT INTO partner_fit_rules (uid, partner_id, kind, value, statement) VALUES (?,?,?,?,?)")
    .run('r1', PARTNER_ID, 'sector_declined', 'native mobile', 'We do not do native mobile.');
  const r = await get(partnerPipeline, '/leads', envFor(db));
  // Needs 1..40 are the OLDEST, so none is on the first page of 200.
  assert.equal(r.body.items.some((x: any) => x.excluded_by), false);
  assert.equal(r.body.excluded_count, 40);
  assert.equal(r.body.open_count, 300);
});

test('a malformed cursor is a 400, not a silent restart from page one', async () => {
  const db = migratedDatabase(); seedPartner(db); seedNeeds(db, 5);
  for (const path of ['/leads?cursor=%%%', '/leads?cursor=bm90LWpzb24', '/proposals?cursor=W10', '/negotiations?cursor=W10', '/retainers?cursor=W10']) {
    const r = await get(partnerPipeline, path, envFor(db));
    assert.equal(r.status, 400, path);
  }
});

// ── Proposals, negotiations, retainers ───────────────────────────────────────

function seedQuotes(db: Db, count: number, status: (i: number) => string = () => 'submitted') {
  seedNeeds(db, count);
  const st = db.prepare("INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, status, decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= count; i += 1) {
    const s = status(i);
    st.run(i, `q-${i}`, i, PARTNER_ID, 1000, 'd', s, s === 'accepted' || s === 'rejected' ? stamp(i + 5) : null, stamp(i));
  }
}

test('proposal totals describe all 230 bids; the version trail is read for the returned page only', async () => {
  const db = migratedDatabase(); seedPartner(db);
  seedQuotes(db, 230, (i) => (i <= 30 ? 'accepted' : i <= 50 ? 'rejected' : 'submitted'));
  const v = db.prepare("INSERT INTO quote_versions (quote_id, version, change_summary) VALUES (?,?,?)");
  v.run(1, 2, 'oldest, page two'); v.run(230, 2, 'newest, page one');
  const log: { sql: string; bound: any[] }[] = [];
  const r = await get(partnerPipeline, '/proposals', envFor(db, { log }));
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 200);
  assert.equal(r.body.has_more, true);
  assert.equal(r.body.won_count, 30);
  assert.equal(r.body.lost_count, 20);
  assert.equal(r.body.decided_count, 50);
  assert.equal(r.body.live_count, 180);
  assert.equal(r.body.win_rate_pct, 60);
  const first = r.body.items.find((x: any) => x.quote_id === 230);
  assert.equal(first.version, 2);
  assert.equal(r.body.items.some((x: any) => x.quote_id === 1), false);
  const trailReads = log.filter((l) => /FROM quote_versions/.test(l.sql));
  assert.ok(trailReads.length > 0);
  for (const t of trailReads) assert.match(t.sql, /json_each/, 'versions must be read for a bound id list');
  // The first page's trail read names exactly the page's 200 quotes.
  assert.equal(JSON.parse(trailReads[0].bound[1]).length, 200);
  const next = await get(partnerPipeline, `/proposals?cursor=${encodeURIComponent(r.body.next_cursor)}`, envFor(db));
  assert.equal(next.body.items.length, 30);
  assert.equal(next.body.has_more, false);
  assert.equal(next.body.items.find((x: any) => x.quote_id === 1).version, 2);
});

test('negotiation totals and terms: whole book counted, terms read for the page only', async () => {
  const db = migratedDatabase(); seedPartner(db); seedQuotes(db, 230);
  const g = db.prepare("INSERT INTO quote_negotiations (id, uid, quote_id, stage, ball, last_moved_at) VALUES (?,?,?,?,?,?)");
  for (let i = 1; i <= 230; i += 1) g.run(i, `g-${i}`, i, i <= 10 ? 'closed' : 'terms', i % 2 ? 'us' : 'them', '2020-01-01 00:00:00');
  db.prepare("INSERT INTO quote_terms (uid, negotiation_id, label) VALUES (?,?,?)").run('t1', 230, 'Newest term');
  db.prepare("INSERT INTO quote_terms (uid, negotiation_id, label) VALUES (?,?,?)").run('t2', 1, 'Oldest term');
  const log: { sql: string; bound: any[] }[] = [];
  const r = await get(partnerPipeline, '/negotiations', envFor(db, { log }));
  assert.equal(r.body.items.length, 200);
  assert.equal(r.body.has_more, true);
  assert.equal(r.body.live_count, 220);
  assert.equal(r.body.stalled_count, 220);
  assert.equal(r.body.awaiting_us_count + r.body.awaiting_them_count, 220);
  assert.deepEqual(r.body.items.find((x: any) => x.quote_id === 230).terms.map((t: any) => t.label), ['Newest term']);
  const termReads = log.filter((l) => /FROM quote_terms/.test(l.sql));
  for (const t of termReads) assert.match(t.sql, /json_each/);
  assert.equal(JSON.parse(termReads[0].bound[1]).length, 200);
});

test('retainer totals are over all 230 retainers, and pages are gap-free in the display order', async () => {
  const db = migratedDatabase(); seedPartner(db); seedQuotes(db, 230, () => 'accepted');
  const eng = db.prepare("INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
  const ret = db.prepare("INSERT INTO partner_retainers (id, uid, engagement_id, shape, cadence, amount_cents, retained_hours, renews_at) VALUES (?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= 230; i += 1) {
    eng.run(i, `e-${i}`, i, i, PARTNER_ID, 5, 9, 1000, stamp(i));
    ret.run(i, `r-${i}`, i, 'retainer', 'monthly', 10_000, 10, `2027-01-${String((i % 28) + 1).padStart(2, '0')}`);
  }
  // Engagement 231 has no retainer: it sorts after every retainer.
  db.prepare("INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, status) VALUES (231,'q-231',1,2,1,'d','accepted')").run();
  eng.run(231, 'e-231', 1, 231, PARTNER_ID, 5, 9, 1000, stamp(231));
  const ids: number[] = [];
  let cursor: string | null = null; let pages = 0; let first: any = null;
  do {
    const path: string = cursor ? `/retainers?cursor=${encodeURIComponent(cursor)}` : '/retainers';
    const r = await get(partnerPipeline, path, envFor(db));
    assert.equal(r.status, 200);
    first ??= r.body;
    ids.push(...r.body.items.map((x: any) => x.engagement_id));
    cursor = r.body.next_cursor; pages += 1;
  } while (cursor);
  assert.equal(pages, 2);
  assert.equal(ids.length, 231);
  assert.equal(new Set(ids).size, 231, 'a page repeated a row');
  assert.equal(ids[230], 231, 'the engagement with no retainer is last');
  assert.equal(first.retainer_count, 230);
  assert.equal(first.mrr_cents, 230 * 10_000);
  assert.equal(first.totals_complete, true);
});

// ── Analytics: a failed dependent read is not a zero ─────────────────────────

test('analytics counts every quote past 1000, and a failed delivery read is "unavailable", not zero', async () => {
  const db = migratedDatabase(); seedPartner(db);
  db.exec("PRAGMA foreign_keys = OFF");
  const st = db.prepare("INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, status, created_at) VALUES (?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= 1_050; i += 1) st.run(i, `q-${i}`, i, PARTNER_ID, 100, 'd', 'submitted', stamp(i));
  db.prepare("INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, status) VALUES (1,'e1',1,1,?,5,9,500,'delivered')").run(PARTNER_ID);
  const app = new Hono(); app.route('/', quotesRouter);
  const call = async (e: any) => {
    const res = await app.request('/analytics', { headers: { Authorization: `Bearer ${await token(PARTNER_USER, 'partner')}` } }, e);
    return { status: res.status, body: await res.json() as any };
  };
  const ok = await call(envFor(db));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.pipeline.quote_count, 1_050, 'analytics read only part of the book');
  assert.equal(ok.body.delivery.delivered, 1);
  assert.equal(ok.body.delivery_unavailable, false);

  const down = await call(envFor(db, { failOn: /FROM engagements/ }));
  assert.equal(down.status, 200);
  assert.equal(down.body.delivery, null, 'a failed read became a zero summary');
  assert.equal(down.body.delivery_unavailable, true);
  assert.equal(down.body.pipeline.quote_count, 1_050, 'the section that did read must stay');

  const noQuotes = await call(envFor(db, { failOn: /FROM quotes q/ }));
  assert.notEqual(noQuotes.status, 200, 'unreadable quotes must not answer with an empty analytics body');
});

// ── Build desk list ──────────────────────────────────────────────────────────

test('GET /pipeline/active pages past 100 projects and totals the whole population', async () => {
  const db = migratedDatabase();
  db.prepare("INSERT INTO users (id, email, name, role) VALUES (44,'a@example.com','A','admin')").run();
  const st = db.prepare("INSERT INTO projects (id, name, status, created_at) VALUES (?,?,?,?)");
  for (let i = 1; i <= 130; i += 1) st.run(i, `P${i}`, 'active', stamp(i));
  st.run(500, 'Rejected', 'rejected', stamp(500));
  const seen: number[] = []; let cursor: string | null = null; let pages = 0;
  do {
    const path: string = cursor ? `/active?cursor=${encodeURIComponent(cursor)}` : '/active';
    const r = await get(pipeline, path, envFor(db), 44, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 130);
    assert.equal(r.body.has_more, r.body.next_cursor !== null);
    seen.push(...r.body.items.map((x: any) => x.id));
    cursor = r.body.next_cursor; pages += 1;
  } while (cursor);
  assert.equal(pages, 2);
  assert.equal(new Set(seen).size, 130);
  assert.equal(seen.includes(500), false);
});

test('the deal drawer says when its metric and gate history is a window, not the whole', async () => {
  const db = migratedDatabase();
  db.prepare("INSERT INTO users (id, email, name, role) VALUES (44,'a@example.com','A','admin')").run();
  db.prepare("INSERT INTO projects (id, name, status) VALUES (7,'P','active')").run();
  const m = db.prepare("INSERT INTO metrics_snapshots (deal_id, key_metrics, traction_score, snapshot_date) VALUES (7,'{}',50,?)");
  for (let i = 1; i <= 35; i += 1) m.run(stamp(i));
  const g = db.prepare("INSERT INTO decision_gates (deal_id, created_at) VALUES (7,?)");
  for (let i = 1; i <= 4; i += 1) g.run(stamp(i));
  const r = await get(pipeline, '/projects/7/detail', envFor(db), 44, 'admin');
  assert.equal(r.status, 200);
  assert.equal(r.body.metrics.length, 30);
  assert.equal(r.body.metrics_total, 35);
  assert.equal(r.body.metrics_truncated, true);
  assert.equal(r.body.gates_total, 4);
  assert.equal(r.body.gates_truncated, false);
});

// ── Vote publish ─────────────────────────────────────────────────────────────

function fakeRoom(db: Db, opts: { fail?: boolean } = {}) {
  const sent: { room: string; body: any; rowsAtPublish: number }[] = [];
  const ns: any = {
    idFromName: (name: string) => name,
    get: (room: string) => ({
      fetch: async (_url: string, init: any) => {
        if (opts.fail) throw new Error('room down');
        const n = (db.prepare('SELECT COUNT(*) AS n FROM pipeline_votes').get() as any).n;
        sent.push({ room, body: JSON.parse(init.body), rowsAtPublish: Number(n) });
        return new Response('ok');
      },
    }),
  };
  return { ns, sent };
}
async function cast(e: any, userId: number, role: string, body: any) {
  const res = await votes.request('/9', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(userId, role)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, e);
  return { status: res.status, body: await res.json() as any };
}

test('a vote publishes the aggregate tally after the row is committed, and nothing private', async () => {
  const db = migratedDatabase();
  db.prepare("INSERT INTO users (id, email, name, role) VALUES (31,'inv@example.com','Ines Investor','investor')").run();
  const room = fakeRoom(db);
  const e = envFor(db, undefined, { PIPELINE_ROOM: room.ns });
  const r = await cast(e, 31, 'investor', { vote_type: 'Strong_Buy', comment: 'PRIVATE-COMMENT-TEXT', anonymous: true });
  assert.equal(r.status, 200);
  assert.deepEqual(room.sent.map((s) => s.room).sort(), ['deal:9', 'overview']);
  for (const s of room.sent) {
    assert.equal(s.rowsAtPublish, 1, 'published before the vote was committed');
    assert.equal(s.body.type, 'vote_updated');
    assert.equal(s.body.deal_id, 9);
    assert.equal(s.body.tally.total_voters, 1);
    assert.equal(s.body.tally.by_type.Strong_Buy.count, 1);
    const wire = JSON.stringify(s.body);
    for (const secret of ['PRIVATE-COMMENT-TEXT', 'my_vote', 'comment', 'anonymous', 'user_id', 'Ines', 'inv@example.com']) {
      assert.equal(wire.includes(secret), false, `the published event carried "${secret}"`);
    }
  }
  assert.ok(r.body.my_vote, 'the caster still gets their own vote back in the response');
});

test('a vote that is refused publishes nothing, and a dead room does not fail a committed vote', async () => {
  const db = migratedDatabase();
  db.prepare("INSERT INTO users (id, email, name, role) VALUES (31,'inv@example.com','I','investor')").run();
  const room = fakeRoom(db);
  const bad = await cast(envFor(db, undefined, { PIPELINE_ROOM: room.ns }), 31, 'investor', { vote_type: 'Nonsense' });
  assert.equal(bad.status, 400);
  assert.equal(room.sent.length, 0);

  const dead = fakeRoom(db, { fail: true });
  const ok = await cast(envFor(db, undefined, { PIPELINE_ROOM: dead.ns }), 31, 'investor', { vote_type: 'Hold' });
  assert.equal(ok.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pipeline_votes').get() as any).n, 1);
});
