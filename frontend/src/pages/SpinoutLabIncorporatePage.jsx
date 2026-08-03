// Spin-Out Lab — Incorporate (Week 4 tool page).
//
// Rebuilt to the Claude Design handoff (attached_assets/Incorporate.dc_*.html):
// a single persistent formation dashboard (NOT the /incorporate jurisdiction
// wizard, which stays a separate generic product) on REAL persisted data:
//   - Recommendation: computed from the project's actual profile —
//     funding_needed (equity-financed), founder count (owner + active project
//     members), sector keywords (deep-tech IP), and university-IP detection
//     from the project's own text fields.
//   - Payment: real incorporation orders (POST /legal/incorporation/order —
//     embedded Stripe in prod, auto-paid dev parity row in dev; existing paid
//     orders for this project are detected via GET /legal/incorporate/orders).
//   - Workspace state (`projects.incorporation_meta`, JSON — Worker D1
//     migration 159 / dev ensure): entity decision + override reason, paid
//     stamp + order id, per-document statuses, uni-IP checklist.
//   - Downstream outputs read the SAME shared milestone state the Cap Table
//     and Co-founder Agreement pages write (captable_locked /
//     cofounder_agreement_signed via /spinout-lab/state).
//
// Persistence: every mutation saves incorporation_meta through the project
// update route (serialized promise chain, same pattern as Use of Funds).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Landmark, Loader2, Lock, AlertTriangle, FileText, Share2,
  Download, Link2, Eye, Check, X, Shield, Info, PieChart, Handshake, Circle,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';
import AxalCheckout from '../components/AxalCheckout';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

// ---------------------------------------------------------------------------
// Entity catalog + recommendation model (computed from real project data)
// ---------------------------------------------------------------------------

export const ENTITIES = {
  ccorp: {
    name: 'Delaware C-Corp', short: 'Delaware C-Corp',
    fit: 'Standard structure for venture-scale, equity-financed startups. Expected by seed investors and required for SAFEs, priced rounds, and QSBS.',
    points: [
      ['Investor-standard · SAFEs and priced rounds', true],
      ['Enables option pool + QSBS eligibility', true],
      ['Double taxation until profitable', false],
    ],
  },
  pbc: {
    name: 'Public Benefit Corp', short: 'Delaware PBC',
    fit: 'A C-Corp variant that binds a public benefit into governance. Fits when mission is central to company identity and investor narrative.',
    points: [
      ['Mission locked into charter', true],
      ['Still venture-fundable (Delaware PBC)', true],
      ['Extra reporting; some investors cautious', false],
    ],
  },
  llc: {
    name: 'LLC', short: 'LLC',
    fit: 'Best for cash-flow, services, or studio businesses not raising venture equity. Simpler tax, but not suited to SAFEs or standard equity financing.',
    points: [
      ['Pass-through tax · simple admin', true],
      ['No option pool / QSBS', false],
      ['Investors will require conversion later', false],
    ],
  },
};

const DEEP_TECH = /\b(ai|ml|machine learning|deep[- ]?tech|robotic|biotech|quantum|semiconductor|hardware|climate|space|aero|photonic|material|synthetic bio|genomic|neuro)\b/i;
const UNI_IP = /\buniversit|institute of technology|\btu \w|research (lab|institute)|tech[- ]transfer|\bTTO\b|\bPhD\b|\bETH\b|\bMIT\b|spin[- ]?out from/i;

// Compute the recommendation from real project + team data. Exported for tests.
export function recommendEntity(project, memberCount) {
  const equity = Number(project?.funding_needed) > 0;
  const founders = Math.max(1, 1 + (memberCount || 0));
  const text = [project?.name, project?.description, project?.sector, project?.problem_statement, project?.solution, project?.why_now, project?.growth_signals]
    .filter(Boolean).join(' ');
  const deepTech = DEEP_TECH.test(text);
  const uniIp = deepTech && UNI_IP.test(text);
  const rec = equity ? 'ccorp' : 'llc';
  const confidence = equity && project?.sector ? 'High' : 'Medium';
  const factors = [
    equity ? 'Equity-financed' : 'Bootstrap-leaning',
    `${founders} founder${founders === 1 ? '' : 's'}`,
    ...(deepTech ? ['Deep-tech IP'] : []),
    ...(equity ? ['Raising a SAFE round'] : []),
    'US-based',
  ];
  const summary = equity
    ? `${project?.name || 'Your startup'} is a venture-scale, equity-financed${deepTech ? ' deep-tech' : ''} startup raising on SAFEs. A Delaware C-Corp is the investor-standard structure and a prerequisite for your current round.`
    : `${project?.name || 'Your startup'} has no recorded raise target${deepTech ? ' despite a deep-tech posture' : ''}. Without venture equity plans, an LLC keeps taxes simple — set a raise in Use of Funds if you plan to take investment, and the recommendation updates.`;
  return { rec, confidence, factors, summary, uniIp, founders, equity, deepTech };
}

const PHASES = ['deciding', 'paying', 'reviewing', 'filing', 'waiting', 'completed'];
const PHASE_LABELS = { deciding: 'Deciding', paying: 'Paying', reviewing: 'Reviewing', filing: 'Filing', waiting: 'Waiting', completed: 'Completed' };
const LC_LABELS = ['Decide', 'Pay', 'Review docs', 'File', 'Await approval', 'Complete'];

const PKG = { service: 1200, state: 110, expedite: 100 };
const PKG_TOTAL = PKG.service + PKG.state;

const DOCS = [
  { key: 'coi', name: 'Certificate of Incorporation', autogen: 'Auto-generated', source: 'Entity + founders', initial: 'ready' },
  { key: 'bylaws', name: 'Bylaws', autogen: 'Auto-generated', source: 'Standard DE template', initial: 'ready' },
  { key: 'incorporator', name: 'Incorporator statement', autogen: 'Auto-generated', source: 'Incorporator action', initial: 'ready' },
  { key: 'board', name: 'Initial board consent', autogen: 'Needs founder input', source: 'Board = founders', initial: 'review' },
  { key: 'ip', name: 'Founder IP assignment', autogen: 'Linked · Startups', source: 'Founder + entity', initial: 'sign' },
];

const DOC_PILL = {
  ready: ['Ready', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'],
  review: ['Needs review', 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'],
  sign: ['Needs signature', 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'],
  locked: ['Locked', 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'],
  done: ['Complete', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'],
};

const UNI_STEPS = [
  { key: 'confirm', title: 'Confirm IP origin', detail: 'Identify university-owned vs. independently developed IP' },
  { key: 'contact', title: 'Tech-transfer contact', detail: 'Open assignment/licensing discussion with the tech-transfer office' },
  { key: 'execute', title: 'Execute assignment', detail: 'Assign or license core IP to the new entity before docs sign' },
];
const UNI_PILL = {
  done: ['Done', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'],
  progress: ['In progress', 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'],
  todo: ['To do', 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'],
};

const fmt = (n) => `$${Number(n).toLocaleString()}`;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SpinoutLabIncorporatePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [memberCount, setMemberCount] = useState(0);
  const [order, setOrder] = useState(null); // matched real incorporation order

  const [meta, setMeta] = useState({});
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [docModal, setDocModal] = useState(null); // doc key being previewed
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [checkout, setCheckout] = useState(null); // {client_secret, amount_cents, currency, incorporation_id}

  const projectRef = useRef(null);
  const userRef = useRef(null);
  const metaRef = useRef({});
  const saveSeqRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state(), api.getMe(), api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st); setUser(me); userRef.current = me;
        const proj = pickLabProject(projects, me);
        setProject(proj || null); projectRef.current = proj || null;
        if (proj) {
          let initial = {};
          try { initial = proj.incorporation_meta ? JSON.parse(proj.incorporation_meta) : {}; } catch { initial = {}; }
          metaRef.current = initial;
          setMeta(initial);
          const [members, orders] = await Promise.all([
            api.listProjectMembers(proj.id).catch(() => null),
            api.legalIncorporationOrders().catch(() => null),
          ]);
          if (dead) return;
          const list = Array.isArray(members?.members) ? members.members : (Array.isArray(members) ? members : []);
          setMemberCount(list.filter((m) => (m.status || 'active') === 'active').length);
          const ords = Array.isArray(orders?.orders) ? orders.orders : (Array.isArray(orders) ? orders : []);
          const mine = ords.find((o) => Number(o.project_id) === Number(proj.id) && ['paid', 'packet_processing', 'packet_ready'].includes(o.status));
          if (mine) setOrder(mine);
        }
        setStatus('ready');
      } catch (e) {
        console.error('[spinout-inc]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));

  // ---- persistence (serialized, sequence-guarded — same pattern as UoF) ----
  const saveMeta = useCallback((next) => {
    metaRef.current = next;
    setMeta(next);
    const seq = ++saveSeqRef.current;
    const proj = projectRef.current;
    if (!proj) return Promise.resolve();
    setSaveState('saving');
    saveChainRef.current = saveChainRef.current.then(async () => {
      if (seq !== saveSeqRef.current) return;
      try {
        await api.updateProject(proj.id, { incorporation_meta: JSON.stringify(next) });
        if (seq !== saveSeqRef.current) return;
        setSaveState('saved'); setSaveError('');
      } catch (e) {
        if (seq !== saveSeqRef.current) return;
        console.error('[spinout-inc:save]', e);
        const detail = e?.data?.detail?.error || e?.data?.error || e?.message || 'Could not save.';
        setSaveState('error');
        setSaveError(typeof detail === 'string' ? detail : 'Could not save.');
      }
    });
    return saveChainRef.current;
  }, []);

  const patchMeta = (patch) => { if (canEdit) saveMeta({ ...meta, ...patch }); };

  // ---- derived model ----
  const rec = useMemo(() => recommendEntity(project, memberCount), [project, memberCount]);
  const selected = meta.entity && ENTITIES[meta.entity] ? meta.entity : rec.rec;
  const hasOverride = selected !== rec.rec;

  const paid = Boolean(meta.paid) || Boolean(order);
  const paidAt = meta.paid_at || order?.paid_at || null;

  const docStatus = (key, initial) => {
    if (!paid) return 'locked';
    const s = (meta.doc_status || {})[key];
    return s && DOC_PILL[s] ? s : initial;
  };
  const docs = DOCS.map((d) => ({ ...d, status: docStatus(d.key, d.initial) }));
  const docsAllDone = paid && docs.every((d) => ['ready', 'done'].includes(d.status));

  const orderStatus = order?.status || (meta.paid ? 'paid' : null);
  // Filing progress index: how many vertical steps are DONE.
  const filingDone = !paid ? 0 : orderStatus === 'packet_ready' ? 2 : orderStatus === 'packet_processing' ? 1 : docsAllDone ? 1 : 0;
  const filingSteps = [
    ['Documents prepared', 'Formation package generated and reviewed', 'Ready'],
    ['Submitted to Delaware', 'Filed with Secretary of State', 'Est. same day'],
    ['Processing', 'State review of Certificate', '1–3 business days'],
    ['Formation approved', 'Certificate stamped and returned', 'Est. 1 week'],
    ['EIN issued', 'IRS SS-4 processed after approval', 'After approval'],
  ].map(([title, detail, time], i) => ({
    title, detail, time,
    done: paid && i < filingDone,
    current: paid && i === filingDone,
  }));

  const phase = !paid ? 'deciding'
    : filingDone >= 5 ? 'completed'
      : filingDone >= 2 ? 'waiting'
        : docsAllDone ? 'filing'
          : 'reviewing';
  const phaseIdx = PHASES.indexOf(phase);

  const uniIpState = meta.uni_ip || {};
  const uniIpDone = rec.uniIp ? UNI_STEPS.every((s) => uniIpState[s.key] === 'done') : true;

  const milestoneKeys = useMemo(() => new Set((state?.milestones || []).map((m) => (typeof m === 'string' ? m : m.key || m.milestone_key)).filter(Boolean)), [state]);

  const entitySuffix = selected === 'llc' ? ', LLC' : ', Inc.';
  const legalName = `${project?.name || 'Your company'}${entitySuffix}`;

  // ---- actions ----
  const onPaid = async (incorporationId) => {
    setCheckout(null); setPayBusy(false);
    // Merge against the LATEST meta (ref), not the closure snapshot — the
    // user may have edited entity/docs while the payment was in flight.
    const cur = metaRef.current || {};
    await saveMeta({ ...cur, paid: true, paid_at: new Date().toISOString(), order_id: incorporationId ?? cur.order_id ?? null });
    markMilestone(userRef.current, 'incorporation_completed');
  };

  const pay = async () => {
    if (!canEdit || payBusy) return;
    setPayBusy(true); setPayError('');
    try {
      // Real order flow: embedded Stripe PaymentIntent in prod. The dev
      // FastAPI doesn't have the order route (Worker-only, Task #6), so fall
      // back to its checkout-parity flow: create the pending Incorporation
      // row, then simulate the paid webhook via dev-complete.
      // Jurisdiction catalog ids are entity-typed (us_de_ccorp / us_de_llc);
      // a PBC files as a Delaware corporation.
      const jurisdictionId = selected === 'llc' ? 'us_de_llc' : 'us_de_ccorp';
      const body = { project_id: project.id, jurisdiction_id: jurisdictionId, company_name: project.name };
      let res;
      try {
        res = await api.legalIncorporationOrder(body);
      } catch (err) {
        if (err?.status !== 404 && err?.status !== 405) throw err;
        const co = await api.legalIncorporateCheckout(body);
        if (co?.dev && co?.incorporation_id) {
          await api.legalIncorporateDevComplete(co.incorporation_id);
          await onPaid(co.incorporation_id);
          return;
        }
        if (co?.url) { window.location.assign(co.url); return; }
        throw err;
      }
      if (res?.client_secret) {
        setCheckout(res); setPayBusy(false);
      } else {
        await onPaid(res?.incorporation_id);
      }
    } catch (e) {
      console.error('[spinout-inc:pay]', e);
      const detail = e?.data?.detail?.error || e?.data?.detail || e?.data?.error || e?.message || 'Payment could not be started.';
      setPayError(typeof detail === 'string' ? detail : 'Payment could not be started.');
      setPayBusy(false);
    }
  };

  const selectEntity = (key) => {
    if (!canEdit) return;
    if (key === rec.rec) patchMeta({ entity: key, override_reason: null });
    else patchMeta({ entity: key });
  };

  const docAction = (d) => {
    if (d.status === 'locked') return;
    if (d.status === 'ready' || d.status === 'done') { setDocModal(d.key); return; }
    if (!canEdit) { setDocModal(d.key); return; }
    // Review → Ready; Sign → Complete (both persisted).
    const next = { ...(meta.doc_status || {}), [d.key]: d.status === 'review' ? 'ready' : 'done' };
    patchMeta({ doc_status: next, [`doc_${d.key}_at`]: new Date().toISOString() });
  };

  const cycleUniIp = (key) => {
    if (!canEdit) return;
    const cur = uniIpState[key] || 'todo';
    const next = cur === 'todo' ? 'progress' : cur === 'progress' ? 'done' : 'todo';
    patchMeta({ uni_ip: { ...uniIpState, [key]: next } });
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ }
  };

  const exportSummary = () => {
    const blob = new Blob([JSON.stringify({
      legal_entity: legalName, entity_type: ENTITIES[selected].name, state: 'Delaware',
      recommended: ENTITIES[rec.rec].name, overridden: hasOverride, override_reason: meta.override_reason || null,
      payment: paid ? { status: 'paid', paid_at: paidAt } : { status: 'awaiting_payment', total_usd: PKG_TOTAL },
      documents: docs.map((d) => ({ name: d.name, status: DOC_PILL[d.status][0] })),
      filing: filingSteps.map((f) => ({ step: f.title, done: f.done, current: f.current })),
      university_ip: rec.uniIp ? UNI_STEPS.map((s) => ({ step: s.title, status: uniIpState[s.key] || 'todo' })) : null,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(project?.name || 'formation').toLowerCase().replace(/\W+/g, '-')}-formation.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- gates ----
  if (status === 'loading') {
    return <div className="flex items-center justify-center min-h-[60vh]" data-testid="inc-loading"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>;
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="inc-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load Incorporate</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="inc-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Entity formation is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-violet-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!isAdmin && !(state?.unlocked_features || []).includes('incorporate')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="inc-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Incorporate unlocks in Week 4</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Finish your current week's deliverables to unlock entity formation.</p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="inc-no-project">
        <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">No startup record yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your startup in <Link to="/spinout-lab/startup" className="text-violet-600 hover:underline">Startups</Link> first — formation is driven by it.
        </p>
      </div>
    );
  }

  const week = Number(user?.spinout_lab_week) || state?.week || 4;

  const outputs = [
    {
      title: 'Cap Table', to: '/spinout-lab/captable', icon: PieChart,
      iconCls: 'bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
      detail: 'Entity + share structure seed founder stock issuance',
      status: milestoneKeys.has('captable_locked') ? ['Ready', DOC_PILL.ready[1]] : paid ? ['Pending', UNI_PILL.progress[1]] : ['After approval', DOC_PILL.locked[1]],
    },
    {
      title: 'Co-founder Agreement', to: '/spinout-lab/cofounder-agreement', icon: Handshake,
      iconCls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
      detail: 'Execution unlocks once entity governing law is set',
      status: milestoneKeys.has('cofounder_agreement_signed') ? ['Ready', DOC_PILL.ready[1]] : paid ? ['Pending', UNI_PILL.progress[1]] : ['After approval', DOC_PILL.locked[1]],
    },
  ];

  const dim = paid ? '' : 'opacity-60';

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-incorporate">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('/spinout-lab')} data-testid="button-back-workspace" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-violet-600 text-white inline-flex items-center justify-center"><Landmark size={14} /></span>
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Incorporate</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800" data-testid="phase-pill">{PHASE_LABELS[phase]}</span>
          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">Unlocked · Wk {week}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 -mt-2">
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400 flex-1 min-w-[200px]">
          Entity decisioning and formation — recommend, pay once, generate, file, and finish investor-ready.
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={copyLink} data-testid="button-share" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 hover:border-violet-400"><Share2 size={12} /> Share</button>
          <button type="button" onClick={exportSummary} data-testid="button-export" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 hover:border-violet-400"><Download size={12} /> Export</button>
          <button type="button" onClick={copyLink} data-testid="button-copy-link" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 hover:border-violet-400">
            {copied ? <Check size={12} className="text-emerald-500" /> : <Link2 size={12} />} {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" onClick={() => setPreviewOpen(true)} data-testid="button-investor-preview" className="inline-flex items-center gap-1 text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-2.5 py-1.5"><Eye size={12} /> Preview as investor</button>
        </div>
      </div>

      {saveState === 'error' && (
        <div className="text-[12px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 dark:bg-rose-900/30 dark:border-rose-800 dark:text-rose-300" data-testid="save-error">{saveError}</div>
      )}

      {/* Formation lifecycle */}
      <div className={`${CARD} p-5`} data-testid="lifecycle-card">
        <div className="flex items-center justify-between mb-3">
          <div className={LBL}>Formation lifecycle</div>
          <div className="text-[12px] text-gray-500 dark:text-gray-400">You are <b className="text-violet-600 dark:text-violet-400">{PHASE_LABELS[phase].toLowerCase()}</b></div>
        </div>
        <div className="flex items-center">
          {LC_LABELS.map((label, i) => {
            const done = i < phaseIdx; const current = i === phaseIdx;
            return (
              <div key={label} className="flex items-center flex-1 min-w-0 last:flex-none">
                <span className={`w-[26px] h-[26px] rounded-full flex-none inline-flex items-center justify-center text-[11px] font-bold ${done || current ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'} ${current ? 'ring-4 ring-violet-100 dark:ring-violet-900/40' : ''}`}>
                  {done ? <Check size={12} /> : i + 1}
                </span>
                {i < LC_LABELS.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${i < phaseIdx ? 'bg-violet-600' : 'bg-gray-100 dark:bg-gray-800'}`} />}
              </div>
            );
          })}
        </div>
        <div className="flex mt-2">
          {LC_LABELS.map((label, i) => (
            <div key={label} className={`flex-1 text-center text-[10.5px] font-semibold ${i <= phaseIdx ? 'text-violet-700 dark:text-violet-400' : 'text-gray-400 dark:text-gray-500'}`}>{label}</div>
          ))}
        </div>
      </div>

      {/* Recommendation + payment */}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr] items-stretch">
        <div className="rounded-2xl p-7 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#1a1030,#2d1a54)' }} data-testid="rec-banner">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-violet-300">Recommended entity</span>
            <span className="text-[10.5px] font-semibold text-lime-200 bg-lime-400/15 rounded-full px-2.5 py-0.5">{rec.confidence} confidence</span>
          </div>
          <div className="text-[30px] font-extrabold tracking-tight leading-tight" data-testid="rec-entity">{ENTITIES[rec.rec].name}</div>
          <div className="text-[13.5px] text-violet-100/80 mt-2 leading-relaxed max-w-[520px]">{rec.summary}</div>
          <div className="flex flex-wrap gap-2 mt-4">
            {rec.factors.map((f) => (
              <span key={f} className="text-[11px] font-semibold text-violet-50 bg-white/10 border border-white/15 rounded-full px-2.5 py-1">{f}</span>
            ))}
          </div>
          {rec.uniIp && !uniIpDone && (
            <div className="flex items-start gap-2 mt-4 bg-amber-400/10 border border-amber-300/30 rounded-xl px-3 py-2.5" data-testid="rec-warning">
              <AlertTriangle size={15} className="flex-none mt-0.5 text-amber-300" />
              <span className="text-[11.5px] text-amber-200 leading-snug">University-originated IP detected — resolve assignment with the tech-transfer office before signing formation documents.</span>
            </div>
          )}
        </div>

        <div className={`${CARD} p-5 flex flex-col`} data-testid="payment-card">
          <div className="flex items-center justify-between mb-1">
            <div className={LBL}>One-time incorporation package</div>
            <span className={`text-[10.5px] font-semibold rounded-full px-2.5 py-0.5 ${paid ? DOC_PILL.done[1] : UNI_PILL.progress[1]}`} data-testid="pay-status">{paid ? 'Paid' : 'Awaiting payment'}</span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-[32px] font-bold font-mono text-gray-900 dark:text-gray-50">{fmt(PKG_TOTAL)}</span>
            <span className="text-[12px] text-gray-400">one-time · USD</span>
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">{fmt(PKG.service)} service + {fmt(PKG.state)} state filing · agent included</div>
          <div className="flex flex-col gap-1.5 border-t border-gray-100 dark:border-gray-800 pt-3 flex-1 text-[12px]">
            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">Formation package (Axal service)</span><span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{fmt(PKG.service)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">Delaware state filing fee</span><span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{fmt(PKG.state)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-300">Registered agent · year 1</span><span className="font-mono font-semibold text-emerald-600">Included</span></div>
            <div className="flex justify-between text-gray-400"><span>Expedited 24h processing (add-on)</span><span className="font-mono">+{fmt(PKG.expedite)}</span></div>
          </div>
          {paid ? (
            <div className="flex items-center gap-2 mt-4 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 dark:bg-emerald-900/30 dark:border-emerald-800" data-testid="paid-box">
              <Check size={15} className="flex-none text-emerald-600" />
              <span className="text-[12px] text-emerald-800 dark:text-emerald-300">Paid {paidAt ? new Date(paidAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''} · workflow unlocked</span>
            </div>
          ) : (
            <>
              <button type="button" disabled={!canEdit || payBusy} onClick={pay} data-testid="button-pay" className="mt-4 text-[13.5px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl py-3 inline-flex items-center justify-center gap-2">
                {payBusy && <Loader2 size={14} className="animate-spin" />} Pay {fmt(PKG_TOTAL)} &amp; unlock filing
              </button>
              {payError && <div className="text-[11px] text-rose-600 text-center mt-2" data-testid="pay-error">{payError}</div>}
              <div className="text-[10.5px] text-gray-400 text-center mt-2">Payment unlocks document generation and filing. Not legal advice.</div>
            </>
          )}
        </div>
      </div>

      {/* Entity decision */}
      <div className={`${CARD} p-5`} data-testid="entity-card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <div className={LBL}>Entity decision · recommendation with override</div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">Auto-selected from your Spin-Out data. Override if your plans differ — we capture why.</div>
          </div>
          {hasOverride && <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800" data-testid="override-badge">Overridden · {ENTITIES[selected].short}</span>}
        </div>
        <div className="grid gap-3.5 md:grid-cols-3">
          {Object.entries(ENTITIES).map(([key, m]) => {
            const isSel = selected === key; const isRec = key === rec.rec;
            return (
              <button
                key={key} type="button" onClick={() => selectEntity(key)} disabled={!canEdit} data-testid={`entity-${key}`}
                className={`text-left rounded-xl border-[1.5px] p-4 relative transition ${isSel ? 'border-violet-600 bg-violet-50/40 dark:bg-violet-900/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'} ${canEdit ? 'cursor-pointer hover:border-violet-300' : 'cursor-default'}`}
              >
                {isRec && <span className="absolute top-3 right-3 text-[9.5px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 dark:bg-violet-900/40 rounded-full px-2 py-0.5">Recommended</span>}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-5 h-5 rounded-full border-2 inline-flex items-center justify-center ${isSel ? 'border-violet-600' : 'border-gray-300 dark:border-gray-600'}`}>
                    {isSel && <span className="w-2.5 h-2.5 rounded-full bg-violet-600" />}
                  </span>
                  <span className="text-[15px] font-bold text-gray-900 dark:text-gray-50">{m.name}</span>
                </div>
                <div className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed mb-3">{m.fit}</div>
                <div className="flex flex-col gap-1.5">
                  {m.points.map(([text, good]) => (
                    <div key={text} className="flex items-start gap-1.5 text-[11.5px] text-gray-700 dark:text-gray-300">
                      {good ? <Check size={13} className="flex-none mt-0.5 text-emerald-600" /> : <AlertTriangle size={13} className="flex-none mt-0.5 text-amber-500" />}
                      {text}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-start gap-2 mt-4 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 rounded-xl px-3.5 py-3" data-testid="rationale-box">
          <Info size={15} className="flex-none mt-0.5 text-violet-600" />
          <div className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed flex-1">
            {hasOverride ? (
              <>
                You overrode the recommendation. {ENTITIES[selected].name} changes your financing and equity setup — confirm this matches your fundraising intent before filing.
                <textarea
                  value={meta.override_reason || ''} disabled={!canEdit}
                  onChange={(e) => patchMeta({ override_reason: e.target.value.slice(0, 500) })}
                  placeholder="Why are you overriding? (captured for your record)"
                  data-testid="override-reason"
                  className="mt-2 w-full text-[12px] rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
                  rows={2}
                />
              </>
            ) : (
              <>Why not the others: an LLC blocks standard SAFEs/priced rounds and QSBS; a PBC is fundable but adds reporting and isn't needed unless public benefit is core to your identity. {rec.rec === 'ccorp' ? 'C-Corp keeps the round clean.' : 'With no raise recorded, an LLC keeps admin light.'}</>
            )}
          </div>
        </div>
      </div>

      {/* Document workspace */}
      <div className={`${CARD} p-5 ${dim}`} data-testid="docs-card">
        <div className="flex items-center justify-between mb-4">
          <div className={LBL}>Formation execution · document workspace</div>
          {!paid && <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400 rounded-full px-2.5 py-1">Unlocks after payment</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60 border-y border-gray-100 dark:border-gray-800 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="text-left px-4 py-2.5">Document</th>
                <th className="text-left px-4 py-2.5">Source data</th>
                <th className="text-center px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const [pillText, pillCls] = DOC_PILL[d.status];
                const btn = d.status === 'locked' ? 'Locked' : d.status === 'ready' ? 'Preview' : d.status === 'review' ? 'Review' : d.status === 'sign' ? 'Sign' : 'View';
                return (
                  <tr key={d.key} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{d.name}</div>
                      <div className="text-[11px] text-gray-400">{d.autogen}</div>
                    </td>
                    <td className={`px-4 py-3 text-[11.5px] ${paid ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`}>{d.source}</td>
                    <td className="px-4 py-3 text-center"><span className={`text-[10.5px] font-semibold rounded-full px-2.5 py-0.5 ${pillCls}`} data-testid={`doc-status-${d.key}`}>{pillText}</span></td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button" disabled={d.status === 'locked'} onClick={() => docAction(d)} data-testid={`doc-action-${d.key}`}
                        className={`text-[11.5px] font-semibold rounded-lg px-3 py-1.5 ${d.status === 'locked' ? 'text-gray-400 bg-gray-100 dark:bg-gray-800 cursor-default' : 'text-violet-700 bg-violet-50 border border-violet-200 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800'}`}
                      >{btn}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3.5 md:grid-cols-2 mt-4">
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-1.5"><Shield size={15} className="text-violet-600" /><span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">Registered agent</span></div>
            <div className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed">Included — Axal-managed agent in Delaware. $0 year 1, then $99/yr. Connected to filing readiness.</div>
          </div>
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-1.5"><FileText size={15} className="text-violet-600" /><span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">EIN application</span></div>
            <div className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed">SS-4 prefilled from formation data. Files after state approval. {paid ? 'SS-4 prefilled' : 'Prepares after payment'}.</div>
          </div>
        </div>
      </div>

      {/* State filing tracker */}
      <div className={`${CARD} p-5 ${dim}`} data-testid="filing-card">
        <div className={`${LBL} mb-4`}>State filing tracker</div>
        <div className="flex flex-col">
          {filingSteps.map((f, i) => (
            <div key={f.title} className="grid grid-cols-[26px_1fr_auto] gap-3.5 items-start pb-4">
              <div className="flex flex-col items-center">
                <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center ${f.done || f.current ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`} data-testid={`filing-dot-${i}`}>
                  {f.done ? <Check size={12} /> : f.current ? <span className="w-2 h-2 rounded-full bg-white" /> : null}
                </span>
                {i < filingSteps.length - 1 && <div className={`w-0.5 h-8 ${f.done ? 'bg-violet-600' : 'bg-gray-100 dark:bg-gray-800'}`} />}
              </div>
              <div className="pt-0.5">
                <div className={`text-[13px] font-semibold ${f.done || f.current ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{f.title}</div>
                <div className="text-[11.5px] text-gray-400 mt-0.5">{f.detail}</div>
              </div>
              <span className="text-[11px] text-gray-400 pt-1">{f.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* University IP — only when actually detected from project data */}
      {rec.uniIp && (
        <div className={`${CARD} p-5 !border-amber-200 dark:!border-amber-800`} data-testid="uni-ip-card">
          <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
            <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/40 inline-flex items-center justify-center"><AlertTriangle size={15} /></span>
            <div className="text-[14px] font-extrabold text-gray-900 dark:text-gray-50">Special handling · University IP assignment</div>
            <span className="ml-auto text-[10.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">Required before filing docs sign</span>
          </div>
          <div className="text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
            Detected from your startup's research affiliation and deep-tech IP posture. Resolve assignment or licensing with the tech-transfer office before executing formation documents, or founder stock may be encumbered.
          </div>
          <div className="flex flex-col gap-2">
            {UNI_STEPS.map((s) => {
              const st = uniIpState[s.key] || 'todo';
              const [pillText, pillCls] = UNI_PILL[st];
              return (
                <button key={s.key} type="button" onClick={() => cycleUniIp(s.key)} disabled={!canEdit} data-testid={`uni-ip-${s.key}`} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-xl text-left w-full">
                  {st === 'done' ? <Check size={16} className="flex-none text-emerald-600" /> : st === 'progress' ? <Circle size={16} className="flex-none text-amber-500" /> : <AlertTriangle size={16} className="flex-none text-gray-400" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">{s.title}</div>
                    <div className="text-[11px] text-gray-400">{s.detail}</div>
                  </div>
                  <span className={`text-[10.5px] font-semibold rounded-full px-2.5 py-0.5 ${pillCls}`}>{pillText}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Completion console */}
      <div className={`${CARD} p-5`} data-testid="outputs-card">
        <div className={`${LBL} mb-4`}>Completion console · downstream outputs</div>
        <div className="grid gap-3.5 md:grid-cols-2">
          {outputs.map((o) => (
            <Link key={o.title} to={o.to} className="flex items-center gap-3 border border-gray-100 dark:border-gray-800 rounded-xl px-4 py-3.5 hover:border-violet-300" data-testid={`output-${o.title === 'Cap Table' ? 'captable' : 'cofounder'}`}>
              <span className={`w-9 h-9 flex-none rounded-lg inline-flex items-center justify-center ${o.iconCls}`}><o.icon size={17} /></span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{o.title}</div>
                <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">{o.detail}</div>
              </div>
              <span className={`text-[10.5px] font-semibold rounded-full px-2.5 py-0.5 ${o.status[1]}`}>{o.status[0]}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Embedded Stripe checkout (prod client_secret path) */}
      {checkout && (
        <div className="fixed inset-0 z-[70] bg-gray-900/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-6" onClick={() => setCheckout(null)} data-testid="checkout-modal">
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] font-bold text-gray-900 dark:text-gray-50">Pay {fmt((checkout.amount_cents || PKG_TOTAL * 100) / 100)} · one-time incorporation</div>
              <button type="button" onClick={() => setCheckout(null)} className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 inline-flex items-center justify-center text-gray-500"><X size={14} /></button>
            </div>
            <AxalCheckout
              clientSecret={checkout.client_secret}
              submitLabel={`Pay ${fmt((checkout.amount_cents || PKG_TOTAL * 100) / 100)}`}
              onSuccess={() => onPaid(checkout.incorporation_id)}
            />
          </div>
        </div>
      )}

      {/* Document preview modal */}
      {docModal && (
        <div className="fixed inset-0 z-[70] bg-gray-900/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-6" onClick={() => setDocModal(null)} data-testid="doc-modal">
          <div className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="text-[14px] font-bold text-gray-900 dark:text-gray-50">{DOCS.find((d) => d.key === docModal)?.name}</div>
              <button type="button" onClick={() => setDocModal(null)} data-testid="doc-modal-close" className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 inline-flex items-center justify-center text-gray-500"><X size={14} /></button>
            </div>
            <div className="p-5 text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed space-y-3">
              <p><b>{legalName}</b> · {ENTITIES[selected].name} · State of Delaware.</p>
              <p>Prefilled from your Spin-Out data: {rec.founders} founder{rec.founders === 1 ? '' : 's'}, sector {project.sector || '—'}{project.funding_needed ? `, raising ${fmt(project.funding_needed)}` : ''}. The executed version is assembled into your filing packet after state submission.</p>
              <p className="text-[11px] text-gray-400">Source: {DOCS.find((d) => d.key === docModal)?.source}. Not legal advice.</p>
            </div>
          </div>
        </div>
      )}

      {/* Investor preview modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-[70] bg-gray-900/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-6" onClick={() => setPreviewOpen(false)} data-testid="investor-modal">
          <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2"><Eye size={15} className="text-violet-600" /><span className="text-[14px] font-bold text-gray-900 dark:text-gray-50">Investor preview · formation status</span></div>
              <button type="button" onClick={() => setPreviewOpen(false)} data-testid="investor-modal-close" className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 inline-flex items-center justify-center text-gray-500"><X size={14} /></button>
            </div>
            <div className="p-6">
              <div className="rounded-xl px-7 py-6 text-white mb-4" style={{ background: '#0d0d12' }}>
                <div className="text-[11px] font-bold uppercase tracking-wide text-violet-400">Legal entity</div>
                <div className="text-[24px] font-extrabold mt-1" data-testid="investor-entity-name">{legalName}</div>
                <div className="text-[13px] text-violet-100/70 mt-0.5">{ENTITIES[selected].name} · State of Delaware</div>
                <div className="flex flex-wrap gap-6 mt-4">
                  <div><div className="text-[11px] text-gray-400">Status</div><div className="text-[14px] font-mono font-semibold mt-0.5">{paid ? (filingDone >= 2 ? 'Filed' : 'Filing') : 'Pre-formation'}</div></div>
                  <div><div className="text-[11px] text-gray-400">EIN</div><div className="text-[14px] font-mono font-semibold mt-0.5">{paid ? 'Pending' : '—'}</div></div>
                  <div><div className="text-[11px] text-gray-400">Registered agent</div><div className="text-[14px] font-mono font-semibold mt-0.5">Axal (DE)</div></div>
                </div>
              </div>
              <div className="text-[11.5px] text-gray-400 leading-relaxed">
                This is the clean formation summary an investor sees in the data room — entity type, jurisdiction, filing status, registered agent, and EIN. Formation documents attach on approval.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
