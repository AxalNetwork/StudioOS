import React, { useEffect, useState } from 'react';
import { useFundLedger } from '../../lib/fundLedger';
import { fundLedgerApi } from '../../lib/api/fundLedger.js';
import { Section, FilterChips, EmptyState } from '../advisor/network/kit';
import ErrorState from '../../components/ErrorState';
import Skeleton from '../../components/Skeleton';
import { Table } from '../admin/fundAdmin/parts';
const money=value=>value==null ? 'Not recorded' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);

/** Read-only layouts from IF3 and Fund Administration's fee-by-period table. */
export function FundLedgerView({items=[],loading=false,error=null,reload=()=>{},fundId,onFundChange=()=>{},periodId,onPeriodChange=()=>{},view='summary',onViewChange=()=>{},layout='default'}) {
  if (loading) return <div aria-busy="true" className="space-y-3"><Skeleton h={16} w="50%" /><Skeleton.Table rows={4} cols={4} /></div>;
  if (error) return <ErrorState message={`Unreadable: ${error}`} onRetry={reload} />;
  const fund=items.find(f=>String(f.id)===String(fundId)) || items[0];
  if (!fund) return <EmptyState>Not recorded: no accessible fund ledger is recorded.</EmptyState>;
  const full=fund.can_manage, selectedView=full ? view : 'summary', summary=fund.summary || {};
  const period=fund.period;
  return <div className="space-y-4" data-testid="fund-ledger-recorded">
    <FilterChips options={items.map(f=>({id:String(f.id),label:f.name}))} value={String(fund.id)} onChange={onFundChange} />
    {fund.periods?.length>0 && <FilterChips options={fund.periods.map(p=>({id:String(p.id),label:p.label}))} value={String(periodId || period?.id || '')} onChange={onPeriodChange} />}
    {full && <FilterChips options={[{id:'summary',label:'Summary'},{id:'journal',label:'Journal'},{id:'fees',label:'Fees'}]} value={selectedView} onChange={onViewChange} />}
    <p className="text-xs text-gray-500 dark:text-gray-400">Operational fund ledger; not the fund’s statutory books. No opening balances are inferred.</p>
    <Section title={`${fund.name}${period ? ` · ${period.label}` : ''}`}>
      {period && <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{period.start_date} to {period.end_date} · {period.closed ? 'Closed' : 'Open'}{full ? ' · Administrator read' : ' · LP summary only'}</p>}
      {fund.reason ? <EmptyState>{fund.reason}</EmptyState> : selectedView==='fees' ?
        <LedgerTable rows={[
          ['Management fee accrued',summary.fee_cents,summary.fee_cents==null?'Not recorded':'Posted','Accrual from explicitly recorded fee terms'],
          ['Management fee collected',null,'Not recorded','No fee collection record is linked to this ledger'],
        ]} /> : selectedView==='journal' ? <>
          {layout === 'admin' ? <JournalTable fund={fund} /> : <LedgerTable rows={(fund.journal || []).flatMap(entry=>entry.lines.map(line=>[
            `${line.code} · ${line.name}`,line.debit_cents-line.credit_cents,line.reconciled_by!=null?'Reconciled':'Posted',
            `${entry.entry_date} · ${entry.description} · Actor #${entry.recorded_by}${line.statement_reference ? ` · ${line.statement_reference} / ${line.statement_line_reference}` : ''}`,
          ]))} />}
          <h3 className="mt-4 mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Trial balance · selected period</h3>
          <LedgerTable rows={(fund.trial_balance || []).map(a=>[`${a.code} · ${a.name}`,a.debit_cents-a.credit_cents,'Recorded',`Debit ${money(a.debit_cents)} · Credit ${money(a.credit_cents)}`])} />
        </> : <LedgerTable rows={[
          ['Management fee accrued',summary.fee_cents,summary.fee_cents==null?'Not recorded':'Posted','Recorded fee terms; actual days / 365'],
          ['Fund expenses',summary.expense_cents,summary.expense_cents==null?'Not recorded':'Posted','Expense account lines, excluding management fee accruals'],
        ]} />}
    </Section>
  </div>;
}
function LedgerTable({rows}) {
  return <div className="rounded-xl border border-gray-200 dark:border-gray-800"><table className="w-full text-sm">
    <thead className="hidden sm:table-header-group bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400"><tr>{['Line','Amount','State','Note'].map(label=><th key={label} className="text-left font-medium px-4 py-2.5">{label}</th>)}</tr></thead>
    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{rows.map(([label,value,state,note],index)=><tr key={`${label}-${index}`} className="block border-b last:border-b-0 sm:table-row bg-white dark:bg-gray-900">
      <td className="block break-words px-4 py-2.5 sm:table-cell text-gray-900 dark:text-gray-100">{label}</td><td className="block break-words px-4 py-2.5 sm:table-cell tabular-nums text-gray-900 dark:text-gray-100"><span className="mr-2 text-gray-500 sm:hidden">Amount</span>{money(value)}</td>
      <td className="block break-words px-4 py-2.5 sm:table-cell text-gray-600 dark:text-gray-400"><span className="mr-2 text-gray-500 sm:hidden">State</span>{state}</td><td className="block break-words px-4 py-2.5 sm:table-cell text-gray-500 dark:text-gray-400"><span className="mr-2 text-gray-500 sm:hidden">Note</span>{note}</td>
    </tr>)}</tbody></table></div>;
}
export default function FundLedgerPanel() {
  const state=useFundLedger();
  const [fundId,setFundId]=useState(null), [periodId,setPeriodId]=useState(null), [view,setView]=useState('summary');
  const [detail,setDetail]=useState({item:null,loading:false,error:null});
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setDetail({item:null,loading:Boolean(fundId && periodId),error:null});
    if (fundId && periodId) fundLedgerApi.read(fundId,periodId).then(item=>{
      if (!item || String(item.id)!==String(fundId) || String(item.period?.id)!==String(periodId)) throw new Error('The selected accounting period could not be read.');
      if (!cancelled) setDetail({item,loading:false,error:null});
    }).catch(error=>{if(!cancelled) setDetail({item:null,loading:false,error:error?.message || 'Please retry.'});});
    return ()=>{cancelled=true;};
  },[fundId,periodId,revision]);
  const items=detail.item ? state.items.map(f=>String(f.id)===String(detail.item.id) ? detail.item : f) : state.items;
  return <FundLedgerView items={items} loading={state.loading || detail.loading} error={state.error || detail.error}
    reload={()=>{state.reload();setRevision(n=>n+1);}} fundId={fundId} periodId={periodId} view={view}
    onFundChange={id=>{setDetail({item:null,loading:false,error:null});setFundId(id);setPeriodId(null);setView('summary');}}
    onPeriodChange={id=>{setDetail({item:null,loading:true,error:null});setFundId(String(fundId || items[0]?.id));setPeriodId(id);}}
    onViewChange={setView} />;
}

function JournalTable({ fund }) {
  const rows = (fund.journal || []).flatMap((entry, e) => (entry.lines || []).map((line, i) => ({ ...line, entry, key: `${e}-${i}` })));
  return <Table testId="books-journal" rows={rows} rowKey={r => r.key} template=".9fr 1.8fr 1.3fr 1fr 1fr .8fr" cols={[
    { key: 'date', label: 'Date', mono: true, cell: r => r.entry.entry_date || 'Not recorded' },
    { key: 'entry', label: 'Entry', cell: r => r.entry.description || 'Not recorded: no entry description.' },
    { key: 'account', label: 'Account', cell: r => `${r.code} · ${r.name}` },
    { key: 'debit', label: 'Debit', mono: true, align: 'right', cell: r => money(r.debit_cents) },
    { key: 'credit', label: 'Credit', mono: true, align: 'right', cell: r => money(r.credit_cents) },
    { key: 'period', label: 'Period', cell: () => fund.period?.label || 'Not recorded: no period recorded.' },
  ]} foot={<p className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">Reconciliation is recorded on individual lines. No agreement with the bank is inferred from these totals.</p>} />;
}
