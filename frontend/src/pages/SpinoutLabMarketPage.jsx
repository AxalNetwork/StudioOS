// Spin-Out Lab "Market Intel" tool page — TAM/SAM sizing + live market
// signal, per the design handoff (Market Intel .dc screenshots / repo
// spin-out-lab-pipeline/project). Every number is real:
//   - TAM / SAM come from the founder's project record (editable here — the
//     Week-1 "Size your market" deliverable) via PUT /projects/:id.
//   - Market dynamics / segments come from the platform Market-Intel
//     aggregator (sector compass + founder lens), matched to the project's
//     sector.
//   - Sources & research log list the aggregator's actual data sources and
//     recent citations.
//   - Investor signals are the REAL anonymised fit matches from
//     /market-intel/fit/founder/:id (identity disclosure is NDA-gated
//     platform-wide, so names stay masked here — honestly, not decoratively).
// The design's fabricated content (fake competitors, hand-placed positioning
// dot, fake investor focus/stage columns) is NOT reproduced; those sections
// render honest states pointing at the real tools that produce the data.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Compass,
  ExternalLink,
  Loader2,
  Lock,
  Pencil,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import { pickLabProject } from './SpinoutLabStartupPage';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';

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
  const [form, setForm] = useState({ tam: '', sam: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [shared, setShared] = useState(false);

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
        const [cp, fl, src, cit, ft] = await Promise.all([
          api.miSectorCompass().catch(() => null),
          api.miFounderLens().catch(() => null),
          api.miSources().catch(() => null),
          p?.sector ? api.miCitations(p.sector, 8).catch(() => null) : Promise.resolve(null),
          p ? api.miFitFounder(p.id).catch(() => ({ unavailable: true })) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setCompass(cp);
        setLens(fl);
        setSources(src);
        setCitations(cit);
        setFit(ft);
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
    setForm({
      tam: project?.tam ? String(project.tam) : '',
      sam: project?.sam ? String(project.sam) : '',
      som: project?.som ? String(project.som) : '',
    });
    setSaveError('');
    setEditOpen(true);
  };

  const saveSizing = async () => {
    if (!project) return;
    const tam = form.tam === '' ? null : Number(form.tam);
    const sam = form.sam === '' ? null : Number(form.sam);
    const som = form.som === '' ? null : Number(form.som);
    if ([tam, sam, som].some((v) => v != null && (!Number.isFinite(v) || v < 0))) {
      setSaveError('Enter plain dollar amounts (e.g. 2400000000 for $2.4B).');
      return;
    }
    if (tam != null && sam != null && sam > tam) {
      setSaveError('SAM should not exceed TAM — it is the serviceable slice of it.');
      return;
    }
    if (sam != null && som != null && som > sam) {
      setSaveError('SOM should not exceed SAM — it is the obtainable slice of it.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const updated = await api.updateProject(project.id, { tam, sam, som });
      setProject((prev) => ({ ...prev, ...updated }));
      // W1 deliverable — sizing counts once both TAM and SAM are on record
      // (citations aggregate automatically from MI sources for the sector).
      if (tam != null && sam != null) await markMilestone(user, 'market_sizing_completed');
      setEditOpen(false);
    } catch (e) {
      reportError('SpinoutLabMarketPage:save', e);
      setSaveError("Couldn't save your sizing. Try again.");
    } finally {
      setSaving(false);
    }
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

  if (!state.active && !state.is_incorporated) {
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
  const tamTxt = fmtMoney(project?.tam);
  const samTxt = fmtMoney(project?.sam);
  const somTxt = fmtMoney(project?.som);
  const samPct = project?.tam && project?.sam ? Math.round((project.sam / project.tam) * 100) : null;
  const somPct = project?.sam && project?.som ? Math.round((project.som / project.sam) * 100) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-market">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <Link to="/spinout-lab" data-testid="link-back-to-workspace" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 mb-2">
            <ArrowLeft size={14} /> Back to Workspace
          </Link>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Compass size={18} className="text-violet-600 dark:text-violet-400" />
            <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Market Intel</h1>
            <span className="text-[10.5px] font-bold rounded-full px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Active</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">TAM / SAM research and sizing — your Week 1 market deliverable.</p>
        </div>
        {project && (
          <div className="flex items-center gap-2">
            <button type="button" data-testid="button-share-research" onClick={shareResearch} className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 text-xs font-semibold inline-flex items-center gap-1.5">
              {shared ? 'Copied' : 'Copy research summary'}
            </button>
            <button type="button" data-testid="button-edit-sizing" onClick={openEdit} className="h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold inline-flex items-center gap-1.5">
              <Pencil size={13} /> Edit sizing
            </button>
          </div>
        )}
      </div>

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

          {/* Methodology */}
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
              <div className="px-5 pb-4 text-[12.5px] text-gray-500 dark:text-gray-400 leading-relaxed" data-testid="methodology-body">
                TAM, SAM and SOM are your own research, saved on your startup record (edit them here — plain dollar figures; your Demo Day deck&rsquo;s Market slide consumes all three).
                The sector signal below is computed by the platform&rsquo;s market-intel aggregator from {sources?.count ?? 'its'} data sources ({liveCount} live), scored across demand, supply, capital, talent, research and sentiment.
                Nothing on this page is auto-invented — empty means not researched yet.
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

            {/* Market dynamics — sector compass */}
            <div className={CARD} data-testid="market-dynamics">
              <div className={`${LBL} mb-1`}>Market dynamics{sectorMatch ? ` · ${sectorMatch.row.sector}` : ''}</div>
              <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3.5">
                {sectorMatch?.exact
                  ? 'Live signal for your sector from the platform aggregator.'
                  : sectorMatch
                    ? `No aggregator segment matches “${project.sector || 'your sector'}” — showing the current leader.`
                    : 'Live sector signal from the platform aggregator.'}
              </p>
              {!sectorMatch ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">No sector signal available this period.</p>
              ) : (
                <>
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
                </>
              )}
            </div>

            {/* Sources & research log */}
            <div className={CARD} data-testid="market-sources">
              <div className={`${LBL} mb-1`}>Sources &amp; research log</div>
              <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3">{srcRows.length} aggregator sources · {liveCount} live feeds</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {srcRows.map((s) => (
                  <span key={s.key} className={`text-[10.5px] font-semibold rounded-md px-2 py-1 ${s.live ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                    {s.display_name}{s.live ? ' · live' : ''}
                  </span>
                ))}
              </div>
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
            </div>
          </div>

          {/* Competitive landscape + positioning — honest states */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <div className={CARD} data-testid="market-competitors">
              <div className={`${LBL} mb-1`}>Competitive landscape</div>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                Competitor mapping is built on your pitch deck&rsquo;s Competition slide{deckUnlocked ? '' : ' in Week 2'} — it stays attached to the deck so every claim ships investor-ready, instead of living as a separate list here.
              </p>
              {deckUnlocked ? (
                <Link to="/build/deck" data-testid="link-deck-competitors" className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold">
                  Map competitors in the deck <ArrowRight size={13} />
                </Link>
              ) : (
                <span data-testid="competitors-locked" aria-disabled="true" className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-[11.5px] font-semibold select-none">
                  <Lock size={12} /> Unlocks in Week 2
                </span>
              )}
            </div>
            <div className={CARD} data-testid="market-positioning">
              <div className={`${LBL} mb-1`}>Where you fit</div>
              {project.problem_statement ? (
                <p className="text-[12px] text-gray-600 dark:text-gray-300 leading-relaxed mb-3 line-clamp-3">
                  <span className="font-semibold text-gray-900 dark:text-gray-50">Positioning input · </span>
                  {project.problem_statement}
                </p>
              ) : (
                <p className="text-[12px] text-gray-400 dark:text-gray-500 mb-3">Add a problem statement to your startup record — positioning is generated from it.</p>
              )}
              {deckUnlocked ? (
                <Link to="/raise/pitch/positioning" data-testid="link-positioning" className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 text-[11.5px] font-semibold">
                  Generate positioning <ArrowRight size={13} />
                </Link>
              ) : (
                <span data-testid="positioning-locked" aria-disabled="true" className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-[11.5px] font-semibold select-none">
                  <Lock size={12} /> Unlocks in Week 2
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
                      <span className={`text-[12px] font-bold w-10 text-right flex-none ${pct >= 75 ? 'text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-300'}`}>{pct}%</span>
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

      {/* Edit sizing modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" data-testid="modal-edit-sizing" onClick={() => !saving && setEditOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">Size your market</h2>
              <button type="button" data-testid="button-close-sizing" onClick={() => setEditOpen(false)} disabled={saving} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={17} /></button>
            </div>
            <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">Plain dollar figures — e.g. 2400000000 for $2.4B. Saved to your startup record and cited on your deck&rsquo;s Market slide.</p>
            <label className="block mb-3">
              <span className={LBL}>TAM (USD)</span>
              <input
                type="number"
                min="0"
                data-testid="input-tam"
                value={form.tam}
                onChange={(e) => setForm((f) => ({ ...f, tam: e.target.value }))}
                className="mt-1 w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-50"
                placeholder="Total addressable market"
              />
              {form.tam && fmtMoney(Number(form.tam)) && <span className="text-[11px] text-violet-700 dark:text-violet-300 font-semibold">= {fmtMoney(Number(form.tam))}</span>}
            </label>
            <label className="block mb-3">
              <span className={LBL}>SAM (USD)</span>
              <input
                type="number"
                min="0"
                data-testid="input-sam"
                value={form.sam}
                onChange={(e) => setForm((f) => ({ ...f, sam: e.target.value }))}
                className="mt-1 w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-50"
                placeholder="Serviceable segment"
              />
              {form.sam && fmtMoney(Number(form.sam)) && <span className="text-[11px] text-violet-700 dark:text-violet-300 font-semibold">= {fmtMoney(Number(form.sam))}</span>}
            </label>
            <label className="block mb-4">
              <span className={LBL}>SOM (USD)</span>
              <input
                type="number"
                min="0"
                data-testid="input-som"
                value={form.som || ''}
                onChange={(e) => setForm((f) => ({ ...f, som: e.target.value }))}
                className="mt-1 w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-50"
                placeholder="Obtainable share"
              />
              {form.som && fmtMoney(Number(form.som)) && <span className="text-[11px] text-violet-700 dark:text-violet-300 font-semibold">= {fmtMoney(Number(form.som))}</span>}
            </label>
            {saveError && <div className="text-[11.5px] text-red-600 dark:text-red-400 mb-3" data-testid="sizing-error">{saveError}</div>}
            <button
              type="button"
              data-testid="button-save-sizing"
              onClick={saveSizing}
              disabled={saving}
              className="w-full h-10 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />} Save sizing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
