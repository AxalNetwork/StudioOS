/**
 * Task #14 (AA-1) — Shared helpers for connector stubs.
 *
 * Every stub source returns deterministic-but-varied rows derived from
 * a hash of (source_key, sector, day-of-year). That keeps `npm run dev`
 * idempotent within a calendar day while still showing variation
 * across days, sectors, and providers.
 */
import type { CommonRow } from '../registry';

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic 0..1 in pseudo-uniform distribution from a string seed. */
export function seeded(seed: string): number {
  return (hash32(seed) % 10_000) / 10_000;
}

/** Deterministic 0..1 with a soft bias toward `mid` (0..1). */
export function seededAround(seed: string, mid: number, spread = 0.25): number {
  const u = seeded(seed);
  const v = mid + (u - 0.5) * 2 * spread;
  return Math.max(0.05, Math.min(0.95, v));
}

/** Build a normalised CommonRow with sensible defaults. */
export function row(opts: Omit<CommonRow, 'ts'> & { ts?: string }): CommonRow {
  return {
    ts: opts.ts ?? new Date().toISOString(),
    geo: opts.geo ?? 'global',
    unit: opts.unit ?? 'index',
    ...opts,
  } as CommonRow;
}

/** Day-of-year string for stable seeding across one UTC day. */
export function doy(now = new Date()): string {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const diff = now.getTime() - start;
  return `${now.getUTCFullYear()}-${Math.floor(diff / 86_400_000)}`;
}
