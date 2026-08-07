/**
 * Spin-Out Lab — pure-logic tests + route-flow smoke test.
 *
 * Pure-logic tests cover the milestone catalog and the `weekMet` /
 * `unlockedFeaturesThrough` helpers. The smoke test drives the full
 * happy-path flow start → milestone (×4) → auto-advance → milestone
 * (week-2 set) → … → week-4 milestone (auto-exit) against a mocked D1
 * sql() helper, exercising the same exported logic functions the wire
 * handlers wrap. No new test deps — same node:test + tsc.transpileModule
 * pattern used by `projects.test.mjs`.
 *
 * Run with:  node --test cloudflare-worker/test/spinout_lab.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Load the catalog + helpers + 4 logic functions out of the real     */
/* TS source. Strips imports, slices each named export by anchor      */
/* + brace balancing, and re-exports them via a wrapping IIFE.        */
/* Same approach as `projects.test.mjs` — guarantees we test the      */
/* exact source bytes that ship to Cloudflare.                        */
/* ------------------------------------------------------------------ */
async function loadModule() {
  // The catalog constants were extracted to services/spinoutLabCatalog.ts
  // (route file re-exports them) — slice from both real sources.
  const srcPath = resolve(__dirname, '../src/routes/spinout_lab.ts');
  const catPath = resolve(__dirname, '../src/services/spinoutLabCatalog.ts');
  const src = `${await readFile(catPath, 'utf8')}\n\n${await readFile(srcPath, 'utf8')}`;

  function sliceBlock(anchor) {
    const start = src.indexOf(anchor);
    assert.notEqual(start, -1, `${anchor} not found in spinout_lab.ts`);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`failed to balance braces for ${anchor}`);
  }

  function sliceConstArray(anchor) {
    const start = src.indexOf(anchor);
    assert.notEqual(start, -1, `${anchor} not found in spinout_lab.ts`);
    let depth = 0;
    let i = src.indexOf('[', start);
    for (; i < src.length; i++) {
      if (src[i] === '[') depth++;
      else if (src[i] === ']') {
        depth--;
        if (depth === 0) {
          const semi = src.indexOf(';', i);
          return src.slice(start, semi + 1);
        }
      }
    }
    throw new Error(`failed to balance brackets for ${anchor}`);
  }

  // The two top-level scaffolding constants the logic depends on.
  const constSprint = (() => {
    const m = src.match(/const SPRINT_DAYS = \d+;/);
    assert.ok(m, 'SPRINT_DAYS not found');
    return m[0];
  })();

  const pieces = [
    sliceConstArray('export const MILESTONES'),
    sliceBlock('export const OPTIONAL_MILESTONES'),
    // Set literal has no braces — slice to the closing `]);`.
    (() => {
      const start = src.indexOf('export const VALID_MILESTONE_KEYS');
      assert.notEqual(start, -1, 'export const VALID_MILESTONE_KEYS not found');
      const end = src.indexOf(']);', start);
      assert.notEqual(end, -1, 'VALID_MILESTONE_KEYS terminator not found');
      return src.slice(start, end + 3);
    })(),
    sliceBlock('function weekForKey('),
    sliceBlock('export function weekMet('),
    sliceBlock('export function unlockedFeaturesThrough('),
    sliceBlock('function daysSince('),
    constSprint,
    sliceBlock('export async function getLabState('),
    sliceBlock('export async function startLab('),
    sliceBlock('export async function recordMilestone('),
    sliceBlock('export async function exitLab('),
  ];

  const body = pieces.map((b) => b.replace(/^export\s+/, '')).join('\n\n');

  const wrapped = `const __out = (() => {
    ${body}
    return {
      MILESTONES,
      VALID_MILESTONE_KEYS,
      weekForKey,
      weekMet,
      unlockedFeaturesThrough,
      getLabState,
      startLab,
      recordMilestone,
      exitLab,
    };
  })();`;

  const ts = (await import(resolve(__dirname, '../node_modules/typescript/lib/typescript.js')))
    .default;
  const { outputText } = ts.transpileModule(wrapped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });

  return new Function(`${outputText}; return __out;`)();
}

/* ------------------------------------------------------------------ */
/* In-memory sql() mock: enough surface to drive the route flow.      */
/* Pattern-matches the exact statements emitted by the logic fns.     */
/* ------------------------------------------------------------------ */
function makeSql(initial = { user: null, milestones: [] }) {
  const state = {
    user: initial.user || {
      id: 1,
      spinout_lab_active: 0,
      spinout_lab_week: 1,
      spinout_lab_started_at: null,
      is_incorporated: 0,
    },
    milestones: [...initial.milestones],
    nextMilestoneId: 1,
    log: [],
  };

  const sql = async (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    state.log.push({ text, values });

    // --- SELECTs --------------------------------------------------
    if (/^SELECT spinout_lab_active, spinout_lab_week, spinout_lab_started_at, is_incorporated FROM users WHERE id = \?$/i.test(text)) {
      return [state.user];
    }
    if (/^SELECT milestone_key AS key, week, completed_at FROM spinout_lab_milestones WHERE user_id = \? ORDER BY week ASC, completed_at ASC$/i.test(text)) {
      return state.milestones
        .slice()
        .sort((a, b) => a.week - b.week || a.completed_at.localeCompare(b.completed_at))
        .map((m) => ({ key: m.milestone_key, week: m.week, completed_at: m.completed_at }));
    }
    if (/^SELECT is_incorporated FROM users WHERE id = \?$/i.test(text)) {
      return [{ is_incorporated: state.user.is_incorporated }];
    }
    if (/^SELECT spinout_lab_active, spinout_lab_week FROM users WHERE id = \?$/i.test(text)) {
      return [{
        spinout_lab_active: state.user.spinout_lab_active,
        spinout_lab_week: state.user.spinout_lab_week,
      }];
    }
    if (/^SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = \?$/i.test(text)) {
      return state.milestones.map((m) => ({ milestone_key: m.milestone_key }));
    }

    // --- UPDATEs --------------------------------------------------
    // start: COALESCE preserves any existing started_at + non-zero week
    if (/^UPDATE users SET spinout_lab_active = 1, spinout_lab_week = COALESCE\(NULLIF\(spinout_lab_week, 0\), 1\), spinout_lab_started_at = COALESCE\(spinout_lab_started_at, datetime\('now'\)\) WHERE id = \?$/i.test(text)) {
      state.user.spinout_lab_active = 1;
      if (!state.user.spinout_lab_week) state.user.spinout_lab_week = 1;
      if (!state.user.spinout_lab_started_at) {
        state.user.spinout_lab_started_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
      }
      return [];
    }
    if (/^UPDATE users SET spinout_lab_week = \? WHERE id = \?$/i.test(text)) {
      state.user.spinout_lab_week = values[0];
      return [];
    }
    if (/^UPDATE users SET spinout_lab_active = 0, is_incorporated = 1 WHERE id = \?$/i.test(text)) {
      state.user.spinout_lab_active = 0;
      state.user.is_incorporated = 1;
      return [];
    }

    // --- INSERTs --------------------------------------------------
    if (/^INSERT OR IGNORE INTO spinout_lab_milestones \(user_id, week, milestone_key\) VALUES \(\?, \?, \?\)$/i.test(text)) {
      const [user_id, week, key] = values;
      if (state.milestones.some((m) => m.user_id === user_id && m.milestone_key === key)) {
        return [];
      }
      state.milestones.push({
        id: state.nextMilestoneId++,
        user_id,
        week,
        milestone_key: key,
        completed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
      return [];
    }

    throw new Error(`Unhandled SQL in mock: ${text}`);
  };
  sql.end = async () => {};
  return { sql, state };
}

/* ------------------------------------------------------------------ */
/* Pure-logic tests                                                   */
/* ------------------------------------------------------------------ */
test('catalog defines four weeks with the spec\'s feature unlocks', async () => {
  const { MILESTONES } = await loadModule();
  assert.equal(MILESTONES.length, 4);
  assert.deepEqual(MILESTONES.map((w) => w.week), [1, 2, 3, 4]);
  assert.ok(MILESTONES[0].unlockedFeatures.includes('customer-discovery'));
  assert.ok(MILESTONES[1].unlockedFeatures.includes('pitch-deck'));
  assert.ok(MILESTONES[2].unlockedFeatures.includes('cofounder-match'));
  assert.ok(MILESTONES[3].unlockedFeatures.includes('incorporate'));
});

test('VALID_MILESTONE_KEYS rejects typos but accepts every catalog key', async () => {
  const { VALID_MILESTONE_KEYS, MILESTONES } = await loadModule();
  for (const w of MILESTONES) {
    for (const k of [...w.requiredAll, ...(w.requiredAny ?? [])]) {
      assert.ok(VALID_MILESTONE_KEYS.has(k), `expected key ${k}`);
    }
  }
  assert.equal(VALID_MILESTONE_KEYS.has('not_a_real_key'), false);
});

test('weekMet: week 1 needs project + 3 interviews', async () => {
  const { weekMet } = await loadModule();
  assert.equal(weekMet(1, new Set(['project_created'])), false);
  assert.equal(
    weekMet(1, new Set([
      'project_created', 'customer_interview_logged_1', 'customer_interview_logged_2',
    ])),
    false,
  );
  assert.equal(
    weekMet(1, new Set([
      'project_created',
      'customer_interview_logged_1',
      'customer_interview_logged_2',
      'customer_interview_logged_3',
    ])),
    true,
  );
});

test('weekMet: week 3 enforces requiredAll AND at least one of requiredAny', async () => {
  const { weekMet } = await loadModule();
  assert.equal(weekMet(3, new Set(['advisor_meeting_booked'])), false);
  assert.equal(weekMet(3, new Set(['scoring_run_completed'])), false);
  assert.equal(weekMet(3, new Set(['scoring_run_completed', 'advisor_meeting_booked'])), true);
  assert.equal(weekMet(3, new Set(['scoring_run_completed', 'cofounder_request_sent'])), true);
});

test('unlockedFeaturesThrough is cumulative and stable per week', async () => {
  const { unlockedFeaturesThrough } = await loadModule();
  const w1 = unlockedFeaturesThrough(1);
  const w2 = unlockedFeaturesThrough(2);
  const w4 = unlockedFeaturesThrough(4);
  for (const f of w1) assert.ok(w2.includes(f), `${f} should remain at w2`);
  for (const f of w2) assert.ok(w4.includes(f), `${f} should remain at w4`);
  assert.equal(w1.includes('roadmap'), false);
  assert.equal(w2.includes('roadmap'), true);
  assert.equal(w4.includes('compliance'), true);
});

/* ------------------------------------------------------------------ */
/* Route-flow smoke test — start → milestone (auto-advance) → exit    */
/* ------------------------------------------------------------------ */
test('happy path: start → 4 weeks of milestones → auto-exit on week 4', async () => {
  // exitLab is not called here — week 4's 'incorporation_completed' milestone
  // auto-exits the lab from inside recordMilestone, which is the behaviour
  // this test asserts below. Exercising exitLab() directly is a separate test.
  const { startLab, recordMilestone } = await loadModule();
  const { sql, state } = makeSql();

  // start()
  let r = await startLab(sql, 1);
  assert.equal(r.ok, true);
  assert.equal(r.state.active, true);
  assert.equal(r.state.week, 1);
  assert.equal(r.state.is_incorporated, false);
  assert.ok(r.state.unlocked_features.includes('customer-discovery'));
  assert.equal(r.state.unlocked_features.includes('roadmap'), false);

  // ---- Week 1: project + 3 interviews → advance to week 2 ------------
  for (const key of [
    'project_created',
    'customer_interview_logged_1',
    'customer_interview_logged_2',
  ]) {
    r = await recordMilestone(sql, 1, key);
    assert.equal(r.ok, true);
    assert.equal(r.state.week, 1, `still week 1 after ${key}`);
  }
  r = await recordMilestone(sql, 1, 'customer_interview_logged_3');
  assert.equal(r.ok, true);
  assert.equal(r.state.week, 2, 'auto-advanced to week 2');
  assert.ok(r.state.unlocked_features.includes('roadmap'), 'week 2 features now unlocked');

  // Idempotent re-record stays at week 2.
  const before = state.milestones.length;
  r = await recordMilestone(sql, 1, 'project_created');
  assert.equal(r.ok, true);
  assert.equal(r.state.week, 2);
  assert.equal(state.milestones.length, before, 'duplicate milestone ignored');

  // ---- Week 2: okrs + brand + deck → advance to week 3 --------------
  for (const key of ['okrs_created', 'brand_basics_filled']) {
    r = await recordMilestone(sql, 1, key);
    assert.equal(r.state.week, 2, `still week 2 after ${key}`);
  }
  r = await recordMilestone(sql, 1, 'pitch_deck_drafted');
  assert.equal(r.state.week, 3);

  // ---- Week 3: scoring alone is NOT enough ---------------------------
  r = await recordMilestone(sql, 1, 'scoring_run_completed');
  assert.equal(r.state.week, 3, 'scoring alone does not advance week 3');
  r = await recordMilestone(sql, 1, 'advisor_meeting_booked');
  assert.equal(r.state.week, 4, 'scoring + mentor meets week 3');

  // Sanity: lab still on, not yet incorporated.
  assert.equal(r.state.active, true);
  assert.equal(r.state.is_incorporated, false);

  // ---- Week 4: incorporation_completed → auto-exit -------------------
  r = await recordMilestone(sql, 1, 'incorporation_completed');
  assert.equal(r.ok, true);
  assert.equal(r.state.active, false, 'lab auto-flips off on week-4 milestone');
  assert.equal(r.state.is_incorporated, true, 'is_incorporated set in same handler');
  assert.equal(state.user.is_incorporated, 1);
  assert.equal(state.user.spinout_lab_active, 0);
});

test('start: refuses for already-incorporated user with 409', async () => {
  const { startLab } = await loadModule();
  const { sql, state } = makeSql({
    user: {
      id: 1,
      spinout_lab_active: 0,
      spinout_lab_week: 1,
      spinout_lab_started_at: null,
      is_incorporated: 1,
    },
    milestones: [],
  });
  const r = await startLab(sql, 1);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(state.user.spinout_lab_active, 0, 'lab stays off');
});

test('start: idempotent — preserves started_at across repeat calls', async () => {
  const { startLab } = await loadModule();
  const { sql, state } = makeSql();
  const first = await startLab(sql, 1);
  assert.equal(first.ok, true);
  const ts1 = state.user.spinout_lab_started_at;
  // Force a tick so wall-clock differs; helper's COALESCE should still hold.
  await new Promise((r) => setTimeout(r, 5));
  const second = await startLab(sql, 1);
  assert.equal(second.ok, true);
  assert.equal(state.user.spinout_lab_started_at, ts1, 'started_at preserved');
});

test('milestone: rejects unknown key with 400', async () => {
  const { startLab, recordMilestone } = await loadModule();
  const { sql } = makeSql();
  await startLab(sql, 1);
  const r = await recordMilestone(sql, 1, 'made_up_key');
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('milestone: refuses when lab is off with 409', async () => {
  const { recordMilestone } = await loadModule();
  const { sql } = makeSql();
  const r = await recordMilestone(sql, 1, 'project_created');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test('exit: idempotent — second call leaves state clean', async () => {
  const { startLab, exitLab } = await loadModule();
  const { sql, state } = makeSql();
  await startLab(sql, 1);
  const a = await exitLab(sql, 1);
  assert.equal(a.active, false);
  assert.equal(a.is_incorporated, true);
  const b = await exitLab(sql, 1);
  assert.equal(b.active, false);
  assert.equal(b.is_incorporated, true);
  assert.equal(state.user.spinout_lab_active, 0);
  assert.equal(state.user.is_incorporated, 1);
});
