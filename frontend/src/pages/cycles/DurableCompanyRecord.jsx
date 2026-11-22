/** D6122 part 2, GR-22/27: stored meeting steps and Pack absence around the shared, scoped record renderer. */
import RecordView from './RecordView';
import {DataState} from '../../ui/Honesty';
export function readonlyCompanyRecord(record){
 const section=s=>({...s,action:undefined,rows:(s.rows||[]).map(({action,actions,...row})=>row)});
 return {...record,actions:[],next:null,facts:(record.facts||[]).map(({action,...fact})=>fact),main:(record.main||[]).map(section),side:(record.side||[]).map(section)};
}
export default function DurableCompanyRecord({record,readOnly=false,...handlers}){
 const main=record.main||[],past=main.find(s=>s.key==='past-meetings'),agenda=main.find(s=>s.key==='agenda');
 const due=record.facts?.find(f=>f.label==='Due')?.value;
 const minutes=record.side?.find(s=>s.key==='documents')?.rows?.find(r=>r.a==='Minutes')?.b;
 return <div className="space-y-4" data-testid="company-obligation-record">
  {readOnly&&<p role="status" className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">Read only. You can review the obligation and its history.</p>}
  {record.parts?.meeting&&<><ol aria-label="Meeting record" className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">{[['Agenda',agenda?.rows?.length?`${agenda.rows.length} recorded`:'None recorded'],['Pack','Not recorded'],['Held',past?.rows?.length?'Recorded in past meetings':'Not held yet'],['Minutes',minutes||'Not recorded']].map(([label,value])=><li key={label} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"><strong className="block">{label}</strong><span>{value==='Not recorded'?<DataState state="not_recorded" reasonVisible={false}/>:value}</span></li>)}</ol>
  {due&&<p className="text-sm text-gray-600 dark:text-gray-400">Current due: {String(due)}. Mark held records this occurrence and follows the stored repeat for the next due date.</p>}
  <section aria-label="Meeting pack" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><h2 className="font-semibold">Pack</h2><p className="text-sm text-gray-600 dark:text-gray-400"><DataState state="not_recorded" reason="A saved meeting pack and accepting a drafted agenda are not available here yet."/></p></section></>}
  <RecordView record={readOnly?readonlyCompanyRecord(record):record} {...handlers}/>
 </div>;
}
