/**
 * Competitor Analysis orchestration.
 *
 * Pipeline (all Cloudflare-native, no paid third-party APIs):
 *   1. Seed candidates from known competitors + startup context.
 *   2. Expand candidates with Workers AI (keyword/category reasoning).
 *   3. Optionally crawl each candidate's public site via the in-house
 *      webFetch pipeline (depth-gated) to gather real signal text.
 *   4. Heuristic relevance scoring (industry / ICP / geo / problem / signal).
 *   5. Workers AI synthesis of the structured, editable report.
 *
 * Every AI step has a deterministic fallback so the feature always returns a
 * usable result even when the model chain refuses or times out.
 */
import type { Env } from '../types';
import { run as aiRun } from './aiRouter';
import { fetchPage, pagesForDomain, normalizeUrl, type FetchedPage } from './webFetch';

export interface AnalysisInputs {
  market: string;
  target_customer?: string;
  geography?: string;
  known_competitors?: string;
  problem?: string;
  region_focus?: string;
  depth?: 'quick' | 'deep';
  nudge?: string;
}

export interface CandidateSubScores {
  industry: number;
  icp: number;
  geo: number;
  problem: number;
  signal: number;
}

export interface Candidate {
  id: string;
  name: string;
  domain: string | null;
  url: string | null;
  category: 'direct' | 'adjacent';
  relevance_score: number;
  scores: CandidateSubScores;
  summary: string;
  details: {
    features?: string[];
    pricing?: string[];
    positioning?: string;
    traction?: string;
  };
  origin: 'known' | 'discovered' | 'manual';
  position: number;
}

export interface SourceRecord {
  id: string;
  candidate_id: string | null;
  url: string;
  kind: string;
  title: string;
  status: number;
  fetched_at: string;
}

export interface SignalRecord {
  id: string;
  candidate_id: string | null;
  signal_type: string;
  label: string;
  detail: string;
}

export interface AnalysisOutput {
  market_summary: string;
  direct_competitors: string[];
  adjacent_competitors: string[];
  feature_comparison: { features: string[]; rows: Array<{ competitor: string; values: string[] }> };
  pricing_signals: Array<{ competitor: string; signal: string }>;
  positioning: Array<{ competitor: string; messaging: string }>;
  traction_signals: Array<{ competitor: string; signal: string }>;
  activity_signals: Array<{ competitor: string; kind: string; detail: string }>;
  gaps: string[];
  wedge: string;
  next_actions: string[];
  notes: string;
}

export interface AnalysisResult {
  candidates: Candidate[];
  sources: SourceRecord[];
  signals: SignalRecord[];
  output: AnalysisOutput;
}

const MAX_CANDIDATES = 10;
const MAX_CRAWL_CANDIDATES = 6;

function uid(): string {
  return crypto.randomUUID();
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Extract the first balanced JSON object/array from an LLM response. */
function parseJsonLoose<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip markdown code fences.
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function runJson<T>(
  env: Env,
  userId: number,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<T | null> {
  try {
    const res = await aiRun(env, {
      task: 'dd_synthesis',
      userId,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens,
      temperature: 0.4,
    });
    if (!res.ok || !res.output) return null;
    return parseJsonLoose<T>(res.output);
  } catch {
    return null;
  }
}

function splitList(s?: string): string[] {
  if (!s) return [];
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function guessDomain(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|technologies|labs|software|app)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return slug ? `${slug}.com` : null;
}

function keywordScore(haystack: string, needles: string[]): number {
  if (!needles.length) return 40;
  const hay = haystack.toLowerCase();
  let hit = 0;
  for (const n of needles) {
    const words = n.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (words.some((w) => hay.includes(w))) hit++;
  }
  return clamp((hit / needles.length) * 100);
}

/** Deterministic heuristic sub-scores from the candidate blurb vs. the inputs. */
function scoreCandidate(cand: { name: string; summary: string; category: string }, inputs: AnalysisInputs, hasSignals: boolean): CandidateSubScores {
  const blob = `${cand.name} ${cand.summary}`;
  const industry = keywordScore(blob, splitList(inputs.market));
  const icp = keywordScore(blob, splitList(inputs.target_customer));
  const geo = inputs.geography ? keywordScore(blob, splitList(inputs.geography)) : 55;
  const problem = keywordScore(blob, splitList(inputs.problem));
  const base = cand.category === 'direct' ? 20 : 0;
  return {
    industry: clamp(industry + base),
    icp: clamp(icp + base * 0.5),
    geo,
    problem: clamp(problem + base),
    signal: hasSignals ? 75 : 35,
  };
}

function weightedRelevance(s: CandidateSubScores): number {
  return clamp(s.industry * 0.3 + s.problem * 0.25 + s.icp * 0.2 + s.geo * 0.1 + s.signal * 0.15);
}

interface RawCandidate {
  name: string;
  domain?: string;
  category?: string;
  why?: string;
}

async function discoverCandidates(env: Env, userId: number, inputs: AnalysisInputs): Promise<RawCandidate[]> {
  const known = splitList(inputs.known_competitors).map((name) => ({ name, category: 'direct', why: 'Named by the founder as a known competitor.' }));
  const system =
    'You are a startup competitive-intelligence analyst. Given a market, ICP, geography and problem, list the most relevant real companies competing in or adjacent to this space. Respond ONLY with a JSON array. Each item: {"name": string, "domain": string (best-guess primary domain, no protocol), "category": "direct" | "adjacent", "why": short reason}. Return at most 10 items. Do not invent obviously fake companies.';
  const user = [
    `Market / industry: ${inputs.market}`,
    inputs.target_customer ? `Target customer / ICP: ${inputs.target_customer}` : '',
    inputs.geography ? `Geography: ${inputs.geography}` : '',
    inputs.region_focus ? `Region focus: ${inputs.region_focus}` : '',
    inputs.problem ? `Problem being solved: ${inputs.problem}` : '',
    inputs.known_competitors ? `Already-known competitors (include + expand beyond these): ${inputs.known_competitors}` : '',
    inputs.nudge ? `Analyst nudge: ${inputs.nudge}` : '',
    '',
    'Return the JSON array now.',
  ]
    .filter(Boolean)
    .join('\n');

  const ai = (await runJson<RawCandidate[]>(env, userId, system, user, 900)) || [];
  const merged: RawCandidate[] = [...known];
  const seen = new Set(known.map((k) => k.name.toLowerCase()));
  for (const c of Array.isArray(ai) ? ai : []) {
    if (!c || typeof c.name !== 'string') continue;
    const key = c.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      name: c.name.trim(),
      domain: typeof c.domain === 'string' ? c.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim() : undefined,
      category: c.category === 'adjacent' ? 'adjacent' : 'direct',
      why: typeof c.why === 'string' ? c.why : '',
    });
    if (merged.length >= MAX_CANDIDATES) break;
  }
  return merged.slice(0, MAX_CANDIDATES);
}

/** Crawl a candidate's public pages and fold the findings into the candidate. */
async function enrichWithCrawl(
  env: Env,
  userId: number,
  analysisId: string,
  cand: Candidate,
  depth: 'quick' | 'deep',
  sources: SourceRecord[],
  signals: SignalRecord[],
): Promise<void> {
  const homepage = cand.url || (cand.domain ? `https://${cand.domain}` : null);
  if (!homepage) return;
  const targets = pagesForDomain(homepage, depth).slice(0, depth === 'deep' ? 8 : 5);
  const collectedText: string[] = [];
  const features = new Set<string>();
  const pricing = new Set<string>();
  let fetchedAny = false;

  for (const url of targets) {
    const page: FetchedPage = await fetchPage(env, url, { userId });
    // Record every source we ATTEMPTED for provenance, but only keep signal
    // from pages that actually returned content.
    if (page.ok && (page.text || page.title)) {
      fetchedAny = true;
      sources.push({
        id: uid(),
        candidate_id: cand.id,
        url: page.url,
        kind: classifyPage(page.url),
        title: page.title || cand.name,
        status: page.status,
        fetched_at: page.fetched_at,
      });
      collectedText.push(`# ${page.title}\n${page.description}\n${page.text}`.slice(0, 4000));
      for (const h of page.headings.slice(0, 8)) features.add(h);
      for (const p of page.pricingHints) pricing.add(p);
      if (/pric|plan/i.test(page.url) && page.pricingHints.length) {
        signals.push({ id: uid(), candidate_id: cand.id, signal_type: 'pricing', label: 'Public pricing', detail: page.pricingHints.slice(0, 4).join(', ') });
      }
      if (/career|job/i.test(page.url)) {
        signals.push({ id: uid(), candidate_id: cand.id, signal_type: 'hiring', label: 'Careers page live', detail: page.title || page.url });
      }
      if (/blog|news|press/i.test(page.url)) {
        signals.push({ id: uid(), candidate_id: cand.id, signal_type: 'content', label: 'Active content/press', detail: page.headings[0] || page.title || page.url });
      }
    }
  }

  if (fetchedAny) {
    cand.details.features = [...features].slice(0, 8);
    cand.details.pricing = [...pricing].slice(0, 6);
    // Ask the model to distill positioning from the crawled text (cheap, optional).
    const positioning = await distillPositioning(env, userId, cand.name, collectedText.join('\n\n'));
    if (positioning) cand.details.positioning = positioning;
    cand.scores.signal = 78;
    cand.relevance_score = weightedRelevance(cand.scores);
    signals.push({ id: uid(), candidate_id: cand.id, signal_type: 'web', label: 'Public site crawled', detail: `${sources.filter((s) => s.candidate_id === cand.id).length} page(s) captured` });
  }
}

function classifyPage(url: string): string {
  const p = url.toLowerCase();
  if (/pric|plan/.test(p)) return 'pricing';
  if (/feature|product/.test(p)) return 'features';
  if (/about|team/.test(p)) return 'about';
  if (/blog|news|press/.test(p)) return 'news';
  if (/career|job/.test(p)) return 'careers';
  return 'homepage';
}

async function distillPositioning(env: Env, userId: number, name: string, text: string): Promise<string> {
  if (!text.trim()) return '';
  const res = await runJson<{ positioning: string }>(
    env,
    userId,
    'You extract a company\'s positioning/messaging from its website text. Respond ONLY as JSON: {"positioning": string (1-2 sentences, concrete)}.',
    `Company: ${name}\n\nWebsite text:\n${text.slice(0, 6000)}`,
    220,
  );
  return res?.positioning?.slice(0, 400) || '';
}

async function synthesize(env: Env, userId: number, inputs: AnalysisInputs, candidates: Candidate[]): Promise<AnalysisOutput> {
  const compactCands = candidates.map((c) => ({
    name: c.name,
    category: c.category,
    summary: c.summary,
    features: c.details.features || [],
    pricing: c.details.pricing || [],
    positioning: c.details.positioning || '',
  }));
  const system =
    'You are a seed-stage VC analyst. Given the market context and a list of competitors (some enriched with real website data), produce a competitive-landscape report. Respond ONLY with JSON matching this exact shape: ' +
    '{"market_summary": string, "direct_competitors": string[], "adjacent_competitors": string[], "feature_comparison": {"features": string[], "rows": [{"competitor": string, "values": string[]}]}, "pricing_signals": [{"competitor": string, "signal": string}], "positioning": [{"competitor": string, "messaging": string}], "traction_signals": [{"competitor": string, "signal": string}], "gaps": string[], "wedge": string, "next_actions": string[]}. ' +
    'Be specific and blunt. feature_comparison.rows[i].values must align 1:1 with feature_comparison.features. Keep arrays under 8 items.';
  const user = [
    `Market: ${inputs.market}`,
    inputs.target_customer ? `ICP: ${inputs.target_customer}` : '',
    inputs.geography ? `Geography: ${inputs.geography}` : '',
    inputs.problem ? `Problem: ${inputs.problem}` : '',
    inputs.nudge ? `Nudge: ${inputs.nudge}` : '',
    '',
    `Competitors JSON:\n${JSON.stringify(compactCands)}`,
    '',
    'Return the report JSON now.',
  ]
    .filter(Boolean)
    .join('\n');

  const ai = await runJson<Partial<AnalysisOutput>>(env, userId, system, user, 1600);
  return normalizeOutput(ai, inputs, candidates);
}

function normalizeOutput(ai: Partial<AnalysisOutput> | null, inputs: AnalysisInputs, candidates: Candidate[]): AnalysisOutput {
  const direct = candidates.filter((c) => c.category === 'direct').map((c) => c.name);
  const adjacent = candidates.filter((c) => c.category === 'adjacent').map((c) => c.name);
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 10) : []);
  const out: AnalysisOutput = {
    market_summary:
      typeof ai?.market_summary === 'string' && ai.market_summary.trim()
        ? ai.market_summary.trim()
        : `The ${inputs.market || 'target'} market has ${candidates.length} tracked players${inputs.target_customer ? ` serving ${inputs.target_customer}` : ''}. Competition clusters around ${direct.slice(0, 3).join(', ') || 'a handful of incumbents'}.`,
    direct_competitors: strArr(ai?.direct_competitors).length ? strArr(ai?.direct_competitors) : direct,
    adjacent_competitors: strArr(ai?.adjacent_competitors).length ? strArr(ai?.adjacent_competitors) : adjacent,
    feature_comparison: normalizeFeatureComparison(ai?.feature_comparison, candidates),
    pricing_signals: normalizePairs(ai?.pricing_signals, 'signal', candidates, (c) => (c.details.pricing || []).join(', ')),
    positioning: normalizePairs(ai?.positioning, 'messaging', candidates, (c) => c.details.positioning || ''),
    traction_signals: normalizePairs(ai?.traction_signals, 'signal', candidates, () => ''),
    activity_signals: [],
    gaps: strArr(ai?.gaps).length ? strArr(ai?.gaps) : ['Under-served ICP segment', 'Weak pricing transparency among incumbents', 'Onboarding / time-to-value gap'],
    wedge:
      typeof ai?.wedge === 'string' && ai.wedge.trim()
        ? ai.wedge.trim()
        : `Win a beachhead in ${inputs.target_customer || 'an under-served segment'} with a sharper take on "${inputs.problem || inputs.market}" than the incumbents offer.`,
    next_actions: strArr(ai?.next_actions).length
      ? strArr(ai?.next_actions)
      : ['Interview 5 target customers on their current tool', 'Build a feature-by-feature battlecard for the top 3 direct competitors', 'Pressure-test pricing against the cheapest incumbent'],
    notes: '',
  };
  return out;
}

function normalizeFeatureComparison(fc: AnalysisOutput['feature_comparison'] | undefined, candidates: Candidate[]): AnalysisOutput['feature_comparison'] {
  if (fc && Array.isArray(fc.features) && Array.isArray(fc.rows) && fc.features.length) {
    const features = fc.features.map((f) => String(f)).slice(0, 8);
    const rows = fc.rows
      .filter((r) => r && typeof r.competitor === 'string')
      .map((r) => ({
        competitor: String(r.competitor),
        values: features.map((_, i) => String((r.values || [])[i] ?? '—')),
      }))
      .slice(0, 12);
    return { features, rows };
  }
  // Deterministic fallback from crawled features.
  const features = ['Category', 'Public pricing', 'Notable capability'];
  const rows = candidates.slice(0, 8).map((c) => ({
    competitor: c.name,
    values: [c.category, (c.details.pricing || []).length ? 'Yes' : 'Unknown', (c.details.features || [])[0] || c.summary.slice(0, 60) || '—'],
  }));
  return { features, rows };
}

function normalizePairs<K extends string>(
  arr: unknown,
  key: K,
  candidates: Candidate[],
  fallback: (c: Candidate) => string,
): Array<{ competitor: string } & Record<K, string>> {
  if (Array.isArray(arr) && arr.length) {
    return arr
      .filter((x) => x && typeof (x as Record<string, unknown>).competitor === 'string')
      .map((x) => {
        const o = x as Record<string, unknown>;
        return { competitor: String(o.competitor), [key]: String(o[key] ?? '') } as { competitor: string } & Record<K, string>;
      })
      .slice(0, 12);
  }
  return candidates
    .map((c) => ({ competitor: c.name, [key]: fallback(c) } as { competitor: string } & Record<K, string>))
    .filter((x) => (x as Record<string, string>)[key])
    .slice(0, 12);
}

/**
 * Run the full pipeline for a set of inputs.
 */
export async function runCompetitorAnalysis(env: Env, userId: number, analysisId: string, inputs: AnalysisInputs): Promise<AnalysisResult> {
  const depth: 'quick' | 'deep' = inputs.depth === 'deep' ? 'deep' : 'quick';
  const raw = await discoverCandidates(env, userId, inputs);

  const sources: SourceRecord[] = [];
  const signals: SignalRecord[] = [];

  const candidates: Candidate[] = raw.map((r, i) => {
    const domain = r.domain || guessDomain(r.name);
    const scores = scoreCandidate({ name: r.name, summary: r.why || '', category: r.category === 'adjacent' ? 'adjacent' : 'direct' }, inputs, false);
    return {
      id: uid(),
      name: r.name,
      domain,
      url: domain ? `https://${domain}` : null,
      category: r.category === 'adjacent' ? 'adjacent' : 'direct',
      relevance_score: weightedRelevance(scores),
      scores,
      summary: r.why || '',
      details: {},
      origin: (r as { origin?: string }).origin === 'manual' ? 'manual' : splitList(inputs.known_competitors).map((k) => k.toLowerCase()).includes(r.name.toLowerCase()) ? 'known' : 'discovered',
      position: i,
    };
  });

  // Crawl the top candidates (by relevance) that have a domain.
  const crawlTargets = [...candidates].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, MAX_CRAWL_CANDIDATES);
  for (const cand of crawlTargets) {
    await enrichWithCrawl(env, userId, analysisId, cand, depth, sources, signals);
  }

  // Re-sort by (post-crawl) relevance and re-number positions.
  candidates.sort((a, b) => b.relevance_score - a.relevance_score);
  candidates.forEach((c, i) => {
    c.position = i;
  });

  const output = await synthesize(env, userId, inputs, candidates);
  // Fold discovered activity signals into the output for the UI.
  output.activity_signals = signals
    .filter((s) => s.signal_type === 'hiring' || s.signal_type === 'content')
    .map((s) => {
      const c = candidates.find((x) => x.id === s.candidate_id);
      return { competitor: c?.name || 'Unknown', kind: s.signal_type, detail: s.detail };
    })
    .slice(0, 12);

  return { candidates, sources, signals, output };
}

/** Build a manual candidate row (used by the "add competitor" endpoint). */
export async function buildManualCandidate(
  env: Env,
  userId: number,
  inputs: AnalysisInputs,
  data: { name: string; url?: string; category?: string; summary?: string; crawl?: boolean },
): Promise<{ candidate: Candidate; sources: SourceRecord[]; signals: SignalRecord[] }> {
  const url = data.url ? normalizeUrl(data.url) : null;
  const domain = url ? new URL(url).hostname : guessDomain(data.name);
  const category: 'direct' | 'adjacent' = data.category === 'adjacent' ? 'adjacent' : 'direct';
  const scores = scoreCandidate({ name: data.name, summary: data.summary || '', category }, inputs, false);
  const candidate: Candidate = {
    id: uid(),
    name: data.name,
    domain: domain || null,
    url: url || (domain ? `https://${domain}` : null),
    category,
    relevance_score: weightedRelevance(scores),
    scores,
    summary: data.summary || '',
    details: {},
    origin: 'manual',
    position: 999,
  };
  const sources: SourceRecord[] = [];
  const signals: SignalRecord[] = [];
  if (data.crawl && candidate.url) {
    await enrichWithCrawl(env, userId, 'manual', candidate, inputs.depth === 'deep' ? 'deep' : 'quick', sources, signals);
  }
  return { candidate, sources, signals };
}
