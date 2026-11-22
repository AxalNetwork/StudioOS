/** D6214: approved PF-13–19 reporting-settings sheet; revisions apply from the current period. */
import { useCallback, useEffect, useRef, useState } from 'react';
import Sheet from '../../ui/Sheet.jsx';
import './reportingSettings.css';
import { portfolioReportingSettingsApi as api } from '../../lib/api/portfolioReportingSettings.js';
export default function PortfolioReportingSettings({ onClose, onSaved }) {
 const [books,setBooks]=useState({loading:true,items:[]});
 const [fund,setFund]=useState('hq');
 const [reads,setReads]=useState({});
 const [draft,setDraft]=useState(null);
 const [due,setDue]=useState(30);
 const [edit,setEdit]=useState(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [conflict,setConflict]=useState(null);
 const [makingOwn,setMakingOwn]=useState(false);
 const attempt=useRef(0);
 useEffect(()=>{let live=true;api.books().then(r=>{if(!Array.isArray(r?.items))throw new Error();if(live)setBooks({items:r.items});}).catch(()=>{if(live)setBooks({error:true,items:[]});});return()=>{live=false;};},[]);
 const load=useCallback(async()=>{
  const own=++attempt.current;setReads({monthly:{loading:true},quarterly:{loading:true}});setDraft(null);setError('');setConflict(null);setMakingOwn(false);
  const out={};
  await Promise.all(['monthly','quarterly'].map(async cadence=>{
   try{const value=await api.read(fund,cadence);if(!Array.isArray(value?.all_rules)||!Array.isArray(value?.rules)||!Number.isSafeInteger(value.revision))throw new Error();out[cadence]={value};}
   catch{out[cadence]={error:true};}
   if(own===attempt.current)setReads(previous=>({...previous,[cadence]:out[cadence]}));
  }));
  if(own===attempt.current&&out.monthly.value&&out.quarterly.value){
   if(out.monthly.value.revision!==out.quarterly.value.revision){setError('The rules changed while loading. Read them again before editing.');return;}
   setDraft(structuredClone(out.monthly.value.all_rules));setDue(out.monthly.value.due_days);
  }
 },[fund]);
 useEffect(()=>{load();return()=>{attempt.current+=1;};},[load]);
 const current=reads.monthly?.value;
 const editable=current?.can_manage===true&&draft!==null;
 const dirty=draft&&current&&(makingOwn||JSON.stringify(draft)!==JSON.stringify(current.all_rules)||due!==current.due_days);
 const bookContext={id:fund,name:fund==='hq'?'Firm-wide':books.items.find(b=>String(b.id)===fund)?.name||'Fund reporting rules'};
 const close=()=>{if(dirty){setError('Save your changes or discard them before closing.');return;}onClose(bookContext);};
 const move=(index,offset)=>setDraft(rows=>{const copy=[...rows],next=index+offset;if(next<0||next>=copy.length)return rows;[copy[index],copy[next]]=[copy[next],copy[index]];return copy.map((r,i)=>({...r,sort_order:i}));});
 const saveFigure=()=>{
  const row=edit.row;
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(row.kpi_key)||!row.name.trim()||!row.applies_to.trim()){setError('Enter a valid key, name and scope for the figure.');return;}
  const other=draft.find((r,i)=>i!==edit.index&&r.kpi_key===row.kpi_key);
  if(other){setError(`The key is already used by ${other.name}.`);return;}
  setDraft(rows=>edit.index===rows.length?[...rows,{...row,sort_order:rows.length}]:rows.map((r,i)=>i===edit.index?row:r));setEdit(null);setError('');
 };
 const save=async()=>{
  if(!editable||busy)return;
  if(!Number.isInteger(due)||due<0||due>365){setError('Choose a due day from 0 to 365.');return;}
  setBusy(true);setError('');
  try{const result=await api.save(fund,{revision:current.revision,rules:draft,due_days:due});if(!result?.revision)throw new Error();onSaved(`Rules saved. They apply from ${result.effective_month} and ${result.effective_quarter}; earlier periods keep their recorded rules.`,bookContext);}
  catch(e){
   if(e?.status===409){
    setError('The rules changed. Your changes are kept below; compare them before saving.');
    try { const latest=await api.read(fund,'monthly'); if(!Array.isArray(latest.all_rules)||!Number.isSafeInteger(latest.revision))throw new Error(); setConflict(latest); }
    catch { setConflict({unavailable:true}); }
   } else setError('The rules could not be saved. Your changes are kept. Try again.');
  }
  finally{setBusy(false);}
 };
 return <Sheet title="Reporting settings" width={560} onClose={close} footer={<div className="pf-tools">
  {editable&&<button type="button" className="pf-btn is-primary" onClick={save} disabled={busy||!dirty||Boolean(conflict)}>{busy?'Saving…':'Save rules'}</button>}
  {dirty&&<button type="button" className="pf-btn" onClick={()=>onClose(bookContext)} disabled={busy}>Discard changes</button>}
  <button type="button" className="pf-btn" onClick={close} disabled={busy}>Close</button>
 </div>}>
  <div className="pf-reporting-settings">
  <p>Each fund inherits the HQ set until it records its own. A change applies from the current monthly and quarterly periods.</p>
  {books.error?<p role="alert">Funds unavailable. Close and reopen settings to try again.</p>:<label className="pf-select">Book<select aria-label="Reporting book" value={fund} disabled={busy||dirty||books.loading} onChange={e=>setFund(e.target.value)}><option value="hq">HQ default · read only</option>{books.items.map(b=><option key={b.id} value={String(b.id)}>{b.name}</option>)}</select></label>}
  {['monthly','quarterly'].map(cadence=><section key={cadence} aria-label={`${cadence} figures`}><h3>{cadence==='monthly'?'Monthly':'Quarterly'} · {reads[cadence]?.value?.period||'current period'}</h3>
   {reads[cadence]?.loading?<p aria-busy="true">Reading figures…</p>:reads[cadence]?.error?<p role="alert">Unavailable: these figures could not be read. <button type="button" onClick={load}>Read again</button></p>:<>
    {reads[cadence]?.value?.inherited&&<p>Inherited from HQ</p>}
    {draft?.filter(r=>r.cadence===cadence).length===0&&<p>No figure is recorded at this cadence.</p>}
    {(draft||reads[cadence]?.value?.rules||[]).map((row,index)=>row.cadence!==cadence?null:<article className="pf-card" key={row.kpi_key} onKeyDown={e=>{if(editable&&e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();move(index,e.key==='ArrowUp'?-1:1);}}}>
      <h4>{row.name} · {row.unit||'Unit not recorded'}</h4><p>{row.required?'Required':'Optional'} · {row.applies_to==='all'?'All companies':`${row.applies_to} only`}</p><p>{row.definition||'Definition not recorded'}</p>
      {editable&&<div className="pf-tools"><button type="button" className="pf-btn" disabled={busy} onClick={()=>setEdit({index,row:{...row}})}>Edit {row.name}</button><button type="button" className="pf-btn" disabled={busy||index===0} onClick={()=>move(index,-1)} aria-label={`Move ${row.name} up`}>Move up</button><button type="button" className="pf-btn" disabled={busy||index===draft.length-1} onClick={()=>move(index,1)} aria-label={`Move ${row.name} down`}>Move down</button></div>}
    </article>)}
   </>}
  </section>)}
  {editable&&current.inherited&&!makingOwn&&<button type="button" className="pf-btn" disabled={busy} onClick={()=>setMakingOwn(true)}>Make this fund’s own set</button>}
  {makingOwn&&<p>Own set · not saved yet</p>}
  {editable&&<button type="button" className="pf-btn" disabled={draft.length>=100||busy} onClick={()=>setEdit({index:draft.length,row:{kpi_key:'',name:'',unit:null,definition:null,cadence:'monthly',required:1,applies_to:'all',sort_order:draft.length}})}>Add figure</button>}
  <label>Due day · days after period end<input type="number" aria-label="Reporting due days" min="0" max="365" value={draft?due??'':''} disabled={!editable||busy} onChange={e=>setDue(e.target.value===''?null:Number(e.target.value))}/></label>
  <p>A signed reporting duty keeps its own due day. These rules supply the fund default.</p>
  {current&&<p>Last changed: {current.updated_at||'Not recorded'} · {current.updated_by_name||'Actor not recorded'} · applies from {current.effective_from}.</p>}
  {conflict&&<section aria-label="Compare reporting rules"><h3>Compare changes</h3>
    <p>Your changes: {draft.map(r=>`${r.name} (${r.required?'Required':'Optional'}, ${r.cadence}, ${r.applies_to})`).join('; ')} · Due after {due} days.</p>
    {conflict.unavailable?<p>Current rules unavailable. Your changes remain here.</p>:<>
      <p>Current rules: {conflict.all_rules.map(r=>`${r.name} (${r.required?'Required':'Optional'}, ${r.cadence}, ${r.applies_to})`).join('; ')} · Due after {conflict.due_days} days.</p>
      <button type="button" className="pf-btn" onClick={()=>{setDraft(structuredClone(conflict.all_rules));setDue(conflict.due_days);setReads(previous=>({...previous,monthly:{value:conflict}}));setConflict(null);setError('');}}>Use current rules</button>
      <button type="button" className="pf-btn" onClick={()=>{setReads(previous=>({...previous,monthly:{value:conflict}}));setConflict(null);setError('Compare the fields, then save your reconciled rules.');}}>Keep editing my changes</button>
    </>}
  </section>}
  {error&&<div role="alert"><p>{error}</p><button type="button" className="pf-btn" onClick={load} disabled={busy}>Read latest rules</button>{current&&<p>Previously read: {current.all_rules.map(r=>`${r.name} (${r.required?'Required':'Optional'})`).join(', ')}</p>}</div>}
  {edit&&<Sheet title="Edit figure" width={640} onClose={()=>setEdit(null)} footer={<button type="button" className="pf-btn is-primary" onClick={saveFigure}>Save figure</button>}>
   {['name','kpi_key','unit'].map(key=><label key={key}>{({name:'Figure',kpi_key:'Key',unit:'Unit',definition:'Definition',applies_to:'Applies to (all or one stage)'})[key]}<input aria-label={`Figure ${key}`} value={edit.row[key]??''} readOnly={key==='kpi_key'&&edit.index<draft.length} maxLength={key==='definition'?1000:100} onChange={e=>setEdit(previous=>({...previous,row:{...previous.row,[key]:e.target.value}}))}/></label>)}
   <label>Definition<textarea aria-label="Figure definition" value={edit.row.definition??''} maxLength={1000} onChange={e=>setEdit(previous=>({...previous,row:{...previous.row,definition:e.target.value}}))}/></label>
   <label>Applies to<select aria-label="Figure applies_to" value={edit.row.applies_to} onChange={e=>setEdit(previous=>({...previous,row:{...previous.row,applies_to:e.target.value}}))}>
    <option value="all">All companies</option>{[...new Set([...(current.stages||[]),edit.row.applies_to].filter(stage=>stage!=='all'))].map(stage=><option key={stage} value={stage}>{stage}{!(current.stages||[]).includes(stage)?' · no current company':''}</option>)}
   </select></label>
   <label>Cadence<select value={edit.row.cadence} onChange={e=>setEdit(previous=>({...previous,row:{...previous.row,cadence:e.target.value}}))}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label>
   <label><input type="checkbox" checked={Boolean(edit.row.required)} onChange={e=>setEdit(previous=>({...previous,row:{...previous.row,required:e.target.checked?1:0}}))}/>Required</label>
   {error&&<p role="alert">{error}</p>}
  </Sheet>}
  </div>
 </Sheet>;
}
