/**
 * D5841 part 2 (#5841): Raise › Evidence › Organic search. The founder's one explicit path from Grow's organic report
 * (and from an organic-search claim's drawer) to Raise evidence, on #5842's client: preview one whole week's figure,
 * pin it to one organic-search claim the founder picks (Private), and re-review or withdraw what is pinned.
 *
 * Opening this sheet writes nothing. Every change opens `ChangeDialog` first and says what it changes. Sharing beyond
 * Private stays on the evidence item (`ItemDrawer`), never here. A refusal shows the Worker's sentence or one of
 * `organicError`'s, never a raw error.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { raiseSearchConsoleEvidenceApi } from '../../../lib/api/raiseSearchConsoleEvidence.js';
import { safeRaiseError } from '../../../lib/raiseErrors.js';
import { searchConsoleApi } from '../../../lib/api/searchConsole.js';
import { BTN_P, BTN_S, BTN_D, ChangeDialog, LINK, MUTED, SharingPill, StalePill } from './EvidenceParts';
import { claimTitle, claimWhere, statedFigure } from './evidenceView';
import { itemHref } from './evidenceModel';
import {
  ORGANIC_METRICS, coverageWords, eligibleClaims, metricLabel, organicError, organicFigure, pinnableWeeks, selectionState, windowWords,
} from './organicEvidenceModel';

const FIELD = 'min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink sm:min-h-[36px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';
const H3 = 'm-0 text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400';
const BOX = 'flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-800';
const TONE = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  muted: 'border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
const Pill = ({ tone, children, state }) => <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONE[tone] || TONE.muted}`} data-testid="organic-state" data-state={state}>{children}</span>;
const NARRATIVE_EXAMPLE = { clicks: '“4,200 organic search clicks”', impressions: '“61,000 organic search impressions”', ctr: '“6.9% organic search CTR”' };

export default function OrganicSearchSheet({ onClose, ...props }) {
  return (
    <Sheet label="Organic search evidence" title="Organic search evidence" eyebrow="Raise › Evidence" onClose={onClose} width={640} testId="organic-evidence">
      <div className="px-5 py-4"><OrganicSearchEvidence key={props.projectId} {...props} /></div>
    </Sheet>
  );
}

/** The sheet's body, keyed by venture: a changed venture drops every read, draft and pending answer. */
export function OrganicSearchEvidence({ projectId, claims = null, week: askedWeek = null, claim: askedClaim = null, search = '', onChanged,
  api = raiseSearchConsoleEvidenceApi, resultsApi = searchConsoleApi }) {
  const [results, setResults] = useState(null), [resultsError, setResultsError] = useState('');
  const [selections, setSelections] = useState(null), [selectionsError, setSelectionsError] = useState('');
  const [round, setRound] = useState(0);
  const [week, setWeek] = useState(askedWeek || ''), [metric, setMetric] = useState('clicks'), [claimUid, setClaimUid] = useState('');
  const [preview, setPreview] = useState(null), [previewing, setPreviewing] = useState(false), [previewError, setPreviewError] = useState('');
  const [dialog, setDialog] = useState(null), [notice, setNotice] = useState('');
  const asked = useRef(0);
  useEffect(() => {
    let live = true;
    Promise.allSettled([resultsApi.results(projectId), api.selections(projectId)]).then(([r, s]) => {
      if (!live) return;
      if (r.status === 'fulfilled') { setResults(r.value); setResultsError(''); } else setResultsError(organicError(r.reason, 'Search Console results could not be read. Try again.'));
      if (s.status === 'fulfilled') { setSelections(Array.isArray(s.value?.selections) ? s.value.selections : []); setSelectionsError(''); }
      else setSelectionsError(organicError(s.reason, 'Pinned organic search figures could not be read. Try again.'));
    });
    return () => { live = false; };
  }, [api, resultsApi, projectId, round]);

  const weeks = pinnableWeeks(results);
  const chosenWeek = weeks.find((w) => w.week_start === week) ? week : (weeks[0]?.week_start || '');
  const fits = eligibleClaims(claims, metric);
  const chosenClaim = fits.find((c) => c.uid === claimUid) ? claimUid : (fits.find((c) => c.uid === askedClaim)?.uid || '');
  const forget = () => { asked.current += 1; setPreview(null); setPreviewError(''); setPreviewing(false); };

  const look = async () => {
    if (!results?.property || !chosenWeek) return;
    const mine = asked.current + 1; asked.current = mine;
    setPreviewing(true); setPreviewError(''); setPreview(null); setNotice('');
    try {
      const out = await api.preview(projectId, { site_url: results.property.site_url, week_start: chosenWeek, metric });
      if (asked.current === mine) setPreview(out?.preview || null);
    } catch (e) { if (asked.current === mine) setPreviewError(organicError(e, 'The figure could not be read. Nothing was pinned. Try again.')); }
    finally { if (asked.current === mine) setPreviewing(false); }
  };
  // A refusal reaches `ChangeDialog` as this page's own sentence (the Worker's, or `organicError`'s), never a raw error.
  const write = async (call) => { try { return await call(); } catch (e) { throw safeRaiseError(organicError(e)); } };
  const after = (sentence) => { forget(); setDialog(null); setNotice(sentence); setRound((n) => n + 1); onChanged?.(); };
  const pin = async () => {
    const c = preview?.candidate;
    await write(() => api.pin(projectId, { site_url: c.search_console.site_url, week_start: c.search_console.window.from, metric: c.search_console.metric, snapshot_hash: c.snapshot_hash, claim_id: chosenClaim }));
    after('Pinned to the claim, Private. Share it from its evidence item when you choose to.');
  };
  // Re-review reads the revised week's preview first, so the founder confirms the hash of the figure they are shown.
  const startReview = async (sel) => {
    setNotice('');
    try {
      const out = await api.preview(projectId, { site_url: sel.aggregate.site_url, week_start: sel.aggregate.window.from, metric: sel.aggregate.metric });
      setDialog({ kind: 'review', sel, preview: out?.preview || null });
    } catch (e) { setDialog({ kind: 'review', sel, preview: null, error: organicError(e, 'The revised figure could not be read. Nothing changed. Try again.') }); }
  };

  const selectable = preview?.state === 'selectable' && preview.candidate;
  const current = (selections || []).filter((s) => s.status === 'current');
  const closed = (selections || []).filter((s) => s.status !== 'current');
  return (
    <div className="flex min-w-0 flex-col gap-4 text-[13px] text-axal-ink dark:text-gray-100" data-testid="organic-evidence-body">
      <p className={MUTED}>Organic Google web search for this venture’s selected property: finalized data, whole Monday–Sunday weeks in Pacific Time. It is not paying customers, revenue or attributed conversions. Opening this, the Grow report or the connector creates and shares nothing.</p>
      {notice ? <p role="status" className="m-0 font-semibold" data-testid="organic-notice">{notice}</p> : null}

      <section className="flex flex-col gap-2" aria-label="Pinned organic search figures" data-testid="organic-pinned">
        <h3 className={H3}>Pinned figures</h3>
        {selectionsError ? <p role="alert" className="m-0">{selectionsError} <button type="button" className={BTN_S} onClick={() => setRound((n) => n + 1)}>Try again</button></p>
          : selections === null ? <p role="status" className={MUTED}>Reading pinned figures…</p>
            : !selections.length ? <p className={MUTED}>Nothing from Search Console is pinned. Choose a week below.</p>
              : <ul className="m-0 flex list-none flex-col gap-2 p-0">{[...current, ...closed].map((s) => <Pinned key={s.uid} sel={s} claims={claims} search={search}
                onWithdraw={() => setDialog({ kind: 'withdraw', sel: s })} onReview={() => startReview(s)} />)}</ul>}
      </section>

      <section className="flex flex-col gap-3" aria-label="Choose a week for a claim" data-testid="organic-choose">
        <h3 className={H3}>Choose a week for a claim</h3>
        {resultsError ? <p role="alert" className="m-0">{resultsError} <button type="button" className={BTN_S} onClick={() => setRound((n) => n + 1)}>Try again</button></p>
          : results === null ? <p role="status" className={MUTED}>Reading stored weeks…</p>
            : !results.property ? <p className={MUTED}>No Search Console property is selected for this venture. Connect it and choose a property in Grow › Distribution › Results first.</p>
              : !weeks.length ? <p className={MUTED}>No whole week is stored in full yet. A partial week cannot be pinned.</p> : (
                <>
                  <p className="m-0 break-all text-[12.5px]"><span className="font-semibold">Property:</span> {results.property.site_url}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className={LABEL}>Week (Pacific Time)
                      <select className={FIELD} value={chosenWeek} onChange={(e) => { setWeek(e.target.value); forget(); }} data-testid="organic-week">
                        {weeks.map((w) => <option key={w.week_start} value={w.week_start}>{w.week_start} to {w.week_end}</option>)}
                      </select>
                    </label>
                    <label className={LABEL}>Figure
                      <select className={FIELD} value={metric} onChange={(e) => { setMetric(e.target.value); setClaimUid(''); forget(); }} data-testid="organic-metric">
                        {ORGANIC_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div><button type="button" className={BTN_S} onClick={look} disabled={previewing} data-testid="organic-preview">{previewing ? 'Reading…' : 'Preview figure'}</button></div>
                  {previewError ? <p role="alert" className="m-0">{previewError}</p> : null}
                  {preview && !selectable ? <p role="status" className="m-0" data-testid="organic-preview-refused">Cannot be pinned: {preview.reason || 'this week’s figure is not available.'}</p> : null}
                  {selectable ? (
                    <div className={BOX} data-testid="organic-preview-figure">
                      <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{metricLabel(metric)} · {windowWords(preview.candidate.search_console.window)}</span>
                      <span className="text-[20px] font-bold">{organicFigure(metric, preview.candidate.value_num)}</span>
                      {metric === 'ctr' ? <span className={MUTED}>{organicFigure('clicks', preview.candidate.search_console.numerator)} clicks ÷ {organicFigure('impressions', preview.candidate.search_console.denominator)} impressions</span> : null}
                      <span className={MUTED}>{coverageWords(preview.candidate.search_console.coverage)}. Finalized web search, property totals only: no landing page or query is part of it.</span>
                      {fits.length ? (
                        <label className={LABEL}>The claim it backs
                          <select className={FIELD} value={chosenClaim} onChange={(e) => setClaimUid(e.target.value)} data-testid="organic-claim">
                            <option value="">Choose a claim</option>
                            {fits.map((c) => <option key={c.uid} value={c.uid}>{claimTitle(c)}{statedFigure(c) ? `: ${statedFigure(c)}` : ''}{claimWhere(c) ? ` · ${claimWhere(c)}` : ''}</option>)}
                          </select>
                        </label>
                      ) : (
                        <p className="m-0" data-testid="organic-no-claim">No claim states {metricLabel(metric).toLowerCase()} yet. Write it in your <Link className={LINK} to={`/raise/investor-narrative${search}`}>Investor narrative</Link>, for example {NARRATIVE_EXAMPLE[metric]}, then come back to pin this week to it.</p>
                      )}
                      <div><button type="button" className={BTN_P} disabled={!chosenClaim} onClick={() => setDialog({ kind: 'pin' })} data-testid="organic-pin">Pin to this claim</button></div>
                    </div>
                  ) : null}
                </>
              )}
      </section>

      {dialog?.kind === 'pin' ? (
        <ChangeDialog title="Pin this figure to the claim" confirm="Pin, Private" testId="organic-pin-dialog" onClose={() => setDialog(null)} onConfirm={pin}
          says={`${metricLabel(metric)}, ${organicFigure(metric, preview?.candidate?.value_num)}, for ${windowWords(preview?.candidate?.search_console?.window)}, becomes evidence for “${claimTitle(fits.find((c) => c.uid === chosenClaim))}”. It is pinned and Private: no investor sees it until you share it from its evidence item.`} />
      ) : null}
      {dialog?.kind === 'withdraw' ? (
        <ChangeDialog title="Withdraw this figure" confirm="Withdraw" danger testId="organic-withdraw-dialog" onClose={() => setDialog(null)}
          onConfirm={async () => { await write(() => api.withdraw(projectId, dialog.sel.uid)); after('Withdrawn. It is Private, unpinned and no longer backs its claim.'); }}
          says="The figure is unpinned, made Private and removed from its claim, which is checked again. Anyone it was shared with no longer sees it. It stays in this list as Withdrawn and cannot be shared again." />
      ) : null}
      {dialog?.kind === 'review' ? (
        dialog.preview?.state === 'selectable' && dialog.preview.candidate ? (
          <ChangeDialog title="Re-review the corrected week" confirm="Use the revised figure, Private" testId="organic-review-dialog" onClose={() => setDialog(null)}
            onConfirm={async () => { await write(() => api.review(projectId, dialog.sel.uid, { snapshot_hash: dialog.preview.candidate.snapshot_hash })); after('Re-reviewed. The revised figure is pinned to the same claim, Private. Share it again when you choose to.'); }}
            says={`The revised ${metricLabel(dialog.sel.aggregate.metric).toLowerCase()} for ${windowWords(dialog.sel.aggregate.window)} replaces the pinned one as a new Private item for the same claim. The old figure is unpinned and Private. Nothing is shared until you share the new one.`}>
            <Compare sel={dialog.sel} revised={dialog.preview.candidate.value_num} />
          </ChangeDialog>
        ) : (
          <ChangeDialog title="Re-review the corrected week" confirm="Close" testId="organic-review-dialog" onClose={() => setDialog(null)} onConfirm={async () => {}}
            says={dialog.error || `The revised week cannot be pinned: ${dialog.preview?.reason || 'it is not available.'}`} />
        )
      ) : null}
    </div>
  );
}

function Compare({ sel, revised }) {
  const m = sel.aggregate.metric;
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="organic-compare">
      <div className={BOX}><span className={H3}>Pinned</span><span className="text-[17px] font-bold">{organicFigure(m, sel.source?.original?.value ?? sel.aggregate.value)}</span></div>
      <div className={BOX}><span className={H3}>Revised by Google</span><span className="text-[17px] font-bold">{organicFigure(m, revised ?? sel.source?.revised?.value)}</span></div>
    </div>
  );
}

function Pinned({ sel, claims, search, onWithdraw, onReview }) {
  const st = selectionState(sel);
  const a = sel.aggregate || {};
  const claim = sel.claim ? (Array.isArray(claims) ? claims.find((c) => c.uid === sel.claim.uid) : null) || sel.claim : null;
  const days = Array.isArray(sel.source?.corrected_days) ? sel.source.corrected_days : [];
  return (
    <li className={BOX} data-testid="organic-selection" data-status={sel.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={st.tone} state={st.key}>{st.word}</Pill>
        {st.stale ? <StalePill /> : null}
        {sel.item ? <SharingPill visibility={sel.item.visibility} /> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[17px] font-bold">{organicFigure(a.metric, a.value)}</span>
        <span>{metricLabel(a.metric)} · {windowWords(a.window)}</span>
      </div>
      <span className={MUTED}>{coverageWords(a.coverage)}{claim ? ` · Backs “${claimTitle(claim)}”` : ''}</span>
      <span className={MUTED}>{st.detail}</span>
      {st.key === 'corrected' ? (
        <span className="text-[12.5px]" data-testid="organic-corrected">Pinned {organicFigure(a.metric, sel.source?.original?.value ?? a.value)}; revised {organicFigure(a.metric, sel.source?.revised?.value)}{days.length ? ` (${days.map((d) => d?.date || d).join(', ')})` : ''}.</span>
      ) : null}
      {st.canWithdraw || st.canReview || (sel.item && sel.status === 'current') ? (
        <div className="flex flex-wrap gap-2">
          {st.canReview ? <button type="button" className={BTN_P} onClick={onReview} data-testid="organic-review">Re-review</button> : null}
          {sel.item && sel.status === 'current' ? <Link className={BTN_S} to={itemHref(sel.item.uid, search)}>Sharing</Link> : null}
          {st.canWithdraw ? <button type="button" className={BTN_D} onClick={onWithdraw} data-testid="organic-withdraw">Withdraw</button> : null}
        </div>
      ) : null}
    </li>
  );
}
