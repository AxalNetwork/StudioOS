/**
 * D863 (#2509) — the Telegram setup for Record a Session, as six steps a
 * founder can follow without the runbook. Each step's state is read from rows
 * Axal already keeps, so the read never calls Telegram:
 *
 *   1. linked           the member's `integrations` row for telegram (D684), or the claim in progress
 *   2. bot_added        a `telegram_business_connections` row for the member (Telegram Business › Chatbots)
 *   3. bot_enabled      that connection's `is_enabled`
 *   4. replies_allowed  its `can_reply` (Bot API 9.0 `rights`)
 *   5. first_chat       a pending or assigned thread on the active connection
 *   6. consent_notice   the D756 §1.7 notice can be sent or pasted: it needs the notice page's link
 *
 * A step is `done`, `todo` (the member's move, said in one sentence) or
 * `blocked` (an earlier step comes first). Disconnecting clears the link and
 * detaches every business connection, so a disconnected member is back at
 * step 1.
 *
 * The answer carries codes, our sentences and at most the member's own
 * `@username`: never a contact's name, a chat id, a connection id or a token.
 */
import type { Env } from '../../types';
import { consentNoticeUrl } from './consentNotice';
import { pendingLinkView } from './linkCodes';
import { telegramBusinessState } from './telegram';

export type SetupState = 'done' | 'todo' | 'blocked';
export const SETUP_STEPS = ['linked', 'bot_added', 'bot_enabled', 'replies_allowed', 'first_chat', 'consent_notice'] as const;
export type SetupStepKey = typeof SETUP_STEPS[number];

export interface SetupStep {
  step: number;
  key: SetupStepKey;
  state: SetupState;
  code: string;
  /** What to do, in our words; null once the step is done. */
  action: string | null;
}

/**
 * The connector page's rule (`connectorPages.ts`, `channelsModel.js`), shown as
 * a prerequisite. Axal cannot see a member's Premium, so its state is null.
 * It stays until the owner reports the Premium check (TELEGRAM.md §1 step 5,
 * #1008); a different answer changes these two lines.
 */
export const TELEGRAM_PREMIUM_REQUIRED = true;
export const TELEGRAM_PREMIUM_LINE = 'Needs Telegram Premium: chatbots are part of Telegram Business.';

const CHATBOTS = 'Telegram › Settings › Telegram Business › Chatbots';

/** Our sentence for each code a step can be left at. */
export const SETUP_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  not_linked: 'Press Link Telegram, open the link in your Telegram account and press Start.',
  link_waiting_telegram: 'Send /confirm to the Axal bot in Telegram to confirm the link from your side.',
  link_waiting_axal: 'Confirm the Telegram account here in Axal to finish linking.',
  needs_link: 'Link your Telegram account first.',
  bot_not_added: `In ${CHATBOTS}, add the Axal bot by its username.`,
  needs_bot: 'Add the Axal bot in Telegram Business first.',
  bot_switched_off: `The Axal bot is switched off. Turn it back on in ${CHATBOTS}.`,
  needs_bot_on: 'Switch the Axal bot on in Telegram Business first.',
  no_reply_right: `Allow the Axal bot to reply to messages in ${CHATBOTS}, so Axal can ask your contacts for consent.`,
  no_chat_yet: `In ${CHATBOTS}, choose the chats the Axal bot may read. The next message a customer sends in one of them appears here, for you to add to an interview.`,
  notice_link_missing: 'Axal cannot ask your contacts for consent yet. Nothing is needed from you; Axal will switch this on.',
});

function step(n: number, key: SetupStepKey, state: SetupState, code: string): SetupStep {
  // A done step's code has no sentence, so its action is null.
  return { step: n, key, state, code, action: SETUP_ACTIONS[code] ?? null };
}

/** The member's own `@username`, or null: a display name is not repeated here. */
const ownUsername = (name: string | null | undefined) => (typeof name === 'string' && /^@[A-Za-z0-9_]{1,64}$/.test(name) ? name : null);

export async function telegramSetup(env: Env, userId: number) {
  const link = await env.DB.prepare(
    `SELECT id, external_account_name FROM integrations WHERE user_id = ? AND provider_key = 'telegram' AND status = 'active'`,
  ).bind(userId).first<{ id: number; external_account_name: string | null }>();

  let linked: SetupStep;
  if (link) linked = step(1, 'linked', 'done', 'linked');
  else {
    const claim = await pendingLinkView(env, userId);
    const code = claim?.status === 'waiting_telegram' ? 'link_waiting_telegram'
      : claim?.status === 'waiting_axal' || claim?.status === 'ready' ? 'link_waiting_axal' : 'not_linked';
    linked = step(1, 'linked', 'todo', code);
  }

  // A disconnect detaches the member's business connections (routes/channels.ts), so none is read here once unlinked.
  const bc = link ? await telegramBusinessState(env, userId) : { state: 'none' as const };
  const added = !link ? step(2, 'bot_added', 'blocked', 'needs_link')
    : bc.state === 'none' ? step(2, 'bot_added', 'todo', 'bot_not_added') : step(2, 'bot_added', 'done', 'bot_added');
  const enabled = bc.state === 'none' ? step(3, 'bot_enabled', 'blocked', link ? 'needs_bot' : 'needs_link')
    : bc.state === 'disabled' ? step(3, 'bot_enabled', 'todo', 'bot_switched_off') : step(3, 'bot_enabled', 'done', 'bot_enabled');
  const replies = bc.state !== 'enabled' ? step(4, 'replies_allowed', 'blocked', !link ? 'needs_link' : bc.state === 'none' ? 'needs_bot' : 'needs_bot_on')
    : bc.canReply ? step(4, 'replies_allowed', 'done', 'replies_allowed') : step(4, 'replies_allowed', 'todo', 'no_reply_right');

  // A chat that already arrived on the live connection counts, even if the bot was switched off since.
  const chat = link ? await env.DB.prepare(
    `SELECT 1 AS n FROM channel_threads WHERE user_id = ? AND provider = 'telegram' AND integration_id = ? AND status IN ('pending', 'assigned') LIMIT 1`,
  ).bind(userId, link.id).first<{ n: number }>() : null;
  const first = chat ? step(5, 'first_chat', 'done', 'chat_received')
    : bc.state !== 'enabled' ? step(5, 'first_chat', 'blocked', !link ? 'needs_link' : bc.state === 'none' ? 'needs_bot' : 'needs_bot_on')
      : step(5, 'first_chat', 'todo', 'no_chat_yet');

  const notice = consentNoticeUrl(env) ? step(6, 'consent_notice', 'done', 'notice_ready') : step(6, 'consent_notice', 'blocked', 'notice_link_missing');

  const steps = [linked, added, enabled, replies, first, notice];
  return {
    account: link ? ownUsername(link.external_account_name) : null,
    prerequisites: [{ key: 'telegram_premium', required: TELEGRAM_PREMIUM_REQUIRED, state: null, line: TELEGRAM_PREMIUM_LINE }],
    steps,
    next: steps.find((s) => s.state !== 'done')?.key ?? null,
    ready: steps.every((s) => s.state === 'done'),
  };
}
