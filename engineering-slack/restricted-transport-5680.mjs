// D5680: send-time restricted recipient checks, layered over the existing team/receipt/retry transport.
import {slackTransport} from './transport.mjs';
export function restrictedTransport5680({token,fetchImpl=fetch}) {
  return slackTransport({token,fetchImpl:async(url,init)=>{
    const response=await fetchImpl(url,init);
    if(url==='https://slack.com/api/conversations.info'&&response.ok){
      const data=await response.clone().json(),c=data.channel;
      if(data.ok&&(c?.is_private!==true||c.is_member!==true||c.is_ext_shared!==false||c.is_pending_ext_shared===true||c.is_archived===true))return Response.json({ok:false,error:'restricted_recipient_refused'});
    }
    return response;
  }});
}
