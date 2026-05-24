/**
 * axalSpinoutDemoDay.ts — Task #15
 *
 * Builds the Axal 30-day Spin-Out Lab demo day deck payload from
 * canonical Lab data:
 *
 *   - projects                 (name, sector, problem, solution, market sizes, …)
 *   - users                    (founder display name, spinout_lab_week, days_remaining)
 *   - spinout_lab_milestones   (per-user milestone keys + completed_at)
 *   - discovery_interviews     (interview count + most-recent N for quotes)
 *   - roadmap_okrs             (next-90-day GTM bullets, when present)
 *   - score_snapshots          (latest total/team/market score for the team slide)
 *   - financial_models         (runway/burn for the ask)
 *   - cap_table_holders        (founder list for the team slide)
 *   - advisor_answers          (free-text colour for thesis / insight when present)
 *
 * NO synthetic numbers. When a row is absent, the corresponding field is
 * left as the literal '—' placeholder so the adapter renders a visible
 * "needs filling" cue (the same em-dash pattern shared by autofill.ts).
 *
 * Output: SpinoutDemoDayData — one object per top-level deck section.
 * The caller (routes/decks.ts apply-method) writes each section as a
 * JSON-encoded paragraph field so it flows through the existing
 * sanitizeSlides → buildTemplateData → mergeShape pipeline unchanged.
 */
import type { Env } from '../../types';

const DASH = '—';

function orDash(v: unknown): string {
  const s = (v == null ? '' : String(v)).trim();
  return s ? s : DASH;
}

function fmtMoney(n: unknown): string {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return DASH;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtPct(n: unknown): string {
  const v = Number(n);
  if (!isFinite(v)) return DASH;
  return `${Math.round(v * 10) / 10}%`;
}

function fmtMonths(n: unknown): string {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return DASH;
  return `${Math.round(v)} months`;
}

// Mirrors `services/spinoutLabCatalog.ts::MILESTONES`. Duplicated here to
// keep this module self-contained — if the catalog ever grows new keys
// the adapter degrades gracefully (unknown keys still render as label =
// key.replace(/_/g, ' ')).
const WEEK_CATALOG: Array<{ week: number; title: string; caption: string; keys: Array<{ key: string; label: string }> }> = [
  {
    week: 1, title: 'Discovery',
    caption: 'Talk to 8+ people. Tag pains. Form hypotheses.',
    keys: [
      { key: 'interview_5_logged', label: '5 interviews logged' },
      { key: 'pains_clustered', label: 'Pains clustered' },
      { key: 'hypothesis_drafted', label: 'Hypothesis drafted' },
    ],
  },
  {
    week: 2, title: 'Shape',
    caption: 'OKRs. Roadmap. First scoring pass.',
    keys: [
      { key: 'okrs_drafted', label: 'OKRs drafted' },
      { key: 'roadmap_outlined', label: 'Roadmap outlined' },
      { key: 'score_baseline', label: 'Baseline score' },
    ],
  },
  {
    week: 3, title: 'Validate',
    caption: 'Sharpen the model. Stress-test the cap table.',
    keys: [
      { key: 'financial_model_v1', label: 'Financial model v1' },
      { key: 'captable_seed', label: 'Cap table seeded' },
      { key: 'score_v2', label: 'Score v2' },
    ],
  },
  {
    week: 4, title: 'Stand up',
    caption: 'Incorporate, brand, ship the deck.',
    keys: [
      { key: 'brand_kit', label: 'Brand kit' },
      { key: 'pitch_deck_v1', label: 'Pitch deck v1' },
      { key: 'incorporation_completed', label: 'Incorporated' },
    ],
  },
];

type ProjectRow = {
  id: number;
  founder_id: number | null;
  name: string | null;
  sector: string | null;
  tagline: string | null;
  description: string | null;
  problem_statement: string | null;
  solution: string | null;
  why_now: string | null;
  tam: number | null; sam: number | null; som: number | null;
  funding_needed: number | null;
  use_of_funds: string | null;
  contact_email: string | null;
  vision: string | null;
  traction_summary: string | null;
  growth_signals: string | null;
  cac: number | null;
  gross_margin_pct: number | null;
  users_count: number | null;
  revenue: number | null;
};

type UserRow = {
  id: number;
  name: string | null;
  email: string | null;
  spinout_lab_active: number | null;
  spinout_lab_week: number | null;
  spinout_lab_started_at: string | null;
};

type InterviewRow = {
  interviewee_name: string | null;
  interviewee_role: string | null;
  notes: string | null;
  pains_json: string | null;
};

type ScoreRow = {
  total_score: number | null;
  tier: string | null;
  team_total: number | null;
  market_total: number | null;
};

type FinancialRow = { computed_json: string | null };

type HolderRow = {
  name: string | null;
  email: string | null;
  ownership_pct: number | null;
  security_type: string | null;
};

type OKRRow = { objective: string | null; kanban_status: string | null };

type MilestoneRow = { milestone_key: string; week: number; completed_at: string };

/** Public output shape — mirrors SpinoutDemoDayData in the adapter. */
export type SpinoutDemoDayData = {
  meta: {
    project_name: string; sector: string;
    founder_name: string; contact_email: string;
    presented_on: string;
    week: number; days_remaining: number; lab_active: boolean;
    is_sample: boolean;
  };
  cover: { eyebrow: string; headline: string; sub: string; location: string };
  thesis: { eyebrow: string; headline: string; body: string; pull_quote: string };
  problem: { eyebrow: string; headline: string; body: string; signals: string[] };
  insight: { eyebrow: string; headline: string; body: string; evidence: Array<{ label: string; value: string; sub?: string }> };
  product: { eyebrow: string; headline: string; body: string; capabilities: string[] };
  market: {
    eyebrow: string; headline: string;
    tam: string; sam: string; som: string;
    why_now: string[];
  };
  traction: {
    eyebrow: string; headline: string;
    metrics: Array<{ label: string; value: string; sub?: string }>;
    interviews_count: number;
    interviews_recent: Array<{ name: string; role: string; takeaway: string }>;
  };
  lab_progress: {
    eyebrow: string; headline: string;
    weeks: Array<{
      week: number; title: string; caption: string;
      status: 'complete' | 'in_progress' | 'upcoming';
      milestones: Array<{ key: string; label: string; done: boolean; completed_at?: string }>;
    }>;
  };
  business_model: {
    eyebrow: string; headline: string; body: string;
    unit_econ: Array<{ label: string; value: string; sub?: string }>;
  };
  gtm: {
    eyebrow: string; headline: string;
    channels: Array<{ name: string; line: string }>;
    plan_90d: string[];
  };
  competition: {
    eyebrow: string; headline: string;
    x_label: string; y_label: string;
    players: Array<{ name: string; x: number; y: number; is_us?: boolean }>;
    wedge: string;
  };
  team: {
    eyebrow: string; headline: string;
    founders: Array<{ name: string; role: string; bio?: string }>;
    advisors: Array<{ name: string; role: string; bio?: string }>;
    scoring: { total_score?: number; tier?: string; team_total?: number; market_total?: number };
  };
  ask: {
    eyebrow: string; headline: string;
    raise_amount: string; runway: string;
    use_of_funds: Array<{ label: string; pct: number }>;
    next_milestones: string[];
    contact: string;
  };
  closing: { eyebrow: string; headline: string; body: string; signoff: string; contact: string };
};

/** Days elapsed since started_at, capped at 28. */
function daysRemaining(startedAt: string | null | undefined): number {
  if (!startedAt) return 28;
  const ms = Date.parse(startedAt.replace(' ', 'T') + (startedAt.includes('Z') ? '' : 'Z'));
  if (!isFinite(ms)) return 28;
  const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  return Math.max(0, 28 - elapsed);
}

/** Extract a one-sentence "takeaway" from interview notes / pains. */
function interviewTakeaway(row: InterviewRow): string {
  const notes = (row.notes || '').trim();
  if (notes) {
    // First sentence, capped.
    const m = notes.match(/^[^.!?\n]{8,220}[.!?]?/);
    return (m ? m[0] : notes).slice(0, 200).trim();
  }
  // Fall back to first pain string.
  try {
    const pains = JSON.parse(row.pains_json || '[]');
    if (Array.isArray(pains) && pains.length > 0) {
      const first = String(pains[0] || '').trim();
      if (first) return first.slice(0, 200);
    }
  } catch {}
  return '';
}

/**
 * Main entry — fetch every Lab table the deck needs in parallel and
 * shape into SpinoutDemoDayData. Safe to call on a brand-new user with
 * no rows: every section degrades to '—' placeholders.
 */
export async function fillAxalSpinoutDemoDay(
  env: Env,
  userId: number,
  projectId: number,
): Promise<SpinoutDemoDayData> {
  const DB = env.DB;

  const [proj, user, score, financial, holders, interviews, interviewCount, okrs, milestones] = await Promise.all([
    DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first<ProjectRow>(),
    DB.prepare(`
      SELECT id, name, email, spinout_lab_active, spinout_lab_week, spinout_lab_started_at
      FROM users WHERE id = ?
    `).bind(userId).first<UserRow>(),
    DB.prepare(`
      SELECT total_score, tier, team_total, market_total
      FROM score_snapshots WHERE project_id = ?
      ORDER BY id DESC LIMIT 1
    `).bind(projectId).first<ScoreRow>().catch(() => null),
    DB.prepare(`
      SELECT computed_json FROM financial_models
      WHERE project_id = ? ORDER BY id DESC LIMIT 1
    `).bind(projectId).first<FinancialRow>().catch(() => null),
    DB.prepare(`
      SELECT name, email, ownership_pct, security_type
      FROM cap_table_holders WHERE project_id = ? OR (project_id IS NULL AND user_id = ?)
      ORDER BY ownership_pct DESC NULLS LAST LIMIT 8
    `).bind(projectId, userId).all<HolderRow>().catch(() => ({ results: [] as HolderRow[] })),
    DB.prepare(`
      SELECT interviewee_name, interviewee_role, notes, pains_json
      FROM discovery_interviews WHERE project_id = ?
      ORDER BY id DESC LIMIT 5
    `).bind(projectId).all<InterviewRow>().catch(() => ({ results: [] as InterviewRow[] })),
    DB.prepare(`SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?`)
      .bind(projectId).first<{ n: number }>().catch(() => ({ n: 0 })),
    DB.prepare(`
      SELECT objective, kanban_status FROM roadmap_okrs
      WHERE project_id = ? ORDER BY sort_order ASC, id ASC LIMIT 12
    `).bind(projectId).all<OKRRow>().catch(() => ({ results: [] as OKRRow[] })),
    DB.prepare(`
      SELECT milestone_key, week, completed_at FROM spinout_lab_milestones
      WHERE user_id = ? ORDER BY week ASC
    `).bind(userId).all<MilestoneRow>().catch(() => ({ results: [] as MilestoneRow[] })),
  ]);

  const p = (proj || {}) as Partial<ProjectRow>;
  const u = (user || {}) as Partial<UserRow>;
  const holdersList = holders?.results || [];
  const interviewsList = interviews?.results || [];
  const okrList = okrs?.results || [];
  const milestoneList = milestones?.results || [];
  const interviewN = Number(interviewCount?.n ?? 0) || 0;

  const labActive = Number(u.spinout_lab_active ?? 0) === 1;
  const week = Math.max(1, Math.min(4, Number(u.spinout_lab_week ?? 1)));
  const remaining = daysRemaining(u.spinout_lab_started_at ?? null);

  // ------ meta + cover --------------------------------------------------
  const projectName = orDash(p.name);
  const sector = orDash(p.sector);
  const founderName = orDash(u.name);
  const contactEmail = orDash(p.contact_email || u.email);
  const presentedOn = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // ------ insight evidence: real interview counts ----------------------
  const distinctPains = new Set<string>();
  let validatedHypotheses = 0;
  for (const it of interviewsList) {
    try {
      const arr = JSON.parse(it.pains_json || '[]');
      if (Array.isArray(arr)) for (const x of arr) distinctPains.add(String(x).toLowerCase().trim());
    } catch {}
    if ((it.notes || '').toLowerCase().includes('confirmed') || (it.notes || '').toLowerCase().includes('validated')) {
      validatedHypotheses += 1;
    }
  }

  // ------ lab progress: zip catalog with actual milestone rows ---------
  const doneMap = new Map<string, string>();
  for (const m of milestoneList) doneMap.set(m.milestone_key, m.completed_at);
  const weeks = WEEK_CATALOG.map((wc) => {
    const ms = wc.keys.map((k) => ({
      key: k.key,
      label: k.label,
      done: doneMap.has(k.key),
      completed_at: doneMap.get(k.key),
    }));
    const allDone = ms.every((m) => m.done);
    let status: 'complete' | 'in_progress' | 'upcoming' = 'upcoming';
    if (allDone) status = 'complete';
    else if (wc.week === week && labActive) status = 'in_progress';
    return { week: wc.week, title: wc.title, caption: wc.caption, status, milestones: ms };
  });

  // ------ traction: real interview quotes ------------------------------
  const interviewQuotes = interviewsList
    .map((it) => ({
      name: orDash(it.interviewee_name),
      role: it.interviewee_role || '',
      takeaway: interviewTakeaway(it),
    }))
    .filter((it) => it.takeaway)
    .slice(0, 3);

  // ------ financials: parse computed_json safely -----------------------
  let runwayMonths: unknown = null;
  let monthlyBurn: unknown = null;
  let ltv: unknown = null;
  let ltvCac: unknown = null;
  try {
    const fj = JSON.parse(financial?.computed_json || '{}');
    runwayMonths = fj.runway_months ?? fj.runway ?? null;
    monthlyBurn = fj.avg_monthly_burn ?? fj.monthly_burn ?? null;
    ltv = fj.ltv ?? null;
    ltvCac = fj.ltv_cac_ratio ?? null;
  } catch {}

  // ------ founders from cap table --------------------------------------
  const founders = holdersList
    .filter((h) => (h.security_type || '').toLowerCase().includes('common') || (h.ownership_pct ?? 0) >= 5)
    .slice(0, 4)
    .map((h) => ({
      name: orDash(h.name),
      role: h.ownership_pct != null ? `${Math.round(h.ownership_pct * 10) / 10}%` : 'Founder',
    }));

  // ------ GTM 90-day from "now" + "next" OKRs --------------------------
  const okrNow = okrList.filter((o) => (o.kanban_status || '').toLowerCase() === 'now').slice(0, 1);
  const okrNext = okrList.filter((o) => (o.kanban_status || '').toLowerCase() === 'next').slice(0, 1);
  const okrLater = okrList.filter((o) => (o.kanban_status || '').toLowerCase() === 'later').slice(0, 1);
  const plan90 = [
    okrNow[0]?.objective || DASH,
    okrNext[0]?.objective || DASH,
    okrLater[0]?.objective || DASH,
  ].map((s) => String(s).slice(0, 160));

  // ------ ask use_of_funds: parse "engineering:50, gtm:30, ops:20" -----
  const useOfFunds = parseUseOfFunds(p.use_of_funds || '');

  // ------ assemble ------------------------------------------------------
  return {
    meta: {
      project_name: projectName,
      sector,
      founder_name: founderName,
      contact_email: contactEmail,
      presented_on: presentedOn,
      week, days_remaining: remaining, lab_active: labActive,
      is_sample: false,
    },
    cover: {
      eyebrow: 'Axal · 30-Day Spin-Out Lab · Demo Day',
      headline: orDash(p.tagline) !== DASH ? String(p.tagline) : `${projectName} — Demo Day`,
      sub: orDash(p.vision) !== DASH
        ? String(p.vision)
        : 'A pre-incorporation thesis, sharpened across 30 days of Discovery, OKRs, Scoring and Cap-Table prep.',
      location: 'Axal Network · Demo Day',
    },
    thesis: {
      eyebrow: '01 · The bet',
      headline: orDash(p.tagline) !== DASH
        ? `We believe ${String(p.tagline).toLowerCase().replace(/\.$/, '')}.`
        : 'What we believe — and why now is the moment.',
      body: orDash(p.description) !== DASH
        ? String(p.description)
        : 'The Spin-Out Lab gave us 30 days to prove the thesis before incorporating. This deck is the artifact of that sprint.',
      pull_quote: orDash(p.vision) !== DASH
        ? `"${String(p.vision)}"`
        : `"We chose to spend 30 days proving the thesis before we spent a dollar incorporating it."`,
    },
    problem: {
      eyebrow: '02 · The problem',
      headline: 'Why this is broken today.',
      body: orDash(p.problem_statement),
      signals: signalsFromGrowth(p.growth_signals || '', interviewN),
    },
    insight: {
      eyebrow: '03 · The insight',
      headline: orDash(p.why_now) !== DASH ? String(p.why_now).slice(0, 80) : 'What we learned that the market missed.',
      body: orDash(p.why_now),
      evidence: [
        { label: 'Discovery interviews', value: interviewN > 0 ? String(interviewN) : DASH, sub: 'logged in Lab' },
        { label: 'Distinct pains', value: distinctPains.size > 0 ? String(distinctPains.size) : DASH, sub: 'tagged across interviews' },
        { label: 'Validated hypotheses', value: validatedHypotheses > 0 ? String(validatedHypotheses) : DASH, sub: 'evidence-backed' },
      ],
    },
    product: {
      eyebrow: '04 · The product',
      headline: 'A first cut of what we will ship.',
      body: orDash(p.solution || p.description),
      capabilities: capabilitiesFromSolution(p.solution || '', p.description || ''),
    },
    market: {
      eyebrow: '05 · The market',
      headline: sector !== DASH ? `${sector} — sized for a real outcome.` : 'Sized for a real outcome.',
      tam: fmtMoney(p.tam),
      sam: fmtMoney(p.sam),
      som: fmtMoney(p.som),
      why_now: signalsFromGrowth(p.why_now || '', 0),
    },
    traction: {
      eyebrow: '06 · Early signal',
      headline: orDash(p.traction_summary) !== DASH ? String(p.traction_summary).slice(0, 80) : 'Who we talked to, what they said.',
      metrics: [
        { label: 'Interviews', value: interviewN > 0 ? String(interviewN) : DASH },
        { label: 'Users', value: Number(p.users_count) > 0 ? Number(p.users_count).toLocaleString() : DASH },
        { label: 'Score', value: score?.total_score != null ? `${Math.round(Number(score.total_score))}/100` : DASH, sub: score?.tier || 'Axal scoring' },
      ],
      interviews_count: interviewN,
      interviews_recent: interviewQuotes,
    },
    lab_progress: {
      eyebrow: '07 · 30-day sprint',
      headline: labActive
        ? `Week ${week} of 4 — ${remaining} days remaining.`
        : 'How we used the Lab.',
      weeks,
    },
    business_model: {
      eyebrow: '08 · How we make money',
      headline: 'A model that scales with the value we create.',
      body: DASH,
      unit_econ: [
        { label: 'LTV', value: fmtMoney(ltv) },
        { label: 'LTV : CAC', value: ltvCac != null && isFinite(Number(ltvCac)) ? `${Math.round(Number(ltvCac) * 10) / 10}×` : DASH },
        { label: 'Gross margin', value: p.gross_margin_pct != null ? fmtPct(p.gross_margin_pct) : DASH },
      ],
    },
    gtm: {
      eyebrow: '09 · Go-to-market',
      headline: 'First customers, then a wedge.',
      channels: [
        { name: DASH, line: DASH },
        { name: DASH, line: DASH },
        { name: DASH, line: DASH },
      ],
      plan_90d: plan90,
    },
    competition: {
      eyebrow: '10 · Landscape',
      headline: 'Where we sit, where we move.',
      x_label: 'Generalist → Specialist',
      y_label: 'Manual → AI-native',
      players: [
        { name: 'Incumbent A', x: 25, y: 30 },
        { name: 'Incumbent B', x: 70, y: 25 },
        { name: 'New entrant', x: 35, y: 70 },
        { name: projectName !== DASH ? projectName : 'Us', x: 78, y: 82, is_us: true },
      ],
      wedge: DASH,
    },
    team: {
      eyebrow: '11 · Team',
      headline: 'Why we are the founders to build this.',
      founders,
      advisors: [],
      scoring: {
        total_score: score?.total_score != null ? Number(score.total_score) : undefined,
        tier: score?.tier || undefined,
        team_total: score?.team_total != null ? Number(score.team_total) : undefined,
        market_total: score?.market_total != null ? Number(score.market_total) : undefined,
      },
    },
    ask: {
      eyebrow: '12 · Ask',
      headline: p.funding_needed && Number(p.funding_needed) > 0
        ? `Raising ${fmtMoney(p.funding_needed)} — 18 months of runway.`
        : 'What we are raising and what it buys.',
      raise_amount: fmtMoney(p.funding_needed),
      runway: fmtMonths(runwayMonths) !== DASH ? fmtMonths(runwayMonths) : '18',
      use_of_funds: useOfFunds.length > 0 ? useOfFunds : [
        { label: 'Engineering', pct: 50 },
        { label: 'Go-to-market', pct: 30 },
        { label: 'Operations', pct: 20 },
      ],
      next_milestones: [
        okrNow[0]?.objective || DASH,
        okrNext[0]?.objective || DASH,
        okrLater[0]?.objective || DASH,
      ].map((s) => String(s).slice(0, 160)),
      contact: contactEmail,
    },
    closing: {
      eyebrow: '14 · Thank you',
      headline: projectName !== DASH ? projectName : 'Built in the Axal Spin-Out Lab.',
      body: '30 days. 14 slides. One thesis, sharpened by the network.',
      signoff: founderName !== DASH ? `— ${founderName}` : '— The founder',
      contact: contactEmail,
    },
  };
}

function signalsFromGrowth(raw: string, fallbackInterviewCount: number): string[] {
  const text = (raw || '').trim();
  if (text) {
    // Split on newlines, semicolons, or " · ".
    const parts = text.split(/[\n;]\s*|\s+·\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    while (parts.length < 3) parts.push(DASH);
    return parts.slice(0, 3);
  }
  if (fallbackInterviewCount > 0) {
    return [
      `${fallbackInterviewCount} interviews logged in discovery`,
      DASH,
      DASH,
    ];
  }
  return [DASH, DASH, DASH];
}

function capabilitiesFromSolution(solution: string, description: string): string[] {
  const text = (solution || description || '').trim();
  if (!text) return [DASH, DASH, DASH];
  // Try bullet-style first.
  const bullets = text.split(/\n|;|\s•\s|\s-\s/).map((s) => s.trim()).filter((s) => s.length >= 4);
  if (bullets.length >= 2) {
    while (bullets.length < 3) bullets.push(DASH);
    return bullets.slice(0, 3);
  }
  // Fall back: sentence split.
  const sentences = text.split(/[.!?]\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  while (sentences.length < 3) sentences.push(DASH);
  return sentences.slice(0, 3);
}

function parseUseOfFunds(raw: string): Array<{ label: string; pct: number }> {
  if (!raw) return [];
  const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const out: Array<{ label: string; pct: number }> = [];
  for (const part of parts) {
    const m = part.match(/^(.+?)[:\s]+(\d{1,3})\s*%?$/);
    if (m) {
      const pct = Math.max(0, Math.min(100, parseInt(m[2], 10)));
      out.push({ label: m[1].trim(), pct });
    }
  }
  // Only use if pcts sum near 100 — otherwise treat raw as a single bucket.
  const sum = out.reduce((a, b) => a + b.pct, 0);
  if (out.length >= 2 && sum >= 80 && sum <= 120) return out.slice(0, 5);
  return [];
}

/**
 * Build the 14 slide records that get persisted in pitch_decks.slides.
 * Each slide carries a single paragraph field whose `value` is the
 * JSON-encoded payload for the matching SAMPLE_DATA section in the
 * adapter. buildTemplateData (in PitchDeckPrintPage) flattens this into
 * a `{ axal_spinout_section_<section>: '<json>' }` map that the adapter
 * parses back via `hydrate()`.
 *
 * Per-field paragraph value cap in sanitizeFields is 4000 chars. The
 * largest section (lab_progress with 4 weeks × 3 milestones) clocks in
 * around 1.2KB so we are well under.
 */
export function buildAxalSpinoutDemoDaySlides(data: SpinoutDemoDayData): any[] {
  const sectionSlides: Array<{ key: keyof SpinoutDemoDayData; id: string; title: string; subtitle?: string | null }> = [
    { key: 'cover',          id: 'cover',          title: 'Cover' },
    { key: 'thesis',         id: 'thesis',         title: 'Thesis' },
    { key: 'problem',        id: 'problem',        title: 'Problem' },
    { key: 'insight',        id: 'insight',        title: 'Insight' },
    { key: 'product',        id: 'product',        title: 'Product' },
    { key: 'market',         id: 'market',         title: 'Market' },
    { key: 'traction',       id: 'traction',       title: 'Early signal' },
    { key: 'lab_progress',   id: 'lab_progress',   title: '30-day sprint' },
    { key: 'business_model', id: 'model',          title: 'Business model' },
    { key: 'gtm',            id: 'gtm',            title: 'Go-to-market' },
    { key: 'competition',    id: 'competition',    title: 'Landscape' },
    { key: 'team',           id: 'team',           title: 'Team' },
    { key: 'ask',            id: 'ask',            title: 'Ask' },
    { key: 'closing',        id: 'closing',        title: 'Thank you' },
  ];

  // Slide 1 also carries the `meta` section as an extra field — keeps
  // founder name, week, days_remaining accessible to every other slide
  // without inflating each one's payload.
  const slides: any[] = sectionSlides.map((s, idx) => {
    const payload = (data as any)[s.key];
    const fields: any[] = [
      {
        key: `axal_spinout_section_${s.key}`,
        label: s.title,
        kind: 'paragraph',
        value: JSON.stringify(payload).slice(0, 4000),
        source: 'data',
      },
    ];
    if (idx === 0) {
      fields.push({
        key: 'axal_spinout_section_meta',
        label: 'Meta',
        kind: 'paragraph',
        value: JSON.stringify(data.meta).slice(0, 4000),
        source: 'data',
      });
    }
    return {
      title: s.title,
      subtitle: s.subtitle ?? null,
      spec_id: s.id,
      method_id: 'axal_spinout_demoday',
      appendix: false,
      fields,
      // Legacy fallback keys so the old non-template renderer at least
      // shows the section title; the registry path supersedes this.
      body: '',
      bullets: [],
      image_url: null,
    };
  });

  return slides;
}
