/**
 * D1574 (#3821, deck v2 E1): a chart block as a native PowerPoint chart.
 *
 * The chart part (`ppt/charts/chartN.xml`, DrawingML `c:chartSpace`) carries
 * its numbers in its own cache, so PowerPoint, Keynote and Google Slides draw
 * it without opening anything. It also points at an embedded workbook
 * (`ppt/embeddings/chartN.xlsx`) holding the same numbers, so PowerPoint's
 * "Edit Data" opens them as a sheet.
 *
 * WHAT IS PLOTTED. Only what the deck holds:
 *   - a typed series' own points (PD9's Typed series, graded Stated);
 *   - a bound series' points as its store reads them now (`chartSeries.ts`),
 *     cut at the binding's `as_of` (Keep as of never draws a later month).
 * A category one series has no point for is left out of that series (a gap,
 * `dispBlanksAs="gap"`), never a 0. A chart with no point at all is not
 * written as a chart: the writer falls back to its picture or its words.
 *
 * TYPES. Line and projection are a line chart; columns, waterfall and nested
 * bars are clustered columns; stacked and 100% bars are stacked columns;
 * ranked bars and the funnel are horizontal bars, biggest first. The types
 * with no native counterpart (cohort heatmap, timeline, metric tiles,
 * comparison table, market circles) answer null here.
 *
 * PROJECTION (pd8b: "A projection keeps its label in every format"). A chart
 * with a point after today's month is titled "Projection", and on a line
 * chart each point past today is dashed, the editor's way (`projectionOf`).
 *
 * Pure: no binding, no fetch. Nothing here logs a label or a figure.
 */
import { buildZip, xmlEsc, type ZipEntry } from './pptx';
import { PROJECTION_LABEL } from './recordSources';

export type Point = { x: string; y: number };
/** A bound series' points by its source key, as the store reads them now. */
export type ResolvedSeries = Map<string, Point[]>;

export type ChartPlan = {
  kind: 'line' | 'bar';
  dir: 'col' | 'bar';
  grouping: 'clustered' | 'stacked' | 'percentStacked';
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
  /** The first month past today, when the chart reaches past it. */
  projectionFrom: string | null;
  labels: boolean;
};

const LINE = new Set(['line', 'projection']);
const COLUMNS = new Set(['columns', 'waterfall', 'nested_bars']);
const STACKED = new Set(['stacked']);
const PERCENT = new Set(['percent_bar']);
const RANKED = new Set(['ranked_bars', 'funnel']);
/** The chart types written as a native chart; every other type is a picture or words. */
export const NATIVE_CHART_TYPES = Object.freeze([...LINE, ...COLUMNS, ...STACKED, ...PERCENT, ...RANKED]);

const RANGE_MONTHS: Record<string, number> = { '3m': 3, '6m': 6, '12m': 12 };
const monthOf = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null);
const finite = (p: any): p is Point => p && typeof p.x === 'string' && typeof p.y === 'number' && Number.isFinite(p.y);

/** One series' points: its own typed points, or its binding's store points up to the binding's `as_of`. */
export function seriesPoints(sr: any, resolved: ResolvedSeries | null | undefined): Point[] {
  if (Array.isArray(sr?.points)) return sr.points.filter(finite);
  const key = sr?.binding?.source_key;
  if (typeof key !== 'string' || !resolved?.has(key)) return [];
  const asOf = typeof sr.binding.as_of === 'string' ? sr.binding.as_of.slice(0, 10) : null;
  return (resolved.get(key) || []).filter(finite).filter((p) => !asOf || p.x.slice(0, 10) <= asOf);
}

/** The first month a chart draws after today's, or null: the editor's `projectionOf`. */
export function projectionFromOf(b: any, resolved: ResolvedSeries | null | undefined, today: string): string | null {
  const now = monthOf(today);
  if (!now || b?.kind !== 'chart') return null;
  let from: string | null = null;
  for (const sr of Array.isArray(b.series) ? b.series : []) {
    for (const p of seriesPoints(sr, resolved)) {
      const m = monthOf(p.x);
      if (m && m > now && (!from || m < from)) from = m;
    }
  }
  return from;
}

/**
 * pd8b: "A projection keeps its label in every format." A chart's heading
 * (`label`, such as "Line chart") as "Projection · Line chart" when the chart
 * reaches past today's month. Every writer heads a chart with this.
 */
export function chartHeading(label: string, b: any, today: string, resolved: ResolvedSeries | null = null): string {
  return projectionFromOf(b, resolved, today) ? `${PROJECTION_LABEL} · ${label}` : label;
}

/** The native chart a block draws, or null when its type has none or it holds no point. */
export function chartPlan(b: any, resolved: ResolvedSeries | null | undefined, today: string): ChartPlan | null {
  const type = String(b?.chart_type || 'line');
  if (b?.kind !== 'chart' || !(NATIVE_CHART_TYPES as readonly string[]).includes(type)) return null;
  const raw = (Array.isArray(b.series) ? b.series : []).map((sr: any) => ({
    name: String(sr?.label || sr?.binding?.source_key || 'Series').slice(0, 80),
    points: seriesPoints(sr, resolved),
  })).filter((s: { points: Point[] }) => s.points.length);
  if (!raw.length) return null;
  const ranked = RANKED.has(type);
  let categories: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) for (const p of s.points) if (!seen.has(p.x)) { seen.add(p.x); categories.push(p.x); }
  if (!ranked) categories.sort();
  const months = RANGE_MONTHS[String(b.range)] ?? 0;
  if (months && !ranked) categories = categories.slice(-months);
  let series = raw.map((s: { name: string; points: Point[] }) => {
    const at = new Map(s.points.map((p) => [p.x, p.y] as const));
    return { name: s.name, values: categories.map((c) => (at.has(c) ? at.get(c)! : null)) };
  });
  if (ranked) {
    // Biggest first, by the first series; a category it has no figure for goes last.
    const order = categories.map((c, i) => ({ c, i, v: series[0].values[i] }))
      .sort((a, z) => (z.v ?? -Infinity) - (a.v ?? -Infinity));
    categories = order.map((o) => o.c);
    series = series.map((s: { name: string; values: Array<number | null> }) => ({ name: s.name, values: order.map((o) => s.values[o.i]) }));
  }
  if (!series.some((s: { values: Array<number | null> }) => s.values.some((v) => v !== null))) return null;
  return {
    kind: LINE.has(type) ? 'line' : 'bar',
    dir: ranked ? 'bar' : 'col',
    grouping: STACKED.has(type) ? 'stacked' : PERCENT.has(type) ? 'percentStacked' : 'clustered',
    categories,
    series,
    projectionFrom: projectionFromOf(b, resolved, today),
    labels: b.labels !== false,
  };
}

/** Column letters for the sheet: A is the categories, B on the series. */
const COL = (i: number) => String.fromCharCode(66 + i);
const PALETTE = ['2563EB', '0F172A', '14B8A6', 'F59E0B', 'A855F7', 'EF4444'];
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6));

/** The chart part. `workbookRid` is the relationship to the embedded sheet. */
export function chartPartXml(plan: ChartPlan, workbookRid: string): string {
  const n = plan.categories.length;
  const now = plan.projectionFrom;
  const catCache = `<c:strCache><c:ptCount val="${n}"/>${plan.categories.map((c, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(c)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const ser = plan.series.map((s, si) => {
    const col = COL(si);
    const colour = PALETTE[si % PALETTE.length];
    const look = plan.kind === 'line'
      ? `<c:spPr><a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
      : `<c:spPr><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`;
    // A line point past today is dashed (the segment into it), the editor's projection.
    const dashed = plan.kind === 'line' && now
      ? plan.categories.map((c, i) => (c.slice(0, 7) >= now ? `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill><a:prstDash val="dash"/><a:round/></a:ln></c:spPr></c:dPt>` : '')).join('')
      : '';
    const pts = s.values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${num(v)}</c:v></c:pt>`)).join('');
    return `<c:ser><c:idx val="${si}"/><c:order val="${si}"/>`
      + `<c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEsc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
      + look + dashed
      + (plan.labels ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' : '')
      + `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f>${catCache}</c:strRef></c:cat>`
      + `<c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${pts}</c:numCache></c:numRef></c:val>`
      + (plan.kind === 'line' ? '<c:smooth val="0"/>' : '')
      + '</c:ser>';
  }).join('');
  const axes = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  const body = plan.kind === 'line'
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${axes}</c:lineChart>`
    : `<c:barChart><c:barDir val="${plan.dir}"/><c:grouping val="${plan.grouping}"/><c:varyColors val="0"/>${ser}<c:gapWidth val="60"/>${plan.grouping === 'clustered' ? '' : '<c:overlap val="100"/>'}${axes}</c:barChart>`;
  const axisText = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
  const catPos = plan.dir === 'bar' ? 'l' : 'b';
  const valPos = plan.dir === 'bar' ? 'b' : 'l';
  const title = now
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:rPr><a:t>${xmlEsc(PROJECTION_LABEL)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart>${title}<c:plotArea><c:layout/>${body}`
    + `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="${plan.dir === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${catPos}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr>${axisText}<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${valPos}"/><c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="F1F5F9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${plan.grouping === 'percentStacked' ? '0%' : 'General'}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${axisText}<c:crossAx val="500000001"/><c:crosses val="${plan.dir === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`
    + `</c:plotArea>${plan.series.length > 1 ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : ''}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
<c:externalData r:id="${workbookRid}"><c:autoUpdate val="0"/></c:externalData>
</c:chartSpace>`;
}

/** The embedded workbook: categories down column A, one series per column from B, a missing point an empty cell. */
export function chartWorkbook(plan: ChartPlan): Uint8Array {
  const enc = new TextEncoder();
  const str = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
  const rows = [`<row r="1">${plan.series.map((s, i) => str(`${COL(i)}1`, s.name)).join('')}</row>`];
  plan.categories.forEach((c, ci) => {
    const r = ci + 2;
    rows.push(`<row r="${r}">${str(`A${r}`, c)}${plan.series.map((s, si) => (s.values[ci] === null ? '' : `<c r="${COL(si)}${r}"><v>${num(s.values[ci] as number)}</v></c>`)).join('')}</row>`);
  });
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`) },
  ];
  return buildZip(entries);
}

/** The graphic frame that places chart `rid` in `box` (EMU). */
export function chartFrameXml(id: number, name: string, descr: string, box: { x: number; y: number; w: number; h: number }, rid: string, pinned = false): string {
  return `<p:graphicFrame>
  <p:nvGraphicFramePr><p:cNvPr id="${id}" name="${xmlEsc(name)}" descr="${xmlEsc(descr)}"/><p:cNvGraphicFramePr>${pinned ? '<a:graphicFrameLocks noMove="1" noResize="1"/>' : '<a:graphicFrameLocks noGrp="1"/>'}</p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
  <p:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></p:xfrm>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic>
</p:graphicFrame>`;
}
