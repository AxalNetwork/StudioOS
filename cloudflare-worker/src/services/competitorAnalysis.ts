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
import { run as aiRun, type RailContext } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { untrustedBlock, withUntrustedRule, withoutUnrecordedLinks } from './ai/untrusted';
import { fetchPage, pagesForDomain, normalizeUrl, type FetchedPage } from './webFetch';
import { hostOf, nameKey } from './competitorDirectoryLink';

/**
 * D778 part 9 (#2103): the fallback for these runs, for a client that sent no
 * rail context. A press's own headers win (`railFor`). The routes are shared
 * (the advisor's Companies board sends its own keys, D773), so the page stays
 * the workspace key `research`, where the member's Manual switch is stored, as
 * part 10's `SHARED_DRAFT_PAGES` keeps it (`routes/research.ts`); the options
 * are the founder inventory's (`frontend/src/lib/railOptions/founder.js`,
 * Founder · Research · Companies). Before part 9 every run logged
 * `scan:competitors`, a key no inventory lists.
 */
export const COMPANIES_PAGE = 'research';
export const COMPANIES_OPTIONS = {
  analyze: 'analyse:competitors',
  again: 'analyse:again',
  sources: 'analyse:sources',
  candidate: 'extract:candidate',
  site: 'extract:site',
} as const;
/** The record a run on one analysis names: the route has scoped it to the member. */
export const analysisRecord = (analysisId: string): string => `competitor_analysis:${analysisId}`;
const fallbackRail = (option: string, analysisId: string): RailContext =>
  ({ page: COMPANIES_PAGE, option, record: analysisRecord(analysisId) });

export interface AnalysisInputs {
  market: string;
  target_customer?: string;
  geography?: string;
  known_competitors?: string;
  problem?: string;
  region_focus?: string;
  depth?: 'quick' | 'deep';
  nudge?: string;
  /**
   * D7175: the directory company the run is about, as it read when the run
   * started. Stored in `inputs_json` beside `competitor_analyses.subject_uid`
   * so a re-run or a refresh, which re-read the stored inputs, keep it out of
   * the candidates too. Absent for a custom market.
   */
  subject?: AnalysisSubject;
}

/** D7175: the subject company of a run: never one of its candidates. */
export interface AnalysisSubject {
  uid: string;
  name: string;
  domain: string | null;
}

/**
 * D7175: one finding of a run, with the fetched sources it rests on.
 * `source_ids` are `competitor_sources.id`s; an empty list is a finding with
 * no source in this run, which the page says in words.
 */
export interface Finding {
  text: string;
  kind: 'fact' | 'interpretation';
  source_ids: string[];
}

/** D7175: what self-match protection kept out of a run's candidates. */
export interface ExcludedCandidate {
  name: string;
  domain: string | null;
  uid: string | null;
  reason: 'subject';
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
  /** D7175: findings with their sources; Interpretation kept apart by `kind`. */
  findings?: Finding[];
  /** D7175: the subject, listed as excluded from the candidates. */
  excluded?: ExcludedCandidate[];
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
  rail: RailContext,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<T | null> {
  try {
    const res = await aiRun(env, {
      task: 'dd_synthesis',
      userId,
      surface: AI_SURFACE.researchCompanies,
      // D765: the press's page; off there, nothing is synthesised. D778 part 9:
      // the pressed option and the analysis it runs on (`railFor` in the route).
      rail,
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

async function discoverCandidates(env: Env, userId: number, inputs: AnalysisInputs, rail: RailContext): Promise<RawCandidate[]> {
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
    // D7175: the subject is who the competitors are competitors OF.
    inputs.subject ? `Subject company (never list it): ${inputs.subject.name}${inputs.subject.domain ? ` (${inputs.subject.domain})` : ''}` : '',
    '',
    'Return the JSON array now.',
  ]
    .filter(Boolean)
    .join('\n');

  const ai = (await runJson<RawCandidate[]>(env, userId, rail, system, user, 900)) || [];
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
  rail: RailContext,
  failed?: SourceRecord[],
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
        kind: sourceKind(page.url),
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
    } else if (failed && failedRead(url === targets[0], page)) {
      failed.push(failedSource(cand.id, url, page));
    }
  }

  if (fetchedAny) {
    cand.details.features = [...features].slice(0, 8);
    cand.details.pricing = [...pricing].slice(0, 6);
    // Ask the model to distill positioning from the crawled text (cheap, optional).
    const positioning = await distillPositioning(env, userId, rail, cand.name, collectedText.join('\n\n'));
    if (positioning) cand.details.positioning = positioning;
    cand.scores.signal = 78;
    cand.relevance_score = weightedRelevance(cand.scores);
    signals.push({ id: uid(), candidate_id: cand.id, signal_type: 'web', label: 'Public site crawled', detail: `${sources.filter((s) => s.candidate_id === cand.id).length} page(s) captured` });
  }
}

/**
 * D7175: which unanswered fetches are failed reads. The homepage always is: it
 * is the company's own site. A guessed path (/pricing, /about) that is not
 * there is not a failure, so only a timeout, a refused connection (0), a rate
 * limit (429) or a server error is recorded for it. `competitor_sources.status`
 * keeps the code, so the page can tell "No candidates" from "Unavailable".
 */
export function failedRead(isHomepage: boolean, page: { ok: boolean; status: number }): boolean {
  // An answered page with nothing in it is not a failed read, and not a source.
  if (page.ok) return false;
  if (isHomepage) return true;
  const n = Number(page.status) || 0;
  return n === 0 || n === 429 || n >= 500;
}

function failedSource(candidateId: string, url: string, page: { status: number; fetched_at?: string }): SourceRecord {
  return {
    id: uid(),
    candidate_id: candidateId,
    url,
    kind: sourceKind(url),
    title: '',
    // A read that failed with a 2xx code (not a page we can read) never counts as fetched.
    status: Number(page.status) >= 200 && Number(page.status) < 400 ? 0 : Number(page.status) || 0,
    fetched_at: page.fetched_at || new Date().toISOString(),
  };
}

/** Kind of one public page, from its URL. A homepage is the fallback, not a guess at the company. */
export function sourceKind(url: string): string {
  const p = url.toLowerCase();
  if (/pric|plan/.test(p)) return 'pricing';
  if (/feature|product/.test(p)) return 'features';
  if (/about|team/.test(p)) return 'about';
  if (/blog|news|press/.test(p)) return 'news';
  if (/career|job/.test(p)) return 'careers';
  return 'homepage';
}

/**
 * Sources and signals for one candidate's own site.
 *
 * `enrichWithCrawl` also writes headings and pricing hints onto `details`,
 * and it recomputes relevance. This page does not: a fetched pricing page is
 * a source, and a price nobody typed stays unrecorded. The score stays the
 * one the scan already stored — a crawl of a page is not a new measurement,
 * and a blank score must not become 0 because a GET happened. The saved
 * fields are written back onto the same object so a caller that persists the
 * candidate afterwards cannot accidentally keep the crawl's edits.
 */
export async function collectCandidateCrawl(
  env: Env,
  userId: number,
  analysisId: string,
  cand: Candidate,
  depth: 'quick' | 'deep',
  rail: RailContext = fallbackRail(COMPANIES_OPTIONS.site, analysisId),
): Promise<{ sources: SourceRecord[]; signals: SignalRecord[] }> {
  const saved = {
    details: {
      ...cand.details,
      features: cand.details.features ? [...cand.details.features] : undefined,
      pricing: cand.details.pricing ? [...cand.details.pricing] : undefined,
    },
    relevance_score: cand.relevance_score,
    scores: { ...cand.scores },
    summary: cand.summary,
  };
  const sources: SourceRecord[] = [];
  const signals: SignalRecord[] = [];
  try {
    await enrichWithCrawl(env, userId, analysisId, cand, depth, sources, signals, rail);
    return { sources, signals };
  } finally {
    cand.details = saved.details;
    cand.relevance_score = saved.relevance_score;
    cand.scores = saved.scores;
    cand.summary = saved.summary;
  }
}

/** D1506: the positioning run's prompt: the crawled pages as one untrusted block. */
export function positioningPrompt(name: string, text: string): { system: string; user: string } {
  return {
    system: withUntrustedRule('You extract a company\'s positioning/messaging from its website text. Respond ONLY as JSON: {"positioning": string (1-2 sentences, concrete)}.'),
    user: `Company: ${name}\n\nWebsite text:\n${untrustedBlock('web_page', text.slice(0, 6000))}`,
  };
}

/** The positioning an answer gives, with links and emails the pages do not hold taken out. */
export function positioningFromModel(res: { positioning?: unknown } | null, text: string): string {
  return typeof res?.positioning === 'string' ? withoutUnrecordedLinks(res.positioning, [text]).slice(0, 400) : '';
}

async function distillPositioning(env: Env, userId: number, rail: RailContext, name: string, text: string): Promise<string> {
  if (!text.trim()) return '';
  // D1506: a crawled page is untrusted data, and a link it does not hold never comes back.
  const p = positioningPrompt(name, text);
  const res = await runJson<{ positioning: string }>(env, userId, rail, p.system, p.user, 220);
  return positioningFromModel(res, text);
}

/** D1506: the landscape run's prompt: the candidates, which carry crawled site text, as one untrusted block. */
export function landscapePrompt(inputs: AnalysisInputs, candidates: Candidate[], sources: SourceRecord[] = []): { system: string; user: string } {
  const compactCands = candidates.map((c) => ({
    name: c.name,
    category: c.category,
    summary: c.summary,
    features: c.details.features || [],
    pricing: c.details.pricing || [],
    positioning: c.details.positioning || '',
  }));
  const system = withUntrustedRule(
    'You are a seed-stage VC analyst. Given the market context and a list of competitors (some enriched with real website data), produce a competitive-landscape report. Respond ONLY with JSON matching this exact shape: ' +
    '{"market_summary": string, "direct_competitors": string[], "adjacent_competitors": string[], "feature_comparison": {"features": string[], "rows": [{"competitor": string, "values": string[]}]}, "pricing_signals": [{"competitor": string, "signal": string}], "positioning": [{"competitor": string, "messaging": string}], "traction_signals": [{"competitor": string, "signal": string}], "gaps": string[], "wedge": string, "next_actions": string[]}. ' +
    'Be specific and blunt. feature_comparison.rows[i].values must align 1:1 with feature_comparison.features. Keep arrays under 8 items. ' +
    // D7175: no finding without a source. The numbers are the Sources list's.
    'Also return "findings": [{"text": string, "kind": "fact" | "interpretation", "sources": number[]}], where each fact cites the numbers of the Sources it was read from; ' +
    'gaps may be given as {"text": string, "sources": number[]} and wedge as {"text": string, "sources": number[]}. Anything no listed source supports goes in next_actions as an open research question, never as a fact.');
  const user = [
    `Market: ${inputs.market}`,
    inputs.target_customer ? `ICP: ${inputs.target_customer}` : '',
    inputs.geography ? `Geography: ${inputs.geography}` : '',
    inputs.problem ? `Problem: ${inputs.problem}` : '',
    inputs.nudge ? `Nudge: ${inputs.nudge}` : '',
    '',
    // D1506: the candidates carry text crawled from their own sites.
    `Competitors JSON:\n${untrustedBlock('web_page', JSON.stringify(compactCands))}`,
    '',
    // D7175: the fetched pages, numbered as findings cite them.
    `Sources:\n${untrustedBlock('web_page', numberedSources(sources, candidates).join('\n') || 'None.')}`,
    '',
    'Return the report JSON now.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

async function synthesize(env: Env, userId: number, inputs: AnalysisInputs, candidates: Candidate[], rail: RailContext, sources: SourceRecord[] = []): Promise<AnalysisOutput> {
  const { system, user } = landscapePrompt(inputs, candidates, sources);
  const ai = await runJson<Partial<AnalysisOutput>>(env, userId, rail, system, user, 1600);
  return normalizeOutput(ai, inputs, candidates, sources);
}

/** D7175: a source the run actually read (its stored status is the HTTP code). */
export function sourceFetched(s: { status?: unknown }): boolean {
  const n = Number(s?.status);
  return Number.isFinite(n) && n >= 200 && n < 400;
}

/** D7175: the fetched sources, numbered from 1 in the order the run read them, as a finding cites them. */
export function numberedSources(sources: SourceRecord[], candidates: Candidate[] = []): string[] {
  const nameOf = new Map(candidates.map((c) => [c.id, c.name]));
  return sources.filter(sourceFetched).map((s, i) =>
    `[${i + 1}] ${(s.candidate_id && nameOf.get(s.candidate_id)) || 'Unattributed'} · ${s.kind} · ${s.url}${s.title ? ` · ${s.title}` : ''}`);
}

/** A question in place of a statement no source in the run supports (the owner's answer A on D7041). */
const asQuestion = (text: string): string => `What source would confirm this: “${text.replace(/[?.]+$/, '')}”?`;

/**
 * D7175: the run's report, with nothing in it that the run did not return.
 *
 * - No fallback gaps, wedge or next actions: an empty answer stays empty.
 * - A finding keeps only citations to sources the run fetched (`source_ids`);
 *   one with none is kept and the page marks it "No source in this run".
 * - A gap or wedge line with no fetched source moves to `next_actions`, which
 *   the page draws as Suggested research questions, apart from the findings.
 * - With 0 fetched sources (Insufficient evidence) the run states no summary,
 *   no gaps, no wedge, no classifications and no findings: every statement
 *   the model wrote becomes a question.
 * - With no candidates, no competitor is named anywhere in the output.
 */
export function normalizeOutput(ai: Partial<AnalysisOutput> | null, inputs: AnalysisInputs, candidates: Candidate[], sources: SourceRecord[] = []): AnalysisOutput {
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
    gaps: [],
    wedge: '',
    next_actions: strArr(ai?.next_actions),
    notes: '',
  };
  return withEvidenceRules(out, ai, candidates, sources);
}

/** D7175: the citation, gap, wedge and Insufficient-evidence rules `normalizeOutput` applies. */
function withEvidenceRules(out: AnalysisOutput, ai: Partial<AnalysisOutput> | null, candidates: Candidate[], sources: SourceRecord[]): AnalysisOutput {
  const fetched = sources.filter(sourceFetched);
  const refs = (v: unknown): string[] => {
    const ids = (Array.isArray(v) ? v : []).map((n) => fetched[Math.trunc(Number(n)) - 1]?.id).filter((x): x is string => !!x);
    return [...new Set(ids)];
  };
  const textOf = (v: unknown): string => (typeof v === 'string' ? v : (v && typeof (v as { text?: unknown }).text === 'string' ? (v as { text: string }).text : '')).trim();
  const questions = [...out.next_actions];
  const ask = (text: string) => { const q = asQuestion(text); if (!questions.includes(q)) questions.push(q); };

  const findings: Finding[] = [];
  for (const f of (Array.isArray((ai as { findings?: unknown })?.findings) ? (ai as { findings: unknown[] }).findings : []).slice(0, 12)) {
    const text = textOf(f);
    if (!text) continue;
    const o = (f && typeof f === 'object' ? f : {}) as { kind?: unknown; sources?: unknown };
    findings.push({ text, kind: o.kind === 'interpretation' ? 'interpretation' : 'fact', source_ids: refs(o.sources) });
  }
  const gaps: string[] = [];
  for (const g of (Array.isArray(ai?.gaps) ? ai.gaps as unknown[] : []).slice(0, 10)) {
    const text = textOf(g);
    if (!text) continue;
    if (refs((g as { sources?: unknown })?.sources).length) gaps.push(text);
    else ask(text);
  }
  const wedgeText = textOf(ai?.wedge);
  let wedge = '';
  if (wedgeText) {
    if (refs((ai?.wedge as unknown as { sources?: unknown } | undefined)?.sources).length) wedge = wedgeText;
    else ask(wedgeText);
  }

  // With no candidates, nobody is named; with no fetched source, nothing is stated.
  const unnamed = { direct_competitors: [], adjacent_competitors: [], pricing_signals: [], positioning: [], traction_signals: [], feature_comparison: { features: [], rows: [] } };
  if (!fetched.length) {
    // Insufficient evidence: a statement with no source is a question.
    for (const f of findings) ask(f.text);
    return { ...out, ...unnamed, market_summary: '', gaps: [], wedge: '', next_actions: questions.slice(0, 12), findings: [] };
  }
  return { ...out, ...(candidates.length ? {} : unnamed), gaps, wedge, next_actions: questions.slice(0, 12), findings };
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
 * Run the full pipeline for a set of inputs. Every model call in it (discovery,
 * each crawl's positioning, the synthesis) logs the one `rail` the press named.
 */
export async function runCompetitorAnalysis(
  env: Env,
  userId: number,
  analysisId: string,
  inputs: AnalysisInputs,
  rail: RailContext = fallbackRail(COMPANIES_OPTIONS.analyze, analysisId),
): Promise<AnalysisResult> {
  const depth: 'quick' | 'deep' = inputs.depth === 'deep' ? 'deep' : 'quick';
  // D7175: self-match protection: the subject is never its own competitor,
  // whether the model found it or it was typed as a known competitor.
  const raw = (await discoverCandidates(env, userId, inputs, rail))
    .filter((r) => !isSubjectMatch(inputs.subject, { name: r.name, domain: r.domain || guessDomain(r.name) }));

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
  // D7175: a read that failed is recorded with its status, so "Unavailable"
  // is told from "nothing to read".
  const failed: SourceRecord[] = [];
  for (const cand of crawlTargets) {
    await enrichWithCrawl(env, userId, analysisId, cand, depth, sources, signals, rail, failed);
  }

  // Re-sort by (post-crawl) relevance and re-number positions.
  candidates.sort((a, b) => b.relevance_score - a.relevance_score);
  candidates.forEach((c, i) => {
    c.position = i;
  });

  const output = await synthesize(env, userId, inputs, candidates, rail, sources);
  if (inputs.subject) output.excluded = [{ name: inputs.subject.name, domain: inputs.subject.domain, uid: inputs.subject.uid, reason: 'subject' }];
  sources.push(...failed);
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

/**
 * D7175: whether a candidate is the run's subject: the same name (case and
 * spacing ignored), the same site (`www.` ignored), or the subject's uid typed
 * as a name. False when the run has no subject.
 */
export function isSubjectMatch(subject: AnalysisSubject | null | undefined, cand: { name?: unknown; domain?: unknown; url?: unknown }): boolean {
  if (!subject) return false;
  const name = nameKey(cand.name);
  if (name && (name === nameKey(subject.name) || name === nameKey(subject.uid))) return true;
  const host = hostOf(cand.domain) || hostOf(cand.url);
  return !!host && !!subject.domain && host === hostOf(subject.domain);
}

export type EvidenceStatus = 'supported' | 'partial' | 'insufficient' | 'no_candidates' | 'unavailable';

export interface Evidence {
  status: EvidenceStatus;
  candidates: number;
  sources_tried: number;
  sources_fetched: number;
  sources_failed: number;
  findings: number;
  findings_with_source: number;
}

/**
 * D7175: a finished run's evidence status, derived on every read from what is
 * stored (so a source added by hand moves it), in one vocabulary for the page,
 * the saved list and the export:
 *
 *   insufficient  — 0 sources fetched and 0 candidates (D7041), or candidates
 *                   with nothing read and nothing tried (no websites);
 *   no_candidates — sources were read but no company is listed;
 *   unavailable   — candidates, and every read tried failed;
 *   supported     — every finding cites a fetched source, and no read failed;
 *   partial       — anything else: a finding with no source, a failed read,
 *                   or a run that wrote no cited findings at all.
 */
export function evidenceOf(a: {
  candidates?: Array<unknown>;
  sources?: Array<{ id?: unknown; status?: unknown }>;
  output?: { findings?: Array<{ source_ids?: unknown }> } | null;
}): Evidence {
  const candidates = (a.candidates || []).length;
  const sources = a.sources || [];
  const fetchedIds = new Set(sources.filter(sourceFetched).map((s) => String(s.id)));
  const findings = Array.isArray(a.output?.findings) ? a.output.findings : [];
  const cited = findings.filter((f) => Array.isArray(f?.source_ids) && f.source_ids.some((id) => fetchedIds.has(String(id)))).length;
  const e = {
    candidates,
    sources_tried: sources.length,
    sources_fetched: fetchedIds.size,
    sources_failed: sources.length - fetchedIds.size,
    findings: findings.length,
    findings_with_source: cited,
  };
  let status: EvidenceStatus;
  if (!e.sources_fetched) status = candidates && e.sources_failed ? 'unavailable' : 'insufficient';
  else if (!candidates) status = 'no_candidates';
  else status = e.findings && cited === e.findings && !e.sources_failed ? 'supported' : 'partial';
  return { status, ...e };
}

/**
 * Build a manual candidate row (used by the "add competitor" endpoint). Only a
 * crawl runs a model; `rail` is the press's (`extract:candidate`), and its
 * record is the analysis the row is added to.
 */
export async function buildManualCandidate(
  env: Env,
  userId: number,
  inputs: AnalysisInputs,
  data: { name: string; url?: string; category?: string; summary?: string; crawl?: boolean },
  rail: RailContext = { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.candidate },
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
    await enrichWithCrawl(env, userId, 'manual', candidate, inputs.depth === 'deep' ? 'deep' : 'quick', sources, signals, rail);
  }
  return { candidate, sources, signals };
}
