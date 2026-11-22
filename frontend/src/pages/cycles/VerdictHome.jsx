/** D6018 (#6018): V10/V11 evidence and founder decision, shared by desktop and phone. */
import { Link } from 'react-router-dom';
import { RecordsTable } from './CycleModulePage.jsx';
const BOX='space-y-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const ACTION='inline-flex min-h-[44px] items-center rounded-lg border border-axal-hairline px-3 text-[12.5px] font-semibold text-axal-violet dark:border-gray-700 dark:text-violet-300';
const WORD={proceed:'Proceed',pivot:'Pivot',stop:'Stop'};
export default function VerdictHome({data, projectId, records, recordsStatus, recordsMessage, add, rowHref, onRetry, onRetryRecords, query, onQuery}) {
 const p=data?.parts?.evidence_state;
 const current=p?.state==='ok'?p.current:null;
 const write=data?.parts?.can_write===true;
 const review=`/validate/experiments?project=${projectId}`;
 const missing=p?.state==='ok'&&(p.coverage?.state==='withheld'||p.fit_unrecorded>0||p.missing_results>0||p.hypotheses_without_evidence>0);
 const decisionAction=(label)=>(write&&<Link className={ACTION} to={`/validate/verdict/new?project=${projectId}`}>{label}</Link>);
 return <div className="space-y-4 text-axal-ink dark:text-gray-100" data-testid="verdict-v10">
  <p className="text-[13px] text-axal-muted dark:text-gray-400">Review the evidence, then choose. Eadwyn never chooses for you.</p>
  {p?.state!=='ok'?<section className={BOX} role="alert">Evidence snapshot unavailable. <button type="button" className={ACTION} onClick={onRetry}>Try again</button></section>:<>
   {missing&&<section className={`${BOX} border-amber-300 dark:border-amber-800`} data-testid="verdict-missing"><h2 className="font-bold">Material evidence is missing.</h2><ul className="space-y-1 text-[12.5px]">
    {p.missing_results>0&&<li>{p.missing_results} completed experiments have no result.</li>}
    {p.fit_unrecorded>0&&<li>{p.fit_unrecorded} interview relationships have unknown customer fit.</li>}
    {p.hypotheses_without_evidence>0&&<li>{p.hypotheses_without_evidence} hypotheses have no observed evidence.</li>}
    {p.coverage?.state==='withheld'&&<li>{p.coverage.counted} of {p.coverage.bar} distinct sources available. A decision below the evidence bar is recorded as withheld.</li>}
   </ul><Link className={ACTION} to={review}>Review evidence</Link> {decisionAction('Record a decision anyway')}</section>}
   <section className={BOX} aria-labelledby="verdict-evidence-title"><h2 id="verdict-evidence-title" className="font-bold">Evidence snapshot</h2>
    <p className="text-[11px] text-axal-muted dark:text-gray-400">Computed from linked evidence — this is not a recorded decision.</p>
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Supporting',p.supporting,'interview relationships'],['Contradictory',p.contradicting,'interview relationships'],['Unknown fit',p.fit_unrecorded,'interview relationships'],['Distinct sources',p.coverage?.counted,'available, counted once'],['Experiment results',`${p.results_recorded} of ${p.experiments_done}`,'completed experiments with a result']].map(([label,value,note])=><div key={label}><dt className="text-[12px]">{label}</dt><dd className="text-[20px] font-bold">{value??'Not recorded'}</dd><dd className="text-[11px] text-axal-muted dark:text-gray-400">{note}</dd></div>)}</dl>
    <p className="text-[12px]">Source breadth: {p.coverage?.interviews??'Not recorded'} interviews · {p.coverage?.organizations??'Not recorded'} organizations. A relationship is not a distinct source.</p>
   </section>
  </>}
  <section className={BOX} aria-labelledby="founder-decision-title" data-testid="verdict-founder-decision"><h2 id="founder-decision-title" className="font-bold">Your decision</h2>
   {p?.state!=='ok'?<p>Current decision unavailable.</p>:current?<>
    <p className="text-[18px] font-bold">{WORD[current.decision]}{current.date?` · ${current.date}`:''}</p><p className="whitespace-pre-wrap text-[13px]">{current.reasoning||'Rationale not recorded'}</p>
    {current.evidence!=null&&<p className="text-[12px]">Rests on {current.evidence} sources recorded with this decision.</p>}
    <div className="flex flex-wrap gap-2"><Link className={ACTION} to={`/validate/verdict/${current.id}?project=${projectId}`}>Review the record</Link>
     {current.decision==='stop'?decisionAction('Reopen…'):current.decision==='pivot'?<Link className={ACTION} to={`/validate?project=${projectId}`}>Update the objective</Link>:write&&<Link className={ACTION} to={`/build/plan?project_id=${projectId}`}>Plan the build</Link>}
    </div>{current.decision==='stop'&&<p className="text-[12px]">This direction is stopped. The evidence stays readable. Reopening is a new decision you record yourself.</p>}
   </>:<><p>No decision recorded. Computed evidence states do not choose Proceed, Pivot or Stop.</p><div className="flex flex-wrap gap-2"><Link className={ACTION} to={review}>Review evidence first</Link>{!missing&&decisionAction('Record a decision')}</div></>}
  </section>
  <RecordsTable title="Decision history" records={records} status={recordsStatus} message={recordsMessage} query={query} onQuery={onQuery} onRetry={onRetryRecords} rowHref={rowHref} add={add}/>
 </div>;
}
