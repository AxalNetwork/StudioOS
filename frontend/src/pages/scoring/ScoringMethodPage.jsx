/**
 * D1253 (#2428) — SC11 "How scoring works" at `/scoring/method`, for any
 * signed-in member, linked from every scorecard panel. It draws the method from
 * `scorecardModel`: the eleven scopes in order, the grades, the confidence and
 * band rules, and what is never an input.
 *
 * D1260 (#3283): the model in force, cited. It reads `GET /api/venture-scores/models`,
 * which names the live version (v1.0 as D1255 shipped it, or the latest one
 * HQ published, D1259) and each scope's inputs: weight, what it reads and the
 * store it reads, or that no store backs it yet. A failed read says so; the
 * method's rules above it still stand.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CONFIDENCE, GRADES, NOT_ENOUGH, NOT_EXPECTED, SCOPES } from '../../components/scoring/scorecard/scorecardModel';
import { ventureScoresApi } from '../../lib/api/ventureScores.js';
import { reportError } from '../../lib/log';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

/** The status line: the live version, and when HQ published it, or that it scored before any publication was recorded. */
export function liveLine(read) {
  const live = read?.live;
  if (!live?.version) return null;
  if (live.default_live) return `Model v${live.version} is in force. It has scored every venture since the scorecard shipped; no later version is published.`;
  if (!live.published_at) return `Model v${live.version} is in force. The day it was published is not recorded.`;
  return `Model v${live.version} is in force, published ${String(live.published_at).slice(0, 10)}.`;
}

function ModelInForce() {
  const [read, setRead] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    setRead({ status: 'loading' });
    try { setRead({ status: 'ready', data: await ventureScoresApi.models() }); }
    catch (e) { reportError('ScoringMethod:models', e); setRead({ status: 'error' }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (read.status === 'loading') return <p className="m-0 text-sm text-axal-muted" aria-live="polite" data-testid="scoring-method-status">Reading the model in force…</p>;
  if (read.status === 'error') {
    return (
      <p className="m-0 text-sm text-axal-muted" data-testid="scoring-method-status">
        The model in force could not be read. The rules below still stand. <button type="button" className="underline" onClick={load}>Try again</button>
      </p>
    );
  }
  const d = read.data || {};
  return (
    <>
      <p className="m-0 text-sm text-axal-muted" data-testid="scoring-method-status">{liveLine(d) || 'The model in force is not recorded.'}</p>
      <section className={box} data-testid="scoring-method-citations">
        <h2 className="m-0 text-[15px] font-bold">What each scope reads, in model v{d.version}</h2>
        {(d.scopes || []).map((s) => (
          <div key={s.scope} data-testid={`scoring-method-scope-${s.scope}`}>
            <h3 className="m-0 text-[13.5px] font-bold">{s.label}</h3>
            {s.defined_by ? <p className="m-0 text-[12.5px] text-axal-muted">Defined by {s.defined_by}.</p> : null}
            <ul className="m-0 list-none p-0 text-[12.5px]">
              {(s.inputs || []).map((i) => (
                <li key={i.key} className="py-0.5">
                  <b>{i.label}</b> · weight {i.weight}{i.reads ? ` · ${i.reads}` : ''}
                  {' · '}<span className="font-mono">{i.source ? `reads ${i.source}` : (s.defined_by ? `see ${s.defined_by}` : 'no store yet: Not recorded')}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}


export default function ScoringMethodPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-5 text-axal-ink dark:text-gray-100" data-testid="scoring-method">
      <h1 className="m-0 text-2xl font-extrabold tracking-tight">How scoring works</h1>
      <ModelInForce />
      <section className={box}>
        <h2 className="m-0 text-[15px] font-bold">Eleven scopes, never one total</h2>
        <ol className="m-0 pl-5 text-sm" data-testid="scoring-method-scopes">{SCOPES.map((s) => <li key={s.key}>{s.label}</li>)}</ol>
        <p className="m-0 text-sm">Each investor sorts by their own weighting. There is no Overall.</p>
      </section>
      <section className={box}>
        <h2 className="m-0 text-[15px] font-bold">Evidence grades</h2>
        <p className="m-0 text-sm">A grade sets how sure a scope is, never its value: a typed figure is less certain, not lower.</p>
        <ul className="m-0 list-none p-0 text-sm" data-testid="scoring-method-grades">{GRADES.map((g) => <li key={g.key}><b>{g.label}</b> · {g.factor.toFixed(1)} · {g.what}</li>)}</ul>
      </section>
      <section className={box}>
        <h2 className="m-0 text-[15px] font-bold">Confidence and bands</h2>
        <ul className="m-0 list-none p-0 text-sm">
          {CONFIDENCE.map(([k, cut, label]) => <li key={k}>{label} confidence at {cut.toFixed(2)} or more.</li>)}
          <li>Below 0.25 a scope reads “{NOT_ENOUGH}” and shows no number. Missing is never 0.</li>
          <li>Strong at 70 or more, Fair from 40, Weak below 40. Risk reads Low, Medium or High risk on the same cut-offs.</li>
          <li>A scope that does not apply at a venture’s stage reads “{NOT_EXPECTED}”.</li>
        </ul>
      </section>
      <section className={box}>
        <h2 className="m-0 text-[15px] font-bold">Never an input</h2>
        <p className="m-0 text-sm">Name, photo, gender, age or date of birth, nationality, residence, ethnicity, religion, health, and school or employer names. Years of experience are not scored. No score changes a deal or venture status: a person decides.</p>
      </section>
    </main>
  );
}
