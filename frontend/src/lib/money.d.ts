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
export function formatMicro(micro: unknown, code: unknown, opts?: { locale?: string }): string | null;
export function formatMinorOrCount(minor: unknown, code: unknown, opts?: { locale?: string; trimWhole?: boolean }): string | null;
export function suffixAmount(minor: unknown, code: unknown, opts?: { locale?: string; trimWhole?: boolean }): string | null;
export function majorToMinor(major: unknown, code: unknown): number | null;
export function plainAmount(minor: unknown, code: unknown, opts?: { locale?: string; trimWhole?: boolean }): string | null;
export function codeAmount(minor: unknown, code: unknown, opts?: { locale?: string; trimWhole?: boolean }): string | null;
export const STRIPE_HUNDREDTHS: readonly string[];
export function fromStripeUnits(unit: unknown, code: unknown): number | null;
export function toStripeUnits(minor: unknown, code: unknown): number | null;
export function formatStripeAmount(unit: unknown, currency: unknown, opts?: { locale?: string; trimWhole?: boolean }): string | null;
export function plainStripeAmount(unit: unknown, currency: unknown, opts?: { locale?: string }): string;
export type ParseStripeResult =
  | { ok: true; minor: number; units: number; exponent: number }
  | { ok: false; reason: 'currency' | 'empty' | 'format' | 'negative' | 'decimals' | 'range'; message: string };
export function parseStripeAmount(text: unknown, currency: unknown): ParseStripeResult;
export function eventCurrency(currency?: string | null): string;
export function formatEventPrice(cents: unknown, currency?: string | null): string;
