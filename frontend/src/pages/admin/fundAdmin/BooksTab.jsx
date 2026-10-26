import { useState } from 'react';
import { FundLedgerView } from '../../investor/FundLedgerPanel';
import { Line, Note, Panel, Section } from './parts';
import { useRead } from './useRead';

/** D1165: reuse the operational ledger on Books; mounting other parts reads nothing here. */
export function BooksTab({ apis, selectedFund, onFund }) {
  const list = useRead(async () => {
    const data = await apis.ledger.list();
    if (!Array.isArray(data?.items)) throw new Error('The fund ledgers could not be read.');
    return data;
  }, [apis]);
  const [period, setPeriod] = useState(null);
  const [view, setView] = useState('journal');
  const items = list.data?.items || [];
  const fundId = selectedFund || items[0]?.id;
  const fund = items.find(f => String(f.id) === String(fundId));
  const detail = useRead(async () => {
    const item = await apis.ledger.read(fundId, period);
    if (!item || String(item.id) !== String(fundId) || String(item.period?.id) !== String(period)) throw new Error('The selected accounting period could not be read.');
    return item;
  }, [apis, fundId, period], { enabled: Boolean(fund && period) });
  const data = detail.data ? items.map(f => String(f.id) === String(detail.data.id) ? detail.data : f) : items;
  const current = detail.data || fund;
  return <Section title="Books" testId="banking-books" sub="The recorded journal, accounting periods and trial balance. No opening balance or bank agreement is inferred.">
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <FundLedgerView items={fund ? data : []} loading={list.status === 'loading' || Boolean(period && detail.status === 'loading')}
      error={list.status === 'unreadable' || detail.status === 'unreadable' ? 'The books could not be read. Try again.' : null}
      reload={() => { list.reload(); if (period) detail.reload(); }} fundId={fundId} periodId={period} view={view} layout="admin"
      onFundChange={id => { setPeriod(null); onFund(id); }} onPeriodChange={setPeriod} onViewChange={setView} />
    <aside className="flex min-w-0 flex-col gap-4">
      <Panel label="Periods" testId="books-periods">
        {list.status === 'loading' ? <Note>Reading…</Note> : list.status === 'unreadable' ? <Note>Unreadable: the accounting periods could not be read.</Note> : !fund?.periods?.length ? <Note>Not recorded: no accounting period was read.</Note> : fund.periods.map(p => <Line key={p.id} a={p.label} b={`${p.start_date || 'Start not recorded'} to ${p.end_date || 'End not recorded'} · ${p.closed ? 'Closed' : 'Open'}`} action={<button type="button" className="min-h-11 text-sm font-bold text-axal-violet dark:text-violet-300" data-testid={`books-period-${p.id}`} onClick={() => setPeriod(p.id)}>Open</button>} />)}
      </Panel>
      <Panel label="Line reconcile" testId="books-reconcile">
        {list.status === 'loading' || detail.status === 'loading' ? <Note>Reading…</Note> : list.status === 'unreadable' || detail.status === 'unreadable' ? <Note>Unreadable: the journal lines could not be read.</Note> : !current?.can_manage ? <Note>This ledger grants summary access only.</Note> : !(current?.journal || []).some(e => e.lines?.length) ? <Note>Not recorded: no journal line was read for this period.</Note> : current.journal.flatMap((e, i) => (e.lines || []).map((l, j) => <Line key={`${i}-${j}`} a={`${l.code} · ${l.name}`} b={l.reconciled_by == null ? 'Not recorded: no bank reconciliation is linked to this line.' : `Reconciled by Admin #${l.reconciled_by}${l.statement_reference ? ` · ${l.statement_reference}` : ''}`} />))}
      </Panel>
    </aside>
    </div>
  </Section>;
}
