/**
 * D7928 (#7928): the BLS Consumer Expenditure Surveys importer — mean annual expenditure per consumer unit for a few
 * major spending categories, with the standard error and relative standard error (the coefficient of variation, in
 * percent) BLS publishes beside each mean, read from the "All consumer units" column of one calendar-year
 * standard-error table (Table 1721, type of area; an XLSX workbook, no API key). National only. This is buyer
 * spending; it is not the unemployment series and not business turnover.
 *
 * D7928-p2: the layout below was checked against the real 2023, 2024 and 2025 workbooks on 2026-11-27. Each item is a
 * label row followed by `Mean`, `Share` (not on every item), `SE` and `RSE` rows. A value BLS does not publish is a
 * footnote marker in the cell (`c/`, `d/`), and an estimate flagged for caution keeps its number but carries the
 * marker in its number format (`# \b\/`). The letters change meaning between years (2023: `c` suppressed, `d` too
 * small; 2024 on: `b` use with caution, `c` too small), so the reader takes each letter's meaning from the legend
 * printed under the table, never from the letter. Anything it does not recognise fails the batch or stores no row.
 */
import type { Env } from '../../types';
import { reportPrivateError } from '../../util/errorPrivacy';
import { readZipEntry, ZipReadError } from '../../util/zipRead';
import { providerArchive } from './censusCbp';
import { ImportFailure, ImportRequestError, MAX_BATCH_ROWS, runObservationBatch, type ImportReport, type Observation, type PreparedBatch } from './write';

export const SOURCE_ID = 'bls-ce';
/** From the 2023 tables BLS leaves a cell blank when its relative standard error is 25 percent or more (D7928). */
export const FIRST_YEAR = 2023;
/** 2025 is the latest calendar year BLS had released when this was written; a later year is refused until checked. */
export const LAST_YEAR = 2025;
export const ceTableUrl = (year: number) =>
  `https://www.bls.gov/cex/tables/calendar-year/mean-item-share-average-standard-error/cu-area-type-${year}.xlsx`;
/**
 * bls.gov answers 403 to a request with no User-Agent or a bare tool one, and its robot policy reserves the right to
 * block robots that carry no way to contact their owner (D7928-p2), so every download names the platform and the
 * contact address the market sources already use.
 */
export const BLS_USER_AGENT = 'Axal StudioOS market-observations (+https://axal.vc; market-intel@axal.vc)';

/** The categories imported, each by the exact label of its row in the table. */
export const CE_ITEMS = Object.freeze({
  total: 'Average annual expenditures',
  food: 'Food',
  housing: 'Housing',
  apparel: 'Apparel and services',
  transportation: 'Transportation',
  healthcare: 'Healthcare',
  entertainment: 'Entertainment',
  education: 'Education',
  personal_insurance: 'Personal insurance and pensions',
} as const);
type Item = keyof typeof CE_ITEMS;

/** The three published statistics per category and the row label each sits under (BLS labels the CV row `RSE`). */
export const CE_STATS = Object.freeze({
  mean: { row: 'Mean', unit: 'USD', currency: 'USD', price_basis: 'current_prices', label: 'mean annual expenditure per consumer unit' },
  se: { row: 'SE', unit: 'USD', currency: 'USD', price_basis: 'current_prices', label: 'standard error of the mean' },
  cv: { row: 'RSE', unit: 'percent', currency: null, price_basis: 'not_applicable', label: 'coefficient of variation of the mean (percent)' },
} as const);
type Stat = keyof typeof CE_STATS;
const STAT_ROWS = new Map<string, Stat>(Object.entries(CE_STATS).map(([k, v]) => [v.row, k as Stat]));
/** A sub-row label that is read but not imported (the item's share of total spending). */
const IGNORED_ROWS = new Set(['Share']);
const ALL_CU = 'All consumer units';

/** One request per batch; nine items by three statistics is 27 cells, inside the writer's batch of 40. */
export const CE_IMPORT_LIMITS = Object.freeze({ first_year: FIRST_YEAR, last_year: LAST_YEAR, items: 9, cells: 27,
  archive_bytes: 2_000_000, sheet_bytes: 8_000_000, strings_bytes: 4_000_000, styles_bytes: 1_000_000 });
if (CE_IMPORT_LIMITS.items * Object.keys(CE_STATS).length > MAX_BATCH_ROWS) throw new Error('CE batch exceeds the writer batch');

export const metricKey = (item: Item, stat: Stat) => `ce_${item}_${stat}`;

/** The text every row carries (D7928). The mean row adds its published uncertainty. */
export const CE_LIMITATIONS = 'Consumer Expenditure Surveys (BLS), all consumer units, United States, calendar year, current dollars '
  + '(not adjusted for inflation). A consumer unit is the members of a household related by blood, marriage, adoption or '
  + 'other legal arrangement; a financially independent person living alone or sharing a household; or two or more persons '
  + 'who pool incomes for joint spending decisions. It is not a household count, a business, or a market size. Values are '
  + 'sample estimates integrating the Interview and Diary surveys and carry sampling error. A cell BLS does not publish '
  + '(suppressed, or too small to display) stores no row; an estimate BLS flags for caution says so in its own row.';

/** Added to a row whose cell BLS flags: its relative standard error is 25 percent or more (the 2024 tables on). */
export const CE_CAUTION = 'BLS flags this estimate: its relative standard error is 25 percent or more; use it with caution.';

export interface CeParams { year: number; items: Item[] }
export interface CeSkips { not_published: number; suppressed: number; too_small: number; unknown_cell: number }
export type CeReport = ImportReport & { skipped: CeSkips; caution: number };
/** A number, with the footnote letter its number format prints after it (`mark`), a text, or an empty cell. */
export type Cell = { n: number; mark?: string } | { s: string } | null;
/** What a footnote letter means, as the table's own legend says. */
export type Footnote = 'suppressed' | 'too_small' | 'caution' | 'other';

const invalid = () => new ImportRequestError('invalid_bls_ce_parameters');

/** Validate a batch: one calendar year and the items asked for (all nine when omitted). */
export function ceParams(raw: unknown): CeParams {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (Object.keys(b).some(k => !['year', 'items'].includes(k))) throw invalid();
  if (!Number.isInteger(b.year) || Number(b.year) < FIRST_YEAR || Number(b.year) > LAST_YEAR) throw invalid();
  const items = b.items === undefined ? Object.keys(CE_ITEMS) : b.items;
  if (!Array.isArray(items) || !items.length || items.length > CE_IMPORT_LIMITS.items
    || items.some(v => typeof v !== 'string' || !Object.hasOwn(CE_ITEMS, v)) || new Set(items).size !== items.length) throw invalid();
  return { year: Number(b.year), items: items as Item[] };
}

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
function xmlText(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e]);
}
/** The visible text of an `<si>` or `<is>` element: its `<t>` runs, phonetic runs left out. */
function runs(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1])).join('');
}
/** A label as compared: spaces collapsed, leader dots and a trailing footnote marker such as `(a)` or `a/` dropped. */
export function label(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/(\s*\.){2,}\s*$/, '').replace(/\s*(\([a-z]\)|[a-z]\/)$/, '').trim();
}

/** The workbook's shared strings. */
export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(m => runs(m[1] ?? ''));
}

const colIndex = (ref: string) => [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * For each cell style (`cellXfs` index), the footnote letter its number format prints after the number, if any: BLS
 * writes `# \b\/` (or `"b/"`) so the cell shows `123 b/`. A format naming two letters yields `?`, which no legend has.
 */
export function cellMarks(xml: string): (string | null)[] {
  const formats = new Map<string, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*?\bnumFmtId="(\d+)"[^>]*?\bformatCode="([^"]*)"/g)) formats.set(m[1], xmlText(m[2]));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map(x => {
    const code = formats.get(/\bnumFmtId="(\d+)"/.exec(x[1])?.[1] ?? '') ?? '';
    const letters = new Set([...code.matchAll(/\\([a-z])\\\/|"([a-z])\/"/g)].map(m => m[1] ?? m[2]));
    return letters.size === 0 ? null : letters.size === 1 ? [...letters][0] : '?';
  });
}

/**
 * A worksheet as rows of cells by column, in document order. A cell this reader cannot read fails the batch. With the
 * workbook's styles (`marks`), a number keeps the footnote letter of its format; a style index outside them fails.
 */
export function sheetRows(xml: string, strings: string[], marks: (string | null)[] | null = null): Cell[][] {
  const rows: Cell[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: Cell[] = [];
    for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]{1,3})\d+"/.exec(c[1]);
      if (!ref) throw new ImportFailure('provider_payload');
      const type = /\bt="([a-zA-Z]+)"/.exec(c[1])?.[1] ?? 'n', body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let cell: Cell = null;
      if (type === 'inlineStr') cell = { s: runs(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '') };
      else if (v === undefined) cell = null;
      else if (type === 's') {
        const i = Number(v);
        if (!Number.isInteger(i) || i < 0 || i >= strings.length) throw new ImportFailure('provider_payload');
        cell = { s: strings[i] };
      } else if (type === 'str') cell = { s: xmlText(v) };
      else if (type === 'n') {
        if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v.trim())) throw new ImportFailure('provider_payload');
        const style = /\bs="(\d+)"/.exec(c[1])?.[1], number: { n: number; mark?: string } = { n: Number(v) };
        if (marks && style !== undefined) {
          const mark = marks[Number(style)];
          if (mark === undefined) throw new ImportFailure('provider_payload');
          if (mark !== null) number.mark = mark;
        }
        cell = number;
      } else throw new ImportFailure('provider_payload');
      if (cell && 's' in cell && !cell.s.trim()) cell = null;
      cells[colIndex(ref[1])] = cell;
    }
    rows.push(cells);
  }
  return rows;
}

const text = (c: Cell | undefined) => (c && 's' in c ? label(c.s) : '');
const fmt = (n: number) => String(n);

/**
 * The legend under the table: column-A lines such as `c Value is too small to display.`, each letter read for what it
 * says. A letter printed twice fails the batch; a letter the legend does not explain has no meaning here.
 */
export function footnotes(grid: Cell[][]): Map<string, Footnote> {
  const legend = new Map<string, Footnote>();
  for (const r of grid) {
    const c = r[0];
    const m = c && 's' in c ? /^([a-z]) (\S.*)$/.exec(c.s.replace(/\s+/g, ' ').trim()) : null;
    if (!m) continue;
    if (legend.has(m[1])) throw new ImportFailure('provider_payload');
    const said = m[2];
    legend.set(m[1], /\bsuppressed\b/i.test(said) ? 'suppressed'
      : /\btoo small to display\b/i.test(said) ? 'too_small'
      : /relative standard error/i.test(said) && /\b25 percent\b/.test(said) && /\bcaution\b/i.test(said) ? 'caution'
      : 'other');
  }
  return legend;
}

/** Read the table's rows into observations for the asked items. */
export async function ceRows(grid: Cell[][], p: CeParams, published: string | null, skipped: CeSkips,
  cautioned: { count: number } = { count: 0 }): Promise<{ rows: Observation[]; seen: number }> {
  const headers = grid.map((r, i) => [i, r.findIndex(c => text(c) === ALL_CU)] as const).filter(([, col]) => col > 0);
  if (headers.length !== 1) throw new ImportFailure('provider_payload');
  const [headerAt, col] = headers[0];
  const legend = footnotes(grid);
  const wanted = new Map<string, Item>(p.items.map(i => [CE_ITEMS[i], i]));
  const found = new Map<Item, Partial<Record<Stat, Cell>>>();
  let current: Partial<Record<Stat, Cell>> | null = null;
  for (const r of grid.slice(headerAt + 1)) {
    const name = text(r[0]);
    if (!name) continue;
    const stat = STAT_ROWS.get(name);
    if (stat) {
      if (current) {
        if (Object.hasOwn(current, stat)) throw new ImportFailure('provider_payload');
        current[stat] = r[col] ?? null;
      }
      continue;
    }
    if (IGNORED_ROWS.has(name)) continue;
    const item = wanted.get(name);
    if (item === undefined) { current = null; continue; }
    // A label that appears twice cannot say which row it means.
    if (found.has(item)) throw new ImportFailure('provider_payload');
    current = {}; found.set(item, current);
  }
  // Every item BLS prints carries a Mean, an SE and an RSE row: an item missing one is a layout this reader does not know.
  for (const cells of found.values()) if (Object.keys(CE_STATS).some(stat => !Object.hasOwn(cells, stat))) throw new ImportFailure('provider_payload');
  const rows: Observation[] = [];
  let seen = 0;
  for (const item of p.items) {
    const cells = found.get(item);
    const read: Partial<Record<Stat, number>> = {}, caution = new Set<Stat>();
    for (const stat of Object.keys(CE_STATS) as Stat[]) {
      seen++;
      if (!cells) { skipped.not_published++; continue; }
      const cell = cells[stat] ?? null;
      // BLS prints a marker for every value it withholds; a blank value cell is not part of the table's layout.
      if (cell === null) { skipped.unknown_cell++; continue; }
      if ('s' in cell) {
        const marker = /^([a-z])\/$/.exec(cell.s.trim())?.[1];
        const meaning = marker === undefined ? undefined : legend.get(marker);
        if (meaning === 'suppressed') skipped.suppressed++;
        else if (meaning === 'too_small') skipped.too_small++;
        else skipped.unknown_cell++;
        continue;
      }
      if (!Number.isFinite(cell.n)) { skipped.unknown_cell++; continue; }
      if (cell.mark !== undefined) {
        // A flagged number is stored only when the legend says the flag is BLS's caution note.
        if (legend.get(cell.mark) !== 'caution') { skipped.unknown_cell++; continue; }
        caution.add(stat);
      }
      read[stat] = cell.n;
    }
    const uncertainty = read.mean === undefined ? null
      : `Published standard error: ${read.se === undefined ? 'not published' : fmt(read.se) + ' USD'}; relative standard error (coefficient of variation): `
        + `${read.cv === undefined ? 'not published' : fmt(read.cv) + ' percent'}.`;
    for (const stat of Object.keys(CE_STATS) as Stat[]) {
      const value = read[stat];
      if (value === undefined) continue;
      const s = CE_STATS[stat], key = ['ce', 'us', p.year, 'allcu', item, stat].join(':');
      const limitations = [CE_LIMITATIONS, stat === 'mean' ? uncertainty : `This is the ${s.label} for ${CE_ITEMS[item]}, not a spending value.`,
        caution.has(stat) ? CE_CAUTION : null].filter(Boolean).join(' ');
      if (caution.has(stat)) cautioned.count++;
      rows.push({
        metric_key: metricKey(item, stat), metric_label: `${CE_ITEMS[item]}: ${s.label}`, geography_type: 'country', geography_code: 'USA',
        period: String(p.year), value, unit: s.unit, observation_status: 'estimate', published_at: published,
        source_observation_key: key,
        vintage: published ?? 'content-sha256:' + await sha256([key, value, limitations]),
        statistical_unit: 'consumer_unit', scale: 'units', currency: s.currency, price_basis: s.price_basis,
        industry_scheme: null, industry_code: null, size_band: null,
        series_id: ['CE', 'US', 'ALLCU', item.toUpperCase(), stat.toUpperCase()].join('.'),
        supporting_passage: null, applicability_note: null, limitations,
      });
    }
  }
  return { rows, seen };
}

async function sha256(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * The workbook's first sheet as a grid. A missing shared-strings part means the sheet holds only inline strings; a
 * missing styles part means no number carries a footnote format.
 */
export async function workbookGrid(bytes: Uint8Array): Promise<Cell[][]> {
  const decode = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b);
  const optional = async (name: RegExp, cap: number) => {
    try { return decode((await readZipEntry(bytes, name, cap)).bytes); }
    catch (error) { if (error instanceof ZipReadError && error.message === 'entry_missing') return null; throw error; }
  };
  try {
    const strings = await optional(/^xl\/sharedStrings\.xml$/, CE_IMPORT_LIMITS.strings_bytes);
    const styles = await optional(/^xl\/styles\.xml$/, CE_IMPORT_LIMITS.styles_bytes);
    return sheetRows(decode((await readZipEntry(bytes, /^xl\/worksheets\/sheet1\.xml$/, CE_IMPORT_LIMITS.sheet_bytes)).bytes),
      strings === null ? [] : sharedStrings(strings), styles === null ? null : cellMarks(styles));
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure('provider_payload');
  }
}

/** One bounded batch: one workbook download, at most one writer batch, no continuation. */
export async function ingestBlsConsumerExpenditure(env: Env, raw: unknown, cursor?: unknown): Promise<CeReport> {
  const params = ceParams(raw);
  if (cursor !== undefined && cursor !== null) throw new ImportRequestError('invalid_cursor');
  const skipped: CeSkips = { not_published: 0, suppressed: 0, too_small: 0, unknown_cell: 0 };
  const cautioned = { count: 0 };
  const report = await runObservationBatch(env, SOURCE_ID, async (): Promise<PreparedBatch> => {
    try {
      const archive = await providerArchive(ceTableUrl(params.year), CE_IMPORT_LIMITS.archive_bytes, { 'User-Agent': BLS_USER_AGENT });
      const { rows, seen } = await ceRows(await workbookGrid(archive.bytes), params, archive.lastModified, skipped, cautioned);
      return { rows, seen, vintage: archive.lastModified ?? (rows.length ? 'content_identified' : 'not_recorded'),
        cursor: null, retry_cursor: null, progressed: true };
    } catch (error) {
      reportPrivateError('import_row', error, 'market_provider_failed');
      for (const k of Object.keys(skipped) as (keyof CeSkips)[]) skipped[k] = 0;
      cautioned.count = 0;
      return { rows: [], seen: 0, vintage: 'not_recorded', cursor: null, retry_cursor: null, progressed: false,
        failure: error instanceof ImportFailure ? error : new ImportFailure('provider_payload') };
    }
  });
  return { ...report, skipped, caution: cautioned.count };
}
