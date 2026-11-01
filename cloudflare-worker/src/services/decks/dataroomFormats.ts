/** D1602: bounded local readers. No formula, relationship, macro or URL runs. */
import { inflateRawSync } from 'node:zlib';

export const DOCUMENT_TEXT_MAX = 16_000;
export const DATAROOM_SLOTS = ['dataroom.revenue_plan', 'dataroom.headcount_plan', 'dataroom.contract_count'] as const;
export type DocumentSlot = typeof DATAROOM_SLOTS[number];
export type DocumentValue = { slot: DocumentSlot; value: number; unit: 'usd' | 'count'; page: number | null };
export type DocumentPage = { page: number; text: string };
const LABELS: Record<DocumentSlot, string[]> = {
  'dataroom.revenue_plan': ['revenue', 'revenue plan', 'planned revenue', 'projected revenue', 'forecast revenue', 'revenue forecast', 'annual revenue'],
  'dataroom.headcount_plan': ['headcount', 'headcount plan', 'planned headcount', 'projected headcount', 'employees', 'planned employees'],
  'dataroom.contract_count': ['contract count', 'signed contracts', 'signed customer contracts', 'customer contracts', 'number of contracts'],
};
const unit = (slot: DocumentSlot) => slot === 'dataroom.revenue_plan' ? 'usd' as const : 'count' as const;
const label = (s: string) => s.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+(?:usd|20\d{2})\s*$/g, '').replace(/[:\s]+$/, '').replace(/\s+/g, ' ');
const slotOf = (s: string) => DATAROOM_SLOTS.find(k => LABELS[k].includes(label(s)));
function numeric(raw: unknown, slot: DocumentSlot): number | null {
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!(slot === 'dataroom.revenue_plan' ? /^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/ : /^(?:\d{1,3}(?:,\d{3})+|\d+)$/).test(s)) return null;
    raw = Number(s.replace(/[$,]/g, ''));
  }
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= Number.MAX_SAFE_INTEGER
    && (slot === 'dataroom.revenue_plan' || Number.isSafeInteger(raw)) ? raw : null;
}

/** RFC4180 quoting, bounded cells/rows; embedded instructions remain strings. */
export function csvRows(text: string): string[][] {
  if (text.length > 2_000_000) throw new Error('document_too_large');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n' || c == null)) {
      row.push(cell.trim()); cell = '';
      if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (c !== '\r' && c != null) cell += c;
    if (cell.length > 20_000 || row.length > 256 || rows.length > 10_000) throw new Error('document_too_large');
  }
  if (quoted) throw new Error('invalid_csv');
  return rows;
}

/** One fixed slot per label. Ambiguous conflicting rows are omitted, never added. */
export function valuesFromRows(rows: (string | number | null)[][], page: number | null, numericOnly = false): DocumentValue[] {
  const found = new Map<DocumentSlot, DocumentValue>(); const conflicts = new Set<DocumentSlot>();
  let period = -1, year = 0;
  for (const row of rows.slice(0, 10).filter(r => typeof r[0] !== 'string' || !slotOf(r[0]))) for (let i = 1; i < row.length; i++) {
    if (/^20\d{2}$/.test(String(row[i])) && Number(row[i]) > year) { year = Number(row[i]); period = i; }
  }
  for (const row of rows) {
    const slot = typeof row[0] === 'string' ? slotOf(row[0]) : undefined;
    if (!slot) continue;
    const cells = period > 0 ? [row[period]] : row.slice(1).filter(v => v != null && v !== '');
    if (cells.length !== 1 || (numericOnly && typeof cells[0] !== 'number')) continue;
    const value = numeric(cells[0], slot); if (value == null) continue;
    if (found.has(slot) && found.get(slot)!.value !== value) conflicts.add(slot);
    else found.set(slot, { slot, value, unit: unit(slot), page });
  }
  return [...found.values()].filter(v => !conflicts.has(v.slot));
}

/** Stored/deflated Office XML only, with central-directory and inflate limits. */
export function officeParts(bytes: Uint8Array): { names: string[]; text: (name: string) => string } {
  if (bytes.length > 20 * 1024 * 1024) throw new Error('document_too_large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65_557) || end < 0) throw new Error('invalid_office_file');
  const count = view.getUint16(end + 10, true); let at = view.getUint32(end + 16, true);
  if (count > 2048) throw new Error('document_too_large');
  const entries = new Map<string, { offset: number; packed: number; size: number; method: number }>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50 || (view.getUint16(at + 8, true) & 1)) throw new Error('invalid_office_file');
    const length = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    if (at + 46 + length + extra + comment > bytes.length) throw new Error('invalid_office_file');
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + length));
    if (entries.has(name)) throw new Error('invalid_office_file');
    entries.set(name, { offset: view.getUint32(at + 42, true), packed: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true), method: view.getUint16(at + 10, true) });
    at += 46 + length + extra + comment;
  }
  let expanded = 0; const cache = new Map<string, string>();
  return { names: [...entries.keys()], text(name) {
    if (cache.has(name)) return cache.get(name)!;
    const e = entries.get(name); if (!e) return '';
    if (e.size > 8_000_000 || e.offset + 30 > bytes.length || view.getUint32(e.offset, true) !== 0x04034b50) throw new Error('invalid_office_file');
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    if (start + e.packed > bytes.length) throw new Error('invalid_office_file');
    const packed = bytes.subarray(start, start + e.packed);
    const data = e.method === 0 ? packed : e.method === 8 ? inflateRawSync(packed, { maxOutputLength: 8_000_000 }) : null;
    if (!data || data.length !== e.size || (expanded += data.length) > 16_000_000) throw new Error('document_too_large');
    const out = new TextDecoder().decode(data); cache.set(name, out); return out;
  } };
}
const xml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos);/g, s => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[s] ?? s);

export function xlsxValues(bytes: Uint8Array): DocumentValue[] {
  const parts = officeParts(bytes);
  const strings = [...parts.text('xl/sharedStrings.xml').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m => xml(m[1]));
  const sheets = parts.names.filter(n => /^xl\/worksheets\/sheet[1-9]\d*\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (sheets.length > 32) throw new Error('document_too_large');
  const values: DocumentValue[] = [];
  for (let page = 0; page < sheets.length; page++) {
    const rows: (string | number | null)[][] = [];
    for (const row of parts.text(sheets[page]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: (string | number | null)[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const ref = /\br="([A-Z]+)\d+"/.exec(c[1]); if (!ref) continue;
        const index = [...ref[1]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
        if (index > 255) continue;
        const type = /\bt="([^"]+)"/.exec(c[1])?.[1]; const v = /<v\b[^>]*>([^<]*)<\/v>/.exec(c[2])?.[1];
        cells[index] = type === 's' ? strings[Number(v)] ?? null : type === 'inlineStr' ? xml(c[2])
          : (type == null || type === 'n') && v != null && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) ? Number(v) : null;
      }
      rows.push(cells);
      if (rows.length > 10_000) throw new Error('document_too_large');
    }
    values.push(...valuesFromRows(rows, page + 1, true));
  }
  // Multiple sheets disagreeing on one slot are ambiguous too.
  return values.filter(v => !values.some(w => w.slot === v.slot && w.value !== v.value)).filter((v, i, a) => a.findIndex(w => w.slot === v.slot) === i);
}

/** Only recorded pagination, never a model-invented Word page number. */
export function docxPages(bytes: Uint8Array): DocumentPage[] {
  const parts = officeParts(bytes), document = parts.text('word/document.xml');
  if (!document) throw new Error('invalid_office_file');
  const pages = document.split(/<w:lastRenderedPageBreak\b[^>]*\/>|<w:br\b[^>]*w:type="page"[^>]*\/>/);
  const recorded = Number(/<Pages>(\d+)<\/Pages>/.exec(parts.text('docProps/app.xml'))?.[1] ?? 0);
  if (pages.length === 1 && recorded !== 1) return [];
  if (pages.length > 40 || (recorded && recorded !== pages.length)) return [];
  return pages.map((p, i) => ({ page: i + 1, text: xml(p
    .replace(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g, (_row, cells: string) =>
      [...cells.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map(c => xml(c[1]).replace(/\s+/g, ' ').trim()).join('\t') + '\n')
    .replace(/<\/w:p>/g, '\n')).slice(0, DOCUMENT_TEXT_MAX) }));
}

/** Model proposals must cite an actual, labelled numeric row on that page. */
export function checkedDocumentValues(raw: string, pages: DocumentPage[]): DocumentValue[] {
  let rows: unknown; try { rows = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(rows) || rows.length > 20) return [];
  const values: DocumentValue[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).sort().join(',') !== 'page,slot,unit,value') continue;
    const { slot, value, unit: u, page } = row;
    if (!DATAROOM_SLOTS.includes(slot) || typeof value !== 'number' || numeric(value, slot) == null || u !== unit(slot) || !Number.isSafeInteger(page) || page < 1) continue;
    const source = pages.find(p => p.page === page); if (!source) continue;
    const evidence = source.text.split('\n').map(line => line.trim().replace(/^\||\|$/g, '').split(/\t|\s*\|\s*|:\s*/));
    if (!valuesFromRows(evidence, page).some(v => v.slot === slot && v.value === value)) continue;
    values.push({ slot, value, unit: u, page });
  }
  return values.filter(v => !values.some(w => w.slot === v.slot && w.value !== v.value)).filter((v, i, a) => a.findIndex(w => w.slot === v.slot) === i);
}
