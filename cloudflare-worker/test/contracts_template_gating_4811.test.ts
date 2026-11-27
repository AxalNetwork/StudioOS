// D4811 (#4811) part 1 — Restricted and Incomplete templates are refused by the
// API, not only hidden by the page. One predicate (`services/templateSafety.ts`)
// answers every route that generates from, uses or publishes a template; a
// complete template that counsel has reviewed still works end to end.
//
// Real routes over the baseline tables, migration 434's publications and 479,
// as template_publish_d717.test.ts builds them. Every title, slug and address
// is synthetic; `subsidiary_licence_agreement` is the one restricted slug the
// code ships (COUNSEL_REVIEW_SLUGS), so it is the fixture's restricted row.
//
// Run with:
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/contracts_template_gating_4811.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { createAndSendEnvelope, templateBodyRefusal, TemplateBodyError } from '../src/routes/esign.ts';
import { templateSafety, templateUseRefusal, restrictedSlugsJson, INCOMPLETE_LINE } from '../src/services/templateSafety.ts';
import { COUNSEL_REVIEW_SLUGS } from '../src/services/templateFormat.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const RESTRICTED = 'subsidiary_licence_agreement';
const SECRET = 'unit-test-secret-d4811-gating-0123456789ab';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'legal_templates', 'legal_template_versions', 'esign_envelopes',
    'esign_recipients', 'esign_audit_events', 'deals']) {
    db.exec(tableFromBaseline(baseline, t));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/434_contract_template_publications.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/479_template_kind_party.sql', 'utf8'));
  const user = db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)');
  user.run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  // D4811 part 13: publishing one template needs a recent step-up; this session's TOTP sign-in is one.
  db.exec('INSERT INTO super_admins (user_id) VALUES (1)'); // D4811 part 15: publishing is the Super Admin's.
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (1, 'sess', 'totp', ?)").run(new Date().toISOString().replace('T', ' ').slice(0, 19));
  db.exec(`INSERT INTO legal_templates(slug,title,category,body_md,version,doc_kind,axal_party) VALUES
    ('d4811_ready','Ready Agreement','gp','Ready body for {{recipient_name}}',2,'agreement','holdings'),
    ('${RESTRICTED}','Restricted Agreement','gp','Restricted body',4,'agreement','holdings')`);
  db.exec("INSERT INTO legal_templates(slug,title,category,body_md,version,is_stub) VALUES('d4811_stub','Stub Agreement','gp','',1,1)");
  db.exec("INSERT INTO legal_templates(slug,title,category,body_md,version,is_stub) VALUES('d4811_blank','Blank Agreement','gp','   ',1,0)");
  return db;
}
/** A publication recorded before the restriction applied (as production may hold one). */
function priorPublication(db: DatabaseSync) {
  db.exec(`INSERT INTO legal_template_publications (template_id, slug, version, title, category, body_md, doc_kind, axal_party, published_at, published_by)
    SELECT id, slug, version, title, category, body_md, doc_kind, axal_party, '2026-10-01T00:00:00Z', 1 FROM legal_templates WHERE slug = '${RESTRICTED}'`);
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, path: string, body: unknown = {}, extraEnv: Record<string, unknown> = {}, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json',
    Authorization: `Bearer ${await new SignJWT({ user_id: 1, role: 'admin', jti: 'sess' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}` };
  // D4811 part 13: a single publish carries the high-risk confirmation unless a case sends its own.
  if (/^\/published-templates\/[^/]+\/publish$/.test(path) && path !== '/published-templates/publish' && body && typeof body === 'object' && !('reason' in (body as any))) {
    body = { ...(body as any), reason: 'Counsel approved this text; synthetic test.', confirm: 'PUBLISH' };
  }
  const res = await app.request(`/contracts${path}`, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv });
  return { status: res.status, body: await res.json() as any };
}
const pubs = (db: DatabaseSync) => (db.prepare('SELECT slug FROM legal_template_publications ORDER BY slug').all() as any[]).map((r) => r.slug);
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);
const envelopes = (db: DatabaseSync) => count(db, 'SELECT COUNT(*) AS n FROM esign_envelopes');

test('D4811 the predicate: restricted comes from COUNSEL_REVIEW_SLUGS, incomplete from is_stub or a blank body, restricted wins', () => {
  // Mutation checked: drop the COUNSEL_REVIEW_SLUGS read in isRestrictedSlug → the first two asserts fail.
  assert.ok(COUNSEL_REVIEW_SLUGS.has(RESTRICTED), 'the fixture names a slug the code really restricts');
  assert.deepEqual(templateUseRefusal({ slug: RESTRICTED, is_stub: 0, body_md: 'text' })?.code, 'template_restricted');
  assert.equal(templateSafety({ slug: RESTRICTED.toUpperCase(), body_md: 'text' }).restricted, true, 'case-insensitive');
  // Mutation checked: read only is_stub (not the trimmed body) → the blank row passes.
  assert.equal(templateUseRefusal({ slug: 'x', is_stub: 1, body_md: 'text' })?.code, 'template_has_no_body');
  assert.equal(templateUseRefusal({ slug: 'x', is_stub: 0, body_md: '  \n ' })?.code, 'template_has_no_body');
  assert.ok(templateUseRefusal({ slug: 'x', body_md: '' })!.message.includes(INCOMPLETE_LINE), 'the refusal carries the incomplete sentence');
  // Mutation checked: test incomplete before restricted → this is template_has_no_body.
  assert.equal(templateUseRefusal({ slug: RESTRICTED, is_stub: 1, body_md: '' })?.code, 'template_restricted', 'restricted wins');
  assert.equal(templateUseRefusal({ slug: 'x', is_stub: 0, body_md: 'text' }), null, 'a complete, reviewed template may be used');
  const both = templateSafety({ slug: RESTRICTED, is_stub: 1, body_md: '' });
  assert.deepEqual([both.restricted, both.incomplete], [true, true], 'both overlays are reported, never one replacing the other');
  assert.deepEqual(JSON.parse(restrictedSlugsJson()), [...COUNSEL_REVIEW_SLUGS].sort());
});

test('D4811 publish one: restricted and incomplete are 409 and write nothing; a complete template publishes', async () => {
  const db = fixture();
  // Mutation checked: remove the templateUseRefusal call in publishOneTemplate → restricted answers 200 and publishes.
  const restricted = await call(db, `/published-templates/${RESTRICTED}/publish`, { version: 4 });
  assert.deepEqual([restricted.status, restricted.body.code], [409, 'template_restricted']);
  assert.match(restricted.body.error, /^Restricted — Legal review required\./);
  for (const slug of ['d4811_stub', 'd4811_blank']) {
    const r = await call(db, `/published-templates/${slug}/publish`, { version: 1 });
    assert.deepEqual([r.status, r.body.code], [409, 'template_has_no_body'], slug);
  }
  assert.deepEqual(pubs(db), []);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'contract_template_published'"), 0);
  const ok = await call(db, '/published-templates/d4811_ready/publish', { version: 2 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(pubs(db), ['d4811_ready']);
});

test('D4811 the library publish skips a restricted template and removes its earlier publication', async () => {
  const db = fixture();
  priorPublication(db);
  assert.deepEqual(pubs(db), [RESTRICTED]);
  // Mutation checked: drop the json_each arm from the DELETE → the restricted row is (re)published and survives.
  const r = await call(db, '/published-templates/publish');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(pubs(db), ['d4811_ready']);
  assert.deepEqual(r.body.items.map((t: any) => t.slug), ['d4811_ready']);
});

test('D4811 New envelope: a restricted publication is marked, and its preview and send are 409 with nothing written', async () => {
  const db = fixture();
  priorPublication(db);
  const listed = await call(db, '/published-templates', {}, {}, 'GET');
  assert.equal(listed.status, 200);
  const bySlug = Object.fromEntries(listed.body.items.map((t: any) => [t.slug, t]));
  assert.equal(bySlug[RESTRICTED].safety.restricted, true);
  assert.equal(bySlug[RESTRICTED].safety.incomplete, false);
  const input = { template_slug: RESTRICTED, template_version: 4, recipient_name: 'New signer', recipient_email: 'new@example.test', fields: {}, provider: 'native' };
  // Mutation checked: remove the templateUseRefusal call in preparePublishedContract → preview answers 200.
  const preview = await call(db, '/envelopes/preview', input);
  assert.deepEqual([preview.status, preview.body.code], [409, 'template_restricted']);
  assert.match(preview.body.message, /Legal review required/);
  const send = await call(db, '/envelopes/send', { ...input, preview_sha256: 'a'.repeat(64) });
  assert.deepEqual([send.status, send.body.code], [409, 'template_restricted']);
  assert.equal(envelopes(db), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'contract_envelope_send_requested'"), 0);
});

test('D4811 a complete, reviewed template still previews and sends', async () => {
  const db = fixture();
  assert.equal((await call(db, '/published-templates/d4811_ready/publish', { version: 2 })).status, 200);
  const listed = await call(db, '/published-templates', {}, {}, 'GET');
  assert.deepEqual(listed.body.items[0].safety, { restricted: false, restricted_reason: null, incomplete: false, incomplete_reason: null });
  const input = { template_slug: 'd4811_ready', template_version: 2, recipient_name: 'New signer', recipient_email: 'new@example.test', fields: {}, provider: 'native' };
  const preview = await call(db, '/envelopes/preview', input);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const sent = await call(db, '/envelopes/send', { ...input, preview_sha256: preview.body.body_sha256 });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(envelopes(db), 1);
});

test('D4811 push withholds a restricted publication from the branches and names it', async () => {
  const db = fixture();
  await call(db, '/published-templates/d4811_ready/publish', { version: 2 });
  priorPublication(db);
  const sent: any[] = [];
  const branches = { BRANCH_FR: { publishTemplate: async (payload: any) => { sent.push(payload); return { stored: 1, withdrawn: 0 }; } } };
  // Mutation checked: drop the `withheld` filter in /published-templates/push → the branch receives the restricted slug.
  const r = await call(db, '/published-templates/push', {}, branches);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(sent[0].templates.map((t: any) => t.slug), ['d4811_ready']);
  assert.deepEqual(r.body.withheld, [RESTRICTED]);
  assert.equal(r.body.template_count, 1);
});

test('D4811 the template read carries both overlays, computed on the server', async () => {
  const db = fixture();
  const restricted = await call(db, `/templates/store/${RESTRICTED}`, {}, {}, 'GET');
  assert.equal(restricted.status, 200);
  assert.equal(restricted.body.template.safety.restricted, true);
  assert.match(restricted.body.template.safety.restricted_reason, /Counsel has not reviewed/);
  const stub = await call(db, '/templates/store/d4811_stub', {}, {}, 'GET');
  assert.deepEqual([stub.body.template.safety.restricted, stub.body.template.safety.incomplete], [false, true]);
  const ready = await call(db, '/templates/store/d4811_ready', {}, {}, 'GET');
  assert.deepEqual([ready.body.template.safety.restricted, ready.body.template.safety.incomplete], [false, false]);
});

test('D4811 every envelope send refuses a restricted template before anything is written, looked up or rendered', async () => {
  const db = fixture();
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const base = { adminUserId: 1, adminName: 'HQ owner', recipientUserId: null, recipientEmail: 'new@example.test', recipientName: 'New signer', appUrl: 'https://example.test' };
  // Mutation checked: remove the isRestrictedSlug line in createAndSendEnvelope → the library path sends (an envelope row appears).
  await assert.rejects(createAndSendEnvelope(env, { ...base, documentType: RESTRICTED }),
    (e: unknown) => e instanceof TemplateBodyError && e.reason === 'restricted');
  // The caller-rendered path (the contract send, staged and booklet sends) is refused the same way.
  await assert.rejects(createAndSendEnvelope(env, { ...base, documentType: RESTRICTED, renderedBody: { title: 'T', body: 'Rendered text' } }),
    (e: unknown) => e instanceof TemplateBodyError && e.reason === 'restricted');
  assert.equal(envelopes(db), 0);
  const admin = templateBodyRefusal(new TemplateBodyError('restricted', RESTRICTED), 'admin')!;
  assert.deepEqual([admin.status, admin.code], [409, 'template_restricted']);
  assert.match(admin.message, /Legal review required/);
  assert.match(templateBodyRefusal(new TemplateBodyError('restricted', RESTRICTED), 'member')!.message, /Nothing was sent/);
  // A complete template still goes through the library path.
  const ok = await createAndSendEnvelope(env, { ...base, documentType: 'd4811_ready' });
  assert.ok(ok?.envelope_uuid, 'a complete template sends');
  assert.equal(envelopes(db), 1);
});
