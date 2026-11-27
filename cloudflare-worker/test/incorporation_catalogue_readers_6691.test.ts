/**
 * D6691 (#6691, plan key E8 of #6680) — the incorporation readers read the
 * formation catalogue, behind parity tests.
 *
 * The real legal router and the name check run over node:sqlite with the full
 * migrated schema, so catalogue version 1 (the D6690 seed) is present as every
 * database has it. What is pinned:
 *   - parity: `GET /legal/jurisdictions`, the admin wizard's handoff and the
 *     name check's adapter answer exactly the frozen fixtures under
 *     `fixtures/incorporation_readers_6691/`, recorded from main d26a93a252
 *     before the change, and log no fallback;
 *   - with the catalogue tables empty, or missing, each reader answers the
 *     same fixture from the frozen arrays and logs the fallback;
 *   - the readers really read the catalogue: a version 2 that relabels a form,
 *     changes a step, moves a form to another register and drops the legacy
 *     gate of another is what HQ serves; a branch studio still serves
 *     version 1 (owner decision 8).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/incorporation_catalogue_readers_6691.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import legal, { HANDOFF_NEXT_STEPS, JURISDICTIONS } from '../src/routes/legal.ts';
import { checkCompanyName, registryFor } from '../src/services/nameCheck.ts';
import { FALLBACK_EVENT, catalogueHandoffSteps, catalogueJurisdictions } from '../src/services/formationCatalogueReaders.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const FIX = resolve(process.cwd(), 'cloudflare-worker/test/fixtures/incorporation_readers_6691');
const frozen = (name: string) => JSON.parse(readFileSync(resolve(FIX, name), 'utf8'));
const JURISDICTIONS_FIXTURE = frozen('jurisdictions.json');
const HANDOFF_FIXTURE = frozen('wizard_handoff.json');
const NAME_CHECK_FIXTURE = frozen('name_check.json');
const IDS = Object.keys(HANDOFF_FIXTURE);
const NOW = () => new Date('2026-11-27T00:00:00Z');
const SEED_STAMP = 202611161600;

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, FOUNDER = 10;

/** A database on the full migrated schema (catalogue version 1 seeded), or as it stood before the seed. */
function fixture({ beforeSeed = false } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db, beforeSeed ? { below: SEED_STAMP } : {});
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Synthetic Admin', 'admin@example.invalid', null);
  u.run(FOUNDER, 'founder', 'Synthetic Founder', 'founder@example.invalid', 1001);
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Synthetic Venture', 1001)");
  return db;
}

/** A database with no catalogue tables at all: every catalogue read throws. */
function noCatalogue() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER, founder_id INTEGER)');
  db.exec(`INSERT INTO users VALUES (${FOUNDER}, 'founder', 'Synthetic Founder', 'founder@example.invalid', 1, 1001)`);
  return db;
}

const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } }; };
const envOf = (db: any, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: kv(), ...extra } as any);

const app = new Hono<any>();
app.route('/legal', legal);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

/** Runs `fn` with the console captured; returns its result and the fallback lines logged. */
async function logged<T>(fn: () => Promise<T>): Promise<{ value: T; fallbacks: any[] }> {
  const w = console.warn, e = console.error, l = console.log;
  const fallbacks: any[] = [];
  console.warn = (...a: unknown[]) => {
    try { const o = JSON.parse(String(a[0])); if (o?.event === FALLBACK_EVENT) fallbacks.push(o); } catch { /* not a fallback line */ }
  };
  console.error = () => {}; console.log = () => {};
  try { return { value: await fn(), fallbacks }; } finally { console.warn = w; console.error = e; console.log = l; }
}

/** What the name check answers for one id with no register keys: the adapter it chose shows in its reason. */
async function nameCheckOutcome(env: any, id: string) {
  const r = await checkCompanyName(env, id, 'Acme Robotics', { now: NOW });
  return { registry: await registryFor(env, id), status: r.status, reason: r.reason ?? null, source: r.source };
}

async function readAll(env: any) {
  const jurisdictions = await call(env, FOUNDER, 'GET', '/legal/jurisdictions');
  assert.equal(jurisdictions.status, 200, JSON.stringify(jurisdictions.body));
  const handoff: Record<string, unknown> = {};
  const nameCheck: Record<string, unknown> = {};
  for (const id of IDS) {
    handoff[id] = { type: 'documents_only', next_steps: await catalogueHandoffSteps(env, id, HANDOFF_NEXT_STEPS) };
    nameCheck[id] = await nameCheckOutcome(env, id);
  }
  return { jurisdictions: jurisdictions.body, handoff, nameCheck };
}

// Mutation checked: `catalogueJurisdictions` returning a form's templates out of order, or dropping a display field
// (fails the jurisdictions parity); the handoff reading `before_filing` items (fails); PLACE_REGISTRY mapping US-WY to
// 'de' (fails the name-check parity).
test('parity: on catalogue version 1 each reader answers its frozen fixture and logs no fallback', async () => {
  const db = fixture();
  const { value, fallbacks } = await logged(() => readAll(envOf(db)));
  assert.deepEqual(value.jurisdictions, JURISDICTIONS_FIXTURE);
  assert.deepEqual(value.handoff, HANDOFF_FIXTURE);
  assert.deepEqual(value.nameCheck, NAME_CHECK_FIXTURE);
  assert.deepEqual(fallbacks, [], 'a reader fell back on a seeded catalogue');
});

// Mutation checked: the wizard reading HANDOFF_NEXT_STEPS again (passes this case, fails the version 2 case below).
test('parity: the admin wizard\'s handoff, through the router, is the fixture for every form', async () => {
  const db = fixture();
  const env = envOf(db);
  const { value, fallbacks } = await logged(async () => {
    const out: Record<string, unknown> = {};
    for (const id of IDS) {
      const r = await call(env, ADMIN, 'POST', '/legal/incorporate/wizard', { project_id: 1, jurisdiction_id: id, company_name: 'Synthetic Co' });
      assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.body)}`);
      out[id] = r.body.handoff;
    }
    return out;
  });
  assert.deepEqual(value, HANDOFF_FIXTURE);
  assert.deepEqual(fallbacks, []);
});

// Mutation checked: the fallback not logged (fails: no lines); falling back to an empty list instead of the frozen
// arrays (fails the parity).
test('with the catalogue tables empty, each reader answers from the frozen arrays and logs it', async () => {
  const db = fixture({ beforeSeed: true });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM formation_catalogue_versions').get() as any).n, 0);
  const { value, fallbacks } = await logged(() => readAll(envOf(db)));
  assert.deepEqual(value.jurisdictions, JURISDICTIONS_FIXTURE);
  assert.deepEqual(value.handoff, HANDOFF_FIXTURE);
  assert.deepEqual(value.nameCheck, NAME_CHECK_FIXTURE);
  assert.deepEqual(new Set(fallbacks.map((f) => `${f.reader}:${f.reason}`)),
    new Set(['jurisdictions:no_version', 'wizard_handoff:no_version', 'name_check:no_version']));
  assert.equal(fallbacks.filter((f) => f.reader === 'wizard_handoff').length, IDS.length, 'one line per fallback hit');
});

// Mutation checked: removing the try/catch in a reader (fails: the read throws).
test('with no catalogue tables at all, each reader answers from the frozen arrays and logs read_failed', async () => {
  const env = envOf(noCatalogue());
  const { value, fallbacks } = await logged(async () => ({
    jurisdictions: await catalogueJurisdictions(env, JURISDICTIONS),
    steps: await catalogueHandoffSteps(env, 'uk_ltd', HANDOFF_NEXT_STEPS),
    nameCheck: await nameCheckOutcome(env, 'sg_pte'),
  }));
  assert.deepEqual({ jurisdictions: value.jurisdictions }, JURISDICTIONS_FIXTURE);
  assert.deepEqual(value.steps, HANDOFF_FIXTURE.uk_ltd.next_steps);
  assert.deepEqual(value.nameCheck, NAME_CHECK_FIXTURE.sg_pte);
  assert.ok(fallbacks.length >= 3 && fallbacks.every((f) => f.reason === 'read_failed'), JSON.stringify(fallbacks));
});

/**
 * Version 2: a copy of version 1 with four changes, published and made current.
 *   us_wy_ccorp   relabelled "Wyoming C-Corp (v2)"
 *   uk_ltd        its first next step retitled
 *   us_de_llc     registered in US-WY, so the Wyoming register is asked
 *   ee_oy         no legacy gate, so the legacy list leaves it out
 * plus a form `zz_new` the frozen ids do not know, which the legacy list also leaves out.
 */
function publishVersion2(db: DatabaseSync) {
  db.exec("INSERT INTO formation_catalogue_versions (version, status) VALUES (2, 'draft')");
  const v1 = (db.prepare('SELECT id FROM formation_catalogue_versions WHERE version = 1').get() as any).id;
  const v2 = (db.prepare('SELECT id FROM formation_catalogue_versions WHERE version = 2').get() as any).id;
  db.prepare(`INSERT INTO formation_jurisdictions (version_id, country, subdivision, registry_name, vocabulary_json)
    SELECT ?, country, subdivision, registry_name, vocabulary_json FROM formation_jurisdictions WHERE version_id = ? ORDER BY id`).run(v2, v1);
  db.prepare(`INSERT INTO formation_entity_forms (version_id, jurisdiction_id, form_key, label, offer_mode, legal_form_family, legacy_gate, legacy_display_json, allow_axal_collection)
    SELECT ?, (SELECT j2.id FROM formation_jurisdictions j2 JOIN formation_jurisdictions j1 ON j1.id = f.jurisdiction_id
                WHERE j2.version_id = ? AND j2.country = j1.country AND COALESCE(j2.subdivision, '') = COALESCE(j1.subdivision, '')),
           form_key, label, offer_mode, legal_form_family, legacy_gate, legacy_display_json, allow_axal_collection
      FROM formation_entity_forms f WHERE version_id = ? ORDER BY id`).run(v2, v2, v1);
  db.prepare(`INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, template_key, counsel_required, position)
    SELECT ?, (SELECT f2.id FROM formation_entity_forms f2 JOIN formation_entity_forms f1 ON f1.id = p.form_id WHERE f2.version_id = ? AND f2.form_key = f1.form_key),
           item_key, phase, kind, acting_party, title, template_key, counsel_required, position
      FROM formation_pack_items p WHERE version_id = ? ORDER BY id`).run(v2, v2, v1);
  const wy = (db.prepare("SELECT id FROM formation_jurisdictions WHERE version_id = ? AND country = 'US' AND subdivision = 'WY'").get(v2) as any).id;
  db.prepare("UPDATE formation_entity_forms SET label = 'Wyoming C-Corp (v2)' WHERE version_id = ? AND form_key = 'us_wy_ccorp'").run(v2);
  db.prepare("UPDATE formation_entity_forms SET jurisdiction_id = ? WHERE version_id = ? AND form_key = 'us_de_llc'").run(wy, v2);
  db.prepare("UPDATE formation_entity_forms SET legacy_gate = NULL WHERE version_id = ? AND form_key = 'ee_oy'").run(v2);
  db.prepare(`UPDATE formation_pack_items SET title = 'File IN01 on Companies House (version 2 wording)'
    WHERE version_id = ? AND item_key = 'next_step_1' AND form_id = (SELECT id FROM formation_entity_forms WHERE version_id = ? AND form_key = 'uk_ltd')`).run(v2, v2);
  db.prepare(`INSERT INTO formation_entity_forms (version_id, jurisdiction_id, form_key, label, offer_mode, legacy_gate, legacy_display_json)
    VALUES (?, ?, 'zz_new', 'A form the legacy path does not know', 'off', '1', '{}')`).run(v2, wy);
  db.prepare("UPDATE formation_catalogue_versions SET status = 'published', published_by = ?, published_at = '2026-11-27T00:00:00Z' WHERE id = ?").run(ADMIN, v2);
  db.prepare('UPDATE formation_catalogue_versions SET is_current = 0 WHERE id = ?').run(v1);
  db.prepare('UPDATE formation_catalogue_versions SET is_current = 1 WHERE id = ?').run(v2);
}

// Mutation checked: `readerVersion` serving version 1 on HQ (fails: HQ shows no v2 change); dropping the legacy-gate
// filter (fails: ee_oy listed); dropping the known-id filter (fails: zz_new listed); nameCheck keyed on the form id
// again (fails: us_de_llc still asks Delaware); the wizard reading HANDOFF_NEXT_STEPS (fails: uk_ltd's step).
test('the readers read the catalogue: HQ serves the current version 2, a branch studio serves version 1', async () => {
  const db = fixture();
  publishVersion2(db);

  const hq = await logged(async () => ({
    all: await readAll(envOf(db)),
    wizard: await call(envOf(db), ADMIN, 'POST', '/legal/incorporate/wizard', { project_id: 1, jurisdiction_id: 'uk_ltd', company_name: 'Synthetic Co' }),
  }));
  assert.deepEqual(hq.fallbacks, []);
  const listed = hq.value.all.jurisdictions.jurisdictions;
  assert.deepEqual(listed.map((j: any) => j.id), ['us_de_ccorp', 'us_wy_ccorp', 'us_de_llc', 'uk_ltd', 'sg_pte']);
  assert.equal(listed.find((j: any) => j.id === 'us_wy_ccorp').label, 'Wyoming C-Corp (v2)');
  assert.deepEqual(listed.find((j: any) => j.id === 'us_de_ccorp'), JURISDICTIONS_FIXTURE.jurisdictions[0], 'an unchanged form changed');
  assert.equal((hq.value.all.handoff.uk_ltd as any).next_steps[0], 'File IN01 on Companies House (version 2 wording)');
  assert.equal(hq.value.wizard.body.handoff.next_steps[0], 'File IN01 on Companies House (version 2 wording)');
  assert.deepEqual(hq.value.all.nameCheck.us_de_llc, NAME_CHECK_FIXTURE.us_wy_ccorp, 'us_de_llc did not ask the Wyoming register');

  const branch = await logged(() => readAll(envOf(db, { BRANCH_CODE: 'synthetic' })));
  assert.deepEqual(branch.fallbacks, []);
  assert.deepEqual(branch.value.jurisdictions, JURISDICTIONS_FIXTURE);
  assert.deepEqual(branch.value.handoff, HANDOFF_FIXTURE);
  assert.deepEqual(branch.value.nameCheck, NAME_CHECK_FIXTURE);
});

// Mutation checked: `readerVersion` accepting a draft version 1 on a branch (fails: no fallback logged).
test('a branch whose version 1 is not published falls back, logged', async () => {
  const db = fixture({ beforeSeed: true });
  db.exec("INSERT INTO formation_catalogue_versions (version, status) VALUES (1, 'draft')");
  const { value, fallbacks } = await logged(() => catalogueJurisdictions(envOf(db, { BRANCH_CODE: 'synthetic' }), JURISDICTIONS));
  assert.deepEqual({ jurisdictions: value }, JURISDICTIONS_FIXTURE);
  assert.deepEqual(fallbacks, [{ event: FALLBACK_EVENT, reader: 'jurisdictions', reason: 'no_version' }]);
});
