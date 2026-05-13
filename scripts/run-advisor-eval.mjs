#!/usr/bin/env node
/**
 * Task #5 — Personal Advisor eval harness.
 *
 * Drives a 50-prompt eval bank against a STAGING worker URL using a
 * dogfood JWT. Captures per-conversation metrics (turn count,
 * repetition rate, write success rate, p95 latency, MI signal coverage
 * delta) and dumps a dated JSON report under `eval-results/`.
 *
 * Usage:
 *   ADVISOR_EVAL_BASE_URL=https://studioos-preview.example.workers.dev \
 *   ADVISOR_EVAL_JWT=eyJhbGciOi… \
 *   node scripts/run-advisor-eval.mjs [--persona=founder|investor|mentor|partner|all]
 *
 * The 50-prompt bank is curated to span every persona × every major
 * section. The script does NOT fail CI — it produces a report we eyeball
 * during Phase 1 / Phase 2 of the rollout.
 *
 * Report shape (eval-results/advisor-eval-YYYY-MM-DD.json):
 *   {
 *     "started_at": "2026-05-13T…",
 *     "base_url": "…",
 *     "summary": {
 *        "prompts_run": N, "turns_total": N,
 *        "repetition_rate": 0.0,
 *        "write_success_rate": 1.0,
 *        "latency_ms": { "p50": …, "p95": …, "max": … },
 *        "mi_signal_coverage": { "before": N, "after": N, "delta": N }
 *     },
 *     "per_persona": [...],
 *     "failures": [...]
 *   }
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const BASE = process.env.ADVISOR_EVAL_BASE_URL;
const JWT  = process.env.ADVISOR_EVAL_JWT;
const PERSONA_ARG = (process.argv.find((a) => a.startsWith('--persona=')) || '').split('=')[1] || 'all';

if (!BASE || !JWT) {
  console.error('[eval] ADVISOR_EVAL_BASE_URL and ADVISOR_EVAL_JWT must be set.');
  console.error('       Skipping eval (this script never fails CI).');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 50-prompt bank — 10/persona × 5 personas (covers every section).
// Each entry: { persona, prompt, expected_section?, mi_section? }
// ---------------------------------------------------------------------------
const PROMPTS = [
  // founder × 10
  { persona: 'founder', prompt: 'How do I write a pitch in one paragraph?',                 expected_section: 'BUILD' },
  { persona: 'founder', prompt: 'What customer-discovery questions should I ask?',          expected_section: 'BUILD' },
  { persona: 'founder', prompt: 'When should I incorporate?',                                expected_section: 'LEGAL' },
  { persona: 'founder', prompt: 'How do I model a SAFE round?',                              expected_section: 'CAPITAL' },
  { persona: 'founder', prompt: 'How long should my runway be before I raise?',              expected_section: 'CAPITAL' },
  { persona: 'founder', prompt: 'How do I find a technical co-founder?',                     expected_section: 'NETWORK' },
  { persona: 'founder', prompt: 'How do I structure my first hire equity?',                  expected_section: 'CAPITAL' },
  { persona: 'founder', prompt: 'What metrics should I show in my deck?',                    expected_section: 'PITCH' },
  { persona: 'founder', prompt: 'When do I need to file 83(b)?',                              expected_section: 'LEGAL' },
  { persona: 'founder', prompt: 'How do I price my B2B SaaS?',                                expected_section: 'BUILD' },
  // investor × 10
  { persona: 'investor', prompt: 'What stage do you write checks at?',                       expected_section: 'PROFILE', mi_section: 'capital_velocity' },
  { persona: 'investor', prompt: 'Which sectors are heating up right now?',                  expected_section: 'THESIS',  mi_section: 'sector_heat' },
  { persona: 'investor', prompt: 'What is the typical SAFE cap I should expect?',            expected_section: 'PIPELINE' },
  { persona: 'investor', prompt: 'Walk me through your dealflow process.',                   expected_section: 'PIPELINE' },
  { persona: 'investor', prompt: 'What does a strong founder profile look like to you?',     expected_section: 'THESIS' },
  { persona: 'investor', prompt: 'How do you decide on follow-on allocations?',              expected_section: 'PIPELINE' },
  { persona: 'investor', prompt: 'What macro trends shape your thesis this year?',           expected_section: 'THESIS',  mi_section: 'sector_heat' },
  { persona: 'investor', prompt: 'How do you think about TAM floors?',                       expected_section: 'THESIS' },
  { persona: 'investor', prompt: 'What is your contrarian take?',                            expected_section: 'THESIS',  mi_section: 'investor_signals' },
  { persona: 'investor', prompt: 'How big is your current fund?',                            expected_section: 'PROFILE', mi_section: 'capital_velocity' },
  // mentor × 10
  { persona: 'mentor',  prompt: 'What stages do you mentor?',                                expected_section: 'PROFILE' },
  { persona: 'mentor',  prompt: 'How many hours per month can you commit?',                   expected_section: 'PROFILE' },
  { persona: 'mentor',  prompt: 'What sectors are you strongest in?',                         expected_section: 'PROFILE' },
  { persona: 'mentor',  prompt: 'Do you offer office hours?',                                expected_section: 'AVAILABILITY' },
  { persona: 'mentor',  prompt: 'How do you prefer founders reach you?',                     expected_section: 'AVAILABILITY' },
  { persona: 'mentor',  prompt: 'What does a successful mentor relationship look like?',     expected_section: 'EXPERIENCE' },
  { persona: 'mentor',  prompt: 'What was your most useful piece of mentor advice?',          expected_section: 'EXPERIENCE' },
  { persona: 'mentor',  prompt: 'Do you take board observer seats?',                         expected_section: 'EXPERIENCE' },
  { persona: 'mentor',  prompt: 'What kind of founder do you decline to mentor?',             expected_section: 'EXPERIENCE' },
  { persona: 'mentor',  prompt: 'How do you measure mentee progress?',                       expected_section: 'EXPERIENCE' },
  // operating partner × 10 (mixed sub-types)
  { persona: 'partner', prompt: 'What services does your firm provide to startups?',         expected_section: 'OFFERING'  },
  { persona: 'partner', prompt: 'What is your typical pricing model?',                       expected_section: 'PRICING'   },
  { persona: 'partner', prompt: 'What sectors do you target?',                                expected_section: 'PROFILE'   },
  { persona: 'partner', prompt: 'How do you source deals for the studio?',                   expected_section: 'OFFERING'  },
  { persona: 'partner', prompt: 'What kind of capital do you deploy?',                       expected_section: 'CAPITAL'   },
  { persona: 'partner', prompt: 'What stage companies do you partner with?',                  expected_section: 'PROFILE'   },
  { persona: 'partner', prompt: 'Are you a corporate venture arm or independent?',            expected_section: 'PROFILE'   },
  { persona: 'partner', prompt: 'What does success look like in our partnership?',            expected_section: 'EXPECTATIONS' },
  { persona: 'partner', prompt: 'What are your blockers to bigger engagements?',              expected_section: 'EXPECTATIONS' },
  { persona: 'partner', prompt: 'How do you measure ROI on studio investments?',              expected_section: 'EXPECTATIONS' },
  // role detector × 10 (cold-start)
  { persona: 'unknown', prompt: 'I am a founder building a fintech app.',                    expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I invest in early-stage AI companies.',                     expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I mentor first-time founders on go-to-market.',              expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I represent an operating-partner firm.',                    expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I run a corporate venture arm.',                            expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I am an angel checking out the platform.',                   expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I help startups with legal services.',                       expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I am exploring whether to spin out from my current job.',    expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'I want to source deals for the studio.',                    expected_section: 'ROLE' },
  { persona: 'unknown', prompt: 'Just curious — show me around.',                             expected_section: 'ROLE' },
];

assert(PROMPTS.length === 50, `expected 50 prompts, got ${PROMPTS.length}`);
function assert(cond, msg) { if (!cond) { console.error('[eval]', msg); process.exit(2); } }

// ---------------------------------------------------------------------------
// HTTP helpers.
// ---------------------------------------------------------------------------
async function api(method, path, body) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'authorization': `Bearer ${JWT}`,
      'content-type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const ms = performance.now() - t0;
  let payload = null;
  try { payload = await res.json(); } catch { /* SSE / empty */ }
  return { status: res.status, body: payload, ms };
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(p * s.length));
  return Math.round(s[idx]);
}

// ---------------------------------------------------------------------------
// Per-prompt run.
// ---------------------------------------------------------------------------
async function runPrompt(p) {
  const seenIds = new Set();
  const latencies = [];
  let writeSuccess = 0;
  let writeAttempts = 0;
  let turns = 0;
  let conversationUid = null;
  let costUsd = 0;             // sum of est_cost_usd across the conversation
  let sectionMatched = 0;      // turns where the served question's section matched expected_section
  let sectionAttempted = 0;    // turns where expected_section was declared
  let budgetBlockedTurns = 0;  // turns where the daily budget cap fired (429 / cost_exceeded)
  const turnRecords = [];      // per-turn detail (q_id, section, latency, cost, write_status)

  // Open / resume.
  const start = await api('POST', '/api/advisor/start', {});
  latencies.push(start.ms);
  if (start.status !== 200) {
    return { ok: false, persona: p.persona, prompt: p.prompt, error: `start ${start.status}: ${JSON.stringify(start.body).slice(0, 200)}` };
  }
  conversationUid = start.body?.conversation_uid || start.body?.conversation?.uid;

  // Up to 6 turns: answer the served question with the prompt text.
  let nextQ = start.body?.next_question || start.body?.question;
  for (let i = 0; i < 6 && nextQ?.id; i++) {
    if (seenIds.has(nextQ.id)) {
      // repetition — record and break out.
      seenIds.add(nextQ.id + ':REPEAT');
      break;
    }
    seenIds.add(nextQ.id);
    turns++;
    writeAttempts++;

    // expected_section enforcement — match the served question's
    // section/mi_section/page against the prompt's declared expectation
    // so we can report "did persona-specific routing actually happen?"
    // rather than just "did anything get served?".
    const servedSection = nextQ.section || nextQ.mi_section || nextQ.page_target || nextQ.page || null;
    let sectionHit = null;
    if (p.expected_section) {
      sectionAttempted++;
      sectionHit = servedSection && String(servedSection).toUpperCase().includes(String(p.expected_section).toUpperCase());
      if (sectionHit) sectionMatched++;
    }

    const ans = await api('POST', '/api/advisor/answer', {
      conversation_uid: conversationUid,
      question_id: nextQ.id,
      value: p.prompt.slice(0, 200),
    });
    latencies.push(ans.ms);
    // cost surfaces on AI-augmented responses (advisor /turn audit
    // exposes est_cost_usd; deterministic /answer typically reports 0
    // because the write path is rule-based, not model-routed). We sum
    // both so the per-conversation cost is comprehensive when the worker
    // does upgrade to model-augmented answers.
    const turnCost = Number(ans.body?.est_cost_usd ?? ans.body?.cost_usd ?? ans.body?.usage?.est_cost_usd ?? 0) || 0;
    costUsd += turnCost;
    if (ans.status === 200 && (ans.body?.saved_to || ans.body?.status === 'paywalled' || ans.body?.status === 'noop')) {
      writeSuccess++;
    }
    // Daily-budget-cap signal — when WORKERS_AI_ADVISOR_BUDGET_USD_DAY
    // is exhausted, the advisor returns HTTP 429 with reason
    // 'cost_exceeded' (or 'rate_limited'). We surface a per-prompt
    // counter so the summary can flag whether the cap fired during
    // this run.
    const budgetBlocked = ans.status === 429 || ans.body?.reason === 'cost_exceeded' || ans.body?.reason === 'rate_limited';
    if (budgetBlocked) budgetBlockedTurns++;

    turnRecords.push({
      q_id: nextQ.id,
      served_section: servedSection,
      expected_section: p.expected_section || null,
      section_hit: sectionHit,
      latency_ms: Math.round(ans.ms),
      cost_usd: turnCost,
      http_status: ans.status,
      write_status: ans.body?.status || (ans.body?.saved_to ? 'saved' : null),
      budget_blocked: budgetBlocked,
    });
    nextQ = ans.body?.next || null;
  }

  return {
    ok: true,
    persona: p.persona,
    prompt: p.prompt,
    expected_section: p.expected_section || null,
    turns,
    repeats: [...seenIds].filter((s) => s.endsWith(':REPEAT')).length,
    writes: { attempted: writeAttempts, succeeded: writeSuccess },
    cost_usd_per_conversation: Number(costUsd.toFixed(6)),
    budget_blocked_turns: budgetBlockedTurns,
    expected_section_match: sectionAttempted > 0
      ? { matched: sectionMatched, attempted: sectionAttempted, rate: Number((sectionMatched / sectionAttempted).toFixed(4)) }
      : null,
    latencies,
    turn_records: turnRecords,
  };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[eval] starting ${PROMPTS.length} prompts against ${BASE}`);

  // Snapshot MI signals before so we can compute the delta.
  let miBefore = 0, miAfter = 0;
  try {
    const r = await api('GET', '/api/market-intel/coverage', null);
    miBefore = Number(r.body?.signal_count || 0);
  } catch { /* tolerate */ }

  const results = [];
  for (const p of PROMPTS) {
    if (PERSONA_ARG !== 'all' && PERSONA_ARG !== p.persona) continue;
    const r = await runPrompt(p);
    results.push(r);
    process.stdout.write(r.ok ? '.' : '!');
  }
  process.stdout.write('\n');

  try {
    const r = await api('GET', '/api/market-intel/coverage', null);
    miAfter = Number(r.body?.signal_count || 0);
  } catch { /* tolerate */ }

  const ok = results.filter((r) => r.ok);
  const allLatencies = ok.flatMap((r) => r.latencies);
  const turnsTotal = ok.reduce((s, r) => s + (r.turns || 0), 0);
  const repeatsTotal = ok.reduce((s, r) => s + (r.repeats || 0), 0);
  const writesAttempted = ok.reduce((s, r) => s + (r.writes?.attempted || 0), 0);
  const writesSucceeded = ok.reduce((s, r) => s + (r.writes?.succeeded || 0), 0);

  const perPersonaMap = new Map();
  for (const r of ok) {
    const m = perPersonaMap.get(r.persona) || {
      persona: r.persona, prompts: 0, turns: 0, repeats: 0,
      write_attempts: 0, write_successes: 0,
      cost_usd_total: 0,
      section_matched: 0, section_attempted: 0,
    };
    m.prompts++; m.turns += r.turns; m.repeats += r.repeats;
    m.write_attempts += r.writes.attempted; m.write_successes += r.writes.succeeded;
    m.cost_usd_total += r.cost_usd_per_conversation || 0;
    if (r.expected_section_match) {
      m.section_matched += r.expected_section_match.matched;
      m.section_attempted += r.expected_section_match.attempted;
    }
    perPersonaMap.set(r.persona, m);
  }
  // Add derived per-persona rates.
  for (const m of perPersonaMap.values()) {
    m.cost_usd_avg_per_conversation = m.prompts > 0 ? Number((m.cost_usd_total / m.prompts).toFixed(6)) : 0;
    m.expected_section_match_rate = m.section_attempted > 0
      ? Number((m.section_matched / m.section_attempted).toFixed(4))
      : null;
  }

  // Aggregate cost + section + budget-cap across all personas.
  const costTotal = ok.reduce((s, r) => s + (r.cost_usd_per_conversation || 0), 0);
  const sectionMatchedTotal = ok.reduce((s, r) => s + (r.expected_section_match?.matched || 0), 0);
  const sectionAttemptedTotal = ok.reduce((s, r) => s + (r.expected_section_match?.attempted || 0), 0);
  const budgetBlockedTotal = ok.reduce((s, r) => s + (r.budget_blocked_turns || 0), 0);
  const turnsTotalAll = ok.reduce((s, r) => s + (r.turns || 0), 0);

  const summary = {
    prompts_run: ok.length,
    turns_total: turnsTotal,
    repetition_rate: turnsTotal === 0 ? 0 : Number((repeatsTotal / turnsTotal).toFixed(4)),
    write_success_rate: writesAttempted === 0 ? 0 : Number((writesSucceeded / writesAttempted).toFixed(4)),
    cost_usd: {
      total: Number(costTotal.toFixed(6)),
      avg_per_conversation: ok.length > 0 ? Number((costTotal / ok.length).toFixed(6)) : 0,
    },
    expected_section_match: sectionAttemptedTotal > 0
      ? {
          matched: sectionMatchedTotal,
          attempted: sectionAttemptedTotal,
          rate: Number((sectionMatchedTotal / sectionAttemptedTotal).toFixed(4)),
        }
      : null,
    latency_ms: {
      p50: percentile(allLatencies, 0.50),
      p95: percentile(allLatencies, 0.95),
      max: Math.round(Math.max(0, ...allLatencies)),
    },
    mi_signal_coverage: { before: miBefore, after: miAfter, delta: miAfter - miBefore },
    // Daily-budget-cap verification — per spec "(e) the daily budget
    // cap works". Reports whether the per-day Workers-AI budget guard
    // (`WORKERS_AI_ADVISOR_BUDGET_USD_DAY`) fired during this run. A
    // non-zero `cap_observed` count is a positive signal that the gate
    // is active under load. Zero across a fresh run is expected; to
    // intentionally trip it, lower the env to a small number (e.g. 5)
    // and rerun the eval — the surplus turns should report
    // `cap_observed > 0`.
    daily_budget: {
      blocked_turns: budgetBlockedTotal,
      total_turns: turnsTotalAll,
      cap_observed: budgetBlockedTotal > 0,
      block_rate: turnsTotalAll === 0 ? 0 : Number((budgetBlockedTotal / turnsTotalAll).toFixed(4)),
    },
  };

  const report = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    base_url: BASE,
    persona_filter: PERSONA_ARG,
    summary,
    per_persona: [...perPersonaMap.values()],
    per_prompt: results,        // full per-prompt detail (incl. turn_records) for offline analysis
    failures: results.filter((r) => !r.ok),
  };

  const dateStamp = startedAt.slice(0, 10);
  const outDir = resolve(root, 'eval-results');
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `advisor-eval-${dateStamp}.json`);
  await writeFile(outFile, JSON.stringify(report, null, 2));

  console.log('[eval] summary:', summary);
  console.log(`[eval] wrote ${outFile}`);
}

main().catch((err) => {
  console.error('[eval] fatal:', err.stack || err.message);
  process.exit(1);
});
