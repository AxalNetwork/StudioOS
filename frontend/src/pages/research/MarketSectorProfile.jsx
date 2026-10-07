import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Building2 } from 'lucide-react';
import { Card } from '../../ui';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import SectorProfile from './SectorProfile';

const missing = (v) => v === null || v === undefined || v === '';
const fact = (v) => (missing(v) ? 'Not recorded' : v);

function Fact({ label, value, note }) {
  return <div><div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{label}</div>
    <div className="mt-1 text-[13px] text-axal-ink dark:text-gray-100">{value}</div>
    {note ? <div className="mt-0.5 text-[11px] text-axal-faint">{note}</div> : null}</div>;
}

/**
 * A market no tracked sector claims (`resolveSectorPage` → `legacy`): 68 of
 * the 82 since migration 376. D593 put it inside the Research shell; #1077
 * made it read the Worker.
 *
 * IT DRAWS THE PAYLOAD THE RESOLVER ALREADY READ. `resolveSectorPage` fetches
 * `GET /api/research/markets/:slug` to learn the market has no sector, and
 * this view renders that same answer. It used to throw it away, read the
 * bundled `marketDirectory.json` for the name and count, and make two more
 * calls of its own, so a failed signals read printed raw red text and turned
 * growth and risk into "Not recorded", and its signals matched the market's
 * name exactly, which finds nothing for names like "FinTech" (#1080's list).
 * Now there is one read: loading, a failed read ("Unreadable") and "not
 * found" are the resolver's states, drawn by `SectorProfile`, and signals,
 * companies and funds come through the taxonomy crosswalk like every other
 * Research page.
 *
 * NOTHING HERE IS A MARKET SIZE. The supplied count is the taxonomy source's
 * and is labelled so; the directory count is the companies the crosswalk maps
 * here. Growth and risk are not drawn: no store records either per market.
 */
export function LegacyMarketView({ market }) {
  const item = market?.item || {};
  const companies = market?.companies || [];
  const funds = market?.funds || [];
  const signals = market?.signals || [];
  const countries = market?.companies_by_country || [];
  const labels = market?.sub_markets?.company_sectors || [];
  const reason = market?.index?.reason || 'This market has no market-intelligence sector yet';
  return <div data-testid="market-sector-profile" className="space-y-4">
    <Link to="/research/markets" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300"><ArrowLeft size={13} /> Markets</Link>
    <div><div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Market</div>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.name}</h1>
      <p className="mt-1 text-[12.5px] text-axal-muted">Directory companies, funds and signals mapped to this market through the taxonomy crosswalk.</p></div>
    <Card className="border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20"><div className="flex items-start gap-2 text-[12px] leading-relaxed text-violet-950 dark:text-violet-100"><ShieldCheck size={15} className="mt-0.5 shrink-0" />
      <span><strong>Data boundary:</strong> the supplied count is the taxonomy source&rsquo;s, for discovery. It is not market size, and no store records growth or risk for a market.</span></div></Card>
    <Card><div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="legacy-market-facts">
      <Fact label="Supplied count" value={missing(item.supplied_count) ? 'Not recorded' : Number(item.supplied_count).toLocaleString()} note={`${item.supplied_label || 'Supplied for discovery'} As of ${fact(item.as_of)}.`} />
      <Fact label="Directory companies" value={missing(market?.company_count) ? 'Not recorded' : market.company_count} note="Mapped by the crosswalk." />
      <Fact label="Market size" value="Not recorded" note="No source records a market size; the count is not one." />
      <Fact label="Tracked sector" value="Not recorded" note={reason} />
    </div></Card>
    <Card>
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-extrabold tracking-tight">Companies in this market</h2>
        <p className="mt-1 text-[12px] text-axal-muted">Directory records whose sector the crosswalk maps here.</p></div><Building2 size={17} className="text-axal-violet" /></div>
      {!companies.length
        ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted" data-testid="legacy-market-no-companies">No directory company maps to this market. That is the directory&rsquo;s coverage, not a claim about the market.</p>
        : <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{companies.map((c) => <Link key={c.uid} to={`/research/companies/company/${encodeURIComponent(c.uid)}`} className="rounded-lg border border-axal-hairline p-3 transition hover:border-violet-300 hover:bg-violet-50/40 dark:border-gray-800 dark:hover:border-violet-700 dark:hover:bg-violet-950/10">
            <div className="text-[13px] font-bold text-axal-violet dark:text-violet-300">{c.name}</div>
            <div className="mt-1 text-[11px] text-axal-muted">{c.sector || 'Sector not recorded'}{c.country ? ` · ${c.country}` : ''}</div></Link>)}</div>
          <p className="mt-3 text-[12px] text-axal-muted" data-testid="legacy-market-company-count">Showing {companies.length} of {market.company_count}.</p>
          {countries.length ? <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">{countries.map((k) => <li key={k.code || 'none'}>
            {k.code ? <Link to={`/research/geographies/${k.code}`} className="underline">{k.name || k.code}</Link> : 'Country not recorded'} · {k.count}</li>)}</ul> : null}
        </>}
      {labels.length ? <p className="mt-3 text-[11px] text-axal-faint">Company sector labels mapped here: {labels.map((l) => `${l.label} (${l.count})`).join(', ')}.</p> : null}
    </Card>
    <Card>
      <h2 className="text-sm font-extrabold tracking-tight">Funds focused on this market</h2>
      {!funds.length
        ? <p className="mt-3 text-[12px] text-axal-muted" data-testid="legacy-market-no-funds">No fund&rsquo;s stated focus maps to this market.</p>
        : <><ul className="mt-3 space-y-1 text-[12.5px]">{funds.map((f) => <li key={f.uid}><Link to={`/research/funds/catalog/${encodeURIComponent(f.uid)}`} className="underline">{f.name}</Link>
          <span className="text-axal-muted"> · {fact(f.hq)}</span></li>)}</ul>
          <p className="mt-2 text-[12px] text-axal-muted">Showing {funds.length} of {market.fund_count}.</p></>}
    </Card>
    <Card>
      <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold tracking-tight">Signals</h2>
        <p className="mt-1 text-[12px] text-axal-muted">Signals whose tags the crosswalk maps to this market.</p></div>
        <Link to="/signals" className="text-[12px] font-semibold text-axal-violet underline">Open full signals feed</Link></div>
      {!signals.length
        ? <p className="mt-4 rounded-lg border border-dashed border-axal-hairline px-3 py-4 text-[12px] leading-relaxed text-axal-muted" data-testid="legacy-market-no-signals">No signal is recorded for this market. That is an evidence gap, not a conclusion about growth or risk.</p>
        : <div className="mt-4 space-y-3">{signals.map((s) => <div key={s.id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
          <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{s.title}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{s.thesis}</p>
          <p className="mt-2 text-[11px] text-axal-faint">Why now: {fact(s.why_now)} · Confidence {missing(s.confidence_score) ? 'not recorded' : `${s.confidence_score}%`} · updated {fact(s.updated_at)}</p>
        </div>)}</div>}
    </Card>
  </div>;
}

/** The legacy page inside the Research shell, from the resolver's own read. */
function LegacyMarketProfile({ role = 'founder', market }) {
  return <WorkspaceShell role={role} title={market?.item?.name || 'Market'} activeSlug="markets"><LegacyMarketView market={market} /></WorkspaceShell>;
}

export default function MarketSectorProfile({ role = 'founder' }) {
  const { slug } = useParams();
  return <SectorProfile slug={slug} role={role} LegacyPage={LegacyMarketProfile} />;
}
