// D717 (#1782) — each legal template's kind and Axal party, stored on its row
// (migration 479) or derived from its slug.
//
// The fixture is the production table shapes (schema_baseline.sql) with the
// catalog's seeded rows, D706's and D707's stubs, migration 434's
// publications and 479 applied, so "every existing row reads NULL" is checked
// against the real catalog.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { pdfText } from './_pdf_text.ts';
import { tableFromBaseline } from './_baseline.mjs';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { classifyDocument, axalEntityKeyForDoc } from '../src/services/legalDocFormat.ts';
import { getTemplate, listVersions, updateTemplate, createTemplate, TemplateError } from '../src/services/legalTemplateStore.ts';
import {
  COUNSEL_DRAFT_SLUGS, PARTYLESS_KINDS, TEMPLATE_KINDS, derivedFormat, effectiveFormat, renderFormat, templateFormatFor,
  validateFormat, FormatError,
} from '../src/services/templateFormat.ts';

const MIGRATIONS = 'cloudflare-worker/sql/migrations';
const SECRET = 'unit-test-secret-d717-format-0123456789abcdef';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const migration = (prefix: string) => {
  const name = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`));
  assert.ok(name, `migration ${prefix}`);
  return readFileSync(`${MIGRATIONS}/${name}`, 'utf8');
};
/** The legal_templates INSERT statements of a migration, alone (478 also creates tables this fixture lacks). */
const catalogInserts = (sql: string) => sql.match(/INSERT OR IGNORE INTO legal_templates[\s\S]*?;/g) ?? [];
/** The slugs those INSERTs add: VALUES tuples (468, 471) and a single SELECT (478). */
const insertedSlugs = (sql: string) => catalogInserts(sql).flatMap((s) => [
  ...[...s.matchAll(/^\s*\('([a-z0-9_]+)'/gm)].map((m) => m[1]),
  ...[...s.matchAll(/^SELECT '([a-z0-9_]+)'/gm)].map((m) => m[1]),
]);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'activity_logs', 'legal_templates', 'legal_template_versions', 'esign_envelopes',
    'esign_recipients', 'documents', 'projects', 'founders', 'deals', 'pairwise_ndas', 'partner_deals']) {
    db.exec(tableFromBaseline(baseline, t));
  }
  for (const f of ['085', '105', '113', '468', '471']) db.exec(migration(f));
  for (const s of catalogInserts(migration('478'))) db.exec(s);
  db.exec(migration('434'));
  db.exec(migration('479'));
  db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)').run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  db.exec('INSERT INTO super_admins(user_id) VALUES(1)');
  return { db, env: { DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await new SignJWT({ user_id: 1, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app.request(`/contracts${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

async function previewText(db: DatabaseSync, slug: string): Promise<string> {
  const res = await app.request(`/contracts/templates/store/${slug}/preview.pdf`, { headers: { Authorization: `Bearer ${await new SignJWT({ user_id: 1, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}` } },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  assert.equal(res.status, 200);
  return pdfText(new Uint8Array(await res.arrayBuffer()));
}

test('D717 migration 479: every existing row reads NULL, and the CHECKs refuse an unknown kind or party', () => {
  const { db } = fixture();
  const rows = db.prepare('SELECT slug, doc_kind, axal_party FROM legal_templates').all() as any[];
  assert.ok(rows.length > 90);
  assert.deepEqual(rows.filter((r) => r.doc_kind !== null || r.axal_party !== null), []);
  for (const table of ['legal_templates', 'legal_template_versions', 'legal_template_publications', 'esign_envelopes']) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
    assert.ok(cols.includes('doc_kind') && cols.includes('axal_party'), table);
  }
  assert.throws(() => db.exec("UPDATE legal_templates SET doc_kind = 'memo' WHERE slug = 'ppm'"), /CHECK/);
  assert.throws(() => db.exec("UPDATE legal_templates SET axal_party = 'treasurer' WHERE slug = 'ppm'"), /CHECK/);
  db.exec("UPDATE legal_templates SET doc_kind = 'notice', axal_party = 'none' WHERE slug = 'ppm'");
  for (const sql of migration('479').split(';').map((s) => s.trim()).filter((s) => s.startsWith('ALTER'))) {
    assert.match(sql, /^ALTER TABLE \w+ ADD COLUMN (doc_kind|axal_party) TEXT CHECK/);
  }
  assert.doesNotMatch(migration('479').replace(/--.*$/gm, ''), /\b(BEGIN|COMMIT|INSERT|UPDATE|DELETE)\b/);
});

test('D717 derivedFormat is the slug rules for every catalog slug, with none for a partyless kind', () => {
  const { db } = fixture();
  const rows = db.prepare('SELECT slug, category FROM legal_templates').all() as any[];
  for (const { slug, category } of rows) {
    const kind = classifyDocument(slug);
    const party = PARTYLESS_KINDS.has(kind) ? 'none' : axalEntityKeyForDoc(slug, category);
    assert.deepEqual(derivedFormat(slug, category), { kind, party }, slug);
    assert.deepEqual(effectiveFormat({ slug, category }), { kind, party, source: 'slug' }, slug);
  }
  assert.ok(rows.some((r) => PARTYLESS_KINDS.has(classifyDocument(r.slug))));
  assert.deepEqual([...TEMPLATE_KINDS].sort(), ['agreement', 'booklet', 'corporate', 'notice', 'policy', 'resolution', 'unilateral']);
});

test('D717 each validation code fires', () => {
  const code = (fn: () => void) => { try { fn(); return null; } catch (e) { assert.ok(e instanceof FormatError); return e.code; } };
  assert.equal(code(() => validateFormat('memo', null, 'ppm')), 'kind_invalid');
  assert.equal(code(() => validateFormat(7, null, 'ppm')), 'kind_invalid');
  assert.equal(code(() => validateFormat('notice', null, 'ppm')), 'kind_not_drawn');
  assert.equal(code(() => validateFormat('booklet', null, 'ppm')), 'kind_not_drawn');
  assert.equal(code(() => validateFormat(null, 'treasurer', 'ppm')), 'party_invalid');
  assert.equal(code(() => validateFormat('policy', 'gp', 'ppm')), 'kind_party_mismatch');
  assert.equal(code(() => validateFormat('agreement', 'none', 'ppm')), 'kind_party_mismatch');
  // The pair is checked on the effective values: a party alone against the slug's kind.
  assert.equal(code(() => validateFormat(null, 'none', 'lpa_initial')), 'kind_party_mismatch');
  assert.equal(code(() => validateFormat(null, 'gp', 'valuation_policy')), 'kind_party_mismatch');
  assert.equal(code(() => validateFormat('agreement', 'holdings', 'ppm')), null);
  assert.equal(code(() => validateFormat(null, 'holdings', 'lpa_initial')), null);
  assert.equal(code(() => validateFormat(null, null, 'valuation_policy')), null);
  assert.equal(code(() => validateFormat('unilateral', 'none', 'lpa_initial')), null);
});

test('D717 a change is an edit: the version bumps, history holds the old pair, absent keeps and null resets', async () => {
  const { db, env } = fixture();
  const before = await getTemplate(env, 'lpa_initial');
  assert.ok(before);
  const keep = { title: before.title, category: before.category, body_md: before.body_md };
  const first = await updateTemplate(env, 'lpa_initial', { ...keep, axal_party: 'holdings' }, 1);
  assert.equal(first.version, before.version + 1);
  assert.deepEqual([first.doc_kind, first.axal_party], [null, 'holdings']);
  const second = await updateTemplate(env, 'lpa_initial', { ...keep, doc_kind: 'resolution' }, 1);
  assert.deepEqual([second.doc_kind, second.axal_party], ['resolution', 'holdings']);
  const absent = await updateTemplate(env, 'lpa_initial', { ...keep }, 1);
  assert.deepEqual([absent.doc_kind, absent.axal_party], ['resolution', 'holdings']);
  const history = (await listVersions(env, 'lpa_initial'))!.versions;
  assert.deepEqual(history.map((v) => [v.version, v.doc_kind, v.axal_party]), [
    [before.version + 2, 'resolution', 'holdings'],
    [before.version + 1, null, 'holdings'],
    [before.version, null, null],
  ]);
  const reset = await updateTemplate(env, 'lpa_initial', { ...keep, doc_kind: null, axal_party: null }, 1);
  assert.deepEqual([reset.doc_kind, reset.axal_party, reset.version], [null, null, before.version + 4]);
  // A refused pair writes nothing.
  await assert.rejects(updateTemplate(env, 'lpa_initial', { ...keep, axal_party: 'none' }, 1),
    (e: any) => e instanceof TemplateError && e.code === 'kind_party_mismatch' && e.status === 400);
  assert.equal((await getTemplate(env, 'lpa_initial'))!.version, before.version + 4);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM legal_template_versions").get() as any).n), 4);
  const created = await createTemplate(env, { slug: 'd717_made_up', title: 'Made-up agreement', category: 'gp', body_md: 'x', axal_party: 'gp' }, 1);
  assert.deepEqual([created.doc_kind, created.axal_party], [null, 'gp']);
  await assert.rejects(createTemplate(env, { slug: 'd717_bad', title: 'Bad', category: 'gp', doc_kind: 'memo' }, 1),
    (e: any) => e.code === 'kind_invalid');
});

test('D717 COUNSEL_DRAFT_SLUGS equals the slugs migrations 468, 471, 478 and 484 insert', () => {
  const slugs = ['468', '471', '478', '484'].flatMap((n) => insertedSlugs(migration(n)));
  assert.equal(slugs.length, 32);
  assert.deepEqual([...COUNSEL_DRAFT_SLUGS].sort(), [...new Set(slugs)].sort());
});

test('D717 the routes: a notice slug takes no stored pair (409 format_fixed); ppm does, and the reads carry the format', async () => {
  const { db } = fixture();
  assert.equal(classifyDocument('capital_call_notice'), 'notice');
  const notice = (await call(db, '/templates/store/capital_call_notice')).body.template;
  const put = (slug: string, row: any, extra: any) => call(db, `/templates/store/${slug}`, 'PUT',
    { title: row.title, category: row.category, body_md: row.body_md, ...extra });
  const fixed = await put('capital_call_notice', notice, { axal_party: 'gp' });
  assert.equal(fixed.status, 409);
  assert.equal(fixed.body.code, 'format_fixed');
  assert.equal((await put('capital_call_notice', notice, { doc_kind: 'agreement' })).body.code, 'format_fixed');
  assert.equal((db.prepare("SELECT version FROM legal_templates WHERE slug='capital_call_notice'").get() as any).version, 1);
  // A save that sends neither (or resets both) still works.
  assert.equal((await put('capital_call_notice', notice, {})).status, 200);
  assert.equal((await put('capital_call_notice', notice, { doc_kind: null, axal_party: null })).status, 200);

  const ppm = (await call(db, '/templates/store/ppm')).body.template;
  assert.deepEqual([ppm.doc_kind, ppm.axal_party, ppm.format_source, ppm.format_fixed], [null, null, 'slug', false]);
  assert.deepEqual([ppm.kind, ppm.party], [derivedFormat('ppm', ppm.category).kind, derivedFormat('ppm', ppm.category).party]);
  assert.deepEqual(ppm.format_options.parties, ['management', 'holdings', 'gp', 'fund', 'none']);
  assert.deepEqual(ppm.format_options.kinds, ['agreement', 'corporate', 'resolution', 'unilateral', 'policy']);
  // #1852: the entity the slug names, for the editor's "From the slug" party.
  assert.equal(ppm.format_options.entity, axalEntityKeyForDoc('ppm', ppm.category));
  const policy = (await call(db, '/templates/store/valuation_policy')).body.template;
  assert.equal(classifyDocument('valuation_policy'), 'policy');
  assert.equal(policy.format_options.derived.party, 'none');
  assert.ok(['management', 'holdings', 'gp', 'fund'].includes(policy.format_options.entity), policy.format_options.entity);
  assert.equal(policy.format_options.entity, axalEntityKeyForDoc('valuation_policy', policy.category));
  const set = await put('ppm', ppm, { doc_kind: 'agreement', axal_party: 'gp' });
  assert.equal(set.status, 200);
  assert.deepEqual([set.body.template.kind, set.body.template.party, set.body.template.format_source], ['agreement', 'gp', 'row']);
  // preview.pdf prints the row's effective party.
  const party = (t: string) => ['Management', 'Holdings', 'GP'].filter((n) => t.includes(`by and between Axal VC ${n} LLC`));
  assert.deepEqual(party(await previewText(db, 'ppm')), ['GP']);
  assert.equal((await put('ppm', ppm, { axal_party: 'holdings' })).status, 200);
  assert.deepEqual(party(await previewText(db, 'ppm')), ['Holdings']);
  const bad = await put('ppm', ppm, { doc_kind: 'memo' });
  assert.deepEqual([bad.status, bad.body.code], [400, 'kind_invalid']);
  const made = await call(db, '/templates/store', 'POST', { slug: 'd717_route_made', title: 'Route-made agreement', category: 'gp', body_md: 'x', axal_party: 'gp' });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.template.axal_party, made.body.template.party, made.body.template.format_source], ['gp', 'gp', 'row']);
  const madeBad = await call(db, '/templates/store', 'POST', { slug: 'd717_route_bad', title: 'Bad', category: 'gp', doc_kind: 'policy', axal_party: 'gp' });
  assert.deepEqual([madeBad.status, madeBad.body.code], [400, 'kind_party_mismatch']);
  const list = await call(db, '/templates/store');
  assert.equal(list.status, 200);
  const row = list.body.items.find((t: any) => t.slug === 'ppm');
  assert.deepEqual([row.doc_kind, row.axal_party, row.kind, row.party, row.format_source], ['agreement', 'holdings', 'agreement', 'holdings', 'row']);
  assert.equal(list.body.items.find((t: any) => t.slug === 'capital_call_notice').format_fixed, true);
  // D717 PR 2b: the counsel-draft mark is the Worker's; the page keeps no copy of the slugs.
  assert.equal(list.body.items.find((t: any) => t.slug === 'capital_call_notice').counsel_draft, true);
  assert.equal(row.counsel_draft, false);
});

test('D717 templateFormatFor reads the active row, falls back to the slug, and renderFormat omits none', async () => {
  const { db, env } = fixture();
  assert.deepEqual(await templateFormatFor(env, 'lpa_initial'), { ...derivedFormat('lpa_initial', 'fund'), source: 'slug' });
  db.exec("UPDATE legal_templates SET axal_party = 'holdings' WHERE slug = 'lpa_initial'");
  assert.deepEqual(await templateFormatFor(env, 'lpa_initial'), { kind: 'agreement', party: 'holdings', source: 'row' });
  db.exec("UPDATE legal_templates SET is_active = 0 WHERE slug = 'lpa_initial'");
  assert.equal((await templateFormatFor(env, 'lpa_initial')).source, 'slug');
  assert.deepEqual(await templateFormatFor({ DB: { prepare() { throw new Error('no such column: doc_kind'); } } } as any, 'valuation_policy'),
    { kind: 'policy', party: 'none', source: 'slug' });
  assert.deepEqual(renderFormat({ kind: 'policy', party: 'none' }), { documentKind: 'policy' });
  assert.deepEqual(renderFormat({ kind: 'agreement', party: 'gp' }), { documentKind: 'agreement', axalEntityKey: 'gp' });
  assert.deepEqual(renderFormat({ doc_kind: null, axal_party: null }), {});
  assert.deepEqual(renderFormat({ doc_kind: null, axal_party: 'fund' }), { axalEntityKey: 'fund' });
});
