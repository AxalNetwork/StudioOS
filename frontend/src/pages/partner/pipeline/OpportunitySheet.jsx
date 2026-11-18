/**
 * D4838 PP08 / PP08m (#5934): the shared opportunity sheet. One detail sheet for a lead, a proposal, a negotiation
 * and an engagement, so they read as one opportunity moving forward rather than four unrelated rows.
 *
 * ONE IDENTITY, JOINED BY ID. A lead is a marketplace need (`need_id`); a proposal is a quote on that need; a
 * negotiation is that quote's (`quote_id`); an engagement is the accepted quote's (`engagement_id`, which the
 * proposal row carries, because a retainer row does not carry its need). Nothing is joined by name. A caller passes
 * whichever id it holds and the sheet finds the rest in the zones' own reads, `/partner/pipeline/{leads,proposals,
 * negotiations,retainers}`, read to the end as the zones read them. Activity is D5942's recorded feed
 * (`/partner/pipeline/activity?need_id=`). No route is added.
 *
 * WHAT IT DRAWS. The header names the client (else the opportunity), the current stage, the value and the source.
 * Tabs appear only when their record exists: Overview and Activity always, Fit for an open lead, Proposal for a
 * quote, Terms for a tracked negotiation, Engagement for an engagement. Activity lists recorded events only; with
 * none it reads Not recorded, and it never infers an event from a stage.
 *
 * THE SHEET IS `ui/Sheet.jsx` (D1317): it traps focus and returns it, Escape and × close it, and below 640px it is
 * a full-screen page (`phone="full"`, PP08m). The read loop is `usePipelineZone` (#4685): a background refresh
 * (`refreshKey`, Try again) keeps the tab and any editor a zone mounts in it (`editors`), and a source that fails
 * on refresh keeps its last good record rather than dropping its tab. A first read that fails is Unreadable inside
 * the sheet, with Try again.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../../../ui';
import { api } from '../../../lib/api';
import { partnerPipelineActivityApi } from '../../../lib/api/partnerPipelineActivity';
import { readAllLeadPages, readAllPages } from '../../../lib/pagedRead';
import { NotRecorded } from '../../../workspaces/canvasKit';
import { Pill, buttonClass, formatDay, moneyCents, moneyDollars } from '../kit';
import { usePipelineZone } from './usePipelineZone';
import { activityRows } from './commandCentre';

export const OPPORTUNITY_TABS = Object.freeze(['Overview', 'Activity', 'Fit', 'Proposal', 'Terms', 'Engagement']);
export const LOAD_FAILED = 'This opportunity could not be read.';
const CORE = ['leads', 'proposals', 'negotiations', 'retainers'];
const SOURCE_LABEL = { leads: 'Leads', proposals: 'Proposals', negotiations: 'Negotiations', retainers: 'Retainers' };

export const OPPORTUNITY_SOURCES = {
  leads: () => readAllLeadPages((cur, pcur) => api.listPartnerLeads(cur, pcur)),
  proposals: () => readAllPages((cur) => api.listPartnerProposals(cur)),
  negotiations: () => readAllPages((cur) => api.listPartnerNegotiations(cur)),
  retainers: () => readAllPages((cur) => api.listPartnerRetainers(cur)),
  activity: (needId) => partnerPipelineActivityApi.list({ needId, limit: 50 }),
};

const num = (v) => (v == null || v === '' ? null : Number(v));
const same = (a, b) => a != null && b != null && Number(a) === Number(b);

/**
 * The four zone reads, each settled on its own, then the activity feed for the need they resolve to. A source that
 * fails keeps `prev`'s record for it (a background refresh does not drop a tab). When all four fail and there is
 * nothing to keep, it throws the first failure, so `usePipelineZone` says Unreadable (or "no partner profile").
 */
export async function readOpportunity(id, sources = OPPORTUNITY_SOURCES, prev = null) {
  const settled = await Promise.allSettled(CORE.map((k) => sources[k]()));
  const reads = {};
  settled.forEach((s, i) => {
    const k = CORE[i];
    if (s.status === 'fulfilled') reads[k] = { state: 'ok', value: s.value || {} };
    else reads[k] = prev?.reads?.[k]?.state === 'ok' ? prev.reads[k] : { state: 'unreadable' };
  });
  if (CORE.every((k) => reads[k].state !== 'ok')) throw settled.find((s) => s.status === 'rejected').reason;
  const record = resolveOpportunity(id, reads);
  let activity = { state: 'none' };
  if (record.needId != null) {
    try {
      const r = await sources.activity(record.needId);
      activity = { state: 'ok', items: Array.isArray(r?.items) ? r.items : [] };
    } catch {
      activity = prev?.activity?.state === 'ok' && same(prev?.record?.needId, record.needId)
        ? prev.activity : { state: 'unreadable' };
    }
  }
  return { reads, record, activity };
}

/** The rows of one opportunity across the four reads, joined by id; and which reads could not answer. */
export function resolveOpportunity(id = {}, reads = {}) {
  const items = (k) => {
    const value = reads[k]?.state === 'ok' ? reads[k].value : null;
    return Array.isArray(value?.items) ? value.items : [];
  };
  const proposals = items('proposals');
  const proposal = proposals.find((p) => same(p.quote_id, id.quoteId))
    || proposals.find((p) => same(p.need_id, id.needId))
    || proposals.find((p) => same(p.engagement_id, id.engagementId))
    || null;
  const needId = num(id.needId ?? proposal?.need_id);
  const quoteId = num(proposal?.quote_id ?? id.quoteId);
  const engagementId = num(id.engagementId ?? proposal?.engagement_id);
  const negs = items('negotiations');
  const negotiation = negs.find((n) => same(n.quote_id, quoteId)) || negs.find((n) => same(n.need_id, needId)) || null;
  const retainer = items('retainers').find((r) => same(r.engagement_id, engagementId)) || null;
  const lead = items('leads').find((l) => same(l.need_id, needId)) || null;
  const passedRows = reads.leads?.state === 'ok' && Array.isArray(reads.leads.value?.passed) ? reads.leads.value.passed : [];
  const passed = passedRows.find((l) => same(l.need_id, needId)) || null;
  const found = { leads: lead || passed, proposals: proposal, negotiations: negotiation, retainers: retainer };
  // A read that failed, or stopped before its end without finding this record, cannot say there is none.
  const unreadable = CORE.filter((k) => reads[k]?.state !== 'ok' || (!found[k] && reads[k].value?.remainder_error));
  return {
    needId, quoteId, engagementId, lead, passed, proposal,
    negotiation: negotiation?.negotiation ? negotiation : null,
    retainer, unreadable,
    exists: Boolean(lead || passed || proposal || negotiation || retainer),
  };
}

/** The furthest recorded stage: an engagement, a tracked negotiation, a proposal, or a lead. */
export function currentStage(r) {
  if (r.retainer) return 'engagement';
  if (r.negotiation && r.proposal?.status !== 'accepted') return 'negotiation';
  if (r.proposal) return 'proposal';
  if (r.lead || r.passed) return 'lead';
  return null;
}

const ORDER = ['lead', 'proposal', 'negotiation', 'engagement'];

/** The tracker: each stage, whether this opportunity has a record of it, and which one it is in now. */
export function stageTrack(r) {
  const now = currentStage(r);
  const has = {
    lead: Boolean(r.lead || r.passed || r.proposal || r.negotiation || r.retainer), // every quote is on a need
    proposal: Boolean(r.proposal || r.negotiation),
    negotiation: Boolean(r.negotiation),
    engagement: Boolean(r.retainer),
  };
  return ORDER.map((key) => ({
    key,
    label: key === 'engagement' ? (r.retainer?.retainer ? 'Retainer' : 'Engagement') : key[0].toUpperCase() + key.slice(1),
    done: has[key] && ORDER.indexOf(key) < ORDER.indexOf(now),
    current: key === now,
  }));
}

/** The stage in words, with its state: "Proposal · Lost", "Negotiation · Terms". */
export function stageLine(r) {
  const s = currentStage(r);
  if (s === 'engagement') {
    const ret = r.retainer.retainer;
    if (ret) return `Retainer · ${ret.active ? 'active' : 'ended'}`;
    return r.retainer.engagement_status ? `Engagement · ${String(r.retainer.engagement_status).replace(/_/g, ' ')}` : 'Engagement';
  }
  if (s === 'negotiation') return `Negotiation · ${r.negotiation.negotiation.label || r.negotiation.negotiation.stage}`;
  if (s === 'proposal') return `Proposal · ${r.proposal.state || 'Sent'}`;
  if (s === 'lead') return r.lead ? 'Lead · open' : 'Lead · passed';
  return null;
}

function budget(lead) {
  const lo = num(lead?.budget_min);
  const hi = num(lead?.budget_max);
  if (lo != null && hi != null) return lo === hi ? `${moneyDollars(hi)} budget` : `${moneyDollars(lo)}–${moneyDollars(hi)} budget`;
  if (hi != null) return `Up to ${moneyDollars(hi)} budget`;
  if (lo != null) return `From ${moneyDollars(lo)} budget`;
  return null;
}

/** The value at the current stage, or null (Not recorded): never a $0 for a figure nobody entered. */
export function opportunityValue(r) {
  const s = currentStage(r);
  if (s === 'engagement') {
    const monthly = r.retainer.retainer?.current_monthly_cents;
    if (monthly != null) return `${moneyCents(monthly)} a month`;
    return r.retainer.engagement_price != null ? moneyDollars(r.retainer.engagement_price) : null;
  }
  if (s === 'negotiation') {
    const p = num(r.negotiation.price ?? r.proposal?.price_dollars);
    return p == null ? null : moneyDollars(p);
  }
  if (s === 'proposal') return r.proposal.price_dollars == null ? null : moneyDollars(r.proposal.price_dollars);
  if (s === 'lead') return budget(r.lead);
  return null;
}

/** Who and what: the client where one is recorded, and the opportunity's own title. */
export function opportunityName(r) {
  const client = r.retainer?.founder_name || r.negotiation?.founder_name || r.proposal?.client || r.lead?.who || r.passed?.who || null;
  const title = r.lead?.title || r.proposal?.need_title || r.negotiation?.need_title || r.passed?.title || r.retainer?.need_title || null;
  return { client, title };
}

/** Where it came from. Every need this build can see is a marketplace need (the Leads read says so). */
export function opportunitySource(r) {
  if (r.lead?.source_label) return r.lead.source_label;
  return r.needId != null ? 'Marketplace need' : null;
}

/** The tabs this record can fill, in the issue's order. */
export function opportunityTabs(r) {
  return OPPORTUNITY_TABS.filter((t) => (
    t === 'Overview' || t === 'Activity'
    || (t === 'Fit' && r.lead)
    || (t === 'Proposal' && r.proposal)
    || (t === 'Terms' && r.negotiation)
    || (t === 'Engagement' && r.retainer)
  ));
}

/** Recorded events only, in the feed's order: the words are Recent movement's (`commandCentre.js`, D4838 part 9). */
export { activityRows };

const h3 = 'mb-1.5 text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-faint';
const muted = 'text-[12.5px] text-axal-muted dark:text-gray-400';

function KV({ rows }) {
  return (
    <dl className="grid grid-cols-[132px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
      {rows.filter(Boolean).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-axal-faint">{k}</dt>
          <dd className="min-w-0">{v ?? <NotRecorded />}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Unreadable, said inside the sheet, with the one action a person has. */
function UnreadableBlock({ what, onRetry, testId }) {
  return (
    <div role="alert" data-testid={testId} className="grid gap-2 rounded-[10px] border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <b>Unreadable</b>
      <span>{what} It is unknown, not empty.</span>
      <span><button type="button" className={buttonClass} onClick={onRetry}>Try again</button></span>
    </div>
  );
}

function Tracker({ steps }) {
  const current = steps.find((s) => s.current);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold" aria-label={current ? `Stage: ${current.label}` : 'Stage'} data-testid="opportunity-stages">
      {steps.map((s) => (
        <li key={s.key} aria-current={s.current ? 'step' : undefined}
          className={`rounded-full border px-2.5 py-0.5 ${s.current
            ? 'border-amber-700 bg-amber-700 text-white'
            : s.done ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-axal-hairline text-axal-faint dark:border-gray-700'}`}>
          {s.done ? `✓ ${s.label}` : s.label}
        </li>
      ))}
    </ol>
  );
}

function Overview({ r }) {
  const { client, title } = opportunityName(r);
  const n = r.negotiation?.negotiation;
  return (
    <KV rows={[
      ['Opportunity', title],
      ['Client', client],
      ['Stage', stageLine(r)],
      ['Value', opportunityValue(r)],
      ['Source', opportunitySource(r)],
      r.lead && ['Arrived', r.lead.days_old != null ? `${r.lead.days_old} days ago` : null],
      r.passed && ['Passed', `${formatDay(r.passed.passed_at)}${r.passed.reason ? ` · ${String(r.passed.reason).replace(/_/g, ' ')}` : ''}`],
      r.proposal && ['Proposal', r.proposal.signal || null],
      n && ['Ball', n.ball === 'us' ? 'With us' : 'With them'],
      r.retainer?.retainer?.renews_at && ['Renews', formatDay(r.retainer.retainer.renews_at)],
    ]} />
  );
}

function Activity({ activity, onRetry }) {
  if (activity.state === 'unreadable') return <UnreadableBlock what="This opportunity’s activity could not be read." onRetry={onRetry} testId="opportunity-activity-unreadable" />;
  const rows = activity.state === 'ok' ? activityRows(activity.items || []) : [];
  if (!rows.length) {
    return (
      <div className="grid gap-1.5" data-testid="opportunity-activity-none">
        <span><NotRecorded /></span>
        <p className={muted}>No lifecycle event is recorded for this opportunity. A stage on this sheet is not an event, so none is drawn from it.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1 text-[12.5px]" data-testid="opportunity-activity">
        {rows.map((e) => (
          <li key={e.key} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 border-b border-dashed border-axal-hairline py-1.5 dark:border-gray-800">
            <span className="font-mono text-[11.5px] text-axal-faint">{formatDay(e.at)}</span>{e.text}
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-axal-faint">Only recorded events are listed. A negotiation keeps its latest move only, so earlier moves are not here.</p>
    </div>
  );
}

const RECEIPT = { hit: 'Meets', miss: 'Misses', gap: 'Not stated' };

function Fit({ lead }) {
  return (
    <div className="grid gap-3 text-[12.5px]" data-testid="opportunity-fit">
      <section>
        <h3 className={h3}>Why</h3>
        {(lead.receipts || []).length ? (
          <ul className="grid gap-1">
            {lead.receipts.map((x) => <li key={x.label}><b className="mr-2">{RECEIPT[x.kind] || x.kind}</b>{x.label}</li>)}
          </ul>
        ) : <NotRecorded />}
      </section>
      <section>
        <h3 className={h3}>Score</h3>
        {lead.excluded_by ? <p>Excluded: {lead.excluded_by}</p>
          : lead.score != null ? <p className="font-mono text-[16px] font-extrabold">{lead.score}</p>
            : <p className={muted}>{lead.score_note || 'Not scored.'}</p>}
      </section>
    </div>
  );
}

function Proposal({ p }) {
  return (
    <div className="grid gap-3" data-testid="opportunity-proposal">
      <KV rows={[
        ['State', p.state],
        ['Price', p.price_dollars == null ? null : moneyDollars(p.price_dollars)],
        ['Shape', p.shape],
        ['Version', p.version != null ? `v${p.version}` : null],
        ['Opened', null],
        p.loss_reason && ['Loss reason', String(p.loss_reason).replace(/_/g, ' ')],
      ]} />
      {(p.versions || []).length > 0 && (
        <section>
          <h3 className={h3}>Versions</h3>
          <ul className="grid gap-1 text-[12.5px]">
            {p.versions.map((v) => (
              <li key={v.id}><b className="mr-2">v{v.version}</b>{v.change_summary}
                {v.price_cents != null && <span className="ml-2 text-axal-faint">{moneyCents(v.price_cents)}</span>}
                <span className="ml-2 text-axal-faint">{formatDay(v.created_at)}</span></li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-[11.5px] text-axal-faint">Opened reads Not recorded: nothing records that a client opened a proposal.</p>
    </div>
  );
}

const TERM_TONE = { open: 'warn', agreed: 'ok', conceded: 'neutral', refused: 'danger' };

function Terms({ row }) {
  const n = row.negotiation;
  const terms = row.terms || [];
  return (
    <div className="grid gap-3" data-testid="opportunity-terms">
      <KV rows={[
        ['Stage', n.label || n.stage],
        ['Ball', n.ball === 'us' ? 'With us' : 'With them'],
        ['Open question', n.open_question],
        ['Last moved', n.days_stalled != null ? `${n.days_stalled} days ago` : null],
      ]} />
      {terms.length ? (
        <table className="w-full text-left text-[12px]">
          <thead className="text-axal-faint"><tr><th className="py-1 font-semibold">Term</th><th className="font-semibold">We</th><th className="font-semibold">They</th><th className="font-semibold">Current</th></tr></thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id} className="border-t border-axal-hairline dark:border-gray-800">
                <td className="py-1.5 font-semibold">{t.label} <Pill tone={TERM_TONE[t.state] || 'neutral'}>{t.state}</Pill></td>
                <td>{t.our_position ?? <NotRecorded />}</td>
                <td>{t.their_position ?? <NotRecorded />}</td>
                <td>{t.landing ?? <NotRecorded />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className={muted}>No clause is tracked on this negotiation.</p>}
    </div>
  );
}

function Engagement({ row }) {
  const ret = row.retainer;
  return (
    <div data-testid="opportunity-engagement">
      <KV rows={[
        ['Status', row.engagement_status ? String(row.engagement_status).replace(/_/g, ' ') : null],
        ['Price', row.engagement_price != null ? moneyDollars(row.engagement_price) : null],
        ['Shape', ret ? String(ret.shape || '').replace(/_/g, ' ') || null : 'One-off'],
        ret && ['Cadence', ret.cadence],
        ret && ['Monthly', ret.current_monthly_cents != null ? moneyCents(ret.current_monthly_cents) : null],
        ret && ['Retained hours', ret.retained_hours],
        ret && ['Utilization', row.utilisation_pct != null ? `${row.utilisation_pct}% used` : (row.utilisation_note || null)],
        ret && ['Renews', ret.renews_at ? formatDay(ret.renews_at) : null],
        ret?.ended_at && ['Ended', formatDay(ret.ended_at)],
      ]} />
    </div>
  );
}

/**
 * @param {object} props
 * @param {{needId?: number, quoteId?: number, engagementId?: number}} props.opportunity  whichever id the opener holds
 * @param {() => void} props.onClose
 * @param {string} [props.title]  what the opener calls it, shown while the first read is in flight
 * @param {string} [props.initialTab]
 * @param {any} [props.refreshKey]  change it after a write elsewhere: a background refresh, nothing unmounts
 * @param {Record<string, React.ReactNode>} [props.editors]  a zone's editor for a tab, drawn under its record
 * @param {object} [props.sources]  the reads, for a test
 */
export default function OpportunitySheet({
  opportunity = {}, onClose, title: hint, initialTab = 'Overview', refreshKey, editors = {}, sources = OPPORTUNITY_SOURCES,
}) {
  const { needId, quoteId, engagementId } = opportunity;
  const key = `${needId ?? ''}:${quoteId ?? ''}:${engagementId ?? ''}`;
  const last = useRef(null);
  const fetcher = useCallback(async () => {
    const prev = last.current?.key === key ? last.current.data : null;
    const data = await readOpportunity({ needId, quoteId, engagementId }, sources, prev);
    last.current = { key, data };
    return data;
  }, [key, needId, quoteId, engagementId, sources]);
  const { state, load } = usePipelineZone(fetcher, LOAD_FAILED, key);
  const retry = useCallback(() => { load(); }, [load]);

  const firstRefresh = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstRefresh.current) return;
    firstRefresh.current = refreshKey;
    load();
  }, [refreshKey, load]);

  const data = state.loading ? null : state.data;
  const r = data?.record || null;
  const tabs = useMemo(() => (r ? opportunityTabs(r) : []), [r]);
  const [tab, setTab] = useState(OPPORTUNITY_TABS.includes(initialTab) ? initialTab : 'Overview');
  const shown = tabs.includes(tab) ? tab : 'Overview';
  const tabRefs = useRef({});
  const onTabKey = (ev) => {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!step || !tabs.length) return;
    ev.preventDefault();
    const next = tabs[(tabs.indexOf(shown) + step + tabs.length) % tabs.length];
    setTab(next);
    tabRefs.current[next]?.focus?.();
  };

  const name = r ? opportunityName(r) : { client: null, title: null };
  const heading = name.client || name.title || hint || 'Opportunity';
  let sub = 'Reading this opportunity…';
  if (!state.loading) sub = r?.exists ? (stageLine(r) || '') : '';

  let body;
  if (state.loading) {
    body = (
      <div aria-busy="true" className="grid gap-2" data-testid="opportunity-loading">
        <span className="sr-only">Reading this opportunity…</span>
        {[40, 60, 80].map((w) => <span key={w} className="h-3.5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" style={{ width: `${w}%` }} />)}
      </div>
    );
  } else if (state.error) {
    body = <UnreadableBlock what={state.error} onRetry={retry} testId="opportunity-unreadable" />;
  } else if (!r.exists) {
    body = r.unreadable.length
      ? <UnreadableBlock what={`${r.unreadable.map((k) => SOURCE_LABEL[k]).join(', ')} could not be read, so this opportunity was not found.`} onRetry={retry} testId="opportunity-unreadable" />
      : <p className={muted} data-testid="opportunity-missing">This opportunity is not in your pipeline record.</p>;
  } else {
    body = (
      <div className="grid gap-4">
        <div className="grid gap-2" data-testid="opportunity-header">
          <Tracker steps={stageTrack(r)} />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
            <b className="font-mono" data-testid="opportunity-value">{opportunityValue(r) ?? <NotRecorded />}</b>
            <span className="text-axal-faint" data-testid="opportunity-source">{opportunitySource(r) ?? <NotRecorded />}</span>
          </div>
        </div>
        {r.unreadable.length > 0 && (
          <UnreadableBlock what={`${r.unreadable.map((k) => SOURCE_LABEL[k]).join(', ')} could not be read, so a tab may be missing.`} onRetry={retry} testId="opportunity-partial" />
        )}
        <div role="tablist" aria-label="Opportunity" data-testid="opportunity-tabs" onKeyDown={onTabKey}
          className="flex flex-wrap gap-3 border-b border-axal-hairline dark:border-gray-700">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={shown === t} tabIndex={shown === t ? 0 : -1}
              ref={(el) => { tabRefs.current[t] = el; }} onClick={() => setTab(t)}
              className={`-mb-px min-h-[44px] border-b-2 px-0.5 text-[12.5px] font-semibold sm:min-h-0 sm:pb-2 ${shown === t
                ? 'border-amber-700 text-axal-ink dark:text-white'
                : 'border-transparent text-axal-faint hover:text-axal-ink dark:hover:text-white'}`}>
              {t}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={shown} data-testid={`opportunity-tab-${shown.toLowerCase()}`} className="grid gap-3">
          {shown === 'Overview' && <Overview r={r} />}
          {shown === 'Activity' && <Activity activity={data.activity} onRetry={retry} />}
          {shown === 'Fit' && <Fit lead={r.lead} />}
          {shown === 'Proposal' && <Proposal p={r.proposal} />}
          {shown === 'Terms' && <Terms row={r.negotiation} />}
          {shown === 'Engagement' && <Engagement row={r.retainer} />}
          {editors[shown] || null}
        </div>
      </div>
    );
  }

  return (
    <Sheet title={heading} eyebrow="Opportunity" sub={sub} onClose={onClose} width={640} phone="full" testId="opportunity-sheet">
      <div className="px-5 py-4">{body}</div>
    </Sheet>
  );
}
