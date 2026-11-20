/** D7821 (#7821): native activity evidence, code-first classification and resumable physical-row maintenance. */
import type { Env } from '../types';
import { loadOverrides, mapCompanySector, normalizeLabel, resolveCompanySectorOverride } from './researchTaxonomy';
import type { Overrides } from './researchTaxonomy';
import { adminAuditStatement } from './adminAudit';

/** Shared with #7716/#7719 until either lands a canonical list. Identifiers are stored verbatim. */
export const INDUSTRY_SCHEMES = ['UK SIC', 'NACE', 'ISIC', 'NAICS'] as const;
export const COMPANY_MAPPING_RULES_VERSION = 'D7821.1';
/** Reviewed non-market labels are separate from COMPANY_SECTOR_RULES, whose keys are unchanged. */
export const COMPANY_LABELS_OUTSIDE: Readonly<Record<string, { reason: string; reviewed_on: string; reviewer: string }>> = {
  'dormant company': { reason: 'Dormancy describes an inactive legal entity, not an operating tracked market.', reviewed_on: '2026-11-20', reviewer: 'D7821' },
  'non trading company': { reason: 'Non-trading status is not an operating tracked market.', reviewed_on: '2026-11-20', reviewer: 'D7821' },
};
export type NativeClassification = { scheme: string; scheme_version: string; code: string | null; native_label: string | null; language: string | null; source: string; position: number };
export type ClassificationCrosswalk = { scheme: string; scheme_version: string; code: string; match_kind: 'exact' | 'prefix'; normalized_scheme: string; normalized_version: string; industry_code: string; industry_title: string; state: 'mapped' | 'outside_tracked_markets'; market_slug: string | null; reason: string; reviewed_on: string; reviewer: string };
export type CompanyMappingState = 'mapped' | 'no_label' | 'not_yet_considered' | 'outside_tracked_markets' | 'pinned_unmapped_by_hand';
export type CompanyClassification = { state: CompanyMappingState; market_slug: string | null; method: 'rule' | 'code' | 'manual' | null; proof: Record<string, unknown>; rules_version: string };

/** Pure: manual (including collision refusal), first placed native code in register order, then a label rule. */
export function classifyCompany(label: string | null, native: readonly NativeClassification[], crosswalk: readonly ClassificationCrosswalk[], overrides?: Overrides): CompanyClassification {
  const raw = label ?? '', manual = resolveCompanySectorOverride(raw, overrides);
  const result = (state: CompanyMappingState, market_slug: string | null, method: CompanyClassification['method'], proof: Record<string, unknown>): CompanyClassification => ({ state, market_slug, method, proof, rules_version: COMPANY_MAPPING_RULES_VERSION });
  if (manual.collisions.length) return result('not_yet_considered', null, 'manual', { reason: 'normalized_override_collision', keys: manual.collisions });
  if (manual.targets !== null) {
    if (!manual.targets.length) return result('pinned_unmapped_by_hand', null, 'manual', { label: raw, rule: 'research_taxonomy_overrides:company_sector' });
    if (manual.targets.length !== 1) return result('not_yet_considered', null, 'manual', { reason: 'multiple_manual_targets', targets: manual.targets });
    return result('mapped', manual.targets[0], 'manual', { label: raw, rule: 'research_taxonomy_overrides:company_sector' });
  }
  const ordered = [...native].sort((a,b) => a.position-b.position || a.scheme.localeCompare(b.scheme) || a.scheme_version.localeCompare(b.scheme_version));
  for (const item of ordered) {
    if (!item.code) continue;
    const candidates = crosswalk.filter(row => row.scheme === item.scheme && row.scheme_version === item.scheme_version &&
      (row.match_kind === 'exact' ? row.code === item.code : item.code!.startsWith(row.code)))
      .sort((a,b) => (a.match_kind === b.match_kind ? b.code.length-a.code.length || a.code.localeCompare(b.code) : a.match_kind === 'exact' ? -1 : 1));
    const row = candidates[0];
    if (row) return result(row.state, row.market_slug, 'code', { native: item, crosswalk: row });
  }
  // Native labels remain evidence even when a register has no code crosswalk yet.
  for (const value of [raw, ...ordered.map(item => item.native_label ?? '')].filter(value => value.trim())) {
    const mapping = mapCompanySector(value);
    if (mapping.targets.length) return result('mapped', mapping.targets[0], 'rule', { label: value, rule: mapping.rule });
    const outside = COMPANY_LABELS_OUTSIDE[normalizeLabel(value)];
    if (outside) return result('outside_tracked_markets', null, 'rule', { label: value, ...outside });
  }
  const hasEvidence = raw.trim() || ordered.some(item => item.code?.trim() || item.native_label?.trim());
  return result(hasEvidence ? 'not_yet_considered' : 'no_label', null, null, { reason: hasEvidence ? 'no_reviewed_crosswalk_or_label_rule' : 'no_activity_label_or_code' });
}

/** Missing/stale is an explicit read state; it must never masquerade as outside tracked markets. */
export async function readCompanyClassification(env: Env, companyUid: string) {
  const row = await env.DB.prepare('SELECT state, market_slug, method, proof, rules_version, mapped_on, COALESCE((SELECT revision FROM research_company_mapping_revision WHERE id = 1),0) AS revision FROM research_company_mapping WHERE company_uid = ?')
    .bind(companyUid).first<{ state: CompanyMappingState; market_slug: string | null; method: string | null; proof: string; rules_version: string; mapped_on: string; revision: number }>();
  if (!row || row.rules_version !== COMPANY_MAPPING_RULES_VERSION + ':' + row.revision) return { state: 'needs_recompute' as const, reason: row ? 'older_rules_version' : 'no_stored_mapping' };
  const {revision: _revision, ...stored} = row;
  return { ...stored, proof: JSON.parse(row.proof) };
}

/** Reads EVERY physical catalogue row, including held records; cursor is lexical uid, not a served-directory cursor. */
export async function recomputeCompanyClassifications(env: Env, after: string, limit: number) {
  const revisionRow = await env.DB.prepare('SELECT revision FROM research_company_mapping_revision WHERE id = 1').first<{revision:number}>();
  const revision = revisionRow?.revision ?? 0, version = COMPANY_MAPPING_RULES_VERSION + ':' + revision;
  const [companies, natives, crosswalk, overrides] = await Promise.all([
    env.DB.prepare('SELECT uid, sector FROM research_company_directory WHERE uid > ? ORDER BY uid LIMIT ?').bind(after, limit+1).all<{uid:string;sector:string|null}>(),
    env.DB.prepare('SELECT company_uid, scheme, scheme_version, code, native_label, language, source, position FROM research_company_classifications WHERE company_uid IN (SELECT uid FROM research_company_directory WHERE uid > ? ORDER BY uid LIMIT ?) ORDER BY company_uid, position, scheme, scheme_version').bind(after,limit).all<NativeClassification & {company_uid:string}>(),
    env.DB.prepare('SELECT * FROM research_classification_crosswalk ORDER BY scheme, scheme_version, code, match_kind').all<ClassificationCrosswalk>(),
    loadOverrides(env),
  ]);
  const page = (companies.results || []).slice(0,limit), evidence = natives.results || [], rules = crosswalk.results || [];
  const counts: {state:Record<string,number>;method:Record<string,number>;scheme:Record<string,number>} = {state:{},method:{},scheme:{}};
  const bump = (group:Record<string,number>,key:string) => {group[key]=(group[key]||0)+1;};
  const writes = page.map(company => {
    const native = evidence.filter(item => item.company_uid === company.uid);
    const mapping = classifyCompany(company.sector,native,rules,overrides);
    bump(counts.state,mapping.state);bump(counts.method,mapping.method ?? 'none');
    for(const scheme of new Set(native.map(item => item.scheme)))bump(counts.scheme,scheme);
    if(!native.length)bump(counts.scheme,'none');
    return env.DB.prepare(`INSERT INTO research_company_mapping(company_uid,state,market_slug,method,proof,rules_version,mapped_on)
      SELECT ?,?,?,?,?,?,date('now') WHERE COALESCE((SELECT revision FROM research_company_mapping_revision WHERE id = 1),0) = ? ON CONFLICT(company_uid) DO UPDATE SET state=excluded.state,market_slug=excluded.market_slug,
      method=excluded.method,proof=excluded.proof,rules_version=excluded.rules_version,mapped_on=excluded.mapped_on
      WHERE state != excluded.state OR market_slug IS NOT excluded.market_slug OR method IS NOT excluded.method OR proof != excluded.proof OR rules_version != excluded.rules_version`)
      .bind(company.uid,mapping.state,mapping.market_slug,mapping.method,JSON.stringify(mapping.proof),version,revision);
  });
  if(writes.length)await env.DB.batch(writes);
  const currentRevision = await env.DB.prepare('SELECT revision FROM research_company_mapping_revision WHERE id = 1').first<{revision:number}>();
  if((currentRevision?.revision ?? 0)!==revision)return { stale:true as const, processed:0, after, done:false, counts:{state:{},method:{},scheme:{}}, rules_version:version };
  return { stale:false as const, processed:page.length, after:page.at(-1)?.uid ?? after, done:(companies.results||[]).length<=limit, counts, rules_version:version };
}

/** Replace one exact company-label override and invalidate materialized mappings in the SAME audited transaction. */
export async function writeCompanySectorOverride(env: Env, author: number, raw: string, target: string, reason: string) {
  if(target && !await env.DB.prepare('SELECT slug FROM research_market_directory WHERE slug = ?').bind(target).first())return false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM research_taxonomy_overrides WHERE kind = 'company_sector' AND raw_value = ?").bind(raw),
    env.DB.prepare("INSERT INTO research_taxonomy_overrides(kind,raw_value,target,method,note,author) VALUES('company_sector',?,?,'manual',?,?)").bind(raw,target,reason,author),
    env.DB.prepare('INSERT INTO research_company_mapping_revision(id,revision) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET revision = revision + 1'),
    adminAuditStatement(env,author,'research_company_sector_override_written',{raw_value:raw,target,reason,author}),
  ]);
  return true;
}
