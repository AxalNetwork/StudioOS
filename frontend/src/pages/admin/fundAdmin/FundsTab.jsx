import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lightbox, Pill, Unrecorded } from '../../../ui';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { refusalText } from './fundAdminModel';
import { withQuery } from './lpsModel';
import { Line, NUM, Note, Panel, ReadFailure, Section, Table } from './parts';
import { LABEL } from './FundTabs';
import { useRead } from './useRead';
import {
  FUNDS_EMPTY, FUNDS_FOOT, FUND_NAME_MAX, FUND_STATUSES, NEW_FUND_INFO, NO_CARRY, NO_FEE, NO_GP, OUTSIDE_LINE, SORTS,
  checkNewFund, filterFunds, gpText, lpaOnFile, rateText, sizeText, splitFunds, statusLabel,
} from './fundsModel';

/**
 * D1161 (#3068, part 4 of #2388) — the Funds tab (FND3).
 *
 * `GET /api/funds` lists every fund to an admin. The funds the console
 * administers (the overview's funds block) fill the table; the rest are run
 * by an outside GP and sit in a collapsed card, each opening its own fund
 * page. A carry or fee the fund did not record reads Not recorded, never 20%
 * or 2%. A failed read says so, never "No funds yet".
 *
 * New fund opens in-page: the header's primary sets `?new=1`. It asks for
 * both rates, so the store's 20% and 2% defaults are never taken silently.
 */
const INFO = 'm-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100';
const STATUS_TONE = { active: 'ok', fundraising: 'info', closed: 'neutral', wound_down: 'neutral' };

export const fundHref = (id) => `/admin/fund-admin/funds/${id}`;

export function FundsTab({ apis, access, overview }) {
  const location = useLocation();
  const navigate = useNavigate();
  const list = useRead(() => apis.funds.list(), [apis]);
  const [toolbar, setToolbar] = useState({ q: '', status: '', sort: 'vintage' });
  const [outsideOpen, setOutsideOpen] = useState(false);
  const creating = new URLSearchParams(location.search).get('new') === '1';
  const closeNew = () => navigate(`${location.pathname}${withQuery(location.search, 'new', undefined)}`, { replace: true });

  const items = list.status === 'ready' && Array.isArray(list.data?.items) ? list.data.items : [];
  const overviewDone = overview.status === 'ready' || overview.status === 'unreadable';
  const split = splitFunds(items, overview.status === 'ready' ? overview.data : null);
  const rows = filterFunds(split.administered, toolbar);
  const set = (k) => (e) => { const v = e.target.value; setToolbar((t) => ({ ...t, [k]: v })); };

  let body;
  if (list.status === 'loading' || list.status === 'idle' || (list.status === 'ready' && !overviewDone)) body = <Panel label="Administered funds"><div className="px-4 py-3 sm:px-5"><LoadingRows lines={3} /></div></Panel>;
  else if (list.status === 'unreadable' || !Array.isArray(list.data?.items)) {
    body = (
      <Panel label="Administered funds" testId="funds-unreadable">
        <div className="px-4 py-3 sm:px-5"><ReadFailure what="The funds" claim="This is not a claim that there are none." onRetry={list.reload} /></div>
      </Panel>
    );
  } else if (items.length === 0) {
    body = <Panel label="Administered funds" testId="funds-empty"><Note>{FUNDS_EMPTY}</Note></Panel>;
  } else {
    body = <>
      <Panel label="Administered funds" sub={`${rows.length} of ${split.administered.length}`} testId="funds-table">
        <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-4 py-2.5 sm:px-5 dark:border-gray-800">
          <input className={`${INPUT} sm:max-w-[240px]`} placeholder="Search funds" value={toolbar.q} onChange={set('q')} aria-label="Search funds" data-testid="funds-search" />
          <select className={`${INPUT} sm:w-auto`} value={toolbar.status} onChange={set('status')} aria-label="Status" data-testid="funds-status">
            <option value="">Every status</option>
            {FUND_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className={`${INPUT} sm:w-auto`} value={toolbar.sort} onChange={set('sort')} aria-label="Sort" data-testid="funds-sort">
            {SORTS.map(([k, l]) => <option key={k} value={k}>{`Sort: ${l}`}</option>)}
          </select>
        </div>
        {!split.known && <Note testId="funds-split-unknown">Which funds an outside GP runs could not be read, so every fund is listed here.</Note>}
        {rows.length === 0
          ? <Note testId="funds-no-match">{split.administered.length ? 'No fund matches this search.' : 'No fund is administered by the console. Each fund is run by an outside GP, below.'}</Note>
          : <Table wide rows={rows} rowKey={(f) => f.id} rowTestId={(f) => `funds-row-${f.id}`}
            template="1.3fr 1fr .6fr 1.05fr .45fr .85fr .95fr 1.2fr .75fr 1fr .5fr"
            cols={[
              { key: 'name', label: 'Fund', cell: (f) => <Link className="font-bold text-axal-ink hover:underline dark:text-gray-100" to={fundHref(f.id)} data-testid={`funds-open-${f.id}`}>{f.name || `Fund #${f.id}`}</Link> },
              { key: 'status', label: 'Status', cell: (f) => <Pill tone={STATUS_TONE[f.status] || 'neutral'}>{statusLabel(f.status)}</Pill> },
              { key: 'vintage', label: 'Vintage', mono: true, cell: (f) => f.vintage_year ?? <Unrecorded /> },
              { key: 'size', label: 'Fund size', mono: true, cell: (f) => sizeText(f.fund_size_cents) ?? <Unrecorded /> },
              { key: 'lps', label: 'LPs', mono: true, cell: (f) => (f.lp_count != null ? f.lp_count : <Unrecorded />) },
              { key: 'carry', label: 'Carry', mono: true, cell: (f) => <span data-testid={`funds-carry-${f.id}`}>{rateText(f.carried_interest) ?? <Unrecorded reason={NO_CARRY} />}</span> },
              { key: 'fee', label: 'Management fee', mono: true, cell: (f) => <span data-testid={`funds-fee-${f.id}`}>{rateText(f.management_fee) ?? <Unrecorded reason={NO_FEE} />}</span> },
              { key: 'gp', label: 'GP of record', cell: (f) => gpText(f) ?? <span className="text-axal-muted dark:text-gray-400">{f.gp_user_id != null ? 'Named, no document name recorded' : NO_GP}</span> },
              { key: 'lpa', label: 'LPA', cell: (f) => (lpaOnFile(f)
                ? <span className="font-bold text-axal-positive dark:text-emerald-300">✓ On file</span>
                : <span className="font-bold text-amber-700 dark:text-amber-300">◷ Pending</span>) },
              { key: 'slug', label: 'Slug', cell: (f) => (f.slug ? <span className={`${NUM} text-[11px] text-axal-muted dark:text-gray-400`}>{f.slug}</span> : <Unrecorded />) },
              { key: 'open', label: '', align: 'right', cell: (f) => <Link className={BTN.link} to={fundHref(f.id)}>Open</Link> },
            ]}
            foot={<Note>{FUNDS_FOOT}</Note>}
          />}
      </Panel>
      {split.outside.length > 0 && (
        <Panel label={`Run by an outside GP · ${split.outside.length}`} testId="funds-outside"
          aside={<button type="button" className={BTN.link} aria-expanded={outsideOpen} onClick={() => setOutsideOpen((o) => !o)} data-testid="funds-outside-toggle">{outsideOpen ? '▴ Collapse' : '▾ Show'}</button>}>
          {outsideOpen && split.outside.map((f) => (
            <Line key={f.id} testId={`funds-outside-${f.id}`} a={f.name || `Fund #${f.id}`}
              b={[f.vintage_year ? `Vintage ${f.vintage_year}` : 'Vintage not recorded', gpText(f) ? `run by ${gpText(f)}` : 'run by an outside GP', OUTSIDE_LINE].join(' · ')}
              action={<Link className={BTN.ghost} to={fundHref(f.id)}>Open fund page</Link>} />
          ))}
        </Panel>
      )}
    </>;
  }

  return (
    <Section title="Funds" sub="Every fund Axal VC administers, with its economics, its general partner of record and its LPA." testId="funds-tab">
      {body}
      {creating && <NewFundDialog apis={apis} access={access} onClose={closeNew}
        onCreated={(fund) => { closeNew(); list.reload(); overview.reload?.(); if (fund?.id) navigate(fundHref(fund.id)); }} />}
    </Section>
  );
}

/** FND3's New fund: name, vintage, target size, status and both rates. Nothing is written until Create fund. */
export function NewFundDialog({ apis, access, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', vintage: '', size: '', status: 'fundraising', carry: '', fee: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const submit = async (e) => {
    e.preventDefault();
    const out = checkNewFund(form);
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError('');
    try {
      const res = await apis.funds.create(out.body);
      await onCreated(res?.fund || null);
    } catch (err) { setError(refusalText(err, 'The fund could not be created.')); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="New fund" title="New fund" sub="Nothing is written until the fund is created." testId="funds-new-dialog" onClose={onClose} width={520}>
      <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit} data-testid="funds-new-form">
        <label className={LABEL}>Name<input className={`${INPUT} mt-1`} value={form.name} maxLength={FUND_NAME_MAX} onChange={set('name')} disabled={busy} data-testid="funds-new-name" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>Vintage year<input className={`${INPUT} mt-1 ${NUM}`} inputMode="numeric" value={form.vintage} onChange={set('vintage')} disabled={busy} placeholder="Optional" data-testid="funds-new-vintage" /></label>
          <label className={LABEL}>Target size ($)<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.size} onChange={set('size')} disabled={busy} placeholder="Optional" data-testid="funds-new-size" /></label>
          <label className={LABEL}>Status
            <select className={`${INPUT} mt-1`} value={form.status} onChange={set('status')} disabled={busy} data-testid="funds-new-status">
              {FUND_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <span />
          <label className={LABEL}>Carry % · required<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.carry} onChange={set('carry')} disabled={busy} data-testid="funds-new-carry" /></label>
          <label className={LABEL}>Management fee % · required<input className={`${INPUT} mt-1 ${NUM}`} inputMode="decimal" value={form.fee} onChange={set('fee')} disabled={busy} data-testid="funds-new-fee" /></label>
        </div>
        <p className={INFO}>{NEW_FUND_INFO}</p>
        {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="funds-new-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <FundActControl access={access} act="fund.create" testId="funds-new-submit-refused" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">
            <button type="submit" className={BTN.primary} disabled={busy} data-testid="funds-new-submit">Create fund</button>
          </FundActControl>
        </div>
      </form>
    </Lightbox>
  );
}
