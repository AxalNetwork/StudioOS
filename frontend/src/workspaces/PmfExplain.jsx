import React, { useEffect, useRef, useState } from 'react';
import Lightbox from '../ui/Lightbox';
import { useRailOption } from '../ui/railCrumbs';
import { railPressHeaders } from '../lib/railPage';
import { pmfExplainApi } from '../lib/api/pmfExplain';
import RunEstimate from './RunEstimate';

const OPTIONS = { explain: 'draft:raise/pmf-explain', questions: 'draft:raise/pmf-questions' };
const BUTTON = 'rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-semibold text-violet-800 disabled:opacity-50 dark:border-violet-700 dark:bg-gray-900 dark:text-violet-200';
const PRIMARY = 'rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-violet-600';
function Citations({ items }) {
  return <div className="space-y-4">{items.map(item => <div key={item.input} className="border-t border-violet-200 py-3 dark:border-violet-800">
    <p className="text-sm leading-relaxed text-gray-900 dark:text-gray-100">{item.text}</p>
    <p className="mt-2 text-xs text-gray-600 dark:text-gray-300"><strong>Cites · {item.citation.label}</strong> · {item.citation.words} · {item.citation.grade.replaceAll('_', ' ')}{item.citation.stale ? ' · stale' : ''}</p>
  </div>)}</div>;
}
/** RD11. Opening and running a preview never saves a reading or changes a score. */
export default function PmfExplain({ projectId, ai }) {
  const [mode, setMode] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [kept, setKept] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState(false);
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);
  const readSerial = useRef(0);
  useRailOption(mode === 'explain' ? 'draft:raise/pmf-explain' : null, 'Explain this score');
  useRailOption(mode === 'questions' ? 'draft:raise/pmf-questions' : null, 'Questions for the next interviews');
  async function load() {
    const current = generation.current; const serial = ++readSerial.current;
    setKept(null); setReadError(false);
    try { const result = await pmfExplainApi.read(projectId); if (current === generation.current && serial === readSerial.current) setKept(result.reading); }
    catch { if (current === generation.current && serial === readSerial.current) setReadError(true); }
  }
  useEffect(() => { generation.current++; setMode(null); setProposal(null); setError(''); setBusy(false); load(); return () => { generation.current++; }; }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(nextMode) {
    const current = generation.current;
    setMode(nextMode); setProposal(null); setError(''); setCopied(false); setBusy(true);
    try {
      const result = await pmfExplainApi.preview(projectId, nextMode, railPressHeaders(OPTIONS[nextMode]));
      if (current === generation.current) setProposal(result);
    } catch (e) {
      if (current === generation.current) setError(e?.code === 'assist_off' ? 'Eadwyn is off for this page. Switch to AI to run a reading.' : e?.status === 402 ? 'Your AI allowance cannot cover this run. Add AI tokens to continue.' : e?.status === 409 ? 'Not recorded: open the current readiness inputs before asking Eadwyn.' : 'The reading is Unreadable. Try again.');
    } finally { if (current === generation.current) setBusy(false); }
  }
  async function keep() {
    const current = generation.current; setBusy(true); setError('');
    try {
      const result = await pmfExplainApi.keep(projectId, proposal.receipt);
      if (current === generation.current) { readSerial.current++; setKept(result.reading); setReadError(false); setMode(null); setProposal(null); }
    } catch (e) { if (current === generation.current) setError(e?.status === 409 ? 'The reading expired or its inputs changed. Explain the current inputs again.' : 'The reading could not be kept. Try again.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(proposal.items.map(i => `${i.text}\nCites · ${i.citation.label}: ${i.citation.words}`).join('\n\n')); setCopied(true); }
    catch { setError('Copy is unavailable. Select the questions and copy them.'); }
  }
  const close = () => { if (!busy) { setMode(null); setProposal(null); setError(''); } };
  return <section className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30" data-testid="pmf-explain">
    <h3 className="text-base font-bold text-violet-900 dark:text-violet-100">Eadwyn</h3>
    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Reads the recorded inputs. It never changes a score.</p>
    <RunEstimate ai={ai} task="workspace_explain" />
    <div className="mt-3 flex flex-wrap gap-2"><button className={BUTTON} disabled={busy} onClick={() => run('explain')}>Explain this score</button><button className={BUTTON} disabled={busy} onClick={() => run('questions')}>Questions for the next interviews</button></div>
    {readError && <p className="mt-3 text-sm text-gray-700 dark:text-gray-300" role="status">Kept reading · Unreadable. <button className={BUTTON} onClick={load}>Try again</button></p>}
    {kept && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-violet-800 dark:text-violet-200">Kept reading</summary><p className="mt-2 text-xs text-gray-600 dark:text-gray-300">From the inputs captured when kept. Explain again to read the current inputs.</p><Citations items={kept.items} /></details>}
    {mode && <Lightbox label={mode === 'explain' ? 'Explain this score' : 'Questions for the next interviews'} onClose={close} width={680}>
      <div className="max-h-[85vh] overflow-y-auto p-5" data-testid="pmf-explain-dialog">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{mode === 'explain' ? 'Proposal · plain-language reading' : 'Questions for the next interviews'}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{mode === 'explain' ? 'Keep saves this reading for you. The score continues to come from the recorded inputs.' : 'Copy these questions for your next interviews, or dismiss them.'}</p>
        {busy && <p className="mt-4 text-sm text-gray-700 dark:text-gray-300" role="status">Reading the inputs…</p>}
        {error && <p className="mt-4 text-sm text-gray-700 dark:text-gray-300" role="alert">{error} <button className={BUTTON} disabled={busy} onClick={() => run(mode)}>Try again</button></p>}
        {proposal && <Citations items={proposal.items} />}
        <div className="mt-4 flex flex-wrap gap-2">
          {proposal && (mode === 'explain' ? <button className={PRIMARY} disabled={busy} onClick={keep}>Keep this reading</button> : <button className={PRIMARY} onClick={copy}>{copied ? 'Copied' : 'Copy questions'}</button>)}
          <button className={BUTTON} disabled={busy} onClick={close}>Dismiss</button>
        </div>
      </div>
    </Lightbox>}
  </section>;
}
