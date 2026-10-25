/** B8: the packaged browser/native adapters; long-lived credentials stay in the Worker. */
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { MeetAdapter } from './adapters/meet.ts';
import { TeamsAdapter, type TeamsPage } from './adapters/teams.ts';
import { ZoomAdapter, type ZoomObf, type ZoomSdkBridge } from './zoomAdapter.ts';
import { ZoomSidecar } from './zoomSidecar.ts';
import { signRequest } from './callback.ts';
import type { RuntimeAdapterContext } from './runtime.ts';
import type { MeetPage } from './adapters/meet.ts';
import { AdapterFailure } from './types.ts';
import type { MeetingAdapter, Platform } from './types.ts';

export interface RuntimeFactories {launch?:()=>Promise<Browser>;zoom?:(jwt:string)=>ZoomSdkBridge;fetch?:typeof fetch}
export async function runtimeAdapter(platform:Platform,context:RuntimeAdapterContext,factories:RuntimeFactories={}):Promise<MeetingAdapter>{
  if(platform==='zoom'){
    const credentials=async(signal?:AbortSignal)=>{
      const url=new URL(`/api/meeting-bots/${context.uid}/zoom-credentials`,context.callbackOrigin),raw='{}';
      const response=await (factories.fetch??fetch)(url,{method:'POST',body:raw,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(10_000),...(signal?[signal]:[])]),
        headers:{'content-type':'application/json',...await signRequest(context.secret,url.pathname,raw,Date.now())}});
      if(!response.ok)throw new AdapterFailure('obf_unavailable');
      const value=await response.json();
      if(typeof value?.sdk_jwt!=='string'||value.sdk_jwt.length<32||value.sdk_jwt.length>4096||!(value.waitingForHost===true||typeof value.token==='string'&&value.token.length>0&&value.token.length<=8192))throw new AdapterFailure('obf_unavailable');
      return value;
    };
    let initial=await credentials();
    const sdk=(factories.zoom??(jwt=>new ZoomSidecar(jwt)))(initial.sdk_jwt);
    return new ZoomAdapter({sdk,mintObf:async(_id,signal):Promise<ZoomObf>=>{
      const value=initial??await credentials(signal);initial=null;
      return value.waitingForHost?{waitingForHost:true}:{token:value.token};
    },waitingForHost:async()=>{await context.transport.status({state:'waiting_room'});}});
  }
  const browser=await (factories.launch??(()=>chromium.launch({headless:true,chromiumSandbox:true})))();
  try{
    const page=await browser.newPage();
    const adapter=platform==='teams'?new TeamsAdapter(page as unknown as TeamsPage):new MeetAdapter(page as unknown as MeetPage);
    const leave=adapter.leave.bind(adapter);let leaving:Promise<void>|null=null;
    adapter.leave=()=>leaving??(leaving=(async()=>{await Promise.allSettled([Promise.resolve().then(leave),Promise.resolve().then(()=>browser.close())]);})());
    return adapter;
  }catch{await browser.close();throw new AdapterFailure('platform_blocked');}
}
