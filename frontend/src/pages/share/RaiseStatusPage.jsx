/**
 * D6897 part 4 (#6897, canvas D6054 RA-31 B) — `/share/status/:token`: the Raise status page a founder shared outside
 * Axal, as its reader sees it. No sign-in wall and no Eadwyn. The page is dated and says it does not update.
 *
 * Stage (with the stages before it done), the five materials in state words, investor counts by stage with "No
 * investor names or commitment amounts.", readiness by area as on the snapshot, the next three steps and each connected
 * tool's read state. Everything is the Worker's frozen copy; nothing is recomputed. A refused link shows the Worker's
 * own page, which names neither the venture nor anything on it.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { raiseEvidenceShareApi } from '../../lib/api/raiseEvidenceShare';
import { day } from '../cycles/evidence/evidenceView';
import { REFUSAL_FALLBACK } from '../cycles/evidence/shareOutsideModel';
import { NO_NAMES, investorRows, stageDone, toolLine } from '../cycles/evidence/statusPageModel';

const PAGE = 'mx-auto flex max-w-3xl flex-col gap-4 bg-white p-4 text-axal-ink sm:p-8 dark:bg-gray-950 dark:text-gray-100 print:max-w-none print:p-0';
const MUTED = 'm-0 text-[13px] text-axal-muted dark:text-gray-400';
const CARD = 'flex flex-col gap-2 rounded-xl border border-axal-hairline p-3 dark:border-gray-800';
const H2 = 'm-0 text-[14px] font-bold';
const CELL = 'border-b border-axal-hairline py-1.5 pr-2 align-top dark:border-gray-800';
const NR = 'Not recorded';

function Rows({ rows, testId }) {
  return (
    <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]" data-testid={testId}>
      {rows.map(([k, v]) => <React.Fragment key={k}><dt className="text-axal-muted dark:text-gray-400">{k}</dt><dd className="m-0 text-right font-semibold" data-testid={`${testId}-value`}>{v}</dd></React.Fragment>)}
    </dl>
  );
}

/** The page from the Worker's answer; pure in its input, so the test renders every state. */
export function RaiseStatusView({ state }) {
  if (!state || state.status === 'loading') return <main className={PAGE} aria-busy="true" data-testid="raise-status-loading"><p className={MUTED}>Opening the status page…</p></main>;
  if (state.status === 'refused') {
    const r = state.body?.title ? state.body : REFUSAL_FALLBACK;
    return (
      <main className={PAGE} data-testid="raise-status-refused" data-state={state.body?.state || 'refused'}>
        <h1 className="m-0 text-[20px] font-bold">{r.title}</h1>
        <p className={MUTED}>{r.sentence}</p>
      </main>
    );
  }
  const { status: page, link } = state.body;
  const areas = Array.isArray(page?.readiness?.areas) ? page.readiness.areas : null;
  const materials = Array.isArray(page?.materials) ? page.materials : [];
  const steps = Array.isArray(page?.next_steps) ? page.next_steps : [];
  const tools = Array.isArray(page?.tools) ? page.tools : [];
  const done = stageDone(page?.stage);
  return (
    <main className={PAGE} data-testid="raise-status">
      <header className="flex flex-col gap-1">
        <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400">{page?.venture || NR} · Raise status</p>
        <h1 className="m-0 text-[22px] font-bold">Raise status</h1>
        <p className="m-0 text-[13px]" role="note" data-testid="raise-status-dated">{`Shared on ${day(link?.made_at) || NR}. This shows the raise as of that day; it does not update.`}</p>
      </header>
      <section className={CARD} aria-label="Stage">
        <h2 className={H2}>Stage</h2>
        <p className="m-0 text-[15px] font-bold" data-testid="raise-status-stage">{page?.stage?.label || NR}</p>
        {done ? <p className={MUTED} data-testid="raise-status-stage-done">{done}</p> : null}
      </section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className={CARD} aria-label="Materials">
          <h2 className={H2}>Materials</h2>
          {materials.length ? <Rows rows={materials.map((m) => [m.label || NR, m.words || NR])} testId="raise-status-materials" /> : <p className={MUTED}>{NR}.</p>}
        </section>
        <section className={CARD} aria-label="Investors · counts by stage">
          <h2 className={H2}>Investors · counts by stage</h2>
          <Rows rows={investorRows(page?.investors)} testId="raise-status-investors" />
          <p className={MUTED}>{NO_NAMES}</p>
        </section>
      </div>
      <section className={CARD} aria-label="Readiness by area">
        <h2 className={H2}>Readiness by area</h2>
        {areas ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-[13px]" data-testid="raise-status-areas">
              <thead><tr>{['Area', 'Score', 'Evidence', 'What is missing', 'Scored'].map((h) => <th key={h} className="border-b border-axal-hairline py-1.5 pr-2 text-[11px] uppercase text-axal-muted dark:border-gray-800 dark:text-gray-400">{h}</th>)}</tr></thead>
              <tbody>{areas.map((a) => (
                <tr key={a.key} data-testid="raise-status-area" data-key={a.key}>
                  <td className={`${CELL} font-semibold`}>{a.label}</td>
                  <td className={CELL}>{a.words}</td>
                  <td className={CELL}>{a.evidence || '—'}</td>
                  <td className={CELL}>{a.missing || '—'}</td>
                  <td className={CELL}>{day(a.scored_on) || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={MUTED}>{NR}.</p>}
      </section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className={CARD} aria-label="Next steps">
          <h2 className={H2}>Next steps</h2>
          {steps.length ? (
            <ol className="m-0 flex flex-col gap-1 pl-5 text-[13px]" data-testid="raise-status-steps">
              {steps.map((s, i) => <li key={i}><b>{s.label}</b>{s.text ? ` · ${s.text}` : ''}</li>)}
            </ol>
          ) : <p className={MUTED}>No next step is listed.</p>}
        </section>
        <section className={CARD} aria-label="Connected tools">
          <h2 className={H2}>Connected tools</h2>
          {tools.length ? <Rows rows={tools.map((t) => [t.label || NR, toolLine(t)])} testId="raise-status-tools" /> : <p className={MUTED}>{NR}.</p>}
        </section>
      </div>
      <footer className={MUTED}>Shared from Axal by the company’s founders. Scores are out of 10. Link expires {day(link?.expires_at) || NR} · no sign-in.</footer>
    </main>
  );
}

export default function RaiseStatusPage() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    raiseEvidenceShareApi.openStatus(token)
      .then((r) => { if (!live) return; setState(r.status === 200 && r.body?.state === 'ok' ? { status: 'ready', body: r.body } : { status: 'refused', body: r.body }); })
      .catch(() => { if (live) setState({ status: 'refused', body: { title: 'This page could not be opened', sentence: 'Try again in a moment.' } }); });
    return () => { live = false; };
  }, [token]);
  return <RaiseStatusView state={state} />;
}
