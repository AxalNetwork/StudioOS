/**
 * D7175 (#7175, canvas D7041) — Research › Companies analysis: a fixed subject
 * from setup to results, and no finding without a source.
 *
 * Held here:
 *   - the migration gives a fresh build `competitor_analyses.subject_uid` and
 *     `research_company_directory.website_verified_at`, both nullable;
 *   - `normalizeOutput` writes no fallback gaps, wedge or next actions, keeps
 *     only citations to fetched sources, moves an unsupported gap or wedge to
 *     the questions, and with 0 fetched sources states nothing at all;
 *   - self-match protection refuses the subject's name, uid and domain;
 *   - a failed read is recorded with its status, so the evidence status can
 *     tell Unavailable from Insufficient evidence;
 *   - the routes: an unknown or malformed subject is refused before a run, the
 *     saved list carries each row's subject and evidence, the hand-typed
 *     candidate cannot be the subject, the directory record says Not verified,
 *     and the Markdown export carries Subject, Evidence, findings with their
 *     source numbers and the Suggested research questions heading.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/competitor_subject_evidence_7175.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import competitors, { subjectAndEvidenceLines } from '../src/routes/competitors.ts';
import research from '../src/routes/research.ts';
import {
  evidenceOf, failedRead, isSubjectMatch, normalizeOutput, numberedSources,
  type Candidate, type SourceRecord,
} from '../src/services/competitorAnalysis.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d7175-subject-0123456789';
const ME = 71, OTHER = 72;

const cand = (id: string, name: string, category: 'direct' | 'adjacent' = 'direct'): Candidate => ({
  id, name, domain: `${name.toLowerCase().replace(/\s+/g, '')}.example`, url: null, category,
  relevance_score: 50, scores: { industry: 50, icp: 50, geo: 50, problem: 50, signal: 50 },
  summary: '', details: {}, origin: 'discovered', position: 0,
});
const src = (id: string, candidate_id: string, status: number, url = `https://${id}.example/`): SourceRecord =>
  ({ id, candidate_id, url, kind: 'homepage', title: '', status, fetched_at: '2026-11-16T10:42:00Z' });
const INPUTS = { market: 'Grid-scale battery storage', target_customer: 'Utilities', problem: 'Peak load' };

test('the migration adds a nullable subject uid to the run and a nullable verified date to the directory record', () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const col = (t: string, c: string) => (db.prepare(`SELECT * FROM pragma_table_info('${t}')`).all() as any[]).find((r) => r.name === c);
  assert.deepEqual(
    { type: col('competitor_analyses', 'subject_uid')?.type, notnull: col('competitor_analyses', 'subject_uid')?.notnull, dflt: col('competitor_analyses', 'subject_uid')?.dflt_value },
    { type: 'TEXT', notnull: 0, dflt: null },
  );
  assert.deepEqual(
    { type: col('research_company_directory', 'website_verified_at')?.type, notnull: col('research_company_directory', 'website_verified_at')?.notnull },
    { type: 'TEXT', notnull: 0 },
  );
});

test('with no model answer, the run writes no gaps, no wedge and no next actions of its own', () => {
  const cands = [cand('c1', 'Ferrous Power')];
  const out = normalizeOutput(null, INPUTS, cands, [src('s1', 'c1', 200)]);
  assert.deepEqual(out.gaps, []);
  assert.equal(out.wedge, '');
  assert.deepEqual(out.next_actions, []);
  assert.deepEqual(out.findings, []);
});

test('a finding keeps only citations to fetched sources, numbered in the order the run read them', () => {
  const cands = [cand('c1', 'Ferrous Power'), cand('c2', 'Gridlift')];
  // s2 failed: it is not numbered, so [2] is s3.
  const sources = [src('s1', 'c1', 200), src('s2', 'c1', 503), src('s3', 'c2', 200)];
  assert.deepEqual(numberedSources(sources, cands).map((l) => l.slice(0, 18)), ['[1] Ferrous Power ', '[2] Gridlift · hom']);
  const out = normalizeOutput({
    findings: [
      { text: 'Both sell 4-hour batteries.', kind: 'fact', sources: [1, 2, 2, 9] },
      { text: 'Price is the difference.', kind: 'interpretation', sources: [2] },
      { text: 'Routebook is cheapest.', kind: 'fact', sources: [] },
      { text: '  ', sources: [1] },
    ],
  } as any, INPUTS, cands, sources);
  assert.deepEqual(out.findings, [
    { text: 'Both sell 4-hour batteries.', kind: 'fact', source_ids: ['s1', 's3'] },
    { text: 'Price is the difference.', kind: 'interpretation', source_ids: ['s3'] },
    { text: 'Routebook is cheapest.', kind: 'fact', source_ids: [] },
  ]);
});

test('a gap or wedge line with no fetched source becomes a suggested research question, not a finding', () => {
  const cands = [cand('c1', 'Ferrous Power')];
  const out = normalizeOutput({
    gaps: [{ text: 'No public prices', sources: [1] }, 'Weak onboarding', { text: 'Thin Nordic coverage', sources: [7] }],
    wedge: { text: 'Win Nordic utilities', sources: [] },
    next_actions: ['Which utilities tender storage?'],
  } as any, INPUTS, cands, [src('s1', 'c1', 200)]);
  assert.deepEqual(out.gaps, ['No public prices']);
  assert.equal(out.wedge, '');
  assert.deepEqual(out.next_actions, [
    'Which utilities tender storage?',
    'What source would confirm this: “Weak onboarding”?',
    'What source would confirm this: “Thin Nordic coverage”?',
    'What source would confirm this: “Win Nordic utilities”?',
  ]);
});

test('0 fetched sources is Insufficient evidence: no summary, gaps, classifications, wedge or findings', () => {
  const out = normalizeOutput({
    market_summary: 'A crowded market.',
    direct_competitors: ['Invented Co'],
    gaps: [{ text: 'Gap', sources: [1] }],
    wedge: 'A wedge',
    findings: [{ text: 'A claim', sources: [1] }],
    traction_signals: [{ competitor: 'Invented Co', signal: 'big' }],
  } as any, INPUTS, [], []);
  assert.equal(out.market_summary, '');
  assert.deepEqual([out.direct_competitors, out.adjacent_competitors, out.gaps, out.findings, out.traction_signals], [[], [], [], [], []]);
  assert.equal(out.wedge, '');
  // The gap's [1] names no fetched source, so it is a question too.
  assert.deepEqual(out.next_actions, ['What source would confirm this: “Gap”?', 'What source would confirm this: “A wedge”?', 'What source would confirm this: “A claim”?']);
});

test('self-match protection refuses the subject by name, by uid and by site, and nothing without a subject', () => {
  const subject = { uid: 'q90410231', name: 'Halden Grid', domain: 'halden-grid.example' };
  assert.equal(isSubjectMatch(subject, { name: '  halden   GRID ' }), true);
  assert.equal(isSubjectMatch(subject, { name: 'q90410231' }), true);
  assert.equal(isSubjectMatch(subject, { name: 'HG', url: 'https://www.halden-grid.example/about' }), true);
  assert.equal(isSubjectMatch(subject, { name: 'HG', domain: 'halden-grid.example' }), true);
  assert.equal(isSubjectMatch(subject, { name: 'Halden Grids', domain: 'haldengrid.example' }), false);
  assert.equal(isSubjectMatch(undefined, { name: 'Halden Grid' }), false);
});

test('a failed read is the homepage, a timeout, a rate limit or a server error; a missing guessed path is not', () => {
  assert.equal(failedRead(true, { ok: false, status: 404 }), true);
  assert.equal(failedRead(false, { ok: false, status: 404 }), false);
  assert.equal(failedRead(false, { ok: false, status: 0 }), true);
  assert.equal(failedRead(false, { ok: false, status: 503 }), true);
  assert.equal(failedRead(false, { ok: false, status: 429 }), true);
  assert.equal(failedRead(true, { ok: true, status: 200 }), false);
});

test('the evidence status: insufficient, no candidates, unavailable, supported and partial', () => {
  const f = (ids: string[]) => ({ text: 't', kind: 'fact', source_ids: ids });
  assert.equal(evidenceOf({ candidates: [], sources: [], output: {} }).status, 'insufficient');
  assert.equal(evidenceOf({ candidates: [1], sources: [], output: {} }).status, 'insufficient');
  assert.equal(evidenceOf({ candidates: [], sources: [{ id: 'a', status: 200 }], output: {} }).status, 'no_candidates');
  assert.equal(evidenceOf({ candidates: [1], sources: [{ id: 'a', status: 503 }, { id: 'b', status: 0 }] }).status, 'unavailable');
  assert.equal(evidenceOf({ candidates: [1], sources: [{ id: 'a', status: 200 }], output: { findings: [f(['a'])] } }).status, 'supported');
  assert.equal(evidenceOf({ candidates: [1], sources: [{ id: 'a', status: 200 }], output: { findings: [f(['a']), f([])] } }).status, 'partial');
  assert.equal(evidenceOf({ candidates: [1], sources: [{ id: 'a', status: 200 }, { id: 'b', status: 503 }], output: { findings: [f(['a'])] } }).status, 'partial');
  assert.equal(evidenceOf({ candidates: [1], sources: [{ id: 'a', status: 200 }], output: { findings: [] } }).status, 'partial');
  // A citation to a source that failed (or was removed) is no citation.
  const e = evidenceOf({ candidates: [1], sources: [{ id: 'a', status: 200 }, { id: 'b', status: 404 }], output: { findings: [f(['b']), f(['a'])] } });
  assert.deepEqual(e, { status: 'partial', candidates: 1, sources_tried: 2, sources_fetched: 1, sources_failed: 1, findings: 2, findings_with_source: 1 });
});

test('the export head names the subject and the evidence in the page\'s words', () => {
  const ev = evidenceOf({ candidates: [1], sources: [{ id: 'a', status: 200 }], output: { findings: [{ source_ids: ['a'] }] } });
  assert.deepEqual(subjectAndEvidenceLines({ uid: 'q1', name: 'Halden Grid', website: 'https://halden-grid.example', website_verified_at: null, read: 'ok' }, ev, 'complete'),
    ['Subject: Halden Grid (q1) · halden-grid.example · website not verified', 'Evidence: Supported · 1 of 1 sources fetched']);
  assert.deepEqual(subjectAndEvidenceLines(null, evidenceOf({ candidates: [], sources: [] }), 'complete'),
    ['Subject: None · custom market', 'Evidence: Insufficient evidence · 0 sources · 0 candidates']);
  assert.deepEqual(subjectAndEvidenceLines({ uid: 'q1', name: null, website: null, website_verified_at: null, read: 'unreadable' }, null, 'error'),
    ['Subject: q1 · the company record could not be read', 'Evidence: Not recorded · the run is error']);
});

// ---------------------------------------------------------------------------
// The routes, on the migrated schema.
// ---------------------------------------------------------------------------

function world() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ME, 'founder', 'Fay Founder', 'fay@example.test');
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test');
  db.prepare(`INSERT INTO research_company_directory (uid, name, website, source_name, source_url, as_of) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('q90410231', 'Halden Grid', 'https://halden-grid.example', 'Wikidata', 'https://www.wikidata.org/wiki/Q90410231', '2026-09-30');
  return db;
}
const app = new Hono<any>();
app.route('/api/competitors', competitors as any);
app.route('/api/research', research as any);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, who = ME) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* markdown */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}

/** A finished run on Halden Grid: two candidates, two fetched sources, one failed, one cited finding. */
function seedRun(db: DatabaseSync, o: { id?: string; subject?: string | null; status?: string } = {}) {
  const id = o.id || 'run-a';
  db.prepare(`INSERT INTO competitor_analyses (id, user_id, mode, title, inputs_json, status, subject_uid) VALUES (?, ?, 'custom', ?, ?, ?, ?)`)
    .run(id, ME, 'Halden Grid · competitors', JSON.stringify({ market: 'Grid storage', subject: { uid: 'q90410231', name: 'Halden Grid', domain: 'halden-grid.example' } }),
      o.status || 'complete', o.subject === undefined ? 'q90410231' : o.subject);
  const c = db.prepare(`INSERT INTO competitor_candidates (id, analysis_id, name, domain, category, origin, position) VALUES (?, ?, ?, ?, ?, 'discovered', ?)`);
  c.run(`${id}-c1`, id, 'Ferrous Power', 'ferrouspower.example', 'direct', 0);
  c.run(`${id}-c2`, id, 'Voltaic Software', 'voltaic.example', 'adjacent', 1);
  const s = db.prepare(`INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at) VALUES (?, ?, ?, ?, ?, '', ?, '2026-11-16T10:42:00Z')`);
  s.run(`${id}-s1`, id, `${id}-c1`, 'https://ferrouspower.example/', 'homepage', 200);
  s.run(`${id}-s2`, id, `${id}-c2`, 'https://voltaic.example/', 'homepage', 200);
  s.run(`${id}-s3`, id, `${id}-c2`, 'https://voltaic.example/customers', 'about', 503);
  db.prepare(`INSERT INTO competitor_analysis_outputs (analysis_id, output_json) VALUES (?, ?)`).run(id, JSON.stringify({
    market_summary: 'Utility storage.',
    findings: [
      { text: 'Ferrous Power sells 4-hour systems.', kind: 'fact', source_ids: [`${id}-s1`] },
      { text: 'Price is the difference.', kind: 'interpretation', source_ids: [`${id}-s2`] },
    ],
    gaps: [], wedge: '', next_actions: ['Which utilities tender storage?'],
    excluded: [{ name: 'Halden Grid', domain: 'halden-grid.example', uid: 'q90410231', reason: 'subject' }],
  }));
  return id;
}

test('a run on a subject the directory does not hold, or a malformed uid, is refused before anything is stored', async () => {
  const db = world();
  const unknown = await call(db, 'POST', '/api/competitors/analyze', { market: 'Grid storage', subject_uid: 'q00000000' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'subject_not_found');
  const bad = await call(db, 'POST', '/api/competitors/analyze', { market: 'Grid storage', subject_uid: "x' OR 1=1 --" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'subject_uid_invalid');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM competitor_analyses').get() as any).n, 0);
});

test('the saved list carries each run\'s subject and evidence status; a custom run has none', async () => {
  const db = world();
  seedRun(db);
  seedRun(db, { id: 'run-b', subject: null });
  db.exec(`DELETE FROM competitor_sources WHERE analysis_id = 'run-b'; DELETE FROM competitor_candidates WHERE analysis_id = 'run-b'`);
  seedRun(db, { id: 'run-c', status: 'error' });
  const r = await call(db, 'GET', '/api/competitors');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.analyses.map((a: any) => [a.id, a]));
  assert.equal(by['run-a'].subject_uid, 'q90410231');
  assert.equal(by['run-a'].subject_name, 'Halden Grid');
  assert.deepEqual(by['run-a'].evidence, { status: 'partial', candidates: 2, sources_tried: 3, sources_fetched: 2, sources_failed: 1, findings: 2, findings_with_source: 2 });
  assert.equal(by['run-b'].subject_name, null);
  assert.equal(by['run-b'].evidence.status, 'insufficient');
  assert.equal(by['run-c'].evidence, null, 'a failed run has no evidence status');
  assert.equal(r.body.subject_names, 'ok');
  // One analysis, read whole, says the same.
  const one = await call(db, 'GET', '/api/competitors/run-a');
  assert.equal(one.body.subject_uid, 'q90410231');
  assert.equal(one.body.evidence.status, 'partial');
  // Another member's list does not carry it.
  assert.deepEqual((await call(db, 'GET', '/api/competitors', undefined, OTHER)).body.analyses, []);
});

test('the subject cannot be added by hand as its own competitor, by name or by site', async () => {
  const db = world();
  const id = seedRun(db);
  for (const body of [{ name: 'halden grid' }, { name: 'HG', url: 'https://www.halden-grid.example' }]) {
    const r = await call(db, 'POST', `/api/competitors/${id}/candidates`, body);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'subject_not_candidate');
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM competitor_candidates WHERE analysis_id = ?').get(id) as any).n, 2);
});

test('the directory record says its website is not verified, and verified once a check is recorded', async () => {
  const db = world();
  assert.equal((await call(db, 'GET', '/api/research/company-directory/q90410231')).body.item.website_status, 'not_verified');
  db.exec(`UPDATE research_company_directory SET website_verified_at = '2026-11-16' WHERE uid = 'q90410231'`);
  const r = (await call(db, 'GET', '/api/research/company-directory/q90410231')).body.item;
  assert.deepEqual([r.website_status, r.website_verified_at], ['verified', '2026-11-16']);
  db.exec(`UPDATE research_company_directory SET website = '' WHERE uid = 'q90410231'`);
  assert.equal((await call(db, 'GET', '/api/research/company-directory/q90410231')).body.item.website_status, 'not_recorded');
});

test('the Markdown export carries Subject, Evidence, cited findings, Interpretation, questions and numbered sources', async () => {
  const db = world();
  const id = seedRun(db);
  const md = (await call(db, 'GET', `/api/competitors/${id}/export?format=md`)).text;
  assert.match(md, /^Subject: Halden Grid \(q90410231\) · halden-grid\.example · website not verified$/m);
  assert.match(md, /^Evidence: Partial · 2 of 3 sources fetched$/m);
  assert.match(md, /## Findings \(each cites a source\)\n- Ferrous Power sells 4-hour systems\. \[1\]/);
  assert.match(md, /## Interpretation\n- Price is the difference\. \[2\]/);
  assert.match(md, /## Suggested research questions \(not findings\)\n- Which utilities tender storage\?/);
  assert.doesNotMatch(md, /Recommended next actions/);
  assert.match(md, /Excluded from candidates: Halden Grid · halden-grid\.example — the subject\./);
  assert.match(md, /## Sources\n\[1\] https:\/\/ferrouspower\.example\/ · homepage · fetched 2026-11-16\n\[2\] https:\/\/voltaic\.example\//);
  assert.doesNotMatch(md, /voltaic\.example\/customers/, 'a failed read is not a numbered source');
  const json = (await call(db, 'GET', `/api/competitors/${id}/export?format=json`)).body;
  assert.equal(json.subject.name, 'Halden Grid');
  assert.equal(json.evidence.status, 'partial');
});
