/**
 * D765 (#2090) PR 2 — no member run starts without a press (D720 §6): no
 * route answers a GET by calling a model, nothing on mount or in the
 * background summarises a member's interview, Stop and Retry transcribe only
 * unless the member chose more, and a job no member started runs as a system
 * call (userId 0), logged at cost and charged to no member.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/rail_no_run_without_press_d765.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest, ROUTE } from '../src/services/aiRouter.ts';
import { pickNextQuestion } from '../src/services/advisor/rerank.ts';
import { aiScoreDeal } from '../ai-workers/scoring.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ================================================================ no GET calls a model

/** What reaches a model from a handler's own body: the router's `run` under each file's name, a direct binding call, or a known wrapper. */
const MODEL_CALL = /(?<![\w.])(?:aiRun|aiRouterRun|runAI|run|aiRouter\.run|ai\.run)\(\s*(?:c\.)?env\s*,|\bAI\.run\(|\bllmText\(|\bsystemRun\(|\bdigestSession\(|\bstructureTranscript\(|\bsummariseTranscript\(|\baskTranscript\(|\bdraftLines\(|\bdraftSummary\(|\bmapSections\(|\bgenerateReview\(|\brunCompetitorAnalysis\(|\bcitesFor\(|\bpickNextQuestion\([^)]*\)/;

/**
 * GETs that reach a model, each with its reason. Nothing else may.
 * - `search.ts` `GET /`: the semantic mode embeds the query to look it up, a
 *   retrieval, not assistance; it writes nothing and no page calls it.
 * - `founder_validate_sessions.ts` `GET /sessions/:id/live`: the WebSocket
 *   upgrade the recorder opens after the member presses Start; live
 *   transcription is saving, which the switch never refuses.
 */
const GET_ALLOWED: Record<string, string> = {
  'search.ts GET /': 'embeds the search query for retrieval; no generation, no page calls it',
  'founder_validate_sessions.ts GET /sessions/:id/live': 'the recorder\'s live transcription, opened by the member\'s Start; saving',
};

function getHandlers() {
  const out: Array<{ key: string; body: string }> = [];
  const dir = join(ROOT, 'src/routes');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const s = readFileSync(join(dir, name), 'utf8');
    for (const m of s.matchAll(/^(\w+)\.get\(\s*'([^']+)'\s*,/gm)) {
      // The handler runs to the next top-level route or function.
      const rest = s.slice(m.index! + m[0].length);
      const end = rest.search(/\n(?:\w+\.(?:get|post|put|patch|delete|use|all|on)\(|(?:export )?(?:async )?function |const \w+ = )/);
      out.push({ key: `${name} GET ${m[2]}`, body: end < 0 ? rest : rest.slice(0, end) });
    }
  }
  return out;
}

test('no route answers a GET by calling a model, but the two allow-listed with their reasons', () => {
  const handlers = getHandlers();
  assert.ok(handlers.length > 300, `found ${handlers.length} GET handlers; the listing lost some`);
  const calling = handlers.filter((h) => {
    const body = h.body.replace(/pickNextQuestion\([^)]*rerank: false[^)]*\)/g, '').replace(/nextQuestion\(c, false\)/g, '');
    return MODEL_CALL.test(body);
  }).map((h) => h.key).filter((k) => !GET_ALLOWED[k]);
  assert.deepEqual(calling, [], `GET handlers that call a model:\n${calling.join('\n')}`);
});

test('the advisor ranks only on a press: GET /next-question and /start take the order, POST /next-question may rank', async () => {
  const advisor = read('src/routes/advisor.ts');
  assert.match(advisor, /advisor\.get\('\/next-question', \(c\) => nextQuestion\(c, false\)\);/);
  assert.match(advisor, /advisor\.post\('\/next-question', \(c\) => nextQuestion\(c, true\)\);/);
  assert.match(advisor, /pinnedId: conv\.current_question_id, rerank: false,\n/, '/start, which the page calls on mount');
  // Without `rerank: true` no model is asked, whatever the bank holds.
  let calls = 0;
  const env: any = { AI: { run: async () => { calls += 1; return { response: '{"id":"q2"}' }; } } };
  const q = (id: string) => ({ id, persona: 'founder', prompt: id, input_kind: 'short' }) as any;
  const picked = await pickNextQuestion(env, 2, 1, [q('q1'), q('q2'), q('q3')], new Set(['q1']));
  assert.equal(picked?.id, 'q2', 'the first unanswered, in bank order');
  assert.equal(calls, 0);
});

test('the syndicate rationale and the monitoring AI summary are presses (POST); their reads call no model', () => {
  const fx = read('src/routes/networkfx.ts');
  assert.match(fx, /networkfx\.post\('\/syndicates\/:id\/recommendations'/);
  assert.doesNotMatch(fx, /networkfx\.get\('\/syndicates\/:id\/recommendations'/);
  const mon = read('src/routes/monitoring.ts');
  assert.match(mon, /monitoring\.get\('\/anomalies', \(c\) => anomalies\(c, false\)\);/);
  assert.match(mon, /monitoring\.post\('\/anomalies', \(c\) => anomalies\(c, true\)\);/);
  assert.match(mon, /if \(withAi && c\.env\.AI\) \{/);
  const api = readFileSync(join(ROOT, '../frontend/src/lib/api.js'), 'utf8');
  assert.match(api, /networkFxSyndicateRecs: \(id\) => request\(`\/networkfx\/syndicates\/\$\{id\}\/recommendations`, \{ method: 'POST'/);
  assert.match(api, /nextQuestion: \(focus\) =>\n\s+request\(`\/advisor\/next-question[^\n]*\{ method: 'POST'/);
  assert.match(api, /monitoringAnomaliesSummary: \(\) => request\('\/monitoring\/anomalies', \{ method: 'POST'/);
});

// ================================================================ no digest without a press

test('nothing queues an interview\'s summary or placement on its own: no automatic trigger, no quiet-chat sweep', () => {
  const dirs = ['src/routes', 'src/services', 'src/services/channels'];
  const offenders: string[] = [];
  for (const d of dirs) {
    for (const name of readdirSync(join(ROOT, d)).filter((n) => n.endsWith('.ts'))) {
      const s = read(`${d}/${name}`);
      for (const m of s.matchAll(/^(?!\s*(?:\/\/|\*)).*\b(enqueueDigest|enqueueSessionStructure)\(/gm)) {
        if (/export async function (enqueueDigest|enqueueSessionStructure)/.test(m[0])) continue;
        offenders.push(`${d}/${name}: ${m[0].trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'an automatic digest is queued');
  assert.doesNotMatch(read('src/index.ts'), /sweepQuietChats/);
  assert.doesNotMatch(read('src/services/sessionAutoStructure.ts'), /export async function sweepQuietChats/);
});

test('Stop and Retry transcribe only unless the member chose more; never from the page\'s mode', () => {
  assert.match(read('src/routes/founder_validate_sessions.ts'), /finishSession\(c\.env, s\.session, s\.user\.id, lastSeq, body\?\.auto === true\)/);
  const proc = read('src/services/interviewProcessing.ts');
  assert.match(proc, /COALESCE\(processing_auto, 0\)/, 'a row with no recorded choice retries as transcribe only');
  assert.match(proc, /const resumeAt: Stage = !transcribed \? 'transcribing' : session\.processing_auto === 1 \? 'summarising' : 'done';/);
  assert.match(proc, /if \(resumeAt !== 'done'\) await enqueueProcess\(env, session\.id, userId\);/);
  const front = (p: string) => readFileSync(join(ROOT, '../frontend/src', p), 'utf8');
  assert.match(front('lib/activeRecording.js'), /async confirmStop\(\{ auto = false \} = \{\}\) \{/);
  assert.match(front('lib/activeRecording.js'), /return await process\(state\.auto === true\);/);
  assert.match(front('lib/api/interviewSessions.js'), /finish: \(id, lastSeq, auto = false\) =>/);
  const live = front('pages/founder/RecordLivePage.jsx');
  assert.match(live, /recorder\.confirmStop\(\{ auto: false \}\)/);
  assert.doesNotMatch(live, /useAssistMode/, 'the page\'s mode no longer decides Stop');
});

// ================================================================ a job no member started

test('a queue job no member started runs as a system call: logged at cost as userId 0, charged to no member', async () => {
  __resetForTest();
  const f = aiBudgetFixture();
  const seen: string[] = [];
  const AI = withGuard({ run: async (model: string) => { seen.push(model); return { response: '{"market":20,"team":15,"product":10,"capital":10,"rationale":"Solid"}', usage: { prompt_tokens: 200, completion_tokens: 40 } }; } });
  try {
    const out = await aiScoreDeal({ DB: f.DB, ENVIRONMENT: 'development', AI } as any, { name: 'Ledger tool', description: 'Close books faster' } as any);
    assert.equal(out.total, 55, 'the job still reads the model\'s answer');
    assert.deepEqual(seen, [ROUTE.system_job.model], 'through the router\'s system_job route, not the deprecated 8B');
    const rows = f.db.prepare("SELECT * FROM ai_usage_logs WHERE task = 'system_job'").all() as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, 0, 'no member');
    assert.ok(rows[0].est_cost_usd > 0, 'logged at cost');
    assert.ok(!rows[0].charged_microusd, 'charged to no member');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 0, 'nothing held');
  } finally { f.db.close(); }
  for (const job of ['equity', 'lpa', 'scoring', 'traction', 'valuation']) {
    const s = read(`ai-workers/${job}.ts`);
    assert.doesNotMatch(s, /AI\.run\(/, `${job} calls Workers AI directly`);
    assert.match(s, /await systemRun\(env, \{/, job);
  }
});
