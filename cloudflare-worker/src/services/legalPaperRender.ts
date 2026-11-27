// D711 (#1776) — print the legal paper to PDF.
//
// `renderLegalPdf(env, model, opts)` sends the paper's HTML, faces inline, to
// Browser Run (services/browserRun.ts) and answers `{ ok, bytes, renderer }`.
// When Browser Run is unbound, throws, answers an error, answers something
// that is not a PDF, answers more than 10 MB, or passes its time limit, the
// pdf-lib fallback (services/pdf.ts) draws the same model, so signing never
// fails because a render service is down (decision 3). With
// `{ fallback: false }` it answers the failure code instead. A fallback logs
// a reason code, never document text.
//
// A cover slug prints in two passes. Pass 1 prints the body with each article
// heading linking to its own `#id`, so the page holding the k-th link
// annotation is where article k starts. pdf-lib reads those pages and strips
// the annotations; pass 2 prints the cover and contents with the numbers; and
// pdf-lib merges the two. With no annotations the contents prints no numbers
// and logs `toc_unresolved`.

import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { Env } from '../types';
import { browserRunPdf, BROWSER_RUN_TIMEOUT_MS } from './browserRun';
import { paperHtml, type PaperModel } from './legalPaper';
import type { PaperCover, PaperPageSize } from './legalPaperCss';
import { renderPaperFallbackPdf } from './pdf';

export type LegalRenderer = 'browser_run' | 'pdf_lib';

export interface RenderLegalOptions {
  pageSize: PaperPageSize;
  cover: PaperCover;
  /** false: answer the Browser Run failure code instead of drawing the fallback. */
  fallback?: boolean;
  timeoutMs?: number;
  createdAt?: Date;
}

export type RenderLegalResult =
  | { ok: true; bytes: Uint8Array; renderer: LegalRenderer }
  | { ok: false; code: string };

function logReason(event: string, code: string) {
  console.warn(JSON.stringify({ event, code }));
}

/**
 * The 1-based page of each internal link annotation, in document order, and
 * the PDF with every annotation stripped.
 */
export async function readLinkPages(bytes: Uint8Array): Promise<{ pages: number[]; doc: PDFDocument }> {
  const doc = await PDFDocument.load(bytes);
  const pages: number[] = [];
  doc.getPages().forEach((page, i) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) {
      for (const ref of annots.asArray()) {
        const a = doc.context.lookup(ref);
        if (a instanceof PDFDict && a.get(PDFName.of('Subtype')) === PDFName.of('Link')) pages.push(i + 1);
      }
    }
    page.node.delete(PDFName.of('Annots'));
  });
  return { pages, doc };
}

async function merge(front: Uint8Array, body: PDFDocument): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const f = await PDFDocument.load(front);
  for (const p of await out.copyPages(f, f.getPageIndices())) out.addPage(p);
  for (const p of await out.copyPages(body, body.getPageIndices())) out.addPage(p);
  out.setTitle(body.getTitle() || f.getTitle() || '');
  out.setProducer('Axal StudioOS');
  out.setCreator('Axal StudioOS');
  return out.save();
}

async function viaBrowserRun(env: Env, model: PaperModel, opts: RenderLegalOptions): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: string }> {
  const run = { format: opts.pageSize, timeoutMs: opts.timeoutMs ?? BROWSER_RUN_TIMEOUT_MS } as const;
  const base = { pageSize: opts.pageSize, cover: opts.cover, medium: 'pdf', fonts: 'inline' } as const;
  if (!model.cover) return browserRunPdf(env, paperHtml(model, base), run);

  const pass1 = await browserRunPdf(env, paperHtml(model, { ...base, part: 'body' }), run);
  if (!pass1.ok) return pass1;
  const { pages, doc } = await readLinkPages(pass1.bytes);
  let toc: (number | null)[] | null = null;
  if (pages.length) toc = model.articles.map((_, k) => pages[k] ?? null);
  // #1865 — a paper with no article prints no contents, so nothing goes unresolved.
  else if (model.articles.length > 0) logReason('legal_pdf_toc', 'toc_unresolved');
  const pass2 = await browserRunPdf(env, paperHtml(model, { ...base, part: 'front', tocPages: toc }), run);
  if (!pass2.ok) return pass2;
  return { ok: true, bytes: await merge(pass2.bytes, doc) };
}

export async function renderLegalPdf(env: Env, model: PaperModel, opts: RenderLegalOptions): Promise<RenderLegalResult> {
  const r = await viaBrowserRun(env, model, opts);
  if (r.ok) return { ok: true, bytes: r.bytes, renderer: 'browser_run' };
  if (opts.fallback === false) return { ok: false, code: r.code };
  logReason('legal_pdf_fallback', r.code);
  const bytes = await renderPaperFallbackPdf(model, { pageSize: opts.pageSize, createdAt: opts.createdAt });
  return { ok: true, bytes, renderer: 'pdf_lib' };
}
