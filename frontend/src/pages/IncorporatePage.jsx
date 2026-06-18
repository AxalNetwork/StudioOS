import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Globe2, CheckCircle2, Loader2, ArrowRight, ArrowLeft,
  AlertTriangle, Sparkles, Scale, DollarSign, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import AxalCheckout from '../components/AxalCheckout';
import { useIncorporationStatus } from '../hooks/useIncorporationStatus';
import IncorporationStatusBadge from '../components/IncorporationStatusBadge';

// Task #30 — Jurisdiction wizard + incorporation flow.
//
// Four steps:
//   1. Goal questionnaire           → recommends a jurisdiction
//   2. Compare jurisdictions table  → user confirms a choice
//   3. Confirm + company name + project picker
//   4. Submit → Delaware C-Corp deep-links to Stripe Atlas; others
//      generate the doc set and surface in /legal.
//
// Auth: gated by RequireAuth in App.jsx. Backend route additionally
// permits founders-of-project, partners, investors, and admins.

const STEPS = [
  { id: 'goals', label: 'Tell us your goals', icon: Sparkles },
  { id: 'compare', label: 'Compare jurisdictions', icon: Globe2 },
  { id: 'confirm', label: 'Company details', icon: Building2 },
  { id: 'payment', label: 'Pay & file', icon: DollarSign },
  { id: 'done', label: 'Done', icon: CheckCircle2 },
];

function formatMoney(cents, currency) {
  const amt = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(amt);
  } catch {
    return `${amt.toFixed(2)} ${(currency || '').toUpperCase()}`.trim();
  }
}

function recommend(answers) {
  // Tiny rules engine — favours fundraising-friendly jurisdictions when
  // the founder plans to raise institutional capital.
  if (answers.raisingVc === 'yes_us') return 'us_de_ccorp';
  if (answers.raisingVc === 'yes_eu') return 'uk_ltd';
  if (answers.region === 'apac') return 'sg_pte';
  if (answers.minimalCost === 'yes' && answers.raisingVc !== 'yes_us') return 'ee_oy';
  if (answers.entityPref === 'llc') return 'us_de_llc';
  return 'us_de_ccorp';
}

function Stepper({ current }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center text-center min-w-0">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 transition-colors ${
                done ? 'bg-emerald-500 text-white' :
                active ? 'bg-violet-600 text-white ring-4 ring-violet-100' :
                'bg-gray-100 text-gray-400'
              }`}>
                {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
              </div>
              <div className={`text-[11px] leading-tight max-w-[90px] ${done || active ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                {s.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mt-[-20px] mx-2 ${i < current ? 'bg-emerald-500' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ChoiceCard({ active, label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left border rounded-lg p-3 transition-colors ${
        active
          ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
      {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
    </button>
  );
}

function GoalsStep({ answers, setAnswers }) {
  const set = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));
  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">
          Are you raising venture capital?
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <ChoiceCard active={answers.raisingVc === 'yes_us'} label="Yes — US investors" hint="Sand Hill, Tier-1 funds" onClick={() => set('raisingVc', 'yes_us')} />
          <ChoiceCard active={answers.raisingVc === 'yes_eu'} label="Yes — EU / UK investors" hint="SEIS/EIS angels, EU funds" onClick={() => set('raisingVc', 'yes_eu')} />
          <ChoiceCard active={answers.raisingVc === 'no'} label="Bootstrapping" hint="Cash-flow, no VC" onClick={() => set('raisingVc', 'no')} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">
          Where will most of your customers be?
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ChoiceCard active={answers.region === 'us'} label="United States" onClick={() => set('region', 'us')} />
          <ChoiceCard active={answers.region === 'eu'} label="Europe / UK" onClick={() => set('region', 'eu')} />
          <ChoiceCard active={answers.region === 'apac'} label="Asia-Pacific" onClick={() => set('region', 'apac')} />
          <ChoiceCard active={answers.region === 'global'} label="Global / remote" onClick={() => set('region', 'global')} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">
          Optimise for minimum incorporation cost?
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ChoiceCard active={answers.minimalCost === 'yes'} label="Yes — under $500" hint="Lean / pre-revenue" onClick={() => set('minimalCost', 'yes')} />
          <ChoiceCard active={answers.minimalCost === 'no'} label="No — pick the right tool" hint="Best fit, not cheapest" onClick={() => set('minimalCost', 'no')} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">
          Strong preference on entity type?
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ChoiceCard active={answers.entityPref === 'corp'} label="Corporation" hint="Stock, options, VC" onClick={() => set('entityPref', 'corp')} />
          <ChoiceCard active={answers.entityPref === 'llc'} label="LLC / Pass-through" hint="Simple, tax-flexible" onClick={() => set('entityPref', 'llc')} />
          <ChoiceCard active={answers.entityPref === 'either'} label="No preference" onClick={() => set('entityPref', 'either')} />
        </div>
      </div>
    </div>
  );
}

function CompareStep({ jurisdictions, recommendedId, selectedId, setSelectedId }) {
  if (!jurisdictions || jurisdictions.length === 0) {
    // Bootstrap fetch returned 404 (or empty) for legalJurisdictions. Render
    // a friendly empty state instead of letting the user step forward into
    // an unfillable confirm screen.
    return (
      <div className="py-10 text-center">
        <div className="text-base font-semibold text-gray-900 mb-1 dark:text-gray-100">Jurisdiction options aren't available right now</div>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Please refresh in a moment, or contact support if this keeps happening. The wizard needs the jurisdiction list to recommend and prepare your founder document set.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm text-gray-600 mb-4">
        Based on your answers we recommend{' '}
        <span className="font-semibold text-violet-700">
          {jurisdictions.find((j) => j.id === recommendedId)?.label || '—'}
        </span>
        . Compare and pick what fits.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {jurisdictions.map((j) => {
          const active = selectedId === j.id;
          const recommended = j.id === recommendedId;
          return (
            <button
              key={j.id}
              type="button"
              onClick={() => setSelectedId(j.id)}
              className={`text-left border rounded-xl p-4 transition-colors ${
                active
                  ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-base font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
                    {j.label}
                    {recommended && (
                      <span className="text-[10px] uppercase tracking-wide bg-violet-600 text-white px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{j.country} · {j.entity_type}</div>
                </div>
                {active && <CheckCircle2 size={18} className="text-violet-600 flex-shrink-0" />}
              </div>
              <div className="text-xs text-gray-700 leading-snug mb-3 dark:text-gray-300">{j.summary}</div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-700 mb-3 dark:text-gray-300">
                <div className="flex items-center gap-1">
                  <DollarSign size={12} className="text-gray-400" />
                  ${j.est_cost_usd[0]}–${j.est_cost_usd[1]}
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={12} className="text-gray-400" />
                  {j.time_to_form_days[0]}–{j.time_to_form_days[1]} d
                </div>
                <div className={`flex items-center gap-1 ${j.fundraising_friendly ? 'text-emerald-700' : 'text-gray-500'}`}>
                  <Sparkles size={12} />
                  {j.fundraising_friendly ? 'VC-friendly' : 'Limited VC'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">Pros</div>
                  <ul className="text-[11px] text-gray-700 space-y-0.5 list-disc pl-4 dark:text-gray-300">
                    {j.pros.slice(0, 2).map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-1">Cons</div>
                  <ul className="text-[11px] text-gray-700 space-y-0.5 list-disc pl-4 dark:text-gray-300">
                    {j.cons.slice(0, 2).map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-600">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Tax: </span>{j.tax_summary}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Task #10 — availability pill under the company-name input. Renders nothing
// until there's something to say; "unavailable" is informational and never
// blocks submit.
function NameAvailability({ jurisdiction, nameChecking, nameCheck, skipNameCheck, setSkipNameCheck }) {
  if (nameChecking) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
        <Loader2 className="animate-spin" size={13} /> Checking availability on the {jurisdiction.country} register…
      </div>
    );
  }
  if (!nameCheck) return null;

  if (nameCheck.status === 'available') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 size={13} /> Looks available on the {jurisdiction.country} register.
      </div>
    );
  }

  if (nameCheck.status === 'taken') {
    const matches = (nameCheck.matches || []).slice(0, 3);
    return (
      <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2.5 dark:border-red-900/50 dark:bg-red-950/30">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
          <AlertTriangle size={13} /> That name appears to be taken on the {jurisdiction.country} register.
        </div>
        {matches.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-[11px] text-red-700/90 dark:text-red-300/90">
            {matches.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer dark:text-gray-400">
          <input
            type="checkbox"
            checked={skipNameCheck}
            onChange={(e) => setSkipNameCheck(e.target.checked)}
            className="rounded"
          />
          Use this name anyway — I'll verify availability myself
        </label>
      </div>
    );
  }

  // unavailable — couldn't check (e.g. register down, no key, or dev env).
  return (
    <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
      <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
      <span>Couldn't verify automatically — please check the official {jurisdiction.country} register before filing.</span>
    </div>
  );
}

function ConfirmStep({ jurisdiction, projects, form, setForm, nameCheck, nameChecking, skipNameCheck, setSkipNameCheck, onlineFilingUnavailable }) {
  if (!jurisdiction) {
    // Defensive — Next button on step 1 is gated on selectedId + a populated
    // jurisdictions list, so this branch should be unreachable. If we still
    // get here (e.g. selected id was for a jurisdiction that's since been
    // removed from the catalog), render a friendly empty state instead of
    // a blank page.
    return (
      <div className="py-10 text-center">
        <div className="text-base font-semibold text-gray-900 mb-1 dark:text-gray-100">No jurisdiction selected</div>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Go back to the previous step and pick a jurisdiction. If the list looks empty, refresh the page in a moment.
        </p>
      </div>
    );
  }
  const isDeCorp = jurisdiction.atlas_supported;
  return (
    <div className="space-y-5">
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-violet-900 mb-1 flex items-center gap-2">
          <Globe2 size={16} /> Selected: {jurisdiction.label}
        </div>
        <div className="text-xs text-violet-800">
          {isDeCorp
            ? "After you submit, we'll hand you off to Stripe Atlas to complete filing. Your founder document set will be generated and surface in Legal."
            : `After you submit, we'll generate the ${jurisdiction.label} document set into Legal. Filing on the official portal is a manual next step.`}
        </div>
      </div>

      {/* Task #12 — graceful gate. When the mirrored Stripe catalog has no
          purchasable online-filing price for this jurisdiction, explain it and
          disable "Continue to payment" instead of dead-ending after the click. */}
      {onlineFilingUnavailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
          <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <div className="text-sm font-semibold">
              Online filing isn't available for {jurisdiction.label} yet
            </div>
            <p>
              We haven't enabled online payment &amp; filing for {jurisdiction.label} yet.{' '}
              <a
                href={`mailto:support@axal.vc?subject=${encodeURIComponent(`Incorporation — ${jurisdiction.label}`)}`}
                className="font-semibold underline hover:no-underline"
              >
                Contact the studio team
              </a>
              {jurisdiction.atlas_supported
                ? ' and we\u2019ll file your Delaware C-Corp via Stripe Atlas, or pick another jurisdiction above.'
                : ' to file your company manually, or pick another jurisdiction above.'}
            </p>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1 dark:text-gray-300">Company name (legal)</label>
        <input
          value={form.company_name}
          onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          placeholder={jurisdiction.id === 'sg_pte' ? 'e.g. Acme Pte. Ltd.' :
                       jurisdiction.id === 'uk_ltd' ? 'e.g. Acme Limited' :
                       jurisdiction.id === 'ee_oy' ? 'e.g. Acme OÜ' : 'e.g. Acme, Inc.'}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
        />
        <NameAvailability
          jurisdiction={jurisdiction}
          nameChecking={nameChecking}
          nameCheck={nameCheck}
          skipNameCheck={skipNameCheck}
          setSkipNameCheck={setSkipNameCheck}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1 dark:text-gray-300">Link to project</label>
        <select
          value={form.project_id || ''}
          onChange={(e) => setForm({ ...form, project_id: e.target.value ? Number(e.target.value) : null })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
        >
          <option value="">Select a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="text-[11px] text-gray-500 mt-1">
          Generated documents will appear under this project on the Legal page.
        </div>
      </div>

      {jurisdiction.id === 'us_de_ccorp' && (
        <details className="border border-gray-200 rounded-lg dark:border-gray-800">
          <summary className="px-3 py-2 text-xs font-semibold text-gray-700 cursor-pointer dark:text-gray-300">
            Optional: registered-agent details (used in Certificate of Incorporation draft)
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            <input
              value={form.registered_agent_name}
              onChange={(e) => setForm({ ...form, registered_agent_name: e.target.value })}
              placeholder="Registered agent name (e.g. Harvard Business Services)"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700"
            />
            <input
              value={form.registered_agent_address}
              onChange={(e) => setForm({ ...form, registered_agent_address: e.target.value })}
              placeholder="Registered agent address (e.g. 16192 Coastal Hwy, Lewes, DE 19958)"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700"
            />
          </div>
        </details>
      )}
    </div>
  );
}

// Task #6 — embedded payment step. Renders the one-time incorporation fee in
// the in-app Stripe terminal (no Checkout redirect). On success we advance to
// the Done step; the `payment_intent.succeeded` webhook marks the order paid
// server-side and enqueues the filing packet pipeline.
function PaymentStep({ jurisdiction, order, onPaid }) {
  if (!order) return null;
  return (
    <div className="space-y-5">
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 dark:bg-violet-950/30 dark:border-violet-900/50">
        <div className="text-sm font-semibold text-violet-900 mb-1 flex items-center gap-2 dark:text-violet-200">
          <DollarSign size={16} /> {jurisdiction?.label} incorporation fee
        </div>
        <div className="text-xs text-violet-800 dark:text-violet-300">
          Pay the one-time filing fee below. We start preparing your founder
          document set the moment payment clears — you'll never leave this page.
        </div>
        <div className="mt-2 text-lg font-bold text-violet-900 dark:text-violet-100">
          {formatMoney(order.amount_cents, order.currency)}
        </div>
      </div>

      <AxalCheckout
        clientSecret={order.client_secret}
        submitLabel={`Pay ${formatMoney(order.amount_cents, order.currency)}`}
        onSuccess={onPaid}
      />
    </div>
  );
}

// Task #6 — annual Registered Agent recurring opt-in, charged through the same
// embedded terminal. Opt-in is optional and never blocks the founder.
function RegisteredAgentOptIn({ offer }) {
  const [opted, setOpted] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  if (!offer?.price_id) return null;

  if (subscribed) {
    return (
      <div className="border border-emerald-200 rounded-lg p-4 bg-emerald-50 flex items-start gap-2 dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <CheckCircle2 className="text-emerald-600 flex-shrink-0 mt-0.5" size={18} />
        <div className="text-sm text-emerald-900 dark:text-emerald-200">
          You're enrolled in <strong>{offer.product_name}</strong>. It renews
          automatically and appears as its own invoice in Billing.
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Add {offer.product_name}
          </div>
          <div className="text-xs text-gray-600 mt-0.5 dark:text-gray-400">
            Stay compliant year-round. We act as your registered agent and handle
            statutory mail and annual reminders.
            {offer.amount_cents != null && (
              <> {' '}<span className="font-semibold text-gray-800 dark:text-gray-200">
                {formatMoney(offer.amount_cents, offer.currency)}/{offer.interval || 'year'}
              </span>.</>
            )}
          </div>
        </div>
        {!opted && (
          <button
            type="button"
            onClick={() => setOpted(true)}
            className="flex-shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-sm px-3 py-1.5 rounded-md"
          >
            Add
          </button>
        )}
      </div>
      {opted && (
        <div className="mt-4">
          <AxalCheckout
            priceId={offer.price_id}
            submitLabel="Subscribe"
            onSuccess={() => setSubscribed(true)}
          />
        </div>
      )}
    </div>
  );
}

// Task #6 — compliance one-offs as à la carte catalog products, purchasable via
// the embedded terminal. Read-only list until the founder picks one to buy.
function ComplianceAddons({ products }) {
  const [selected, setSelected] = useState(null);
  const [bought, setBought] = useState({});
  if (!products || products.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-800">
      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 dark:text-gray-300">
        Compliance add-ons
      </div>
      <div className="text-xs text-gray-500 mb-3">
        Optional one-time compliance services. Add any you need now or later.
      </div>
      <ul className="space-y-2">
        {products.map((p) => {
          const price = (p.prices || []).find((pr) => pr.active && pr.type !== 'recurring') || (p.prices || [])[0];
          const isSelected = selected === p.id;
          const isBought = bought[p.id];
          return (
            <li key={p.id} className="border border-gray-100 rounded-md p-3 dark:border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                  {p.description && <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>}
                  {price && (
                    <div className="text-xs font-semibold text-gray-800 mt-1 dark:text-gray-200">
                      {formatMoney(price.unit_amount, price.currency)}
                    </div>
                  )}
                </div>
                {isBought ? (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={14} /> Added
                  </span>
                ) : price ? (
                  <button
                    type="button"
                    onClick={() => setSelected(isSelected ? null : p.id)}
                    className="flex-shrink-0 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm px-3 py-1.5 rounded-md dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {isSelected ? 'Cancel' : 'Purchase'}
                  </button>
                ) : null}
              </div>
              {isSelected && price && !isBought && (
                <div className="mt-3">
                  <AxalCheckout
                    priceId={price.id}
                    submitLabel={`Pay ${formatMoney(price.unit_amount, price.currency)}`}
                    onSuccess={() => {
                      setBought((b) => ({ ...b, [p.id]: true }));
                      setSelected(null);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DoneStep({ jurisdiction, order, raOffer, complianceProducts, navigate }) {
  const incorporationId = order?.incorporation_id;
  const { status, timedOut } = useIncorporationStatus(incorporationId);

  if (!order) return null;

  const isFailed = status === 'failed' || timedOut;
  const isReady = status === 'packet_ready' || status === 'documents_ready';

  return (
    <div className="space-y-5">
      {isFailed ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 dark:bg-red-950/30 dark:border-red-900/50">
          <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <div className="text-sm font-semibold text-red-900 dark:text-red-200">
              Something went wrong with your filing
            </div>
            <div className="text-xs text-red-800 mt-1 dark:text-red-300">
              {timedOut
                ? 'Your filing is taking longer than expected. Documents may still be on their way.'
                : 'We could not prepare your founder document set.'}{' '}
              Please{' '}
              <a
                href={`mailto:support@axal.vc?subject=Incorporation+issue&body=Order+ID:+${incorporationId}`}
                className="font-semibold underline hover:no-underline"
              >
                contact support
              </a>
              {' '}and quote order ID{' '}
              <span className="font-mono font-semibold">{incorporationId}</span>.
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3 dark:bg-emerald-950/30 dark:border-emerald-900/50">
          <CheckCircle2 className="text-emerald-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-emerald-900 flex items-center flex-wrap gap-2 dark:text-emerald-200">
              Payment received — {jurisdiction?.label} filing started
              <IncorporationStatusBadge status={status} timedOut={false} />
            </div>
            <div className="text-xs text-emerald-800 mt-0.5 dark:text-emerald-300">
              {isReady
                ? 'Your founder document set is ready. Open Legal to view your documents.'
                : "We're preparing your founder document set now. It'll appear under your project in Legal shortly, and your receipt is in Billing."}
            </div>
          </div>
        </div>
      )}

      <RegisteredAgentOptIn offer={raOffer} />

      <ComplianceAddons products={complianceProducts} />

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => navigate('/legal')}
          className={`inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md ${
            isReady
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-violet-600 hover:bg-violet-700 text-white'
          }`}
        >
          Open Legal <ArrowRight size={14} />
        </button>
        <button
          onClick={() => navigate('/settings/billing')}
          className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm px-4 py-2 rounded-md inline-flex items-center gap-1.5 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          View Billing
        </button>
        <button
          onClick={() => navigate('/incorporate')}
          className="text-sm text-gray-700 hover:text-gray-900 px-3 py-2 dark:text-gray-300"
        >
          Incorporate another
        </button>
      </div>
    </div>
  );
}

export default function IncorporatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Task #6 — embedded-terminal order state (client_secret + RA offer) and the
  // compliance à la carte catalog surfaced on the Done step.
  const [order, setOrder] = useState(null);
  const [complianceProducts, setComplianceProducts] = useState([]);
  // Task #12 — per-jurisdiction online-filing availability derived from the
  // mirrored Stripe catalog. `null` = unknown (never blocks the wizard); a Set
  // holds the jurisdiction ids that have a purchasable one-time incorporation
  // price, so we can disable "Continue to payment" up-front for the rest.
  const [incorpAvailability, setIncorpAvailability] = useState(null);
  // Task #10 — live company-name availability state.
  const [nameCheck, setNameCheck] = useState(null);
  const [nameChecking, setNameChecking] = useState(false);
  const [skipNameCheck, setSkipNameCheck] = useState(false);
  const nameCheckSeq = useRef(0);

  const [answers, setAnswers] = useState({
    raisingVc: '', region: '', minimalCost: '', entityPref: '',
  });
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({
    company_name: '',
    project_id: null,
    registered_agent_name: '',
    registered_agent_address: '',
  });

  useEffect(() => {
    let cancelled = false;
    // Fetch jurisdictions and projects INDEPENDENTLY. A 404 on one used to
    // blank both via Promise.all + shared catch, which surfaced a raw "Not
    // found" banner over an otherwise renderable wizard (the original bug
    // in the screenshot was triggered by listProjects() 404 for users with
    // no project scope yet). Each fetch now has its own defensive 404
    // handler so the other still populates and the wizard remains usable.
    const isNotFound = (e) => {
      const msg = (e?.message || '').toLowerCase();
      return e?.status === 404 || msg.includes('not found');
    };
    (async () => {
      const [jRes, pRes, cRes] = await Promise.allSettled([
        api.legalJurisdictions(),
        api.listProjects(),
        // Task #12 — best-effort read of the FULL catalog so we can disable
        // "Continue to payment" up-front for jurisdictions with no purchasable
        // online-filing price, instead of only failing after the click. We must
        // NOT pass kind='incorporation' here: the Worker's resolveIncorporationPrice
        // matches ANY active product by metadata.jurisdiction_id, and a product
        // tagged only with jurisdiction_id derives kind 'alacarte' — so a kind
        // filter would wrongly hide (and block) a jurisdiction the server would
        // actually accept. ANY failure (the dev FastAPI has no catalog route,
        // network, etc.) leaves availability `null` → never blocks; submit()'s
        // catch handler remains the required safety net.
        api.catalogProducts(),
      ]);
      if (cancelled) return;

      if (jRes.status === 'fulfilled') {
        setJurisdictions(jRes.value?.jurisdictions || []);
      } else if (!isNotFound(jRes.reason)) {
        setErr(jRes.reason?.message || 'Failed to load jurisdictions.');
      } // 404 → leave jurisdictions empty; render handles the empty state.

      if (pRes.status === 'fulfilled') {
        const list = pRes.value;
        setProjects(list?.projects || list || []);
      } else if (!isNotFound(pRes.reason)) {
        // Only surface a non-404 projects error if jurisdictions also failed
        // (otherwise the user can still browse jurisdictions and a banner
        // about projects would be confusing context).
        if (jRes.status !== 'fulfilled') {
          setErr(pRes.reason?.message || 'Failed to load projects.');
        }
      } // 404 → leave projects empty; submit step shows a clear reason.

      if (cRes.status === 'fulfilled') {
        const products = cRes.value?.products || cRes.value || [];
        const purchasable = new Set();
        for (const p of products) {
          if (!p?.active) continue;
          const jid = p?.metadata?.jurisdiction_id;
          if (!jid) continue;
          // Mirror the Worker (priceForPlanMetadata with interval=null, then
          // unit_amount > 0): a one-time price carries no recurring interval.
          const hasOneTimePrice = (p.prices || []).some(
            (pr) => pr?.active && pr?.type !== 'recurring' && Number(pr?.unit_amount) > 0,
          );
          if (hasOneTimePrice) purchasable.add(jid);
        }
        // A reachable-but-empty catalog (the reported case: nothing configured)
        // yields an empty Set → we DO block, since we positively know no price
        // exists. Only a failed fetch leaves availability unknown (`null`).
        setIncorpAvailability(purchasable);
      } // failure → leave incorpAvailability null (unknown); submit() handles it.

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const recommendedId = useMemo(() => recommend(answers), [answers]);

  // Auto-select the recommendation when entering the compare step.
  useEffect(() => {
    if (step === 1 && !selectedId && recommendedId) setSelectedId(recommendedId);
  }, [step, recommendedId, selectedId]);

  // Task #10 — debounced, sequence-guarded company-name availability check on
  // the Confirm step. A slow lookup never clobbers a newer one, and ANY
  // failure (incl. the dev FastAPI env, which has no such route) degrades to
  // "couldn't check — verify manually" rather than blocking the wizard.
  useEffect(() => {
    setSkipNameCheck(false);
    const name = form.company_name.trim();
    if (step !== 2 || !selectedId || name.length < 2) {
      setNameChecking(false);
      setNameCheck(null);
      return;
    }
    const seq = ++nameCheckSeq.current;
    setNameChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.legalNameCheck(selectedId, name);
        if (seq !== nameCheckSeq.current) return; // a newer check superseded us
        setNameCheck(res);
      } catch {
        if (seq !== nameCheckSeq.current) return;
        setNameCheck({ status: 'unavailable', reason: 'check_failed' });
      } finally {
        if (seq === nameCheckSeq.current) setNameChecking(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [step, selectedId, form.company_name]);

  const selected = jurisdictions.find((j) => j.id === selectedId) || null;
  const goalsAnswered = answers.raisingVc && answers.region && answers.minimalCost && answers.entityPref;
  // Task #12 — true only when we KNOW (catalog reachable) that the selected
  // jurisdiction has no purchasable online-filing price. `null` availability
  // (catalog unreachable / dev) keeps this false so we never block on a guess.
  const onlineFilingUnavailable = Boolean(
    incorpAvailability && selectedId && !incorpAvailability.has(selectedId),
  );

  const submit = async () => {
    if (!form.company_name.trim()) { setErr('Enter a company name to continue.'); return; }
    if (!form.project_id) { setErr('Select a project to attach the documents to.'); return; }
    if (!selectedId) { setErr('Pick a jurisdiction.'); return; }
    if (nameChecking) { setErr('Hold on — still checking name availability.'); return; }
    if (nameCheck?.status === 'taken' && !skipNameCheck) {
      setErr('That company name appears to be taken. Pick another name, or tick "use this name anyway" to proceed.');
      return;
    }
    setBusy(true); setErr('');
    try {
      // Task #6 — embedded-terminal order. Returns a PaymentIntent client_secret
      // (confirmed in-app, no Checkout redirect) + an optional Registered Agent
      // subscription offer. In dev (no Stripe key) the order is marked paid
      // immediately, so we skip straight to Done.
      const res = await api.legalIncorporationOrder({
        project_id: form.project_id,
        jurisdiction_id: selectedId,
        company_name: form.company_name.trim(),
        registered_agent_name: form.registered_agent_name || null,
        registered_agent_address: form.registered_agent_address || null,
      });
      setOrder(res);
      setBusy(false);
      // Step 3 = payment, 4 = done. Dev fallback paid → jump to done.
      setStep(res?.dev || res?.status === 'paid' ? 4 : 3);
    } catch (e) {
      const status = e?.status;
      // The Worker returns a structured `error` code we branch on instead of
      // collapsing everything into one opaque message:
      //   stripe_not_configured (503) / catalog_price_missing (502) → online
      //     filing isn't set up for this jurisdiction yet — a setup gap, not a
      //     transient error, so retrying won't help.
      //   order_failed (502) / other 5xx / network → genuinely transient.
      // api.js surfaces the parsed body on `e.data` and the code on `e.message`.
      const code = (
        (typeof e?.data?.error === 'string' && e.data.error) || e?.message || ''
      ).toLowerCase();
      const jLabel = selected?.label || 'this jurisdiction';
      if (status === 404 || code.includes('not found')) {
        setErr("The selected project or jurisdiction is no longer available. Please refresh and try again.");
      } else if (status === 401 || status === 403) {
        setErr('Your session expired or you do not have access to this project. Please sign in again.');
      } else if (code.includes('stripe_not_configured') || code.includes('catalog_price_missing')) {
        setErr(`Online incorporation filing isn't set up for ${jLabel} yet — contact the studio team at support@axal.vc to file your company manually.`);
      } else if (code.includes('order_failed') || (typeof status === 'number' && status >= 500)) {
        setErr("We couldn't start the payment for this filing. Please try again in a moment, or contact support if it keeps happening.");
      } else {
        setErr('Submission failed. Please retry in a moment, or contact support if it persists.');
      }
      setBusy(false);
    }
  };

  // Task #6 — once payment clears in-app, advance to Done and lazily fetch the
  // compliance à la carte catalog for the add-ons section. A failure here is
  // non-blocking — the Done step simply omits the add-ons.
  const handlePaid = async () => {
    setStep(4);
    try {
      const res = await api.catalogProducts('alacarte');
      const list = (res?.products || res || []).filter(
        (p) => p?.active && (p?.metadata?.category === 'compliance'),
      );
      setComplianceProducts(list);
    } catch {
      setComplianceProducts([]);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-violet-600 font-semibold flex items-center gap-1.5 mb-1">
          <Scale size={14} /> Jurisdiction Wizard
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Incorporate your company</h1>
        <PageExplainer pageKey="incorporate" />
        <p className="text-sm text-gray-600 mt-1">
          Pick the right jurisdiction in five questions. We'll prep the founder document set and
          hand you off to a filing partner where one is supported.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 dark:bg-gray-900 dark:border-gray-800">
        <Stepper current={step} />

        {err && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded p-2 text-sm flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        ) : (
          <>
            {step === 0 && <GoalsStep answers={answers} setAnswers={setAnswers} />}
            {step === 1 && (
              <CompareStep
                jurisdictions={jurisdictions}
                recommendedId={recommendedId}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
              />
            )}
            {step === 2 && (
              <ConfirmStep
                jurisdiction={selected}
                projects={projects}
                form={form}
                setForm={setForm}
                nameCheck={nameCheck}
                nameChecking={nameChecking}
                skipNameCheck={skipNameCheck}
                setSkipNameCheck={setSkipNameCheck}
                onlineFilingUnavailable={onlineFilingUnavailable}
              />
            )}
            {step === 3 && (
              <PaymentStep
                jurisdiction={selected}
                order={order}
                onPaid={handlePaid}
              />
            )}
            {step === 4 && (
              <DoneStep
                jurisdiction={selected}
                order={order}
                raOffer={order?.registered_agent}
                complianceProducts={complianceProducts}
                navigate={navigate}
              />
            )}
          </>
        )}

        {step < 3 && !loading && (
          <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => { setErr(''); setStep((s) => Math.max(0, s - 1)); }}
              disabled={step === 0}
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30"
            >
              <ArrowLeft size={14} /> Back
            </button>
            {step < 2 ? (
              <button
                onClick={() => { setErr(''); setStep((s) => s + 1); }}
                disabled={(step === 0 && !goalsAnswered) || (step === 1 && (!selectedId || jurisdictions.length === 0))}
                className="inline-flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
              >
                Next <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={busy || nameChecking || onlineFilingUnavailable || (nameCheck?.status === 'taken' && !skipNameCheck)}
                className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
              >
                {busy ? <Loader2 className="animate-spin" size={14} /> : <DollarSign size={14} />}
                {busy ? 'Working…' : 'Continue to payment'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
