/** #6315: accepted Grow destinations and edit-safe undo, served by cycle_grow.ts. */
import { request } from '../api.js';
const post=(path,project,uid)=>request(path,{method:'POST',body:JSON.stringify({project,receipt_uid:uid})});
export const growProposalsApi={
  receipts:(project,source)=>request(`/cycles/grow/proposal-receipts?${new URLSearchParams({project,source})}`),
  undo:(project,uid,source,id)=>{
    switch(source){
      case 'mercury':return post(`/cycles/grow/mercury/partner-proposals/${encodeURIComponent(id)}/undo`,project,uid);
      case 'google':return post(`/cycles/grow/google/proposals/${encodeURIComponent(id)}/undo`,project,uid);
      case 'posthog':return post(`/cycles/grow/posthog/proposals/${encodeURIComponent(id)}/undo`,project,uid);
      case 'beehiiv':return post('/cycles/grow/beehiiv/channel-proposal/undo',project,uid);
      default:return Promise.reject(new Error('This proposal source cannot be undone.'));
    }
  },
};
