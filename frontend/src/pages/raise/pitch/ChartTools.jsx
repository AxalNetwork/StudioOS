import React, { useMemo, useState } from 'react';
import { Lightbox } from '../../../ui';
import { Chart } from '../../../ui/Charts';
import {
  CADENCE_WORD, NO_SERIES, NOT_RECORDED, ONLY_BOUND, RANGE_LABELS, RANGES, SERIES_FAILED, TYPE_NOTE, UNBOUND,
  chartBlock, chartView, chartsInDeck, dayWord, refreshSeries, seriesChanged, seriesChoices, seriesIndex, typeChoices, valueWord,
} from './chartModel';

/**
 * D898 group C (#2676, part 4 of #2434) — the bound charts on the editor's
 * card:
 *
 *   ChartBlock    a chart block drawn from its bound series (`ui/Charts.jsx`),
 *                 with each series' source chip under it, always on
 *   ChartToolbar  PD9c: the chart selected swaps Eadwyn's bar for Change type,
 *                 Series, Range, Data, Labels and Remove
 *   DataPopover   PD9: each series with its source, range, previous period,
 *                 as of and grade; Changed since … with Refresh and Keep as of
 *   ChartLibrary  PD9b: the twelve types with how many of your series each
 *                 fits (greyed with the reason when none), the charts already
 *                 in the deck to reuse, the series to plot, the options, a
 *                 preview on the card's colours, and Insert chart
 *
 * Every series comes from `GET /api/decks/chart-series`; nothing is typed in.
 * Every change waits for the editor's Save, like any other.
 */

const BTN = 'inline-flex min-h-[32px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[12px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50`;
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PANEL = 'flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900';
const SEG = (on) => `rounded-[7px] px-2.5 py-1 text-[11.5px] font-bold ${on ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-800 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`;
const TYPED = 'inline-flex items-center rounded-full border border-axal-hairline px-1.5 text-[9.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';

const today = () => new Date().toISOString().slice(0, 10);

/** The source chips under a chart, one per series, always on. */
function Chips({ chips, colours }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px]" style={colours ? { color: colours.muted } : undefined} data-testid="pitch-chart-chips">
      {chips.map((c) => <span key={c.key}>{c.typed ? <span className={TYPED}>T Typed</span> : null} {c.text}</span>)}
    </span>
  );
}

/** A chart block on the card, drawn from its bound series. */
export function ChartBlock({ block, charts, colours, on = today() }) {
  const v = chartView(block, charts, on);
  const head = <b className="text-[11px]">{(block.series || []).map((s) => s.label).filter(Boolean).join(' · ') || 'Chart'}</b>;
  if (v.state === 'loading') return <span className="text-[11px] italic" style={{ color: colours?.muted }}>Reading the series…</span>;
  if (v.state === 'unreadable') return <span className="flex flex-col gap-1 text-[11px]">{head}<span style={{ color: colours?.muted }}>{SERIES_FAILED}</span></span>;
  if (v.state === 'unbound') {
    return (
      <span className="flex h-full flex-col gap-1 text-[11px]" data-testid="pitch-chart-unbound">
        <b>{block.chart_type} chart</b>
        {(block.series || []).map((s, i) => <span key={i} style={{ color: colours?.muted }}>{s.label || s.binding?.source_key || 'Series'}{s.points ? ' · Typed' : ''}</span>)}
        <span className="italic" style={{ color: colours?.muted }}>{UNBOUND}</span>
      </span>
    );
  }
  if (v.state === 'empty' || v.state === 'unfit') {
    return (
      <span className="flex h-full flex-col gap-1 text-[11px]" data-testid={`pitch-chart-${v.state}`}>
        {head}
        <span className="italic" style={{ color: colours?.muted }}>{v.state === 'empty' ? `No point in ${RANGE_LABELS[block.range || 'all'].toLowerCase()}.` : `A ${block.chart_type} chart cannot draw these series.`}</span>
        <Chips chips={v.chips} colours={colours} />
      </span>
    );
  }
  return (
    <span className="flex h-full min-h-0 flex-col gap-1" role="img" aria-label={v.alt} data-testid="pitch-chart">
      {head}
      <span className="min-h-0 flex-1 overflow-hidden">
        {v.chart.type === 'tiles' ? (
          <span className="grid h-full grid-cols-2 gap-1.5">
            {v.chart.tiles.map((t) => (
              <span key={t.label} className="flex flex-col justify-center">
                <span className="text-[9.5px] font-bold uppercase" style={{ color: colours?.muted }}>{t.label}</span>
                <span className={t.value === NOT_RECORDED ? 'text-[11px] italic' : 'text-[16px] font-extrabold'}>{t.value}</span>
              </span>
            ))}
          </span>
        ) : <Chart chart={v.chart} />}
      </span>
      {v.labelLast.length ? <span className="text-[10px] font-bold" data-testid="pitch-chart-last">{v.labelLast.join(' · ')}</span> : null}
      <Chips chips={v.chips} colours={colours} />
    </span>
  );
}

/** PD9c's type popover: the twelve types, those the series cannot fill greyed with the reason. */
function TypePopover({ block, charts, onPick, onLibrary, onClose }) {
  const keys = (block.series || []).map((s) => s.binding?.source_key).filter(Boolean);
  const types = typeChoices(charts, keys);
  const head = (block.series || []).map((s) => s.label).filter(Boolean).join(' · ');
  return (
    <div className={PANEL} data-testid="pitch-chart-types">
      <div className="flex items-center justify-between gap-2"><span className={EYE}>Change chart type</span><span className={MUTED}>{head}</span></div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {types.map((t) => (
          <button key={t.type} type="button" disabled={t.disabled} title={t.reason || t.description}
            className={`flex flex-col items-start gap-0.5 rounded-[8px] border p-1.5 text-left text-[10.5px] font-semibold ${t.type === block.chart_type ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline dark:border-gray-700'} disabled:opacity-45 ${INK}`}
            onClick={() => onPick(t.type)} data-testid={`pitch-chart-type-${t.type}`}>
            {t.label}
            {t.disabled ? <span className="sr-only">{t.reason}</span> : null}
          </button>
        ))}
      </div>
      <span className={MUTED}>{TYPE_NOTE}</span>
      <div className="flex items-center justify-between">
        <button type="button" className="text-[12px] font-bold text-axal-violet dark:text-violet-300" onClick={onLibrary}>Open the full library ›</button>
        <button type="button" className={GHOST} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/** PD9: the Data popover, one row per series. */
export function DataPopover({ block, charts, onRefresh, onClose }) {
  const index = seriesIndex(charts);
  return (
    <div className={PANEL} data-testid="pitch-chart-data">
      <span className={EYE}>Data</span>
      {(block.series || []).map((s, i) => {
        const cur = index.get(s.binding?.source_key) || null;
        const changed = seriesChanged(cur, s.binding);
        const asOf = dayWord(s.binding?.as_of) || 'date not recorded';
        return (
          <div key={i} className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 first:border-t-0 first:pt-0 dark:border-gray-700" data-testid={`pitch-chart-data-${i}`}>
            <Row k="Series" v={<>{cur?.source === 'Typed' ? <span className={TYPED}>T Typed</span> : null} {s.label || cur?.label || s.binding?.source_key} · {cur ? `${cur.source} · ${CADENCE_WORD[cur.cadence] || ''}` : NOT_RECORDED}</>} />
            <Row k="Range" v={RANGE_LABELS[block.range || 'all']} />
            <Row k="Previous period" v={block.previous ? 'Shown, dotted' : 'Off'} />
            <Row k="As of" v={<span className="font-mono">{asOf} · {s.binding?.grade || NOT_RECORDED}</span>} />
            {cur && cur.points?.length ? <Row k="Newest" v={<span className="font-mono">{valueWord(cur.points[cur.points.length - 1].y, cur.unit)} · {dayWord(cur.as_of) || NOT_RECORDED}</span>} /> : null}
            {changed ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`pitch-chart-changed-${i}`}>
                <span>Changed since {asOf}</span>
                <span className="flex gap-2">
                  <button type="button" className="font-bold underline" onClick={() => onRefresh(i)} data-testid={`pitch-chart-refresh-${i}`}>Refresh</button>
                  <button type="button" className="font-bold underline" onClick={onClose} data-testid={`pitch-chart-keep-${i}`}>Keep as of {asOf}</button>
                </span>
              </div>
            ) : null}
            {!cur ? <span className={MUTED}>{UNBOUND}</span> : null}
          </div>
        );
      })}
      <span className={MUTED}>Refresh draws the newest snapshot and moves the chip with it. Nothing is saved until you press Save.</span>
      <div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose}>Done</button></div>
    </div>
  );
}

const Row = ({ k, v }) => <div className="flex justify-between gap-3 text-[12.5px]"><span className="text-axal-muted dark:text-gray-400">{k}</span><span className={`text-right font-semibold ${INK}`}>{v}</span></div>;

/** PD9c: the toolbar a selected chart shows in place of Eadwyn's bar. */
export function ChartToolbar({ block, charts, onPatch, onLibrary, onRemove }) {
  const [open, setOpen] = useState(null);
  const toggle = (k) => setOpen((o) => (o === k ? null : k));
  return (
    <div className="flex flex-col gap-2" data-testid="pitch-chart-toolbar">
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-axal-hairline bg-white px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900">
        <span className="text-[12px] font-bold text-axal-violet dark:text-violet-300">Chart</span>
        <button type="button" className={GHOST} aria-expanded={open === 'type'} onClick={() => toggle('type')} data-testid="pitch-chart-change-type">Change type ▾</button>
        <button type="button" className={GHOST} onClick={onLibrary} data-testid="pitch-chart-series">Series</button>
        <label className="flex items-center gap-1 text-[12px] font-semibold">
          <span className="sr-only">Range</span>
          <select className="rounded-[8px] border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" value={block.range || 'all'}
            onChange={(e) => onPatch({ range: e.target.value })} data-testid="pitch-chart-range">
            {RANGES.map((r) => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}
          </select>
        </label>
        <button type="button" className={GHOST} aria-expanded={open === 'data'} onClick={() => toggle('data')} data-testid="pitch-chart-data-open">Data</button>
        <button type="button" className={GHOST} aria-pressed={block.labels !== false} onClick={() => onPatch({ labels: block.labels === false })} data-testid="pitch-chart-labels">Labels {block.labels === false ? 'off' : 'on'}</button>
        <button type="button" className={`${GHOST} text-red-700 dark:text-red-300`} onClick={onRemove} data-testid="pitch-chart-remove">Remove</button>
      </div>
      {open === 'type' ? <TypePopover block={block} charts={charts} onPick={(t) => onPatch({ chart_type: t, previous: t === 'line' ? block.previous : false })} onLibrary={() => { setOpen(null); onLibrary(); }} onClose={() => setOpen(null)} /> : null}
      {open === 'data' ? <DataPopover block={block} charts={charts} onRefresh={(i) => onPatch(refreshSeries(block, i, charts))} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/**
 * PD9b: the chart library, as a centred lightbox. `initial` is the selected
 * chart when it opens from the toolbar (its series and type), else a new one.
 */
export function ChartLibrary({ charts, cards, initial = null, colours, onClose, onInsert, problem = null }) {
  const [keys, setKeys] = useState(() => (initial?.series || []).map((s) => s.binding?.source_key).filter(Boolean));
  const [type, setType] = useState(initial?.chart_type || 'line');
  const [range, setRange] = useState(initial?.range || '12m');
  const [previous, setPrevious] = useState(Boolean(initial?.previous));
  const [labels, setLabels] = useState(initial?.labels !== false);
  const choices = seriesChoices(charts, keys);
  const types = typeChoices(charts, keys);
  const typeNow = types.find((t) => t.type === type);
  const draft = useMemo(() => chartBlock({ type, keys, range, previous, labels }, charts), [type, keys, range, previous, labels, charts]);
  const reuse = chartsInDeck(cards).filter((c) => c.id !== initial?.id);
  const canPrevious = keys.length === 1 && type === 'line';
  const ok = keys.length > 0 && typeNow && !typeNow.disabled;
  const flip = (k) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k].slice(0, 6)));
  return (
    <Lightbox label="Chart library" title="Chart library" sub="Charts from the series your records keep. Each keeps its source chip." width={980} onClose={onClose} testId="pitch-chart-library"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={MUTED}>{ONLY_BOUND}</span>
          <span className="flex gap-2">
            <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
            <button type="button" className={PRIMARY} disabled={!ok} onClick={() => onInsert(draft)} data-testid="pitch-chart-insert">{initial ? 'Apply' : 'Insert chart'}</button>
          </span>
        </div>
      )}>
      {charts?.status === 'error' ? <p role="alert" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="pitch-chart-library-error">{SERIES_FAILED} <button type="button" className="underline" onClick={charts.retry}>Try again</button></p> : null}
      {charts?.status === 'ok' && !choices.length ? <p className={MUTED} data-testid="pitch-chart-library-none">{NO_SERIES}</p> : null}
      {problem ? <p role="alert" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="pitch-chart-library-problem">{problem}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {types.map((t) => (
              <button key={t.type} type="button" disabled={t.disabled} onClick={() => setType(t.type)}
                className={`flex flex-col items-start gap-1 rounded-[10px] border p-2 text-left ${t.type === type ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline dark:border-gray-700'} disabled:cursor-not-allowed disabled:opacity-55`}
                data-testid={`pitch-library-type-${t.type}`}>
                <b className={`text-[12.5px] ${INK}`}>{t.label}</b>
                <span className={MUTED}>{t.description}</span>
                <span className={`text-[10.5px] leading-snug ${t.disabled ? 'text-axal-muted dark:text-gray-400' : 'text-emerald-700 dark:text-emerald-300'}`} data-testid={`pitch-library-fit-${t.type}`}>
                  {t.disabled ? t.reason : `Fits ${t.fits} of your series`}
                </span>
              </button>
            ))}
          </div>
          {reuse.length ? (
            <div className="flex flex-col gap-1.5" data-testid="pitch-library-reuse">
              <span className={EYE}>Charts already in this deck</span>
              {reuse.map((c) => (
                <button key={`${c.card}-${c.id}`} type="button" className={`${GHOST} justify-start`} onClick={() => {
                  setKeys(c.block.series.map((s) => s.binding?.source_key).filter(Boolean)); setType(c.type); setRange(c.block.range || 'all');
                  setPrevious(Boolean(c.block.previous)); setLabels(c.block.labels !== false);
                }}>{c.label}</button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          <span className={EYE}>Series to plot</span>
          <div className="flex flex-col gap-1.5" data-testid="pitch-library-series">
            {choices.map((s) => (
              <label key={s.key} className={`flex items-start gap-2 text-[12.5px] ${s.blocked ? 'opacity-55' : ''}`} title={s.blocked || undefined}>
                <input type="checkbox" checked={s.chosen} disabled={Boolean(s.blocked)} onChange={() => flip(s.key)} data-testid={`pitch-library-series-${s.key}`} />
                <span className="flex flex-col">
                  <b className={INK}>{s.label}</b>
                  <span className={MUTED}>{s.source === 'Typed' ? <span className={TYPED}>T Typed</span> : null} {s.source} · {s.module} · {dayWord(s.as_of) || NOT_RECORDED} · {s.grade}</span>
                  {s.blocked ? <span className={MUTED}>{s.blocked}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="flex w-fit gap-1 rounded-[9px] bg-axal-ground p-1 dark:bg-gray-800" role="radiogroup" aria-label="Range">
            {RANGES.map((r) => <button key={r} type="button" role="radio" aria-checked={range === r} className={SEG(range === r)} onClick={() => setRange(r)}>{RANGE_LABELS[r]}</button>)}
          </div>
          <label className={`flex items-center justify-between gap-2 text-[12.5px] ${canPrevious ? '' : 'opacity-55'}`}>
            <span>Previous period, dotted{canPrevious ? '' : ' · one line series only'}</span>
            <input type="checkbox" checked={previous && canPrevious} disabled={!canPrevious} onChange={(e) => setPrevious(e.target.checked)} data-testid="pitch-library-previous" />
          </label>
          <label className="flex items-center justify-between gap-2 text-[12.5px]"><span>Label the last value</span><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} data-testid="pitch-library-labels" /></label>
          <label className="flex items-center justify-between gap-2 text-[12.5px]"><span>Source chip under the chart · always on</span><input type="checkbox" checked disabled readOnly /></label>
          <div className="flex aspect-video flex-col overflow-hidden rounded-[8px] border border-axal-hairline p-2.5 dark:border-gray-700" style={colours ? { background: colours.bg, color: colours.ink } : undefined} data-testid="pitch-library-preview">
            {keys.length ? <ChartBlock block={draft} charts={charts} colours={colours} /> : <span className={MUTED}>Choose a series to preview the chart.</span>}
          </div>
        </div>
      </div>
    </Lightbox>
  );
}
