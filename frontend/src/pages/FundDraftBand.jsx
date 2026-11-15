import { useState } from 'react';

/**
 * #6252 (D6252): the fund pages' Eadwyn band, for the two actions the F1/F2 canvas puts on their rails ("Fund
 * brief", "Letter draft"). The shared WorkerRail draws no task of its own (its `action` prop is retired until
 * #5130's shell-wide rail), so the band sits on the page, as ZoneDraft's do, with the canvas's words.
 *
 * NOTHING RUNS ON MOUNT, AND NOTHING IS WRITTEN BUT BY ACCEPT. The press asks the Worker for a draft; the Worker
 * stores nothing. The draft shows with the records its [n] numbers cite. Accept hands the text to the page
 * (`onAccept`), which decides what Accept writes; Discard forgets it. A refusal (AI off, the budget, nothing
 * recorded) is the Worker's own sentence, shown beside the button.
 *
 */
export default function FundDraftBand({ title, body, writes, run = 'Draft it', onRun, onAccept, blocked = null, testId }) {
  const [state, setState] = useState({ busy: false, draft: null, error: null });
  const [accepting, setAccepting] = useState(false);
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
    if (!state.draft || !onAccept || accepting) return;
    setAccepting(true);
    setState((s) => ({ ...s, error: null }));
    try {
      const refusal = await onAccept(state.draft.body.trim(), state.draft);
      if (typeof refusal === 'string' && refusal) setState((s) => ({ ...s, error: refusal }));
      else setState({ busy: false, draft: null, error: null });
    } catch (failure) {
      const message = [400, 402, 403, 404, 413, 503].includes(failure?.status) && failure?.message
        ? failure.message : 'Accept could not be confirmed. Try again with this draft.';
      setState((s) => ({ ...s, error: message }));
    } finally {
      setAccepting(false);
    }
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
        {onAccept && <button type="button" disabled={accepting} onClick={accept}>{accepting ? 'Accepting…' : 'Accept'}</button>}
        <button type="button" disabled={accepting} onClick={() => setState({ busy: false, draft: null, error: null })}>Discard</button>
      </div>
    </>}
    {state.error && <p role="alert">{state.error}</p>}
    <small>{writes}</small>
  </article>;
}
