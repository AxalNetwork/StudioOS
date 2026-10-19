/**
 * D684 (#1575, S02 #1578) — the rules of Connectors' "Customer conversations"
 * group: Telegram Business, WhatsApp Business, Zoom and Google Meet. No React
 * and no fetch, so `frontend/test/interview_channels_d684.test.mjs` holds each
 * rule.
 *
 * THE GROUP READS `GET /api/channels` (`lib/api/channels.js`):
 *   { providers: [{ provider, available, missing, signup? }],
 *     connections: { telegram?, whatsapp? }, pending: { telegram, whatsapp } }
 * The shape is read defensively — a field that is absent is unknown, never a
 * zero and never a crash. `missing` names platform secrets: it is for an
 * admin and is never drawn. Neither is a WhatsApp phone number id, a WABA id
 * or anything else the provider uses to address the member's account.
 *
 * Zoom connects through the Connectors registry (OAuth) and Google Meet rides
 * on the member's Google Calendar connection, so those two cards read the
 * connectors catalogue as well, and connect through the existing sheet.
 */

export const CHANNEL_PROVIDERS = ['telegram', 'whatsapp', 'zoom', 'google_meet'];
export const MESSAGING_PROVIDERS = ['telegram', 'whatsapp'];
export const MEETING_PROVIDERS = ['zoom', 'google_meet'];

export const PROVIDER_LABEL = { telegram: 'Telegram', whatsapp: 'WhatsApp', zoom: 'Zoom', google_meet: 'Google Meet' };

/** The card titles: what the member connects, in their words. */
export const CARD_TITLE = { telegram: 'Telegram Business', whatsapp: 'WhatsApp Business', zoom: 'Zoom', google_meet: 'Google Meet' };

/** Where every "connect it first" link points: this group on Connectors. */
export const CHANNELS_HREF = '/account/connectors#interview-channels';
/** The inbox of conversations waiting for an interview. */
export const INBOX_HREF = '/validate/inbox';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const count = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.floor(Number(v))) : null);

/**
 * `GET /api/channels`, normalised. `providers` may arrive as a list or keyed
 * by provider, `connections` as an object or a list; either way each provider
 * comes out as `{ available: true|false|null, signup }` and a connection or
 * null. `null` for the whole read means it failed.
 */
export function readOverview(raw) {
  if (!isObj(raw)) return null;
  const providers = {};
  const list = Array.isArray(raw.providers)
    ? raw.providers
    : isObj(raw.providers) ? Object.entries(raw.providers).map(([provider, v]) => ({ provider, ...(isObj(v) ? v : { available: v }) })) : [];
  for (const p of list) {
    const key = str(p?.provider || p?.key);
    if (!CHANNEL_PROVIDERS.includes(key) || providers[key]) continue;
    providers[key] = {
      available: typeof p.available === 'boolean' ? p.available : null,
      signup: isObj(p.signup) ? p.signup : null,
    };
  }
  const connections = {};
  const conns = Array.isArray(raw.connections)
    ? Object.fromEntries(raw.connections.filter(isObj).map((c) => [str(c.provider || c.provider_key), c]))
    : isObj(raw.connections) ? raw.connections : {};
  for (const key of CHANNEL_PROVIDERS) connections[key] = isObj(conns[key]) ? conns[key] : null;
  const pending = {};
  for (const key of MESSAGING_PROVIDERS) pending[key] = count(isObj(raw.pending) ? raw.pending[key] : null);
  // S01 adds WhatsApp's public Embedded Signup config to this read; accept it
  // on the provider entry (`signup`) or beside it (`whatsapp`).
  if (providers.whatsapp && !providers.whatsapp.signup && isObj(raw.whatsapp)) providers.whatsapp.signup = raw.whatsapp;
  if (!providers.whatsapp && isObj(raw.whatsapp)) providers.whatsapp = { available: null, signup: raw.whatsapp };
  // D757 §2.11 (#1922): an empty list, not an absent one, is the Worker offering no channel.
  const offered = !(Array.isArray(raw.providers) && raw.providers.length === 0);
  return { providers, connections, pending, telegramLink: telegramClaim(raw.telegram_link), offered };
}

/**
 * The cards to draw. The Worker offers no channel to a member who cannot hold
 * a venture (D757 §2.11); then only a card with a connection is drawn, so it
 * keeps Disconnect, and with none the group is not drawn at all.
 */
export function shownChannels(overview) {
  if (!overview || overview.offered !== false) return CHANNEL_PROVIDERS;
  return CHANNEL_PROVIDERS.filter((k) => !!overview.connections?.[k]);
}

// ---------- Telegram: the two-sided link (#1625, migration 458) ------------

/** The Worker's link states (`services/channels/linkCodes.ts`, `pendingLinkView`). */
export const TELEGRAM_CLAIM_STATES = ['waiting_claim', 'waiting_telegram', 'waiting_axal', 'ready', 'linked', 'expired', 'cancelled', 'unreadable'];

/** Each state in words, for a read that sends no sentence of its own. */
export const TELEGRAM_CLAIM_WORDS = {
  waiting_claim: 'Open the link in your Telegram account first.',
  waiting_telegram: 'Confirm in Telegram by sending /confirm to the Axal bot.',
  waiting_axal: 'Confirm the claimed Telegram account in Axal to finish linking.',
  ready: 'Both owners confirmed. Press Confirm again to finish activating this link.',
  linked: 'Both owners confirmed this Telegram link.',
  expired: 'Both confirmations must arrive within ten minutes. Request a new Telegram link.',
  cancelled: 'This link was replaced or cancelled. Request a new Telegram link.',
  unreadable: 'The claimed Telegram account could not be read. Request a new link before confirming.',
};

/**
 * `telegram_link` from `GET /api/channels` (or `claim` from `GET
 * /channels/telegram/link`), normalised; null when there is none. The
 * claimed account's name and @username are kept exactly as Telegram sent
 * them, so the member can see whose account it is.
 */
export function telegramClaim(raw) {
  if (!isObj(raw) || !str(raw.uid) || !TELEGRAM_CLAIM_STATES.includes(raw.status)) return null;
  return {
    uid: str(raw.uid),
    displayName: typeof raw.display_name === 'string' && raw.display_name ? raw.display_name : null,
    username: typeof raw.username === 'string' && raw.username ? raw.username : null,
    expiresAt: str(raw.expires_at) || null,
    telegramConfirmed: raw.telegram_confirmed === true,
    axalConfirmed: raw.axal_confirmed === true,
    status: raw.status,
    message: str(raw.message) || TELEGRAM_CLAIM_WORDS[raw.status],
  };
}

/**
 * What the Telegram card draws for a claim: who claimed it, the state's
 * sentence, and whether Confirm is offered. Axal may confirm before or after
 * Telegram's /confirm (`confirmAxalTelegramLink`), so Confirm stands until
 * Axal's half is in, and again at `ready`. Null when there is nothing to draw:
 * no claim, an unclaimed code (its steps are drawn instead), or a link done.
 */
export function telegramClaimView(claim) {
  if (!claim || claim.status === 'waiting_claim' || claim.status === 'linked') return null;
  const who = [claim.displayName, claim.username].filter(Boolean).join(' · ');
  const open = claim.status === 'waiting_telegram' || claim.status === 'waiting_axal' || claim.status === 'ready';
  return {
    uid: claim.uid,
    who: who || null,
    sentence: claim.message,
    canConfirm: (open && !claim.axalConfirmed) || claim.status === 'ready',
    stale: claim.status === 'expired' || claim.status === 'cancelled' || claim.status === 'unreadable',
    steps: [
      { label: 'Confirmed in Telegram', done: claim.telegramConfirmed },
      { label: 'Confirmed in Axal', done: claim.axalConfirmed },
    ],
  };
}

/** The confirm route's refusals in words, for an answer that carries no sentence of its own. */
export const TELEGRAM_CONFIRM_REFUSALS = {
  link_not_found: 'That Telegram link is not waiting on this Axal account.',
  link_cancelled: 'This link was replaced or cancelled. Request a new Telegram link.',
  link_expired: 'Both confirmations must arrive within ten minutes. Request a new Telegram link.',
  link_not_claimed: 'Open the link in your Telegram account and check its name in Axal before confirming.',
  member_inactive: 'This Axal account is no longer active, so nothing was linked.',
  identity_taken: 'This Telegram account is already linked to another Axal account. Disconnect it there first.',
};

/** A refused Confirm: the Worker's own sentence when it wrote one, else this table's, never a code. */
export function telegramConfirmRefusal(e) {
  const code = typeof e?.code === 'string' ? e.code : '';
  const msg = typeof e?.message === 'string' ? e.message.trim() : '';
  if (msg && msg !== code && !/^[a-z0-9_]+$/.test(msg)) return msg;
  return TELEGRAM_CONFIRM_REFUSALS[code] || 'Axal could not confirm this link. Try again in a minute.';
}

/** The name a connected account goes by on its card: a display name or a masked number. Never an id. */
export function accountName(conn) {
  if (!isObj(conn)) return '';
  for (const k of ['account_name', 'external_account_name', 'display_name', 'username', 'name']) {
    const v = str(conn[k]);
    if (v) return v.slice(0, 80);
  }
  return '';
}

const BAD_STATUS = new Set(['error', 'failed', 'revoked', 'expired', 'disabled', 'needs_attention', 'needs_reconnect']);

/** Why a connection needs the member, in plain words; '' when it does not. */
export function connectionProblem(provider, conn) {
  if (!isObj(conn)) return '';
  const name = PROVIDER_LABEL[provider] || 'The provider';
  const status = str(conn.status).toLowerCase();
  const err = str(conn.last_error);
  if (/expired|revoked|invalid_token|unauthori[sz]ed|\b401\b|oauth/i.test(err) || status === 'revoked' || status === 'expired') {
    return provider === 'whatsapp'
      ? 'WhatsApp no longer accepts Axal’s access to this number. Disconnect it, then connect WhatsApp Business again.'
      : `${name} no longer accepts Axal’s access. Disconnect it, then connect again.`;
  }
  if (err || BAD_STATUS.has(status)) return `The last attempt to reach ${name} failed. Send a test; if it fails again, disconnect and connect again.`;
  return '';
}

/**
 * Telegram is two steps: the member links their Telegram account (`/start`
 * with a one-time code), then adds the Axal bot in Telegram Business. A
 * connection that says its business connection is off has only done the
 * first. A field the Worker does not send is not a "no".
 */
export function telegramBusinessMissing(conn) {
  if (!isObj(conn)) return false;
  for (const k of ['business_connected', 'business_connection_enabled', 'business_enabled']) {
    if (conn[k] === false || conn[k] === 0) return true;
  }
  return conn.business_connection === null;
}

/** Telegram: the bot is connected but its rights do not let it reply. Explicit `false` only. */
export function telegramCannotReply(conn) {
  return isObj(conn) && (conn.can_reply === false || conn.can_reply === 0);
}

const WORDS = {
  unreadable: { label: 'Status unreadable', tone: 'neutral' },
  unavailable: { label: 'Not available yet', tone: 'neutral' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
  linked: { label: 'One step left', tone: 'info' },
  connected: { label: 'Connected', tone: 'ok' },
  problem: { label: 'Needs attention', tone: 'warn' },
};

/** The sentence for a provider Axal has not switched on: plain words, no secret names. */
export const UNAVAILABLE_WHY = 'Axal has not switched this on yet. There is nothing for you to set up until it does.';

/**
 * One messaging card's state: `unreadable` (the read failed), `unavailable`
 * (not set up on this platform yet), `not_connected`, `linked` (Telegram:
 * linked, bot not yet added), `connected`, or `problem`. With its pill words
 * and, where there is one, the sentence that says why.
 */
export function channelCard(provider, overview) {
  const out = (state, extra = {}) => ({ provider, state, ...WORDS[state], why: '', account: '', note: '', ...extra });
  if (!overview) return out('unreadable', { why: 'Your connection could not be read. This is not a claim that you have none.' });
  const conn = overview.connections?.[provider] || null;
  const available = overview.providers?.[provider]?.available ?? null;
  if (conn) {
    const account = accountName(conn);
    if (available === false) return out('problem', { account, why: 'Axal has switched this off for now. Your connection is kept, but nothing new arrives until it is back.' });
    const problem = connectionProblem(provider, conn);
    if (problem) return out('problem', { account, why: problem, calls: callsLine(provider, conn) });
    if (provider === 'telegram' && telegramBusinessMissing(conn)) {
      return out('linked', { account, why: 'Your Telegram account is linked. Add the Axal bot in Telegram Business to start receiving chats.' });
    }
    const note = provider === 'telegram' && telegramCannotReply(conn)
      ? 'The bot can read the chats you chose but not reply. To reply from Axal, allow it to reply in Telegram › Settings › Telegram Business › Chatbots.'
      : '';
    return out('connected', { account, note, calls: callsLine(provider, conn) });
  }
  if (available !== true) return out('unavailable', { why: UNAVAILABLE_WHY });
  return out('not_connected');
}

/** "3 conversations waiting", or '' when there are none or the count is unknown. */
export function pendingLabel(n) {
  const c = count(n);
  if (!c) return '';
  return `${c} conversation${c === 1 ? '' : 's'} waiting`;
}

/** The pending total across Telegram and WhatsApp; null when neither was counted. */
export function pendingTotal(overview) {
  const vals = MESSAGING_PROVIDERS.map((p) => overview?.pending?.[p]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/**
 * What "Send test" says once it worked (routes/channels.ts):
 *   telegram  a message to the member's own chat with the Axal bot. Telegram
 *             reports acceptance only, so nothing may say it arrived (§11).
 *   whatsapp  a check of the number with the member's access; it sends no
 *             message, so a test never reaches one of their customers.
 */
export function testOutcome(provider, r) {
  if (provider === 'whatsapp' || r?.sent === false) return 'Checked: WhatsApp answered for your number. No message was sent.';
  if (provider === 'telegram') return 'Test sent to your chat with the Axal bot. Telegram reports that it accepted the message, not that it arrived.';
  return 'Test sent.';
}

/** What a disconnect does, said before the click. */
export function disconnectNote(provider) {
  const name = PROVIDER_LABEL[provider] || 'this account';
  return `New ${name} chats stop arriving, and conversations still waiting in your inbox are deleted. Anything you already put in an interview stays there.`;
}

// ---------- Telegram: the link step ----------------------------------------

/** A link to the Axal bot that Axal itself issued: https://t.me/<bot>?start=<code>, nothing else. */
const TME = /^https:\/\/t\.me\/([A-Za-z0-9_]{4,32})\?start=[A-Za-z0-9_-]{1,64}$/;

export function safeTelegramUrl(url) {
  const s = str(url);
  return TME.test(s) ? s : null;
}

/** The bot's handle, from the link: "@AxalBot". */
export function botHandle(url) {
  const m = TME.exec(str(url));
  return m ? `@${m[1]}` : null;
}

/**
 * The link step after "Link Telegram": the link to open (only one Axal
 * issued), the bot's handle, when it stops working and whether it already has.
 */
export function telegramLinkView(link, now = Date.now(), fmt = defaultTime) {
  const href = safeTelegramUrl(link?.url);
  const exp = Date.parse(str(link?.expires_at));
  const expired = Number.isFinite(exp) ? exp <= now : false;
  return {
    href,
    bot: href ? botHandle(href) : null,
    expired,
    expires: Number.isFinite(exp) && !expired ? `Works once, until ${fmt(new Date(exp))}.` : '',
  };
}

function defaultTime(d) {
  try { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d); } catch { return d.toISOString().slice(11, 16); }
}

/** Both owners confirm the claim (migration 458): Telegram first or Axal first, inside the code's ten minutes. */
export const TELEGRAM_CONFIRM_STEP = 'Send /confirm in Telegram, then press Confirm here, within ten minutes of the code.';

/** What the member does in Telegram after opening the link, in order. */
export function telegramSteps(bot) {
  const handle = bot || 'the Axal bot';
  return [
    'Open the link and press Start. That proves this Telegram account is yours.',
    TELEGRAM_CONFIRM_STEP,
    'In Telegram, open Settings › Telegram Business › Chatbots.',
    `Add ${handle} as your chatbot.`,
    'Choose which chats it can see: only those can reach Axal.',
  ];
}

export const TELEGRAM_LIMITS = [
  'Needs Telegram Premium: chatbots are part of Telegram Business.',
  'The bot can read and reply only in the chats you choose. It cannot make or receive calls.',
];

// ---------- WhatsApp: Embedded Signup's public config ----------------------

/**
 * The app id and configuration id Meta's Embedded Signup needs. They are
 * public values the Worker hands out; with either missing the button stays
 * off and says it is not set up yet.
 */
export function whatsappSignupConfig(overview) {
  const s = overview?.providers?.whatsapp?.signup;
  const appId = str(s?.app_id);
  const configId = str(s?.config_id);
  if (!/^\d{5,25}$/.test(appId) || !/^\d{5,25}$/.test(configId)) return null;
  const version = /^v\d{1,2}\.\d$/.test(str(s?.graph_version)) ? str(s.graph_version) : undefined;
  return { appId, configId, ...(version ? { version } : {}) };
}

export const WHATSAPP_NOTES = [
  'Use your WhatsApp Business number. Your WhatsApp Business app keeps working on it (version 2.24.17 or later).',
  'Meta asks you to log in with Facebook and choose the business and the number. Only chats with your customers reach Axal, and nothing reaches an interview until you assign it.',
];

/** WhatsApp calls are a later phase (D684 §6): the card says so. */
export const WHATSAPP_CALLS = 'Calls: not yet';

/**
 * #1586: the connected number's own "Calls: not yet, because …", from the
 * Worker's eligibility read (`connections.whatsapp.calls.sentence`). '' when
 * the read has none, and the card then says the fixed line above.
 */
export function callsLine(provider, conn) {
  if (provider !== 'whatsapp') return '';
  const line = conn?.calls?.sentence;
  return typeof line === 'string' && /^Calls: not yet/.test(line) ? line : '';
}

// ---------- Zoom and Google Meet -------------------------------------------

/**
 * A meeting card's state, from `GET /api/channels` (is it on here?) and the
 * connectors catalogue (is the member's Zoom or Google connected?).
 *   Zoom        — the registry's `zoom` connector.
 *   Google Meet — the first-party Google Calendar connection; a connection
 *                 that says its Meet permission is missing needs a reconnect.
 */
export function meetingCard(provider, overview, catalogue = []) {
  const out = (state, extra = {}) => ({ provider, state, ...WORDS[state], why: '', account: '', connectorKey: null, ...extra });
  if (!overview) return out('unreadable', { why: 'Whether this is set up could not be read.' });
  const available = overview.providers?.[provider]?.available ?? null;
  const key = provider === 'zoom' ? 'zoom' : 'google';
  const entry = (Array.isArray(catalogue) ? catalogue : []).find((p) => p?.key === key) || null;
  const own = overview.connections?.[provider] || null;
  const conn = own || entry?.connection || null;
  if (available !== true) return out('unavailable', { why: UNAVAILABLE_WHY, connectorKey: entry && conn ? key : null });
  if (conn) {
    const account = accountName(conn);
    const problem = connectionProblem(provider, conn);
    if (problem) return out('problem', { account, connectorKey: key, why: problem });
    return out('connected', { account, connectorKey: entry ? key : null });
  }
  if (!entry || entry.available === false) {
    return out('unavailable', { why: provider === 'zoom' ? 'Zoom is not in your connectors yet. Axal adds it when it is switched on.' : 'Google Calendar cannot be connected on this deployment yet.' });
  }
  return out('not_connected', { connectorKey: key });
}

/**
 * What each call card says. A transcript is promised only on the provider's
 * terms: Zoom makes one only from a cloud recording (the Schedule panel's
 * "Record in the cloud"), Meet only when transcription is turned on in the call.
 */
export const MEETING_NOTES = {
  zoom: 'Schedule a Zoom call from an interview with Record in the cloud turned on, and its transcript comes in when the call ends. Transcripts need a paid Zoom plan with cloud recording and audio transcripts turned on; without a cloud recording, Zoom makes none.',
  google_meet: 'Schedule a Meet call from an interview; a transcript comes in after the call only if someone turned on transcription in it. Transcripts need a Google Workspace edition that includes Meet transcription.',
};
