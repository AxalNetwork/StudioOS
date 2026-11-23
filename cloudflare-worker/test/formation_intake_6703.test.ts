/** D6703 (#6703): real routes over the migrated store, ownership, immutable answers and live restrictions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { openSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router from '../src/routes/formation_cases.ts';
import { formationCountry } from '../src/services/formationPrefill.ts';
import { companyFormations, projectFormations } from '../src/services/formationState.ts';

const SECRET = 'synthetic-formation-intake-6703-only'.repeat(2);
const app = new Hono<any>();
app.route('/api/formation/cases', router);
app.onError((error, c) => c.json({ error: 'request_failed' }, error.message === 'Authentication required' ? 401 : 500));

function fixture() {
  const db = openSchema();
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic founder', 'formation@example.test');
    INSERT INTO users (id, name, email, role, founder_id, country, nationality) VALUES
      (10, 'Synthetic founder', 'formation@example.test', 'founder', 10, 'Canada', 'CA'),
      (11, 'Other founder', 'other@example.test', 'founder', NULL, 'FR', 'FR');
    INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'project-6703', 'Synthetic project', 10);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (10, 'company-6703', 'Synthetic company');
    INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES ('link-6703', 10, 10, 'Admin');`);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env, close: () => db.close() };
}

async function request(f: ReturnType<typeof fixture>, method: string, suffix = '', body?: unknown, user = 10) {
  const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/formation/cases${suffix}`, { method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  return { status: res.status, data: await res.json() as any, cache: res.headers.get('cache-control') };
}

test('two project doors and concurrent opens return one case, without changing incorporation metadata', async () => {
  const f = fixture();
  try {
    const results = await Promise.all([request(f, 'POST', '', { project_id: 10 }), request(f, 'POST', '', { project_id: 10 })]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal(results[0].data.case.uid, results[1].data.case.uid);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_cases').get()!.n, 1);
    assert.equal(results[0].cache, 'private, no-store');
    assert.equal(f.db.prepare('SELECT incorporation_meta FROM projects WHERE id = 10').get()!.incorporation_meta, null);
    assert.equal((await projectFormations(f.env, [{ id: 10, company_id: null }]))(10).formation_state, 'draft_case');
  } finally { f.close(); }
});

test('only a project owner or company editor can open and read a subject', async () => {
  const f = fixture();
  try {
    assert.equal((await request(f, 'POST', '', { project_id: 10 }, 11)).status, 404);
    const company = await request(f, 'POST', '', { company_uid: 'company-6703' });
    assert.equal(company.status, 200);
    assert.equal((await companyFormations(f.env, [10]))(10).formation_state, 'draft_case');
    assert.equal((await request(f, 'POST', '', { company_uid: 'company-6703' }, 11)).status, 404);
    assert.equal((await request(f, 'GET', `/${company.data.case.uid}`, undefined, 11)).status, 404);
    f.db.exec("UPDATE user_company_links SET role_in_company = 'Member' WHERE user_id = 10");
    assert.equal((await request(f, 'GET', `/${company.data.case.uid}`)).status, 404);
    f.db.exec("UPDATE projects SET deleted_at = datetime('now') WHERE id = 10");
    assert.equal((await request(f, 'POST', '', { project_id: 10 })).status, 404);
  } finally { f.close(); }
});

test('a branch refuses intake without creating cases', async () => {
  const f = fixture();
  try {
    f.env.BRANCH_CODE = 'example-branch';
    assert.equal((await request(f, 'POST', '', { project_id: 10 })).status, 403);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_cases').get()!.n, 0);
  } finally { f.close(); }
});

test('prefill carries store provenance and unknown countries remain questions', async () => {
  const f = fixture();
  try {
    f.db.exec("UPDATE users SET country = 'Cambridge' WHERE id = 10");
    const result = await request(f, 'POST', '', { project_id: 10, intent: 'new_company' });
    assert.equal(result.data.prefill.values.company_name, 'Synthetic project');
    assert.equal(result.data.prefill.provenance.company_name, 'projects.name');
    assert.equal(result.data.prefill.provenance['founders.0.residence_country'], 'users.country');
    assert.equal(result.data.prefill.values.founders[0].residence_country, null);
    assert.equal(formationCountry('Canada'), 'CA');
    assert.equal(formationCountry('CA'), 'CA');
    assert.equal(formationCountry('France'), 'FR');
    assert.equal(formationCountry('FR'), 'FR');
    assert.equal(formationCountry('London'), null);
    assert.equal(formationCountry('ZZ'), null);
    assert.equal(formationCountry('Cambridge'), null);
  } finally { f.close(); }
});

test('each edit appends an immutable snapshot, changes only the case and rejects a stale revision', async () => {
  const f = fixture();
  try {
    const opened = await request(f, 'POST', '', { project_id: 10 });
    const path = `/${opened.data.case.uid}/answers`;
    const first = await request(f, 'POST', path, { revision: 0, answers: { company_name: 'First name' } });
    const second = await request(f, 'POST', path, { revision: 1, answers: { company_name: 'Second name' } });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(second.status, 200);
    assert.notEqual(first.data.answers.uid, second.data.answers.uid);
    assert.equal(second.data.answers.values.company_name, 'Second name');
    assert.equal(first.data.answers.prefill.provenance.company_name, 'projects.name');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_case_answers').get()!.n, 2);
    assert.throws(() => f.db.exec("UPDATE formation_case_answers SET answers_json = '{}'"), /immutable answer set/);
    assert.equal(f.db.prepare('SELECT name FROM projects WHERE id = 10').get()!.name, 'Synthetic project');
    assert.equal((await request(f, 'POST', path, { revision: 0, answers: {} })).status, 409);
    assert.equal((await request(f, 'POST', path, { revision: 2, answers: { notes: 'é'.repeat(20000) } })).status, 400, 'the 32 KB limit counts UTF-8 bytes');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_case_answers').get()!.n, 2);
  } finally { f.close(); }
});

test('a changed restriction list holds residence, nationality or operating-country matches without exposing the reason', async () => {
  for (const field of ['residence_country', 'nationality', 'operating_countries']) {
    const f = fixture();
    try {
      const opened = await request(f, 'POST', '', { project_id: 10 });
      f.db.exec(`INSERT INTO formation_sources (id, kind, title, url) VALUES (6703, 'registry', 'Synthetic restriction source', 'https://example.test/restriction');
        INSERT INTO formation_restricted_jurisdictions (place, kind, source_id, checked_on, checked_by) VALUES ('CA', 'not_served', 6703, '2026-11-01', 10);`);
      const founder = { user_id: 10, residence_country: 'FR', nationality: 'FR', ...(field !== 'operating_countries' ? { [field]: 'CA' } : {}) };
      const saved = await request(f, 'POST', `/${opened.data.case.uid}/answers`, { revision: 0,
        answers: { founders: [founder], operating_countries: field === 'operating_countries' ? ['CA'] : ['FR'] } });
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.case.held, true);
      assert.equal(saved.data.case.waiting_on, 'hq');
      assert.equal(saved.data.case.message, 'We are checking your details');
      assert.equal('hold_reason' in saved.data.case, false);
      assert.deepEqual(saved.data.options, []);
      f.db.exec("DELETE FROM formation_restricted_jurisdictions WHERE place = 'CA'");
      const again = await request(f, 'POST', `/${opened.data.case.uid}/answers`, { revision: 1, answers: { founders: [{ user_id: 10, residence_country: 'FR', nationality: 'FR' }] } });
      assert.equal(again.data.case.held, true, 'only HQ review can release an existing hold');
    } finally { f.close(); }
  }
});

test('competing answer saves append once and missing founders cannot evade country checks', async () => {
  const f = fixture();
  try {
    const opened = await request(f, 'POST', '', { project_id: 10 });
    const path = `/${opened.data.case.uid}/answers`;
    assert.equal((await request(f, 'POST', path, { revision: 0, answers: { founders: [] } })).status, 400);
    const results = await Promise.all([request(f, 'POST', path, { revision: 0, answers: { company_name: 'A' } }), request(f, 'POST', path, { revision: 0, answers: { company_name: 'B' } })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM formation_case_answers').get()!.n, 1);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM formation_case_events WHERE kind = 'answers_saved'").get()!.n, 1);
  } finally { f.close(); }
});
