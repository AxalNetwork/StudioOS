// D5671: verify live Slack Connect state in addition to the shared transport's team/privacy/membership checks.
import {slackTransport} from '../engineering-slack/transport.mjs';
export function cloudflareTransport({token,fetchImpl=fetch}) {
  return slackTransport({token,fetchImpl:async(url,init)=>{
    const response=await fetchImpl(url,init);
    if(url==='https://slack.com/api/conversations.info'&&response.ok){
      const value=await response.clone().json();
      if(value.ok&&(value.channel?.is_ext_shared!==false||value.channel?.is_pending_ext_shared===true))return Response.json({ok:false,error:'channel_access_mismatch'});
    }
    return response;
  }});
}
