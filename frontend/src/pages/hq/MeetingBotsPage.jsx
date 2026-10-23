import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminMeetingBotsApi } from '../../lib/api/adminMeetingBots';
import { Card } from '../../ui';

const platforms = { zoom: 'Zoom', google_meet: 'Google Meet', teams: 'Microsoft Teams' };
const number = (n) => n == null ? 'Not recorded' : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n);
const usd = (n) => n == null ? 'Not recorded' : new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(n / 1e6);
const percent = (n) => n == null ? 'Not recorded' : `${number(n / 100)}%`;
const label = (s) => s.replaceAll('_', ' ');
const field = 'mt-1 w-full rounded-lg border border-axal-hairline bg-axal-ground dark:bg-gray-950 dark:border-gray-700 px-3 py-2 text-sm text-axal-ink dark:text-white';
const button = 'rounded-lg border border-axal-hairline px-3 py-2 text-xs font-bold dark:border-gray-600 hover:bg-axal-ground dark:hover:bg-gray-800 aria-pressed:bg-axal-ink aria-pressed:text-white dark:aria-pressed:bg-gray-200 dark:aria-pressed:text-gray-950 disabled:opacity-50';

function Metric({ title, value, note }) {
  return <div className="min-w-0 rounded-lg border border-axal-hairline dark:border-gray-700 p-3"><dt className="text-xs text-axal-muted dark:text-gray-300">{title}</dt><dd className="mt-1 break-words text-lg font-bold">{value}</dd>{note && <p className="mt-1 text-xs text-axal-faint dark:text-gray-400">{note}</p>}</div>;
}

export function BotOperationsPanel({ report, pricing, range, setRange }) {
  const period = report?.state === 'ok' ? report[range] : null;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Run window" className="flex flex-wrap gap-2">{[['today','Today'],['days7','7 days'],['days30','30 days']].map(([key,title]) => <button key={key} className={button} aria-pressed={range === key} onClick={() => setRange(key)}>{title}</button>)}</div>
      <p className="text-xs text-axal-faint dark:text-gray-400">UTC · runs created in the selected window</p>
    </div>
    {report?.state !== 'ok' ? <Card><h2 className="font-bold">{report?.state === 'not_recorded' ? 'Not recorded' : 'Unreadable'}</h2><p className="mt-2 text-sm text-axal-muted dark:text-gray-300">{report?.reason || 'Meeting bot operations could not be read.'}</p></Card> : <>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Runs" value={number(period.runs)} />
        <Metric title="Bot minutes" value={number(period.bot_minutes)} note={`${period.measured_runtime_runs} of ${period.runs} runs have settled bot minutes; includes waiting rooms.`} />
        <Metric title="Audio minutes" value={number(period.recorded_minutes)} note={`${period.measured_minutes_runs} of ${period.runs} runs have transcribed audio attributed.`} />
        <Metric title="Bot AI tokens charged" value={usd(period.financials.charged_microusd)} note="Settled ledger charges only. Transcription is separate." />
      <Metric title="Audio AI tokens charged" value={usd(period.audio_charged_microusd)} note={`${period.measured_audio_charge_runs ?? 0} of ${period.runs} runs have settled transcription charges attributed.`} />
      </dl>
      <Card><h2 className="font-bold">Runs by platform and status</h2>{period.runs === 0 && <p className="mt-2 text-sm text-axal-muted dark:text-gray-300">No runs recorded in this window.</p>}
        <div className="mt-3 grid gap-3 lg:grid-cols-3">{period.platforms.map(p => <section key={p.platform} className="rounded-lg border border-axal-hairline p-3"><h3 className="text-sm font-bold">{platforms[p.platform]} · {number(p.runs)}</h3><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">{Object.entries(p.statuses).map(([status,count]) => <React.Fragment key={status}><dt className="capitalize text-axal-muted dark:text-gray-300">{label(status)}</dt><dd className="text-right tabular-nums">{number(count)}</dd></React.Fragment>)}</dl></section>)}</div>
      </Card>
      <Card><h2 className="font-bold">Failure codes</h2>{period.failures.length ? <ul className="mt-2 space-y-2 text-sm">{period.failures.map(f => <li key={`${f.platform}:${f.code}`} className="flex flex-wrap justify-between gap-2 border-b border-axal-hairline pb-2"><span>{platforms[f.platform]} · {label(f.code)}</span><b>{number(f.runs)}</b></li>)}</ul> : <p className="mt-2 text-sm text-axal-muted dark:text-gray-300">No failures recorded in this window.</p>}</Card>
      <Card><h2 className="font-bold">Measured cost and realised markup</h2><p className="mt-1 text-xs text-axal-muted dark:text-gray-300">Terminal runs in the selected window. Incomplete measurements remain Not recorded.</p><dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Supplier cost" value={usd(period.financials.provider_cost_microusd)} note={`${period.financials.measured_cost_runs} of ${period.financials.terminal_runs} terminal runs measured.`} />
        <Metric title="Supplier cost / bot-hour" value={usd(period.financials.cost_per_bot_hour_microusd)} />
        <Metric title="Realised markup" value={percent(period.financials.realised_markup_bps)} note="Target: 25% of supplier cost." />
        <Metric title="Gross margin" value={percent(period.financials.realised_margin_bps)} note="Target: 20% of charged price." />
      </dl></Card>
      <Card><h2 className="font-bold">Operations alerts</h2><p className="mt-1 text-xs text-axal-muted dark:text-gray-300">Failure rate above 30% in 24 hours · missed heartbeat · realised markup below 15% over 7 days. Sent to HQ Super Admins in the app.</p>
        {report.alerts.length ? <ul className="mt-3 space-y-2 text-sm">{report.alerts.map((a,i) => <li key={i} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{a.kind === 'failure_rate' ? `${platforms[a.platform]}: ${a.failed} of ${a.completed} completed runs failed (${percent(a.rate_bps)}).` : a.kind === 'missed_heartbeat' ? `${platforms[a.platform]}: ${a.runs} active runs missed a heartbeat.` : `Realised markup is ${percent(a.markup_bps)}, below 15%.`}</li>)}</ul> : <p className="mt-3 text-sm text-axal-muted dark:text-gray-300">No alerts among the available measurements.</p>}
        {report.heartbeat_unknown_runs > 0 && <p className="mt-2 text-xs text-axal-faint dark:text-gray-400">{report.heartbeat_unknown_runs} active runs have no recorded heartbeat deadline.</p>}
      </Card>
    </>}
    {pricing && <Card><h2 className="font-bold">Canary price ceiling</h2><dl className="mt-3 grid gap-3 sm:grid-cols-2"><Metric title="Bot price ceiling / minute" value={usd(pricing.bot_per_minute_microusd)} /><Metric title="Supplier cost ceiling / minute" value={usd(pricing.supplier_per_minute_microusd)} /></dl><p className="mt-3 text-xs text-axal-muted dark:text-gray-300">{pricing.note}</p><p className="mt-2 text-xs text-axal-faint dark:text-gray-400">{pricing.audio_note}</p></Card>}
  </>;
}

export default function MeetingBotsPage() {
  const [data,setData] = useState(null), [range,setRange] = useState('days7'), [reading,setReading] = useState(false);
  const [session,setSession] = useState(''), [link,setLink] = useState(''), [live,setLive] = useState(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    setReading(true);
    try { const result = await adminMeetingBotsApi.read(); if (mounted.current) setData(result); }
    catch { if (mounted.current) setData({ operations: { state: 'unreadable', reason: 'Meeting bot operations could not be read.' } }); }
    finally { if (mounted.current) setReading(false); }
  },[]);
  useEffect(() => { mounted.current = true; refresh(); return () => { mounted.current = false; }; },[refresh]);
  useEffect(() => {
    if (!live?.uid || ['done','failed','stopped'].includes(live.status)) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try { const result = await adminMeetingBotsApi.test(live.uid); if (!cancelled) { setLive(result.test); setError(''); } }
      catch { if (!cancelled) setError('The check timings could not be read. The bot may still be running.'); }
    },5000);
    return () => { cancelled = true; clearInterval(timer); };
  },[live?.uid,live?.status]);
  const start = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await adminMeetingBotsApi.startTest(Number(session),link.trim()); setLive(result.test); setLink(''); refresh(); }
    catch { setError('The check could not start. Confirm that your fresh audio session has consent, enough AI tokens, and that meeting bots are enabled. Check the session before retrying.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4 text-axal-ink dark:text-white" data-testid="meeting-bots-page">
    <Link to="/admin/platform" className="text-xs font-bold text-axal-muted dark:text-gray-300">← Platform</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-extrabold tracking-tight">Meeting bots</h1><p className="mt-1 text-sm text-axal-muted dark:text-gray-300">HQ operations · counts, timing and cost</p></div><button className={button} disabled={reading} onClick={refresh}>{reading ? 'Reading…' : 'Refresh'}</button></header>
    {data ? <BotOperationsPanel report={data.operations} pricing={data.pricing} range={range} setRange={setRange} /> : <p role="status" className="text-sm text-axal-muted dark:text-gray-300">Reading meeting bot operations…</p>}
    <Card><h2 className="font-bold">Test Eadwyn AI</h2><p className="mt-1 text-sm text-axal-muted dark:text-gray-300">Send Eadwyn AI to a test meeting. First create a fresh audio session in Validate and record consent. This uses your session and the usual AI-token charges.</p>
      <form onSubmit={start} className="mt-4 grid gap-3 sm:grid-cols-[9rem_1fr_auto] sm:items-end">
        <label className="text-xs font-bold">Your session ID<input className={field} type="number" min="1" step="1" required value={session} onChange={e => setSession(e.target.value)} /></label>
        <label className="text-xs font-bold">Meeting link<input className={field} type="url" autoComplete="off" required maxLength={2048} placeholder="Zoom, Google Meet or Teams" value={link} onChange={e => setLink(e.target.value)} /></label>
        <button className={button} disabled={busy || !!live && !['done','failed','stopped'].includes(live.status)}>{busy ? 'Sending…' : 'Test Eadwyn AI'}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {live && <div className="mt-4 rounded-lg border border-axal-hairline p-3"><h3 className="text-sm font-bold">{platforms[live.platform]} · {label(live.status)}</h3>{live.failure_code && <p className="mt-1 text-xs text-axal-muted dark:text-gray-300">{label(live.failure_code)}</p>}<ol className="mt-3 space-y-2 text-sm">{live.stages.map((s,i) => <li key={`${s.stage}:${i}`} className="flex flex-wrap justify-between gap-2"><span className="capitalize">{label(s.stage)}</span><span className="text-xs tabular-nums text-axal-muted dark:text-gray-300">Reached +{number(s.elapsed_ms / 1000)}s · {s.duration_ms == null ? 'complete' : `${number(s.duration_ms / 1000)}s in stage`}</span></li>)}</ol><p className="mt-3 text-xs text-axal-faint dark:text-gray-400">{live.timing_basis}</p><p className="mt-2 text-xs text-axal-faint dark:text-gray-400">Stop the bot from the session’s bot controls.</p></div>}
    </Card>
  </div>;
}
