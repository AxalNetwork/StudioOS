// Spin-Out Lab — Co-founder Agreement (Week 4 tool page).
//
// Design handoff: spin-out-lab-pipeline/project/Co-founder Agreement.dc.html.
// The design's layout ships in full; the design's DATA does not. Its entire
// status layer (Accepted / signedCount-of-2 / v1.3 / "4 of 6 modules" / a
// 9-row RACI matrix / "Guillaume L. & Maya R." / 52.9-47.1 / "Fully executed")
// is hardcoded literals in the prototype's renderVals() with zero backing
// fields. On a legal-document tool a fabricated clause status, signature
// state, or equity number is the worst possible failure, so every one of them
// is replaced by a named, checkable derivation in
// lib/cofounderAgreementViewModel.js — or omitted with the reason shown.
//
// What is real here:
//   - Every editable clause is a real input of POST /legal/cofounder-agreement.
//     The request body has the same 16 keys it always had.
//   - WYSIWYG generation: the Generate button is gated on there being NO
//     `blocked` clause, and generate() sends the parsed values or refuses. It
//     never substitutes a fallback for an empty field — a document whose
//     vesting/confidentiality/jurisdiction terms differ from the ones on
//     screen is the worst failure this page can produce.
//   - An untouched builder default is labelled "Default — not reviewed", not
//     "Draft input": a value the builder supplied for you is not a term you
//     chose, and no pill asserts authorship the user does not have.
//   - Equity prefill comes from the project's saved cap-table scenario.
//   - Documents + their status come from GET /legal/documents
//     (template_name === 'cofounder_agreement').
//   - Clause statuses are derived from cap table, project members, formation
//     orders, 83(b) trackers, and the builder inputs — see STATUS/CLAUSE_SPEC.
//
// What is deliberately disabled or omitted (no backend exists):
//   - "Accept term" / "Needs alignment" clause workflow — there is no
//     clause-state store; a clause reading "Accepted" when nothing recorded an
//     acceptance is a fabricated legal fact.
//   - Per-signer signature pills — the schema has one signed_by per DOCUMENT.
//   - "Send for signature" / "Fully executed" — api.js has no method to sign a
//     documents row. The finalize control is disabled with the reason in title.
//   - Solo-founder declaration — no template exists in either runtime.
//   - Share and Preview-as-investor — disabled with reasons.
//   - The generator is dev-only (no Worker route); the 404/405 at generate time
//     raises an environment banner. Existing documents are unaffected.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileSignature, Loader2, Lock, AlertTriangle, FileText, Users,
  CheckCircle2, ExternalLink, Sparkles, Share2, Download, Copy, Eye, Check,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';
import {
  buildCofounderAgreementViewModel, capTableSplit as capTableSplitFn, newDraft,
} from '../lib/cofounderAgreementViewModel';
import StatusPill from '../components/cofounder/StatusPill';
import ClauseRow from '../components/cofounder/ClauseRow';
import { EDITORS, ReadOnlyClause } from '../components/cofounder/ClauseEditors';
import CriticalTermsSnapshot from '../components/cofounder/CriticalTermsSnapshot';
import RolesAndReservedMatters from '../components/cofounder/RolesAndReservedMatters';
import IpRider from '../components/cofounder/IpRider';
import DisputeCard from '../components/cofounder/DisputeCard';
import ExecutionConsole from '../components/cofounder/ExecutionConsole';
import SoloDeclaration from '../components/cofounder/SoloDeclaration';

// Kept as a named export for unit-testability (moved to the view model).
export { capTableSplit } from '../lib/cofounderAgreementViewModel';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';

/** Read-only prose for the three template-fixed clauses (no generator input). */
const READONLY_PROSE = {
  departure: 'Standard leaver mechanics (§7): a departing founder forfeits all unvested equity; termination for cause lets the Company repurchase vested shares on the template’s buyout terms; a Change of Control accelerates per the vesting clause; and founders may not transfer shares to third parties without first offering them to the Company. Review the exact language in the generated document.',
  covenants: 'Fixed template language (§8.2): for 12 months after involvement ends, no founder may solicit the Company’s employees or customers. This template contains no non-compete — non-competes are unenforceable in several states.',
  s83b: 'The template (§9) obligates each founder to file their 83(b) election within 30 days of stock purchase. The deadline is statutory and cannot be extended.',
};

export default function SpinoutLabCofounderAgreementPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [docs, setDocs] = useState([]);            // cofounder_agreement documents
  const [capSplit, setCapSplit] = useState([]);    // relative split from Cap Table
  const [members, setMembers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [trackers, setTrackers] = useState([]);
  const [connections, setConnections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [envUnavailable, setEnvUnavailable] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [showBuilder, setShowBuilder] = useState(false);

  // UI-only state (no backend, nothing implied to be saved).
  const [path, setPath] = useState('multi');
  const [showExplain, setShowExplain] = useState(false);
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  const autoExpanded = useRef(false);
  // Affirmative confirmation required only when an admin/partner is editing a
  // startup that is not their own (see vm.permission.actingForOther).
  const [confirmedOther, setConfirmedOther] = useState(false);

  // Builder state — mirrors the generator's request model exactly. Seeded from
  // the view model's DEFAULT_DRAFT so the same literals define BOTH the
  // starting values and the baseline that tells an untouched default apart
  // from a term the founder actually chose. Do not re-declare them here.
  const [draft, setDraft] = useState(newDraft);
  const setD = useCallback((patch) => setDraft((prev) => ({ ...prev, ...patch })), []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state(),
          api.getMe(),
          api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        if (proj) {
          // Every one of these degrades to [] on failure — a missing upstream
          // downgrades a clause status, it never crashes the page.
          const [docRes, capRes, memRes, ordRes, trkRes, connRes] = await Promise.allSettled([
            api.listDocuments(proj.id),
            api.getCapTableByProject(proj.id),
            api.listProjectMembers(proj.id),
            api.legalIncorporationOrders(),
            api.legal83bList(proj.id),
            api.cofounderListConnections(),
          ]);
          if (dead) return;

          const all = docRes.status === 'fulfilled' && Array.isArray(docRes.value) ? docRes.value : [];
          const mine = all.filter((d) => d.template_name === 'cofounder_agreement');
          setDocs(mine);
          setShowBuilder(mine.length === 0);

          const memVal = memRes.status === 'fulfilled' ? memRes.value : null;
          setMembers(Array.isArray(memVal?.members) ? memVal.members : (Array.isArray(memVal) ? memVal : []));

          const ordVal = ordRes.status === 'fulfilled' ? ordRes.value : null;
          setOrders(Array.isArray(ordVal?.orders) ? ordVal.orders : (Array.isArray(ordVal) ? ordVal : []));

          const trkVal = trkRes.status === 'fulfilled' ? trkRes.value : null;
          setTrackers(Array.isArray(trkVal?.trackers) ? trkVal.trackers : (Array.isArray(trkVal) ? trkVal : []));

          const connVal = connRes.status === 'fulfilled' ? connRes.value : null;
          setConnections(Array.isArray(connVal?.items) ? connVal.items : (Array.isArray(connVal) ? connVal : []));

          // Real prefill: relative founder split from the saved cap table.
          const split = capRes.status === 'fulfilled' ? capTableSplitFn(capRes.value?.scenario?.inputs) : [];
          setCapSplit(split);
          setDraft((prev) => ({
            ...prev,
            companyName: proj.name || '',
            // Names and percentages are REAL cap-table data. Titles are not:
            // cap-table row order carries no officer semantics, so assigning
            // CEO/CTO by position would pair real people with invented officer
            // titles that generate verbatim into §5. Left blank — the backend
            // renders an empty role as "TBD".
            founders: split.length
              ? split.map((f) => ({ name: f.name, email: '', role: '', equity_pct: f.equity_pct, start_date: '' }))
              : [
                { name: '', email: '', role: '', equity_pct: 50, start_date: '' },
                { name: '', email: '', role: '', equity_pct: 50, start_date: '' },
              ],
          }));
        }
        if (!dead) setStatus('ready');
      } catch (e) {
        console.error('[spinout-cofounder]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const vm = useMemo(() => buildCofounderAgreementViewModel({
    user, project, labState: state, docs, capSplit, members, orders, trackers,
    connections, draft, path, envUnavailable,
  }), [user, project, state, docs, capSplit, members, orders, trackers, connections, draft, path, envUnavailable]);

  const canEdit = vm.permission.canEdit;
  const canGenerate = vm.permission.canGenerate;
  // An admin/partner on somebody else's startup must tick the confirmation
  // before the generator writes a real legal document onto that project.
  const needsOtherConfirm = vm.permission.actingForOther && !confirmedOther;
  const canSubmit = canGenerate && !needsOtherConfirm;
  const submitBlockedReason = needsOtherConfirm
    ? 'Confirm you mean to generate on this founder’s startup first.'
    : vm.permission.blockedReason;

  // W4 deliverable — declared before every early return (Rules of Hooks).
  // Fires only from real document status; never from a UI toggle, a clause
  // status, a path switch, or generation success. SpinoutLabIncorporatePage
  // reads this milestone back to gate a downstream row.
  useEffect(() => {
    if (docs.some((d) => String(d.status || '').toLowerCase() === 'signed')) {
      markMilestone(user, 'cofounder_agreement_signed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, user?.id]);

  // Auto-expand blocked clauses once, on the first ready render.
  useEffect(() => {
    if (status !== 'ready' || autoExpanded.current) return;
    autoExpanded.current = true;
    const blocking = vm.clauses.filter((c) => c.blocking).map((c) => c.key);
    if (blocking.length) setOpenKeys(new Set(blocking));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const toggleClause = useCallback((key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const allOpen = vm.clauses.length > 0 && openKeys.size >= vm.clauses.length;
  const toggleAll = () => setOpenKeys(allOpen ? new Set() : new Set(vm.clauses.map((c) => c.key)));

  const scrollToExec = () => {
    const el = document.getElementById('exec-console');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  // Client-side only. Carries provenance and per-clause status; deliberately
  // contains no signature field of any kind.
  const exportSummary = () => {
    const payload = {
      provenance: 'Draft input — not stored in Axal until the agreement is generated',
      exported_at: new Date().toISOString(),
      startup: project?.name || null,
      path,
      company_name: draft.companyName || null,
      founders: vm.founders.map((f) => ({ name: f.name, role: f.role, equity_pct: f.equityPct, start_date: f.startDate })),
      clauses: vm.clauses.map((c) => ({
        key: c.key, label: c.label, section: c.section, value: c.value,
        status: c.statusLabel, source: c.source, note: c.note,
      })),
      readiness: vm.moduleProgress.label,
      needs_attention: vm.unresolvedCount,
      generated_drafts: vm.execution.draftCount,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    // Firefox needs the anchor in the document, and revoking in the same tick
    // as click() can cancel the download — defer the revoke by a macrotask.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project?.name || 'startup').toLowerCase().replace(/\W+/g, '-')}-cofounder-agreement-draft.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const generate = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      // NO silent coercion. `Number(x) || 4` turned a user-visible 0-year vest
      // into a contractual 4-year vest, and an empty governing law was sent
      // verbatim into "§10.1 Governing Law: ." — a document whose terms the
      // founder never chose. canGenerate already blocks on every invalid
      // clause; this is the belt-and-braces check that the values leaving the
      // page are exactly the ones the page displayed.
      const numeric = {
        vesting_years: Number(draft.vestingYears),
        cliff_months: Number(draft.cliffMonths),
        cliff_pct: Number(draft.cliffPct),
        confidentiality_years: Number(draft.confidentialityYears),
      };
      const badField = Object.keys(numeric).find((k) => !Number.isFinite(numeric[k]));
      const law = String(draft.governingLaw || '').trim();
      const venue = String(draft.arbitrationVenue || '').trim();
      if (badField || !law || !venue) {
        setError('Some clause values are empty or invalid. Fix the blocked clauses above — the agreement is not generated with substituted values.');
        return; // `finally` clears busy
      }
      const r = await api.legalCofounderAgreement({
        project_id: project.id,
        company_name: draft.companyName.trim(),
        founders: draft.founders.map((f) => ({
          name: f.name.trim(),
          email: f.email.trim() || null,
          role: f.role.trim() || null,
          equity_pct: Number(f.equity_pct) || 0,
          start_date: f.start_date || null,
        })),
        vesting_years: numeric.vesting_years,
        cliff_months: numeric.cliff_months,
        cliff_pct: numeric.cliff_pct,
        acceleration: draft.acceleration,
        ip_exclusions: draft.ipExclusions.trim() || null,
        decision_day_to_day: draft.decisionDayToDay,
        decision_threshold: draft.decisionThreshold,
        unanimous_matters: draft.unanimousMatters.filter((m) => m.trim()),
        deadlock_clause: draft.deadlock,
        commitment_level: draft.commitment,
        confidentiality_years: numeric.confidentiality_years,
        governing_law: law,
        arbitration_venue: venue,
      });
      setGenerated(r?.document || r);
      setShowBuilder(false);
      try {
        const all = await api.listDocuments(project.id);
        setDocs((Array.isArray(all) ? all : []).filter((d) => d.template_name === 'cofounder_agreement'));
      } catch { /* list refresh is best-effort */ }
    } catch (e) {
      console.error('[spinout-cofounder:generate]', e);
      if (e?.status === 404 || e?.status === 405) setEnvUnavailable(true);
      else setError(e?.data?.detail || e?.message || 'Could not generate the agreement.');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------- gates ---------------------------------- */
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="cofounder-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load the Co-founder Agreement</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The Co-founder Agreement workspace is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-violet-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!isAdmin && !(state?.unlocked_features || []).includes('cofounder-agreement')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Co-founder Agreement unlocks in Week 4</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Finish your current week's deliverables to unlock founder legal paperwork.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-no-project">
        <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">No startup record yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your startup in{' '}
          <Link to="/spinout-lab/startup" className="text-violet-600 hover:underline">Startups</Link>{' '}
          first — the agreement belongs to it.
        </p>
      </div>
    );
  }

  const qa = (key) => vm.quickActions.find((a) => a.key === key) || { label: '', enabled: false, disabledReason: '', testid: `qa-${key}` };
  const qaShare = qa('share');
  const qaExport = qa('export');
  const qaCopy = qa('copy');
  const qaInvestor = qa('investor');
  const QA_BTN = 'inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-lg px-2.5 py-1.5 transition';

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-cofounder">
      {/* Header — the app shell's own treatment, not the prototype's top bar. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/spinout-lab')}
          data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300 inline-flex items-center justify-center shrink-0">
            <FileSignature size={15} />
          </span>
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Co-founder Agreement</h1>
          <StatusPill
            tone={vm.activePill.tone}
            label={vm.activePill.label}
            size="xs"
            icon={vm.activePill.tone === 'emerald' ? <Check size={9} strokeWidth={3} /> : null}
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <div
              className="text-[11px] font-bold text-violet-600 dark:text-violet-400 tabular-nums"
              title={vm.moduleProgress.title}
              data-testid="text-module-progress"
            >
              {vm.moduleProgress.label}
            </div>
            <div className="w-[130px] h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mt-1 overflow-hidden">
              <div className="h-full bg-violet-600 rounded-full" style={{ width: `${vm.moduleProgress.pct}%` }} />
            </div>
          </div>
          {/* States a fact about the MODULE (it unlocks in Week 4 — the same
              number the lock screen shows), not about the viewer's week. */}
          <span
            title={vm.unlockPill.title}
            data-testid="pill-unlock"
            className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border whitespace-nowrap ${
              vm.unlockPill.tone === 'violet'
                ? 'text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-900/30 dark:border-violet-800'
                : 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-700'
            }`}
          >
            {vm.unlockPill.label}
          </span>
        </div>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Draft and generate the founding team agreement — equity, vesting, IP, roles, and departure — as a real legal document on your startup.
      </p>

      {/* Quick actions + path toggle */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button" disabled title={qaShare.disabledReason} data-testid={qaShare.testid}
          className={`${QA_BTN} text-gray-400 dark:text-gray-600 cursor-not-allowed`}
        >
          <Share2 size={13} /> {qaShare.label}
        </button>
        <button
          type="button" onClick={exportSummary} data-testid={qaExport.testid}
          className={`${QA_BTN} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800`}
        >
          <Download size={13} /> {qaExport.label}
        </button>
        <button
          type="button" onClick={copyLink} data-testid={qaCopy.testid}
          className={`${QA_BTN} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800`}
        >
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {copied ? 'Copied' : qaCopy.label}
        </button>
        <button
          type="button" disabled title={qaInvestor.disabledReason} data-testid={qaInvestor.testid}
          className={`${QA_BTN} text-gray-400 dark:text-gray-600 cursor-not-allowed`}
        >
          <Eye size={13} /> {qaInvestor.label}
        </button>

        <div className="ml-auto flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
          {[
            { v: 'multi', label: 'Multi-founder agreement', testid: 'tab-multi' },
            { v: 'solo', label: 'Solo-founder path', testid: 'tab-solo' },
          ].map((t) => (
            <button
              key={t.v} type="button" onClick={() => setPath(t.v)} data-testid={t.testid}
              className={`text-[11.5px] font-bold rounded-lg px-3 py-1.5 transition ${path === t.v ? 'bg-white dark:bg-gray-900 text-violet-600 dark:text-violet-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10.5px] text-gray-400 dark:text-gray-500 -mt-3">
        The path above is a view toggle only — Axal does not store an agreement-path choice.
      </p>

      {envUnavailable && (
        <div className={`${CARD} !p-3 flex items-center gap-3`} data-testid="banner-env-unavailable">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <p className="text-[12px] text-gray-600 dark:text-gray-300">
            Agreement generation isn't available in this environment. Your existing documents are unaffected.
          </p>
        </div>
      )}

      {!canEdit && (
        <div className={`${CARD} !p-3 flex items-center gap-3`} data-testid="banner-readonly">
          <Lock size={14} className="text-gray-400 dark:text-gray-500 shrink-0" />
          <p className="text-[12px] text-gray-600 dark:text-gray-300">{vm.permission.reason}</p>
        </div>
      )}

      {/* Write access granted by ROLE, not ownership. The startup shown was
          selected automatically, so say whose it is and require a deliberate
          confirmation before a document is written onto their project. */}
      {vm.permission.actingForOther && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-4" data-testid="banner-acting-for-other">
          <div className="flex items-start gap-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold text-amber-800 dark:text-amber-200">Not your startup record</div>
              <p className="text-[12px] text-amber-700 dark:text-amber-300 leading-snug mt-0.5">{vm.permission.actingForOtherText}</p>
              <label className="mt-2.5 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmedOther}
                  onChange={(e) => setConfirmedOther(e.target.checked)}
                  data-testid="checkbox-confirm-other"
                  className="w-3.5 h-3.5 accent-violet-600"
                />
                <span className="text-[11.5px] font-semibold text-amber-800 dark:text-amber-200">
                  I mean to draft and generate on this startup.
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {generated && (
        <div className={`${CARD} flex items-center gap-3`} data-testid="card-generated">
          <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{generated.title || 'Agreement generated'}</div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500">
              Stored in your startup's legal documents. Axal has no in-app signing flow for this document — the generated copy carries wet-ink signature blocks.
            </div>
          </div>
          <Link to="/legal-capital" className="text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline shrink-0 inline-flex items-center gap-1">
            Open Legal &amp; Capital <ExternalLink size={10} />
          </Link>
        </div>
      )}

      {path === 'solo' ? (
        <div className={CARD}>
          <SoloDeclaration solo={vm.solo} />
        </div>
      ) : (
        <>
          {/* Summary banner */}
          <div className={CARD} data-testid="card-summary">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                  <FileSignature size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                    Agreement path · Multi-founder
                  </div>
                  <div className="text-[14.5px] font-bold text-gray-900 dark:text-gray-50 mt-0.5 break-words">
                    {vm.foundersLabel} · {vm.statusLabel}
                  </div>
                  {vm.founders.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                      {vm.founders.map((f, i) => (
                        <span key={i} className="text-[10.5px] text-gray-400 dark:text-gray-500" data-testid={`founder-chip-${i}`}>
                          {f.name} · {f.equityLabel} · starts {f.startDate}
                          {f.matchedMember ? ' · on team record' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-5">
                <div className="text-center">
                  <div
                    className={`text-[20px] font-bold tabular-nums ${vm.unresolvedTone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}
                    data-testid="text-unresolved"
                  >
                    {vm.unresolvedCount}
                  </div>
                  <div className="text-[9.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{vm.unresolvedLabel}</div>
                </div>
                <div className="text-center">
                  <div className="text-[20px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-signed">
                    {vm.signedLabel}
                  </div>
                  <div className="text-[9.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{vm.signedSub}</div>
                </div>
                <button
                  type="button" onClick={scrollToExec} data-testid="button-open-exec"
                  className="text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3.5 py-2.5 whitespace-nowrap"
                >
                  Open execution console
                </button>
              </div>
            </div>
            {vm.blockerText && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-start gap-2" data-testid="text-blocker">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                <p className="text-[12px] text-amber-700 dark:text-amber-300 leading-snug">
                  <span className="font-bold">Blocker: </span>{vm.blockerText}
                </p>
              </div>
            )}
          </div>

          {/* Critical terms snapshot */}
          <div className={CARD}>
            <CriticalTermsSnapshot tiles={vm.snapshot} />
          </div>

          {vm.founders.length < 2 && (
            <div className={`${CARD} !p-3 flex items-center gap-3`} data-testid="banner-solo">
              <Users size={14} className="text-violet-500 shrink-0" />
              <p className="text-[12px] text-gray-600 dark:text-gray-300 flex-1">
                A co-founder agreement needs at least two named founders — there's no solo declaration document.
                Still searching? Use <Link to="/cofounder" className="text-violet-600 hover:underline">Co-founder Match</Link>.
              </p>
            </div>
          )}

          {/* Clause-by-clause builder */}
          <div className={CARD} data-testid="card-builder">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Clause-by-clause agreement builder</div>
                <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
                  Every clause below is written into the generated document. Each status names what it is derived from — nothing here records an approval.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button" onClick={() => setShowExplain((v) => !v)} data-testid="button-explain-toggle"
                  className="text-[11.5px] font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-900/50 rounded-lg px-2.5 py-1.5"
                >
                  {showExplain ? 'Hide plain-English' : 'Show plain-English'}
                </button>
                <button
                  type="button" onClick={toggleAll} data-testid="button-expand-all"
                  className="text-[11.5px] font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg px-2.5 py-1.5"
                >
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
            </div>

            {/* A generated document exists, so the builder is locked: without
                this the whole form stayed enabled while the Generate footer
                was hidden — every input typeable with no way to submit. */}
            {!showBuilder && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 mb-2" data-testid="banner-builder-locked">
                <Lock size={13} className="text-gray-400 dark:text-gray-500 shrink-0" />
                <p className="text-[11.5px] text-gray-600 dark:text-gray-300 flex-1 min-w-[200px]">
                  An agreement has already been generated, so these clauses are read-only. Start a new draft to change them — it does not alter the existing document.
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowBuilder(true)}
                    data-testid="button-new-version-inline"
                    className="text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1 shrink-0"
                  >
                    Draft a new version
                  </button>
                )}
              </div>
            )}

            <div>
              {vm.clauses.map((c) => {
                const Editor = c.editor ? EDITORS[c.editor] : null;
                return (
                  <ClauseRow
                    key={c.key}
                    clause={c}
                    open={openKeys.has(c.key)}
                    onToggle={() => toggleClause(c.key)}
                    showExplain={showExplain}
                  >
                    {Editor ? (
                      <Editor
                        draft={draft}
                        set={setD}
                        canEdit={canEdit && showBuilder}
                        {...(c.key === 'dispute' ? { explain: vm.dispute.explain, clauseSentence: vm.dispute.clauseSentence } : {})}
                      />
                    ) : (
                      <ReadOnlyClause>{READONLY_PROSE[c.key] || c.value}</ReadOnlyClause>
                    )}
                  </ClauseRow>
                );
              })}
            </div>

            {error && <div className="text-[12px] text-rose-600 dark:text-rose-400 mt-3" data-testid="text-error">{String(error)}</div>}

            {showBuilder && (
              <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 max-w-md">
                  Generates a real document on your startup — nothing above is stored until then, and the clause values shown above are exactly the ones sent.
                  {!canSubmit && submitBlockedReason && (
                    <span className="block text-rose-600 dark:text-rose-400 font-semibold mt-1" data-testid="text-generate-blocked">
                      {submitBlockedReason}
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={generate}
                  disabled={!canSubmit || busy}
                  data-testid="button-generate"
                  title={canSubmit ? undefined : (submitBlockedReason || 'Fill in the blocked clauses above first.')}
                  className="text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate agreement
                </button>
              </div>
            )}
          </div>

          {/* Roles + IP rider + dispute resolution (the design's 3 cards) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-5">
            <div className={CARD}>
              <RolesAndReservedMatters roles={vm.roles} reason={vm.raciReason} />
            </div>
            <div className="flex flex-col gap-5">
              <div className={CARD}>
                <IpRider items={vm.ipItems} note={vm.ipNote} />
              </div>
              <div className={CARD}>
                <DisputeCard
                  dispute={vm.dispute}
                  canEdit={canEdit && showBuilder}
                  disabledReason={canEdit ? 'An agreement has already been generated — start a new draft to change this.' : vm.permission.reason}
                  onSelect={(v) => setD({ deadlock: v })}
                />
              </div>
            </div>
          </div>

          {/* Execution console */}
          <div className={CARD}>
            <ExecutionConsole
              execution={vm.execution}
              canEdit={canEdit}
              showBuilder={showBuilder}
              onNewVersion={() => setShowBuilder(true)}
            />
          </div>
        </>
      )}
    </div>
  );
}
