/**
 * D6862 (#6862, D6021 V17, V18, V22 A/B, V23 A) — on Record a decision: the
 * evidence offered for the chosen scope as an E-numbered table with the
 * coverage sentence, and Eadwyn's task "Read the evidence for this decision".
 *
 * The task reads only the rows checked here (`routes/verdict_summary.ts`), and
 * answers rows, each citing one row (E1…), sorted by the Worker into
 * Contradicts, Supports and Checked but not counted, with what would change
 * it. It never picks Proceed, Pivot or Stop: the form's Decision stays the
 * page's own. Use as reasoning places the text in Reasoning, where the founder
 * edits it; nothing is saved unless the decision is recorded.
 *
 * #5130's rail task system is not on `main`, so the task card is drawn here,
 * inside the form (FormLightbox's assistant slot, `formAssistants.js`), and on
 * a phone it opens as a bottom sheet. States (V18): not run with its quoted
 * hold (A), reading (B), Eadwyn off (C), not available with nothing charged
 * (D), evidence Unavailable (E), out of date (F), no evidence (G).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Unrecorded, Unreadable } from '../../ui/Honesty.jsx';
import { PhoneSheet } from '../../ui/phone/PhoneSheet.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { formatMicro } from '../../lib/money.js';
import { decisionSummaryApi } from '../../lib/api/decisionSummary.js';
import { ventureRef, ventureSearch } from './ventureQuery.js';
import { recordHref } from './recordModel.js';
import { cardState, coverage, offeredRows, reasoningText, scopeWord, staleness, summaryGroups, towardWord } from './verdictEvidenceModel.js';

const BTN = 'inline-flex min-h-9 items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-lg:min-h-11';
const PRIMARY = 'inline-flex min-h-9 items-center justify-center rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600 max-lg:min-h-11';
const EYEBROW = 'text-[10px] font-extrabold uppercase tracking-[0.09em] text-axal-muted dark:text-gray-400';
const CARD = 'flex flex-col gap-2.5 rounded-xl border border-axal-hairline bg-white p-3.5 dark:border-gray-700 dark:bg-gray-900';

function Direction({ value }) {
  if (!value) return <Unrecorded>Direction not recorded</Unrecorded>;
  const against = value === 'contradicts';
  return <span className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ' + (against
    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300')}>
    <span aria-hidden="true">{against ? '−' : '+'}</span>{against ? 'Contradicts' : 'Supports'}</span>;
}

function Toward({ row }) {
  const word = towardWord(row);
  if (!word) return <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">Counted</span>;
  return <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{word}</span>;
}

/** The E-numbered table (V17) and, below 1024px, the same rows as cards (V22 A). */
function EvidenceTable({ rows, scope, highlight, phone }) {
  if (phone) {
    return <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={`Evidence offered for ${scope}`}>
      {rows.map((r) => <li key={r.key} id={`vev-${r.n}`} className={'rounded-[10px] border p-2.5 text-[12.5px] ' + (highlight === r.n
        ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900')}>
        <div className="flex items-start gap-2"><b className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">E{r.n}</b>
          <div className="min-w-0 flex-1"><p className="m-0 font-bold text-axal-ink dark:text-gray-100">{r.label}</p>
            <p className="m-0 text-axal-muted dark:text-gray-400">{[r.strength ?? 'Strength not recorded', r.date, r.kind].filter(Boolean).join(' · ')}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2"><Direction value={r.direction} /><Toward row={r} /></div></div></div>
      </li>)}
    </ul>;
  }
  return <div className="overflow-x-auto rounded-[10px] border border-axal-hairline dark:border-gray-700">
    <table className="w-full border-collapse text-left text-[12px]">
      <caption className="sr-only">Evidence offered for {scope}</caption>
      <thead className="bg-axal-ground dark:bg-gray-800"><tr>
        {['Row', 'Evidence', 'Strength', 'Date', 'Direction', 'Toward the bar'].map((h) => <th key={h} scope="col" className={EYEBROW + ' px-2 py-1.5'}>{h}</th>)}
      </tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key} id={`vev-${r.n}`} className={'border-t border-axal-hairline dark:border-gray-700 ' + (highlight === r.n ? 'bg-axal-lavender dark:bg-violet-900/30' : r.checked ? '' : 'opacity-70')}>
        <td className="px-2 py-1.5 font-mono text-axal-muted dark:text-gray-400">E{r.n}</td>
        <td className="px-2 py-1.5 text-axal-ink dark:text-gray-100"><b>{r.label}</b>{r.kind && <span className="block text-[11px] text-axal-muted dark:text-gray-400">{r.kind}</span>}</td>
        <td className="px-2 py-1.5 text-axal-ink dark:text-gray-200">{r.strength ?? <Unrecorded>Strength not recorded</Unrecorded>}</td>
        <td className="px-2 py-1.5 font-mono text-axal-muted dark:text-gray-400">{r.date ?? <Unrecorded />}</td>
        <td className="px-2 py-1.5"><Direction value={r.direction} /></td>
        <td className="px-2 py-1.5"><Toward row={r} /></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Cite({ n, onCite }) {
  return <button type="button" onClick={() => onCite(n)} aria-label={`Go to evidence row E${n}`}
    className="mr-1.5 rounded border border-axal-hairline px-1 font-mono text-[11px] font-bold text-axal-violet dark:border-gray-700 dark:text-violet-300">E{n}</button>;
}

function Group({ title, lines, onCite, tone }) {
  if (!lines.length) return null;
  return <section className="flex flex-col gap-1">
    <h4 className={'m-0 text-[12px] font-extrabold ' + (tone === 'c' ? 'text-red-700 dark:text-red-300' : tone === 's' ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-ink dark:text-gray-100')}>{title}</h4>
    <ul className="m-0 flex list-none flex-col gap-1 p-0">{lines.map((l) => <li key={l.key} className="text-[12.5px] leading-snug text-axal-ink dark:text-gray-200">
      <Cite n={l.n} onCite={onCite} />{l.text}{l.reason && <span className="text-axal-muted dark:text-gray-400"> · {l.reason}</span>}</li>)}</ul>
  </section>;
}

/** The task card: its seven states and its three actions. */
function TaskCard({ state, rows, scope, quote, run, cov, onRun, onUse, onCopy, onDiscard, onCite, copied, hypothesisHref, sub }) {
  const head = <div className="flex flex-col gap-0.5"><span className={EYEBROW}>Task · this decision</span>
    <b className="text-[13.5px] text-axal-ink dark:text-gray-100">Read the evidence for this decision</b>
    <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{sub}</span></div>;
  const hold = quote?.ai && Number.isFinite(quote.hold_microusd) ? formatMicro(quote.hold_microusd, 'USD') : null;
  const holdLine = <p className="m-0 flex gap-1.5 text-[12px] text-axal-muted dark:text-gray-400"><span aria-hidden="true">◔</span>
    <span>{hold ? <>Holds up to <b className="text-axal-ink dark:text-gray-100">{hold}</b> of your allowance before it runs.</> : 'The hold for this read is shown before it runs.'} The model and allowance stay in AI settings.</span></p>;
  if (state === 'none') return <div className={CARD} data-testid="verdict-task" data-state="none">{head}
    <Unrecorded>None · 0 rows linked to {scope}</Unrecorded>
    <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-200"><b>Nothing to read yet.</b> Link evidence to a hypothesis first.</p>
    <a className={BTN + ' self-start'} href={hypothesisHref}>Go to Hypotheses</a></div>;
  if (state === 'unchecked') return <div className={CARD} data-testid="verdict-task" data-state="unchecked">{head}
    <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-200">Check the evidence this decision rests on, and Eadwyn reads those rows.</p></div>;
  if (state === 'off') return <div className={CARD} data-testid="verdict-task" data-state="off">{head}
    <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-200"><b>Eadwyn is off for your account.</b> Turn it on in <a className="font-bold text-axal-violet dark:text-violet-300" href="/settings/ai">AI settings</a>. The evidence list and the decision work unchanged.</p></div>;
  if (state === 'unavailable') return <div className={CARD} data-testid="verdict-task" data-state="unavailable">{head}
    <div role="status" className="rounded-[10px] border border-amber-200 bg-amber-50 p-2.5 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <b>{run?.message || quote?.message || 'Eadwyn is not available right now.'}</b><p className="m-0 mt-1">Nothing was run and nothing was charged.</p></div>
    <a className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300" href="/settings/ai">AI settings</a></div>;
  if (state === 'failed') return <div className={CARD} data-testid="verdict-task" data-state="failed">{head}
    <Unreadable what="The evidence" claim="No summary is drawn over a failed read, and nothing was charged." onRetry={onRun} size="block" />
    {run?.message && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{run.message}</p>}</div>;
  if (state === 'reading') return <div className={CARD} aria-busy="true" data-testid="verdict-task" data-state="reading">{head}
    <span role="status" className="text-[12px] font-bold text-axal-muted dark:text-gray-400">Reading the evidence…</span>
    <div className="flex flex-col gap-2">{[70, 92, 84, 60, 88].map((w) => <span key={w} className="h-[11px] animate-pulse rounded bg-axal-ground dark:bg-gray-800" style={{ width: `${w}%` }} />)}</div>
    <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">The form and the decision stay usable.</p></div>;
  if (state === 'idle') return <div className={CARD} data-testid="verdict-task" data-state="idle">{head}
    <p className="m-0 text-[12.5px] leading-snug text-axal-ink dark:text-gray-200">Eadwyn sorts the evidence checked for this decision into contradicts, supports and not counted, and lists what would change it. Every line cites one row. It never picks a decision.</p>
    {holdLine}<button type="button" className={PRIMARY + ' self-start'} onClick={onRun}>Read the evidence</button></div>;
  const g = summaryGroups(run.result, rows);
  const old = state === 'stale' ? staleness(run.result, rows) : null;
  const change = run.result?.change;
  const counted = run.result?.coverage;
  return <div className={CARD + (old ? ' opacity-95' : '')} data-testid="verdict-task" data-state={state}>{head}
    {old && <div role="status" className="rounded-[10px] border border-amber-200 bg-amber-50 p-2.5 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <b>Out of date.</b> The checked evidence changed since this ran{old.added.length ? `: ${old.added.length} ${old.added.length === 1 ? 'row' : 'rows'} added (${old.added.map((r) => `E${r.n}`).join(', ')})` : ''}{old.removed ? `${old.added.length ? ',' : ':'} ${old.removed} removed` : ''}.
      <div className="mt-1.5"><button type="button" className={BTN} onClick={onRun}>Run again{hold ? ` · holds up to ${hold}` : ''}</button></div></div>}
    <Group tone="c" title={`− Contradicts · ${g.contradicts.length}`} lines={g.contradicts} onCite={onCite} />
    <Group tone="s" title={`+ Supports · ${g.supports.length}`} lines={g.supports} onCite={onCite} />
    <Group title={`∅ Checked but not counted · ${g.not_counted.length}`} lines={g.not_counted} onCite={onCite} />
    <section className="flex flex-col gap-1"><h4 className="m-0 text-[12px] font-extrabold text-axal-ink dark:text-gray-100">↺ What would change this · {scope}</h4>
      {change ? <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12.5px]">
        <dt className="text-axal-muted dark:text-gray-400">Disproof</dt><dd className="m-0 text-axal-ink dark:text-gray-200">{change.disproof ?? <><Unrecorded /> <a className="font-bold text-axal-violet dark:text-violet-300" href={hypothesisHref}>Add to {scope}</a></>}</dd>
        <dt className="text-axal-muted dark:text-gray-400">Success bar</dt><dd className="m-0 text-axal-ink dark:text-gray-200">{change.success_bar ?? <Unrecorded />}</dd>
        <dt className="text-axal-muted dark:text-gray-400">Deadline</dt><dd className="m-0 font-mono text-axal-ink dark:text-gray-200">{change.deadline ?? <Unrecorded />}</dd>
      </dl> : <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">A decision for the venture has no disproof or success bar of its own.</p>}</section>
    <p className="m-0 text-[12px] text-axal-ink dark:text-gray-200"><b>{counted ? `${counted.counted} of ${counted.bar}` : cov.lead}</b> distinct sources counted. {(counted ? counted.state === 'withheld' : cov.withheld) ? 'A decision recorded now would be kept as Withheld.' : 'A decision recorded now would be given.'}</p>
    <p className="m-0 text-[12px] font-bold text-axal-ink dark:text-gray-100">Eadwyn doesn’t choose. Proceed, Pivot and Stop are yours.</p>
    <div className="flex flex-wrap gap-2 max-lg:flex-col">
      <button type="button" className={BTN} onClick={onUse}>Use as reasoning</button>
      <button type="button" className={BTN} onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</button>
      <button type="button" className={BTN + ' border-transparent'} onClick={onDiscard}>Discard</button>
    </div>
    <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Saved nowhere unless you record it as reasoning.</span></div>;
}

export default function VerdictEvidencePanel({ fields, values, setValue, busy, search = '' }) {
  const projectId = ventureRef(search)?.id ?? null;
  const rows = useMemo(() => offeredRows(fields, values), [fields, values]);
  const scope = scopeWord(fields, values);
  const cov = coverage(rows, scope);
  const phone = usePhoneWidth();
  const [quote, setQuote] = useState(null);
  const [run, setRun] = useState(null);
  const [copied, setCopied] = useState(false);
  const [highlight, setHighlight] = useState(null);
  const [sheet, setSheet] = useState(false);
  const opener = useRef(null);
  const checked = rows.filter((r) => r.checked).map((r) => r.key);
  const body = { for: values?.for || 'venture', evidence: checked };
  const bodyKey = JSON.stringify(body);
  // The quoted hold, read again when the checked rows change; it runs and holds nothing.
  useEffect(() => {
    if (!projectId || !checked.length || run) return undefined;
    let live = true;
    const t = setTimeout(() => {
      decisionSummaryApi.quote(projectId, body).then((q) => { if (live) setQuote(q); }, () => { if (live) setQuote(null); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, bodyKey, !!run]);
  const go = () => {
    if (!projectId) return;
    setRun({ status: 'reading' }); setCopied(false);
    decisionSummaryApi.run(projectId, body).then(
      (result) => setRun({ status: 'ready', result }),
      (e) => {
        const status = Number(e?.status);
        setRun({ status: 'failed', code: e?.code ?? null, message: e?.message ?? null,
          // A budget stop, a guard or an unreachable model: nothing ran, nothing was charged (D). A failed evidence read is E.
          unavailable: e?.code !== 'evidence_unreadable' && (status === 402 || status === 422 || e?.code === 'model_unavailable' || e?.code === 'summary_unmatched' || status === 403) });
      },
    );
  };
  const text = run?.status === 'ready' ? reasoningText(run.result, rows, scope) : '';
  const cite = (n) => {
    setHighlight(n); setSheet(false);
    document.getElementById(`vev-${n}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };
  const state = cardState({ rows, quote, run });
  const hypothesisMatch = /^h-([1-9][0-9]*)$/.exec(String(values?.for ?? ''));
  const hypothesisHref = hypothesisMatch && projectId ? recordHref('validate', 'experiments', hypothesisMatch[1], ventureSearch(projectId)) ?? '/validate/experiments'
    : `/validate/experiments${projectId ? ventureSearch(projectId) : ''}`;
  const card = <TaskCard state={state} rows={rows} scope={scope} quote={quote} run={run} cov={cov} copied={copied} hypothesisHref={hypothesisHref}
    sub={`${scope} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} offered${checked.length !== rows.length ? ` · ${checked.length} checked` : ''}`}
    onRun={go} onCite={cite} onDiscard={() => { setRun(null); setCopied(false); }}
    onUse={() => { if (!busy && text) setValue('reasoning', text.slice(0, 4000)); setSheet(false); }}
    onCopy={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }} />;
  return <section className="flex flex-col gap-3" data-testid="verdict-evidence" aria-label="Evidence and Eadwyn">
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="m-0 text-[13.5px] font-extrabold text-axal-ink dark:text-gray-100">Evidence this decision can rest on</h3>
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{rows.length} offered · all time · for {scope}</span></div>
      {rows.length ? <EvidenceTable rows={rows} scope={scope} highlight={highlight} phone={phone} /> : null}
      <p role="status" data-testid="verdict-coverage" className="m-0 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <b className="font-mono">{cov.lead}</b>{cov.text}<b>{cov.tail}</b></p>
    </div>
    {phone && state !== 'none' ? <>
      <button ref={opener} type="button" className={BTN} onClick={() => setSheet(true)}>Read the evidence with Eadwyn</button>
      {sheet && <PhoneSheet label="Eadwyn · Read the evidence" title="Read the evidence" opener={opener} onClose={() => setSheet(false)}>{card}</PhoneSheet>}
    </> : card}
  </section>;
}
