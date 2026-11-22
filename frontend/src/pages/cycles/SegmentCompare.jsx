/**
 * D6007 (#6007, V24): Compare segments, a mode on the Ideal customer profile page (`?compare=ids`, owner
 * option A on D5995). Two to four of the venture's segments side by side: the five steps, the value source,
 * interviews and fit, evidence, top pain themes, firmographics and disqualifiers, each the stored value or
 * Not recorded. A writer sets the primary ICP from a column header; exactly one segment per venture holds it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cycleValidateApi } from '../../lib/api/cycleValidate';
import { DataState } from '../../ui';
import {
  COMPARE_MAX, COMPARE_MIN, COMPARE_ROWS, addId, cellOf, chosenIds, compareIds, removeId, withCompare,
} from './segmentCompareModel';

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-9 items-center rounded-lg border border-axal-hairline px-3 text-[12.5px] font-semibold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-100';
const PILL = 'inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2.5 py-0.5 text-[12px] text-axal-ink dark:border-gray-700 dark:text-gray-100';
const PRIMARY = 'inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11.5px] font-bold text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
const MUTED = 'text-[11.5px] text-axal-muted dark:text-gray-400';

/** The venture's segments from the module's own (adapted) list: id, name and whether it is the primary. */
export function segmentOptions(records) {
  return (records?.rows || []).map((r) => {
    const id = r.recordId ?? r.id;
    const name = r.cells?.segment;
    return id == null || typeof name !== 'string' ? null : { id: String(id), name, primary: r.primary === true };
  }).filter(Boolean);
}

function Cell({ row, segment }) {
  const cell = cellOf(row, segment);
  if (cell.empty) return <DataState state="not_recorded">{cell.empty}</DataState>;
  if (Array.isArray(cell.value)) {
    return <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{cell.value.map((v) => <li key={v}>{v}</li>)}</ul>;
  }
  return <span>{cell.value}</span>;
}

/** The page body in compare mode. `records` is the module's adapted list (for Add); `projectId` names the venture. */
export default function SegmentCompare({ projectId, records }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const options = segmentOptions(records);
  const ids = chosenIds(compareIds(params), options);
  const key = ids.join(',');
  const [read, setRead] = useState({ state: 'loading' });
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!projectId || ids.length < COMPARE_MIN) { setRead({ state: 'ready', segments: [], missing: [], can_write: false }); return undefined; }
    let live = true;
    setRead({ state: 'loading' });
    cycleValidateApi.compareSegments(projectId, ids)
      .then((d) => { if (live) setRead({ state: 'ready', segments: d?.segments || [], missing: d?.missing || [], can_write: d?.can_write === true }); })
      .catch((e) => { if (live) setRead({ state: e?.status === 403 ? 'refused' : 'unavailable', message: e?.message || '' }); });
    return () => { live = false; };
    // `key` is the ids' identity; the array itself is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key, attempt]);

  const go = useCallback((next) => navigate(`${location.pathname}${withCompare(location.search, next)}`), [location.pathname, location.search, navigate]);

  const setPrimary = async (id) => {
    setSaving(String(id)); setError('');
    try { await cycleValidateApi.setPrimarySegment(projectId, id, true); setAttempt((n) => n + 1); }
    catch (e) { setError(e?.message || 'The primary ICP could not be saved.'); }
    finally { setSaving(''); }
  };

  const done = `${location.pathname}${withCompare(location.search, null)}`;
  const addable = options.filter((o) => !ids.includes(o.id));
  const segments = read.state === 'ready' ? read.segments : [];

  return (
    <div className="flex flex-col gap-3.5" data-testid="segment-compare">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">Compare segments</h2>
          <p className={MUTED}>Two to four segments side by side. Anything unwritten reads Not recorded.</p>
        </div>
        <Link to={done} className={BTN} data-testid="segment-compare-done">Done comparing</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Segments compared">
        <span className={MUTED}>Comparing {ids.length} of up to {COMPARE_MAX}</span>
        {ids.map((id) => {
          const name = segments.find((s) => String(s.id) === id)?.name ?? options.find((o) => o.id === id)?.name ?? `Segment ${id}`;
          return (
            <span key={id} className={PILL}>
              {name}
              {ids.length > COMPARE_MIN && (
                <button type="button" className="ml-0.5 min-h-6 min-w-6 rounded-full text-axal-muted hover:text-axal-ink dark:text-gray-400"
                  aria-label={`Remove ${name}`} onClick={() => go(removeId(ids, id))}>✕</button>
              )}
            </span>
          );
        })}
        {ids.length < COMPARE_MAX && addable.length > 0 && (
          <label className="flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
            <span className="sr-only">Add a segment</span>
            <select className="min-h-9 rounded-md border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              value="" onChange={(e) => e.target.value && go(addId(ids, e.target.value))} data-testid="segment-compare-add">
              <option value="">+ Add a segment</option>
              {addable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {ids.length < COMPARE_MIN && !records ? <DataState state="loading" size="block" />
        : ids.length < COMPARE_MIN ? (
        <DataState state="none" size="block">
          {options.length < COMPARE_MIN ? 'Compare needs two segments. Add another segment first.' : 'Choose a second segment to compare.'}
        </DataState>
      ) : read.state === 'loading' ? <DataState state="loading" size="block" />
        : read.state === 'refused' ? <DataState state="refused" size="block" what="These segments" reason={read.message} />
        : read.state === 'unavailable' ? <DataState state="unavailable" size="block" what="The segments" onRetry={() => setAttempt((n) => n + 1)} />
        : (
          <>
            {read.missing.length > 0 && (
              <p className={MUTED} role="status">
                {read.missing.length === 1 ? 'One segment named in this link is archived or no longer this venture’s, so it is not shown.'
                  : `${read.missing.length} segments named in this link are archived or no longer this venture’s, so they are not shown.`}
              </p>
            )}
            {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-400">{error}</p>}
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="segment-compare-table">
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 w-[150px] bg-white p-3 dark:bg-gray-900"><span className="sr-only">Row</span></th>
                    {segments.map((s) => (
                      <th key={s.id} scope="col" className="p-3 align-top">
                        <div className="flex items-center justify-between gap-2">
                          <b>{s.name}</b>
                          {s.primary ? <span className={PRIMARY}>★ Primary</span>
                            : read.can_write ? (
                              <button type="button" className={BTN} disabled={saving !== ''} onClick={() => setPrimary(s.id)}
                                data-testid="segment-compare-set-primary">{saving === String(s.id) ? 'Saving…' : 'Set primary'}</button>
                            ) : null}
                        </div>
                        {s.source && <small className={MUTED}>{s.source === 'icp_definition' ? 'From the ICP wizard' : s.source === 'interview' ? 'From an interview' : 'Written by hand'}</small>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row) => (
                    <tr key={row.key} className="border-t border-axal-hairline dark:border-gray-800">
                      <th scope="row" className="sticky left-0 bg-white p-3 align-top text-[12px] font-bold text-axal-muted dark:bg-gray-900 dark:text-gray-400">{row.label}</th>
                      {segments.map((s) => <td key={s.id} className="p-3 align-top"><Cell row={row} segment={s} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {read.can_write && <p className={MUTED}>Exactly one segment per venture is the primary ICP, so setting it here clears the other.</p>}
          </>
        )}
    </div>
  );
}
