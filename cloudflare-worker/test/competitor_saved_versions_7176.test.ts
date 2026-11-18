/**
 * D7176 (#7176, canvas D7042) — a saved competitor analysis keeps the
 * researcher's work through refresh, rerun and export.
 *
 *   - competitor_sources.origin: a source attached by hand is 'manual', and
 *     refresh and rerun keep it;
 *   - refresh re-fetches the stored sources only: no discovery, no model, no
 *     write to output_json, and a page that does not answer keeps its date;
 *   - a save is a version; a save based on an older version answers 409;
 *   - a rerun returns a proposal and writes nothing; a failed rerun leaves the
 *     status and the body alone; apply takes the ticked changes with If-Match;
 *   - export names its version in X-Analysis-Version and can read an older one.
 *
 * Real SQLite (the baseline plus every migration above BASELINE_CUTOFF), a
 * stubbed, guarded model, a stubbed public web, made-up data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/competitor_saved_versions_7176.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import competitors from '../src/routes/competitors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { loadSchema } from './_schema_once.mjs';
import { __setPublicResolverForTest } from '../src/services/webFetch.ts';

__setPublicResolverForTest(async () => ['93.184.216.34']);

const JWT_SECRET = 'unit-test-jwt-secret-7176-saved-analyses-0123456789';
const OWNER = 1;
const OTHER = 2;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  loadSchema(db);
  db.exec(`INSERT INTO users (id, email, name, role) VALUES (${OWNER}, 'owner@example.test', 'Ola Owner', 'founder');
    INSERT INTO users (id, email, name, role) VALUES (${OTHER}, 'other@example.test', 'Oskar Other', 'founder');
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${OWNER}, 5000000);`);
  return db;
}

/** What the stubbed model answers. Tests change it between runs. */
const model = {
  discovery: [] as Array<{ name: string; domain: string; category: string }>,
  synthesis: {} as Record<string, unknown>,
  /** A statement containing this text throws, as a D1 outage would mid-route. */
  failSql: '',
};

/** The D1 binding, with every statement naming `model.failSql` throwing when it runs. */
function failing(d1: any) {
  const boom = () => { throw new Error('D1_ERROR: storage unavailable'); };
  return new Proxy(d1, {
    get(target, key) {
      if (key !== 'prepare') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      return (sql: string) => {
        const stmt = target.prepare(sql);
        if (!model.failSql || !sql.includes(model.failSql)) return stmt;
        const bound = { run: boom, runSync: boom, all: boom, first: boom, bind: () => bound };
        return bound;
      };
    },
  });
}

/** The public web: every page answers, except a host named `down`, which answers 503. */
async function withWeb<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    if (url.includes('down.example')) return new Response('unavailable', { status: 503, headers: { 'content-type': 'text/html' } });
    return new Response(
      '<html><head><title>Fresh page</title></head><body><h1>Freight</h1><p>Plans from $99 a month.</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    );
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = prev; }
}

async function call(db: any, method: string, path: string, json?: unknown, headers: Record<string, string> = {}, user = OWNER) {
  const AI: any = withGuard({
    run: async (_m: string, input: any) => {
      const sys = String(input?.messages?.[0]?.content || '');
      if (sys.includes('competitive-intelligence analyst')) return { response: JSON.stringify(model.discovery) };
      if (sys.includes('positioning/messaging')) return { response: JSON.stringify({ positioning: 'Freight invoices.' }) };
      return { response: JSON.stringify(model.synthesis) };
    },
  });
  const app = new Hono<any>();
  app.route('/api/competitors', competitors);
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withWeb(() => app.fetch(new Request(`http://t/api/competitors${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: failing(d1Over(db)), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any));
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, type, version: res.headers.get('X-Analysis-Version') };
}

const runs = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs WHERE guard_for IS NULL').get() as any).n);
const outputOf = (db: any, id: string) => String((db.prepare('SELECT output_json FROM competitor_analysis_outputs WHERE analysis_id = ?').get(id) as any).output_json);

/**
 * One analysis with: Ledgerline and Oldco discovered, Plainrow added by hand,
 * a source attached by hand to Ledgerline, and a conclusion, notes and an
 * edited market summary saved as version 2.
 */
async function seeded(db: any) {
  model.failSql = "";
  model.discovery = [
    { name: 'Ledgerline', domain: 'ledgerline.example', category: 'direct' },
    { name: 'Oldco', domain: 'oldco.example', category: 'adjacent' },
  ];
  model.synthesis = { market_summary: 'A crowded back office.', gaps: ['Carrier disputes'], wedge: 'Disputes first.', next_actions: ['Interview five carriers'] };
  const made = await call(db, 'POST', '/analyze', { market: 'Freight invoice reconciliation', depth: 'quick' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = String(made.body.id);
  assert.equal(made.body.version, 1, 'a new analysis is version 1');
  const ledger = made.body.candidates.find((c: any) => c.name === 'Ledgerline');
  const plain = await call(db, 'POST', `/${id}/candidates`, { name: 'Plainrow', crawl: false });
  assert.equal(plain.status, 200);
  const attached = await call(db, 'POST', `/${id}/candidates/${ledger.id}/sources`, { url: 'https://press.example/ledgerline-raise' });
  assert.equal(attached.status, 200, JSON.stringify(attached.body));
  const out = { ...made.body.output, market_summary: 'My own read of the back office.', notes: 'Call Ledgerline.', conclusion: 'Lead with disputes.' };
  const saved = await call(db, 'PATCH', `/${id}`, { title: 'Freight, my take', output: out }, { 'If-Match': '1' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.version, 2);
  return { id, ledger: ledger.id as string, record: saved.body };
}

test('7176: a source attached by hand is origin manual; one a run fetched is origin fetched', async () => {
  const db = fixture();
  const { id, record } = await seeded(db);
  const manual = record.sources.filter((s: any) => s.origin === 'manual');
  assert.deepEqual(manual.map((s: any) => s.url), ['https://press.example/ledgerline-raise']);
  assert.ok(record.sources.some((s: any) => s.origin === 'fetched'), 'the run’s own sources read as fetched');
  const fromDb = db.prepare("SELECT COUNT(*) AS n FROM competitor_sources WHERE analysis_id = ? AND origin = 'manual'").get(id) as any;
  assert.equal(Number(fromDb.n), 1);
});

test('7176: refresh re-fetches the stored sources only — no model, no output write, the list and the attached source kept', async () => {
  const db = fixture();
  const { id } = await seeded(db);
  // One stored source whose page is down now: it keeps its old date.
  db.prepare("INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at) VALUES ('s-down', ?, NULL, 'https://down.example/pricing', 'pricing', 'Old copy', 200, '2026-11-12T09:40:00.000Z')").run(id);
  const before = outputOf(db, id);
  const candidatesBefore = (db.prepare('SELECT id, name FROM competitor_candidates WHERE analysis_id = ? ORDER BY id').all(id) as any[]).map((r) => ({ ...r }));
  const sourcesBefore = Number((db.prepare('SELECT COUNT(*) AS n FROM competitor_sources WHERE analysis_id = ?').get(id) as any).n);
  const mark = runs(db);
  model.discovery = [{ name: 'Somebody New', domain: 'new.example', category: 'direct' }];

  const r = await call(db, 'POST', `/${id}/refresh`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(runs(db), mark, 'refresh ran a model');
  assert.equal(outputOf(db, id), before, 'refresh wrote output_json');
  assert.deepEqual((db.prepare('SELECT id, name FROM competitor_candidates WHERE analysis_id = ? ORDER BY id').all(id) as any[]).map((x) => ({ ...x })), candidatesBefore,
    'refresh changed the competitor list');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM competitor_sources WHERE analysis_id = ?').get(id) as any).n), sourcesBefore,
    'refresh added or deleted a source row');
  assert.equal(r.body.refresh.checked, sourcesBefore);
  assert.equal(r.body.refresh.not_fetched, 1);
  assert.deepEqual(r.body.refresh.results.filter((x: any) => !x.ok).map((x: any) => x.id), ['s-down']);
  const down = db.prepare("SELECT fetched_at, title FROM competitor_sources WHERE id = 's-down'").get() as any;
  assert.equal(down.fetched_at, '2026-11-12T09:40:00.000Z', 'a page that did not answer lost its date');
  assert.equal(down.title, 'Old copy');
  const manual = db.prepare("SELECT origin, title FROM competitor_sources WHERE analysis_id = ? AND url = 'https://press.example/ledgerline-raise'").get(id) as any;
  assert.equal(manual.origin, 'manual', 'the attached source is still there, still manual');
  assert.equal(r.body.version, 2, 'a refresh is not a save');
  assert.equal(r.body.output.conclusion, 'Lead with disputes.');
  assert.equal(r.body.sections_edited.market_summary != null, true, 'the edited flag survived the refresh');
});

test('7176: a save is a version; a save based on an older version answers 409 and writes nothing', async () => {
  const db = fixture();
  const { id, record } = await seeded(db);
  assert.ok(record.sections_edited.market_summary, 'the edited section is dated');
  assert.equal(record.sections_edited.wedge, undefined, 'a section the save left alone is not marked edited');

  const stale = await call(db, 'PATCH', `/${id}`, { title: 'Stale tab' }, { 'If-Match': '1' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'version_conflict');
  assert.equal(stale.body.current_version, 2);
  assert.equal((db.prepare('SELECT title FROM competitor_analyses WHERE id = ?').get(id) as any).title, 'Freight, my take', 'a 409 wrote the title');

  const viaBody = await call(db, 'PATCH', `/${id}`, { title: 'Also stale', base_version: 1 });
  assert.equal(viaBody.status, 409, 'base_version in the body is checked too');

  const ok = await call(db, 'PATCH', `/${id}`, { title: 'Freight, v3' }, { 'If-Match': '"2"' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.version, 3);
  const kept = db.prepare('SELECT version FROM competitor_analysis_versions WHERE analysis_id = ? ORDER BY version').all(id) as any[];
  assert.deepEqual(kept.map((k) => k.version), [1, 2], 'each superseded version is kept');
});

test('7176: a rerun returns a proposal and writes nothing; your work is never in it', async () => {
  const db = fixture();
  const { id, ledger } = await seeded(db);
  const before = outputOf(db, id);
  const status = (db.prepare('SELECT status, inputs_json FROM competitor_analyses WHERE id = ?').get(id) as any);
  model.discovery = [
    { name: 'Ledgerline', domain: 'ledgerline.example', category: 'direct' },
    { name: 'Newco', domain: 'newco.example', category: 'direct' },
  ];
  model.synthesis = { market_summary: 'Two new integrators.', gaps: ['Carrier disputes', 'Cold sites'], wedge: 'Disputes first.', next_actions: ['Interview five carriers'] };

  const r = await call(db, 'POST', `/${id}/rerun`, { inputs: { market: 'Freight invoice reconciliation', depth: 'quick' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.base_version, 2);
  assert.ok(r.body.proposal_id);
  assert.deepEqual(r.body.candidates.add.map((c: any) => c.name), ['Newco']);
  assert.deepEqual(r.body.candidates.remove.map((c: any) => c.name), ['Oldco'],
    'Plainrow (added by hand) or Ledgerline (a source attached by hand) was proposed for removal');
  assert.equal(r.body.output.market_summary.changed, true);
  assert.ok(r.body.output.market_summary.edited_at, 'the rewrite of an edited section says it was edited');
  assert.equal(r.body.output.wedge.changed, false);
  assert.equal('notes' in r.body.output, false, 'notes were proposed');
  assert.equal('conclusion' in r.body.output, false, 'the conclusion was proposed');
  assert.deepEqual(r.body.kept.manual_candidates.map((c: any) => c.name), ['Plainrow']);
  assert.ok(ledger);

  assert.equal(outputOf(db, id), before, 'the rerun wrote the output');
  const after = (db.prepare('SELECT status, inputs_json FROM competitor_analyses WHERE id = ?').get(id) as any);
  assert.deepEqual({ ...after }, { ...status }, 'the rerun wrote the status or the inputs');
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM competitor_candidates WHERE analysis_id = ? AND name = 'Newco'").get(id) as any).n), 0);
});

test('7176: a failed rerun leaves the status and the body alone', async () => {
  const db = fixture();
  const { id } = await seeded(db);
  const before = outputOf(db, id);
  model.failSql = 'competitor_rerun_proposals';
  const r = await call(db, 'POST', `/${id}/rerun`, {});
  model.failSql = '';
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'rerun_failed');
  assert.match(r.body.message, /still version 2/);
  assert.equal((db.prepare('SELECT status FROM competitor_analyses WHERE id = ?').get(id) as any).status, 'complete');
  assert.equal(outputOf(db, id), before);
  const read = await call(db, 'GET', `/${id}`);
  assert.equal(read.body.candidates.length, 3, 'the competitors were touched');
});

test('7176: a failed refresh changes nothing', async () => {
  const db = fixture();
  const { id } = await seeded(db);
  const dates = () => (db.prepare('SELECT id, fetched_at FROM competitor_sources WHERE analysis_id = ? ORDER BY id').all(id) as any[]).map((r) => ({ ...r }));
  const before = dates();
  // The attached source is fetched last, and only its write fails: the fetched rows' writes
  // before it must not land either (one batch, D1 rolls it back).
  db.prepare("UPDATE competitor_sources SET created_at = '2999-01-01 00:00:00' WHERE analysis_id = ? AND origin = 'manual'").run(id);
  model.failSql = 'UPDATE competitor_sources SET status = ?, fetched_at = ? WHERE';
  const r = await call(db, 'POST', `/${id}/refresh`, {});
  model.failSql = '';
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'refresh_failed');
  assert.deepEqual(dates(), before, 'a failed refresh moved a date');
});

test('7176: apply takes only the ticked changes, with If-Match, as one new version', async () => {
  const db = fixture();
  const { id } = await seeded(db);
  model.discovery = [
    { name: 'Ledgerline', domain: 'ledgerline.example', category: 'direct' },
    { name: 'Newco', domain: 'newco.example', category: 'direct' },
    { name: 'Skipco', domain: 'skipco.example', category: 'adjacent' },
  ];
  model.synthesis = { market_summary: 'Two new integrators.', gaps: ['Cold sites'], wedge: 'Cold sites first.', next_actions: ['Interview five carriers'] };
  const p = await call(db, 'POST', `/${id}/rerun`, {});
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const newco = p.body.candidates.add.find((c: any) => c.name === 'Newco');
  const oldco = p.body.candidates.remove.find((c: any) => c.name === 'Oldco');
  const plain = (db.prepare("SELECT id FROM competitor_candidates WHERE analysis_id = ? AND name = 'Plainrow'").get(id) as any).id;
  const body = { proposal_id: p.body.proposal_id, add: [newco.id], remove: [oldco.id, plain], output: ['wedge', 'notes', 'conclusion'] };

  const noHeader = await call(db, 'POST', `/${id}/rerun/apply`, body);
  assert.equal(noHeader.status, 428);
  assert.equal(noHeader.body.error, 'if_match_required');
  const stale = await call(db, 'POST', `/${id}/rerun/apply`, body, { 'If-Match': '1' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'version_conflict');

  const ok = await call(db, 'POST', `/${id}/rerun/apply`, body, { 'If-Match': '2' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.version, 3);
  assert.deepEqual(ok.body.applied, { added: 1, removed: 1, rewritten: 1, version: 3 });
  const names = ok.body.candidates.map((c: any) => c.name).sort();
  assert.deepEqual(names, ['Ledgerline', 'Newco', 'Plainrow'], 'an unticked addition was added, or a manual row removed');
  assert.equal(ok.body.output.wedge, 'Cold sites first.');
  assert.equal(ok.body.output.market_summary, 'My own read of the back office.', 'an unticked rewrite replaced the person’s edit');
  assert.equal(ok.body.output.notes, 'Call Ledgerline.');
  assert.equal(ok.body.output.conclusion, 'Lead with disputes.');
  assert.ok(ok.body.sections_edited.market_summary, 'the kept edit lost its date');
  assert.ok(ok.body.sources.some((s: any) => s.origin === 'manual'), 'the attached source went');
  assert.ok(ok.body.sources.some((s: any) => s.candidate_id === newco.id), 'the added competitor came without its sources');

  const again = await call(db, 'POST', `/${id}/rerun/apply`, body, { 'If-Match': '3' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'proposal_gone', 'a proposal applied twice');
});

test('7176: a save after a rerun proposal makes the proposal stale', async () => {
  const db = fixture();
  const { id } = await seeded(db);
  const p = await call(db, 'POST', `/${id}/rerun`, {});
  assert.equal(p.status, 200);
  const saved = await call(db, 'PATCH', `/${id}`, { title: 'Saved in another tab' }, { 'If-Match': '2' });
  assert.equal(saved.status, 200);
  const r = await call(db, 'POST', `/${id}/rerun/apply`, { proposal_id: p.body.proposal_id, add: [], remove: [], output: ['wedge'] }, { 'If-Match': '2' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'version_conflict');
  assert.equal(r.body.current_version, 3);
});

test('7176: export is of a saved version and says which; an older version is readable', async () => {
  const db = fixture();
  const { id } = await seeded(db);
  const md = await call(db, 'GET', `/${id}/export?format=md`);
  assert.equal(md.status, 200);
  assert.match(md.type, /^text\/markdown/);
  assert.equal(md.version, '2');
  assert.match(md.body, /## Conclusion\nLead with disputes\./);

  const v1 = await call(db, 'GET', `/${id}/export?format=json&version=1`);
  assert.equal(v1.status, 200);
  assert.equal(v1.version, '1');
  assert.notEqual(v1.body.title, 'Freight, my take', 'version 1 came back with version 2’s title');
  assert.equal(v1.body.output.conclusion, undefined);

  const v2 = await call(db, 'GET', `/${id}/export?format=json&version=2`);
  assert.equal(v2.version, '2');
  assert.equal(v2.body.title, 'Freight, my take');

  const missing = await call(db, 'GET', `/${id}/export?format=md&version=9`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'version_not_found');
  const bad = await call(db, 'GET', `/${id}/export?format=md&version=two`);
  assert.equal(bad.status, 400);
});

test('7176: another member reaches none of it', async () => {
  const db = fixture();
  const { id } = await seeded(db);
  for (const [method, path, headers] of [
    ['POST', `/${id}/refresh`, {}], ['POST', `/${id}/rerun`, {}],
    ['POST', `/${id}/rerun/apply`, { 'If-Match': '2' }], ['GET', `/${id}/export?format=md&version=1`, {}],
  ] as const) {
    const r = await call(db, method, path, method === 'GET' ? undefined : {}, headers as Record<string, string>, OTHER);
    assert.equal(r.status, 404, `${method} ${path}`);
  }
});
