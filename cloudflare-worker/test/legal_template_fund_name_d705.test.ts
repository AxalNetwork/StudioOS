/**
 * D705 part 2 (#1717) — the template bodies take the Fund's legal name, in a
 * new version, never in place.
 *
 *   · Migration 469 over a store holding the six production rows at version 1
 *     leaves each at version 2 with the new name, and the old body in
 *     `legal_template_versions` at version 1.
 *   · A second run changes nothing; a row whose body no longer holds the old
 *     name, and an inactive row, are untouched.
 *   · No file the registry imports prints the old name, and each new file is
 *     its old version with only the name changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const MIG = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const TPL = resolve(ROOT, 'cloudflare-worker/src/templates/legal');
const OLD = 'Axal VC Fund I, LP';
const NEW = 'Axal VC Spin-Out Lab Fund I LP';
const sqlOf = (f: string) => readFileSync(resolve(MIG, f), 'utf8');
const MIG469 = sqlOf('469_legal_templates_fund_legal_name.sql');
const file = (f: string) => readFileSync(resolve(TPL, f), 'utf8');

// The six rows production held on 2026-10-17, with the file each body came from.
const SIX: Array<[string, string]> = [
  ['accreditation_v1', 'accreditation_v1.md'],
  ['investor_nda_axal', 'investor_nda_v1.md'],
  ['mentor_engagement_disclaimer', 'mentor_disclaimer_v1.md'],
  ['partner_services', 'partner_msa_v1.md'],
  ['privacy_v1', 'privacy_v1.md'],
  ['tos_v1', 'tos_v1.md'],
];

function store() {
  const db = new DatabaseSync(':memory:');
  db.exec(sqlOf('084_legal_templates.sql'));
  const ins = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, created_by, updated_by)
                          VALUES (?, ?, 'gp', ?, ?, ?, 7, 7)`);
  for (const [slug, f] of SIX) ins.run(slug, slug, file(f), 1, 1);
  // An admin already rewrote this one without the old name: left alone.
  ins.run('carried_interest', 'Carried Interest', `Allocated by the general partner of ${NEW}.`, 3, 1);
  // Soft-deleted rows are not issued, so they keep what they had.
  ins.run('retired_doc', 'Retired', `An old line naming ${OLD}.`, 1, 0);
  return db;
}

const rows = (db: any) => db.prepare('SELECT slug, version, body_md, updated_by FROM legal_templates ORDER BY slug').all() as any[];
const history = (db: any) => db.prepare('SELECT slug, version, body_md, created_by FROM legal_template_versions ORDER BY slug, version').all() as any[];

test('469: each of the six rows moves to version 2 with the legal name, and its version 1 body is kept', () => {
  const db = store();
  db.exec(MIG469);
  const by = Object.fromEntries(rows(db).map((r) => [r.slug, r]));
  const hist = Object.fromEntries(history(db).map((r) => [r.slug, r]));
  for (const [slug, f] of SIX) {
    const r = by[slug];
    assert.equal(r.version, 2, slug);
    assert.equal(r.body_md.includes(OLD), false, `${slug} still prints the old name`);
    assert.ok(r.body_md.includes(NEW), `${slug} prints the legal name`);
    // Only the name changed.
    assert.equal(r.body_md, file(f).split(OLD).join(NEW), `${slug}: only the name changes`);
    assert.equal(r.updated_by, 7, `${slug}: no person is recorded for this change`);
    assert.deepEqual([hist[slug].version, hist[slug].body_md, hist[slug].created_by], [1, file(f), 7], `${slug} history`);
  }
});

test('469: a second run changes nothing; an edited row and an inactive row are untouched', () => {
  const db = store();
  db.exec(MIG469);
  const once = [rows(db), history(db)];
  db.exec(MIG469);
  assert.deepEqual([rows(db), history(db)], once, 'the second run changed the store');
  const by = Object.fromEntries(rows(db).map((r) => [r.slug, r]));
  assert.equal(by.carried_interest.version, 3);
  assert.equal(by.retired_doc.version, 1);
  assert.ok(by.retired_doc.body_md.includes(OLD));
  assert.equal(history(db).some((h: any) => h.slug === 'carried_interest' || h.slug === 'retired_doc'), false);
});

test('the registry imports no file that prints the old name; each new file changes only the name', () => {
  const reg = readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/legalTemplates.ts'), 'utf8');
  const imported = [...reg.matchAll(/templates\/legal\/([\w.-]+\.md)\?raw/g)].map((m) => m[1]);
  assert.equal(imported.length, 9);
  for (const f of imported) assert.equal(file(f).includes(OLD), false, `${f} prints the old name`);
  const pairs: Array<[string, string]> = [
    ['accreditation_v1.md', 'accreditation_v2.md'], ['carried_interest_v1.md', 'carried_interest_v2.md'],
    ['ic_charter_v1.md', 'ic_charter_v2.md'], ['investor_nda_v1.md', 'investor_nda_v2.md'],
    ['investor_subscription_inst_v1.md', 'investor_subscription_inst_v2.md'], ['mentor_disclaimer_v1.md', 'mentor_disclaimer_v2.md'],
    ['partner_capital_v1.md', 'partner_capital_v2.md'], ['partner_msa_v1.md', 'partner_msa_v2.md'],
    ['partner_services_v1.md', 'partner_services_v2.md'], ['privacy_v1.md', 'privacy_v2.md'], ['tos_v1.md', 'tos_v3.md'],
  ];
  for (const [oldF, newF] of pairs) {
    assert.ok(existsSync(resolve(TPL, oldF)), `${oldF} stays: a signed document names its version`);
    assert.ok(file(oldF).includes(OLD));
    assert.equal(file(newF), file(oldF).split(OLD).join(NEW), `${newF} is ${oldF} with only the name changed`);
  }
  // No other current file in the folder prints the old name: only the kept
  // `_v1` files and `tos_v2.md`, which nothing imports.
  const kept = new Set([...pairs.map(([o]) => o), 'tos_v2.md']);
  const stray = readdirSync(TPL).filter((f) => f.endsWith('.md') && !kept.has(f) && file(f).includes(OLD));
  assert.deepEqual(stray, []);
});

test('the Terms and Privacy pages print the legal name', () => {
  for (const f of ['frontend/src/pages/TermsPage.jsx', 'frontend/src/pages/PrivacyPage.jsx']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    assert.equal(src.includes(OLD), false, f);
    assert.ok(src.includes(NEW), f);
  }
});
