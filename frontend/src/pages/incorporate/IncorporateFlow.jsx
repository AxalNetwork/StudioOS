import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pill from '../../ui/Pill.jsx';
import { Unrecorded } from '../../ui/Honesty.jsx';
import { api } from '../../lib/api';
import { accountCompaniesApi } from '../../lib/api/accountCompanies.js';
import { fmtCents } from '../../lib/incorporationPricing.js';
import { reportError } from '../../lib/log';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth';
import { useIncorporationStatus } from '../../hooks/useIncorporationStatus';
import AskButton from '../team/AskButton.jsx';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, FIELD } from '../team/teamUi.jsx';
import IncorporationTimeline from './IncorporationTimeline.jsx';
import IncorporateDone from './IncorporateDone.jsx';
import {
  DECLINED, LINE, NOT_YOURS, OFFICERS_LATER, OWN_ONLY, RANGES, SAVED_HERE, STATE_FEE, STEPS, TITLE,
  clearDraft, cofounderStatus, jurisdictionCard, loadDraft, ownProjects, prefill, recommend, saveDraft, shortDay, stepLine,
} from './incorporateModel.js';

/**
 * D1414 (#3696, INC1–INC7) — Incorporate, redesigned: turn one of your own
 * projects (or a new one) into a company, filed by Axal VC.
 *
 *   1 Tell us your goals     which project, and four questions that pick a
 *                            recommendation; `?project=<id>` prefills
 *                            ("From [name]"), and a project that is not yours
 *                            says so (INC5f)
 *   2 Compare jurisdictions  the Worker's six options (`GET
 *                            /api/legal/jurisdictions`), in its own words
 *   3 Company details        the legal name and its register check, the
 *                            registered agent and address, the co-founder
 *                            agreement's status (`GET /api/legal/documents`)
 *   4 Review                 every answer with Edit, and the order summary
 *   5 Pay & file             the catalog quote's one price and the
 *                            registered-agent offer (owner answer Q5: "The
 *                            state fee is confirmed at filing."), the order
 *                            and Stripe; then the status timeline
 *   6 Done                   next steps
 *
 * READS ONLY YOUR OWN PROJECTS: `GET /api/account/projects`, the owner's
 * seat. Never `GET /api/projects`. "Start fresh" creates the project first
 * (`POST /api/projects`), then orders.
 *
 * NO GATE (owner answer Q6) and NO BANK LINK (Q7). Ask draws nothing until
 * #3706's panel exists (`incorporateAdapter.askPanel`); no field trigger is
 * drawn. The answers are kept on this device (INC5a), in try/catch.
 */

// The Stripe terminal loads with its step (it reads the publishable key when its module loads).
const AxalCheckout = lazy(() => import('../../components/AxalCheckout'));

const CARD = 'rounded-axal-lg border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const EYEBROW = 'font-mono text-[11px] font-medium uppercase tracking-[.11em] text-axal-muted dark:text-gray-400';
const LABEL = 'text-[12.5px] font-bold text-axal-ink dark:text-gray-100';

function Card({ title, aside, children, testId }) {
  return (
    <section className={CARD} data-testid={testId}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.02em] ${INK}`}>{title}</h2>
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Failed({ what, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-axal-md border border-dashed border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid={testId}>
      <span className={`text-[13px] ${INK}`}>{what} could not be read.</span>
      {onRetry ? <button type="button" className={BTN_SECONDARY} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

function StepRail({ current, phone }) {
  if (phone) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="incorporate-steps-phone">
        <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{stepLine(current)}</span>
        <span className="h-1 rounded-full bg-axal-ground dark:bg-gray-800"><span className="block h-1 rounded-full bg-axal-violet" style={{ width: `${Math.round(((current + 1) / STEPS.length) * 100)}%` }} /></span>
      </div>
    );
  }
  return (
    <ol className={`${CARD} m-0 flex list-none flex-wrap gap-x-5 gap-y-2`} aria-label="Steps" data-testid="incorporate-steps">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined} data-testid={`incorporate-step-${s.id}`}>
          <span className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-bold ${i === current ? 'bg-axal-violet text-white dark:bg-violet-500' : i < current ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400'}`}>{i < current ? '✓' : i + 1}</span>
          <span className={`text-[13px] ${i === current ? `font-bold ${INK}` : 'text-axal-muted dark:text-gray-400'}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Choice({ active, label, onClick }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`rounded-axal-md border px-3 py-2 text-left text-[13px] ${active ? 'border-axal-violet bg-axal-lavender font-semibold text-axal-ink dark:border-violet-500 dark:bg-violet-900/30 dark:text-gray-100' : 'border-axal-hairline text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:text-gray-100'}`}>{label}</button>
  );
}

const GOALS = [
  ['raisingVc', 'Are you raising venture capital?', [['yes_us', 'Yes, from US investors'], ['yes_eu', 'Yes, from EU or UK investors'], ['no', 'No, bootstrapping']]],
  ['region', 'Where will most of your customers be?', [['us', 'United States'], ['eu', 'Europe or the UK'], ['apac', 'Asia-Pacific'], ['global', 'Global or remote']]],
  ['minimalCost', 'Keep the cost to form it as low as possible?', [['yes', 'Yes'], ['no', 'No, the right fit matters more']]],
  ['entityPref', 'Do you prefer an entity type?', [['corp', 'A corporation'], ['llc', 'An LLC'], ['either', 'No preference']]],
];

function PickCard({ projects, pick, setPick, freshName, setFreshName, prefilled, refused, onRetry }) {
  return (
    <Card title="Which project becomes the company?" testId="incorporate-pick">
      {refused ? <p role="alert" className="m-0 mb-3 rounded-axal-md bg-axal-ground px-3 py-2.5 text-[13px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="incorporate-not-yours">{NOT_YOURS}</p> : null}
      {projects.status === 'loading' ? <p className={MUTED}>Reading…</p>
        : projects.status === 'error' ? <Failed what="Your projects" onRetry={onRetry} testId="incorporate-projects-unread" />
          : (
            <div role="radiogroup" aria-label="Project" className="flex flex-col gap-1.5">
              {projects.own.map((p) => (
                <label key={p.id} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-axal-md border px-3 py-2 ${String(pick) === String(p.id) ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`incorporate-project-${p.id}`}>
                  <input type="radio" name="inc-project" checked={String(pick) === String(p.id)} onChange={() => setPick(p.id)} className="accent-violet-600" />
                  <span className="flex min-w-0 flex-1 flex-col"><b className={`text-[13.5px] ${INK}`}>{p.name}</b><span className={MUTED}>{p.sub}</span></span>
                  {String(prefilled) === String(p.id) ? <Pill tone="info" data-testid="incorporate-from">From {p.name}</Pill> : null}
                </label>
              ))}
              <label className={`flex min-h-[52px] cursor-pointer flex-col gap-2 rounded-axal-md border px-3 py-2 ${pick === 'fresh' ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`} data-testid="incorporate-fresh">
                <span className="flex items-center gap-3">
                  <input type="radio" name="inc-project" checked={pick === 'fresh'} onChange={() => setPick('fresh')} className="accent-violet-600" data-testid="incorporate-fresh-radio" />
                  <span className="flex flex-col"><b className={`text-[13.5px] ${INK}`}>Start fresh</b><span className={MUTED}>We’ll create the project first, then incorporate it.</span></span>
                </span>
                {pick === 'fresh' ? <input aria-label="Project name" className={FIELD} value={freshName} onChange={(e) => setFreshName(e.target.value)} placeholder="Project name" data-testid="incorporate-fresh-name" /> : null}
              </label>
            </div>
          )}
      <p className={`m-0 mt-2 ${MUTED}`}>{OWN_ONLY}</p>
    </Card>
  );
}

function CompareCard({ read, recommended, selectedId, setSelectedId, onRetry, phone }) {
  if (read.status === 'loading') return <Card title="Compare jurisdictions"><p className={MUTED}>Reading…</p></Card>;
  if (read.status !== 'ready' || !read.list.length) return <Card title="Compare jurisdictions" testId="incorporate-compare"><Failed what="Jurisdiction options" onRetry={onRetry} testId="incorporate-jurisdictions-unread" /></Card>;
  return (
    <Card title="Compare jurisdictions" testId="incorporate-compare">
      <div role="radiogroup" aria-label="Jurisdiction" className={`grid gap-3 ${phone ? '' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
        {read.list.map(jurisdictionCard).map((j) => (
          <label key={j.id} className={`flex cursor-pointer flex-col gap-2 rounded-axal-md border px-3.5 py-3 ${selectedId === j.id ? 'border-2 border-axal-violet ring-4 ring-axal-lavender dark:border-violet-500 dark:ring-violet-900/40' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`incorporate-jurisdiction-${j.id}`}>
            <span className="flex flex-wrap items-center gap-2">
              <input type="radio" name="inc-jurisdiction" checked={selectedId === j.id} onChange={() => setSelectedId(j.id)} className="accent-violet-600" />
              <b className={`text-[14px] ${INK}`}>{j.label}</b>
              <Pill tone={j.pill.tone}>{j.pill.label}</Pill>
              {j.id === recommended ? <Pill tone="info" data-testid="incorporate-recommended">Recommended</Pill> : null}
            </span>
            {j.summary ? <span className={MUTED}>{j.summary}</span> : null}
            <span className="flex gap-4 font-mono text-[12px] text-axal-ink dark:text-gray-200">
              <span>Cost {j.cost || <Unrecorded />}</span><span>Timeline {j.timeline || <Unrecorded />}</span>
            </span>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px] text-axal-ink dark:text-gray-200">
              {j.pros.map((p) => <li key={p}>+ {p}</li>)}
              {j.cons.map((c) => <li key={c} className="text-axal-muted dark:text-gray-400">− {c}</li>)}
            </ul>
          </label>
        ))}
      </div>
      <p className={`m-0 mt-2 ${MUTED}`}>{RANGES}</p>
    </Card>
  );
}

function NameLine({ check, checking, country, skip, setSkip }) {
  if (checking) return <span className={MUTED}>Checking the {country} register…</span>;
  if (!check) return null;
  if (check.status === 'available') return <span className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="incorporate-name-available">✓ Available in {country}</span>;
  if (check.status === 'taken') {
    return (
      <span className="flex flex-wrap items-center gap-2" data-testid="incorporate-name-taken">
        <Pill tone="warn">Appears taken</Pill>
        <label className="flex items-center gap-1.5 text-[12.5px] text-axal-ink dark:text-gray-100">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Use this name anyway
        </label>
      </span>
    );
  }
  return <span className={MUTED} data-testid="incorporate-name-unchecked">Couldn’t check the register · verify it yourself before filing</span>;
}

function CofounderBox({ status }) {
  const pill = status.kind === 'signed' ? <Pill tone="ok">Signed{status.on ? ` ${shortDay(status.on)}` : ''}</Pill>
    : status.kind === 'drafted' ? <Pill tone="neutral">Drafted, not signed</Pill>
      : status.kind === 'none' ? <Pill tone="neutral">Not started</Pill>
        : status.kind === 'unread' ? <span className={MUTED}>Its status could not be read</span> : <span className={MUTED}>Reading…</span>;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-axal-md bg-axal-ground/70 px-3.5 py-3 dark:bg-gray-950/40" data-testid="incorporate-cofounder">
      <span className="flex flex-col"><b className={`text-[13.5px] ${INK}`}>Founders and equity split</b><span className={MUTED}>Set in your Co-founder Agreement</span></span>
      {pill}
      <Link to="/incorporate/cofounder-agreement" className="ml-auto text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Open Co-founder Agreement ›</Link>
    </div>
  );
}

function OrderCard({ jurisdiction, quote, onRetry }) {
  return (
    <Card title="Order summary" testId="incorporate-order">
      {quote.status === 'loading' ? <p className={MUTED}>Reading…</p>
        : quote.status !== 'ready' ? <Failed what="The price" onRetry={onRetry} testId="incorporate-quote-unread" />
          : quote.value.amount_cents == null ? (
            <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="incorporate-no-price">Online filing isn’t available for {jurisdiction?.label || 'this jurisdiction'} yet. Contact the studio team at support@axal.vc to file it by hand, or pick another jurisdiction.</p>
          ) : (
            <>
              <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-[13px]">
                <dt className={MUTED}>Jurisdiction</dt><dd className={`m-0 ${INK}`}>{jurisdiction?.label}</dd>
                <dt className={MUTED}>Company formation, filed by Axal VC</dt><dd className={`m-0 font-mono ${INK}`} data-testid="incorporate-price">{fmtCents(quote.value.amount_cents, quote.value.currency)}</dd>
                {quote.value.registered_agent?.amount_cents != null ? (
                  <>
                    <dt className={MUTED}>{quote.value.registered_agent.product_name || 'Registered agent'} · optional, added after you pay</dt>
                    <dd className={`m-0 font-mono ${INK}`} data-testid="incorporate-ra-offer">{fmtCents(quote.value.registered_agent.amount_cents, quote.value.registered_agent.currency)}/{quote.value.registered_agent.interval || 'year'}</dd>
                  </>
                ) : null}
              </dl>
              <p className="m-0 mt-3 flex items-center justify-between rounded-axal-md bg-axal-lavender px-3 py-2.5 dark:bg-violet-900/20">
                <b className={`text-[13.5px] ${INK}`}>Total today</b>
                <b className={`font-mono text-[18px] ${INK}`} data-testid="incorporate-total">{fmtCents(quote.value.amount_cents, quote.value.currency)}</b>
              </p>
              <p className={`m-0 mt-2 ${MUTED}`} data-testid="incorporate-state-fee">{STATE_FEE}</p>
            </>
          )}
    </Card>
  );
}

/** After payment: the annual registered-agent offer, through the same embedded terminal (unchanged from Task #6). */
function RegisteredAgentOptIn({ offer }) {
  const [opted, setOpted] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  if (!offer?.price_id) return null;
  if (subscribed) return <p className={`${CARD} m-0 ${MUTED}`}>You’re enrolled in {offer.product_name}. It renews each {offer.interval || 'year'} and appears as its own invoice in Billing.</p>;
  return (
    <section className={CARD} data-testid="incorporate-ra-optin">
      <span className="flex flex-wrap items-center gap-2">
        <b className={`text-[14px] ${INK}`}>Add {offer.product_name}</b>
        {offer.amount_cents != null ? <span className="font-mono text-[12.5px]">{fmtCents(offer.amount_cents, offer.currency)}/{offer.interval || 'year'}</span> : null}
        {!opted ? <button type="button" className={`ml-auto ${BTN_SECONDARY}`} onClick={() => setOpted(true)}>Add</button> : null}
      </span>
      <p className={`m-0 mt-1 ${MUTED}`}>A registered agent receives the company’s legal mail and annual reminders.</p>
      {opted ? <div className="mt-3"><Suspense fallback={<p className={MUTED}>Reading…</p>}><AxalCheckout priceId={offer.price_id} submitLabel="Subscribe" onSuccess={() => setSubscribed(true)} /></Suspense></div> : null}
    </section>
  );
}

function orderRefusal(e, label) {
  const status = e?.status;
  const code = e?.code || '';
  if (status === 403) return NOT_YOURS;
  if (status === 404) return 'That project or jurisdiction is no longer available. Refresh and try again.';
  if (code === 'stripe_not_configured' || code === 'catalog_price_missing') return `Online filing isn’t set up for ${label || 'this jurisdiction'} yet. Contact the studio team at support@axal.vc.`;
  return 'The payment could not be started. Try again in a moment.';
}

export default function IncorporateFlow({ embedded = false }) {
  const [params] = useSearchParams();
  const phone = usePhoneWidth();
  const asked = params.get('project');
  const [step, setStep] = useState(0);
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  const [jurisdictions, setJurisdictions] = useState({ status: 'loading', list: [] });
  const [projects, setProjects] = useState({ status: 'loading', own: [] });
  const [answers, setAnswers] = useState({ raisingVc: '', region: '', minimalCost: '', entityPref: '' });
  const [pick, setPick] = useState(null);
  const [freshName, setFreshName] = useState('');
  const [prefilled, setPrefilled] = useState({ id: null, refused: false });
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ company_name: '', registered_agent_name: '', registered_agent_address: '' });
  const [nameCheck, setNameCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [skip, setSkip] = useState(false);
  const [quote, setQuote] = useState({ status: 'idle' });
  const [cofounder, setCofounder] = useState({ kind: 'loading' });
  const [order, setOrder] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [declined, setDeclined] = useState(false);
  const [draft, setDraft] = useState(() => (asked ? null : loadDraft()));
  const seq = useRef(0);
  const { data: status } = useIncorporationStatus(paid ? order?.incorporation_id : null);

  // Reads: the Worker's jurisdictions, and your own projects only.
  useEffect(() => {
    let alive = true;
    setJurisdictions((s) => ({ ...s, status: 'loading' }));
    api.legalJurisdictions().then((r) => { if (alive) setJurisdictions({ status: 'ready', list: r?.jurisdictions || [] }); })
      .catch(() => { if (alive) setJurisdictions({ status: 'error', list: [] }); });
    setProjects((s) => ({ ...s, status: 'loading' }));
    accountCompaniesApi.projects().then((r) => { if (alive) setProjects({ status: 'ready', own: ownProjects(r) }); })
      .catch(() => { if (alive) setProjects({ status: 'error', own: [] }); });
    return () => { alive = false; };
  }, [tick]);

  // `?project=<id>` prefills once your projects are read; one that is not yours says so.
  useEffect(() => {
    if (projects.status !== 'ready') return;
    const p = prefill(projects.own, asked);
    setPrefilled(p);
    if (p.id != null) setPick((x) => (x == null ? p.id : x));
  }, [projects, asked]);

  const recommended = useMemo(() => recommend(answers), [answers]);
  useEffect(() => { if (step === 1 && !selectedId) setSelectedId(recommended); }, [step, selectedId, recommended]);
  const selected = jurisdictions.list.find((j) => j.id === selectedId) || null;
  const pickedProject = projects.own.find((p) => String(p.id) === String(pick)) || null;

  // The company name's register check, debounced; a failure is "couldn't check", never "available".
  // Run on the details step only; the last answer is kept for Review.
  useEffect(() => {
    if (step !== 2) return undefined;
    setSkip(false);
    const name = form.company_name.trim();
    if (!selectedId || name.length < 2) { setChecking(false); setNameCheck(null); return undefined; }
    const n = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try { const r = await api.legalNameCheck(selectedId, name); if (n === seq.current) setNameCheck(r); } catch { if (n === seq.current) setNameCheck({ status: 'unavailable' }); } finally { if (n === seq.current) setChecking(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [step, selectedId, form.company_name]);

  // The co-founder agreement's status for the project picked (a fresh project has none yet).
  useEffect(() => {
    if (step < 2) return undefined;
    if (!pickedProject) { setCofounder({ kind: 'none' }); return undefined; }
    let alive = true;
    setCofounder({ kind: 'loading' });
    api.listDocuments(pickedProject.id).then((docs) => { if (alive) setCofounder(cofounderStatus(Array.isArray(docs) ? docs : docs?.documents)); })
      .catch(() => { if (alive) setCofounder({ kind: 'unread' }); });
    return () => { alive = false; };
  }, [step, pickedProject]);

  // The quote: the one catalog price the order charges, and the registered-agent offer.
  const readQuote = useCallback(() => {
    if (!selectedId) return;
    setQuote({ status: 'loading' });
    api.legalIncorporationQuote(selectedId).then((v) => setQuote({ status: 'ready', value: v })).catch(() => setQuote({ status: 'error' }));
  }, [selectedId]);
  useEffect(() => { if (step >= 3 && !order) readQuote(); }, [step, readQuote]); // eslint-disable-line react-hooks/exhaustive-deps

  // The answers stay on this device until the order is paid (INC5a).
  useEffect(() => {
    if (paid || draft) return;
    if (step > 0 || pick != null) saveDraft({ step: Math.min(step, 3), answers, pick, freshName, selectedId, form });
  }, [step, answers, pick, freshName, selectedId, form, paid, draft]);

  const resume = () => {
    const d = draft;
    setDraft(null);
    if (!d) return;
    setAnswers(d.answers || answers); setPick(d.pick ?? null); setFreshName(d.freshName || ''); setSelectedId(d.selectedId || '');
    setForm({ ...form, ...(d.form || {}) }); setStep(Math.min(Math.max(0, d.step || 0), 3));
  };

  const pickReady = pick === 'fresh' ? freshName.trim().length > 0 : pickedProject != null;
  const canContinue = [
    pickReady,
    !!selected,
    form.company_name.trim().length > 0 && !checking && !(nameCheck?.status === 'taken' && !skip),
    quote.status === 'ready' && quote.value?.amount_cents != null,
    false,
    false,
  ][step];

  const pay = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setDeclined(false);
    try {
      let pid = pickedProject?.id ?? projectId;
      if (pick === 'fresh' && pid == null) {
        // Start fresh: the project first, standalone; then the order for it.
        const created = await api.createProject({ name: freshName.trim(), company_id: null });
        pid = created?.id;
        setProjectId(pid);
      }
      const res = await api.legalIncorporationOrder({
        project_id: pid, jurisdiction_id: selectedId, company_name: form.company_name.trim(),
        registered_agent_name: form.registered_agent_name.trim() || null, registered_agent_address: form.registered_agent_address.trim() || null,
      });
      setProjectId(pid);
      setOrder(res);
      if (res?.dev || res?.status === 'paid') { setPaid(true); clearDraft(); }
    } catch (e) {
      reportError('incorporate:order', e);
      setErr(orderRefusal(e, selected?.label));
    } finally { setBusy(false); }
  };

  const projectName = pickedProject?.name || (pick === 'fresh' ? freshName.trim() : null);
  const primary = step === 4 && paid ? { label: 'Continue', go: () => setStep(5) }
    : step === 4 && !order ? { label: 'Pay and submit', go: pay, disabled: busy || !(quote.status === 'ready' && quote.value?.amount_cents != null) }
      : step < 3 ? { label: 'Continue', go: () => { setErr(''); setStep(step + 1); }, disabled: !canContinue }
        : step === 3 ? { label: 'Continue to payment', go: () => setStep(4), disabled: !canContinue } : null;

  const review = [
    ['Project', projectName || <Unrecorded key="p" />, 0],
    ['Jurisdiction', selected?.label || <Unrecorded key="j" />, 1],
    ['Company name', form.company_name.trim() ? `${form.company_name.trim()}${nameCheck?.status === 'available' ? ' · available' : ''}` : <Unrecorded key="n" />, 2],
    ['Registered agent', form.registered_agent_name.trim() || <Unrecorded key="a" />, 2],
    ['Registered address', form.registered_agent_address.trim() || <Unrecorded key="r" />, 2],
    ['Founders and equity split', cofounder.kind === 'signed' ? `From your Co-founder Agreement · signed${cofounder.on ? ` ${shortDay(cofounder.on)}` : ''}` : cofounder.kind === 'drafted' ? 'Co-founder Agreement drafted, not signed' : cofounder.kind === 'unread' ? 'Could not be read' : 'No Co-founder Agreement yet', 2],
    ['Officers and directors', 'Recorded on the company once it exists', null],
  ];

  return (
    <div className={`mx-auto flex w-full max-w-5xl flex-col gap-4 ${embedded ? '' : 'px-4 pb-24 pt-6 md:px-7 md:pb-8'}`} data-testid="incorporate-flow" data-step={STEPS[step].id}>
      {!embedded ? (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className={EYEBROW}>Company creation</span>
            <h1 className={`m-0 text-[26px] font-extrabold tracking-[-.02em] ${INK}`}>{TITLE}</h1>
            <p className={`m-0 ${MUTED}`}>{LINE}</p>
          </div>
          <span className="flex items-center gap-2">
            <AskButton />
            {primary && !phone ? <button type="button" className={BTN_PRIMARY} onClick={primary.go} disabled={primary.disabled} data-testid="incorporate-primary">{busy ? 'Working…' : primary.label}</button> : null}
          </span>
        </header>
      ) : null}

      <StepRail current={step} phone={phone} />

      {draft ? (
        <p role="status" className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-axal-md border border-violet-200 bg-axal-lavender px-3 py-2.5 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-900/20 dark:text-gray-100" data-testid="incorporate-draft">
          {SAVED_HERE}
          <button type="button" className={BTN_PRIMARY} onClick={resume} data-testid="incorporate-resume">Resume</button>
        </p>
      ) : null}
      {err ? <p role="alert" className="m-0 rounded-axal-md border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" data-testid="incorporate-error">{err}</p> : null}

      {step === 0 ? (
        <>
          <PickCard projects={projects} pick={pick} setPick={setPick} freshName={freshName} setFreshName={setFreshName}
            prefilled={prefilled.id} refused={prefilled.refused} onRetry={retry} />
          <Card title="Your goals" testId="incorporate-goals">
            <div className="flex flex-col gap-4">
              {GOALS.map(([k, q, opts]) => (
                <div key={k} className="flex flex-col gap-2">
                  <span className={LABEL}>{q}</span>
                  <span className="flex flex-wrap gap-2">{opts.map(([v, l]) => <Choice key={v} active={answers[k] === v} label={l} onClick={() => setAnswers((a) => ({ ...a, [k]: v }))} />)}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {step === 1 ? <CompareCard read={jurisdictions} recommended={recommended} selectedId={selectedId} setSelectedId={setSelectedId} onRetry={retry} phone={phone} /> : null}

      {step === 2 ? (
        <Card title="Company details" testId="incorporate-details">
          <div className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Company name (legal)</span>
              <input className={FIELD} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} data-testid="incorporate-company-name" />
              <NameLine check={nameCheck} checking={checking} country={selected?.country || selected?.label || 'the'} skip={skip} setSkip={setSkip} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Registered agent</span>
              <input className={FIELD} value={form.registered_agent_name} onChange={(e) => setForm({ ...form, registered_agent_name: e.target.value })} placeholder="Agent name" data-testid="incorporate-agent" />
              <span className={MUTED}>A registered agent receives legal mail for the company.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Registered address</span>
              <input className={FIELD} value={form.registered_agent_address} onChange={(e) => setForm({ ...form, registered_agent_address: e.target.value })} placeholder="Street, city, state, postcode" data-testid="incorporate-address" />
            </label>
            <CofounderBox status={cofounder} />
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Officers and directors</span>
              <span className={MUTED}>{OFFICERS_LATER}</span>
            </div>
          </div>
        </Card>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card title="Review your answers" testId="incorporate-review">
            <dl className="m-0 grid gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-[170px_minmax(0,1fr)_auto]">
              {review.map(([k, v, at]) => (
                <React.Fragment key={k}>
                  <dt className="font-mono text-[10.5px] uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{k}</dt>
                  <dd className={`m-0 ${INK}`}>{v}</dd>
                  <dd className="m-0">{at != null ? <button type="button" className={BTN_TEXT} onClick={() => setStep(at)} data-testid={`incorporate-edit-${at}`}>Edit</button> : null}</dd>
                </React.Fragment>
              ))}
            </dl>
          </Card>
          <OrderCard jurisdiction={selected} quote={quote} onRetry={readQuote} />
        </div>
      ) : null}

      {step === 4 ? (
        paid ? (
          <div className="flex flex-col gap-4">
            <IncorporationTimeline order={status || { ...(order || {}), status: order?.status || 'paid' }} projectId={projectId} projectName={projectName} />
            <RegisteredAgentOptIn offer={order?.registered_agent} />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <OrderCard jurisdiction={selected} quote={quote} onRetry={readQuote} />
            <Card title="Payment" testId="incorporate-payment">
              {declined ? (
                <p role="alert" className="m-0 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-axal-md border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" data-testid="incorporate-declined">
                  {DECLINED}
                  <button type="button" className={BTN_SECONDARY} onClick={() => setDeclined(false)}>Try again</button>
                </p>
              ) : null}
              {order?.client_secret && !declined ? (
                <Suspense fallback={<p className={MUTED}>Reading…</p>}>
                  <AxalCheckout clientSecret={order.client_secret} submitLabel={`Pay ${fmtCents(order.amount_cents, order.currency) || ''}`.trim()}
                    onSuccess={() => { setPaid(true); clearDraft(); }} onError={() => setDeclined(true)} />
                </Suspense>
              ) : !order ? <p className={MUTED}>Pay and submit starts the order. Paid securely through Stripe. Axal VC never stores your card details.</p> : null}
            </Card>
          </div>
        )
      ) : null}

      {step === 5 ? <IncorporateDone order={status || order} projectId={projectId} companyName={form.company_name.trim()} /> : null}

      {step > 0 && step < 4 ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={() => setStep(step - 1)} data-testid="incorporate-back">‹ Back</button> : null}

      {(phone || embedded) && primary ? (
        <div className={phone ? 'fixed inset-x-0 bottom-0 z-20 border-t border-axal-hairline bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900' : ''}>
          <button type="button" className={`${BTN_PRIMARY} ${phone ? 'h-12 w-full' : ''}`} onClick={primary.go} disabled={primary.disabled} data-testid="incorporate-primary-bottom">{busy ? 'Working…' : primary.label}</button>
        </div>
      ) : null}
    </div>
  );
}
