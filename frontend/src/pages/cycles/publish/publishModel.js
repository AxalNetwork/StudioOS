/**
 * D1321 (#3482, part 3 of #2400) — the rules and the words of Publish to…,
 * its confirm, its result and the sent history ("Published outside"), as pure
 * functions over part 1's reads (`publishApi`, D1319). The canvases are
 * `design/incoming/Publish Sheet Page.dc.html` and `Publish · Boards.dc.html`
 * (PUB1–PUB12, D1318).
 *
 * NOTHING HERE SENDS. A send is `publishApi.confirm`, called only from the
 * confirm dialog the founder presses, with one idempotency key per place made
 * when the dialog opens (`idempotencyKey`). An outcome that is not known is
 * never offered Retry: Check, or Mark as not sent first (D1318 §5).
 */

/** Grow's places, in Grow's order, as `PUBLISH_MODULES` names them. */
export const MODULE_LABELS = Object.freeze({
  overview: 'Overview',
  updates: 'Updates',
  'product-improvement': 'Product improvement',
  distribution: 'Distribution',
  'revenue-and-traction': 'Revenue and traction',
  'team-expansion': 'Team expansion',
  'partner-network': 'Partner network',
  'market-expansion': 'Market expansion',
  'durable-company-building': 'Durable company-building',
});
export const moduleLabel = (key) => MODULE_LABELS[key] || 'Grow';

/** A provider's name and the letter on its tile. An unknown key reads as itself, never as another service. */
const PROVIDERS = Object.freeze({
  x: ['X', 'X'], twitter: ['X', 'X'], beehiiv: ['Beehiiv', 'B'], facebook: ['Facebook', 'f'], tiktok: ['TikTok', 'T'],
});
export function providerOf(key) {
  const k = String(key || '').toLowerCase();
  if (PROVIDERS[k]) return { name: PROVIDERS[k][0], letter: PROVIDERS[k][1] };
  const name = k ? k.charAt(0).toUpperCase() + k.slice(1) : 'the service';
  return { name, letter: (name[0] || '?').toUpperCase() };
}
/** "@northwind_demo on X". */
export const accountOn = (account, providerKey) => `${account || 'This account'} on ${providerOf(providerKey).name}`;

/** Where a destination is switched on or off: the connector's own page (D753). */
export const connectorHref = (providerKey) => `/account/connectors/${encodeURIComponent(String(providerKey || ''))}`;
/** The history's address on Grow's Reporting desk; `sent` opens one row's detail. */
export const HISTORY_ID = 'published-outside';
export const historyHref = (sendUid) => (sendUid ? `/grow/reporting?sent=${encodeURIComponent(sendUid)}#${HISTORY_ID}` : `/grow/reporting#${HISTORY_ID}`);

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

/**
 * Every place the founder's connections list, flat, in their order. Each is
 * `on` when switched on for this company; one that is off is muted with its
 * reason and a link. Nothing is pre-ticked: the sheet starts with none.
 */
export function destinationRows(read) {
  const out = [];
  for (const c of read?.connections || []) {
    for (const d of c.destinations || []) {
      out.push({
        uid: d.uid, provider_key: d.provider_key || c.provider_key, account: d.account, audience: d.audience || null,
        retract: d.retract || 'unknown', on: d.enabled === true,
        reason: d.enabled === true ? null : 'Off for this company',
        href: connectorHref(d.provider_key || c.provider_key),
      });
    }
  }
  return out;
}
export const tickedLine = (ticked, rows) => `${ticked} of ${rows.filter((r) => r.on).length} ticked`;

/** "Public · Can be deleted later", "Draft only: not sent to subscribers", "Public · Cannot be deleted from Axal VC". */
export function retractWords(retract) {
  if (retract === 'delete') return 'Can be deleted later';
  if (retract === 'none') return 'Cannot be deleted from Axal VC';
  return null;
}
export const audienceLine = (audience, retract) => [audience, retractWords(retract)].filter(Boolean).join(' · ');

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const FINDING = Object.freeze({
  email: ['Email address', 'Remove it from the text.'],
  phone: ['Phone number', 'Remove it from the text.'],
  secret: ['Looks like a key or token', 'Remove it from the text. Keys are never posted.'],
  card_like: ['Looks like a card number', 'Remove it from the text.'],
  tax_id: ['Looks like a tax ID', 'Remove it from the text.'],
  bank_iban: ['Looks like a bank account number', 'Remove it from the text.'],
  private_in_public: ['Names an Axal member', 'Remove the name, or tick that they agreed to be named.'],
  consent_missing: ['Names an Axal member', 'Remove the name, or tick that they agreed to be named.'],
  team_only: ['Team-only figure', 'Remove it, or tick team-only figures in for this draft.'],
});
/** A secret's own words ("Looks like an API key.") name which kind it is. */
const secretTitle = (f) => {
  const m = /^(Looks like [^.]+)\.?$/.exec(String(f.context || ''));
  return m ? m[1] : FINDING.secret[0];
};

/**
 * The check's findings across the previews, once each (kind and match). Each
 * says what it is, the masked match the Worker sent, and how to fix it. A
 * finding always blocks: there is no override (#2400 decision E). A named
 * member is cleared by "They agreed to be named", a team-only figure by
 * ticking team-only figures in; both are the draft's own settings, saved, and
 * the check runs again.
 */
export function findingRows(previews) {
  const seen = new Map();
  for (const p of previews || []) {
    for (const f of p?.lint?.findings || []) {
      const key = `${f.kind}|${f.match}|${f.user_id ?? ''}`;
      const [title, fix] = FINDING[f.kind] || ['Found in the text', 'Remove it from the text.'];
      seen.set(key, {
        key, kind: f.kind, title: f.kind === 'secret' ? secretTitle(f) : title, match: f.match || '', fix,
        user_id: Number.isSafeInteger(f.user_id) ? f.user_id : null, offset: Number.isInteger(f.offset) ? f.offset : null,
        length: Number.isInteger(f.length) ? f.length : null,
        consent: f.kind === 'private_in_public' || f.kind === 'consent_missing',
        teamOnly: f.kind === 'team_only',
      });
    }
  }
  return [...seen.values()];
}

/**
 * The text cut into plain and highlighted runs, at the findings' offsets
 * (the Worker's, into the text as sent). Overlaps and offsets past the end
 * are dropped, never guessed.
 */
export function highlightRuns(text, findings) {
  const s = String(text || '');
  const spans = (findings || []).filter((f) => f.offset != null && f.length > 0 && f.offset + f.length <= s.length)
    .sort((a, b) => a.offset - b.offset);
  const out = [];
  let at = 0;
  for (const f of spans) {
    if (f.offset < at) continue;
    if (f.offset > at) out.push({ text: s.slice(at, f.offset), mark: false });
    out.push({ text: s.slice(f.offset, f.offset + f.length), mark: true, kind: f.kind });
    at = f.offset + f.length;
  }
  if (at < s.length) out.push({ text: s.slice(at), mark: false });
  return out;
}

/** The check's one line when it passed. */
export const CHECK_PASSED = 'No email addresses, keys, Axal member names or team-only figures in the text.';
export const CHECK_WAITS = 'The check runs when there is text to send.';
export const PREVIEW_WAITS = 'A preview for each place appears when there is text.';
export const NO_OVERRIDE = 'A finding is fixed in the text. Nothing sends past one.';

/** A preview's counter, "212 / 280", with its text equivalent "212 of 280 characters". */
export function counterOf(preview) {
  const c = (preview?.preview?.counts || []).find((x) => x && Number.isFinite(x.used));
  if (!c) return null;
  const limit = Number.isFinite(c.limit) ? c.limit : null;
  const unit = String(c.name || 'characters').toLowerCase();
  return {
    shown: limit == null ? String(c.used) : `${c.used} / ${limit}`,
    spoken: limit == null ? `${c.used} ${unit}` : `${c.used} of ${limit} ${unit}`,
    over: limit != null && c.used > limit,
  };
}
/** "Up to 4 images · JPG, PNG, WEBP", or null when the place takes none. */
export function mediaLine(preview) {
  const m = preview?.preview?.media;
  if (!m || !m.limit) return null;
  const types = (m.types || []).map((t) => String(t).replace(/^image\//, '').toUpperCase()).join(', ');
  return [`Up to ${m.limit} ${m.limit === 1 ? 'image' : 'images'}`, types || null].filter(Boolean).join(' · ');
}

/**
 * Review and send, and the words beside it when it is off. On only with text,
 * a ticked place, a preview for every ticked place, and every one sendable
 * (no problem, no finding).
 */
export function footState({ text, ticked, previews, checking }) {
  const has = String(text || '').trim().length > 0;
  if (!has) return { on: false, why: 'Write your post to continue.' };
  if (!ticked.length) return { on: false, why: 'Tick a place to continue.' };
  if (checking) return { on: false, why: 'Checking…' };
  const byUid = new Map((previews || []).map((p) => [p.destination_uid, p]));
  const mine = ticked.map((uid) => byUid.get(uid));
  if (mine.some((p) => !p)) return { on: false, why: 'Checking…' };
  if (mine.some((p) => p.lint && p.lint.ok === false)) return { on: false, why: 'Remove the highlighted text to continue.' };
  if (mine.some((p) => !p.sendable)) return { on: false, why: 'Fix the problems the preview lists to continue.' };
  return { on: true, why: null };
}

// ---------------------------------------------------------------------------
// The confirm
// ---------------------------------------------------------------------------

export const placesWord = (n) => `${n} ${n === 1 ? 'place' : 'places'}`;
export const CONFIRM_LINE = 'This posts in your name. Nothing else is sent.';

/** The confirm's rows: every account and audience, as it will be sent. */
export function confirmRows(previews, rows) {
  const byUid = new Map((rows || []).map((r) => [r.uid, r]));
  return (previews || []).map((p) => {
    const r = byUid.get(p.destination_uid) || {};
    return {
      uid: p.destination_uid, provider_key: p.provider_key || r.provider_key, title: accountOn(p.account || r.account, p.provider_key || r.provider_key),
      line: audienceLine(p.audience ?? r.audience, p.retract || r.retract) || 'Audience not stated',
    };
  });
}

/** One key per place per confirm dialog: a second press of the same dialog is the same send. */
export function idempotencyKey(rand = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)) {
  return `pub-${rand()}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

// ---------------------------------------------------------------------------
// Sends: the result, the history and the detail
// ---------------------------------------------------------------------------

/** Part 1's statuses, as the pill reads them. `ready` is a confirm not yet taken: it is sending. */
export const STATUS = Object.freeze({
  ready: { glyph: '◌', word: 'Sending', tone: 'violet' },
  sending: { glyph: '◌', word: 'Sending', tone: 'violet' },
  sent: { glyph: '✓', word: 'Sent', tone: 'pos' },
  failed: { glyph: '!', word: 'Failed', tone: 'neg' },
  unknown: { glyph: '?', word: 'Not known', tone: 'amber' },
  retracted: { glyph: '↩', word: 'Retracted', tone: 'muted' },
  removed_outside: { glyph: '↗', word: 'Removed outside', tone: 'muted' },
});
export const statusOf = (s) => STATUS[s] || { glyph: '?', word: 'Not known', tone: 'amber' };
/** The status filter's choices, as the Worker takes them. */
export const STATUS_FILTERS = Object.freeze(['sent', 'sending', 'failed', 'unknown', 'retracted', 'removed_outside']);

const asDate = (v) => {
  if (!v) return null;
  const s = String(v);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.valueOf()) ? null : d;
};
/** "26 Oct 2026" and "14:02", in UTC, from the Worker's time; null for none. */
export function dayAndTime(v) {
  const d = asDate(v);
  if (!d) return { day: null, time: null };
  return {
    day: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }),
  };
}
const whenOf = (s) => s?.sent_at || s?.confirmed_at || null;

export const NOT_KNOWN = (provider) => `Not known whether this arrived. Check ${provider} before sending again.`;
export const NOT_KNOWN_WHY = (provider) => `${provider} did not answer before the connection timed out. Axal VC will not send it again on its own.`;

/** Why a failed send failed, in our words; a 429 names when to try again. */
export function failedLine(send) {
  const p = providerOf(send?.provider_key).name;
  if (send?.error_code === 'rate_limited' || send?.error_code === 'daily_cap_reached') {
    const { time } = dayAndTime(send.retry_after);
    if (send.error_code === 'daily_cap_reached') return 'This place has reached its posts for today. Try again tomorrow.';
    return time ? `${p} is busy. Try again after ${time}.` : `${p} is busy. Try again later.`;
  }
  if (send?.error_code === 'reconnect_required' || send?.error_code === 'auth_failed') return `Reconnect ${p}, then try again.`;
  return `${p} did not take it. Nothing was posted there.`;
}

/** What a send may do now, for the member who may publish; nothing for anyone else. */
export function actionsOf(send, canPublish) {
  const none = { retry: false, check: false, markNotSent: false, retract: false, markRemoved: false, deleteOutside: false };
  if (!canPublish || !send) return none;
  const s = send.status;
  return {
    retry: s === 'failed',
    check: s === 'unknown',
    markNotSent: s === 'unknown',
    retract: s === 'sent' && send.retract === 'delete',
    markRemoved: s === 'sent' && send.retract !== 'delete',
    deleteOutside: s === 'sent' && send.retract !== 'delete' && isHttps(send.external_url),
  };
}
export const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u);

/** The link a sent post has: "View on X ↗"; a Beehiiv draft "Open in Beehiiv ↗". */
export function viewLink(send) {
  if (!isHttps(send?.external_url) || send.status !== 'sent') return null;
  const p = providerOf(send.provider_key).name;
  return { href: send.external_url, label: /draft/i.test(String(send.audience || '')) ? `Open in ${p} ↗` : `View on ${p} ↗` };
}

/** "Sent to 2 of 3", and the line under it. */
export function resultSummary(sends) {
  const all = sends || [];
  const sent = all.filter((s) => s.status === 'sent');
  const names = (pred) => [...new Set(all.filter(pred).map((s) => providerOf(s.provider_key).name))].join(' and ');
  const failed = names((s) => s.status === 'failed');
  const unknown = names((s) => s.status === 'unknown');
  const parts = [sent.length ? `${placesWord(sent.length)} received it.` : 'No place received it yet.'];
  if (failed) parts.push(`${failed} did not.`);
  if (unknown) parts.push(`It is not known whether ${unknown} did.`);
  parts.push('Nothing was sent anywhere else.');
  return { title: `Sent to ${sent.length} of ${all.length}`, line: parts.join(' ') };
}

/** A history row: one send, as the list and the phone's cards draw it. */
export function historyRow(send) {
  const { day, time } = dayAndTime(whenOf(send));
  const prov = providerOf(send.provider_key);
  const aud = /draft/i.test(String(send.audience || '')) ? String(send.audience).split(':')[0] : null;
  return {
    uid: send.uid, day: day || '—', time: time || '', module: moduleLabel(send.module), account: send.destination || 'This account',
    provider: prov.name, letter: prov.letter, audience: aud, status: statusOf(send.status), first: firstLine(send.text),
    link: viewLink(send),
  };
}
export const firstLine = (text) => {
  const s = String(text || '').split('\n').find((l) => l.trim()) || '';
  return s.length > 90 ? `${s.slice(0, 89)}…` : s;
};

/** The detail's facts. Only the founder confirms, so "Confirmed by" is them, or the viewer. */
export function detailFacts(send, viewerId) {
  const confirmed = dayAndTime(send.confirmed_at);
  const sent = dayAndTime(send.sent_at);
  const by = Number(send.confirmed_by) === Number(viewerId) ? 'You' : 'The founder';
  return [
    { k: 'Account', v: accountOn(send.destination, send.provider_key) },
    { k: 'Audience', v: send.audience || 'Not stated' },
    { k: 'Confirmed by', v: confirmed.day ? `${by} · ${confirmed.day}, ${confirmed.time}` : by },
    { k: 'Sent at', v: sent.day ? `${sent.day}, ${sent.time}` : 'Not sent', mono: true },
    ...(send.external_post_id ? [{ k: 'Post ID', v: String(send.external_post_id), mono: true, copy: true }] : []),
  ];
}
/** The detail's line on deleting, from the place's own rule. */
export function retractNote(send) {
  const p = providerOf(send.provider_key).name;
  if (send.retract === 'delete') return `${p} lets Axal VC delete this post.`;
  return `Axal VC cannot delete posts on ${p}. Delete it there, then mark it here.`;
}

/** The history's filters: module, destination and status go to the Worker; the search reads the text here. */
export function filterRows(sends, { q = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return sends || [];
  return (sends || []).filter((s) => String(s.text || '').toLowerCase().includes(needle) || String(s.destination || '').toLowerCase().includes(needle));
}
/** The destination filter's choices, from the sends themselves. */
export function providerChoices(sends) {
  return [...new Set((sends || []).map((s) => s.provider_key).filter(Boolean))].map((k) => ({ key: k, label: providerOf(k).name }));
}

/**
 * D1333's `dropped` counts, as the sheet says them: what the pre-fill left out
 * and why. A count of none says nothing.
 */
export function droppedLines(dropped) {
  const d = dropped || {};
  const n = (k) => (Number.isFinite(d[k]) && d[k] > 0 ? d[k] : 0);
  return [
    n('team_only') && `${n('team_only')} team-only ${n('team_only') === 1 ? 'figure was' : 'figures were'} left out. They stay in Axal VC.`,
    n('not_recorded') && `${n('not_recorded')} ${n('not_recorded') === 1 ? 'figure is' : 'figures are'} not recorded, so ${n('not_recorded') === 1 ? 'it was' : 'they were'} left out.`,
    n('unnamed') && `${n('unnamed')} ${n('unnamed') === 1 ? 'partner is' : 'partners are'} named by type only.`,
  ].filter(Boolean);
}
