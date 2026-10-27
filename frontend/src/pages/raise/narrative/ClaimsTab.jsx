import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Pill, Unreadable } from '../../../ui';
import { narrativeApi } from '../../../lib/api/narrative';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { reportError } from '../../../lib/log';
import { checkNote, NOTE_MAX } from '../pitch/checkModel';
import {
  CLAIM_STATES, NO_CLAIMS, NO_RECORDS, SOURCE_LABELS, SOURCE_ORDER, STATE_LABELS, STATE_TONE,
  claimLine, filterClaims, itemLine, lastChecked, recordSource, sectionOptions, sourceBar,
} from './claimsModel';

/**
 * D912 (#2696, part 6 of #2454) — NAR6, the Claims tab, and NAR7, the claim
 * drawer (a full sheet on a phone, NAR19c).
 *
 * `GET /narrative/:version/claims` is D1264's store: for the founder it checks
 * the version as it reads, and returns both figures, the records, the Evidence
 * candidates and Eadwyn's proposed links; an admin with a reason reads the
 * states alone and changes nothing (D914).
 *
 *   the table   State, Source and Section filters and "Needs you first"
 *   the bar     claims by best source, 100%, the dashed segment Not backed,
 *               its legend and "Table" (the same counts as rows)
 *   the drawer  Not backed: the candidates, each Link, and Eadwyn's proposed
 *               links on lavender, each Accept; none is NAR15c. Mismatch: both
 *               figures and both sources, "Use the record's figure" and "Keep
 *               mine, with a note". Every write opens a dialog first.
 */
const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground dark:hover:bg-gray-800 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SELECT = 'rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LAVENDER = 'rounded-[10px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40';
const SEG = { connector: 'bg-axal-violet', signed: 'bg-emerald-600', document: 'bg-sky-600', recorded: 'bg-amber-500', typed: 'bg-gray-400' };
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';

function refusal(e, fallback) { return (typeof e?.message === 'string' && e.message.trim()) || fallback; }

export default function ClaimsTab({ projectId, version, search = '', admin = false, phone = false }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const [filters, setFilters] = useState({ state: '', source: '', section: '', needsFirst: true });
  const [asTable, setAsTable] = useState(false);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    narrativeApi.claims(projectId, version).then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      (e) => { if (live) setState({ status: 'error', data: null }); reportError('narrative:claims', e); },
    );
    return () => { live = false; };
  }, [projectId, version, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  if (state.status === 'loading' && !state.data) return <div className="h-40 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="narrative-claims-loading" />;
  if (state.status === 'error') return <div data-testid="narrative-claims-unreadable"><Unreadable what="The claims" claim="This is not a claim that there are none." onRetry={reload} /></div>;
  const data = state.data;
  const claims = Array.isArray(data?.claims) ? data.claims : [];
  const rows = filterClaims(claims, filters);
  const bar = sourceBar(data?.by_source);
  const set = (k) => (e) => { const v = e.target.value; setFilters((f) => ({ ...f, [k]: v })); };
  const current = open ? claims.find((c) => c.uid === open) : null;

  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-claims">
      <section className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <div className="flex flex-col gap-1">
            <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{`Claims in v${version}`}</h2>
            <span className={`text-[12px] ${MUTED}`} data-testid="narrative-claims-last">{lastChecked(data?.checked_at)}</span>
          </div>
          {bar ? <button type="button" className={`${LINK} text-[12.5px]`} onClick={() => setAsTable((t) => !t)} data-testid="narrative-claims-table-toggle">{asTable ? 'Bar' : 'Table'}</button> : null}
        </div>
        {bar ? (
          <div className="flex flex-col gap-2 px-4 py-3" data-testid="narrative-claims-bar">
            <span className={EYEBROW}>Claims by best source</span>
            {asTable ? (
              <table className="w-full text-left text-[12.5px]" data-testid="narrative-claims-bar-table">
                <thead><tr className={EYEBROW}><th className="py-1">Best source</th><th className="py-1 text-right">Claims</th><th className="py-1 text-right">Share</th></tr></thead>
                <tbody>{bar.segments.map((s) => <tr key={s.key} className="border-t border-axal-hairline dark:border-gray-800"><td className={`py-1 ${INK}`}>{s.label}</td><td className="py-1 text-right font-mono">{s.n}</td><td className="py-1 text-right font-mono">{`${s.pct}%`}</td></tr>)}</tbody>
              </table>
            ) : (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full" role="img" aria-label={bar.summary}>
                  {bar.segments.map((s) => (
                    <span key={s.key} style={{ width: `${s.pct}%` }} data-testid={`narrative-claims-seg-${s.key}`}
                      className={s.dashed ? 'box-border border-[1.5px] border-dashed border-gray-400 dark:border-gray-500' : SEG[s.key]} />
                  ))}
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-3 p-0" data-testid="narrative-claims-legend">
                  {bar.segments.map((s) => (
                    <li key={s.key} className={`flex items-center gap-1.5 text-[11.5px] ${MUTED}`}>
                      <span aria-hidden="true" className={`inline-block h-2.5 w-3.5 rounded-[3px] ${s.dashed ? 'border border-dashed border-gray-400' : SEG[s.key]}`} />
                      {`${s.label} · ${s.n}`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-axal-hairline px-4 py-2.5 dark:border-gray-800" data-testid="narrative-claims-filters">
          <select aria-label="State" className={SELECT} value={filters.state} onChange={set('state')} data-testid="narrative-claims-state">
            <option value="">Every state</option>
            {CLAIM_STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
          </select>
          <select aria-label="Source" className={SELECT} value={filters.source} onChange={set('source')} data-testid="narrative-claims-source">
            <option value="">Every source</option>
            {[...SOURCE_ORDER, 'not_backed'].map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
          </select>
          <select aria-label="Section" className={SELECT} value={filters.section} onChange={set('section')} data-testid="narrative-claims-section">
            <option value="">Every section</option>
            {sectionOptions(claims).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <label className={`flex items-center gap-1.5 text-[12.5px] ${INK}`}>
            <input type="checkbox" checked={filters.needsFirst} onChange={(e) => setFilters((f) => ({ ...f, needsFirst: e.target.checked }))} data-testid="narrative-claims-needs" />
            Needs you first
          </label>
        </div>
        {!claims.length ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`} data-testid="narrative-claims-none">{NO_CLAIMS}</p>
          : !rows.length ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`} data-testid="narrative-claims-filtered">No claim matches these filters.</p>
            : rows.map((c) => (
              <button key={c.uid} type="button" onClick={() => setOpen(c.uid)} data-testid={`narrative-claim-${c.uid}`}
                className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-axal-ground px-4 py-2.5 text-left hover:bg-axal-ground/60 dark:border-gray-800 dark:hover:bg-gray-800/50">
                <span className="flex min-w-0 flex-col">
                  <span className={`text-[13px] font-semibold ${INK}`}>{c.label}{c.stated_shown ? <span className="font-mono font-normal"> · {c.stated_shown}</span> : null}</span>
                  <span className={`text-[12px] ${MUTED}`}>{[c.section_label, c.best_source ? SOURCE_LABELS[c.best_source] : 'No record'].filter(Boolean).join(' · ')}</span>
                </span>
                <Pill tone={STATE_TONE[c.state] || 'neutral'}>{STATE_LABELS[c.state] || c.state}</Pill>
              </button>
            ))}
      </section>
      {current ? (
        <ClaimDrawer claim={current} projectId={projectId} version={version} search={search} readOnly={admin || !data?.can_check} phone={phone}
          onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />
      ) : null}
    </div>
  );
}

/** NAR7 and NAR7b: one claim, a full sheet on a phone (NAR19c). */
function ClaimDrawer({ claim, projectId, version, search, readOnly, phone, onClose, onChanged }) {
  const [step, setStep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(refusal(e, fallback)); reportError('narrative:claim', e); } finally { setBusy(false); }
  };
  const evidence = `/raise/evidence/claim/${encodeURIComponent(claim.uid)}${search ? `${search.startsWith('?') ? search : `?${search}`}` : ''}`;
  const candidates = claim.candidates || [];
  const offered = claim.eadwyn || [];
  let body;
  if (step?.kind === 'link') {
    body = (
      <div className="flex flex-col gap-2" data-testid="narrative-claim-link-confirm">
        <p className={`m-0 text-[13px] ${INK}`}>{`Link ${itemLine(step.item)} to ${claim.label} in v${version}? The claim is checked again on your next read.`}</p>
        <span className="flex gap-2">
          <button type="button" className={BTN} disabled={busy} data-testid="narrative-claim-link-go"
            onClick={() => run(() => raiseEvidenceApi.link(projectId, claim.uid, step.item.uid, step.item.version, step.proposal ?? undefined), 'The record could not be linked.')}>Link it</button>
          <button type="button" className={GHOST} onClick={() => setStep(null)} disabled={busy}>Back</button>
        </span>
      </div>
    );
  } else if (step?.kind === 'use') {
    body = (
      <div className="flex flex-col gap-2" data-testid="narrative-claim-use-confirm">
        <p className={`m-0 text-[13px] ${INK}`}>{`${claim.stated_shown} becomes ${claim.record.shown} in ${claim.section_label}, and the section is saved in v${version}. The rest of its words stay as they are.`}</p>
        <span className="flex gap-2">
          <button type="button" className={BTN} disabled={busy} data-testid="narrative-claim-use-go"
            onClick={() => run(() => narrativeApi.useRecord(projectId, version, claim.uid, claim.record.value), 'The figure could not be replaced.')}>{`Use ${claim.record.shown}`}</button>
          <button type="button" className={GHOST} onClick={() => setStep(null)} disabled={busy}>Back</button>
        </span>
      </div>
    );
  } else if (step?.kind === 'keep') {
    body = (
      <div className="flex flex-col gap-2" data-testid="narrative-claim-keep-confirm">
        <p className={`m-0 text-[13px] ${INK}`}>{`${claim.section_label} keeps ${claim.stated_shown}. It stays a Mismatch with ${recordSource(claim.record)}’s ${claim.record?.shown}, shown with your note. Neither figure is presumed right.`}</p>
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Why you keep it</span>
          <textarea className="min-h-[80px] w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} data-testid="narrative-claim-keep-note" />
        </label>
        <span className="flex gap-2">
          <button type="button" className={BTN} disabled={busy} data-testid="narrative-claim-keep-go"
            onClick={() => { const out = checkNote(note); if (out.error) { setError(out.error); return; } run(() => raiseEvidenceApi.note(projectId, claim.uid, out.note), 'The note could not be saved.'); }}>Keep my figure</button>
          <button type="button" className={GHOST} onClick={() => setStep(null)} disabled={busy}>Back</button>
        </span>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <span className={`text-[13px] ${INK}`} data-testid="narrative-claim-line">{claimLine(claim)}</span>
        {claim.state === 'mismatch' && claim.record ? (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]" data-testid="narrative-claim-figures">
            <dt className={MUTED}>{claim.section_label || 'The narrative'}</dt><dd className={`m-0 font-mono ${INK}`}>{claim.stated_shown ?? 'Not recorded'}</dd>
            <dt className={MUTED}>{recordSource(claim.record)}</dt>
            <dd className={`m-0 font-mono ${INK}`}>{claim.record.shown ?? 'Not recorded'}{claim.record.observed_on ? <span className={MUTED}> · {claim.record.observed_on}</span> : null}</dd>
          </dl>
        ) : null}
        {claim.note ? <p className={`m-0 rounded-[8px] bg-axal-ground px-2.5 py-1.5 text-[12.5px] ${INK} dark:bg-gray-800`} data-testid="narrative-claim-note">{`Kept, with your note: ${claim.note.text}`}</p> : null}
        {claim.note_outdated ? <p className={`m-0 text-[12px] ${MUTED}`}>Your earlier note was about another figure, so it no longer applies.</p> : null}
        {!readOnly && claim.state === 'mismatch' && claim.record ? (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={GHOST} onClick={() => setStep({ kind: 'use' })} data-testid="narrative-claim-use">Use the record’s figure</button>
            {!claim.note ? <button type="button" className={GHOST} onClick={() => setStep({ kind: 'keep' })} data-testid="narrative-claim-keep">Keep mine, with a note</button> : null}
          </span>
        ) : null}
        {claim.state === 'not_backed' || claim.state === 'mismatch' ? (
          <section className="flex flex-col gap-2" data-testid="narrative-claim-candidates">
            <span className={EYEBROW}>Evidence candidates</span>
            {offered.map((o) => (
              <div key={o.proposal_uid} className={`${LAVENDER} flex flex-wrap items-center justify-between gap-2 p-2.5`} data-testid={`narrative-claim-eadwyn-${o.proposal_uid}`}>
                <span className="flex flex-col"><span className={EYEBROW}>Proposed by Eadwyn</span><span className={`text-[12.5px] ${INK}`}>{itemLine(o.item)}</span>{o.item.summary ? <span className={`text-[12px] ${MUTED}`}>{o.item.summary}</span> : null}</span>
                {!readOnly ? <button type="button" className={GHOST} onClick={() => setStep({ kind: 'link', item: o.item, proposal: o.proposal_uid })} data-testid={`narrative-claim-accept-${o.proposal_uid}`}>Accept</button> : null}
              </div>
            ))}
            {candidates.map((i) => (
              <div key={i.uid} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-axal-hairline p-2.5 dark:border-gray-700" data-testid={`narrative-claim-candidate-${i.uid}`}>
                <span className="flex flex-col"><span className={`text-[12.5px] ${INK}`}>{itemLine(i)}</span>{i.summary ? <span className={`text-[12px] ${MUTED}`}>{i.summary}</span> : null}</span>
                {!readOnly ? <button type="button" className={GHOST} onClick={() => setStep({ kind: 'link', item: i })} data-testid={`narrative-claim-link-${i.uid}`}>Link</button> : null}
              </div>
            ))}
            {!offered.length && !candidates.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="narrative-claim-no-records">{NO_RECORDS}</p> : null}
          </section>
        ) : null}
        <Link className={`${LINK} text-[12.5px]`} to={evidence} data-testid="narrative-claim-evidence">Open Evidence ›</Link>
      </div>
    );
  }
  return (
    <Lightbox label={claim.label} eyebrow={`${claim.section_label || 'Narrative'} · v${version}`} title={claim.label} width={560} onClose={onClose}
      pageBelow={phone ? 'lg' : undefined} testId="narrative-claim-drawer">
      <div className="flex flex-col gap-3">
        <Pill tone={STATE_TONE[claim.state] || 'neutral'}>{STATE_LABELS[claim.state] || claim.state}</Pill>
        {body}
        {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="narrative-claim-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}
