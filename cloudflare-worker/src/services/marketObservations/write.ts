/** D7709 (#7709): bounded append-only observation writes and durable, body-free import receipts. */
import type { Env } from '../../types';
import { reportPrivateError } from '../../util/errorPrivacy';
import { observationFieldsError, OBSERVATION_FIELDS, type ObservationFields } from '../researchObservations';

export const MAX_BATCH_ROWS = 40;
export class ImportRequestError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
export type FailureKind = 'provider_http' | 'provider_transport' | 'provider_payload' | 'edition_conflict' | 'database_unavailable' | 'source_disabled';
export class ImportFailure extends Error {
  kind: FailureKind;
  httpStatus: number | null;
  constructor(kind: FailureKind, httpStatus: number | null = null) {
    super(kind); this.kind = kind;
    this.httpStatus = httpStatus !== null && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
  }
}
/** One provider cell. D7716: the optional fields say what it counts, where and how; a value outside the exported lists is refused. */
export interface Observation extends Partial<ObservationFields> {
  metric_key: string; metric_label: string; geography_type: 'country' | 'region' | 'city' | 'ecosystem';
  geography_code: string; period: string; value: number | null; unit: string;
  observation_status: 'actual' | 'estimate' | 'forecast' | 'axal_derived' | 'unspecified';
  published_at: string | null; source_observation_key: string; vintage: string;
}
export interface PreparedBatch {
  rows: Observation[]; seen: number; vintage: string; cursor: string | null;
  retry_cursor: string | null; progressed: boolean; failure?: ImportFailure;
}
export interface ImportReport {
  run_id: number; source_id: string; vintage: string; status: 'succeeded' | 'failed' | 'partial';
  rows_seen: number; rows_inserted: number; rows_unchanged: number;
  next_cursor: string | null; failure: string | null;
}
type Prior = { id: number; source_observation_key: string; vintage: string; value: number | null; observation_status: string; limitations: string | null };
/** D7717: a cell is unchanged only when its value, status and limitations (where a provider's flags land) all match. */
const same = (p: Prior, r: Observation) => p.value === r.value && p.observation_status === r.observation_status
  && (p.limitations ?? null) === (r.limitations ?? null);
const keyOf = (r: Pick<Observation, 'source_observation_key' | 'vintage'>) => JSON.stringify([r.source_observation_key, r.vintage]);
const failureOf = (error: unknown) => error instanceof ImportFailure ? error : new ImportFailure('database_unavailable');
export const failureText = (f: ImportFailure) => f.kind + (f.httpStatus === null ? '' : ` HTTP ${f.httpStatus}`);

/** Never expose a legacy importer exception through the new operator reader. */
export function storedFailure(value: unknown): string | null {
  if (value == null) return null;
  return /^(provider_http|provider_transport|provider_payload|edition_conflict|database_unavailable|source_disabled)( HTTP [1-5][0-9]{2})?$/.test(String(value))
    ? String(value) : 'previous_import_error';
}

async function priorRows(env: Env, source: string, rows: Observation[]): Promise<Prior[]> {
  if (!rows.length) return [];
  // One bounded prior read: the latest row and the requested edition, at most two per cell.
  const wanted = JSON.stringify(rows.map(r => ({ key: r.source_observation_key, vintage: r.vintage })));
  return (await env.DB.prepare(
    `SELECT o.id,o.source_observation_key,o.vintage,o.value,o.observation_status,o.limitations
       FROM research_market_observations o
      WHERE o.source_id=? AND EXISTS (
        SELECT 1 FROM json_each(?) w WHERE json_extract(w.value,'$.key')=o.source_observation_key
          AND (o.vintage=json_extract(w.value,'$.vintage') OR o.id=(
            SELECT MAX(p.id) FROM research_market_observations p
             WHERE p.source_id=o.source_id AND p.source_observation_key=o.source_observation_key)))`,
  ).bind(source, wanted).all<Prior>()).results || [];
}

/** Only this module mutates the observation, run and source receipts. No provider body is persisted. */
export async function runObservationBatch(env: Env, source: string, prepare: () => Promise<PreparedBatch>): Promise<ImportReport> {
  const registered = await env.DB.prepare('SELECT enabled FROM research_market_sources WHERE id=?').bind(source).first<{ enabled: number }>();
  if (!registered) throw new ImportRequestError('source_not_found', 404);
  if (registered.enabled !== 1) throw new ImportRequestError('source_disabled', 409);
  const started = new Date().toISOString();
  const run = await env.DB.prepare(
    `INSERT INTO research_market_ingestion_runs(source_id,vintage,started_at,status)
     SELECT ?,'not_recorded',?,'running' WHERE EXISTS (SELECT 1 FROM research_market_sources WHERE id=? AND enabled=1) RETURNING id`,
  ).bind(source, started, source).first<{ id: number }>();
  if (!run) throw new ImportRequestError('source_disabled', 409);
  await env.DB.prepare(
    `UPDATE research_market_sources SET last_attempt_at=? WHERE id=?
      AND ?=(SELECT MAX(id) FROM research_market_ingestion_runs WHERE source_id=?)`,
  ).bind(started, source, run.id, source).run();

  let batch: PreparedBatch | undefined, inserted = 0, unchanged = 0, seen = 0, vintage = 'not_recorded';
  let failure: ImportFailure | undefined;
  try {
    batch = await prepare();
    if (!Number.isSafeInteger(batch.seen) || batch.seen < batch.rows.length || batch.seen > MAX_BATCH_ROWS || batch.rows.length > MAX_BATCH_ROWS)
      throw new ImportFailure('provider_payload');
    seen = batch.seen; vintage = batch.vintage;
    const enabled = await env.DB.prepare('SELECT enabled FROM research_market_sources WHERE id=?').bind(source).first<{ enabled: number }>();
    if (enabled?.enabled !== 1) throw new ImportFailure('source_disabled');
    const rows = batch.rows.filter(r => r.value !== null);
    const identities = new Map<string, Observation>();
    for (const r of rows) {
      if (!Number.isFinite(r.value) || !r.source_observation_key || r.source_observation_key.length > 200 || !r.vintage || r.vintage.length > 100)
        throw new ImportFailure('provider_payload');
      // D7716: a field outside its exported list refuses the batch before any write; nothing is truncated or guessed.
      if (observationFieldsError(r)) throw new ImportFailure('provider_payload');
      const old = identities.get(r.source_observation_key);
      if (old && (old.vintage !== r.vintage || old.value !== r.value || old.observation_status !== r.observation_status
        || (old.limitations ?? null) !== (r.limitations ?? null)))
        throw new ImportFailure('provider_payload');
      identities.set(r.source_observation_key, r);
    }
    const prior = await priorRows(env, source, [...identities.values()]);
    const editions = new Map(prior.map(r => [keyOf(r), r]));
    const latest = new Map<string, Prior>();
    for (const r of prior) if (!latest.has(r.source_observation_key) || latest.get(r.source_observation_key)!.id < r.id) latest.set(r.source_observation_key, r);
    const pending: Observation[] = [], staged = new Set<string>(), duplicates = new Map<string, number>();
    for (const r of rows) {
      const edition = editions.get(keyOf(r));
      // An immutable edition cannot silently change under the same unique key.
      if (edition && !same(edition, r)) throw new ImportFailure('edition_conflict');
      const previous = latest.get(r.source_observation_key);
      if (edition || (previous && same(previous, r))) { unchanged++; continue; }
      if (staged.has(keyOf(r))) { duplicates.set(keyOf(r), (duplicates.get(keyOf(r)) || 0) + 1); continue; }
      staged.add(keyOf(r)); pending.push(r);
    }
    if (pending.length) {
      const results = await env.DB.batch(pending.map(r => env.DB.prepare(
        `INSERT OR IGNORE INTO research_market_observations
          (source_id,metric_key,metric_label,geography_type,geography_code,period,value,unit,observation_status,
           published_at,retrieved_at,confidence,source_observation_key,vintage,supersedes_observation_id,
           statistical_unit,scale,currency,price_basis,industry_scheme,industry_code,size_band,series_id,
           supporting_passage,applicability_note,limitations)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,'source_reported',?,?,
           (SELECT id FROM research_market_observations WHERE source_id=? AND source_observation_key=? ORDER BY id DESC LIMIT 1),
           ?,?,?,?,?,?,?,?,?,?,?
          WHERE EXISTS (SELECT 1 FROM research_market_sources WHERE id=? AND enabled=1)
            AND NOT EXISTS (SELECT 1 FROM research_market_observations p WHERE p.source_id=? AND p.source_observation_key=?
              AND p.id=(SELECT MAX(q.id) FROM research_market_observations q WHERE q.source_id=p.source_id AND q.source_observation_key=p.source_observation_key)
              AND p.value IS ? AND p.observation_status=? AND p.limitations IS ?)`,
      ).bind(source, r.metric_key, r.metric_label, r.geography_type, r.geography_code, r.period, r.value, r.unit, r.observation_status,
        r.published_at, started, r.source_observation_key, r.vintage, source, r.source_observation_key,
        ...OBSERVATION_FIELDS.map(f => r[f] ?? null),
        source, source, r.source_observation_key, r.value, r.observation_status, r.limitations ?? null)));
      const ignored: Observation[] = [];
      for (let i = 0; i < results.length; i++) {
        if (Number(results[i].meta?.changes || 0) === 1) { inserted++; unchanged += duplicates.get(keyOf(pending[i])) || 0; }
        else ignored.push(pending[i]);
      }
      // A concurrent identical import is unchanged, not an inserted row. Verify all races in one read.
      if (ignored.length) {
        const raced = await priorRows(env, source, ignored);
        for (const r of ignored) {
          const edition = raced.find(p => keyOf(p) === keyOf(r));
          const last = raced.filter(p => p.source_observation_key === r.source_observation_key).sort((a, b) => b.id - a.id)[0];
          if (edition && !same(edition, r)) throw new ImportFailure('edition_conflict');
          if (!(edition || (last && same(last, r)))) throw new ImportFailure('source_disabled');
          unchanged += 1 + (duplicates.get(keyOf(r)) || 0);
        }
      }
    }
    failure = batch.failure;
  } catch (error) {
    reportPrivateError('import_row', error, 'market_import_failed');
    failure = failureOf(error);
  }
  const status = failure ? (inserted > 0 || unchanged > 0 || batch?.progressed && batch.failure ? 'partial' : 'failed') : 'succeeded';
  const finished = new Date().toISOString(), error = failure ? failureText(failure) : null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE research_market_ingestion_runs SET vintage=?,finished_at=?,status=?,rows_seen=?,rows_inserted=?,rows_unchanged=?,error=? WHERE id=?`)
      .bind(vintage, finished, status, seen, inserted, unchanged, error, run.id),
    env.DB.prepare(`UPDATE research_market_sources SET
      last_success_at=CASE WHEN ?='succeeded' AND (last_success_at IS NULL OR julianday(last_success_at)<julianday(?)) THEN ? ELSE last_success_at END,
      last_error=CASE WHEN ?=(SELECT MAX(id) FROM research_market_ingestion_runs WHERE source_id=?) THEN ? ELSE last_error END WHERE id=?`)
      .bind(status, finished, finished, run.id, source, error, source),
  ]);
  return { run_id: run.id, source_id: source, vintage, status, rows_seen: seen, rows_inserted: inserted, rows_unchanged: unchanged,
    next_cursor: failure && !batch?.failure ? batch?.retry_cursor ?? null : batch?.cursor ?? null, failure: error };
}
