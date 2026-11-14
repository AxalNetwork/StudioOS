/**
 * D4817 part 9 (#5311, addendum PFA03–PFA05, PFA10) — "Ask for this report"
 * and "Waive this period" on a company's Reports, as pure rules. No React, so
 * `frontend/test/portfolio_report_ask_d4817.test.mjs` loads it alone.
 *
 * WHAT IS READ AND WRITTEN (the investor's own, scoped by the Worker,
 * `cloudflare-worker/src/routes/reporting.ts`):
 *   - `GET /api/reporting/companies/:uid`: the company's duties and periods,
 *     each period with the caller's own ask (`asked`, `asked_at`) and who
 *     waived it (`waived_at`, `waived_by_you`), and whether the caller may act
 *     (`can_act`, `act_refusal`);
 *   - `POST /api/reporting/periods/:uid/ask`: records one ask per period while
 *     it is late or missing, and tells the founder team. It answers with the
 *     stored audit row's time (`asked_at`), the period and the in-app notices
 *     stored (`told`);
 *   - `POST /api/reporting/periods/:uid/waive`: marks the period waived. It
 *     answers with the stored `waived_at` and `waived_by_you`. The waiver
 *     stores no reason, so none is asked for.
 *
 * NOTHING IS ASSUMED. A receipt reads only what the Worker's answer carries;
 * a field it lacks is "Not recorded" with its reason. A period reads as asked
 * or waived only from the company read, never from the press. Email delivery
 * is never confirmed here, and another investor's ask is never seen.
 */
import { NOT_RECORDED } from '../../lib/absence';
import { DOCUMENT_WORDS, KIND_WORDS, ROUTE_WORDS, dayOf, periodPill, periodWord } from '../investor/portfolioReportsModel';

export const ASK = 'ask';
export const WAIVE = 'waive';

/** A stored UTC stamp as "2 Nov 2026, 09:15 UTC"; a bare day as "2 Nov 2026"; null when unreadable. */
export function stampOf(raw) {
  const d = dayOf(raw);
  if (!d) return null;
  const t = /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/.exec(String(raw));
  return t ? `${d}, ${t[1]}:${t[2]} UTC` : d;
}

/** Whether the caller may ask or waive here, from the company read. A read without the field leaves the Worker to decide. */
export function accessOf(owedValue) {
  if (owedValue && owedValue.can_act === false) {
    return { can: false, why: (typeof owedValue.act_refusal === 'string' && owedValue.act_refusal.trim()) || 'This session cannot ask for a report or waive a period.' };
  }
  return { can: true, why: null };
}

const isOpen = (p) => p && p.state !== 'sent' && p.state !== 'waived';
const RANK = { missing: 0, late: 1, due: 2, upcoming: 3 };

/** The company's open periods, most pressing first: missing, late, due, upcoming; then the earliest due. */
export function openPeriodsOf(company) {
  return (Array.isArray(company?.periods) ? company.periods : []).filter(isOpen)
    .slice().sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || String(a.due_on).localeCompare(String(b.due_on)));
}

export const dutyOf = (company, period) => (company?.duties || []).find((d) => d.uid === period?.duty_uid) || null;

/** What each action may do to a period, as the Worker decides it: ask while late or missing and not yet asked; waive while not sent or waived. */
export function actionsOf(period, access) {
  if (!access?.can || !period) return { ask: false, waive: false };
  return { ask: (period.state === 'late' || period.state === 'missing') && !period.asked, waive: isOpen(period) };
}

/** The period's own record, after any act: who asked or waived it and when, read from the company read. */
export function recordOf(period) {
  if (!period) return null;
  if (period.state === 'waived') {
    const when = stampOf(period.waived_at);
    const by = period.waived_by_you === true ? ' by you' : period.waived_by_you === false ? ' by another account' : '';
    const unknownWho = by ? '' : ' · who waived it is not recorded';
    return { key: 'waived', text: `Waived${by}${when ? ` on ${when}` : ' · when is not recorded'}${unknownWho}` };
  }
  if (period.asked) {
    const when = stampOf(period.asked_at);
    return { key: 'asked', text: when ? `You asked on ${when}` : 'You asked · when is not recorded' };
  }
  return null;
}

/** The source document and clause a duty comes from. */
export function sourceOf(duty) {
  const src = duty?.source || {};
  const doc = DOCUMENT_WORDS[src.document] || src.document;
  if (!doc) return `${NOT_RECORDED} · the duty carries no source document`;
  return `${doc}${src.clause ? ` · ${src.clause}` : ''}${src.signed === false ? ' (from the closing’s template)' : ''}`;
}

/** What the duty requires and the period still lacks: nothing once sent or waived. */
export function missingOf(duty, period) {
  if (!period || period.state === 'sent') return 'Nothing · the report was received';
  if (period.state === 'waived') return 'Nothing · the period is waived';
  const kind = KIND_WORDS[duty?.kind] || 'Report';
  const figs = Array.isArray(duty?.required_figures) ? duty.required_figures.length : 0;
  const docs = Array.isArray(duty?.required_documents) ? duty.required_documents.length : 0;
  const parts = [kind];
  if (figs) parts.push(`${figs} required ${figs === 1 ? 'figure' : 'figures'}`);
  if (docs) parts.push(`${docs} required ${docs === 1 ? 'document' : 'documents'}`);
  return parts.join(' · ');
}

const rangeOf = (p) => {
  const a = dayOf(p?.start); const b = dayOf(p?.end);
  return a && b ? `${a} – ${b}` : null;
};

/** The obligation card's facts (PFA03, PFA10): company, period, due, received, status, missing, your last ask, source and route. */
export function obligationOf(company, period) {
  const duty = dutyOf(company, period);
  const route = duty?.holding?.route;
  const rec = recordOf(period);
  return {
    title: `${periodWord(period?.label)} reporting obligation`,
    pill: periodPill(period),
    facts: [
      ['Company', company?.name || NOT_RECORDED],
      ['Period', [periodWord(period?.label), rangeOf(period)].filter(Boolean).join(' · ')],
      ['Report', KIND_WORDS[duty?.kind] || NOT_RECORDED],
      ['Due', dayOf(period?.due_on) || NOT_RECORDED],
      ['Received', period?.state === 'sent' ? (dayOf(period.sent_at) || `${NOT_RECORDED} · no date stored`) : 'Not received'],
      ['Missing', missingOf(duty, period)],
      ['Your last ask', period?.asked ? (stampOf(period.asked_at) || 'You asked · when is not recorded') : 'You have not asked for this period'],
      ['Source', sourceOf(duty)],
      ['Holding route', route ? (ROUTE_WORDS[route] || route) : `${NOT_RECORDED} · the duty records no route`],
    ],
    record: rec,
    expected: period?.expected_on ? `The company expects to send it ${dayOf(period.expected_on)}${period.expected_note ? `: ‘${period.expected_note}’` : ''}` : null,
  };
}

/** The confirm button names the act, the company and the period. */
export function confirmLabel(kind, company, period) {
  return `${kind === WAIVE ? 'Waive' : 'Ask'} ${company?.name || 'this company'} · ${periodWord(period?.label)}`;
}

/** The Review step (PFA04, PFA05): who acts, what is recorded, who is told, and the period, before anything is sent. */
export function reviewOf(kind, company, period) {
  const duty = dutyOf(company, period);
  const name = company?.name || 'This company';
  const route = duty?.holding?.route;
  const common = [
    ['Company', name],
    ['Period', `${periodWord(period?.label)} · ${KIND_WORDS[duty?.kind] || 'Report'} · due ${dayOf(period?.due_on) || NOT_RECORDED.toLowerCase()}`],
    ['Holding route', route ? (ROUTE_WORDS[route] || route) : `${NOT_RECORDED} · the duty records no route`],
    ['Source', sourceOf(duty)],
  ];
  if (kind === WAIVE) {
    return {
      title: `Waive this reporting period`,
      facts: [
        ['Who acts', 'You, as the holder this period is owed to'],
        ['What is recorded', 'This period is marked waived by you, with the time, on the reporting record'],
        ['Who sees it', `The founders of ${name}, on their reporting desk. No other investor`],
        ...common,
      ],
      lines: [
        'This period is marked waived. It does not waive future periods or change the signed duty.',
        'No reason is recorded: the waiver stores none, so none is asked for.',
        'It cannot be undone here.',
      ],
    };
  }
  return {
    title: `Ask ${name} for its report`,
    facts: [
      ['Who acts', 'You, as the holder this period is owed to'],
      ['What is recorded', 'One request for this missing period, with the time, on the reporting record'],
      ['Who is told', `The founder team of ${name}, in the app and by email. No other investor`],
      ...common,
    ],
    lines: [
      'You can ask once per period, while it is late or missing.',
      'The receipt shows what the platform stored. Email delivery is not confirmed here.',
    ],
  };
}

/** The Worker's refusal, as it said it: its sentence and its code. */
export function refusalOf(error, kind) {
  const message = typeof error?.message === 'string' && error.message.trim() ? error.message.trim()
    : kind === WAIVE ? 'The period could not be waived.' : 'The request could not be sent.';
  return { message, code: error?.code || null, status: Number(error?.status) || null };
}

const BY = (v) => (v === true ? 'You' : v === false ? 'Another account' : `${NOT_RECORDED} · the answer carried no author`);

/** The Receipt, from the Worker's answer only: a field it lacks is Not recorded, never filled in. */
export function receiptOf(kind, answer, company, period) {
  const label = periodWord(answer?.period?.label || period?.label);
  const name = company?.name || 'This company';
  if (kind === WAIVE) {
    const at = stampOf(answer?.waived_at);
    return {
      title: `${label} waived`,
      facts: [
        ['Waived', at || `${NOT_RECORDED} · the answer carried no stored time`],
        ['By', BY(answer?.waived_by_you)],
        ['Company', name],
        ['Period', label],
        ['Scope', 'This period only. Future periods and the signed duty are unchanged'],
      ],
    };
  }
  const at = stampOf(answer?.asked_at);
  const told = answer?.told;
  let notices;
  if (!told || told.team == null) notices = `${NOT_RECORDED} · the founder team could not be read`;
  else if (!told.team) notices = 'Nobody · the company has no founder team on record';
  else notices = `${told.in_app} of ${told.team} in-app ${told.team === 1 ? 'notice' : 'notices'} stored`;
  return {
    title: `Request for ${label} recorded`,
    facts: [
      ['Recorded', at || `${NOT_RECORDED} · the answer carried no stored time`],
      ['By', BY(answer?.by_you)],
      ['Company', name],
      ['Period', label],
      ['Founder team told', notices],
      ['Email', 'Delivery is not confirmed here'],
      ['Reference', answer?.chase_uid || `${NOT_RECORDED} · the answer carried no reference`],
    ],
  };
}
