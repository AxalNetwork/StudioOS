import React from 'react';
import { NOT_RECORDED, blockLabel, runsOf, tileValue } from './editorModel';
import { SOURCE_NOT_RECORDED, chartLabel, objectPosition, sourceOf } from './presentExportModel';
import { STATED_CHIP, TYPED_LINE, faceOf, projectionOf } from './figuresModel';
import { isTypedChart, marketCircles, projectionLines, tableView } from './typedChartsModel';
import { aspectOf, placeOf } from './gridModel';

export { gridBlocks } from './presentExportModel';

/**
 * D898's blocks on the 12 × 6 grid, drawn the one way the editor, Present and
 * the print page (the PDF and the PowerPoint pictures) all draw them (D1112,
 * #2992). Each block sits at its range, columns by rows.
 *
 * `live` makes the video, audio and link blocks real links, which Present and
 * the print page want and the editor (where a click selects the block) does
 * not. `sources` adds each metric tile's source line ("Show sources").
 * A tile with no figure reads "Not recorded", never 0. `renderChart` (the
 * editor's, D898 group C) draws a chart from its bound series with each
 * series' source chip; without it a chart is its type and series in words.
 * It is a prop, not an import, so Present and the print page never load the
 * editor's chart tools (and with them the shared UI that reaches the rail).
 *
 * D1604 (#3716, pd6, pd24): in the editor a bound tile's face says its
 * source · grade (`renderFace`, the editor's `SourceChip`, else the same
 * words in plain text). Present, share and print draw no such badge: only
 * "Show sources"' line, as before. A chart that reaches past today carries
 * "Projection" and its footnote in every format (`projectionOf`).
 */

/** The Projection label and footnote under a chart (pd6), wherever the card is drawn. */
function Projection({ block, colours, small }) {
  const p = projectionOf(block);
  if (!p) return null;
  return (
    <span className={`flex flex-col ${small}`} style={{ color: colours.muted }} data-testid={`deck-projection-${block.id}`}>
      <span className="self-start rounded-full border border-dashed px-1.5 font-bold uppercase" style={{ borderColor: colours.muted }}>{p.label} · {p.grade}</span>
      <span className="italic">{p.note}</span>
    </span>
  );
}

/**
 * D1538 (#3787): market circles and the projection line, drawn the same way in
 * the editor, Present and print. A market that does not nest, or a series
 * with fewer than two points, says so in words instead of drawing a shape.
 */
function TypedChart({ block, colours, small }) {
  if (block.chart_type === 'market_circles') {
    const circles = marketCircles(block);
    if (!circles) return <span className={`${small} italic`} style={{ color: colours.muted }}>Market circles need TAM, SAM and SOM, each inside the one before.</span>;
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={circles.map((c) => c.text).join(', ')} data-testid={`deck-market-circles-${block.id}`}>
        {circles.map((c, i) => (
          <g key={c.key}>
            <circle cx={c.cx} cy={c.cy} r={c.r} fill={colours.accent} fillOpacity={0.12 + i * 0.18} stroke={colours.accent} strokeWidth="0.6" />
            <text x="50" y={+(c.cy - c.r + (i === 2 ? c.r : 6)).toFixed(2)} textAnchor="middle" fontSize="5" fontWeight="700" fill="currentColor">{c.text}</text>
          </g>
        ))}
      </svg>
    );
  }
  const lines = projectionLines(block);
  if (!lines) return <span className={`${small} italic`} style={{ color: colours.muted }}>A projection needs two or more points.</span>;
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${block.series?.[0]?.label || 'Series'}, dashed after ${lines.from || 'today'}`} data-testid={`deck-projection-chart-${block.id}`}>
      {lines.solid ? <polyline points={lines.solid} fill="none" stroke={colours.accent} strokeWidth="1.4" vectorEffect="non-scaling-stroke" /> : null}
      {lines.dashed ? <polyline points={lines.dashed} fill="none" stroke={colours.accent} strokeWidth="1.4" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" data-testid={`deck-projection-dashed-${block.id}`} /> : null}
    </svg>
  );
}

/** D1538: a typed table: its head row, then its rows; a blank cell stays blank. */
function TableView({ block, colours, para }) {
  const { head, body } = tableView(block);
  return (
    <table className={`w-full border-collapse ${para}`} data-testid={`deck-table-${block.id}`}>
      {head ? <thead><tr>{head.map((c, i) => <th key={i} scope="col" className="border px-1 text-start font-bold" style={{ borderColor: colours.muted }}>{c}</th>)}</tr></thead> : null}
      <tbody>{body.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i} className="border px-1" style={{ borderColor: colours.muted }}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** The editor's tile face line: source · grade, never the raw key. */
function faceLine(binding) {
  const f = faceOf(binding);
  return f ? `${f.source} · ${f.grade}` : SOURCE_NOT_RECORDED;
}

/** One block's face. */
/**
 * D1500: a text block's paragraphs of runs: bold, italic, underline, an
 * accent colour (the Worker kept it only when it reads on the card) and an
 * https link, which opens in a new tab.
 */
function RichText({ paras, className }) {
  return (
    <span className={`flex flex-col gap-1 ${className}`} data-testid="deck-block-rich">
      {paras.map((runs, i) => (
        <span key={i}>
          {runs.map((r, j) => {
            const style = { fontWeight: r.b ? 800 : undefined, fontStyle: r.i ? 'italic' : undefined, textDecoration: r.u ? 'underline' : undefined, color: r.accent || undefined };
            return r.href
              ? <a key={j} href={r.href} target="_blank" rel="noopener noreferrer" className="underline" style={style}>{r.text}</a>
              : <span key={j} style={style}>{r.text}</span>;
          })}
        </span>
      ))}
    </span>
  );
}

export function BlockView({ block: b, colours, live = false, sources = false, size = 'card', renderChart = null, renderFace = null }) {
  const big = size === 'print';
  const heading = big ? 'text-[64px]' : 'text-[20px]';
  const para = big ? 'text-[30px]' : 'text-[12.5px]';
  const small = big ? 'text-[22px]' : 'text-[10.5px]';
  if (b.kind === 'text') {
    if (!String(b.text || '').trim()) return live ? null : <span className="text-[11px] italic" style={{ color: colours.muted }}>Text · empty</span>;
    // D1500: rich text is drawn as its runs, read-only (editing them is A4c's).
    const paras = runsOf(b);
    if (paras) return <RichText paras={paras} className={b.style === 'heading' ? `${heading} font-extrabold leading-tight` : `${para} leading-snug`} />;
    if (b.style === 'heading') return <span className={`${heading} font-extrabold leading-tight`}>{b.text}</span>;
    if (b.style === 'list') return <ul className={`m-0 list-disc pl-4 ${para}`}>{String(b.text).split('\n').filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}</ul>;
    return <span className={`${para} leading-snug`}>{b.text}</span>;
  }
  if (b.kind === 'metric') {
    const v = tileValue(b);
    return (
      <span className="flex h-full flex-col justify-center" data-testid={live ? `deck-block-metric-${b.id}` : undefined}>
        <span className={`${small} font-bold uppercase`} style={{ color: colours.muted }}>{b.label || 'Metric'}</span>
        <span className={v === NOT_RECORDED ? `${big ? 'text-[26px]' : 'text-[11.5px]'} italic` : `${big ? 'text-[60px]' : 'text-[20px]'} font-extrabold`}>{v}</span>
        {live ? (sources ? <span className={small} style={{ color: colours.muted }}>{sourceOf(b.binding) || SOURCE_NOT_RECORDED}</span> : null)
          : b.binding ? (renderFace ? renderFace(b) : <span className="text-[10px]" style={{ color: colours.muted }} data-testid={`deck-block-face-${b.id}`}>{faceLine(b.binding)}</span>)
            : v !== NOT_RECORDED ? <span className="text-[10px]" style={{ color: colours.muted }} title={TYPED_LINE()} data-testid={`deck-block-face-${b.id}`}>{STATED_CHIP}</span> : null}
      </span>
    );
  }
  if (b.kind === 'image') {
    // D903: the image keeps its fit and its crop (the point that stays in view); its alt text travels everywhere it is drawn.
    if (b.image_url) return <img src={b.image_url} alt={b.alt || ''} className={`h-full w-full rounded ${b.fit === 'contain' ? 'object-contain' : 'object-cover'}`} style={{ objectPosition: objectPosition(b.crop) }} />;
    return live ? null : <span className="text-[11px] italic">Image · none chosen</span>;
  }
  if (b.kind === 'video') {
    const face = (
      <span className="relative flex h-full w-full items-center justify-center rounded bg-black/80 text-white">
        {b.poster_url ? <img src={b.poster_url} alt="" className="absolute inset-0 h-full w-full rounded object-cover opacity-80" /> : null}
        <span className={`relative ${big ? 'text-[56px]' : 'text-[18px]'}`} aria-hidden="true">▶</span>
        <span className={`absolute bottom-1 left-1 right-1 truncate ${small}`}>{b.title || b.provider}</span>
      </span>
    );
    return live && b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer" className="block h-full w-full" aria-label={b.title || 'Watch the video'}>{face}</a> : face;
  }
  if (b.kind === 'audio' || b.kind === 'link') {
    const label = b.label || (b.kind === 'audio' ? 'Audio clip' : 'Open');
    const face = b.kind === 'audio'
      ? <span className={`flex items-center gap-1 ${para}`}><span aria-hidden="true">▶</span>{label}</span>
      : <span className={`inline-flex rounded-[8px] px-2 py-1 ${para} font-bold text-white`} style={{ background: colours.accent }}>{label}</span>;
    return live && b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer" className="no-underline" style={{ color: 'inherit' }}>{face}</a> : face;
  }
  if (b.kind === 'graphic') return <span className={big ? 'text-[24px]' : 'text-[11px]'} style={{ color: colours.muted }}>Graphic · {b.graphic || 'none chosen'}</span>;
  if (b.kind === 'table') return <TableView block={b} colours={colours} para={para} />;
  // D1538: market circles and projections are drawn from their typed points here, in every format, with the one Projection label.
  if (isTypedChart(b)) {
    return (
      <span className="flex h-full flex-col gap-1">
        <span className="min-h-0 flex-1"><TypedChart block={b} colours={colours} small={small} /></span>
        <Projection block={b} colours={colours} small={small} />
      </span>
    );
  }
  if (b.kind === 'chart' && renderChart) {
    return projectionOf(b)
      ? <span className="flex h-full flex-col gap-1"><span className="min-h-0 flex-1">{renderChart(b)}</span><Projection block={b} colours={colours} small={small} /></span>
      : renderChart(b);
  }
  if (b.kind === 'chart') {
    return (
      <span className={`flex h-full flex-col gap-1 ${big ? 'text-[24px]' : 'text-[11px]'}`}>
        <Projection block={b} colours={colours} small={small} />
        <b>{chartLabel(b.chart_type)} chart</b>
        {(b.series || []).map((s, i) => (
          <span key={i} style={{ color: colours.muted }}>
            {s.label || s.binding?.source_key || 'Series'}
            {Array.isArray(s.points) && s.points.length ? (live ? `: ${s.points.map((p) => `${p.x} ${p.y}`).join(' · ')}` : ` · ${STATED_CHIP}`) : ''}
          </span>
        ))}
      </span>
    );
  }
  return null;
}

/**
 * The grid itself, inside a 16:9 or 4:3 face the caller draws (`aspect`, the
 * theme's). D1499 (#3749): every block is placed with `gridModel.placeOf`,
 * `boxOf` as a share of the slide, so the editor, Present and print draw the
 * same boxes at any size; there is no CSS gap or padding, on screen or in
 * print. `onSelect` makes each block a button (the editor); without it each
 * block is a plain cell.
 */
export function BlockGrid({ blocks, colours, live = false, sources = false, size = 'card', selected = null, onSelect = null, testId = 'deck-blocks', renderChart = null, aspect = '16:9', lang = undefined, dir = undefined }) {
  // D1571 (#3818): the deck's language and direction (`deckLanguage.langAttrs`); text aligns to the start, so it mirrors.
  return (
    <div className="absolute inset-0" data-aspect={aspectOf(aspect)} lang={lang} dir={dir} data-testid={testId}>
      {blocks.map((b) => {
        const at = placeOf(b.grid, aspect);
        const inner = <BlockView block={b} colours={colours} live={live} sources={sources} size={size} renderChart={renderChart} />;
        if (onSelect) {
          return (
            <button type="button" key={b.id}
              className={`min-h-0 min-w-0 overflow-hidden rounded-[8px] p-1.5 text-start ${selected === b.id ? 'outline outline-2 outline-violet-500' : 'outline outline-1 outline-dashed outline-black/10'}`}
              style={at} onClick={() => onSelect(b.id)} aria-label={blockLabel(b)} data-testid={`pitch-editor-block-${b.id}`}>
              {inner}
            </button>
          );
        }
        return <div key={b.id} className="min-h-0 min-w-0 overflow-hidden p-1" style={at} data-testid={`deck-block-${b.id}`}>{inner}</div>;
      })}
    </div>
  );
}
