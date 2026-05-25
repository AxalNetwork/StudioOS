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
  featured: number | null;
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
  shares: number | null;
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
      SELECT name, ownership_pct, shares, security_type, kind
      FROM cap_table_holders
      WHERE project_id = ? OR (project_id IS NULL AND user_id = ?)
      ORDER BY COALESCE(ownership_pct, 0) DESC, COALESCE(shares, 0) DESC LIMIT 12
    `).bind(projectId, userId).all<HolderRow>().catch(() => ({ results: [] as HolderRow[] })),
    DB.prepare(`
      SELECT interviewee_name, interviewee_role, notes, pains_json, hypotheses_json,
             COALESCE(featured, 0) AS featured
      FROM discovery_interviews WHERE project_id = ?
      ORDER BY COALESCE(featured, 0) DESC, id DESC LIMIT 6
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

  // Task #18 — founder-curated quotes. The SQL above already orders
  // featured rows first; when at least one interview is starred we keep
  // only those (capped at 3), otherwise we fall back to the recency-based
  // top 3 just like before. Empty-takeaway / unnamed rows are still
  // filtered out so blank stars don't push real signal off the slide.
  const candidateQuotes = interviewsList
    .map((it) => ({
      name: orDash(it.interviewee_name),
      role: it.interviewee_role || '',
      takeaway: interviewTakeaway(it),
      featured: Number(it.featured ?? 0) === 1,
    }))
    .filter((it) => it.takeaway && it.name !== DASH);
  const starred = candidateQuotes.filter((q) => q.featured);
  const interviewQuotes = (starred.length > 0 ? starred : candidateQuotes)
    .slice(0, 3)
    .map(({ name, role, takeaway }) => ({ name, role, takeaway }));

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
  // Spec requires ownership % to be derived from `shares` when an
  // explicit `ownership_pct` is missing — the base schema (migration
  // 020) makes `ownership_pct` optional but always carries `shares`.
  // We compute a total shares sum across the whole pulled set and use
  // it as the denominator so derived pcts agree with what the cap-
  // table UI shows. Explicit `ownership_pct` always wins; derivation
  // is the fallback.
  const totalShares = holdersList.reduce(
    (s, h) => s + (isFinite(Number(h.shares)) ? Math.max(0, Number(h.shares)) : 0),
    0,
  );
  const effectivePct = (h: HolderRow): number | null => {
    if (h.ownership_pct != null && isFinite(Number(h.ownership_pct))) {
      return Number(h.ownership_pct);
    }
    const sh = Number(h.shares);
    if (totalShares > 0 && isFinite(sh) && sh > 0) {
      return (sh / totalShares) * 100;
    }
    return null;
  };
  const holdersWithPct = holdersList.map((h) => ({ row: h, pct: effectivePct(h) }));

  // "Founder" rows = explicit kind=founder OR common-stock holders OR
  // anyone holding ≥5% who isn't tagged as an investor/ESOP.
  const founders = holdersWithPct
    .filter(({ row, pct }) => {
      const k = (row.kind || '').toLowerCase();
      if (k === 'investor' || k === 'esop') return false;
      const st = (row.security_type || '').toLowerCase();
      return k === 'founder' || st.includes('common') || (pct ?? 0) >= 5;
    })
    .slice(0, 4)
    .map(({ row, pct }) => ({
      name: orDash(row.name),
      role: pct != null
        ? `Founder · ${Math.round(pct * 10) / 10}%`
        : 'Founder',
      bio: undefined as string | undefined,
    }))
    .filter((f) => f.name !== DASH);

  const allHolders = holdersWithPct
    .filter(({ row, pct }) => row.name && (pct ?? 0) > 0)
    .slice(0, 10)
    .map(({ row, pct }) => ({
      name: orDash(row.name),
      role: (row.security_type || '').trim() || DASH,
      ownership_pct: pct != null ? `${Math.round(pct * 10) / 10}%` : DASH,
      kind: (row.kind || '').trim() || DASH,
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
 * carries a small set of *typed* flat fields the editor can render as
 * real text inputs / bullet lists / metric grids — no more raw JSON
 * blobs in the author surface.
 *
 * Field-key map mirrors the adapter's `hydrate()` in
 * `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`.
 * Complex object arrays (validation quotes, team founders, cap-table
 * holders, axal-signal lab weeks) still ride as one JSON-encoded
 * paragraph with a `_json` suffix — these are populated by Lab data
 * and aren't meant to be hand-edited from the deck builder.
 */
export function buildAxalSpinoutDemoDaySlides(data: SpinoutDemoDayData): Array<Record<string, unknown>> {
  const MAX_BYTES = 3900;
  const trimDeep = (val: unknown): unknown => {
    if (typeof val === 'string') {
      return val.length > 400 ? val.slice(0, 397) + '…' : val;
    }
    if (Array.isArray(val)) return val.slice(0, 8).map(trimDeep);
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) out[k] = trimDeep(v);
      return out;
    }
    return val;
  };
  const encJson = (obj: unknown): string => {
    const first = JSON.stringify(obj);
    if (first.length <= MAX_BYTES) return first;
    const second = JSON.stringify(trimDeep(obj));
    if (second.length <= MAX_BYTES) return second;
    return JSON.stringify(Array.isArray(obj) ? [] : {});
  };

  // trimDeep/encJson retained for the (rare) oversize defense — every
  // emitted field is hard-capped at MAX_BYTES so a runaway Lab payload
  // can't poison the slide write.
  void trimDeep; void encJson;
  const capStr = (s: string): string =>
    s.length > MAX_BYTES ? s.slice(0, MAX_BYTES - 1) + '…' : s;
  const para = (key: string, value: string) => ({ kind: 'paragraph', key, value: capStr(String(value ?? '')) });
  const bullets = (key: string, value: string[]) => ({ kind: 'bullets', key, value: (value || []).map((x) => capStr(String(x ?? ''))) });
  const metrics = (key: string, value: Array<{ label: string; value: string; sub?: string }>) =>
    ({ kind: 'metric_grid', key, value });

  const m = data.meta;
  const c = data.cover;
  const p = data.problem;
  const v = data.validation;
  const mk = data.market;
  const s = data.solution;
  const r = data.roadmap;
  const b = data.brand;
  const vr = data.venture_readiness;
  const t = data.team;
  const mn = data.mentor_network;
  const ct = data.cap_table;
  const ask = data.ask;
  const as = data.axal_signal;
  const ctc = data.contact;

  // Pads variable-length arrays to a fixed slot count so every Axal
  // deck — sample or hydrated — surfaces the same set of editable
  // fields. Slot count picked to match the spec rendering: up to 3
  // discovery quotes, 4 founders, 4 lab weeks.
  const padTo3 = <T,>(a: T[], empty: T): [T, T, T] => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty];
  const padTo4 = <T,>(a: T[], empty: T): [T, T, T, T] =>
    [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty];

  const emptyQuote = { name: '', role: '', takeaway: '' };
  const emptyFounder = { name: '', role: '', bio: '' };
  const emptyWeek: SpinoutDemoDayData['axal_signal']['lab_weeks'][number] = {
    week: 0, title: '', caption: '', status: 'upcoming', milestones: [],
  };

  const [q1, q2, q3] = padTo3(v.quotes, emptyQuote);
  const [f1, f2, f3, f4] = padTo4(t.founders, emptyFounder);
  const [w1, w2, w3, w4] = padTo4(as.lab_weeks, emptyWeek);

  // Encode milestones as "[x] Label" / "[ ] Label" so they round-trip
  // through a plain bullets field. The `key` field on each milestone
  // is regenerated from the label slug on the hydrate side — keys
  // exist only to give React a stable list id, never user-facing.
  const milestonesAsBullets = (
    ms: SpinoutDemoDayData['axal_signal']['lab_weeks'][number]['milestones'],
  ): string[] => (ms || []).map((x) => `${x.done ? '[x]' : '[ ]'} ${x.label}`);

  // Cap-table holders flatten to one metric_grid row per holder:
  // label = name, value = ownership_pct, sub = "security · kind".
  // The `kind` field carries one of: founder | investor | esop | ''.
  const holdersAsGrid = (hs: SpinoutDemoDayData['cap_table']['holders']) =>
    (hs || []).map((h) => ({
      label: h.name,
      value: h.ownership_pct,
      sub: [h.role, h.kind].filter((x) => x && x !== DASH).join(' · '),
    }));

  // Use-of-funds round-trips through metric_grid: value is "45%"
  // (already string-formatted) and adapter strips the trailing % on read.
  const useOfFundsGrid = ask.use_of_funds.map((u) => ({ label: u.label, value: `${u.pct}%` }));

  const SLIDES: Array<{ spec_id: string; title: string; fields: Array<Record<string, unknown>> }> = [
    {
      spec_id: 'cover', title: 'Cover',
      fields: [
        para('cover_eyebrow', c.eyebrow),
        para('cover_headline', c.headline),
        para('cover_sub', c.sub),
        para('cover_location', c.location),
        // Deck-wide envelope (project name, founder, week) flattened
        // onto slide 0 so the editor surfaces every value as a real
        // input — never a JSON blob.
        para('meta_project_name', m.project_name),
        para('meta_sector', m.sector),
        para('meta_founder_name', m.founder_name),
        para('meta_contact_email', m.contact_email),
        para('meta_presented_on', m.presented_on),
        para('meta_week', String(m.week)),
        para('meta_days_remaining', String(m.days_remaining)),
        para('meta_lab_active', m.lab_active ? 'true' : 'false'),
        para('meta_is_sample', m.is_sample ? 'true' : 'false'),
      ],
    },
    {
      spec_id: 'problem', title: 'Problem',
      fields: [
        para('problem_eyebrow', p.eyebrow),
        para('problem_headline', p.headline),
        para('problem_body', p.body),
        bullets('problem_signals', p.signals),
      ],
    },
    {
      spec_id: 'validation', title: 'Validation',
      fields: [
        para('validation_eyebrow', v.eyebrow),
        para('validation_headline', v.headline),
        para('validation_body', v.body),
        metrics('validation_metrics', v.metrics),
        para('validation_quote1_name', q1.name),
        para('validation_quote1_role', q1.role),
        para('validation_quote1_takeaway', q1.takeaway),
        para('validation_quote2_name', q2.name),
        para('validation_quote2_role', q2.role),
        para('validation_quote2_takeaway', q2.takeaway),
        para('validation_quote3_name', q3.name),
        para('validation_quote3_role', q3.role),
        para('validation_quote3_takeaway', q3.takeaway),
      ],
    },
    {
      spec_id: 'market', title: 'Market',
      fields: [
        para('market_eyebrow', mk.eyebrow),
        para('market_headline', mk.headline),
        para('market_tam', mk.tam),
        para('market_sam', mk.sam),
        para('market_som', mk.som),
        bullets('market_why_now', mk.why_now),
      ],
    },
    {
      spec_id: 'solution', title: 'Solution',
      fields: [
        para('solution_eyebrow', s.eyebrow),
        para('solution_headline', s.headline),
        para('solution_body', s.body),
        bullets('solution_capabilities', s.capabilities),
      ],
    },
    {
      spec_id: 'roadmap', title: 'Roadmap',
      fields: [
        para('roadmap_eyebrow', r.eyebrow),
        para('roadmap_headline', r.headline),
        para('roadmap_quarter', r.quarter),
        bullets('roadmap_now', r.now),
        bullets('roadmap_next', r.next),
        bullets('roadmap_later', r.later),
      ],
    },
    {
      spec_id: 'brand', title: 'Brand',
      fields: [
        para('brand_eyebrow', b.eyebrow),
        para('brand_headline', b.headline),
        para('brand_tagline', b.tagline),
        para('brand_vision', b.vision),
        para('brand_kit_ready', b.brand_kit_ready ? 'true' : 'false'),
        para('brand_pitch_deck_ready', b.pitch_deck_ready ? 'true' : 'false'),
        para('brand_incorporated', b.incorporated ? 'true' : 'false'),
      ],
    },
    {
      spec_id: 'venture_readiness', title: 'Venture readiness',
      fields: [
        para('vr_eyebrow', vr.eyebrow),
        para('vr_headline', vr.headline),
        para('vr_total_score', vr.total_score),
        para('vr_tier', vr.tier),
        para('vr_sandbox', vr.is_sandbox ? 'true' : 'false'),
        metrics('vr_breakdown', vr.breakdown.map((x) => ({ label: x.label, value: x.value }))),
        para('vr_ai_notes', vr.ai_notes),
      ],
    },
    {
      spec_id: 'team', title: 'Team',
      fields: [
        para('team_eyebrow', t.eyebrow),
        para('team_headline', t.headline),
        para('team_intro', t.team_intro),
        para('team_founder1_name', f1.name),
        para('team_founder1_role', f1.role),
        para('team_founder1_bio', f1.bio ?? ''),
        para('team_founder2_name', f2.name),
        para('team_founder2_role', f2.role),
        para('team_founder2_bio', f2.bio ?? ''),
        para('team_founder3_name', f3.name),
        para('team_founder3_role', f3.role),
        para('team_founder3_bio', f3.bio ?? ''),
        para('team_founder4_name', f4.name),
        para('team_founder4_role', f4.role),
        para('team_founder4_bio', f4.bio ?? ''),
      ],
    },
    {
      spec_id: 'mentor_network', title: 'Mentors & network',
      fields: [
        para('mn_eyebrow', mn.eyebrow),
        para('mn_headline', mn.headline),
        para('mn_body', mn.body),
        bullets('mn_mentors', mn.mentors),
        bullets('mn_network_signals', mn.network_signals),
      ],
    },
    {
      spec_id: 'cap_table', title: 'Cap table',
      fields: [
        para('ct_eyebrow', ct.eyebrow),
        para('ct_headline', ct.headline),
        para('ct_note', ct.note),
        metrics('ct_holders', holdersAsGrid(ct.holders)),
      ],
    },
    {
      spec_id: 'ask', title: 'Ask',
      fields: [
        para('ask_eyebrow', ask.eyebrow),
        para('ask_headline', ask.headline),
        para('ask_raise_amount', ask.raise_amount),
        para('ask_runway', ask.runway),
        metrics('ask_use_of_funds', useOfFundsGrid),
        bullets('ask_next_milestones', ask.next_milestones.filter((x) => x && x !== DASH)),
      ],
    },
    {
      spec_id: 'axal_signal', title: 'Axal signal',
      fields: [
        para('as_eyebrow', as.eyebrow),
        para('as_headline', as.headline),
        para('as_body', as.body),
        para('as_week1_title', w1.title),
        para('as_week1_caption', w1.caption),
        para('as_week1_status', w1.status),
        bullets('as_week1_milestones', milestonesAsBullets(w1.milestones)),
        para('as_week2_title', w2.title),
        para('as_week2_caption', w2.caption),
        para('as_week2_status', w2.status),
        bullets('as_week2_milestones', milestonesAsBullets(w2.milestones)),
        para('as_week3_title', w3.title),
        para('as_week3_caption', w3.caption),
        para('as_week3_status', w3.status),
        bullets('as_week3_milestones', milestonesAsBullets(w3.milestones)),
        para('as_week4_title', w4.title),
        para('as_week4_caption', w4.caption),
        para('as_week4_status', w4.status),
        bullets('as_week4_milestones', milestonesAsBullets(w4.milestones)),
      ],
    },
    {
      spec_id: 'contact', title: 'Contact',
      fields: [
        para('contact_eyebrow', ctc.eyebrow),
        para('contact_headline', ctc.headline),
        para('contact_body', ctc.body),
        para('contact_email', ctc.contact_email),
        para('contact_signoff', ctc.signoff),
      ],
    },
  ];

  return SLIDES.map((sl) => ({
    title: sl.title,
    subtitle: null,
    spec_id: sl.spec_id,
    appendix: false,
    method_id: 'axal_spinout_demoday',
    fields: sl.fields,
    body: '',
    bullets: [],
    image_url: null,
  }));
}

/**
 * Task #8 — per-slide coverage map for the "Fill from project" grid in
 * PitchDeckPage. 14 cells in the canonical slide order; each cell
 * records (a) the source table(s) it reads, (b) whether the slide will
 * populate vs. needs founder input, and (c) a short count_label the UI
 * shows as a badge ("3/5 interviews", "0 holders", "score: ✓").
 *
 * Derived entirely from the SpinoutDemoDayData object so we don't need
 * to re-query D1. `data.meta.is_sample === true` is treated as fully
 * uncovered (no slide gets a green dot) — keeps the grid honest when
 * the deck is being previewed before any real Lab data exists.
 */
export type AxalSpinoutCoverageCell = {
  spec_id: string;
  title: string;
  source: string;
  has: boolean;
  count_label: string;
};
export function buildAxalSpinoutCoverage(data: SpinoutDemoDayData): AxalSpinoutCoverageCell[] {
  const isReal = !data.meta.is_sample;
  const notDash = (v: string | null | undefined): boolean =>
    !!v && String(v).trim() !== '' && String(v).trim() !== DASH;
  const intOr0 = (v: string | null | undefined): number => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return isFinite(n) ? n : 0;
  };

  // ── validation: pull interview / pain counts back out of metrics ──
  const interviewN = intOr0(data.validation.metrics?.[0]?.value);
  const painsN = intOr0(data.validation.metrics?.[1]?.value);
  const hypN = intOr0(data.validation.metrics?.[2]?.value);

  // ── roadmap: total OKR objectives bucketed into now/next/later ─
  const okrTotal =
    (data.roadmap.now?.length || 0) +
    (data.roadmap.next?.length || 0) +
    (data.roadmap.later?.length || 0);

  // ── ask: use_of_funds line + raise/runway ──
  const usePcts = data.ask.use_of_funds || [];
  const hasRaise = notDash(data.ask.raise_amount);
  const hasRunway = notDash(data.ask.runway);

  // ── axal_signal: count completed milestones across the 4 weeks ──
  const totalMilestones = data.axal_signal.lab_weeks.reduce(
    (s, w) => s + (w.milestones?.length || 0), 0);
  const doneMilestones = data.axal_signal.lab_weeks.reduce(
    (s, w) => s + (w.milestones?.filter((m) => m.done).length || 0), 0);

  // ── market: count of TAM/SAM/SOM cells that are non-DASH ──
  const marketFilled =
    (notDash(data.market.tam) ? 1 : 0) +
    (notDash(data.market.sam) ? 1 : 0) +
    (notDash(data.market.som) ? 1 : 0);

  // ── brand: count of brand_kit / pitch_deck / incorporated checks ──
  const brandFilled =
    (data.brand.brand_kit_ready ? 1 : 0) +
    (data.brand.pitch_deck_ready ? 1 : 0) +
    (data.brand.incorporated ? 1 : 0);

  const cells: AxalSpinoutCoverageCell[] = [
    {
      spec_id: 'cover', title: 'Cover',
      source: 'projects.name + projects.tagline',
      has: isReal && notDash(data.meta.project_name),
      count_label: notDash(data.meta.project_name) ? `${data.meta.project_name}` : 'project: —',
    },
    {
      spec_id: 'problem', title: 'Problem',
      source: 'projects.problem_statement',
      has: isReal && notDash(data.problem.body),
      count_label: notDash(data.problem.body) ? 'problem: ✓' : 'problem: —',
    },
    {
      spec_id: 'validation', title: 'Validation',
      source: 'discovery_interviews.pains_json',
      has: isReal && interviewN > 0,
      count_label: `${interviewN}/5 interviews · ${painsN} pains · ${hypN} hypotheses`,
    },
    {
      spec_id: 'market', title: 'Market',
      source: 'projects.tam/sam/som',
      has: isReal && marketFilled > 0,
      count_label: `${marketFilled}/3 sized`,
    },
    {
      spec_id: 'solution', title: 'Solution',
      source: 'projects.solution',
      has: isReal && notDash(data.solution.body),
      count_label: notDash(data.solution.body)
        ? `${(data.solution.capabilities || []).length} capabilities`
        : 'solution: —',
    },
    {
      spec_id: 'roadmap', title: 'Roadmap',
      source: 'roadmap_okrs',
      has: isReal && okrTotal > 0,
      count_label: `${okrTotal} OKRs (${data.roadmap.now?.length || 0} now)`,
    },
    {
      spec_id: 'brand', title: 'Brand',
      source: 'projects.tagline + spinout_lab_milestones',
      has: isReal && (notDash(data.brand.tagline) || brandFilled > 0),
      count_label: `${brandFilled}/3 stand-up checks`,
    },
    {
      spec_id: 'venture_readiness', title: 'Venture readiness',
      source: 'score_snapshots',
      has: isReal && notDash(data.venture_readiness.tier),
      count_label: notDash(data.venture_readiness.tier)
        ? `score: ${data.venture_readiness.total_score} (${data.venture_readiness.tier})`
        : 'score: —',
    },
    {
      spec_id: 'team', title: 'Team',
      source: 'cap_table_holders + advisor_answers',
      has: isReal && (data.team.founders?.length || 0) > 0,
      count_label: `${data.team.founders?.length || 0} founders`,
    },
    {
      spec_id: 'mentor_network', title: 'Mentors & network',
      source: 'advisor_answers',
      has: isReal && (notDash(data.mentor_network.body) || (data.mentor_network.mentors?.length || 0) > 0),
      count_label: `${data.mentor_network.mentors?.length || 0} mentors`,
    },
    {
      spec_id: 'cap_table', title: 'Cap table',
      source: 'cap_table_holders',
      has: isReal && (data.cap_table.holders?.length || 0) > 0,
      count_label: `${data.cap_table.holders?.length || 0} holders`,
    },
    {
      spec_id: 'ask', title: 'Ask',
      source: 'projects.funding_needed + financial_models.inputs_json',
      has: isReal && (hasRaise || hasRunway || usePcts.length > 0),
      count_label: [
        hasRaise ? `raise ${data.ask.raise_amount}` : 'raise: —',
        hasRunway ? `${data.ask.runway} runway` : 'runway: —',
        `${usePcts.length} use-of-funds`,
      ].join(' · '),
    },
    {
      spec_id: 'axal_signal', title: 'Axal signal',
      source: 'spinout_lab_milestones',
      has: isReal && doneMilestones > 0,
      count_label: `${doneMilestones}/${totalMilestones} Lab milestones`,
    },
    {
      spec_id: 'contact', title: 'Contact',
      source: 'projects.contact_email',
      has: isReal && notDash(data.contact.contact_email),
      count_label: notDash(data.contact.contact_email) ? 'email: ✓' : 'email: —',
    },
  ];
  return cells;
}
