/**
 * #4651 (Pricing audit 1/5) — what /register says about the plan a visitor chose on /pricing, and about what signing
 * up does and does not do. `lib/planIntent.js` holds the contract; `lib/planSelection.js` reads the catalogue.
 *
 *   PlanSelection      the chosen plan: its name, what it costs a month, how it is charged, the full commitment, or
 *                      that it is not offered or could not be read. Never a substitute plan, never a guessed price.
 *   RegistrationSteps  account creation, the profile step and checkout as three separate things, with when payment
 *                      begins; and, for a founder, the Spin-Out Lab application as a fourth, optional, separate one.
 *   SignedInPlanNotice a signed-in visitor who follows a plan link here is told so and given a choice, instead of
 *                      being signed out in silence.
 *
 * Words only. Nothing here charges, creates or changes anything.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pricingReturnPath, specFor } from '../../lib/planIntent';
import { selectionFor } from '../../lib/planSelection';
import { publicPricingApi } from '../../lib/api/publicPricing';

export const STEPS = (plan, lane) => [
  { key: 'account', title: 'Create your account', line: 'This is free. No payment is taken on this page.' },
  { key: 'profile', title: 'Choose your profile', line: 'Plans belong to a profile: Founder, Investor, Advisor or Operating Partner. A plan can only be bought once your profile is chosen; until then Checkout asks you to choose it first. A new account is also reviewed before its workspace opens.' },
  plan
    ? { key: 'checkout', title: `Check out ${plan.name}`, line: plan.state === 'ready' ? `Payment starts only when you confirm on Stripe’s secure page, at the price Checkout shows then. ${plan.basis === 'billed every month' ? 'Charged each month.' : `Billed ${plan.basis.replace(/^.* billed /, '')}.`}` : 'Payment starts only when you confirm checkout.' }
    : { key: 'checkout', title: 'Pick a plan when you want one', line: 'Plans are optional. Payment starts only when you confirm checkout.' },
  ...(lane === 'founder' ? [{ key: 'spinout', title: 'Optional: apply to the Spin-Out Lab', line: 'This is a separate application you make after you sign in. It is not part of any plan and not needed to create your account.' }] : []),
];

export function PlanSelection({ selection }) {
  if (!selection) return null;
  const ready = selection.state === 'ready';
  return (
    <section className={`mb-4 rounded-lg border px-3 py-3 text-sm ${ready ? 'border-violet-200 bg-violet-50 text-gray-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
      role="status" data-testid="register-plan" data-state={selection.state}>
      {ready ? (
        <>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-violet-700">Your selected plan</p>
          <p className="m-0 mt-1 text-base font-bold" data-testid="register-plan-name">{selection.name}</p>
          <p className="m-0 mt-1" data-testid="register-plan-price">{selection.perMonth} · {selection.basis}</p>
          <p className="m-0 mt-1 text-gray-600" data-testid="register-plan-commitment">{selection.commitment}</p>
          <p className="m-0 mt-1 text-xs text-gray-600">You will see the exact total, and any tax, at checkout before you pay.</p>
          <p className="m-0 mt-1 text-xs"><Link to={`/pricing?for=${selection.tab}`} className="font-semibold text-violet-700 underline" data-testid="register-plan-change">Change plan</Link></p>
        </>
      ) : (
        <p className="m-0" data-testid="register-plan-line">{selection.line}{' '}<Link to="/pricing" className="font-semibold underline">See plans</Link></p>
      )}
    </section>
  );
}

export function RegistrationSteps({ selection, lane }) {
  const steps = STEPS(selection?.state === 'ready' || selection?.state === 'unreadable' ? selection : null, lane);
  return (
    <ol className="mb-5 list-none space-y-2 p-0 text-xs text-gray-600" data-testid="register-steps">
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-2" data-testid={`register-step-${s.key}`}>
          <span aria-hidden="true" className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-700">{i + 1}</span>
          <span><b className="text-gray-800">{s.title}.</b> {s.line}</span>
        </li>
      ))}
    </ol>
  );
}

export function SignedInPlanNotice({ user, intent, onSignOut }) {
  const found = specFor(intent.planKey);
  const name = found?.spec.name || null;
  const to = found ? pricingReturnPath({ tab: found.tab, planKey: intent.planKey, interval: intent.interval }) : '/pricing';
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4" data-testid="register-signed-in">
      <div className="max-w-md rounded-lg border border-gray-200 p-6 text-sm text-gray-800">
        <h1 className="m-0 text-lg font-bold">You are already signed in</h1>
        <p className="mt-2">You are signed in as {user?.name || user?.email || 'this account'}. {name ? `To get ${name}, open it on Pricing: checkout opens there for your account.` : 'Plans are bought on Pricing while you are signed in.'}</p>
        <p className="mt-2 text-gray-600">Nothing has been changed, and you were not signed out.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={to} className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white" data-testid="register-signed-in-continue">Continue to Pricing</Link>
          <button type="button" className="rounded-lg border border-gray-300 px-4 py-2 font-semibold" onClick={onSignOut} data-testid="register-signed-in-signout">Sign out and create a different account</button>
        </div>
      </div>
    </div>
  );
}

/**
 * What /register draws under its heading: the chosen plan (read from the public catalogue, `undefined` while reading,
 * `false` when it could not be) and the steps. `onSelection` hands the plan up so the page can head itself with it.
 */
export function RegistrationPlanBlock({ intent, lane, onSelection, api = publicPricingApi }) {
  const [catalogue, setCatalogue] = useState(undefined);
  useEffect(() => {
    if (!intent) return undefined;
    let alive = true;
    api.plansAndPacks().then((r) => { if (alive) setCatalogue(r); }, () => { if (alive) setCatalogue(false); });
    return () => { alive = false; };
  }, [intent, api]);
  const selection = intent && catalogue !== undefined ? selectionFor(catalogue || null, intent) : null;
  useEffect(() => { onSelection?.(selection); }, [selection?.state, selection?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {intent && catalogue === undefined && <p className="text-xs text-gray-600 mb-4" data-testid="register-plan-reading">Reading the plan you chose…</p>}
      <PlanSelection selection={selection} />
      <RegistrationSteps selection={selection} lane={lane} />
    </>
  );
}
