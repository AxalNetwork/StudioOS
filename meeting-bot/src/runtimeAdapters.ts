/** Browser packaging boundary. Native Zoom bridge and Teams remain their adapter tasks. */
import { chromium } from 'playwright';
import { MeetAdapter } from './adapters/meet.ts';
import type { MeetPage } from './adapters/meet.ts';
import { AdapterFailure } from './types.ts';
import type { MeetingAdapter, Platform } from './types.ts';

export async function runtimeAdapter(platform:Platform):Promise<MeetingAdapter>{
  if(platform!=='google_meet')throw new AdapterFailure(platform==='zoom'?'obf_unavailable':'platform_blocked');
  const browser=await chromium.launch({headless:true,chromiumSandbox:true});
  try{
    const page=await browser.newPage();
    const adapter=new MeetAdapter(page as unknown as MeetPage);
    const leave=adapter.leave.bind(adapter);let leaving:Promise<void>|null=null;
    adapter.leave=()=>leaving??(leaving=(async()=>{await Promise.allSettled([Promise.resolve().then(leave),Promise.resolve().then(()=>browser.close())]);})());
    return adapter;
  }catch{await browser.close();throw new AdapterFailure('platform_blocked');}
}
