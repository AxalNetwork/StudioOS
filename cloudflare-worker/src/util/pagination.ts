// T17 — Shared pagination utilities for ?limit=N and ?offset=N parsing.
// Use clampLimit() on every paginated GET so a malicious caller can't ask
// for LIMIT 999999 and OOM the worker / D1 query budget.

export function clampLimit(
  raw: string | null | undefined,
  def = 50,
  max = 200,
): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

export function parseOffset(raw: string | null | undefined): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// Clamp a `?days=N` window. Used by /api/dashboard.
export function clampDays(
  raw: string | null | undefined,
  def = 30,
  max = 365,
): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}
