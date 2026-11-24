/** D7909: bounded history collection; full and compact authorities both retain their dependent evidence. */
type Storage = Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
export const CAPACITY_HISTORY_PAGE = 64;
type Kind = 'publications' | 'results';
export function compactTableExists(storage: Pick<DurableObjectStorage, 'sql'>): boolean {
  return storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ci_capacity_compact'").toArray().length > 0;
}
/** Point reads only. A conflict retains both representations rather than assigning one implicit precedence. */
export function retainedCapacity(storage: Pick<DurableObjectStorage, 'sql'>, id: string, compact = compactTableExists(storage)): boolean {
  if (storage.sql.exec('SELECT id FROM ci_capacity_requests WHERE id=?', id).toArray().length) return true;
  if(compact && storage.sql.exec('SELECT id FROM ci_capacity_compact WHERE id=?', id).toArray().length > 0)return true;
  const failures=storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='capacity_result_failures'").toArray().length>0;
  if(failures&&storage.sql.exec('SELECT id FROM capacity_result_failures WHERE request_id=? LIMIT 1',id).toArray().length)return true;
  const results=storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='capacity_execution_results'").toArray().length>0;
  return results&&storage.sql.exec(`SELECT id FROM capacity_execution_results WHERE request_id=? AND
    (CASE WHEN json_valid(state) THEN json_extract(state,'$.testStep')='failure'
      AND COALESCE(json_extract(state,'$.failureApplied'),0)<>1 ELSE 1 END) LIMIT 1`,id).toArray().length>0;
}
/** One durable page, fixed table/cursor names and no raw JSON scan. Returns true when another page may remain. */
export function pruneCapacityHistory(storage: Storage, kind: Kind): boolean {
  return storage.transactionSync(() => {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS capacity_history_cursor (
      name TEXT PRIMARY KEY CHECK(name IN ('publications','results')), last TEXT NOT NULL)`);
    const table = kind === 'publications' ? 'capacity_publications' : 'capacity_execution_results';
    if (!storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).toArray().length) return false;
    const last = storage.sql.exec<{ last: string }>('SELECT last FROM capacity_history_cursor WHERE name=?', kind).toArray()[0]?.last ?? '';
    const rows = kind === 'publications'
      ? storage.sql.exec<{ id: string; owner: string; valid:number; owed:number }>(`SELECT id, substr(id,1,36) AS owner, json_valid(state) AS valid,
        CASE WHEN json_valid(state) THEN CASE WHEN json_extract(state,'$.phase')='known'
          AND json_type(state,'$.checkId')='integer' AND json_extract(state,'$.checkId')>0
          AND json_valid(json_extract(state,'$.sent'))
          THEN CASE WHEN json_extract(json_extract(state,'$.sent'),'$.status') IN ('success','failure','cancelled')
            AND (COALESCE(json_extract(state,'$.failed'),0)=0 OR json_extract(json_extract(state,'$.sent'),'$.status')='failure')
            THEN 0 ELSE 1 END ELSE 1 END ELSE 1 END AS owed
        FROM capacity_publications WHERE id>? ORDER BY id LIMIT 64`, last).toArray()
      : storage.sql.exec<{ id: string; owner: string; valid:number; owed:number }>(`SELECT id, request_id AS owner, json_valid(state) AS valid,
        CASE WHEN json_valid(state) THEN CASE WHEN json_extract(state,'$.testStep')='failure'
          AND COALESCE(json_extract(state,'$.failureApplied'),0)<>1 THEN 1 ELSE 0 END ELSE 1 END AS owed
        FROM capacity_execution_results WHERE id>? ORDER BY id LIMIT 64`, last).toArray();
    const compact = compactTableExists(storage);
    for (const row of rows) if (row.valid === 1 && row.owed === 0 && !retainedCapacity(storage, row.owner, compact)) {
      if (kind === 'publications') storage.sql.exec('DELETE FROM capacity_publications WHERE id=?', row.id);
      else storage.sql.exec('DELETE FROM capacity_execution_results WHERE id=?', row.id);
    }
    if (rows.length < CAPACITY_HISTORY_PAGE) storage.sql.exec('DELETE FROM capacity_history_cursor WHERE name=?', kind);
    else storage.sql.exec('INSERT OR REPLACE INTO capacity_history_cursor(name,last) VALUES(?,?)', kind, rows.at(-1)!.id);
    return rows.length === CAPACITY_HISTORY_PAGE;
  });
}
