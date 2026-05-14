/**
 * Task #16 (DE) — Server-side HTML renderer for export.
 *
 * Renders a FilledDeck (or the editor's flat slide JSON) as a single
 * Tailwind-styled HTML document. The export endpoints feed this HTML
 * to the BROWSER binding (PDF + PNG), or hand the structured slides
 * directly to the PPTX writer.
 *
 * NB — Tailwind is loaded via CDN inside the rendered HTML; this is
 * fine because the HTML is consumed only by the headless browser
 * inside Cloudflare Browser Rendering, never shipped to a real client.
 */
import type { DeckBrand } from './branding';

export type RenderableField = {
  key: string;
  label: string;
  kind: 'title' | 'subtitle' | 'paragraph' | 'bullets' | 'image' | 'metric_grid' | 'quote';
  value: any;
  source?: 'data' | 'ai' | 'placeholder';
};

export type RenderableSlide = {
  spec_id?: string;
  title: string;
  subtitle?: string | null;
  appendix?: boolean;
  fields: RenderableField[];
};

export type RenderableDeck = {
  title: string;
  method_label?: string;
  project_name?: string;
  slides: RenderableSlide[];
};

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fieldMarkup(f: RenderableField): string {
  switch (f.kind) {
    case 'title':
      return `<h1 class="text-5xl font-bold tracking-tight text-slate-900 mb-2">${esc(f.value || '')}</h1>`;
    case 'subtitle':
      return `<div class="text-xl text-violet-700 font-medium mb-4">${esc(f.value || '')}</div>`;
    case 'paragraph':
      return `<p class="text-lg text-slate-700 leading-relaxed mb-4">${esc(f.value || '')}</p>`;
    case 'bullets': {
      const arr = Array.isArray(f.value) ? f.value : [];
      if (!arr.length) return '';
      return `<ul class="space-y-2 mb-4 text-lg text-slate-800">${
        arr.map((b) => `<li class="flex gap-2"><span class="text-violet-600 font-bold">▸</span><span>${esc(b)}</span></li>`).join('')
      }</ul>`;
    }
    case 'metric_grid': {
      const cells = Array.isArray(f.value) ? f.value : [];
      if (!cells.length) return '';
      return `<div class="grid grid-cols-${Math.min(cells.length, 4)} gap-4 mb-4">${
        cells.map((c: any) => `
          <div class="border border-violet-200 rounded-lg p-4 bg-violet-50">
            <div class="text-xs uppercase tracking-wider text-violet-600 mb-1">${esc(c.label)}</div>
            <div class="text-2xl font-bold text-slate-900">${esc(c.value)}</div>
          </div>`).join('')
      }</div>`;
    }
    case 'quote':
      return f.value
        ? `<blockquote class="border-l-4 border-violet-400 pl-4 text-xl italic text-slate-700 my-4">"${esc(f.value)}"</blockquote>`
        : '';
    case 'image':
      return f.value
        ? `<img src="${esc(f.value)}" alt="" class="max-h-64 object-contain rounded mb-4" />`
        : '';
    default:
      return '';
  }
}

function slidePage(slide: RenderableSlide, brand: DeckBrand, idx: number, total: number): string {
  const title = slide.title || 'Slide';
  const subtitle = slide.subtitle ? `<div class="text-sm uppercase tracking-widest text-violet-600 mb-1">${esc(slide.subtitle)}</div>` : '';
  const heading = `<div class="mb-6">${subtitle}<h2 class="text-3xl font-semibold text-slate-900 border-b-2 border-violet-200 pb-2">${esc(title)}</h2></div>`;
  const body = slide.fields.map(fieldMarkup).join('\n');
  const watermark = brand.watermark_url
    ? `<img src="${esc(brand.watermark_url)}" alt="" class="absolute top-6 right-8 max-h-10 opacity-90" />`
    : '';
  const footer = brand.show_footer
    ? `<div class="absolute bottom-4 left-8 right-8 flex justify-between items-center text-xs text-slate-400 border-t border-slate-100 pt-2">
         <span>${esc(brand.footer_text)}</span><span>${idx + 1} / ${total}</span>
       </div>`
    : `<div class="absolute bottom-4 right-8 text-xs text-slate-300">${idx + 1} / ${total}</div>`;
  return `
    <section class="slide relative bg-white text-slate-900 px-12 py-10" style="width:1280px;height:720px;page-break-after:always;overflow:hidden;">
      ${watermark}
      ${heading}
      <div class="space-y-2">${body}</div>
      ${footer}
    </section>`;
}

export function renderDeckHTML(deck: RenderableDeck, brand: DeckBrand): string {
  const slides = deck.slides.map((s, i) => slidePage(s, brand, i, deck.slides.length)).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(deck.title)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  @page { size: 1280px 720px; margin: 0; }
  body { margin: 0; background: #fff; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .slide { box-sizing: border-box; }
</style>
</head>
<body>
${slides}
</body>
</html>`;
}
