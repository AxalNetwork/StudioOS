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
