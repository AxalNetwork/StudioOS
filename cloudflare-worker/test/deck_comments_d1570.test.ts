/**
 * D1570 (#3817, deck builder v2 D9) — comments with @mentions, an assignee and
 * Resolve, and the approval a share waits for, through the real mounted routes
 * on SQLite (the baseline and every post-cutoff migration, 741 included).
 *
 *   1. Who (owner decision Q = B): the founders and a co-founder read and
 *      comment; an advisor or Operating Partner only with the founder's
 *      `scope_deck` grant, re-checked on every request; an advisor member
 *      without it, a grant without the scope, an Admin and another venture's
 *      founder are not found, and nothing is written.
 *   2. An @mention notifies each mentioned person exactly once: named twice in
 *      one comment, once; the author never; a person who cannot read the
 *      thread is refused before anything is written.
 *   3. Assignee and Resolve live on the thread's first comment; a reply joins
 *      its card; who may assign and resolve.
 *   4. Share creation is refused until the approver signs off, on both link
 *      writers; an approval is of one version; only an approver approves and
 *      only a founder names approvers.
 *   5. No AI anywhere in a thread: the route reads and calls no model.
 *   6. A grant that opens only the deck's comments may go to an Operating
 *      Partner; any wider grant to one is still refused.
 *
 * Every principal and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_comments_d1570.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import deckComments from '../src/routes/deck_comments.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import decks from '../src/routes/decks.ts';
import advisorGrants from '../src/routes/advisor_grants.ts';
import { approvalSentence } from '../src/services/decks/deckApproval.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1570-deck-comments-0123456789';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));

// [id, role, founder_id, name]
const FOUNDER = 3, COFOUNDER = 4, ADVISOR = 5, PARTNER = 6, MEMBER_ADVISOR = 7, NO_SCOPE = 8, ADMIN = 1, OTHER = 9;
const PEOPLE: [number, string, number | null, string][] = [
  [ADMIN, 'admin', null, 'Ada Admin'], [FOUNDER, 'founder', 1001, 'Fay Founder'], [COFOUNDER, 'founder', 1003, 'Cy Cofounder'],
  [ADVISOR, 'advisor', null, 'Sam Advisor'], [PARTNER, 'partner', null, 'Pat Partner'], [MEMBER_ADVISOR, 'advisor', null, 'Mo Member'],
  [NO_SCOPE, 'advisor', null, 'Nia Noscope'], [OTHER, 'founder', 1002, 'Oz Other'],
];
const P = 5, OTHER_P = 6, DECK = 60, DECK_V3 = 61, PROSPECT = 7;
const SLIDES = [1, 2, 3, 4].map((n) => ({ title: `Synthetic card ${n}`, fields: [] }));

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES (?, ?, ?, ?, 1, ?, 'studio')");
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const [id, role, founder, name] of PEOPLE) { u.run(id, role, name, `synthetic${id}@example.test`, founder); ss.run(id, `j-${id}`); }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id, sector, stage) VALUES (${P}, 'proj-p', 'Synthetic venture', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'proj-o', 'Other', 1002, 'Health', 'seed')`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${FOUNDER}, 'owner', 'accepted'), (${P}, ${COFOUNDER}, 'cofounder', 'accepted'), (${P}, ${MEMBER_ADVISOR}, 'advisor', 'accepted')`);
  const g = db.prepare("INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, status, scope_project, scope_deck) VALUES (?, ?, ?, ?, 'active', ?, ?)");
  g.run('g-adv', P, ADVISOR, FOUNDER, 1, 1);
  g.run('g-op', P, PARTNER, FOUNDER, 0, 1);
  g.run('g-none', P, NO_SCOPE, FOUNDER, 1, 0);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, 2, ?, ?, 1, ?)')
    .run(DECK, P, JSON.stringify(SLIDES), 'Synthetic deck', '2026-11-01 09:00:00');
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Ivy Investor', 'Fund A')").run(PROSPECT, P);
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckComments);
app.route('/api/decks', deckInvestorLinks);
app.route('/api/decks', decks);
app.route('/api/advisor-grants', advisorGrants);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function req(db: DatabaseSync, method: string, path: string, as: number | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) {
    const role = PEOPLE.find((p) => p[0] === as)![1];
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role, jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const post = (db: DatabaseSync, as: number, body: Record<string, unknown>, deck = DECK) => req(db, 'POST', `/api/decks/${deck}/comments`, as, body);
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any)?.n ?? 0);
const mentionNotices = (db: DatabaseSync, user: number) => count(db, "SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'deck_comment_mention'", user);

test('D1570 1: founders and granted reviewers comment; everyone else is not found and writes nothing', async () => {
  const db = fixture();
  for (const who of [FOUNDER, COFOUNDER, ADVISOR, PARTNER]) {
    const r = await post(db, who, { body: `Synthetic comment by ${who}`, card_index: 1 });
    assert.equal(r.status, 201, `${who}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.comment.card_index, 1);
    assert.equal(r.body.comment.author.id, who);
    const list = await req(db, 'GET', `/api/decks/${DECK}/comments`, who);
    assert.equal(list.status, 200);
  }
  const seen = await req(db, 'GET', `/api/decks/${DECK}/comments`, ADVISOR);
  assert.deepEqual(seen.body.viewer, { user_id: ADVISOR, kind: 'advisor', can_manage: false });
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, PARTNER)).body.viewer.kind, 'operating_partner');
  assert.deepEqual((await req(db, 'GET', `/api/decks/${DECK}/comments`, COFOUNDER)).body.viewer, { user_id: COFOUNDER, kind: 'founder', can_manage: true });
  assert.deepEqual(seen.body.people.map((p: any) => p.id).sort(), [FOUNDER, COFOUNDER, ADVISOR, PARTNER].sort(), 'the people are the readers only');
  const before = count(db, 'SELECT COUNT(*) AS n FROM deck_comments');
  for (const who of [MEMBER_ADVISOR, NO_SCOPE, ADMIN, OTHER]) {
    assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, who)).status, 404, `${who} reads nothing`);
    assert.equal((await post(db, who, { body: 'Synthetic', card_index: 0 })).status, 404, `${who} posts nothing`);
  }
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_comments'), before, 'nothing is written');
  // The grant is re-checked on every request: revoked, expired or the role gone, and the door shuts.
  db.prepare("UPDATE advisor_client_grants SET status = 'revoked' WHERE uid = 'g-adv'").run();
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, ADVISOR)).status, 404);
  db.prepare("UPDATE advisor_client_grants SET expires_at = '2020-01-01 00:00:00' WHERE uid = 'g-op'").run();
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, PARTNER)).status, 404);
  db.prepare("UPDATE advisor_client_grants SET status = 'active', expires_at = NULL").run();
  db.prepare("UPDATE users SET role = 'exploring' WHERE id = ?").run(ADVISOR);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, ADVISOR)).status, 404, 'an advisor no longer, the grant reads nothing');
  assert.equal((await req(db, 'GET', '/api/decks/999/comments', FOUNDER)).status, 404);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, null)).status, 401);
});

test('D1570 2: an @mention notifies each mentioned person exactly once', async () => {
  const db = fixture();
  const r = await post(db, FOUNDER, { body: '@Sam Advisor @Cy Cofounder @Sam Advisor is this figure right?', card_index: 3, area: 'a2', mentions: [ADVISOR, COFOUNDER, ADVISOR, FOUNDER] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.comment.mentions.map((m: any) => m.id).sort(), [COFOUNDER, ADVISOR].sort(), 'each once, and never the author');
  assert.equal(r.body.comment.area, 'a2');
  assert.equal(mentionNotices(db, ADVISOR), 1, 'named twice, told once');
  assert.equal(mentionNotices(db, COFOUNDER), 1);
  assert.equal(mentionNotices(db, FOUNDER), 0, 'the author is never told');
  const notice = db.prepare("SELECT title, body, link, category FROM notifications_inbox WHERE user_id = ? AND type = 'deck_comment_mention'").get(ADVISOR) as any;
  assert.equal(notice.title, 'Fay Founder mentioned you on card 4.');
  assert.equal(notice.category, 'mentions');
  assert.doesNotMatch(String(notice.body), /figure right/, 'the notice never carries the comment\'s words');
  // A reply that mentions nobody tells nobody; one that mentions Sam again is a new comment, told once more.
  await post(db, ADVISOR, { body: 'Synthetic reply', parent_uid: r.body.comment.uid });
  assert.equal(mentionNotices(db, ADVISOR) + mentionNotices(db, COFOUNDER) + mentionNotices(db, FOUNDER), 2);
  await post(db, COFOUNDER, { body: '@Sam Advisor again', parent_uid: r.body.comment.uid, mentions: [ADVISOR] });
  assert.equal(mentionNotices(db, ADVISOR), 2);
  // A replayed claim sends nothing: the row is notified already.
  const id = Number((db.prepare('SELECT id FROM deck_comments WHERE uid = ?').get(r.body.comment.uid) as any).id);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_comment_mentions WHERE comment_id = ? AND notified_at IS NULL', id), 0);
  // Someone who cannot read the thread is refused before anything is written or sent.
  const comments = count(db, 'SELECT COUNT(*) AS n FROM deck_comments');
  for (const bad of [[MEMBER_ADVISOR], [ADMIN], [OTHER], ['x'], [0]]) {
    const refused = await post(db, FOUNDER, { body: 'Synthetic', card_index: 0, mentions: bad });
    assert.equal(refused.status, 400, JSON.stringify(bad));
    assert.equal(refused.body.error, 'mention_not_on_deck');
  }
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM deck_comments'), comments);
  assert.equal(mentionNotices(db, MEMBER_ADVISOR) + mentionNotices(db, ADMIN) + mentionNotices(db, OTHER), 0);
});

test('D1570 3: assignee and Resolve on the thread; a reply joins its card; who may do which', async () => {
  const db = fixture();
  const t = (await post(db, FOUNDER, { body: 'Synthetic thread', card_index: 2 })).body.comment;
  const mine = (await post(db, ADVISOR, { body: 'Synthetic advisor thread', card_index: 0 })).body.comment;
  const reply = await post(db, PARTNER, { body: 'Synthetic reply', parent_uid: t.uid, card_index: 0 });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.comment.parent_uid, t.uid);
  assert.equal(reply.body.comment.card_index, 2, 'a reply joins its thread\'s card');
  assert.equal((await post(db, FOUNDER, { body: 'x', parent_uid: reply.body.comment.uid })).status, 404, 'a reply to a reply is refused');
  assert.equal((await post(db, FOUNDER, { body: 'x' })).body.error, 'invalid_card', 'a thread is pinned to a card');
  assert.equal((await post(db, FOUNDER, { body: 'x', card_index: 4 })).body.error, 'invalid_card');
  assert.equal((await post(db, FOUNDER, { body: 'x', card_index: 0, area: 'bad area!' })).body.error, 'invalid_area');
  assert.equal((await post(db, FOUNDER, { body: '   ', card_index: 0 })).body.error, 'comment_required');

  let list = await req(db, 'GET', `/api/decks/${DECK}/comments`, FOUNDER);
  assert.equal(list.body.open, 2);
  const assign = await req(db, 'POST', `/api/decks/${DECK}/comments/${t.uid}/assign`, FOUNDER, { user_id: ADVISOR });
  assert.equal(assign.status, 200);
  assert.deepEqual(assign.body.comment.assignee, { id: ADVISOR, name: 'Sam Advisor' });
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/comments/${t.uid}/assign`, FOUNDER, { user_id: MEMBER_ADVISOR })).body.error, 'assignee_not_on_deck');
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/comments/${t.uid}/assign`, PARTNER, { user_id: PARTNER })).status, 403, 'a reviewer assigns only a thread they started');
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/comments/${mine.uid}/assign`, ADVISOR, { user_id: FOUNDER })).status, 200);
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/comments/${reply.body.comment.uid}/resolve`, FOUNDER, {})).body.error, 'not_a_thread');
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/comments/${t.uid}/resolve`, PARTNER, {})).status, 403, 'not the founder, author or assignee');
  const done = await req(db, 'POST', `/api/decks/${DECK}/comments/${t.uid}/resolve`, ADVISOR, {});
  assert.equal(done.status, 200, 'the assignee resolves');
  assert.ok(done.body.comment.resolved_at);
  assert.deepEqual(done.body.comment.resolved_by, { id: ADVISOR, name: 'Sam Advisor' });
  list = await req(db, 'GET', `/api/decks/${DECK}/comments`, FOUNDER);
  assert.equal(list.body.open, 1);
  const again = await req(db, 'POST', `/api/decks/${DECK}/comments/${t.uid}/resolve`, FOUNDER, { resolved: false });
  assert.equal(again.body.comment.resolved_at, null);
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/comments/${'f'.repeat(32)}/resolve`, FOUNDER, {})).status, 404);
  // Every write logs a row with the card and version, never the words.
  const logs = db.prepare("SELECT details FROM activity_logs WHERE action LIKE 'deck_comment_%'").all() as any[];
  assert.ok(logs.length >= 6);
  assert.equal(logs.some((l) => /Synthetic/.test(String(l.details))), false);
});

test('D1570 4: share creation is refused until the approver signs off', async () => {
  const db = fixture();
  const link = () => req(db, 'POST', `/api/decks/${DECK}/investor-links`, FOUNDER, { prospect_id: PROSPECT, expires_days: 14 });
  const legacy = () => req(db, 'POST', `/api/decks/${DECK}/share`, FOUNDER, {});
  assert.equal((await link()).status, 201, 'with no approver named, nothing waits');
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}/approvers`, ADVISOR, { user_ids: [ADVISOR] })).status, 403, 'only a founder names approvers');
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}/approvers`, FOUNDER, { user_ids: [MEMBER_ADVISOR] })).body.error, 'approver_not_on_deck');
  const named = await req(db, 'PUT', `/api/decks/${DECK}/approvers`, FOUNDER, { user_ids: [ADVISOR] });
  assert.equal(named.status, 200, JSON.stringify(named.body));
  assert.equal(named.body.message, 'Approval needed before sharing · Sam Advisor has not approved yet.');
  const tokens = count(db, 'SELECT COUNT(*) AS n FROM pitch_deck_share_tokens');
  const refused = await link();
  assert.equal(refused.status, 409);
  assert.match(JSON.stringify(refused.body), /Sam Advisor has not approved yet/);
  const old = await legacy();
  assert.equal(old.status, 409);
  assert.equal(old.body.error, 'approval_needed');
  assert.deepEqual(old.body.pending, [{ user_id: ADVISOR, name: 'Sam Advisor' }]);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM pitch_deck_share_tokens'), tokens, 'no link was written');
  assert.equal((await req(db, 'POST', `/api/decks/${DECK}/approve`, PARTNER, {})).status, 403, 'only a named approver approves');
  const ok = await req(db, 'POST', `/api/decks/${DECK}/approve`, ADVISOR, {});
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.pending, []);
  assert.equal(ok.body.message, null);
  assert.equal(ok.body.approvers[0].approved, true);
  assert.equal((await link()).status, 201, 'signed off, the link is made');
  assert.equal((await legacy()).status, 200);
  // An approval is of one version: the next saved version waits again.
  db.prepare('UPDATE pitch_decks SET is_current = 0 WHERE id = ?').run(DECK);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 3, ?, ?, 1)').run(DECK_V3, P, JSON.stringify(SLIDES), 'Synthetic deck');
  assert.equal((await req(db, 'POST', `/api/decks/${DECK_V3}/investor-links`, FOUNDER, { prospect_id: PROSPECT, expires_days: 7 })).status, 409);
  const v3 = await req(db, 'GET', `/api/decks/${DECK_V3}/approval`, COFOUNDER);
  assert.equal(v3.body.approvers[0].approved, false);
  assert.equal(v3.body.approvers[0].approved_version, 2);
  // Removed, the approver no longer holds the share; named again, their old approval does not return.
  await req(db, 'PUT', `/api/decks/${DECK_V3}/approvers`, FOUNDER, { user_ids: [] });
  assert.equal((await req(db, 'POST', `/api/decks/${DECK_V3}/investor-links`, FOUNDER, { prospect_id: PROSPECT, expires_days: 7 })).status, 201);
  const back = await req(db, 'PUT', `/api/decks/${DECK}/approvers`, FOUNDER, { user_ids: [ADVISOR, PARTNER] });
  assert.equal(back.body.approvers.find((a: any) => a.user_id === ADVISOR).approved, false);
  assert.equal(back.body.message, 'Approval needed before sharing · Sam Advisor and Pat Partner have not approved yet.');
  assert.equal(approvalSentence([{ user_id: 1, name: null }]), 'Approval needed before sharing · An approver has not approved yet.');
});

test('D1570 5: no AI anywhere in a thread', () => {
  const src = readFileSync('cloudflare-worker/src/routes/deck_comments.ts', 'utf8');
  const imports = [...src.matchAll(/^import [^\n]* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.filter((i) => /ai|model|eadwyn|assist|llm/i.test(i)), [], 'no model is read or called');
  assert.doesNotMatch(src, /\bAI\.run|aiRouter|runModel|env\.AI\b/);
});

test('D1570 6: a deck-only grant may go to an Operating Partner; a wider one is refused', async () => {
  const db = fixture();
  db.prepare('DELETE FROM advisor_client_grants WHERE advisor_user_id = ?').run(PARTNER);
  const wide = await req(db, 'POST', '/api/advisor-grants/proj-p', FOUNDER, { email: `synthetic${PARTNER}@example.test`, scope_deck: true });
  assert.equal(wide.status, 400, 'scope_project defaults on, so this is not deck-only');
  const deckOnly = await req(db, 'POST', '/api/advisor-grants/proj-p', FOUNDER, { email: `synthetic${PARTNER}@example.test`, scope_project: false, scope_deck: true });
  assert.equal(deckOnly.status, 201, JSON.stringify(deckOnly.body));
  assert.equal(deckOnly.body.scope_deck, true);
  assert.equal(deckOnly.body.scope_project, false);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, PARTNER)).status, 200);
  const adv = await req(db, 'POST', '/api/advisor-grants/proj-p', FOUNDER, { email: `synthetic${NO_SCOPE}@example.test`, scope_deck: true });
  assert.equal(adv.status, 201);
  assert.equal(adv.body.scope_deck, true, 'an advisor\'s grant gains the scope');
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/comments`, NO_SCOPE)).status, 200);
});
