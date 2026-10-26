import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Pill, Unrecorded, Unreadable } from '../../../ui';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import {
  FILTERS, NOT_RECORDED, ROW_MENU, SORTS, bookletText, cell, day, identityText, lpHref, lpIdFrom, lpTiles, lpTypeText,
  rosterQuery, typeBars, typeNote, typeSummary, withQuery,
} from './lpsModel';
import { NUM, Note, Panel, Section, TH, Table, Tiles } from './parts';
import { useRead } from './useRead';
import { LpDrawer } from './LpDrawer';
import { AddLpDialog, ContactDialog, LpTypeDialog } from './LpDialogs';

/**
 * D1162 (#3069) — FND5, every LP of every administered fund at
 * `/admin/fund-admin/lps`, from `GET /api/fund-admin/lps` (D1158): the tiles,
 * commitment by LP type ("Not recorded" a dashed outline), the table with
 * its filters, search, sort and pages (all on the Worker, kept in the
 * address), the row menu, and Add LP. FND6, one LP's drawer, opens over it at
 * `/admin/fund-admin/lps/:id`.
 *
 * Add LP is `fund.write`, an Admin's act; a first call issues a call, which
 * is a Super Admin's (`capital_call.issue`), so an Admin adds the LP without
 * one and reads the sentence in its place.
 */
const CHIP = 'inline-flex min-h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold max-sm:min-h-[44px]';
const chipTone = (on) => (on
  ? 'border-axal-violet bg-axal-violet/10 text-axal-violet-deep dark:text-violet-300'
  : 'border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-100');

/** A missing figure with the Worker's reason; a held one in mono. */
function Fig({ row, k, testId }) {
  const c = cell(row, k);
  return c.reason ? <span title={c.reason} data-testid={testId}><Unrecorded reason={c.reason}>{c.text}</Unrecorded></span> : <span data-testid={testId}>{c.text}</span>;
}

export function LpsTab({ apis, access, funds }) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = rosterQuery(location.search);
  const key = JSON.stringify(query);
  const roster = useRead(() => apis.fundAdmin.lps(query), [apis, key]);
  const [dialog, setDialog] = useState(null);
  const lpId = lpIdFrom(location.pathname);
  const adding = dialog?.kind === 'add' || new URLSearchParams(location.search).get('add') === '1';
  const go = (k, v) => navigate(`${location.pathname}${withQuery(location.search, k, v)}`, { replace: true });
  const closeAdd = () => { setDialog(null); if (adding) go('add', undefined); };
  const data = roster.status === 'ready' ? roster.data : null;
  const rows = data?.items || [];

  return (
    <Section title="LPs" sub="Every LP of every fund administered here: commitment, calls, LPA, identity check and booklet."
      aside={<button type="button" className={BTN.primary} onClick={() => setDialog({ kind: 'add' })} data-testid="lps-add">Add LP</button>}
      testId="lps-section">
      {roster.status === 'unreadable' && (
        <div data-testid="lps-unreadable"><Unreadable what="The LPs" claim="This is not a claim that there are none." onRetry={roster.reload} /></div>
      )}
      {(roster.status === 'loading' || roster.status === 'idle') && !data && <LoadingRows lines={4} />}
      {data && <Tiles testId="lps-tiles" items={lpTiles(data)} />}
      {data && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <TypeChart tally={data.tally} />
          <Panel label="LP applications" testId="lps-applications">
            <Note>LP applications are decided in Approvals.</Note>
            <div className="px-4 pb-4 sm:px-5"><Link className={BTN.ghost} to="/admin/lp-applications" data-testid="lps-open-applications">Open LP applications</Link></div>
          </Panel>
        </div>
      )}
      <Panel label="LPs" sub={data ? `${data.total_rows} LP${data.total_rows === 1 ? '' : 's'}` : null} testId="lps-table-panel">
        <Toolbar query={query} search={location.search} go={go} />
        {data && (rows.length === 0
          ? <Note testId="lps-empty"><Unrecorded>No LP matches these filters.</Unrecorded></Note>
          : <Table wide testId="lps-table" rowTestId={(r) => `lps-row-${r.limited_partner_id}`} rowKey={(r) => r.limited_partner_id} rows={rows}
            template="1.4fr .9fr .9fr 1fr 1fr 1fr 1fr 1fr .7fr .9fr .8fr .9fr 2.5rem"
            cols={[
              { key: 'lp', label: 'LP', cell: (r) => (
                <Link to={lpHref(r.limited_partner_id, location.search)} className="block min-w-0" data-testid={`lps-open-${r.limited_partner_id}`}>
                  <span className="block font-bold text-axal-ink dark:text-gray-100">{r.name || r.email || `LP ${r.limited_partner_id}`}</span>
                  {r.email && <span className="block break-all text-[11px] text-axal-muted dark:text-gray-400">{r.email}</span>}
                </Link>) },
              { key: 'fund', label: 'Fund', cell: (r) => r.fund_name || NOT_RECORDED },
              { key: 'type', label: 'Type', cell: (r) => (r.lp_type ? lpTypeText(r.lp_type) : <Unrecorded reason={r.unavailable?.lp_type}>{NOT_RECORDED}</Unrecorded>) },
              { key: 'commitment', label: 'Commitment', align: 'right', mono: true, cell: (r) => <Fig row={r} k="commitment_cents" /> },
              { key: 'called', label: 'Called', align: 'right', mono: true, cell: (r) => <Fig row={r} k="called_cents" testId={`lps-called-${r.limited_partner_id}`} /> },
              { key: 'received', label: 'Received', align: 'right', mono: true, cell: (r) => <Fig row={r} k="received_cents" /> },
              { key: 'outstanding', label: 'Outstanding', align: 'right', mono: true, cell: (r) => <Fig row={r} k="outstanding_cents" /> },
              { key: 'distributed', label: 'Distributed', align: 'right', mono: true, cell: (r) => <Fig row={r} k="distributed_cents" /> },
              { key: 'lpa', label: 'LPA', cell: (r) => (r.lpa_signed ? <Pill tone="ok">Signed</Pill> : <Pill tone="warn">Pending</Pill>) },
              { key: 'identity', label: 'Identity', cell: (r) => (r.kyc_status ? identityText(r.kyc_status) : <Unrecorded reason={r.unavailable?.kyc_status}>{NOT_RECORDED}</Unrecorded>) },
              { key: 'booklet', label: 'Booklet', cell: (r) => (r.booklet ? bookletText(r.booklet) : <Unrecorded reason={r.unavailable?.booklet}>{NOT_RECORDED}</Unrecorded>) },
              { key: 'notice', label: 'Last notice', mono: true, cell: (r) => (r.last_notice ? day(r.last_notice.issued_at) : <Unrecorded reason={r.unavailable?.last_notice}>{NOT_RECORDED}</Unrecorded>) },
              { key: 'menu', label: '', align: 'right', cell: (r) => <RowMenu row={r} onPick={(kind) => (kind === 'open' ? navigate(lpHref(r.limited_partner_id, location.search)) : setDialog({ kind, row: r }))} /> },
            ]}
            foot={<Pager data={data} go={go} />} />)}
      </Panel>
      {adding && <AddLpDialog apis={apis} access={access} funds={funds} fundId={query.fund} onClose={closeAdd} onAdded={roster.reload} />}
      {dialog?.kind === 'type' && <LpTypeDialog apis={apis} access={access} row={dialog.row} onClose={() => setDialog(null)} onChanged={roster.reload} />}
      {dialog?.kind === 'contact' && <ContactDialog apis={apis} access={access} row={dialog.row} onClose={() => setDialog(null)} />}
      {lpId && <LpDrawer apis={apis} access={access} lpId={lpId} onClose={() => navigate(`/admin/fund-admin/lps${withQuery(location.search, 'page', query.page > 1 ? query.page : undefined)}`)} onChanged={roster.reload} />}
    </Section>
  );
}

/** The chart by LP type, with its table: the type no row records is a dashed outline, never a guessed type. */
function TypeChart({ tally }) {
  const [table, setTable] = useState(false);
  const bars = typeBars(tally);
  return (
    <Panel label="Commitment by LP type" testId="lps-types"
      aside={bars.length > 0 && (
        <div className="flex gap-1" role="group" aria-label="Show as">
          {[['Chart', false], ['Table', true]].map(([t, v]) => (
            <button key={t} type="button" aria-pressed={table === v} onClick={() => setTable(v)} data-testid={`lps-types-show-${t.toLowerCase()}`}
              className={`${CHIP} ${chipTone(table === v)}`}>{t}</button>
          ))}
        </div>
      )}>
      {bars.length === 0
        ? <Note testId="lps-types-empty"><Unrecorded>No LP is in these filters.</Unrecorded></Note>
        : (
          <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
            <p className="m-0 text-[13px] font-medium text-axal-ink dark:text-gray-100" data-testid="lps-types-note">{typeNote(bars)}</p>
            {table ? (
              <table className="w-full text-left text-[12px]" data-testid="lps-types-table">
                <thead><tr><th className={TH}>Type</th><th className={TH}>LPs</th><th className={`${TH} text-right`}>Commitment</th></tr></thead>
                <tbody>{bars.map((b) => (
                  <tr key={b.key} className="border-t border-axal-hairline dark:border-gray-800">
                    <td className="py-1.5 text-zinc-700 dark:text-gray-200">{b.label}</td>
                    <td className={`py-1.5 ${NUM}`}>{b.lps}</td>
                    <td className={`py-1.5 text-right ${NUM}`}>{b.text}</td>
                  </tr>))}</tbody>
              </table>
            ) : (
              <div role="img" aria-label={typeSummary(bars)} className="flex flex-col gap-2.5" data-testid="lps-types-chart">
                {bars.map((b) => (
                  <div key={b.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-[12.5px] sm:grid-cols-[170px_minmax(0,1fr)_120px]" data-testid={`lps-type-${b.key}`}>
                    <span className="text-zinc-700 dark:text-gray-200">{b.label} · {b.lps} LP{b.lps === 1 ? '' : 's'}</span>
                    <span className="col-span-2 row-start-2 h-3 sm:col-span-1 sm:row-start-auto">
                      {b.width > 0 && <span className={`block h-full rounded-[3px] ${b.dashed ? 'box-border border-[1.5px] border-dashed border-axal-muted dark:border-gray-500' : 'bg-axal-violet dark:bg-violet-400'}`}
                        style={{ width: `${b.width}%` }} data-testid={b.dashed ? 'lps-type-dashed' : undefined} />}
                    </span>
                    <span className={`text-right ${NUM} font-semibold text-zinc-700 dark:text-gray-200`}>{b.text}</span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-axal-muted dark:text-gray-400">
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-axal-violet dark:bg-violet-400" />Commitment</span>
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="box-border h-2.5 w-3.5 rounded-[3px] border border-dashed border-axal-muted dark:border-gray-500" />Type not recorded</span>
                </div>
              </div>
            )}
          </div>
        )}
    </Panel>
  );
}

/** Search, the filters, the toggles and the sort: each kept in the address, applied on the Worker. */
function Toolbar({ query, search, go }) {
  const [q, setQ] = useState(query.q || '');
  const select = (k, list, label) => (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select className={`${INPUT} w-auto`} value={query[k] || ''} onChange={(e) => go(k, e.target.value)} data-testid={`lps-filter-${k}`}>
        {list.map(([v, l]) => <option key={v || 'any'} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <div className="flex flex-col gap-2.5 border-b border-axal-hairline px-4 py-3 sm:px-5 dark:border-gray-800" data-testid="lps-toolbar">
      <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go('q', q.trim()); }}>
        <input className={INPUT} type="search" placeholder="Search name or email" aria-label="Search name or email" value={q}
          onChange={(e) => setQ(e.target.value)} maxLength={100} data-testid="lps-search" />
        <button type="submit" className={BTN.ghost} data-testid="lps-search-go">Search</button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {select('lpa', FILTERS.lpa, 'LPA')}
        {select('identity', FILTERS.identity, 'Identity')}
        {select('booklet', FILTERS.booklet, 'Booklet')}
        <button type="button" aria-pressed={!!query.outstanding} className={`${CHIP} ${chipTone(query.outstanding)}`} onClick={() => go('outstanding', !query.outstanding)} data-testid="lps-filter-outstanding">Has outstanding</button>
        <button type="button" aria-pressed={!!query.overdue} className={`${CHIP} ${chipTone(query.overdue)}`} onClick={() => go('overdue', !query.overdue)} data-testid="lps-filter-overdue">Overdue</button>
        <label className="flex items-center gap-1.5">
          <span className={TH}>Sort</span>
          <select className={`${INPUT} w-auto`} value={query.sort} onChange={(e) => go('sort', e.target.value)} data-testid="lps-sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button type="button" className={`${CHIP} ${chipTone(false)}`} onClick={() => go('dir', query.dir === 'asc' ? 'desc' : 'asc')}
          aria-label={query.dir === 'asc' ? 'Ascending; sort descending' : 'Descending; sort ascending'} data-testid="lps-dir">{query.dir === 'asc' ? '↑ Ascending' : '↓ Descending'}</button>
      </div>
    </div>
  );
}

function Pager({ data, go }) {
  const from = data.total_rows ? (data.page - 1) * data.per_page + 1 : 0;
  const to = Math.min(data.total_rows, data.page * data.per_page);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-4 py-3 sm:px-5 dark:border-gray-800" data-testid="lps-pager">
      <span className={`text-[12px] text-axal-muted dark:text-gray-400 ${NUM}`} data-testid="lps-count">{`${from}–${to} of ${data.total_rows}`}</span>
      <div className="flex gap-2">
        <button type="button" className={BTN.ghost} disabled={data.page <= 1} onClick={() => go('page', data.page - 1 > 1 ? data.page - 1 : undefined)} data-testid="lps-prev">Previous</button>
        <button type="button" className={BTN.ghost} disabled={data.page >= data.pages} onClick={() => go('page', data.page + 1)} data-testid="lps-next">Next</button>
      </div>
    </div>
  );
}

/** The row menu (FND5): Open, Set LP type, Log a contact. */
function RowMenu({ row, onPick }) {
  const [open, setOpen] = useState(false);
  const id = row.limited_partner_id;
  return (
    <div className="relative inline-block text-left">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${row.name || row.email || `LP ${id}`}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-axal-sm text-axal-muted hover:bg-gray-100 max-sm:h-11 max-sm:w-11 dark:text-gray-400 dark:hover:bg-gray-800"
        onClick={() => setOpen((v) => !v)} data-testid={`lps-menu-${id}`}>⋯</button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 min-w-[170px] rounded-axal-md border border-axal-hairline bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          {ROW_MENU.map(([k, label]) => (
            <button key={k} type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800"
              onClick={() => { setOpen(false); onPick(k); }} data-testid={`lps-menu-${id}-${k}`}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

