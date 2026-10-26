/** D1239: personal thesis comparison, not a venture score or an Overall. */
import type { Env } from '../types';

export type Thesis = {
  sectors: string[]; stages: string[]; regions: string[];
  excludedSectors: string[]; excludedStages: string[];
  ticketMin: number | null; ticketMax: number | null;
};
export type FitFacts = {
  sector: string | null; stage: string | null;
  regions: string[] | null; geographyIncomplete?: boolean;
  ask: number | null; currency: string | null;
};
type CriterionState = 'match' | 'outside' | 'not_set' | 'not_recorded';
type Criterion = { key: 'sector' | 'stage' | 'region' | 'ticket'; state: CriterionState; source: string; reason: string };
const normalize = (v: string) => v.trim().toLowerCase().replace(/[_\s]+/g, '-');
const stageKey = (v: string) => normalize(v).replace(/^preseed$/, 'pre-seed');
const includes = (values: string[], value: string, key = normalize) => values.some(v => key(v) === key(value));
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

function strings(raw: unknown): string[] {
  if (raw == null) return [];
  let value: unknown;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('thesis_unreadable'); }
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error('thesis_unreadable');
  return value.map(v => v.trim()).filter(Boolean);
}

/** Free-text thesis prose is never parsed into invented preferences. */
export async function readThesis(env: Env, userId: number): Promise<Thesis | null> {
  const row = await env.DB.prepare(`SELECT sectors_json, stages_json, geos_json,
    anti_thesis_sectors_json, anti_thesis_stages_json, ticket_min_usd, ticket_max_usd
    FROM investor_profiles WHERE user_id = ?`).bind(userId).first<Record<string, unknown>>();
  if (!row) return null;
  const min = row.ticket_min_usd == null ? null : finite(row.ticket_min_usd);
  const max = row.ticket_max_usd == null ? null : finite(row.ticket_max_usd);
  if ((row.ticket_min_usd != null && min == null) || (row.ticket_max_usd != null && max == null)
    || (min != null && max != null && min > max)) throw new Error('thesis_unreadable');
  return { sectors: strings(row.sectors_json), stages: strings(row.stages_json), regions: strings(row.geos_json),
    excludedSectors: strings(row.anti_thesis_sectors_json), excludedStages: strings(row.anti_thesis_stages_json),
    ticketMin: min, ticketMax: max };
}

/** Research's stored regions to the existing investor-profile vocabulary. */
export function thesisRegion(region: string): string | null {
  const regions: Record<string, string> = { Europe: 'Europe', 'North America': 'North America',
    'Latin America': 'LATAM', Asia: 'APAC', Oceania: 'APAC', 'Middle East': 'MENA', Africa: 'Africa' };
  return regions[region] ?? null;
}

export type FitGeography = { regions: string[] | null; geographyIncomplete: boolean; unreadable?: boolean };
/** SCORING's Geographic facts cite Grow's recorded markets; never parse projects.hq.
 * One bound query serves the batch. A malformed source row stays local to its project.
 */
export async function readFitGeographies(env: Env, projectIds: number[]): Promise<Map<number, FitGeography>> {
  const grouped = new Map(projectIds.map(id => [id, { regions: [] as string[], geographyIncomplete: false, unreadable: false }]));
  if (!grouped.size) return new Map();
  const rows = await env.DB.prepare(`SELECT m.project_id, m.geography_ref, c.region FROM markets m
    LEFT JOIN research_countries c ON c.code = m.geography_ref
    WHERE m.project_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    AND m.state IN ('considering','entering','served')`).bind(JSON.stringify([...grouped.keys()]))
    .all<{ project_id: number; geography_ref: string | null; region: string | null }>();
  if (!Array.isArray(rows.results)) throw new Error('geography_unreadable');
  for (const row of rows.results) {
    const entry = grouped.get(row.project_id);
    if (!entry) continue;
    if ((row.region != null && typeof row.region !== 'string') || (row.geography_ref != null && typeof row.geography_ref !== 'string')) {
      entry.unreadable = true; continue;
    }
    const region = row.region ? thesisRegion(row.region) : null;
    if (region) entry.regions.push(region); else entry.geographyIncomplete = true;
  }
  return new Map([...grouped].map(([id, value]) => [id, { ...value, regions: value.regions.length ? [...new Set(value.regions)] : null }]));
}

export async function readFitGeography(env: Env, projectId: number): Promise<FitGeography> {
  const result = (await readFitGeographies(env, [projectId])).get(projectId)!;
  if (result.unreadable) throw new Error('geography_unreadable');
  return result;
}

export function computeThesisFit(thesis: Thesis | null, facts: FitFacts) {
  const criteria: Criterion[] = [];
  function choice(key: 'sector' | 'stage', wanted: string[], excluded: string[], actual: string | null) {
    const source = `projects.${key}`;
    if (!wanted.length && !excluded.length) { criteria.push({ key, source, state: 'not_set', reason: 'No thesis preference is recorded for this criterion.' }); return; }
    if (!actual?.trim()) { criteria.push({ key, source, state: 'not_recorded', reason: 'The venture has not recorded this criterion.' }); return; }
    const canonical = key === 'stage' ? stageKey : normalize;
    const match = !includes(excluded, actual, canonical) && (!wanted.length || includes(wanted, actual, canonical));
    criteria.push({ key, source, state: match ? 'match' : 'outside', reason: match
      ? 'The recorded value matches your thesis.' : 'The recorded value is outside your thesis.' });
  }
  const t = thesis ?? { sectors: [], stages: [], regions: [], excludedSectors: [], excludedStages: [], ticketMin: null, ticketMax: null };
  const set = !!(t.sectors.length || t.stages.length || t.regions.length || t.excludedSectors.length || t.excludedStages.length
    || t.ticketMin != null || t.ticketMax != null);
  choice('sector', t.sectors, t.excludedSectors, facts.sector);
  choice('stage', t.stages, t.excludedStages, facts.stage);
  const regionMatch = facts.regions?.some(r => includes(t.regions, r)) ?? false;
  criteria.push({ key: 'region', source: 'markets.geography_ref → research_countries.region',
    state: !t.regions.length ? 'not_set' : regionMatch ? 'match' : !facts.regions?.length || facts.geographyIncomplete ? 'not_recorded' : 'outside',
    reason: !t.regions.length ? 'No thesis region is recorded.' : regionMatch ? 'A recorded market region matches your thesis.'
      : !facts.regions?.length || facts.geographyIncomplete ? 'Market geography is not fully recorded.' : 'The recorded market regions are outside your thesis.' });
  const ticketSet = t.ticketMin != null || t.ticketMax != null;
  const ask = finite(facts.ask);
  const comparable = ask != null && facts.currency === 'USD';
  const ticketMatch = comparable && (t.ticketMin == null || ask >= t.ticketMin) && (t.ticketMax == null || ask <= t.ticketMax);
  criteria.push({ key: 'ticket', source: 'deals.target_raise / deals.amount + deals.currency',
    state: !ticketSet ? 'not_set' : !comparable ? 'not_recorded' : ticketMatch ? 'match' : 'outside',
    reason: !ticketSet ? 'No thesis ticket range is recorded.' : !comparable ? 'A comparable USD ask is not recorded; no exchange rate is assumed.'
      : ticketMatch ? 'The recorded ask is within your ticket range.' : 'The recorded ask is outside your ticket range.' });
  const known = criteria.filter(c => c.state === 'match' || c.state === 'outside');
  const confidence = known.length / 4;
  return { state: !set ? 'not_set' : !known.length ? 'not_enough_recorded' : 'recorded',
    label: !set ? 'Set your thesis' : !known.length ? 'Not enough recorded' : 'Fit to my thesis',
    score: !set || !known.length ? null : Math.round(100 * known.filter(c => c.state === 'match').length / known.length),
    confidence, confidence_label: confidence >= 0.7 ? 'High' : confidence >= 0.45 ? 'Medium' : 'Low',
    coverage: { recorded: known.length, total: 4 }, criteria,
    method: 'thesis-fit-v1-equal-criteria', computed: true };
}
