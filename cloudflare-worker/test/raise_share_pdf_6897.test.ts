/** D6897 part 2 (#6897, RA-28 C, RA-29, RA-30 B): the evidence pack and the readiness snapshot as PDF copies.
 *  The Worker returns exactly what a link would freeze and records that a copy left; nothing is sent, no token is
 *  made, and a copy is listed on Shared links apart from the links, with no state: it cannot be stopped or counted.
 *  Real SQLite with the production schema and migrations; every person, venture and figure is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import router from '../src/routes/cycle_raise.ts';
import evidenceSharePublic from '../src/routes/evidence_share_public.ts';
import { buildCandidates, acceptItem, setSharing } from '../src/services/raiseEvidence.ts';
import { createPackLink, createPackPdf, createReadinessPdf, listPackLinks, revokePackLink, NOT_SCORED, TEAM_LINE } from '../src/services/raiseEvidenceShare.ts';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 't'.repeat(64); // in-memory test signing seed only

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL),(3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL),
   (5,'Synthetic Investor','five@example.invalid','investor',NULL,1,0,'approved');
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('three',3,10);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  const app = new Hono<any>(); app.route('/api/cycles/raise', router); app.route('/api/share/evidence', evidenceSharePublic);
  return { db, env, ctx, app };
}
type World = ReturnType<typeof world>;
function seed(w: World, table: string, values: Record<string, unknown>) {
  if (!/^[a-z_0-9]+$/.test(table)) throw new Error('bad fixture table');
  const row = { ...values }; for (const c of w.db.prepare('PRAGMA table_info(' + table + ')').all() as any[]) if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : c.name === 'uid' ? table + '-' + String(values.id ?? 'one') : 'synthetic';
  const keys = Object.keys(row); for (const k of keys) if (!/^[a-z_0-9]+$/.test(k)) throw new Error('bad fixture column');
  w.db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map(k => row[k] as any));
}
function sources(w: World) {
  seed(w, 'integrations', { id: 1, user_id: 1, provider_key: 'mercury', status: 'active' });
  seed(w, 'mercury_raise_facts', { id: 1, integration_id: 1, project_id: 1, kind: 'runway', fact_key: 'runway', value: 8, months: 3, amount_cents: 123400, label: 'product', as_of: '2026-09-02' });
  seed(w, 'discovery_interviews', { id: 1, project_id: 1, interviewee_name: 'PRIVATE INTERVIEWEE', interview_date: '2026-09-07', pains_json: '[]', quote_consent: 1, notes: 'PRIVATE QUOTE', icp_fit: 'strong' });
  seed(w, 'project_metrics', { id: 1, project_id: 1, snapshot_date: '2026-09-10', source: 'manual', mrr: 4200, cash_balance: 987654321 });
  seed(w, 'raise_prospects', { id: 1, uid: 'prospect-one', project_id: 1, name: 'PRIVATE INVESTOR', email: 'private@example.invalid', stage: 'committed', commit_status: 'soft', amount_cents: 50000, currency: 'USD', updated_at: '2026-10-26' });
}
const proposalOf = (w: World, kind: string, area?: string) => w.db.prepare(`SELECT uid,payload_json FROM ai_rail_proposals WHERE status='proposed' AND json_extract(payload_json,'$.kind')=? AND (? IS NULL OR json_extract(payload_json,'$.area')=?) LIMIT 1`).get(kind, area ?? null, area ?? null) as any;
async function share(w: World, kind: string, visibility: 'private' | 'summary' | 'after_nda', area?: string) {
  const q = proposalOf(w, kind, area); assert.ok(q, 'candidate ' + kind);
  let item: any = await acceptItem(w.ctx, q.uid, JSON.parse(q.payload_json).snapshot_hash);
  if (item.visibility !== visibility) item = await setSharing(w.ctx, item.uid, { version: item.version, visibility });
  return item;
}
async function pack(w: World) {
  sources(w); await buildCandidates(w.ctx);
  const kpi = await share(w, 'kpi-snapshot', 'after_nda', 'Investor narrative and Pitch deck');
  const icp = await share(w, 'icp-fit', 'summary');
  const runway = await share(w, 'bank-runway', 'after_nda');
  const commitment = await share(w, 'typed-commitment', 'after_nda');
  const kept = await share(w, 'kpi-snapshot', 'private', 'Capital model');
  return { kpi, icp, runway, commitment, kept };
}
/** What may never leave Axal in a pack: private fields, a balance, a bank amount, an investor's name, money or email. */
const NEVER = /PRIVATE|987654321|123400|50000|private@example|snapshot_hash|private_reason|source_ref|accepted_by|Synthetic Investor/;
/** A fixed day already past, so the NDA day is never in the future; no real clock is read. */
const NDA_DAY = '2026-11-01';
async function call(w: World, who: number, method: string, tail: string, body?: unknown) {
  const auth = { Authorization: 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)) };
  const r = await w.app.request('/api/cycles/raise' + tail, { method, headers: { 'Content-Type': 'application/json', 'X-Company-Id': '10', ...auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  return { status: r.status, body: await r.json() as any };
}


const KEYS = ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team', 'pmf'];
function readiness(w: World) {
  KEYS.forEach((k, i) => w.db.prepare('INSERT INTO readiness_items(id,project_id,item_key,label,position) VALUES(?,?,?,?,?)').run(i + 1, 1, k, k, i));
  const score = (key: string, value: number, evidence: string, missing: string | null, at: string, source = 'computed') =>
    w.db.prepare('INSERT INTO readiness_scores(item_id,project_id,score,evidence,missing,source,scored_at) VALUES(?,?,?,?,?,?,?)').run(KEYS.indexOf(key) + 1, 1, value, evidence, missing, source, at);
  score('narrative', 7, 'stated', 'One customer story.', '2026-11-02 09:00:00');
  score('team', 9, 'anecdote', 'PRIVATE TEAM NOTE', '2026-11-05 09:00:00', 'manual');
  score('pmf', 4, 'pattern', 'PRIVATE PMF NOTE', '2026-11-06 09:00:00');
}
const copies = (w: World) => w.db.prepare('SELECT * FROM raise_share_pdf_copies ORDER BY id').all() as any[];
const links = (w: World) => (w.db.prepare('SELECT COUNT(*) n FROM raise_evidence_share_links').get() as any).n;
const logged = (w: World, action: string) => (w.db.prepare('SELECT COUNT(*) n FROM activity_logs WHERE action = ?').get(action) as any).n;

test('the readiness snapshot as a PDF copy: the same seven areas, recorded as a copy, no link and no token', async () => {
  const w = world(); try {
    readiness(w);
    const made = await call(w, 1, 'POST', '/readiness/pdf-copies?project=1', { label: 'Synthetic Advisor', covering_line: '  Where we   stand. ' });
    assert.equal(made.status, 201);
    assert.equal(made.body.kind, 'pdf'); assert.equal(made.body.output, 'readiness'); assert.equal(made.body.item_count, 7);
    assert.ok(!('path' in made.body) && !('expires_at' in made.body) && !('view_limit' in made.body), 'a copy has no address, expiry or view limit');
    const s = made.body.snapshot;
    assert.equal(s.kind, 'readiness'); assert.equal(s.covering_line, 'Where we stand.'); assert.equal(s.venture, 'Synthetic One');
    assert.deepEqual(s.areas.map((a: any) => a.key), ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team']);
    const by = Object.fromEntries(s.areas.map((a: any) => [a.key, a]));
    assert.equal(by.narrative.words, '7 of 10'); assert.equal(by.data_room.words, NOT_SCORED); assert.equal(by.data_room.score, null);
    assert.equal(by.team.words, TEAM_LINE); assert.equal(by.team.score, null);
    assert.ok(!JSON.stringify(made.body).includes('PRIVATE'), 'Team and PMF notes stay in Axal');
    // Recorded: what left, for whom, how many, its hash; never the content or a token.
    const [row] = copies(w);
    assert.equal(row.output, 'readiness'); assert.equal(row.label, 'Synthetic Advisor'); assert.equal(row.reader, 'before_nda'); assert.equal(row.item_count, 7);
    assert.match(row.content_hash, /^[0-9a-f]{64}$/); assert.equal(row.created_by, 1);
    assert.ok(!('snapshot_json' in row) && !('token_hash' in row));
    assert.equal(links(w), 0, 'a PDF made a link');
    assert.equal(logged(w, 'readiness_snapshot_pdf_copied'), 1);
  } finally { w.db.close(); }
});

test('a readiness PDF refuses a link\'s settings, a bad covering line, a missing label and anyone but a founder', async () => {
  const w = world(); try {
    readiness(w);
    for (const bad of [{ label: 'X', expires_in_days: 14 }, { label: 'X', view_limit: 5 }, { label: '' }, { label: 'X', covering_line: 'one\ntwo' }, { label: 'X', covering_line: 'x'.repeat(201) }]) {
      const r = await call(w, 1, 'POST', '/readiness/pdf-copies?project=1', bad);
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.error, 'invalid');
    }
    await assert.rejects(createReadinessPdf({ ...w.ctx, founder: false }, { label: 'X' }), (e: any) => e.code === 'forbidden');
    assert.equal(copies(w).length, 0, 'a refused PDF was recorded');
  } finally { w.db.close(); }
});

test('the evidence pack as a PDF copy carries exactly what its link would, and nothing private', async () => {
  const w = world(); try {
    await pack(w);
    const link = await createPackLink(w.ctx, { label: 'Link', reader: 'after_nda', nda_confirmed: true, nda_signed_on: NDA_DAY });
    const linkSnap = JSON.parse((w.db.prepare('SELECT snapshot_json FROM raise_evidence_share_links WHERE uid = ?').get(link.uid) as any).snapshot_json);
    const pdf = await call(w, 1, 'POST', '/evidence/pdf-copies?project=1', { label: 'Synthetic Fund', reader: 'after_nda', nda_confirmed: true, nda_signed_on: NDA_DAY });
    assert.equal(pdf.status, 201);
    assert.equal(pdf.body.kind, 'pdf'); assert.equal(pdf.body.output, 'pack'); assert.equal(pdf.body.reader, 'after_nda');
    assert.equal(pdf.body.item_count, link.item_count);
    const { made_at: a, ...pdfRest } = pdf.body.pack; const { made_at: b, ...linkRest } = linkSnap;
    assert.deepEqual(pdfRest, linkRest, 'the PDF and the link differ in content');
    assert.doesNotMatch(JSON.stringify(pdf.body), NEVER);
    const row = copies(w)[0];
    assert.equal(row.nda_signed_on, NDA_DAY); assert.equal(row.item_count, link.item_count);
    assert.equal(logged(w, 'evidence_pack_pdf_copied'), 1);
    // Before an NDA: coverage only.
    const before = await createPackPdf(w.ctx, { label: 'First look' });
    assert.equal(before.reader, 'before_nda'); assert.equal(before.pack.items, null); assert.equal(before.pack.claims, null);
  } finally { w.db.close(); }
});

test('a pack PDF is refused without the NDA confirmed, with a link\'s settings, or when nothing is shared', async () => {
  const w = world(); try {
    assert.equal((await call(w, 1, 'POST', '/evidence/pdf-copies?project=1', { label: 'X' })).body.error, 'empty');
    await pack(w);
    assert.equal((await call(w, 1, 'POST', '/evidence/pdf-copies?project=1', { label: 'X', reader: 'after_nda' })).body.error, 'nda_unconfirmed');
    assert.equal((await call(w, 1, 'POST', '/evidence/pdf-copies?project=1', { label: 'X', expires_in_days: 3 })).body.error, 'invalid');
    assert.equal((await call(w, 3, 'POST', '/evidence/pdf-copies?project=1', { label: 'X' })).status, 403);
    assert.equal(copies(w).length, 0);
  } finally { w.db.close(); }
});

test('Shared links lists the copies apart, newest first, with no state; a copy cannot be revoked', async () => {
  const w = world(); try {
    await pack(w); readiness(w);
    await createPackLink(w.ctx, { label: 'A link' });
    await createPackPdf(w.ctx, { label: 'Older copy' });
    w.db.exec("UPDATE raise_share_pdf_copies SET created_at = '2026-11-01T00:00:00.000Z'");
    const snap = await createReadinessPdf(w.ctx, { label: 'Newer copy' });
    const list = await listPackLinks(w.ctx);
    assert.deepEqual(list.links.map((l: any) => l.label), ['A link']);
    assert.deepEqual(list.copies.map((c: any) => [c.label, c.output, c.kind]), [['Newer copy', 'readiness', 'pdf'], ['Older copy', 'pack', 'pdf']]);
    for (const c of list.copies) assert.ok(!('state' in c) && !('view_count' in c) && !('expires_at' in c), 'a copy was given a link\'s state');
    assert.equal(list.copies_capped, false);
    await assert.rejects(revokePackLink(w.ctx, snap.uid), (e: any) => e.code === 'not_found');
    const other = { ...w.ctx, projectId: 2 };
    w.db.exec("INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(2,'venture-two','Other Venture',100,10)");
    assert.equal((await listPackLinks(other)).copies.length, 0, 'another venture saw these copies');
  } finally { w.db.close(); }
});
