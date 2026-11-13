import React from 'react';
import { BarChart3 } from 'lucide-react';
import { Card } from '../../ui';

const euro = (cents) => cents == null ? 'Not recorded' : `€${(Number(cents) / 100000000).toFixed(0)}m`;

export default function EuroTechFundHistoryChart({ reports = [] }) {
  const points = reports.filter((x) => x.fund_size_cents != null).slice(-12);
  if (!points.length) return null;
  const values = points.map((x) => Number(x.fund_size_cents));
  const max = Math.max(...values, 1);
  const width = Math.max(420, points.length * 72);
  return <Card data-testid="eurotech-fund-history" className="border-violet-200 dark:border-violet-900"><div className="flex items-baseline justify-between gap-3"><div><h2 className="text-sm font-extrabold tracking-tight">Reported fund-size history</h2><p className="mt-1 text-[11px] text-axal-muted">EuroTech spreadsheet observations · latest {points.length} reported periods</p></div><BarChart3 size={16} className="text-violet-700 dark:text-violet-300" /></div><div className="mt-4 overflow-x-auto"><svg viewBox={`0 0 ${width} 190`} width={width} height="190" role="img" aria-label="Reported fund size by period" className="min-w-full"><line x1="24" y1="150" x2={width - 10} y2="150" stroke="currentColor" className="text-gray-200 dark:text-gray-800" strokeWidth="1" />{points.map((point, index) => { const barWidth = Math.max(22, Math.min(42, width / points.length - 12)); const x = 32 + index * (width - 48) / points.length; const height = Math.max(4, Number(point.fund_size_cents) / max * 118); const y = 150 - height; return <g key={`${point.period}-${index}`}><rect x={x} y={y} width={barWidth} height={height} rx="4" fill="#6d28d9" opacity=".82" /><text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="9" fill="currentColor" className="text-axal-muted">{euro(point.fund_size_cents)}</text><text x={x + barWidth / 2} y="168" textAnchor="middle" fontSize="9" fill="currentColor" className="text-axal-faint">{point.period}</text></g>; })}</svg></div><p className="mt-3 text-[10px] leading-relaxed text-axal-faint">This is a reported fund-size series, not a performance chart. NAV, IRR, TVPI, and quarterly returns remain unrecorded unless a fund-specific report is attached in the private dossier.</p></Card>;
}
