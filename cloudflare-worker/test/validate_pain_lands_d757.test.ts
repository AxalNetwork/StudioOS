/**
 * D757 (#1897) — an accepted pain reaches Problem discovery.
 *
 * Accept used to write only the severity row, and Problem discovery counts
 * themes from `discovery_interviews.pains_json`, so an accepted pain never
 * showed. These tests prove the mention, its severity and the founder's theme
 * land in one batch; that the same pain twice is one mention; that no Accept
 * writes half of the three rows or overwrites a list it could not read; that
 * a foreign or invented theme never reaches a row; and that the overview's
 * "would move" count equals what Accept moves.
 *
 * The model is stubbed through `env.AI.run`: nothing calls Workers AI or any
 * provider.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_pain_lands_d757.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { createJWT } from '../src/auth.ts';
import { parsePlacements, type Segment } from '../src/services/interviewStructuring.ts';
import { addInterviewPain } from '../src/services/interviewWriters.ts';
import { pendingMoves } from '../src/services/validateFocus.ts';
import structure, { loadStructureContext, storePlacements } from '../src/routes/founder_validate_structure.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, OTHER = 3, LAB = 4, FOUNDER = 9, LAB_FOUNDER = 19;
const PROJECT = 7, LAB_PROJECT = 8;
const MID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const QUOTE = 'By hand, every Friday. It takes my whole afternoon and I hate it.';
const CITE = { from: 4000, to: 12000 };

const SEGMENTS: Segment[] = [
  { start: 0, end: 4000, speaker: 'Me', text: 'How do you reconcile invoices today?' },
  { start: 4000, end: 12000, speaker: '[Interviewee]', text: QUOTE },
];

function world(reply: (model: string, input: any) => any = () => ({ response: '{"placements":[]}' })) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    UPDATE users SET role = 'advisor', founder_id = ${LAB_FOUNDER}, spinout_lab_active = 1 WHERE id = ${LAB};
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${ME}', ${ME}), ('jti-${OTHER}', ${OTHER}), ('jti-${LAB}', ${LAB});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    INSERT INTO projects VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}, NULL), (${LAB_PROJECT}, 'Lab venture', ${LAB_FOUNDER}, NULL);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json) VALUES
      (101, ${PROJECT}, 'A', '[]'), (102, ${PROJECT}, 'B', '[]'), (201, ${LAB_PROJECT}, 'Lab interviewee', '[]');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
  `);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '453_interview_processing.sql']) {
    db.exec(mig(m));
  }
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  applyEngineSchema(db);
  db.exec(`
    INSERT INTO hypotheses (id, project_id, code, claim) VALUES (31, ${PROJECT}, 'H1', 'Finance leads reconcile by hand');
    INSERT INTO pain_groups (id, project_id, title) VALUES
      (41, ${PROJECT}, 'Manual reconciliation'), (42, ${PROJECT}, 'Cost'), (99, ${LAB_PROJECT}, 'Another venture');
  `);
  const prompts: string[] = [];
  const env: any = {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB,
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) return { response: 'safe' };
        for (const m of input?.messages ?? []) if (m.role === 'system') prompts.push(String(m.content));
        return reply(model, input);
      },
    },
  };
  return { env, db, prompts };
}

async function call(env: any, app: any, method: string, path: string, body?: unknown, id = ME) {
  const role = id === LAB ? 'advisor' : 'founder';
  const token = await createJWT(env, id, `u${id}@example.test`, role, undefined, `jti-${id}`);
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const CTX = { hypotheses: [{ id: 31, code: 'H1', claim: 'x' }], painGroups: [{ id: 41, title: 'Manual reconciliation' }, { id: 42, title: 'Cost' }] };
const pain = (payload: Record<string, unknown>) => ({ kind: 'pain_severity', payload, cite: CITE, quote: QUOTE });

/** Store pending placements for one session; returns their ids, oldest first. */
async function seed(env: any, db: any, payloads: Record<string, unknown>[], opts: { session?: number; interview?: number; project?: number } = {}) {
  const before = Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM validate_proposals').get().n);
  const ctx = await loadStructureContext(env, opts.project ?? PROJECT);
  const parsed = parsePlacements(JSON.stringify({ placements: payloads.map(pain) }), SEGMENTS, ctx);
  assert.equal(parsed.dropped, 0, 'a seeded placement was dropped');
  await storePlacements(env, {
    projectId: opts.project ?? PROJECT, sessionId: opts.session ?? 5, interviewId: opts.interview ?? 101,
    runId: `run-${opts.session ?? 5}-${before}`, userId: ME, model: MID, placements: parsed.placements,
  });
  return db.prepare('SELECT id FROM validate_proposals WHERE id > ? ORDER BY id').all(before).map((r: any) => Number(r.id));
}

const painsOf = (db: any, id = 101) => JSON.parse(db.prepare('SELECT pains_json FROM discovery_interviews WHERE id = ?').get(id).pains_json);
const rawPainsOf = (db: any, id = 101) => db.prepare('SELECT pains_json FROM discovery_interviews WHERE id = ?').get(id).pains_json;
const severities = (db: any) => db.prepare('SELECT interview_id, phrase_norm, severity FROM interview_pain_severities ORDER BY id').all().map((r: any) => ({ ...r }));
const aliases = (db: any) => db.prepare('SELECT project_id, group_id, phrase_norm FROM pain_group_aliases ORDER BY id').all().map((r: any) => ({ ...r }));
const statusOf = (db: any, id: number) => db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id).status;
const painLogs = (db: any) => db.prepare(
  "SELECT action, entity_id, details FROM activity_logs WHERE action IN ('interview_pain_added', 'pain_severity_set') ORDER BY id",
).all().map((r: any) => ({ ...r }));

async function themes(env: any) {
  const r = await call(env, cycleValidate, 'GET', `/overview?project=${PROJECT}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.cards.find((c: any) => c.slug === 'problem-discovery').series?.themes ?? [];
}
const accept = (env: any, id: number, body?: unknown, user = ME) => call(env, structure, 'POST', `/placements/${id}/accept`, body, user);

// ── 1. an accepted session pain appears in Problem discovery ─────────────────

test('an accepted session pain appears in Problem discovery, and its log names the interview, never the phrase', async () => {
  const { env, db } = world();
  const [id] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real' }]);
  assert.deepEqual(painsOf(db), []);
  assert.equal((await themes(env)).some((t: any) => t.theme === 'Reconcile by hand'), false);
  assert.equal((await pendingMoves(env, PROJECT, 5)).themes, 1);

  const r = await accept(env, id);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.pain, { mention: 'added', group_id: null });
  assert.deepEqual(painsOf(db), ['Reconcile by hand'], 'the mention was not appended to pains_json');
  const t = (await themes(env)).find((x: any) => x.theme === 'Reconcile by hand');
  assert.ok(t, 'the accepted pain is not on the Problem discovery card');
  assert.equal(t.mentions, 1);
  assert.equal(t.severity, 'real');
  assert.equal(t.real, 1);
  const m = await call(env, cycleValidate, 'GET', `/modules/problem-discovery?project=${PROJECT}`);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.match(JSON.stringify(m.json.records.rows), /Reconcile by hand/, 'the module records do not list the accepted pain');
  const logs = painLogs(db);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'interview_pain_added');
  assert.equal(String(logs[0].entity_id), '101');
  assert.doesNotMatch(JSON.stringify(logs), /reconcile/i, 'the log carried the phrase');
});

// ── 2. with the founder's theme ──────────────────────────────────────────────

test("a pain naming the founder's theme lands under it, and naming another theme moves the phrase", async () => {
  const { env, db } = world();
  const [id] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 }]);
  const r = await accept(env, id);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.pain, { mention: 'added', group_id: 41 });
  assert.deepEqual(aliases(db), [{ project_id: PROJECT, group_id: 41, phrase_norm: 'reconcile by hand' }]);
  const t = (await themes(env)).find((x: any) => x.theme === 'Manual reconciliation');
  assert.ok(t, 'the theme the pain named is not on the card');
  assert.equal(t.mentions, 1);
  assert.equal(t.severity, 'real');
  assert.equal((await themes(env)).some((x: any) => x.theme === 'Reconcile by hand'), false);

  db.prepare("UPDATE pain_group_aliases SET group_id = 42").run();
  const [again] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'severe', pain_group_id: 41 }], { session: 6 });
  assert.equal((await accept(env, again)).status, 200);
  assert.deepEqual(aliases(db).map((a: any) => a.group_id), [41], 'Accept did not re-assign the phrase to the theme it named');
});

// ── 3. the same phrase twice is one mention ──────────────────────────────────

test('the same pain accepted twice, in two wordings, is one mention with the later severity', async () => {
  const { env, db } = world();
  const [a] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real' }], { session: 5 });
  const [b] = await seed(env, db, [{ phrase: 'reconcile   by hand!', severity: 'severe' }], { session: 6 });
  assert.equal((await accept(env, a)).status, 200);
  const r = await accept(env, b);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.pain.mention, 'already_logged');
  assert.deepEqual(painsOf(db), ['Reconcile by hand'], 'a second wording appended a second mention');
  assert.deepEqual(severities(db), [{ interview_id: 101, phrase_norm: 'reconcile by hand', severity: 'severe' }]);
  assert.equal((await themes(env)).find((x: any) => x.theme === 'Reconcile by hand').mentions, 1);
  assert.deepEqual(painLogs(db).map((l: any) => l.action), ['interview_pain_added', 'pain_severity_set']);
});

test('a pain the founder already typed appends nothing and keeps the typed wording', async () => {
  const { env, db } = world();
  // What the interview form's PUT stores: the whole list as typed.
  db.prepare(`UPDATE discovery_interviews SET pains_json = '["Reconcile by hand."]' WHERE id = 101`).run();
  const [id] = await seed(env, db, [{ phrase: 'reconcile by hand', severity: 'mild' }]);
  const r = await accept(env, id);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.pain, { mention: 'already_logged', group_id: null });
  assert.deepEqual(painsOf(db), ['Reconcile by hand.']);
  assert.deepEqual(severities(db), [{ interview_id: 101, phrase_norm: 'reconcile by hand', severity: 'mild' }]);
});

// ── 4. the cap ───────────────────────────────────────────────────────────────

test('addInterviewPain caps a direct caller\'s phrase at 120 characters', async () => {
  const { env, db } = world();
  const out = await addInterviewPain(env, { projectId: PROJECT, interviewId: 101, phrase: `  ${'x'.repeat(130)}  ` });
  await env.DB.batch(out.statements);
  assert.equal(painsOf(db)[0].length, 120);
  await assert.rejects(addInterviewPain(env, { projectId: PROJECT, interviewId: 201, phrase: 'x' }), /Interview not found/);
  await assert.rejects(addInterviewPain(env, { projectId: PROJECT, interviewId: 101, phrase: ' !? ' }), /needs a phrase/);
});

// ── 5. a foreign or invented theme ───────────────────────────────────────────

test('at parse, a foreign, invented or malformed theme drops the placement; no key, or null, is an ungrouped pain', () => {
  for (const bad of [99, 0, -1, '41', 41.5, 7777]) {
    const r = parsePlacements(JSON.stringify({ placements: [pain({ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: bad })] }), SEGMENTS, CTX);
    assert.equal(r.placements.length, 0, `pain_group_id ${JSON.stringify(bad)} was kept`);
    assert.equal(r.dropped, 1, `pain_group_id ${JSON.stringify(bad)} was not counted as dropped`);
  }
  const named = parsePlacements(JSON.stringify({ placements: [pain({ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 })] }), SEGMENTS, CTX);
  assert.deepEqual(named.placements[0].payload, { phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 });
  for (const p of [{ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: null }, { phrase: 'Reconcile by hand', severity: 'real' }]) {
    const r = parsePlacements(JSON.stringify({ placements: [pain(p)] }), SEGMENTS, CTX);
    assert.deepEqual(r.placements[0].payload, { phrase: 'Reconcile by hand', severity: 'real' });
  }
  const extra = parsePlacements(JSON.stringify({ placements: [pain({ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 42, theme: 'Brand new theme', title: 'New' })] }), SEGMENTS, CTX);
  assert.deepEqual(Object.keys(extra.placements[0].payload).sort(), ['pain_group_id', 'phrase', 'severity']);
});

test('at edit, a foreign theme is refused; another of the project\'s themes lands; clearing never un-groups', async () => {
  const { env, db } = world();
  const groupsBefore = db.prepare('SELECT COUNT(*) AS n FROM pain_groups').get().n;
  const [a, b, c] = await seed(env, db, [
    { phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 },
    { phrase: 'Month-end panic', severity: 'severe', pain_group_id: 41 },
    { phrase: 'Friday close', severity: 'mild', pain_group_id: 41 },
  ]);
  const bad = await accept(env, a, { payload: { phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 99 } });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, 'invalid_edit');
  assert.equal(statusOf(db, a), 'pending');
  assert.deepEqual(painsOf(db), []);
  assert.deepEqual(severities(db), []);

  assert.equal((await accept(env, b, { payload: { phrase: 'Month-end panic', severity: 'severe', pain_group_id: 42 } })).status, 200);
  assert.equal((await themes(env)).find((x: any) => x.theme === 'Cost')?.mentions, 1, 'the edited theme did not land');

  // The founder had already grouped "Friday close" under Cost; an edit that
  // clears the theme files it under no theme from this accept, and the alias stays.
  db.prepare(`INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
              VALUES (${PROJECT}, 42, 'friday close', 'Friday close', 'x', 'x')`).run();
  const cleared = await accept(env, c, { payload: { phrase: 'Friday close', severity: 'mild', pain_group_id: null } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.deepEqual(cleared.json.pain, { mention: 'added', group_id: null });
  assert.equal(db.prepare("SELECT group_id FROM pain_group_aliases WHERE phrase_norm = 'friday close'").get().group_id, 42);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pain_groups').get().n, groupsBefore, 'a path in this file created a theme');
});

// ── 6. a theme deleted after the proposal ────────────────────────────────────

test('a theme deleted after the proposal is refused, nothing is written, and clearing it then lands', async () => {
  const { env, db } = world();
  const [id] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 }]);
  db.prepare('DELETE FROM pain_groups WHERE id = 41').run();
  const r = await accept(env, id);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'not_this_project');
  assert.deepEqual(painsOf(db), []);
  assert.deepEqual(severities(db), []);
  assert.deepEqual(aliases(db), []);
  assert.equal(statusOf(db, id), 'pending');
  const ok = await accept(env, id, { payload: { phrase: 'Reconcile by hand', severity: 'real' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(painsOf(db), ['Reconcile by hand']);
});

// ── 7. the batch is all or nothing ───────────────────────────────────────────

/** Make the founder's form save `pains_json` just before the next `times` batches. */
function raceBatches(env: any, db: any, times: number) {
  const batch = env.DB.batch.bind(env.DB);
  let n = 0;
  env.DB.batch = async (stmts: any[]) => {
    if (n < times) {
      n += 1;
      db.prepare(`UPDATE discovery_interviews SET pains_json = ? WHERE id = 101`).run(JSON.stringify(n === 1 ? ['Typed by hand'] : ['Typed by hand', `edit ${n}`]));
    }
    return batch(stmts);
  };
}

test('a list changed between the read and the batch is re-read once, and the pain lands beside it', async () => {
  const { env, db } = world();
  const [id] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 }]);
  raceBatches(env, db, 1);
  const r = await accept(env, id);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(painsOf(db), ['Typed by hand', 'Reconcile by hand']);
  assert.equal(severities(db).length, 1);
});

test('a second loss is a 409 that writes nothing and leaves the placement pending', async () => {
  const { env, db } = world();
  const [id] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 }]);
  raceBatches(env, db, 2);
  const r = await accept(env, id);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'writer_refused');
  assert.equal(r.json.detail, 'This interview changed while the pain was saved. Nothing was written. Accept it again.');
  assert.deepEqual(painsOf(db), ['Typed by hand', 'edit 2']);
  assert.deepEqual(severities(db), [], 'a severity row landed without its mention');
  assert.deepEqual(aliases(db), [], 'an alias landed without its mention');
  assert.deepEqual(painLogs(db), []);
  assert.equal(statusOf(db, id), 'pending');
});

// ── 8. unreadable pains ──────────────────────────────────────────────────────

test('an unreadable pains_json is refused and never overwritten', async () => {
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET pains_json = 'not json' WHERE id = 101").run();
  const [id] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real' }]);
  const r = await accept(env, id);
  assert.equal(r.status, 409);
  assert.match(r.json.detail, /could not be read/);
  assert.equal(rawPainsOf(db), 'not json');
  assert.deepEqual(severities(db), []);
  assert.equal(statusOf(db, id), 'pending');
});

// ── 9. only the founder's Accept writes ──────────────────────────────────────

function withSession(w: ReturnType<typeof world>) {
  w.db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
                VALUES (5, 'sess-5', 101, ?, ?, 'video', 'transcribed', 'given')`).run(PROJECT, ME);
  for (const seg of SEGMENTS) {
    w.db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text, model)
                  VALUES (5, 'final', ?, ?, ?, ?, 'whisper')`).run(seg.start, seg.end, seg.speaker, seg.text);
  }
  return w;
}

const REPLY = JSON.stringify({ placements: [pain({ phrase: 'Reconcile by hand', severity: 'severe', pain_group_id: 41 })] });

test('Structure and Discard write no pain; another member is refused; a second Accept appends nothing', async () => {
  const w = withSession(world(() => ({ response: REPLY })));
  const { env, db } = w;
  const s = await call(env, structure, 'POST', '/sessions/5/structure');
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.deepEqual(painsOf(db), []);
  assert.deepEqual(severities(db), []);
  assert.deepEqual(aliases(db), []);
  const ids = db.prepare("SELECT id FROM validate_proposals WHERE kind = 'pain_severity' ORDER BY id").all().map((r: any) => r.id);
  assert.equal(ids.length, 1);

  assert.equal((await accept(env, ids[0], undefined, OTHER)).status, 403);
  assert.deepEqual(painsOf(db), []);

  const [toDiscard] = await seed(env, db, [{ phrase: 'Friday close', severity: 'mild' }], { session: 6 });
  assert.equal((await call(env, structure, 'POST', `/placements/${toDiscard}/discard`)).status, 200);
  assert.deepEqual(painsOf(db), []);

  assert.equal((await accept(env, ids[0])).status, 200);
  const again = await accept(env, ids[0]);
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'not_pending');
  assert.deepEqual(painsOf(db), ['Reconcile by hand']);
});

test("a Lab venture's member accepts a pain onto that venture's interview", async () => {
  const { env, db } = world();
  const [id] = await seed(env, db, [{ phrase: 'Reconcile by hand', severity: 'real' }], { interview: 201, project: LAB_PROJECT });
  const r = await accept(env, id, undefined, LAB);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(painsOf(db, 201), ['Reconcile by hand']);
  assert.deepEqual(painsOf(db, 101), []);
});

// ── 10. pendingMoves matches Accept ──────────────────────────────────────────

test("the overview's would-move count equals the themes Accept moves", async () => {
  const { env, db } = world();
  db.prepare(`INSERT INTO pain_groups (id, project_id, title) VALUES (43, ${PROJECT}, 'Late payments')`).run();
  const ids = await seed(env, db, [
    { phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 },
    { phrase: 'Month-end panic', severity: 'severe', pain_group_id: 41 },
    { phrase: 'Friday close', severity: 'mild' },
    { phrase: 'Late invoices', severity: 'real', pain_group_id: 43 },
  ]);
  db.prepare('DELETE FROM pain_groups WHERE id = 43').run();
  assert.equal((await pendingMoves(env, PROJECT, 5)).themes, 2);

  const before = new Map((await themes(env)).map((t: any) => [t.theme, t.mentions]));
  const statuses = [];
  for (const id of ids) statuses.push((await accept(env, id)).status);
  assert.deepEqual(statuses, [200, 200, 200, 409]);
  const rose = (await themes(env)).filter((t: any) => t.mentions > (before.get(t.theme) ?? 0)).map((t: any) => t.theme).sort();
  assert.deepEqual(rose, ['Friday close', 'Manual reconciliation']);
});

// ── 11. the placements read ──────────────────────────────────────────────────

test('the placements read names each pain\'s theme, and says when it has gone', async () => {
  const w = withSession(world());
  const { env, db } = w;
  await seed(env, db, [
    { phrase: 'Reconcile by hand', severity: 'real', pain_group_id: 41 },
    { phrase: 'Friday close', severity: 'mild' },
  ]);
  const read = async () => (await call(env, structure, 'GET', '/sessions/5/placements')).json.runs.flatMap((r: any) => r.placements);
  let ps = await read();
  assert.deepEqual(ps.map((p: any) => [p.theme, p.theme_missing]), [[{ id: 41, title: 'Manual reconciliation' }, undefined], [null, undefined]]);
  db.prepare('DELETE FROM pain_groups WHERE id = 41').run();
  ps = await read();
  assert.deepEqual(ps.map((p: any) => [p.theme, p.theme_missing]), [[null, true], [null, undefined]]);
});

// ── 12. the prompt ───────────────────────────────────────────────────────────

test("the prompt lists the founder's themes and says never to invent one", async () => {
  const w = withSession(world(() => ({ response: REPLY })));
  assert.equal((await call(w.env, structure, 'POST', '/sessions/5/structure')).status, 201);
  const first = w.prompts.find((p) => p.includes('pain_severity'));
  assert.ok(first, 'no prompt taught pain_severity');
  assert.match(first, /- 41: Manual reconciliation/);
  assert.match(first, /- 42: Cost/);
  assert.ok(first.includes('Give a pain_group_id only when the pain belongs to a pain group in the list. Never invent a group or name a new one: leave pain_group_id out instead.'));
});
