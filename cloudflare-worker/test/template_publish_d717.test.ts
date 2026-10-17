// D717 (#1782) decision 10 — publish one template, withdraw one, and push the
// recorded publications to the branches separately.
//
// Real routes over the baseline tables, migration 434's publications and 479.
// Branch bindings are plain objects, as `fanOut` discovers them by prefix.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/** Every page's drawn text, joined (as pdf_execution_d705.test.ts reads it). */
async function pdfText(base64: string): Promise<string> {
  const doc = await PDFDocument.load(Uint8Array.from(Buffer.from(base64, 'base64')));
  return doc.getPages().map((page) => {
    const raw = page.node.lookup(PDFName.of('Contents'));
    const streams = raw instanceof PDFArray ? raw.asArray().map((r) => doc.context.lookup(r)) : [raw];
    let ops = '';
    for (const st of streams) if (st instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(st).decode()).toString('latin1');
    return [...ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join(' ');
  }).join(' ').replace(/\s+/g, ' ');
}

const SECRET = 'unit-test-secret-d717-publish-0123456789abc';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'activity_logs', 'legal_templates', 'legal_template_versions', 'esign_envelopes',
    'esign_recipients', 'esign_audit_events', 'deals']) {
    db.exec(tableFromBaseline(baseline, t));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/434_contract_template_publications.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/479_template_kind_party.sql', 'utf8'));
  const user = db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)');
  user.run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  user.run(3, 'founder', 'Founder', 'founder@example.test', 1);
  db.exec(`INSERT INTO legal_templates(slug,title,category,body_md,version,doc_kind,axal_party) VALUES
    ('d717_alpha','Alpha Agreement','gp','Alpha body',3,'agreement','holdings'),
    ('d717_beta','Beta Agreement','fund','Beta body',2,NULL,NULL)`);
  db.exec("INSERT INTO legal_templates(slug,title,category,body_md,version,is_stub) VALUES('d717_stub','Stub Agreement','fund','',1,1)");
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, path: string, body: unknown = {}, who: number | null = 1, extraEnv: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === 1 ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  const res = await app.request(`/contracts${path}`, { method: 'POST', headers, body: JSON.stringify(body) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv });
  return { status: res.status, body: await res.json() as any };
}
const pubs = (db: DatabaseSync) => (db.prepare('SELECT slug, version, body_md, doc_kind, axal_party FROM legal_template_publications ORDER BY slug').all() as any[]).map((r) => ({ ...r }));
const logs = (db: DatabaseSync, action: string) => db.prepare('SELECT details, user_id FROM activity_logs WHERE action = ?').all(action) as any[];

test('D717 publish snapshots one row with its kind and party, and one activity row', async () => {
  const db = fixture();
  const r = await call(db, '/published-templates/d717_alpha/publish', { version: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.publication.slug, r.body.publication.version, r.body.publication.doc_kind, r.body.publication.axal_party],
    ['d717_alpha', 3, 'agreement', 'holdings']);
  assert.equal(r.body.publication.body_md, undefined);
  assert.deepEqual(pubs(db), [{ slug: 'd717_alpha', version: 3, body_md: 'Alpha body', doc_kind: 'agreement', axal_party: 'holdings' }]);
  const audit = logs(db, 'contract_template_published');
  assert.equal(audit.length, 1);
  assert.deepEqual([JSON.parse(audit[0].details).slug, JSON.parse(audit[0].details).version, audit[0].user_id], ['d717_alpha', 3, 1]);
  assert.equal(logs(db, 'contract_templates_published').length, 0);
  // A second template publishes beside it; NULL columns copy as NULL.
  assert.equal((await call(db, '/published-templates/d717_beta/publish', { version: 2 })).status, 200);
  assert.deepEqual(pubs(db).map((p) => [p.slug, p.doc_kind, p.axal_party]), [['d717_alpha', 'agreement', 'holdings'], ['d717_beta', null, null]]);
});

test('D717 the library publish still copies both columns into every snapshot', async () => {
  const db = fixture();
  assert.equal((await call(db, '/published-templates/publish')).status, 200);
  assert.deepEqual(pubs(db).map((p) => [p.slug, p.doc_kind, p.axal_party]), [['d717_alpha', 'agreement', 'holdings'], ['d717_beta', null, null]]);
});

test('D717 publish answers 409 for a stale version and for a stub, and writes nothing', async () => {
  const db = fixture();
  const stale = await call(db, '/published-templates/d717_alpha/publish', { version: 2 });
  assert.deepEqual([stale.status, stale.body.code], [409, 'published_version_changed']);
  const stub = await call(db, '/published-templates/d717_stub/publish', { version: 1 });
  assert.deepEqual([stub.status, stub.body.code], [409, 'template_has_no_body']);
  db.exec("UPDATE legal_templates SET is_stub = 0, body_md = '   ' WHERE slug = 'd717_stub'");
  assert.equal((await call(db, '/published-templates/d717_stub/publish', { version: 1 })).body.code, 'template_has_no_body');
  const missing = await call(db, '/published-templates/d717_none/publish', { version: 1 });
  assert.deepEqual([missing.status, missing.body.code], [404, 'template_not_found']);
  const noVersion = await call(db, '/published-templates/d717_alpha/publish', { version: '3' });
  assert.deepEqual([noVersion.status, noVersion.body.code], [400, 'version_required']);
  assert.deepEqual(pubs(db), []);
  assert.equal(logs(db, 'contract_template_published').length, 0);
});

test('D717 withdraw removes only that publication, and 404s when there is none', async () => {
  const db = fixture();
  await call(db, '/published-templates/d717_alpha/publish', { version: 3 });
  await call(db, '/published-templates/d717_beta/publish', { version: 2 });
  const r = await call(db, '/published-templates/d717_alpha/withdraw');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.withdrawn, { slug: 'd717_alpha', version: 3 });
  assert.deepEqual(pubs(db).map((p) => p.slug), ['d717_beta']);
  assert.equal(logs(db, 'contract_template_withdrawn').length, 1);
  const again = await call(db, '/published-templates/d717_alpha/withdraw');
  assert.deepEqual([again.status, again.body.code], [404, 'not_published']);
  assert.equal(logs(db, 'contract_template_withdrawn').length, 1);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM legal_templates').get() as any).n), 3);
});

test('D717 push sends the recorded publications as they stand, writes none, and maps each branch', async () => {
  const db = fixture();
  await call(db, '/published-templates/d717_alpha/publish', { version: 3 });
  db.exec("UPDATE legal_templates SET body_md = 'Alpha draft', version = 4 WHERE slug = 'd717_alpha'");
  const sent: any[] = [];
  const branches = {
    BRANCH_FR: { publishTemplate: async (payload: any) => { sent.push(payload); return { stored: 1, withdrawn: 0 }; } },
    BRANCH_DE: { publishTemplate: async () => { throw new Error('branch said no'); } },
    BRANCH_IT: {},
  };
  const before = JSON.stringify(pubs(db));
  const logsBefore = Number((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n);
  const r = await call(db, '/published-templates/push', {}, 1, branches);
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(pubs(db)), before);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n), logsBefore);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].templates, [{ slug: 'd717_alpha', title: 'Alpha Agreement', category: 'gp', version: 3 }]);
  assert.match(sent[0].pushed_at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual([r.body.template_count, r.body.answered, r.body.total], [1, 1, 3]);
  const byCode = Object.fromEntries(r.body.branches.map((b: any) => [b.code, b]));
  assert.deepEqual(byCode.fr, { code: 'fr', status: 'ok', stored: 1, withdrawn: 0 });
  assert.deepEqual([byCode.de.status, byCode.de.reason], ['unreadable', 'branch said no']);
  assert.equal(byCode.it.status, 'unreadable');
  const none = await call(db, '/published-templates/push');
  assert.deepEqual(none.body.branches, []);
  assert.match(none.body.branches_reason, /No branch Worker is bound/);
});

test('D717 a branch Worker, a member and an anonymous caller are refused on all three', async () => {
  const db = fixture();
  for (const [path, body] of [['/published-templates/d717_alpha/publish', { version: 3 }], ['/published-templates/d717_alpha/withdraw', {}],
    ['/published-templates/push', {}]] as const) {
    assert.equal((await call(db, path, body, null)).status, 401, path);
    assert.equal((await call(db, path, body, 3)).status, 403, path);
    const branch = await call(db, path, body, 1, { BRANCH_CODE: 'fr' });
    assert.equal(branch.status, 403, path);
  }
  assert.deepEqual(pubs(db), []);
});

test('D717 a contract send records the publication\'s kind and party on the envelope, not the edited row\'s', async () => {
  const db = fixture();
  await call(db, '/published-templates/d717_alpha/publish', { version: 3 });
  // A later draft changes the row's party; the publication is what is sent.
  db.exec("UPDATE legal_templates SET axal_party = 'gp', version = 4 WHERE slug = 'd717_alpha'");
  const input = { template_slug: 'd717_alpha', template_version: 3, recipient_name: 'New signer', recipient_email: 'new@example.test', fields: {}, provider: 'native' };
  const preview = await call(db, '/envelopes/preview', input);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  // The envelope preview prints the publication's party too.
  const shown = await pdfText(preview.body.pdf_base64);
  assert.ok(shown.includes('by and between Axal VC Holdings LLC'), 'preview names Holdings');
  assert.ok(!shown.includes('by and between Axal VC GP LLC'));
  const sent = await call(db, '/envelopes/send', { ...input, preview_sha256: preview.body.body_sha256 });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const env = { ...db.prepare('SELECT doc_kind, axal_party FROM esign_envelopes WHERE envelope_uuid = ?').get(sent.body.envelope_uuid) as any };
  assert.deepEqual(env, { doc_kind: 'agreement', axal_party: 'holdings' });
  // A publication with NULL columns records the slug's pair.
  await call(db, '/published-templates/d717_beta/publish', { version: 2 });
  const beta = { ...input, template_slug: 'd717_beta', template_version: 2 };
  const p2 = await call(db, '/envelopes/preview', beta);
  const s2 = await call(db, '/envelopes/send', { ...beta, preview_sha256: p2.body.body_sha256 });
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
  const env2 = { ...db.prepare('SELECT doc_kind, axal_party FROM esign_envelopes WHERE envelope_uuid = ?').get(s2.body.envelope_uuid) as any };
  assert.deepEqual(env2, { doc_kind: 'agreement', axal_party: 'management' });
});
