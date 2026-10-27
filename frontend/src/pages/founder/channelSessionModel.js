/**
 * D862 (#2507) — Record a session › WhatsApp, the rules behind its boards
 * (`design/incoming/Record a session · WhatsApp Boards.dc.html`, WA1–WA13,
 * over `Session Channels Page.dc.html`). No React and no fetch, so
 * `frontend/test/record_whatsapp_d862.test.mjs` holds each rule.
 *
 * THE BOARDS SHARE THESE RULES. The inbox, the transcript, the analytics and
 * the proposals are drawn by `ChannelSessionParts.jsx` with the channel as an
 * argument, so Telegram (#2515) and Calls (#2525) reuse them.
 *
 * WHAT IT READS, all already in the Worker (nothing here adds a route):
 *   GET  /channels                          the connections and pending counts (D684)
 *   GET  /channels/threads                  ThreadView[] (services/channels/threads.ts)
 *   GET  /channels/whatsapp/setup           the six guided steps (D856), 404 while it is off
 *   GET  /founder/validate/sessions/:id     segments with `translation` beside `text` (D857)
 *   GET  /validate/sessions/:id/analytics   one session's figures (D858)
 *   GET  /validate/conversations/analytics  a venture's chats over a range (D858, D866)
 *   GET  /founder/validate/sessions/:id/placements  the proposals to accept (D859)
 *
 * THINGS THIS FILE MUST NEVER DO: show a full phone number; turn a figure the
 * store does not hold into 0 (it is "Not recorded", with the Worker's reason);
 * call a translation the original, or the original a translation; or say a
 * proposal is in Validate before the founder accepts it.
 */
import { PROVIDER_LABEL, contactLabel, threadRow } from './channelThreads.js';
import { placementText } from './InterviewReview.jsx';
import { NOT_RECORDED } from '../../lib/absence.js';

export { NOT_RECORDED };

/* ------------------------------------------------------------------ *
 * Addresses: each tab is a path (D1309's page, `/validate/record/whatsapp`)
 * ------------------------------------------------------------------ */

export const WA_BASE = '/validate/record/whatsapp';

export const WA_TABS = Object.freeze([
  { key: 'inbox', label: 'Inbox', to: WA_BASE },
  { key: 'sessions', label: 'Sessions', to: `${WA_BASE}/sessions` },
  { key: 'analytics', label: 'Analytics', to: `${WA_BASE}/analytics` },
  { key: 'proposals', label: 'Proposals', to: `${WA_BASE}/proposals` },
  { key: 'connection', label: 'Connection', to: `${WA_BASE}/connection` },
]);

const TAB_KEYS = new Set(WA_TABS.map((t) => t.key));

/** The tab and the record a location names: `{ tab, id }`, or null for an address that is not the tool's. */
export function waRoute(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === WA_BASE) return { tab: 'inbox', id: null };
  if (!p.startsWith(`${WA_BASE}/`)) return null;
  const [tab, id, extra] = p.slice(WA_BASE.length + 1).split('/');
  if (!TAB_KEYS.has(tab) || tab === 'inbox' || extra !== undefined) return null;
  if (id === undefined) return { tab, id: null };
  if (tab === 'connection' || !/^[1-9]\d{0,9}$/.test(id)) return null;
  return { tab, id: Number(id) };
}

/** A tab's address, with a session for Sessions, Analytics and Proposals. */
export function waHref(tab, id = null) {
  const t = WA_TABS.find((x) => x.key === tab);
  if (!t) throw new Error(`Unknown tab: ${tab}`);
  return id && tab !== 'inbox' && tab !== 'connection' ? `${t.to}/${Number(id)}` : t.to;
}

/* ------------------------------------------------------------------ *
 * Numbers and names
 * ------------------------------------------------------------------ */

/** "•••• 1234" from anything holding digits; never more than the last four. */
export function maskNumber(value) {
  const d = String(value ?? '').replace(/\D/g, '');
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : null;
}

/** A contact's name as the inbox shows it. A name that is a phone number is masked. */
export function contactName(t) {
  const name = contactLabel(t);
  return /^\+?[\d\s().-]{6,}$/.test(name) ? (maskNumber(name) || 'Number hidden') : name;
}

/* ------------------------------------------------------------------ *
 * The page's state (WA8–WA11)
 * ------------------------------------------------------------------ */

/**
 * Which board the page draws before any tab: loading (WA9), error (WA10), no
 * permission (WA11), empty (WA8), or ready. A refused read (401/403) is "no
 * permission", never "nothing here"; a failed one is "could not be read".
 */
export function pageState({ overview, threads }) {
  if (overview.status === 'loading' || threads.status === 'loading') return 'loading';
  if (threads.status === 'forbidden' || overview.status === 'forbidden') return 'nop';
  if (overview.status === 'unreadable' || threads.status === 'unreadable') return 'error';
  const o = overview.overview;
  // D757 §2.11: a member who cannot hold a venture is offered no channel at all.
  if (!o || !Object.keys(o.providers || {}).length) return 'nop';
  if (!o.connections?.whatsapp) return 'empty';
  return 'ready';
}

/** What a failed read means: refused (no permission) or unreadable. */
export const readFailure = (e) => (e?.status === 401 || e?.status === 403 ? 'forbidden' : 'unreadable');

/* ------------------------------------------------------------------ *
 * WA2: the chats inbox
 * ------------------------------------------------------------------ */

const CONSENT = {
  not_asked: ['Not asked', 'mut'],
  awaiting: ['Asked', 'amb'],
  given: ['Given', 'pos'],
  declined: ['Declined', 'neg'],
  withdrawn: ['Withdrawn', 'neg'],
};

/** The consent pill: the Worker's state in the canvas's words. A state it does not send is Not recorded. */
export function consentPill(status) {
  const [t, tone] = CONSENT[status] || [NOT_RECORDED, 'mut'];
  return { t, tone };
}

/** The channel filter Telegram shares (TG2): All, WhatsApp, Telegram, with counts. */
export function channelFilters(items, channel) {
  const n = (p) => items.filter((t) => !p || t.provider === p).length;
  return [{ key: 'all', t: 'All', n: n(null) }, { key: 'whatsapp', t: 'WhatsApp', n: n('whatsapp') }, { key: 'telegram', t: 'Telegram', n: n('telegram') }]
    .map((f) => ({ ...f, on: f.key === channel }));
}

/** The inbox rows for one channel filter, newest first. Each row's actions follow its state. */
export function inboxRows(items, channel = 'whatsapp', now = Date.now()) {
  return items
    .filter((t) => channel === 'all' || t.provider === channel)
    .slice()
    .sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')))
    .map((t) => {
      const row = threadRow(t, now);
      const consent = consentPill(t.consent_status);
      return {
        uid: t.uid,
        name: contactName(t),
        channel: PROVIDER_LABEL[t.provider] || 'Unknown',
        count: row.count,
        when: row.when,
        consent,
        status: t.status,
        interviewee: row.interviewee,
        sessionId: t.session_id ?? null,
        suggestions: Number(t.pending_suggestions) || 0,
        canAssign: t.status === 'pending',
        canAsk: t.status !== 'ignored' && (t.consent_status === 'not_asked' || t.consent_status === 'declined'),
        canIgnore: t.status === 'pending',
      };
    });
}

/* ------------------------------------------------------------------ *
 * WA3: the transcript, original and translation side by side (D857)
 * ------------------------------------------------------------------ */

export const TX_VIEWS = [{ key: 'orig', t: 'Original' }, { key: 'tr', t: 'Translation' }, { key: 'both', t: 'Both' }];

/** A language's name from its code ("pt" → "Portuguese"); the code itself if the browser cannot name it. */
export function languageName(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(c) || c;
  } catch {
    return c;
  }
}

const SPEECH = /whisper|nova|deepgram|speech/i;

/**
 * The turns of a chat session in the chosen view. A translation is shown only
 * when the Worker sent one (`translation_status: done`); otherwise the
 * original stands alone, whatever the view. A pending segment says so.
 */
export function transcriptTurns(segments, view = 'both') {
  return (Array.isArray(segments) ? segments : [])
    .filter((s) => s && s.source === 'final' && String(s.text ?? '').trim())
    .map((s) => {
      const hasTr = s.translation_status === 'done' && typeof s.translation === 'string' && s.translation.trim() !== '';
      return {
        id: s.id,
        you: s.speaker_label === 'Me',
        who: s.speaker_label === 'Me' ? 'You' : (String(s.speaker_label || '').trim() || 'Contact'),
        at: s.created_at || null,
        voice: SPEECH.test(String(s.model || '')),
        original: String(s.text),
        translation: hasTr ? s.translation : null,
        showOriginal: view !== 'tr' || !hasTr,
        showTranslation: view !== 'orig' && hasTr,
        from: hasTr ? `Translated from ${languageName(s.source_lang) || 'another language'}` : '',
        pending: s.translation_status === 'pending',
      };
    });
}

/** How many segments still wait for their translation. */
export const pendingTranslations = (segments) => (Array.isArray(segments) ? segments : []).filter((s) => s?.source === 'final' && s.translation_status === 'pending').length;

/**
 * WA7. A pending translation waits for the next pass; the Worker does not keep
 * why it waited, so the page never claims a reason it was not told. It says
 * what is known, that the originals are kept, and where AI tokens are added.
 */
export function pendingNotice(n) {
  if (!n) return null;
  return {
    t: `${n === 1 ? '1 message waits' : `${n} messages wait`} for translation.`,
    p: 'The originals are kept and shown. A translation waits when Eadwyn could not run it, for example when your AI tokens ran out; it is tried again on the next pass.',
  };
}

/** The consent banner from the session read's `channel_consent` (D754). */
export function consentBanner(consent) {
  if (!consent || typeof consent !== 'object') return { tone: 'mut', t: 'Consent for this chat is not recorded on this page.', p: 'Open the chat in the inbox to see where consent stands.' };
  const state = consent.status;
  if (state === 'given') return { tone: 'pos', t: 'Consent is given for this chat.', p: 'If the person withdraws it, new messages stop being kept at once.' };
  if (state === 'withdrawn' || state === 'declined') return { tone: 'neg', t: 'Consent was withdrawn or declined.', p: 'No new message from this chat is kept.' };
  return { tone: 'amb', t: 'Consent is not given yet.', p: 'Nothing new is kept until the person agrees.' };
}

/* ------------------------------------------------------------------ *
 * WA4, WA5: analytics (D858). Every figure is `{ value, sources, reason }`.
 * ------------------------------------------------------------------ */

/** A figure as the page shows it: its text, or Not recorded with the Worker's reason; and its source chips. */
export function figure(f, show = (v) => String(v)) {
  const sources = Array.isArray(f?.sources) ? f.sources.filter((s) => s === 'Recorded' || s === 'Typed') : [];
  if (!f || f.value === null || f.value === undefined) {
    return { text: NOT_RECORDED, reason: typeof f?.reason === 'string' && f.reason ? f.reason : 'This figure was not sent.', sources, missing: true };
  }
  return { text: show(f.value), reason: '', sources, missing: false };
}

const minutes = (n) => `${Math.round(Number(n) * 10) / 10}`;
const replyTime = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** The four tiles: one session (WA4) or a venture (WA5). */
export function analyticsTiles(a, venture = false) {
  const m = a?.messages;
  const counts = m?.value;
  const msg = figure(m, (v) => String(v.total));
  if (counts) msg.sub = `You ${counts.founder.typed + counts.founder.recorded} · contacts ${counts.customer.typed + counts.customer.recorded}`;
  const tiles = [
    venture ? { e: 'Chats', ...figure({ value: a?.sessions, sources: m?.sources || [], reason: null }) } : null,
    { e: 'Messages', ...msg },
    { e: 'Voice minutes', ...figure(a?.voice_minutes, minutes) },
    venture ? null : { e: 'Languages', ...figure(a?.languages, (v) => String(v.length)) },
    { e: 'Median reply time', ...figure(a?.median_reply_seconds, replyTime) },
  ];
  return tiles.filter(Boolean);
}

/** Messages by side, as two bars. Null when the store does not hold the counts. */
export function bySide(a) {
  const c = a?.messages?.value;
  if (!c) return null;
  const you = c.founder.typed + c.founder.recorded;
  const them = c.customer.typed + c.customer.recorded;
  const max = Math.max(you, them, 1);
  return [{ l: 'You', n: you, w: (you / max) * 100 }, { l: 'Contacts', n: them, w: (them / max) * 100 }];
}

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The lists beside the themes: objections, willingness to pay and competitors, each item with its count. */
export function analyticsLists(a) {
  const named = (f, key) => (Array.isArray(f?.value) ? f.value.map((x) => ({ a: x[key] || NOT_RECORDED, n: plural((x.suggested || 0) + (x.accepted || 0), 'mention') })) : null);
  const wtp = a?.wtp_mentions?.value;
  return [
    { t: 'Pain themes', L: Array.isArray(a?.pain_themes?.value) ? a.pain_themes.value.map((x) => ({ a: x.title || 'Not in a theme', n: plural((x.suggested || 0) + (x.accepted || 0), 'mention') })) : null, reason: a?.pain_themes?.reason || '' },
    { t: 'Objections', L: named(a?.objections, 'about'), reason: a?.objections?.reason || '' },
    { t: 'Willingness to pay', L: wtp ? [{ a: 'Mentions', n: plural((wtp.suggested || 0) + (wtp.accepted || 0), 'mention') }] : null, reason: a?.wtp_mentions?.reason || '' },
    { t: 'Competitors', L: named(a?.competitor_mentions, 'name'), reason: a?.competitor_mentions?.reason || '' },
  ];
}

/** Quotes per theme: the words in one session's read, counts only in a venture's. Withheld says why. */
export function themeQuotes(a) {
  const f = a?.quotes_by_theme;
  if (!f || !Array.isArray(f.value)) return { withheld: f?.reason || NOT_RECORDED, themes: [] };
  return {
    withheld: '',
    themes: f.value.map((x) => ({
      th: x.title || 'Not in a theme',
      quotes: Array.isArray(x.quotes) ? x.quotes : [],
      counts: Array.isArray(x.quotes) ? '' : `${plural(x.quotable || 0, 'quote')} shown · ${x.withheld || 0} withheld`,
    })),
  };
}

const iso = (d) => d.toISOString().slice(0, 10);

/** The weeks a trend reads, oldest first: `n` Monday-to-Sunday weeks ending with the one holding `today`. */
export function trendWeeks(today = new Date(), n = 8) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
  return Array.from({ length: n }, (_, i) => {
    const from = new Date(monday.getTime() - (n - 1 - i) * 7 * 86400000);
    const to = new Date(from.getTime() + 6 * 86400000);
    return { from: iso(from), to: iso(to), last: i === n - 1 };
  });
}

/** The trend bars: a week whose read failed is a dashed hairline marked Not recorded, never a zero. */
export function trendBars(weeks, values) {
  const known = values.filter((v) => typeof v === 'number');
  const max = Math.max(1, ...known);
  return weeks.map((w, i) => {
    const v = values[i];
    const missing = typeof v !== 'number';
    return { l: w.last ? 'to date' : new Date(`${w.from}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), v: missing ? '—' : String(v), missing, h: missing ? 0 : (v / max) * 100, partial: w.last };
  });
}

/** The range choices (WA5): the last 30 or 90 days, as `from`/`to` days. */
export function rangeOf(key, today = new Date()) {
  const days = key === '90' ? 90 : 30;
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return { from: iso(new Date(to.getTime() - (days - 1) * 86400000)), to: iso(to) };
}

/* ------------------------------------------------------------------ *
 * WA6: proposals to accept (D859)
 * ------------------------------------------------------------------ */

export const PROPOSAL_GROUPS = [
  { key: 'pricing', g: 'Pricing', mod: 'Validate › Demand and urgency signals', kinds: ['demand_signal', 'budget'] },
  { key: 'market', g: 'Market intelligence', mod: 'Validate › Market intelligence', kinds: ['competitor_mention', 'market_fact'] },
  { key: 'problem', g: 'Problem', mod: 'Validate › Problem discovery', kinds: ['pain_severity', 'job_to_be_done'] },
  { key: 'customer', g: 'Customer', mod: 'Validate › Ideal customer profile', kinds: ['firmographic', 'segment', 'icp_fit'] },
  { key: 'follow', g: 'Follow-ups', mod: 'Validate › Customer research', kinds: ['follow_up', 'prototype_ask'] },
];

/** Accept all takes at most this many, as the Worker's route does. */
export const ACCEPT_ALL_MAX = 50;

/** A confidence word from the model's 0–1 score, or Not recorded. */
export function confidenceOf(p) {
  const c = Number((p?.edited_payload || p?.payload || {}).confidence);
  if (!Number.isFinite(c) || c < 0 || c > 1) return { t: NOT_RECORDED, dots: 0 };
  return c >= 0.8 ? { t: 'High', dots: 3 } : c >= 0.6 ? { t: 'Medium', dots: 2 } : { t: 'Low', dots: 1 };
}

/** A proposal's line, in the founder's words. The two D859 kinds are named here; the rest are the review page's. */
export function proposalTitle(p) {
  const v = p?.edited_payload || p?.payload || {};
  if (p?.kind === 'follow_up') return v.detail ? `Follow up: ${v.detail}${v.due_hint ? ` (${v.due_hint})` : ''}` : 'Follow-up, detail not recorded';
  if (p?.kind === 'prototype_ask') return v.feature ? `Prototype ask: ${v.feature}` : 'Prototype ask, feature not recorded';
  if (p?.kind === 'budget') return v.amount ? `Spends ${v.amount} today` : 'Spend today, amount not recorded';
  return placementText(p);
}

/**
 * The proposals waiting for the founder, grouped as the canvas groups them.
 * Only pending ones: an accepted or discarded item is never offered again.
 * Prototype asks carry "For Build". The latest run of each source counts, as
 * the review page reads them.
 */
export function proposalGroups(read) {
  const runs = Array.isArray(read?.runs) ? read.runs : [];
  const latest = (src) => [...runs].reverse().find((r) => (r.source === 'assistant' ? 'assistant' : 'studioos') === src);
  const items = [latest('assistant'), latest('studioos')].filter(Boolean).flatMap((r) => r.placements || []).filter((p) => p.status === 'pending');
  const groups = PROPOSAL_GROUPS.map((g) => ({ ...g, items: items.filter((p) => g.kinds.includes(p.kind)) }));
  const known = new Set(PROPOSAL_GROUPS.flatMap((g) => g.kinds));
  const other = items.filter((p) => !known.has(p.kind));
  if (other.length) groups.push({ key: 'other', g: 'Other', mod: 'Validate', kinds: [], items: other });
  return groups.filter((g) => g.items.length).map((g) => ({
    ...g,
    items: g.items.map((p) => ({
      id: p.id,
      t: proposalTitle(p),
      q: p.cite?.quote || '',
      conf: confidenceOf(p),
      build: p.kind === 'prototype_ask' || (p.payload || {}).build_candidate === true,
      canAccept: p.can_accept !== false,
    })),
  }));
}

/** The ids Accept all sends: the acceptable pending ones, at most ACCEPT_ALL_MAX. */
export function acceptAllIds(groups) {
  return groups.flatMap((g) => g.items).filter((i) => i.canAccept).map((i) => i.id).slice(0, ACCEPT_ALL_MAX);
}

/* ------------------------------------------------------------------ *
 * WA1: the guided connect (D856)
 * ------------------------------------------------------------------ */

const STEP_TITLES = { prerequisites: 'Prerequisites', number: 'Number', register: 'Register', webhook: 'Webhook', template: 'Consent template', connect: 'Done' };
const STEP_LINES = {
  prerequisites: 'A Meta Business account, and a number that is not already used in the WhatsApp app.',
  number: 'The business number Axal reads. Only its last four digits are shown.',
  register: 'The number registered on the WhatsApp Business Platform.',
  webhook: 'Meta sends new messages to Axal.',
  template: 'The consent message each person sees before anything is kept, sent to Meta for review.',
  connect: 'Chats from people who agree start arriving in Inbox.',
};

/**
 * The six steps as the board draws them. The first step not done is the one
 * to press: "Resume from this step" when it failed, "Run this step"
 * otherwise. A later step waits for it.
 */
export function setupSteps(view) {
  const steps = Array.isArray(view?.steps) ? view.steps : [];
  const next = steps.find((s) => s.state !== 'done');
  return steps.map((s) => ({
    key: s.key,
    n: s.step,
    t: STEP_TITLES[s.key] || s.key,
    line: s.key === 'number' && view?.number_masked ? `${maskNumber(view.number_masked) || view.number_masked}.` : STEP_LINES[s.key] || '',
    state: s.state === 'done' ? 'done' : s.state === 'blocked' ? 'failed' : 'todo',
    pill: s.state === 'done' ? 'Done' : s.state === 'blocked' ? 'Failed' : 'To do',
    action: s.state === 'done' ? null : s.action,
    confirm: s.confirm || null,
    press: next === s ? (s.state === 'blocked' ? 'Resume from this step' : 'Run this step') : null,
  }));
}
