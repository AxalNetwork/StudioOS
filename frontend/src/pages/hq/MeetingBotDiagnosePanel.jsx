// #3708: the owner's staged diagnostic. One link, one table: where Eadwyn AI stops, why, and the fix.
import React, { useEffect, useState } from 'react';
import { adminMeetingBotsApi } from '../../lib/api/adminMeetingBots';
import { Card } from '../../ui';

const STAGES = {
  site: 'The site reaches the bot', config: 'Google or Zoom setup', container: 'The container starts', browser: 'The browser launches',
  egress: 'Egress to the meeting hosts', join: 'Join attempt', admission: 'Admission', audio: 'Audio frames and first chunk', last_run: 'Your last real run',
};
const RESULT = {
  pass: 'text-emerald-700 dark:text-emerald-300', fail: 'text-red-700 dark:text-red-300',
  skipped: 'text-axal-muted dark:text-gray-400', running: 'text-amber-700 dark:text-amber-300',
};
const label = (s) => String(s).replaceAll('_', ' ');
const field = 'mt-1 w-full rounded-lg border border-axal-hairline bg-axal-ground dark:bg-gray-950 dark:border-gray-700 px-3 py-2 text-sm text-axal-ink dark:text-white';
const button = 'rounded-lg border border-axal-hairline px-3 py-2 text-xs font-bold dark:border-gray-600 hover:bg-axal-ground dark:hover:bg-gray-800 disabled:opacity-50';

export function DiagnosisTable({ diagnosis }) {
  return <div className="mt-4 overflow-x-auto">
    <table className="w-full text-left text-sm" data-testid="diagnosis-table">
      <thead className="text-xs text-axal-muted dark:text-gray-300"><tr><th className="py-1 pr-3">Stage</th><th className="py-1 pr-3">Result</th><th className="py-1 pr-3">What it found</th><th className="py-1">Fix</th></tr></thead>
      <tbody>{diagnosis.rows.map((row) => <tr key={row.stage} className="border-t border-axal-hairline align-top dark:border-gray-700" data-stage={row.stage} data-result={row.result}>
        <td className="py-2 pr-3 font-bold">{STAGES[row.stage] || label(row.stage)}</td>
        <td className={`py-2 pr-3 font-bold capitalize ${RESULT[row.result] || ''}`}>{row.result === 'running' ? 'Running…' : row.result}</td>
        <td className="py-2 pr-3"><span className="font-mono text-xs">{row.code}</span>{Object.keys(row.facts || {}).length > 0 && <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-axal-muted dark:text-gray-300">{Object.entries(row.facts).map(([k, v]) => <React.Fragment key={k}><dt>{label(k)}</dt><dd className="font-mono">{String(v)}</dd></React.Fragment>)}</dl>}</td>
        <td className="py-2 text-xs">{row.fix || '—'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function MeetingBotDiagnosePanel() {
  const [link, setLink] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [diagnosis, setDiagnosis] = useState(null), [shot, setShot] = useState(null);
  useEffect(() => {
    if (!diagnosis?.id || diagnosis.done) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try { const result = await adminMeetingBotsApi.diagnosis(diagnosis.id); if (!cancelled) { setDiagnosis(result.diagnosis); setError(''); } }
      catch { if (!cancelled) setError('The diagnostic could not be read. It may still be running.'); }
    }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [diagnosis?.id, diagnosis?.done]);
  useEffect(() => {
    if (!diagnosis?.screenshot) return;
    let url = null, cancelled = false;
    adminMeetingBotsApi.diagnosisScreenshot(diagnosis.id).then((blob) => { if (!cancelled) { url = URL.createObjectURL(blob); setShot(url); } }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [diagnosis?.id, diagnosis?.screenshot]);
  const start = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setShot(null);
    try { const result = await adminMeetingBotsApi.diagnose(link.trim()); setDiagnosis(result.diagnosis); }
    catch (e) { setError(e?.message || 'The diagnostic could not start.'); }
    finally { setBusy(false); }
  };
  const stop = diagnosis?.stops_at;
  return <Card data-testid="meeting-bot-diagnose">
    <h2 className="font-bold">Diagnose Eadwyn AI</h2>
    <p className="mt-1 text-sm text-axal-muted dark:text-gray-300">Open a Google Meet or Zoom call you host, paste its link, and stay in the call to admit Eadwyn AI. Each stage runs in order and says where it stops. No session, consent or AI tokens are used, and no audio, names or page text are kept. A screenshot of the stopping point is kept for you only.</p>
    <form onSubmit={start} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <label className="text-xs font-bold">Meeting link<input className={field} type="url" autoComplete="off" required maxLength={2048} placeholder="Google Meet or Zoom" value={link} onChange={(e) => setLink(e.target.value)} /></label>
      <button className={button} disabled={busy || (!!diagnosis && !diagnosis.done)}>{busy ? 'Starting…' : 'Diagnose'}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {diagnosis && <>
      <p role="status" className="mt-4 text-sm font-bold">{!diagnosis.done ? 'Running… admit Eadwyn AI when it asks to join.' : stop ? `Stops at: ${STAGES[stop] || label(stop)}.` : 'Every stage passed.'}</p>
      <DiagnosisTable diagnosis={diagnosis} />
      {diagnosis.probe_bytes != null && <p className="mt-2 text-xs text-axal-muted dark:text-gray-300">The Worker received a {diagnosis.probe_bytes}-byte probe chunk (silence the length of the first frames) and kept only its size.</p>}
      {shot && <figure className="mt-4"><img src={shot} alt="The meeting page where Eadwyn AI stopped" className="max-w-full rounded-lg border border-axal-hairline dark:border-gray-700" /><figcaption className="mt-1 text-xs text-axal-muted dark:text-gray-300">The stopping point, visible to you only.</figcaption></figure>}
    </>}
  </Card>;
}
