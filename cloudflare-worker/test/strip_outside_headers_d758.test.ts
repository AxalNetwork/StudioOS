/**
 * D758 (#1863) — migration 496 strips the five outside rows' seed header block,
 * in a new version, never in place.
 *
 *   · The store holds what production held on 2026-10-18: each row's
 *     migration-085 seed body, then 469 (which moves three of them to v2).
 *   · 496 leaves each body as the text after its header, byte for byte, one
 *     version up, with the old body in `legal_template_versions`.
 *   · A second run changes nothing; a row an Admin edited, a clause-only body
 *     (a fresh build's) and every other row are untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const MIG = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const TPL = resolve(ROOT, 'cloudflare-worker/src/templates/legal');
const sqlOf = (f: string) => readFileSync(resolve(MIG, f), 'utf8');
const M496 = sqlOf('496_strip_outside_template_headers.sql');
const FIVE = ['nda_3way_founder_investor_axal', 'investor_nda_axal', 'mentor_nda_axal', 'mentor_engagement_disclaimer', 'partner_services'];

/** A slug's body as migration 085 seeds it, read from the file itself. */
function seedBody(slug: string): string {
  const m = sqlOf('085_seed_legal_templates.sql').match(new RegExp(`\\('${slug}', '(?:[^']|'')*', '[^']*', '((?:[^']|'')*)'`));
  assert.ok(m, `${slug} is in 085`);
  return m[1].replace(/''/g, "'");
}

function store(edit?: (db: any) => void) {
  const db = new DatabaseSync(':memory:');
  db.exec(sqlOf('084_legal_templates.sql'));
  const ins = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, created_by, updated_by)
                          VALUES (?, ?, 'gp', ?, 1, 1, 7, 7)`);
  for (const slug of FIVE) ins.run(slug, slug, seedBody(slug));
  ins.run('carried_interest', 'Carried Interest', seedBody('carried_interest'));
  db.exec(sqlOf('469_legal_templates_fund_legal_name.sql'));
  edit?.(db);
  return db;
}

const rows = (db: any) => db.prepare('SELECT slug, version, body_md, updated_by FROM legal_templates ORDER BY slug').all() as any[];
const history = (db: any) => db.prepare('SELECT slug, version, body_md, created_by FROM legal_template_versions ORDER BY slug, version').all() as any[];
const bySlug = (list: any[]) => Object.fromEntries(list.map((r) => [r.slug, r]));
/** The header block: everything before the first clause heading. */
const headerOf = (body: string) => body.slice(0, body.indexOf('\n## ') + 1);

test('496: the store before it is production\'s — versions 1, 2, 1, 2, 2, each opening with the header block', () => {
  const by = bySlug(rows(store()));
  assert.deepEqual(FIVE.map((s) => by[s].version), [1, 2, 1, 2, 2]);
  for (const s of FIVE) {
    const h = headerOf(by[s].body_md);
    assert.match(h, /^# /, s);
    assert.ok(h.includes('> **Subject to legal review.** This template is a working draft.'), s);
    assert.ok(h.includes('**Version:** v1'), s);
  }
});

test('496: each of the five loses only its header, one version up, with the old body kept in history', () => {
  const db = store();
  const before = bySlug(rows(db));
  const histBefore = history(db);
  db.exec(M496);
  const after = bySlug(rows(db));
  const hist = history(db);
  for (const s of FIVE) {
    const old = before[s];
    const header = headerOf(old.body_md);
    assert.equal(after[s].body_md, old.body_md.slice(header.length), `${s}: the rest is byte for byte`);
    assert.match(after[s].body_md, /^## 1\. /, s);
    assert.ok(!after[s].body_md.includes('Subject to legal review'), s);
    assert.ok(!after[s].body_md.includes('**Version:**'), s);
    assert.equal(after[s].version, old.version + 1, s);
    assert.equal(after[s].updated_by, 7, `${s}: no person made this change`);
    const kept = hist.find((h) => h.slug === s && h.version === old.version);
    assert.ok(kept, `${s}: v${old.version} is in history`);
    assert.equal(kept.body_md, old.body_md, s);
    assert.equal(kept.created_by, 7, s);
  }
  assert.deepEqual(after.carried_interest, before.carried_interest, 'another row is untouched');
  assert.equal(hist.length, histBefore.length + FIVE.length);
});

test('496: a second run changes nothing', () => {
  const db = store();
  db.exec(M496);
  const once = [rows(db), history(db)];
  db.exec(M496);
  assert.deepEqual([rows(db), history(db)], once);
});

test('496: a row an Admin edited, and a clause-only body, are left alone', () => {
  const db = store((d) => {
    d.prepare("UPDATE legal_templates SET body_md = replace(body_md, '# Mentor Mutual NDA', '# Mentor NDA'), version = version + 1 WHERE slug = 'mentor_nda_axal'").run();
    d.prepare('UPDATE legal_templates SET body_md = ? WHERE slug = ?')
      .run(readFileSync(resolve(TPL, 'nda_3way_founder_investor_axal_v1.md'), 'utf8'), 'nda_3way_founder_investor_axal');
  });
  const before = bySlug(rows(db));
  const histBefore = history(db);
  db.exec(M496);
  const after = bySlug(rows(db));
  for (const s of ['mentor_nda_axal', 'nda_3way_founder_investor_axal']) {
    assert.deepEqual(after[s], before[s], `${s} untouched`);
    assert.equal(history(db).filter((h) => h.slug === s).length, histBefore.filter((h) => h.slug === s).length, `${s}: no new history`);
  }
  for (const s of ['investor_nda_axal', 'mentor_engagement_disclaimer', 'partner_services']) {
    assert.equal(after[s].version, before[s].version + 1, `${s} still stripped`);
  }
});

test('496 only strips: every UPDATE sets the body to the text after a fixed prefix', () => {
  const updates = [...M496.matchAll(/UPDATE legal_templates\s+SET ([\s\S]*?)\s+WHERE/g)].map((m) => m[1]);
  assert.equal(updates.length, FIVE.length);
  for (const u of updates) assert.match(u, /^body_md = substr\(body_md, length\('(?:[^']|'')*'\) \+ 1\),\s+version = version \+ 1,\s+updated_at = CURRENT_TIMESTAMP$/);
  assert.equal([...M496.matchAll(/INSERT OR IGNORE INTO legal_template_versions/g)].length, FIVE.length);
  const statements = M496.replace(/^--.*$/gm, '');
  assert.doesNotMatch(statements, /\bDELETE\b|\bBEGIN\b|\bCOMMIT\b/);
});
