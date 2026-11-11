/**
 * D4838 (#4838, part 1) — what the Pipeline root says, worked out from what the zones already read.
 *
 * Pure functions over the Worker's own payloads (`GET /partner/pipeline/{leads,proposals,negotiations,retainers}`,
 * `GET /quotes/analytics`, `GET /partner/offers/fit-rules`, `GET /services/offerings?mine=1`), so the command
 * centre and its tests agree on one rule each. Nothing here reads a clock, invents a figure or fills a gap:
 *
 *   · A source is `{ state: 'ok', data }` or `{ state: 'unreadable' }`. An unreadable source is never a zero.
 *   · An outcome metric prints a value only over a population that exists. No decided quote is "No decided
 *     quotes", never "0%" or "$0 won"; a real zero over a real population still prints as zero.
 *   · Attention and risks are facts from recorded fields (ball, days since a move, days since a quote was sent,
 *     utilisation, days to renewal, fit score). Nothing records whether a client opened a proposal, so nothing
 *     here says "unopened"; it says no reply is recorded.
 *   · Recent movement has no store: nothing joins lead, proposal, negotiation and retainer events into one feed.
 */
import { usd, usdCents } from '../../../workspaces/boards/format.js';

/** A fit score at or above this is a strong fit — the Worker's own line (`strong_fit_count`). */
export const STRONG_FIT = 80;
/** A quote with no recorded reply after this many days asks for a follow-up. */
export const NO_REPLY_DAYS = 7;
/** A negotiation unmoved this long is stalled — the Worker's `stalled_count` uses the same 7. */
export const STALLED_DAYS = 7;
/** A renewal inside this many days is called out. */
export const RENEWAL_WINDOW_DAYS = 30;
/** Below this share of retained hours a retainer reads as low use. */
export const LOW_USE_PCT = 50;
/** How many attention cards the root shows before "N more". */
export const ATTENTION_SHOWN = 6;

export const ok = (data) => ({ state: 'ok', data: data || {} });
export const unreadable = () => ({ state: 'unreadable', data: null });
const read = (src) => (src && src.state === 'ok' ? src.data : null);
const list = (src) => {
  const d = read(src);
  return Array.isArray(d?.items) ? d.items : [];
};
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where each setup step is done — the real editors, never a new one. */
export const SETUP_LINKS = {
  services: '/offers/catalog',
  rules: '/offers/audience-fit',
  leads: '/pipeline/leads',
  proposals: '/pipeline/proposals',
  demand: '/partner/insights',
};

/** Active rows on a read that lists them. */
const activeCount = (src) => list(src).filter((r) => r && (r.is_active === true || r.is_active === 1)).length;

/** Every quote this firm has ever sent, decided or not; null when the read failed. */
export function quotesEverSent(proposals) {
  const d = read(proposals);
  if (!d) return null;
  const counted = [d.live_count, d.decided_count, d.withdrawn_count].map(num);
  if (counted.every((n) => n !== null)) return counted.reduce((a, b) => a + b, 0);
  return list(proposals).length;
}

/**
 * The five setup steps (PP01). `done` is true, false, or null where the record cannot say.
 *
 * SERVICES ARE FIRM-WIDE, THE CATALOGUE READ IS NOT. `?mine=1` lists the caller's own offerings, while lead
 * scoring reads every member's. So "done" comes from either side: the caller's catalogue has an active offering, or
 * the leads read scores against something while the firm has no active fit rule (so what it scores against is an
 * offering). "Not done" is said only when the leads read reports nothing to score against at all. Anything in
 * between — rules exist, the caller's own catalogue is empty — is null: a colleague may hold the catalogue.
 */
export function setupSteps({ leads, fitRules, services, proposals }) {
  const l = read(leads);
  const rulesOn = fitRules?.state === 'ok' ? activeCount(fitRules) : null;
  const scoring = l?.scoring ?? null;
  let servicesDone = null;
  if (services?.state === 'ok' && activeCount(services) > 0) servicesDone = true;
  else if (scoring === 'none') servicesDone = false;
  else if (scoring === 'fit_rules' && rulesOn === 0) servicesDone = true;
  const sent = quotesEverSent(proposals);
  const passed = num(l?.passed_count);
  return [
    { key: 'profile', label: 'Company profile exists', done: leads?.state === 'ok' ? true : null },
    { key: 'services', label: 'Add services', done: servicesDone, to: SETUP_LINKS.services },
    { key: 'rules', label: 'Set fit rules', done: rulesOn === null ? null : rulesOn > 0, to: SETUP_LINKS.rules },
    {
      key: 'leads', label: 'Review matching leads', to: SETUP_LINKS.leads,
      done: (passed !== null && passed > 0) || (sent !== null && sent > 0) ? true : (l ? false : null),
    },
    { key: 'proposal', label: 'Draft the first proposal', to: SETUP_LINKS.proposals, done: sent === null ? null : sent > 0 },
  ];
}

/**
 * First run (PP01): the firm has nothing to score leads against AND nothing has ever moved through the lifecycle.
 * Every source it rests on must have been read: an unreadable one is not evidence of an empty pipeline, so the
 * populated view draws instead, with that source marked Unreadable.
 */
export function isFirstRun({ leads, proposals, negotiations, retainers }) {
  if ([leads, proposals, negotiations, retainers].some((s) => s?.state !== 'ok')) return false;
  if (read(leads).scoring !== 'none') return false;
  if (quotesEverSent(proposals) !== 0) return false;
  const tracked = num(read(negotiations).tracked_count) ?? list(negotiations).filter((n) => n.negotiation).length;
  const retained = num(read(retainers).retainer_count) ?? list(retainers).filter((r) => r.retainer).length;
  return tracked === 0 && retained === 0;
}

/**
 * One headline metric: `{ label, state: 'value' | 'none' | 'unreadable', value, basis, how }`.
 * `none` carries the words for the missing population in `value` ("No decided quotes"), never a zero.
 */
const metric = (label, state, value, basis, how) => ({ label, state, value, basis, how });

export function openPipelineMetric(proposals) {
  const label = 'Open pipeline';
  const d = read(proposals);
  if (!d) return metric(label, 'unreadable', null, null, null);
  const n = num(d.live_count);
  const how = 'The price on every quote still waiting for a decision, including the ones in negotiation. It is what is in play, not revenue.';
  if (!n) return metric(label, 'none', 'No open quotes', 'nothing is waiting for a decision', how);
  return metric(label, 'value', usd(num(d.live_value_dollars) ?? 0), `${plural(n, 'open quote')} · not revenue`, how);
}

export function weightedMetric(analytics) {
  const label = 'Weighted pipeline';
  const d = read(analytics);
  if (!d) return metric(label, 'unreadable', null, null, null);
  const f = d.forecast;
  const open = Array.isArray(f?.by_stage) ? f.by_stage.reduce((a, s) => a + (num(s?.count) || 0), 0) : 0;
  const how = f?.note || d.forecast_scope_note || null;
  if (!f || !open) return metric(label, 'none', 'Nothing open to forecast', 'no undecided quote', how);
  return metric(label, 'value', usd(num(f.weighted_value) ?? 0), `value × stage weight · ${plural(open, 'open quote')}`, how);
}

export function winRateMetric(proposals) {
  const label = 'Win rate';
  const d = read(proposals);
  if (!d) return metric(label, 'unreadable', null, null, null);
  const decided = num(d.decided_count);
  const how = d.win_rate_basis || null;
  if (!decided || d.win_rate_pct === null || d.win_rate_pct === undefined) {
    return metric(label, 'none', 'No decided quotes', 'nothing won or lost yet', how);
  }
  return metric(label, 'value', `${Math.round(Number(d.win_rate_pct))}%`, `${num(d.won_count) ?? 0} of ${decided} decided`, how);
}

export function cycleMetric(analytics) {
  const label = 'Median sales cycle';
  const d = read(analytics);
  if (!d) return metric(label, 'unreadable', null, null, null);
  const p = d.pipeline || {};
  const decided = (num(p.accepted) || 0) + (num(p.rejected) || 0);
  const how = 'Days from a quote being sent to its decision, the middle value over decided quotes that carry both dates.';
  if (!decided) return metric(label, 'none', 'No decided quotes', 'no cycle has finished', how);
  if (p.median_cycle_days === null || p.median_cycle_days === undefined) {
    return metric(label, 'none', 'Not recorded', 'no decided quote carries both dates', how);
  }
  return metric(label, 'value', `${p.median_cycle_days} days`, `quote to decision · ${decided} decided`, how);
}

export function headlineMetrics({ proposals, analytics }) {
  return [openPipelineMetric(proposals), weightedMetric(analytics), winRateMetric(proposals), cycleMetric(analytics)];
}

/** Quote ids whose negotiation is open — a quote in terms is not "no reply". */
function openNegotiationQuotes(negotiations) {
  return new Set(list(negotiations).filter((n) => n?.negotiation?.open).map((n) => Number(n.quote_id)));
}

/**
 * Needs attention (PP02): what asks this firm to act, each a fact on a recorded field, most urgent first.
 * `{ key, who, issue, detail, action, to, rank }`.
 */
export function attentionItems({ leads, proposals, negotiations, retainers }) {
  const out = [];
  for (const n of list(negotiations)) {
    const g = n?.negotiation;
    if (!g?.open || g.ball !== 'us') continue;
    const days = num(g.days_stalled);
    out.push({
      key: `neg-${n.quote_id}`, rank: 0, sort: -(days ?? 0),
      who: n.founder_name || n.need_title || 'Unnamed client',
      issue: 'Negotiation waiting on us',
      detail: [g.open_question, days === null ? null : `${plural(days, 'day')} since it moved`].filter(Boolean).join(' · '),
      action: 'Open terms', to: '/pipeline/negotiations',
    });
  }
  for (const r of list(retainers)) {
    const t = r?.retainer;
    if (!t?.active) continue;
    const who = r.founder_name || r.need_title || 'Unnamed client';
    const pct = num(r.utilisation_pct);
    if (pct !== null && pct > 100) {
      out.push({
        key: `over-${r.engagement_id}`, rank: 1, sort: -pct, who,
        issue: `Retainer at ${Math.round(pct)}% of retained hours`, detail: 'over scope this period',
        action: 'Review scope', to: '/pipeline/retainers',
      });
    }
    const due = num(t.days_to_renewal);
    if (due !== null && due >= 0 && due <= RENEWAL_WINDOW_DAYS) {
      const monthly = usdCents(num(t.current_monthly_cents));
      out.push({
        key: `renew-${r.engagement_id}`, rank: 2, sort: due, who,
        issue: due === 0 ? 'Retainer renews today' : `Retainer renewing in ${plural(due, 'day')}`,
        detail: monthly ? `${monthly} / month equivalent` : 'no amount recorded',
        action: 'Prepare renewal', to: '/pipeline/retainers',
      });
    }
  }
  const inTerms = openNegotiationQuotes(negotiations);
  for (const q of list(proposals)) {
    if (q?.status !== 'submitted' || inTerms.has(Number(q.quote_id))) continue;
    const days = num(q.days_since_sent);
    if (days === null || days < NO_REPLY_DAYS) continue;
    out.push({
      key: `quote-${q.quote_id}`, rank: 3, sort: -days,
      who: q.client || q.need_title || 'Unnamed client',
      issue: 'No reply recorded',
      detail: [`Sent ${plural(days, 'day')} ago`, usd(num(q.price_dollars))].filter(Boolean).join(' · '),
      action: 'Follow up', to: '/pipeline/proposals',
    });
  }
  for (const r of list(retainers)) {
    const pct = num(r?.utilisation_pct);
    if (!r?.retainer?.active || pct === null || pct >= LOW_USE_PCT) continue;
    out.push({
      key: `low-${r.engagement_id}`, rank: 4, sort: pct,
      who: r.founder_name || r.need_title || 'Unnamed client',
      issue: `Using ${Math.round(pct)}% of retained hours`, detail: 'low use this period',
      action: 'Check in', to: '/pipeline/retainers',
    });
  }
  for (const l of list(leads)) {
    const s = num(l?.score);
    if (l?.excluded_by || s === null || s < STRONG_FIT) continue;
    const days = num(l.days_old);
    out.push({
      key: `lead-${l.need_id}`, rank: 5, sort: -s,
      who: l.who || l.title || 'Unnamed lead',
      issue: 'Strong-fit lead, no proposal yet',
      detail: [`Fit ${s}`, days === null ? null : `arrived ${plural(days, 'day')} ago`].filter(Boolean).join(' · '),
      action: 'Review lead', to: '/pipeline/leads',
    });
  }
  return out.sort((a, b) => a.rank - b.rank || a.sort - b.sort);
}

/** Risks (PP02): renewal, scope overrun, a stalled proposal or negotiation. Compact, one line each. */
export function riskItems({ proposals, negotiations, retainers }) {
  const out = [];
  for (const r of list(retainers)) {
    const t = r?.retainer;
    if (!t?.active) continue;
    const who = r.founder_name || r.need_title || 'Unnamed client';
    const due = num(t.days_to_renewal);
    if (due !== null && due >= 0 && due <= RENEWAL_WINDOW_DAYS) out.push({ key: `r-renew-${r.engagement_id}`, who, text: `Renews in ${plural(due, 'day')}`, tag: 'Renewing' });
    const pct = num(r.utilisation_pct);
    if (pct !== null && pct > 100) out.push({ key: `r-over-${r.engagement_id}`, who, text: `Scope overrun · ${Math.round(pct)}%`, tag: 'Over scope' });
  }
  const inTerms = openNegotiationQuotes(negotiations);
  for (const q of list(proposals)) {
    const days = num(q?.days_since_sent);
    if (q?.status !== 'submitted' || inTerms.has(Number(q.quote_id)) || days === null || days < NO_REPLY_DAYS) continue;
    out.push({ key: `r-quote-${q.quote_id}`, who: q.client || q.need_title || 'Unnamed client', text: `Proposal stalled · ${plural(days, 'day')}`, tag: 'Stalled' });
  }
  for (const n of list(negotiations)) {
    const days = num(n?.negotiation?.days_stalled);
    if (!n?.negotiation?.open || days === null || days < STALLED_DAYS) continue;
    out.push({ key: `r-neg-${n.quote_id}`, who: n.founder_name || n.need_title || 'Unnamed client', text: `Negotiation stalled · ${plural(days, 'day')}`, tag: 'Stalled' });
  }
  return out;
}

/**
 * The lifecycle strip (PP02): one cell per zone, `{ key, label, to, state, count, sub }`. A count of zero is a real
 * count of records; money beside it is printed only when there is something to sum.
 */
export function lifecycleStrip({ leads, proposals, negotiations, retainers }) {
  const cell = (key, label, src, count, sub) => (
    src?.state === 'ok'
      ? { key, label, to: `/pipeline/${key}`, state: 'ok', count, sub }
      : { key, label, to: `/pipeline/${key}`, state: 'unreadable', count: null, sub: null }
  );
  const l = read(leads) || {};
  const p = read(proposals) || {};
  const g = read(negotiations) || {};
  const r = read(retainers) || {};
  const strong = num(l.strong_fit_count);
  const pOpen = num(p.live_count) ?? 0;
  const gOpen = num(g.open_count) ?? 0;
  const usAwait = num(g.awaiting_us_count) ?? 0;
  const mrr = usdCents(num(r.mrr_cents));
  return [
    cell('leads', 'Leads', leads, num(l.open_count) ?? list(leads).length,
      strong === null ? 'not scored · no fit rule or service' : `${strong} strong fit`),
    cell('proposals', 'Proposals', proposals, pOpen, pOpen ? `${usd(num(p.live_value_dollars) ?? 0)} open` : 'none open'),
    cell('negotiations', 'Negotiations', negotiations, gOpen,
      gOpen ? [usd(num(g.live_value_dollars) ?? 0), usAwait ? `${usAwait} waiting on us` : null].filter(Boolean).join(' · ') : 'none open'),
    cell('retainers', 'Retainers', retainers, num(r.active_count) ?? 0,
      mrr ? `${mrr} / month equivalent` : (num(r.active_count) ? 'no amount recorded' : 'none active')),
  ];
}

/**
 * The Eadwyn rail's steps for this page (`ui/RailSteps.jsx`), in place of the model list: setup on first run,
 * the most urgent attention items when populated. Links to where the work is; nothing acts.
 */
export function railSteps({ loading, failed, firstRun, steps, attention }) {
  const title = 'For Pipeline';
  if (loading) return { title, state: 'loading' };
  if (failed) return { title, state: 'unavailable', text: 'Pipeline could not be read, so there is nothing to point at yet.' };
  if (firstRun) {
    const open = (steps || []).filter((s) => s.to && s.done === false);
    if (!open.length) return { title, state: 'empty', text: 'Setup is done.' };
    return {
      title, state: 'ready',
      items: open.slice(0, 3).map((s) => ({ key: s.key, tone: 'act', text: s.label, to: s.to, action: 'Open' })),
      foot: 'Nothing in Pipeline is sent or changed without your click.',
    };
  }
  if (!attention?.length) return { title, state: 'empty', text: 'Nothing in Pipeline needs action right now.' };
  return {
    title, state: 'ready',
    items: attention.slice(0, 4).map((a) => ({ key: a.key, tone: 'act', text: `${a.who} · ${a.issue}`, to: a.to, action: a.action })),
    foot: 'Nothing in Pipeline is sent or changed without your click.',
  };
}
