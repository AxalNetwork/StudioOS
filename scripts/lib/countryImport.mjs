/**
 * D7714 (#7714) — builds the body of a country catalogue import
 * (`POST /api/admin/licence-pricing/countries/import`, D5016) from a reviewed
 * source file and saved reads, for `scripts/build-country-import.mjs`.
 *
 * WHAT GOES IN. A reviewed source file, one row per figure: country, field,
 * value, status, source, reference and as-of date. A saved read of
 * `GET /api/admin/licence-pricing/countries` (the profiles with their figures and
 * revisions). Optionally a saved `GET /api/admin/licence-pricing/consistency`
 * read, and the fields named to be recorded again. A reason.
 *
 * WHAT COMES OUT. `{ observations, expected_revisions, reason }`, the import
 * body, holding the rows that change something. A row is left out only when its
 * value, status, source, reference and as-of date all equal the profile's (a
 * rank, which holds only a value on the profile, when its value does). A field
 * the consistency read reports, or one named to be recorded again, is never
 * left out: that is how a value with no history row gets its row (D7714, answer
 * B). Nothing left means no body.
 *
 * WHAT IT REFUSES, naming the row: a missing source, date or status, a value that
 * is not an integer, a field or country the read does not hold, a provisional
 * rank, a field listed twice, more than 500 rows. It never rounds a value and
 * never supplies a status, source or date: those are the source file's.
 *
 * It calls no API and holds no credential; it reads the files it is given.
 */

export const OBSERVED_FIELDS = ['population', 'ppp_gdp_per_capita', 'startup_ecosystem_score', 'startup_ecosystem_rank'];
export const MAX_ROWS = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z]{2}$/;

/** The profile columns each field lives in, as `GET /countries` returns them. A rank has a value only. */
export const PROFILE_COLUMNS = {
  population: { value: 'population', status: 'population_status', source: 'population_source', source_ref: 'population_source_ref', as_of: 'population_as_of' },
  ppp_gdp_per_capita: { value: 'ppp_gdp_per_capita', status: 'ppp_status', source: 'ppp_source', source_ref: 'ppp_source_ref', as_of: 'ppp_as_of' },
  startup_ecosystem_score: { value: 'startup_ecosystem_score', status: 'startup_score_status', source: 'startup_source', source_ref: 'startup_source_ref', as_of: 'startup_as_of' },
  startup_ecosystem_rank: { value: 'startup_ecosystem_rank' },
};

export class CountryImportError extends Error {
  /** @param {string} message @param {Array<{ row: number | null, problem: string }>} problems */
  constructor(message, problems = []) {
    super(problems.length ? `${message}\n${problems.map((p) => `  ${p.row === null ? '' : `row ${p.row}: `}${p.problem}`).join('\n')}` : message);
    this.problems = problems;
  }
}

/** Splits CSV text into records: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text) {
  const records = [];
  let field = '', record = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.some((f) => f !== '')) records.push(record);
      record = [];
    } else field += ch;
  }
  if (quoted) throw new CountryImportError('The source file has a quote that is never closed.');
  record.push(field);
  if (record.some((f) => f !== '')) records.push(record);
  return records;
}

const HEADER_ALIASES = { country: 'country', country_code: 'country', field: 'field', value: 'value', status: 'status', source: 'source',
  reference: 'reference', source_ref: 'reference', as_of: 'as_of', 'as-of': 'as_of', as_of_date: 'as_of' };

/**
 * The source file's rows, as written: `.json` (an array of objects, or `{ rows: [...] }`) or CSV with a
 * header naming country, field, value, status, source, reference and as_of. Values stay as written.
 */
export function parseSource(text, name = 'source') {
  if (/\.json$/i.test(name)) {
    let data;
    try { data = JSON.parse(text); } catch { throw new CountryImportError(`${name} is not valid JSON.`); }
    const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : null;
    if (!rows) throw new CountryImportError(`${name} holds no array of rows.`);
    return rows.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r && typeof r === 'object' ? r : {})) { const key = HEADER_ALIASES[k.trim().toLowerCase()]; if (key) o[key] = v; }
      return o;
    });
  }
  const [header, ...records] = parseCsv(text);
  if (!header) throw new CountryImportError(`${name} is empty.`);
  const keys = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  const missing = ['country', 'field', 'value', 'status', 'source', 'as_of'].filter((k) => !keys.includes(k));
  if (missing.length) throw new CountryImportError(`${name}'s header does not name: ${missing.join(', ')}.`);
  return records.map((rec) => Object.fromEntries(keys.map((k, i) => [k, rec[i]]).filter(([k]) => k)));
}

/** The profiles from a saved `GET /countries` read, by country code. */
export function parseCatalogue(data) {
  const list = Array.isArray(data?.countries) ? data.countries : null;
  if (!list || !list.length) throw new CountryImportError('The catalogue read holds no countries. Save GET /api/admin/licence-pricing/countries.');
  const out = new Map();
  for (const p of list) {
    const hasFigures = p && typeof p === 'object' && Number.isInteger(p.revision) && OBSERVED_FIELDS.every((f) => PROFILE_COLUMNS[f].value in p);
    if (!hasFigures) {
      throw new CountryImportError('The catalogue read does not hold the profiles\' figures and revisions. Save GET /api/admin/licence-pricing/countries, not the priced /catalogue list.');
    }
    out.set(String(p.country_code), p);
  }
  return out;
}

/** The `CODE:field` pairs a saved `GET /consistency` read reports. */
export function parseConsistency(data) {
  if (!data || !Array.isArray(data.findings) || !data.checked || !Number.isInteger(data.checked.countries)) {
    throw new CountryImportError('The consistency read is not a saved GET /api/admin/licence-pricing/consistency answer.');
  }
  return new Set(data.findings.map((f) => `${f.country_code}:${f.field}`));
}

/** `CODE:field,CODE:field`, the fields to record again even when unchanged. */
export function parseAgain(raw) {
  const out = new Set();
  for (const part of String(raw || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [code, field] = part.split(':');
    if (!CODE.test(code || '') || !OBSERVED_FIELDS.includes(field)) throw new CountryImportError(`--again takes CODE:field pairs; "${part}" is not one.`);
    out.add(`${code}:${field}`);
  }
  return out;
}

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** A value as written, if it is an integer; never rounded. */
function integerOf(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : null;
  const t = text(raw);
  return /^-?\d+$/.test(t) && Number.isSafeInteger(Number(t)) ? Number(t) : null;
}

const validDate = (d) => DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/**
 * Checks every source row and builds the import body. Rows are numbered from 1
 * as they come in the source file (in a CSV, the line after the header).
 * Returns `{ body: null, ... }` when nothing changes.
 */
export function buildCountryImport({ rows, catalogue, reported = new Set(), again = new Set(), reason }) {
  const why = text(reason);
  if (why.length < 3 || why.length > 500) throw new CountryImportError('Give a reason of 3 to 500 characters.');
  const problems = [];
  const seen = new Map();
  const clean = [];
  rows.forEach((r, i) => {
    const n = i + 1;
    const here = [];
    const code = text(r.country).toUpperCase();
    const field = text(r.field);
    const status = text(r.status);
    const source = text(r.source);
    const ref = text(r.reference);
    const asOf = text(r.as_of);
    const value = integerOf(r.value);
    if (!CODE.test(code)) here.push(`"${text(r.country)}" is not a country code`);
    else if (!catalogue.has(code)) here.push(`${code} is not a country in the catalogue read`);
    if (!OBSERVED_FIELDS.includes(field)) here.push(`field must be one of ${OBSERVED_FIELDS.join(', ')}`);
    if (value === null) here.push(`value "${text(r.value)}" is not an integer (nothing is rounded)`);
    else if (field === 'startup_ecosystem_score' ? value < 0 : value <= 0) here.push(field === 'startup_ecosystem_score' ? 'a score cannot be negative' : 'value must be positive');
    if (!status) here.push('status is missing (recorded or provisional; none is supplied)');
    else if (status !== 'recorded' && status !== 'provisional') here.push('status must be recorded or provisional');
    if (field === 'startup_ecosystem_rank' && status === 'provisional') here.push('a rank is recorded or not; there is no provisional rank');
    if (!source) here.push('source is missing');
    else if (source.length > 200) here.push('source is longer than 200 characters, which the route would cut');
    if (ref.length > 500) here.push('reference is longer than 500 characters, which the route would cut');
    if (!asOf) here.push('as-of date is missing');
    else if (!validDate(asOf)) here.push(`as-of date "${asOf}" is not a YYYY-MM-DD date`);
    const key = `${code}:${field}`;
    if (CODE.test(code) && OBSERVED_FIELDS.includes(field)) {
      if (seen.has(key)) here.push(`${key} is also on row ${seen.get(key)}`);
      else seen.set(key, n);
    }
    for (const p of here) problems.push({ row: n, problem: p });
    if (!here.length) clean.push({ n, key, row: { country_code: code, field, value, status, source, source_ref: ref || null, as_of: asOf } });
  });
  if (problems.length) throw new CountryImportError('The source file has rows to fix; nothing was built.', problems);

  const observations = [];
  const leftOut = [];
  for (const { n, key, row } of clean) {
    const p = catalogue.get(row.country_code);
    const cols = PROFILE_COLUMNS[row.field];
    const same = Object.entries(cols).every(([k, col]) => (p[col] ?? null) === row[k]);
    if (same && !reported.has(key) && !again.has(key)) leftOut.push({ row: n, key });
    else observations.push(row);
  }
  if (observations.length > MAX_ROWS) {
    throw new CountryImportError(`The import would hold ${observations.length} rows; the route takes at most ${MAX_ROWS}. Split the source file by country, send one part, read again, and build the next.`,
      [{ row: null, problem: `${observations.length} rows to send` }]);
  }
  if (!observations.length) return { body: null, left_out: leftOut, kept_reported: [] };
  const expected_revisions = {};
  for (const o of observations) expected_revisions[o.country_code] = catalogue.get(o.country_code).revision;
  const keptReported = observations.map((o) => `${o.country_code}:${o.field}`).filter((k) => reported.has(k) || again.has(k));
  return { body: { observations, expected_revisions, reason: why }, left_out: leftOut, kept_reported: keptReported };
}
