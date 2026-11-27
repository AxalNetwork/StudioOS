/** D4438 (#4438) — HQ's SEG7 scopes over the existing D999 queries; remote reads carry aggregates only. */
import type { Env } from '../types';
import { requireBranchTier } from '../util/branch';
import { branchBindings, branchRead, fanOut } from './branches';
import { insightsScopes } from './insightsScope';
import { CONFIDENCE_BANDS, SEGMENT_PROFILES, SEGMENT_SOURCES, readPersonaSegments } from './personaSegments';
import { PRODUCT_TESTERS_REASON } from './adminInsights';
import { listProfiles, segmentCoverage } from './segmentProfiles';

export const SCOPE_FAILURE = 'Could not be read. This is not a claim that there are none.';
export const scopeOff = () => ({ available: false as const, unreadable: true as const, reason: SCOPE_FAILURE });
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const sum = (v: unknown[]) => v.every(count) ? (v as number[]).reduce((a, b) => a + b, 0) : null;
const fields = (rows: any[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, sum(rows.map((r) => r?.[k]))]));
const keysOf = (rows: any[][], key: string) => [...new Set(rows.flatMap((r) => (Array.isArray(r) ? r : []).map((r) => r?.[key]).filter((v) => typeof v === 'string' && KEY.test(v))))].sort();
const rowSum = (rows: any[][], id: string, key: string, names: string[]) => fields(rows.map((rs) => rs.find((r) => r[key] === id) || Object.fromEntries(names.map((n) => [n, 0]))), names);

/** Explicit projection, also used on one studio: unexpected personal fields never cross the RPC boundary. */
export function combineSegmentSummaries(reads: any[], now = Date.now()) {
  const block = (key: string, build: (v: any[]) => any) => {
    if (!reads.length || !reads.every((r) => r?.[key]?.available === true)) return scopeOff();
    try { return { available: true, ...build(reads.map((r) => r[key])) }; } catch { return scopeOff(); }
  };
  const group = (groups: any[]) => {
    const rows = groups.map((g) => Array.isArray(g?.segments) ? g.segments : []);
    return { ...fields(groups, ['members', 'no_segment']), segments: keysOf(rows, 'id').map((id) => ({ id, ...rowSum(rows, id, 'id', ['count']) })) };
  };
  return {
    as_of: new Date(now).toISOString(), counted: 'Every account but admins. Deactivated accounts are counted apart.',
    members: block('members', (v) => fields(v, ['total', 'in_segment', 'no_segment', 'new_30d', 'deactivated', 'profile_differs', 'not_in_taxonomy'])),
    segments: block('segments', (v) => {
      const rows = v.map((r) => Array.isArray(r.rows) ? r.rows : []);
      return { rows: keysOf(rows, 'id').map((id) => {
        const first = rows.flat().find((r) => r.id === id);
        return { id, in_taxonomy: first?.in_taxonomy === true, profile: SEGMENT_PROFILES.includes(first?.profile) ? first.profile : null,
          ...rowSum(rows, id, 'id', ['members', 'new_30d', 'still_explorers', 'profile_differs']) };
      }) };
    }),
    sub_accounts: block('sub_accounts', (v) => {
      const ids = keysOf(v.map((r) => Object.keys(r.lp?.by_segment || {}).map((id) => ({ id }))), 'id');
      return { lp: { ...fields(v.map((r) => r.lp), ['total', 'no_segment']), by_segment: Object.fromEntries(ids.map((id) => [id, sum(v.map((r) => Object.prototype.hasOwnProperty.call(r.lp?.by_segment || {}, id) ? r.lp.by_segment[id] : 0))])), definition: 'Accounts with an approved LP application. Not added to the segment’s total.' }, product_tester: { recorded: false, reason: PRODUCT_TESTERS_REASON } };
    }),
    by_profile: block('by_profile', (v) => ({ profiles: SEGMENT_PROFILES.map((profile) => ({ profile, ...group(v.map((r) => r.profiles?.find((g: any) => g.profile === profile))) })), other: group(v.map((r) => r.other)) })),
    how_set: block('how_set', (v) => ({ counts: fields(v.map((r) => r.counts), [...SEGMENT_SOURCES, 'not_recorded']) })),
    confidence: block('confidence', (v) => ({ ...fields(v, ['over', 'not_recorded']), bands: CONFIDENCE_BANDS.map((b) => ({ ...b, count: sum(v.map((r) => r.bands?.find((x: any) => x.key === b.key)?.count)) })) })),
    weekly: block('weekly', (v) => {
      const dates = [...new Set(v.flatMap((r) => (r.weeks || []).map((w: any) => w.week_start)).filter((s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)))].sort() as string[];
      return { weeks: dates.map((week_start, i) => ({ week_start, count: sum(v.map((r) => r.weeks?.find((w: any) => w.week_start === week_start)?.count)), ...(i === dates.length - 1 ? { to_date: true } : {}) })), undated: sum(v.map((r) => r.undated)), counted_by: 'The day each member’s current segment was first given; dates not recorded remain gaps.' };
    }),
    moves_30d: block('moves_30d', (v) => ({ count: sum(v.map((r) => r.count)) })),
  };
}

function profilesOnly(v: any) {
  if (!Array.isArray(v)) return scopeOff();
  return { segments: v.filter((p) => typeof p?.key === 'string' && KEY.test(p.key)).map((p) => ({ key: p.key, name: p.name, profile: p.profile, status: p.status, who: p.who ?? null })) };
}
/** Only authored segment definitions and aggregate coverage, never per-person records or answer text. */
function coverageOnly(v: any) {
  if (!Array.isArray(v?.segments)) return scopeOff();
  return { small_cell_min: v.small_cell_min, segments: v.segments.filter((p: any) => typeof p?.key === 'string' && KEY.test(p.key)).map((p: any) => ({
    key: p.key, name: p.name, profile: p.profile, status: p.status,
    needs: p.needs?.recorded ? { recorded: true, total: p.needs.total, met: p.needs.met, items: (p.needs.items || []).map((n: any) => ({ text: n.text })), gaps: (p.needs.gaps || []).map(() => ({})) } : { recorded: false, reason: 'HQ has not written needs for this segment yet.' },
    gap_kinds: (p.gap_kinds || []).filter((k: string) => ['program', 'perk', 'events', 'content', 'sidebar_link'].includes(k)),
    offers: Object.fromEntries(['programs', 'perks', 'events', 'content', 'sidebar_links'].map((key) => [key, p.offers?.[key]?.available === true ? { available: true, count: count(p.offers[key].count) ? p.offers[key].count : null } : scopeOff()])),
  })) };
}
export async function localSegmentOverview(env: Env, now = Date.now()) {
  const [summary, profiles, coverage] = await Promise.allSettled([readPersonaSegments(env, now), listProfiles(env), segmentCoverage(env, now)]);
  return {
    summary: combineSegmentSummaries(summary.status === 'fulfilled' ? [summary.value] : [], now),
    profiles: profiles.status === 'fulfilled' ? profilesOnly(profiles.value) : scopeOff(),
    coverage: coverage.status === 'fulfilled' ? coverageOnly(coverage.value) : scopeOff(),
  };
}
export async function branchSegmentOverview(env: Env, now?: number) {
  const branch = requireBranchTier(env);
  if (now !== undefined && (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000)) throw new Error('Invalid summary date');
  return { branch, as_of: new Date(now ?? Date.now()).toISOString(), overview: await localSegmentOverview(env, now) };
}
export async function segmentScopes(env: Env) {
  const result = await insightsScopes(env);
  return { ...result, scopes: [...result.scopes, ...(result.scopes.length > 1 ? [{ code: '*', label: 'All studios', kind: 'all' }] : [])] };
}
export class SegmentScopeError extends Error {
  status: 404 | 503;
  code: string;
  constructor(status: 404 | 503, code: string) { super(status === 404 ? 'That studio scope is not recorded.' : SCOPE_FAILURE); this.status = status; this.code = code; }
}
export async function checkedScope(env: Env, raw: string | undefined) {
  const code = raw ?? 'hq';
  const meta = await segmentScopes(env);
  const scope = meta.scopes.find((s) => s.code === code);
  if (!scope) throw new SegmentScopeError(meta.registry.readable ? 404 : 503, meta.registry.readable ? 'scope_not_found' : 'unreadable');
  return { meta, scope };
}
export async function scopedSegmentOverview(env: Env, raw?: string) {
  const { meta, scope } = await checkedScope(env, raw);
  const now = Date.now();
  const local = scope.code === 'hq' || scope.code === '*' ? await localSegmentOverview(env, now) : null;
  if (scope.code === 'hq') return { ...meta, scope, ...local };
  const remote = scope.code === '*'
    ? await fanOut<any>(Object.fromEntries(branchBindings(env).filter((b) => meta.scopes.some((s) => s.kind === 'branch' && s.code === b.code)).map((b) => [b.binding, b.stub])) as unknown as Env, 'personaSegmentOverview', [now])
    : [await branchRead<any>(env, scope.code, 'personaSegmentOverview', [now])];
  // Include deployed registry rows that have no binding; otherwise 'All' could silently shrink.
  for (const s of meta.scopes.filter((s) => s.kind === 'branch')) if (scope.code === '*' && !remote.some((r) => r.code === s.code)) remote.push({ code: s.code, binding: '', status: 'not_deployed' });
  const reads = remote.map((r) => r.status === 'ok' && r.data?.branch === r.code ? r.data.overview : null);
  const coverage = { total: remote.length, answered: reads.filter(Boolean).length, complete: reads.every(Boolean) };
  if (scope.code !== '*') {
    const read = reads[0];
    return { ...meta, scope, sources: coverage, summary: combineSegmentSummaries(read ? [read.summary] : [], now), profiles: profilesOnly(read?.profiles?.segments), coverage: coverageOnly(read?.coverage) };
  }
  return { ...meta, scope, sources: coverage,
    summary: combineSegmentSummaries([local?.summary, ...reads.map((r) => r?.summary)], now),
    profiles: local?.profiles,
    coverage: { recorded: false, reason: 'Needs and offers are recorded per studio. Choose one studio to read them.', segments: [] },
  };
}
