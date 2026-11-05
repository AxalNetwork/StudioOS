/** D4492: venture prospects and recorded marketing permissions; Worker routes/grow_prospects.ts. Nothing sends. */
import { request } from '../api.js';
const qs=params=>{const q=new URLSearchParams();for(const[k,v]of Object.entries(params||{}))if(v!=null&&v!=='')q.set(k,String(v));return `?${q}`;};
const base='/grow/prospects';
const write=(path,method,body)=>request(base+path,{method,body:JSON.stringify(body)});
export const growProspectsApi={
  list:params=>request(base+qs(params)),
  detail:(uid,project)=>request(`${base}/${encodeURIComponent(uid)}${qs({project})}`),
  add:body=>write('','POST',body),
  consent:(uid,channel,body)=>write(`/${encodeURIComponent(uid)}/consent/${encodeURIComponent(channel)}`,'PUT',body),
  status:(uid,body)=>write(`/${encodeURIComponent(uid)}/status`,'PATCH',body),
  settings:project=>request(`${base}/settings${qs({project})}`),
  saveSettings:body=>write('/settings','PUT',body),
  suppressions:project=>request(`${base}/suppressions/count${qs({project})}`),
  suppress:body=>write('/suppressions','POST',body),
  unsuppress:(id,project)=>write(`/suppressions/${encodeURIComponent(id)}`,'DELETE',{project}),
  summary:params=>request(`${base}/consent-summary${qs(params)}`),
  importCsv:body=>write('/import','POST',body),
};
