import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { paymentsApi } from '../../../lib/api/payments';
import { reportError } from '../../../lib/log';
import {
  EXPORT_REASON_MAX, LOG_PAGE, LOG_UNREAD, WHAT_WORDS,
  actionWord, detailText, isFailure, logFilters, logRange, peopleOf, reasonOf, reasonProblem, stampText, whatWord, whoText,
} from './payModel';
import {
  BAD_PILL, CARD, EYE, FIELD, GHOST, H2, MONO, PRIMARY, SUB, PayDialog, Reading, Technical, Unread, usePayPhone,
} from './payUi';

/**
 * D1014 (#2833) — PAY7, the Change log at /admin/platform/payments/log: every
 * change to the catalogue and the Stripe connection, newest first, with who
 * made it. Failed syncs are recorded too. The read is part 3's (D1011,
 * `paymentsApi.changeLog`); its filters drive it, so this tab reads it itself.
 *
 * Product names come from the catalogue read when it answers; when it does
 * not, a row names its product by its ID and nothing else is lost. The CSV
 * export asks why in an in-page dialog: the Worker records the reason before
 * the file leaves, and refuses an export without one.
 */

const EMPTY = { what: '', who: '', product: '', from: '', to: '' };

function useChangeLog(filters, offset, tick) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const sig = JSON.stringify([filters, offset, tick]);
  useEffect(() => {
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    paymentsApi.changeLog({ ...logFilters(filters), limit: LOG_PAGE, offset }).then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { reportError('payments:change-log', e); if (live) setState({ status: 'error', data: null, message: e?.message || null }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return state;
}

function ExportDialog({ filters, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const problem = reasonProblem(reason);
  const submit = async (e) => {
    e?.preventDefault?.();
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await paymentsApi.changeLogCsv(logFilters(filters), reason.trim());
      onDone(out);
    } catch (err) {
      setError(err?.message || 'The export did not go through. Nothing was sent.');
      setBusy(false);
    }
  };
  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
      <button type="submit" form="pay-export-form" className={PRIMARY} disabled={Boolean(problem) || busy} data-testid="pay-export-send">{busy ? 'Exporting…' : 'Export CSV'}</button>
    </div>
  );
  return (
    <PayDialog title="Export the change log" sub="The rows the filters show, as a CSV. Your reason is recorded with the export before the file is sent." onClose={onClose} footer={footer} testId="pay-export">
      <form id="pay-export-form" onSubmit={submit} className="flex flex-col gap-2" data-testid="pay-export-form">
        <label className="flex flex-col gap-1">
          <span className={EYE}>Why are you exporting it?</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={EXPORT_REASON_MAX + 50}
            className={`${FIELD} h-auto py-2`} data-testid="pay-export-reason" />
        </label>
        <span className={SUB} data-testid="pay-export-hint">{problem || 'Ready to export.'}</span>
        {error && <span role="alert" className="text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="pay-export-error">{error}</span>}
      </form>
    </PayDialog>
  );
}

function Filters({ filters, setFilter, kinds, people, products, onClear }) {
  const any = Object.values(filters).some(Boolean);
  return (
    <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-end" data-testid="pay-log-filters">
      <label className="flex flex-col gap-1">
        <span className={EYE}>What</span>
        <select value={filters.what} onChange={(e) => setFilter('what', e.target.value)} className={FIELD} data-testid="pay-log-what">
          <option value="">Everything</option>
          {kinds.map((k) => <option key={k} value={k}>{whatWord(k)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={EYE}>Who</span>
        <select value={filters.who} onChange={(e) => setFilter('who', e.target.value)} className={FIELD} data-testid="pay-log-who">
          <option value="">Anyone</option>
          {people.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        <span className={EYE}>Product</span>
        <select value={filters.product} onChange={(e) => setFilter('product', e.target.value)} className={`${FIELD} md:max-w-[260px]`} data-testid="pay-log-product">
          <option value="">Every product</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={EYE}>From</span>
        <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className={FIELD} data-testid="pay-log-from" />
      </label>
      <label className="flex flex-col gap-1">
        <span className={EYE}>To</span>
        <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className={FIELD} data-testid="pay-log-to" />
      </label>
      {any && <button type="button" className={`${GHOST} self-end`} onClick={onClear} data-testid="pay-log-clear">Clear filters</button>}
    </div>
  );
}

function Row({ e, names, phone }) {
  const product = e.product_id ? (names[e.product_id] || e.product_id) : null;
  const detail = detailText(e);
  const reason = reasonOf(e);
  const what = isFailure(e.action)
    ? <span className={BAD_PILL}><span aria-hidden="true">✕</span>{actionWord(e.action)}</span>
    : <span className="font-bold text-axal-ink dark:text-gray-100">{actionWord(e.action)}</span>;
  const tech = (
    <Technical testId="pay-log-tech">
      {[`action ${e.action}`, e.product_id && `product ${e.product_id}`, e.price_id && `price ${e.price_id}`, e.details && JSON.stringify(e.details)].filter(Boolean).join(' · ')}
    </Technical>
  );
  const detailCell = (
    <>
      {detail ? <span className="block text-axal-ink dark:text-gray-100">{detail}</span> : null}
      {reason ? <span className={`block ${SUB}`}>Reason: {reason}</span> : null}
      {!detail && !reason && <span className={SUB}>—</span>}
      {tech}
    </>
  );
  if (phone) {
    return (
      <li className="flex flex-col gap-1 border-t border-axal-hairline py-2.5 dark:border-gray-700" data-testid="pay-log-row">
        <div className="flex flex-wrap items-center justify-between gap-2">{what}<span className={`${MONO} text-[11.5px] text-axal-muted dark:text-gray-400`}>{stampText(e.at) || e.at}</span></div>
        <span className={SUB}>{whoText(e.who)}{product ? ` · ${product}` : ''}</span>
        {detailCell}
      </li>
    );
  }
  return (
    <tr className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid="pay-log-row">
      <td className={`py-2 pr-3 ${MONO} text-axal-ink dark:text-gray-100`}>{stampText(e.at) || e.at}</td>
      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{whoText(e.who)}</td>
      <td className="py-2 pr-3">{what}</td>
      <td className="py-2 pr-3 text-axal-ink dark:text-gray-100">{product || <span className={SUB}>—</span>}</td>
      <td className="py-2">{detailCell}</td>
    </tr>
  );
}

export default function ChangeLog({ reads }) {
  const phone = usePayPhone();
  // D1012: a product's "Open the change log" arrives with `?product=prod_…`, already filtered.
  const { search } = useLocation();
  const [filters, setFilters] = useState(() => {
    const product = new URLSearchParams(search).get('product');
    return product && /^prod_[A-Za-z0-9]+$/.test(product) ? { ...EMPTY, product } : EMPTY;
  });
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(null);
  const [seen, setSeen] = useState([]);
  const log = useChangeLog(filters, offset, tick);
  const data = log.data;
  const entries = data?.entries || [];
  useEffect(() => { if (log.status === 'ready') setSeen((s) => peopleOf(entries, s)); }, [log.status, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = reads.catalog;
  const products = useMemo(() => (catalog?.status === 'ready' ? (catalog.data?.products || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))) : []), [catalog]);
  const names = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products]);
  const kinds = Array.isArray(data?.kinds) ? data.kinds.filter((k) => WHAT_WORDS[k]) : Object.keys(WHAT_WORDS);
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setOffset(0); };
  const total = Number(data?.total || 0);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} aria-labelledby="pay-h-log" data-testid="pay-log">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pay-h-log" className={H2}>Change log</h2>
        <div className="flex items-center gap-3">
          {log.status === 'ready' && <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid="pay-log-count">{logRange(offset, entries.length, total)}</span>}
          <button type="button" className={GHOST} onClick={() => { setExported(null); setExporting(true); }} disabled={log.status !== 'ready' || total === 0} data-testid="pay-log-export">Export CSV</button>
        </div>
      </div>
      <Filters filters={filters} setFilter={setFilter} kinds={kinds} people={seen} products={products} onClear={() => { setFilters(EMPTY); setOffset(0); }} />
      {catalog?.status === 'error' && <span className={SUB} data-testid="pay-log-names-unread">Product names could not be read, so products are named by their ID.</span>}
      {exported && <span role="status" className={SUB} data-testid="pay-log-exported">Exported {Number(exported.rows || 0).toLocaleString('en-US')} rows as {exported.filename}. The export and its reason are recorded.</span>}
      {log.status === 'loading' && !data && <Reading />}
      {log.status === 'error' && <Unread text={LOG_UNREAD} onRetry={() => setTick((t) => t + 1)} testId="pay-log-unread" />}
      {log.status !== 'error' && data && entries.length === 0 && (
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pay-log-empty">
          {filtered ? 'No change matches these filters.' : 'No change has been recorded yet. Every change to a product, a price, a token pack, the webhook or the publishable key will appear here, and so will each sync.'}
        </p>
      )}
      {log.status !== 'error' && entries.length > 0 && (phone ? (
        <ul className="m-0 list-none p-0" data-testid="pay-log-list">{entries.map((e) => <Row key={e.id} e={e} names={names} phone />)}</ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-[12.5px]" data-testid="pay-log-table">
            <thead>
              <tr className={EYE}>
                {['When', 'Who', 'What', 'Product', 'Detail'].map((t) => <th key={t} scope="col" className="py-1.5 pr-3 font-bold">{t}</th>)}
              </tr>
            </thead>
            <tbody>{entries.map((e) => <Row key={e.id} e={e} names={names} />)}</tbody>
          </table>
        </div>
      ))}
      {log.status === 'ready' && total > LOG_PAGE && (
        <div className="flex items-center gap-2" data-testid="pay-log-pager">
          <button type="button" className={GHOST} disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LOG_PAGE))} data-testid="pay-log-newer">Newer</button>
          <button type="button" className={GHOST} disabled={offset + entries.length >= total} onClick={() => setOffset((o) => o + LOG_PAGE)} data-testid="pay-log-older">Older</button>
        </div>
      )}
      <span className={SUB}>Newest first. Failed syncs are recorded too. Times are UTC.</span>
      {exporting && <ExportDialog filters={filters} onClose={() => setExporting(false)} onDone={(out) => { setExporting(false); setExported(out); }} />}
    </section>
  );
}
