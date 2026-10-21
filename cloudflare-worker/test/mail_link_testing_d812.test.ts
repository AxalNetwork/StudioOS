/**
 * D812 part 2b (#2258) — Mail's Product testing reads, mounted on D811's signed
 * router: `GET /api/mail-link/testing/programmes` and
 * `GET /api/mail-link/testing/programmes/:uid/applicants`. Real signed HTTP
 * requests and the real migrations (515, 516, 517), as `mail_link_d811` runs.
 *
 * What these prove:
 *   · Both reads are D811's surface: 404 with no secret, 401 unsigned.
 *   · The programmes read names each owner and counts; the applicants read is
 *     one programme's, and an unknown uid is 404, never another's list.
 *   · An applicant's email is set ONLY for someone `testers:<uid>` sends to —
 *     the same people as D811's `testerRecipients` and as `testersAudience`,
 *     case by case: picked and consented; not consented; programme emails
 *     turned off; suppressed; unsubscribed; an inactive account; applied or
 *     declined; a programme not yet open.
 *   · Each read is logged in `mail_link_reads`, never with an address.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mail_link_testing_d812.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import mailLink from '../src/routes/mail_link.ts';
import { mailLinkSignature } from '../src/middleware/mailLink.ts';
import { testerRecipients } from '../src/services/mailLinkTesters.ts';
import { testersAudience } from '../src/services/testing.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
// Random per run: synthetic credentials never committed as secret-looking literals.
const secret = crypto.randomUUID();
const prefix = '/api/mail-link';
const PROG = 'a1b2c3d4e5f60718', OTHER = 'f0e1d2c3b4a59687', SHUT = 'c0ffee00c0ffee00';

function harness(env: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:');
  for (const name of ['users', 'user_profile_ext', 'partners', 'insight_subscriptions', 'rate_limit_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  }
  db.exec(read('cloudflare-worker/sql/migrations/515_newsletter_lists.sql'));
  db.exec(stripForeignKeys(read('cloudflare-worker/sql/migrations/516_product_testing.sql')));
  db.exec(read('cloudflare-worker/sql/migrations/517_mail_link.sql'));
  const kv = new Map<string, string>();
  const e: any = { ENVIRONMENT: 'production', MAIL_LINK_SECRET: secret, NEWSLETTER_TOKEN_KEY: crypto.randomUUID(),
    DB: d1Over(db), APP_URL: 'https://example.test', RATE_LIMITS: {
      get: async (key: string) => kv.get(key) || null,
      put: async (key: string, value: string) => { kv.set(key, value); },
    }, ...env };
  const app = new Hono<any>();
  app.route(prefix, mailLink);
  let tick = 0;
  const start = Math.floor(Date.now() / 1000);
  const context = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException() {} };
  const raw = (path: string, init: RequestInit = {}) => app.request(`https://example.test${path}`, init, e, context as any);
  async function signed(path: string) {
    const timestamp = String(start - tick++);
    const signature = await mailLinkSignature(secret, 'GET', path, timestamp, '');
    return raw(path, { headers: { 'X-Axal-Link-Timestamp': timestamp, 'X-Axal-Link-Signature': signature } });
  }
  return { db, env: e, raw, signed };
}

/**
 * Two programmes (Acme's open one and HQ's open one) and a third not yet open,
 * with one applicant per email case.
 */
function seed(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`INSERT INTO partners (id, uid, name, company, email) VALUES (1, 'p1', 'Ada Acme', 'Acme Labs', 'acme@example.test');
    INSERT INTO testing_programmes (id, uid, owner_kind, owner_partner_id, created_by, product_name, places, status, eligible_roles)
      VALUES (1, '${PROG}', 'partner', 1, 10, 'Ledger beta', 9, 'open', '["founder"]'),
             (2, '${OTHER}', 'hq', NULL, 1, 'Axal Mail beta', 2, 'open', '["founder"]'),
             (3, '${SHUT}', 'hq', NULL, 1, 'Not yet open', 2, 'approved', '["founder"]');`);
  const user = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, ?)');
  const app = db.prepare(`INSERT INTO testing_applications (uid, programme_id, user_id, answers, status, consent_email_at, consent_version, mail_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const cases: [number, string, string, number, string, boolean, number, number?][] = [
    // id, name, email, programme, status, consented, mail_enabled, active
    [20, 'Fran Ruiz', ' Fran@Example.test ', 1, 'picked', true, 1],
    [21, 'Finn Oak', 'finn@example.test', 1, 'picked', false, 1],
    [22, 'Fay Wu', 'fay@example.test', 1, 'picked', true, 0],
    [23, 'Sam Supp', 'sam@example.test', 1, 'picked', true, 1],
    [24, 'Una Sub', 'una@example.test', 1, 'picked', true, 1],
    [25, 'Ina Active', 'ina@example.test', 1, 'picked', true, 1, 0],
    [26, 'Abe Applied', 'abe@example.test', 1, 'applied', true, 1],
    [27, 'Dee Declined', 'dee@example.test', 1, 'declined', true, 1],
    [28, 'Other Prog', 'other@example.test', 2, 'picked', true, 1],
    [29, 'Early Bird', 'early@example.test', 3, 'picked', true, 1],
  ];
  for (const [id, name, email, prog, status, consented, enabled, active = 1] of cases) {
    user.run(id, email, name, 'founder', active);
    app.run(`app${id}`, prog, id, JSON.stringify([`Spreadsheets, mostly\nand paper`]), status, consented ? '2026-10-20T10:00:00Z' : null, consented ? 'd812-1' : null, enabled);
  }
  db.exec(`INSERT INTO email_suppressions (email, reason, source) VALUES ('sam@example.test', 'bounce', 'mail_link');
    INSERT INTO newsletter_subscribers (uid, email, status, source) VALUES ('${'9'.repeat(32)}', 'una@example.test', 'unsubscribed', 'website');`);
}

test('both reads are D811\'s surface: 404 with no secret, 401 unsigned', async () => {
  const off = harness({ MAIL_LINK_SECRET: '' });
  for (const p of [`${prefix}/testing/programmes`, `${prefix}/testing/programmes/${PROG}/applicants`]) {
    assert.equal((await off.raw(p)).status, 404, p);
  }
  const h = harness();
  seed(h.db);
  // Mutation checked: mount the reads before mailLinkAuth → an unsigned read answers 200.
  for (const p of [`${prefix}/testing/programmes`, `${prefix}/testing/programmes/${PROG}/applicants`]) {
    assert.equal((await h.raw(p)).status, 401, p);
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM mail_link_reads').get()!.n, 0, 'a refused read logs nothing');
});

test('programmes: every programme with its owner, status, places, applicants and dates; the read is logged', async () => {
  const h = harness();
  seed(h.db);
  const r = await h.signed(`${prefix}/testing/programmes`);
  assert.equal(r.status, 200);
  const body: any = await r.json();
  assert.deepEqual(body.items.map((p: any) => [p.uid, p.owner_name, p.status, p.places, p.applicant_count]), [
    [SHUT, 'Axal VC', 'approved', 2, 1],
    [OTHER, 'Axal VC', 'open', 2, 1],
    [PROG, 'Acme Labs', 'open', 9, 8],
  ]);
  assert.ok(!JSON.stringify(body).includes('@'), 'no address in the programmes read');
  assert.deepEqual(h.db.prepare('SELECT audience, count FROM mail_link_reads').all().map((x: any) => ({ ...x })), [{ audience: 'testing:programmes', count: 3 }]);
});

test('applicants: an email only for someone testers:<uid> sends to, the same people as testerRecipients', async () => {
  // Mutation checked: drop `a.mail_enabled = 1` from mailApplicants' CASE → Fay, who turned programme emails off, gets an email.
  // Mutation checked: drop the email_suppressions clause → Sam, a suppressed address, gets an email.
  // Mutation checked: drop the unsubscribed clause → Una gets an email.
  // Mutation checked: drop the programme-status clause → Early Bird, on a programme not yet open, gets an email.
  const h = harness();
  seed(h.db);
  const r = await h.signed(`${prefix}/testing/programmes/${PROG}/applicants`);
  assert.equal(r.status, 200);
  const body: any = await r.json();
  const emails = Object.fromEntries(body.items.map((a: any) => [a.name, a.email]));
  assert.deepEqual(emails, {
    'Fran Ruiz': 'fran@example.test',
    'Finn Oak': null, 'Fay Wu': null, 'Sam Supp': null, 'Una Sub': null, 'Ina Active': null,
    'Abe Applied': null, 'Dee Declined': null,
  });
  assert.equal(body.items[0].first_answer, 'Spreadsheets, mostly');
  assert.deepEqual(body.programme, { uid: PROG, product_name: 'Ledger beta', owner_name: 'Acme Labs', status: 'open', places: 9 });
  assert.ok(!body.items.some((a: any) => a.name === 'Other Prog'), "another programme's applicant never appears");
  // The three readers of the rule agree, on every programme.
  for (const uid of [PROG, OTHER, SHUT]) {
    const fromRead: any = await (await h.signed(`${prefix}/testing/programmes/${uid}/applicants`)).json();
    const read = fromRead.items.map((a: any) => a.email).filter(Boolean).sort();
    const sends = (await testerRecipients(h.env, uid, 0)).recipients.map((x: any) => x.email).sort();
    const audience = (await testersAudience(h.env, uid)).map((x) => x.email).sort();
    assert.deepEqual([read, audience], [sends, sends], uid);
  }
  assert.deepEqual((await testerRecipients(h.env, SHUT, 0)).recipients, [], 'a programme not yet open sends to nobody');
});

test('applicants: an unknown or malformed uid is 404, never a list; each read is logged without an address', async () => {
  // Mutation checked: answer an unknown uid with an empty list → the read is 200.
  const h = harness();
  seed(h.db);
  for (const uid of ['0123456789abcdef', 'not-a-uid!', 'x']) {
    const r = await h.signed(`${prefix}/testing/programmes/${encodeURIComponent(uid)}/applicants`);
    assert.equal(r.status, 404, uid);
    assert.equal(((await r.json()) as any).error, 'not_found');
  }
  await h.signed(`${prefix}/testing/programmes/${PROG}/applicants`);
  const logged = h.db.prepare('SELECT audience, count FROM mail_link_reads').all().map((x: any) => ({ ...x }));
  assert.deepEqual(logged, [{ audience: `testing:applicants:${PROG}`, count: 8 }]);
  assert.ok(!JSON.stringify(logged).includes('@'));
});
