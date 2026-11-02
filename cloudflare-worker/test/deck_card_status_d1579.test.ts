/**
 * D1579 (#3826, deck builder v2 E6) — a card's status and assignee, through
 * the real mounted routes on SQLite (the baseline and every post-cutoff
 * migration; E6 adds none).
 *
 *   1. `card.status` and `card.assignee` live in the version's card document:
 *      `sanitizeSlides` keeps them when sound and drops them when not,
 *      `modelProblems` refuses a bad one with a sentence, and `publicDeckOf`
 *      leaves both out of every outside reader.
 *   2. The filter (`GET /api/decks/:id/card-status`) returns exactly the
 *      matching cards, by status, by assignee and by both; a bad filter is
 *      refused.
 *   3. Assigning a card notifies once: the save that assigns tells the person
 *      once, saving again tells nobody, a second card is a second notice, the
 *      saver is never told, and someone who cannot work on the deck is
 *      refused before anything is written.
 *   4. The not-Done count and titles: none on a deck never tracked; on a
 *      tracked deck, a card with no status reads To do.
 *   5. Who reads: whoever may read the deck; another venture's founder and
 *      nobody signed in read nothing.
 *
 * Every principal and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_card_status_d1579.test.ts
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
import deckCardStatus from '../src/routes/deck_card_status.ts';
import decks, { publicDeckOf, sanitizeSlides, sanitizeImageUrl } from '../src/routes/decks.ts';
import { modelProblems } from '../src/services/decks/slideModel.ts';
import { cardStates, filterCards, newAssignments, notDone } from '../src/services/decks/cardStatus.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1579-card-status-0123456789';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));

// [id, role, founder_id, name]
const FOUNDER = 3, COFOUNDER = 4, ADVISOR = 5, MEMBER_ADVISOR = 7, ADMIN = 1, OTHER = 9;
const PEOPLE: [number, string, number | null, string][] = [
  [ADMIN, 'admin', null, 'Ada Admin'], [FOUNDER, 'founder', 1001, 'Fay Founder'], [COFOUNDER, 'founder', 1003, 'Cy Cofounder'],
  [ADVISOR, 'advisor', null, 'Sam Advisor'], [MEMBER_ADVISOR, 'advisor', null, 'Mo Member'], [OTHER, 'founder', 1002, 'Oz Other'],
];
const P = 5, OTHER_P = 6, DECK = 60, PLAIN = 70;
// Six cards: two To do (one by default), two In progress, two Done; assignees spread over two people and nobody.
const TRACKED = [
  { uid: 'u1', title: 'Synthetic cover', status: 'done', assignee: FOUNDER },
  { uid: 'u2', title: 'Synthetic problem', status: 'in_progress', assignee: COFOUNDER },
  { uid: 'u3', title: 'Synthetic market', status: 'todo' },
  { uid: 'u4', title: 'Synthetic traction', status: 'in_progress', assignee: FOUNDER },
  { uid: 'u5', title: 'Synthetic team', assignee: COFOUNDER },
  { uid: 'u6', title: 'Synthetic ask', status: 'done' },
];
const UNTRACKED = [1, 2, 3].map((n) => ({ uid: `p${n}`, title: `Synthetic plain ${n}` }));

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES (?, ?, ?, ?, 1, ?, 'studio')");
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const [id, role, founder, name] of PEOPLE) { u.run(id, role, name, `synthetic${id}@example.test`, founder); ss.run(id, `j-${id}`); }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id, sector, stage) VALUES (${P}, 'proj-p', 'Synthetic venture', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'proj-o', 'Other', 1002, 'Health', 'seed')`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${FOUNDER}, 'owner', 'accepted'), (${P}, ${COFOUNDER}, 'cofounder', 'accepted'), (${P}, ${MEMBER_ADVISOR}, 'advisor', 'accepted')`);
  db.prepare("INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, status, scope_project, scope_deck) VALUES ('g-adv', ?, ?, ?, 'active', 1, 1)").run(P, ADVISOR, FOUNDER);
  const d = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  d.run(DECK, P, 2, JSON.stringify(TRACKED), 'Synthetic deck', 1, '2026-11-01 09:00:00');
  d.run(PLAIN, OTHER_P, 1, JSON.stringify(UNTRACKED), 'Synthetic other deck', 1, '2026-11-01 09:00:00');
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckCardStatus);
app.route('/api/decks', decks);
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
const read = (db: DatabaseSync, query = '', as = FOUNDER, deck = DECK) => req(db, 'GET', `/api/decks/${deck}/card-status${query}`, as);
const current = (db: DatabaseSync) => db.prepare('SELECT id, slides FROM pitch_decks WHERE project_id = ? AND is_current = 1').get(P) as any;
const save = (db: DatabaseSync, as: number, slides: unknown[]) => req(db, 'PUT', `/api/decks/${current(db).id}`, as, { model_version: 2, slides, title: 'Synthetic deck' });
const notices = (db: DatabaseSync, user: number) => Number((db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'deck_card_assigned'").get(user) as any)?.n ?? 0);
const uids = (r: any) => r.body.cards.map((c: any) => c.uid);

test('D1579 1: status and assignee are kept on the card, refused with a sentence when unsound, and never reach an outside reader', () => {
  const [kept] = sanitizeSlides([{ title: 'Synthetic', status: 'in_progress', assignee: COFOUNDER }]);
  assert.equal(kept.status, 'in_progress');
  assert.equal(kept.assignee, COFOUNDER);
  const [dropped] = sanitizeSlides([{ title: 'Synthetic', status: 'blocked', assignee: 'Cy' }]);
  assert.equal('status' in dropped, false, 'an unknown status is not kept');
  assert.equal('assignee' in dropped, false, 'an assignee is a person\'s id');
  const [none] = sanitizeSlides([{ title: 'Synthetic' }]);
  assert.equal('status' in none || 'assignee' in none, false, 'a card saved before E6 hashes as it did');
  assert.deepEqual(modelProblems([{ status: 'blocked' }, { assignee: -2 }, { status: 'done', assignee: FOUNDER }], sanitizeImageUrl), [
    'Card 1: the status is To do, In progress or Done.',
    'Card 2: the assignee must be a person on the deck.',
  ]);
  const pub = publicDeckOf({ id: 1, project_id: P, version: 1, title: 'x', slides: JSON.stringify(TRACKED), is_current: 1 });
  assert.equal(pub.slides.some((s: any) => 'status' in s || 'assignee' in s), false, 'the share, print and grant readers carry neither');
});

test('D1579 2: the filter returns exactly the matching cards, by status, by assignee and by both', async () => {
  const db = fixture();
  const all = await read(db);
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.deepEqual(uids(all), ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
  assert.equal(all.body.total, 6);
  assert.deepEqual(all.body.filter, { status: 'all', assignee: 'anyone' });
  const cases: [string, string[]][] = [
    ['?status=todo', ['u3', 'u5']],
    ['?status=in_progress', ['u2', 'u4']],
    ['?status=done', ['u1', 'u6']],
    [`?assignee=${FOUNDER}`, ['u1', 'u4']],
    [`?assignee=${COFOUNDER}`, ['u2', 'u5']],
    ['?assignee=none', ['u3', 'u6']],
    [`?status=in_progress&assignee=${FOUNDER}`, ['u4']],
    [`?status=todo&assignee=${COFOUNDER}`, ['u5']],
    ['?status=done&assignee=none', ['u6']],
    [`?status=todo&assignee=${FOUNDER}`, []],
    [`?assignee=${ADVISOR}`, []],
    ['?status=all&assignee=anyone', ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']],
  ];
  for (const [q, want] of cases) {
    const r = await read(db, q);
    assert.equal(r.status, 200, q);
    assert.deepEqual(uids(r), want, q);
    assert.equal(r.body.total, 6, `${q}: total is every card`);
  }
  const one = await read(db, `?status=in_progress&assignee=${FOUNDER}`);
  assert.deepEqual(one.body.cards, [{ index: 3, uid: 'u4', title: 'Synthetic traction', status: 'in_progress', assignee: { id: FOUNDER, name: 'Fay Founder' } }]);
  for (const bad of ['?status=blocked', '?assignee=Cy', '?assignee=0', '?assignee=-3']) {
    const r = await read(db, bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error, 'invalid_filter');
  }
  // The pure rule the strip mirrors.
  const states = cardStates(TRACKED);
  assert.deepEqual(filterCards(states, 'todo', COFOUNDER).map((c) => c.uid), ['u5']);
  assert.deepEqual(filterCards(states, 'all', 'none').map((c) => c.uid), ['u3', 'u6']);
});

test('D1579 3: assigning a card notifies once', async () => {
  const db = fixture();
  const cards = () => JSON.parse(current(db).slides) as any[];
  // Assign card 3 to the cofounder: one notice, to them only.
  const first = await save(db, FOUNDER, cards().map((c) => (c.uid === 'u3' ? { ...c, assignee: COFOUNDER } : c)));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(notices(db, COFOUNDER), 1, 'assigning a card notifies once');
  const notice = db.prepare("SELECT title, body, link, category FROM notifications_inbox WHERE user_id = ? AND type = 'deck_card_assigned'").get(COFOUNDER) as any;
  assert.equal(notice.title, 'Fay Founder assigned you card 3.');
  assert.equal(notice.category, 'mentions');
  assert.doesNotMatch(`${notice.title} ${notice.body}`, /Synthetic market/, 'the notice carries no words of the deck');
  // Cards already assigned before (u2, u5) told nobody; saving again with the same assignee tells nobody.
  assert.equal(notices(db, FOUNDER), 0);
  const again = await save(db, FOUNDER, cards().map((c) => ({ ...c, status: 'todo' })));
  assert.equal(again.status, 200);
  assert.equal(notices(db, COFOUNDER), 1, 'saving again never repeats the notice');
  // A second card is a second assignment; the saver assigning themselves is told nothing.
  await save(db, COFOUNDER, cards().map((c) => (c.uid === 'u6' ? { ...c, assignee: COFOUNDER } : c.uid === 'u1' ? { ...c, assignee: ADVISOR } : c)));
  assert.equal(notices(db, COFOUNDER), 1, 'never the person who assigned');
  assert.equal(notices(db, ADVISOR), 1, 'a granted advisor can be assigned, and is told');
  await save(db, FOUNDER, cards().map((c) => (c.uid === 'u6' ? { ...c, assignee: ADVISOR } : c)));
  assert.equal(notices(db, ADVISOR), 2, 'a second card, a second notice');
  // Someone who cannot work on the deck is refused before anything is written or sent.
  const before = current(db).id;
  for (const who of [MEMBER_ADVISOR, ADMIN, OTHER, 999]) {
    const r = await save(db, FOUNDER, cards().map((c) => (c.uid === 'u3' ? { ...c, assignee: who } : c)));
    assert.equal(r.status, 400, String(who));
    assert.equal(r.body.error, 'assignee_not_on_deck');
    assert.match(r.body.message, /^Card 3: assign someone who can work on this deck\. Nothing was saved\.$/);
  }
  assert.equal(current(db).id, before, 'no version was written');
  assert.equal(notices(db, MEMBER_ADVISOR) + notices(db, ADMIN) + notices(db, OTHER), 0);
  // An assignee who left the deck stays on their card and never blocks a save.
  db.prepare("UPDATE advisor_client_grants SET status = 'revoked' WHERE advisor_user_id = ?").run(ADVISOR);
  const kept = await save(db, FOUNDER, cards().map((c) => ({ ...c, status: 'done' })));
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(notices(db, ADVISOR), 2);
  // The pure rule: by uid, wherever the card moved; an unchanged assignee is not new.
  assert.deepEqual(newAssignments([{ uid: 'a', assignee: 3 }, { uid: 'b' }], [{ uid: 'b', assignee: 4 }, { uid: 'a', assignee: 3 }]), [{ uid: 'b', index: 0, user_id: 4 }]);
});

test('D1579 4: the not-Done count and titles, and a deck never tracked has none', async () => {
  const db = fixture();
  const r = await read(db, '?status=done');
  assert.equal(r.body.tracked, true);
  assert.deepEqual(r.body.not_done, {
    count: 4,
    cards: [
      { index: 1, uid: 'u2', title: 'Synthetic problem', status: 'in_progress' },
      { index: 2, uid: 'u3', title: 'Synthetic market', status: 'todo' },
      { index: 3, uid: 'u4', title: 'Synthetic traction', status: 'in_progress' },
      { index: 4, uid: 'u5', title: 'Synthetic team', status: 'todo' },
    ],
  }, 'whatever the filter; a card with no status on a tracked deck reads To do');
  assert.deepEqual(r.body.people.map((p: any) => p.id).sort(), [FOUNDER, COFOUNDER, ADVISOR].sort(), 'D1570\'s people: never an advisor member without the grant, never an Admin');
  const plain = await read(db, '', OTHER, PLAIN);
  assert.equal(plain.status, 200);
  assert.equal(plain.body.tracked, false);
  assert.deepEqual(plain.body.not_done, { count: 0, cards: [] });
  assert.deepEqual(plain.body.cards.map((c: any) => c.status), [null, null, null]);
  assert.deepEqual(notDone(cardStates([{ title: 'a', status: 'done' }, { title: 'b' }])).map((c) => c.title), ['b']);
});

test('D1579 5: whoever may read the deck reads it; another venture\'s founder and nobody signed in read nothing', async () => {
  const db = fixture();
  for (const who of [FOUNDER, COFOUNDER]) assert.equal((await read(db, '', who)).status, 200, String(who));
  assert.equal((await read(db, '', OTHER)).status, 403);
  assert.equal((await read(db, '', null as any)).status, 401);
  assert.equal((await read(db, '', FOUNDER, 999)).status, 404);
  // Another venture's founder cannot save an assignment onto this deck either.
  assert.equal((await req(db, 'PUT', `/api/decks/${DECK}`, OTHER, { model_version: 2, slides: TRACKED })).status, 403);
});
