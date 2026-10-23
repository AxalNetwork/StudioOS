/** B8: short-lived SDK/OBF material for the already-authorized stored run. */
import { SignJWT } from 'jose';
import type { Env } from '../types';
import { BotError, botSession, botPlatform, type BotRun } from './meetingBots';
import { decryptColumn } from './columnCipher';
import { zoomConnection, mintObfToken } from './channels/zoom';
import { MeetingProviderError } from './channels/meetings';

export async function zoomRuntimeCredentials(env: Env, run: BotRun) {
  await botSession(env,run);
  const id=env.MEETING_BOT_ZOOM_CLIENT_ID,secret=env.MEETING_BOT_ZOOM_CLIENT_SECRET;
  if (run.platform!=='zoom' || !id || !secret || !['joining','waiting_room'].includes(run.status)) throw new BotError(503,'bot_zoom_unavailable','The Zoom runtime is not configured.');
  const raw=await decryptColumn(env,'meeting_bots','meeting_url_enc',run.uid,run.meeting_url_enc);
  const parsed=botPlatform(raw),url=new URL(parsed.url);
  const meeting=/^\/(?:j\/|wc\/join\/)(\d{6,20})\/?$/.exec(url.pathname)?.[1];
  const connection=await zoomConnection(env,run.user_id);
  if (parsed.platform!=='zoom' || !meeting || !connection) throw new BotError(503,'bot_zoom_unavailable','The Zoom runtime is not configured.');
  let token:string|undefined,waiting=false;
  try { token=await mintObfToken(env,connection,meeting); }
  catch(e) { if(e instanceof MeetingProviderError && e.code==='zoom_waiting_for_host') waiting=true; else throw new BotError(503,'bot_zoom_unavailable','The Zoom runtime is not configured.'); }
  // No caller-supplied user/meeting id; recheck access/consent after the provider.
  await botSession(env,run);
  const iat=Math.floor(Date.now()/1000)-30,exp=iat+7200;
  const jwt=await new SignJWT({appKey:id,mn:meeting,role:0,tokenExp:exp}).setProtectedHeader({alg:'HS256',typ:'JWT'})
    .setIssuedAt(iat).setExpirationTime(exp).sign(new TextEncoder().encode(secret));
  return {sdk_jwt:jwt,...(waiting?{waitingForHost:true}:{token})};
}
