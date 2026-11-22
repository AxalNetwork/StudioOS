/** D6057 (#6057): PS04 Design/Data/Eadwyn inspector; all panes stay mounted while changing tabs. */
import {useId,useState} from 'react';
const TABS=['Design','Data','Eadwyn'];
export default function EditorInspector({design,data,eadwyn}) {
 const [tab,setTab]=useState('Design');const id=useId();
 return <aside className="min-w-0 self-start rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900" aria-label="Card inspector" data-testid="pitch-editor-inspector">
  <div role="tablist" aria-label="Inspector" className="flex border-b border-axal-hairline dark:border-gray-700" onKeyDown={e=>{
   const at=TABS.indexOf(tab);const next=e.key==='ArrowRight'?(at+1)%3:e.key==='ArrowLeft'?(at+2)%3:e.key==='Home'?0:e.key==='End'?2:null;
   if(next==null)return;e.preventDefault();setTab(TABS[next]);e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  }}>{TABS.map(t=><button key={t} id={`${id}-${t}`} type="button" role="tab" aria-selected={tab===t} aria-controls={`${id}-${t}-panel`} tabIndex={tab===t?0:-1} onClick={()=>setTab(t)} className="min-h-[44px] flex-1 px-2 text-[12px] font-bold aria-selected:border-b-2 aria-selected:border-axal-violet aria-selected:text-axal-violet dark:aria-selected:text-violet-300">{t}</button>)}</div>
  {TABS.map(t=><div key={t} id={`${id}-${t}-panel`} role="tabpanel" aria-labelledby={`${id}-${t}`} hidden={tab!==t} className="space-y-3 p-3" data-testid={`pitch-inspector-${t.toLowerCase()}`}>{t==='Design'?design:t==='Data'?data:eadwyn}</div>)}
 </aside>;
}
