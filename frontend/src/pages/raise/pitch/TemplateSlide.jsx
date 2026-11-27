/**
 * D8770 (#8770, canvas PTP02 to PTP04, PTP12 to PTP15) — a template's card in
 * the template's own face, laid out once at its export size and scaled.
 *
 *   TemplateSlide     one card: `BlockGrid` at 1920 × 1080 (`size="print"`,
 *                     the page the PDF and PowerPoint photograph), scaled to
 *                     the width it is given as one picture, so it never
 *                     re-wraps or clips at a small size. Charts are plotted
 *                     (`PreviewChart`), a missing image is a labelled frame,
 *                     and an Example card carries its badge and source line
 *                     on the slide. After it lays out, each area is measured
 *                     in the real DOM (`preflightMeasure.measureBlocks`); an
 *                     area that runs past its box, or a card too small to
 *                     read, says so and offers Open full size.
 *   TemplateFullSize  one card at full width with Previous, Next, ← → and
 *                     Read this slide: the takeaway, the chart's data as a
 *                     table, the source and what the blank structure holds.
 *   ViewSwitch        Example / Blank structure, two `aria-pressed` buttons.
 *
 * Reads and draws only.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lightbox } from '../../../ui';
import { BlockGrid } from './BlockGrid';
import { measureBlocks } from './preflightMeasure';
import { boxOf, ratioOf } from './gridModel';
import { EMPTY_CARD, cardOf, chartLabel } from './presentExportModel';
import {
  IN_BLANK, KEYS_LINE, OPEN_FULL, READ_SLIDE, RUNS_PAST, TOO_SMALL, VIEWS, VIEW_GROUP,
  chartPlan, fontsHref, layoutSize, overflowing, readSlide, sourceLine, tooSmall, withMedia,
} from './templatePreviewModel';
import { EXAMPLE_BADGE, EXAMPLE_COMPANY, EXAMPLE_NOTE } from './templateExamples';

const SMALL = 'text-[11.5px] text-axal-muted dark:text-gray-400';
const GHOST = 'inline-flex min-h-[32px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

const loaded = new Set();
/** The theme's faces, from Google Fonts (each under an open licence), once per page. */
export function useThemeFonts(theme) {
  const href = fontsHref(theme);
  useEffect(() => {
    if (!href || loaded.has(href) || typeof document === 'undefined' || !document.head) return;
    loaded.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-template-fonts', '');
    document.head.appendChild(link);
  }, [href]);
}

/** The width the element is drawn at, followed as it changes. */
function useWidth(ref, initial) {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => { const w = el.getBoundingClientRect?.().width; if (Number.isFinite(w) && w > 0) setWidth(w); };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const AXIS = 22;
const PAD = 4; // BlockGrid's cell padding (p-1) at export size

/** One series' panel: plotted from 0 with its unit and last value, or stepped down (PTP12). */
function Panel({ p, colour, face, w, h }) {
  const head = <text x="0" y="28" fontSize="26" fontWeight="700" fill={face.ink} fontFamily={face.body}>{p.label}{p.unitName ? ` · ${p.unitName}` : ''}</text>;
  if (p.state !== 'line') {
    return (
      <g>
        {head}
        <text x="0" y={Math.min(h - 40, 100)} fontSize="48" fontWeight="700" fill={p.state === 'none' ? face.muted : colour} fontFamily={face.display} fontStyle={p.state === 'none' ? 'italic' : undefined}>{p.line}</text>
        {p.chip ? <text x="0" y={Math.min(h - 6, 140)} fontSize={AXIS} fill={face.muted} fontFamily={face.mono}>{p.chip}</text> : null}
        {p.state === 'figure' ? <text x="0" y={Math.min(h - 6, 140)} fontSize={AXIS} fill={face.muted} fontFamily={face.mono}>{p.when}</text> : null}
        {p.state === 'none' ? <text x="0" y={Math.min(h - 6, 140)} fontSize={AXIS} fill={face.muted} fontFamily={face.body}>{p.from}</text> : null}
      </g>
    );
  }
  const L = 100; const R = 150; const T = 52; const B = 40;
  const top = p.ticks[p.ticks.length - 1] || 1;
  const x = (i) => L + (i * (w - L - R)) / Math.max(1, p.points.length - 1);
  const y = (v) => T + (1 - v / top) * (h - T - B);
  const path = p.points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.y).toFixed(1)}`).join(' ');
  const last = p.points[p.points.length - 1];
  return (
    <g>
      {head}
      {p.ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={w - R} y1={y(t)} y2={y(t)} stroke={face.hairline} strokeWidth="2" />
          <text x={L - 12} y={y(t) + 8} textAnchor="end" fontSize={AXIS} fill={face.muted} fontFamily={face.mono}>{formatTick(t, p.unit)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke={colour} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
      {p.points.map((pt, i) => <circle key={i} cx={x(i)} cy={y(pt.y)} r={i === p.points.length - 1 ? 9 : 5} fill={colour} />)}
      <text x={x(p.points.length - 1) + 16} y={y(last.y) + 9} fontSize="28" fontWeight="700" fill={colour} fontFamily={face.mono}>{p.last}</text>
      {p.xLabels.map((l, i) => <text key={i} x={x(i)} y={h - 8} textAnchor={i === p.xLabels.length - 1 ? 'end' : 'middle'} fontSize={AXIS} fill={face.muted} fontFamily={face.mono}>{l}</text>)}
    </g>
  );
}

function formatTick(t, unit) {
  if (unit === 'usd') return t >= 1000 ? `$${+(t / 1000).toFixed(1)}k` : `$${t}`;
  return String(t);
}

/**
 * The preview's chart: plotted panels (two units never share an axis), ranked
 * bars, a comparison table, a use-of-funds bar or a roadmap's milestones, or
 * the dashed frame that says what fills it (canvas PTP12, PTP15). A plotted
 * chart is drawn in its area's own pixels and shrinks, never spills, when
 * `BlockView` puts a Projection note under it.
 */
export function PreviewChart({ block, face, aspect = '16:9' }) {
  const plan = chartPlan(block);
  const box = boxOf(block.grid, aspect);
  const w = Math.max(1, box.w - PAD * 2);
  const h = Math.max(1, box.h - PAD * 2);
  const chart = face.chart || [];
  if (plan.kind === 'panels') {
    const gap = 28;
    const ph = (h - gap * (plan.panels.length - 1)) / plan.panels.length;
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMin meet" style={{ display: 'block' }} role="img" aria-label={plan.panels.map((p) => `${p.label}: ${p.state === 'line' ? `last ${p.last}` : p.line}`).join('; ')} data-testid={`template-chart-${block.id}`} data-plan="panels">
        {plan.panels.map((p, i) => (
          <g key={i} transform={`translate(0 ${(ph + gap) * i})`} data-state={p.state}>
            <Panel p={p} colour={chart[i % chart.length] || face.accent} face={face} w={w} h={ph} />
          </g>
        ))}
      </svg>
    );
  }
  if (plan.kind === 'bars') {
    const row = Math.min(90, h / plan.bars.length);
    const L = Math.min(380, w * 0.36); const R = 160;
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMin meet" style={{ display: 'block' }} role="img" aria-label={plan.bars.map((b) => `${b.label}: ${b.valueLabel}`).join('; ')} data-testid={`template-chart-${block.id}`} data-plan="bars">
        {plan.bars.map((b, i) => (
          <g key={i} transform={`translate(0 ${i * row})`}>
            <text x="0" y={row / 2 + 9} fontSize="26" fill={face.ink} fontFamily={face.body}>{b.label}</text>
            {b.value != null ? <rect x={L} y={row * 0.2} height={row * 0.6} width={Math.max(4, ((w - L - R) * b.value) / plan.max)} fill={chart[i % chart.length] || face.accent} /> : null}
            <text x={b.value != null ? L + ((w - L - R) * b.value) / plan.max + 14 : L} y={row / 2 + 9} fontSize="26" fontWeight="700" fill={face.ink} fontFamily={face.mono}>{b.valueLabel}</text>
          </g>
        ))}
      </svg>
    );
  }
  if (plan.kind === 'table') {
    const glyph = (c) => (/^yes$/i.test(c) ? `✓ ${c}` : /^no$/i.test(c) ? `✗ ${c}` : /^partial/i.test(c) ? `◐ ${c}` : c);
    return (
      <table className="w-full border-collapse" style={{ fontSize: 26, fontFamily: face.body, color: face.ink }} data-testid={`template-chart-${block.id}`} data-plan="table">
        {plan.head ? <thead><tr>{plan.head.map((c, i) => <th key={i} scope="col" className="px-3 py-3 text-start" style={{ borderBottom: `3px solid ${face.ink}`, fontWeight: 700, color: i === 1 ? face.accent : face.ink }}>{c}</th>)}</tr></thead> : null}
        <tbody>{plan.rows.map((r, k) => <tr key={k}>{r.map((c, i) => (i === 0
          ? <th key={i} scope="row" className="px-3 py-3 text-start font-semibold" style={{ borderBottom: `2px solid ${face.hairline}` }}>{c}</th>
          : <td key={i} className="px-3 py-3" style={{ borderBottom: `2px solid ${face.hairline}`, fontWeight: i === 1 ? 700 : 400 }}>{glyph(c)}</td>))}</tr>)}</tbody>
      </table>
    );
  }
  if (plan.kind === 'shares') {
    let at = 0;
    return (
      <div className="flex h-full flex-col gap-5" style={{ fontFamily: face.body, color: face.ink }} data-testid={`template-chart-${block.id}`} data-plan="shares">
        <span style={{ fontSize: 26, fontWeight: 700 }}>Use of funds · US$ · total {plan.totalLabel}</span>
        <svg width={w} height="90" viewBox={`0 0 ${w} 90`} role="img" aria-label={plan.items.map((i) => `${i.label} ${i.valueLabel}, ${i.share}%`).join('; ')}>
          {plan.items.map((it, i) => {
            const x = (at / plan.total) * w; const width = (it.value / plan.total) * w; at += it.value;
            return <rect key={i} x={x} y="0" width={Math.max(0, width - 4)} height="90" fill={chart[i % chart.length] || face.accent} />;
          })}
        </svg>
        <span className="grid grid-cols-2 gap-x-10 gap-y-3" style={{ fontSize: 26 }}>
          {plan.items.map((it, i) => (
            <span key={i} className="flex items-center gap-3">
              <span aria-hidden="true" style={{ width: 22, height: 22, background: chart[i % chart.length] || face.accent, display: 'inline-block' }} />
              <span>{it.label}</span>
              <b style={{ fontFamily: face.mono }}>{it.valueLabel} · {it.share}%</b>
            </span>
          ))}
        </span>
      </div>
    );
  }
  if (plan.kind === 'milestones') {
    return (
      <ol className="m-0 grid h-full list-none items-start gap-8 p-0" style={{ gridTemplateColumns: `repeat(${plan.items.length}, minmax(0, 1fr))`, fontFamily: face.body, color: face.ink, borderTop: `4px solid ${face.accent}`, paddingTop: 28 }} data-testid={`template-chart-${block.id}`} data-plan="milestones">
        {plan.items.map((m, i) => (
          <li key={i} className="flex flex-col gap-2">
            <span style={{ fontFamily: face.mono, fontSize: 24, color: face.accent, fontWeight: 700 }}>{m.when}</span>
            <span style={{ fontSize: 30, lineHeight: 1.3 }}>{m.what}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-8" style={{ border: `4px dashed ${face.muted}`, fontFamily: face.body, color: face.ink }} data-testid={`template-chart-${block.id}`} data-plan="blank">
      <b style={{ fontSize: 30 }}>{chartLabel(plan.type)} chart</b>
      {plan.labels.length ? <span style={{ fontSize: 26, color: face.muted }}>{plan.labels.join(' · ')}</span> : null}
      <span style={{ fontSize: 24, color: face.muted, fontStyle: 'italic' }}>{plan.from}</span>
    </div>
  );
}

/** A card with no grid blocks (a saved template's fielded card), at export size the way the print page draws one. */
function FieldedCard({ slide, index, face }) {
  const card = cardOf(slide, index);
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '120px 112px 96px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ fontFamily: face.display, fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>{card.sub || card.title}</div>
      {card.lines.map((l, k) => <p key={k} style={{ margin: 0, fontSize: 30, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{l}</p>)}
      {card.bullets.length ? <ul style={{ margin: 0, paddingInlineStart: 40, fontSize: 30, lineHeight: 1.5 }}>{card.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul> : null}
      {card.empty && !card.sub ? <p style={{ margin: 0, fontSize: 30, color: face.muted }}>{EMPTY_CARD}</p> : null}
    </div>
  );
}

/**
 * One card in the template's face, laid out at export size and scaled to its
 * width. `label` is its accessible name (the picture itself is hidden from
 * assistive technology; Read this slide gives the words).
 */
export default function TemplateSlide({ slide, index = 0, count = 1, face, aspect = '16:9', label = '', onOpen = null, initialWidth = 320, notes = true, testId = 'template-slide' }) {
  const outer = useRef(null);
  const frame = useRef(null);
  const width = useWidth(outer, initialWidth);
  const size = layoutSize(aspect);
  const scale = width / size.width;
  const blocks = useMemo(() => withMedia((Array.isArray(slide?.blocks) ? slide.blocks : []).filter((b) => b?.grid), face), [slide, face]);
  const [over, setOver] = useState([]);
  const [measured, setMeasured] = useState(false);
  const gridId = `${testId}-grid`;
  useEffect(() => {
    let live = true;
    const run = () => {
      if (!live || !frame.current || typeof frame.current.querySelectorAll !== 'function') return;
      const cells = [...frame.current.querySelectorAll(`[data-testid="${gridId}"] > div`)];
      const measured = measureBlocks(cells.map((el) => ({ card: index, block: String(el.getAttribute('data-testid') || '').replace(/^deck-block-/, ''), el })));
      const next = overflowing(measured);
      setOver((was) => (was.length === next.length && was.every((k, j) => k === next[j]) ? was : next));
      setMeasured(true);
    };
    const ready = typeof document !== 'undefined' ? document.fonts?.ready : null;
    if (ready && typeof ready.then === 'function') ready.then(run, run); else run();
    return () => { live = false; };
  }, [blocks, face, index, gridId]);
  const small = tooSmall(width, aspect);
  const source = sourceLine(slide);
  const chrome = { position: 'absolute', fontFamily: face.mono, fontSize: 22, color: face.muted, letterSpacing: '0.04em' };
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId} data-overflow={over.length ? 'true' : 'false'} data-measured={measured ? 'true' : 'false'} data-small={small ? 'true' : 'false'} data-view={slide?.example ? 'example' : 'blank'}>
      <div ref={outer} role="img" aria-label={label || undefined} className="relative w-full overflow-hidden rounded-[6px] border border-axal-hairline dark:border-gray-700" style={{ aspectRatio: ratioOf(aspect), background: face.bg }}>
        <div ref={frame} aria-hidden="true" data-testid={`${testId}-frame`} data-scale={scale.toFixed(4)}
          style={{ position: 'absolute', left: 0, top: 0, width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: '0 0', background: face.bg, color: face.ink, fontFamily: face.body, overflow: 'hidden' }}>
          {blocks.length
            ? <BlockGrid blocks={blocks} colours={face} live size="print" aspect={aspect} testId={gridId} renderChart={(b) => <PreviewChart block={b} face={face} aspect={aspect} />} />
            : <FieldedCard slide={slide} index={index} face={face} />}
          <span style={{ ...chrome, left: 112, top: 36 }}>{slide?.example ? EXAMPLE_COMPANY : '[Venture name]'}</span>
          {slide?.example ? (
            <span style={{ position: 'absolute', right: 112, top: 26, padding: '6px 18px', border: `3px solid ${face.accent}`, color: face.accent, fontFamily: face.mono, fontSize: 24, fontWeight: 700, background: face.bg }} data-testid={`${testId}-badge`}>{EXAMPLE_BADGE}</span>
          ) : null}
          {source ? <span style={{ ...chrome, left: 112, bottom: 30 }} data-testid={`${testId}-source`}>{source}</span> : null}
          <span style={{ ...chrome, right: 112, bottom: 30 }}>{String(index + 1).padStart(2, '0')}</span>
        </div>
      </div>
      {notes && (small || over.length || onOpen) ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {over.length ? <span className="text-[11.5px] font-semibold text-amber-800 dark:text-amber-300" role="note" data-testid={`${testId}-runs-past`}>{RUNS_PAST}</span> : null}
          {small && !over.length ? <span className={SMALL} data-testid={`${testId}-too-small`}>{TOO_SMALL}</span> : null}
          {onOpen ? <button type="button" className="min-h-[28px] text-[11.5px] font-bold text-axal-violet underline-offset-2 hover:underline dark:text-violet-300" onClick={onOpen} aria-label={`${OPEN_FULL}: slide ${index + 1} of ${count}${slide?.title ? `, ${slide.title}` : ''}`} data-testid={`${testId}-open`}>{OPEN_FULL}</button> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Example / Blank structure (canvas PTP01 to PTP04). */
export function ViewSwitch({ view, onChange, testId = 'template-view' }) {
  return (
    <div role="group" aria-label={VIEW_GROUP} className="flex gap-1 self-start rounded-[9px] bg-axal-ground p-1 dark:bg-gray-800" data-testid={testId}>
      {Object.entries(VIEWS).map(([id, text]) => (
        <button key={id} type="button" aria-pressed={view === id} onClick={() => onChange(id)}
          className={`min-h-[32px] rounded-[7px] px-3 text-[12px] font-bold ${view === id ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-900 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}
          data-testid={`${testId}-${id}`}>{text}</button>
      ))}
    </div>
  );
}

/** Read this slide: the takeaway, the data as a table, the source, and the blank structure in words. */
export function ReadThisSlide({ read }) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5" aria-label={READ_SLIDE} data-testid="template-read">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{READ_SLIDE}</span>
      {read.takeaway ? <h3 className="m-0 text-[15px] font-extrabold leading-snug text-axal-ink dark:text-gray-100" data-testid="template-read-takeaway">{read.takeaway}</h3> : null}
      {read.example ? <p className="m-0 rounded-[8px] bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="template-read-example">{EXAMPLE_NOTE}</p> : null}
      {read.table ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] text-axal-ink dark:text-gray-100" data-testid="template-read-table">
            <caption className="sr-only">The chart’s data</caption>
            <thead><tr>{read.table.head.map((c, i) => <th key={i} scope="col" className="border-b border-axal-hairline px-1.5 py-1 text-start font-bold dark:border-gray-700">{c}</th>)}</tr></thead>
            <tbody>{read.table.rows.map((r, k) => <tr key={k}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row" className="border-b border-axal-hairline px-1.5 py-1 text-start font-semibold dark:border-gray-700">{c}</th> : <td key={i} className="border-b border-axal-hairline px-1.5 py-1 font-mono dark:border-gray-700">{c}</td>))}</tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {read.source ? <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400" data-testid="template-read-source">{read.source}</span> : null}
      {read.blank.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{IN_BLANK}</span>
          <ul className="m-0 flex list-disc flex-col gap-0.5 ps-4 text-[12px] text-axal-muted dark:text-gray-400" data-testid="template-read-blank">{read.blank.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Full size (canvas PTP04): one card at the dialog's width, Previous and Next
 * (and ← →), and Read this slide. `blank` are the store's cards, `shown` the
 * cards the chosen view draws.
 */
export function TemplateFullSize({ blank, shown, at, onMove, onClose, view, onView, face, aspect = '16:9' }) {
  const n = shown.length;
  const i = Math.min(Math.max(0, at), Math.max(0, n - 1));
  const read = readSlide(blank[i], shown[i], i, n);
  const move = useRef(onMove);
  move.current = onMove;
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); move.current(i - 1); }
      if (e.key === 'ArrowRight' && i < n - 1) { e.preventDefault(); move.current(i + 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, n]);
  const title = (k) => blank[k]?.title || `Card ${k + 1}`;
  return (
    <Lightbox label={read.heading} title={read.heading} width={1240} onClose={onClose} testId="template-full">
      <div className="flex flex-col gap-3">
        <ViewSwitch view={view} onChange={onView} testId="template-full-view" />
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-2">
            <TemplateSlide key={`${view}-${i}`} slide={shown[i]} index={i} count={n} face={face} aspect={aspect} label={read.takeaway || title(i)} initialWidth={860} testId="template-full-slide" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className={GHOST} disabled={i === 0} onClick={() => onMove(i - 1)} aria-label={i > 0 ? `Previous: slide ${i}, ${title(i - 1)}` : 'Previous'} data-testid="template-full-prev">‹ {i > 0 ? title(i - 1) : 'Previous'}</button>
              <span className={SMALL}>{KEYS_LINE}</span>
              <button type="button" className={GHOST} disabled={i >= n - 1} onClick={() => onMove(i + 1)} aria-label={i < n - 1 ? `Next: slide ${i + 2}, ${title(i + 1)}` : 'Next'} data-testid="template-full-next">{i < n - 1 ? title(i + 1) : 'Next'} ›</button>
            </div>
          </div>
          <ReadThisSlide read={read} />
        </div>
      </div>
    </Lightbox>
  );
}
