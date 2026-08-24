// Spin-Out Lab — Co-founder Match (Week 3 tool page).
//
// Design handoff: spin-out-lab-pipeline/project/Co-founder Match.dc.html.
// This was the last Lab design with no native page — the workspace card
// linked straight out to /cofounder. Data mapping and honesty rules live in
// lib/cofounderMatchViewModel.js (read its header): archetype from
// /assessment/results/me, capabilities from /radar/me (same <60 gap rule as
// the radar service), values from /values/me, candidates from the REAL
// vector matcher GET /cofounder/browse, and the decision from
// projects.cofounder_decision_meta (Worker D1 migration 162).
//
// Express interest here is the SAME action as /cofounder — same endpoint,
// same 'cofounder_request_sent' milestone — so Week 3 advances identically
// whichever surface the founder used. The full browse/connections/NDA flow
// stays on /cofounder and is linked, not duplicated.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Users, Loader2, Lock, AlertTriangle, X, Check,
  Compass, Search, Scale, UserCheck,
} from 'lucide-react';
import { api, spinoutLab, assessment } from '../lib/api';
import { archetypeMeta } from '../lib/assessmentMeta';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';
import LabPageHeader, { labBtn, LAB_ICON_SIZE } from '../components/spinout/LabPageHeader';
import IncomingLeadsStrip from '../components/IncomingLeadsStrip';
import {
  buildMatchBrief, buildEvidenceModules, buildDecisionModel, serializeDecision,
  fitRows, DECISION_OUTCOMES, CAPABILITY_GAP_THRESHOLD,
} from '../lib/cofounderMatchViewModel';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

function initialsOf(name) {
  return String(name || '').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

// Non-blocking loader: any source may be absent (dev env, unstarted surveys)
// and the page degrades per-section instead of dying whole.
const wkOnly = (e) => (e?.status === 404 || /not found/i.test(e?.message || '') ? { unavailable: true } : { failed: true });

export default function SpinoutLabCofounderMatchPage() {
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [radar, setRadar] = useState(null);
  const [results, setResults] = useState(null);
  const [values, setValues] = useState(null);
  const [myProfile, setMyProfile] = useState(null); // cofounder profile | {unavailable}
  const [browse, setBrowse] = useState(null); // {items, viewer_has_profile} | {failed}
  const [browseSkill, setBrowseSkill] = useState('');
  const [interestBusy, setInterestBusy] = useState(null);
  const [interestMsg, setInterestMsg] = useState(null);

  // Decision console.
  const [outcome, setOutcome] = useState(null);
  const [candidateUid, setCandidateUid] = useState(null);
  const [note, setNote] = useState('');
  const [followups, setFollowups] = useState([]);
  const [followDraft, setFollowDraft] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state().catch(() => null),
          api.getMe().catch(() => null),
          api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        const [rd, rs, vv, prof, br] = await Promise.all([
          api.radar.me().catch(wkOnly),
          assessment.myResults().catch(wkOnly),
          api.values.getMe().catch(wkOnly),
          api.cofounderMe().catch(wkOnly),
          api.cofounderBrowse({ limit: 20 }).catch(wkOnly),
        ]);
        if (dead) return;
        setRadar(rd);
        setResults(rs);
        setValues(vv);
        setMyProfile(prof);
        setBrowse(br?.failed || br?.unavailable ? { failed: true } : br);
        // Hydrate the console from the stored decision.
        const model = buildDecisionModel({ meta: proj?.cofounder_decision_meta, milestoneKeys: [] });
        setOutcome(model.outcome);
        setCandidateUid(model.candidateUid);
        setNote(model.note);
        setFollowups(model.followups);
        setStatus('ready');
      } catch {
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const brief = useMemo(
    () => buildMatchBrief({
      radar: radar && !radar.failed && !radar.unavailable ? radar : null,
      results: Array.isArray(results) ? results : results?.results || null,
      values: values && !values.failed && !values.unavailable ? values : null,
      archetypeMetaFn: archetypeMeta,
    }),
    [radar, results, values],
  );
  const milestoneKeys = useMemo(
    () => new Set((state?.milestones || []).map((m) => m?.key ?? m)),
    [state],
  );
  const decision = useMemo(
    () => buildDecisionModel({ meta: project?.cofounder_decision_meta, milestoneKeys }),
    [project, milestoneKeys],
  );
  const scoringDone = milestoneKeys.has('scoring_run_completed');
  const cards = useMemo(() => (Array.isArray(browse?.items) ? browse.items : []), [browse]);
  const evidence = useMemo(
    () => buildEvidenceModules({
      brief,
      hasProfile: Boolean(myProfile && !myProfile.failed && !myProfile.unavailable),
      candidateCount: cards.length,
      scoringDone,
    }),
    [brief, myProfile, cards, scoringDone],
  );

  const isAdmin = user?.role === 'admin';
  const unlocked = isAdmin || (state?.unlocked_features || []).includes('cofounder-match');

  const runSearch = useCallback(async (term) => {
    setBrowseSkill(term);
    setBrowse(null);
    const br = await api.cofounderBrowse({ limit: 20, ...(term ? { skill: term } : {}) }).catch(wkOnly);
    setBrowse(br?.failed || br?.unavailable ? { failed: true } : br);
  }, []);

  const expressInterest = useCallback(async (card) => {
    if (!card?.user_uid) return;
    setInterestBusy(card.uid);
    setInterestMsg(null);
    try {
      const r = await api.cofounderExpressInterest({ user_uid: card.user_uid, message: null });
      // Same milestone the /cofounder surface marks — one deliverable, two doors.
      await markMilestone(user, 'cofounder_request_sent');
      spinoutLab.state().then(setState).catch(() => {});
      setInterestMsg({
        kind: 'ok',
        text: r?.mutual
          ? 'Mutual interest — continue to Connections to sign your NDA.'
          : 'Interest sent. It marks your Week-3 co-founder milestone.',
      });
      const br = await api.cofounderBrowse({ limit: 20, ...(browseSkill ? { skill: browseSkill } : {}) }).catch(wkOnly);
      setBrowse(br?.failed || br?.unavailable ? { failed: true } : br);
    } catch (e) {
      setInterestMsg({ kind: 'err', text: e?.message || 'Could not send interest.' });
    } finally {
      setInterestBusy(null);
    }
  }, [user, browseSkill]);

  const saveDecision = useCallback(async () => {
    if (!project || !outcome) return;
    setSaveState('saving');
    try {
      const blob = serializeDecision({
        outcome,
        candidateUid: outcome === 'advance' ? candidateUid : null,
        note,
        followups,
        decidedAt: new Date().toISOString(),
      });
      const updated = await api.updateProject(project.id, { cofounder_decision_meta: JSON.stringify(blob) });
      setProject((p) => ({ ...(updated || p), cofounder_decision_meta: JSON.stringify(blob) }));
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch {
      setSaveState('error');
    }
  }, [project, outcome, candidateUid, note, followups]);

  if (status === 'loading') {
    return <div className="max-w-7xl mx-auto px-4 py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>;
  }
  if (status === 'error') {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center" data-testid="page-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Couldn't load Co-founder Match. Reload to try again.</p>
      </div>
    );
  }
  if (!unlocked) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center" data-testid="page-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <div className="text-base font-extrabold text-gray-900 dark:text-gray-50 mb-1">Co-founder Match unlocks in Week 3</div>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">Complete your Week 2 deliverables to open co-founder sourcing.</p>
        <Link to="/spinout-lab" className="text-[13px] font-bold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }

  const chipTone = (done) => (done
    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-cofounder-match">
      {/* Header */}
      <LabPageHeader
        className="mb-5"
        icon={Users}
        title="Co-founder Match"
        subtitle="Founder match brief, ranked candidates, and the track decision — advance, keep searching, or go solo."
        status="Active"
        weekChip="Unlocked · Wk 3"
        actions={(
          <Link to="/cofounder" data-testid="link-full-browse" className={labBtn('secondary')}>
            Full browse & connections <ArrowRight size={LAB_ICON_SIZE} />
          </Link>
        )}
      />

      {/* Decision readiness — evidence modules */}
      <div className={`${CARD} mb-5`} data-testid="card-evidence">
        <div className="flex items-center justify-between mb-2">
          <div className={LBL}>Decision readiness</div>
          <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300" data-testid="text-evidence-count">
            {evidence.done} of {evidence.total} evidence modules
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {evidence.mods.map((m) => (
            <span key={m.key} data-testid={`evidence-${m.key}`} className={`inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2.5 py-1 ${chipTone(m.done)}`}>
              {m.done ? <Check size={11} /> : null}{m.label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
          Each module is a real evidence source this decision can draw on — complete them in Profiling, Scoring, and your co-founder profile.
        </p>
      </div>

      {/* Co-founder signups captured on the founder's published landing pages
          (audience: cofounder) route here — the destination the Brand page's
          "Routing to → Co-founder Match" points at. */}
      <div className="mb-5">
        <IncomingLeadsStrip
          audience="cofounder"
          sectionLabel="INBOUND LEADS · BRAND & PAGES"
          title="New co-founder leads"
          blurb="People who reached out about co-founding via your landing pages."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
        {/* LEFT — candidates */}
        <div className="space-y-5 min-w-0">
          {/* Skills gap → search criteria */}
          <div className={CARD} data-testid="card-search-criteria">
            <div className={`${LBL} mb-2`}>Skills gap → search criteria</div>
            {brief.searchCriteria.length === 0 ? (
              <p className="text-[12.5px] text-gray-400 dark:text-gray-500" data-testid="criteria-empty">
                {brief.strongest.length || brief.missing.length
                  ? `No capability axis is under ${CAPABILITY_GAP_THRESHOLD}% — search by overall complement instead.`
                  : 'Rate your skills in Studio to derive search criteria from your real gaps.'}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button type="button" onClick={() => runSearch('')} data-testid="chip-criteria-all" aria-pressed={!browseSkill}
                    className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-full border ${!browseSkill ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
                    Overall complement
                  </button>
                  {brief.searchCriteria.map((cta) => (
                    <button key={cta.slug} type="button" onClick={() => runSearch(cta.term)} data-testid={`chip-criteria-${cta.slug}`} aria-pressed={browseSkill === cta.term}
                      className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-full border ${browseSkill === cta.term ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
                      {cta.label} · weight {cta.weight}
                    </button>
                  ))}
                </div>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
                  Criteria are your capability axes under {CAPABILITY_GAP_THRESHOLD}% (the radar service's own gap rule); weight is relative gap depth.
                </p>
              </>
            )}
          </div>

          {/* Ranked candidates */}
          <div className="space-y-3" data-testid="section-candidates">
            <div className={LBL}>Ranked candidates · best complement first</div>
            {interestMsg && (
              <div className={`text-[12px] rounded-lg px-3 py-2 ${interestMsg.kind === 'ok' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'}`} data-testid="interest-msg">
                {interestMsg.text}
              </div>
            )}
            {browse === null ? (
              <div className={`${CARD} py-8 flex justify-center`}><Loader2 className="w-5 h-5 animate-spin text-violet-500" /></div>
            ) : browse.failed ? (
              <div className={`${CARD} text-center py-8`} data-testid="candidates-error">
                <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                <p className="text-[12.5px] text-gray-500 dark:text-gray-400">Couldn't load candidates. The full browse surface may still work — try <Link className="text-violet-600 hover:underline" to="/cofounder">/cofounder</Link>.</p>
              </div>
            ) : cards.length === 0 ? (
              <div className={`${CARD} text-center py-8`} data-testid="candidates-empty">
                <Users className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
                  {browseSkill ? 'No listed candidates match this criterion — clear it or search the full pool.' : 'No listed candidates right now — the pool is still growing.'}
                </p>
              </div>
            ) : cards.map((card) => {
              const rows = fitRows(card.breakdown);
              const gapsGroup = rows.filter((r) => r.group === 'gaps');
              const styleGroup = rows.filter((r) => r.group === 'style');
              return (
                <div key={card.uid} className={CARD} data-testid={`candidate-${card.uid}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 flex-none rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[11px] font-bold flex items-center justify-center">
                      {initialsOf(card.handle)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">{card.handle}</span>
                        {card.match_score != null && (
                          <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-violet-600 text-white" data-testid={`fit-${card.uid}`}>
                            Total fit {card.match_score}
                          </span>
                        )}
                        {card.mutual_interest ? (
                          <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Mutual interest</span>
                        ) : card.interest_sent ? (
                          <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">Interest sent</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(card.skills || []).slice(0, 5).map((s) => (
                          <span key={s} className="text-[10px] font-semibold capitalize rounded-full px-2 py-0.5 bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{s}</span>
                        ))}
                        {card.commitment && <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{card.commitment}</span>}
                      </div>
                      {card.bio && <p className="text-[12px] text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">{card.bio}</p>}

                      {card.match_score == null ? (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2" data-testid={`unscored-${card.uid}`}>
                          Unscored — create your own co-founder profile to unlock fit scoring against your vectors.
                        </p>
                      ) : rows.length > 0 && (
                        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5" data-testid={`fit-breakdown-${card.uid}`}>
                          <div>
                            <div className={`${LBL} mb-1`}>Gaps they fill</div>
                            {gapsGroup.length ? gapsGroup.map((r) => (
                              <div key={r.key} className="flex justify-between text-[11px] py-0.5">
                                <span className="text-gray-600 dark:text-gray-300">{r.label}</span>
                                <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">{r.value}<span className="text-gray-400 font-normal">/{r.max}</span></span>
                              </div>
                            )) : <p className="text-[11px] text-gray-400">No skill-complement signal.</p>}
                          </div>
                          <div>
                            <div className={`${LBL} mb-1`}>Working style compatibility</div>
                            {styleGroup.length ? styleGroup.map((r) => (
                              <div key={r.key} className="flex justify-between text-[11px] py-0.5">
                                <span className="text-gray-600 dark:text-gray-300">{r.label}</span>
                                <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">{r.value}<span className="text-gray-400 font-normal">/{r.max}</span></span>
                              </div>
                            )) : <p className="text-[11px] text-gray-400">No values/commitment signal yet.</p>}
                          </div>
                        </div>
                      )}
                      {(card.watch_outs || []).length > 0 && (
                        <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid={`riskflags-${card.uid}`}>
                          <span className="font-bold">Risk flags:</span> {card.watch_outs.slice(0, 2).join(' · ')}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          type="button"
                          disabled={card.interest_sent || interestBusy === card.uid}
                          onClick={() => expressInterest(card)}
                          data-testid={`button-interest-${card.uid}`}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg px-3 py-1.5"
                        >
                          {interestBusy === card.uid ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                          {card.interest_sent ? 'Interest sent' : 'Express interest'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setOutcome('advance'); setCandidateUid(card.uid); }}
                          data-testid={`button-advance-${card.uid}`}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 rounded-lg px-3 py-1.5"
                        >
                          <Scale size={12} /> Advance to decision
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — brief + decision console */}
        <div className="space-y-5 min-w-0">
          {/* Founder match brief */}
          <div className={CARD} data-testid="card-match-brief">
            <div className={`${LBL} mb-3`}>Founder match brief</div>
            <div className="flex items-center gap-2 mb-2">
              <Compass size={14} className="text-violet-500" />
              {brief.archetype?.label ? (
                <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50" data-testid="text-archetype">
                  {brief.archetype.label}
                  {brief.archetype.confidence != null && (
                    <span className="text-gray-400 dark:text-gray-500 font-semibold"> · {brief.archetype.confidence}% confidence</span>
                  )}
                </span>
              ) : (
                <span className="text-[12px] text-gray-400 dark:text-gray-500" data-testid="archetype-empty">No archetype yet — answer in Studio.</span>
              )}
            </div>
            {brief.role && (
              <div className="mb-3" data-testid="text-recommended-role">
                <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">Recommended co-founder role</div>
                <div className="text-[12.5px] text-violet-700 dark:text-violet-300 font-semibold">{brief.role}</div>
                <div className="text-[10.5px] text-gray-400 dark:text-gray-500">Derived from your weakest capability axes.</div>
              </div>
            )}
            <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mb-1">Strongest capabilities</div>
            {brief.strongest.length ? brief.strongest.map((s) => (
              <div key={s.slug} className="flex justify-between text-[12px] py-0.5" data-testid={`strong-${s.slug}`}>
                <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
                <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{s.score}%</span>
              </div>
            )) : <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-1">No rated capabilities yet.</p>}
            <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mt-3 mb-1">Critical missing capabilities</div>
            {brief.missing.length ? brief.missing.map((s) => (
              <div key={s.slug} className="flex justify-between text-[12px] py-0.5" data-testid={`missing-${s.slug}`}>
                <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
                <span className="tabular-nums font-bold text-rose-600 dark:text-rose-400">{s.score}%</span>
              </div>
            )) : <p className="text-[11.5px] text-gray-400 dark:text-gray-500">None under the {CAPABILITY_GAP_THRESHOLD}% gap rule.</p>}
            {brief.mustHaveValues.length > 0 && (
              <>
                <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mt-3 mb-1">Must-have values</div>
                <div className="flex flex-wrap gap-1">
                  {brief.mustHaveValues.map((v) => (
                    <span key={v.slug} className="text-[10px] font-semibold capitalize rounded-full px-2 py-0.5 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300" data-testid={`value-${v.slug}`}>
                      {v.slug.replace(/^(schwartz|founder)_/, '').replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </>
            )}
            {(brief.archetype?.blindSpots || []).length > 0 && (
              <>
                <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mt-3 mb-1">Caution areas</div>
                <ul className="text-[11.5px] text-gray-500 dark:text-gray-400 space-y-0.5 list-disc pl-4">
                  {brief.archetype.blindSpots.slice(0, 3).map((b) => <li key={b}>{b}</li>)}
                </ul>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Archetype blind spots — descriptive archetype copy, not a measurement of you.</p>
              </>
            )}
          </div>

          {/* Decision console */}
          <div className={CARD} data-testid="card-decision-console">
            <div className={`${LBL} mb-1`}>Decision console · track decision</div>
            <div className="text-[11px] mb-3" data-testid="text-week3-status">
              {decision.week3Satisfied ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  ✓ Week-3 "validate path" satisfied — {decision.requestSent ? 'co-founder request sent' : 'advisor meeting booked'}.
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  Week 3 needs a sent co-founder request or a booked advisor meeting — recording a decision alone doesn't advance it.
                </span>
              )}
            </div>
            <div className="space-y-2 mb-3">
              {DECISION_OUTCOMES.map((o) => (
                <label key={o.value} className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer ${outcome === o.value ? 'border-violet-400 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-700'}`} data-testid={`outcome-${o.value}`}>
                  <input type="radio" name="cf-outcome" checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="mt-0.5 text-violet-600 focus:ring-violet-500" />
                  <span>
                    <span className="block text-[12.5px] font-bold text-gray-900 dark:text-gray-50">{o.label}</span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            {outcome === 'advance' && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3" data-testid="text-advance-candidate">
                {candidateUid ? `Candidate: ${candidateUid.slice(0, 8)}… (from the list).` : 'Pick a candidate with "Advance to decision" on the left.'}
              </p>
            )}
            {outcome === 'solo' && (
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3 mb-3 text-[11.5px] text-gray-600 dark:text-gray-300" data-testid="solo-panel">
                <div className="font-bold text-gray-800 dark:text-gray-100 mb-1">Solo path — a first-class outcome, not a failure state.</div>
                {brief.missing.length > 0 && (
                  <p className="mb-1.5">Capability gaps to mitigate without a co-founder: {brief.missing.map((m) => m.label).join(', ')} — advisors and early hires are the usual levers.</p>
                )}
                <p>
                  For Week 3, <Link to="/spinout-lab/advisors" className="text-violet-600 hover:underline font-semibold">book an advisor meeting</Link> (the other valid path).
                  The solo declaration itself executes in Week 4's <Link to="/spinout-lab/cofounder-agreement" className="text-violet-600 hover:underline font-semibold">Co-founder Agreement</Link> tool.
                </p>
              </div>
            )}
            <label className={`${LBL} block mb-1`} htmlFor="cf-note">Decision note</label>
            <textarea id="cf-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-decision-note"
              placeholder="Top strengths, top concerns, what would change your mind…"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-[12.5px] text-gray-900 dark:text-gray-50 mb-3" />
            <label className={`${LBL} block mb-1`} htmlFor="cf-follow">Required follow-ups</label>
            <div className="flex gap-2 mb-2">
              <input id="cf-follow" value={followDraft} onChange={(e) => setFollowDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (followDraft.trim()) { setFollowups([...followups, followDraft.trim()]); setFollowDraft(''); } } }}
                placeholder="Type and press Enter" data-testid="input-followup"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-[12.5px] text-gray-900 dark:text-gray-50" />
            </div>
            {followups.length > 0 && (
              <ul className="mb-3 space-y-1">
                {followups.map((f, i) => (
                  <li key={`${f}-${i}`} className="flex items-center justify-between text-[11.5px] text-gray-600 dark:text-gray-300" data-testid={`followup-${i}`}>
                    <span>· {f}</span>
                    <button type="button" onClick={() => setFollowups(followups.filter((_, j) => j !== i))} aria-label={`Remove ${f}`} className="text-gray-400 hover:text-rose-500"><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" disabled={!outcome || !project || saveState === 'saving'} onClick={saveDecision} data-testid="button-save-decision"
              className="w-full h-9 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5">
              {saveState === 'saving' && <Loader2 size={13} className="animate-spin" />}
              {saveState === 'saved' ? '✓ Decision recorded' : 'Record decision'}
            </button>
            {saveState === 'error' && <p className="text-[11.5px] text-rose-600 dark:text-rose-400 mt-2" data-testid="text-save-error">Couldn't save — try again.</p>}
            {!project && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">Create a startup record first to store a decision.</p>}
            {decision.decidedAt && saveState === 'idle' && (
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2" data-testid="text-decided-at">
                Last recorded {new Date(decision.decidedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.
              </p>
            )}
          </div>

          {/* Profile nudge */}
          {(myProfile?.unavailable || myProfile?.failed) && (
            <div className={`${CARD} text-[11.5px] text-gray-500 dark:text-gray-400`} data-testid="card-profile-nudge">
              <Search size={13} className="inline mr-1 text-violet-500" />
              You don't have a co-founder profile yet — candidates stay unscored until you do.{' '}
              <Link to="/cofounder" className="text-violet-600 hover:underline font-semibold">Create it on the browse surface</Link>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
