// Task #2 — Use of Funds allocator helpers (THE ASK).
//
// The founder intake persists Use of Funds as a JSON array of { label, pct }
// objects (only non-zero sections, in canonical order). We store JSON rather
// than a delimited string because the canonical section labels contain colons
// (e.g. "GTM: sales and marketing"), which a delimiter parser would mis-split.
// Legacy projects still carry free-text, so every reader falls back to the old
// "Eng 55%, GTM 30%" text parser for backward compatibility.

export type FundUse = { label: string; pct: number };

/** Legacy free-text parser: "Eng 55%, GTM 30%" / "engineering:50, gtm:30". */
function parseFreeText(raw: string): FundUse[] {
  const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const out: FundUse[] = [];
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
}

/** Coerce a parsed JSON array into clean, non-zero FundUse[] (cap 5). */
function cleanJsonAlloc(arr: unknown[]): FundUse[] {
  return arr
    .map((x: any) => ({ label: String(x?.label ?? '').trim(), pct: Math.round(Number(x?.pct)) }))
    .filter((x) => x.label && Number.isFinite(x.pct) && x.pct > 0)
    .slice(0, 5);
}

/**
 * Parse a stored use_of_funds value into FundUse[] for deck rendering.
 * JSON-first (the structured allocator), then legacy free-text fallback.
 */
export function parseUseOfFundsValue(raw: string | null | undefined): FundUse[] {
  const s = (raw ?? '').toString().trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        const cleaned = cleanJsonAlloc(arr);
        if (cleaned.length) return cleaned;
      }
    } catch { /* fall through to free-text */ }
  }
  return parseFreeText(s);
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
  const s = (raw ?? '').toString().trim();
  if (!s) return '';
  if (s.startsWith('[')) {
    const parsed = parseUseOfFundsValue(s);
    if (parsed.length) return parsed.map((f) => `${f.label} ${f.pct}%`).join('; ');
  }
  return s;
}
