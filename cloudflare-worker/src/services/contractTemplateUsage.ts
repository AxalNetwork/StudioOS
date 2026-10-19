import { librarySlugFor } from './legalDocTypes';

/**
 * Map a raw documents.template_name, documents.doc_type or esign document_type
 * to the catalog key used in `TEMPLATES` / HQ · Contracts counts.
 *
 * D758 (#1863): the same spelling-to-row rule the send uses. The exact value
 * first, so a spaced slug such as `Subscription Booklet & LPA` matches its own
 * row; then its lowercase; then `librarySlugFor` of each, so a bundled-key
 * spelling (`investor_nda_v1`, `nda_3way_v1`, …) counts under its row. The
 * first that is a key wins.
 */
export function catalogDocTypeForRaw(
  raw: string | null | undefined,
  catalogKeys: ReadonlySet<string>,
): string | null {
  if (!raw) return null;
  const exact = String(raw);
  const lower = exact.toLowerCase();
  for (const k of [exact, lower, librarySlugFor(exact), librarySlugFor(lower)]) {
    if (catalogKeys.has(k)) return k;
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

/** A unified contract row, as far as usage reads it. */
export type UsageRow = {
  doc_type: string | null;
  template_name?: string | null;
  created_at: string | null;
  source?: string;
  uid?: string;
  /** A pairwise NDA or partner deal row: the envelope it was signed in, if any. */
  envelope_uuid?: string | null;
};

/**
 * D758 decision 7: one document, one use. A pairwise NDA or partner deal row
 * whose envelope is an esign row in the same union is that envelope's
 * relationship, not a second document, so it is skipped. A relationship row
 * with no envelope still counts once.
 */
function countedRows<T extends UsageRow>(rows: ReadonlyArray<T>): T[] {
  const envelopes = new Set(rows.filter((r) => r.source === 'esign' && r.uid).map((r) => r.uid as string));
  return rows.filter((r) => !((r.source === 'pairwise_nda' || r.source === 'partner_deal')
    && r.envelope_uuid && envelopes.has(r.envelope_uuid)));
}

function keyFor(r: UsageRow, catalogKeys: ReadonlySet<string>): string | null {
  return catalogDocTypeForRaw(r.doc_type, catalogKeys)
    ?? catalogDocTypeForRaw(r.template_name ?? null, catalogKeys);
}

/**
 * Count usage from unified contract rows (four-source union). Avoids double-counting
 * migrated documents and maps alias spellings to one catalog key.
 */
export function usageFromContractRows(
  rows: ReadonlyArray<UsageRow>,
  catalogKeys: ReadonlySet<string>,
): UsageMaps {
  const usage = new Map<string, number>();
  const lastUsed = new Map<string, string>();
  for (const r of countedRows(rows)) {
    const key = keyFor(r, catalogKeys);
    if (!key) continue;
    bumpUsage(usage, lastUsed, key, r.created_at);
  }
  return { usage, lastUsed };
}

/** The rows that count under `slug`, after the same fold and skip: the drill-down equals the chip. */
export function usageRowsFor<T extends UsageRow>(rows: ReadonlyArray<T>, catalogKeys: ReadonlySet<string>, slug: string): T[] {
  return countedRows(rows).filter((r) => keyFor(r, catalogKeys) === slug);
}
