/**
 * D1575 (#3822, deck v2 E2) — the PDF that matches the screen: its page size
 * at the deck's aspect, and the check every PDF passes before it is handed out.
 *
 * THE PAGE. A studio deck (no template method, at least one card laid out on
 * The Grid) prints at its own aspect: 1920 × 1080 at 16:9, 1440 × 1080 at 4:3
 * (`SLIDE_SIZES`, the editor's and the print page's own sizes, D1499). A
 * template deck stays 1920 × 1080. The viewport, the `@page` size and the PDF
 * size all come from one `PrintPage`, so the browser never lays out a 4:3 card
 * on a 16:9 sheet.
 *
 * THE CHECK (`checkDeckPdf`), on the bytes the browser answered:
 *   · every page is the deck's size (Chrome prints CSS pixels at 0.75 pt);
 *   · every font is embedded (a FontFile, FontFile2 or FontFile3 under its
 *     descriptor), so the PDF reads the same on a machine without the font;
 *   · text is text: a deck with words prints at least one font, so a page
 *     that was flattened into a picture is refused;
 *   · links are live: every link the cards draw (a link, button, audio or
 *     provider video block's URL, and a text run's https href) is a URI link
 *     annotation.
 * A PDF that fails any of these is refused with the codes, never handed out.
 * No text and no URL appears in a code.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, PDFHexString, type PDFObject } from 'pdf-lib';

export const SLIDE_SIZES = Object.freeze({
  '16:9': Object.freeze({ width: 1920, height: 1080 }),
  '4:3': Object.freeze({ width: 1440, height: 1080 }),
});
export type Aspect = keyof typeof SLIDE_SIZES;
export const aspectOf = (v: unknown): Aspect => (v === '4:3' ? '4:3' : '16:9');
/** Chrome's PDF unit: one CSS pixel is 0.75 pt (96 px to the inch). */
export const PT_PER_PX = 0.75;

export type PrintPage = { aspect: Aspect; width: number; height: number };

/** The print page's own rule for a studio card (`PrintExtras.isStudioSlide`). */
const isStudioSlide = (s: any) => (Array.isArray(s?.blocks) && s.blocks.length > 0) || (Array.isArray(s?.fields) && s.fields.length > 0);

/** The page a deck prints on: its aspect for a studio deck, 16:9 for a template deck. */
export function printPageOf({ slides, theme, methodId }: { slides: any[]; theme: any; methodId: string | null }): PrintPage {
  const studio = !methodId && Array.isArray(slides) && slides.some(isStudioSlide);
  const aspect: Aspect = studio ? aspectOf(theme?.aspect) : '16:9';
  return { aspect, ...SLIDE_SIZES[aspect] };
}

/** Browser Rendering's options for one PDF at `page`: the viewport, the `@page` size and the PDF size agree. */
export function pdfRenderOptions(url: string, page: PrintPage, pageLoadMs: number): Record<string, unknown> {
  const w = `${page.width}px`;
  const h = `${page.height}px`;
  return {
    url,
    viewport: { width: page.width, height: page.height, deviceScaleFactor: 1 },
    gotoOptions: { waitUntil: 'networkidle0', timeout: pageLoadMs },
    addStyleTag: [{
      content: `@page { size: ${w} ${h}; margin: 0; } html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }`,
    }],
    pdfOptions: {
      printBackground: true,
      preferCSSPageSize: true,
      // Vector text and live links are Chrome's own PDF output; nothing here flattens a page to a picture.
      tagged: true,
      width: w,
      height: h,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    },
  };
}

const LINKED_KINDS = new Set(['link', 'button', 'video', 'audio']);
const httpUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
};
/** A text run's link, drawn only when it is https and the run has words (`runsOf` in `editorModel.js`). */
const httpsUrl = (v: unknown): string | null => {
  const u = httpUrl(v);
  return u && u.startsWith('https:') ? u : null;
};

/** Whether a deck carries words, so its PDF must carry a font. */
export function hasWords(slides: any[]): boolean {
  const text = (v: unknown, d = 0): boolean => {
    if (d > 6 || v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.some((x) => text(x, d + 1));
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return ['title', 'subtitle', 'text', 'body', 'label', 'value', 'bullets', 'runs', 'paras', 'rich'].some((k) => text(o[k], d + 1));
    }
    return false;
  };
  return (slides || []).some((s) => text(s?.title) || text(s?.subtitle) || text(s?.body) || text(s?.bullets)
    || (Array.isArray(s?.blocks) && s.blocks.some((b: any) => text(b))) || (Array.isArray(s?.fields) && s.fields.some((f: any) => text(f?.value))));
}

/**
 * The links the print cards draw live (`BlockView` with `live`), normalised:
 * a link, button, audio or provider video block's URL (an uploaded mp4 plays
 * in place, so it is no link), and the https href of a text run with words in
 * a text block with words.
 */
export function expectedLinks(slides: any[]): string[] {
  const out = new Set<string>();
  for (const s of slides || []) {
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) {
      if (LINKED_KINDS.has(b?.kind) && !(b.kind === 'video' && b.provider === 'mp4')) { const u = httpUrl(b.url); if (u) out.add(u); }
      if (b?.kind !== 'text' || !String(b.text ?? '').trim() || !Array.isArray(b.paras)) continue;
      for (const p of b.paras) {
        for (const r of Array.isArray(p?.runs) ? p.runs : []) {
          const u = typeof r?.text === 'string' && r.text ? httpsUrl(r.href) : null;
          if (u) out.add(u);
        }
      }
    }
  }
  return [...out].sort();
}

export type PdfCheck = { ok: true; pages: number } | { ok: false; codes: string[]; pages: number };

const str = (o: PDFObject | undefined): string | null => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : null);

/**
 * Every check on one PDF. `links` are `expectedLinks`; `words` is `hasWords`.
 * A failure lists its codes once each: `unreadable`, `no_pages`, `page_size`,
 * `font_not_embedded`, `text_flattened`, `links_missing`.
 */
export async function checkDeckPdf(bytes: Uint8Array, page: PrintPage, { links = [] as string[], words = true } = {}): Promise<PdfCheck> {
  let doc: PDFDocument;
  let pages: ReturnType<PDFDocument['getPages']>;
  // A file pdf-lib cannot read, or one with no page tree, is unreadable.
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); pages = doc.getPages(); } catch { return { ok: false, codes: ['unreadable'], pages: 0 }; }
  if (!pages.length) return { ok: false, codes: ['no_pages'], pages: 0 };
  const codes = new Set<string>();
  const ctx = doc.context;
  const look = (o: PDFObject | undefined): PDFObject | undefined => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const wantW = page.width * PT_PER_PX;
  const wantH = page.height * PT_PER_PX;
  let fonts = 0;
  const uris = new Set<string>();

  const descriptorEmbedded = (font: PDFDict): boolean => {
    let f = font;
    if (f.get(PDFName.of('Subtype'))?.toString() === '/Type0') {
      const kids = look(f.get(PDFName.of('DescendantFonts')));
      const first = kids instanceof PDFArray ? look(kids.get(0)) : undefined;
      if (!(first instanceof PDFDict)) return false;
      f = first;
    }
    // A Type3 font draws its glyphs as content: nothing to embed.
    if (f.get(PDFName.of('Subtype'))?.toString() === '/Type3') return true;
    const desc = look(f.get(PDFName.of('FontDescriptor')));
    if (!(desc instanceof PDFDict)) return false;
    return ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.get(PDFName.of(k)) !== undefined);
  };

  for (const p of pages) {
    const { width, height } = p.getSize();
    if (Math.abs(width - wantW) > 1 || Math.abs(height - wantH) > 1) codes.add('page_size');
    const res = look(p.node.get(PDFName.of('Resources')));
    const fontDict = res instanceof PDFDict ? look(res.get(PDFName.of('Font'))) : undefined;
    if (fontDict instanceof PDFDict) {
      for (const [, ref] of fontDict.entries()) {
        const font = look(ref);
        if (!(font instanceof PDFDict)) continue;
        fonts += 1;
        if (!descriptorEmbedded(font)) codes.add('font_not_embedded');
      }
    }
    const annots = look(p.node.get(PDFName.of('Annots')));
    if (annots instanceof PDFArray) {
      for (const a of annots.asArray()) {
        const annot = look(a);
        if (!(annot instanceof PDFDict) || annot.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
        const action = look(annot.get(PDFName.of('A')));
        const uri = action instanceof PDFDict ? str(look(action.get(PDFName.of('URI')))) : null;
        const u = httpUrl(uri);
        if (u) uris.add(u);
      }
    }
  }
  if (words && fonts === 0) codes.add('text_flattened');
  if (links.some((l) => !uris.has(l))) codes.add('links_missing');
  return codes.size ? { ok: false, codes: [...codes], pages: pages.length } : { ok: true, pages: pages.length };
}
