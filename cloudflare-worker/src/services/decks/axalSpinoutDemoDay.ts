/**
 * axalSpinoutDemoDay.ts — Task #15
 *
 * Builds the Axal 30-day Spin-Out Lab "Demo Day" deck payload from
 * canonical Lab data. 14 fixed sections in the spec-required order:
 *
 *   cover · problem · validation · market · solution · roadmap ·
 *   brand · venture_readiness · team · mentor_network · cap_table ·
 *   ask · axal_signal · contact
 *
 * Source tables (all read in parallel — `Promise.all`):
 *   - projects                 (name, sector, tagline, vision, problem,
 *                               solution, TAM/SAM/SOM, funding_needed,
 *                               use_of_funds, traction_summary, …)
 *   - users                    (display_name / name, spinout_lab_week,
 *                               spinout_lab_active, spinout_lab_started_at)
 *   - spinout_lab_milestones   (per-user milestone_key + week + completed_at)
 *   - discovery_interviews     (interview count, pains_json,
 *                               hypotheses_json, recent quotes)
 *   - roadmap_okrs             (objectives + key_results bucketed
 *                               Now / Next / Later, quarter)
 *   - score_snapshots          (total, tier, 6 sub-scores + ai_notes —
 *                               filtered to is_sandbox = 0)
 *   - financial_models         (inputs_json → runway/burn/use-of-funds)
 *   - cap_table_holders        (founders + investors with ownership %;
 *                               `kind` lazy-added by ensureSpinoutDeckSchema)
 *   - advisor_answers          (free-text colour for thesis / mentors /
 *                               team — question_id + raw_value)
 *
 * Honesty: when a row is absent the field is left as the literal '—'
 * placeholder so the adapter renders a visible <Nudge> cue. No
 * fabricated runway, use-of-funds split, quotes, or names — ever.
 *
 * Output shape mirrors `SpinoutDemoDayData` in the frontend adapter.
 * The route handler JSON-encodes each top-level section as a single
 * paragraph field keyed `axal_spinout_section_<name>`, which flows
 * through sanitizeSlides → buildTemplateData unchanged.
 */
import type { Env } from '../../types';

const DASH = '—';

const orDash = (v: unknown): string => {
  const s = (v == null ? '' : String(v)).trim();
  return s ? s : DASH;
};

const fmtMoney = (n: unknown): string => {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return DASH;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString()}`;
};

const fmtPct = (n: unknown): string => {
  const v = Number(n);
  if (!isFinite(v)) return DASH;
  return `${Math.round(v * 10) / 10}%`;
};

const fmtMonths = (n: unknown): string => {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return DASH;
  return `${Math.round(v)} months`;
};

/**
 * Lazy bootstrap for any spec-listed columns that may not exist yet.
 * Same self-healing pattern as ensureTelegramSchema / ensureXSchema.
 *
 * Today only `cap_table_holders.kind` is plausibly missing (the spec
 * calls for it but the original migration 020 didn't include it). All
 * other columns the deck consumes — score_snapshots.is_sandbox + the 6
 * sub-scores + ai_notes, financial_models.inputs_json, roadmap_okrs
 * kanban_status + quarter, discovery_interviews pains_json +
 * hypotheses_json, spinout_lab_milestones milestone_key + week +
 * completed_at, advisor_answers question_id + raw_value — already
 * exist in their original CREATE TABLE statements.
 *
 * D1 has no `ADD COLUMN IF NOT EXISTS`, so wrap in try/catch and
 * swallow the "duplicate column name" error.
 */
let _schemaReady = false;
export async function ensureSpinoutDeckSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(`ALTER TABLE cap_table_holders ADD COLUMN kind TEXT`);
  } catch {
    /* already exists — fine */
  }
  _schemaReady = true;
}

// Mirrors services/spinoutLabCatalog.ts MILESTONES. Duplicated here so
// the deck module stays self-contained; unknown keys still degrade
// gracefully (rendered as key.replace(/_/g,' ')).
const WEEK_CATALOG: Array<{
  week: number; title: string; caption: string;
  keys: Array<{ key: string; label: string }>;
}> = [
  { week: 1, title: 'Discovery', caption: 'Talk to 8+ people. Tag pains. Form hypotheses.', keys: [
    { key: 'interview_5_logged', label: '5 interviews logged' },
    { key: 'pains_clustered', label: 'Pains clustered' },
    { key: 'hypothesis_drafted', label: 'Hypothesis drafted' },
  ] },
  { week: 2, title: 'Shape', caption: 'OKRs. Roadmap. First scoring pass.', keys: [
    { key: 'okrs_drafted', label: 'OKRs drafted' },
    { key: 'roadmap_outlined', label: 'Roadmap outlined' },
    { key: 'score_baseline', label: 'Baseline score' },
  ] },
  { week: 3, title: 'Validate', caption: 'Sharpen the model. Stress-test the cap table.', keys: [
    { key: 'financial_model_v1', label: 'Financial model v1' },
    { key: 'captable_seed', label: 'Cap table seeded' },
    { key: 'score_v2', label: 'Score v2' },
  ] },
  { week: 4, title: 'Stand up', caption: 'Incorporate, brand, ship the deck.', keys: [
    { key: 'brand_kit', label: 'Brand kit' },
    { key: 'pitch_deck_v1', label: 'Pitch deck v1' },
    { key: 'incorporation_completed', label: 'Incorporated' },
  ] },
];

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
  problem: { eyebrow: string; headline: string; body: string; signals: string[] };
  validation: {
    eyebrow: string; headline: string; body: string;
    metrics: Array<{ label: string; value: string; sub?: string }>;
    quotes: Array<{ name: string; role: string; takeaway: string }>;
  };
  market: {
    eyebrow: string; headline: string;
    tam: string; sam: string; som: string;
    why_now: string[];
  };
  solution: {
    eyebrow: string; headline: string; body: string;
    capabilities: string[];
  };
  roadmap: {
    eyebrow: string; headline: string;
    quarter: string;
    now: string[]; next: string[]; later: string[];
  };
  brand: {
    eyebrow: string; headline: string;
    tagline: string; vision: string;
    brand_kit_ready: boolean;
    pitch_deck_ready: boolean;
    incorporated: boolean;
  };
  venture_readiness: {
    eyebrow: string; headline: string;
    total_score: string; tier: string;
    is_sandbox: boolean;
    breakdown: Array<{ label: string; value: string }>;
    ai_notes: string;
  };
  team: {
    eyebrow: string; headline: string;
    founders: Array<{ name: string; role: string; bio?: string }>;
    team_intro: string;
  };
  mentor_network: {
    eyebrow: string; headline: string;
    body: string;
    mentors: string[];
    network_signals: string[];
  };
  cap_table: {
    eyebrow: string; headline: string;
    holders: Array<{ name: string; role: string; ownership_pct: string; kind: string }>;
    note: string;
  };
  ask: {
    eyebrow: string; headline: string;
    raise_amount: string; runway: string;
    use_of_funds: Array<{ label: string; pct: number }>;
    next_milestones: string[];
  };
  axal_signal: {
    eyebrow: string; headline: string;
    body: string;
    lab_weeks: Array<{
      week: number; title: string; caption: string;
      status: 'complete' | 'in_progress' | 'upcoming';
      milestones: Array<{ key: string; label: string; done: boolean }>;
    }>;
  };
  contact: {
    eyebrow: string; headline: string; body: string;
    contact_email: string; signoff: string;
  };
};

type ProjectRow = {
  id: number; founder_id: number | null;
  name: string | null; sector: string | null; tagline: string | null;
  description: string | null; problem_statement: string | null;
  solution: string | null; why_now: string | null; vision: string | null;
  tam: number | null; sam: number | null; som: number | null;
  funding_needed: number | null; use_of_funds: string | null;
  contact_email: string | null; traction_summary: string | null;
  growth_signals: string | null; gross_margin_pct: number | null;
};
type UserRow = {
  id: number; name: string | null; display_name: string | null; email: string | null;
  spinout_lab_active: number | null; spinout_lab_week: number | null;
  spinout_lab_started_at: string | null;
};
type InterviewRow = {
  interviewee_name: string | null; interviewee_role: string | null;
  notes: string | null; pains_json: string | null; hypotheses_json: string | null;
};
type ScoreRow = {
  total_score: number | null; tier: string | null; is_sandbox: number | null;
  market_total: number | null; team_total: number | null;
  product_total: number | null; capital_total: number | null;
  fit_total: number | null; distribution_total: number | null;
  ai_notes: string | null;
};
type FinancialRow = { inputs_json: string | null; computed_json?: string | null };
type HolderRow = {
  name: string | null; ownership_pct: number | null;
  security_type: string | null; kind: string | null;
};
type OKRRow = {
  objective: string | null; kanban_status: string | null;
  quarter: string | null; key_results_json: string | null;
};
type MilestoneRow = { milestone_key: string; week: number; completed_at: string };
type AdvisorAnswerRow = { question_id: string; raw_value: string | null };

const daysRemaining = (startedAt: string | null | undefined): number => {
  if (!startedAt) return 28;
  const ms = Date.parse(startedAt.replace(' ', 'T') + (startedAt.includes('Z') ? '' : 'Z'));
  if (!isFinite(ms)) return 28;
  const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  return Math.max(0, 28 - elapsed);
};

/** Extract a one-sentence "takeaway" from interview notes / first pain. */
const interviewTakeaway = (row: InterviewRow): string => {
  const notes = (row.notes || '').trim();
  if (notes) {
    const m = notes.match(/^[^.!?\n]{8,220}[.!?]?/);
    return (m ? m[0] : notes).slice(0, 200).trim();
  }
  try {
    const pains = JSON.parse(row.pains_json || '[]');
    if (Array.isArray(pains) && pains.length > 0) {
      const first = String(pains[0] || '').trim();
      if (first) return first.slice(0, 200);
    }
  } catch {}
  return '';
};

/** Parse "Eng 55%, GTM 30%" / "engineering:50, gtm:30" into FundUse[]. */
const parseUseOfFunds = (raw: string): Array<{ label: string; pct: number }> => {
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
  const sum = out.reduce((a, b) => a + b.pct, 0);
  if (out.length >= 2 && sum >= 80 && sum <= 120) return out.slice(0, 5);
  return [];
};

const signalsFromText = (raw: string, max = 3): string[] => {
  const text = (raw || '').trim();
  if (!text) return [];
  return text.split(/[\n;]\s*|\s+·\s+/).map((s) => s.trim()).filter(Boolean).slice(0, max);
};

const capabilitiesFromText = (raw: string): string[] => {
  const text = (raw || '').trim();
  if (!text) return [];
  const bullets = text.split(/\n|;|\s•\s|\s-\s/).map((s) => s.trim()).filter((s) => s.length >= 4);
  if (bullets.length >= 2) return bullets.slice(0, 4);
  return text.split(/[.!?]\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
};

const padTo = <T>(arr: T[], min: number, filler: T): T[] => {
  const out = arr.slice();
  while (out.length < min) out.push(filler);
  return out;
};

/**
 * Main entry — fetch every Lab table the deck needs in parallel and
 * shape into SpinoutDemoDayData. Safe to call on a brand-new user with
 * no rows: every section degrades to '—' placeholders or empty arrays,
 * which the adapter renders as <Nudge> cues pointing the founder back
 * to the right Lab page.
 */
export async function fillAxalSpinoutDemoDay(
  env: Env,
  userId: number,
  projectId: number,
): Promise<SpinoutDemoDayData> {
  await ensureSpinoutDeckSchema(env);
  const DB = env.DB;

  const [
    proj, user, score, financial, holders,
    interviews, interviewCount, okrs, milestones, advisorAnswers,
  ] = await Promise.all([
    DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first<ProjectRow>(),
    DB.prepare(`
      SELECT id, name, display_name, email, spinout_lab_active,
             spinout_lab_week, spinout_lab_started_at
      FROM users WHERE id = ?
    `).bind(userId).first<UserRow>(),
    DB.prepare(`
      SELECT total_score, tier, is_sandbox,
             market_total, team_total, product_total,
             capital_total, fit_total, distribution_total, ai_notes
      FROM score_snapshots
      WHERE project_id = ? AND COALESCE(is_sandbox, 0) = 0
      ORDER BY id DESC LIMIT 1
    `).bind(projectId).first<ScoreRow>().catch(() => null),
    DB.prepare(`
      SELECT inputs_json, computed_json FROM financial_models
      WHERE project_id = ? ORDER BY id DESC LIMIT 1
    `).bind(projectId).first<FinancialRow>().catch(() => null),
    DB.prepare(`
      SELECT name, ownership_pct, security_type, kind
      FROM cap_table_holders
      WHERE project_id = ? OR (project_id IS NULL AND user_id = ?)
      ORDER BY ownership_pct DESC NULLS LAST LIMIT 12
    `).bind(projectId, userId).all<HolderRow>().catch(() => ({ results: [] as HolderRow[] })),
    DB.prepare(`
      SELECT interviewee_name, interviewee_role, notes, pains_json, hypotheses_json
      FROM discovery_interviews WHERE project_id = ?
      ORDER BY id DESC LIMIT 6
    `).bind(projectId).all<InterviewRow>().catch(() => ({ results: [] as InterviewRow[] })),
    DB.prepare(`SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?`)
      .bind(projectId).first<{ n: number }>().catch(() => ({ n: 0 })),
    DB.prepare(`
      SELECT objective, kanban_status, quarter, key_results_json
      FROM roadmap_okrs WHERE project_id = ?
      ORDER BY sort_order ASC, id ASC LIMIT 18
    `).bind(projectId).all<OKRRow>().catch(() => ({ results: [] as OKRRow[] })),
    DB.prepare(`
      SELECT milestone_key, week, completed_at FROM spinout_lab_milestones
      WHERE user_id = ? ORDER BY week ASC
    `).bind(userId).all<MilestoneRow>().catch(() => ({ results: [] as MilestoneRow[] })),
    DB.prepare(`
      SELECT question_id, raw_value FROM advisor_answers
      WHERE user_id = ? AND raw_value IS NOT NULL AND TRIM(raw_value) <> ''
      ORDER BY id DESC LIMIT 200
    `).bind(userId).all<AdvisorAnswerRow>().catch(() => ({ results: [] as AdvisorAnswerRow[] })),
  ]);

  const p = (proj || {}) as Partial<ProjectRow>;
  const u = (user || {}) as Partial<UserRow>;
  const holdersList = holders?.results || [];
  const interviewsList = interviews?.results || [];
  const okrList = okrs?.results || [];
  const milestoneList = milestones?.results || [];
  const advisorList = advisorAnswers?.results || [];
  const interviewN = Number(interviewCount?.n ?? 0) || 0;

  const labActive = Number(u.spinout_lab_active ?? 0) === 1;
  const week = Math.max(1, Math.min(4, Number(u.spinout_lab_week ?? 1)));
  const remaining = daysRemaining(u.spinout_lab_started_at ?? null);

  const projectName = orDash(p.name);
  const sector = orDash(p.sector);
  const founderName = orDash(u.display_name || u.name);
  const contactEmail = orDash(p.contact_email || u.email);
  const presentedOn = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // ------ validation: pains + hypotheses from real interviews ----------
  const distinctPains = new Set<string>();
  let validatedHypotheses = 0;
  for (const it of interviewsList) {
    try {
      const arr = JSON.parse(it.pains_json || '[]');
      if (Array.isArray(arr)) for (const x of arr) distinctPains.add(String(x).toLowerCase().trim());
    } catch {}
    try {
      const hyps = JSON.parse(it.hypotheses_json || '[]');
      if (Array.isArray(hyps)) {
        validatedHypotheses += hyps.filter((h: any) => {
          const status = String((h && (h.status || h.state)) || '').toLowerCase();
          return status === 'validated' || status === 'confirmed' || status === 'true';
        }).length;
      }
    } catch {}
  }
  // Notes-based fallback if hypotheses_json is empty but notes mention validation.
  if (validatedHypotheses === 0) {
    for (const it of interviewsList) {
      const n = (it.notes || '').toLowerCase();
      if (n.includes('confirmed') || n.includes('validated')) validatedHypotheses += 1;
    }
  }

  const interviewQuotes = interviewsList
    .map((it) => ({
      name: orDash(it.interviewee_name),
      role: it.interviewee_role || '',
      takeaway: interviewTakeaway(it),
    }))
    .filter((it) => it.takeaway && it.name !== DASH)
    .slice(0, 3);

  // ------ roadmap: bucket OKRs by kanban_status, pull quarter ---------
  const okrByStatus = (status: string): string[] =>
    okrList
      .filter((o) => (o.kanban_status || '').toLowerCase() === status)
      .map((o) => String(o.objective || '').trim())
      .filter(Boolean)
      .slice(0, 4);
  const okrNow = okrByStatus('now');
  const okrNext = okrByStatus('next');
  const okrLater = okrByStatus('later');
  const quarter = orDash(okrList.find((o) => o.quarter)?.quarter || '');

  // ------ milestones map for brand + axal_signal weeks ----------------
  const doneMap = new Map<string, string>();
  for (const m of milestoneList) doneMap.set(m.milestone_key, m.completed_at);
  const labWeeks = WEEK_CATALOG.map((wc) => {
    const ms = wc.keys.map((k) => ({ key: k.key, label: k.label, done: doneMap.has(k.key) }));
    const allDone = ms.every((m) => m.done);
    let status: 'complete' | 'in_progress' | 'upcoming' = 'upcoming';
    if (allDone) status = 'complete';
    else if (wc.week === week && labActive) status = 'in_progress';
    return { week: wc.week, title: wc.title, caption: wc.caption, status, milestones: ms };
  });

  // ------ financials: inputs_json first, fall back to computed_json ---
  let runwayMonths: unknown = null;
  let financialUseOfFunds: Array<{ label: string; pct: number }> = [];
  try {
    const fj = JSON.parse(financial?.inputs_json || '{}');
    runwayMonths = fj.runway_months ?? fj.runway ?? null;
    if (Array.isArray(fj.use_of_funds)) {
      financialUseOfFunds = fj.use_of_funds
        .map((x: any) => ({ label: String(x?.label || '').trim(), pct: Number(x?.pct) }))
        .filter((x: { label: string; pct: number }) => x.label && isFinite(x.pct) && x.pct > 0)
        .slice(0, 5);
    }
  } catch {}
  if (runwayMonths == null) {
    try {
      const cj = JSON.parse(financial?.computed_json || '{}');
      runwayMonths = cj.runway_months ?? cj.runway ?? null;
    } catch {}
  }
  // Project-string parse is the third source; never invent a 50/30/20 split.
  const useOfFundsParsed = financialUseOfFunds.length > 0
    ? financialUseOfFunds
    : parseUseOfFunds(p.use_of_funds || '');

  // ------ team + mentor colour from advisor_answers -------------------
  const advisorMap = new Map<string, string>();
  for (const a of advisorList) {
    if (!advisorMap.has(a.question_id) && a.raw_value) {
      advisorMap.set(a.question_id, a.raw_value);
    }
  }
  const teamIntro = advisorMap.get('founder.lab.team_intro')
    || advisorMap.get('founder.lab.why_us')
    || advisorMap.get('team.intro')
    || '';
  const mentorBody = advisorMap.get('founder.lab.mentors')
    || advisorMap.get('founder.lab.network')
    || advisorMap.get('founder.dd.mentors')
    || '';
  const networkSignals = signalsFromText(
    advisorMap.get('founder.lab.network_signals') || '',
    3,
  );

  // ------ founders + cap-table holders --------------------------------
  // "Founder" rows = explicit kind=founder OR common-stock holders OR
  // anyone holding ≥5% who isn't tagged as an investor/ESOP. Everyone
  // else surfaces on the cap_table slide.
  const founders = holdersList
    .filter((h) => {
      const k = (h.kind || '').toLowerCase();
      if (k === 'investor' || k === 'esop') return false;
      const st = (h.security_type || '').toLowerCase();
      return k === 'founder' || st.includes('common') || (h.ownership_pct ?? 0) >= 5;
    })
    .slice(0, 4)
    .map((h) => ({
      name: orDash(h.name),
      role: h.ownership_pct != null
        ? `Founder · ${Math.round(h.ownership_pct * 10) / 10}%`
        : 'Founder',
      bio: undefined as string | undefined,
    }))
    .filter((f) => f.name !== DASH);

  const allHolders = holdersList
    .filter((h) => h.name && (h.ownership_pct ?? 0) > 0)
    .slice(0, 10)
    .map((h) => ({
      name: orDash(h.name),
      role: (h.security_type || '').trim() || DASH,
      ownership_pct: h.ownership_pct != null
        ? `${Math.round(h.ownership_pct * 10) / 10}%`
        : DASH,
      kind: (h.kind || '').trim() || DASH,
    }));

  // ------ assemble all 14 sections ------------------------------------
  return {
    meta: {
      project_name: projectName, sector,
      founder_name: founderName, contact_email: contactEmail,
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
      location: `Presented ${presentedOn} · Axal Network`,
    },

    problem: {
      eyebrow: '01 · Problem',
      headline: 'Why this is broken today.',
      body: orDash(p.problem_statement),
      signals: signalsFromText(p.growth_signals || ''),
    },

    validation: {
      eyebrow: '02 · Validation',
      headline: interviewN > 0
        ? `${interviewN} discovery interviews — what we heard.`
        : 'Discovery — what we heard.',
      body: orDash(p.why_now),
      metrics: [
        { label: 'Interviews', value: interviewN > 0 ? String(interviewN) : DASH, sub: 'logged in Lab' },
        { label: 'Distinct pains', value: distinctPains.size > 0 ? String(distinctPains.size) : DASH, sub: 'tagged' },
        { label: 'Hypotheses validated', value: validatedHypotheses > 0 ? String(validatedHypotheses) : DASH, sub: 'evidence-backed' },
      ],
      quotes: interviewQuotes,
    },

    market: {
      eyebrow: '03 · Market',
      headline: sector !== DASH ? `${sector} — sized for a real outcome.` : 'Sized for a real outcome.',
      tam: fmtMoney(p.tam),
      sam: fmtMoney(p.sam),
      som: fmtMoney(p.som),
      why_now: signalsFromText(p.why_now || ''),
    },

    solution: {
      eyebrow: '04 · Solution',
      headline: 'A first cut of what we will ship.',
      body: orDash(p.solution || p.description),
      capabilities: capabilitiesFromText(p.solution || p.description || ''),
    },

    roadmap: {
      eyebrow: '05 · Roadmap',
      headline: quarter !== DASH ? `Roadmap — ${quarter}.` : 'What we ship next.',
      quarter,
      now: okrNow,
      next: okrNext,
      later: okrLater,
    },

    brand: {
      eyebrow: '06 · Brand',
      headline: orDash(p.tagline) !== DASH ? String(p.tagline) : 'How we show up.',
      tagline: orDash(p.tagline),
      vision: orDash(p.vision),
      brand_kit_ready: doneMap.has('brand_kit'),
      pitch_deck_ready: doneMap.has('pitch_deck_v1'),
      incorporated: doneMap.has('incorporation_completed'),
    },

    venture_readiness: {
      eyebrow: '07 · Venture readiness',
      headline: (score?.tier && score?.total_score != null)
        ? `Axal score: ${Math.round(Number(score.total_score))}/100 — ${score.tier}.`
        : 'Axal score — to be run in Week 2.',
      total_score: score?.total_score != null ? `${Math.round(Number(score.total_score))}/100` : DASH,
      tier: orDash(score?.tier),
      is_sandbox: Number(score?.is_sandbox ?? 0) === 1,
      breakdown: score ? [
        { label: 'Market', value: score.market_total != null ? `${Math.round(Number(score.market_total))}` : DASH },
        { label: 'Team', value: score.team_total != null ? `${Math.round(Number(score.team_total))}` : DASH },
        { label: 'Product', value: score.product_total != null ? `${Math.round(Number(score.product_total))}` : DASH },
        { label: 'Capital', value: score.capital_total != null ? `${Math.round(Number(score.capital_total))}` : DASH },
        { label: 'Fit', value: score.fit_total != null ? `${Math.round(Number(score.fit_total))}` : DASH },
        { label: 'Distribution', value: score.distribution_total != null ? `${Math.round(Number(score.distribution_total))}` : DASH },
      ] : [],
      ai_notes: orDash(score?.ai_notes),
    },

    team: {
      eyebrow: '08 · Team',
      headline: 'Why we are the founders to build this.',
      founders,
      team_intro: teamIntro,
    },

    mentor_network: {
      eyebrow: '09 · Mentors & network',
      headline: 'Who is around the table.',
      body: mentorBody,
      mentors: signalsFromText(mentorBody, 6),
      network_signals: networkSignals,
    },

    cap_table: {
      eyebrow: '10 · Cap table',
      headline: doneMap.has('captable_seed')
        ? 'Seeded in Week 3. Clean. Founder-controlled.'
        : 'Cap table — to be seeded in Week 3.',
      holders: allHolders,
      note: doneMap.has('incorporation_completed')
        ? 'Incorporated in Week 4.'
        : 'Pre-incorporation — entity stands up in Week 4.',
    },

    ask: {
      eyebrow: '11 · Ask',
      headline: p.funding_needed && Number(p.funding_needed) > 0
        ? `Raising ${fmtMoney(p.funding_needed)}.`
        : 'What we are raising — and what it buys.',
      raise_amount: fmtMoney(p.funding_needed),
      runway: fmtMonths(runwayMonths),
      use_of_funds: useOfFundsParsed,
      next_milestones: padTo([...okrNow.slice(0, 1), ...okrNext.slice(0, 1), ...okrLater.slice(0, 1)], 3, DASH),
    },

    axal_signal: {
      eyebrow: '12 · Axal signal',
      headline: labActive
        ? `Week ${week} of 4 — ${remaining} days remaining.`
        : 'Built across 30 days of Lab work.',
      body: orDash(score?.ai_notes),
      lab_weeks: labWeeks,
    },

    contact: {
      eyebrow: '13 · Contact',
      headline: 'Let\'s talk.',
      body: orDash(p.traction_summary),
      contact_email: contactEmail,
      signoff: founderName !== DASH ? `— ${founderName}` : '— The founding team',
    },
  };
}

/**
 * Build the 14 slides written to `pitch_decks.slides`. Each slide
 * carries one JSON-encoded paragraph field keyed
 * `axal_spinout_section_<name>`; slide 0 also carries `meta`.
 *
 * The adapter's `hydrate()` walks these keys, parses each JSON, and
 * merges onto SAMPLE_DATA via `mergeShape()`.
 */
export function buildAxalSpinoutDemoDaySlides(data: SpinoutDemoDayData): Array<Record<string, unknown>> {
  const enc = (obj: unknown): string => JSON.stringify(obj).slice(0, 3900);
  const para = (key: string, value: string) => ({ kind: 'paragraph', key, value });

  const SPEC = [
    { spec_id: 'cover', section: 'cover', title: 'Cover' },
    { spec_id: 'problem', section: 'problem', title: 'Problem' },
    { spec_id: 'validation', section: 'validation', title: 'Validation' },
    { spec_id: 'market', section: 'market', title: 'Market' },
    { spec_id: 'solution', section: 'solution', title: 'Solution' },
    { spec_id: 'roadmap', section: 'roadmap', title: 'Roadmap' },
    { spec_id: 'brand', section: 'brand', title: 'Brand' },
    { spec_id: 'venture_readiness', section: 'venture_readiness', title: 'Venture readiness' },
    { spec_id: 'team', section: 'team', title: 'Team' },
    { spec_id: 'mentor_network', section: 'mentor_network', title: 'Mentors & network' },
    { spec_id: 'cap_table', section: 'cap_table', title: 'Cap table' },
    { spec_id: 'ask', section: 'ask', title: 'Ask' },
    { spec_id: 'axal_signal', section: 'axal_signal', title: 'Axal signal' },
    { spec_id: 'contact', section: 'contact', title: 'Contact' },
  ] as const;

  return SPEC.map((s, i) => {
    const sectionPayload = (data as any)[s.section];
    const fields: Array<Record<string, unknown>> = [
      para(`axal_spinout_section_${s.section}`, enc(sectionPayload)),
    ];
    // Slide 0 carries the deck-wide meta envelope.
    if (i === 0) {
      fields.push(para('axal_spinout_section_meta', enc(data.meta)));
    }
    return {
      title: s.title,
      subtitle: null,
      spec_id: s.spec_id,
      appendix: false,
      method_id: 'axal_spinout_demoday',
      fields,
      body: '',
      bullets: [],
      image_url: null,
    };
  });
}
