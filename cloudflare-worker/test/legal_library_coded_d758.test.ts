// D758 (#1861) — every library document renders from a coded template.
//
// Migration 484 fills every active catalog row that has no text from its file
// under `src/templates/legal/` (D706's 25 production stubs, and nothing that
// already has text), as a new version with the empty one kept in history, and
// adds the Operating Partner Agreement (Spin-Out Lab) as a counsel stub. The
// 24 bodies that lived only inside migration 085 become `<slug>_v1.md` files,
// byte for byte.
//
// The expected slug-to-file map is read out of the generator, so the test and
// the migration cannot disagree on which file fills which row.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { extractMergeFields } from '../src/services/legalTemplateStore.ts';
import { COUNSEL_DRAFT_SLUGS, derivedFormat, validateFormat } from '../src/services/templateFormat.ts';
import { templateBodyFor } from '../src/routes/esign.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const SQL = resolve(ROOT, 'cloudflare-worker/sql');
const MIG = resolve(SQL, 'migrations');
const TPL = resolve(ROOT, 'cloudflare-worker/src/templates/legal');
const GEN = readFileSync(resolve(ROOT, 'scripts/gen-legal-templates-seed.py'), 'utf8');
const OLD = 'Axal VC Fund I, LP';
const NEW = 'Axal VC Spin-Out Lab Fund I LP';
const NEW_SLUG = 'operating_partner_agreement_spin_out_lab';

const baseline = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const migration = (prefix: string) => {
  const name = readdirSync(MIG).find((f) => f.startsWith(`${prefix}_`));
  assert.ok(name, `migration ${prefix}`);
  return readFileSync(resolve(MIG, name), 'utf8');
};
const M484 = migration('484');
const file = (f: string) => readFileSync(resolve(TPL, f), 'utf8');

/** One list of the generator: its `(slug, file, title, category)` tuples, in order. */
function genList(name: string): Array<[string, string]> {
  const start = GEN.indexOf(`\n${name} = [`);
  assert.ok(start >= 0, `${name} in the generator`);
  const block = GEN.slice(start, GEN.indexOf('\n]', start));
  return [...block.matchAll(/^\s*\("([^"]+)",\s*"([^"]+\.md)"/gm)].map((m) => [m[1], m[2]]);
}
const SEED = genList('SEED_SKELETON_V1');
/** all_md_bodies(): FULL_BODY_V1, then NEW_BODY_V1, then ESIGN_MD, first wins; then the seed skeletons. */
const MAP = new Map<string, string>();
for (const [slug, f] of [...genList('FULL_BODY_V1'), ...genList('NEW_BODY_V1'), ...genList('ESIGN_MD')]) if (!MAP.has(slug)) MAP.set(slug, f);
const MD_BACKED = new Set(MAP.keys());
for (const [slug, f] of SEED) MAP.set(slug, f);
const expected = (slug: string) => file(MAP.get(slug)!).split(OLD).join(NEW);

/** D706's 25 production stubs (D706.md, the table). */
const D706_25 = [
  'data_access_acknowledgment_admin', 'Co-Investment Side Letter', 'SPV Joinder Agreement', 'Strategic Side Letter / Focused SPV',
  'Subscription Booklet & LPA', 'investor_subscription_inst', 'investor_subscription_pro', 'Engagement Letter (Spin-Out Package)',
  'MSA + Equity-for-Services', 'Venture Share Agreement (FAST)', 'White-Label Service Agreement', 'finders_fee_intro_agreement',
  'partner_capital', 'partner_custom', 'partner_equity', 'partner_nda_nonsolicit', 'partner_revshare', 'Founder Collaboration Agreement',
  'M&A Advisory Mandate', 'Referral / Agency Agreement', 'Secondary Purchase Agreement', 'Spin-Out Subsidiary SPA + IP Transfer',
  'Strategic Scale Partnership Agreement', 'Technology Integration / JV Agreement', 'ip_background_schedule',
];

/** The repo's catalog: the production table shapes, then 085, 105, 113, 434, 468, 469, 471, 478's catalog inserts and 479. */
function fixture(with484 = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'activity_logs', 'legal_templates', 'legal_template_versions', 'esign_envelopes',
    'esign_recipients', 'documents', 'projects', 'founders', 'deals', 'pairwise_ndas', 'partner_deals']) {
    db.exec(tableFromBaseline(baseline, t));
  }
  for (const f of ['085', '105', '113', '434', '468', '469', '471']) db.exec(migration(f));
  for (const s of migration('478').match(/INSERT OR IGNORE INTO legal_templates[\s\S]*?;/g) ?? []) db.exec(s);
  db.exec(migration('479'));
  if (with484) db.exec(M484);
  return db;
}
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM legal_templates ORDER BY id').all() as any[];
const history = (db: DatabaseSync) => db.prepare('SELECT * FROM legal_template_versions ORDER BY id').all() as any[];
const bySlug = (db: DatabaseSync) => new Map(rows(db).map((r) => [r.slug, r]));

/** Production's shape: every file-backed row emptied, as D706's 25 are in production. */
function emptied() {
  const db = fixture(false);
  const empty = db.prepare("UPDATE legal_templates SET body_md = '', merge_fields = '[]', is_stub = 1 WHERE slug = ?");
  for (const slug of MAP.keys()) assert.equal(Number(empty.run(slug).changes), 1, slug);
  return db;
}

test('D758 the generator map: 42 .md-backed slugs and 24 seed skeletons, 66 in all', () => {
  assert.equal(MD_BACKED.size, 42);
  assert.equal(SEED.length, 24);
  assert.equal(MAP.size, 66);
  for (const [slug] of SEED) assert.equal(MD_BACKED.has(slug), false, `${slug} is not in all_md_bodies()`);
});

test("D758 the repo's catalog: 98 rows, every one outside the counsel stubs holds its file's text", () => {
  const db = fixture();
  const all = rows(db);
  assert.equal(all.length, 98);
  for (const r of all) {
    if (COUNSEL_DRAFT_SLUGS.has(r.slug)) continue;
    assert.ok(MAP.has(r.slug), `${r.slug} has a file`);
    assert.equal(Number(r.is_stub), 0, r.slug);
    if (r.slug === 'privacy_v1') {
      // The one named drift: the replay holds 113's text, which predates the
      // company address in privacy_v1.md (#296); production holds privacy_v2.md.
      assert.equal(r.body_md, file('privacy_v2.md').replace(', 16192 Coastal Hwy, Lewes, DE 19958, United States', ''));
      continue;
    }
    assert.equal(r.body_md, expected(r.slug), `${r.slug} is its file`);
  }
});

test('D758 the body-less rows are exactly COUNSEL_DRAFT_SLUGS: 32 stubs', () => {
  const db = fixture();
  const empty = rows(db).filter((r) => r.body_md.trim() === '');
  assert.equal(COUNSEL_DRAFT_SLUGS.size, 32);
  assert.deepEqual(empty.map((r) => r.slug).sort(), [...COUNSEL_DRAFT_SLUGS].sort());
  for (const r of empty) assert.equal(Number(r.is_stub), 1, r.slug);
});

test('D758 every row passes validateFormat; the Operating Partner Agreement is a management agreement stub', () => {
  const db = fixture();
  for (const r of rows(db)) assert.doesNotThrow(() => validateFormat(r.doc_kind, r.axal_party, r.slug, r.category), r.slug);
  const op = bySlug(db).get(NEW_SLUG);
  assert.deepEqual(derivedFormat(NEW_SLUG, op.category), { kind: 'agreement', party: 'management' });
  assert.equal(op.title, 'Operating Partner Agreement (Spin-Out Lab)');
  assert.equal(op.category, 'gp');
  assert.deepEqual([op.version, op.is_active, op.is_stub, op.body_md, op.merge_fields, op.doc_kind, op.axal_party], [1, 1, 1, '', '[]', null, null]);
  assert.equal(history(db).some((h) => h.slug === NEW_SLUG), false);
});

test("D758 production's shape: each empty row takes its file at a new version, with the empty one in history", () => {
  const db = emptied();
  db.exec("UPDATE legal_templates SET doc_kind = 'agreement', axal_party = 'gp', updated_by = 7 WHERE slug = 'ppm'");
  const before = bySlug(db);
  const histBefore = history(db).length;
  db.exec(M484);
  const after = bySlug(db);
  const hist = history(db);
  assert.equal(hist.length, histBefore + 66);
  for (const slug of MAP.keys()) {
    const b = before.get(slug); const a = after.get(slug);
    assert.equal(a.version, b.version + 1, `${slug} version`);
    assert.equal(Number(a.is_stub), 0, slug);
    assert.equal(a.body_md, expected(slug), `${slug} body`);
    assert.deepEqual(JSON.parse(a.merge_fields), extractMergeFields(a.body_md), `${slug} merge_fields`);
    for (const k of ['title', 'category', 'doc_kind', 'axal_party', 'updated_by', 'is_active']) assert.equal(a[k], b[k], `${slug} ${k}`);
    const h = hist.filter((x) => x.template_id === b.id && x.version === b.version);
    assert.equal(h.length, 1, `${slug} one history row at version ${b.version}`);
    assert.deepEqual([h[0].body_md, h[0].merge_fields, h[0].title, h[0].category, h[0].created_by, h[0].doc_kind, h[0].axal_party],
      ['', '[]', b.title, b.category, b.updated_by, b.doc_kind, b.axal_party], `${slug} history`);
  }
  for (const slug of ['partner_capital', 'investor_subscription_inst']) {
    assert.ok(after.get(slug).body_md.includes(NEW), `${slug} prints the legal name`);
    assert.equal(after.get(slug).body_md.includes(OLD), false, `${slug} does not print the old name`);
  }
  // Every one of D706's 25 is among them.
  for (const slug of D706_25) assert.ok(MAP.has(slug), slug);
});

test('D758 what a send reads: the store text after 484, nothing before it', async () => {
  const db = emptied();
  const env = { DB: d1Over(db) } as any;
  for (const slug of ['partner_capital', 'SPV Joinder Agreement']) assert.equal(await templateBodyFor(env, slug), null, `${slug} before 484`);
  db.exec(M484);
  for (const slug of ['partner_capital', 'SPV Joinder Agreement']) {
    const title = (db.prepare('SELECT title FROM legal_templates WHERE slug = ?').get(slug) as any).title;
    assert.deepEqual(await templateBodyFor(env, slug), { body: expected(slug), source: 'store', title }, `${slug} after 484`);
  }
});

test('D758 run twice: a second 484 changes no row and no history', () => {
  const db = emptied();
  db.exec(M484);
  const once = [rows(db), history(db)];
  db.exec(M484);
  assert.deepEqual([rows(db), history(db)], once);
});

test('D758 never over text: an admin body, a soft-deleted row and an admin Operating Partner row are left alone', () => {
  const db = emptied();
  db.exec("UPDATE legal_templates SET body_md = 'Counsel''s own text.', merge_fields = '[]', is_stub = 0, version = 3 WHERE slug = 'partner_equity'");
  db.exec("UPDATE legal_templates SET is_active = 0 WHERE slug = 'partner_custom'");
  db.exec(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES ('${NEW_SLUG}', 'Admin title', 'gp', 'An admin body.', '[]', 2, 1, 0)`);
  const before = bySlug(db);
  db.exec(M484);
  const after = bySlug(db);
  for (const slug of ['partner_equity', 'partner_custom', NEW_SLUG]) {
    assert.deepEqual(after.get(slug), before.get(slug), `${slug} untouched`);
    assert.equal(history(db).some((h) => h.slug === slug), false, `${slug} no new history`);
  }
  assert.equal(rows(db).filter((r) => r.slug === NEW_SLUG).length, 1);
});

test('D758 a fresh build: 484 applies over the baseline and later migrations, adds the stub once and changes no other row', () => {
  const files = readdirSync(MIG).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations)
    .filter((f) => migrationNumber(f) > BASELINE_CUTOFF);
  assert.ok(files.includes('484_library_coded_templates.sql'));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(baseline);
  for (const f of files) { if (f >= '484_') break; db.exec(readFileSync(resolve(MIG, f), 'utf8')); }
  const before = rows(db);
  const histBefore = history(db);
  db.exec(M484);
  const after = rows(db);
  assert.deepEqual(after.filter((r) => r.slug !== NEW_SLUG), before);
  assert.equal(after.filter((r) => r.slug === NEW_SLUG).length, 1);
  assert.deepEqual(history(db), histBefore);
});

test('D758 the 24 seed files: each is the replayed 085 body byte for byte, unimported, without the old name', () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  for (const f of ['084', '085', '105', '113', '469']) db.exec(migration(f));
  const reg = readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/legalTemplates.ts'), 'utf8');
  for (const [slug, f] of SEED) {
    assert.equal(f, `${slug}_v1.md`);
    assert.ok(existsSync(resolve(TPL, f)), f);
    assert.equal(reg.includes(f), false, `${f} is not imported`);
    const bytes = readFileSync(resolve(TPL, f));
    assert.equal(bytes.toString('utf8').includes(OLD), false, `${f} does not print the old name`);
    const row = db.prepare('SELECT body_md, version FROM legal_templates WHERE slug = ?').get(slug) as any;
    assert.equal(row.version, 1, `${slug} is still at version 1`);
    assert.ok(bytes.equals(Buffer.from(row.body_md, 'utf8')), `${f} equals the seeded body, end included`);
  }
});

test('D758 the generator cannot rewrite an applied migration', () => {
  const defs = [...GEN.matchAll(/^def (gen_\w+)\(\):\n([\s\S]*?)(?=^def |^if __name__)/gm)];
  assert.deepEqual(defs.map((d) => d[1]), ['gen_085', 'gen_105', 'gen_refresh', 'gen_484']);
  const outputs: Record<string, string> = { gen_085: 'OUT', gen_105: 'OUT_105', gen_refresh: 'OUT_113', gen_484: 'OUT_484' };
  for (const [, name, body] of defs) {
    const firstStatement = body.replace(/^\s*"""[\s\S]*?"""\s*/, '').split('\n')[0].trim();
    assert.equal(firstStatement, `if os.path.exists(${outputs[name]}):`, `${name} returns early when its output exists`);
    assert.match(body, /if os\.path\.exists\(\w+\):\n\s+print\([^\n]*\)\n\s+return\n/, `${name} returns`);
  }
  const allMd = GEN.slice(GEN.indexOf('def all_md_bodies'), GEN.indexOf('\n\n', GEN.indexOf('def all_md_bodies') + 200));
  assert.equal(allMd.includes('SEED_SKELETON_V1'), false, 'SEED_SKELETON_V1 is not in all_md_bodies()');
  assert.ok(M484.includes(`-- ${SEED[0][0]} <- ${SEED[0][1]}`), '484 reads the seed list');
});
