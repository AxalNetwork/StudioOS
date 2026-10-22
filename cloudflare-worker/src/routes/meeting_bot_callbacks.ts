/** D886: runtime-only ingress. Authentication precedes JSON parsing and all durable writes. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { BotError, botControl } from '../services/meetingBots';
import { boundedBotBody, validBotCallback, validBotUploadToken } from '../durable-objects/meeting-bot-run';

const callbacks = new Hono<{ Bindings: Env }>();
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
