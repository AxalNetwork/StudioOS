/** D4492 MK7c: explicit manual prospect capture and proof, using the existing Sheet. No consent Ask. */
import React,{useRef,useState} from 'react';
import { Sheet } from '../../../ui';
import { PageAsk } from '../../../ui/AskButton';
import { CONSENT_CHOICES,SOURCE_CHIPS,prospectRefusal } from './prospectsModel';
export const PROSPECT_INPUT='min-h-11 w-full rounded-axal-sm border border-axal-hairline bg-white px-3 py-2 text-sm text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const PROSPECT_BUTTON='inline-flex min-h-11 items-center justify-center rounded-axal-sm border border-axal-hairline px-3 text-sm font-semibold disabled:opacity-40 dark:border-gray-700 dark:text-gray-100';
export function ConsentFields({basis,proof,onBasis,onProof,disabled=false}){
  return <fieldset disabled={disabled} className="space-y-3" data-testid="prospect-consent-fields"><legend className="mb-2 text-sm font-semibold">How they agreed to hear from you</legend>
    {CONSENT_CHOICES.map(choice=><label key={choice.value} className="flex min-h-11 items-start gap-2 text-sm"><input type="radio" name="prospect-consent" value={choice.value} checked={basis===choice.value} onChange={()=>onBasis(choice.value)} className="mt-1"/><span>{choice.label}<span className="block text-xs text-axal-muted dark:text-gray-400">{choice.hint}</span></span></label>)}
    {basis!=='none'?<label className="block text-sm">Proof <span className="text-xs text-axal-muted dark:text-gray-400">Form or message, with its date</span><textarea required maxLength={280} value={proof} onChange={e=>onProof(e.target.value)} className={PROSPECT_INPUT}/></label>:null}
  </fieldset>;
}
export default function AddProspectSheet({projectId,ventureName,api,campaigns={status:'loading'},canWrite=false,onClose,onAdded}){
  const [form,setForm]=useState({name:'',company:'',email:'',source:'manual',campaign:'',basis:'none',proof:'',note:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
  const field=key=>e=>setForm(old=>({...old,[key]:e.target.value}));
  const save=async e=>{e.preventDefault();if(!canWrite||lock.current)return;lock.current=true;setBusy(true);setError('');try{const made=await api.add({project:projectId,...form});onAdded?.(made.uid);}catch(err){setError(prospectRefusal(err));}finally{lock.current=false;setBusy(false);}};
  return <Sheet title="Add a prospect" sub={`To ${ventureName||'this venture'}’s contacts`} width={480} onClose={onClose} testId="add-prospect-sheet"
    footer={<div className="flex justify-end gap-2"><button type="button" className={PROSPECT_BUTTON} onClick={onClose}>Cancel</button><button form="add-prospect-form" type="submit" disabled={!canWrite||busy} className={`${PROSPECT_BUTTON} bg-axal-violet text-white`}>{busy?'Adding…':'Add prospect'}</button></div>}>
    <form id="add-prospect-form" onSubmit={save} className="space-y-4 p-5">
      {error?<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>:null}
      <fieldset disabled={!canWrite||busy} className="space-y-4">
        {['name','company','email'].map(key=><label key={key} className="block text-sm capitalize">{key}<input type={key==='email'?'email':'text'} required={key!=='company'} maxLength={key==='email'?254:key==='name'?120:200} value={form[key]} onChange={field(key)} className={PROSPECT_INPUT}/>{key==='email'?<span className="text-xs normal-case text-axal-muted dark:text-gray-400">Shown only in this prospect’s own sheet.</span>:null}</label>)}
        <label className="block text-sm">Source<select value={form.source} onChange={field('source')} className={PROSPECT_INPUT}>{SOURCE_CHIPS.filter(([key])=>key).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block text-sm">Campaign<select value={form.campaign} onChange={field('campaign')} disabled={campaigns.status!=='ready'} className={PROSPECT_INPUT}><option value="">No campaign</option>{(campaigns.rows||[]).map(c=><option key={c.uid} value={c.uid} disabled={!c.utm_campaign}>{c.name}{!c.utm_campaign?' · UTM not recorded':''}</option>)}</select></label>
        {campaigns.status==='unreadable'?<p className="text-xs text-axal-muted dark:text-gray-400">Campaigns could not be read. You can add this prospect without one.</p>:null}
        <ConsentFields basis={form.basis} proof={form.proof} onBasis={basis=>setForm(old=>({...old,basis}))} onProof={proof=>setForm(old=>({...old,proof}))}/>
        <label className="block text-sm">Note{!form.note.trim()?<PageAsk label="Draft a prospect note for me to review" testId="prospect-note-ask"/>:null}<textarea maxLength={2000} value={form.note} onChange={field('note')} className={PROSPECT_INPUT}/></label>
      </fieldset>
      <p className="text-xs text-axal-muted dark:text-gray-400">Nothing sends from this page.</p>
    </form>
  </Sheet>;
}
