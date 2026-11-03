import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BlockGrid } from './BlockGrid';
import { cardColours } from './editorModel';
import { SLIDE_SIZES, aspectOf } from './gridModel';
import { PAIR_TITLE } from './preflightUiModel';

/**
 * D1370 (#3661, PF3) — a finding drawn on its slide, under the strip "Show me"
 * leaves (pf3, pf3b). The slide is drawn as it was checked, at export size
 * (1920 × 1080, or 1440 × 1080 at 4:3, `BlockGrid`'s print sizes), scaled to
 * fit:
 *   · the finding's block outlined (red to fix, amber dashed to look at) with
 *     its number;
 *   · cut-off text (`clip`): the words past the block's edge drawn greyed,
 *     and the edge marked with a dashed line on the side that overflows,
 *     read from the block's own box, never guessed;
 *   · low contrast (`contrast`): beside the slide, the text and background
 *     colours, their ratio and the ratio that reads reliably.
 * It draws only: nothing on the slide changes, and it takes no focus.
 */
const TONES = { fix: { line: '#b91c1c', style: 'solid' }, look: { line: '#d97706', style: 'dashed' } };
const GREY = '#a1a1aa';

export default function PreflightOverlay({ overlay, card, theme, kit }) {
  const wrap = useRef(null);
  const page = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [width, setWidth] = useState(640);
  const [box, setBox] = useState(null);
  const aspect = aspectOf(theme?.aspect);
  const size = SLIDE_SIZES[aspect] || { width: 1920, height: 1080 };
  const colours = cardColours(theme, kit);
  const bg = card?.background?.color || colours.bg;
  const blocks = Array.isArray(card?.blocks) ? card.blocks : [];
  const j = overlay?.block != null ? blocks.findIndex((b) => b?.id === overlay.block) : -1;
  const target = j >= 0 ? blocks[j] : null;

  // The display width, read from the layout (and kept as the panel or the window resizes).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const read = () => { const w = el.clientWidth; if (w > 0) setWidth(Math.min(w, 960)); };
    read();
    const Obs = globalThis.ResizeObserver;
    if (typeof Obs !== 'function') return undefined;
    const ro = new Obs(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The block's box on the export-size page, and the side its text overflows, as the browser laid them out.
  useLayoutEffect(() => {
    const grid = page.current?.querySelector?.(`[data-testid="pitch-preflight-overlay-grid"]`);
    const cell = grid && j >= 0 ? grid.children[j] : null;
    if (!cell || !(cell.offsetWidth > 0)) { setBox(null); return; }
    const right = cell.scrollWidth > cell.clientWidth + 1;
    const bottom = cell.scrollHeight > cell.clientHeight + 1;
    setBox({ x: cell.offsetLeft, y: cell.offsetTop, w: cell.offsetWidth, h: cell.offsetHeight, right, bottom });
  }, [j, card, theme, width]);

  if (!overlay || !card) return null;
  const k = width / size.width;
  const tone = TONES[overlay.tone] || TONES.look;
  const px = (n) => `${n / k}px`;
  const clip = overlay.kind === 'clip' && target;
  const css = [
    // The greyed copy shows every word, past the edge too; the real cell, on top, keeps the card behind its own box.
    clip ? `[data-pf-ghost="${uid}"] [data-testid="pitch-preflight-ghost-grid"] > * { overflow: visible !important; }
            [data-pf-ghost="${uid}"] [data-testid="pitch-preflight-ghost-grid"] * { color: ${GREY} !important; }
            [data-pf-main="${uid}"] [data-testid="pitch-preflight-overlay-grid"] > :nth-child(${j + 1}) { background: ${bg}; }` : '',
  ].join('\n');

  return (
    <figure className="m-0 mb-2 flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
      aria-label={overlay.label} data-testid="pitch-preflight-overlay" data-kind={overlay.kind}>
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[.09em] text-axal-muted dark:text-gray-400" data-testid="pitch-preflight-overlay-eyebrow">{overlay.eyebrow}</span>
      <div className="flex flex-wrap items-start gap-4">
        <div ref={wrap} className="min-w-[280px] flex-1" style={{ maxWidth: 960 }}>
          {css ? <style>{css}</style> : null}
          <div aria-hidden="true" style={{ position: 'relative', width, height: size.height * k, overflow: 'visible' }}>
            <div ref={page} style={{ position: 'absolute', left: 0, top: 0, width: size.width, height: size.height, transform: `scale(${k})`, transformOrigin: 'top left', background: bg, color: colours.ink, borderRadius: px(6), boxShadow: '0 10px 30px rgba(24,24,27,.10)' }}>
              {clip ? (
                <div data-pf-ghost={uid} style={{ position: 'absolute', inset: 0 }} data-testid="pitch-preflight-ghost">
                  <BlockGrid blocks={[target]} colours={colours} live size="print" aspect={aspect} testId="pitch-preflight-ghost-grid" />
                </div>
              ) : null}
              <div data-pf-main={uid} style={{ position: 'absolute', inset: 0 }}>
                <BlockGrid blocks={blocks} colours={colours} live size="print" aspect={aspect} testId="pitch-preflight-overlay-grid" />
              </div>
              {box ? (
                <>
                  <div data-testid="pitch-preflight-overlay-outline" style={{ position: 'absolute', left: box.x - 5 / k, top: box.y - 5 / k, width: box.w + 10 / k, height: box.h + 10 / k,
                    border: `${2 / k}px ${tone.style} ${tone.line}`, borderRadius: px(6), boxSizing: 'border-box', pointerEvents: 'none' }} />
                  {clip && box.right ? <div data-testid="pitch-preflight-overlay-edge" data-edge="right" style={{ position: 'absolute', left: box.x + box.w, top: box.y - 14 / k, height: box.h + 28 / k, borderLeft: `${2 / k}px dashed ${tone.line}` }} /> : null}
                  {clip && !box.right && box.bottom ? <div data-testid="pitch-preflight-overlay-edge" data-edge="bottom" style={{ position: 'absolute', left: box.x - 14 / k, top: box.y + box.h, width: box.w + 28 / k, borderTop: `${2 / k}px dashed ${tone.line}` }} /> : null}
                  <span style={{ position: 'absolute', left: box.x - 15 / k, top: box.y - 15 / k, width: 22 / k, height: 22 / k, borderRadius: 999, background: tone.line, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 / k, fontWeight: 800 }}>{overlay.n}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        {overlay.pair ? (
          <div className="flex w-[236px] shrink-0 flex-col gap-3 rounded-[12px] border border-axal-hairline bg-white p-3.5 dark:border-gray-700 dark:bg-gray-900"
            role="group" aria-label={overlay.pair.label} data-testid="pitch-preflight-pair">
            <span className="flex items-center gap-2 text-[13px] font-bold text-axal-ink dark:text-gray-100">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[12px] font-extrabold text-white" style={{ background: tone.line }} aria-hidden="true">{overlay.n}</span>
              {PAIR_TITLE}
            </span>
            <div className="flex gap-2">
              {[[overlay.pair.fg, 'Text'], [overlay.pair.bg, 'Background']].map(([c, l]) => (
                <div key={l} className="flex flex-1 flex-col gap-1">
                  <span aria-hidden="true" className="h-10 rounded-[8px] border border-[#e2dfe8]" style={{ background: c }} />
                  <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{l}</span>
                  <span className="font-mono text-[11px] text-gray-700 dark:text-gray-300" data-testid={`pitch-preflight-pair-${l.toLowerCase()}`}>{c}</span>
                </div>
              ))}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="whitespace-nowrap font-mono text-[24px] font-semibold text-axal-ink dark:text-gray-100" data-testid="pitch-preflight-pair-ratio">{overlay.pair.ratio}</span>
              <span className="text-[12px] text-axal-muted dark:text-gray-400">{overlay.pair.reads}</span>
            </div>
            {target?.kind === 'text' && target.text ? (
              <div className="rounded-[8px] border border-[#e2dfe8] px-3 py-2.5 text-[13px] leading-snug" style={{ background: overlay.pair.bg, color: overlay.pair.fg }} aria-hidden="true">
                {String(target.text).slice(0, 60)}{String(target.text).length > 60 ? '…' : ''}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="m-0 flex gap-2 text-[12.5px] leading-snug text-gray-700 dark:text-gray-300" data-testid="pitch-preflight-overlay-legend">
        <span className="font-mono font-bold" aria-hidden="true">{overlay.n}</span>
        <span><b className="text-axal-ink dark:text-gray-100">{overlay.legend.title}</b>{overlay.legend.detail ? ` ${overlay.legend.detail}` : ''}</span>
      </p>
    </figure>
  );
}
