/**
 * D6171 (#6171) — the deal page's Market read: TAM, SAM and SOM read their
 * source and date from `market_figures` (D6011), with an honest reason when
 * none is stored; each market keeps its four readiness scores with sources;
 * the masked answer is unchanged; and no note or prompt reaches a source.
 * On real SQLite with every migration; everyone here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_market_readiness_6171.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import insights from '../src/routes/deal_insights.ts';
import { loadSchema } from './_schema_once.mjs';

const secret = 'synthetic-d6171-only-'.repeat(3);
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

const NOTE = 'PRIVATE-FOUNDER-NOTE';
const PROMPT = 'PRIVATE-MODEL-PROMPT';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id) VALUES
      (1,'admin@example.test','Staff','admin',NULL),(2,'founder@example.test','Founder','founder',20),
      (3,'investor@example.test','Invited','investor',NULL),(7,'cofounder@example.test','Co-founder','founder',NULL);
    INSERT INTO projects(id,name,founder_id,sector,stage,tagline,tam,sam,som) VALUES
      (10,'Venture',20,'Climate','build','Public headline',5000000000,700000000,77000000);
    INSERT INTO deals(id,project_id,status) VALUES(100,10,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(100,3);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES(10,7,'cofounder','accepted');
    INSERT INTO market_sources(id,project_id,title,url) VALUES(5,10,'Synthetic grid report 2026','https://example.test/grid');
    INSERT INTO markets(uid,project_id,name,state,demand_score,demand_source,regulation_score,regulation_source,cost_score,cost_source) VALUES
      ('m-ca',10,'Canada','entering',8,'Pilot waitlist',0,'Provincial filing',NULL,NULL),
      ('m-de',10,'Germany','considering',NULL,NULL,NULL,NULL,NULL,NULL);
    INSERT INTO project_market_assumptions(project_id,methodology,growth_driver) VALUES(10,'Top-down','${NOTE}');`);
  // The fills store holds a proposal's text and its citation; neither may become a source.
  db.exec(`INSERT INTO fill_provenance(target_table,target_row_id,target_column,fill_class,proposed_value,citation_json)
    VALUES('project_market_assumptions',1,'population','sourced','${PROMPT}','{"quote":"${PROMPT}"}')`);
  const figure = (figure: string, value: number, method: string, setBy: number | null, src: { id: number; title: string; url: string } | null, at: string) =>
    db.prepare(`INSERT INTO market_figures(project_id,figure,value,method,source_title,source_url,market_source_id,set_by,set_at)
      VALUES(10,?,?,?,?,?,?,?,?)`).run(figure, value, method, src?.title ?? null, src?.url ?? null, src?.id ?? null, setBy, at);
  return { db, figure, env: { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' } as any };
}
async function read(f: ReturnType<typeof fixture>, path: string, who = 3) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await insights.request(path, { headers: { Authorization: `Bearer ${token}` } }, f.env);
  return { status: res.status, body: await res.json() as any };
}
const nda = (f: ReturnType<typeof fixture>) => f.db.exec("INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(2,3,'active')");

test('a typed figure is the founder’s own, a sourced one names its source, each with its date', async () => {
  const f = fixture();
  try {
    nda(f);
    f.figure('tam', 5_000_000_000, 'typed', 2, null, '2026-11-01 09:00:00');
    f.figure('sam', 700_000_000, 'document', 7, { id: 5, title: 'Synthetic grid report 2026', url: 'https://example.test/grid' }, '2026-11-02 09:00:00');
    f.figure('som', 77_000_000, 'top_down', 2, null, '2026-11-03 09:00:00');
    const m = (await read(f, '/100/market')).body;
    assert.equal(m.masked, false);
    assert.deepEqual(m.sizing.data, {
      tam: { value: 5_000_000_000, source: 'typed', as_of: '2026-11-01', reason: null },
      sam: { value: 700_000_000, source: 'Synthetic grid report 2026', as_of: '2026-11-02', reason: null },
      som: { value: 77_000_000, source: null, as_of: '2026-11-03', reason: 'The founder’s own top-down sizing; no source named' },
    });
  } finally { f.db.close(); }
});

test('with no stored source the read says why: before D6011, another writer, or entered on the founder’s behalf', async () => {
  const f = fixture();
  try {
    nda(f);
    f.figure('sam', 650_000_000, 'typed', 2, null, '2026-11-02 09:00:00'); // projects.sam moved since: stale
    f.figure('som', 77_000_000, 'typed', 1, null, '2026-11-03 09:00:00'); // an admin's entry
    const m = (await read(f, '/100/market')).body;
    assert.deepEqual(m.sizing.data.tam, { value: 5_000_000_000, source: null, as_of: null, reason: 'No source recorded for this figure' });
    assert.deepEqual(m.sizing.data.sam, { value: 700_000_000, source: null, as_of: null, reason: 'No source recorded for this figure' });
    assert.deepEqual(m.sizing.data.som, { value: 77_000_000, source: null, as_of: '2026-11-03', reason: 'Entered on the founder’s behalf; no source named' });
    f.db.exec('UPDATE projects SET som = NULL WHERE id = 10');
    assert.deepEqual((await read(f, '/100/market')).body.sizing.data.som, { value: null, source: null, as_of: null, reason: 'Not recorded' });
  } finally { f.db.close(); }
});

test('each market keeps its four readiness scores with their sources; one never scored is null, never 0', async () => {
  const f = fixture();
  try {
    nda(f);
    const rows = (await read(f, '/100/market')).body.company_markets.data;
    const ca = rows.find((r: any) => r.name === 'Canada');
    assert.deepEqual([ca.demand_score, ca.demand_source, ca.regulation_score, ca.regulation_source, ca.partners_score, ca.cost_score],
      [8, 'Pilot waitlist', 0, 'Provincial filing', null, null]);
    const de = rows.find((r: any) => r.name === 'Germany');
    assert.deepEqual([de.demand_score, de.regulation_score, de.partners_score, de.cost_score], [null, null, null, null]);
  } finally { f.db.close(); }
});

test('nothing new is disclosed before the NDA: the masked answer is unchanged and reads no figure store', async () => {
  const f = fixture();
  try {
    f.figure('tam', 5_000_000_000, 'document', 2, { id: 5, title: 'Synthetic grid report 2026', url: 'https://example.test/grid' }, '2026-11-01 09:00:00');
    const masked = await read(f, '/100/market');
    assert.deepEqual(masked.body, { masked: true, reason: 'no_pairwise_nda', project: { name: 'Venture', sector: 'Climate', stage: 'build', headline: 'Public headline' } });
    f.db.exec('DROP TABLE market_figures; DROP TABLE markets');
    assert.deepEqual((await read(f, '/100/market')).body, masked.body, 'a masked read touches neither store');
  } finally { f.db.close(); }
});

test('no private note or model prompt appears in any source text', async () => {
  const f = fixture();
  try {
    nda(f);
    f.figure('tam', 5_000_000_000, 'top_down', 2, null, '2026-11-01 09:00:00');
    const text = JSON.stringify((await read(f, '/100/market')).body);
    assert.ok(!text.includes(NOTE), 'the drawer’s growth note stays private');
    assert.ok(!text.includes(PROMPT), 'a fill proposal’s text stays private');
    assert.ok(!text.includes('@example.test'), 'no address');
  } finally { f.db.close(); }
});

test('a failed figure store makes only the sizing block unreadable', async () => {
  const f = fixture();
  try {
    nda(f);
    f.db.exec('DROP TABLE market_figures');
    const m = (await read(f, '/100/market')).body;
    assert.deepEqual(m.sizing, { state: 'unreadable', reason: 'Unreadable. Try again.' });
    assert.equal(m.company_markets.state, 'recorded');
  } finally { f.db.close(); }
});
