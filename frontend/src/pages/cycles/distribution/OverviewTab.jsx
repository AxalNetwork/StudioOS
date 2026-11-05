/** D4485 (#4485): DS1 Overview, with independently unreadable data and retained legacy tools. */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesWrite } from '../../../lib/api/cycles.js';
import { api } from '../../../lib/api.js';
import Skeleton from '../../../components/Skeleton.jsx';
import { Card, Chip, Pill, ProgressBar, SourceChip } from './DistributionParts.jsx';
import { distributionPath } from './distributionModel.js';
import { budgetView, KPI_LABELS, metricView, resultsLine, sourceChips, UNREADABLE_NOTE, weekColumns } from './overviewModel.js';
import './overview.css';

function Failed({ onRetry }) {
  return <div role="status"><strong>Unreadable</strong><p>{UNREADABLE_NOTE}</p><button type="button" className="ds-overview-link" onClick={onRetry}>Try again</button></div>;
}
function Missing({ reason }) { return <p className="ds-not-recorded">{reason || 'Not recorded'}</p>; }
function Head({ title, href, link }) { return <header className="ds-overview-head"><h2>{title}</h2>{href && <Link to={href}>{link} ›</Link>}</header>; }
export function OverviewSkeleton() {
  return <div className="ds-overview" role="status" aria-label="Loading Distribution overview"><div className="ds-overview-kpis">{Object.keys(KPI_LABELS).map((key) => <Card key={key}><Skeleton h={12} w="65%" /><Skeleton h={22} className="mt-3" /></Card>)}</div><div className="ds-overview-columns"><Skeleton.Card /><Skeleton.Card /></div></div>;
}
const sub = { leads: 'UTM-tagged sign-ups · this month', replies: 'Across channels · this month', cost_per_lead: 'This month’s spend ÷ leads' };
export function OverviewView({ data, loading = false, onRetry, search = '', projectId, onAdd, additions = {}, today }) {
  if (loading) return <OverviewSkeleton />;
  const week = weekColumns(data?.week, today);
  const campaigns = data?.campaigns;
  const replies = data?.update_asks;
  const channels = data?.channels;
  return <div className="ds-overview" data-testid="distribution-overview">
    <div className="ds-overview-kpis">{Object.entries(KPI_LABELS).map(([key, label]) => {
      const metric = data?.kpis?.[key] ?? { value: null, reason: 'Unreadable: overview KPI could not be read', sources: [] };
      const view = metricView(key, metric);
      return <Card key={key} data-testid={`overview-kpi-${key}`}><h2 className="ds-eyebrow">{label}</h2>
        {view.state === 'unreadable' ? <Failed onRetry={onRetry} /> : <><div className={view.state === 'recorded' ? 'ds-overview-value' : 'ds-not-recorded'}>{view.label}</div>
          {view.reason && <p className="ds-overview-sub">{view.reason}</p>}
          {sub[key] && <p className="ds-overview-sub">{sub[key]}</p>}
          {key === 'spend_vs_budget' && <p className="ds-overview-sub">{metric?.budget_cents == null ? 'Budget · Not recorded' : `of ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(metric.budget_cents / 100)}`}</p>}
          <div className="ds-overview-chips">{view.chips.map((chip) => <SourceChip key={chip.source} source={chip.source} />)}</div></>}
      </Card>;
    })}</div>
    <div className="ds-overview-columns"><div className="ds-overview-main">
      <Card><Head title="Active campaigns" href={distributionPath('campaigns', search)} link="All campaigns" />
        {!Array.isArray(campaigns?.items) ? <Failed onRetry={onRetry} /> : campaigns.items.length ? <div className="ds-overview-campaigns">{campaigns.items.map((campaign) => {
          const budget = budgetView(campaign);
          return <article className="ds-overview-campaign" key={campaign.uid}><div className="ds-overview-head"><Link to={`${distributionPath('campaigns').split('?')[0]}/${encodeURIComponent(campaign.uid)}${new URLSearchParams(search).toString() ? `?${new URLSearchParams(search)}` : ''}`}>{campaign.name}</Link><Pill tone="positive">Active</Pill></div>
            <Pill tone="lavender">Goal · {({ demos: 'Demos', signups: 'Sign-ups', sales: 'Sales', awareness: 'Awareness' })[campaign.goal] || 'Not recorded'}</Pill>
            <div className="ds-overview-chips">{campaign.channels?.map((channel) => <Chip key={channel.uid}>{channel.name || 'Channel · Not recorded'}</Chip>)}</div>
            <div className="ds-overview-head"><span>{budget.label}</span>{budget.percent && <span className="ds-overview-percent">{budget.percent}</span>}</div>
            {budget.progress !== null && <ProgressBar value={budget.progress} label={`${campaign.name} budget used`} />}
            <p className="ds-overview-sub">{resultsLine(campaign)}</p>{[campaign.leads, campaign.demos, campaign.customers].some((n) => typeof n === 'number') && <SourceChip source="connector" />}{campaign.budget_cents != null && <SourceChip source="manual" />}{sourceChips((campaign.channels || []).flatMap((channel) => (channel.spend_months || []).map((month) => month.source))).map((chip) => <SourceChip key={chip.source} source={chip.source} />)}
          </article>;
        })}</div> : <div><p>{campaigns.total === 0 ? 'No campaigns yet. A campaign groups your channels, audience, budget and posts toward one goal.' : 'No active campaigns. Open Campaigns to see your drafts and completed campaigns.'}</p><Link className="ds-overview-link" to={`/grow/distribution/campaigns/new${search}`}>New campaign</Link></div>}
      </Card>
      <Card><Head title="This week" href={distributionPath('calendar', search)} link="Open Calendar" /><p className="ds-overview-sub">Scheduled posts and sequence steps{data?.week?.from ? ` · ${data.week.from} – ${week.days.at(-1)?.date}` : ''}. Sequence steps are not recorded here yet.</p>
        {week.state === 'unreadable' ? <Failed onRetry={onRetry} /> : <div className="ds-overview-week">{week.days.map((day) => <section key={day.date} className={`ds-overview-day${day.today ? ' is-today' : ''}`} aria-label={day.heading}><h3>{day.heading}</h3><time dateTime={day.date}>{day.date.slice(5)}</time>
          {day.empty ? <p className="ds-overview-sub">{day.empty}</p> : day.items.map((item) => <article className="ds-overview-post" key={item.uid}><span className="ds-eyebrow">POST</span><p>{item.title || 'Untitled post'}</p><Chip>{item.channel || 'Channel · Not recorded'}</Chip></article>)}
        </section>)}</div>}
      </Card>
    </div><aside className="ds-overview-side">
      <Card><Head title="Connected channels" href={distributionPath('channels', search)} link="Open Channels" />
        {!Array.isArray(channels?.items) ? channels?.reason?.startsWith('Not recorded:') ? <Missing reason={channels.reason} /> : <Failed onRetry={onRetry} /> : <ul className="ds-overview-list">{channels.items.map((channel) => <li key={channel.name}><span>{channel.name}</span><Pill tone={channel.status === 'Connected' ? 'positive' : channel.status === 'Reconnect' ? 'amber' : 'muted'}>{channel.status}</Pill></li>)}</ul>}
        <p className="ds-overview-sub">Account connections, not campaign plans. WhatsApp capture does not send marketing messages.</p>
      </Card>
      <Card><Head title="Replies from your update asks" /><p className="ds-overview-sub">Investors and advisors who answered an ask in your last update.</p>
        {!Array.isArray(replies?.items) ? replies?.reason?.startsWith('Not recorded:') ? <Missing reason={replies.reason} /> : <Failed onRetry={onRetry} /> : replies.items.length ? <ul className="ds-overview-list">{replies.items.map((reply) => <li key={reply.uid}><div><strong>{reply.name || 'Name · Not recorded'}</strong><p>{reply.ask_text || reply.message}</p>
          {replies.can_add && reply.email && onAdd ? <button type="button" className="ds-overview-link" disabled={additions[reply.uid] === 'busy' || additions[reply.uid] === 'added'} onClick={() => onAdd(reply, projectId)}>{additions[reply.uid] === 'added' ? 'Added to Prospects' : additions[reply.uid] === 'busy' ? 'Adding…' : 'Add to Prospects'}</button> : <Link to={distributionPath('prospects', search)}>Open Prospects</Link>}
          {additions[reply.uid] === 'error' && <p role="alert">Couldn’t add this prospect. Try again.</p>}</div><Pill tone="lavender">Lead</Pill></li>)}</ul> : <p className="ds-overview-sub">No replies from your update asks yet.</p>}
      </Card>
    </aside></div>
  </div>;
}
export default function OverviewTab({ projectId, search = '', refresh, children, read = cyclesWrite.grow.distributionOverview, create = api.contactCreate }) {
  const [attempt, setAttempt] = useState(0);
  const [reading, setReading] = useState({ key: null, data: null, loading: true });
  const [additions, setAdditions] = useState({});
  const key = `${projectId}:${refresh}:${attempt}`;
  useEffect(() => {
    let alive = true;
    setAdditions({});
    Promise.resolve().then(() => read(projectId)).then((data) => { if (alive) setReading({ key, data, loading: false }); }, () => { if (alive) setReading({ key, data: null, loading: false }); });
    return () => { alive = false; };
  }, [projectId, refresh, attempt, read, key]);
  const add = async (reply) => {
    setAdditions((state) => ({ ...state, [reply.uid]: 'busy' }));
    try {
      await create({ project_id: projectId, name: reply.name, email: reply.email, audience: 'customer', source: 'update ask' });
      setAdditions((state) => ({ ...state, [reply.uid]: 'added' }));
    } catch { setAdditions((state) => ({ ...state, [reply.uid]: 'error' })); }
  };
  return <><OverviewView data={reading.data} loading={reading.key !== key || reading.loading} projectId={projectId} search={search} onRetry={() => setAttempt((n) => n + 1)} onAdd={add} additions={additions} />{children}</>;
}
