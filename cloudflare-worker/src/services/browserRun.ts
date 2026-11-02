// D711 (#1776) — Browser Run's documented PDF call.
//
// Cloudflare documents `env.BROWSER.quickAction('pdf', { html, pdfOptions,
// gotoOptions })` (compatibility date 2026-03-24 or later; remote mode under
// `wrangler dev`). The six older callers post through `BROWSER.fetch` to a
// made-up host (GOTCHAS.md); this one never calls `fetch`.
//
// `browserRunPdf` answers `{ ok: true, bytes }` only for an `ok` answer that
// starts `%PDF-` and is at most 10 MB, the limit admin_contracts.ts reads back.
// Every other outcome is a code, never document text:
//   browser_unbound · browser_error · browser_timeout · browser_status ·
//   not_pdf · pdf_too_large
//
// D717 (#1782) — `renderLegalPng` photographs page 1 of the paper through the
// documented `quickAction('screenshot', { html, viewport, screenshotOptions })`
// for the Templates tab's thumbnails. It answers `{ ok: true, bytes }` only
// for an `ok` answer that starts with the PNG signature and is under 1 MB;
// otherwise a code: browser_unbound · browser_error · browser_timeout ·
// browser_status · not_png · png_too_large.

import type { Env } from '../types';

export const BROWSER_RUN_TIMEOUT_MS = 20_000;
export const MAX_LEGAL_PDF_BYTES = 10 * 1024 * 1024;

export type BrowserRunResult = { ok: true; bytes: Uint8Array } | { ok: false; code: string };

export interface BrowserRunOptions {
  format: 'letter' | 'a4';
  timeoutMs?: number;
}

class Timeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Timeout()), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

export async function browserRunPdf(env: Env, html: string, opts: BrowserRunOptions): Promise<BrowserRunResult> {
  const binding = env.BROWSER;
  if (!binding || typeof binding.quickAction !== 'function') return { ok: false, code: 'browser_unbound' };
  const ms = opts.timeoutMs ?? BROWSER_RUN_TIMEOUT_MS;
  try {
    return await withTimeout((async (): Promise<BrowserRunResult> => {
      const res = await binding.quickAction!('pdf', {
        html,
        pdfOptions: { format: opts.format, printBackground: true, preferCSSPageSize: true },
        gotoOptions: { waitUntil: 'networkidle0' },
      });
      if (!res || !res.ok) return { ok: false, code: 'browser_status' };
      const declared = Number(res.headers?.get?.('content-length') || 0);
      if (declared > MAX_LEGAL_PDF_BYTES) return { ok: false, code: 'pdf_too_large' };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_LEGAL_PDF_BYTES) return { ok: false, code: 'pdf_too_large' };
      if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return { ok: false, code: 'not_pdf' };
      return { ok: true, bytes };
    })(), ms);
  } catch (e) {
    return { ok: false, code: e instanceof Timeout ? 'browser_timeout' : 'browser_error' };
  }
}

export const MAX_THUMBNAIL_BYTES = 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngOptions {
  /** CSS px of the viewport: Letter is 816 x 1056. */
  width: number;
  height: number;
  /** 0.5 draws a half-size image of the same layout. */
  deviceScaleFactor?: number;
  timeoutMs?: number;
}

export async function renderLegalPng(env: Env, html: string, opts: PngOptions): Promise<BrowserRunResult> {
  const binding = env.BROWSER;
  if (!binding || typeof binding.quickAction !== 'function') return { ok: false, code: 'browser_unbound' };
  const ms = opts.timeoutMs ?? BROWSER_RUN_TIMEOUT_MS;
  try {
    return await withTimeout((async (): Promise<BrowserRunResult> => {
      const res = await binding.quickAction!('screenshot', {
        html,
        viewport: { width: opts.width, height: opts.height, deviceScaleFactor: opts.deviceScaleFactor ?? 1 },
        screenshotOptions: { type: 'png', fullPage: false },
      });
      if (!res || !res.ok) return { ok: false, code: 'browser_status' };
      const declared = Number(res.headers?.get?.('content-length') || 0);
      if (declared >= MAX_THUMBNAIL_BYTES) return { ok: false, code: 'png_too_large' };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length >= MAX_THUMBNAIL_BYTES) return { ok: false, code: 'png_too_large' };
      if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return { ok: false, code: 'not_png' };
      return { ok: true, bytes };
    })(), ms);
  } catch (e) {
    return { ok: false, code: e instanceof Timeout ? 'browser_timeout' : 'browser_error' };
  }
}

// #3655 — the deck export's renders: a signed print page opened by URL, through
// the same documented `quickAction`. The deck export, its PowerPoint pictures
// and Google Slides' chart pictures posted to `https://browser/pdf` and
// `https://browser/screenshot` through `BROWSER.fetch`, the made-up host above:
// that is why #3654 saw every PDF and PowerPoint export fail while HTML, which
// needs no browser, worked.
//
// `renderUrl` answers `{ ok: true, bytes }` only for an `ok` answer whose first
// bytes are the asked kind (`%PDF-` or the PNG signature) and within the cap.
// Otherwise a code (no page text, no URL, no token) with the answer's status
// and how many attempts were made:
//   browser_unbound · browser_error · browser_timeout · browser_busy (429) ·
//   browser_refused (other 4xx) · browser_status (5xx) · not_pdf · not_png · too_large · budget_exhausted
//
// One bounded retry, only for what can pass on a second try: a thrown call, a
// timeout, 429 and 5xx. A render writes nothing, and the export's ledger row is
// written once after the final answer, so a retry can never record a second
// export.

/** The renderer's own page load is 45 s (`gotoOptions.timeout`); this bounds the whole call. */
export const DECK_RENDER_TIMEOUT_MS = 60_000;
export const DECK_PAGE_LOAD_MS = 45_000;
export const DECK_RENDER_ATTEMPTS = 2;
export const DECK_RENDER_BACKOFF_MS = 750;
export const MAX_DECK_PDF_BYTES = 40 * 1024 * 1024;
export const MAX_SLIDE_PNG_BYTES = 8 * 1024 * 1024;

export type RenderFailure = { ok: false; code: string; status?: number; attempts: number };
export type RenderResult = { ok: true; bytes: Uint8Array; attempts: number } | RenderFailure;

export interface RenderUrlOptions {
  /** What the answer must be: its first bytes are checked. */
  kind: 'pdf' | 'png';
  maxBytes: number;
  timeoutMs?: number;
  attempts?: number;
  backoffMs?: number;
  /** The epoch ms after which no attempt starts, and each call's timeout is cut to fit. */
  deadline?: number;
}

const RETRYABLE = new Set(['browser_error', 'browser_timeout', 'browser_busy', 'browser_status']);

async function renderOnce(env: Env, action: 'pdf' | 'screenshot', options: Record<string, unknown>, opts: RenderUrlOptions, ms: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: string; status?: number }> {
  const binding = env.BROWSER!;
  try {
    return await withTimeout((async () => {
      const res = await binding.quickAction!(action, options);
      if (!res || !res.ok) {
        const status = Number(res?.status) || undefined;
        // The body is the renderer's words about our page: drained, never kept.
        await res?.arrayBuffer?.().catch(() => null);
        return { ok: false as const, code: status === 429 ? 'browser_busy' : status && status < 500 ? 'browser_refused' : 'browser_status', status };
      }
      const declared = Number(res.headers?.get?.('content-length') || 0);
      if (declared > opts.maxBytes) return { ok: false as const, code: 'too_large' };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > opts.maxBytes) return { ok: false as const, code: 'too_large' };
      const good = opts.kind === 'pdf'
        ? bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
        : bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
      if (!good) return { ok: false as const, code: opts.kind === 'pdf' ? 'not_pdf' : 'not_png' };
      return { ok: true as const, bytes };
    })(), ms);
  } catch (e) {
    return { ok: false, code: e instanceof Timeout ? 'browser_timeout' : 'browser_error' };
  }
}

/**
 * D1506 (#3757): the origins the export browser may load, besides the page's
 * own: the inline schemes, and the Google Fonts hosts the print page's type
 * comes from. Anything else (an external image left in a deck, a tracking
 * pixel) is never requested; the deck reads our copies (`/images/import`).
 */
export const EXPORT_EXTRA_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'] as const;
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Browser Run's `allowRequestPattern` for a page at `url`: its own origin, the extra origins, data: and blob:. */
export function exportAllowPatterns(url: string): string[] {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return ['/^data:/', '/^blob:/']; }
  return [origin, ...EXPORT_EXTRA_ORIGINS].map((o) => `/^${reEscape(o)}\\//`).concat(['/^data:/', '/^blob:/']);
}

export async function renderUrl(env: Env, action: 'pdf' | 'screenshot', options: Record<string, unknown>, opts: RenderUrlOptions): Promise<RenderResult> {
  const binding = env.BROWSER;
  // D1506: a page opened by URL loads only the allow-listed origins.
  if (typeof options.url === 'string') options = { ...options, allowRequestPattern: exportAllowPatterns(options.url) };
  if (!binding || typeof binding.quickAction !== 'function') return { ok: false, code: 'browser_unbound', attempts: 0 };
  const attempts = Math.max(1, opts.attempts ?? DECK_RENDER_ATTEMPTS);
  const backoff = opts.backoffMs ?? DECK_RENDER_BACKOFF_MS;
  let last: { code: string; status?: number } = { code: 'budget_exhausted' };
  for (let n = 1; n <= attempts; n++) {
    let ms = opts.timeoutMs ?? DECK_RENDER_TIMEOUT_MS;
    if (opts.deadline != null) {
      const left = opts.deadline - Date.now();
      if (left <= 0) return { ok: false, code: 'budget_exhausted', status: last.status, attempts: n - 1 };
      ms = Math.min(ms, left);
    }
    const r = await renderOnce(env, action, options, opts, ms);
    if (r.ok) return { ok: true, bytes: r.bytes, attempts: n };
    last = r;
    if (!RETRYABLE.has(r.code) || n === attempts) return { ok: false, code: r.code, status: r.status, attempts: n };
    if (backoff > 0) await new Promise((res) => setTimeout(res, backoff * n));
  }
  return { ok: false, code: last.code, status: last.status, attempts };
}
