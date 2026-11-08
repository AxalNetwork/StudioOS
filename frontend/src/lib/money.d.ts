/** Types for `money.js` (D5029), so the Worker's typecheck can import it. */
export const CURRENCY_CODES: readonly string[];
export function currencyCode(v: unknown): string | null;
export function exponentOf(code: unknown): 0 | 2 | 3 | null;
export function toMinorSafe(v: unknown): number | null;
export type ParseMinorResult =
  | { ok: true; minor: number; exponent: number }
  | { ok: false; reason: 'currency' | 'empty' | 'format' | 'negative' | 'decimals' | 'range'; message: string };
export function parseMinor(text: unknown, code: unknown, opts?: { allowNegative?: boolean }): ParseMinorResult;
export function toMajorString(minor: unknown, code: unknown): string | null;
export function formatMinor(minor: unknown, code: unknown, opts?: { locale?: string; trimWhole?: boolean }): string | null;
export function formatEventPrice(cents: unknown, currency?: string | null): string;
