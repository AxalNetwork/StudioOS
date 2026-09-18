/**
 * D110 — H3 step 5: the licence agreement, instantiated from a master template.
 *
 * TWO PROPERTIES THIS FILE EXISTS FOR, and both are about what happens to the
 * thing the licence CANNOT supply:
 *
 *   1. A merge field nobody can fill is LEFT VISIBLE and named. Blanking it
 *      turns "we never agreed a governing law" into a contract that reads as
 *      complete and says nothing — the single most expensive silent failure
 *      available on this screen.
 *   2. The rendered body is STORED, not re-rendered on read. A master template
 *      gets edited and a fee gets re-termed; a contract that restated itself
 *      from today's values would display terms nobody signed. The test that
 *      proves it changes the licence AFTER instantiation and reads the row
 *      back unchanged.
 *
 * Both halves of each assertion are exercised: a renderer that substituted
 * nothing would pass a test that only checked the placeholder survived.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_contract_instantiate.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

/**
 * `licence_events` WITH ITS REAL CHECK, read off the migrations rather than
 * retyped (D139).
 *
 * THIS FIXTURE USED TO DECLARE `event TEXT NOT NULL` AND NOTHING MORE, and that
 * is why the suite was green while the route was broken. `POST /:uid/contract`
 * writes the event `contract_instantiated`, which migration 187's CHECK did not
 * admit — so on real D1 the contract row landed and the route then answered
 * 400. A fixture that omits the constraint it is testing under cannot fail on a
 * value the real constraint rejects, which is the same class as an assertion
 * that cannot fail. `compliance_ladder_d135.test.ts` states the rule it kept:
 * "The CHECK is migration 187's, copied rather than relaxed."
 *
 * 266 widens the CHECK, so the DDL is assembled from BOTH files: 187's table
 * with 266's replacement when it exists. Reading them rather than retyping is
 * what makes this test fail if either changes.
 */
function licenceEventsDdl(): string {
  const read = (f: string) => readFileSync(
    resolve(process.cwd(), `cloudflare-worker/sql/migrations/${f}`), 'utf8',
  );
  // 266 rebuilds the table; its CREATE is the current shape. Fall back to 187's
  // only if 266 is ever removed, so this never silently loses the constraint.
  for (const [file, marker] of [
    ['266_licence_event_contract.sql', 'CREATE TABLE IF NOT EXISTS licence_events_266'],
    ['187_territory_licences.sql', 'CREATE TABLE IF NOT EXISTS licence_events'],
  ] as const) {
    let sql: string;
    try { sql = read(file); } catch { continue; }
    const at = sql.indexOf(marker);
    if (at < 0) continue;
    const end = sql.indexOf(');', at);
    assert.ok(end > at, `${file}: the licence_events CREATE does not terminate`);
    return sql.slice(at, end + 2).replace('licence_events_266', 'licence_events');
  }
  throw new Error('neither 187 nor 266 declares licence_events — re-point this fixture');
}

import adminLicences from '../src/routes/admin_licences.ts';
import {
  mergeValues, renderContract, moneyFromCents, pctFromBps,
} from '../src/services/licenceContract.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7;
const PLAIN = 9;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const LICENCE = {
  id: 1, uid: 'lic_fr', licence_ref: 'AXL-001', entity_id: null,
  legal_entity_name: 'Axal VC France SAS', brand_name: 'Axal VC France',
  registered_address: '12 rue de la Paix, Paris', signatory_name: 'Marie Dubois',
  signatory_title: 'Directrice Générale', status: 'active',
  term_years: 5, annual_fee_cents: 9000000, currency: 'EUR',
  revenue_share_bps: 3500, token_split_bps: 3050,
  starts_on: '2026-01-01', renews_on: '2027-01-01', suspended_at: null,
  terminated_at: null, status_note: null, created_at: '2026-01-01T00:00:00Z',
} as any;

/* ── the pure half ─────────────────────────────────────────────────── */

test('money and percentages come out of the ledger\'s integers, not out of floats', () => {
  assert.equal(moneyFromCents(9000000, 'EUR'), 'EUR 90,000.00');
  assert.equal(moneyFromCents(1, 'USD'), 'USD 0.01');
  assert.equal(moneyFromCents(123456789, 'GBP'), 'GBP 1,234,567.89');
  assert.equal(moneyFromCents(0, null), 'EUR 0.00', 'zero is a number, not an absence');
  assert.equal(moneyFromCents(null, 'EUR'), null, 'an absent fee is absent, never "EUR 0.00"');

  assert.equal(pctFromBps(3500), '35%', 'a whole percentage carries no decimal');
  assert.equal(pctFromBps(3050), '30.5%');
  assert.equal(pctFromBps(0), '0%');
  assert.equal(pctFromBps(null), null);
});

test('a field the licence cannot fill keeps its placeholder AND is named', () => {
  const values = mergeValues(LICENCE, ['FR', 'BE'], [{ seat_type: 'founder', seats_licensed: 200 }]);
  const { body, unfilled } = renderContract(
    'Between {{legal_entity_name}} and Axal VC, for {{territory}}, at {{annual_fee}} '
    + 'under {{governing_law}}, renewing {{renews_on}}. See {{governing_law}} again.',
    values,
  );
  // Substituted — without this half a renderer that replaced nothing would
  // pass the placeholder assertion below.
  assert.match(body, /Axal VC France SAS/);
  assert.match(body, /for FR, BE/);
  assert.match(body, /EUR 90,000\.00/);
  assert.match(body, /renewing 2027-01-01/);
  // NOT substituted, and still visible.
  assert.match(body, /under \{\{governing_law\}\}/);
  assert.deepEqual(unfilled, ['governing_law'], 'named once, not once per occurrence');
  assert.ok(!body.includes('under  under'), 'nothing is blanked');
});

test('a merge field the licence has but has not SET is unfilled too', () => {
  // `renews_on` on a licence whose renewal date was never entered is not a
  // field nobody has heard of — but it is just as much "the contract is not
  // finished", and a blank date on a contract is worse than a visible gap.
  const values = mergeValues({ ...LICENCE, renews_on: null, registered_address: '' }, ['FR'], []);
  const { body, unfilled } = renderContract('{{renews_on}} / {{registered_address}} / {{starts_on}}', values);
  assert.deepEqual(unfilled, ['renews_on', 'registered_address']);
  assert.match(body, /\{\{renews_on\}\}/);
  assert.match(body, /2026-01-01/, 'the one that IS set is still substituted');
});

test('seats appear per type and as a total, and only when there are any', () => {
  const withSeats = mergeValues(LICENCE, ['FR'], [
    { seat_type: 'founder', seats_licensed: 200 },
    { seat_type: 'advisor', seats_licensed: 125 },
  ]);
  assert.equal(withSeats.seats_total, '325');
  assert.equal(withSeats.seats_founder, '200');
  assert.equal(withSeats.seats_advisor, '125');

  // A licence with no seats row does not render "0" — it renders nothing, and
  // the field is reported unfilled.
  const none = mergeValues(LICENCE, ['FR'], []);
  assert.equal(none.seats_total, null);
  assert.deepEqual(renderContract('{{seats_total}}', none).unfilled, ['seats_total']);
});

test('a template with no placeholders renders unchanged and reports nothing', () => {
  const { body, unfilled } = renderContract('Plain text, no fields.', mergeValues(LICENCE, ['FR'], []));
  assert.equal(body, 'Plain text, no fields.');
  assert.deepEqual(unfilled, []);
});

/* ── the route ─────────────────────────────────────────────────────── */

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
  CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
    licence_ref TEXT UNIQUE NOT NULL, entity_id INTEGER, legal_entity_name TEXT NOT NULL,
    brand_name TEXT NOT NULL, registered_address TEXT, signatory_name TEXT, signatory_title TEXT,
    status TEXT NOT NULL DEFAULT 'draft', term_years INTEGER, annual_fee_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'EUR', revenue_share_bps INTEGER, token_split_bps INTEGER,
    starts_on TEXT, renews_on TEXT, suspended_at TEXT, terminated_at TEXT, status_note TEXT,
    created_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
    country_code TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
    seat_type TEXT NOT NULL, seats_licensed INTEGER NOT NULL DEFAULT 0);
  ${licenceEventsDdl()}
  CREATE TABLE licence_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE licence_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
    licence_uid TEXT NOT NULL, template_slug TEXT NOT NULL, template_version INTEGER NOT NULL,
    template_title TEXT NOT NULL, body_md TEXT NOT NULL, unfilled_fields TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft', envelope_uid TEXT, superseded_at TEXT,
    created_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT, signed_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

const TEMPLATE_BODY =
  'AGREEMENT between {{legal_entity_name}} (the "Licensee") and Axal VC.\n'
  + 'Territory: {{territory}}. Annual fee: {{annual_fee}}. Revenue share: {{revenue_share}}.\n'
  + 'Governed by {{governing_law}}.';

function seededDb({ templates = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(HOLDER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  db.prepare(
    `INSERT INTO territory_licences
       (id, uid, licence_ref, legal_entity_name, brand_name, registered_address, signatory_name,
        signatory_title, status, term_years, annual_fee_cents, currency, revenue_share_bps,
        token_split_bps, starts_on, renews_on)
     VALUES (1,'lic_fr','AXL-001','Axal VC France SAS','Axal VC France','12 rue de la Paix, Paris',
             'Marie Dubois','Directrice Générale','active',5,9000000,'EUR',3500,3050,
             '2026-01-01','2027-01-01')`,
  ).run();
  const t = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?,?)');
  t.run(1, 'LU'); t.run(1, 'FR'); t.run(1, 'BE');
  db.prepare('INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (?,?,?)')
    .run(1, 'founder', 325);

  // `ensureLegalTemplatesSchema` creates these, but seeding needs them now.
  db.exec(`
    CREATE TABLE legal_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'gp', body_md TEXT NOT NULL DEFAULT '',
      merge_fields TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1, is_stub INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP, updated_at TIMESTAMP, created_by INTEGER, updated_by INTEGER);
    CREATE TABLE legal_template_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL,
      slug TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
      body_md TEXT NOT NULL, merge_fields TEXT NOT NULL DEFAULT '[]', created_at TIMESTAMP,
      created_by INTEGER, UNIQUE(template_id, version));
  `);
  if (templates) {
    db.prepare(
      `INSERT INTO legal_templates (slug, title, category, body_md, version, is_active)
       VALUES ('licence_agreement','Territory licence agreement','gp',?,4,1)`,
    ).run(TEMPLATE_BODY);
    // An inactive one, which must not be offered.
    db.prepare(
      `INSERT INTO legal_templates (slug, title, category, body_md, version, is_active)
       VALUES ('retired_msa','Retired MSA','gp','x',2,0)`,
    ).run();
  }
  return db;
}

function app(db: InstanceType<typeof DatabaseSync>) {
  const env = {
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    OAUTH_CALLBACK_BASE_URL: 'https://app.axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
    DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development',
  };
  const a = new Hono<any>();
  a.route('/api/admin/licences', adminLicences);
  a.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    return c.json({ detail: msg }, 403);
  });
  return async (path: string, init: RequestInit = {}, userId: number | null = HOLDER) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId !== null) {
      const token = await new SignJWT({ user_id: userId, role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(JWT_SECRET));
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await a.request(`/api/admin/licences${path}`, { ...init, headers }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

const post = (slug: unknown) => ({ method: 'POST', body: JSON.stringify({ template_slug: slug }) } as RequestInit);

test('instantiating stores the rendered text at the template\'s current version', async () => {
  const db = seededDb();
  const call = app(db);
  const r = await call('/lic_fr/contract', post('licence_agreement'));

  assert.equal(r.status, 201);
  assert.equal(r.body.template_slug, 'licence_agreement');
  assert.equal(r.body.template_version, 4, 'the version is read from the library, never passed in');
  assert.equal(r.body.status, 'draft');
  assert.deepEqual(r.body.unfilled_fields, ['governing_law']);
  assert.match(r.body.body_md, /Axal VC France SAS/);
  assert.match(r.body.body_md, /Territory: BE, FR, LU/, 'ordered, not as inserted');
  assert.match(r.body.body_md, /EUR 90,000\.00/);
  assert.match(r.body.body_md, /35%/);
  assert.match(r.body.body_md, /\{\{governing_law\}\}/);
  assert.match(r.body.note, /pending signature does not block activation/);

  const row = db.prepare('SELECT * FROM licence_contracts').get() as any;
  assert.equal(row.licence_uid, 'lic_fr');
  assert.equal(row.template_version, 4);
  assert.equal(row.created_by_user_id, HOLDER);
  assert.equal(row.superseded_at, null);
  assert.equal(JSON.parse(row.unfilled_fields)[0], 'governing_law');

  // A contractual act lands in the append-only ledger, like every other one.
  const ev = db.prepare("SELECT * FROM licence_events WHERE event = 'contract_instantiated'").get() as any;
  assert.ok(ev, 'the instantiation is recorded');
  assert.equal(JSON.parse(ev.detail_json).template_version, 4);
});

test('a version named by the caller is ignored — an archived one is not newly issuable', async () => {
  // The rule the library runs on is that an archived version stays binding on
  // contracts that ALREADY carry it, not that it can be issued afresh. A route
  // that honoured a `template_version` in the body would let someone
  // instantiate a superseded text and have the row claim it was current.
  const db = seededDb();
  const call = app(db);
  const r = await call('/lic_fr/contract', {
    method: 'POST',
    body: JSON.stringify({ template_slug: 'licence_agreement', template_version: 1 }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.template_version, 4, 'the library\'s current version, not the caller\'s');
  assert.equal((db.prepare('SELECT template_version AS v FROM licence_contracts').get() as any).v, 4);
});

test('the stored body does NOT follow the licence, which is the whole reason it is stored', async () => {
  const db = seededDb();
  const call = app(db);
  await call('/lic_fr/contract', post('licence_agreement'));
  const before = (db.prepare('SELECT body_md FROM licence_contracts').get() as any).body_md;
  assert.match(before, /EUR 90,000\.00/);

  // Re-term the licence and re-edit the master text, the two things that
  // would rewrite a contract that re-rendered on read.
  db.prepare('UPDATE territory_licences SET annual_fee_cents = 9500000 WHERE uid = ?').run('lic_fr');
  db.prepare('UPDATE legal_templates SET body_md = ?, version = 5 WHERE slug = ?')
    .run('Entirely different text.', 'licence_agreement');

  const after = (db.prepare('SELECT body_md FROM licence_contracts').get() as any).body_md;
  assert.equal(after, before, 'the executed text is a record, not a view');
  assert.match(after, /EUR 90,000\.00/, 'still the fee that was agreed');

  // And the READ path returns the stored version number, not the library's.
  const read = await call('/lic_fr/contract');
  assert.equal(read.body.contracts[0].template_version, 4);
});

test('a re-issue supersedes the prior contract and never overwrites it', async () => {
  const db = seededDb();
  const call = app(db);
  const first = await call('/lic_fr/contract', post('licence_agreement'));
  db.prepare('UPDATE legal_templates SET version = 5 WHERE slug = ?').run('licence_agreement');
  const second = await call('/lic_fr/contract', post('licence_agreement'));

  assert.notEqual(first.body.uid, second.body.uid);
  const rows = db.prepare('SELECT uid, template_version, superseded_at FROM licence_contracts ORDER BY id')
    .all() as any[];
  assert.equal(rows.length, 2, 'both are kept');
  assert.ok(rows[0].superseded_at, 'the first is marked superseded');
  assert.equal(rows[1].superseded_at, null, 'the second is current');
  assert.equal(rows[1].template_version, 5);

  const read = await call('/lic_fr/contract');
  assert.equal(read.body.contracts.length, 2);
  assert.equal(read.body.contracts[0].uid, second.body.uid, 'newest first');
});

test('the read offers the library and the contracts together, and skips inactive templates', async () => {
  const call = app(seededDb());
  const r = await call('/lic_fr/contract');
  assert.equal(r.status, 200);
  assert.equal(r.body.contracts_available, true);
  assert.deepEqual(r.body.contracts, []);
  assert.deepEqual(r.body.templates.map((t: any) => t.slug), ['licence_agreement']);
  assert.equal(r.body.templates[0].version, 4);
  assert.equal(r.body.templates_reason, undefined);
});

test('an empty library says so rather than offering an empty picker', async () => {
  const r = await app(seededDb({ templates: false }))('/lic_fr/contract');
  assert.deepEqual(r.body.templates, []);
  assert.match(r.body.templates_reason, /no master templates/);
  assert.match(r.body.templates_reason, /Contracts/, 'and names where the library lives');
});

test('a database without migration 259 is unreadable, not a licence with no contracts', async () => {
  const db = seededDb();
  db.exec('DROP TABLE licence_contracts');
  const r = await app(db)('/lic_fr/contract');
  assert.equal(r.status, 200);
  assert.equal(r.body.contracts_available, false);
  assert.match(r.body.contracts_reason, /259/);
  assert.deepEqual(r.body.contracts, []);
});

test('an unknown template and an unknown licence are refused, and write nothing', async () => {
  const db = seededDb();
  const call = app(db);
  assert.equal((await call('/lic_fr/contract', post('nope'))).status, 404);
  assert.equal((await call('/lic_nope/contract', post('licence_agreement'))).status, 404);
  const missing = await call('/lic_fr/contract', post(''));
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /template_slug/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM licence_contracts').get()!.n, 0);
  // An inactive template is an unknown one — an archived version stays binding
  // on contracts that carry it, it is not newly issuable.
  assert.equal((await call('/lic_fr/contract', post('retired_msa'))).status, 404);
});

test('both contract routes are super-admin only', async () => {
  const db = seededDb();
  const call = app(db);
  assert.equal((await call('/lic_fr/contract', {}, PLAIN)).status, 403);
  assert.equal((await call('/lic_fr/contract', post('licence_agreement'), PLAIN)).status, 403);
  assert.equal((await call('/lic_fr/contract', {}, null)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM licence_contracts').get()!.n, 0);
});
