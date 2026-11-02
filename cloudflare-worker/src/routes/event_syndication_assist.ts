/**
 * D1493 (#3906, SY8) — Ask proposes a channel's title and description for an
 * event. Mounted at `/api/events` before `events.ts`, beside Part A's
 * `event_syndication.ts`; every path is `/:id/syndication/assist…`.
 *
 *   POST /:id/syndication/assist/quote   { account_uid, fields? }
 *        → { option, ai: true, hold_microusd, model } | { option, ai: false, reason, message }
 *   POST /:id/syndication/assist         (the same body)
 *        → { proposals: [proposal], option, cost: { charged_microusd | null, usage_log_id } }
 *
 * `fields` is `['title']`, `['description']` or both (the default). One press
 * is one run of the rail option `draft:syndication-copy` on `rail_write`,
 * filed under `<Profile> · Events` on the record `events:<id>` and charged to
 * the member who pressed. Its answer leaves one `ai_rail_proposals` row per
 * field (`kind: 'proposal'`, payload `{ account_uid, channel, field, value,
 * source }`), each value cut to the channel's limit.
 *
 * NOTHING HERE WRITES AN OVERRIDE OR POSTS. Accept is
 * `POST /api/ai/rail/proposals/:uid/decide`; the page then saves the value
 * with Part A's `PUT /api/events/:id/syndication`, and posting still waits for
 * Approve and publish.
 *
 * THE GATE, in order: signed in (401); the event's host or an admin
 * (`canManage`, else the same 404 as Part A); not a support session (403);
 * a public event, else 409 in Part A's own sentence ("Private event"), before
 * any quote or hold; an account the event may use (404). A run's refusals
 * answer as every rail press does (`refuseRun`): 402 for a budget stop, 403
 * for the switch or a pause, 422 for the guard.
 *
 * Logs carry codes only: never the event's text or a model's answer.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { selectJwt } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { readSettings, SKIP } from '../services/eventSyndication/eligibility';
import {
  COPY_FIELDS, SYNDICATION_COPY_OPTION, eventRecord, eventsPage, fieldsOf, messageOf, payloadsOf, type CopyField,
} from '../services/eventSyndication/copyAssist';
import { proposeRail } from '../services/railProposals';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { accountsFor, managed, type Account } from './event_syndication';

const eventSyndicationAssist = new Hono<{ Bindings: Env }>();

type Press = { user: User; event: Record<string, any>; account: Account; fields: CopyField[] };

/** The press, checked, or the response that refuses it. Nothing is quoted or held before this answers. */
async function pressOf(c: any): Promise<Press | Response> {
  const m = await managed(c);
  if (m instanceof Response) return m;
  if ((await selectJwt(c))?.payload?.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot run Eadwyn on a member’s event.' });
  }
  if (m.event.visibility !== 'public') return refuse(c, 409, { code: 'not_public', message: SKIP.private });
  const body: any = await c.req.json().catch(() => ({}));
  const fields = fieldsOf(body?.fields);
  if (!fields) return refuse(c, 400, { code: 'invalid_fields', message: `fields must be one or both of ${COPY_FIELDS.join(', ')}` });
  const accounts = await accountsFor(c.env, m.event, await readSettings(c.env));
  const account = accounts.find((a) => a.uid === String(body?.account_uid ?? ''));
  if (!account) return refuse(c, 404, { code: 'account_not_found', message: 'That channel account is not one this event can use.' });
  return { user: m.user, event: m.event, account, fields };
}

/** The run one press makes, so the quote and the run read the same input. */
function runOptions(c: any, p: Press): RunOptions {
  const msg = messageOf(p.event, p.account.channel, p.fields);
  const id = Number(p.event.id);
  // The press names its own option: a header can name the page, never another option's price.
  const rail = { ...railFor(c, { page: eventsPage(p.user.role), option: SYNDICATION_COPY_OPTION }, eventRecord(id)), option: SYNDICATION_COPY_OPTION };
  return {
    task: 'rail_write',
    userId: Number(p.user.id) || 0,
    surface: AI_SURFACE.eventSyndication,
    rail,
    systemPrompt: msg.system,
    messages: [{ role: 'user', content: msg.user }],
    temperature: 0.5,
    maxTokens: p.fields.includes('description') ? 1200 : 200,
  };
}

/** What a run charged, from its usage row; null when it is not known. */
async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

eventSyndicationAssist.post('/:id/syndication/assist/quote', async (c) => {
  const p = await pressOf(c);
  if (p instanceof Response) return p;
  const q = await quoteRun(c.env, runOptions(c, p));
  if (q.ok) return c.json({ option: SYNDICATION_COPY_OPTION, ai: true, hold_microusd: q.hold_microusd, model: q.model });
  return c.json({ option: SYNDICATION_COPY_OPTION, ai: false, reason: q.refusal, message: q.error });
});

eventSyndicationAssist.post('/:id/syndication/assist', async (c) => {
  const p = await pressOf(c);
  if (p instanceof Response) return p;
  const userId = Number(p.user.id) || 0;
  const opts = runOptions(c, p);
  const res = await run(c.env, { ...opts, surface: AI_SURFACE.eventSyndication, rail: opts.rail });
  if (!res.ok) {
    const stop = refuseRun(c, res);
    if (stop) return stop;
    return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
  }
  const cost = { charged_microusd: await chargedOf(c.env, res.usageLogId, userId), usage_log_id: res.usageLogId ?? null };
  const payloads = payloadsOf(res.output, p.account.uid, p.account.channel, p.fields);
  if (!payloads.length) {
    return refuse(c, 422, { code: 'nothing_proposed', message: 'Eadwyn’s answer had nothing to place, so nothing was proposed. It was charged for the run.', extra: { cost } });
  }
  const proposals = [];
  try {
    for (const payload of payloads) {
      proposals.push(await proposeRail(c.env, {
        userId, page: opts.rail!.page, option: SYNDICATION_COPY_OPTION, record: eventRecord(Number(p.event.id)), kind: 'proposal',
        payload, model: res.usage?.model ?? null, usageLogId: res.usageLogId ?? null,
      }));
    }
  } catch {
    console.error('[event-syndication-assist] proposal_unsaved');
    return refuse(c, 503, { code: 'proposal_unsaved', message: 'Eadwyn answered, but the proposal could not be kept. It was charged for the run; try again in a moment.', extra: { cost } });
  }
  return c.json({ proposals, option: SYNDICATION_COPY_OPTION, cost });
});

export default eventSyndicationAssist;
