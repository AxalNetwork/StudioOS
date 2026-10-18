// D758 (#1863) — one text per document: every sender reads its library row.
//
// The e-sign route and its callers on real SQLite (`_esign_harness.ts`),
// with `legal_templates` from `ensureLegalTemplatesSchema`, as
// envelope_format_d717.test.ts builds its fixture. Bundled files are read
// from disk to prove the fallback; no provider is called.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/library_one_text_d758.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ADMIN, SENDER, RECIPIENT, freshDb, envFor, call } from './_esign_harness.ts';
import { ensureLegalTemplatesSchema } from '../src/services/legalTemplateStore.ts';
import {
  BUNDLED_SENT_DIRECTLY, LIBRARY_SLUG_FOR, bundledKeySpellings, librarySlugFor, templateKeyForDocType,
} from '../src/services/legalDocTypes.ts';
import { templateBodyFor, isThreeWayNdaType } from '../src/routes/esign.ts';
import { templateFormatFor } from '../src/services/templateFormat.ts';
import { createThreeWayNdaEnvelope, THREE_WAY_NDA_SLUG } from '../src/services/trustEnvelope.ts';
import { deckShareNdaBody, DECK_SHARE_NDA_SLUG } from '../src/routes/deck_share_actions.ts';
import { requestIntroLogic } from '../src/routes/trust.ts';
import { ensureTrustSchema, upsertPairwiseNda } from '../src/services/trust.ts';

const read = (p: string) => readFileSync(p, 'utf8');
const LEGAL = 'cloudflare-worker/src/templates/legal';
/** The bundled file each key falls back to, read from disk (the imports in services/legalTemplates.ts). */
const BUNDLED_FILE: Record<string, string> = Object.fromEntries(
  [...read('cloudflare-worker/src/services/legalTemplates.ts').matchAll(/import\s+(\w+)\s+from '\.\.\/templates\/legal\/([\w.]+)\?raw'/g)]
    .map((m) => [m[1], m[2]]),
);
const KEY_IMPORT: Record<string, string> = {
  investor_nda_v1: 'investorNda', mentor_nda_v1: 'advisorNda', mentor_disclaimer_v1: 'advisorDisclaimer',
  partner_msa_v1: 'partnerMsa', nda_3way_founder_investor_axal_v1: 'nda3Way',
};
const bundled = (key: string) => read(`${LEGAL}/${BUNDLED_FILE[KEY_IMPORT[key]]}`);

/** The five rows whose spellings this task folds, and each row's bundled key. */
const ROWS: Record<string, string> = {
  investor_nda_axal: 'investor_nda_v1',
  mentor_nda_axal: 'mentor_nda_v1',
  mentor_engagement_disclaimer: 'mentor_disclaimer_v1',
  partner_services: 'partner_msa_v1',
  nda_3way_founder_investor_axal: 'nda_3way_founder_investor_axal_v1',
};
const spellingsOf = (slug: string) => [slug, ...Object.keys(LIBRARY_SLUG_FOR).filter((k) => LIBRARY_SLUG_FOR[k] === slug)];

async function setup(bodies: Record<string, string | null> = {}) {
  const db = freshDb();
  const e: any = envFor(db);
  await ensureLegalTemplatesSchema(e);
  const ins = db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub) VALUES (?, ?, 'portfolio', ?, ?)");
  for (const slug of Object.keys(ROWS)) {
    const body = slug in bodies ? bodies[slug] : `ROW ${slug} {{recipient_name}}`;
    ins.run(slug, `Title of ${slug}`, body ?? '', body ? 0 : 1);
  }
  return { db, e };
}

// ─────────────────────────────────────────────── the map

test('D758 the spelling map: seven spellings fold to their rows, anything else is itself', () => {
  assert.deepEqual({ ...LIBRARY_SLUG_FOR }, {
    investor_nda_v1: 'investor_nda_axal', mentor_nda_v1: 'mentor_nda_axal', mentor_disclaimer_v1: 'mentor_engagement_disclaimer',
    partner_msa_v1: 'partner_services', nda_3way_founder_investor_axal_v1: 'nda_3way_founder_investor_axal',
    nda_3way_v1: 'nda_3way_founder_investor_axal', founder_nda_axal: 'founder_nda_v1',
  });
  for (const v of ['tos_v1', 'Subscription Booklet & LPA', 'partner_custom', 'constructor', 'toString']) assert.equal(librarySlugFor(v), v);
  const seeded = ['085_seed_legal_templates.sql', '105_fill_legal_template_bodies.sql', '113_refresh_legal_template_bodies.sql']
    .map((f) => read(`cloudflare-worker/sql/migrations/${f}`)).join('\n');
  for (const k of bundledKeySpellings()) {
    const slug = librarySlugFor(k);
    assert.ok(seeded.includes(`'${slug}'`), `${k} → ${slug} is a seeded library row`);
    assert.equal(templateKeyForDocType(slug), templateKeyForDocType(k), `${k}: the fallback file never changes`);
  }
});

// ─────────────────────────────────────────────── templateBodyFor

test('D758 templateBodyFor reads the row under every spelling, and the bundled file only for a row with no body', async () => {
  const { db, e } = await setup();
  for (const [slug, key] of Object.entries(ROWS)) {
    for (const spelling of spellingsOf(slug)) {
      const got = await templateBodyFor(e, spelling);
      if (BUNDLED_SENT_DIRECTLY.some((x) => x.key === spelling)) {
        // PR 1: partner onboarding still sends its bundled file, even when the row has a body.
        assert.deepEqual(got, { body: bundled(key), source: 'template' }, spelling);
      } else {
        assert.deepEqual(got, { body: `ROW ${slug} {{recipient_name}}`, source: 'store' }, spelling);
      }
    }
  }
  db.exec("UPDATE legal_templates SET is_stub = 1, body_md = ''");
  for (const [slug, key] of Object.entries(ROWS)) {
    for (const spelling of spellingsOf(slug)) {
      assert.deepEqual(await templateBodyFor(e, spelling), { body: bundled(key), source: 'template' }, `${spelling} falls back`);
    }
  }
});

// ─────────────────────────────────────────────── the send

test('D758 a send under a bundled-key spelling records the row\'s slug, its text, its pair and the spelling it was asked for', async () => {
  const { db, e } = await setup({ mentor_engagement_disclaimer: 'Disclaimer for {{recipient_name}}.' });
  const body = { document_type: 'mentor_disclaimer_v1', recipient_email: 'investor@example.test', recipient_name: 'Ivy Investor', provider: 'native' };
  const sent = await call(e, 'POST', '/send', ADMIN, body);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const env = db.prepare('SELECT id, document_type, document_body, doc_kind, axal_party FROM esign_envelopes ORDER BY id DESC LIMIT 1').get() as any;
  assert.equal(env.document_type, 'mentor_engagement_disclaimer');
  assert.equal(env.document_body, 'Disclaimer for Ivy Investor.');
  const format = await templateFormatFor(e, 'mentor_engagement_disclaimer');
  assert.deepEqual([env.doc_kind, env.axal_party], [format.kind, format.party]);
  assert.deepEqual([format.kind, format.party], ['unilateral', 'none']);
  const audit = db.prepare("SELECT meta FROM esign_audit_events WHERE envelope_id = ? AND action = 'envelope_created'").get(env.id) as any;
  assert.equal(JSON.parse(audit.meta).requested_as, 'mentor_disclaimer_v1');
  const again = await call(e, 'POST', '/send', ADMIN, body);
  assert.equal(again.body.already_pending, true, JSON.stringify(again.body));
  // A send pending under the old spelling still dedupes.
  db.exec("UPDATE esign_envelopes SET document_type = 'mentor_disclaimer_v1'");
  const old = await call(e, 'POST', '/send', ADMIN, body);
  assert.equal(old.body.already_pending, true, JSON.stringify(old.body));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get() as any).n, 1);
});

// ─────────────────────────────────────────────── the 3-way NDA

const PARTIES = {
  founder: { user_id: SENDER, email: 'sender@example.test', name: 'Sam Sender' },
  investor: { user_id: RECIPIENT, email: 'Investor@Example.test', name: 'Ivy Investor' },
  appUrl: 'https://app.example.test',
};
const THREE_WAY_ROW = 'NDA between {{founder_name}} ({{founder_email}}) and {{investor_name}} ({{investor_email}}); Axal signs at {{axal_signer_email}}.';

test('D758 the 3-way NDA is its library row, merged, recorded under its slug; an emptied row falls back to the bundled file', async () => {
  const { db, e } = await setup({ nda_3way_founder_investor_axal: THREE_WAY_ROW });
  const r = await createThreeWayNdaEnvelope(e, PARTIES);
  const env = db.prepare('SELECT document_type, document_body FROM esign_envelopes WHERE envelope_uuid = ?').get(r.envelope_uuid) as any;
  assert.equal(env.document_type, THREE_WAY_NDA_SLUG);
  assert.equal(env.document_body, 'NDA between Sam Sender (sender@example.test) and Ivy Investor (Investor@Example.test); Axal signs at legal@axal.vc.');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM esign_recipients').get() as any).n, 3);
  db.exec("UPDATE legal_templates SET is_stub = 1, body_md = '' WHERE slug = 'nda_3way_founder_investor_axal'");
  const fallback = await createThreeWayNdaEnvelope(e, PARTIES);
  const body = (db.prepare('SELECT document_body FROM esign_envelopes WHERE envelope_uuid = ?').get(fallback.envelope_uuid) as any).document_body;
  const values: Record<string, string> = { founder_name: 'Sam Sender', founder_email: 'sender@example.test', investor_name: 'Ivy Investor',
    investor_email: 'Investor@Example.test', axal_signer_email: 'legal@axal.vc', effective_date: new Date().toISOString().slice(0, 10) };
  assert.equal(body, bundled('nda_3way_founder_investor_axal_v1').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => values[k] ?? m), 'the bundled file, merged');
});

test('D758 a 3-way row with a field nobody fills writes nothing, and the intro route answers 409', async () => {
  const { db, e } = await setup({ nda_3way_founder_investor_axal: `${THREE_WAY_ROW} Governed by {{governing_law}}.` });
  await assert.rejects(() => createThreeWayNdaEnvelope(e, PARTIES), (err: any) => err.message === 'unfilled_fields' && err.fields.includes('governing_law'));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'esign_envelopes'").get() as any).n
    ? (db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get() as any).n : 0, 0);
  const deps = (createEnvelope: any) => ({
    lookupFounder: async () => ({ id: SENDER, email: 'sender@example.test', name: 'Sam', role: 'founder' }),
    getPairwise: async () => null, isPairwiseActive: async () => false, upsertPairwise: async () => {}, notify: async () => {},
    createEnvelope,
  });
  const investor = { id: RECIPIENT, role: 'investor', email: 'Investor@Example.test', name: 'Ivy' };
  const refused = await requestIntroLogic(e, investor, { founder_user_id: SENDER }, deps(() => createThreeWayNdaEnvelope(e, PARTIES)) as any);
  assert.equal(refused.status, 409);
  assert.equal((refused.body as any).error, 'template_fields_unfilled');
  assert.match((refused.body as any).message, /Axal VC still has to complete it\. Nothing was sent\./);
  const failed = await requestIntroLogic(e, investor, { founder_user_id: SENDER }, deps(async () => { throw new Error('boom'); }) as any);
  assert.equal(failed.status, 500);
  assert.equal((failed.body as any).error, 'envelope_creation_failed');
});

test('D758 the completion hook activates the pairwise NDA under either 3-way spelling, and touches no other row', async () => {
  assert.ok(isThreeWayNdaType('nda_3way_v1') && isThreeWayNdaType('nda_3way_founder_investor_axal'));
  assert.ok(!isThreeWayNdaType('investor_nda_axal') && !isThreeWayNdaType(null));
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  async function signAll(db: any, e: any, uuid: string) {
    const recs = db.prepare(`SELECT r.signing_token, r.user_id FROM esign_recipients r JOIN esign_envelopes x ON x.id = r.envelope_id
      WHERE x.envelope_uuid = ? ORDER BY r.id`).all(uuid) as any[];
    for (const r of recs) {
      const res = await call(e, 'POST', `/sign/${r.signing_token}`, r.user_id ?? ADMIN, { accepted: true, typed_name: 'Signer', signature_data_url: PNG });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  }
  for (const spelling of ['nda_3way_founder_investor_axal', 'nda_3way_v1']) {
    const { db, e } = await setup({ nda_3way_founder_investor_axal: THREE_WAY_ROW });
    await ensureTrustSchema(e);
    const r = await createThreeWayNdaEnvelope(e, PARTIES);
    if (spelling === 'nda_3way_v1') db.prepare('UPDATE esign_envelopes SET document_type = ? WHERE envelope_uuid = ?').run(spelling, r.envelope_uuid);
    await upsertPairwiseNda(e, SENDER, RECIPIENT, r.envelope_uuid);
    await signAll(db, e, r.envelope_uuid);
    const row = db.prepare('SELECT status FROM pairwise_ndas WHERE nda_envelope_uuid = ?').get(r.envelope_uuid) as any;
    assert.equal(row.status, 'active', spelling);
  }
  // A single-signer 3-way NDA from /legal/send with no pairwise row changes none.
  const { db, e } = await setup({ nda_3way_founder_investor_axal: 'A one-party 3-way NDA for {{recipient_name}}.' });
  await ensureTrustSchema(e);
  db.prepare("INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, intermediary, nda_envelope_uuid, status) VALUES (?, ?, 'axal', 'another-envelope', 'pending')")
    .run(SENDER, RECIPIENT);
  const sent = await call(e, 'POST', '/send', ADMIN, { document_type: 'nda_3way_founder_investor_axal', recipient_email: 'Investor@Example.test', recipient_name: 'Ivy', provider: 'native' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  await signAll(db, e, (db.prepare('SELECT envelope_uuid FROM esign_envelopes ORDER BY id DESC LIMIT 1').get() as any).envelope_uuid);
  assert.deepEqual((db.prepare('SELECT status FROM pairwise_ndas').all() as any[]).map((x) => x.status), ['pending']);
});

// ─────────────────────────────────────────────── deck-share

test('D758 the deck-share NDA is the investor_nda_axal row, merged; an emptied row falls back; a field left is refused', async () => {
  const merge = { recipient_name: 'Vic Viewer', recipient_email: 'vic@example.test', counterparty_name: 'Acme', effective_date: '2026-10-18' };
  const { db, e } = await setup({ investor_nda_axal: 'NDA for {{recipient_name}} with {{counterparty_name}}.' });
  assert.equal(DECK_SHARE_NDA_SLUG, 'investor_nda_axal');
  assert.equal(await deckShareNdaBody(e, merge), 'NDA for Vic Viewer with Acme.');
  db.exec("UPDATE legal_templates SET is_stub = 1, body_md = '' WHERE slug = 'investor_nda_axal'");
  assert.ok((await deckShareNdaBody(e, merge))!.startsWith(bundled('investor_nda_v1').slice(0, 40)));
  db.exec("UPDATE legal_templates SET is_stub = 0, body_md = 'NDA under {{governing_law}}.' WHERE slug = 'investor_nda_axal'");
  await assert.rejects(() => deckShareNdaBody(e, merge), (err: any) => err.message === 'unfilled_fields');
  const src = read('cloudflare-worker/src/routes/deck_share_actions.ts');
  assert.match(src, /deckShareNdaBody\(c\.env,/);
  assert.doesNotMatch(src, /# NDA acceptance/);
  assert.match(src, /refuse\(c, 409, \{ code: 'template_fields_unfilled'/);
  assert.match(src, /refuse\(c, 503, \{ code: 'template_unreadable'/);
  assert.match(src, /nda_template_key: DECK_SHARE_NDA_SLUG/);
});

// ─────────────────────────────────────────────── source: no direct render

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const SRC = walk('cloudflare-worker/src').map((p) => ({ path: relative('cloudflare-worker/src', p), text: read(p) }));

test('D758 only the resolver, the outside thumbnail and the template module render a bundled file', () => {
  const renders = SRC.filter((s) => /\b(renderLegalTemplate|getLegalTemplateBody)\(/.test(s.text)).map((s) => s.path).sort();
  assert.deepEqual(renders, ['routes/admin_contracts.ts', 'routes/esign.ts', 'services/legalTemplates.ts']);
  const esign = SRC.find((s) => s.path === 'routes/esign.ts')!.text;
  const outsideEsign = esign.replace(/export async function templateBodyFor[\s\S]*?\n\}\n/, '');
  assert.doesNotMatch(outsideEsign, /\b(renderLegalTemplate|getLegalTemplateBody)\(/, 'esign.ts renders only in templateBodyFor');
  const admin = SRC.find((s) => s.path === 'routes/admin_contracts.ts')!.text;
  const outsideThumb = admin.replace(/adminContracts\.get\('\/templates\/outside\/:key\/thumbnail\.png'[\s\S]*?\n\}\);\n/, '');
  assert.doesNotMatch(outsideThumb, /\b(renderLegalTemplate|getLegalTemplateBody)\(/, 'admin_contracts.ts renders only in the outside thumbnail');
});

test('D758 every literal documentType a sender passes is a library slug or still sent as its bundled file', () => {
  const seeded = ['085_seed_legal_templates.sql', '105_fill_legal_template_bodies.sql', '113_refresh_legal_template_bodies.sql']
    .map((f) => read(`cloudflare-worker/sql/migrations/${f}`)).join('\n');
  const literals = SRC.filter((s) => s.path.startsWith('routes/') || s.path.startsWith('services/'))
    .flatMap((s) => [...s.text.matchAll(/documentType:\s*'([^']+)'/g)].map((m) => ({ path: s.path, v: m[1] })));
  assert.ok(literals.length >= 1);
  for (const { path, v } of literals) {
    assert.ok(seeded.includes(`'${v}'`) || BUNDLED_SENT_DIRECTLY.some((e) => e.key === v), `${path}: ${v}`);
  }
  for (const e of BUNDLED_SENT_DIRECTLY) {
    assert.match(read(`cloudflare-worker/src/${e.sender}`), new RegExp(`documentType:\\s*'${e.key}'`), `${e.sender} sends ${e.key}`);
  }
});

// ─────────────────────────────────────────────── usage, through the router

import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const USAGE_SECRET = 'unit-test-secret-d758-usage-0123456789abcd';
const contractsApp = new Hono<any>();
contractsApp.route('/contracts', contracts);
contractsApp.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function adminGet(db: DatabaseSync, path: string) {
  const jwt = await new SignJWT({ user_id: 1, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(USAGE_SECRET));
  const res = await contractsApp.request(`/contracts${path}`, { headers: { Authorization: `Bearer ${jwt}` } },
    { JWT_SECRET: USAGE_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

function usageFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'legal_templates', 'legal_template_versions', 'documents', 'projects', 'esign_envelopes', 'esign_recipients',
    'pairwise_ndas', 'partner_deals', 'activity_logs', 'deals']) db.exec(tableFromBaseline(baseline, t));
  db.exec(read('cloudflare-worker/sql/migrations/434_contract_template_publications.sql'));
  db.prepare("INSERT INTO users(id,role,name,email,is_active) VALUES(1,'admin','HQ owner','hq@example.test',1), (2,'partner','Pat','pat@example.test',1), (3,'investor','Ivy','ivy@example.test',1)").run();
  const row = db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub, is_active) VALUES (?, ?, 'portfolio', 'Body.', 0, 1)");
  for (const [slug, title] of [['Subscription Booklet & LPA', 'Subscription Booklet & LPA'], ['nda_3way_founder_investor_axal', '3-Way NDA'],
    ['partner_services', 'Partner Services / MSA v1'], ['partner_custom', 'Partner Custom Deal'], ['investor_nda_axal', 'Investor NDA']]) row.run(slug, title);
  const env = db.prepare("INSERT INTO esign_envelopes (id, envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, audit_log) VALUES (?, ?, 3, ?, 'T', 'B', 'h', 'sent', 1, '[]')");
  env.run(1, 'env-lpa', 'Subscription Booklet & LPA');
  env.run(2, 'env-3way', 'nda_3way_v1');
  env.run(3, 'env-partner', 'partner_msa_v1');
  env.run(4, 'env-inv', 'investor_nda_v1');
  db.prepare("INSERT INTO pairwise_ndas (id, party_a_user_id, party_b_user_id, intermediary, nda_envelope_uuid, status) VALUES (1, 1, 3, 'axal', 'env-3way', 'pending')").run();
  db.prepare("INSERT INTO partner_deals (id, user_id, deal_type, proposal_json, status, envelope_id) VALUES (1, 2, 'equity_partnership', '{}', 'active', 3), (2, 2, 'services_partnership', '{}', 'proposed', NULL)").run();
  return db;
}

test('D758 the "[n] uses" chip counts each document once under its row, and the drill-down lists the same rows', async () => {
  const db = usageFixture();
  const store = await adminGet(db, '/templates/store?recorded=true');
  assert.equal(store.status, 200, JSON.stringify(store.body));
  const uses = Object.fromEntries(store.body.items.map((t: any) => [t.slug, t.usage_count]));
  assert.deepEqual(uses, {
    'Subscription Booklet & LPA': 1,
    nda_3way_founder_investor_axal: 1,
    partner_services: 2,
    partner_custom: 0,
    investor_nda_axal: 1,
  });
  for (const [slug, n] of Object.entries(uses)) {
    const d = await adminGet(db, `/templates/${encodeURIComponent(slug)}/usage`);
    assert.equal(d.status, 200, `${slug}: ${JSON.stringify(d.body)}`);
    assert.equal(d.body.items.length, n, `${slug}: the drill-down equals the chip`);
  }
});
