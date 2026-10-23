/** D886: runtime-only ingress. Authentication precedes JSON parsing and all durable writes. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { BotError, botControl } from '../services/meetingBots';
import { boundedBotBody, validBotCallback, validBotUploadToken } from '../durable-objects/meeting-bot-run';

const callbacks = new Hono<{ Bindings: Env }>();
callbacks.post('/:uid/zoom-credentials',async c=>{
  try {
    const raw=new TextDecoder().decode(await boundedBotBody(c.req.raw,128));
    if (!await validBotCallback(c.env,c.req.raw,raw)) return c.json({code:'invalid_bot_signature',message:'The runtime signature is invalid.'},401);
    // Identity and meeting come exclusively from B1's encrypted stored run.
    if (raw!=='{}') return c.json({code:'invalid_bot_event',message:'The runtime request is not valid.'},400);
    const response=await botControl(c.env,c.req.param('uid'),'zoom-credentials');
    const headers=new Headers(response.headers);headers.set('cache-control','no-store');
    return new Response(response.body,{status:response.status,headers});
  } catch { return c.json({code:'bot_zoom_unavailable',message:'The Zoom runtime is not available.'},503); }
});
callbacks.post('/:uid/events', async c => {
  try {
    const raw=new TextDecoder().decode(await boundedBotBody(c.req.raw,128*1024));
    if (!await validBotCallback(c.env,c.req.raw,raw)) return c.json({code:'invalid_bot_signature',message:'The runtime signature is invalid.'},401);
    try { JSON.parse(raw); } catch { return c.json({code:'invalid_bot_event',message:'The bot event is not valid.'},400); }
    return await botControl(c.env,c.req.param('uid'),'event',{body:raw,headers:{'content-type':'application/json'}});
  } catch (e) {
    if (e instanceof BotError) return c.json(e.body(),e.status as 400);
    return c.json({code:'bot_unavailable',message:'The meeting bot is temporarily unavailable.'},503);
  }
});
callbacks.put('/:uid/chunks/:seq', async c => {
  try {
    if (!await validBotUploadToken(c.env,c.req.param('uid'),c.req.param('seq'),c.req.query('token')??'')) return c.json({code:'invalid_upload',message:'The upload permission is invalid.'},401);
    return await botControl(c.env,c.req.param('uid'),'chunk',{body:c.req.raw.body,headers:{
      'x-bot-chunk':c.req.param('seq'),'x-bot-upload':c.req.query('token')??'',
      'content-length':c.req.header('content-length')??'',
    }});
  } catch (e) {
    if (e instanceof BotError) return c.json(e.body(),e.status as 400);
    return c.json({code:'bot_unavailable',message:'The meeting bot is temporarily unavailable.'},503);
  }
});
export default callbacks;
