/**
 * #4707 — the HQ licence page's lifecycle: one licence, its actions and tabs. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 *
 * D4819 (#4819), part 3 — the identity header, the Needs HQ strip and the
 * canvas's six sections (Overview, Terms, Agreement, Access, Operations,
 * History). Every tab the view had before sits under one section
 * (`licenceNavModel.js`), drawn as a second row where a section holds more
 * than one, so nothing that was reachable has gone.
 *
 * D4819 part 4 (#5927) — board L17: the lifecycle actions sit in the header's
 * More menu, which offers only what the licence's state allows
 * (`lifecycleActionsFor`), and each opens the one consequence sheet
 * (`LicenceConsequenceSheet.jsx`) before it writes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import LicenceTermsSchedule from '../LicenceTermsSchedule';
import LicenceRequestsPanel from '../LicenceRequestsPanel';
import LicenceFeeInvoices from '../LicenceFeeInvoices';
import LicenceHistory from '../LicenceHistory';
import { AlertCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { adminLicenceSyncApi } from '../../../lib/api/adminLicenceSync';
import { reportError } from '../../../lib/log';
import { useConsequenceSheet } from '../LicenceConsequenceSheet';
import { ACTION_LABELS, lifecycleActionsFor } from '../licenceConsequenceModel';
import { HeaderMenuItem, MoreMenu } from '../../../ui/AdminPageHeader';
import {
  DEFAULT_TAB, LICENCE_SECTIONS_NAV, phoneSectionTabs, phoneStep, sectionOfTab, sectionTabs, stepOfTab, tabKeyMove, tabOfStep,
} from '../licenceNavModel';
import { overviewFacts } from '../licenceOverviewModel';
import { HISTORY_STEP, ADMINS_STEP, NOTICES_STEP, BRAND_STEP, SCHEDULE_STEP, FEE_INVOICES_STEP, OVERVIEW_STEP, Field } from './licenceShared';
import LicenceIdentity from './LicenceIdentity';
import LicenceOverview, { AttentionStrip, PhoneTriage, useOverviewReads } from './LicenceOverview';
import { AdminsEditor } from './AdminsEditor';
import { BrandKitEditor } from './BrandKitEditor';
import { LicensedSeats, SeatEditor } from './CommercialTerms';
import { CountryPricing } from './CountryPricing';
import { Exclusivity } from './Exclusivity';
import TermsWorkspace from './TermsWorkspace';
import { ContractStep } from './ContractStep';
import LicenceAgreements from './LicenceAgreements';
import { DeployStep } from './DeployStep';
import { NoticesEditor } from './NoticesEditor';
import { LicenceSyncStrip } from './LicenceSyncStrip';
import { TerritoryEditor } from './TerritoryEditor';
import LicenceOutcomeCard from '../LicenceOutcomeCard';
import { licenceWriteOutcome } from '../licenceOutcomeModel';
import { outcomeOfError } from '../../../lib/mutationOutcome';
import { BELOW_MD_QUERY, usePhoneWidth } from '../../../ui/phone/usePhoneWidth';

/* ------------------------------------------------------------------ *
 * Detail                                                              *
 * ------------------------------------------------------------------ */

export function Detail({ uid, held, onChanged, onOpenLicence, tab = DEFAULT_TAB, onTab }) {
  // D4707 — never window.prompt. D4819 part 4 — every lifecycle action opens
  // the consequence sheet, which asks for the reason where the write records one.
  const [consequenceSheet, askConsequence] = useConsequenceSheet();
  const [d, setD] = useState(null);
  // D4707 — the tab lives in the URL (`?tab=`), so a link reopens it.
  // D4819 part 20 (#5932), board L20 — below `md` the licence is a triage
  // view, not the desktop workstation: the triage rows sit above the tabs, the
  // Terms section is read-only (a terms editor's tab draws the Terms read,
  // `phoneStep`), and the requests side panel steps aside for the Requests row.
  const phone = usePhoneWidth(BELOW_MD_QUERY);
  const step = phone ? phoneStep(stepOfTab(tab)) : stepOfTab(tab);
  const setStep = (n) => onTab?.(tabOfStep(n));
  const [busy, setBusy] = useState(false);
  // D197 — the detach's own reason and its own error. `act` below reports a
  // failure to the beacon and renders nothing, which is right for a control
  // whose effect is visible on the next load; it is wrong for this one,
  // because a silently-failed detach tells HQ a host was taken away when it
  // was not. The server's sentence is shown instead.
  const [detachReason, setDetachReason] = useState('');
  const [detachErr, setDetachErr] = useState('');
  // D801 — the term "Open terms" points at, and the delegate "Grant admin" prefills.
  const [highlight, setHighlight] = useState(null);
  const [grant, setGrant] = useState(null);

  // D4819 part 3 — when the ledger was read, for the Overview's Sources card.
  const [readAt, setReadAt] = useState(null);
  const load = useCallback(() => {
    api.licence(uid)
      .then((x) => { setD(x); setReadAt(new Date().toISOString()); })
      .catch((e) => { reportError('licence_load_failed', e); setD(false); });
  }, [uid]);
  useEffect(load, [load]);

  // D4819 part 3 — the reads behind the header's and the Overview's facts,
  // made once for both. A fact read off the licence itself retries by
  // re-reading the licence.
  const { reads, retry: retryRead } = useOverviewReads(d || null);
  const retry = (key) => (key === 'licence' ? load() : retryRead(key));

  const refresh = () => { load(); onChanged?.(); };

  // D4706 — every lifecycle action (activate, suspend, reinstate, renew,
  // terminate) says how it ended. An unknown outcome re-reads the licence
  // before anything is offered again, so the status shown is the one the
  // server holds, not the one the operator hoped for.
  // D4819 part 21 (#5928, L18): the write's outcome is kept as what happened (`action`, `phase`, `result`,
  // `error`) and drawn against the licence's `sync` as last read, so a partial outcome says what the branch
  // holds now. Pending, completed, partial, refused and unknown each look different (`LicenceOutcomeCard`).
  const [actOutcome, setActOutcome] = useState(null);
  async function act(action, fn, ...args) {
    setBusy(true); setActOutcome({ action, phase: 'pending' });
    try {
      const result = await fn(...args);
      setActOutcome({ action, phase: 'done', result });
      refresh();
    } catch (e) {
      reportError('licence_action_failed', e);
      setActOutcome({ action, phase: 'failed', error: e });
      if (outcomeOfError(e) === 'unknown') refresh();
    } finally { setBusy(false); }
  }

  if (d === false) return <p className="text-sm text-red-600">Could not load this licence.</p>;
  if (!d) return <p className="text-sm text-gray-500">Loading…</p>;

  const facts = overviewFacts(d, reads);
  // D4819 part 21: Retry branch sync, from the outcome card and from the Branch sync strip.
  const retrySync = () => act('syncRetry', adminLicenceSyncApi.retry, d.uid);
  // D801: "Open terms" goes to the term's row or its step; "Grant admin" prefills the appointment.
  const openTerm = (target) => {
    const tab = { schedule: SCHEDULE_STEP, terms: 4, seats: 3, territory: 2 }[target.tab] ?? SCHEDULE_STEP;
    setHighlight(target.key);
    setStep(tab);
  };
  const grantAdmin = (g) => { setGrant(g); setStep(ADMINS_STEP); };
  const section = sectionOfTab(tabOfStep(step));
  // The views whose section draws its own two cards across the width (L11, L12): the side panel steps aside.
  const sectionWide = step === NOTICES_STEP || step === ADMINS_STEP;
  const subTabs = phone ? phoneSectionTabs(section, d.kind) : sectionTabs(section, d.kind);
  const sectionLabel = LICENCE_SECTIONS_NAV.find((x) => x.key === section)?.label || 'Overview';
  const openSection = (key) => {
    const first = sectionTabs(key, d.kind)[0];
    if (first) setStep(first.step);
    return first;
  };

  // D4819 part 4 — what each lifecycle action writes, once its sheet is confirmed.
  const WRITES = {
    activate: () => act('activate', api.licenceActivate, d.uid),
    reinstate: () => act('reinstate', api.licenceReinstate, d.uid),
    renew: () => act('renew', api.licenceRenew, d.uid, {}),
    suspend: (reason) => act('suspend', api.licenceSuspend, d.uid, reason),
    terminate: (reason) => act('terminate', api.licenceTerminate, d.uid, reason),
  };
  const runAction = async (action) => {
    if (busy) return;
    const out = await askConsequence(action, d, reads);
    if (out) WRITES[action](out.reason);
  };
  const offered = lifecycleActionsFor(d);
  const actions = offered.length > 0 && (
    <MoreMenu className="shrink-0" testId="licence-more">
      {offered.map((a) => (
        <HeaderMenuItem key={a} onSelect={() => runAction(a)} data-testid={`licence-action-${a}`}>
          {ACTION_LABELS[a]}
        </HeaderMenuItem>
      ))}
    </MoreMenu>
  );

  // D4819 part 3 — drawn on Operations › Branch and domain, beside the sync figures and the deployment.
  const domainStrip = (
    <>
      {/* H31 — THE DOMAIN STRIP, AND THE ONE THING HQ MAY DO TO IT (D197).
          The artboard's own sentence: "There is no Approve, no Add domain, and
          no DNS editor for HQ to complete on a tenant's behalf." So five
          columns of status, a footer saying where the records live, and Detach
          as the only control. Before D197 `d.custom_domain` was read off a
          table that had no such column, so this strip said "Not recorded" on
          every licence that has ever existed. */}
      <div
        className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950"
        data-testid="licence-domain-strip"
      >
        <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">Domain</div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="Platform host"
            // THE HOST MEMBERS ACTUALLY USE, and it is never blank while a
            // licence is deployed — S17's "a licence never waits on DNS" is
            // only true because this column exists.
            value={d.deployment_available === false ? null : (d.deployment?.hostname || null)}
            hint={d.deployment_available === false
              ? 'The deployment registry could not be read.'
              : d.deployment ? null : 'No branch is deployed for this licence yet.'}
          />
          <Field
            label="Custom host"
            value={d.domain_available === false ? null : (d.domain?.hostname || null)}
            hint={d.domain_available === false
              ? d.domain_reason
              : d.domain ? null : 'The Admin has bound none. HQ does not add one.'}
          />
          <Field
            label="State"
            value={d.domain_available === false ? null : (d.domain?.state || null)}
            hint={d.domain?.state === 'verified' ? 'Both records confirmed' : null}
          />
          <Field
            label="Certificate"
            // NOT A DATE, AND NOT "PENDING". Issuing one needs a Cloudflare for
            // SaaS custom hostname that is not configured, so there is no
            // certificate and no queue it is waiting in. The server writes the
            // reason; printing a date here would be the invented figure this
            // strip existed to avoid.
            value={null}
            hint={d.domain?.serves_reason
              || 'No certificate is issued for a custom host, and none is pending.'}
          />
          <Field
            label="Primary"
            // `is_primary` exists and nothing writes 1: a host members are sent
            // to has to serve first. Saying so beats a "No" that reads like a
            // choice somebody made.
            value={null}
            hint="No custom host is primary. Members are on the platform host."
          />
        </div>
        <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
          Status only — the records live in the tenant&rsquo;s own zone. The Admin binds the hostname in
          Settings → Domain, including a white-label. HQ does not set a CNAME, a certificate, or a
          fallback host, and Super Admin stays on axal.vc and app.axal.vc.
        </p>
        {/* DETACH IS DRAWN ONLY WHEN THERE IS A HOST TO DETACH, and never on a
            row Super Admin has already detached — both would 409, and a button
            that can only refuse is the `still_an_admin` mistake D134 named. */}
        {d.domain && d.domain.state !== 'detached' && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setDetachErr('');
              api.licenceDomainDetach(d.uid, detachReason)
                .then(() => { setDetachReason(''); refresh(); })
                .catch((e2) => {
                  reportError('licence_domain_detach_failed', e2);
                  setDetachErr(e2?.data?.error || e2?.message || 'The detach did not go through, and the host is unchanged.');
                })
                .finally(() => setBusy(false));
            }}
          >
            <input
              value={detachReason}
              onChange={(e) => setDetachReason(e.target.value)}
              placeholder="Why this host is being detached (≥10 characters)"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
            />
            <button
              type="submit"
              disabled={detachReason.trim().length < 10 || busy}
              className="rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-40 dark:border-rose-800 dark:text-rose-300"
              data-testid="licence-domain-detach"
            >
              Detach
            </button>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              The operator is sent this reason, and the host stays claimed so nobody else can take it.
            </span>
            {detachErr && (
              <p className="w-full text-[11px] text-rose-700 dark:text-rose-300" data-testid="licence-domain-detach-error">
                {detachErr}
              </p>
            )}
          </form>
        )}
        {d.domain?.state === 'detached' && (
          <p className="mt-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300" data-testid="licence-domain-detached">
            Detached{d.domain.detached_at ? ` ${String(d.domain.detached_at).slice(0, 10)}` : ''}.
            {d.domain.detach_reason ? ` ${d.domain.detach_reason}` : ''} The hostname stays claimed, so
            re-binding it is not something the operator can do from their side.
          </p>
        )}
      </div>
    </>
  );

  return (
    <div>
      {consequenceSheet}
      <LicenceOutcomeCard
        outcome={actOutcome ? licenceWriteOutcome({ ...actOutcome, sync: d.sync }) : null} busy={busy}
        onRetrySync={retrySync} onReread={refresh}
        onDismiss={() => setActOutcome(null)} testId="licence-action-outcome"
      />
      <LicenceIdentity licence={d} facts={facts} retry={retry} actions={actions} />
      <AttentionStrip licence={d} facts={facts} />
      {phone && step === OVERVIEW_STEP && <PhoneTriage facts={facts} retry={retry} onOpenTab={(key) => onTab?.(key)} />}

      {d.status === 'suspended' && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Suspended{d.status_note ? `: ${d.status_note}` : ''}. It still holds{' '}
          {d.territories.length === 1 ? 'its country' : `all ${d.territories.length} of its countries`}.
        </div>
      )}

      {/* The unfinished-termination notice stays above the sections: its Resume cannot wait for a tab.
          The sync figures moved to Operations › Branch and domain, and the old figures grid
          (territory, seats, fee, shares, renewal) to the header and the Overview's facts. */}
      <LicenceSyncStrip sync={d.sync} busy={busy} onResume={() => act('terminate', api.licenceTerminate, d.uid)} part="termination" />

      {d.blockers?.length > 0 && d.status !== 'active' && (
        <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Before this can be activated</div>
          <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {d.blockers.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-500" />{b}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gray-500">A pending signature does not block activation.</p>
        </div>
      )}
      {offered.includes('activate') && (
        <button type="button" disabled={busy} onClick={() => runAction('activate')} data-testid="licence-activate"
          className="mt-4 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          Activate
        </button>
      )}

      {/* D4707 — a real tablist: arrow keys, Home and End move between tabs,
          the selected one says so, and on a narrow screen the row scrolls
          sideways instead of wrapping into a second row of half-tabs.
          D4819 part 3 — the first row is the canvas's six sections; a section
          that holds more than one of the view's tabs draws them as a second
          tablist under it, with the same keys. Both live in the URL (`?tab=`).
          D4819 part 20 — below `md` the six sections are a 3 × 2 grid of 44px
          tabs and the second row wraps, so neither row scrolls the page sideways;
          the keys are the same. */}
      <div
        role="tablist" aria-label="Licence sections" data-testid="licence-tabs"
        className="mt-6 grid grid-cols-3 gap-1 border-b border-gray-200 dark:border-gray-800 md:-mx-1 md:flex md:overflow-x-auto md:whitespace-nowrap md:px-1 md:[scrollbar-width:thin]"
        onKeyDown={(e) => {
          const at = LICENCE_SECTIONS_NAV.findIndex((x) => x.key === section);
          const next = tabKeyMove(e.key, at < 0 ? 0 : at, LICENCE_SECTIONS_NAV.length);
          if (next === null) return;
          e.preventDefault();
          openSection(LICENCE_SECTIONS_NAV[next].key);
          document.getElementById(`licence-section-${LICENCE_SECTIONS_NAV[next].key}`)?.focus();
        }}
      >
        {LICENCE_SECTIONS_NAV.map((x) => (
          <button
            key={x.key} id={`licence-section-${x.key}`} type="button" role="tab"
            aria-selected={section === x.key} aria-controls="licence-tabpanel" tabIndex={section === x.key ? 0 : -1}
            data-testid={`licence-section-${x.key}`} onClick={() => openSection(x.key)}
            className={`-mb-px min-h-[44px] min-w-0 shrink-0 border-b-2 px-1 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 md:min-h-0 md:px-3 ${
              section === x.key ? 'border-indigo-600 font-semibold text-indigo-700 dark:text-indigo-300' : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {subTabs.length > 1 && (
        <div
          role="tablist" aria-label={`${sectionLabel} views`} data-testid="licence-subtabs"
          className="mt-2 flex flex-wrap gap-1 md:-mx-1 md:flex-nowrap md:overflow-x-auto md:whitespace-nowrap md:px-1 md:[scrollbar-width:thin]"
          onKeyDown={(e) => {
            const at = subTabs.findIndex((t) => t.step === step);
            const next = tabKeyMove(e.key, at < 0 ? 0 : at, subTabs.length);
            if (next === null) return;
            e.preventDefault();
            setStep(subTabs[next].step);
            document.getElementById(`licence-tab-${subTabs[next].key}`)?.focus();
          }}
        >
          {subTabs.map((t) => (
            <button
              key={t.key} id={`licence-tab-${t.key}`} type="button" role="tab"
              aria-selected={step === t.step} aria-controls="licence-tabpanel" tabIndex={step === t.step ? 0 : -1}
              data-testid={t.testId} onClick={() => setStep(t.step)}
              className={`min-h-[44px] shrink-0 rounded-full border px-3 py-1 text-xs md:min-h-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${
                step === t.step ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-gray-200 text-gray-600 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {/* D4819 part 12: on Requests and compliance the requests are the section's own card, so the side panel steps aside.
          D4819 part 11: so it does on Access › Administrators, board L11's two cards side by side. */}
      <div className={`mt-4 grid grid-cols-1 gap-4 ${sectionWide ? '' : 'lg:grid-cols-[minmax(0,1fr)_18rem]'}`}>
      <div className={`min-w-0 ${sectionWide ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]' : ''}`} role="tabpanel" id="licence-tabpanel"
        aria-labelledby={subTabs.length > 1 ? `licence-tab-${tabOfStep(step)}` : `licence-section-${section}`}>
        {step === OVERVIEW_STEP && (
          <LicenceOverview licence={d} reads={reads} retry={retry} readAt={readAt} onOpenTab={(key) => onTab?.(key)} />
        )}
        {step === 1 && (
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal entity" value={d.legal_entity_name} />
              <Field label="Brand name in product" value={d.brand_name} />
              <Field label="Registered address" value={d.registered_address} />
              <Field label="Signatory"
                value={d.signatory_name ? `${d.signatory_name}${d.signatory_title ? ` · ${d.signatory_title}` : ''}` : null} />
            </div>
            {/* D198 — the brand kit moved to its own tab and is drawn only for a
                white-label. What stays here is the one sentence Entity needs:
                which brand this licence trades under, and who decides it. */}
            <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
              {d.kind === 'white_label'
                ? 'This is a white-label licence, so the operator trades under their own brand. '
                  + 'The mark and the colours are on the Brand kit tab; HQ captures them because a '
                  + 'licence is issued before anybody is named on it, and HQ does not approve them.'
                : 'This is an Axal subsidiary, so it trades under Axal\u2019s brand. That brand is '
                  + 'fixed and is not stored per licence, which is why there is no brand-kit tab '
                  + 'here \u2014 only a white-label licence has one of its own.'}
            </p>
          </div>
        )}
        {step === 2 && (
          <TerritoryEditor licence={d} held={held} onSaved={refresh} onOpenLicence={onOpenLicence} />
        )}
        {/* D5019 — exclusivity and development commitments, apart from the operating territory above. */}
        {step === 2 && <Exclusivity licence={d} />}
        {step === 3 && <SeatEditor licence={d} onSaved={refresh} />}
        {/* D4819: the canvas's Terms section: read-only by default, amended in a reviewed session. */}
        {step === 4 && <TermsWorkspace licence={d} onSaved={refresh} onOpenTab={(key) => onTab?.(key)} />}
        {/* D5017 — the country-pricing recommendation, under the core terms it can change. */}
        {step === 4 && <CountryPricing licence={d} onSaved={refresh} />}
        {step === 5 && <ContractStep licence={d} onSaved={refresh} />}
        {/* D5051 (L33): the package and program agreements, package readiness and legal Needs HQ, after the master. */}
        {step === 5 && <LicenceAgreements licence={d} />}
        {step === 6 && (
          <div>
            <LicenceSyncStrip sync={d.sync} busy={busy} onResume={() => act('terminate', api.licenceTerminate, d.uid)} part="strip"
              deployment={d.deployment ?? null} deploymentAvailable={d.deployment_available} onReread={load}
              onRetry={retrySync} />
            {domainStrip}
            <div className="mt-4"><DeployStep licence={d} /></div>
          </div>
        )}
        {/* D4819 part 11 (#5922): board L11, administrators with their account state beside licensed seats by profile. */}
        {step === ADMINS_STEP && <AdminsEditor key={grant?.uid || 'admins'} licence={d} prefill={grant}
          onSaved={() => { setGrant(null); refresh(); }} />}
        {step === ADMINS_STEP && <LicensedSeats licence={d} onOpenTab={(key) => onTab?.(key)} />}
        {step === SCHEDULE_STEP && <LicenceTermsSchedule licence={d} highlight={highlight} onSaved={refresh} />}
        {/* D4819 part 12 (#5923): board L12, studio requests then compliance, each failing on its own. */}
        {step === NOTICES_STEP && <LicenceRequestsPanel licence={d} layout="section" onOpenTerm={openTerm} onGrantAdmin={grantAdmin} />}
        {step === NOTICES_STEP && <NoticesEditor licence={d} onSaved={refresh} />}
        {step === FEE_INVOICES_STEP && <LicenceFeeInvoices licence={d} />}
        {/* The kind is re-checked here as well as on the tab: the tab is what an
            operator clicks, and this is what decides what renders. A licence
            whose kind changed while the tab was open falls back to nothing
            rather than to an editor for a store its kind has no row in. */}
        {step === BRAND_STEP && d.kind === 'white_label'
          && <BrandKitEditor licence={d} onSaved={refresh} />}
        {step === HISTORY_STEP && <LicenceHistory licence={d} />}
      </div>
      {!sectionWide && !phone && (
        <LicenceRequestsPanel
          licence={d}
          onOpenTerm={openTerm}
          onGrantAdmin={(g) => { setGrant(g); setStep(ADMINS_STEP); }}
        />
      )}
      </div>
    </div>
  );
}
