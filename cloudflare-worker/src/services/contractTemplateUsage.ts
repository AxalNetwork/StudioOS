import { templateKeyForDocType } from './legalDocTypes';

/** Envelope / legacy spellings → catalog `TEMPLATES` key (doc_type slug). */
const RAW_TO_CATALOG: Record<string, string> = {
  nda_3way_v1: 'nda_3way_founder_investor_axal',
  investor_nda_v1: 'investor_nda_axal',
  partner_msa_v1: 'partner_services',
  mentor_nda_v1: 'mentor_nda_axal',
  mentor_disclaimer_v1: 'mentor_engagement_disclaimer',
};

/**
 * Map a raw documents.template_name, documents.doc_type or esign document_type
 * to the catalog key used in `TEMPLATES` / HQ · Contracts counts.
 */
export function catalogDocTypeForRaw(
  raw: string | null | undefined,
  catalogKeys: ReadonlySet<string>,
): string | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase();
  if (catalogKeys.has(lower)) return lower;
  const alias = RAW_TO_CATALOG[lower];
  if (alias && catalogKeys.has(alias)) return alias;
  const tk = templateKeyForDocType(lower);
  if (tk) {
    for (const k of catalogKeys) {
      if (templateKeyForDocType(k) === tk) return k;
    }
  }
  return null;
}

export type UsageMaps = {
  usage: Map<string, number>;
  lastUsed: Map<string, string>;
};

export function bumpUsage(
  usage: Map<string, number>,
  lastUsed: Map<string, string>,
  catalogKey: string,
  when: string | null | undefined,
): void {
  usage.set(catalogKey, (usage.get(catalogKey) || 0) + 1);
  const prev = lastUsed.get(catalogKey);
  if (when && (!prev || new Date(when) > new Date(prev))) lastUsed.set(catalogKey, when);
}

/**
 * Count usage from unified contract rows (four-source union). Avoids double-counting
 * migrated documents and maps alias spellings to one catalog key.
 */
export function usageFromContractRows(
  rows: ReadonlyArray<{ doc_type: string | null; template_name?: string | null; created_at: string | null }>,
  catalogKeys: ReadonlySet<string>,
): UsageMaps {
  const usage = new Map<string, number>();
  const lastUsed = new Map<string, string>();
  for (const r of rows) {
    const key =
      catalogDocTypeForRaw(r.doc_type, catalogKeys)
      ?? catalogDocTypeForRaw(r.template_name ?? null, catalogKeys);
    if (!key) continue;
    bumpUsage(usage, lastUsed, key, r.created_at);
  }
  return { usage, lastUsed };
}
