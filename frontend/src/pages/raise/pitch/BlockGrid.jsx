import React from 'react';
import { NOT_RECORDED, blockLabel, tileValue } from './editorModel';
import { SOURCE_NOT_RECORDED, chartLabel, objectPosition, sourceOf } from './presentExportModel';
import { faceOf, projectionOf } from './figuresModel';

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

/** The editor's tile face line: source · grade, never the raw key. */
function faceLine(binding) {
  const f = faceOf(binding);
  return f ? `${f.source} · ${f.grade}` : SOURCE_NOT_RECORDED;
}

/** One block's face. */
export function BlockView({ block: b, colours, live = false, sources = false, size = 'card', renderChart = null, renderFace = null }) {
  const big = size === 'print';
  const heading = big ? 'text-[64px]' : 'text-[20px]';
  const para = big ? 'text-[30px]' : 'text-[12.5px]';
  const small = big ? 'text-[22px]' : 'text-[10.5px]';
  if (b.kind === 'text') {
    if (!String(b.text || '').trim()) return live ? null : <span className="text-[11px] italic" style={{ color: colours.muted }}>Text · empty</span>;
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
          : b.binding ? (renderFace ? renderFace(b) : <span className="text-[10px]" style={{ color: colours.muted }} data-testid={`deck-block-face-${b.id}`}>{faceLine(b.binding)}</span>) : null}
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
            {Array.isArray(s.points) && s.points.length ? (live ? `: ${s.points.map((p) => `${p.x} ${p.y}`).join(' · ')}` : ' · Typed') : ''}
          </span>
        ))}
      </span>
    );
  }
  return null;
}

/**
 * The grid itself, inside a 16:9 face the caller draws. `onSelect` makes each
 * block a button (the editor); without it each block is a plain cell.
 */
export function BlockGrid({ blocks, colours, live = false, sources = false, size = 'card', selected = null, onSelect = null, testId = 'deck-blocks', renderChart = null }) {
  const gap = size === 'print' ? 'gap-6 p-[3%]' : 'gap-2 p-[3%]';
  return (
    <div className={`absolute inset-0 grid ${gap}`} style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, minmax(0, 1fr))' }} data-testid={testId}>
      {blocks.map((b) => {
        const at = { gridColumn: `${b.grid.c1} / ${b.grid.c2 + 1}`, gridRow: `${b.grid.r1} / ${b.grid.r2 + 1}` };
        const inner = <BlockView block={b} colours={colours} live={live} sources={sources} size={size} renderChart={renderChart} />;
        if (onSelect) {
          return (
            <button type="button" key={b.id}
              className={`relative min-h-0 min-w-0 overflow-hidden rounded-[8px] p-1.5 text-left ${selected === b.id ? 'outline outline-2 outline-violet-500' : 'outline outline-1 outline-dashed outline-black/10'}`}
              style={at} onClick={() => onSelect(b.id)} aria-label={blockLabel(b)} data-testid={`pitch-editor-block-${b.id}`}>
              {inner}
            </button>
          );
        }
        return <div key={b.id} className="relative min-h-0 min-w-0 overflow-hidden p-1" style={at} data-testid={`deck-block-${b.id}`}>{inner}</div>;
      })}
    </div>
  );
}
