import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Card } from '../../ui';
import data from '../../data/companyDirectory.json';

function Fact({ label, value }) {
  return <div><div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{label}</div><div className="mt-1 text-[13px] text-axal-ink dark:text-gray-100">{value || 'Not recorded'}</div></div>;
}

export default function CompanyProfile() {
  const { uid } = useParams();
  const company = (data.items || []).find((x) => x.uid === uid);
  if (!company) return <Card variant="dashed"><h1 className="text-sm font-extrabold">Company not found</h1><Link to="/research/companies" className="mt-2 inline-block text-[12px] text-axal-violet underline">Back to companies</Link></Card>;
  const analysisUrl = `/build/competitors?market=${encodeURIComponent(company.name)}&website=${encodeURIComponent(company.website)}`;
  return <div data-testid="company-profile" className="space-y-4">
    <Link to="/research/companies" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet underline dark:text-violet-300"><ArrowLeft size={13} /> Companies</Link>
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div><div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Company profile · public baseline</div><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{company.name}</h1><a href={company.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-axal-violet underline">{company.website}<ExternalLink size={12} /></a></div>
      <Link to={analysisUrl} className="inline-flex items-center justify-center rounded-lg bg-violet-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-violet-800">Run competitor analysis →</Link>
    </div>
    <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"><div className="flex items-start gap-2 text-[12px] leading-relaxed text-emerald-950 dark:text-emerald-100"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span><strong>Evidence label:</strong> the facts below are imported from Wikidata. Funding, valuation, revenue, market size, risk, and competitive position are intentionally not inferred from this baseline.</span></div></Card>
    <Card><div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4"><Fact label="Country" value={company.country} /><Fact label="Founded" value={company.founded_year} /><Fact label="Sector" value={company.sector} /><Fact label="Wikidata ID" value={company.uid.toUpperCase()} /></div></Card>
    <div className="grid gap-4 lg:grid-cols-2"><Card><h2 className="text-sm font-extrabold tracking-tight">Competitor research workspace</h2><p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">The analysis tool can assess market players, gaps, positioning, pricing signals, traction signals, and a suggested wedge. Its output is a research artifact, not a sourced fact about this company until the evidence rail is reviewed.</p><Link to={analysisUrl} className="mt-3 inline-block text-[12px] font-semibold text-axal-violet underline">Open analysis with {company.name} prefilled →</Link></Card><Card><h2 className="text-sm font-extrabold tracking-tight">Source</h2><p className="mt-2 text-[12px] text-axal-muted">{company.source_license}</p><a href={company.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] text-axal-violet underline">Open Wikidata record <ExternalLink size={12} /></a><p className="mt-2 text-[11px] text-axal-faint">Retrieved {data.source?.retrieved_at || company.as_of}</p></Card></div>
  </div>;
}
