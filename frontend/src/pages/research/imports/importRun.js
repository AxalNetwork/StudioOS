/**
 * D7753 (#7753) — the Research source import run, with no React: read the chosen file in this browser, check it
 * against its own manifest, class its columns, preview, apply in bounded chunks at a paced rate, read back,
 * reconcile and resume. The console pages (`SourceImportsPage.jsx`, `SourceImportRun.jsx`) draw what this returns;
 * the tests drive it with a stub transport.
 *
 * What leaves the browser, and only in a POST body (#7739 Q3 B): the permitted columns of the records that are not
 * about a person. A contact column's cells and a whole record marked about a person are left out of every request
 * and only counted. No address and no query string carries anything from the file: the run's id is the Worker's.
 *
 * Errors. `frontend/src/lib/log.js` keeps a reported message in a localStorage ring and beacons it, and a JSON parse
 * error can quote the text it failed on. So nothing here throws, returns or reports an error's own message: every
 * problem is an `ImportProblem` whose message is a fixed sentence naming at most a source, a record index and a
 * column, and a Worker refusal is read by its code alone (never its body). Nothing is written to any storage.
 *
 * Hashes (D7745, D7742). The file's SHA-256 is worked out here and sent as declared; the Worker never sees the file.
 * Each source's list digest (sorted `id:row hash` lines) is checked here against the file's manifest and again by
 * the Worker at seal. No package hash recipe is registered (D7742 Q1), so each stated row hash is declared and not
 * checked, and the page says so.
 */
import { resultLabel } from '../sheetsSyncModel.js';

/** The Worker's chunk bound (`IMPORT_LIMITS`, D7745), used until a run's open answers its own. */
export const CHUNK_BOUND = Object.freeze({ records: 50, bytes: 600_000 });
/** Preview: entries per page and per request, and a request's byte ceiling (the Worker's is 1,000,000). */
export const PREVIEW_LIMITS = Object.freeze({ page: 500, entries: 5_000, bytes: 900_000 });
/** Seal: the expected list's ceiling (the Worker's MAX_SEAL_ENTRIES and MAX_SEAL_BYTES). */
export const SEAL_LIMITS = Object.freeze({ entries: 20_000, bytes: 1_900_000 });
/** Pacing: the Worker allows 60 requests a minute per user; one request starts at most every 1.1 s. */
export const PACE_MS = 1_100;
/** A 429 is waited out: the next minute, unless the refusal names its own wait. */
export const RATE_WAIT_MS = 61_000;
/** The manifest's own bounds, as the store takes them (D7742 `LIMITS`). */
const MAX_SOURCES = 20;
const MAX_COLUMNS = 200;

export const COLUMN_CLASSES = Object.freeze(['fact', 'prose', 'contact']);
export const CLASS_LABEL = Object.freeze({ fact: 'Fact', prose: 'Prose', contact: 'Contact · withheld' });

const SOURCE_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[a-z][a-z0-9_]{0,59}$/;
const SEP = '\u001f';
/**
 * True when a string holds a UTF-16 surrogate that is not half of a pair. A loop, not a regex: the
 * lookbehind a regex needs cannot parse in Safari/iOS before 16.4 (safari_regex_compat_3592).
 */
export function hasLoneSurrogate(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { i++; continue; }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ fixed sentences */

/** A name the page may print: a source key or a column name, clipped. Never a value. */
const nameOf = (v) => (typeof v === 'string' ? v.slice(0, 80) : '');
const rowOf = (i) => (Number.isSafeInteger(i) ? `record ${i + 1}` : 'a record');

/**
 * Every sentence a problem can carry. Each names at most a source, a record index and a column.
 * `p` is `{ source, index, column, declared, counted }`; the two counts are counts, never values.
 */
export const SENTENCES = Object.freeze({
  unreadable: () => 'The file could not be read in this browser. Nothing was sent.',
  not_text: () => 'The file is not text (UTF-8), so it is not a source package. Nothing was sent.',
  not_json: () => 'The file is not a source package: it is not JSON. Nothing was sent.',
  no_manifest: () => 'The file is not a source package: it has no manifest. Nothing was sent.',
  no_records: () => 'The file is not a source package: it has no list of records. Nothing was sent.',
  bad_source: (p) => `The manifest's entry for ${p.source ? `source ${p.source}` : 'a source'} is not in the expected shape. Nothing was sent.`,
  bad_record: (p) => `${p.source ? `Source ${p.source}, ` : ''}${rowOf(p.index)} is not in the expected shape. Nothing was sent.`,
  unknown_source: (p) => `${rowOf(p.index)[0].toUpperCase()}${rowOf(p.index).slice(1)} names a source the manifest does not list. Nothing was sent.`,
  unknown_column: (p) => `Source ${p.source}, ${rowOf(p.index)} has a column the manifest does not list: ${p.column}. Nothing was sent.`,
  duplicate_column: (p) => `Source ${p.source}, ${rowOf(p.index)} names column ${p.column} twice. Nothing was sent.`,
  bad_value: (p) => `Source ${p.source}, ${rowOf(p.index)}, column ${p.column} holds a value the store cannot keep. Nothing was sent.`,
  duplicate_record: (p) => `Source ${p.source}, ${rowOf(p.index)} repeats a record id. Nothing was sent.`,
  count_mismatch: (p) => `The file does not match its manifest: source ${p.source} declares ${p.declared} records and the file holds ${p.counted}.`,
  cells_mismatch: (p) => `The file does not match its manifest: source ${p.source} declares ${p.declared} cells, and ${p.counted} records of its columns make ${p.counted_cells}.`,
  digest_mismatch: (p) => `The file does not match its manifest: source ${p.source}'s list digest is not the one its records give.`,
  record_too_large: (p) => `Source ${p.source}, ${rowOf(p.index)} is larger than one request may carry. Nothing was sent.`,
  too_many_sources: () => `The manifest lists more than ${MAX_SOURCES} sources, more than the store accepts. Nothing was sent.`,
  too_many_records: () => `The file holds more records than one run may seal (${SEAL_LIMITS.entries.toLocaleString('en-US')}). Nothing was sent.`,
  class_missing: (p) => `Set a class for ${p.column} in source ${p.source} first.`,
  wrong_file: () => 'This is not the file of the open run: its SHA-256 differs. Choose the same file to resume. Nothing was sent.',
  unexpected: () => 'Something went wrong in this browser. Nothing more was sent.',
});

/** A problem the page can show: its message is a fixed sentence and nothing else. */
export class ImportProblem extends Error {
  constructor(code, params = {}) {
    const make = SENTENCES[code] || SENTENCES.unexpected;
    super(make({
      source: nameOf(params.source), column: nameOf(params.column), index: params.index,
      declared: Number(params.declared) || 0, counted: Number(params.counted) || 0, counted_cells: Number(params.counted_cells) || 0,
    }));
    this.name = 'ImportProblem';
    this.code = SENTENCES[code] ? code : 'unexpected';
    this.sentence = String(this.message);
  }
}

/** The sentence for any thrown thing: an `ImportProblem`'s own fixed sentence, else the fixed fallback; never another error's text. */
export const problemSentence = (e) => (e instanceof ImportProblem ? e.sentence : SENTENCES.unexpected());

/* ------------------------------------------------------------------ the Worker's refusals, by code */

/** Our sentence for each refusal code the console meets. The Worker's body is never printed. */
const REFUSALS = Object.freeze({
  run_open: 'Another run is open or not yet reconciled. Settle it before a new run.',
  idempotency_key_reused: 'That run key belongs to another file. Choose the file again to start a new run.',
  column_rules_disagree: 'A source\'s column classes were fixed by its first run, and these differ. Set them as that run did.',
  source_removed: 'A source in this file was removed, so no run may bring it back.',
  manifest_invalid: 'The Worker found the manifest not in the expected shape.',
  manifest_too_large: 'The manifest is larger than the store accepts.',
  hash_recipe_unknown: 'No package hash recipe is registered, so a run cannot name one.',
  held_not_enabled: 'Contact columns are only withheld, never held.',
  contact_column_refused: 'The Worker refused a contact cell. Contact values are never uploaded.',
  body_hash_mismatch: 'The Worker recomputed a record\'s body hash and it differs.',
  chunk_too_large: 'A batch was larger than the Worker accepts.',
  chunk_index_reused: 'That batch number already holds other records in this run.',
  record_in_other_chunk: 'A record in this batch was already sent in another batch of this run.',
  expected_list_mismatch: 'The expected list does not match the manifest, so nothing was sealed.',
  run_not_found: 'There is no such run.',
  run_not_open: 'This run no longer takes batches.',
  run_closed: 'This run no longer takes batches.',
  run_changed: 'The run changed while this was being done. Read it again.',
  storage_unavailable: 'The store could not be reached. Try again.',
  support_session_refused: 'Not available during a support session. Nothing is read or written.',
  removal_scope_invalid: 'Choose private fields, one record or one source.',
  source_key_invalid: 'Choose a source.',
  provider_record_id_required: 'Name the record to remove.',
});
const GENERIC_REFUSAL = 'The Worker refused this request. Nothing was written by it.';

/** A refusal's code, if it is one: a lower-case word, never free text. */
export const refusalCode = (e) => (e && typeof e.code === 'string' && CODE.test(e.code) ? e.code : null);
/** The sentence for a Worker refusal, by its code only. */
export function refusalSentence(e) {
  const code = refusalCode(e);
  if (code && REFUSALS[code]) return REFUSALS[code];
  return code ? `${GENERIC_REFUSAL} (${code})` : GENERIC_REFUSAL;
}

/** How a failed request reads to the run. */
export function failureKind(e) {
  const status = Number(e?.status) || 0;
  const code = refusalCode(e);
  if (status === 429 || code === 'rate_limited') return 'rate';
  if (status === 403 && code === 'step_up_required') return 'step_up';
  if (status === 401) return 'signed_out';
  if (status === 403) return 'refused';
  if (!status || status >= 500 || code === 'timeout') return 'transport';
  return 'refusal';
}

/* ------------------------------------------------------------------ hashing */

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const subtle = () => globalThis.crypto?.subtle;
export async function sha256Bytes(bytes) { return toHex(await subtle().digest('SHA-256', bytes)); }
export async function sha256Text(text) { return sha256Bytes(new TextEncoder().encode(text)); }
const utf8Length = (s) => new TextEncoder().encode(s).byteLength;

/** The store's per-source list digest (D7742 `membershipDigest`): sorted `id:row hash` lines joined by `\n`. */
export function listDigest(members) {
  return sha256Text(members.map((m) => `${m.provider_record_id}:${m.stated_row_hash}`).sort().join('\n'));
}

/* ------------------------------------------------------------------ reading and checking the file */

function wellFormed(value) {
  if (typeof value === 'string') return !hasLoneSurrogate(value);
  if (Array.isArray(value)) return value.every(wellFormed);
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * Read the chosen file's bytes and check it against its own manifest. Answers the checked package, held only in
 * memory by the caller: `{ sha256, size, sources, records }`. Throws an `ImportProblem` before any request.
 *
 * The file is a JSON object `{ manifest: { sources: [...] }, records: [...] }`. A manifest source is the store's
 * (`source_key`, `columns` in source order, `expected_records`, `expected_cells`, `digest`, and optionally
 * `excluded_person_records` for people already left out). A record is `{ source_key, provider_record_id,
 * stated_row_hash, cells: [[column, value], …], captured_at?, about_person? }`; one marked `about_person` is checked
 * with its source and left out of every request (#7739 Q3 B). The manifest counts every record in the file.
 */
export async function readPackage(input) {
  let bytes;
  try { bytes = input instanceof Uint8Array ? input : new Uint8Array(input); } catch { throw new ImportProblem('unreadable'); }
  let sha256;
  try { sha256 = await sha256Bytes(bytes); } catch { throw new ImportProblem('unreadable'); }
  let doc;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    try { doc = JSON.parse(text); } catch { throw new ImportProblem('not_json'); }
  } catch (e) {
    throw e instanceof ImportProblem ? e : new ImportProblem('not_text');
  }
  return checkPackage(doc, { sha256, size: bytes.byteLength });
}

/** The check `readPackage` runs on the parsed file. Exported for the tests. */
export async function checkPackage(doc, { sha256, size }) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ImportProblem('not_json');
  const manifest = doc.manifest;
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new ImportProblem('no_manifest');
  if (manifest.sources.length > MAX_SOURCES) throw new ImportProblem('too_many_sources');
  if (!Array.isArray(doc.records)) throw new ImportProblem('no_records');

  const sources = [];
  const byKey = new Map();
  for (const s of manifest.sources) {
    const key = s && typeof s.source_key === 'string' && SOURCE_KEY.test(s.source_key) ? s.source_key : null;
    if (!key || byKey.has(key)) throw new ImportProblem('bad_source', { source: key });
    const cols = s.columns;
    if (!Array.isArray(cols) || cols.length === 0 || cols.length > MAX_COLUMNS || new Set(cols).size !== cols.length ||
        cols.some((c) => typeof c !== 'string' || c.length === 0 || c.length > 200 || hasLoneSurrogate(c))) {
      throw new ImportProblem('bad_source', { source: key });
    }
    if (!isCount(s.expected_records) || !isCount(s.expected_cells) || typeof s.digest !== 'string' || !HEX64.test(s.digest)) {
      throw new ImportProblem('bad_source', { source: key });
    }
    if (s.excluded_person_records !== undefined && !isCount(s.excluded_person_records)) throw new ImportProblem('bad_source', { source: key });
    const entry = {
      source_key: key, columns: [...cols], expected_records: s.expected_records, expected_cells: s.expected_cells, digest: s.digest,
      declared_excluded: s.excluded_person_records ?? 0, records: [], persons: 0,
    };
    sources.push(entry);
    byKey.set(key, entry);
  }
  if (doc.records.length > SEAL_LIMITS.entries) throw new ImportProblem('too_many_records');

  const seen = new Set();
  doc.records.forEach((r, index) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new ImportProblem('bad_record', { index });
    const source = typeof r.source_key === 'string' ? byKey.get(r.source_key) : null;
    if (!source) throw new ImportProblem('unknown_source', { index });
    const at = source.records.length;
    const ok = typeof r.provider_record_id === 'string' && r.provider_record_id.length > 0 && r.provider_record_id.length <= 200 &&
      typeof r.stated_row_hash === 'string' && r.stated_row_hash.length > 0 && r.stated_row_hash.length <= 200 &&
      Array.isArray(r.cells) && (r.captured_at === undefined || r.captured_at === null || typeof r.captured_at === 'string') &&
      (r.about_person === undefined || typeof r.about_person === 'boolean');
    if (!ok) throw new ImportProblem('bad_record', { source: source.source_key, index: at });
    const names = new Set();
    for (const cell of r.cells) {
      if (!Array.isArray(cell) || cell.length !== 2 || typeof cell[0] !== 'string') throw new ImportProblem('bad_record', { source: source.source_key, index: at });
      const column = cell[0];
      if (!source.columns.includes(column)) throw new ImportProblem('unknown_column', { source: source.source_key, index: at, column });
      if (names.has(column)) throw new ImportProblem('duplicate_column', { source: source.source_key, index: at, column });
      names.add(column);
      if (!wellFormed(cell[1])) throw new ImportProblem('bad_value', { source: source.source_key, index: at, column });
    }
    const k = `${source.source_key}${SEP}${r.provider_record_id}`;
    if (seen.has(k)) throw new ImportProblem('duplicate_record', { source: source.source_key, index: at });
    seen.add(k);
    source.records.push(r);
    if (r.about_person === true) source.persons += 1;
  });

  for (const s of sources) {
    if (s.records.length !== s.expected_records) {
      throw new ImportProblem('count_mismatch', { source: s.source_key, declared: s.expected_records, counted: s.records.length });
    }
    if (s.expected_cells !== s.expected_records * s.columns.length) {
      throw new ImportProblem('cells_mismatch', { source: s.source_key, declared: s.expected_cells, counted: s.records.length, counted_cells: s.records.length * s.columns.length });
    }
    if (await listDigest(s.records) !== s.digest) throw new ImportProblem('digest_mismatch', { source: s.source_key });
  }
  return { sha256, size, sources, records: doc.records.length };
}

/** What the check proved, per source, as the Review step prints it: counts and digests only. */
export function checkSummary(pkg) {
  return pkg.sources.map((s) => ({
    source_key: s.source_key, records: s.records.length, columns: s.columns.length, cells: s.expected_cells,
    persons: s.persons + s.declared_excluded, list_digest: 'matches', row_hashes: 'declared_not_checked',
  }));
}

/* ------------------------------------------------------------------ column classes */

/** Every column of every source, with no class chosen: the operator sets each one. */
export const emptyClasses = (pkg) => Object.fromEntries(pkg.sources.map((s) => [s.source_key, Object.fromEntries(s.columns.map((c) => [c, null]))]));

/** The first column with no class, as `{ source, column }`, or null when every column has one. */
export function missingClass(pkg, classes) {
  for (const s of pkg.sources) for (const c of s.columns) {
    if (!COLUMN_CLASSES.includes(classes?.[s.source_key]?.[c])) return { source: s.source_key, column: c };
  }
  return null;
}

/** The classes as the run route takes them: a contact column is always withheld (#7739 Q3 B). */
export function classesForRun(pkg, classes) {
  return Object.fromEntries(pkg.sources.map((s) => [s.source_key, Object.fromEntries(s.columns.map((c) => {
    const k = classes[s.source_key][c];
    return [c, k === 'contact' ? { class: 'contact', contact: 'withheld' } : { class: k }];
  }))]));
}

/* ------------------------------------------------------------------ the plan: what is sent */

/**
 * The permitted projection and its chunks. People's records are left out; contact cells are left out and counted.
 * The manifest the Worker receives describes what is sent: its records, cells and list digest, and the number of
 * person records left out. Chunks are cut in file order, within the bound, so the same file gives the same chunks
 * on every visit and a resume sends only the ones the Worker does not hold.
 */
export async function buildPlan(pkg, classes, bound = CHUNK_BOUND) {
  const gap = missingClass(pkg, classes);
  if (gap) throw new ImportProblem('class_missing', gap);
  const maxRecords = Math.max(1, Math.min(CHUNK_BOUND.records, Number(bound?.records) || CHUNK_BOUND.records));
  const maxBytes = Math.max(10_000, Math.min(CHUNK_BOUND.bytes, Number(bound?.bytes) || CHUNK_BOUND.bytes));
  const sources = [];
  const sent = [];
  const entries = [];
  for (const s of pkg.sources) {
    const contact = new Set(s.columns.filter((c) => classes[s.source_key][c] === 'contact'));
    const kept = [];
    for (const [index, r] of s.records.entries()) {
      if (r.about_person === true) continue;
      const cells = r.cells.filter(([c]) => !contact.has(c));
      const record = {
        source_key: s.source_key, provider_record_id: r.provider_record_id, stated_row_hash: r.stated_row_hash,
        ...(typeof r.captured_at === 'string' ? { captured_at: r.captured_at } : {}),
        cells, body_sha256: await sha256Text(JSON.stringify(cells)),
      };
      if (utf8Length(JSON.stringify({ chunk_index: 999_999, records: [record] })) > maxBytes) {
        throw new ImportProblem('record_too_large', { source: s.source_key, index });
      }
      kept.push(record);
      sent.push(record);
      entries.push([s.source_key, r.provider_record_id, r.stated_row_hash]);
    }
    sources.push({
      source_key: s.source_key, columns: s.columns, records_in_file: s.records.length, sent: kept.length,
      persons: s.persons, declared_excluded: s.declared_excluded, contact_columns: contact.size,
      withheld_cells: kept.length * contact.size,
      manifest: {
        source_key: s.source_key, columns: s.columns, expected_records: kept.length, expected_cells: kept.length * s.columns.length,
        digest: await listDigest(kept), excluded_person_records: s.persons + s.declared_excluded,
      },
    });
  }
  const chunks = cutChunks(sent, { records: maxRecords, bytes: maxBytes });
  return {
    sha256: pkg.sha256,
    manifest: { sources: sources.map((s) => s.manifest) },
    column_classes: classesForRun(pkg, classes),
    sources, entries, chunks, bound: { records: maxRecords, bytes: maxBytes },
  };
}

/** Cut the records to send into chunks of at most `bound.records` records and `bound.bytes` bytes of body, in order. */
export function cutChunks(records, bound) {
  const chunks = [];
  let current = [];
  const start = utf8Length(JSON.stringify({ chunk_index: 999_999, records: [] }));
  let bytes = start;
  for (const record of records) {
    const size = utf8Length(JSON.stringify(record)) + 1;
    if (current.length && (current.length >= bound.records || bytes + size > bound.bytes)) {
      chunks.push({ index: chunks.length, records: current });
      current = [];
      bytes = start;
    }
    current.push(record);
    bytes += size;
  }
  if (current.length) chunks.push({ index: chunks.length, records: current });
  return chunks;
}

/** The plan's chunks under the bound a run's open answered, when it is tighter than the one they were cut to. */
export function withBound(plan, bound) {
  const records = Math.min(plan.bound.records, Number(bound?.records) || plan.bound.records);
  const bytes = Math.min(plan.bound.bytes, Number(bound?.bytes) || plan.bound.bytes);
  if (records === plan.bound.records && bytes === plan.bound.bytes) return plan;
  return { ...plan, bound: { records, bytes }, chunks: cutChunks(plan.chunks.flatMap((c) => c.records), { records, bytes }) };
}

/* ------------------------------------------------------------------ preview (writes nothing) */

/** The preview requests for a plan: pages of at most 500 entries, at most 5,000 entries and ~900 KB a request. */
export function previewRequests(plan) {
  const manifestBytes = utf8Length(JSON.stringify(plan.manifest));
  const requests = [];
  let pages = [];
  let page = [];
  let count = 0;
  let bytes = manifestBytes + 40;
  const flush = () => { if (page.length) { pages.push(page); page = []; } };
  for (const e of plan.entries) {
    const size = utf8Length(JSON.stringify(e)) + 1;
    if (count >= PREVIEW_LIMITS.entries || bytes + size > PREVIEW_LIMITS.bytes) {
      flush();
      requests.push({ manifest: plan.manifest, pages });
      pages = []; count = 0; bytes = manifestBytes + 40;
    }
    page.push(e);
    count += 1;
    bytes += size + (page.length === 1 ? 2 : 0);
    if (page.length >= PREVIEW_LIMITS.page) flush();
  }
  flush();
  if (pages.length) requests.push({ manifest: plan.manifest, pages });
  return requests;
}

/* ------------------------------------------------------------------ the run */

/** Statuses that keep a run open on the Worker (D7745 `OPEN_STATUSES`). */
export const OPEN_STATUSES = Object.freeze(['running', 'uncertain', 'partial']);
const isOpen = (run) => OPEN_STATUSES.includes(run?.status);

/** The run's phase, as the page words it. Complete, Partial, Failed and Outcome uncertain are D7170's. */
export function phaseLabel(state) {
  switch (state?.phase) {
    case 'previewing': return { tone: 'neutral', text: 'Previewing · nothing is written' };
    case 'previewed': return { tone: 'neutral', text: 'Nothing has been written' };
    case 'opening': case 'sending': case 'sealing': case 'reading': case 'reconciling': return resultLabel({ status: 'running' });
    case 'waiting': return { tone: 'neutral', text: 'Waiting, then continuing' };
    case 'step_up': return { tone: 'warn', text: 'Confirm it is you to continue' };
    case 'stopped': return { tone: 'warn', text: 'Stopped · resume with the same file' };
    case 'blocked': return { tone: 'warn', text: 'Another run is open' };
    case 'refused': return { tone: 'danger', text: 'Refused' };
    case 'complete': case 'partial': case 'failed': case 'uncertain': return resultLabel({ status: state.phase });
    default: return null;
  }
}

/** The live-region sentence for a phase change (FND-I16): a status when nothing is needed, an alert otherwise. */
export function announcement(state) {
  const total = state?.chunks_total ?? 0;
  const done = state?.chunks_done ?? 0;
  switch (state?.phase) {
    case 'waiting': return { role: 'status', text: `Waiting, then continuing. Batch ${done} of ${total} sent.` };
    case 'step_up': return { role: 'alert', text: 'Confirm it is you to continue. Nothing is written meanwhile.' };
    case 'stopped': return { role: 'alert', text: `Run stopped after batch ${done}. Resume with the same file.` };
    case 'complete': return { role: 'status', text: `Run complete. ${state.sent_records ?? 0} records stored and read back.` };
    case 'partial': return { role: 'alert', text: 'Run partial. Apply again sends only what is missing.' };
    case 'uncertain': return { role: 'alert', text: 'Outcome uncertain. Reconcile before a new run.' };
    case 'failed': return { role: 'alert', text: 'Run failed before any write. Nothing changed.' };
    case 'blocked': return { role: 'alert', text: 'Another run is open. Settle it before a new run.' };
    default: return null;
  }
}

const defaultClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
};

/**
 * One run of one plan. `transport` is the API module (or a test's stub) with `preview`, `runs`, `run`, `openRun`,
 * `sendChunk`, `seal` and `reconcile`. `onChange(state)` gets a fresh copy of the state after every step; the state
 * holds counts, chunk numbers, ids, digests, codes and fixed sentences only. `confirmStepUp()` resolves when the
 * person has confirmed it is them again (a lapsed step-up is a wait, never a failure). `report(scope, err)` gets a
 * fixed-sentence error for anything unexpected; `clock` paces the requests.
 */
export function createRun({ plan: given, transport, onChange = () => {}, confirmStepUp = async () => {}, report = () => {}, clock = defaultClock, newKey }) {
  let plan = given;
  let state = {
    phase: 'idle', run_uid: null, sentence: null, code: null, chunks_total: plan.chunks.length, chunks_done: 0,
    sent_records: plan.entries.length, unconfirmed: [], wait_ms: 0, preview: null, seal: null, readback: null, blocking_run: null,
  };
  let lastStart = -Infinity;
  let stopAsked = false;
  // One key for this plan's run: a resend after a 429 or a timeout answers the same run, never a second one.
  const key = typeof newKey === 'function' ? newKey(plan.sha256) : runKey(plan.sha256);
  const held = new Set();

  const set = (patch) => { state = { ...state, ...patch }; onChange({ ...state, unconfirmed: [...state.unconfirmed] }); };
  const markDone = () => set({ chunks_done: held.size });

  /** One request, paced; a 429 or a lapsed step-up waits and sends the same request again. */
  async function call(fn) {
    for (;;) {
      const gap = lastStart + PACE_MS - clock.now();
      if (gap > 0) await clock.sleep(gap);
      lastStart = clock.now();
      try {
        return await fn();
      } catch (e) {
        const kind = failureKind(e);
        if (kind === 'rate') {
          const asked = Number(e?.data?.retry_after);
          const wait = Number.isFinite(asked) && asked > 0 && asked <= 120 ? asked * 1000 : RATE_WAIT_MS;
          const before = state.phase;
          set({ phase: 'waiting', wait_ms: wait });
          await clock.sleep(wait);
          set({ phase: before, wait_ms: 0 });
          continue;
        }
        if (kind === 'step_up') {
          const before = state.phase;
          set({ phase: 'step_up' });
          await confirmStepUp();
          set({ phase: before });
          continue;
        }
        throw e;
      }
    }
  }

  /** A failure that is not a wait: refused, signed out, a Worker refusal, or a request whose answer never came. */
  function halt(e, where) {
    const kind = failureKind(e);
    if (kind === 'refused' || kind === 'signed_out') { set({ phase: 'refused', code: refusalCode(e), sentence: refusalSentence(e) }); return 'refused'; }
    if (kind === 'transport') return 'transport';
    if (!(e && typeof e === 'object' && 'status' in e)) report('researchSourceImports:run', new Error(SENTENCES.unexpected()));
    set({ code: refusalCode(e), sentence: e && typeof e === 'object' && 'status' in e ? refusalSentence(e) : SENTENCES.unexpected() });
    return where;
  }

  async function preview() {
    set({ phase: 'previewing', sentence: null, code: null });
    const tally = new Map(plan.sources.map((s) => [s.source_key, { new: 0, unchanged: 0, changed: 0, removed: 0, private_fields_removed: 0, sent: 0 }]));
    const matches = new Map();
    const requests = previewRequests(plan);
    try {
      for (const body of requests) {
        const answer = await call(() => transport.preview(body));
        for (const s of answer?.sources ?? []) {
          const t = tally.get(s.source_key);
          if (!t) continue;
          for (const k of Object.keys(t)) t[k] += Number(s[k]) || 0;
          if (requests.length === 1) matches.set(s.source_key, s.list_digest_matches);
        }
      }
    } catch (e) {
      const why = halt(e, 'preview_failed');
      if (why !== 'refused') set({ phase: 'preview_failed', sentence: why === 'transport' ? 'The preview could not be read. Nothing was written. Try again.' : state.sentence });
      return state;
    }
    const sources = plan.sources.map((s) => ({ source_key: s.source_key, ...tally.get(s.source_key), list_digest_matches: matches.has(s.source_key) ? matches.get(s.source_key) : null }));
    const total = sources.reduce((a, s) => a + s.sent, 0);
    const unchanged = sources.reduce((a, s) => a + s.unchanged, 0);
    set({ phase: 'previewed', preview: { sources, total, all_unchanged: total === plan.entries.length && unchanged === total } });
    return state;
  }

  /** Send every chunk the Worker does not hold. Ends with 'sent', 'stopped', 'transport' or 'refusal'. */
  async function sendMissing(extra = []) {
    const order = plan.chunks.filter((c) => !held.has(c.index) || extra.includes(c.index));
    for (const chunk of order) {
      if (stopAsked) { set({ phase: 'stopped' }); return 'stopped'; }
      set({ phase: 'sending' });
      let answer;
      try {
        answer = await call(() => transport.sendChunk(state.run_uid, { chunk_index: chunk.index, records: chunk.records }));
      } catch (e) {
        const why = halt(e, 'refusal');
        if (why === 'transport') set({ unconfirmed: [...new Set([...state.unconfirmed, chunk.index])] });
        return why;
      }
      if (answer?.status === 'uncertain') {
        // The Worker's write did not settle: the same chunk again settles it (D7745 decision 3).
        try {
          answer = await call(() => transport.sendChunk(state.run_uid, { chunk_index: chunk.index, records: chunk.records }));
        } catch (e) {
          const why = halt(e, 'refusal');
          if (why === 'transport') set({ unconfirmed: [...new Set([...state.unconfirmed, chunk.index])] });
          return why;
        }
        if (answer?.status === 'uncertain') { set({ unconfirmed: [...new Set([...state.unconfirmed, chunk.index])] }); return 'transport'; }
      }
      held.add(chunk.index);
      set({ unconfirmed: state.unconfirmed.filter((i) => i !== chunk.index) });
      markDone();
    }
    return 'sent';
  }

  /** Seal, then read back. Complete only when the stored read-back equals what was sent, withheld counts too. */
  async function sealAndRead() {
    set({ phase: 'sealing' });
    let seal;
    try {
      seal = await call(() => transport.seal(state.run_uid, { expected: plan.entries }));
    } catch (e) {
      const why = halt(e, 'refusal');
      if (why === 'refused') return;
      set({ phase: 'uncertain', sentence: why === 'transport' ? 'The read-back did not answer. Reconcile reads it again.' : state.sentence });
      return;
    }
    set({ seal: sealView(seal) });
    set({ phase: 'reading' });
    let readback;
    try {
      readback = await readWhole(state.run_uid);
    } catch (e) {
      const why = halt(e, 'refusal');
      if (why === 'refused') return;
      set({ phase: 'uncertain', sentence: 'The read-back did not answer. Reconcile reads it again.' });
      return;
    }
    const verdict = judge(plan, seal, readback);
    set({ readback: verdict.view });
    if (verdict.complete) { set({ phase: 'complete', sentence: null }); return; }
    if (seal?.status === 'uncertain') { set({ phase: 'uncertain', sentence: 'Some batches are not confirmed. Reconcile sends them again.' }); return; }
    if (readback.members_total === 0) {
      // Nothing was written: close the run so it no longer blocks, and say Failed (D7170: only when nothing was written).
      try { await call(() => transport.reconcile(state.run_uid, { action: 'close' })); } catch { /* the run stays partial; the run page offers Close */ }
      set({ phase: 'failed' });
      return;
    }
    set({ phase: 'partial' });
  }

  /** Every page of one run's members (ids, row hashes, outcomes, codes; never a body). */
  async function readWhole(uid) {
    const first = await call(() => transport.run(uid));
    const members = [...(first?.members ?? [])];
    let next = first?.next_offset ?? null;
    while (Number.isSafeInteger(next) && next > 0) {
      const page = await call(() => transport.run(uid, next));
      members.push(...(page?.members ?? []));
      next = page?.next_offset ?? null;
    }
    return { ...first, members };
  }

  /** Find this file's open run on the Worker, if there is one, and the chunks it holds. */
  async function findOpen() {
    const list = await call(() => transport.runs());
    const open = (list?.runs ?? []).find(isOpen);
    if (!open) return null;
    if (open.file_digest?.sha256 !== plan.sha256) return { other: open };
    const one = await call(() => transport.run(open.uid));
    return { mine: one };
  }

  /** Apply: open (or resume) the run, send what the Worker does not hold, seal and read back. */
  async function apply() {
    stopAsked = false;
    set({ phase: 'opening', sentence: null, code: null });
    let resend = [];
    try {
      const found = await findOpen();
      if (found?.other) {
        set({ phase: 'blocked', blocking_run: { uid: found.other.uid, status: found.other.status }, sentence: REFUSALS.run_open });
        return state;
      }
      if (found?.mine) {
        const run = found.mine.run;
        set({ run_uid: run.uid });
        for (const i of found.mine.held_chunks ?? []) held.add(Number(i));
        markDone();
        resend = (run.uncertain_chunks ?? []).map(Number).filter(Number.isSafeInteger);
        if (run.status === 'partial') await call(() => transport.reconcile(run.uid, { action: 'resume' }));
      } else {
        const opened = await call(() => transport.openRun({
          idempotency_key: key, manifest: plan.manifest, column_classes: plan.column_classes, file_sha256: plan.sha256,
        }));
        set({ run_uid: opened?.run?.uid ?? null });
        if (!state.run_uid) throw new ImportProblem('unexpected');
        // Never larger than the bound the Worker gives.
        plan = withBound(plan, opened?.chunk_bound);
        set({ chunks_total: plan.chunks.length });
        if (opened?.replayed && opened.run && !isOpen(opened.run)) {
          set({ phase: opened.run.status === 'complete' ? 'complete' : 'failed' });
          return state;
        }
      }
    } catch (e) {
      const why = halt(e, 'refusal');
      if (why === 'refused') return state;
      if (why === 'transport' && state.run_uid) { set({ phase: 'uncertain', sentence: 'The Worker did not answer. Reconcile reads the run again.' }); return state; }
      if (refusalCode(e) === 'run_open') set({ blocking_run: e?.data?.names?.run_uid ? { uid: String(e.data.names.run_uid), status: String(e.data.names.status || '') } : null });
      set({ phase: refusalCode(e) === 'run_open' ? 'blocked' : 'failed', sentence: why === 'transport' ? 'The Worker did not answer, so no run was opened. Try again.' : state.sentence });
      return state;
    }
    return continueRun(resend);
  }

  async function continueRun(extra = []) {
    const outcome = await sendMissing(Array.isArray(extra) ? extra : []);
    if (outcome === 'stopped' || outcome === 'refused') return state;
    if (outcome === 'transport') {
      set({ phase: 'uncertain', sentence: 'The Worker did not answer for a batch, so it is not known whether it is stored. Reconcile reads the run again.' });
      return state;
    }
    await sealAndRead();
    return state;
  }

  /**
   * Reconcile: ask the Worker which chunks it holds, send the rest (and any it lists as uncertain), then seal and
   * read back again. A partial run is resumed first. Ends Complete, or still Partial with what is short.
   */
  async function reconcile() {
    if (!state.run_uid) return apply();
    stopAsked = false;
    set({ phase: 'reconciling', sentence: null, code: null });
    let one;
    try {
      one = await call(() => transport.run(state.run_uid));
      held.clear();
      for (const i of one?.held_chunks ?? []) held.add(Number(i));
      markDone();
      if (one?.run?.status === 'partial') await call(() => transport.reconcile(state.run_uid, { action: 'resume' }));
    } catch (e) {
      const why = halt(e, 'refusal');
      if (why !== 'refused') set({ phase: 'uncertain', sentence: why === 'transport' ? 'The run could not be read. Reconcile again.' : state.sentence });
      return state;
    }
    if (one?.run?.status === 'complete') { await sealAndReadOnly(); return state; }
    const resend = [...new Set([...(one?.run?.uncertain_chunks ?? []).map(Number), ...state.unconfirmed.filter((i) => !held.has(i))])];
    return continueRun(resend);
  }

  /** A run the Worker already sealed Complete: read it back again before saying so. */
  async function sealAndReadOnly() {
    set({ phase: 'reading' });
    try {
      const readback = await readWhole(state.run_uid);
      const verdict = judge(plan, null, readback);
      set({ readback: verdict.view, phase: verdict.complete ? 'complete' : 'partial' });
    } catch (e) {
      const why = halt(e, 'refusal');
      if (why !== 'refused') set({ phase: 'uncertain', sentence: 'The read-back did not answer. Reconcile reads it again.' });
    }
  }

  return {
    get state() { return state; },
    key,
    preview,
    apply,
    reconcile,
    /** Stop after the chunk in flight; Resume (with the same file) sends only what the Worker does not hold. */
    stop() { stopAsked = true; },
  };
}

/** A new run key for a file: its digest's head and a random tail, held in memory for this plan only. */
export function runKey(sha256) {
  const c = globalThis.crypto;
  const tail = c && typeof c.randomUUID === 'function' ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `rsi-${String(sha256).slice(0, 12)}-${tail}`;
}

/** The seal's answer as the page shows it: statuses, counts and named ids with codes. */
export function sealView(seal) {
  if (!seal || typeof seal !== 'object') return null;
  return {
    status: seal.status ?? null,
    sources: seal.sources ?? {},
    named: seal.named ?? {},
    uncertain_chunks: Array.isArray(seal.uncertain_chunks) ? seal.uncertain_chunks : [],
  };
}

/** Sum a run's cell counts per source: `{ stored, withheld, blank }`, or null when the Worker sent none. */
export function cellTotals(counts, sourceKey) {
  const cols = counts?.cells?.[sourceKey];
  if (!cols || typeof cols !== 'object') return null;
  const out = { stored: 0, withheld: 0, blank: 0 };
  for (const c of Object.values(cols)) {
    out.stored += Number(c?.stored) || 0;
    out.withheld += Number(c?.withheld) || 0;
    out.blank += Number(c?.blank) || 0;
  }
  return out;
}

/**
 * The verdict on a read-back: Complete only when the Worker says complete, every source's recomputed list digest
 * equals the one sent, every record sent is a member, and stored + withheld + blank cells equal what was sent,
 * with the withheld cells equal to the contact cells left out here.
 */
export function judge(plan, seal, readback) {
  const run = readback?.run ?? {};
  const members = readback?.members ?? [];
  const bySource = Object.fromEntries(plan.sources.map((s) => [s.source_key, { kept: 0, refused: [] }]));
  for (const m of members) {
    const t = bySource[m.source_key];
    if (!t) continue;
    if (m.outcome === 'refused') t.refused.push({ provider_record_id: String(m.provider_record_id), code: refusalCode({ code: m.refusal_code }) ?? 'refused' });
    else t.kept += 1;
  }
  let complete = run.status === 'complete' && (seal === null || seal?.status === 'complete');
  const sources = plan.sources.map((s) => {
    const digest = readback?.list_digests?.[s.source_key] ?? null;
    const cells = cellTotals(run.counts, s.source_key) ?? (s.sent === 0 ? { stored: 0, withheld: 0, blank: 0 } : null);
    const t = bySource[s.source_key];
    const counted = cells ? cells.stored + cells.withheld + cells.blank : null;
    const row = {
      source_key: s.source_key, in_file: s.records_in_file, sent: s.sent, persons: s.persons + s.declared_excluded,
      read_back: digest ? Number(digest.members) : null, digest_matches: digest ? digest.matches === true : null,
      cells, cells_declared: s.manifest.expected_cells, withheld_expected: s.withheld_cells, refused: t.refused,
    };
    if (!digest || row.digest_matches !== true || row.read_back !== s.sent || t.kept !== s.sent || t.refused.length ||
        !cells || counted !== s.manifest.expected_cells || cells.withheld !== s.withheld_cells) complete = false;
    return row;
  });
  return { complete, view: { status: run.status ?? null, sources, members_total: Number(readback?.members_total) || 0 } };
}

/* ------------------------------------------------------------------ runs list and one run */

/** A run's id as the list shows it: the head of the Worker's uuid. */
export const shortUid = (uid) => (typeof uid === 'string' ? uid.slice(0, 8) : '');

/** A run's outcome counts as one line: new · unchanged · changed · refused. Null when the Worker sent none. */
export function outcomesLine(run) {
  const o = run?.counts?.outcomes;
  if (!o || typeof o !== 'object') return null;
  const n = (k) => Number(o[k]) || 0;
  return `${n('new').toLocaleString('en-US')} · ${n('unchanged').toLocaleString('en-US')} · ${n('new_version').toLocaleString('en-US')} · ${n('refused').toLocaleString('en-US')}`;
}

/** Records stored by a run (every outcome but refused), or null when the Worker sent no counts. */
export function storedCount(run) {
  const o = run?.counts?.outcomes;
  if (!o || typeof o !== 'object') return null;
  return Object.entries(o).filter(([k]) => k !== 'refused').reduce((a, [, v]) => a + (Number(v) || 0), 0);
}

/** The open run that blocks a new one, if any: an uncertain or partial run must be settled first. */
export const openRunOf = (runs) => (Array.isArray(runs) ? runs.find(isOpen) ?? null : null);

/** The typed confirmation each removal asks for (FND-I06). */
export function removalWord(scope, sourceKey) {
  return scope === 'source' ? `remove source ${sourceKey}` : 'remove';
}

/** The removal's counts as the Result says them. Null when the Worker sent none. */
export function removalCounts(answer) {
  const c = answer?.counts;
  if (!c || typeof c !== 'object') return null;
  const n = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : null);
  return { records: n(c.records), private_fields: n(c.private_fields), flags: n(c.flags) };
}
