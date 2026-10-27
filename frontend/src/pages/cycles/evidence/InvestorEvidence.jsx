/**
 * D1268 (#3291) — the investor's evidence block (VR8, VR9), one item's drawer
 * (VR10) and the phone (VR18), on D1265's read (`investorEvidence`). Placed on
 * the deal page's Evidence tab (`EvidenceSummary`), an investor's round call
 * (the call read's own `evidence`) and the diligence room (`SharedEvidence`).
 *
 * WHAT THE READ HOLDS BACK STAYS OUT. Before the NDA the read carries coverage
 * only, so nothing here can draw a value, an item or a claim. After it, every
 * item the read did not return is simply absent: there is no "hidden" row, no
 * count of what is private. A figure is drawn only when the read carried one;
 * otherwise the read's own reason. Opening the block is logged by the Worker
 * (`open_evidence`); this file writes nothing.
 *
 * It imports no `ui` index, so a page that places it does not read as drawing the rail.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../../ui/Lightbox';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence.js';
import { BASE, claimWord, coverageTile, investorView, kindWord, refusalOf, sourceLine, sourceWord, strengthWord } from './evidenceModel';

const box = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const BTN = 'w-fit rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[13px] font-semibold hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800 max-sm:min-h-[44px]';
const PILL = 'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold';
const CLAIM_TONE = {
  backed: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  mismatch: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
  founders_figure: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  not_backed: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

function Unreadable({ line, onRetry, testId }) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <p className="m-0 text-[13px]">{line}</p>
      {onRetry && <button type="button" className={BTN} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>}
    </div>
  );
}

/** VR8 and VR9's coverage: one tile per area, kind and Source, with a count and the newest date. Never a value. */
function Coverage({ coverage, onRetry }) {
  if (!coverage.ok) return <Unreadable line={coverage.reason} onRetry={onRetry} testId="evidence-coverage-unreadable" />;
  if (!coverage.rows.length) return <p className={`m-0 text-[13px] ${MUTED}`} data-testid="evidence-coverage-empty">The founder has shared no evidence yet.</p>;
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2" data-testid="evidence-coverage">
      {coverage.rows.map((g) => {
        const t = coverageTile(g);
        return (
          <li key={`${g.area}|${g.kind}|${g.source_label}`} className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid="evidence-tile">
            <span className={`text-[11px] font-semibold uppercase tracking-[.05em] ${MUTED}`}>{t.area}</span>
            <span className="text-[13px] font-semibold">{t.count != null ? <span className={MONO}>{t.count}</span> : 'Not recorded'} · {t.kind}</span>
            <span className={`text-[12px] ${MUTED}`}>{t.source} · {t.newest}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ClaimPills({ claims }) {
  if (!claims.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {claims.map((c) => <span key={c.uid} className={`${PILL} ${CLAIM_TONE[c.state] || CLAIM_TONE.not_backed}`} data-testid="evidence-claim-state">{claimWord(c.state)}</span>)}
    </span>
  );
}

/** VR10: one shared item. Its figure only when the read carried one; otherwise the read's own reason. */
function ItemDrawer({ item, onClose }) {
  const title = kindWord(item.kind);
  return (
    <Lightbox label={title} title={title} onClose={onClose} width={520} phone="full" testId="evidence-item">
      <div className="flex flex-col gap-3 text-[13px]">
        <span className={`text-[11px] font-semibold uppercase tracking-[.05em] ${MUTED}`}>Evidence · {item.area}</span>
        <p className="m-0" data-testid="evidence-item-source">{sourceWord(item.source_label)} · {sourceLine(item)}</p>
        {item.figure != null
          ? <p className={`m-0 text-[18px] font-extrabold ${MONO}`} data-testid="evidence-item-figure">{item.figure}</p>
          : <p className={`m-0 ${MUTED}`} data-testid="evidence-item-reason">{item.value_reason || 'No figure is recorded for this item.'}</p>}
        {item.summary && <p className="m-0">{item.summary}</p>}
        {strengthWord(item.strength) && <p className={`m-0 ${MUTED}`}>{strengthWord(item.strength)}</p>}
        {item.stale && <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="evidence-item-stale">This record is older than its kind is usually kept current.</p>}
        {item.claims.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className={`text-[11px] font-semibold uppercase tracking-[.05em] ${MUTED}`}>Backs</span>
            <ClaimPills claims={item.claims} />
          </div>
        )}
        <p className={`m-0 text-[12px] ${MUTED}`}>{item.sharing === 'summary' ? 'The founder shared this as a summary only.' : 'Shared after the NDA.'} Each item names where it came from and when.</p>
      </div>
    </Lightbox>
  );
}

/**
 * The block itself, from one read (or `null` when the read does not admit this
 * reader). `company` names the venture in the canvas's lines.
 */
export function InvestorEvidence({ read, onRetry = null, company = null, heading = 'Evidence' }) {
  const v = investorView(read);
  const [open, setOpen] = useState(null);
  if (v.stage === 'none') return null;
  const who = company || 'The founder';
  return (
    <section className={box} data-testid="evidence-summary" data-stage={v.stage}>
      <h2 className="m-0 text-[15px] font-bold">{heading}</h2>
      {v.stage === 'unreadable' && <Unreadable line={v.reason} onRetry={onRetry} testId="evidence-unreadable" />}
      {v.stage === 'before' && (
        <>
          <span className={`${PILL} border-gray-200 text-axal-muted dark:border-gray-700 dark:text-gray-400`} data-testid="evidence-before-nda">Before the NDA</span>
          <p className="m-0 text-[13.5px]">{who} shares what backs its claims. {v.line}</p>
          <Coverage coverage={v.coverage} onRetry={onRetry} />
          <p className={`m-0 text-[12px] ${MUTED}`}>Coverage only: each kind of evidence, how many, its source and its newest date. No values.</p>
        </>
      )}
      {v.stage === 'after' && (
        <>
          <span className={`${PILL} border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200`} data-testid="evidence-after-nda">✓ NDA signed</span>
          <p className="m-0 text-[13.5px]">You see what {company || 'the founder'} chose to share. Each item names where it came from and when.</p>
          {!v.items.ok ? <Unreadable line={v.items.reason} onRetry={onRetry} testId="evidence-items-unreadable" />
            : v.items.rows.length === 0 ? <p className={`m-0 text-[13px] ${MUTED}`} data-testid="evidence-items-empty">The founder has shared no evidence yet.</p>
              : (
                <>
                  {v.tally && <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="evidence-tally">{v.tally}</p>}
                  {v.items.areas.map(([area, rows]) => (
                    <div key={area} className="flex flex-col gap-1.5" data-testid="evidence-area">
                      <h3 className="m-0 text-[13px] font-bold">{area}</h3>
                      <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
                        {rows.map((i) => (
                          <li key={i.uid} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`evidence-row-${i.uid}`}>
                            <button type="button" className="min-h-[32px] text-left text-[13px] font-semibold text-axal-violet hover:underline dark:text-violet-300" onClick={() => setOpen(i)} data-testid={`evidence-open-${i.uid}`}>{kindWord(i.kind)}</button>
                            <span className={`text-[13px] ${i.figure != null ? MONO : MUTED}`} data-testid={`evidence-value-${i.uid}`}>{i.figure ?? i.value_reason ?? 'No figure is recorded for this item.'}</span>
                            <span className={`text-[12px] ${MUTED}`}>{sourceLine(i)}</span>
                            <ClaimPills claims={i.claims} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
          {!v.claims.ok && <Unreadable line="Which claims these items back could not be read. Try again." onRetry={onRetry} testId="evidence-claims-unreadable" />}
        </>
      )}
      {v.partial && <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="evidence-partial">Some of the founder’s evidence could not be checked against its record just now, so it is left out. Try again later.</p>}
      {open && <ItemDrawer item={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** A read the block draws itself: loading, then the read or its refusal. */
function useEvidence(load, key) {
  const [s, setS] = useState({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    setS({ status: 'loading', data: null, error: null });
    Promise.resolve().then(load).then((data) => { if (live) setS({ status: 'ready', data, error: null }); }, (error) => { if (live) setS({ status: 'refused', data: null, error }); });
    return () => { live = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...s, retry: () => setAttempt((n) => n + 1) };
}

function Loading() {
  return <section className={box} data-testid="evidence-loading"><h2 className="m-0 text-[15px] font-bold">Evidence</h2><p className={`m-0 text-[13px] ${MUTED}`}>Reading the founder’s evidence…</p></section>;
}

/** The refused read, in the deal page's words; the founder is pointed to their own view. */
function Refused({ error, onRetry }) {
  const r = refusalOf(error);
  return (
    <section className={box} data-testid="evidence-summary" data-stage={`refused-${r.kind}`}>
      <h2 className="m-0 text-[15px] font-bold">Evidence</h2>
      <p className="m-0 text-[13px]" data-testid="evidence-refused">{r.line}</p>
      {r.kind === 'founder' && <Link to={BASE} className="w-fit text-[13px] font-semibold text-axal-violet underline dark:text-violet-300">Open Raise › Evidence</Link>}
      {r.kind === 'unreadable' && <button type="button" className={BTN} onClick={onRetry} data-testid="evidence-unreadable-retry">Try again</button>}
    </section>
  );
}

/** The deal page's Evidence tab: `GET /api/deals/:id/evidence`. */
export function EvidenceSummary({ dealId, company = null, api = raiseEvidenceApi }) {
  const r = useEvidence(() => api.forDeal(dealId), dealId ? `deal:${dealId}` : null);
  if (r.status === 'loading') return <Loading />;
  if (r.status === 'refused') return <Refused error={r.error} onRetry={r.retry} />;
  return <InvestorEvidence read={r.data} onRetry={r.retry} company={company} />;
}

/** The diligence room: `GET /api/data-room/shared/:projectUid/evidence`. A refusal draws nothing: the room already says what is open. */
export function SharedEvidence({ projectUid, company = null, api = raiseEvidenceApi }) {
  const r = useEvidence(() => api.shared(projectUid), projectUid ? `shared:${projectUid}` : null);
  if (r.status === 'loading') return <Loading />;
  if (r.status === 'refused') {
    const k = refusalOf(r.error).kind;
    return k === 'unreadable' ? <Refused error={r.error} onRetry={r.retry} /> : null;
  }
  return <InvestorEvidence read={r.data} onRetry={r.retry} company={company} />;
}

