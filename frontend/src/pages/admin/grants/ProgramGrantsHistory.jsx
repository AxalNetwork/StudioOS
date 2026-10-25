import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { programGrantsApi } from '../../../lib/api/programGrants';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderMenuItem } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { LEDGER_PATH, PROGRAMS, historyLine } from '../../../lib/programGrants';
import { CsvError, GrantsTabs, useCsvDownload } from './ProgramGrants';

/**
 * D1126 (#3006) — HQ's History tab at /admin/licences/programs/history: every
 * program decision HQ recorded, across every studio, newest first. Each row
 * is one `program_changed` event in a licence's ledger (a grant, a terms
 * change, a pause, a resume, an end, an answer to a request, or a change to
 * the studio's partner deal types), with HQ's reason, as GR3's "Recent
 * changes" draws them. It reads `GET /api/admin/program-grants/history` and
 * writes nothing.
 *
 * A failed read says so, never an empty history. "No decision recorded yet"
 * is said only when the read answered with none.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} self-start border border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
const SELECT = 'min-h-[36px] rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const day = (iso) => {
  const t = Date.parse(String(iso || '').replace(' ', 'T') + (String(iso || '').includes('T') ? '' : 'Z'));
  return Number.isNaN(t) ? 'Not recorded' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function ProgramGrantsHistoryPage() {
  const [program, setProgram] = useState('');
  const [read, setRead] = useState({ status: 'loading', items: [], next: null });
  const [more, setMore] = useState({ busy: false, error: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [downloadCsv, csv] = useCsvDownload(programGrantsApi.exportCsv);

  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', items: [], next: null });
    programGrantsApi.allHistory({ program: program || undefined }).then(
      (d) => { if (live) setRead({ status: 'ready', items: Array.isArray(d?.items) ? d.items : [], next: d?.next_before ?? null }); },
      (e) => { reportError('program-grants:history', e); if (live) setRead({ status: 'error', items: [], next: null }); },
    );
    return () => { live = false; };
  }, [program, tick]);

  const loadMore = () => {
    setMore({ busy: true, error: false });
    programGrantsApi.allHistory({ program: program || undefined, before: read.next }).then(
      (d) => {
        setRead((r) => ({ ...r, items: [...r.items, ...(Array.isArray(d?.items) ? d.items : [])], next: d?.next_before ?? null }));
        setMore({ busy: false, error: false });
      },
      (e) => { reportError('program-grants:history-more', e); setMore({ busy: false, error: true }); },
    );
  };

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid="program-grants-history">
      <AdminPageHeader
        crumb={{ label: 'Licences', to: LEDGER_PATH, current: 'Program grants' }}
        title="Program grants"
        pills={[{ label: 'HQ only', tone: 'hq' }]}
        actions={<button type="button" aria-label="Refresh" onClick={reload} className="grid h-9 w-9 place-items-center rounded-[9px] border border-axal-hairline text-axal-muted dark:border-gray-700"><RefreshCw size={16} aria-hidden="true" /></button>}
        line="Every program decision HQ recorded, for every studio, with HQ's reason. Newest first."
        tabs={<GrantsTabs />}
        more={<HeaderMenuItem onSelect={downloadCsv} data-testid="grants-csv">{csv.busy ? 'Downloading…' : 'Download CSV'}</HeaderMenuItem>}
        data-testid="grants-history-header"
      />
      <CsvError error={csv.error} />

      <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="grants-h-history" data-testid="grants-history">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="grants-h-history" className="m-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">History</h2>
          <label className="flex items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400">
            Program
            <select value={program} onChange={(e) => setProgram(e.target.value)} className={SELECT} data-testid="grants-history-program">
              <option value="">Every program</option>
              {PROGRAMS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
        </div>

        {read.status === 'loading' && <span className="font-mono text-[13px] text-axal-muted" data-testid="grants-history-loading">Reading…</span>}
        {read.status === 'error' && (
          <div role="alert" className="flex flex-col gap-2.5 text-[13px] text-axal-destructive dark:text-red-300" data-testid="grants-history-unreadable">
            <span>The history could not be read. That is not the same as none.</span>
            <button type="button" className={DANGER} onClick={reload}>Try again</button>
          </div>
        )}
        {read.status === 'ready' && read.items.length === 0 && (
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="grants-history-empty">
            {program ? 'No decision is recorded for this program yet.' : 'No program decision is recorded yet. Each grant, change and answer HQ makes appears here.'}
          </p>
        )}
        {read.status === 'ready' && read.items.length > 0 && (
          <ol className="m-0 flex list-none flex-col p-0">
            {read.items.map((e) => {
              const l = historyLine(e);
              return (
                <li key={e.id} className="flex flex-col gap-0.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`grants-history-row-${e.id}`}>
                  <span className={EYE}>{day(e.at)} · {l.by} · {l.studio}</span>
                  <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{l.what}</span>
                  {l.details.map((d) => <span key={d} className={`${SUB} font-mono`}>{d}</span>)}
                  {l.reason ? <span className={SUB}>HQ’s reason: {l.reason}</span> : null}
                </li>
              );
            })}
          </ol>
        )}
        {read.status === 'ready' && read.next ? (
          <div className="flex flex-col gap-1.5">
            <button type="button" className={GHOST} onClick={loadMore} disabled={more.busy} data-testid="grants-history-more">{more.busy ? 'Reading…' : 'Show older'}</button>
            {more.error ? <span role="alert" className="text-[12.5px] text-axal-destructive dark:text-red-300">The older history could not be read. Try again.</span> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** The page inside the Licences board's rail frame, as the grid (D981 §1). */
export default function ProgramGrantsHistory() {
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads the grants on this page. It changes nothing." data-testid="admin-board-program-grants-history">
      <ProgramGrantsHistoryPage />
    </AdminBoardFrame>
  );
}
