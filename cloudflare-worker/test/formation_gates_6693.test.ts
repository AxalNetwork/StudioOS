/**
 * D6693 (#6693, plan key C3 of #6680): order gates for the formation catalogue,
 * the signed-in catalogue read and HQ's pause.
 *
 * Real schema (`loadSchema`), real services and routes, synthetic catalogue,
 * partners, templates and reviews. The catalogue price is injected (`priceOf`),
 * so no Stripe mirror is needed. Every firm, person and figure is fictional.
 *
 * The schema is the fully migrated one, so it already holds the seeded version 1
 * ("legacy parity", D6690), published and current. The fixture lays its own
 * version 2 beside it and makes that the current one, as HQ's next published
 * version would be; its rows take ids from 9001 so they never meet the seed's.
 *
 *   v2 (published, current; the seeded v1 stays published, no longer current)
 *     GB  gb_ltd       orderable; partner P1 (priority 10) and P2 (priority 20) cover it;
 *                      template gb_articles needs counsel; one blocking fact
 *     US  us_wy_ccorp  legacy_gate '1'; today's rule (price; Wyoming charter)
 *     US  us_de_ccorp  legacy_gate '1'
 *
 * The issue's Done-when cases, each a test below:
 *   · a stale blocking fact → not orderable, `facts` named
 *   · suspending the only partner → not orderable, no catalogue edit
 *   · a US-jurisdiction template review does not open a GB form
 *   · a legacy form reads orderable on price alone, as today
 *   · pausing a form removes it from orderable on the next read
 *   · the signed-in read never returns `cost_minor`
 *
 * Mutation-checked (each fails a named assertion below):
 *   · the jurisdiction check dropped from templateApprovedFor → "a US review does not open GB"
 *   · the age check dropped from the facts gate → "a stale blocking fact closes it"
 *   · the pause gate dropped → "a pause closes it on the next read"
 *   · `ORDER BY c.priority` reversed → "the default partner is the lowest priority number"
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_gates_6693.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { formGates, templateApprovedFor, jurisdictionIsCountry, freshSince, DEFAULT_FACT_MAX_AGE_DAYS, factMaxAgeDays, LEGACY_COUNSEL, type PriceOf } from '../src/services/formationGates.ts';
import { readCatalogue, availabilityOf } from '../src/routes/formation_catalogue.ts';
import catalogueRouter from '../src/routes/formation_catalogue.ts';
import adminRouter from '../src/routes/admin_formation_catalogue.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { currentVersion, versionByNumber } from '../src/services/formationCatalogue.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { readFileSync } from 'node:fs';

const scratch = mkdtempSync(join(tmpdir(), 'formation-gates-6693-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, SCHEMA_OPTIONS);
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

const JWT_SECRET = 'synthetic-6693-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2, FOUNDER = 3, COUNSEL = 4;
const TODAY = '2026-11-16';
const GB_BODY = '# Articles of association (synthetic)\n\n1. Name\nThe company is a private company limited by shares.';
const WY_BODY = '# Articles of incorporation, Wyoming (synthetic)';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const priced: PriceOf = async () => ({ amount_minor: 49900, currency: 'usd' });
const unpriced: PriceOf = async () => null;
// The fixture's own version and its first row id, clear of the seeded version 1 (D6690).
const VERSION = 2, V = 9001;
const GB = V, US = V + 1, GB_LTD = V, WY = V + 1, DE = V + 2, SOURCE = V;
let n = 0;

type Over = { factCheckedOn?: string; factStatus?: string; factSourced?: boolean; offerMode?: string };
function fixture(o: Over = {}) {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, SCHEMA_OPTIONS);
  const user = db.prepare('INSERT INTO users(id, email, name, role) VALUES (?, ?, ?, ?)');
  user.run(SUPER, 'super@example.invalid', 'Sam Super', 'admin');
  user.run(ADMIN, 'plain@example.invalid', 'Pat Plain', 'admin');
  user.run(FOUNDER, 'founder@example.invalid', 'Fay Founder', 'founder');
  user.run(COUNSEL, 'counsel@example.invalid', 'Cal Counsel', 'admin');
  db.prepare('DELETE FROM super_admins').run();
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  // The seeded version 1 steps down first: one version is current at a time.
  db.exec(`UPDATE formation_catalogue_versions SET is_current = 0 WHERE is_current = 1`);
  db.exec(`
    INSERT INTO formation_catalogue_versions (id, version, status, is_current, notes) VALUES (${V}, ${VERSION}, 'draft', 0, 'HQ only: synthetic note');
    INSERT INTO formation_sources (id, kind, title, url) VALUES (${SOURCE}, 'registry', 'Synthetic registry guidance', 'https://registry.example.invalid/guide');
    INSERT INTO formation_jurisdictions (id, version_id, country, registry_name) VALUES (${GB}, ${V}, 'GB', 'Synthetic Registry'), (${US}, ${V}, 'US', NULL);
    INSERT INTO formation_entity_forms (id, version_id, jurisdiction_id, form_key, label, offer_mode, legacy_gate) VALUES
      (${GB_LTD}, ${V}, ${GB}, 'gb_ltd', 'Private limited company', '${o.offerMode ?? 'orderable'}', NULL),
      (${WY}, ${V}, ${US}, 'us_wy_ccorp', 'Wyoming C corporation', 'orderable', '1'),
      (${DE}, ${V}, ${US}, 'us_de_ccorp', 'Delaware C corporation', 'orderable', '1');
    INSERT INTO formation_form_facts (version_id, form_id, fact_key, value, status, blocking, source_id, checked_on) VALUES
      (${V}, ${GB_LTD}, 'min_directors', '1', '${o.factStatus ?? 'recorded'}', 1, ${o.factSourced === false ? 'NULL' : SOURCE}, '${o.factCheckedOn ?? '2026-10-01'}'),
      (${V}, ${GB_LTD}, 'share_capital', NULL, 'not_recorded', 0, NULL, NULL);
    INSERT INTO formation_fee_lines (version_id, form_id, line_key, label, payee, collected_by, currency, amount_cents, timing) VALUES
      (${V}, ${GB_LTD}, 'registry_fee', 'Registry fee', 'Synthetic Registry', 'payee', 'GBP', NULL, 'at_formation');
    INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, template_key, counsel_required, position) VALUES
      (${V}, ${GB_LTD}, 'articles', 'before_filing', 'document', 'axal', 'Articles of association', 'gb_articles', 1, 1),
      (${V}, ${GB_LTD}, 'filing', 'filing', 'filing', 'provider', 'File with the registry', NULL, 1, 2);
    INSERT INTO partners (id, uid, name, email) VALUES (10, 'firm-a', 'Made-up Formations', 'a@example.invalid'), (11, 'firm-b', 'Fictional Filings', 'b@example.invalid');
    INSERT INTO formation_partners (id, partner_id, status, dpa_signed_on) VALUES (1, 10, 'verified', '2026-09-01'), (2, 11, 'verified', '2026-09-01');
    INSERT INTO formation_partner_credentials (formation_partner_id, country, licence_type, licence_number, regulator, valid_until) VALUES
      (1, 'GB', 'tcsp', 'SYN-1', 'Synthetic regulator', '2027-12-31'), (2, 'GB', 'tcsp', 'SYN-2', 'Synthetic regulator', '2027-12-31');
    INSERT INTO formation_partner_coverage (id, formation_partner_id, country, form_key, service, priority, is_on) VALUES
      (1, 1, 'GB', 'gb_ltd', 'formation', 20, 1), (2, 2, 'GB', 'gb_ltd', 'formation', 10, 1);
    INSERT INTO formation_partner_prices (coverage_id, founder_price_minor, cost_minor, currency, cadence, effective_from) VALUES
      (1, 39900, 25000, 'GBP', 'one_time', '2026-01-01'), (2, 34900, 21000, 'GBP', 'one_time', '2026-01-01');
  `);
  db.exec(`UPDATE formation_catalogue_versions SET status = 'published', is_current = 1, published_by = ${SUPER}, published_at = '2026-11-01T00:00:00Z' WHERE id = ${V}`);
  const tpl = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, is_stub) VALUES (?, ?, 'formation', ?, 1, 1, 0)`);
  tpl.run('gb_articles', 'Articles of association', GB_BODY);
  tpl.run('articles_of_incorporation_wy', 'Articles of incorporation (Wyoming)', WY_BODY);
  const jti = grantWriteBar(db, SUPER);
  const env = { DB: d1Over(db) as any, JWT_SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env, jti };
}
type F = ReturnType<typeof fixture>;
function review(f: F, slug: string, body: string, jurisdiction: string, decision = 'approved') {
  f.db.prepare(`INSERT INTO legal_reviews (object_kind, object_ref, version, version_sha256, review_type, jurisdiction, reviewer_id, requested_by, decision, decided_by, decided_at)
    VALUES ('template', ?, 1, ?, 'initial', ?, ?, ?, ?, ?, '2026-11-02T00:00:00Z')`).run(slug, sha(body), jurisdiction, COUNSEL, ADMIN, decision, COUNSEL);
}
const gate = (g: any, key: string) => g.gates.find((x: any) => x.key === key);
const opts = { today: TODAY, priceOf: priced };

test('a GB form with every gate met is orderable; the default partner is the lowest priority number', async () => {
  const f = fixture();
  review(f, 'gb_articles', GB_BODY, 'GB');
  const g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.deepEqual(g.gates.filter((x: any) => !x.pass), [], JSON.stringify(g.gates));
  assert.equal(g.orderable, true);
  // mutation: priority order reversed → coverage 1.
  assert.equal(g.default_partner!.coverage_id, 2, 'the default partner is the lowest priority number');
});

test('a stale blocking fact closes it, naming the facts gate; a disputed or unsourced one too', async () => {
  const f = fixture({ factCheckedOn: '2026-01-02' });
  review(f, 'gb_articles', GB_BODY, 'GB');
  const g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.equal(g.orderable, false);
  // mutation: age check dropped → facts passes.
  assert.equal(gate(g, 'facts').pass, false, 'a stale blocking fact closes it');
  assert.match(gate(g, 'facts').detail, /min_directors/);
  assert.deepEqual(g.gates.filter((x: any) => !x.pass).map((x: any) => x.key), ['facts']);
  const d = fixture({ factStatus: 'disputed' });
  assert.match(gate((await formGates(d.env, 'gb_ltd', opts))!, 'facts').detail, /Disputed: min_directors/);
  const u = fixture({ factSourced: false, factStatus: 'provisional' });
  assert.equal(gate((await formGates(u.env, 'gb_ltd', opts))!, 'facts').pass, false, 'a fact without a source is not fresh');
  // A longer allowed age opens the stale fact; it is a config value.
  assert.equal(gate((await formGates(f.env, 'gb_ltd', { ...opts, maxAgeDays: 365 }))!, 'facts').pass, true);
  assert.equal(freshSince(TODAY, DEFAULT_FACT_MAX_AGE_DAYS), '2026-05-17');
  assert.equal(factMaxAgeDays({ FORMATION_FACT_MAX_AGE_DAYS: '90' } as any), 90);
  assert.equal(factMaxAgeDays({ FORMATION_FACT_MAX_AGE_DAYS: 'x' } as any), 183);
});

test('suspending partners closes the form with no catalogue edit; the gates name the partner', async () => {
  const f = fixture();
  review(f, 'gb_articles', GB_BODY, 'GB');
  f.db.exec(`UPDATE formation_partners SET status = 'suspended' WHERE id = 2`);
  let g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.equal(g.orderable, true, 'the other verified partner still covers it');
  assert.equal(g.default_partner!.coverage_id, 1);
  f.db.exec(`UPDATE formation_partners SET status = 'suspended' WHERE id = 1`);
  g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.equal(g.orderable, false);
  assert.deepEqual(g.gates.filter((x: any) => !x.pass).map((x: any) => x.key), ['partner', 'credential', 'data_agreement']);
  assert.equal(g.default_partner, null);
});

test('an expired credential or an unsigned data agreement closes it', async () => {
  const f = fixture();
  review(f, 'gb_articles', GB_BODY, 'GB');
  f.db.exec(`UPDATE formation_partner_credentials SET valid_until = '2026-11-15'`);
  let g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.deepEqual(g.gates.filter((x: any) => !x.pass).map((x: any) => x.key), ['credential', 'data_agreement']);
  f.db.exec(`UPDATE formation_partner_credentials SET valid_until = '2027-12-31'; UPDATE formation_partners SET dpa_signed_on = NULL`);
  g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.deepEqual(g.gates.filter((x: any) => !x.pass).map((x: any) => x.key), ['data_agreement']);
});

test('a US-jurisdiction template review does not open a GB form; a review of an older version does not either', async () => {
  const f = fixture();
  review(f, 'gb_articles', GB_BODY, 'US');
  // mutation: jurisdiction check dropped → approved.
  assert.equal(await templateApprovedFor(f.env, 'gb_articles', 'GB'), false, 'a US review does not open GB');
  const g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.deepEqual(g.gates.filter((x: any) => !x.pass).map((x: any) => x.key), ['templates']);
  review(f, 'gb_articles', 'an older body', 'GB');
  assert.equal(await templateApprovedFor(f.env, 'gb_articles', 'GB'), false, 'a review bound to another version does not count');
  review(f, 'gb_articles', GB_BODY, 'GB', 'approved_with_conditions');
  assert.equal(await templateApprovedFor(f.env, 'gb_articles', 'GB'), false, 'conditions are not an approval');
  review(f, 'gb_articles', GB_BODY, 'gb');
  assert.equal(await templateApprovedFor(f.env, 'gb_articles', 'GB'), true);
  assert.equal(jurisdictionIsCountry('US-WY', 'US'), true);
  assert.equal(jurisdictionIsCountry('USA', 'US'), false);
});

test('a legacy form reads orderable on price alone, as today; Wyoming also needs its charter', async () => {
  const f = fixture();
  const de = (await formGates(f.env, 'us_de_ccorp', opts))!;
  assert.equal(de.legacy, true);
  assert.equal(de.orderable, true, 'price alone, with no partner, review or fact');
  assert.deepEqual(de.gates.map((x: any) => x.key), ['price', 'counsel', 'not_paused']);
  assert.equal((await formGates(f.env, 'us_de_ccorp', { today: TODAY, priceOf: unpriced }))!.orderable, false);
  assert.equal((await formGates(f.env, 'us_wy_ccorp', opts))!.orderable, true);
  f.db.exec(`UPDATE legal_templates SET is_stub = 1 WHERE slug = 'articles_of_incorporation_wy'`);
  const wy = (await formGates(f.env, 'us_wy_ccorp', opts))!;
  assert.equal(wy.orderable, false);
  assert.match(gate(wy, 'counsel').detail, /articles_of_incorporation_wy/);
  // The legacy counsel rule is today's: routes/legal.ts COUNSEL_REQUIRED_TEMPLATES.
  const legal = readFileSync('cloudflare-worker/src/routes/legal.ts', 'utf8');
  const today = /COUNSEL_REQUIRED_TEMPLATES = new Set\(\[([^\]]*)\]\)/.exec(legal)![1].match(/'([^']+)'/g)!.map((x) => x.slice(1, -1));
  assert.deepEqual(Object.values(LEGACY_COUNSEL).flat(), today);
});

test('a form not offered as orderable, without a price, or not on a current published version, is not orderable', async () => {
  const f = fixture({ offerMode: 'guided' });
  review(f, 'gb_articles', GB_BODY, 'GB');
  assert.deepEqual((await formGates(f.env, 'gb_ltd', opts))!.gates.filter((x: any) => !x.pass).map((x: any) => x.key), ['offer_mode']);
  assert.equal((await readCatalogue(f.env, opts)).forms.find((x: any) => x.key === 'gb_ltd').availability, 'guided');
  const g = fixture();
  review(g, 'gb_articles', GB_BODY, 'GB');
  assert.deepEqual((await formGates(g.env, 'gb_ltd', { ...opts, priceOf: unpriced }))!.gates.filter((x: any) => !x.pass).map((x: any) => x.key), ['price']);
  const draft = { id: V, version: VERSION, status: 'draft', published_at: null };
  assert.equal(gate((await formGates(g.env, 'gb_ltd', { ...opts, version: draft }))!, 'published').pass, false, 'a draft version is not orderable');
  // The seeded version 1 (D6690) is still there and still published; the current one is the fixture's.
  assert.equal((await versionByNumber(g.env, 1))!.status, 'published');
  assert.deepEqual(await currentVersion(g.env), { id: V, version: VERSION, status: 'published', published_at: '2026-11-01T00:00:00Z' });
  assert.equal(availabilityOf('orderable', false), 'information_only');
  assert.equal(availabilityOf('guided', true), 'guided');
  assert.equal(availabilityOf('off', true), null);
});

// ── Routes ──
const app = new Hono<any>();
app.route('/api/formation/catalogue', catalogueRouter);
app.route('/api/admin/formation/catalogue', adminRouter);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(f: F, who: number | null, method: string, path: string, body?: unknown, bar = false) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who !== null) {
    const claims: Record<string, unknown> = { user_id: who };
    if (bar) claims.jti = f.jti;
    headers.Authorization = `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

test('the signed-in read: availability collapsed, facts with sources and dates, a quote, never a cost, a partner or HQ notes', async () => {
  const f = fixture();
  review(f, 'gb_articles', GB_BODY, 'GB');
  const cat = await readCatalogue(f.env, opts);
  const gb = cat.forms.find((x: any) => x.key === 'gb_ltd');
  assert.equal(gb.availability, 'orderable');
  assert.deepEqual(gb.quote, { amount_minor: 34900, currency: 'GBP', cadence: 'one_time' }, 'the default partner\'s founder price');
  const fact = gb.facts.find((x: any) => x.key === 'min_directors');
  assert.deepEqual(fact.source, { kind: 'registry', title: 'Synthetic registry guidance', url: 'https://registry.example.invalid/guide' });
  assert.equal(fact.checked_on, '2026-10-01'); assert.equal(fact.fresh, true);
  assert.equal(gb.fees[0].amount_cents, null, 'not recorded is null, never 0');
  const text = JSON.stringify(cat);
  assert.doesNotMatch(text, /cost_minor|25000|21000/, 'the signed-in read never returns cost_minor');
  assert.doesNotMatch(text, /Made-up|Fictional Filings|formation_partner_id|coverage_id|HQ only/, 'no partner and no HQ notes');
  assert.doesNotMatch(text, /"gates"/, 'the gates are HQ\'s');
  const res = await call(f, FOUNDER, 'GET', '/api/formation/catalogue');
  assert.equal(res.status, 200);
  assert.equal(res.body.version.version, VERSION, 'the current version is the fixture\'s, not the seeded one');
  assert.equal((await call(f, null, 'GET', '/api/formation/catalogue')).status, 401);
});

test('pausing removes a form from orderable on the next read; resuming restores it; Super Admin only, with a reason, logged', async () => {
  const f = fixture();
  review(f, 'gb_articles', GB_BODY, 'GB');
  const plain = await call(f, ADMIN, 'POST', '/api/admin/formation/catalogue/forms/gb_ltd/pause', { reason: 'x' });
  assert.equal(plain.status, 403);
  assert.equal(plain.body.error, 'super_admin_required');
  assert.equal((await call(f, FOUNDER, 'POST', '/api/admin/formation/catalogue/forms/gb_ltd/pause', { reason: 'x' })).status, 403);
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/formation/catalogue/forms/gb_ltd/pause', { reason: '' }, true)).body.error, 'reason_required');
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/formation/catalogue/forms/nope_form/pause', { reason: 'x' }, true)).status, 404);
  const p = await call(f, SUPER, 'POST', '/api/admin/formation/catalogue/forms/gb_ltd/pause', { reason: 'Registry outage' }, true);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  // mutation: pause gate dropped → still orderable.
  const g = (await formGates(f.env, 'gb_ltd', opts))!;
  assert.equal(g.orderable, false, 'a pause closes it on the next read');
  assert.match(gate(g, 'not_paused').detail, /Registry outage/);
  assert.equal((await readCatalogue(f.env, opts)).forms.find((x: any) => x.key === 'gb_ltd').availability, 'information_only');
  // A legacy form is paused the same way.
  await call(f, SUPER, 'POST', '/api/admin/formation/catalogue/forms/us_de_ccorp/pause', { reason: 'Price review' }, true);
  assert.equal((await formGates(f.env, 'us_de_ccorp', opts))!.orderable, false);
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/formation/catalogue/forms/gb_ltd/resume', { reason: 'Registry back' }, true)).status, 200);
  assert.equal((await formGates(f.env, 'gb_ltd', opts))!.orderable, true);
  const log = (f.db.prepare(`SELECT action FROM admin_audit_log ORDER BY id`).all() as any[]).map((r) => r.action);
  assert.deepEqual(log, ['formation_form_paused', 'formation_form_paused', 'formation_form_resumed']);
});
