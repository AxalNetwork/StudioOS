/**
 * D902 (#2681) — Pitch deck studio part 8: the share dialog (PD18), the
 * investor's viewer (PD20, PD22) and Share & analytics per version (PD19),
 * kept pure so the tests read them without a browser.
 *
 * ONE LINK WRITER. The dialog writes through `POST /api/cycles/raise/deck-links`,
 * the Raise module's own writer, with the one body (`shareBody`). The editor's
 * Share and "New link" on Share & analytics both open it. The link is shown
 * once: only its hash is stored.
 *
 * WHAT A LINK INCLUDES is the owner's question 3, unanswered: answer A, as the
 * canvas draws it. Whatever the switches say, the Worker never sends a bank
 * balance, an account or a counterparty, an internal score, or a quote without
 * its consent recorded (`services/decks/shareInclude.ts`).
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { dayLabel } from './pitchStudioModel.js';

export const SHARE_TITLE = 'Share this deck';
export const SHARE_CTA = 'Create link';
export const NEW_LINK = 'New link';
export const TYPED = 'typed';
export const SHOWN_ONCE = 'The link is shown once. Withdraw it any time from Share & analytics.';
export const NDA_SWITCH = 'Require the NDA before the deck opens';
export const NEVER_SHARED = 'Never on a link: bank balances, accounts and counterparties, internal scores, and any quote without its consent recorded.';
export const NO_DECK = 'No deck yet. Build it before you share it.';
export const NO_LIMIT = 'No limit';
export const VIEW_LIMIT_MAX = 100;

export const EXPIRIES = [
  { id: 7, label: '7 days' },
  { id: 14, label: '14 days' },
  { id: 30, label: '30 days' },
  { id: null, label: 'Never' },
];
export const DEFAULT_EXPIRY = 14;

/** "What is included", in the canvas's words and order. */
export const INCLUDE_ROWS = [
  { key: 'figures', label: 'Figures with chips' },
  { key: 'sources', label: 'Sources appendix' },
  { key: 'notes', label: 'Speaker notes' },
  { key: 'bands', label: 'Scorecard and Product-market fit bands' },
];
export const DEFAULT_INCLUDE = Object.freeze({ figures: true, sources: true, notes: false, bands: false });

/** The canvas's defaults: 14 days, Download and Forwarding off, the NDA on. */
export const DEFAULT_SHARE = Object.freeze({
  investor: '', label: '', expires: DEFAULT_EXPIRY, viewLimit: '',
  allowDownload: false, allowForwarding: false, ndaRequired: true, include: DEFAULT_INCLUDE,
});

/** "Frozen at v4 as of 21 Oct": a link never follows a later save. */
export function frozenLine(version) {
  if (!version || version.version == null) return NOT_RECORDED;
  const day = version.created_at ? dayLabel(version.created_at) : null;
  return day ? `Frozen at v${version.version} as of ${day}` : `Frozen at v${version.version}`;
}

/** The view limit typed: '' is no limit; otherwise a whole number 1–100, or NaN when it is not one. */
export function viewLimitOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,3}$/.test(s)) return NaN;
  const n = Number(s);
  return n >= 1 && n <= VIEW_LIMIT_MAX ? n : NaN;
}

/** What stops the dialog's Create link, or null. */
export function shareProblem(state, deck) {
  if (!deck?.id) return NO_DECK;
  if (!state.investor) return 'Name the investor: one of your prospects, or type a name.';
  if (state.investor === TYPED && !String(state.label || '').trim()) return 'Type the investor\'s name.';
  if (Number.isNaN(viewLimitOf(state.viewLimit))) return `The view limit is a whole number from 1 to ${VIEW_LIMIT_MAX}, or empty for no limit.`;
  return null;
}

/** The one writer's body (`createDeckLink`). */
export function shareBody(state, deck) {
  const body = {
    deck_id: Number(deck.id),
    expires_days: state.expires == null ? null : Number(state.expires),
    view_limit: viewLimitOf(state.viewLimit),
    allow_download: Boolean(state.allowDownload),
    allow_forwarding: Boolean(state.allowForwarding),
    nda_required: Boolean(state.ndaRequired),
    include: { ...DEFAULT_INCLUDE, ...(state.include || {}) },
  };
  if (state.investor === TYPED) body.investor_label = String(state.label || '').trim();
  else body.prospect_id = Number(state.investor);
  return body;
}

/** The sentence under the form: what Create link writes, before it writes. */
export function whatShareDoes(state, deck, investorName) {
  if (!deck?.id) return NO_DECK;
  const who = investorName || 'this investor';
  const until = state.expires == null ? 'never expires' : `expires in ${state.expires} days`;
  const limit = viewLimitOf(state.viewLimit);
  const views = limit ? `opens ${limit === 1 ? 'once' : `${limit} times`}` : 'has no view limit';
  const nda = state.ndaRequired ? ' It asks for the NDA before any card shows.' : '';
  return `Creates one link to v${deck.version} for ${who}. It ${until} and ${views}.${nda} Every link is logged on the deck.`;
}

/** The link to copy, only for the path the writer returns. */
export function shareUrl(result, origin = globalThis.location?.origin ?? '') {
  const path = result?.share_path;
  return typeof path === 'string' && /^\/share\/deck\/[A-Za-z0-9._~-]+$/.test(path) ? `${origin}${path}` : null;
}

/** A refusal as one sentence: the Worker's own words when it sent any. */
export function shareFailure(error) {
  const said = error?.data?.detail || error?.data?.error || (typeof error?.message === 'string' && error.status ? error.message : '');
  return said ? `${said} No link was made.` : 'The link could not be made. Nothing was sent.';
}

// ---------------------------------------------------------------------------
// The viewer (PD20, PD22)
// ---------------------------------------------------------------------------

export const LINK_CLOSED = 'This link is no longer open.';
export const ACCEPT_AND_OPEN = 'Accept and open';
export const SIGN_IN_TO_ACCEPT = 'Sign in to accept';
export const NDA_GATE_TITLE = 'Accept the NDA to open this deck';
export const NDA_UNREADABLE = 'The NDA could not be read, so the deck stays closed. Try again in a moment.';

/** What the share read answered: the closed card, the NDA gate, or the deck. */
export function viewerState(deck, error) {
  if (error && (error.status === 410 || error.data?.code === 'link_closed')) return 'closed';
  if (deck?.gate === 'nda') return 'gate';
  return deck ? 'deck' : error ? 'failed' : 'loading';
}

/** PD22's card: the sentence, and who to ask. Nothing from the deck. */
export function closedCard(error) {
  const venture = typeof error?.data?.venture === 'string' && error.data.venture.trim() ? error.data.venture.trim() : null;
  return { title: LINK_CLOSED, line: venture ? `Ask ${venture} for a new one.` : 'Ask the venture for a new one.' };
}

/** The chip under a figure, from the field's recorded source. */
export function chipOf(field) {
  switch (field?.source) {
    case 'data': return 'From records';
    case 'auto': return 'Computed';
    case 'ai': return 'Drafted';
    case 'placeholder': return NOT_RECORDED;
    default: return null;
  }
}

/** The figures a shared version shows, card by card, each with its chip. */
export function figureChips(slides) {
  const out = [];
  (Array.isArray(slides) ? slides : []).forEach((s, i) => {
    for (const f of Array.isArray(s?.fields) ? s.fields : []) {
      if (f?.kind !== 'metric_grid' || !Array.isArray(f.value)) continue;
      for (const cell of f.value) {
        const value = String(cell?.value ?? '').trim();
        out.push({
          card: String(i + 1).padStart(2, '0'),
          label: String(cell?.label ?? '').trim() || String(f.label || '').trim() || 'Figure',
          value: value || NOT_RECORDED,
          chip: chipOf(f) || NOT_RECORDED,
        });
      }
    }
  });
  return out;
}

/** Under the viewer's header: the version it is frozen to, and the deal page slot (DEAL #2421). */
export function viewerNote(frozen) {
  if (!frozen?.version) return null;
  const day = frozen.as_of ? dayLabel(frozen.as_of) : null;
  return `Frozen at v${frozen.version}${day ? ` as of ${day}` : ''}. The deal page shows this same viewer.`;
}

// ---------------------------------------------------------------------------
// Share & analytics per version (PD19)
// ---------------------------------------------------------------------------

/** The Worker's PD19 block, or null when it is not there or could not be read. */
export const analyticsOf = (engagement) => (engagement?.analytics?.available ? engagement.analytics : null);

/**
 * Seconds per card on this version, and on the version before it to draw
 * dotted. A card nobody read on a version that was read is a measured 0; with
 * no version before, `previous` is null throughout.
 */
export function cardSeries(analytics) {
  if (!analytics?.cards) return null;
  const now = new Map((analytics.cards.seconds || []).map((r) => [Number(r.index), Number(r.seconds) || 0]));
  const before = analytics.previous ? new Map((analytics.previous.seconds || []).map((r) => [Number(r.index), Number(r.seconds) || 0])) : null;
  const last = Math.max(-1, ...now.keys(), ...(before ? before.keys() : []));
  const rows = [];
  for (let i = 0; i <= last; i++) {
    rows.push({ index: i, label: String(i + 1).padStart(2, '0'), seconds: now.get(i) ?? 0, previous: before ? before.get(i) ?? 0 : null });
  }
  return { version: analytics.cards.version, previousVersion: analytics.previous?.version ?? null, rows, max: Math.max(1, ...rows.map((r) => Math.max(r.seconds, r.previous ?? 0))) };
}

/**
 * The funnel over unique viewers: opened, accepted the NDA, reached the ask.
 * A count nobody can read is null, never 0; a version with no ask card says so.
 */
export function shareFunnel(stats, analytics) {
  const of = analytics?.viewers ?? stats?.viewers ?? null;
  const share = (n) => (n == null || !of ? 0 : Math.min(100, Math.round((n / of) * 100)));
  const ask = analytics?.reached_ask;
  const reached = ask?.recorded ? Number(ask.viewers) : null;
  return [
    { label: 'Opened', n: of, width: share(of) },
    { label: 'Accepted the NDA', n: stats?.ndaSigned ?? null, width: share(stats?.ndaSigned ?? null) },
    { label: 'Reached the ask', n: reached, width: share(reached), reason: ask && !ask.recorded ? ask.reason : null },
  ];
}

/** A link's settings, as one short line. */
export function settingsLine(share) {
  if (!share || share.allow_download == null) return NOT_RECORDED;
  const parts = [];
  parts.push(share.view_limit ? `${share.view_limit} ${share.view_limit === 1 ? 'view' : 'views'}` : 'No view limit');
  parts.push(share.allow_download ? 'Download on' : 'Download off');
  parts.push(share.allow_forwarding ? 'Forwarding on' : 'Forwarding off');
  return parts.join(' · ');
}

/** "NDA: 2 signed", "NDA: none yet", or "No NDA", per link. */
export function ndaCell(share) {
  if (!share || share.nda_required == null) return NOT_RECORDED;
  if (!share.nda_required) return 'No NDA';
  return share.nda_signed ? `${share.nda_signed} signed` : 'None signed yet';
}
