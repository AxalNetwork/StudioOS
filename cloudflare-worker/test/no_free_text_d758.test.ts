// D758 (#1862) — no free text on any send path.
//
// A send draws its body only from the library: the store's active non-stub
// row, then the bundled `.md`. `buildTemplateBody` and its inline paragraphs
// and "Closing Binder" fallback are gone. A document with no body is refused
// (409 `template_has_no_body`) before the envelope, its recipient or any
// email is written; a store that cannot be read is 503 `template_unreadable`,
// never "no body". `routes/legal.ts` reads its 18 documents from the store,
// and the incorporate wizard writes no placeholder.
//
// The e-sign route runs on `_esign_harness.ts` (real SQLite); the exploring
// binding and the /legal routes run on their own routers over node:sqlite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { freshDb, envFor, makeD1, call, ADMIN, SENDER, EXPLORER, JWT_SECRET } from './_esign_harness.ts';
import { TemplateBodyError, templateBodyRefusal } from '../src/routes/esign.ts';
import { ensureLegalTemplatesSchema } from '../src/services/legalTemplateStore.ts';
import { COUNSEL_DRAFT_SLUGS, STUB_LINE } from '../src/services/templateFormat.ts';
import adminExploring from '../src/routes/admin_exploring.ts';
import legal from '../src/routes/legal.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from '../../frontend/test/_codeOnly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const src = (f: string) => readFileSync(resolve(SRC, f), 'utf8');

const ADMIN_STUB = 'No body in the store yet, so nothing was sent. Add its body under Contracts › Templates.';
const ADMIN_COUNSEL = 'Stub — counsel to draft. This document has no text until counsel supplies it, so nothing was sent.';
const MEMBER = 'This document is not ready to send: it has no text in the library yet. Nothing was sent.';
const UNREADABLE = 'The template could not be read, so nothing was sent. Try again in a moment.';

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const saved = [console.warn, console.error, console.log];
  console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try { return await fn(); } finally { [console.warn, console.error, console.log] = saved; }
};

/** Counts outbound fetches (the e-mail provider) while `fn` runs. */
async function fetchesDuring<T>(fn: () => Promise<T>): Promise<{ out: T; fetches: number }> {
  const saved = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches += 1; return new Response('{}', { status: 200 }); }) as any;
  try { return { out: await fn(), fetches }; } finally { globalThis.fetch = saved; }
}

async function esignDb() {
  const db = freshDb();
  const e = envFor(db, undefined, { RESEND_API_KEY: 're_test_key_example' });
  await ensureLegalTemplatesSchema(e as any);
  return { db, e };
}
/** Rows in a table the route creates on first use: a missing table holds none. */
const rowsIn = (db: DatabaseSync, table: string) => {
  try { return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n); } catch { return 0; }
};
const counts = (db: DatabaseSync) => ({ envelopes: rowsIn(db, 'esign_envelopes'), recipients: rowsIn(db, 'esign_recipients') });
const send = (e: any, who: number, docType: string) =>
  call(e, 'POST', '/send', who, { document_type: docType, recipient_email: 'ivy@example.test', recipient_name: 'Ivy Investor', provider: 'native' });

// ── the send resolver ───────────────────────────────────────────────────────

test('D758 no row and no bundled key: 409 template_has_no_body, and nothing is written or mailed', async () => {
  const { db, e } = await esignDb();
  const before = counts(db);
  const { out: r, fetches } = await fetchesDuring(() => quiet(() => send(e, ADMIN, 'binding_agreement')));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'template_has_no_body');
  assert.equal(r.body.message, ADMIN_STUB);
  assert.deepEqual(counts(db), before, 'no envelope and no recipient row');
  assert.equal(fetches, 0, 'no email');
});

test('D758 a counsel stub is refused with the counsel sentence; any other stub with the store line', async () => {
  const { db, e } = await esignDb();
  const stub = db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub) VALUES (?, ?, 'fund', '', 1)");
  stub.run('lpa_initial', 'Initial LPA');
  stub.run('finders_fee_intro_agreement', "Finder's Fee / Intro Agreement");
  const counsel = await quiet(() => send(e, ADMIN, 'lpa_initial'));
  assert.equal(counsel.status, 409);
  assert.equal(counsel.body.error, 'template_has_no_body');
  assert.ok(counsel.body.message.startsWith('Stub — counsel to draft.'), counsel.body.message);
  const other = await quiet(() => send(e, ADMIN, 'finders_fee_intro_agreement'));
  assert.equal(other.status, 409);
  assert.ok(other.body.message.startsWith('No body in the store yet'), other.body.message);
  assert.equal(counts(db).envelopes, 0);
});

test('D758 a filled spaced slug sends its row: the body merged, titled from the row, no inline text', async () => {
  const { db, e } = await esignDb();
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub) VALUES (?, ?, 'fund', ?, 0)")
    .run('Subscription Booklet & LPA', 'Subscription Booklet & LPA (LP)', 'SPECIMEN {{recipient_name}}');
  const r = await quiet(() => send(e, ADMIN, 'Subscription Booklet & LPA'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const env = db.prepare('SELECT document_title, document_body FROM esign_envelopes').get() as any;
  assert.ok(env.document_body.startsWith('SPECIMEN Ivy Investor'), env.document_body);
  assert.equal(env.document_title, 'Subscription Booklet & LPA (LP)');
  assert.equal(/Closing Binder|Counterparty subscribes/.test(env.document_body), false);
});

test('D758 a bundled key whose row is a stub still sends the bundled body', async () => {
  const { db, e } = await esignDb();
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub) VALUES ('founder_nda_v1', 'Founder NDA', 'portfolio', '', 1)").run();
  const r = await quiet(() => send(e, SENDER, 'founder_nda_v1'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const env = db.prepare('SELECT document_body FROM esign_envelopes').get() as any;
  const { getLegalTemplateBody } = await import('../src/services/legalTemplates.ts');
  const bundled = getLegalTemplateBody('founder_nda_v1' as any);
  const line = bundled.split('\n').find((l) => l.trim().length > 40 && !l.includes('{{'))!;
  assert.ok(line, 'the bundled body has a plain line to look for');
  assert.ok(env.document_body.includes(line.trim()), 'the envelope carries the bundled text');
  assert.equal(/Closing Binder/.test(env.document_body), false);
});

test('D758 an unreadable store is 503 template_unreadable, never "no body", and writes nothing', async () => {
  const { db } = await esignDb();
  const d1 = makeD1(db);
  const broken = {
    ...d1,
    prepare(sql: string) {
      if (/FROM legal_templates/.test(sql)) throw new Error('D1_ERROR: simulated outage');
      return d1.prepare(sql);
    },
  };
  const e = envFor(db, undefined, { DB: broken });
  const r = await quiet(() => send(e, ADMIN, 'Subscription Booklet & LPA'));
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error, 'template_unreadable');
  assert.equal(r.body.message, UNREADABLE);
  assert.equal(counts(db).envelopes, 0);
});

test('D758 templateBodyRefusal: the sentence for each reason, audience and counsel case, and null otherwise', () => {
  const counselSlug = [...COUNSEL_DRAFT_SLUGS][0];
  assert.deepEqual(templateBodyRefusal(new TemplateBodyError('no_body', 'binding_agreement'), 'admin'),
    { status: 409, code: 'template_has_no_body', message: ADMIN_STUB });
  assert.deepEqual(templateBodyRefusal(new TemplateBodyError('no_body', counselSlug), 'admin'),
    { status: 409, code: 'template_has_no_body', message: ADMIN_COUNSEL });
  for (const slug of ['binding_agreement', counselSlug]) {
    assert.deepEqual(templateBodyRefusal(new TemplateBodyError('no_body', slug), 'member'),
      { status: 409, code: 'template_has_no_body', message: MEMBER });
  }
  for (const audience of ['admin', 'member'] as const) {
    assert.deepEqual(templateBodyRefusal(new TemplateBodyError('unreadable', 'ppm'), audience),
      { status: 503, code: 'template_unreadable', message: UNREADABLE });
  }
  assert.equal(templateBodyRefusal(new Error('boom'), 'admin'), null);
  assert.equal(templateBodyRefusal(null, 'member'), null);
  assert.equal(STUB_LINE, 'No body in the store yet.');
});

test('D758 the preview of an offered type with no body answers 409 with the member sentence', async () => {
  const { e } = await esignDb();
  // Every type offered today has a bundled body, so no offered type reaches
  // the no-body branch on real data. The route is pinned in source instead,
  // and an unoffered type still answers 404.
  const r = await call(e, 'GET', '/templates/not_a_type', SENDER);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'template_not_offered');
  const code = codeOnly(src('routes/esign.ts'));
  const route = code.slice(code.indexOf("esign.get('/templates/:doc_type'"));
  assert.match(route.slice(0, route.indexOf('const tokens')), /templateBodyRefusal\(new TemplateBodyError\('no_body', docType\), 'member'\)/);
});

// ── no inline text anywhere ────────────────────────────────────────────────

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|mjs)$/.test(f) ? [p] : [];
  });
}

test('D758 source: no buildTemplateBody and no Closing Binder text in cloudflare-worker/src', () => {
  for (const f of walk(SRC)) {
    const text = readFileSync(f, 'utf8');
    for (const phrase of ['buildTemplateBody', 'Closing Binder Agreement', 'constitutes the Closing Binder']) {
      assert.equal(text.includes(phrase), false, `${f} holds "${phrase}"`);
    }
  }
});

test('D758 source: routes/legal.ts writes no placeholder and LEGAL_PAGE_DOCUMENTS carries no content', () => {
  const s = src('routes/legal.ts');
  assert.equal(s.includes('[Counsel-reviewed body managed in the FastAPI backend.]'), false);
  const block = s.slice(s.indexOf('const LEGAL_PAGE_DOCUMENTS'), s.indexOf('];', s.indexOf('const LEGAL_PAGE_DOCUMENTS')));
  assert.equal((block.match(/\{ key: '/g) || []).length, 18);
  assert.equal(/content|title/.test(block.replace(/^\/\/.*$/gm, '')), false);
  assert.equal(/\bconst TEMPLATES\b/.test(s), false);
});

test('D758 source: partner onboarding and profiling hand a refusal to templateBodyRefusal with their audience', () => {
  const po = codeOnly(src('routes/partner_onboarding.ts'));
  assert.match(po, /templateBodyRefusal\(e, 'member'\)/);
  const pr = codeOnly(src('routes/profiling.ts'));
  assert.match(pr, /templateBodyRefusal\(e, 'admin'\)/);
  assert.match(pr, /esign_refusal: esignRefusal/);
  // The catch no longer only logs: a refusal is kept for the response.
  const catchBlock = pr.slice(pr.indexOf("const refusal = templateBodyRefusal(e, 'admin')") - 40, pr.indexOf('esign_refusal: esignRefusal'));
  assert.match(catchBlock, /if \(refusal\) esignRefusal = \{ code: refusal\.code, message: refusal\.message \}/);
  assert.match(catchBlock, /else console\.error/);
});

// ── the exploring binding ──────────────────────────────────────────────────

const exploringApp = new Hono<any>();
exploringApp.route('/', adminExploring);
exploringApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function bind(db: DatabaseSync) {
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await exploringApp.request(`/users/${EXPLORER}/binding`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}',
  }, envFor(db, undefined, { RESEND_API_KEY: 're_test_key_example' }));
  return { status: res.status, body: await res.json() as any };
}
const reviews = (db: DatabaseSync) => {
  try { return (db.prepare('SELECT COUNT(*) AS n FROM user_role_review').get() as any).n; } catch { return 0; }
};

test('D758 the exploring binding: the default type has no row, so 409 and nothing recorded; with a body, 200', async () => {
  const { db } = await esignDb();
  const refused = await fetchesDuring(() => quiet(() => bind(db)));
  assert.equal(refused.out.status, 409, JSON.stringify(refused.out.body));
  assert.equal(refused.out.body.error, 'template_has_no_body');
  assert.equal(refused.out.body.message, ADMIN_STUB);
  assert.equal(reviews(db), 0);
  assert.equal(counts(db).envelopes, 0);
  assert.equal(refused.fetches, 0);

  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub) VALUES ('binding_agreement', 'Binding Agreement', 'gp', 'BINDING SPECIMEN for {{recipient_name}}', 0)").run();
  const sent = await fetchesDuring(() => quiet(() => bind(db)));
  assert.equal(sent.out.status, 200, JSON.stringify(sent.out.body));
  assert.equal(reviews(db), 1);
  const env = db.prepare('SELECT document_title, document_body FROM esign_envelopes').get() as any;
  assert.equal(env.document_title, 'Binding Agreement');
  assert.ok(env.document_body.startsWith('BINDING SPECIMEN for Eli Explorer'));
});

// ── /legal: the library, read from the store ───────────────────────────────

const BASELINE = readFileSync(resolve(SRC, '../sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
const LEGAL_KEYS = ['operating_agreement', 'carried_interest', 'ic_charter', 'service_agreement', 'lpa', 'ppm', 'subscription',
  'mgmt_company', 'safe', 'term_sheet', 'bylaws', 'equity_split', 'ip_license', 'spa', 'voting_rights', 'form_adv', 'aml_kyc', 'section_83b'];
const LAYER: Record<string, string> = {
  operating_agreement: 'gp', carried_interest: 'gp', ic_charter: 'gp', service_agreement: 'gp',
  lpa: 'fund', ppm: 'fund', subscription: 'fund', mgmt_company: 'fund',
  form_adv: 'compliance', aml_kyc: 'compliance', section_83b: 'compliance',
};
const FOUNDER = 10, LADMIN = 1, INVESTOR = 30;
function legalDb({ library = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'entities', 'documents', 'legal_templates', 'legal_template_versions']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(LADMIN, 'admin', 'Hq Admin', 'hq@example.test', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001)");
  if (library) {
    const t = db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub, is_active) VALUES (?, ?, 'gp', ?, 0, 1)");
    for (const k of LEGAL_KEYS) t.run(k, `Store title of ${k}`, `BODY OF ${k} for {{company_name}}`);
  }
  return db;
}
const legalApp = new Hono<any>();
legalApp.route('/legal', legal);
legalApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
async function legalCall(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const role = who === LADMIN ? 'admin' : who === FOUNDER ? 'founder' : 'investor';
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await legalApp.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D758 GET /legal/templates: the 18 in order, titled from the store, for founders and admins; 403 otherwise', async () => {
  const db = legalDb();
  for (const who of [FOUNDER, LADMIN]) {
    const r = await legalCall(db, who, 'GET', '/legal/templates');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body));
    assert.deepEqual(r.body.map((t: any) => t.key), LEGAL_KEYS);
    for (const t of r.body) {
      assert.deepEqual(Object.keys(t).sort(), ['has_body', 'key', 'layer', 'layer_label', 'title']);
      assert.equal(t.title, `Store title of ${t.key}`);
      assert.equal(t.layer, LAYER[t.key] ?? 'portfolio');
      assert.equal(t.has_body, true);
    }
  }
  const investor = await legalCall(db, INVESTOR, 'GET', '/legal/templates');
  assert.equal(investor.status, 403);
  assert.equal(investor.body.error, 'legal_library_forbidden');
  assert.equal(investor.body.message, 'The legal library is for founders and admins.');
  // A key with no row is left out.
  db.prepare("DELETE FROM legal_templates WHERE slug = 'ppm'").run();
  const fewer = await legalCall(db, FOUNDER, 'GET', '/legal/templates');
  assert.deepEqual(fewer.body.map((t: any) => t.key), LEGAL_KEYS.filter((k) => k !== 'ppm'));
});

test('D758 GET /legal/templates/:key reads the row body; a stub reads no body; an unknown key is 404; generate is gone', async () => {
  const db = legalDb();
  const r = await legalCall(db, FOUNDER, 'GET', '/legal/templates/lpa');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { key: 'lpa', title: 'Store title of lpa', layer: 'fund', layer_label: 'Fund Formation (LP Level)', has_body: true, body: 'BODY OF lpa for {{company_name}}' });
  db.prepare("UPDATE legal_templates SET is_stub = 1 WHERE slug = 'lpa'").run();
  const stub = await legalCall(db, FOUNDER, 'GET', '/legal/templates/lpa');
  assert.equal(stub.body.has_body, false);
  assert.equal(stub.body.body, null);
  assert.equal((await legalCall(db, FOUNDER, 'GET', '/legal/templates/nope')).status, 404);
  assert.equal((await legalCall(db, INVESTOR, 'GET', '/legal/templates/lpa')).status, 403);
  assert.equal((await legalCall(db, LADMIN, 'POST', '/legal/templates/term_sheet/generate', {})).status, 404);
});

test('D758 the wizard writes no placeholder: an empty store lists each item under pending_body; a body is written from the store', async () => {
  const db = legalDb({ library: false });
  const wizard = () => quiet(() => legalCall(db, LADMIN, 'POST', '/legal/incorporate/wizard', { project_id: 1, jurisdiction_id: 'us_de_ccorp', company_name: 'Acme, Inc.' }));
  const r = await wizard();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const docs = () => (db.prepare('SELECT template_name, content FROM documents ORDER BY id').all() as any[]);
  for (const k of ['certificate_of_incorporation_de', 'stock_purchase_agreement']) {
    assert.equal(docs().some((d) => d.template_name === k), false, `${k} written as a placeholder`);
    const p = r.body.pending_body.find((x: any) => x.template_key === k);
    assert.ok(p, `${k} in pending_body`);
    assert.equal(p.reason, 'template_has_no_body');
    assert.ok(p.title);
  }
  assert.equal(docs().some((d) => /Counsel-reviewed body managed/.test(d.content)), false);

  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub, is_active) VALUES ('certificate_of_incorporation_de', 'Certificate', 'portfolio', 'CERTIFICATE OF {{company_name}}', 0, 1)").run();
  const again = await wizard();
  assert.equal(again.status, 200);
  const cert = docs().find((d) => d.template_name === 'certificate_of_incorporation_de');
  assert.ok(cert, 'the certificate was written from the store');
  assert.equal(cert.content, 'CERTIFICATE OF Acme, Inc.');
  assert.equal(again.body.pending_body.some((x: any) => x.template_key === 'certificate_of_incorporation_de'), false);
});

test('D758 every key in every jurisdiction kit has a JURISDICTION_TEMPLATES title', () => {
  const s = src('routes/legal.ts');
  const kits = [...s.matchAll(/templates: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]));
  assert.ok(kits.length > 10);
  const jt = s.slice(s.indexOf('const JURISDICTION_TEMPLATES'), s.indexOf('};', s.indexOf('const JURISDICTION_TEMPLATES')));
  for (const k of new Set(kits)) assert.ok(new RegExp(`\\b${k}: \\{`).test(jt), `${k} has no JURISDICTION_TEMPLATES title`);
});
