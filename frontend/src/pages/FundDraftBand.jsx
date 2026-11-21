import { useState } from 'react';

/**
 * #6252 (D6252): the fund pages' Eadwyn band, for the two actions the F1/F2 canvas puts on their rails ("Fund
 * brief", "Letter draft"). The shared WorkerRail draws no task of its own (its `action` prop is retired until
 * #5130's shell-wide rail), so the band sits on the page, as ZoneDraft's do, with the canvas's words.
 *
 * NOTHING RUNS ON MOUNT, AND NOTHING IS WRITTEN BUT BY ACCEPT. The press asks the Worker for a draft; the Worker
 * stores nothing. The draft shows with the records its [n] numbers cite. Accept hands the text to the page
 * (`onAccept`, given the text and the whole draft), which decides what Accept writes; Discard forgets it. `onAccept`
 * may be async: a returned sentence (or a rejected write) keeps the draft and shows the sentence. A refusal (AI off, the budget, nothing
 * recorded) is the Worker's own sentence, shown beside the button.
 *
 * `acceptBlocked`: where Accept cannot write yet, the sentence that says why, in place of the button.
 */
export default function FundDraftBand({ title, body, writes, run = 'Draft it', onRun, onAccept, acceptBlocked = null, blocked = null, testId }) {
  const [state, setState] = useState({ busy: false, draft: null, error: null });
  const press = async () => {
    if (blocked || state.busy) return;
    setState({ busy: true, draft: null, error: null });
    try {
      const r = await onRun();
      const draft = r?.draft;
      if (typeof draft?.body !== 'string' || !draft.body.trim() || !Array.isArray(draft.sources)) throw Object.assign(new Error('Eadwyn could not draft this just now. Nothing was written. Try again.'), { status: 503 });
      setState({ busy: false, draft, error: null });
    } catch (failure) {
      const sentence = [402, 403, 404, 409, 422, 503].includes(failure?.status) && failure?.message ? failure.message : 'Eadwyn could not draft this just now. Nothing was written. Try again.';
      setState({ busy: false, draft: null, error: sentence });
    }
  };
  const accept = async () => {
    if (!state.draft || !onAccept || state.busy) return;
    const draft = state.draft;
    setState((s) => ({ ...s, busy: true, error: null }));
    let refusal;
    try { refusal = await onAccept(draft.body.trim(), draft); }
    catch (failure) { refusal = failure?.message || 'The draft could not be kept. Nothing was written. Try again.'; }
    if (typeof refusal === 'string' && refusal) setState({ busy: false, draft, error: refusal });
    else setState({ busy: false, draft: null, error: null });
  };
  return <article className="fd-card fd-draft" aria-label={title} data-testid={testId}>
    <h2>{title}</h2>
    <p>{body}</p>
    {!state.draft && <div className="fd-actions">
      {blocked ? <p>{blocked}</p> : <button type="button" disabled={state.busy} onClick={press}>{state.busy ? 'Drafting…' : run}</button>}
    </div>}
    {state.draft && <>
      <p className="fd-draft-body">{state.draft.body}</p>
      <h3>Drawn from</h3>
      <ol className="fd-draft-sources">{state.draft.sources.map((s) => <li key={s.n} value={s.n}>{s.label}{s.date ? ` · ${s.date}` : ''}</li>)}</ol>
      <div className="fd-actions">
        {onAccept ? <button type="button" disabled={state.busy} onClick={accept}>{state.busy ? 'Keeping…' : 'Accept'}</button> : acceptBlocked ? <p>{acceptBlocked}</p> : null}
        <button type="button" onClick={() => setState({ busy: false, draft: null, error: null })}>Discard</button>
      </div>
    </>}
    {state.error && <p role="alert">{state.error}</p>}
    <small>{writes}</small>
  </article>;
}
