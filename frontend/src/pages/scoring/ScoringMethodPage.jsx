/**
 * D1253 (#2428) — SC11 "How scoring works" at `/scoring/method`, for any
 * signed-in member, linked from every scorecard panel. It draws the method from
 * `scorecardModel`: the eleven scopes in order, the grades, the confidence and
 * band rules, and what is never an input. Model v1 is not published yet
 * (part 2), and the page says so rather than presenting a draft as in force.
 */
import React from 'react';
import { CONFIDENCE, GRADES, NOT_ENOUGH, NOT_EXPECTED, SCOPES } from '../../components/scoring/scorecard/scorecardModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export default function ScoringMethodPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-5 text-axal-ink dark:text-gray-100" data-testid="scoring-method">
      <h1 className="m-0 text-2xl font-extrabold tracking-tight">How scoring works</h1>
      <p className="m-0 text-sm text-axal-muted" data-testid="scoring-method-status">Model v1 is the method below. It is not published yet, so no venture carries a score from it today.</p>
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
