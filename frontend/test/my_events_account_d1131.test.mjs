import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Routes, Route} from 'react-router-dom';
import {h,mountForm,sourceModule,textOf} from './_form_d695.mjs';
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const dropdown=app.slice(app.indexOf('function UserDropdown('),app.indexOf('function PortalSwitcher('));
const source=`import React,{useState,useEffect,useRef} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {isMyEventsPath} from './pages/events/myEventsModel';
const ChevronDown=()=>null;
${dropdown}
export default UserDropdown;`;

test('D1131: account menu marks Events Current on My events and its tabs only',async()=>{
  const Menu=(await sourceModule(source,'App.jsx')).default;
  for(const [path,current] of [['/my/events',true],['/my/events/hosting',true],['/calendar',false]]){
    const ui=await mountForm(h(Routes,{location:path},h(Route,{path:'*',element:h(Menu,{user:{name:'Synthetic',role:'exploring'},onLogout(){}})})),{modal:true});
    try{await ui.click('Synthetic');assert.equal(!!ui.by('account-events-current'),current);const link=ui.nodes().find(n=>ui.props(n).href==='/my/events');assert.equal(ui.props(link)['aria-current'],current?'page':undefined);}finally{await ui.unmount();}
  }
});

test('D1131: phone account sheet carries the same Current marker',async()=>{
  let code=readFileSync(new URL('../src/ui/phone/AccountSheet.jsx',import.meta.url),'utf8');
  code=code.replace(/import \{ api \}[^;]+;/,"const api={wellbeingDaily:async()=>({submitted_today:false})};")
    .replace(/import \{ useActiveCompany \}[^;]+;/,"const useActiveCompany=()=>({company:null});")
    .replace(/import \{ CheckInStatus \}[^;]+;/,"const CheckInStatus=()=>null;");
  const Sheet=(await sourceModule(code,'ui/phone/AccountSheet.jsx')).AccountSheet;
  for(const [path,current] of [['/my/events/past',true],['/account',false]]){
    const ui=await mountForm(h(Routes,{location:path},h(Route,{path:'*',element:h(Sheet,{user:{name:'Synthetic'},onClose(){},onLogout(){}})})),{modal:true});
    try{await ui.flush();assert.equal(textOf(ui.body).includes('EventsCurrent'),current);}finally{await ui.unmount();}
  }
});
