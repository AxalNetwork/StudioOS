/**
 * D5060 (#5060, part 3) — the Licences registry by family (Licences and Contracts v2 addendum, board L36): one
 * table across operator and user licences, read from `/api/admin/licence-registry`. Ten columns: Licence ref,
 * Holder, Type, Scope / territory, Package / plan, Status, Renewal, Agreement, Programs, Attention. A user row has
 * no territory: its Scope cell is empty and heard as "Not applicable". Every cell is one state
 * (`../licenceRegistryModel.js`); a store the database lacks is Not recorded, a failed read Unreadable, never zero.
 *
 * The family chips sit on the Licences page (`FamilyChips`); Operator / territory keeps the operator ledger with
 * Needs HQ (boards L01, L02). Clicking a holder filters the registry to that holder (`?holder=`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { licenceRegistryApi } from '../../../lib/api/licenceRegistry';
import { reportError } from '../../../lib/log';
import { Unreadable } from '../../../ui';
import {
  FAMILIES, agreementCell, attentionCell, familyCount, holderCell, holderParam, packageCell, programsCell, renewalCell,
  scopeCell, statusWord,
} from '../licenceRegistryModel';

const TAG = {
  value: 'text-gray-900 dark:text-gray-100',
  none: 'text-gray-600 dark:text-gray-400',
  not_recorded: 'italic text-gray-500 dark:text-gray-400',
  unreadable: 'font-semibold text-red-700 dark:text-red-300',
  not_on_ledger: 'text-[12px] text-gray-500 dark:text-gray-400',
};

/** One cell's state with its word. Unreadable carries its "!" so the state is never colour alone. */
function Cell({ c, testId }) {
  if (c.state === 'not_applicable') {
    return <span data-state="not_applicable" data-testid={testId}><span className="sr-only">{c.aria}</span></span>;
  }
  return (
    <span className={TAG[c.state] || TAG.value} data-state={c.state} title={c.reason || undefined} data-testid={testId}>
      {c.state === 'unreadable' ? `! ${c.label}` : c.label}
    </span>
  );
}

/** The family chips (board L36), with each family's count over the whole registry when the read has it. */
export function FamilyChips({ family, counts, onChange }) {
  return (
    <div role="radiogroup" aria-label="Licence family" className="mt-4 flex flex-wrap gap-1.5" data-testid="licence-family-filter">
      {FAMILIES.map((f) => {
        const n = familyCount(counts, f.key);
        const on = family === f.key;
        return (
          <button
            key={f.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(f.key)}
            data-testid={`licence-family-${f.key}`}
            className={`min-h-[32px] rounded-full border px-3 text-xs font-semibold ${on
              ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-200'
              : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'}`}
          >
            {f.label}{n !== null ? <span className="ml-1 font-mono text-[11px] opacity-70">{n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px]';
const COLUMNS = ['Licence ref', 'Holder', 'Type', 'Scope / territory', 'Package / plan', 'Status', 'Renewal', 'Agreement', 'Programs', 'Attention'];

function HolderButton({ row, onHolder }) {
  const c = holderCell(row);
  const param = holderParam(row);
  if (c.state !== 'value' || !param) return <Cell c={c} testId="registry-holder" />;
  return (
    <button
      type="button" onClick={() => onHolder(param, c.label)} title={`Show every licence ${c.label} holds`}
      className="text-left font-semibold text-gray-900 underline decoration-transparent hover:decoration-current dark:text-gray-100"
      data-testid="registry-holder"
    >
      {c.label}
    </button>
  );
}

/**
 * Opens the licence: a user licence's type-aware detail, or the territory licence's own page (`rowHref`). Each path
 * is written out whole, so the route guard (`admin_route_reachability.test.mjs`) reads it as a door.
 */
function RowLink({ row, className, testId, children }) {
  return row.licence_family === 'user'
    ? <Link to={`/admin/licences/registry/user/${encodeURIComponent(row.uid)}`} className={className} data-testid={testId}>{children}</Link>
    : <Link to={`/admin/licences/${encodeURIComponent(row.uid)}`} className={className} data-testid={testId}>{children}</Link>;
}

function RegistryRow({ row, onHolder }) {
  const attention = attentionCell(row);
  return (
    <tr className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="registry-row" data-uid={row.uid} data-family={row.licence_family}>
      <td className={TD}>
        <RowLink row={row} className="font-mono text-[12.5px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300" testId="registry-open">
          {row.licence_ref}
        </RowLink>
      </td>
      <td className={TD}><HolderButton row={row} onHolder={onHolder} /></td>
      <td className={TD}>{row.licence_type_label}</td>
      <td className={TD}><Cell c={scopeCell(row)} testId="registry-scope" /></td>
      <td className={TD}><Cell c={packageCell(row)} testId="registry-package" /></td>
      <td className={TD}><span data-testid="registry-status">{statusWord(row.status)}</span></td>
      <td className={TD}><Cell c={renewalCell(row)} testId="registry-renewal" /></td>
      <td className={TD}><Cell c={agreementCell(row.agreement)} testId="registry-agreement" /></td>
      <td className={TD}>
        {row.licence_family === 'user'
          ? <RowLink row={row} className="text-[12px] text-indigo-700 hover:underline dark:text-indigo-300" testId="registry-programs">{programsCell(row).label}</RowLink>
          : <Cell c={programsCell(row)} testId="registry-programs" />}
      </td>
      <td className={TD}>
        <span title={attention.items ? attention.items.map((a) => a.label).join('\n') : undefined}>
          <Cell c={attention} testId="registry-attention" />
        </span>
      </td>
    </tr>
  );
}

/**
 * The registry for one family. `holder` is the chosen holder filter (`{ param, name }`) or null. `onCounts` hands
 * the page each read's family counts for its chips.
 */
export function RegistryLedger({ family, query, status, holder, onHolder, onClearHolder, onCounts }) {
  const [read, setRead] = useState({ state: 'loading', data: null });
  const [extra, setExtra] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const filters = { family, q: query || undefined, status: status || undefined, holder: holder?.param || undefined };
  const key = JSON.stringify(filters);

  useEffect(() => {
    let live = true;
    setRead((r) => ({ state: 'loading', data: r.data }));
    setExtra([]);
    licenceRegistryApi.page(filters).then(
      (data) => { if (!live) return; setRead({ state: 'ready', data }); onCounts?.(data?.counts || null); },
      (e) => { reportError('licence-registry:page', e); if (live) setRead({ state: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setTick((t) => t + 1), []);
  const d = read.data;
  const cursor = extra.length ? extra[extra.length - 1].next_cursor : d?.next_cursor;
  const rows = [...(d?.items || []), ...extra.flatMap((p) => p.items || [])];

  async function more() {
    setLoadingMore(true);
    try {
      const page = await licenceRegistryApi.page({ ...filters, cursor });
      setExtra((x) => [...x, page]);
    } catch (e) {
      reportError('licence-registry:more', e);
    } finally { setLoadingMore(false); }
  }

  const holderChip = holder ? (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs" data-testid="registry-holder-filter">
      <span className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 font-semibold text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">
        Holder: {holder.name || rows.find((r) => holderParam(r) === holder.param)?.holder?.name || holder.param}
      </span>
      <button type="button" onClick={onClearHolder} className="font-semibold text-indigo-700 underline dark:text-indigo-300" data-testid="registry-holder-clear">Clear holder</button>
    </p>
  ) : null;

  if (read.state === 'error') {
    return (
      <div className="mt-4">
        {holderChip}
        <Unreadable what="The licence registry" claim="This is not a claim that no licences exist." onRetry={retry} />
      </div>
    );
  }
  if (!d) return <p className="mt-4 text-sm text-gray-500 dark:text-gray-400" data-testid="registry-loading">Reading the registry…</p>;
  if (d.available === false) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400" data-testid="registry-not-recorded">
        <span className="font-semibold">Not recorded.</span> {d.reason}
      </p>
    );
  }
  const familyLabel = FAMILIES.find((f) => f.key === family)?.label || 'All';
  const filtered = Boolean(query || status || holder);
  return (
    <>
      {holderChip}
      {rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700" data-testid="registry-none">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {filtered
              ? 'No licence in this family matches the search, status or holder. Clear them to see every licence in it.'
              : family === 'all' ? 'No licence of any family has been issued.' : `No ${familyLabel} licence has been issued.`}
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[1080px] border-collapse" data-testid="registry-table">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">{COLUMNS.map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>{rows.map((row) => <RegistryRow key={row.uid} row={row} onHolder={onHolder} />)}</tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 font-mono text-[12px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <span data-testid="registry-count">{Number.isFinite(d.total) ? `Showing ${rows.length} of ${d.total}` : `Showing ${rows.length}`}</span>
            {cursor && (
              <button
                type="button" onClick={more} disabled={loadingMore} data-testid="registry-more"
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {loadingMore ? 'Loading…' : 'Show more'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
