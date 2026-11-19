/**
 * D6864 (#6864, canvas D6054 RA-28, RA-36) — `/share/evidence/:token`: the evidence pack a founder shared outside
 * Axal, as its reader sees it. No sign-in wall and no Eadwyn. The page is dated and says it does not update. Before
 * an NDA it shows coverage only (area, kind, source, count, newest day); after one it shows each item with its
 * source, day and strength, a figure only where the founder shared it After NDA, and Value withheld with its reason.
 * A Mismatch is never hidden; the founder's note sits under it. A refused link shows the Worker's own page: it names
 * neither the venture nor any evidence. Print styles give the A4 copy (RA-28 C).
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { raiseEvidenceShareApi } from '../../lib/api/raiseEvidenceShare';
import { day, figure, itemTitle, sourceWord } from '../cycles/evidence/evidenceView';
import { claimWord } from '../cycles/evidence/evidenceModel';
import { REFUSAL_FALLBACK } from '../cycles/evidence/shareOutsideModel';

const PAGE = 'mx-auto flex max-w-3xl flex-col gap-4 bg-white p-4 text-axal-ink sm:p-8 dark:bg-gray-950 dark:text-gray-100 print:max-w-none print:p-0';
const MUTED = 'm-0 text-[13px] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-bold';
const STRENGTH = { anecdote: 'Anecdote', pattern: 'Pattern', measured: 'Measured' };

export function groupsByArea(rows) {
  const by = new Map();
  for (const r of rows || []) by.set(r.area, [...(by.get(r.area) || []), r]);
  return [...by.entries()];
}

/** The page from the Worker's answer; pure in its input, so the test renders every state. */
export function EvidencePackView({ state }) {
  if (!state || state.status === 'loading') return <main className={PAGE} aria-busy="true" data-testid="evidence-pack-loading"><p className={MUTED}>Opening the pack…</p></main>;
  if (state.status === 'refused') {
    const r = state.body?.title ? state.body : REFUSAL_FALLBACK;
    return (
      <main className={PAGE} data-testid="evidence-pack-refused" data-state={state.body?.state || 'refused'}>
        <h1 className="m-0 text-[20px] font-bold">{r.title}</h1>
        <p className={MUTED}>{r.sentence}</p>
      </main>
    );
  }
  const { pack, link } = state.body;
  const after = !!pack?.nda_signed;
  const coverage = pack?.coverage?.state === 'recorded' ? pack.coverage.groups : null;
  const items = after && pack?.items?.state === 'recorded' ? pack.items.rows : null;
  const claims = after && pack?.claims?.state === 'recorded' ? pack.claims.rows : null;
  return (
    <main className={PAGE} data-testid="evidence-pack" data-reader={after ? 'after_nda' : 'before_nda'}>
      <header className="flex flex-col gap-1">
        <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400">Evidence pack</p>
        <h1 className="m-0 text-[22px] font-bold">{pack?.venture || 'Not recorded'}</h1>
        <p className="m-0 text-[13px]" role="note" data-testid="evidence-pack-dated">As of {day(link?.made_at) || 'Not recorded'}. This pack does not update; ask the sender for a new one.</p>
        <p className={MUTED}>{after ? `Shared after an NDA signed outside Axal${pack?.nda_signed_on ? ` on ${day(pack.nda_signed_on)}` : ''}.` : pack?.before_nda || 'Figures, files and quotes open once the NDA is signed.'}</p>
        {pack?.partial ? <p className="m-0 text-[13px] text-amber-800 dark:text-amber-300" role="note">Some evidence could not be read when this pack was made, so it is not in it.</p> : null}
      </header>
      {!after ? (
        <section className="flex flex-col gap-2" data-testid="evidence-pack-coverage">
          <h2 className={H2}>What is on record</h2>
          {coverage ? (
            <table className="w-full border-collapse text-left text-[13px]">
              <thead><tr>{['Area', 'Kind', 'Source', 'How many', 'Newest'].map((h) => <th key={h} className="border-b border-axal-hairline py-1.5 pr-2 text-[11px] uppercase text-axal-muted dark:border-gray-800 dark:text-gray-400">{h}</th>)}</tr></thead>
              <tbody>{coverage.map((g) => (
                <tr key={`${g.area}-${g.kind}-${g.source_label}`}>
                  <td className="border-b border-axal-hairline py-1.5 pr-2 dark:border-gray-800">{g.area}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-2 dark:border-gray-800">{itemTitle(g)}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-2 dark:border-gray-800">{sourceWord(g.source_label) || 'Not recorded'}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-2 dark:border-gray-800">{g.count}</td>
                  <td className="border-b border-axal-hairline py-1.5 pr-2 dark:border-gray-800">{day(g.newest) || 'Not recorded'}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className={MUTED}>Not recorded.</p>}
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3" data-testid="evidence-pack-items">
            <h2 className={H2}>Evidence</h2>
            {items ? groupsByArea(items).map(([area, rows]) => (
              <div key={area} className="flex flex-col gap-1">
                <h3 className="m-0 text-[13px] font-bold">{area}</h3>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {rows.map((r) => {
                    const shown = r.value_reason ? null : figure(r.value_num, r.value_unit, r.currency);
                    return (
                      <li key={r.uid} className="border-b border-axal-hairline py-1.5 text-[13px] dark:border-gray-800" data-testid="evidence-pack-item">
                        <b>{itemTitle(r)}</b> · {sourceWord(r.source_label) || 'Not recorded'} · {day(r.observed_on) || 'Date not recorded'} · {STRENGTH[r.strength] || 'Not recorded'}
                        <div className="text-axal-muted dark:text-gray-400">{shown ? <span className="font-semibold text-axal-ink dark:text-gray-100">{shown}</span> : r.value_reason && r.value_reason !== 'Shared as a summary only.' && r.value_reason !== 'No figure is recorded for this item.' ? `Value withheld: ${r.value_reason}` : r.value_reason || 'Not recorded'}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )) : <p className={MUTED}>Not recorded.</p>}
          </section>
          <section className="flex flex-col gap-2" data-testid="evidence-pack-claims">
            <h2 className={H2}>Claims these items back</h2>
            {claims && claims.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {claims.map((c) => (
                  <li key={c.uid} className="border-b border-axal-hairline py-1.5 text-[13px] dark:border-gray-800" data-testid="evidence-pack-claim" data-state={c.state}>
                    <b>{claimWord(c.state)}</b>{c.checked_at ? ` · checked ${day(c.checked_at)}` : ' · not checked yet'}
                    {c.founder_note ? <p className="m-0 mt-1 border-l-2 border-axal-hairline pl-2 dark:border-gray-700" data-testid="evidence-pack-note">Founder’s note: {c.founder_note}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className={MUTED}>No claim is backed by these items.</p>}
          </section>
        </>
      )}
      <footer className={MUTED}>Shared from Axal by the company’s founders. Link expires {day(link?.expires_at) || 'Not recorded'}.</footer>
    </main>
  );
}

export default function EvidencePackPage() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    raiseEvidenceShareApi.openShared(token)
      .then((r) => { if (!live) return; setState(r.status === 200 && r.body?.state === 'ok' ? { status: 'ready', body: r.body } : { status: 'refused', body: r.body }); })
      .catch(() => { if (live) setState({ status: 'refused', body: { title: 'This page could not be opened', sentence: 'Try again in a moment.' } }); });
    return () => { live = false; };
  }, [token]);
  return <EvidencePackView state={state} />;
}
