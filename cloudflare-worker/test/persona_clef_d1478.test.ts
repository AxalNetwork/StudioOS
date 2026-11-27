/**
 * D1478 §3937 (ON3) — the persona pick runs clef-flash through `run()`: quoted,
 * held and charged like every run, on `/onboarding/persona`, and never a
 * direct `ai.run` of the deprecated Llama 3.1 8B. Clef answers in the System
 * One shape; a refused or unreadable answer falls back to the email-domain
 * heuristic. Synthetic members only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/persona_clef_d1478.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { classifyPersona, PERSONA_MODEL, PERSONA_QUESTION } from '../ai-workers/persona-router.ts';
import { PERSONAS } from '../src/personas.ts';
import { specialistOutput, questionsValid } from '../src/services/ai/moduleShapes.ts';

const FOUNDER = PERSONAS.find((p) => /founder/i.test(p.id))!.id;
const OTHER = PERSONAS.find((p) => p.id !== FOUNDER)!.id;
const answer = (choice: string, p = 0.82) => ({
  model: 'clef-flash',
  answers: { persona: { type: 'choice', choice, confidence: 0.7, probabilities: { [choice]: p, [OTHER]: 1 - p - 0.05, [PERSONAS[2].id]: 0.05 } } },
  usage: { input_tokens: 180 },
});

function world(reply: (model: string, input: any) => unknown) {
  const { DB, db } = aiBudgetFixture();
  db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(4, 5_000_000);
  const calls: Array<{ model: string; input: any }> = [];
  const AI = withGuard({ run: async (model: string, input: any) => { calls.push({ model, input }); return reply(model, input); } });
  const env: any = { DB, AI };
  const rows = () => db.prepare("SELECT task, model, surface, user_id, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  return { env, db, calls, rows };
}

test('the question is one typed choice over every persona, and the router accepts it', () => {
  assert.equal(PERSONA_MODEL, '@cf/cloudflare/clef-flash');
  assert.deepEqual(Object.keys(PERSONA_QUESTION.persona.criteria).sort(), PERSONAS.map((p) => p.id).sort());
  assert.ok(questionsValid(PERSONA_QUESTION), `${PERSONAS.length} options fit the choice cap`);
});

test('the persona runs clef-flash through run(): one row on /onboarding/persona, the chosen persona and Clef’s own ranking as alternatives', async () => {
  const w = world((model) => (model === PERSONA_MODEL ? answer(FOUNDER) : { response: 'safe' }));
  const out = await classifyPersona(w.env, { first_message: 'I am building a fintech startup and need help raising a seed round.', email: 'ada@example.test' }, 4);
  assert.equal(out.persona_id, FOUNDER);
  assert.equal(out.confidence, 0.82);
  assert.equal(out.alternatives[0].persona_id, OTHER, 'ranked by Clef’s probabilities');
  const sent = w.calls.find((c) => c.model === PERSONA_MODEL)!;
  assert.deepEqual(Object.keys(sent.input).sort(), ['model', 'questions', 'state']);
  assert.equal(sent.input.model, 'clef-flash');
  assert.doesNotMatch(sent.input.state, /ada@/, 'only the domain is sent, never the address');
  const rows = w.rows().filter((r) => r.model === PERSONA_MODEL);
  assert.deepEqual(rows.map((r) => [r.task, r.surface, r.user_id]), [['module_decision', '/onboarding/persona', 4]]);
  assert.ok(w.calls.every((c) => c.model !== '@cf/meta/llama-3.1-8b-instruct'), 'the deprecated model is never called');
});

test('a refused or unreadable decision falls back to the email-domain heuristic; no member means no run at all', async () => {
  const broken = world((model) => (model === PERSONA_MODEL ? { answers: { persona: { type: 'choice', choice: 'not_a_persona' } } } : { response: 'safe' }));
  const a = await classifyPersona(broken.env, { first_message: 'Hello there.', email: 'x@example.test' }, 4);
  assert.equal(a.persona_id, null, 'an option it was not offered is no answer');
  assert.equal(a.needs_disambiguation, true);
  const none = world(() => { throw new Error('should not run'); });
  await classifyPersona(none.env, { first_message: 'Hello there.', email: 'x@example.test' }, null);
  assert.deepEqual(none.calls, []);
});

test('the System One answer shapes are read: noul as an object or a bare probability, choice within its options, score within its rubric', () => {
  const q = { urgent: { type: 'noul' as const, instructions: 'Urgent?' }, team: { type: 'choice' as const, instructions: 'Team?', criteria: { billing: 'b', technical: 't' } }, sev: { type: 'score' as const, instructions: 'How bad?', criteria: ['none', 'minor', 'major'] } };
  const s = { operation: 'decision' as const, questions: q };
  const ok = { answers: { urgent: { type: 'noul', noul: 0.9 }, team: { type: 'choice', choice: 'billing', confidence: 0.8, probabilities: { billing: 0.87, technical: 0.13 } }, sev: { type: 'score', score: 1.05, probabilities: { 0: 0, 1: 0.95, 2: 0.05 } } } };
  assert.ok(specialistOutput(ok, s, 'text'));
  assert.ok(specialistOutput({ answers: { ...ok.answers, urgent: 0.9 } }, s, 'text'), 'the bare probability still reads');
  for (const bad of [
    { ...ok.answers, team: { choice: 'sales' } },
    { ...ok.answers, team: { choice: 'billing', probabilities: { billing: 1.4 } } },
    { ...ok.answers, sev: { score: 3 } },
    { ...ok.answers, urgent: { noul: -0.1 } },
  ]) assert.equal(specialistOutput({ answers: bad }, s, 'text'), null);
});

test('persona-router.ts makes no direct ai.run', () => {
  const src = readFileSync(new URL('../ai-workers/persona-router.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.run\(\s*['"]@cf\//);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /llama-3\.1-8b-instruct/);
});
