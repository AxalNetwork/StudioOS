/**
 * D7828 (#7828): sourced company facts — the reviewed-manifest compiler (scripts/import-company-facts.mjs),
 * its compiled fixture applied to the canonical migrated schema, and the two Companies-gated reads.
 *
 * Every company, publisher, page and person here is invented (fixtures/company_facts_7828_*).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_company_facts_7828.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router, { mount } from '../src/routes/research_company_facts.ts';
import research from '../src/routes/research.ts';
// @ts-ignore — a plain ES module script
import { ManifestError, compileManifest, contactPathRefusal, ledgerOf } from '../../scripts/import-company-facts.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const MANIFEST_PATH = join(FIX, 'company_facts_7828_manifest.json');
const COMPILED_PATH = join(FIX, 'company_facts_7828_compiled.sql');
const SCRIPT = fileURLToPath(new URL('../../scripts/import-company-facts.mjs', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const COMPILED = readFileSync(COMPILED_PATH, 'utf8');
const FRESH = (await compileManifest(MANIFEST)).sql as string;
const SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BM = 'synthetic-7828-brindlemoor';
const IDENTITY_ONLY = 'synthetic-7828-quillon';
const FOUNDER = 782801;
const INVESTOR = 782802;

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES
    (${FOUNDER},'7828-founder@example.invalid','Synthetic founder','founder',1),
    (${INVESTOR},'7828-investor@example.invalid','Synthetic investor','investor',1)`);
  for (const [uid, name] of [
    [BM, 'Brindlemoor Synthetic Routing'],
    [IDENTITY_ONLY, 'Quillon Synthetic Fieldworks'],
    ['synthetic-7828-withdrawn', 'Withdrawn Synthetic Record'],
  ])
    db.prepare(
      `INSERT INTO research_company_directory(uid,name,website,country,source_url,source_name,source_license,as_of)
       VALUES (?,?,'https://synthetic.example','Portugal','https://synthetic.example/source','Synthetic directory','Synthetic terms','2026-10-01')`,
    ).run(uid, name);
  db.exec(`INSERT INTO research_company_reviews(uid,status,reason_code,admin_note,reviewer,reviewed_on)
    VALUES ('synthetic-7828-withdrawn','withdrawn','source_withdrawn','PRIVATE_SENTINEL',1,'2026-11-01')`);
  const app = new Hono().route(mount.path, router).route('/api/research', research);
  app.onError((e, c) => c.json({ detail: e.message === 'Unauthorized' ? 'Unauthorized' : 'Unavailable' }, e.message === 'Unauthorized' ? 401 : 500));
  return { db, app, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, who: number | null, path: string) {
  const headers: Record<string, string> = {};
  if (who)
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  return f.app.request(`/api/research${path}`, { headers }, f.env);
}
const count = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM research_company_facts').get() as any).n as number;
const facts = async (f: F, uid = BM) => (await (await call(f, FOUNDER, `/company-directory/${uid}/facts`)).json()) as any;
const byKey = (body: any, key: string) =>
  [...body.facts.current, ...body.facts.superseded].find((x: any) => x.key === key);
const fact = (over: Record<string, unknown>) => ({
  company_uid: BM, key: 'x', attribute: 'product', state: 'found', value: 'Synthetic value',
  statement_type: 'company_statement', source_url: 'https://synthetic.example/page', publisher: 'Synthetic site',
  passage: 'A synthetic passage.', retrieved_at: '2026-11-02', ...over,
});
const manifest = (...rows: Record<string, unknown>[]) => ({
  name: 'refusal-7828', reviewed_by: 'Synthetic reviewer', reviewed_on: '2026-11-20', facts: rows.map(fact),
});

test('--check passes on the committed fixture, and the committed compile is what the manifest compiles to now', () => {
  assert.equal(FRESH, COMPILED);
  const r = spawnSync(process.execPath, [SCRIPT, '--manifest', MANIFEST_PATH, '--out', COMPILED_PATH, '--ledger', FIX, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /14 facts/);
  assert.doesNotMatch(readFileSync(MANIFEST_PATH, 'utf8'), /@/);
});

test('the compiled manifest fills the store, a second apply adds nothing, and unserved companies are skipped', () => {
  const f = fixture();
  try {
    f.db.exec(FRESH);
    const stored = (f.db.prepare('SELECT company_uid, fact_key FROM research_company_facts ORDER BY fact_key').all() as any[]);
    assert.ok(stored.every((r) => r.company_uid === BM));
    assert.equal(stored.length, 12);
    const snapshot = JSON.stringify(f.db.prepare('SELECT * FROM research_company_facts ORDER BY id').all());
    f.db.exec(FRESH);
    assert.equal(count(f.db), 12);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM research_company_facts ORDER BY id').all()), snapshot);
    // How skipped facts are counted after deploy: the header's facts less the rows under the manifest's name.
    const header = Number(/this header's (\d+) facts/.exec(FRESH)![1]);
    const written = (f.db.prepare(`SELECT COUNT(*) AS n FROM research_company_facts WHERE manifest_name='fixture-7828'`).get() as any).n;
    assert.equal(header - written, 2);
    assert.equal(f.db.prepare(`SELECT 1 FROM research_company_facts WHERE company_uid IN ('synthetic-7828-absent','synthetic-7828-withdrawn')`).get(), undefined);
  } finally {
    f.db.close();
  }
});

test('a fixture company returns its facts with passage, source, licence and the three dates, and never who reviewed', async () => {
  const f = fixture();
  try {
    f.db.exec(FRESH);
    const res = await call(f, FOUNDER, `/company-directory/${BM}/facts`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    const product = byKey(body, 'bm-product');
    assert.equal(product.value, 'Route planning software for regional couriers');
    assert.equal(product.source.passage, 'Brindlemoor plans delivery routes for regional courier fleets.');
    assert.equal(product.source.url, 'https://brindlemoor.example/product');
    assert.equal(product.source.publisher, 'Brindlemoor website');
    assert.deepEqual([product.published_at, product.retrieved_at, product.reviewed_at], ['2026-09-01', '2026-11-02', '2026-11-20']);
    assert.equal(product.checked_label, 'Checked by Axal on 2026-11-20');
    assert.equal(product.statement_type_label, 'Company statement');
    assert.equal(product.source.licence, null);
    assert.equal(product.source.licence_state, 'licence terms not reviewed');
    const indexed = byKey(body, 'bm-product-index');
    assert.equal(indexed.statement_type_label, 'Third-party observation');
    assert.equal(indexed.source.field, 'P1056 product or material produced');
    assert.equal(indexed.source.licence.id, 'CC0-1.0');
    assert.equal(byKey(body, 'bm-markets').market_country, 'PT');
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /Synthetic reviewer|reviewed_by|manifest_name/);
  } finally {
    f.db.close();
  }
});

test("the four absence states and 'no row' stay five distinct answers", async () => {
  const f = fixture();
  try {
    f.db.exec(FRESH);
    const body = await facts(f);
    const answer = (attribute: string) => body.attributes.find((a: any) => a.attribute === attribute);
    const got = ['partner_programme', 'integration_listing', 'contact_path', 'delivery_model', 'capability'].map((a) => answer(a).state);
    assert.deepEqual(got, ['not_found', 'not_offered', 'source_unavailable', 'outdated', 'not_recorded']);
    assert.equal(new Set(got).size, 5);
    assert.equal(answer('capability').reason, 'Needs research');
    for (const key of ['bm-partners', 'bm-integrations', 'bm-contact']) {
      const absence = byKey(body, key);
      assert.equal(absence.value, null);
      assert.equal(absence.source.passage, null);
      assert.match(absence.source.url, /^https:\/\/brindlemoor\.example\//);
      assert.equal(absence.retrieved_at, '2026-11-02');
    }
    assert.equal(answer('product').state, 'found');
  } finally {
    f.db.close();
  }
});

test('two conflicting facts are both returned and each is marked; a corrected fact is outdated with a link to its replacement', async () => {
  const f = fixture();
  try {
    f.db.exec(FRESH);
    const body = await facts(f);
    assert.deepEqual(byKey(body, 'bm-segment-small').conflicts_with, ['bm-segment-enterprise']);
    assert.deepEqual(byKey(body, 'bm-segment-enterprise').conflicts_with, ['bm-segment-small']);
    assert.ok(body.facts.current.some((x: any) => x.key === 'bm-segment-small'));
    assert.ok(body.facts.current.some((x: any) => x.key === 'bm-segment-enterprise'));
    const old = byKey(body, 'bm-pricing-1');
    assert.equal(old.state, 'outdated');
    assert.equal(old.replaced_by, 'bm-pricing-2');
    assert.equal(old.value, 'Per-seat subscription');
    assert.ok(body.facts.superseded.some((x: any) => x.key === 'bm-pricing-1'));
    const now = byKey(body, 'bm-pricing-2');
    assert.equal(now.state, 'found');
    assert.equal(now.replaces, 'bm-pricing-1');
    assert.ok(body.facts.current.some((x: any) => x.key === 'bm-pricing-2'));
  } finally {
    f.db.close();
  }
});

function numbersIn(value: unknown, path = '$'): string[] {
  if (typeof value === 'number') return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => numbersIn(v, `${path}.${k}`));
  return [];
}

test("completeness for an identity-only record: lookup supported, Needs research, not assessed, and no number", async () => {
  const f = fixture();
  try {
    f.db.exec(FRESH);
    const res = await call(f, FOUNDER, `/company-directory/${IDENTITY_ONLY}/completeness`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.jobs.lookup.status, 'supported');
    assert.ok(body.jobs.lookup.fields.every((x: any) => x.status === 'supported' && x.evidence.length));
    for (const job of ['competitor_research', 'partner_discovery']) {
      assert.equal(body.jobs[job].status, 'needs_research', job);
      for (const field of body.jobs[job].fields) {
        assert.equal(field.status, 'not_recorded');
        assert.equal(field.reason, 'Needs research');
      }
    }
    assert.equal(body.jobs.investment_firm_discovery.status_label, 'Not assessed in this read');
    assert.match(body.jobs.investment_firm_discovery.reason, /organisations.*#7743.*#7748.*#7749/);
    assert.deepEqual(numbersIn(body), []);
    const full: any = await (await call(f, FOUNDER, `/company-directory/${BM}/completeness`)).json();
    assert.equal(full.jobs.competitor_research.status, 'supported');
    assert.equal(full.jobs.partner_discovery.status, 'needs_research');
    const path = full.jobs.partner_discovery.fields.find((x: any) => x.field === 'partner_path');
    assert.equal(path.status, 'not_recorded');
    assert.deepEqual(path.checked.map((c: any) => c.state).sort(), ['not_found', 'not_offered', 'source_unavailable']);
    assert.deepEqual(numbersIn(full), []);
    assert.doesNotMatch(JSON.stringify(full), /Synthetic reviewer|reviewed_by/);
  } finally {
    f.db.close();
  }
});

test("an account the Companies rule refuses gets the profile's refusal on both reads; an unserved record returns no facts", async () => {
  const f = fixture();
  try {
    f.db.exec(FRESH);
    const profile = await call(f, INVESTOR, `/company-directory/${BM}`);
    assert.equal(profile.status, 403);
    const refusal = await profile.json();
    for (const path of ['facts', 'completeness']) {
      assert.equal((await call(f, null, `/company-directory/${BM}/${path}`)).status, 401);
      const res = await call(f, INVESTOR, `/company-directory/${BM}/${path}`);
      assert.equal(res.status, 403, path);
      assert.deepEqual(await res.json(), refusal);
      for (const uid of ['synthetic-7828-withdrawn', 'synthetic-7828-absent']) {
        const r = await call(f, FOUNDER, `/company-directory/${uid}/${path}`);
        assert.equal(r.status, 404, `${uid} ${path}`);
        assert.doesNotMatch(await r.text(), /A product of|PRIVATE_SENTINEL/);
      }
    }
    // Facts stored before a record was withdrawn are not served after it.
    f.db.exec(`INSERT INTO research_company_reviews(uid,status,reason_code,reviewer,reviewed_on) VALUES ('${BM}','withdrawn','source_withdrawn',1,'2026-11-21')`);
    assert.equal((await call(f, FOUNDER, `/company-directory/${BM}/facts`)).status, 404);
  } finally {
    f.db.close();
  }
});

test('a failed read is a 503, never an empty list', async () => {
  const f = fixture();
  try {
    f.db.exec('DROP TABLE research_company_facts');
    for (const path of ['facts', 'completeness']) {
      const res = await call(f, FOUNDER, `/company-directory/${BM}/${path}`);
      assert.equal(res.status, 503);
      const body: any = await res.json();
      assert.equal(body.error, 'company_facts_unreadable');
      assert.equal(body.facts, undefined);
      assert.equal(body.jobs, undefined);
    }
  } finally {
    f.db.close();
  }
});

test('each compile-time refusal has its code and writes no migration', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['source_missing', { source_url: undefined }],
    ['source_missing', { publisher: '' }],
    ['attribute_unknown', { attribute: 'sector' }],
    ['state_unknown', { state: 'not_recorded' }],
    ['contact_path_not_page_link', { attribute: 'contact_path', value: 'the contact form' }],
    ['contact_path_not_page_link', { attribute: 'contact_path', value: 'http://synthetic.example/apply' }],
    ['contact_path_person_name', { attribute: 'contact_path', value: 'Jane Synthetic' }],
    ['contact_path_person_name', { attribute: 'contact_path', value: 'https://www.linkedin.com/in/synthetic-person' }],
    ['contact_path_email', { attribute: 'contact_path', value: 'partners@synthetic.example' }],
    ['contact_path_email', { attribute: 'contact_path', value: 'mailto:partners' }],
    ['contact_path_phone', { attribute: 'contact_path', value: '+44 20 7946 0000' }],
    ['pricing_model_amount', { attribute: 'pricing_model', value: 'From €49 a month' }],
    ['pricing_model_amount', { attribute: 'pricing_model', value: '20 USD per seat' }],
    ['pricing_model_amount', { attribute: 'pricing_model', value: 'Subscription, 15/month' }],
    ['found_without_value', { value: null }],
    ['found_without_passage', { passage: null }],
    ['absence_with_value', { state: 'not_found' }],
    ['value_email', { passage: 'Write to sales@synthetic.example' }],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'company-facts-7828-'));
  try {
    for (const [code, over] of cases) {
      const m = manifest(fact({ key: 'ok-first' }), fact({ key: 'refused', ...over }));
      await assert.rejects(compileManifest(m), (e: any) => e instanceof ManifestError && e.code === code, `${code} ${JSON.stringify(over)}`);
      const path = join(dir, `${code}.json`);
      const out = join(dir, `${code}.sql`);
      writeFileSync(path, JSON.stringify(m));
      const r = spawnSync(process.execPath, [SCRIPT, '--manifest', path, '--out', out, '--ledger', dir], { encoding: 'utf8' });
      assert.equal(r.status, 1, code);
      assert.match(r.stderr, new RegExp(code));
      assert.equal(existsSync(out), false, `${code} wrote no migration`);
      assert.doesNotMatch(r.stderr, /Jane|partners@|7946|€49/);
    }
    // Accepted shapes, so the refusals above are not refusing everything.
    assert.equal(contactPathRefusal('https://synthetic.example/partners/apply'), null);
    const ok = await compileManifest(manifest(
      fact({ key: 'a', attribute: 'contact_path', value: 'https://synthetic.example/partners/apply' }),
      fact({ key: 'b', attribute: 'pricing_model', value: 'Per-seat subscription with three tiers' }),
      fact({ key: 'c', state: 'not_offered', value: null, passage: null }),
    ));
    assert.equal(ok.counts.facts, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a key keeps its value across compiles, and links must name a known fact of the same company', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-facts-7828-ledger-'));
  try {
    writeFileSync(join(dir, '202611232100_7828_fixture.sql'), COMPILED);
    const ledger = ledgerOf(dir);
    assert.equal(ledger.size, 14);
    const first = MANIFEST.facts[0];
    await compileManifest({ ...MANIFEST, name: 'replay-7828', facts: [first] }, { ledger });
    await assert.rejects(
      compileManifest({ ...MANIFEST, name: 'edit-7828', facts: [{ ...first, value: 'Edited value' }] }, { ledger }),
      (e: any) => e.code === 'changed_value_same_key',
    );
    await assert.rejects(compileManifest(manifest(fact({ key: 'n', replaces: 'nowhere' }))), (e: any) => e.code === 'replaces_unknown');
    await assert.rejects(compileManifest(manifest(fact({ key: 'n', conflicts_with: 'nowhere' }))), (e: any) => e.code === 'conflict_unknown');
    await assert.rejects(
      compileManifest(manifest(fact({ key: 'a' }), fact({ key: 'b', attribute: 'buyer', replaces: 'a' }))),
      (e: any) => e.code === 'replaces_other_attribute',
    );
    await assert.rejects(
      compileManifest({ ...manifest(fact({ key: 'a' })), reviewed_by: 'reviewer@synthetic.example' }),
      (e: any) => e.code === 'value_email',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
