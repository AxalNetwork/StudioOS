/**
 * #8259 (D8259, Build v2 BD28) — Company creation's suggested filings: the
 * pack for the company's jurisdiction, minus what the venture already has and
 * what it hid with "Not now", which stays hidden. Through the real routes
 * (`cycle_build.ts`' module read and `build_suggested_filings.ts`) over the
 * real migrated schema. Every person, company and date is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_suggested_filings_8259.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import suggested from '../src/routes/build_suggested_filings.ts';
import { isSuggestionKey, packFor, suggestedFilings } from '../src/services/suggestedFilings.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'synthetic-8259-only-not-a-real-credential'.repeat(2);
const P = 301;

function harness(setup = '') {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id, role, founder_id, name, email, is_active) VALUES
      (1, 'founder', 11, 'Synthetic founder', 'founder@example.invalid', 1),
      (2, 'founder', 22, 'Other founder', 'other@example.invalid', 1);
    INSERT INTO company_profiles(id, uid, company_name, jurisdiction, legal_form) VALUES (40, 'co-8259', 'Synthetic Co', 'US-DE', 'c_corp');
    INSERT INTO projects(id, name, founder_id, company_id) VALUES (${P}, 'Synthetic venture', 11, 40);
    ${setup}`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/cycles/build/company-creation/suggested-filings', suggested);
  app.route('/api/cycles/build', build);
  app.onError((e, c) => c.json({ error: e.message }, 500));
  const call = async (method: string, path: string, user = 1) => {
    const quiet = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = () => {};
    try {
      const auth = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const res = await app.request(path, { method, headers: { Authorization: `Bearer ${auth}` } }, env);
      return { status: res.status, body: await res.json() as any };
    } finally { [console.log, console.warn, console.error] = quiet; }
  };
  const page = async (user = 1) => (await call('GET', `/api/cycles/build/modules/company-creation?project=${P}`, user)).body.facts.suggestions;
  const dismiss = (key: string, user = 1, project = P) => call('POST', `/api/cycles/build/company-creation/suggested-filings/${encodeURIComponent(key)}/dismiss?project=${project}`, user);
  return { db, env, page, dismiss, close: () => db.close() };
}

const keys = (s: any) => s.rows.map((r: any) => r.key);

test('a Delaware C-Corp company record gets the C-Corp pack, every rule once, with its kind, date or reason', async () => {
  const h = harness();
  try {
    const s = await h.page();
    assert.equal(s.state, 'ok');
    assert.equal(s.pack, 'us_de_ccorp');
    assert.equal(s.source, 'the company record');
    assert.deepEqual(keys(s), ['us_de_ccorp:franchise_tax', 'us_de_ccorp:registered_agent', 'us_de_ccorp:board_meeting', 'us_de_ccorp:annual_report']);
    const tax = s.rows.find((r: any) => r.key === 'us_de_ccorp:franchise_tax');
    assert.equal(tax.kind, 'franchise_tax');
    assert.match(tax.due, /^\d{4}-03-01$/, 'a fixed date takes its next 1 March');
    assert.equal(tax.jurisdiction, null);
    assert.equal(s.rows.find((r: any) => r.key === 'us_de_ccorp:annual_report').jurisdiction, 'Federal', 'Form 1120 is filed with the IRS');
    const agent = s.rows.find((r: any) => r.key === 'us_de_ccorp:registered_agent');
    assert.equal(agent.kind, 'other');
    assert.equal(agent.due, null, 'no formation date recorded: no date is invented');
    assert.match(agent.due_reason, /formation date, which is not recorded/);
  } finally { h.close(); }
});

test('jurisdiction: the order wins; an LLC gets the LLC pack; a jurisdiction with no pack offers nothing and says why', async () => {
  const llc = harness(`UPDATE company_profiles SET legal_form = 'llc' WHERE id = 40;`);
  try { const s = await llc.page(); assert.equal(s.pack, 'us_de_llc'); assert.deepEqual(keys(s), ['us_de_llc:franchise_tax', 'us_de_llc:registered_agent']); }
  finally { llc.close(); }
  const ordered = harness(`UPDATE company_profiles SET jurisdiction = 'GB', legal_form = 'ltd' WHERE id = 40;
    INSERT INTO incorporations(id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at, created_at)
      VALUES (930, 1, ${P}, 'us_de_llc', 'Synthetic LLC', 50000, 'paid', '2026-11-01', '2026-10-30');`);
  try { const s = await ordered.page(); assert.equal(s.pack, 'us_de_llc'); assert.equal(s.source, 'the incorporation order'); }
  finally { ordered.close(); }
  const uk = harness(`UPDATE company_profiles SET jurisdiction = 'GB', legal_form = 'ltd' WHERE id = 40;`);
  try {
    const s = await uk.page();
    assert.equal(s.state, 'no_pack');
    assert.equal(s.jurisdiction, 'GB');
    assert.deepEqual(s.rows, []);
    assert.match(s.reason, /US Delaware LLCs and C-Corps only/);
  } finally { uk.close(); }
  assert.deepEqual(packFor(null, { jurisdiction: 'us-de', legal_form: 'c_corp' }), { pack: 'us_de_ccorp', source: 'the company record' });
  assert.equal(packFor(null, { jurisdiction: 'US-DE', legal_form: 'lp' }).pack, null, 'a form with no pack names none');
});

test('a formation date dates the rules counted from formation', async () => {
  const h = harness(`UPDATE company_profiles SET incorporation_date = '2026-01-15' WHERE id = 40;`);
  try {
    const out = await suggestedFilings(h.env, { id: P, company_id: 40, entity_id: null }, null, [], '2026-11-22');
    assert.equal(out.rows.find((r: any) => r.key === 'us_de_ccorp:registered_agent')!.due, '2027-01-15');
    assert.equal(out.rows.find((r: any) => r.key === 'us_de_ccorp:board_meeting')!.due, '2027-01-15', 'quarterly from 15 Apr (90 days after formation): the first on or after today');
  } finally { h.close(); }
});

test('already added: a filing with the suggestion’s title, or Axal’s seeded obligation, leaves the list', async () => {
  const h = harness(`
    INSERT INTO entities(id, name, entity_type, jurisdiction) VALUES (601, 'Synthetic Inc', 'project', 'DE');
    UPDATE projects SET entity_id = 601 WHERE id = ${P};
    INSERT INTO formation_steps(project_id, title, state, kind, sort_order, created_by) VALUES (${P}, '  delaware franchise tax + annual report ', 'todo', 'franchise_tax', 1, 1);
    INSERT INTO entity_obligations(uid, entity_id, kind, title, cadence, due_date, source, pack_key, created_by)
      VALUES ('ob-8259', 601, 'board_meeting', 'Board meeting (Axal)', 'quarterly', '2027-01-01', 'pack', 'us_de_ccorp:board_meeting', 1);`);
  try {
    const s = await h.page();
    assert.deepEqual(keys(s), ['us_de_ccorp:registered_agent', 'us_de_ccorp:annual_report']);
    assert.equal(s.already_added, 2);
  } finally { h.close(); }
});

test('Not now hides a suggestion and it stays hidden: a second one changes nothing, and it is logged once', async () => {
  const h = harness();
  try {
    const first = await h.dismiss('us_de_ccorp:board_meeting');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { ok: true, key: 'us_de_ccorp:board_meeting', already_dismissed: false });
    const again = await h.dismiss('us_de_ccorp:board_meeting');
    assert.equal(again.body.already_dismissed, true);
    assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM company_filing_suggestion_dismissals').get() as any).n, 1);
    const logs = h.db.prepare("SELECT entity_type, action, details FROM activity_logs WHERE action = 'build_suggested_filing_dismissed'").all() as any[];
    assert.equal(logs.length, 1);
    assert.equal(logs[0].entity_type, 'build.company-creation');
    assert.equal(logs[0].details, 'Suggested filing hidden: Quarterly board meeting');
    const s = await h.page();
    assert.ok(!keys(s).includes('us_de_ccorp:board_meeting'));
    assert.equal(s.dismissed, 1);
    // A later read, and a filing added afterwards for something else, do not bring it back.
    h.db.exec(`INSERT INTO formation_steps(project_id, title, state, sort_order, created_by) VALUES (${P}, 'Something else', 'todo', 2, 1)`);
    assert.ok(!keys(await h.page()).includes('us_de_ccorp:board_meeting'));
  } finally { h.close(); }
});

test('Not now is the venture’s founders’ only, for a real rule of a pack, on a venture that exists', async () => {
  const h = harness();
  try {
    const other = await h.dismiss('us_de_ccorp:board_meeting', 2);
    assert.equal(other.status, 403);
    assert.equal(other.body.error, 'forbidden');
    for (const key of ['us_de_ccorp:nope', 'uk_ltd:annual_report', 'us_de_ccorp', "us_de_ccorp:board_meeting' OR 1=1"]) {
      const r = await h.dismiss(key);
      assert.equal(r.status, 404, key);
      assert.equal(r.body.error, 'suggestion_not_found');
    }
    assert.equal((await h.dismiss('us_de_ccorp:board_meeting', 1, 999)).body.error, 'project_not_found');
    assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM company_filing_suggestion_dismissals').get() as any).n, 0, 'nothing written by a refusal');
    assert.equal(isSuggestionKey('us_de_llc:board_meeting'), false, 'the LLC pack holds no board meeting rule');
    assert.equal(isSuggestionKey('us_de_llc:franchise_tax'), true);
  } finally { h.close(); }
});

test('a store that cannot be read fails this block only: the module read still answers', async () => {
  const h = harness();
  try {
    h.db.exec('DROP TABLE company_filing_suggestion_dismissals');
    const s = await h.page();
    assert.equal(s.state, 'unreadable');
    assert.deepEqual(s.rows, []);
  } finally { h.close(); }
});
