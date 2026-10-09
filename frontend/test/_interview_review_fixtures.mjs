/**
 * D660 part 2 (#1473) — the review step's fixtures, in the response shapes of
 * #1494 (D658 part 2), as its route tests assert them:
 *   GET  /api/founder/validate/sessions/:id/placements  → { runs, compare }
 *   POST /api/founder/validate/sessions/:id/structure   → 201 { ok, run_id, step, stored, dropped, parts, receipt }
 *   POST /api/founder/validate/sessions/:id/ask         → { ok, answer, cites, receipt } | 422 no_citation
 *   POST /api/founder/validate/placements/:id/accept    → 4xx { error: 'writer_refused', detail } when the module refuses
 *   GET  /api/founder/validate/sessions/:id/receipt     → items with kind structured | re_structured | asked
 *   any model call refused for budget                   → 503 { ok: false, refusal: 'budget_user_day', message }
 *
 * ONE FILE. If #1494 changes a shape in review, this is the file to change.
 */

const p = (id, kind, module, payload, extra = {}) => ({
  id, kind, module, payload, edited_payload: null, status: 'pending', can_accept: true,
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', run_id: 'run_a',
  cite: { from: 12000, to: 19500, quote: 'We lose a full day every week reconciling the two systems.' },
  created_at: '2026-10-09 19:20:00', ...extra,
});

export const RUN_A = [
  p(1, 'pain_severity', 'problem_discovery', { phrase: 'reconciling two systems', severity: 'severe' }),
  p(2, 'icp_fit', 'customer_research', { fit: 'strong', reason: 'Runs ops at a 40-person logistics firm.' }),
  p(3, 'evidence', 'experiments', { hypothesis_id: 4, pain_group_id: 9, direction: 'supports', strength: 'pattern' }),
  p(4, 'market_fact', 'market_intelligence', { fact: 'Most firms their size use two tools.', source: 'the interviewee' }, { can_accept: false }),
  p(5, 'competitor_mention', 'market_intelligence', { name: 'Ledgerly', context: 'tried it, dropped it' }),
];

export const RUN_B = [
  { ...p(11, 'pain_severity', 'problem_discovery', { phrase: 'reconciling two systems', severity: 'real' }), model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', run_id: 'run_b' },
  { ...p(12, 'demand_signal', 'demand_signals', { signal: 'would_pay', detail: 'up to $200 a month' }), model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', run_id: 'run_b' },
];

export const PLACEMENTS_ONE_RUN = {
  runs: [{ run_id: 'run_a', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', placements: RUN_A }],
  compare: null,
};

export const PLACEMENTS_TWO_RUNS = {
  runs: [
    { run_id: 'run_a', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', placements: RUN_A },
    { run_id: 'run_b', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', placements: RUN_B },
  ],
  compare: {
    first: 'run_a', second: 'run_b',
    modules: [
      { module: 'problem_discovery', first: [RUN_A[0]], second: [RUN_B[0]] },
      { module: 'customer_research', first: [RUN_A[1]], second: [] },
      { module: 'experiments', first: [RUN_A[2]], second: [] },
      { module: 'market_intelligence', first: [RUN_A[3], RUN_A[4]], second: [] },
      { module: 'demand_signals', first: [], second: [RUN_B[1]] },
    ],
  },
};

export const PLACEMENTS_NONE = { runs: [], compare: null };

export const STRUCTURED = {
  ok: true, run_id: 'run_a', step: 'structured', stored: 5, dropped: 1, parts: 1,
  receipt: [{ step: 'structured', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', requested_model: null, fallback_used: false, est_cost_usd: 0.0021, prompt_tokens: 3100, completion_tokens: 420 }],
};

export const ASK_OK = {
  ok: true,
  answer: 'They reconcile the two systems by hand every Friday.',
  cites: [{ from: 12000, to: 19500, quote: 'We lose a full day every week reconciling the two systems.' }],
  receipt: [{ step: 'asked', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', requested_model: null, fallback_used: false, est_cost_usd: 0.0004, prompt_tokens: 3000, completion_tokens: 40 }],
};

/** What `request()` throws for a 422 `no_citation` (api.js: message from `detail`, data = body). */
export const ASK_NO_CITATION_ERROR = {
  status: 422, code: 'no_citation',
  message: 'The transcript did not give an answer that could be tied to a passage, so none is shown.',
  data: { error: 'no_citation', detail: 'The transcript did not give an answer that could be tied to a passage, so none is shown.' },
};

export const BUDGET_ERROR = {
  status: 402, code: null,
  message: 'You have used today’s AI allowance. It resets at midnight UTC.',
  data: { ok: false, refusal: 'budget_user_day', message: 'You have used today’s AI allowance. It resets at midnight UTC.' },
};

export const WRITER_REFUSED_ERROR = {
  status: 409, code: 'writer_refused',
  message: 'That competitor is already on the list under another name.',
  data: { error: 'writer_refused', detail: 'That competitor is already on the list under another name.' },
};

export const RECEIPT_ITEMS = [
  { kind: 'final', model: '@cf/openai/whisper-large-v3-turbo', requested_model: '@cf/openai/whisper-large-v3-turbo', fallback_used: 0, audio_minutes: 31, cost_microusd: 15500, outcome: 'ok', refusal: null, created_at: '2026-10-09 19:10:00' },
  { kind: 'structured', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', requested_model: null, fallback_used: 0, audio_minutes: 0, cost_microusd: 2100, outcome: 'ok', refusal: null, created_at: '2026-10-09 19:20:00' },
  { kind: 're_structured', model: '@cf/meta/llama-3.1-8b-instruct-fp8', requested_model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', fallback_used: 1, audio_minutes: 0, cost_microusd: 300, outcome: 'ok', refusal: null, created_at: '2026-10-09 19:25:00' },
  { kind: 'asked', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', requested_model: null, fallback_used: 0, audio_minutes: 0, cost_microusd: 0, outcome: 'refused', refusal: 'budget_user_day', created_at: '2026-10-09 19:30:00' },
];
