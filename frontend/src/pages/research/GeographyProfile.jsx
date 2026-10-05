import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card } from '../../ui';
import { Unreadable, Unrecorded } from '../../ui/Honesty';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { useRead } from './MarketDirectoryZone';

/**
 * Research · Geographies · one country (`/research/geographies/:code`), to the
 * Geography canvas (`design/incoming/Research · Geography.dc.html`, D546).
 * Issue #1080, D533. Reads `GET /api/research/geographies/:code`.
 *
 * WHAT IT DOES NOT CLAIM.
 * - Demand per country reads "Not recorded": the sector indexes are computed
 *   worldwide only, so no per-country demand is stored.
 * - A fund size is printed only in euros, the one currency a size is recorded
 *   in (the EuroTech list); any other list's number reads "Not recorded".
 * - EIF/EIFO is yes, no, or "LPs not recorded": a fund that names no LPs is
 *   not evidence that neither backs it.
 * - A signal that names only the region says so on its card.
 */

const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));

/** Euro cents → "€30M" / "€0.5M". */
export function euroMillions(cents) {
  if (cents == null) return null;
  const m = Number(cents) / 100 / 1e6;
  return `€${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

/** EIF/EIFO cell: the backers named, "Neither named", or LPs not recorded. */
export function backingLabel(f) {
  const named = [f.eif ? 'EIF' : null, f.eifo ? 'EIFO' : null].filter(Boolean);
  if (named.length) return named.join(', ');
  if (f.eif === false && f.eifo === false) return 'Neither named';
  return null;
}

function Bar({ value, max }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return <span className="block h-1.5 rounded-full bg-violet-100 dark:bg-violet-950"><span className="block h-1.5 rounded-full bg-violet-500" style={{ width: `${w}%` }} /></span>;
}

function Stat({ label, value, note, testId }) {
  return (
    <div data-testid={testId} className="rounded-xl border border-axal-hairline p-4 dark:border-gray-800">
      <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-axal-faint">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-axal-ink dark:text-gray-100">{value}</div>
      {note ? <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">{note}</p> : null}
    </div>
  );
}

function CountryStrip({ code }) {
  const navigate = useNavigate();
  const [geos] = useRead(() => researchMarketsApi.geographies({ sort: 'company_count', limit: 100 }));
  if (geos.status !== 'ready' || !geos.data?.items?.length) return null;
  const items = geos.data.items;
  return (
    <div className="space-y-2">
      <nav aria-label={`Countries · ${items.length}`} className="flex gap-1.5 overflow-x-auto pb-1">
        {items.slice(0, 12).map((k) => (
          <Link key={k.code} to={`/research/geographies/${k.code}`} aria-current={k.code === code ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold ${k.code === code ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}>
            {k.name} <span className="font-mono text-[11px] text-axal-muted">{fmt(k.company_count)}</span>
          </Link>
        ))}
      </nav>
      <label className="flex items-center gap-2 text-[12px] font-semibold text-axal-ink dark:text-gray-200">
        Go to a country
        <select aria-label="Go to a country" value={code} onChange={(e) => navigate(`/research/geographies/${e.target.value}`)}
          className="min-h-[36px] rounded-lg border border-axal-hairline bg-white px-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-950">
          {items.some((k) => k.code === code) ? null : <option value={code}>{code}</option>}
          {items.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}
        </select>
      </label>
    </div>
  );
}

/** The licences whose route table reaches a directory company's page. */
const COMPANY_PAGE_ROLES = new Set(['admin', 'founder', 'advisor']);

export function GeographyBody({ data, role = 'founder' }) {
  const { item, totals, as_of: asOf, fund_aggregates: agg } = data;
  const labels = data.companies_by_label || [];
  const maxLabel = Math.max(0, ...labels.map((l) => l.count));
  const maxBand = Math.max(0, ...(agg?.size_bands || []).map((b) => b.count));
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[.1em] text-axal-faint">Country</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.name}</h1>
        <p className="mt-1 text-[13px] text-axal-muted">Companies based here, funds headquartered here, and the signals that name it.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat testId="geo-companies" label="Directory companies" value={fmt(data.company_count)}
          note={`of ${fmt(totals.companies)} · research_company_directory${asOf.companies ? ` · as of ${asOf.companies}` : ''}`} />
        <Stat testId="geo-funds" label="Funds headquartered here" value={fmt(data.fund_count)}
          note={`of ${fmt(totals.funds)} · HQ as the source wrote it${asOf.funds ? ` · as of ${asOf.funds}` : ''}`} />
        <Stat testId="geo-signals" label="Signals naming it" value={fmt(data.signals.length)}
          note={`of ${fmt(totals.signals)} · by country or by region${asOf.signals ? ` · as of ${String(asOf.signals).slice(0, 10)}` : ''}`} />
        <div data-testid="geo-demand" className="rounded-xl border border-dashed border-axal-hairline p-4 dark:border-gray-700">
          <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-axal-faint">Demand in {item.name}</div>
          <div className="mt-1"><Unrecorded reason={data.demand?.reason} /></div>
          <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">{data.demand?.reason}</p>
          <Link to="/research/markets" className="mt-1 inline-block text-[12px] font-semibold text-axal-violet">See worldwide demand by sector →</Link>
        </div>
      </div>

      <Card data-testid="geo-company-section">
        <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Companies based in {item.name}</h2>
        <p className="mt-1 text-[12.5px] text-axal-muted">What the directory’s companies here do, and the largest of them by recorded headcount.</p>
        {data.company_count === 0 ? (
          <p className="mt-3 text-[12.5px] text-axal-muted">No directory company is based in {item.name}.</p>
        ) : (
          <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <h3 className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">By sector label</h3>
              <ul className="mt-2">
                {labels.map((l) => (
                  <li key={l.label} className="grid grid-cols-[1fr_90px_36px] items-center gap-2 py-1 text-[12.5px]">
                    <span className="truncate">{l.label}</span><Bar value={l.count} max={maxLabel} /><span className="text-right font-mono">{fmt(l.count)}</span>
                  </li>
                ))}
                {data.companies_without_label ? (
                  <li className="grid grid-cols-[1fr_90px_36px] items-center gap-2 py-1 text-[12.5px]">
                    <span>No sector label</span><Unrecorded /><span className="text-right font-mono">{fmt(data.companies_without_label)}</span>
                  </li>
                ) : null}
              </ul>
            </div>
            <div className="overflow-x-auto">
              <h3 className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Top companies</h3>
              <p className="text-[11.5px] text-axal-muted">Largest by recorded headcount first; companies with no headcount follow by name.</p>
              <table className="mt-2 w-full min-w-[520px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-axal-hairline text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:border-gray-800">
                    <th className="py-2 pr-3">Company</th><th className="py-2 pr-3">Sector label</th><th className="py-2 pr-3">Founded</th>
                    <th className="py-2 pr-3">Employees</th><th className="py-2">Last round</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companies.map((co) => (
                    <tr key={co.uid} className="border-b border-axal-hairline/60 dark:border-gray-800">
                      <td className="py-2 pr-3">{COMPANY_PAGE_ROLES.has(role)
                        ? <Link to={`/research/companies/company/${encodeURIComponent(co.uid)}`} className="font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{co.name}</Link>
                        : <span className="font-semibold text-axal-ink dark:text-gray-100">{co.name}</span>}</td>
                      <td className="py-2 pr-3">{co.sector || <Unrecorded />}</td>
                      <td className="py-2 pr-3">{co.founded_year ?? <Unrecorded />}</td>
                      <td className="py-2 pr-3 font-mono">{co.employee_count != null ? fmt(co.employee_count) : <Unrecorded />}</td>
                      <td className="py-2">{co.last_round
                        ? [co.last_round.amount != null ? `${fmt(co.last_round.amount)}${co.last_round.currency ? ` ${co.last_round.currency}` : ''}` : null, co.last_round.type].filter(Boolean).join(' · ')
                        : <Unrecorded />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-axal-faint">research_company_directory · country = {item.name}</p>
      </Card>

      <Card data-testid="geo-fund-section">
        <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Funds headquartered in {item.name}</h2>
        <p className="mt-1 text-[12.5px] text-axal-muted">How many, how large, and what they say they back. HQ and focus are free text, read as the sources wrote them.</p>
        {data.fund_count === 0 ? (
          <p className="mt-3 text-[12.5px] text-axal-muted">No fund in the directory names {item.name} as its HQ.</p>
        ) : (
          <>
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-axal-faint">Funds</div>
                <div className="text-2xl font-extrabold">{fmt(agg.count)}</div>
                <p className="text-[11.5px] text-axal-muted">{fmt(agg.with_size)} with a size, {fmt(agg.with_vintage)} with a vintage, {fmt(agg.with_focus)} with a stated focus</p>
              </div>
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-axal-faint">Sizes</div>
                <ul className="mt-1">
                  {agg.size_bands.map((b) => (
                    <li key={b.key} className="grid grid-cols-[110px_1fr_28px] items-center gap-2 py-0.5 text-[12px]">
                      <span>{b.label}</span><Bar value={b.count} max={maxBand} /><span className="text-right font-mono">{fmt(b.count)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-axal-faint">Funds per size band, in euros as reported · {fmt(agg.size_not_recorded)} with no size in a known currency</p>
              </div>
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-[.08em] text-axal-faint">Stated focus</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {agg.focus_keywords.map((k) => <span key={k.label} className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] dark:border-gray-700">{k.label} <span className="font-mono text-axal-muted">{fmt(k.count)}</span></span>)}
                </div>
                <p className="mt-1 text-[11px] text-axal-faint">Most common keywords · {fmt(agg.no_focus)} funds state no focus</p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-axal-hairline text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:border-gray-800">
                    <th className="py-2 pr-3">Fund</th><th className="py-2 pr-3">Size</th><th className="py-2 pr-3">Vintage</th>
                    <th className="py-2 pr-3">Stated focus</th><th className="py-2">EIF / EIFO</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funds.map((f) => (
                    <tr key={f.uid} className="border-b border-axal-hairline/60 dark:border-gray-800">
                      <td className="py-2 pr-3"><span className="font-semibold text-axal-ink dark:text-gray-100">{f.name}</span><div className="text-[11px] text-axal-faint">{f.hq}</div></td>
                      <td className="py-2 pr-3 font-mono">{f.fund_size_cents != null ? euroMillions(f.fund_size_cents) : <Unrecorded reason={f.size_reason} />}</td>
                      <td className="py-2 pr-3">{f.fund_year ?? <Unrecorded />}</td>
                      <td className="py-2 pr-3">{f.sector_focus || <Unrecorded />}</td>
                      <td className="py-2">{backingLabel(f) || <Unrecorded>LPs not recorded</Unrecorded>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-3 text-[11px] text-axal-faint">research_fund_directory · HQ matched to {item.name}{agg?.as_of ? ` · as of ${agg.as_of}` : ''}</p>
      </Card>

      <Card data-testid="geo-signal-section">
        <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Signals for {item.name} and {item.region}</h2>
        <p className="mt-1 text-[12.5px] text-axal-muted">Opportunity signals that name this country, then those that name its region.</p>
        {data.signals.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-axal-muted">No signal names {item.name} or {item.region}.</p>
        ) : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {data.signals.map((s) => (
              <li key={s.id} className="rounded-xl border border-axal-hairline p-4 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full border border-axal-hairline px-2 py-0.5 dark:border-gray-700">{s.sector}</span>
                  <span data-testid="signal-match" className="text-axal-muted">{s.match === 'country' ? `Names ${item.name}` : `Names ${item.region}`}</span>
                </div>
                <h3 className="mt-2 text-[14px] font-bold text-axal-ink dark:text-gray-100">{s.title}</h3>
                <p className="mt-1 text-[12px] text-axal-muted"><span className="font-semibold text-axal-ink dark:text-gray-200">Why now</span> {s.why_now || <Unrecorded />}</p>
                <p className="mt-1 text-[12px] text-axal-muted"><span className="font-semibold text-axal-ink dark:text-gray-200">What a founder could build</span> {s.build_headline || <Unrecorded />}</p>
                <p className="mt-2 text-[11px] text-axal-faint">
                  {s.confidence_score != null ? `Confidence ${Math.round(Number(s.confidence_score) * 100)}%` : 'Confidence not recorded'}
                  {s.updated_at ? ` · updated ${String(s.updated_at).slice(0, 10)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[11px] leading-relaxed text-axal-faint">
        Countries come from the company directory (Wikidata) and from fund HQs as the fund lists wrote them. Market intelligence is worldwide only, so per-country demand reads “Not recorded”.
      </p>
    </div>
  );
}

/** The country page body for each state of its read. */
export function GeographyState({ geo, code, role = 'founder', reload }) {
  if (geo.status === 'loading' && !geo.data) return <p className="text-[12px] text-axal-muted" role="status">Loading {code}…</p>;
  if (geo.status === 'not_found') {
    return <Card data-testid="geography-not-found"><h1 className="text-sm font-extrabold">No country has the code {code}</h1><Link to="/research/geographies" className="mt-2 inline-block text-[12px] text-axal-violet underline">See the countries that are recorded</Link></Card>;
  }
  if (geo.status === 'unreadable') {
    return <Card><Unreadable what={`The country ${code}`} claim="This is not a sign it holds nothing." onRetry={reload} /></Card>;
  }
  return <GeographyBody data={geo.data} role={role} />;
}

export default function GeographyProfile({ role = 'founder' }) {
  const { code = '' } = useParams();
  const upper = code.toUpperCase();
  const [geo, reload] = useRead(() => researchMarketsApi.geography(upper), upper);
  return (
    <div data-testid="geography-profile" className="space-y-4">
      <Link to="/research/geographies" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300"><ArrowLeft size={13} /> Geographies</Link>
      <CountryStrip code={upper} />
      <GeographyState geo={geo} code={upper} role={role} reload={reload} />
    </div>
  );
}
