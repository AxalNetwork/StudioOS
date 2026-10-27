/**
 * D1267 (#3290) — the Evidence part under each Raise module's table (VR6), and
 * "Evidence on this slide" in the Pitch deck editor (VR7), with its optional
 * "Sources on Axal" slide.
 *
 * Both read the founder's evidence (`raiseEvidenceApi.read`) and open the
 * Evidence view's own drawers at their addresses. A reader the read refuses
 * (an advisor, a partner) sees no part at all: the evidence is the founders'
 * and their admins'. A failed read is Unreadable with Try again, never empty.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { BASE, claimHref, itemHref } from './evidenceModel';
import { claimTitle, claimWhere, itemFigure, itemTitle, statedFigure } from './evidenceView';
import { SOURCES_TITLE, deckChecked, moduleEvidence, slideClaims, sourcesLines } from './moduleEvidence';
import { BTN_S, BlockUnreadable, CARD, ChangeDialog, H2, LINK, MUTED, SharingPill, SourcePill, StatePill } from './EvidenceParts';

/** One read of the venture's evidence, or `refused` for a reader it is not for. */
export function useEvidenceRead(projectId) {
  const [state, setState] = useState({ status: projectId ? 'loading' : 'none' });
  const load = useCallback(() => {
    if (!projectId) { setState({ status: 'none' }); return () => {}; }
    let alive = true;
    setState({ status: 'loading' });
    raiseEvidenceApi.read(projectId, { limit: 100 })
      .then((read) => { if (alive) setState({ status: 'ready', read }); })
      .catch((e) => { if (alive) setState(e?.status === 403 || e?.status === 404 ? { status: 'refused' } : { status: 'error', message: e?.message || '' }); });
    return () => { alive = false; };
  }, [projectId]);
  useEffect(() => load(), [load]);
  return { state, reload: load };
}

/** VR6: drawn from a read, so the test renders every state. */
export function EvidencePartView({ slug, state, search = '', onRetry }) {
  if (!state || state.status === 'none' || state.status === 'refused') return null;
  if (state.status === 'loading') return <section className={CARD} data-testid="module-evidence" aria-busy="true"><h2 className={H2}>Evidence</h2><p className={MUTED}>Reading…</p></section>;
  if (state.status === 'error') return <section className={CARD} data-testid="module-evidence"><h2 className={H2}>Evidence</h2><BlockUnreadable id="module-evidence" reason={state.message || 'The evidence could not be read.'} onRetry={onRetry} /></section>;
  const part = moduleEvidence(state.read, slug);
  if (!part) return null;
  const { claims, items, version, hasClaims, hasItems } = part;
  return (
    <section className={CARD} id="evidence" data-testid="module-evidence" data-module={slug}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>Evidence{version ? ` · ${version}` : ''}</h2>
        <Link to={`${BASE}${search}`} className={LINK} data-testid="module-evidence-open">Open Evidence ›</Link>
      </div>
      <p className={MUTED}>{hasClaims ? 'What backs the figures stated here. Each one opens its claim drawer.' : 'The evidence pinned for this module. Each item opens its drawer.'}</p>
      {hasClaims ? (
        state.read?.claims?.state === 'unreadable' ? <BlockUnreadable id="module-claims" reason={state.read.claims.reason} onRetry={onRetry} />
          : claims && !claims.length ? <p className={MUTED} data-testid="module-claims-none">No claim stated here is checked yet.</p>
            : (
              <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
                {(claims || []).map((c) => (
                  <li key={c.uid} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="module-claim" data-state={c.state}>
                    <Link to={claimHref(c.uid, search)} className="text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">
                      {claimTitle(c)}{statedFigure(c) ? ` ${statedFigure(c)}` : ''}<span className="ml-2 text-[11.5px] font-normal text-axal-muted dark:text-gray-400">{claimWhere(c)}</span>
                    </Link>
                    <StatePill state={c.state} />
                  </li>
                ))}
              </ul>
            )
      ) : null}
      {hasItems ? (
        state.read?.items?.state === 'unreadable' ? <BlockUnreadable id="module-items" reason={state.read.items.reason} onRetry={onRetry} />
          : items && !items.length ? <p className={MUTED} data-testid="module-items-none">Nothing is pinned for this module yet. Waiting for review lists what could be.</p>
            : (
              <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
                {(items || []).map((i) => (
                  <li key={i.uid} className="flex flex-col gap-1 py-2" data-testid="module-item">
                    <Link to={itemHref(i.uid, search)} className="text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{itemTitle(i)}{itemFigure(i) ? ` · ${itemFigure(i)}` : ''}</Link>
                    <div className="flex flex-wrap items-center gap-2"><SourcePill source={i.source_label} provider={i.provider} on={i.observed_on} /><SharingPill visibility={i.visibility} /></div>
                  </li>
                ))}
              </ul>
            )
      ) : null}
    </section>
  );
}

/** VR6, mounted by the Raise module page's parts. */
export default function EvidencePart({ slug, projectId }) {
  const { search } = useLocation();
  const { state, reload } = useEvidenceRead(projectId);
  return <EvidencePartView slug={slug} state={state} search={search} onRetry={reload} />;
}

/**
 * VR7, drawn from a read: the claims the open slide states, each with its state
 * and source; the note that a share-link deck shows the slide only; and the
 * optional "Sources on Axal" card, added to the deck through a dialog and kept
 * only when the founder presses Save.
 */
export function SlideEvidenceView({ state, version, slide, readOnly = false, onAddSources, search = '' }) {
  const [dialog, setDialog] = useState(false);
  if (!state || state.status === 'none' || state.status === 'refused') return null;
  const read = state.read;
  const claims = state.status === 'ready' ? slideClaims(read, version, slide) : null;
  const checked = state.status === 'ready' ? deckChecked(read, version) : null;
  const lines = state.status === 'ready' ? sourcesLines(read, version) : null;
  return (
    <section className={CARD} data-testid="slide-evidence">
      <h2 className={H2}>Evidence on this slide</h2>
      {state.status === 'loading' ? <p className={MUTED}>Reading…</p> : null}
      {state.status === 'error' ? <BlockUnreadable id="slide-evidence" reason={state.message || 'The evidence could not be read.'} /> : null}
      {state.status === 'ready' && read?.claims?.state === 'unreadable' ? <BlockUnreadable id="slide-claims" reason={read.claims.reason} /> : null}
      {checked === false ? <p className={MUTED} data-testid="slide-not-checked">This version’s figures are not checked: the check reads the current deck when Evidence is opened.</p> : null}
      {claims && checked && !claims.length ? <p className={MUTED} data-testid="slide-no-claims">This slide states no figure the check reads.</p> : null}
      {claims?.length ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
          {claims.map((c) => (
            <li key={c.uid} className="flex flex-col gap-1 py-2" data-testid="slide-claim" data-state={c.state}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={claimHref(c.uid, search)} className="text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{claimTitle(c)}{statedFigure(c) ? ` ${statedFigure(c)}` : ''}</Link>
                <StatePill state={c.state} />
              </div>
              {c.record ? <SourcePill source={c.record.source_label} provider={c.record.provider} on={c.record.observed_on} /> : <SourcePill source={null} />}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 rounded-lg border border-axal-hairline bg-gray-50 px-3 py-2 text-[12px] text-axal-muted dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400" data-testid="slide-share-note">
        People who open this deck by link see the slides only. Evidence shows in the deal, the round call and the data room.
      </p>
      {!readOnly && lines?.length ? (
        <>
          <button type="button" className={`${BTN_S} w-fit`} onClick={() => setDialog(true)} data-testid="slide-add-sources">Add a “{SOURCES_TITLE}” slide</button>
          <div className="flex flex-col gap-0.5 rounded-lg border border-dashed border-axal-hairline p-2 dark:border-gray-700" data-testid="slide-sources-preview">
            <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">Preview · each figure, its source and its date</span>
            {lines.map((l) => <span key={l} className="text-[12px]">{l}</span>)}
          </div>
        </>
      ) : null}
      {dialog ? (
        <ChangeDialog title={`Add a “${SOURCES_TITLE}” slide?`} confirm="Add the slide" onClose={() => setDialog(false)} testId="slide-sources-dialog"
          says={`A card is added at the end of the deck listing each figure it states, its source and its date (${lines.length} ${lines.length === 1 ? 'line' : 'lines'}). Anyone who opens the deck by link sees it, as they see every card. Nothing is saved until you press Save.`}
          onConfirm={async () => { onAddSources?.(lines); }} />
      ) : null}
    </section>
  );
}

/** VR7, mounted by the editor beside its right panel. */
export function SlideEvidence({ projectId, version, slide, readOnly, onAddSources }) {
  const { search } = useLocation();
  const { state } = useEvidenceRead(projectId);
  return <SlideEvidenceView state={state} version={version} slide={slide} readOnly={readOnly} onAddSources={onAddSources} search={search} />;
}
