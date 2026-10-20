/**
 * D642 (#1435) — the Usage section's arithmetic and words, kept apart from the
 * cards so each rule is tested on its own.
 *
 * THE RULES (#1430's prompt, which wins over the canvas where they differ):
 *   - amounts are US dollars; below one cent, up to four decimals ($0.0042);
 *   - a token count is short (1.2M, 340k) with the exact figure kept for a
 *     hover;
 *   - a figure the Worker did not record is `null` here and is drawn as
 *     "Not recorded" or "Not counted" with its reason, never as 0;
 *   - nothing is split by company: every read is the caller's own, across all
 *     their companies, and nothing below takes a company.
 */
import { aiTokenState, purchaseState } from '../../lib/aiTokens';
import { dayCapped, noPlan } from '../../lib/planAllowance';

export const NOT_COUNTED = 'Not counted';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** A USD amount. Below one cent, up to four decimals; below $0.0001, said as such. */
export function usd(n) {
  if (!isNum(n)) return null;
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a === 0) return '$0.00';
  if (a < 0.0001) return `${sign}< $0.0001`;
  if (a < 0.01) {
    const s = a.toFixed(4).replace(/0+$/, '');
    return `${sign}$${s.length - s.indexOf('.') - 1 < 2 ? a.toFixed(2) : s}`;
  }
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A micro-USD integer (the budget store's unit) as dollars. */
export function microUsd(n) {
  return isCount(n) ? usd(n / 1_000_000) : null;
}

/** A token count, short: 812, 340k, 1.2M. */
export function shortTokens(n) {
  if (!isCount(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim1(n / 1000)}k`;
  return `${trim1(n / 1_000_000)}M`;
}
const trim1 = (x) => (x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ''));

/** A byte count, in the largest unit that keeps it at or above 1. */
export function bytes(n) {
  if (!isCount(n)) return null;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${trim1(v)} ${units[i]}`;
}

/** How long until the next 00:00 UTC, as "in 5 h 12 min". */
export function untilUtcMidnight(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(0, Math.ceil((next - now.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `in ${h} h ${m} min` : `in ${m} min`;
}

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** `founder:growth` → "Founder · Growth"; `advisor` → "Advisor". */
export function planLabel(licence) {
  if (typeof licence !== 'string' || !licence) return null;
  return licence.split(':').map(cap).join(' · ');
}

/** A recorded page path → "Validate › Interviews". `null` is a run with no page. */
export function surfaceLabel(surface) {
  if (surface == null) return null;
  const parts = String(surface).split('/').filter(Boolean).filter((p) => !p.startsWith(':'));
  if (!parts.length) return 'Home';
  return parts.map((p) => cap(p.replace(/[-_]+/g, ' '))).join(' › ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-08` → "8 Oct". */
export function dayLabel(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null;
}

/** The run log's `YYYY-MM-DD HH:MM:SS` (UTC) → "8 Oct, 14:02 UTC". */
export function whenLabel(at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(at || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}, ${m[4]}:${m[5]} UTC` : null;
}

const BUDGET_KEYS = ['daily_microusd', 'monthly_microusd', 'day_spend_microusd', 'month_spend_microusd',
  'balance_microusd', 'day_reserved_microusd', 'month_reserved_microusd', 'topup_reserved_microusd'];

/** Whether `/ai-budget/me` answered with every figure the card draws. */
export function budgetReadable(b) {
  return !!b && typeof b.licence === 'string' && BUDGET_KEYS.every((k) => isCount(b[k]))
    && Array.isArray(b.held_for_review);
}

const pct = (used, of) => (of > 0 ? Math.min(100, Math.round((used / of) * 100)) : 0);

/**
 * U1 — the allowance card from `/ai-budget/me`. `null` when the read is not
 * whole, so the card says Unreadable rather than drawing part of it.
 *
 * Spend and holds are reported apart (D629): a run in progress has reserved
 * its share and not yet spent it. A period is "used up" when spend and holds
 * together reach its allowance, because that is when the next run is refused.
 */
export function allowanceView(b, now = new Date()) {
  if (!budgetReadable(b)) return null;
  const resetIn = untilUtcMidnight(now);
  // D783: a member has no daily limit (`daily_capped: false`), so there is no Today period.
  const noDaily = !dayCapped(b) || b.daily_microusd === 0;
  const noMonthly = b.monthly_microusd === 0;
  const dayTaken = b.day_spend_microusd + b.day_reserved_microusd;
  const monthTaken = b.month_spend_microusd + b.month_reserved_microusd;
  const states = [];
  if (b.held_for_review.length > 0) states.push('paused');
  if (noDaily && noMonthly) states.push('no_allowance');
  else {
    if (!noMonthly && monthTaken >= b.monthly_microusd) states.push('month_used_up');
    else if (!noDaily && dayTaken >= b.daily_microusd) states.push('day_used_up');
  }
  return {
    plan: planLabel(b.licence),
    noAllowance: noDaily && noMonthly,
    noPlan: noPlan(b),
    dayCapped: dayCapped(b),
    today: noDaily ? null : {
      used: microUsd(b.day_spend_microusd), of: microUsd(b.daily_microusd),
      pct: pct(dayTaken, b.daily_microusd), reset: `Resets at 00:00 UTC · ${resetIn}`,
    },
    month: noMonthly ? null : {
      used: microUsd(b.month_spend_microusd), of: microUsd(b.monthly_microusd),
      pct: pct(monthTaken, b.monthly_microusd), reset: 'Resets on the 1st at 00:00 UTC',
    },
    held: microUsd(b.month_reserved_microusd + b.topup_reserved_microusd),
    balance: microUsd(b.balance_microusd),
    resetIn,
    states,
    heldForReview: b.held_for_review.length,
  };
}

/**
 * The top-up purchase option in this page's words: `available`, `unavailable`
 * (nothing is on sale, which a retry cannot change) or `unreadable`. The
 * decision is `aiTokenState`'s (lib/aiTokens.js, D755 #1916).
 */
export function topUpState(p) {
  const state = aiTokenState({ data: p });
  return state === 'ready' ? 'available' : state === 'not_ready' ? 'unavailable' : 'unreadable';
}

/** Model id → its display name and rates, from `/ai/rates`. */
export function rateIndex(rates) {
  const list = Array.isArray(rates?.models) ? rates.models : [];
  return new Map(list.filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]));
}

/** U4's rate rows. Token models per million in and out; transcription per audio minute. */
export function rateRows(rates) {
  const list = Array.isArray(rates?.models) ? rates.models : null;
  if (!list) return null;
  return list.filter((m) => m && typeof m.id === 'string').map((m) => {
    // D766: an image model has no single rate; it is priced by size and steps.
    if (m.image === true) return { id: m.id, name: m.name || m.id, pin: null, pout: null, unit: 'per image, by its size and steps', retired: m.retired === true };
    const audio = isNum(m.per_audio_minute_usd);
    return {
      id: m.id,
      name: m.name || m.id,
      pin: usd(audio ? m.per_audio_minute_usd : m.in_per_1m_usd),
      pout: audio ? null : usd(m.out_per_1m_usd),
      unit: audio ? 'per audio minute' : 'per million tokens',
      retired: m.retired === true,
    };
  });
}

/**
 * U4's model rows from `by_model`. A direction's tokens are the counted sum;
 * when every run of a model went uncounted there is no sum to show, and the
 * cell says "Not counted" instead of 0.
 */
export function modelRows(byModel, rates) {
  if (!Array.isArray(byModel)) return null;
  const index = rateIndex(rates);
  return byModel.map((m) => {
    const counted = isCount(m.calls) && isCount(m.uncounted_calls) ? m.calls - m.uncounted_calls : 0;
    const tok = (n) => (counted > 0 && isCount(n) ? { short: shortTokens(n), exact: n.toLocaleString('en-US') } : null);
    return {
      id: m.model,
      name: index.get(m.model)?.name || m.model,
      runs: m.calls,
      tin: tok(m.prompt_tokens),
      tout: tok(m.completion_tokens),
      cost: usd(m.spend_usd),
      fallback: m.fallback_calls,
      cached: m.cached_calls,
      notCounted: m.uncounted_calls,
    };
  });
}

/**
 * U3's two tabs. By page keeps the "No page recorded" row (a run carrying
 * none) at the end, whatever it cost, and the search matches the label.
 */
export function pageRows(bySurface) {
  if (!Array.isArray(bySurface)) return null;
  const rows = bySurface.map((r) => ({
    key: r.surface == null ? '(none)' : String(r.surface),
    label: surfaceLabel(r.surface),
    noPage: r.surface == null,
    runs: r.calls,
    cost: usd(r.spend_usd),
  }));
  return [...rows.filter((r) => !r.noPage), ...rows.filter((r) => r.noPage)];
}

export function filterPages(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (r.noPage ? 'no page recorded' : `${r.label} ${r.key}`.toLowerCase()).includes(q));
}

export const PAGE_SIZE = 10;

export function pageOf(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), page: p, pages };
}

export function taskRows(byTask) {
  if (!Array.isArray(byTask)) return null;
  return byTask.map((t) => ({ key: t.task, label: t.label || t.task, runs: t.calls, cost: usd(t.spend_usd) }));
}

/**
 * U2's bars. A day with no runs is a real $0.00 and is drawn as a stub, not
 * left out. Heights are relative to the busiest day.
 */
export function dayBars(days) {
  if (!Array.isArray(days)) return null;
  const max = Math.max(0, ...days.map((d) => (isNum(d.spend_usd) ? d.spend_usd : 0)));
  return days.map((d, i) => {
    const none = !d.calls;
    const label = dayLabel(d.day);
    return {
      day: d.day,
      none,
      today: i === days.length - 1,
      height: none ? 2 : Math.max(4, max > 0 ? Math.round((d.spend_usd / max) * 100) : 4),
      tip: `${label} · ${d.calls} ${d.calls === 1 ? 'run' : 'runs'} · ${usd(d.spend_usd) ?? '$0.00'}`,
    };
  });
}

/** Five axis labels across the 30 days, first and last included. */
export function dayAxis(days) {
  if (!Array.isArray(days) || days.length === 0) return [];
  const n = days.length;
  const idx = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1];
  return [...new Set(idx)].map((i) => dayLabel(days[i].day));
}

/** Why a run's token count is missing, in one line. */
export function notCountedReason(run) {
  if (run.refusal) return 'A refusal ran no model, so it recorded no count.';
  if (run.cached) return 'A cached answer ran no model, so it recorded no count.';
  return 'A streamed reply or a transcription recorded no count.';
}

/** U5's receipt from `last_run`. */
export function receiptView(run, rates) {
  if (!run) return null;
  const index = rateIndex(rates);
  const model = index.get(run.model)?.name || run.model;
  const tok = (n) => (isCount(n) && n > 0 ? { v: n.toLocaleString('en-US') } : { v: NOT_COUNTED, nr: true, sub: notCountedReason(run) });
  const flags = [];
  if (run.fallback_used) flags.push({ t: 'Fallback', tone: 'warn' });
  flags.push(run.cached ? { t: 'Cached', tone: 'info' } : { t: 'Not cached', tone: 'neutral' });
  if (run.refusal) flags.push({ t: 'Refused', tone: 'danger' });
  return {
    flags,
    rows: [
      { k: 'When', v: whenLabel(run.at) ?? run.at },
      { k: 'Task', v: run.label || run.task },
      { k: 'Model', v: model, sub: model !== run.model ? run.model : '' },
      { k: 'Tokens in', ...tok(run.prompt_tokens) },
      { k: 'Tokens out', ...tok(run.completion_tokens) },
      { k: 'Cost', v: usd(run.cost_usd) },
    ],
  };
}

export const STORAGE_AREAS = [
  ['data_room', 'Data room'],
  ['diligence_files', 'Diligence files'],
  ['research_library', 'Research library'],
  ['message_attachments', 'Message attachments'],
  ['interview_recordings', 'Interview recordings'],
];

/**
 * U6 from `/usage/storage` (D642). An area the Worker could not read is
 * `unreadable`; an area holding files with no recorded size has no exact
 * total, so its size is "Not recorded" and the files without one are said.
 */
export function storageView(s) {
  if (!s || !Array.isArray(s.areas)) return null;
  const byKey = new Map(s.areas.map((a) => [a.key, a]));
  const places = STORAGE_AREAS.map(([key, label]) => {
    const a = byKey.get(key);
    if (!a || a.recorded !== true) return { key, label, unreadable: true };
    return {
      key, label, unreadable: false,
      files: a.files,
      size: a.bytes == null ? null : bytes(a.bytes),
      noSize: isCount(a.unknown_size_files) ? a.unknown_size_files : 0,
    };
  });
  const allRead = places.every((p) => !p.unreadable);
  return {
    places,
    total: s.total_bytes == null ? null : bytes(s.total_bytes),
    files: isCount(s.files) ? s.files : null,
    noSize: isCount(s.unknown_size_files) ? s.unknown_size_files : null,
    anyUnreadable: !allRead,
    empty: allRead && s.files === 0,
  };
}

/**
 * D755 §10 (#1984) — the Top-ups card's rows, from `/ai-budget/history`.
 * Newest first, as the Worker pages them; purchases paid but not yet credited
 * lead as "being added". Every amount is the Worker's signed micro-USD figure
 * for that row: nothing here sums a balance, and an adjustment's reason never
 * reaches the member (the Worker does not send it, and this never reads it).
 */
const LEDGER_LABEL = {
  purchase: (p) => p,
  bonus: (p) => `Bonus on ${p}`,
  refund: (p) => `Refund · ${p}`,
  dispute: (p) => `Disputed · ${p}`,
  dispute_won: (p) => `Dispute won · ${p}`,
  adjustment: () => 'Adjustment',
  hold: () => 'AI run · held',
  release: () => 'AI run · released',
  spend: () => 'AI run',
};
export const RUN_KINDS = Object.freeze(['hold', 'release', 'spend']);

/** A signed micro-USD figure: "+$20.00", "−$4.50". */
export function signedMicroUsd(n) {
  if (!Number.isSafeInteger(n)) return null;
  const abs = usd(Math.abs(n) / 1_000_000);
  return n < 0 ? `−${abs}` : `+${abs}`;
}

export function topUpRows(h) {
  if (!h || !Array.isArray(h.items)) return null;
  const pack = (r) => r?.pack_label || 'Token pack';
  const pending = (Array.isArray(h.pending) ? h.pending : []).map((p, i) => ({
    key: `pending-${p.order_ref || i}`,
    kind: 'pending',
    label: pack(p),
    amount: Number.isSafeInteger(p.amount_microusd) ? signedMicroUsd(p.amount_microusd) : null,
    note: 'being added',
    when: whenLabel(p.at),
    order: p.order_ref || null,
  }));
  const rows = h.items.filter((r) => LEDGER_LABEL[r?.kind]).map((r) => {
    const shortfall = r.kind === 'refund' && Number.isSafeInteger(r.shortfall_microusd) && r.shortfall_microusd > 0
      ? `${microUsd(r.shortfall_microusd)} of these tokens had already been used.` : null;
    return {
      key: r.uid,
      kind: r.kind,
      label: LEDGER_LABEL[r.kind](pack(r)),
      amount: signedMicroUsd(r.delta_microusd),
      note: shortfall,
      when: whenLabel(r.at),
      order: r.order_ref || null,
      run: RUN_KINDS.includes(r.kind),
    };
  });
  return [...pending, ...rows];
}

/**
 * D755 §10 (#1984, part 2) — the top-up tile's line for the member's latest
 * purchase in 24 hours (`/ai-budget/top-up`'s `latest`, #1971), in the state
 * `purchaseState` decides (lib/aiTokens.js, #1916). Null when there is none,
 * or for a dispute, which the Top-ups card lists. `help` asks for the Help
 * Center link. A figure the answer does not carry is left out, never guessed.
 */
export function purchaseLine(latest, now = Date.now()) {
  const state = purchaseState(latest, now);
  if (!state) return null;
  const order = latest.order_ref || 'your order';
  const amount = microUsd(latest.amount_microusd);
  const reversed = microUsd(latest.reversed_microusd);
  const when = whenLabel(latest.credited_at || latest.at);
  switch (state) {
    case 'waiting':
      return { state, text: `Adding ${amount ?? 'your tokens'} from order ${order}. It appears here once Stripe confirms the payment.` };
    case 'credited':
      return { state, text: `Added ${amount ?? 'your tokens'}${when ? ` on ${when}` : ''} · order ${order}.` };
    case 'overdue':
      return { state, help: true, text: `Payment for ${order} is recorded, but the tokens are not in your balance yet. If they are not here within an hour, contact support with the order number.` };
    case 'refunded':
      return { state, text: reversed ? `Order ${order} was refunded. ${reversed} was taken off your top-up balance.` : `Order ${order} was refunded. Your top-ups below show what was taken off your top-up balance.` };
    default:
      return null;
  }
}

/**
 * D776 (#2093) — "Where it went", charged: `GET /ai-budget/runs?group=option`
 * folded into pages, each with its options, what was charged and the
 * allowance and token split. A page or option a run did not record is
 * `noPage` / `noOption`, shown last as "Not recorded"; a charge the Worker
 * reads as null (rows before migration 493, runs held for a review) is null
 * here, never $0.00. A page links only when its key is an app path: D720's
 * page keys wait on its page map to become links. Null for anything that is
 * not the Worker's shape.
 */
export function chargedPages(read) {
  if (!read || !Array.isArray(read.rows)) return null;
  const pages = new Map();
  const add = (into, r) => {
    into.runs += isCount(r.runs) ? r.runs : 0;
    into.notRecorded += isCount(r.not_recorded) ? r.not_recorded : 0;
    if (isCount(r.charged_microusd)) into.chargedMicro = (into.chargedMicro ?? 0) + r.charged_microusd;
    into.allowanceMicro += isCount(r.allowance_microusd) ? r.allowance_microusd : 0;
    into.tokensMicro += isCount(r.tokens_microusd) ? r.tokens_microusd : 0;
  };
  const blank = () => ({ runs: 0, notRecorded: 0, chargedMicro: null, allowanceMicro: 0, tokensMicro: 0 });
  for (const r of read.rows) {
    if (!r || typeof r !== 'object') continue;
    const key = typeof r.page === 'string' && r.page ? r.page : null;
    const id = key ?? '(none)';
    if (!pages.has(id)) {
      const path = key && /^\/(?!\/)[A-Za-z0-9/_.-]*$/.test(key) ? key : null;
      pages.set(id, { key: id, noPage: key == null, label: key == null ? null : (path ? surfaceLabel(path) : key), href: path, options: [], ...blank() });
    }
    const page = pages.get(id);
    add(page, r);
    const opt = typeof r.option === 'string' && r.option ? r.option : null;
    const o = { key: opt ?? '(none)', label: opt, noOption: opt == null, ...blank() };
    add(o, r);
    page.options.push(o);
  }
  const view = (x) => ({
    ...x,
    charged: x.chargedMicro == null ? null : microUsd(x.chargedMicro),
    allowance: microUsd(x.allowanceMicro),
    tokens: microUsd(x.tokensMicro),
  });
  const byCharge = (a, b) => (b.chargedMicro ?? -1) - (a.chargedMicro ?? -1) || b.runs - a.runs;
  const all = [...pages.values()].map((p) => ({
    ...view(p),
    options: [...p.options.filter((o) => !o.noOption).sort(byCharge), ...p.options.filter((o) => o.noOption)].map(view),
  }));
  return {
    pages: [...all.filter((p) => !p.noPage).sort(byCharge), ...all.filter((p) => p.noPage)],
    truncated: read.truncated === true,
  };
}
