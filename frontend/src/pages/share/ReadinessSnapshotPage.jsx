/**
 * D6897 (#6897, canvas D6054 RA-30) — `/share/readiness/:token`: the readiness snapshot a founder shared outside
 * Axal, as its reader sees it. No sign-in wall and no Eadwyn. The page is dated and says it does not update. Seven
 * areas, each with its score out of 10, its evidence, what is missing and the day scored; an area with no score reads
 * "Not scored yet", never 0; Team reads "Team is assessed by a person". There is no overall score and no
 * Product-market fit row. A refused link shows the Worker's own page: it names neither the venture nor any score.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { raiseEvidenceShareApi } from '../../lib/api/raiseEvidenceShare';
import { day } from '../cycles/evidence/evidenceView';
import { REFUSAL_FALLBACK } from '../cycles/evidence/shareOutsideModel';

const PAGE = 'mx-auto flex max-w-3xl flex-col gap-4 bg-white p-4 text-axal-ink sm:p-8 dark:bg-gray-950 dark:text-gray-100 print:max-w-none print:p-0';
const MUTED = 'm-0 text-[13px] text-axal-muted dark:text-gray-400';
const CELL = 'border-b border-axal-hairline py-1.5 pr-2 align-top dark:border-gray-800';

/** The page from the Worker's answer; pure in its input, so the test renders every state. */
export function ReadinessSnapshotView({ state }) {
  if (!state || state.status === 'loading') return <main className={PAGE} aria-busy="true" data-testid="readiness-snapshot-loading"><p className={MUTED}>Opening the snapshot…</p></main>;
  if (state.status === 'refused') {
    const r = state.body?.title ? state.body : REFUSAL_FALLBACK;
    return (
      <main className={PAGE} data-testid="readiness-snapshot-refused" data-state={state.body?.state || 'refused'}>
        <h1 className="m-0 text-[20px] font-bold">{r.title}</h1>
        <p className={MUTED}>{r.sentence}</p>
      </main>
    );
  }
  const { snapshot, link } = state.body;
  const areas = Array.isArray(snapshot?.areas) ? snapshot.areas : null;
  return (
    <main className={PAGE} data-testid="readiness-snapshot">
      <header className="flex flex-col gap-1">
        <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400">Fundraising readiness</p>
        <h1 className="m-0 text-[22px] font-bold">{snapshot?.venture || 'Not recorded'}</h1>
        <p className="m-0 text-[13px]" role="note" data-testid="readiness-snapshot-dated">As of {day(link?.made_at) || 'Not recorded'}. This snapshot does not update; ask the sender for a new one.</p>
        {snapshot?.covering_line ? <p className="m-0 border-l-2 border-axal-hairline pl-2 text-[14px] dark:border-gray-700" data-testid="readiness-snapshot-line">{snapshot.covering_line}</p> : null}
      </header>
      {areas ? (
        <table className="w-full border-collapse text-left text-[13px]" data-testid="readiness-snapshot-areas">
          <thead><tr>{['Area', 'Score', 'Evidence', 'What is missing', 'Scored'].map((h) => <th key={h} className="border-b border-axal-hairline py-1.5 pr-2 text-[11px] uppercase text-axal-muted dark:border-gray-800 dark:text-gray-400">{h}</th>)}</tr></thead>
          <tbody>{areas.map((a) => (
            <tr key={a.key} data-testid="readiness-snapshot-area" data-key={a.key}>
              <td className={`${CELL} font-semibold`}>{a.label}</td>
              <td className={CELL} data-testid="readiness-snapshot-score">{a.words}</td>
              <td className={CELL}>{a.evidence || '—'}</td>
              <td className={CELL}>{a.missing || '—'}</td>
              <td className={CELL}>{day(a.scored_on) || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className={MUTED}>Not recorded.</p>}
      <footer className={MUTED}>Shared from Axal by the company’s founders. Scores are out of 10. Link expires {day(link?.expires_at) || 'Not recorded'}.</footer>
    </main>
  );
}

export default function ReadinessSnapshotPage() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    raiseEvidenceShareApi.openReadiness(token)
      .then((r) => { if (!live) return; setState(r.status === 200 && r.body?.state === 'ok' ? { status: 'ready', body: r.body } : { status: 'refused', body: r.body }); })
      .catch(() => { if (live) setState({ status: 'refused', body: { title: 'This page could not be opened', sentence: 'Try again in a moment.' } }); });
    return () => { live = false; };
  }, [token]);
  return <ReadinessSnapshotView state={state} />;
}
