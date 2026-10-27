import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbox, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import { narrativeApi } from '../../../lib/api/narrative';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import {
  FIX_NO_NUMBER, NOTHING_COMPARED, RESULT_LABELS, RESULT_TONE, SOURCE_UNREADABLE,
  acceptFixHref, againstLine, checkLine, fixParts, fixScope, lastChecked,
} from './claimsModel';

/**
 * D912 (#2696, part 6 of #2454) — NAR8, the Check tab, and NAR9, Phrase the
 * fix. It replaces D906's Check body and keeps "Nothing compared yet.".
 *
 * `GET /narrative/:version/check` compares each figure the version states with
 * the current deck's (read from its cards, bound or typed) and the metrics, as
 * the version's "Check against" chooses (#2447). A figure stated in one place
 * only is Not compared. Run the check (`POST`, the founder's) checks the
 * version, writes its claims and stamps "Last checked".
 *
 * Phrase the fix is for the mismatch clicked, not always the first: Eadwyn's
 * `raise/narrative-fix` band, scoped to the version and the figure. Its
 * wording carries no number; the figures under it are the check's. "Accept
 * into [section]" places the wording in Story as a proposal, where Accept and
 * Save version decide; nothing is written here.
 */
const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground dark:hover:bg-gray-800 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LAVENDER = 'rounded-[10px] border border-axal-lavender-edge bg-axal-lavender p-3 dark:border-violet-800 dark:bg-violet-950/40';

/** The Worker's sentence, or ours when it sent a bare code (`draft_unavailable`). */
function refusal(e, fallback) {
  const m = typeof e?.message === 'string' ? e.message.trim() : '';
  return m && !/^[a-z_]+$/.test(m) ? m : fallback;
}

export default function CheckTab({ projectId, version, search = '', admin = false, fixOn = true }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [fix, setFix] = useState(null);
  const load = useCallback(async (write) => {
    setState((s) => ({ status: 'loading', data: s.data, error: null }));
    try {
      const data = write ? await narrativeApi.runCheck(projectId, version) : await narrativeApi.check(projectId, version);
      setState({ status: 'ready', data, error: null });
    } catch (e) {
      reportError('narrative:check', e);
      setState((s) => ({ status: 'error', data: s.data, error: refusal(e, SOURCE_UNREADABLE) }));
    }
  }, [projectId, version]);
  useEffect(() => { load(false); }, [load]);

  const data = state.data;
  const canCheck = !admin && data?.can_check === true;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const deckHead = data?.deck?.version ? `Deck v${data.deck.version}` : 'Deck';
  return (
    <div className="flex flex-col gap-3.5" data-testid="narrative-check">
      <section className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <div className="flex flex-col gap-1">
            <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Check against the deck and the metrics</h2>
            {data ? <span className={`text-[12px] ${MUTED}`} data-testid="narrative-check-against">{againstLine(data)}</span> : null}
            {data ? <span className={`text-[12.5px] font-semibold ${INK}`} data-testid="narrative-check-summary">{checkLine(data)}</span> : null}
            <span className={`text-[12px] ${MUTED}`} data-testid="narrative-check-last">{lastChecked(data?.checked_at)}</span>
          </div>
          {canCheck ? <button type="button" className={BTN} disabled={state.status === 'loading'} onClick={() => load(true)} data-testid="narrative-check-run">Run the check</button> : null}
        </div>
        {state.status === 'loading' && !data ? <div className="m-4 h-20 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="narrative-loading" /> : null}
        {state.status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-3" data-testid="narrative-check-error">
            <span className="text-[12.5px] text-red-700 dark:text-red-300">{state.error}</span>
            <button type="button" className={GHOST} onClick={() => load(false)}>Try again</button>
          </div>
        ) : null}
        {data && !rows.length ? <p className={`m-0 px-4 py-4 text-[13px] ${MUTED}`} data-testid="narrative-check-none">{NOTHING_COMPARED}</p> : null}
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12.5px]" data-testid="narrative-check-table">
              <thead>
                <tr className={`bg-axal-ground dark:bg-gray-800 ${EYEBROW}`}>
                  <th className="px-4 py-2">Figure</th><th className="px-4 py-2">Narrative</th><th className="px-4 py-2">{deckHead}</th><th className="px-4 py-2">Metrics</th><th className="px-4 py-2">Result</th><th className="px-4 py-2"><span className="sr-only">Fix</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.figure} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid="narrative-check-row">
                    <td className={`px-4 py-2.5 font-semibold ${INK}`}>{r.label}{r.section_label ? <span className={`block text-[11.5px] font-normal ${MUTED}`}>{r.section_label}</span> : null}</td>
                    <td className={`px-4 py-2.5 font-mono ${INK}`}>{r.narrative?.shown}</td>
                    <td className="px-4 py-2.5" data-testid={`narrative-check-deck-${r.figure}`}>{r.deck ? <><span className={`font-mono ${INK}`}>{r.deck.shown}</span><span className={`block text-[11px] ${MUTED}`}>{r.deck.source}</span></> : <span className={MUTED}>Not stated</span>}</td>
                    <td className="px-4 py-2.5" data-testid={`narrative-check-metrics-${r.figure}`}>{r.metrics ? <><span className={`font-mono ${INK}`}>{r.metrics.shown}</span><span className={`block text-[11px] ${MUTED}`}>{r.metrics.source}</span></> : <span className={MUTED}>Not recorded</span>}</td>
                    <td className="px-4 py-2.5"><Pill tone={RESULT_TONE[r.result] || 'neutral'}>{RESULT_LABELS[r.result] || r.result}</Pill></td>
                    <td className="px-4 py-2.5 text-right">
                      {r.result === 'mismatch' && r.metrics && fixOn && canCheck
                        ? <button type="button" className={GHOST} onClick={() => setFix(r)} data-testid={`narrative-check-fix-${r.figure}`}>Phrase the fix</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <p className={`m-0 text-[12.5px] leading-relaxed ${MUTED}`}>A figure stated in one place only is Not compared. Neither side is presumed right.</p>
      {fix ? <FixDialog projectId={projectId} version={version} row={fix} search={search} onClose={() => setFix(null)} /> : null}
    </div>
  );
}

/** NAR9: Eadwyn phrases the fix for the row clicked; the wording carries no number. */
function FixDialog({ projectId, version, row, search, onClose }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'idle', draft: null, error: null });
  const ask = async () => {
    setState({ status: 'busy', draft: null, error: null });
    try {
      const r = await api.research.zoneDraftRun('raise/narrative-fix', fixScope(projectId, version, row.figure), '/raise/investor-narrative/check', railPressHeaders('draft:raise/narrative-fix'));
      setState({ status: 'done', draft: r?.item || null, error: null });
    } catch (e) {
      setState({ status: 'error', draft: null, error: e?.code === 'draft_unfaithful' ? 'Eadwyn’s wording held a number, so none was kept. Write the fix yourself in Story.' : refusal(e, 'Eadwyn could not phrase the fix just now. Nothing was charged.') });
    }
  };
  const parts = state.draft ? fixParts(state.draft.body) : null;
  const section = row.section_label || 'the section';
  return (
    <Lightbox label="Phrase the fix" eyebrow={`${row.label} · v${version}`} title="Phrase the fix" sub={FIX_NO_NUMBER} width={560} onClose={onClose} testId="narrative-fix-dialog">
      <div className="flex flex-col gap-3">
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]" data-testid="narrative-fix-figures">
          <dt className={MUTED}>Narrative</dt><dd className={`m-0 font-mono ${INK}`}>{row.narrative?.shown}</dd>
          {row.metrics ? <><dt className={MUTED}>Metrics</dt><dd className={`m-0 font-mono ${INK}`}>{row.metrics.shown} <span className={`font-sans ${MUTED}`}>· {row.metrics.source}</span></dd></> : null}
          {row.deck ? <><dt className={MUTED}>Deck</dt><dd className={`m-0 font-mono ${INK}`}>{row.deck.shown} <span className={`font-sans ${MUTED}`}>· {row.deck.source}</span></dd></> : null}
        </dl>
        {state.status !== 'done' ? <button type="button" className={BTN} onClick={ask} disabled={state.status === 'busy'} data-testid="narrative-fix-ask">{state.status === 'busy' ? 'Phrasing…' : 'Ask Eadwyn to phrase it'}</button> : null}
        {state.error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="narrative-fix-error">{state.error}</p> : null}
        {parts ? (
          <div className={`${LAVENDER} flex flex-col gap-2`} data-testid="narrative-fix-proposal">
            <span className={EYEBROW}>Proposed by Eadwyn</span>
            <p className={`m-0 whitespace-pre-line text-[13.5px] leading-relaxed ${INK}`} data-testid="narrative-fix-wording">{parts.wording}</p>
            {parts.found ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid="narrative-fix-found">{`As the check found them: ${parts.found}`}</p> : null}
            <span className="flex flex-wrap gap-2">
              <button type="button" className={BTN} data-testid="narrative-fix-accept"
                onClick={() => navigate(acceptFixHref(search, version, row.section, state.draft.uid))}>{`Accept into ${section}`}</button>
              <button type="button" className={GHOST} onClick={onClose}>Discard</button>
            </span>
          </div>
        ) : null}
      </div>
    </Lightbox>
  );
}
