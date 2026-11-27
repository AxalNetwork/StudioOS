import React, { useState } from 'react';
import * as agents from './agentsAdapter.js';
import { Marker } from './SkillExtension.jsx';
import { BTN_PRIMARY, BTN_SECONDARY, MUTED } from './teamUi.jsx';
import { acceptedChoices, holdWords, partList, proposalLead, proposalsView, refusalState } from './skillProposalsModel.js';

/**
 * D8827 (#8827, D5963 SK-17) — Eadwyn's rail on Compare with Axal: a summary of what Axal changed from vB to vN, and a
 * proposal per conflicting part. Writers only (the page mounts it for an editor who may rebase).
 *
 * Asking is two presses: the Worker quotes the run (`{ estimate: true }`), and the run goes only with that quote. The
 * answer lives in this panel; nothing is stored. Accept puts a proposal's choice into "Rebase onto vN" and opens it
 * (`onRebase`); the draft is written only by Create draft there (`POST /skills/:uid/rebase`, `expected_draft_hash`).
 * When Eadwyn cannot answer, the panel says so and shows nothing in its place.
 */

const CARD = 'flex flex-col gap-2 rounded-axal-md border border-dashed border-axal-lavender-edge bg-axal-lavender px-3 py-2.5 text-[12.5px] leading-[1.5] text-axal-ink dark:border-violet-800 dark:bg-violet-900/20 dark:text-gray-200';
const EYE = 'flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-axal-violet-deep dark:text-violet-300';
const SMALL_BTN = `${BTN_SECONDARY} min-h-[44px] px-3 text-[12.5px] md:min-h-[32px]`;

function Value({ p }) {
  if (p.choice !== 'edit') return null;
  if (p.part === 'steps') return <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-5" data-testid={`proposal-value-${p.part}`}>{p.value.map((s, i) => <li key={i}>{s}</li>)}</ol>;
  if (p.part === 'tools') return <span className="flex flex-wrap gap-1" data-testid={`proposal-value-${p.part}`}>{p.value.map((t) => <code key={t} className="rounded border border-axal-hairline bg-white px-1 font-mono text-[11.5px] dark:border-gray-700 dark:bg-gray-900">{t}</code>)}</span>;
  return <span className="block border-l-2 border-axal-lavender-edge pl-2 dark:border-violet-700" data-testid={`proposal-value-${p.part}`}>{p.value}</span>;
}

export default function SkillProposals({ skillUid, view, onRebase }) {
  const v = view.newestVersion;
  const [state, setState] = useState({ kind: 'idle' });
  const [decided, setDecided] = useState({});
  const answer = state.kind === 'answer' ? state.answer : null;
  const accepted = Object.fromEntries(Object.entries(decided).filter(([, d]) => d === 'accepted').map(([k]) => [k, true]));

  const quote = async () => {
    setState({ kind: 'quoting' });
    const out = await agents.skillProposals(skillUid, { estimate: true });
    setState(out.available ? { kind: 'quote', estimate: out.value.estimate } : refusalState(out));
  };
  const ask = async (estimate) => {
    setState({ kind: 'running' });
    const out = await agents.skillProposals(skillUid, { quote: { hold_microusd: estimate.hold_microusd, model: estimate.model } });
    const shown = out.available ? proposalsView(out.value, view) : null;
    if (shown) { setDecided({}); setState({ kind: 'answer', answer: { ...shown, receipt: out.value.receipt || null } }); return; }
    setState(out.available ? refusalState({ refused: true, code: 'proposals_unmatched', reason: 'Eadwyn’s answer could not be matched to this comparison, so nothing is shown.' }) : refusalState(out));
  };
  const decide = (part, d) => setDecided((x) => ({ ...x, [part]: d }));
  const accept = (p) => {
    decide(p.part, 'accepted');
    onRebase?.(acceptedChoices(answer.proposals, { ...accepted, [p.part]: true }));
  };

  let body;
  if (state.kind === 'idle') {
    body = <button type="button" className={`${BTN_PRIMARY} min-h-[44px] md:min-h-0`} onClick={quote} data-testid="proposals-ask">Ask Eadwyn for proposals…</button>;
  } else if (state.kind === 'quoting' || state.kind === 'running') {
    body = <p aria-busy="true" role="status" className={`m-0 ${MUTED}`} data-testid="proposals-busy">{state.kind === 'quoting' ? 'Working out what this read holds…' : 'Eadwyn is reading the comparison…'}</p>;
  } else if (state.kind === 'quote') {
    body = (
      <div className="flex flex-col gap-2" data-testid="proposals-quote">
        <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-200">
          {state.changed ? <b>The cost changed since you looked. </b> : null}
          This read holds up to <b className="font-mono">{holdWords(state.estimate.hold_microusd)}</b> of your AI tokens and settles at what it uses.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BTN_PRIMARY} min-h-[44px] md:min-h-0`} onClick={() => ask(state.estimate)} data-testid="proposals-run">Ask Eadwyn</button>
          <button type="button" className={SMALL_BTN} onClick={() => setState({ kind: 'idle' })}>Cancel</button>
        </div>
      </div>
    );
  } else if (state.kind === 'unavailable' || state.kind === 'refused') {
    body = (
      <div role="status" className="flex flex-col gap-1.5 rounded-axal-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200" data-testid={`proposals-${state.kind}`}>
        {state.kind === 'unavailable' ? <b>Eadwyn is unavailable</b> : null}
        <span>{state.text}</span>
        <span>The comparison and Rebase still work without Eadwyn.</span>
        <span><button type="button" className={SMALL_BTN} onClick={() => setState({ kind: 'idle' })} data-testid="proposals-retry">Try again</button></span>
      </div>
    );
  } else {
    const a = answer;
    body = (
      <div className="flex flex-col gap-3" data-testid="proposals-answer">
        {decided.summary === 'discarded' ? null : (
          <section className={CARD} data-testid="proposal-summary">
            <span className={EYE}>Proposal · what Axal changed, v{view.baseVersion} → v{v}</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {a.summary.map((s) => <li key={s.part}><b>{s.label}</b> {s.text}</li>)}
              {a.undescribed.length ? <li className={MUTED}><b>{partList(a.undescribed)}</b> changed; Eadwyn did not describe {a.undescribed.length === 1 ? 'it' : 'them'}.</li> : null}
              {a.unchanged.length ? <li><b>{partList(a.unchanged)}</b> unchanged.</li> : null}
            </ul>
            <span><button type="button" className={SMALL_BTN} onClick={() => decide('summary', 'discarded')}>Discard</button></span>
          </section>
        )}
        {a.proposals.map((p) => {
          const d = decided[p.part];
          if (d === 'discarded') return null;
          return (
            <section key={p.part} className={CARD} data-testid={`proposal-${p.part}`}>
              <span className={EYE}>Proposal · {p.label} <Marker k="c" /></span>
              <p className="m-0"><b>{proposalLead(p, v)}</b> {p.why}</p>
              <Value p={p} />
              {d === 'accepted' ? (
                <>
                  <p className="m-0 font-semibold" role="status" data-testid={`proposal-${p.part}-accepted`}>Accepted. It is chosen for {p.label} in Rebase onto v{v}; nothing is saved until you create the draft there.</p>
                  <span className="flex flex-wrap gap-2">
                    <button type="button" className={SMALL_BTN} onClick={() => onRebase?.(acceptedChoices(a.proposals, accepted))}>Open the rebase</button>
                    <button type="button" className={SMALL_BTN} onClick={() => decide(p.part, null)} data-testid={`proposal-${p.part}-undo`}>Undo</button>
                  </span>
                </>
              ) : (
                <span className="flex flex-wrap gap-2">
                  <button type="button" className={SMALL_BTN} onClick={() => accept(p)} data-testid={`proposal-${p.part}-accept`}>Accept into the rebase</button>
                  <button type="button" className={SMALL_BTN} onClick={() => decide(p.part, 'discarded')} data-testid={`proposal-${p.part}-discard`}>Discard</button>
                </span>
              )}
            </section>
          );
        })}
        {a.withheld.map((w) => <p key={`${w.part}-${w.code}`} className="m-0 rounded-axal-md border border-amber-300 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:text-amber-200" data-testid={`proposal-withheld-${w.part}`}>{w.message}</p>)}
        {a.missing.length ? <p className={`m-0 ${MUTED}`} data-testid="proposals-missing">No proposal for {partList(a.missing)}. Choose {a.missing.length === 1 ? 'it' : 'them'} yourself in the rebase.</p> : null}
        <p className={`m-0 ${MUTED}`} data-testid="proposals-receipt">
          {Number.isFinite(a.receipt?.charged_microusd)
            ? <>Charged <span className="font-mono">{holdWords(a.receipt.charged_microusd)}</span>.</>
            : <>Held up to <span className="font-mono">{holdWords(a.receipt?.held_microusd)}</span>; what it charged is not recorded yet.</>}
        </p>
        <span><button type="button" className={SMALL_BTN} onClick={() => setState({ kind: 'idle' })}>Ask again</button></span>
      </div>
    );
  }

  return (
    <aside aria-label="Eadwyn" className="flex min-w-0 flex-col gap-3 self-start rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid="skill-proposals">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-lg bg-axal-violet text-[13px] font-extrabold text-white dark:bg-violet-600">E</span>
        <span className="flex flex-col"><b className="text-[14px] text-axal-ink dark:text-gray-100">Eadwyn</b><small className={MUTED}>Ask about this comparison</small></span>
      </div>
      <p className={`m-0 ${MUTED}`} data-testid="proposals-note">
        Drafted from what this page shows. Nothing is saved until you accept, and accepting only fills in Rebase onto v{v}; the draft is made when you create it there.
      </p>
      {body}
    </aside>
  );
}
