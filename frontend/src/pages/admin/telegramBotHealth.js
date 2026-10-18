/**
 * D756 (#1895) — the Telegram Business interview bot's health, in words.
 *
 * `GET /api/admin/channels/telegram/webhook` answers codes and numbers only
 * (routes/channels.ts); this turns them into the sentences the HQ section
 * shows. Pure, so every sentence is tested without a screen. An unknown code
 * gets a generic sentence, never the code itself, and Telegram's own error
 * text is passed through as text for the screen to draw, never as HTML.
 */

/** One sentence per issue code the Worker raises, each naming its fix. */
export const ISSUE_TEXT = Object.freeze({
  token_rejected: 'Telegram refused the bot token. Check TELEGRAM_CHANNEL_BOT_TOKEN in the Worker’s secrets.',
  telegram_unreachable: 'Telegram did not answer. Check again in a minute.',
  business_mode_off: 'Business Mode is off for this bot. Turn it on in @BotFather › Bot Settings › Business Mode. Until then, members cannot add the bot in Telegram Business.',
  username_mismatch: 'TELEGRAM_CHANNEL_BOT_USERNAME names a different bot from the token, so Link Telegram would open the wrong bot. Set it to this bot’s username.',
  same_bot_as_news: 'This is the same bot as the news bot (TELEGRAM_BOT_TOKEN). Create a separate bot for interviews in @BotFather.',
  base_url_missing: 'The Worker has no https PUBLIC_BASE_URL, so there is no webhook address to check or register.',
  webhook_unregistered: 'No webhook is registered, so Telegram sends Axal nothing. Press Register webhook.',
  webhook_elsewhere: 'Telegram sends this bot’s updates to another address, not axal.vc. Press Register webhook.',
  updates_stale: 'The webhook asks Telegram for a different list of updates than Axal reads. Press Register webhook.',
});

export const READY_TEXT = 'Ready. Business Mode is on, the username matches, and Telegram sends this bot’s updates to axal.vc.';
export const UNKNOWN_ISSUE_TEXT = 'Axal found a problem it cannot name yet. Check again in a minute.';
export const UNREADABLE_TEXT = 'The bot’s health could not be read. This is not a claim that it is broken.';

/** "Not switched on", naming the secrets the Worker is missing (names only; the Worker never sends a value). */
export function notConfiguredText(missing) {
  const names = (Array.isArray(missing) ? missing : []).filter((n) => typeof n === 'string' && n.trim());
  const list = names.length ? names.join(', ') : 'its Telegram secrets';
  return `Not switched on. The Worker is missing: ${list}. The owner sets them with wrangler secret put (PRODUCTION.md §4).`;
}

/** An ISO time as a short local date and time, or the raw text when it does not parse. */
function when(iso) {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return String(iso ?? '');
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The lines the section shows, worst first: `[{ tone: 'ok' | 'warn' | 'bad', text }]`.
 * Issues are 'bad' except a waiting backlog or an old delivery error, which are 'warn'.
 */
export function healthLines(health) {
  if (!health || typeof health !== 'object') return [{ tone: 'bad', text: UNREADABLE_TEXT }];
  if (health.configured === false) return [{ tone: 'warn', text: notConfiguredText(health.missing) }];
  const issues = Array.isArray(health.issues) ? health.issues : [];
  const lines = [];
  for (const code of issues) {
    if (code === 'delivery_error') continue;
    lines.push({ tone: 'bad', text: Object.hasOwn(ISSUE_TEXT, code) ? ISSUE_TEXT[code] : UNKNOWN_ISSUE_TEXT });
  }
  const hook = health.webhook && health.webhook.reachable ? health.webhook : null;
  if (hook && hook.last_error_at) {
    const text = typeof hook.last_error === 'string' && hook.last_error ? hook.last_error : 'no reason given';
    lines.push({
      tone: issues.includes('delivery_error') ? 'bad' : 'warn',
      text: `Telegram last failed to deliver an update to Axal at ${when(hook.last_error_at)}: “${text}”.`,
    });
  } else if (issues.includes('delivery_error')) {
    lines.push({ tone: 'bad', text: UNKNOWN_ISSUE_TEXT });
  }
  const pending = hook ? Number(hook.pending_update_count) : 0;
  if (Number.isFinite(pending) && pending > 0) {
    lines.push({ tone: 'warn', text: `${pending} ${pending === 1 ? 'update is' : 'updates are'} waiting at Telegram.` });
  }
  if (health.ready === true && !issues.length) lines.unshift({ tone: 'ok', text: READY_TEXT });
  return lines;
}
