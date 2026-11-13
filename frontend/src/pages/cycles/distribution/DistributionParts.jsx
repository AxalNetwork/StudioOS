// D4484: shared Distribution presentation; data and every decision belong to the caller.
import React from 'react';
import { Eye, Info, AlertTriangle } from 'lucide-react';
import AskProposal from '../../../ui/AskProposal.jsx';
import { microMoney } from '../../../lib/aiTokens.js';
export function Card({ children, className = '', ...props }) { return <section className={`ds-card ${className}`} {...props}>{children}</section>; }
export function NotRecorded() { return <span className="ds-not-recorded">Not recorded</span>; }
export function KpiCard({ label, value = null, note }) { return <Card><h2 className="ds-eyebrow">{label}</h2><div className="ds-kpi">{value == null ? <NotRecorded /> : value}</div>{note && <p>{note}</p>}</Card>; }
const TONES = new Set(['draft','amber','lavender','positive','negative','muted']);
export function Pill({ tone = 'muted', children }) { return <span className={`ds-pill is-${TONES.has(tone) ? tone : 'muted'}`}><i aria-hidden="true" />{children}</span>; }
export function Chip({ children }) { return <span className="ds-chip">{children}</span>; }
const SOURCES = { mercury:'Mercury', manual:'Manual', connector:'Connector' };
export function SourceChip({ source }) { const key=String(source || '').toLowerCase();return Object.hasOwn(SOURCES,key) ? <span className={`ds-source is-${key}`}><i aria-hidden="true" />{SOURCES[key]}</span> : <NotRecorded />; }
export function ProposalBlock({ proposal, title, children, onAccept, onEdit, onDiscard, busy = false }) {
  return <div className="ds-proposal"><AskProposal proposal={{ ...proposal, eyebrow:title ?? proposal?.eyebrow, text:children ?? proposal?.text }}
    icon={<Eye size={15} aria-hidden="true" />} onAccept={onAccept} onEdit={onEdit} onDiscard={onDiscard} busy={busy} /></div>;
}
export function StatusNote({ tone = 'info', children }) { const warn=tone==='warn'||tone==='negative',Icon=warn?AlertTriangle:Info;return <div role="status" className={`ds-note is-${warn?tone:'info'}`}><Icon size={16} aria-hidden="true" /><span>{children}</span></div>; }
export function Table({ columns = [], children, label }) { return <div className="ds-table-scroll"><table role="table" aria-label={label} className="ds-table"><thead><tr>{columns.map((c)=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
export function ProgressBar({ value, label }) { return typeof value==='number'&&Number.isFinite(value) ? <div className="ds-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0,Math.min(100,value))}><span style={{width:`${Math.max(0,Math.min(100,value))}%`}} /></div> : <NotRecorded />; }
export function HoldLine({ microusd }) { return Number.isSafeInteger(microusd)&&microusd>=0 ? <p className="ds-hold">Holds up to {microMoney(microusd)} · you pay what it uses</p> : <NotRecorded />; }
export function LoadingSkeleton({ label }) { return <div role="status" aria-label={`Loading ${label}`} className="ds-skeleton"><div /><div /><div /><span className="sr-only">Loading {label}…</span></div>; }
export function ComingSoon() { return <Card className="ds-coming-soon">Coming in this module soon</Card>; }
