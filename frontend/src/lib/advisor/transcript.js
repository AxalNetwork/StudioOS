/**
 * D9288 (#9288) — what Eadwyn's transcript says about its own history.
 *
 * Two rules, both pure so a Node test can hold them without importing
 * `PersonalAdvisor.jsx` (which reaches `router.js`):
 *
 * UNREADABLE IS NOT EMPTY. A history read that failed is not a conversation
 * with nothing in it. `openingState` decides what the panel opens on: the
 * unreadable notice (with Retry), the orientation for a history that was read
 * and is empty, or the history itself. The question widget's two reads go
 * through `queueReadState`: if either failed, its buckets are not drawn,
 * because every bucket is computed from both and would be wrong or stale.
 *
 * ONE TOOL-MESSAGE MODEL. The Worker records a tool turn as
 * `JSON.stringify({ result, cta })` on a `role: 'tool'` row (`advisor.ts`,
 * `/tool` and `/tool/auto`), or `refused:<reason>` when the gate refused it.
 * A live turn is built with `toolEnvelopeText` into the same string, and every
 * surface reads a row through `readToolMessage`, so a receipt draws the same
 * live, after a reload and in the phone's transcript sheet.
 */

export const HISTORY_UNREADABLE = "Couldn't load your earlier conversation.";
export const QUEUE_UNREADABLE = "Couldn't load your questions.";
export const RETRY_LABEL = 'Retry';
export const TOOL_UNREADABLE = "This action's result could not be read.";
export const TOOL_REFUSED = 'That action was not run.';

/** The transcript row a failed history read leaves in place of the history. */
export function historyUnreadableNotice(onRetry) {
  return { role: 'notice', kind: 'history_unreadable', content: HISTORY_UNREADABLE, onRetry: onRetry || null };
}

export const isHistoryUnreadable = (m) => Boolean(m) && m.kind === 'history_unreadable';

/**
 * What the panel opens on once `/start` answered.
 *   'unreadable' — the history read failed: say so, never orient.
 *   'orient'     — the history was read and holds nothing.
 *   'history'    — the history was read and has turns.
 */
export function openingState({ historyReadable, hydrated }) {
  if (historyReadable === false) return 'unreadable';
  return Number(hydrated) === 0 ? 'orient' : 'history';
}

/**
 * The question widget's two settled reads (`Promise.allSettled` of
 * `/advisor/queue` and `/advisor/answered`). `readable` is false when either
 * failed or answered a shape that is not the one asked for.
 */
export function queueReadState(q, a) {
  const queueOk = q?.status === 'fulfilled' && Boolean(q.value) && typeof q.value === 'object';
  const answeredOk = a?.status === 'fulfilled' && Array.isArray(a.value?.answered);
  if (!queueOk || !answeredOk) return { readable: false, queue: null, answered: null };
  const v = q.value;
  return {
    readable: true,
    queue: {
      next_question: v.next_question || null,
      queue: Array.isArray(v.queue) ? v.queue : [],
      paywall_ctas: Array.isArray(v.paywall_ctas) ? v.paywall_ctas : [],
      complete: !!v.complete,
    },
    answered: a.value.answered,
  };
}

/** The stored form of a tool turn, built from a `/tool/auto` response. */
export const toolEnvelopeText = (r) => JSON.stringify({ result: r?.result, cta: r?.cta });

/**
 * One `role: 'tool'` row, live or reloaded, as `{ result, cta, refused,
 * unreadable }`; null for a row that is not a tool turn. A row that cannot be
 * parsed, or carries neither a result nor a CTA (the Worker caps the stored
 * envelope at 4000 characters, so an oversized one is cut mid-JSON), is
 * `unreadable` and says so rather than showing raw JSON.
 */
export function readToolMessage(m) {
  if (!m || m.role !== 'tool') return null;
  const text = typeof m.content === 'string' ? m.content.trim() : '';
  if (text.startsWith('refused:')) return { result: null, cta: null, refused: text.slice(8) || 'refused', unreadable: false };
  let parsed = null;
  try { parsed = text.startsWith('{') ? JSON.parse(text) : null; } catch { parsed = null; }
  const result = parsed && parsed.result && typeof parsed.result === 'object' ? parsed.result : null;
  const cta = parsed?.cta && parsed.cta.primary ? parsed.cta : null;
  return { result, cta, refused: null, unreadable: !result && !cta };
}

const LIST_KEYS = ['advisors', 'investors', 'partners', 'deals', 'tasks'];

/** The result's shape, as both previews draw it. */
export function toolPreviewModel(view) {
  if (!view) return null;
  if (view.unreadable) return { kind: 'unreadable' };
  if (view.refused) return { kind: 'refused', reason: view.refused };
  const r = view.result;
  if (r && typeof r === 'object') {
    const key = LIST_KEYS.find((k) => Array.isArray(r[k]));
    if (key) {
      return {
        kind: 'list',
        total: r[key].length,
        rows: r[key].slice(0, 5).map((row, i) => ({
          id: row?.id ?? i, title: row?.title || row?.name || '', snippet: row?.snippet || null,
        })),
      };
    }
    if (r.page) return { kind: 'page', page: r.page };
    if (r.gated) return { kind: 'gated', feature: r.feature, tier: r.required_tier };
  }
  return null;
}

/** The one-line receipt the phone's transcript sheet shows. */
export function toolReceiptText(view) {
  const p = toolPreviewModel(view);
  if (p?.kind === 'unreadable') return TOOL_UNREADABLE;
  if (p?.kind === 'refused') return TOOL_REFUSED;
  if (p?.kind === 'list') {
    if (p.total === 0) return 'No matches yet.';
    const names = p.rows.slice(0, 3).map((row) => row.title).filter(Boolean);
    if (!names.length) return `Found ${p.total}.`;
    const more = p.total - names.length;
    return `Found ${p.total}: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`;
  }
  if (p?.kind === 'page') return `Opening ${p.page}.`;
  if (p?.kind === 'gated') return `${p.feature} requires the ${p.tier} tier.`;
  return view?.cta?.primary?.label || null;
}
