import React from 'react';
import { BlockGrid } from './BlockGrid';
import { SLIDE_SIZES, aspectOf } from './gridModel';
import { EMPTY_CARD, NO_NOTES, cardOf } from './presentExportModel';
import CardCompliance from './CardCompliance';
import { langAttrs } from './deckLanguage';

/**
 * D1112 (#2992) — what the headless print page (`/deck/print-export/:token`)
 * draws for a studio card and for PD17's two options. Browser Rendering prints
 * it to the PDF and photographs it, one page at a time, for PowerPoint, so
 * each part is exactly one 1920 × 1080 page (`data-slide-frame`).
 *
 *   StudioPrintCard  a card the editor laid out on D898's grid, from its
 *                    blocks; else a fielded card, as Present draws it. D1546:
 *                    with its compliance chrome (`CardCompliance`).
 *   NotesPages       the speaker notes, six cards a page, after the cards
 *                    (the PDF only: PowerPoint carries them as speaker notes).
 *   SourcesPage      the Sources appendix the Worker sends with the version
 *                    (`sources_appendix`), the same lines as the HTML file's.
 *
 * The notes and the appendix are drawn only when the token the founder's own
 * export signed asked for them; the Worker sends neither otherwise.
 */

export const PAGE_W = 1920;
export const PAGE_H = 1080;
const PAGE = { width: PAGE_W, height: PAGE_H, boxSizing: 'border-box', position: 'relative', overflow: 'hidden', background: '#fbfaf7', color: '#0f2a3d', fontFamily: 'Outfit, sans-serif' };
const COLOURS = { bg: '#fbfaf7', ink: '#0f2a3d', accent: '#6d28d9', muted: '#64748b' };
const EYE = { fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', color: '#6d28d9', fontWeight: 700 };
export const NOTES_PER_PAGE = 6;
export const NO_SOURCES = 'This version does not record where its figures come from.';
/** Not the same as none: the appendix did not come with the version. */
export const SOURCES_NOT_SENT = 'The Sources appendix did not come with this version, so it is not shown. That is not the same as none.';

/** Does this slide belong to the studio (D897's fields, D898's blocks) rather than a template? */
export const isStudioSlide = (s) => (Array.isArray(s?.blocks) && s.blocks.length > 0) || (Array.isArray(s?.fields) && s.fields.length > 0);

export function StudioPrintCard({ slide, index, aspect = '16:9', chrome = null, theme = null }) {
  const card = cardOf(slide, index);
  // D1571 (#3818): the printed page reads in the deck's language and direction.
  const words = langAttrs(theme);
  if (card.blocks.length) {
    // D1499: the page is the slide itself, 1920 × 1080 or 1440 × 1080, so `boxOf`'s boxes print at their own pixels.
    return (
      <div data-slide-frame="" style={{ ...PAGE, width: SLIDE_SIZES[aspectOf(aspect)].width }} {...words} data-testid={`print-card-${index}`} data-layout="grid">
        <BlockGrid blocks={card.blocks} colours={COLOURS} live size="print" aspect={aspect} lang={words.lang} dir={words.dir} testId={`print-blocks-${index}`} />
        <CardCompliance chrome={chrome} size="print" testId={`print-compliance-${index}`} />
      </div>
    );
  }
  return (
    <div data-slide-frame="" style={{ ...PAGE, padding: 96, display: 'flex', flexDirection: 'column', gap: 28, textAlign: 'start' }} {...words} data-testid={`print-card-${index}`}>
      <div style={EYE}>{card.n} · {card.title}{card.appendix ? ' · Appendix' : ''}</div>
      {card.sub ? <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>{card.sub}</div> : null}
      {card.lines.map((l, k) => <p key={k} style={{ margin: 0, fontSize: 30, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{l}</p>)}
      {card.bullets.length ? <ul style={{ margin: 0, paddingInlineStart: 40, fontSize: 30, lineHeight: 1.5 }}>{card.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul> : null}
      {card.figures.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {card.figures.map((f, k) => (
            <div key={k} style={{ border: '2px solid #e5e7eb', borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 22, color: '#64748b' }}>{f.k}</div>
              <div style={{ fontSize: 44, fontWeight: 700 }}>{f.v}</div>
            </div>
          ))}
        </div>
      ) : null}
      {card.image ? <img src={card.image} alt={card.title} style={{ maxHeight: '45%', alignSelf: 'flex-start', objectFit: 'contain', borderRadius: 12 }} /> : null}
      {card.empty ? <p style={{ margin: 0, fontSize: 30, color: '#64748b' }}>{EMPTY_CARD}</p> : null}
      <CardCompliance chrome={chrome} size="print" testId={`print-compliance-${index}`} />
    </div>
  );
}

/** The cards' notes, `NOTES_PER_PAGE` a page, in card order. A card with none says so. */
export function notesPages(slides) {
  const rows = (Array.isArray(slides) ? slides : []).map((s, i) => ({
    n: String(i + 1).padStart(2, '0'),
    title: String(s?.title ?? '').trim() || `Card ${i + 1}`,
    notes: String(s?.notes ?? '').trim() || null,
  }));
  const pages = [];
  for (let i = 0; i < rows.length; i += NOTES_PER_PAGE) pages.push(rows.slice(i, i + NOTES_PER_PAGE));
  return pages;
}

export function NotesPages({ slides }) {
  return notesPages(slides).map((rows, p) => (
    <div key={`notes-${p}`} data-slide-frame="" style={{ ...PAGE, padding: 96, display: 'flex', flexDirection: 'column', gap: 24 }} data-testid={`print-notes-${p}`}>
      <div style={EYE}>Speaker notes</div>
      {rows.map((r) => (
        <div key={r.n} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{r.n} · {r.title}</div>
          <div style={{ fontSize: 24, lineHeight: 1.45, whiteSpace: 'pre-line', color: r.notes ? '#0f2a3d' : '#64748b' }}>{r.notes || NO_NOTES}</div>
        </div>
      ))}
    </div>
  ));
}

export function SourcesPage({ appendix }) {
  const lines = Array.isArray(appendix?.lines) ? appendix.lines : null;
  const ai = Array.isArray(appendix?.ai) ? appendix.ai : [];
  return (
    <div data-slide-frame="" style={{ ...PAGE, padding: 96, display: 'flex', flexDirection: 'column', gap: 20 }} data-testid="print-sources">
      <div style={EYE}>Appendix</div>
      <div style={{ fontSize: 56, fontWeight: 700 }}>Sources</div>
      {lines === null ? <p style={{ margin: 0, fontSize: 26, color: '#64748b' }}>{SOURCES_NOT_SENT}</p> : null}
      {lines && !lines.length ? <p style={{ margin: 0, fontSize: 26 }}>{NO_SOURCES}</p> : null}
      {lines && lines.length ? (
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lines.map((l, k) => (
            <div key={k}>
              <dt style={{ fontSize: 22, color: '#475569' }}>Card {l.card} ({l.title}) · {l.figure}</dt>
              <dd style={{ margin: 0, fontSize: 24 }}>{l.line}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {ai.length ? <p style={{ margin: 0, fontSize: 22 }}>Written with AI help: {ai.map((r) => `card ${r.card} (${r.title})`).join(', ')}.</p> : null}
    </div>
  );
}
