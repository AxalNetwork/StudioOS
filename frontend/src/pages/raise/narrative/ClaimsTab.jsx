import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable } from '../../../ui';
import { api as appApi } from '../../../lib/api';
import { narrativeApi } from '../../../lib/api/narrative';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import {
  checkLine, claimFilters, claimRows, claimSheet, claimsLine, filterClaims, fixScopeKey, lastChecked, sourceBar,
} from './claimsModel';

/**
 * D912 (#2696) — the Investor narrative's Claims tab (NAR6), the claim
 * lightbox (NAR7 Not backed, NAR7b Mismatch; a sheet on a phone, NAR19c), and
 * the Check tab's body (NAR8) with Phrase the fix (NAR9). Every state is
 * D1264's, read from `GET /narrative/:version/claims`; nothing here decides
 * one. Every write opens a dialog that says what it changes.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] w-fit items-center rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 sm:min-h-[36px] dark:hover:bg-violet-600';
const BTN_SEC = 'inline-flex min-h-[44px] w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[36px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const SELECT = 'min-h-[44px] rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12.5px] font-semibold text-axal-ink sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const PILL = {
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-600/50 dark:bg-amber-950/30 dark:text-amber-300',
  lav: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-400/40 dark:bg-violet-950/30 dark:text-violet-200',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  grey: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const BAR = { connector: 'bg-violet-600', signed: 'bg-sky-500', document: 'bg-emerald-500', recorded: 'bg-amber-500', typed: 'bg-gray-400' };

export const DEFAULT_CLAIMS_API = { narrative: narrativeApi, evidence: raiseEvidenceApi, app: appApi };

function StatePill({ state, testId }) {
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL[state.tone] || PILL.grey}`} data-testid={testId}>{state.label}</span>;
}

/** One version's claims, read on its own; `reload` re-reads it. */
export function useClaims(api, projectId, version) {
  const [st, setSt] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!projectId || version == null) return undefined;
    let alive = true;
    setSt({ status: 'loading', data: null });
    api.narrative.claims(projectId, version)
      .then((data) => { if (alive) setSt({ status: 'ready', data }); })
      .catch((error) => { if (alive) setSt({ status: [401, 403, 404].includes(error?.status) ? 'refused' : 'error', data: null, message: error?.message || '' }); });
    return () => { alive = false; };
  }, [api, projectId, version, n]);
  return { ...st, reload: useCallback(() => setN((x) => x + 1), []) };
}

/* ------------------------------------------------------------------ *
 * NAR7, NAR7b: the claim lightbox (a sheet on a phone, NAR19c)
 * ------------------------------------------------------------------ */

export function ClaimSheet({ row, version, search, projectId, founder, api, onClose, onChanged }) {
  const sheet = claimSheet(row, version, search);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!sheet) return null;
  const save = async (text) => {
    setBusy(true); setErr('');
    try {
      if (text == null) await api.evidence.clearNote(projectId, row.id); else await api.evidence.note(projectId, row.id, text);
      setNote(null); onChanged();
    } catch (e) { setErr(e?.message || 'The note could not be saved. Nothing was changed.'); }
    setBusy(false);
  };
  return (
    <Lightbox label={sheet.title} title={sheet.title} sub={sheet.sub} onClose={onClose} width={560} phone="sheet" testId="claim-sheet">
      <div className="flex flex-col gap-3" data-testid={`claim-sheet-${sheet.kind}`}>
        {sheet.kind === 'mismatch' ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className={`${CARD} p-3`} data-testid="claim-stated">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>Stated</span>
                <p className={`m-0 font-mono text-[17px] font-bold ${INK}`}>{sheet.stated.value}</p>
                <p className={`m-0 text-[12px] ${MUTED}`}>{sheet.stated.where}</p>
              </div>
              <div className={`${CARD} p-3`} data-testid="claim-record">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>Record</span>
                {sheet.record
                  ? <><p className={`m-0 font-mono text-[17px] font-bold ${INK}`}>{sheet.record.value}</p><p className={`m-0 text-[12px] ${MUTED}`}>{sheet.record.where}</p></>
                  : <p className={`m-0 text-[12.5px] ${MUTED}`}>The record’s figure is the founder’s to read.</p>}
              </div>
            </div>
            {sheet.note ? (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-[12.5px] text-violet-900 dark:border-violet-400/40 dark:bg-violet-950/30 dark:text-violet-200" data-testid="claim-note">
                <span className="font-bold">Kept, with a note. </span>{sheet.note.text ?? 'The founder kept their figure and wrote why.'}
                {founder ? <button type="button" className={`${LINK} ml-2`} onClick={() => save(null)} disabled={busy} data-testid="claim-note-clear">Clear the note</button> : null}
              </div>
            ) : null}
            {sheet.noteOutdated ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="claim-note-outdated">A note was written for another figure; it no longer applies.</p> : null}
            {founder ? (
              <div className="flex flex-wrap gap-2">
                {sheet.useRecord ? <Link to={sheet.useRecord} className={BTN} data-testid="claim-use-record">Use the record’s figure</Link> : null}
                {sheet.canNote && !sheet.note ? <button type="button" className={BTN_SEC} onClick={() => setNote('')} data-testid="claim-keep">Keep mine, with a note</button> : null}
              </div>
            ) : null}
            {sheet.useRecord && founder ? <p className={`m-0 text-[12px] ${MUTED}`}>Story opens on this version. Insert a figure binds the record’s figure, with its source and date, where your cursor is.</p> : null}
            {note !== null ? (
              <div className="flex flex-col gap-2" data-testid="claim-note-form">
                <label className={`flex flex-col gap-1 text-[12.5px] font-semibold ${INK}`}>Why you keep your figure
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className="rounded-[9px] border border-axal-hairline bg-white p-2 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="claim-note-input" />
                </label>
                <p className={`m-0 text-[12px] ${MUTED}`}>Your figure stays as stated and the claim stays a Mismatch, with your note beside it. Nothing else changes.</p>
                <div className="flex gap-2">
                  <button type="button" className={BTN} disabled={busy || !note.trim()} onClick={() => save(note.trim())} data-testid="claim-note-save">Keep mine</button>
                  <button type="button" className={BTN_SEC} onClick={() => setNote(null)}>Cancel</button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        {sheet.kind === 'not_backed' ? (
          <>
            {sheet.candidates == null ? <p className={`m-0 text-[12.5px] ${MUTED}`}>The records are the founder’s to read.</p>
              : !sheet.candidates.length ? (
                <div className={`${CARD} flex flex-col items-start gap-2 p-4`} data-testid="claim-no-records">
                  <p className={`m-0 text-[13px] font-semibold ${INK}`}>No records to back a claim yet.</p>
                  <p className={`m-0 text-[12.5px] ${MUTED}`}>Pin records in your Evidence pack, then run the check again.</p>
                  <Link to="/raise/evidence" className={BTN_SEC}>Open Evidence</Link>
                </div>
              ) : (
                <ul className={`${CARD} m-0 list-none divide-y divide-axal-hairline p-0 dark:divide-gray-800`} data-testid="claim-candidates">
                  {sheet.candidates.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12.5px]" data-testid={`claim-candidate-${c.id}`}>
                      <span className={INK}>{c.kind}</span>
                      <span className={MUTED}>{[c.source_label, c.provider, c.observed_on].filter(Boolean).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            {founder && sheet.candidates?.length ? <Link to={sheet.evidence} className={BTN} data-testid="claim-link">Link a record</Link> : null}
          </>
        ) : null}
        {sheet.kind === 'state' ? <Link to={sheet.evidence} className={LINK} data-testid="claim-evidence">See it in Evidence</Link> : null}
        {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="claim-error">{err}</p> : null}
      </div>
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * NAR6: Claims
 * ------------------------------------------------------------------ */

export function ClaimsTab({ projectId, version, search = '', api = DEFAULT_CLAIMS_API }) {
  const claims = useClaims(api, projectId, version);
  const [f, setF] = useState({ state: 'all', source: 'all', section: 'all', needsFirst: false });
  const [open, setOpen] = useState(null);
  if (claims.status === 'loading') return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="claims-loading" />;
  if (claims.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`} data-testid="claims-refused">{claims.message || 'Claims are the founder’s to read.'}</p>;
  // NAR17a: the claim store could not be read; that is not a claim that there are none.
  if (claims.status !== 'ready') return <Unreadable what="This version’s claims" claim="This is not a claim that there are none." onRetry={claims.reload} />;
  const rows = claimRows(claims.data);
  const founder = claims.data?.founder === true;
  if (!rows.length) {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2 p-5`} data-testid="claims-none">
        <span className={`text-[13.5px] font-bold ${INK}`}>{claims.data?.checked_at ? 'This version states no figure to back.' : 'This version has not been checked yet.'}</span>
        <span className={`text-[12.5px] ${MUTED}`}>A claim is a figure the narrative states. The check compares each with your pinned records.</span>
        <Link to={`/raise/investor-narrative/check${search ? `${search}${search.includes('version=') ? '' : `&version=${version}`}` : `?version=${version}`}`} className={LINK}>Go to Check</Link>
      </div>
    );
  }
  const filters = claimFilters(rows);
  const shown = filterClaims(rows, f);
  const bar = sourceBar(rows);
  const pick = (key) => (e) => setF((x) => ({ ...x, [key]: e.target.value }));
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-claims">
      <section className={`${CARD} flex flex-col gap-2 p-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Claims by best source</h2>
          <span className={`text-[12px] ${MUTED}`} data-testid="claims-line">{claimsLine(rows)} · {lastChecked(claims.data)}</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full" role="img" aria-label="Claims by best source" data-testid="claims-bar">
          {bar.map((p) => <span key={p.key} style={{ width: `${p.pct}%` }} className={p.dashed ? 'border border-dashed border-gray-400 bg-transparent dark:border-gray-500' : BAR[p.key]} data-testid={`claims-bar-${p.key}`} />)}
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-[12px]" data-testid="claims-legend">
          {bar.map((p) => <li key={p.key} className={`flex items-center gap-1.5 ${MUTED}`}><span className={`inline-block h-2.5 w-2.5 rounded-sm ${p.dashed ? 'border border-dashed border-gray-400' : BAR[p.key]}`} />{p.label} · {p.n}</li>)}
        </ul>
      </section>
      <div className="flex flex-wrap items-center gap-2" data-testid="claims-filters">
        <select aria-label="State" className={SELECT} value={f.state} onChange={pick('state')} data-testid="claims-filter-state">
          <option value="all">All states</option>{filters.state.map((o) => <option key={o.key} value={o.key}>{o.label} · {o.n}</option>)}
        </select>
        <select aria-label="Source" className={SELECT} value={f.source} onChange={pick('source')} data-testid="claims-filter-source">
          <option value="all">All sources</option>{filters.source.map((o) => <option key={o.key} value={o.key}>{o.label} · {o.n}</option>)}
        </select>
        <select aria-label="Section" className={SELECT} value={f.section} onChange={pick('section')} data-testid="claims-filter-section">
          <option value="all">All sections</option>{filters.section.map((o) => <option key={o.key} value={o.key}>{o.label} · {o.n}</option>)}
        </select>
        <label className={`flex min-h-[44px] items-center gap-2 text-[12.5px] font-semibold sm:min-h-0 ${INK}`}>
          <input type="checkbox" checked={f.needsFirst} onChange={(e) => setF((x) => ({ ...x, needsFirst: e.target.checked }))} data-testid="claims-needs" />Needs you
        </label>
      </div>
      <section className={CARD}>
        {!shown.length ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`} data-testid="claims-filtered-none">No claim matches these filters.</p> : shown.map((r) => (
          <button key={r.id} type="button" onClick={() => setOpen(r)} className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-2.5 text-left last:border-b-0 hover:bg-axal-ground dark:border-gray-800 dark:hover:bg-gray-800" data-testid={`claim-row-${r.id}`}>
            <span className="flex min-w-0 flex-col">
              <span className={`text-[13px] font-semibold ${INK}`}>{r.figure} · <span className="font-mono">{r.stated}</span></span>
              <span className={`text-[12px] ${MUTED}`}>{r.section} · {r.source}{r.note ? ' · kept, with a note' : ''}</span>
            </span>
            <StatePill state={r.state} testId={`claim-state-${r.id}`} />
          </button>
        ))}
      </section>
      {open ? <ClaimSheet row={open} version={version} search={search} projectId={projectId} founder={founder} api={api} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); claims.reload(); }} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * NAR8: the check, and NAR9: Phrase the fix
 * ------------------------------------------------------------------ */

/** Eadwyn phrases the fix for the claim clicked (`raise/narrative-fix`, scope `<project>|<claim>`); the wording carries no number. */
function FixSheet({ row, projectId, api, onClose }) {
  const [st, setSt] = useState({ status: 'idle', draft: null, err: '' });
  const run = async () => {
    setSt({ status: 'busy', draft: null, err: '' });
    try {
      const r = await api.app.zoneDraftRun('raise/narrative-fix', fixScopeKey(projectId, row.id), 'investor-narrative');
      setSt(r?.item?.body ? { status: 'ready', draft: r.item, err: '' } : { status: 'none', draft: null, err: '' });
    } catch (e) {
      // The Worker keeps no wording that states a number (`draft_unfaithful`); that is not a failure to say so.
      if (e?.code === 'draft_unfaithful' || e?.data?.detail === 'draft_unfaithful') setSt({ status: 'none', draft: null, err: '' });
      else setSt({ status: 'error', draft: null, err: e?.message || 'Eadwyn could not phrase it. Nothing was changed.' });
    }
  };
  const keep = async () => {
    try { await api.app.zoneDraftAccept(st.draft.uid); onClose(); } catch (e) { setSt((s) => ({ ...s, err: e?.message || 'It could not be kept.' })); }
  };
  return (
    <Lightbox label="Phrase the fix" title="Phrase the fix" sub={`${row.figure}: Eadwyn’s wording carries no number. The figures under it come from the check, and keeping it changes neither record.`} onClose={onClose} width={560} phone="sheet" testId="fix-sheet">
      <div className="flex flex-col gap-3">
        {st.status === 'idle' ? <button type="button" className={BTN} onClick={run} data-testid="fix-run">Phrase it · uses AI tokens</button> : null}
        {st.status === 'busy' ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Eadwyn is phrasing it…</p> : null}
        {st.status === 'none' ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="fix-none">Eadwyn’s wording stated a number, so it was not kept. Try again.</p> : null}
        {st.status === 'ready' ? (
          <>
            <p className={`m-0 whitespace-pre-line rounded-lg bg-violet-50 p-3 text-[13px] ${INK} dark:bg-violet-950/30`} data-testid="fix-draft">{st.draft.body}</p>
            <div className="flex gap-2">
              <button type="button" className={BTN} onClick={keep} data-testid="fix-keep">Keep the wording</button>
              <button type="button" className={BTN_SEC} onClick={onClose}>Close</button>
            </div>
          </>
        ) : null}
        {st.err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="fix-error">{st.err}</p> : null}
      </div>
    </Lightbox>
  );
}

export function CheckPanel({ projectId, version, search = '', fixOn = true, api = DEFAULT_CLAIMS_API }) {
  const claims = useClaims(api, projectId, version);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [fix, setFix] = useState(null);
  const [open, setOpen] = useState(null);
  if (claims.status === 'loading') return <div className="h-24 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="check-loading" />;
  if (claims.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`} data-testid="check-refused">{claims.message || 'The check is the founder’s to read.'}</p>;
  if (claims.status !== 'ready') return <Unreadable what="This version’s check" claim="This is not a claim that nothing differs." onRetry={claims.reload} />;
  const founder = claims.data?.founder === true;
  const rows = claimRows(claims.data);
  const run = async () => {
    setRunning(true); setErr('');
    try { await api.narrative.runCheck(projectId, version); claims.reload(); } catch (e) { setErr(e?.message || 'The check could not run. Nothing was changed.'); }
    setRunning(false);
  };
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-check">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <div className="flex flex-col gap-1">
            <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Check against the records</h2>
            <span className={`text-[12.5px] font-semibold ${INK}`} data-testid="narrative-check-summary">{checkLine(rows)}</span>
            <span className={`text-[12px] ${MUTED}`} data-testid="narrative-check-last">{lastChecked(claims.data)}</span>
          </div>
          {founder ? <button type="button" className={BTN} onClick={run} disabled={running} data-testid="narrative-check-run">{running ? 'Checking…' : 'Run the check'}</button> : null}
        </div>
        {rows.length === 0
          ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`} data-testid="narrative-check-none">Nothing compared yet.</p>
          : rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800" data-testid="narrative-check-row">
              <button type="button" className="flex min-h-[44px] min-w-0 flex-col text-left sm:min-h-0" onClick={() => setOpen(r)} data-testid={`check-open-${r.id}`}>
                <span className={`text-[13px] font-semibold ${INK}`}>{r.figure} · {r.section}</span>
                <span className={`text-[12px] ${MUTED}`}>Stated <span className="font-mono">{r.stated}</span>{r.record != null ? <> · record <span className="font-mono">{r.record}</span></> : null} · {r.source}</span>
              </button>
              <span className="flex items-center gap-2">
                {r.state.key === 'mismatch' && founder && fixOn ? <button type="button" className={LINK} onClick={() => setFix(r)} data-testid={`check-fix-${r.id}`}>Phrase the fix</button> : null}
                <StatePill state={r.state} />
              </span>
            </div>
          ))}
      </section>
      <p className={`m-0 text-[12.5px] leading-relaxed ${MUTED}`}>The check compares each figure this version states with your pinned records in Evidence. A figure no record measures is Not backed; one only a typed record agrees with is the Founder’s figure.</p>
      {err ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="narrative-check-error">{err}</p> : null}
      {fix ? <FixSheet row={fix} projectId={projectId} api={api} onClose={() => setFix(null)} /> : null}
      {open ? <ClaimSheet row={open} version={version} search={search} projectId={projectId} founder={founder} api={api} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); claims.reload(); }} /> : null}
    </div>
  );
}
