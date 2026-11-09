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
 */
import React, { useCallback, useEffect, useState } from 'react';
import LicenceTermsSchedule from '../LicenceTermsSchedule';
import LicenceRequestsPanel from '../LicenceRequestsPanel';
import LicenceFeeInvoices from '../LicenceFeeInvoices';
import LicenceHistory from '../LicenceHistory';
import { AlertCircle, Check, X, Ban, RotateCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useReasonDialog } from '../LicenceReasonDialog';
import { LICENCE_REASONS } from '../licenceReasonModel';
import {
  DEFAULT_TAB, LICENCE_SECTIONS_NAV, sectionOfTab, sectionTabs, stepOfTab, tabKeyMove, tabOfStep,
} from '../licenceNavModel';
import { overviewFacts } from '../licenceOverviewModel';
import { HISTORY_STEP, ADMINS_STEP, NOTICES_STEP, BRAND_STEP, SCHEDULE_STEP, FEE_INVOICES_STEP, OVERVIEW_STEP, Field } from './licenceShared';
import LicenceIdentity from './LicenceIdentity';
import LicenceOverview, { AttentionStrip, useOverviewReads } from './LicenceOverview';
import { AdminsEditor } from './AdminsEditor';
import { BrandKitEditor } from './BrandKitEditor';
import { SeatEditor } from './CommercialTerms';
import { CountryPricing } from './CountryPricing';
import { Exclusivity } from './Exclusivity';
import TermsWorkspace from './TermsWorkspace';
import { ContractStep } from './ContractStep';
import { DeployStep } from './DeployStep';
import { NoticesEditor } from './NoticesEditor';
import { LicenceSyncStrip } from './LicenceSyncStrip';
import { TerritoryEditor } from './TerritoryEditor';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { describeOutcome, outcomeFromError, outcomeOfError } from '../../../lib/mutationOutcome';

/* ------------------------------------------------------------------ *
 * Detail                                                              *
 * ------------------------------------------------------------------ */

export function Detail({ uid, held, onChanged, onOpenLicence, tab = DEFAULT_TAB, onTab }) {
  // D4707 — reasons are asked for in a labelled dialog, never window.prompt.
  const [reasonDialog, ask] = useReasonDialog();
  const [d, setD] = useState(null);
  // D4707 — the tab lives in the URL (`?tab=`), so a link reopens it.
  const step = stepOfTab(tab);
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
  const [actNotice, setActNotice] = useState(null);
  async function act(fn, ...args) {
    setBusy(true); setActNotice(null);
    try {
      await fn(...args);
      setActNotice(describeOutcome('committed', { fallback: 'Done. The licence below is as the server now holds it.' }));
      refresh();
    } catch (e) {
      reportError('licence_action_failed', e);
      setActNotice(outcomeFromError(e, 'That was refused. The licence is unchanged.'));
      if (outcomeOfError(e) === 'unknown') refresh();
    } finally { setBusy(false); }
  }

  if (d === false) return <p className="text-sm text-red-600">Could not load this licence.</p>;
  if (!d) return <p className="text-sm text-gray-500">Loading…</p>;

  const facts = overviewFacts(d, reads);
  const section = sectionOfTab(tabOfStep(step));
  const subTabs = sectionTabs(section, d.kind);
  const sectionLabel = LICENCE_SECTIONS_NAV.find((x) => x.key === section)?.label || 'Overview';
  const openSection = (key) => {
    const first = sectionTabs(key, d.kind)[0];
    if (first) setStep(first.step);
    return first;
  };

  const actions = (
    <div className="flex flex-wrap gap-2">
      {d.status === 'suspended' ? (
        <button type="button" disabled={busy} onClick={() => act(api.licenceReinstate, d.uid)}
          className="inline-flex items-center gap-1 rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50">
          <Check size={12} /> Reinstate
        </button>
      ) : d.status === 'active' && (
        <button type="button" disabled={busy}
          onClick={async () => {
            const note = await ask(LICENCE_REASONS.suspendLicence);
            if (note) act(api.licenceSuspend, d.uid, note);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50">
          <Ban size={12} /> Suspend
        </button>
      )}
      {d.status !== 'terminated' && (
        <>
          <button type="button" disabled={busy} onClick={() => act(api.licenceRenew, d.uid, {})}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
            <RotateCw size={12} /> Renew
          </button>
          <button type="button" disabled={busy}
            onClick={async () => {
              const note = await ask(LICENCE_REASONS.terminateLicence);
              if (note) act(api.licenceTerminate, d.uid, note);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
            <X size={12} /> Terminate
          </button>
        </>
      )}
    </div>
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
      {reasonDialog}
      <OutcomeNotice notice={actNotice} testId="licence-action-outcome" onDismiss={() => setActNotice(null)} />
      <LicenceIdentity licence={d} facts={facts} retry={retry} actions={actions} />
      <AttentionStrip licence={d} facts={facts} />

      {d.status === 'suspended' && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Suspended{d.status_note ? `: ${d.status_note}` : ''}. It still holds{' '}
          {d.territories.length === 1 ? 'its country' : `all ${d.territories.length} of its countries`} —
          releasing them is a termination, not a lapse.
        </div>
      )}

      {/* The unfinished-termination notice stays above the sections: its Resume cannot wait for a tab.
          The sync figures moved to Operations › Branch and domain, and the old figures grid
          (territory, seats, fee, shares, renewal) to the header and the Overview's facts. */}
      <LicenceSyncStrip sync={d.sync} busy={busy} onResume={() => act(api.licenceTerminate, d.uid)} part="termination" />

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
      {d.status !== 'active' && d.status !== 'terminated' && !d.blockers?.length && (
        <button type="button" disabled={busy} onClick={() => act(api.licenceActivate, d.uid)}
          className="mt-4 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          Activate
        </button>
      )}

      {/* D4707 — a real tablist: arrow keys, Home and End move between tabs,
          the selected one says so, and on a narrow screen the row scrolls
          sideways instead of wrapping into a second row of half-tabs.
          D4819 part 3 — the first row is the canvas's six sections; a section
          that holds more than one of the view's tabs draws them as a second
          tablist under it, with the same keys. Both live in the URL (`?tab=`). */}
      <div
        role="tablist" aria-label="Licence sections" data-testid="licence-tabs"
        className="mt-6 -mx-1 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200 px-1 [scrollbar-width:thin] dark:border-gray-800"
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
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${
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
          className="mt-2 -mx-1 flex gap-1 overflow-x-auto whitespace-nowrap px-1 [scrollbar-width:thin]"
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
              className={`shrink-0 rounded-full border px-3 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${
                step === t.step ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-gray-200 text-gray-600 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0" role="tabpanel" id="licence-tabpanel"
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
        {step === 6 && (
          <div>
            <LicenceSyncStrip sync={d.sync} busy={busy} onResume={() => act(api.licenceTerminate, d.uid)} part="strip" />
            {domainStrip}
            <div className="mt-4"><DeployStep licence={d} /></div>
          </div>
        )}
        {step === ADMINS_STEP && <AdminsEditor key={grant?.uid || 'admins'} licence={d} prefill={grant}
          onSaved={() => { setGrant(null); refresh(); }} />}
        {step === SCHEDULE_STEP && <LicenceTermsSchedule licence={d} highlight={highlight} onSaved={refresh} />}
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
      <LicenceRequestsPanel
        licence={d}
        onOpenTerm={(target) => {
          const tab = { schedule: SCHEDULE_STEP, terms: 4, seats: 3, territory: 2 }[target.tab] ?? SCHEDULE_STEP;
          setHighlight(target.key);
          setStep(tab);
        }}
        onGrantAdmin={(g) => { setGrant(g); setStep(ADMINS_STEP); }}
      />
      </div>
    </div>
  );
}
