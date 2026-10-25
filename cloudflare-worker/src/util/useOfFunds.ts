// Task #2 — Use of Funds allocator helpers (THE ASK).
//
// The founder intake persists Use of Funds as a JSON array of { label, pct }
// objects (only non-zero sections, in canonical order). We store JSON rather
// than a delimited string because the canonical section labels contain colons
// (e.g. "GTM: sales and marketing"), which a delimiter parser would mis-split.
// Legacy text remains stored. A split read accepts only the five fixed
// sections; unrecognised labels are Not recorded until the founder records a split.

/** D1174: the fixed section keys used by every stored-split reader. */
export const FUND_SECTIONS = [
  { key: 'product', label: 'Product & engineering', bucket: 'eng' },
  { key: 'go-to-market', label: 'GTM: sales and marketing', bucket: 'gtm' },
  { key: 'infrastructure', label: 'Infrastructure & data', bucket: null },
  { key: 'operations', label: 'Operations, legal & compliance', bucket: 'ops' },
  { key: 'reserve', label: 'Hiring / runway reserve', bucket: null },
] as const;

export type FundUse = { label: string; pct: number };

/** Parse legacy text without correcting, dropping or truncating its figures. */
function parseFreeText(raw: string): FundUse[] {
  let remaining = raw.trim();
  const out: FundUse[] = [];
  while (remaining) {
    // Match a complete fixed label before consuming a separator: one label
    // contains a comma and another contains a colon.
    const section = FUND_SECTIONS.find((s) => remaining.startsWith(s.label));
    if (!section) return [];
    const match = remaining.slice(section.label.length).match(/^(?:\s*:\s*|\s+)(\d{1,3}(?:\.\d+)?)\s*%?\s*(?:[,;\n]|$)/);
    if (!match) return [];
    out.push({ label: section.label, pct: Number(match[1]) });
    remaining = remaining.slice(section.label.length + match[0].length).trim();
  }
  return out;
}

/** Coerce a parsed JSON array into clean, non-zero FundUse[] (cap 5). */
function cleanJsonAlloc(arr: unknown[]): FundUse[] {
  return arr
    .map((x: any) => ({ label: String(x?.label ?? '').trim(), pct: Math.round(Number(x?.pct)) }))
    .filter((x) => x.label && Number.isFinite(x.pct) && x.pct > 0)
    .slice(0, 5);
}

/**
 * Read a stored split consistently for readiness, cards, records and decks.
 * JSON-first (the structured allocator), then legacy free-text fallback.
 */
export function parseUseOfFundsValue(raw: string | null | undefined): FundUse[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  let arr: unknown;
  try { arr = s.startsWith('[') ? JSON.parse(s) : parseFreeText(s); } catch { return []; }
  if (!Array.isArray(arr) || !arr.length) return [];
  const values = new Map<string, number>();
  for (const row of arr) {
    const section = row?.key != null
      ? FUND_SECTIONS.find((f) => row.key === f.key)
      : FUND_SECTIONS.find((f) => String(row?.label ?? '').trim() === f.label);
    const rawPct = row?.pct;
    if (!section || values.has(section.key) || (typeof rawPct !== 'number' && typeof rawPct !== 'string') || String(rawPct).trim() === '') return [];
    const pct = Number(rawPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return [];
    values.set(section.key, pct);
  }
  if (Math.abs([...values.values()].reduce((sum, pct) => sum + pct, 0) - 100) > 1e-9) return [];
  return FUND_SECTIONS.filter((f) => (values.get(f.key) ?? 0) > 0).map((f) => ({ label: f.label, pct: values.get(f.key)! }));
}

/**
 * Validate + canonicalize a submitted use_of_funds value for storage.
 *   - empty / all-zero → { value: null }  (no allocation)
 *   - JSON allocator    → must total exactly 100 after dropping 0% sections,
 *                         else { error }. Returns a canonical JSON string.
 *   - legacy free-text  → passthrough (kept for old/admin flows).
 */
export function normalizeUseOfFunds(raw: string | null | undefined): { value: string | null; error?: string } {
  const s = (raw ?? '').toString().trim();
  if (!s) return { value: null };
  if (s.startsWith('[')) {
    let arr: unknown;
    try { arr = JSON.parse(s); } catch { return { value: null, error: 'Use of Funds is not valid JSON.' }; }
    if (!Array.isArray(arr)) return { value: null, error: 'Use of Funds must be a list of sections.' };
    for (const x of arr as any[]) {
      const pct = Number(x?.pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return { value: null, error: 'Use of Funds percentages must be between 0 and 100.' };
      }
    }
    const nonZero = cleanJsonAlloc(arr);
    if (nonZero.length === 0) return { value: null };
    const sum = nonZero.reduce((a, b) => a + b.pct, 0);
    if (sum !== 100) return { value: null, error: 'Use of Funds must total exactly 100%.' };
    return { value: JSON.stringify(nonZero) };
  }
  return { value: s };
}

/** Human-readable one-line rendering for non-ASK text surfaces. */
export function formatUseOfFundsText(raw: string | null | undefined): string {
  return parseUseOfFundsValue(raw).map((f) => `${f.label} ${f.pct}%`).join('; ');
}
