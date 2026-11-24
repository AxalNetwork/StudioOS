/** D6037 (#6037): BD31/BD35 founding record, over the existing module and founder forms. */
import { Link } from 'react-router-dom';
import { RecordsTable } from './CycleModulePage.jsx';
import BuildFacts from './BuildFacts.jsx';
const CARD='min-w-0 space-y-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const LINK='inline-flex min-h-[44px] items-center text-[12.5px] font-semibold text-axal-violet dark:text-violet-300';
const n=(v)=>v==null?'Not recorded':`${v}%`;
export default function FoundingTeamHome({data,projectId,records,recordsStatus,recordsMessage,add,rowHref,onRetryRecords,query,onQuery}) {
 const f=data?.facts||{};const founders=Array.isArray(f.founders)?f.founders:[];
 const split=founders.length>0&&founders.every(h=>h.equity!=null)&&f.option_pool_pct!=null&&f.unallocated_pct!=null;
 const adds=Array.isArray(add)?add:[add||records?.add].filter(Boolean);
 const parts=[...founders.map(h=>({label:h.name,value:h.equity})),...(f.other_holders||[]).map(h=>({label:h.name,value:h.equity})),{label:`Option pool · ${f.option_pool_source==='model'?'Modelled':'Record'}`,value:f.option_pool_pct},{label:'Unallocated',value:f.unallocated_pct}];
 const legal=`/raise/legal-engine/founders?project_id=${projectId}`;
 return <div className="space-y-4 text-axal-ink dark:text-gray-100" data-testid="founding-team-home">
  <div className="flex flex-wrap gap-2 sm:hidden">{adds.map(a=>a.onClick?<button key={a.text} className={LINK} type="button" onClick={a.onClick}>{a.text}</button>:a.href?<Link key={a.text} className={LINK} to={a.href}>{a.text}</Link>:null)}</div>
  <section className={CARD}><h2 className="font-bold">Equity split</h2>
   {!founders.length?<p>No founders yet. The equity split and vesting appear here.</p>:split&&parts.every(p=>p.value>=0)&&parts.reduce((s,p)=>s+p.value,0)>0?<>
    <div className="flex h-5 overflow-hidden rounded-full" aria-label="Recorded equity split">{parts.map((p,i)=><div key={p.label} title={`${p.label}: ${p.value}%`} style={{width:`${p.value}%`}} className={['bg-violet-600','bg-violet-400','bg-violet-300','bg-gray-400','bg-gray-200'][i%5]}/>)}</div>
    <ul className="grid gap-1 text-[12px] sm:grid-cols-2">{parts.map(p=><li key={p.label}>{p.label} · {n(p.value)}</li>)}</ul>
   </>:<p>{split?'The recorded percentages do not form a valid split.':f.unallocated_reason||'One or more ownership percentages are not recorded; no split can be drawn.'}</p>}
   <p className="text-[12px]">Unallocated · {n(f.unallocated_pct)}</p>
   <BuildFacts cycle="build" slug="founding-team" data={data} status="ready"/>
  </section>
  <div className="hidden sm:block"><RecordsTable title="Founders" records={records} status={recordsStatus} message={recordsMessage} query={query} onQuery={onQuery} onRetry={onRetryRecords} rowHref={rowHref} add={add}/></div>
  <div className="space-y-3 sm:hidden">{founders.map(h=><article className={CARD} key={h.id}><Link className={LINK} to={`/build/founding-team/h-${h.id}?project=${projectId}`}>{h.name} →</Link><dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-[12px]">{[['Role',h.role],['Equity',n(h.equity)],['Vesting',h.vesting],['Agreement',h.agreement]].map(([l,v])=><div className="contents" key={l}><dt>{l}</dt><dd>{v||'Not recorded'}</dd></div>)}</dl><Link className={LINK} to={h.filing.href}>83(b) · {h.filing.text}</Link></article>)}</div>
  <section className={CARD}><h2 className="font-bold">Vesting</h2>{founders.map(h=><div key={h.id} className="space-y-1 text-[12px]"><Link className={LINK} to={`/build/founding-team/h-${h.id}?project=${projectId}`}>{h.name}</Link><p>Start · {h.start||'Not recorded'} · Cliff · {h.cliff||'Not recorded'} · Fully vested · {h.fully||'Not recorded'}</p><p>Vested · {n(h.vested_pct)}</p>{h.vested_pct!=null&&<progress className="h-2 w-full" value={h.vested_pct} max="100" aria-label={`${h.name} vested`}/>}</div>)}</section>
  <div className="grid gap-4 lg:grid-cols-2">
   <section className={CARD}><h2 className="font-bold">Co-founder agreement</h2>{f.cofounder_decision?.outcome==='solo'&&<p>A solo founder has no co-founder agreement to sign.</p>}{founders.map(h=><p key={h.id} className="text-[12.5px]">{h.name} · {h.agreement} · {h.agreement_date||'Date not recorded'}</p>)}<p className="text-[12px]">Signatures · Not recorded. {f.agreement_reason}</p><Link className={LINK} to={legal}>Draft the co-founder agreement →</Link><p><Link className={LINK} to={legal}>Send for signature →</Link></p><p className="text-[11px] text-axal-muted dark:text-gray-400">Opens the existing legal flow. No agreement is sent from this page.</p></section>
   <section className={CARD}><h2 className="font-bold">83(b) elections</h2>{founders.map(h=><p key={h.id}><Link className={LINK} to={h.filing.href}>{h.name} · {h.filing.text} →</Link></p>)}</section>
   <section className={CARD}><h2 className="font-bold">Contributions log</h2>{f.contributions?.state!=='ok'?<p>Contributions unavailable.</p>:!f.contributions.rows.length?<p>No contributions recorded.</p>:f.contributions.rows.map(c=><p key={c.id} className="break-words text-[12px]">{c.on_date||'Date not recorded'} · {c.founder} · {c.text}</p>)}</section>
   <section className={CARD}><h2 className="font-bold">Roles in Grow</h2>{f.hiring?.state!=='ok'?<p>Hiring roles unavailable.</p>:<><p>{f.hiring.rows.length} roles recorded</p><p className="text-[11px]">{[...new Set(f.hiring.rows.map(h=>h.status))].map(s=>`${f.hiring.rows.filter(h=>h.status===s).length} ${s==='pending_review'?'In review':s.replaceAll('_',' ')}`).join(' · ')}</p>{f.hiring.rows.map(h=><p className="text-[12px]" key={h.id}>{h.title} · {h.team||'Team not recorded'} · {h.target_start||'Start not recorded'} · {h.status==='pending_review'?'In review':h.status?.replaceAll('_',' ')}</p>)}</>}<Link className={LINK} to={`/grow/team-expansion?project=${projectId}`}>Open Team expansion →</Link></section>
  </div>
 </div>;
}
