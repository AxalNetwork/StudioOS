/** D6154, DE19/20/27: the Commit zone's scoped decision list and opening sheet; /ic is a forwarding entry only. */
import React, {useEffect,useMemo,useState} from 'react';
import {Link,Navigate,useNavigate} from 'react-router-dom';
import {api,dd} from '../lib/api';
import {useAuth} from '../hooks/useAuthSync';
import Sheet from '../ui/Sheet';
import {tallyText,ballotOf} from './icDecisionModel';
const field='w-full rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const button='min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700';
const itemsOf=r=>Array.isArray(r)?r:r?.items??r?.projects??[];
export default function ICDecisionsPage(){return <Navigate to="/deals/commit?view=decisions" replace/>;}
export function ICDecisionsList({items=[],onReload}){
 const {user,role}=useAuth();const navigate=useNavigate();
 const [view,setView]=useState('All'),[venture,setVenture]=useState(''),[open,setOpen]=useState(false);
 const [choices,setChoices]=useState(null),[choiceError,setChoiceError]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState({title:'',deal:'',project:'',case:'',scoring:false,memo:''});
 const [terms,setTerms]=useState([]);
 const mine=d=>d.status!=='decided'&&d.roster?.available&&d.roster.not_voted?.some(v=>Number(v.user_id)===Number(user?.id));
 const tabs=['All','Mine to vote','Voting','Draft','Decided'];
 const inTab=(d,t)=>t==='All'||(t==='Mine to vote'?mine(d):d.status===t.toLowerCase());
 const shown=items.filter(d=>inTab(d,view)&&(!venture||d.project_name===venture));
 const ventures=useMemo(()=>[...new Set(items.map(d=>d.project_name).filter(Boolean))],[items]);
 const loadChoices=()=>{setChoiceError('');setChoices(null);Promise.allSettled([api.listProjects(),role==='investor'?api.listDeals(undefined,'mine'):Promise.resolve([]),dd.listCases()]).then(([projects,deals,cases])=>{
   if(projects.status==='rejected'||deals.status==='rejected'){setChoiceError('Unreadable: the venture or deal choices could not be read.');return;}
   setChoices({projects:itemsOf(projects.value),deals:itemsOf(deals.value),cases:cases.status==='fulfilled'?itemsOf(cases.value):[],caseError:cases.status==='rejected'});
 });};
 useEffect(()=>{if(open)loadChoices();},[open,role]);
 const submit=async e=>{e.preventDefault();setBusy(true);setError('');try{
   const payload={title:form.title.trim(),memo:form.memo||undefined,from_scoring:form.scoring,terms:Object.fromEntries(terms.filter(t=>t.label.trim()).map(t=>[t.label.trim(),t.value]))};
   if(form.project)payload.project_id=Number(form.project);if(form.deal)payload.deal_id=Number(form.deal);if(form.case)payload.dd_case_id=Number(form.case);
   const result=await api.icCreate(payload);setOpen(false);onReload?.();navigate(`/deals/commit/${encodeURIComponent(result.uid)}`);
 }catch(e){setError(`${e.status===403||e.status===402?'Refused':'Could not open the decision'}: ${e.message}`);}finally{setBusy(false);}};
 return <section className="space-y-4" data-testid="ic-decision-list">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">All decisions</h2><p className="text-sm text-gray-600 dark:text-gray-400">Decisions, votes, reasons and conditions.</p></div><button className={button} onClick={()=>{setForm({title:'',deal:'',project:'',case:'',scoring:false,memo:''});setTerms([]);setError('');setOpen(true);}}>Open a decision</button></header>
  <div className="flex flex-wrap gap-2" role="tablist" aria-label="Decision view">{tabs.map(t=><button key={t} role="tab" aria-selected={view===t} onClick={()=>setView(t)} className={`${button} ${view===t?'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200':''}`}>{t} <span>{items.filter(d=>inTab(d,t)).length}</span></button>)}</div>
  <label className="block text-sm">Venture <select className={field} value={venture} onChange={e=>setVenture(e.target.value)}><option value="">Any venture</option>{ventures.map(v=><option key={v}>{v}</option>)}</select></label>
  <p className="text-xs text-gray-600 dark:text-gray-400">Mine to vote: roster members without a vote, of the 100 most recent decisions. No roster means eligibility is not recorded.</p>
  {!shown.length?<p className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">{items.length?'No decisions match this view.':'No investment decision is open. Open a decision when a deal is ready for the committee.'}</p>:<div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">{shown.map(d=><article key={d.uid} className="grid gap-2 p-4 md:grid-cols-[2fr_1fr_2fr]">
   <div><Link className="font-bold text-violet-700 underline dark:text-violet-300" to={`/deals/commit/${encodeURIComponent(d.uid)}`}>{d.title||'Untitled decision'}</Link><p className="text-sm text-gray-600 dark:text-gray-400">{d.project_name||'Venture not recorded'}</p></div>
   <div className="text-sm"><p>{d.status}</p><p>{d.decision||'Not decided'}</p><p>To vote: {d.roster?.available?d.roster.to_vote:'Not recorded'}</p></div>
   <div className="text-sm"><p>{tallyText(d.tally)}</p><p>Rationales: {ballotOf(d).rationales} of {ballotOf(d).voted} votes cast</p><p>My vote: {d.votes?.find(v=>Number(v.user_id)===Number(user?.id))?.vote||'Not voted yet'}</p></div>
  </article>)}</div>}
  {open&&<Sheet title="Open a decision" onClose={()=>!busy&&setOpen(false)}><form onSubmit={submit} className="space-y-4 p-4">
    <label className="block text-sm">Title<input required className={field} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
    {!choices&&!choiceError&&<p role="status">Reading choices…</p>}{choiceError&&<div role="alert">{choiceError}<button type="button" className={button} onClick={loadChoices}>Try again</button></div>}
    <label className="block text-sm">Deal<select className={field} disabled={role!=='investor'||!choices} value={form.deal} onChange={e=>setForm({...form,deal:e.target.value})}><option value="">{role==='investor'?'No deal':'Deal flow is an investor’s own'}</option>{choices?.deals.map(d=><option key={d.id} value={d.id}>{d.startup_name||d.title||d.name||'Unnamed deal'}</option>)}</select></label>
    <label className="block text-sm">Venture<select className={field} disabled={!choices} value={form.project} onChange={e=>setForm({...form,project:e.target.value,scoring:false})}><option value="">No venture</option>{choices?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="block text-sm">Diligence case<select className={field} disabled={!choices||choices.caseError} value={form.case} onChange={e=>setForm({...form,case:e.target.value})}><option value="">{choices?.caseError?'Refused or unreadable: diligence cases':'No diligence case'}</option>{choices?.cases.map(c=><option key={c.id} value={c.id}>{c.subject_label||c.title||c.uid}</option>)}</select></label>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={!form.project} checked={form.scoring} onChange={e=>setForm({...form,scoring:e.target.checked})}/>Start from the scorecard memo, when one is saved for this venture</label>
    <label className="block text-sm">Memo (optional)<textarea className={field} value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})}/></label>
    <fieldset><legend>Proposed terms (optional)</legend>{terms.map((t,i)=><div key={i} className="flex flex-wrap gap-2 py-1"><input aria-label={`Term ${i+1}`} className={field} value={t.label} onChange={e=>setTerms(terms.map((x,j)=>i===j?{...x,label:e.target.value}:x))}/><input aria-label={`Value ${i+1}`} className={field} value={t.value} onChange={e=>setTerms(terms.map((x,j)=>i===j?{...x,value:e.target.value}:x))}/><button type="button" className={button} onClick={()=>setTerms(terms.filter((_,j)=>j!==i))}>Remove line {i+1}</button></div>)}<button type="button" className={button} onClick={()=>setTerms([...terms,{label:'',value:''}])}>Add a line</button></fieldset>
    <p className="text-xs text-gray-600 dark:text-gray-400">Opens in Draft. Nothing is sent to anyone. Choosing a deal does not choose the venture.</p>
    {error&&<p role="alert">{error}</p>}<button className={button} disabled={busy||!choices||!form.title.trim()}>{busy?'Opening…':'Open decision'}</button>
  </form></Sheet>}
 </section>;
}
