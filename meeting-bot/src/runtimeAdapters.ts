/** B8: the packaged browser/native adapters; long-lived credentials stay in the Worker. */
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { MeetAdapter } from './adapters/meet.ts';
import { TeamsAdapter, type TeamsPage } from './adapters/teams.ts';
import { ZoomAdapter, type ZoomObf, type ZoomSdkBridge } from './zoomAdapter.ts';
import { ZoomSidecar } from './zoomSidecar.ts';
import { signRequest } from './callback.ts';
import type { RuntimeAdapterContext, RuntimeDiagnoseContext } from './runtime.ts';
import { diagnoseCallbacks, runDiagnosis } from './diagnose.ts';
import { realClock } from './lifecycle.ts';
import { consoleSink } from './log.ts';
import type { MeetPage } from './adapters/meet.ts';
import { AdapterFailure } from './types.ts';
import type { MeetingAdapter, Platform } from './types.ts';

export interface RuntimeFactories {launch?:()=>Promise<Browser>;zoom?:(jwt:string)=>ZoomSdkBridge;fetch?:typeof fetch;zoomWait?:(signal:AbortSignal)=>Promise<void>}
export async function runtimeAdapter(platform:Platform,context:RuntimeAdapterContext,factories:RuntimeFactories={}):Promise<MeetingAdapter>{
  if(platform==='zoom'){
    const credentials=async(signal?:AbortSignal)=>{
      const url=new URL(`/api/meeting-bots/${context.uid}/zoom-credentials`,context.callbackOrigin),raw='{}';
      const response=await (factories.fetch??fetch)(url,{method:'POST',body:raw,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(10_000),...(signal?[signal]:[])]),
        headers:{'content-type':'application/json',...await signRequest(context.secret,url.pathname,raw,Date.now())}});
      // D1381: the Worker's refusal code (zoom_reconnect, zoom_not_in_meeting, ...) rides along; never its message.
      if(!response.ok){const body=await response.json().catch(()=>null);throw new AdapterFailure('obf_unavailable',typeof body?.code==='string'?body.code:'credentials_refused');}
      const value=await response.json();
      if(typeof value?.sdk_jwt!=='string'||value.sdk_jwt.length<32||value.sdk_jwt.length>4096||!(value.waitingForHost===true||typeof value.token==='string'&&value.token.length>0&&value.token.length<=8192))throw new AdapterFailure('obf_unavailable');
      return value;
    };
    let initial=await credentials(),waitingSent=false;
    const sdk=(factories.zoom??(jwt=>new ZoomSidecar(jwt)))(initial.sdk_jwt);
    return new ZoomAdapter({sdk,mintObf:async(_id,signal):Promise<ZoomObf>=>{
      const value=initial??await credentials(signal);initial=null;
      return value.waitingForHost?{waitingForHost:true}:{token:value.token};
    // #2582: B1 learns "waiting for the founder" from its own credentials answer; the
    // runtime reports the waiting state once, not on every three-second retry.
    },waitingForHost:async()=>{if(waitingSent)return;await context.transport.status({state:'waiting_room'});waitingSent=true;},...(factories.zoomWait?{wait:factories.zoomWait}:{})});
  }
  const browser=await (factories.launch??(()=>chromium.launch({headless:true,chromiumSandbox:true})))();
  try{
    const page=await browser.newPage({locale:'en-US'});
    const adapter=platform==='teams'?new TeamsAdapter(page as unknown as TeamsPage):new MeetAdapter(page as unknown as MeetPage);
    const leave=adapter.leave.bind(adapter);let leaving:Promise<void>|null=null;
    adapter.leave=()=>leaving??(leaving=(async()=>{await Promise.allSettled([Promise.resolve().then(leave),Promise.resolve().then(()=>browser.close())]);})());
    return adapter;
  }catch{await browser.close();throw new AdapterFailure('platform_blocked');}
}

/** #3708: the owner's staged diagnostic with the packaged browser and the Meet adapter. */
export async function runtimeDiagnose(platform:Platform,meetingUrl:string,context:RuntimeDiagnoseContext,factories:RuntimeFactories={}):Promise<void>{
  const callbacks=diagnoseCallbacks(context.callbackOrigin,context.uid,context.secret,factories.fetch??fetch);
  await runDiagnosis(platform,meetingUrl,{...callbacks,fetch:factories.fetch??fetch,clock:realClock,stop:context.stop,log:consoleSink,
    launch:async()=>{
      const browser=await (factories.launch??(()=>chromium.launch({headless:true,chromiumSandbox:true})))();
      try{
        const page=await browser.newPage({locale:'en-US',viewport:{width:1280,height:720}});
        return {page:{screenshot:()=>page.screenshot({type:'png'}),url:()=>page.url()},
          meet:new MeetAdapter(page as unknown as MeetPage,{log:consoleSink}),close:()=>browser.close()};
      }catch(e){await browser.close();throw e;}
    }});
}
