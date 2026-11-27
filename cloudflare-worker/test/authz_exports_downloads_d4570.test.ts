// #4570 slice 5 (S1 of #4554) — exports and downloads, on the real Worker.
//
// Every route in the ledger that hands a record out as a file, or serves the
// bytes behind a signed link, apart from those another slice or a private
// advisory holds. Asked through `worker.fetch` on the fully migrated schema:
//
//   signed in, the record names who may have it
//   GET /api/competitors/:id/export              a competitor analysis, as JSON or Markdown   (its owner)
//   GET /api/deck-reviewer/:id/export            a deck review, as JSON or Markdown           (its owner)
//   GET /api/wellbeing/resources/:uid/file       a library resource's file                    (any member; a draft's, an admin)
//   GET /api/learning/webinars/:uid/calendar.ics a webinar as a calendar entry                (whoever may see it: open, or
//                                                                                              enrolled in its program; a draft, the Super Admin)
//   no session, the token is the credential
//   GET /api/calendar/feed/my-events.ics         the owner's events feed                      (its own token, of its own scope)
//   GET /api/calendar/feed/calendar.ics          the owner's whole-calendar feed              (the same)
//   GET /api/decks/print-export/:token           a deck, for the headless PDF render          (a print token)
//   GET /api/market-intel-public/publications/download/:token   a publication's file         (a publication token)
//   GET /api/monitoring/analytics/download/:token               an analytics export's file   (an analytics token)
//   GET /api/learning/stream/source/:token       an uploaded video, for Stream to copy        (a source token)
//
// The callers refused: four kinds of non-party (another venture's founder,
// another deal's investor, an unrelated Operating Partner, an advisor whose
// grant on the venture was revoked and whose program enrolment was removed),
// an admin and the Super Admin where the record is the owner's alone, a
// disabled owner, no credentials; and on the token routes every account's
// session with no token, a forged, a tampered, an expired, a replaced and a
// wrong-scope token, and each other route's valid token.
//
// Each refusal names nothing of the record (no title, no file name, no
// bytes), answers a non-party as it answers a record that does not exist,
// changes no row (the feed's last-used stamp included), writes no audit row
// or notification, opens no stored object, and makes no outbound call. The
// last test runs the rightful party on every route, so each refusal is the
// gate. These are the ledger's `verified` entries for these routes.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/authz_exports_downloads_d4570.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { signDeckPrintToken } from '../src/routes/decks.ts';
import { signPublicationToken } from '../src/services/publications.ts';
import { signDownloadToken } from '../src/services/analyticsReports.ts';
import { signSourceToken } from '../src/services/learningStream.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'd4570-exports-fixture-only-'.repeat(3); // A fixture signing key; never a service credential.
const WRONG_SECRET = 'd4570-not-the-worker-key-'.repeat(3);

// The owner of every record, and the people with a right to some of them.
const FOUNDER = 2;   // owns the analysis, the review and both feeds; hosts the event; enrolled in the program
const ADMIN = 9;     // an admin: reads a draft resource's file; no reach into a member's own analysis or review
const SUPER = 10;    // the Super Admin: sees a draft webinar; no reach into a member's own analysis or review
// Everyone else.
const OTHER_FOUNDER = 4, OTHER_INVESTOR = 5, OTHER_PARTNER = 6, REVOKED_ADVISOR = 7, DISABLED = 8, SIGNED_OUT = 11;
const OUTSIDERS = [OTHER_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER, REVOKED_ADVISOR] as const;
const WHO: Record<number, string> = {
  [FOUNDER]: 'the owner', [ADMIN]: 'an admin', [SUPER]: 'the Super Admin',
  [OTHER_FOUNDER]: 'another venture\'s founder', [OTHER_INVESTOR]: 'another deal\'s investor',
  [OTHER_PARTNER]: 'an unrelated Operating Partner', [REVOKED_ADVISOR]: 'an advisor whose grant was revoked',
  [DISABLED]: 'a disabled owner', [SIGNED_OUT]: 'an owner who signed out everywhere',
};

const LEAKS = ['Quokka', 'quokka', 'QUOKKA'];
const MISSING = 'missing-0000';
const START = new Date(Date.now() + 7 * 86_400_000).toISOString(); // clock-ok: relative
const END = new Date(Date.now() + 7 * 86_400_000 + 3_600_000).toISOString(); // clock-ok: relative

// Stored objects. Each body is a marker a leak check can find.
const PUB_KEY = 'publications/quokka-weekly.pdf';
const PRIVATE_KEY = 'private/quokka-ledger.csv';            // outside the publication prefix: no publication token reaches it
const ANALYTICS_KEY = 'analytics/exports/quokka-overview.csv';
const VIDEO_KEY = 'learning/videos/quokka-intro.mp4';
const VIDEO_OLD_KEY = 'learning/videos/quokka-intro-v1.mp4'; // the upload the item played before it was replaced
const RESOURCE_KEY = 'wellbeing/resources/quokka-sleep.pdf';
const DRAFT_KEY = 'wellbeing/resources/quokka-draft.pdf';

class FakeR2 {
  objects = new Map<string, Uint8Array>();
  reads: string[] = [];
  constructor(entries: Record<string, string>) { for (const [k, v] of Object.entries(entries)) this.objects.set(k, new TextEncoder().encode(v)); }
  async head(key: string) { this.reads.push(`head ${key}`); const o = this.objects.get(key); return o ? { size: o.length, httpMetadata: { contentType: 'application/octet-stream' } } : null; }
  async get(key: string, opts?: any) {
    this.reads.push(`get ${key}`);
    const o = this.objects.get(key);
    if (!o) return null;
    const r = opts?.range;
    const bytes = r ? o.slice(r.offset, r.offset + r.length) : o;
    return { body: new Blob([bytes]).stream(), httpMetadata: { contentType: 'application/octet-stream' }, writeHttpMetadata(h: Headers) { h.set('content-type', 'application/octet-stream'); } };
  }
  async put() { throw new Error('a download never writes an object'); }
  async delete() { throw new Error('a download never deletes an object'); }
}

let db: any, env: any, files: FakeR2, publications: FakeR2;
const sessions: Record<number, string> = {};
const pending: Promise<unknown>[] = [];
const ctx: any = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
const outbound: string[] = [];
let realFetch: typeof fetch;

// Tokens, minted in `before`.
const feed = { mine: '', calendar: '', replaced: '', disabled: '', signedOut: '' };
const tok = {
  print: '', printOther: '', printExpired: '', printForged: '', printTampered: '',
  pub: '', pubPrivate: '', pubExpired: '', pubForged: '', pubTampered: '',
  analytics: '', analyticsExpired: '', analyticsForged: '', analyticsTampered: '',
  source: '', sourceStale: '', sourceExpired: '', sourceForged: '', sourceTampered: '', sourceDraft: '',
};

const jwt = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));

async function call(path: string, who?: number, method = 'GET', body?: unknown) {
  const read = method === 'GET';
  const res = await worker.fetch(new Request(`https://unit.test${path}`, {
    method, redirect: 'manual',
    headers: {
      ...(who ? { authorization: `Bearer ${sessions[who]}` } : {}),
      ...(read ? {} : { 'content-type': 'application/json' }),
    },
    body: read ? undefined : JSON.stringify(body ?? {}),
  // A fresh limiter per request: this suite is about gates, and the limiter would otherwise answer 429 first.
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  await Promise.all(pending.splice(0));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json, disposition: res.headers.get('content-disposition') };
}

/** Everything a refused download could have changed. */
const snapshot = () => JSON.stringify([
  db.prepare('SELECT * FROM competitor_analyses ORDER BY id').all(),
  db.prepare('SELECT * FROM deck_reviews ORDER BY id').all(),
  db.prepare('SELECT * FROM wellbeing_resources ORDER BY id').all(),
  db.prepare('SELECT * FROM learning_webinars ORDER BY id').all(),
  db.prepare('SELECT * FROM learning_webinar_registrations ORDER BY id').all(),
  db.prepare('SELECT * FROM learning_enrollments ORDER BY id').all(),
  db.prepare('SELECT * FROM learning_items ORDER BY id').all(),
  db.prepare('SELECT * FROM pitch_decks ORDER BY id').all(),
  db.prepare('SELECT * FROM calendar_feed_tokens ORDER BY id').all(),
  db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get(),
  // The app-wide request log writes its own `http_*` row for every request, refused or not: not the route's write.
  db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action NOT LIKE 'http\\_%' ESCAPE '\\'").get(),
  db.prepare('SELECT COUNT(*) AS n FROM notifications').get(),
]);
const named = (r: { text: string; disposition: string | null }) => LEAKS.filter((l) => r.text.includes(l) || (r.disposition ?? '').includes(l));
const objectReads = () => [...files.reads, ...publications.reads];

/** Swap one field of a signed token's payload and keep its signature. */
function tamper(token: string, from: string, to: string): string {
  const [p, s] = token.split('.');
  const payload = Buffer.from(p, 'base64url').toString('utf8');
  assert.ok(payload.includes(from), `the fixture: ${from} is in the payload`);
  return `${Buffer.from(payload.replace(from, to), 'utf8').toString('base64url')}.${s}`;
}

/** The signed-in routes, each with the record a party may export and one that does not exist. */
const OWNED = [
  { route: 'GET /api/competitors/:id/export', path: (id: string) => `/api/competitors/${id}/export?format=md`, record: 'ca-quokka', disabledRecord: 'ca-disabled' },
  { route: 'GET /api/deck-reviewer/:id/export', path: (id: string) => `/api/deck-reviewer/${id}/export?format=md`, record: 'dr-quokka', disabledRecord: 'dr-disabled' },
] as const;

before(async () => {
  db = migratedDatabase();
  db.exec(`INSERT INTO users (id, uid, name, email, role, founder_id, is_active, subscription_tier, subscription_status, investor_tier) VALUES
    (${FOUNDER},'u-fdr','Owner Founder','founder@example.test','founder',102,1,'studio','active','free'),
    (${OTHER_FOUNDER},'u-of','Other Founder','of@example.test','founder',103,1,'studio','active','free'),
    (${OTHER_INVESTOR},'u-oi','Other Investor','oi@example.test','investor',NULL,1,'studio','active','professional'),
    (${OTHER_PARTNER},'u-op','Other Partner','op@example.test','partner',NULL,1,'studio','active','free'),
    (${REVOKED_ADVISOR},'u-ra','Revoked Advisor','ra@example.test','advisor',NULL,1,'studio','active','free'),
    (${DISABLED},'u-dis','Disabled Owner','dis@example.test','founder',104,1,'studio','active','free'),
    (${ADMIN},'u-adm','Admin','admin@example.test','admin',NULL,1,'studio','active','free'),
    (${SUPER},'u-sup','Super Admin','super@example.test','admin',NULL,1,'studio','active','free'),
    (${SIGNED_OUT},'u-so','Signed Out','so@example.test','founder',105,1,'studio','active','free');
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO projects (id, uid, name, founder_id) VALUES (20,'p-venture','Venture One',102), (30,'p-else','Elsewhere',103), (40,'p-dis','Disabled Venture',104);
    INSERT INTO deals (id, project_id, lead_partner_id) VALUES (200,20,NULL), (300,30,NULL);
    INSERT INTO deal_invitations (deal_id, investor_user_id, status) VALUES (300,${OTHER_INVESTOR},'interested');
    INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, scope_project, scope_sessions, status)
      VALUES ('grant-revoked',20,${REVOKED_ADVISOR},${FOUNDER},1,1,'revoked');

    INSERT INTO competitor_analyses (id, user_id, project_id, mode, title, inputs_json, status) VALUES
      ('ca-quokka',${FOUNDER},20,'custom','Quokka competitor map','{"market":"Quokka market"}','complete'),
      ('ca-disabled',${DISABLED},40,'custom','Quokka disabled map','{}','complete');
    INSERT INTO competitor_candidates (id, analysis_id, name, url, summary, position) VALUES
      ('cc-1','ca-quokka','Quokka Rival','https://rival.example.test','Quokka rival summary',0);
    INSERT INTO deck_reviews (id, user_id, project_id, filename, title, status, review_json) VALUES
      ('dr-quokka',${FOUNDER},20,'quokka-deck.pdf','Quokka deck review','complete','{"overall_score":71,"summary":"Quokka review summary"}'),
      ('dr-disabled',${DISABLED},40,'quokka-disabled.pdf','Quokka disabled review','complete','{}');

    INSERT INTO wellbeing_resources (uid, category, name, status, file_key, file_type, file_size) VALUES
      ('res-published','reading','Quokka sleep handout','published','${RESOURCE_KEY}','application/pdf',20),
      ('res-draft','reading','Quokka draft handout','draft','${DRAFT_KEY}','application/pdf',20);

    INSERT INTO learning_webinars (uid, title, abstract, starts_at, ends_at, visibility, status, created_by) VALUES
      ('web-open','Quokka open webinar','Quokka abstract','${START}','${END}','open','published',${SUPER}),
      ('web-program','Quokka program webinar','Quokka cohort only','${START}','${END}','program','published',${SUPER}),
      ('web-draft','Quokka draft webinar','Quokka unannounced','${START}','${END}','open','draft',${SUPER});
    INSERT INTO learning_programs (id, uid, name, status, created_by) VALUES (70,'prog-quokka','Quokka cohort','published',${SUPER});
    INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid) VALUES (70,'webinar','web-program');
    INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, status) VALUES
      (70,${FOUNDER},${SUPER},'active'), (70,${DISABLED},${SUPER},'active'), (70,${REVOKED_ADVISOR},${SUPER},'removed');
    INSERT INTO learning_items (uid, kind, title, visibility, status, created_by, video_source, r2_key) VALUES
      ('vid-quokka','video','Quokka intro','open','published',${SUPER},'r2','${VIDEO_KEY}'),
      -- Switched from an upload to a link: the old key is still on the row, and no token for it may serve it.
      ('vid-link','video','Quokka link','open','published',${SUPER},'url','${VIDEO_KEY}');

    INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES
      (501,20,1,'[{"uid":"c1","type":"title","title":"Quokka cover","notes":"Quokka speaker notes"}]','Quokka deck',1,${FOUNDER}),
      (502,30,1,'[{"uid":"c1","type":"title","title":"Elsewhere cover"}]','Elsewhere deck',1,${OTHER_FOUNDER});

    INSERT INTO events (id, slug, host_user_id, title, summary, starts_at, ends_at, location_kind, location_url, visibility, status) VALUES
      (61,'quokka-meetup',${FOUNDER},'Quokka meetup','Quokka summary','${START}','${END}','virtual','https://meet.example.test/quokka','unlisted','published'),
      (62,'quokka-disabled',${DISABLED},'Quokka disabled meetup','x','${START}','${END}','virtual',NULL,'unlisted','published'),
      (63,'quokka-signed-out',${SIGNED_OUT},'Quokka signed-out meetup','x','${START}','${END}','virtual',NULL,'unlisted','published');`);

  files = new FakeR2({
    [RESOURCE_KEY]: 'QUOKKA-RESOURCE-BYTES', [DRAFT_KEY]: 'QUOKKA-DRAFT-BYTES', [ANALYTICS_KEY]: 'QUOKKA-ANALYTICS-BYTES',
    [VIDEO_KEY]: 'QUOKKA-VIDEO-BYTES', [VIDEO_OLD_KEY]: 'QUOKKA-OLD-VIDEO-BYTES', [PRIVATE_KEY]: 'QUOKKA-PRIVATE-BYTES',
  });
  publications = new FakeR2({ [PUB_KEY]: 'QUOKKA-PUBLICATION-BYTES', [PRIVATE_KEY]: 'QUOKKA-PRIVATE-BYTES' });
  env = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(),
    APP_URL: 'https://unit.test', FILES: files, PUBLICATIONS: publications,
  };
  const wrong = { ...env, JWT_SECRET: WRONG_SECRET };
  for (const id of [FOUNDER, ADMIN, SUPER, DISABLED, SIGNED_OUT, ...OUTSIDERS]) sessions[id] = await jwt({ user_id: id });

  // The feeds, made the way a member makes them: signed in. The first my-events address is replaced by a second.
  const mint = async (who: number, path: string) => new URL((await call(path, who, 'POST')).json.url).searchParams.get('token')!;
  feed.replaced = await mint(FOUNDER, '/api/calendar/my-events/feed');
  feed.mine = await mint(FOUNDER, '/api/calendar/my-events/feed');
  feed.calendar = await mint(FOUNDER, '/api/calendar/subscription');
  feed.disabled = await mint(DISABLED, '/api/calendar/my-events/feed');
  feed.signedOut = await mint(SIGNED_OUT, '/api/calendar/my-events/feed');
  for (const t of Object.values(feed)) assert.match(t, /^[A-Za-z0-9_-]{20,}$/, 'the fixture: every feed address was made');
  // The owner disabled; the other owner pressed "sign out everywhere" after making the address.
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(DISABLED);
  db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) + 120, SIGNED_OUT); // clock-ok: relative

  tok.print = await signDeckPrintToken(env, 501);
  tok.printOther = await signDeckPrintToken(env, 502);
  tok.printExpired = await signDeckPrintToken(env, 501, -60);
  tok.printForged = await signDeckPrintToken(wrong, 501);
  tok.printTampered = tamper(tok.printOther, 'deck-print|502|', 'deck-print|501|');
  tok.pub = await signPublicationToken(env, PUB_KEY);
  tok.pubPrivate = await signPublicationToken(env, PRIVATE_KEY);
  tok.pubExpired = await signPublicationToken(env, PUB_KEY, -60);
  tok.pubForged = await signPublicationToken(wrong, PUB_KEY);
  tok.pubTampered = tamper(tok.pub, PUB_KEY, 'publications/quokka-other.pdf');
  tok.analytics = await signDownloadToken(env, ANALYTICS_KEY, 86400);
  tok.analyticsExpired = await signDownloadToken(env, ANALYTICS_KEY, -60);
  tok.analyticsForged = await signDownloadToken(wrong, ANALYTICS_KEY, 86400);
  tok.analyticsTampered = tamper(tok.analytics, ANALYTICS_KEY, PRIVATE_KEY);
  tok.source = (await signSourceToken(env, 'vid-quokka', VIDEO_KEY))!;
  tok.sourceStale = (await signSourceToken(env, 'vid-quokka', VIDEO_OLD_KEY))!;
  tok.sourceExpired = (await signSourceToken(env, 'vid-quokka', VIDEO_KEY, Date.now() - 2 * 3_600_000))!; // clock-ok: relative
  tok.sourceForged = (await signSourceToken(wrong, 'vid-quokka', VIDEO_KEY))!;
  tok.sourceTampered = tamper(tok.source, VIDEO_KEY, PRIVATE_KEY);
  tok.sourceDraft = (await signSourceToken(env, 'vid-link', VIDEO_KEY))!;

  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => { outbound.push(String(url)); return Response.json({}); }) as typeof fetch;
  files.reads.length = 0; publications.reads.length = 0;
});
after(() => { if (realFetch) globalThis.fetch = realFetch; db?.close(); removeMigratedDatabases(); });

test('no credentials: every signed-in export is refused 401, names nothing, opens nothing and changes nothing', async () => {
  const before = snapshot();
  const asks = [
    ...OWNED.map((o) => [o.route, o.path(o.record)] as const),
    ['GET /api/wellbeing/resources/:uid/file', '/api/wellbeing/resources/res-published/file'] as const,
    ['GET /api/learning/webinars/:uid/calendar.ics', '/api/learning/webinars/web-open/calendar.ics'] as const,
  ];
  for (const [route, path] of asks) {
    const r = await call(path);
    // Mutation checked: the competitor export's requireAuth replaced by a fixed owner → it exports the analysis and this fails.
    assert.equal(r.status, 401, `${route}: ${r.text}`);
    assert.deepEqual(named(r), [], `${route}: the refusal names nothing`);
  }
  assert.equal(snapshot(), before);
  assert.deepEqual(objectReads(), [], 'no stored object was opened');
  assert.equal(outbound.length, 0);
});

test('a disabled owner: their own analysis, review, enrolled webinar and published file are refused 401', async () => {
  const before = snapshot();
  const asks = [
    ...OWNED.map((o) => [o.route, o.path(o.disabledRecord)] as const),
    ['GET /api/wellbeing/resources/:uid/file', '/api/wellbeing/resources/res-published/file'] as const,
    ['GET /api/learning/webinars/:uid/calendar.ics', '/api/learning/webinars/web-program/calendar.ics'] as const,
  ];
  for (const [route, path] of asks) {
    const r = await call(path, DISABLED);
    // Mutation checked: getCurrentUser's `is_active` refusal removed → the disabled owner exports and this fails.
    assert.equal(r.status, 401, `${route}: ${r.text}`);
    assert.deepEqual(named(r), [], `${route}: the refusal names nothing`);
  }
  assert.equal(snapshot(), before);
  assert.deepEqual(objectReads(), []);
  assert.equal(outbound.length, 0);
});

test('an analysis or a review is its owner\'s alone: every other account, an admin and the Super Admin get the answer a missing id gets', async () => {
  const before = snapshot();
  for (const o of OWNED) {
    const answers = new Set<string>();
    for (const id of [...OUTSIDERS, ADMIN, SUPER]) {
      const real = await call(o.path(o.record), id);
      const none = await call(o.path(MISSING), id);
      // Mutation checked, one route at a time: the loader's `user_id = caller` binding removed → this fails.
      assert.equal(real.status, 404, `${o.route} as ${WHO[id]}: ${real.text}`);
      assert.deepEqual(named(real), [], `${o.route} as ${WHO[id]}: names nothing`);
      assert.deepEqual([real.status, real.text], [none.status, none.text], `${o.route} as ${WHO[id]}: no existence leak`);
      answers.add(`${real.status} ${real.text}`);
    }
    assert.equal(answers.size, 1, `${o.route}: one answer whoever asks`);
    // The disabled owner's record is no nearer to anyone else.
    assert.equal((await call(o.path(o.disabledRecord), OTHER_FOUNDER)).status, 404);
  }
  assert.equal(snapshot(), before);
  assert.deepEqual(objectReads(), []);
  assert.equal(outbound.length, 0);
});

test('a draft resource\'s file: every account but an admin gets the answer a missing file gets, and nothing is opened', async () => {
  const before = snapshot();
  for (const id of [...OUTSIDERS, FOUNDER]) {
    const real = await call('/api/wellbeing/resources/res-draft/file', id);
    const none = await call(`/api/wellbeing/resources/${MISSING}/file`, id);
    // Mutation checked: the draft test (`status === 'draft' && role !== 'admin'`) removed → the draft's bytes are served and this fails.
    assert.equal(real.status, 404, `as ${WHO[id]}: ${real.text}`);
    assert.deepEqual(named(real), []);
    assert.deepEqual([real.status, real.text], [none.status, none.text], `as ${WHO[id]}: no existence leak`);
  }
  assert.equal(snapshot(), before);
  assert.deepEqual(objectReads(), [], 'the draft\'s object was never opened');
  assert.equal(outbound.length, 0);
});

test('a webinar\'s calendar entry: a program webinar to the unenrolled (a removed enrolment included), a draft to all but the Super Admin', async () => {
  const before = snapshot();
  for (const [uid, askers] of [
    ['web-program', [...OUTSIDERS, ADMIN]],
    ['web-draft', [...OUTSIDERS, ADMIN, FOUNDER]],
  ] as const) {
    const answers = new Set<string>();
    for (const id of askers) {
      const real = await call(`/api/learning/webinars/${uid}/calendar.ics`, id);
      const none = await call(`/api/learning/webinars/${MISSING}/calendar.ics`, id);
      // Mutation checked, one at a time: the route's `seen` test removed; the program rule reading any enrolment as active
      // (`pe.status = 'active'` removed from enrolledSql) → the removed advisor gets the entry; the draft rule widened to every admin.
      assert.equal(real.status, 404, `${uid} as ${WHO[id]}: ${real.text}`);
      assert.deepEqual(named(real), [], `${uid} as ${WHO[id]}: names nothing`);
      assert.deepEqual([real.status, real.text], [none.status, none.text], `${uid} as ${WHO[id]}: no existence leak`);
      answers.add(`${real.status} ${real.text}`);
    }
    assert.equal(answers.size, 1, `${uid}: one answer whoever asks`);
  }
  assert.equal(snapshot(), before);
  assert.equal(outbound.length, 0);
});

test('the calendar feeds: no session opens one, and a replaced, wrong-scope, disabled or signed-out address answers as an unknown one', async () => {
  const before = snapshot();
  const MY = '/api/calendar/feed/my-events.ics', ALL = '/api/calendar/feed/calendar.ics';
  const unknown = await call(`${MY}?token=${'A'.repeat(43)}`);
  assert.equal(unknown.status, 404, unknown.text);
  const asks: Array<[string, string, number | undefined]> = [
    ['the replaced my-events address', `${MY}?token=${feed.replaced}`, undefined],
    // Mutation checked: resolveFeedToken's `scope = ?` binding removed → each address opens the other feed and this fails.
    ['the my-events address on the whole-calendar feed', `${ALL}?token=${feed.mine}`, undefined],
    ['the whole-calendar address on the my-events feed', `${MY}?token=${feed.calendar}`, undefined],
    // Mutation checked: resolveFeedToken's `is_active` test removed → the disabled owner's feed is served and this fails.
    ['a disabled owner\'s address', `${MY}?token=${feed.disabled}`, undefined],
    // Mutation checked: resolveFeedToken's `jwt_min_iat` test removed → the signed-out owner's feed is served and this fails.
    ['an address made before "sign out everywhere"', `${MY}?token=${feed.signedOut}`, undefined],
    ['no address', MY, undefined],
    ['no address, whole calendar', ALL, undefined],
  ];
  // A session is no address: not the owner's, not an admin's, not anyone's.
  for (const id of [FOUNDER, ADMIN, SUPER, ...OUTSIDERS]) {
    asks.push([`${WHO[id]}'s session, no address`, MY, id], [`${WHO[id]}'s session, no address, whole calendar`, ALL, id]);
  }
  for (const [label, path, who] of asks) {
    const r = await call(path, who);
    assert.equal(r.status, 404, `${label}: ${r.text}`);
    assert.deepEqual(named(r), [], `${label}: names nothing`);
    assert.equal(r.text, unknown.text, `${label}: the same answer an unknown address gets`);
  }
  assert.equal(snapshot(), before, 'no address\'s last-used stamp moved');
  assert.equal(outbound.length, 0);
});

/** The token routes: each with its own refusal, the tokens it must refuse, and every other route's valid token. */
const TOKEN_ROUTES = () => [
  {
    route: 'GET /api/decks/print-export/:token', path: (t: string) => `/api/decks/print-export/${t}`, status: 403,
    // Mutations checked, one at a time: the signature test and the expiry test removed.
    refused: { forged: tok.printForged, expired: tok.printExpired, tampered: tok.printTampered, garbage: 'not-a-token' },
    others: { publication: tok.pub, analytics: tok.analytics, source: tok.source },
  },
  {
    route: 'GET /api/market-intel-public/publications/download/:token', path: (t: string) => `/api/market-intel-public/publications/download/${t}`, status: 403,
    // Mutations checked, one at a time: the signature test, the expiry test and the `publications/` prefix lock removed
    // (the prefix lock is what keeps a publication token off any other object in the bucket).
    refused: { forged: tok.pubForged, expired: tok.pubExpired, tampered: tok.pubTampered, 'outside the prefix': tok.pubPrivate, garbage: 'not-a-token' },
    others: { print: tok.print, analytics: tok.analytics, source: tok.source },
  },
  {
    route: 'GET /api/monitoring/analytics/download/:token', path: (t: string) => `/api/monitoring/analytics/download/${t}`, status: 403,
    // Mutations checked, one at a time: the signature test and the expiry test removed.
    refused: { forged: tok.analyticsForged, expired: tok.analyticsExpired, tampered: tok.analyticsTampered, garbage: 'not-a-token' },
    // The publication token is checked on its own below: see the hardening item in D4570-p5.
    others: { print: tok.print, source: tok.source },
  },
  {
    route: 'GET /api/learning/stream/source/:token', path: (t: string) => `/api/learning/stream/source/${t}`, status: 404,
    // Mutations checked, one at a time: the expiry test removed; the `r2_key = token's key` test removed (the stale
    // token of a replaced upload then serves the old bytes); the `video_source = 'r2'` test removed.
    refused: { forged: tok.sourceForged, expired: tok.sourceExpired, tampered: tok.sourceTampered, 'a replaced upload': tok.sourceStale, 'an item that plays no upload': tok.sourceDraft, garbage: 'not-a-token' },
    others: { print: tok.print, publication: tok.pub, analytics: tok.analytics },
  },
];

test('the token routes: a forged, tampered, expired or misdirected token, and another route\'s token, are refused, name nothing and serve nothing', async () => {
  const before = snapshot();
  for (const t of TOKEN_ROUTES()) {
    const answers = new Set<string>();
    for (const [label, token] of [...Object.entries(t.refused), ...Object.entries(t.others).map(([k, v]) => [`a valid ${k} token`, v] as const)]) {
      const r = await call(t.path(token));
      assert.equal(r.status, t.status, `${t.route}, ${label}: ${r.status} ${r.text}`);
      assert.deepEqual(named(r), [], `${t.route}, ${label}: names nothing and sends no file name`);
      answers.add(`${r.status} ${r.text}`);
    }
    // One refusal per route, whatever was wrong with the token.
    assert.equal(answers.size, 1, `${t.route}: ${[...answers].join(' | ')}`);
  }
  assert.equal(snapshot(), before);
  assert.deepEqual(objectReads(), [], 'no object was opened for a refused token');
  assert.equal(outbound.length, 0);
});

test('a session is no token: every account, with any bad token, gets the route\'s own refusal', async () => {
  const before = snapshot();
  for (const t of TOKEN_ROUTES()) {
    for (const id of [FOUNDER, ADMIN, SUPER, ...OUTSIDERS]) {
      const r = await call(t.path('not-a-token'), id);
      assert.equal(r.status, t.status, `${t.route} with ${WHO[id]}'s session: ${r.text}`);
      assert.deepEqual(named(r), []);
    }
  }
  assert.equal(snapshot(), before);
  assert.deepEqual(objectReads(), []);
  assert.equal(outbound.length, 0);
});

test('hardening item (D4570-p5): a publication token on the analytics download passes its signature test, names no object and serves nothing', async () => {
  const before = snapshot();
  const r = await call(`/api/monitoring/analytics/download/${tok.pub}`);
  // The token was minted for another purpose with the same key. The analytics reader has no purpose tag and no prefix
  // lock, so the token is read as naming an object called `pub`, which does not exist: 404 where its own refusal is 403.
  assert.equal(r.status, 404, r.text);
  assert.deepEqual(named(r), []);
  assert.equal(r.disposition, null, 'no file was sent');
  assert.equal(snapshot(), before);
  assert.equal(outbound.length, 0);
});

test('the rightful party gets each export, so the refusals above are the gates (run last)', async () => {
  files.reads.length = 0; publications.reads.length = 0;
  // The owner's analysis and review.
  for (const o of OWNED) {
    const r = await call(o.path(o.record), FOUNDER);
    assert.equal(r.status, 200, `${o.route}: ${r.text}`);
    assert.ok(r.text.includes('Quokka'), `${o.route}: the owner's export carries the record`);
  }
  // A published resource's file, to any member; a draft's, to an admin.
  const pubFile = await call('/api/wellbeing/resources/res-published/file', OTHER_INVESTOR);
  assert.deepEqual([pubFile.status, pubFile.text], [200, 'QUOKKA-RESOURCE-BYTES']);
  const draftFile = await call('/api/wellbeing/resources/res-draft/file', ADMIN);
  assert.deepEqual([draftFile.status, draftFile.text], [200, 'QUOKKA-DRAFT-BYTES']);
  // The open webinar to anyone; the program webinar to the enrolled founder; the draft to the Super Admin.
  for (const [uid, who] of [['web-open', OTHER_PARTNER], ['web-program', FOUNDER], ['web-draft', SUPER]] as const) {
    const r = await call(`/api/learning/webinars/${uid}/calendar.ics`, who);
    assert.equal(r.status, 200, `${uid} as ${WHO[who]}: ${r.text}`);
    assert.ok(r.text.includes('BEGIN:VEVENT') && r.text.includes('Quokka'), `${uid}: the entry`);
  }
  // Each feed at its own address, and its last-used stamp moves.
  const my = await call(`/api/calendar/feed/my-events.ics?token=${feed.mine}`);
  assert.equal(my.status, 200, my.text);
  assert.ok(my.text.includes('Quokka meetup'), 'the owner\'s hosted event is in the my-events feed');
  const all = await call(`/api/calendar/feed/calendar.ics?token=${feed.calendar}`);
  assert.equal(all.status, 200, all.text);
  assert.ok(all.text.includes('BEGIN:VCALENDAR'));
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM calendar_feed_tokens WHERE last_used_at IS NOT NULL").get().n >= 2);
  // Each token route serves its own valid token.
  const print = await call(`/api/decks/print-export/${tok.print}`);
  assert.equal(print.status, 200, print.text);
  assert.ok(print.text.includes('Quokka cover'));
  const pub = await call(`/api/market-intel-public/publications/download/${tok.pub}`);
  assert.deepEqual([pub.status, pub.text], [200, 'QUOKKA-PUBLICATION-BYTES']);
  const analytics = await call(`/api/monitoring/analytics/download/${tok.analytics}`);
  assert.deepEqual([analytics.status, analytics.text], [200, 'QUOKKA-ANALYTICS-BYTES']);
  const source = await call(`/api/learning/stream/source/${tok.source}`);
  assert.deepEqual([source.status, source.text], [200, 'QUOKKA-VIDEO-BYTES']);
  assert.ok(objectReads().length > 0, 'the fixture: a rightful download opens its object, so "nothing opened" above is meaningful');
  assert.equal(outbound.length, 0);
});
