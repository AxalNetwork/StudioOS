import { ADD_TOKENS_PATH } from '../lib/aiTokens';
import { FOUNDER_ASK_CHIPS } from '../lib/railOptions/founder.js';
import { INVESTOR_ASK_CHIPS } from '../lib/railOptions/investor.js';
import { ADVISOR_ASK_CHIPS } from '../lib/railOptions/advisor.js';
import { PARTNER_ASK_CHIPS } from '../lib/railOptions/partner.js';

/**
 * D1443 (#3706, canvas AK) — the Ask panel's words and rules, as plain
 * functions, so the panel draws them and the tests read them without a DOM.
 *
 * WHAT THE CANVAS DRAWS (`design/incoming/Ask Panel Page.dc.html`):
 *   head      the Eadwyn mark, the page's name, "Eadwyn · <section>", ×
 *   chips     "Suggested for this page"
 *   log       the member's question, Eadwyn's answer, proposal cards with
 *             Accept, Edit and Discard
 *   composer  "Ask about <page>…", the cost line, Send, and "Nothing is
 *             written until you accept."
 *   states    nothing to propose, running (Stop), an error (Try again), out of
 *             AI tokens (Add tokens), AI paused, and a support session (no Ask)
 */

export const ASK_PLACEHOLDER = (page) => `Ask about ${page || 'this page'}…`;
export const ASK_FOOT = 'Nothing is written until you accept.';
export const ASK_SUGGESTED = 'Suggested for this page';
export const ASK_NOTHING = 'Eadwyn found nothing new to propose. Nothing was guessed.';
export const ASK_ERROR = 'Eadwyn’s answer could not be read.';
export const ASK_ERROR_LINE = 'Nothing was written. Any hold was released.';
export const ASK_TOKENS = 'The included AI allowance and top-up balance cannot cover this run.';
export const ASK_TOKENS_LINE = 'Everything on the page still works without Eadwyn.';
export const ASK_PAUSED = 'AI is paused for your account.';
export const ASK_PAUSED_LINE = 'Your pages and records still work. Send is off until it resumes.';
export const ASK_OFF = 'AI is off on this page.';
export const ASK_OFF_LINE = 'Turn it back on in the AIRail to ask Eadwyn here.';
export const ASK_RUNNING = 'Eadwyn is reading…';

/**
 * The cost line before Send (S1's question F, answered by the canvas: a hold,
 * an upper bound, never "~"). The hold comes from the Worker's quote, which is
 * D1442's `POST /api/eadwyn/conversations/:uid/quote`; until it answers, the
 * line says the hold is not shown, never "$0.00".
 */
export function costLine(holdMicroUsd) {
  const n = Number(holdMicroUsd);
  if (holdMicroUsd == null || !Number.isFinite(n) || n < 0) return 'The hold shows here before Send · you pay what it uses';
  return `Holds up to ${money(n)} · you pay what it uses`;
}

/** A run's charge against its hold; a charge that is not recorded says so. */
export function chargeLine(chargedMicroUsd, holdMicroUsd) {
  const c = Number(chargedMicroUsd);
  if (chargedMicroUsd == null || !Number.isFinite(c)) return 'Charge not recorded';
  if (c === 0) return 'Not charged';
  const h = Number(holdMicroUsd);
  return holdMicroUsd != null && Number.isFinite(h) && h > 0 ? `Charged ${money(c)} of ${money(h)} held` : `Charged ${money(c)}`;
}

function money(micro) {
  // Cents, or tenths of a cent when the charge has them (the canvas's "$0.021").
  const usd = micro / 1_000_000;
  const three = usd.toFixed(3);
  return `$${three.endsWith('0') ? usd.toFixed(2) : three}`;
}

/**
 * A refusal, by its code, as the panel's state. The words are the Worker's
 * (402 `budget_*`, `spend_limit`; 403 `ai_paused`, `assist_off`), never
 * "insufficient tokens".
 */
const TOKEN_CODES = new Set(['budget_user_day', 'budget_user_month', 'spend_limit', 'budget_review', 'insufficient_tokens', 'out_of_tokens']);
export function refusalState(err) {
  const code = String(err?.code ?? err?.data?.error ?? err?.data?.refusal ?? '');
  const status = Number(err?.status);
  if (TOKEN_CODES.has(code) || status === 402) return 'tok';
  if (code === 'ai_paused') return 'paused';
  if (code === 'assist_off') return 'off';
  if (code === 'support_session_refused') return 'support';
  return 'err';
}

/** What each state draws: its headline, its line, and its one action. */
export function stateBlock(state) {
  switch (state) {
    case 'tok': return { tone: 'amber', title: ASK_TOKENS, line: ASK_TOKENS_LINE, action: { label: 'Add tokens', href: ADD_TOKENS_PATH } };
    case 'paused': return { tone: 'muted', title: ASK_PAUSED, line: ASK_PAUSED_LINE, action: null };
    case 'off': return { tone: 'muted', title: ASK_OFF, line: ASK_OFF_LINE, action: null };
    case 'err': return { tone: 'red', title: ASK_ERROR, line: ASK_ERROR_LINE, action: { label: 'Try again', retry: true } };
    case 'none': return { tone: 'plain', title: ASK_NOTHING, line: null, action: null };
    default: return null;
  }
}

/** Send is off while AI is off, paused or out of tokens, while one runs, and with nothing typed. */
export function canSend({ text, state, busy }) {
  if (busy) return false;
  if (state === 'tok' || state === 'paused' || state === 'off' || state === 'support') return false;
  return typeof text === 'string' && text.trim().length > 0 && text.trim().length <= 2000;
}

/**
 * Who Ask serves (S1's question E, the canvas's AK10 to AK13): every licence
 * on a page with a rail page key. A support session and an Explorer never.
 */
const STAFF = new Set(['admin', 'super_admin', 'branch_admin']);
export function askServes({ page, supportSession, viewer, host }) {
  if (!page || typeof page !== 'string') return false;
  if (supportSession) return false;
  const v = String(viewer || '').toLowerCase();
  if (!v || v === 'exploring') return false;
  // The viewer's own licence's pages only (S1, #3706, 2026-11-01): an HQ admin
  // previewing a founder's or an investor's page is reading someone else's
  // record and gets no Ask. Staff ask on the staff consoles (AK11).
  const h = String(host || '').toLowerCase();
  if (!h) return true;
  if (STAFF.has(v)) return STAFF.has(h);
  return v === h;
}

/**
 * The run chips: options that run IN the panel, on `POST /api/ai/rail/run`,
 * and come back as proposal cards. Today two exist (D1420 `studio:layout`,
 * D1596 `sessions:block`); `studio:layout` lives in Studio's own chat (AK9),
 * which has no AIRail, so the panel runs `sessions:block` only. A new run
 * chip is added here with the page it runs on.
 */
const STUDIO_CHAT_ONLY = new Set(['studio:layout']);
export const RUN_CHIPS = Object.freeze(
  [...FOUNDER_ASK_CHIPS, ...INVESTOR_ASK_CHIPS, ...ADVISOR_ASK_CHIPS, ...PARTNER_ASK_CHIPS]
    .filter((c) => !STUDIO_CHAT_ONLY.has(c.key))
    .map((c) => c.key),
);

/**
 * The panel's chips, from the page's options as the rail reads them
 * (`GET /api/ai/rail?page=`, already read by `WorkerRail`). A run chip runs in
 * the panel. Every other option is pressed on the page itself (a draft band,
 * an upload, a form), so its chip puts the words in the composer as a typed
 * question: it never claims to run the page's control.
 */
export function panelChips(options) {
  if (!Array.isArray(options)) return [];
  const seen = new Set();
  const out = [];
  for (const o of options) {
    const key = typeof o?.key === 'string' ? o.key : null;
    const label = typeof o?.label === 'string' ? o.label.trim() : '';
    if (!key || !label || seen.has(key) || STUDIO_CHAT_ONLY.has(key)) continue;
    seen.add(key);
    out.push({ key, label, run: RUN_CHIPS.includes(key) });
  }
  return out.slice(0, 6);
}

/**
 * A proposal card's words, from one `ai_rail_proposals` row's payload. A row
 * whose payload names no title or value is drawn as "Not recorded", never as
 * an empty card.
 */
export function proposalCard(row) {
  const p = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const eyebrow = str(p.kind_label) || str(p.field_label) || str(p.title) || words(p.kind) || 'Proposal';
  const text = str(p.summary) || str(p.value) || str(p.text) || str(p.label) || dateRange(p) || 'Not recorded';
  const source = str(p.source) || str(p.why) || null;
  return { uid: String(row?.uid ?? ''), eyebrow, text, source, status: str(row?.status) || 'proposed' };
}

/** `free_afternoon` → "Free afternoon"; anything that is not a key gives nothing. */
function words(v) {
  const k = str(v);
  if (!k || !/^[a-z][a-z_]*$/.test(k)) return null;
  const t = k.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function dateRange(p) {
  const from = str(p.starts_at) || str(p.from);
  const to = str(p.ends_at) || str(p.until) || str(p.to);
  if (!from) return null;
  return to ? `${from} – ${to}` : from;
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "Accept all (n)" is offered for two or more open cards, and caps at 50 (`/api/fills/rows/accept`'s cap). */
export function acceptAllLabel(cards) {
  const open = (cards || []).filter((c) => c.status === 'proposed').length;
  if (open < 2) return null;
  return `Accept all (${Math.min(open, 50)})`;
}

/**
 * Where the panel sits, by the window's width (the canvas's AK12, S1's C=a):
 *   ≥ 1440  docked to the rail's left edge, and the content narrows
 *   1024–1439  docked, overlaying the content column only
 *   640–1023   over the content, under the header
 *   < 640      a bottom sheet, 92% of the screen
 */
export function askLayout(width) {
  const w = Number(width);
  if (!Number.isFinite(w)) return 'dock';
  if (w >= 1440) return 'dock';
  if (w >= 1024) return 'overlay';
  if (w >= 640) return 'over';
  return 'sheet';
}
