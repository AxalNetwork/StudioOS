// Spin-Out Lab "Market Intel" tool page — TAM/SAM sizing + live market
// signal, per the design handoff (Market Intel .dc screenshots / repo
// spin-out-lab-pipeline/project). Every number is real:
//   - TAM / SAM / SOM come from the founder's project record (recalculated
//     here via the assumptions drawer — the Week-1 "Size your market"
//     deliverable) via PUT /projects/:id. Only tam/sam/som persist; the other
//     assumption fields are page-local session state until backend columns
//     exist (the drawer says so in plain words).
//   - Market dynamics / segments come from the platform Market-Intel
//     aggregator (sector compass + founder lens), matched to the project's
//     sector. Growth-outlook rows are founder assumptions, labeled as such.
//   - Sources & research log list the aggregator's actual data sources and
//     recent citations; founder-added sources are local-only and say
//     "not saved yet" (no backend endpoint exists for them).
//   - Competitors persist through the real Competitor Analysis API
//     (/competitors) — the same records the Competitor Analysis tool edits.
//   - Investor signals are the REAL anonymised fit matches from
//     /market-intel/fit/founder/:id (identity disclosure is NDA-gated
//     platform-wide, so names stay masked here — honestly, not decoratively).
// The positioning map's dot placement is a deterministic sketch hashed from
// competitor names (labeled illustrative on-page) — never presented as
// measured data. The design's fake investor Focus/Stage columns are NOT
// reproduced (the fit payload doesn't carry them).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Compass,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Pencil,
  ShieldCheck,
  X,
} from 'lucide-react';
import LabPageHeader, { labBtn, LAB_ICON_SIZE } from '../components/spinout/LabPageHeader';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import { pickLabProject } from './SpinoutLabStartupPage';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';
// Drawer / inline-form controls (design 1478-1536).
const FLD = 'block text-[11.5px] font-semibold text-gray-700 dark:text-gray-300 mb-1';
const INP = 'w-full h-[34px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 text-[12.5px] text-gray-900 dark:text-gray-50 placeholder-gray-400 dark:placeholder-gray-500';
const TXA = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2 text-[12.5px] text-gray-900 dark:text-gray-50 placeholder-gray-400 dark:placeholder-gray-500 resize-y';
// Toggle pills — selected #7c3aed on white (design 2195-2196).
const SEG_ON = 'bg-violet-600 border-violet-600 text-white';
const SEG_OFF = 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300';
const GHOST_SM = 'h-[26px] px-2.5 rounded-[7px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 text-[11px] font-semibold';

export function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e12) return `$${+(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(1)}B`;
  // 1 decimal below $10M so $2.4M doesn't flatten to $2M; values that would
  // round up to "1000K" promote to the M tier instead.
  if (n >= 1e6 || Math.round(n / 1e3) >= 1000) return `$${+(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  if (n >= 1e3) return `$${+(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

// Match the project's free-text sector to an aggregator sector row.
export function matchSectorRow(rows, sector) {
  if (!rows?.length) return null;
  const s = (sector || '').trim().toLowerCase();
  if (s) {
    // Containment only counts when the shorter side has ≥3 chars, so tiny
    // fragments ("ai") can't claim unrelated segments.
    const hit = rows.find((r) => {
      const rs = (r.sector || '').trim().toLowerCase();
      if (!rs) return false;
      const shorter = rs.length <= s.length ? rs : s;
      const longer = rs.length <= s.length ? s : rs;
      return shorter.length >= 3 && longer.includes(shorter);
    });
    if (hit) return { row: hit, exact: true };
  }
  const top = [...rows].sort((a, b) => (b.composite || 0) - (a.composite || 0))[0];
  return top ? { row: top, exact: false } : null;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const DIM_LABELS = {
  demand: 'Demand',
  supply: 'Supply',
  capital: 'Capital',
  talent: 'Talent',
  research: 'Research',
  sentiment: 'Sentiment',
};

// ---------------------------------------------------------------------------
// Assumptions (drawer) — page-local session state. Only TAM/SAM/SOM persist
// (PUT /projects/:id); the other fields need backend columns (or a
// project_market_assumptions table) that don't exist yet, so they seed from
// real project data where possible and otherwise start empty — never with
// invented market numbers.
// ---------------------------------------------------------------------------
function seedAssumptions(p) {
  const tam = Number(p?.tam) || 0;
  const sam = Number(p?.sam) || 0;
  const som = Number(p?.som) || 0;
  return {
    category: p?.sector || '',
    geography: 'Global',
    targetYear: '2026',
    methodology: 'Top-down',
    population: '',
    acv: '',
    tamOverride: '',
    // Real inversions of the calculator when the record already has values.
    samPct: tam > 0 && sam > 0 ? String(Math.round((sam / tam) * 100)) : '',
    winRate: sam > 0 && som > 0 ? String(Math.round(((som / sam) / 2.2) * 100)) : '',
    runway: '',
    capacity: '',
    cagr: '', // stays empty until the founder sets it — visuals fall back to the design's 24 default
    growthDriver: '',
    maturity: 'Growing',
    segFilter: [],
  };
}

// Competitor share / stage / display-category are persisted INSIDE the
// candidate's `summary` text column as a structured blob:
//   "mi1|<share>|<stage>|<display category>|<note>"
// because competitor_candidates has no dedicated columns for them and its
// `category` column is binary direct/adjacent (so "Indirect" wouldn't
// round-trip). Plain AI/manual summaries (no marker) pass through as the note.
const COMP_BLOB = 'mi1';
function encodeCompSummary({ share, stage, cat, note }) {
  return `${COMP_BLOB}|${share}|${stage}|${cat}|${note}`;
}
function parseCandidate(c) {
  const s = String(c.summary || '');
  const base = { key: c.id, id: c.id, name: c.name, persisted: true };
  if (s.startsWith(`${COMP_BLOB}|`)) {
    const p = s.split('|');
    return {
      ...base,
      share: p[1] || 'N/A',
      stage: p[2] || 'Unknown',
      cat: p[3] || (c.category === 'adjacent' ? 'Adjacent' : 'Direct'),
      note: p.slice(4).join('|') || '—',
    };
  }
  return { ...base, share: null, stage: null, cat: c.category === 'adjacent' ? 'Adjacent' : 'Direct', note: s || '—' };
}

const COMP_STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series F', 'Bootstrapped', 'Public', 'Unknown'];
const COMP_CAT_CHIP = {
  Direct: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  Indirect: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  Adjacent: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};
const SRC_TYPE_CHIP = {
  Report: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  Interview: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  Article: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  Manual: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};
const MATURITY_CHIP = {
  Early: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  Growing: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  Mature: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

// Positioning-map placement (design 2094-2096): a deterministic hash of the
// competitor name — an illustrative sketch, labeled as such on-page.
const POS_W = 220;
const POS_H = 140;
function posSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function posDot(name) {
  const h = posSeed(String(name || ''));
  return {
    x: 14 + ((h % 80) + (POS_W - 28 - 80) * (((h >> 4) % 100) / 100)),
    y: 14 + (((h >> 2) % 100) / 100) * (POS_H - 28),
  };
}

export default function SpinoutLabMarketPage() {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [project, setProject] = useState(null);
  const [compass, setCompass] = useState(null);
  const [lens, setLens] = useState(null);
  const [sources, setSources] = useState(null);
  const [citations, setCitations] = useState(null);
  const [fit, setFit] = useState(null);
  const [status, setStatus] = useState('loading');
  const [methodOpen, setMethodOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [shared, setShared] = useState(false);
  // Assumptions drawer (spec A) — session-local, see seedAssumptions().
  const [assume, setAssume] = useState(() => seedAssumptions(null));
  const [anim, setAnim] = useState(null); // {tam,sam,som} in dollars while the recalc tween runs
  const animRef = useRef(null);
  const finishRef = useRef({ tween: false, saved: false });
  // Readiness checklist flags with no backend signal — set when the founder
  // completes the action this session (spec F).
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [posDone, setPosDone] = useState(false);
  const [assumptionsReviewed, setAssumptionsReviewed] = useState(false);
  // Competitive landscape (spec B) — persisted via the Competitor Analysis API.
  const [compAnalysis, setCompAnalysis] = useState(null);
  const [localComps, setLocalComps] = useState([]); // fallback rows that failed to persist — labeled "not saved yet"
  const [compAdding, setCompAdding] = useState(false);
  const [compForm, setCompForm] = useState({ name: '', cat: 'Indirect', share: '', note: '', stage: 'Seed' });
  const [compBusy, setCompBusy] = useState(false);
  const [compError, setCompError] = useState('');
  // Founder-added sources (spec D) — local-only; no backend endpoint exists.
  const [founderSources, setFounderSources] = useState([]);
  const [srcAdding, setSrcAdding] = useState(false);
  const [srcForm, setSrcForm] = useState({ title: '', type: 'Report' });

  useEffect(() => () => clearInterval(animRef.current), []);

  // W1 deliverable "Export or share initial Market Intel research" — copies a
  // real research summary; the milestone fires only on this explicit action.
  const shareResearch = async () => {
    if (!project) return;
    const rows = Array.isArray(citations?.items) ? citations.items : Array.isArray(citations) ? citations : [];
    const lines = [
      `Market research — ${project.name || 'startup'}${project.sector ? ` (${project.sector})` : ''}`,
      project.tam != null ? `TAM: ${fmtMoney(project.tam)}` : null,
      project.sam != null ? `SAM: ${fmtMoney(project.sam)}` : null,
      project.som != null ? `SOM: ${fmtMoney(project.som)}` : null,
      rows.length ? `\nSources (${rows.length}):` : null,
      ...rows.slice(0, 8).map((c) => `- ${c.title || c.source || c.url || 'source'}${c.url ? ` — ${c.url}` : ''}`),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setShared(true);
      setTimeout(() => setShared(false), 2000);
      await markMilestone(user, 'market_research_shared');
    } catch (e) {
      reportError('SpinoutLabMarketPage:share', e);
    }
  };

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    Promise.all([spinoutLab.state(), api.listProjects().catch(() => [])])
      .then(async ([s, projects]) => {
        if (!alive) return;
        setState(s);
        const p = pickLabProject(projects, user);
        setProject(p);
        const [cp, fl, src, cit, ft, comp] = await Promise.all([
          api.miSectorCompass().catch(() => null),
          api.miFounderLens().catch(() => null),
          api.miSources().catch(() => null),
          p?.sector ? api.miCitations(p.sector, 8).catch(() => null) : Promise.resolve(null),
          p ? api.miFitFounder(p.id).catch(() => ({ unavailable: true })) : Promise.resolve(null),
          // Reuse an existing Competitor Analysis for this startup, if any —
          // list() is sorted by updated_at DESC so the first hit is freshest.
          p
            ? api.competitors
                .list()
                .then((l) => {
                  const hit = (l?.analyses || []).find((a) => Number(a.project_id) === Number(p.id));
                  return hit ? api.competitors.get(hit.id) : null;
                })
                .catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        setCompass(cp);
        setLens(fl);
        setSources(src);
        setCitations(cit);
        setFit(ft);
        setCompAnalysis(comp);
        setAssume(seedAssumptions(p));
        setStatus('ready');
      })
      .catch((e) => {
        if (!alive) return;
        reportError('SpinoutLabMarketPage:load', e);
        setStatus('error');
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = () => {
    setSaveError('');
    setEditOpen(true);
  };

  const setA = (k) => (e) => setAssume((a) => ({ ...a, [k]: e.target.value }));
  const setAV = (k, v) => setAssume((a) => ({ ...a, [k]: v }));
  const toggleSeg = (name) =>
    setAssume((a) => {
      const cur = a.segFilter || [];
      return { ...a, segFilter: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name] };
    });

  // 800ms ease-out cubic counter tween on the TAM/SAM/SOM cards (design
  // animateMarketTo, 1581-1595) — ~16ms ticks, e = 1-(1-p)^3.
  const tweenTo = (to) => {
    clearInterval(animRef.current);
    const from = {
      tam: (anim ? anim.tam : Number(project?.tam)) || 0,
      sam: (anim ? anim.sam : Number(project?.sam)) || 0,
      som: (anim ? anim.som : Number(project?.som)) || 0,
    };
    const t0 = Date.now();
    const dur = 800;
    animRef.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setAnim({
        tam: from.tam + (to.tam - from.tam) * e,
        sam: from.sam + (to.sam - from.sam) * e,
        som: from.som + (to.som - from.som) * e,
      });
      if (p === 1) {
        clearInterval(animRef.current);
        finishRef.current.tween = true;
        // Hand display back to the saved record only once the PUT landed.
        if (finishRef.current.saved) setAnim(null);
      }
    }, 16);
  };

  // "Recalculate market sizing" — the design's math (1596-1605), then the
  // existing persistence flow: PUT /projects/:id {tam,sam,som} + the
  // market_sizing_completed milestone. Only those three fields are saved.
  const recalcMarket = async () => {
    if (!project) return;
    const f = assume;
    const pop = parseFloat(f.population) || 0;
    const acv = parseFloat(f.acv) || 0;
    const tamCalc = (pop * acv) / 1e6; // $M
    const curM = Number(project.tam) > 0 ? Number(project.tam) / 1e6 : 0;
    const tamM = parseFloat(f.tamOverride) || tamCalc || curM;
    const samM = tamM * ((parseFloat(f.samPct) || 14) / 100);
    const somM = samM * ((parseFloat(f.winRate) || 8) / 100) * 2.2;
    if (!(tamM > 0)) {
      setSaveError('Add an addressable population × ACV (or a TAM override) so there is something to calculate.');
      return;
    }
    if ([tamM, samM, somM].some((v) => !Number.isFinite(v) || v < 0)) {
      setSaveError('Assumptions must be positive numbers.');
      return;
    }
    const tam = Math.round(tamM * 1e6);
    const sam = Math.round(samM * 1e6);
    const som = Math.round(somM * 1e6);
    if (sam > tam) {
      setSaveError('SAM should not exceed TAM — it is the serviceable slice of it.');
      return;
    }
    if (som > sam) {
      setSaveError('SOM should not exceed SAM — it is the obtainable slice of it.');
      return;
    }
    setSaving(true);
    setSaveError('');
    finishRef.current = { tween: false, saved: false };
    tweenTo({ tam, sam, som });
    try {
      const updated = await api.updateProject(project.id, { tam, sam, som });
      setProject((prev) => ({ ...prev, ...updated }));
      // W1 deliverable — sizing counts once both TAM and SAM are on record
      // (citations aggregate automatically from MI sources for the sector).
      if (tam != null && sam != null) await markMilestone(user, 'market_sizing_completed');
      finishRef.current.saved = true;
      if (finishRef.current.tween) setAnim(null);
      setAssumptionsReviewed(true);
      setEditOpen(false);
    } catch (e) {
      reportError('SpinoutLabMarketPage:save', e);
      clearInterval(animRef.current);
      setAnim(null); // revert the cards to the saved record
      setSaveError("Couldn't save your sizing. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // ---- Competitors (spec B) ----
  const confirmAddComp = async () => {
    const f = compForm;
    const name = f.name.trim();
    if (!name) {
      // Design behavior: empty name cancels silently.
      setCompAdding(false);
      return;
    }
    const share = f.share.trim() ? (f.share.trim().endsWith('%') ? f.share.trim() : `${f.share.trim()}%`) : 'N/A';
    const note = f.note.trim() || '—';
    const summary = encodeCompSummary({ share, stage: f.stage, cat: f.cat, note });
    setCompBusy(true);
    setCompError('');
    try {
      let analysis = compAnalysis;
      if (!analysis) {
        // First competitor: bootstrap an analysis record for this startup —
        // same flow the Competitor Analysis page uses (may take a while on
        // first run; it also discovers real candidates of its own).
        analysis = await api.competitors.analyze({
          project_id: project.id,
          mode: 'startup',
          depth: 'quick',
          title: `${project.name || 'Startup'} · Market Intel`,
        });
      }
      const full = await api.competitors.addCandidate(analysis.id, {
        // Backend category column is binary: Adjacent maps to 'adjacent',
        // Direct AND Indirect map to 'direct' — the display category
        // round-trips via the summary blob (see encodeCompSummary).
        name,
        category: f.cat === 'Adjacent' ? 'adjacent' : 'direct',
        summary,
        crawl: false,
      });
      setCompAnalysis(full);
      setCompForm({ name: '', cat: 'Indirect', share: '', note: '', stage: 'Seed' });
      setCompAdding(false);
    } catch (e) {
      reportError('SpinoutLabMarketPage:comp-add', e);
      // Honest fallback: keep the row on-page, clearly labeled unsaved.
      setLocalComps((prev) => [...prev, { key: `local-${Date.now()}`, name, cat: f.cat, share, stage: f.stage, note, local: true }]);
      setCompError("Couldn't save to your competitor analysis — the row below is kept on this page only.");
      setCompForm({ name: '', cat: 'Indirect', share: '', note: '', stage: 'Seed' });
      setCompAdding(false);
    } finally {
      setCompBusy(false);
    }
  };

  const removeComp = async (row) => {
    if (row.local) {
      setLocalComps((prev) => prev.filter((r) => r.key !== row.key));
      return;
    }
    if (!compAnalysis) return;
    try {
      const full = await api.competitors.removeCandidate(compAnalysis.id, row.id);
      setCompAnalysis(full);
    } catch (e) {
      reportError('SpinoutLabMarketPage:comp-remove', e);
      setCompError("Couldn't remove that competitor. Try again.");
    }
  };

  // ---- Sources (spec D) ----
  const confirmAddSource = () => {
    const title = srcForm.title.trim();
    if (!title) {
      // Design behavior: empty title cancels silently.
      setSrcAdding(false);
      return;
    }
    setFounderSources((prev) => [
      ...prev,
      { title, type: srcForm.type, date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) },
    ]);
    setSrcForm({ title: '', type: 'Report' });
    setSrcAdding(false);
  };

  const derived = useMemo(() => {
    const sectorMatch = matchSectorRow(compass?.sectors, project?.sector);
    const picks = (lens?.picks || []).slice(0, 3);
    const srcRows = sources?.sources || [];
    const liveCount = srcRows.filter((s) => s.live).length;
    const citRows = citations?.rows || [];
    const matches = (fit?.matches || []).slice(0, 6);
    const fitUnavailable = Boolean(fit?.unavailable);
    return { sectorMatch, picks, srcRows, liveCount, citRows, matches, fitUnavailable };
  }, [compass, lens, sources, citations, fit, project]);

  const compRows = useMemo(
    () => [...(compAnalysis?.candidates || []).map(parseCandidate), ...localComps],
    [compAnalysis, localComps],
  );

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24" data-testid="market-loading">
        <Loader2 className="animate-spin text-violet-600 dark:text-violet-400" size={28} />
      </div>
    );
  }

  if (status === 'error' || !state) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="market-error">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Couldn&rsquo;t load Market Intel</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Check your connection and try again.</p>
        <button type="button" data-testid="button-retry-market" onClick={() => window.location.reload()} className="h-10 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          Retry
        </button>
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';
  if (!state.active && !state.is_incorporated && !isAdmin) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="market-inactive">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Spin-Out Lab isn&rsquo;t active on this account</div>
        <Link to="/spinout-lab" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold mt-3">
          Go to Spin-Out Lab
        </Link>
      </div>
    );
  }

  const week = state.is_incorporated ? 4 : Math.min(4, Math.max(1, Number(state.week) || 1));
  const deckUnlocked = state.is_incorporated || week >= 2;
  const advisorsUnlocked = state.is_incorporated || week >= 3;
  const { sectorMatch, picks, srcRows, liveCount, citRows, matches, fitUnavailable } = derived;
  // Cards read the tween values while the recalc animation runs.
  const tamTxt = fmtMoney(anim ? anim.tam : project?.tam);
  const samTxt = fmtMoney(anim ? anim.sam : project?.sam);
  const somTxt = fmtMoney(anim ? anim.som : project?.som);
  const samPct = project?.tam && project?.sam ? Math.round((project.sam / project.tam) * 100) : null;
  const somPct = project?.sam && project?.som ? Math.round((project.som / project.sam) * 100) : null;

  // ---- Readiness checklist (spec F, design 2181-2192) ----
  const checklist = [
    { label: 'TAM defined', done: Number(project?.tam) > 0 },
    { label: 'SAM defined', done: Number(project?.sam) > 0 },
    { label: 'SOM defined', done: Number(project?.som) > 0 },
    { label: 'Sources added (min 2)', done: citRows.length + founderSources.length >= 2 },
    { label: 'Market growth rate added', done: Boolean(assume.cagr) },
    { label: 'Competitive landscape (min 3 competitors)', done: compRows.length >= 3 },
    { label: 'Positioning map completed', done: posDone },
    { label: 'Founder assumptions reviewed', done: assumptionsReviewed },
    { label: 'Investor signals reviewed (Week 3)', done: advisorsUnlocked && matches.length > 0 },
  ];
  const readinessPct = Math.round((100 * checklist.filter((c) => c.done).length) / checklist.length);
  const readinessRemaining = Math.max(0, Math.ceil((0.7 - readinessPct / 100) * checklist.length));
  const readinessCls =
    readinessPct >= 70
      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
      : readinessPct >= 40
        ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
        : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300';

  // ---- Growth outlook (spec E, design 2077-2088) — founder assumptions ----
  // Design fallback: parseFloat(cagr)||24; the pill says "(default)" until the
  // founder actually sets a rate, so the fallback never masquerades as data.
  const cagrPct = parseFloat(assume.cagr) || 24;
  const sparkTamM = ((anim ? anim.tam : Number(project?.tam)) || 0) / 1e6;
  let spark = null;
  if (sparkTamM > 0) {
    const pts = [0, 1, 2, 3, 4].map((i) => sparkTamM * Math.pow(1 + cagrPct / 100, i - 2));
    const max = Math.max(...pts);
    const min = Math.min(...pts);
    const pad = 6;
    const xy = pts.map((v, i) => [pad + i * ((220 - pad * 2) / 4), 48 - pad - ((v - min) / (max - min || 1)) * (48 - pad * 2)]);
    spark = {
      path: xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),
      dot: xy[2],
    };
  }

  const compShown = compRows.slice(0, 6); // design caps the grid at 6
  const youDot = { x: POS_W * 0.72, y: POS_H * 0.28 };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-market">
      {/* Header — brand rule, back control inline with the title, and the tool
          icon in its violet tile (design handoff). */}
      <LabPageHeader
        className="mb-5"
        icon={Compass}
        title="Market Intel"
        subtitle="TAM / SAM research and sizing — your Week 1 market deliverable."
        status="Active"
        titleExtra={project ? (
          <span className="relative">
            <button
              type="button"
              data-testid="market-readiness-pill"
              onClick={() => setChecklistOpen((v) => !v)}
              className={`text-[10.5px] font-bold rounded-full px-2.5 py-1 ${readinessCls}`}
            >
              Market Intel {readinessPct}% complete
            </button>
            {checklistOpen && (
              <div
                data-testid="market-checklist-popover"
                onClick={(e) => e.stopPropagation()}
                className="absolute top-[26px] left-0 z-40 w-[280px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[14px] shadow-[0_20px_50px_-12px_rgba(24,24,27,.3)] p-4 text-left"
              >
                <div className="text-[13px] font-extrabold text-gray-900 dark:text-gray-50 mb-2.5">Market Intel Checklist</div>
                <div className="flex flex-col gap-[7px] mb-3">
                  {checklist.map((c) => (
                    <div key={c.label} className="flex items-center gap-2">
                      {c.done ? (
                        <span className="w-3.5 h-3.5 flex-none rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                          <Check size={9} strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="w-3.5 h-3.5 flex-none rounded-full border-[1.5px] border-gray-200 dark:border-gray-700" />
                      )}
                      <span className="text-[11.5px] text-gray-700 dark:text-gray-300">{c.label}</span>
                    </div>
                  ))}
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-2">
                  <div className="h-full rounded-full bg-violet-600" style={{ width: `${readinessPct}%` }} />
                </div>
                <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2.5">Investor-ready threshold: 70%. You need {readinessRemaining} more item(s).</div>
                <button type="button" onClick={() => setChecklistOpen(false)} className="w-full h-8 rounded-[9px] bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold">
                  Continue →
                </button>
              </div>
            )}
          </span>
        ) : null}
        actions={project ? (
          <>
            <button type="button" data-testid="button-share-research" onClick={shareResearch} className={labBtn('accent')}>
              {shared ? 'Copied' : 'Copy research summary'}
            </button>
            <button type="button" data-testid="button-edit-sizing" onClick={openEdit} className={labBtn('primary')}>
              <Pencil size={LAB_ICON_SIZE} /> Edit Market Data
            </button>
          </>
        ) : null}
      />

      {/* Design's Week-2 notice (611-614) — informational only: StudioOS
          deliberately keeps this page editable in Week 2 (founders iterate
          sizing all program long), so nothing below is actually disabled. */}
      {week === 2 && (
        <div data-testid="market-week2-banner" className="flex items-center gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 rounded-[11px] px-4 py-3 mb-5">
          <Lock size={15} className="text-amber-700 dark:text-amber-400 flex-none" />
          <span className="text-[12.5px] font-medium text-amber-800 dark:text-amber-200">Read-only during Week 2. Full investor signals unlock in Week 3.</span>
        </div>
      )}

      {!project ? (
        <div className={`${CARD} text-center py-10`} data-testid="market-no-project">
          <div className="text-base font-bold text-gray-900 dark:text-gray-50">Create your startup record first</div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">Market sizing attaches to your company record.</p>
          <Link to="/projects" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
            Create your startup record
          </Link>
        </div>
      ) : (
        <>
          {/* TAM / SAM / SOM */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-4">
            <div className={CARD} data-testid="card-tam">
              <div className={LBL}>TAM</div>
              {tamTxt ? (
                <>
                  <div className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 mt-1">{tamTxt}</div>
                  <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">{project.sector ? `${project.sector}, total addressable` : 'Total addressable market'}</div>
                  <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1">Founder research · {project.name}</div>
                </>
              ) : (
                <button type="button" onClick={openEdit} data-testid="button-add-tam" className="block text-left mt-1">
                  <div className="text-2xl font-extrabold tracking-tight text-gray-300 dark:text-gray-600">—</div>
                  <div className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 mt-0.5">Add your TAM →</div>
                </button>
              )}
            </div>
            <div className={CARD} data-testid="card-sam">
              <div className={LBL}>SAM</div>
              {samTxt ? (
                <>
                  <div className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 mt-1">{samTxt}</div>
                  <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">Serviceable segment{samPct != null ? ` · ${samPct}% of TAM` : ''}</div>
                  <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1">Founder research · {project.name}</div>
                </>
              ) : (
                <button type="button" onClick={openEdit} data-testid="button-add-sam" className="block text-left mt-1">
                  <div className="text-2xl font-extrabold tracking-tight text-gray-300 dark:text-gray-600">—</div>
                  <div className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 mt-0.5">Add your SAM →</div>
                </button>
              )}
            </div>
            <div className={CARD} data-testid="card-som">
              <div className={LBL}>SOM</div>
              {somTxt ? (
                <>
                  <div className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 mt-1">{somTxt}</div>
                  <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">Obtainable share{somPct != null ? ` · ${somPct}% of SAM` : ''}</div>
                  <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1">Founder model · {project.name}</div>
                </>
              ) : (
                <button type="button" onClick={openEdit} data-testid="button-add-som" className="block text-left mt-1">
                  <div className="text-2xl font-extrabold tracking-tight text-gray-300 dark:text-gray-600">—</div>
                  <div className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 mt-0.5">Add your SOM →</div>
                </button>
              )}
            </div>
          </div>

          {/* Methodology (spec H) — 3 method cards + caveat + drawer CTA */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm mb-5" data-testid="market-methodology">
            <button
              type="button"
              data-testid="button-toggle-methodology"
              onClick={() => setMethodOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left"
            >
              <span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">How this market is sized</span>
              <ChevronDown size={15} className={`text-gray-400 transition-transform ${methodOpen ? 'rotate-180' : ''}`} />
            </button>
            {methodOpen && (
              <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-3" data-testid="methodology-body">
                <div className="flex flex-col gap-2.5 mt-3.5">
                  {[
                    {
                      tag: 'TAM',
                      method: 'Top-down',
                      desc: 'Addressable population × average contract value — or your direct override.',
                      why: 'Saved on your startup record; the deck’s Market slide cites it.',
                    },
                    {
                      tag: 'SAM',
                      method: 'Segmented top-down',
                      desc: 'TAM filtered to the share you can actually reach (% reachable × segment focus).',
                      why: samPct != null ? `${samPct}% of TAM on your record.` : 'Set % reachable in the assumptions drawer.',
                    },
                    {
                      tag: 'SOM',
                      method: 'Bottom-up',
                      desc: 'Reachable share × win rate, modeled on sales capacity.',
                      why: somPct != null ? `${somPct}% of SAM on your record.` : 'Set win rate in the assumptions drawer.',
                    },
                  ].map((m) => (
                    <div key={m.tag} className="px-3.5 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 rounded-md px-[7px] py-0.5">{m.tag}</span>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{m.method}</span>
                      </div>
                      <div className="text-[12.5px] text-gray-800 dark:text-gray-100 mt-1.5">{m.desc}</div>
                      <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{m.why}</div>
                    </div>
                  ))}
                </div>
                {/* Design says "AI-assisted estimates" — these figures are
                    founder-entered/derived, not AI output, so the copy drops
                    that claim rather than lie about provenance. */}
                <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 rounded-[11px] px-3.5 py-2.5">
                  <Lock size={13} className="text-amber-700 dark:text-amber-400 flex-none mt-0.5" />
                  <span className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">These figures are estimates based on your inputs. Validate with primary research before presenting to investors.</span>
                </div>
                <div>
                  <button type="button" data-testid="button-update-assumptions" onClick={openEdit} className="h-[34px] px-3.5 rounded-[9px] border border-violet-200 dark:border-violet-800 bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 text-[12.5px] font-semibold">
                    Update assumptions →
                  </button>
                  <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">Nothing on this page is auto-invented — empty means not researched yet.</div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start mb-5">
            {/* Segment picks */}
            <div className={CARD} data-testid="market-segments">
              <div className={`${LBL} mb-1`}>Segment signal · founder lens</div>
              <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3.5">The aggregator&rsquo;s strongest founder-opportunity segments this period.</p>
              {picks.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">No segment data this period.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {picks.map((p) => {
                    const mine = sectorMatch?.exact && sectorMatch.row.sector === p.sector;
                    return (
                      <div key={p.sector}>
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">{p.sector}</span>
                          {mine && <span className="text-[9.5px] font-bold rounded-full px-1.5 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">Your sector</span>}
                          <span className="ml-auto text-[11.5px] font-bold text-gray-700 dark:text-gray-200">{Math.round(p.composite)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mt-1.5 overflow-hidden">
                          <div className="h-full rounded-full bg-violet-600" style={{ width: `${Math.min(100, Math.round(p.composite))}%` }} />
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                          Demand {Math.round(p.demand)} · Supply {Math.round(p.supply)} · Gap {Math.round(p.opportunity_gap)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Market dynamics — founder growth assumptions + sector compass */}
            <div className={CARD} data-testid="market-dynamics">
              <div className={`${LBL} mb-1`}>Market dynamics{sectorMatch ? ` · ${sectorMatch.row.sector}` : ''}</div>
              <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3.5">
                {sectorMatch?.exact
                  ? 'Live signal for your sector from the platform aggregator.'
                  : sectorMatch
                    ? `No aggregator segment matches “${project.sector || 'your sector'}” — showing the current leader.`
                    : 'Live sector signal from the platform aggregator.'}
              </p>
              {/* Growth outlook (spec E) — drawer-fed founder assumptions,
                  local-only until backend columns exist. */}
              <div className="mb-3.5" data-testid="market-growth-outlook">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Growth outlook · founder assumptions</span>
                  <button type="button" onClick={openEdit} className="text-[10.5px] font-semibold text-violet-700 dark:text-violet-300">Edit →</button>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">CAGR</span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-bold rounded-full px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                      ↑ {cagrPct}%/yr{assume.cagr ? '' : ' (default)'}
                    </span>
                  </div>
                  {/* Peak window + tailwind have no drawer/backend field yet —
                      rendered as an honest em dash, never invented. */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Peak growth window</span>
                    <span className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">—</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Key growth driver</span>
                    <div className="text-xs text-gray-800 dark:text-gray-100 mt-0.5 leading-snug">{assume.growthDriver.trim() || '—'}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Market maturity</span>
                    <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${MATURITY_CHIP[assume.maturity] || MATURITY_CHIP.Mature}`}>{assume.maturity}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Tailwind moment</span>
                    <span className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">—</span>
                  </div>
                </div>
                {spark && (
                  <svg viewBox="0 0 220 48" className="w-full h-11 mt-2.5" data-testid="market-cagr-sparkline">
                    <path d={spark.path} fill="none" strokeWidth="2" className="stroke-violet-300 dark:stroke-violet-700" />
                    <circle cx={spark.dot[0].toFixed(1)} cy={spark.dot[1].toFixed(1)} r="3.5" className="fill-violet-600 dark:fill-violet-400" />
                  </svg>
                )}
              </div>
              {!sectorMatch ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center border-t border-gray-100 dark:border-gray-800">No sector signal available this period.</p>
              ) : (
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">{Math.round(sectorMatch.row.composite)}</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">composite / 100</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {Object.entries(sectorMatch.row.dimensions || {}).map(([k, d]) => (
                      <div key={k} className="flex items-center gap-2.5">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 w-[70px] flex-none">{DIM_LABELS[k] || k}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, Math.round(d.value))}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 w-8 text-right">{Math.round(d.value)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-3">Source: platform market-intel aggregator · updated {shortDate(compass?.computed_at) || 'this period'}</div>
                </div>
              )}
            </div>

            {/* Sources & research log (spec D) */}
            <div className={CARD} data-testid="market-sources">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className={LBL}>Sources &amp; research log</div>
                <button type="button" data-testid="button-add-source" onClick={() => setSrcAdding(true)} className={GHOST_SM}>
                  + Add source
                </button>
              </div>
              <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3">{srcRows.length} aggregator sources · {liveCount} live feeds</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {srcRows.map((s) => (
                  <span key={s.key} className={`text-[10.5px] font-semibold rounded-md px-2 py-1 ${s.live ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                    {s.display_name}{s.live ? ' · live' : ''}
                  </span>
                ))}
              </div>
              {srcAdding && (
                <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-[11px] flex flex-col gap-2" data-testid="form-add-source">
                  <input
                    type="text"
                    data-testid="input-source-title"
                    placeholder="Source title or URL"
                    value={srcForm.title}
                    onChange={(e) => setSrcForm((f) => ({ ...f, title: e.target.value }))}
                    className={`${INP} h-8 text-xs`}
                  />
                  <select
                    data-testid="select-source-type"
                    value={srcForm.type}
                    onChange={(e) => setSrcForm((f) => ({ ...f, type: e.target.value }))}
                    className={`${INP} h-8 text-xs`}
                  >
                    <option value="Report">Report</option>
                    <option value="Interview">Interview</option>
                    <option value="Article">Article</option>
                    <option value="Manual">Manual entry</option>
                  </select>
                  <div className="flex gap-2">
                    <button type="button" data-testid="button-confirm-source" onClick={confirmAddSource} className="h-[30px] px-3 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold">
                      Add
                    </button>
                    <button type="button" onClick={() => setSrcAdding(false)} className="h-[30px] px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs font-semibold">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {founderSources.length > 0 && (
                <div className="flex flex-col mb-1">
                  {founderSources.map((s, i) => (
                    <div key={`${s.title}-${i}`} className="group flex items-start gap-2.5 py-2 border-t border-gray-100 dark:border-gray-800" data-testid={`founder-source-${i}`}>
                      <FileText size={15} className="text-gray-400 dark:text-gray-500 flex-none mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{s.title}</span>
                          <span className={`text-[9.5px] font-bold rounded-full px-1.5 py-0.5 ${SRC_TYPE_CHIP[s.type] || SRC_TYPE_CHIP.Manual}`}>{s.type === 'Manual' ? 'Manual entry' : s.type}</span>
                        </div>
                        {/* Founder sources have no backend endpoint yet — page-local, and honest about it. */}
                        <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-0.5">
                          Added {s.date} · <span className="text-amber-700 dark:text-amber-400 font-semibold">not saved yet</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        title="Remove"
                        onClick={() => setFounderSources((prev) => prev.filter((_, idx) => idx !== i))}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-sm leading-none px-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {citRows.length > 0 ? (
                <div className="flex flex-col border-t border-gray-100 dark:border-gray-800">
                  {citRows.slice(0, 5).map((c, i) => (
                    <div key={`${c.source_key}-${i}`} className="flex items-center gap-2 py-1.5 border-b border-gray-50 dark:border-gray-800/60 last:border-b-0">
                      <span className="text-[11px] text-gray-600 dark:text-gray-300 flex-1 truncate">{c.source_key} · {c.metric_key}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">{shortDate(c.ts)}</span>
                      {c.citation_url && (
                        <a href={c.citation_url} target="_blank" rel="noreferrer" className="text-violet-600 dark:text-violet-400"><ExternalLink size={11} /></a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-2.5" data-testid="citations-empty">
                  No recent citations for {project.sector || 'your sector'} — the log fills as sources report.
                </p>
              )}
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-2.5 leading-relaxed">Minimum 2 sources required for investor-ready status. Primary research (interviews) weighted more heavily.</div>
            </div>
          </div>

          {/* Competitive landscape (spec B) + positioning map (spec C) */}
          <div className={`${CARD} mb-5`} data-testid="market-competitors">
            <div className="flex items-center justify-between gap-2 mb-3.5">
              <div className={LBL}>Competitive landscape</div>
              {compRows.length < 6 && (
                <button type="button" data-testid="button-add-competitor" onClick={() => setCompAdding(true)} className={GHOST_SM}>
                  + Add competitor
                </button>
              )}
            </div>
            {compError && <div className="text-[11.5px] text-red-600 dark:text-red-400 mb-3" data-testid="competitor-error">{compError}</div>}
            {compAdding && (
              <div className="mb-3.5 p-3.5 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-xl flex flex-col gap-2.5" data-testid="form-add-competitor">
                <div className="grid grid-cols-[1.4fr_1fr] gap-2.5">
                  <input
                    type="text"
                    data-testid="input-competitor-name"
                    placeholder="Competitor name"
                    value={compForm.name}
                    onChange={(e) => setCompForm((f) => ({ ...f, name: e.target.value }))}
                    className={INP}
                  />
                  <select value={compForm.cat} onChange={(e) => setCompForm((f) => ({ ...f, cat: e.target.value }))} className={INP} data-testid="select-competitor-category">
                    <option value="Direct">Direct</option>
                    <option value="Indirect">Indirect</option>
                    <option value="Adjacent">Adjacent</option>
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Differentiation note — how they differ from you"
                  value={compForm.note}
                  onChange={(e) => setCompForm((f) => ({ ...f, note: e.target.value }))}
                  className={INP}
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    placeholder="Market share e.g. 8%"
                    value={compForm.share}
                    onChange={(e) => setCompForm((f) => ({ ...f, share: e.target.value }))}
                    className={INP}
                  />
                  <select value={compForm.stage} onChange={(e) => setCompForm((f) => ({ ...f, stage: e.target.value }))} className={INP} data-testid="select-competitor-stage">
                    {COMP_STAGES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  {compBusy && !compAnalysis && (
                    <span className="mr-auto text-[10.5px] text-gray-400 dark:text-gray-500">Creating your competitor analysis — the first run can take a moment…</span>
                  )}
                  <button type="button" onClick={() => setCompAdding(false)} disabled={compBusy} className="h-8 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs font-semibold">
                    Cancel
                  </button>
                  <button type="button" data-testid="button-confirm-competitor" onClick={confirmAddComp} disabled={compBusy} className="h-8 px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                    {compBusy && <Loader2 size={12} className="animate-spin" />} Add competitor
                  </button>
                </div>
              </div>
            )}
            {compShown.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center" data-testid="competitors-empty">
                No competitors mapped yet — add the players investors will ask about.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {compShown.map((c, i) => (
                  <div key={c.key} className="relative border border-gray-100 dark:border-gray-800 rounded-xl p-3.5 bg-gray-50 dark:bg-gray-800/50" data-testid={`competitor-card-${i}`}>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => removeComp(c)}
                      className="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-gray-300 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-500 dark:hover:text-gray-300 text-[15px] leading-none"
                    >
                      ×
                    </button>
                    <div className="flex items-center justify-between gap-2 pr-6 mb-1.5">
                      <span className="text-[13px] font-bold text-gray-800 dark:text-gray-100 truncate">{c.name}</span>
                      <span className={`text-[9.5px] font-bold rounded-full px-2 py-0.5 flex-none ${COMP_CAT_CHIP[c.cat] || COMP_CAT_CHIP.Adjacent}`}>{c.cat}</span>
                    </div>
                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-snug mb-2.5 line-clamp-3">{c.note}</div>
                    <div className="flex items-center justify-between gap-2">
                      {c.share ? (
                        <span className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300">{c.share} share</span>
                      ) : (
                        <span className="text-[11.5px] text-gray-400 dark:text-gray-500">— share</span>
                      )}
                      {c.stage && <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-md px-1.5 py-0.5">{c.stage}</span>}
                    </div>
                    {c.local && (
                      <span className="mt-2 inline-flex text-[9.5px] font-bold rounded-full px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">not saved yet</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Positioning map (spec C) — deterministic sketch, labeled as such. */}
            <div className="mt-5 pt-[18px] border-t border-gray-100 dark:border-gray-800" data-testid="market-positioning">
              <div className={`${LBL} mb-2.5`}>Where you fit</div>
              <div className="flex gap-5 items-start flex-wrap">
                <div>
                  <div className="flex gap-1.5">
                    <div className="flex flex-col justify-between h-[140px] text-[9.5px] text-gray-400 dark:text-gray-500 py-0.5">
                      <span>Broad</span>
                      <span>Narrow</span>
                    </div>
                    <svg width={POS_W} height={POS_H} viewBox={`0 0 ${POS_W} ${POS_H}`} className="flex-none rounded-[10px] border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60" data-testid="positioning-map">
                      {compShown.map((c) => {
                        const d = posDot(c.name);
                        return <circle key={c.key} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r="4" className="fill-gray-300 dark:fill-gray-600" />;
                      })}
                      <circle cx={youDot.x} cy={youDot.y} r="5" className="fill-violet-600" />
                      <text x={youDot.x} y={youDot.y} dy="-9" textAnchor="middle" fontSize="10" fontWeight="700" className="fill-violet-700 dark:fill-violet-300">You</text>
                    </svg>
                  </div>
                  <div className="flex justify-between text-[9.5px] text-gray-400 dark:text-gray-500 mt-1 pl-[34px]">
                    <span>Low-cost</span>
                    <span>Premium</span>
                  </div>
                </div>
                <div className="flex-1 min-w-[200px] max-w-[320px]">
                  {project.problem_statement ? (
                    <p className="text-[11.5px] text-gray-600 dark:text-gray-300 leading-relaxed mb-2 line-clamp-3">
                      <span className="font-semibold text-gray-900 dark:text-gray-50">Positioning input · </span>
                      {project.problem_statement}
                    </p>
                  ) : (
                    <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-2">Add a problem statement to your startup record — positioning is generated from it.</p>
                  )}
                  <p className="text-[10.5px] text-gray-400 dark:text-gray-500 leading-relaxed mb-3">Dot placement is an illustrative sketch from your competitor set — directional, not measured data.</p>
                  {deckUnlocked ? (
                    <Link
                      to="/raise/pitch/positioning"
                      data-testid="link-positioning"
                      onClick={() => setPosDone(true)}
                      className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 text-[11.5px] font-semibold"
                    >
                      Generate positioning <ArrowRight size={13} />
                    </Link>
                  ) : (
                    <span data-testid="positioning-locked" aria-disabled="true" className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-[11.5px] font-semibold select-none">
                      <Lock size={12} /> Unlocks in Week 2
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* The deck's Competition slide stays the investor-ready surface. */}
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              {deckUnlocked ? (
                <Link to="/build/deck" data-testid="link-deck-competitors" className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-violet-700 dark:text-violet-300">
                  Map competitors in the deck <ArrowRight size={13} />
                </Link>
              ) : (
                <span data-testid="competitors-locked" aria-disabled="true" className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-[11.5px] font-semibold select-none">
                  <Lock size={12} /> Deck competition slide unlocks in Week 2
                </span>
              )}
            </div>
          </div>

          {/* Investor signals */}
          <div className={CARD} data-testid="market-investor-signals">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <div className={LBL}>Investor signals · scored from your profile</div>
              {!advisorsUnlocked && (
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                  <Lock size={10} /> Intro tools unlock in Week 3
                </span>
              )}
            </div>
            <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3.5 max-w-2xl">
              Real anonymised matches from the platform&rsquo;s investor-fit engine, scored against your sector, stage and traction. Identities are NDA-gated platform-wide — names are withheld here, not decoratively blurred.
            </p>
            {matches.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center" data-testid="fit-empty">
                {fitUnavailable
                  ? 'Investor matching isn’t available for this account — it’s computed for the startup record owner.'
                  : 'No investor matches computed yet — they appear as your record and traction fill in.'}
              </p>
            ) : (
              <div className="flex flex-col">
                {matches.map((m, i) => {
                  const pct = Math.round((Number(m.score) || 0) * 100);
                  // Design's compact signal affordances (795-812): ●●●○○ dot
                  // string + banded score chip, both derived from the real
                  // score (dots = clamp(round(score/20),1,5); band ≥70/≥45).
                  const dots = Math.max(1, Math.min(5, Math.round(pct / 20)));
                  const dotsStr = '●'.repeat(dots) + '○'.repeat(5 - dots);
                  const bandCls =
                    pct >= 70
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : pct >= 45
                        ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';
                  // Stable pseudonymous tag: hash prefix when present, rank
                  // fallback otherwise (post-NDA rows may carry a real
                  // investor_user_id instead of a hash — never rendered here).
                  const tag = String(m.investor_id_hash || '').slice(0, 6) || `#${i + 1}`;
                  return (
                    <div key={m.investor_id_hash || i} data-testid={`investor-match-${i}`} className="flex items-center gap-3 py-2.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0">
                      <span className="w-5 text-[11px] font-bold text-gray-400 dark:text-gray-500 flex-none">{i + 1}</span>
                      <span className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 flex-none">
                        Investor <span className="font-mono text-gray-400 dark:text-gray-500">·{tag}</span>
                      </span>
                      {m.nda_required && (
                        <span className="text-[9.5px] font-bold rounded-full px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 inline-flex items-center gap-1 flex-none">
                          <ShieldCheck size={9} /> NDA
                        </span>
                      )}
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden min-w-[60px]">
                        <div className={`h-full rounded-full ${pct >= 75 ? 'bg-violet-600' : pct >= 50 ? 'bg-violet-400' : 'bg-gray-300 dark:bg-gray-600'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="hidden sm:inline font-mono text-[13px] tracking-[1px] text-violet-600 dark:text-violet-400 flex-none">{dotsStr}</span>
                      <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 flex-none ${bandCls}`}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
            {advisorsUnlocked && matches.length > 0 && (
              <Link to="/advisors" className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-violet-700 dark:text-violet-300">
                Work introductions with your advisor <ArrowRight size={12} />
              </Link>
            )}
          </div>
        </>
      )}

      {/* Market-assumptions drawer (spec A, design 1458-1549) — replaces the
          old centered modal. Test-id names from the modal are kept for
          continuity: modal-edit-sizing = overlay, button-close-sizing = ×,
          button-save-sizing = "Recalculate market sizing", sizing-error = the
          validation line; input-tam/-sam/-som map to the drawer controls that
          now drive each figure (TAM override / % reachable / win rate). */}
      {editOpen && project && (
        <div className="fixed inset-0 z-[75] bg-zinc-900/35" data-testid="modal-edit-sizing" onClick={() => !saving && setEditOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-0 right-0 bottom-0 w-[400px] max-w-full bg-white dark:bg-gray-900 shadow-[-20px_0_50px_-20px_rgba(24,24,27,.35)] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-3 flex-none">
              <div>
                <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-50">Edit Market Assumptions</div>
                {/* The design shows an "Auto-saves" chip here — omitted because
                    it would lie: only TAM/SAM/SOM persist, on explicit recalc. */}
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 max-w-[280px] leading-relaxed">
                  Assumptions inform the calculator — only TAM/SAM/SOM are saved to your startup record yet.
                </div>
              </div>
              <button type="button" data-testid="button-close-sizing" onClick={() => setEditOpen(false)} disabled={saving} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center justify-center flex-none">
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 flex-1 overflow-y-auto flex flex-col gap-[22px]">
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 rounded-[10px] px-3 py-2.5">
                <Lock size={13} className="text-amber-700 dark:text-amber-400 flex-none mt-0.5" />
                <span className="text-[11.5px] text-amber-800 dark:text-amber-200 leading-relaxed">Pitch Deck Market slide will update when you recalculate.</span>
              </div>

              {/* Market definition */}
              <div>
                <div className={`${LBL} mb-2.5`}>Market definition</div>
                <div className="flex flex-col gap-2.5">
                  <label>
                    <span className={FLD}>Market category</span>
                    <input type="text" value={assume.category} onChange={setA('category')} className={INP} data-testid="input-market-category" />
                  </label>
                  <label>
                    <span className={FLD}>Geography</span>
                    <select value={assume.geography} onChange={setA('geography')} className={INP} data-testid="select-geography">
                      <option>Global</option>
                      <option>North America</option>
                      <option>Europe</option>
                      <option>APAC</option>
                      <option>Custom</option>
                    </select>
                  </label>
                  <label>
                    <span className={FLD}>Target year</span>
                    <select value={assume.targetYear} onChange={setA('targetYear')} className={INP} data-testid="select-target-year">
                      <option>2025</option>
                      <option>2026</option>
                      <option>2027</option>
                      <option>2028</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* TAM inputs */}
              <div>
                <div className={`${LBL} mb-2.5`}>TAM inputs</div>
                <div className="flex flex-col gap-2.5">
                  <div className="flex gap-1.5">
                    {['Top-down', 'Bottom-up'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setAV('methodology', m)}
                        className={`flex-1 h-8 rounded-lg border text-xs font-semibold ${assume.methodology === m ? SEG_ON : SEG_OFF}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <label>
                    <span className={FLD}>Total addressable population (units)</span>
                    <input type="number" min="0" value={assume.population} onChange={setA('population')} className={INP} data-testid="input-population" />
                  </label>
                  <label>
                    <span className={FLD}>Average contract value ($)</span>
                    <input type="number" min="0" value={assume.acv} onChange={setA('acv')} className={INP} data-testid="input-acv" />
                  </label>
                  <label>
                    <span className={FLD}>TAM override ($M, optional)</span>
                    <input type="number" min="0" placeholder="Override calculated TAM" value={assume.tamOverride} onChange={setA('tamOverride')} className={INP} data-testid="input-tam" />
                  </label>
                </div>
              </div>

              {/* SAM inputs */}
              <div>
                <div className={`${LBL} mb-2.5`}>SAM inputs</div>
                <div className="flex flex-col gap-2.5">
                  <label>
                    <span className={FLD}>% of TAM reachable</span>
                    <input type="number" min="0" max="100" value={assume.samPct} onChange={setA('samPct')} className={INP} data-testid="input-sam" />
                  </label>
                  <div>
                    <span className={FLD}>Segment filter</span>
                    {picks.length === 0 ? (
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">No aggregator segments this period.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {picks.map((p) => (
                          <button
                            key={p.sector}
                            type="button"
                            onClick={() => toggleSeg(p.sector)}
                            className={`h-7 px-2.5 rounded-full border text-[11px] font-semibold ${(assume.segFilter || []).includes(p.sector) ? SEG_ON : SEG_OFF}`}
                          >
                            {p.sector}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SOM inputs */}
              <div>
                <div className={`${LBL} mb-2.5`}>SOM inputs</div>
                <div className="flex flex-col gap-2.5">
                  <label>
                    <span className={FLD}>Win rate (%)</span>
                    <input type="number" min="0" value={assume.winRate} onChange={setA('winRate')} className={INP} data-testid="input-som" />
                  </label>
                  <label>
                    <span className={FLD}>Runway (months)</span>
                    <input type="number" min="0" value={assume.runway} onChange={setA('runway')} className={INP} data-testid="input-runway" />
                  </label>
                  <label>
                    <span className={FLD}>Sales capacity (deals/month)</span>
                    <input type="number" min="0" value={assume.capacity} onChange={setA('capacity')} className={INP} data-testid="input-capacity" />
                  </label>
                </div>
              </div>

              {/* Growth */}
              <div>
                <div className={`${LBL} mb-2.5`}>Growth</div>
                <div className="flex flex-col gap-2.5">
                  <label>
                    <span className={FLD}>CAGR estimate (%)</span>
                    <input type="number" min="0" value={assume.cagr} onChange={setA('cagr')} className={INP} data-testid="input-cagr" />
                  </label>
                  <label>
                    <span className={FLD}>Growth driver</span>
                    <textarea rows={2} value={assume.growthDriver} onChange={setA('growthDriver')} className={TXA} data-testid="input-growth-driver" />
                  </label>
                  <div>
                    <span className={FLD}>Market maturity</span>
                    <div className="flex gap-1.5">
                      {['Early', 'Growing', 'Mature'].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setAV('maturity', m)}
                          className={`flex-1 h-[30px] rounded-lg border text-[11.5px] font-semibold ${assume.maturity === m ? SEG_ON : SEG_OFF}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex-none">
              {saveError && <div className="text-[11.5px] text-red-600 dark:text-red-400 mb-2.5" data-testid="sizing-error">{saveError}</div>}
              <button
                type="button"
                data-testid="button-save-sizing"
                onClick={recalcMarket}
                disabled={saving}
                className="w-full h-[42px] rounded-[11px] bg-violet-600 hover:bg-violet-700 text-white text-[13.5px] font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />} Recalculate market sizing
              </button>
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 leading-relaxed text-center">Recalculating updates TAM, SAM, SOM cards and the Pitch Deck Market slide automatically.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
