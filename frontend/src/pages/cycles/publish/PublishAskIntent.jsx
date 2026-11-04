/**
 * #4046 (S1, 2026-11-04) — Ask on Publish to…'s post text, as a form intent in
 * the Ask panel (D1443 part 4, `AskIntent`), like the email draft (#4017).
 *
 *   Ask       the places it writes for, what it drafts from (the module's
 *             records), and the hold before the run: "Holds up to $X · you pay
 *             what it uses". Draft is pressable only once that line is on
 *             screen (`canAskDraft`).
 *   Preview   the post as Eadwyn wrote it, "Used: … Nothing else was read.",
 *             its versions (‹ ›) and Regenerate.
 *   Accept    hands the text to the sheet (`onAccept`), which places it in the
 *             Draft box with the "From Eadwyn" mark. Nothing is sent: only the
 *             confirm dialog's Send publishes. Discard closes the intent and
 *             leaves the Draft as it was.
 *
 * It reads and writes nothing else: the run is `POST /api/publish/ask`, which
 * writes no draft, proposal or send.
 */
import { useEffect, useMemo, useState } from 'react';
import AskIntent from '../../../ui/AskIntent.jsx';
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens';
import { publishApi } from '../../../lib/api/publish.js';
import { ASK_ACCEPT_LINE, ASK_HOLD_READING, ASK_REPLACES, askHoldLine, askPlaces, canAskDraft } from './publishAskModel.js';
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, MUTED } from './SendParts.jsx';
import { accountOn, moduleLabel } from './publishModel.js';

export default function PublishAskIntent({ projectId, module, ticked = [], places = [], hasText = false, onAccept, onClose, api = publishApi }) {
  const uids = useMemo(() => askPlaces(ticked), [ticked]);
  const ask = useMemo(() => ({ project_id: projectId, module, destination_uids: uids }), [projectId, module, uids]);
  const [estimate, setEstimate] = useState(null);
  const [sources, setSources] = useState([]);
  const [versions, setVersions] = useState([]);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const names = places.filter((p) => uids.includes(p.uid)).map((p) => accountOn(p.account, p.provider_key));

  // The quote before every draft: `estimate` runs nothing and charges nothing.
  useEffect(() => {
    let live = true;
    setEstimate(null); setError(null);
    api.ask({ ...ask, estimate: true })
      .then((r) => { if (live) { setEstimate(r?.estimate ?? null); setSources(r?.sources ?? []); } })
      .catch((e) => { if (live) setError(e?.message || 'The cost of this draft could not be worked out. Try again.'); });
    return () => { live = false; };
  }, [ask, api]);

  const draft = versions[at] ?? null;
  const hold = askHoldLine(estimate);
  const pressable = canAskDraft({ estimate, busy });
  const press = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.ask(ask);
      if (r?.text) { setVersions((v) => [...v, { text: r.text, sources: r.sources ?? sources }]); setAt(versions.length); }
    } catch (e) {
      setError(e?.status === 402 ? { line: e.message || 'Not enough AI tokens for this draft.', topUp: true } : (e?.message || 'Eadwyn could not draft this post. Try again.'));
    } finally { setBusy(false); }
  };

  const footer = draft
    ? <span className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => onAccept?.(draft.text)} data-testid="publish-ask-accept">Accept</button>
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onClose} data-testid="publish-ask-discard">Discard</button>
        <span className={`text-[12px] ${MUTED}`}>{ASK_ACCEPT_LINE}{hasText ? ` ${ASK_REPLACES}` : ''}</span>
      </span>
    : <span className="flex flex-col gap-1.5">
        <span className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="publish-ask-hold">{hold ?? ASK_HOLD_READING}</span>
        <button type="button" className={`${BTN_PRIMARY} self-start`} disabled={!pressable} onClick={press} data-testid="publish-ask-draft">{busy ? 'Drafting…' : 'Draft'}</button>
      </span>;

  return (
    <AskIntent label="Draft a post" title={`A post from ${moduleLabel(module)}`} footer={footer} onClose={onClose} testId="publish-ask">
      {!draft ? (
        <div className="flex flex-col gap-2">
          <span className={EYEBROW}>For</span>
          <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="publish-ask-places">{names.join(', ')}</p>
          <span className={EYEBROW}>From</span>
          <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="publish-ask-sources">
            {sources.length ? sources.map((s) => s.label).join(', ') : `What ${moduleLabel(module)} has recorded`}. Team-only figures are never read.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-2" aria-label="Preview" data-testid="publish-ask-preview">
          <span className="flex items-center justify-between gap-2">
            <span className={EYEBROW}>Preview · version {at + 1} of {versions.length}</span>
            <span className="flex gap-1">
              <button type="button" className={BTN_SECONDARY} aria-label="Previous version" disabled={at === 0} onClick={() => setAt(at - 1)}>‹</button>
              <button type="button" className={BTN_SECONDARY} aria-label="Next version" disabled={at >= versions.length - 1} onClick={() => setAt(at + 1)}>›</button>
            </span>
          </span>
          <p className="m-0 whitespace-pre-wrap text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="publish-ask-text">{draft.text}</p>
          <p className={`m-0 text-[12px] ${MUTED}`}>Used: {(draft.sources ?? []).map((s) => s.label).join(', ') || 'nothing'}. Nothing else was read.</p>
          <span className="flex flex-wrap gap-1.5">
            <button type="button" className={BTN_SECONDARY} disabled={!pressable} onClick={press} data-testid="publish-ask-regenerate">Regenerate</button>
          </span>
          <span className={`text-[12px] ${MUTED}`}>{hold ?? ASK_HOLD_READING}</span>
        </section>
      )}
      {error ? <div role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-800 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200" data-testid="publish-ask-error">
        {typeof error === 'string' ? error : error.line}
        {typeof error === 'object' && error.topUp ? <a href={ADD_TOKENS_PATH} className="ml-2 font-semibold underline">Top up</a> : null}
      </div> : null}
    </AskIntent>
  );
}
