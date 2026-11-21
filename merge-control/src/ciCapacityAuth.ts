/** D7973: bounded GitHub OIDC authentication; caller JSON never supplies execution identity. */
import type { CapacityIssuerKeys } from './lib/ciCapacityAuthPolicy.ts';
export const CAPACITY_ISSUER = 'https://token.actions.githubusercontent.com';
/** Workers supports manual redirects, not redirect:error. Refuse every redirect without following it. */
export const capacityPlatformFetch: typeof fetch = async(input,init)=>{
  const response=await fetch(input,{...init,redirect:'manual'});
  if(response.redirected||(response.status>=300&&response.status<400)){
    void response.body?.cancel().catch(()=>undefined);
    throw new Error('capacity_redirect_refused');
  }
  return response;
};
export type CapacityIdentity = {
  repository: string; repository_id: string; run_id: string; run_attempt: string;
  event_name: string; ref: string; sha: string; workflow_ref: string; workflow_sha: string;
  exp: number; job_workflow_ref?: string; job_workflow_sha?: string;
};
/** The runtime and verifier consume the same bounded bearer; it never comes from JSON. */
export function capacityBearer(request: Request): string {
  const token = /^Bearer ([A-Za-z0-9_.-]{1,16384})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new Error('capacity_unauthorized');
  return token;
}
export async function capacityBody(body: ReadableStream<Uint8Array>|null, max: number): Promise<Uint8Array> {
  const reader=body?.getReader();if(!reader)return new Uint8Array();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([ (async()=>{
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new Error('capacity_body_bound');chunks.push(value);}
      return new Uint8Array(Buffer.concat(chunks));
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('capacity_body_timeout')),10000);})]);
  }finally{clearTimeout(timer);void reader.cancel().catch(()=>undefined);}
}
export async function boundedJson(response: Response, max = 512 * 1024): Promise<unknown> {
  if (!response.ok) throw Object.assign(new Error(`capacity_http_${response.status}`),{status:response.status});
  return JSON.parse(new TextDecoder().decode(await capacityBody(response.body,max)));
}
export async function authenticateCapacity(request: Request, audience: string, repository: string,
  fetcher: typeof fetch = capacityPlatformFetch, now: number|(()=>number) = Date.now, keyProvider?: Pick<CapacityIssuerKeys, 'get'>): Promise<CapacityIdentity> {
  if (!audience || audience.length > 200) throw new Error('capacity_audience_unconfigured');
  const token = capacityBearer(request);
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('capacity_invalid_jwt');
  const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  const header = decode(parts[0]);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(header.kid)) throw new Error('capacity_invalid_jwt');
  // The per-authority provider caches bounded public keys only, never verified identities.
  // The optional legacy fetch seam remains for existing standalone authentication tests.
  const keys = keyProvider ? { keys: [await keyProvider.get(header.kid)] } : await boundedJson(await fetcher(`${CAPACITY_ISSUER}/.well-known/jwks`, {
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 64 * 1024) as { keys: (JsonWebKey & { kid?: string; alg?: string })[] };
  if (!Array.isArray(keys.keys) || keys.keys.length > 20) throw new Error('capacity_invalid_keys');
  const candidates = keys.keys.filter(key => key.kid === header.kid && key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig');
  if (candidates.length !== 1) throw new Error('capacity_unknown_key');
  const key = await crypto.subtle.importKey('jwk', candidates[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error('capacity_bad_signature');
  const claims = decode(parts[1]);
  const seconds = Math.floor((typeof now === 'function' ? now() : now) / 1000);
  if (claims.iss !== CAPACITY_ISSUER || claims.aud !== audience || claims.repository !== repository
    || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds || claims.exp > seconds + 600
    || !Number.isSafeInteger(claims.nbf) || claims.nbf > seconds || !Number.isSafeInteger(claims.iat) || claims.iat > seconds || claims.iat < seconds - 600
    || !['repository_id','run_id','run_attempt'].every(k => /^[1-9][0-9]{0,14}$/.test(claims[k] ?? ''))
    || !['sha','workflow_sha'].every(k => /^[a-f0-9]{40}$/.test(claims[k] ?? ''))
    || !['event_name','ref','workflow_ref'].every(k => typeof claims[k] === 'string' && claims[k].length <= 300)
    || claims.sub !== `repo:${repository}:ref:${claims.ref}`) throw new Error('capacity_claims_refused');
  return claims as CapacityIdentity;
}
