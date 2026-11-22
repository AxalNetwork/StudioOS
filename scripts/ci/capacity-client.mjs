/** D7973: opt-in authenticated capacity caller; no polling or hosted job waiting. */
const REPOSITORY='AxalNetwork/StudioOS';
async function json(response,max=32*1024){
 if(!response.ok)throw new Error('capacity_authority_unavailable');
 const reader=response.body?.getReader();if(!reader)throw new Error('capacity_empty_response');
 const chunks=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('capacity_response_bound');}chunks.push(value);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Only GitHub's reserved OIDC endpoint is accepted. Never hand this closure to candidate code. */
export function githubOidcToken(env=process.env,fetcher=globalThis.fetch){
 return async(audience,signal)=>{
  const endpoint=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.actions.githubusercontent.com')||endpoint.username||endpoint.password||endpoint.port)throw new Error('invalid_oidc_endpoint');
  endpoint.searchParams.set('audience',audience);
  const result=await json(await fetcher(endpoint,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}}));
  if(typeof result.value!=='string'||result.value.length>16384)throw new Error('invalid_oidc_response');
  return result.value;
 };
}
function transport({url,audience,oidcToken,fetcher=globalThis.fetch}){
 const endpoint=new URL(url);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||!audience||typeof oidcToken!=='function')throw new Error('capacity_authority_unconfigured');
 return async(path,body,signal)=>{
  const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000);
  const token=await oidcToken(audience,deadline);
  return json(await fetcher(new URL(path,endpoint),{method:'POST',redirect:'error',signal:deadline,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 };
}
export function createReceiptReader(options){
 const send=transport(options);
 return async({request,context,phase,signal})=>{
  if(context.repository!==REPOSITORY)throw new Error('capacity_repository_refused');
  const result=await send('/capacity/receipt',{requestId:request.requestId,shard:request.shard,generation:Number(request.generation),profile:request.profile,phase},signal);
  const receipt=result.receipt;
  if(result.active!==true||!receipt||receipt.repository!==context.repository||String(receipt.childRunId)!==String(context.childRunId)||String(receipt.childAttempt)!==String(context.childAttempt)||receipt.executorSha!==context.executorSha||receipt.requestId!==request.requestId||receipt.generation!==Number(request.generation)||receipt.logicalShard!==request.shard||receipt.profile!==request.profile)throw new Error('capacity_receipt_refused');
  return result;
 };
}
/** Disabled by default. Submission returns immediately; existing hosted execution stays the caller's default. */
export async function submitCapacity(submission,{enabled=false,plan,...options}={}){
 if(enabled!==true)return {accepted:false,reason:'capacity_disabled'};
 return transport(options)('/capacity/submit',{submission,plan});
}
