/** D6154, DE21–28: the decision record in Deals; legacy /ic links preserve the uid. */
import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { ArrowLeft, Gavel, Save, ShieldCheck, PieChart, RefreshCw } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import Sheet from '../ui/Sheet';
import {DataState} from '../ui/Honesty';
import ICDecisionMinutes from './ICDecisionMinutes';
import { api } from '../lib/api';
import { FillFormBar, FillLabel, useScopedFill } from '../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../lib/fillScoped.js';
import {
  canChangeDecision, AUTHOR_ONLY_LINE, recusalBody, RECUSAL_FINAL_LINE, ownRecusal,
  tallyText, VOTE_WORDS, voteWord, CONDITION_WORDS, canOpenCommitRoom,
} from './icDecisionModel.js';

const VOTES = ['yes', 'no', 'abstain'];
const DECISIONS = ['invest', 'pass', 'defer'];
const OUTCOMES = ['open', 'vindicated', 'regret'];

export default function ICDecisionPage() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const legacy = location.pathname.startsWith('/ic/');
  const { user, role } = useAuth();
  // Every IC member may vote; only the record's author or an Admin may change
  // it (PUT /api/ic/:uid, #6155). Offering the others Save memo, Record
  // decision and Outcome only ever ended in 'Forbidden'.
  const roleCanVote = ['admin', 'partner', 'investor'].includes(role);
  // Task #83 — after an "invest" decision, admins commit it to the cap-table /
  // position ledger. Prefill the position form via router state so they don't
  // re-key the startup + round.
  const canRecordPosition = role === 'admin';
  const [d, setD] = useState(null);
  const loadTicket=useRef(0);
  const [err, setErr] = useState(null);
  const [errState,setErrState]=useState('unavailable');
  const fail=e=>{setErr(e.message||'The request could not be completed.');setErrState(e.status===403||e.status===402?'refused':'unavailable');};
  const [memo, setMemo] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [recusing, setRecusing] = useState(false);
  const [declaration, setDeclaration] = useState('');
  const [pendingDecision,setPendingDecision]=useState(null);
  const [termRows,setTermRows]=useState(null);
  const [newCondition,setNewCondition]=useState('');
  // D1329 (#3490, AF17, the owner's answer B): Fill with Eadwyn on the memo's
  // words only, never its terms, decision or outcome. Its author fills it until
  // it is decided; a voter, a colleague and an admin read its marks.
  const fill = useScopedFill({
    scope: SCOPED_FORMS.icMemo, record: d?.id ?? null, enabled: !!d?.id,
    values: { memo }, onValues: (v) => { if (v.memo != null) setMemo(v.memo); },
  });

  const load = () => {
    const ticket=++loadTicket.current;
    setErr(null);
    api.icGet(uid)
      .then((res) => { if(ticket!==loadTicket.current)return;setD(res); setMemo(res?.memo || ''); })
      .catch((e) => {if(ticket===loadTicket.current)fail(e);});
  };
  useEffect(() => { if(!legacy) { setD(null);load(); } return ()=>{loadTicket.current++;}; }, [uid,legacy]);
  if(legacy) return <Navigate to={`/deals/commit/${encodeURIComponent(uid)}`} replace/>;

  const saveMemo = async () => {
    setBusy(true); setErr(null);
    try { await api.icUpdate(uid, { memo }); await fill.afterSave(d?.id); load(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const castVote = async (vote) => {
    setBusy(true); setErr(null);
    try { await api.icVote(uid, { vote, rationale: rationale || undefined }); setRationale(''); load(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  // A recusal sends the declared conflict as its rationale (the Worker
  // refuses one without it) and is final; a later vote is refused in the
  // Worker's own words, which land in `err`.
  const recuse = async () => {
    const body = recusalBody(declaration);
    if (!body) return;
    setBusy(true); setErr(null);
    try { await api.icVote(uid, body); setDeclaration(''); setRecusing(false); load(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const setField = async (patch) => {
    setBusy(true); setErr(null);
    try { await api.icUpdate(uid, patch); load(); return true; }
    catch (e) { fail(e); return false; } finally { setBusy(false); }
  };

  if (err && !d) {
    return (
      <div className="max-w-3xl mx-auto py-16" role="alert">
        <DataState state={errState} reason={`This IC record could not be read. ${err}`}/>
        <button type="button" onClick={load}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }
  if (!d) return <div className="max-w-3xl mx-auto py-16 text-sm text-gray-500" role="status" aria-live="polite">Reading the IC record…</div>;

  const canVote = roleCanVote && d.status !== 'decided' && (!d.roster?.available || (d.roster.members||[]).some(m=>Number(m.user_id)===Number(user?.id)));
  const canChange = canChangeDecision(user, d);
  const recusal = ownRecusal(user, d.votes);
  const conditions = Array.isArray(d.conditions) ? d.conditions : [];

  return (
    <div className="max-w-6xl mx-auto">
      <Link to="/deals/commit?view=decisions" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-4">
        <ArrowLeft size={14} /> Back to IC Decisions
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <Gavel size={20} />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{d.title}</h1>
      </div>
      <div className="text-sm text-gray-500 mb-3">
        {d.project?.name ? `${d.project.name} · ` : ''}Status: <span className="font-medium">{d.status}</span>
        {d.decision ? ` · Decision: ${d.decision}` : ''}{d.outcome ? ` · Outcome: ${d.outcome}` : ''}
      </div>

      {/* Task #83 — link back to the diligence case this decision was drawn from. */}
      {d.dd_case?.uid && (
        <Link to={`/due-diligence/${d.dd_case.uid}`}
          className="inline-flex items-center gap-1.5 mb-6 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/20">
          <ShieldCheck size={13} /> Diligence: {d.dd_case.subject_label || `Case ${d.dd_case.uid}`}
        </Link>
      )}

      {err && <DataState state={errState} reason={err}/>}

      <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Status',d.status],['Votes',tallyText(d.tally)],['Eligible voters',d.roster?.available?d.roster.eligible:'Not recorded'],['To vote',d.roster?.available?d.roster.to_vote:'Not recorded']].map(([label,value])=><div key={label} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"><dt className="text-xs text-gray-600 dark:text-gray-400">{label}</dt><dd className="text-sm font-bold">{value}</dd></div>)}</dl>
      <div className="grid gap-4 lg:grid-cols-12">
      {/* Memo */}
      <section className="lg:col-span-7 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <FillLabel fill={fill} name="memo" label="Memo" value={memo}>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">IC Memo</h2>
        </FillLabel>
        <FillFormBar fill={fill} />
        {canChange ? (
          <>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={8}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            <button onClick={saveMemo} disabled={busy}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm">
              <Save size={14} /> Save memo
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{d.memo || 'No memo written yet.'}</p>
            <p className="mt-2 text-xs text-gray-500">{AUTHOR_ONLY_LINE}</p>
          </>
        )}
      </section>


      <section className="lg:col-span-5 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="font-semibold">Proposed terms</h2><p className="text-xs text-gray-600 dark:text-gray-400">Lines the author wrote. Nothing is calculated from them.</p>
        {d.terms&&Object.keys(d.terms).length?<dl className="my-3 grid grid-cols-2 gap-2">{Object.entries(d.terms).map(([key,value])=><React.Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>:<p>Not recorded</p>}
        {canChange?<button className="min-h-11 text-violet-700 dark:text-violet-300" onClick={()=>setTermRows(Object.entries(d.terms||{}).map(([label,value])=>({label,value:String(value)})))}>Edit terms</button>:<p className="text-xs text-gray-600 dark:text-gray-400">{AUTHOR_ONLY_LINE}</p>}
      </section>

      {/* Votes */}
      <section className="lg:col-span-7 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Committee vote · {tallyText(d.tally)}
        </h2>
        {d.status==='decided'&&<p className="mb-3 text-sm text-gray-600 dark:text-gray-400">Voting is closed for this decision.</p>}
        {d.roster?.available?<div className="mb-3 text-sm"><h3 className="font-semibold">Voting roster</h3><p>{d.roster.members.map(m=>m.name||'Name not recorded').join(' · ')}</p></div>:<p className="text-xs text-gray-600 dark:text-gray-400">Voting roster: Not recorded.</p>}
        {!canVote&&d.status!=='decided'&&!recusal&&<p>You are not on this decision’s voting roster.</p>}
        {recusal && (
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">You recused yourself from this decision. {RECUSAL_FINAL_LINE}</p>
        )}
        {canVote && !recusal && (
          <div className="mb-3">
            <input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Rationale (required)"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm mb-2" />
            <div className="flex gap-2">
              {VOTES.map((v) => (
                <button key={v} type="button" data-testid={`ic-vote-${v}`} onClick={() => castVote(v)} disabled={busy || d.status==='decided' || !rationale.trim()}
                  title={rationale.trim() ? undefined : 'Every vote records its reason: write the rationale first.'}
                  className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
                  {`Vote ${VOTE_WORDS[v].toLowerCase()}`}
                </button>
              ))}
              <button type="button" onClick={() => setRecusing((x) => !x)} disabled={busy || d.status==='decided'} aria-expanded={recusing}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                Recuse…
              </button>
            </div>
            {recusing && (
              <Sheet title="Recuse from this decision" onClose={()=>!busy&&setRecusing(false)}>
              <div className="p-4">
                {err&&<DataState state={errState} reason={err}/>}
                <label htmlFor="ic-recusal-declaration" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                  Declare the conflict
                </label>
                <textarea id="ic-recusal-declaration" value={declaration} onChange={(e) => setDeclaration(e.target.value)} rows={3}
                  placeholder="What the conflict is, for example a holding in the company or a family tie to a founder"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{RECUSAL_FINAL_LINE}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={recuse} disabled={busy || !declaration.trim()}
                    className="px-3 py-1.5 rounded-lg text-sm bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50">
                    Recuse from this decision
                  </button>
                  <button type="button" onClick={() => { setRecusing(false); setDeclaration(''); }} disabled={busy}
                    className="px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:underline">
                    Cancel
                  </button>
                </div>
              </div></Sheet>
            )}
            {/* Task #83 — each vote auto-drafts a private journal entry (yes→invest,
                no→pass, abstain→defer). The Watchlist page that showed those
                entries was removed (owner, 2026-10-20), so the note that sent
                the voter there is gone too. */}
          </div>
        )}
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {(d.votes || []).map((v, i) => (
            <li key={i} className="py-2 text-sm flex justify-between gap-3">
              <span className="text-gray-700 dark:text-gray-300">{v.user_name || `User ${v.user_id}`}</span>
              <span className="text-gray-500">{voteWord(v.vote)}{v.rationale ? ` — ${v.rationale}` : ''}</span>
            </li>
          ))}
          {(d.votes || []).length === 0 && <li className="py-2 text-sm text-gray-500">No votes yet.</li>}
        </ul>
      </section>

      {/* Conditions belong to this exact record. */}
      <section className="lg:col-span-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Conditions</h2>
        {conditions.length === 0 ? (
          <p className="text-sm text-gray-500">No conditions on this decision.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {conditions.map((cond) => (
              <li key={cond.uid} className="py-2 text-sm flex justify-between gap-3">
                <span className="text-gray-700 dark:text-gray-300">{cond.body}</span>
                <span className="text-gray-500 shrink-0">{CONDITION_WORDS[cond.status] || cond.status}</span>{canChange&&cond.status==='open'&&<span className="flex gap-2">{['met','waived'].map(status=><button key={status} disabled={busy} className="min-h-11 underline" onClick={async()=>{setBusy(true);setErr(null);try{await api.icResolveCondition(cond.uid,status);load();}catch(e){fail(e);}finally{setBusy(false);}}}>{status==='met'?'Mark met':'Waive'}</button>)}</span>}
              </li>
            ))}
          </ul>
        )}
        {canChange?<form className="mt-3 space-y-2" onSubmit={async e=>{e.preventDefault();setBusy(true);setErr(null);try{await api.icAddCondition(uid,{body:newCondition.trim()});setNewCondition('');load();}catch(e){fail(e);}finally{setBusy(false);}}}><label className="block text-sm">Condition<input className="w-full rounded-lg border border-gray-300 bg-transparent p-2 dark:border-gray-700" value={newCondition} onChange={e=>setNewCondition(e.target.value)}/></label><button className="min-h-11 underline" disabled={busy||!newCondition.trim()}>Add condition</button></form>:<p className="text-xs text-gray-600 dark:text-gray-400">{AUTHOR_ONLY_LINE}</p>}
        {canOpenCommitRoom(role) && (
          <Link to="/deals/commit" className="mt-2 inline-block text-sm text-violet-700 dark:text-violet-300 hover:underline">
            Manage conditions on the commit room
          </Link>
        )}
      </section>

      <ICDecisionMinutes uid={uid} />
      {/* Decision + outcome */}
      {canChange && (
        <section className="lg:col-span-12 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Record decision</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {DECISIONS.map((dec) => (
              <button key={dec} onClick={() => setPendingDecision(dec)} disabled={busy}
                className={`px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ${d.decision === dec ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                {dec}
              </button>
            ))}
          </div>
          {/* Task #83 — commit an "invest" decision to the position ledger. */}
          {d.decision === 'invest' && canRecordPosition && (
            <div className="mb-4 -mt-1 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => navigate('/portfolio/positions', {
                  state: {
                    prefill: {
                      project_id: d.project?.id ?? null,
                      startup_name: d.project?.name || '',
                      round_name: d.title || '',
                    },
                  },
                })}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium">
                <PieChart size={14} /> Record position
              </button>
              <span className="text-xs text-gray-500">Prefills the startup &amp; round on the position ledger.</span>
            </div>
          )}
          <div className="text-xs text-gray-500 mb-1">Post-hoc outcome</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map((o) => (
              <button key={o} onClick={() => setField({ outcome: o })} disabled={busy}
                className={`px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ${d.outcome === o ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                {o}
              </button>
            ))}
          </div>
        </section>
      )}
      </div>
      {pendingDecision&&<Sheet title="Record decision" onClose={()=>!busy&&setPendingDecision(null)}><div className="space-y-3 p-4"><p>Record {pendingDecision} for {d.title}? Voting controls close on this page.</p>{err&&<DataState state={errState} reason={err}/>}<button className="min-h-11 rounded-lg bg-violet-600 px-4 text-white" disabled={busy} onClick={async()=>{if(await setField({decision:pendingDecision}))setPendingDecision(null);}}>Confirm record decision</button></div></Sheet>}
      {termRows&&<Sheet title="Edit proposed terms" onClose={()=>!busy&&setTermRows(null)}><form className="space-y-3 p-4" onSubmit={async e=>{e.preventDefault();if(await setField({terms:Object.fromEntries(termRows.filter(t=>t.label.trim()).map(t=>[t.label.trim(),t.value]))}))setTermRows(null);}}>{err&&<DataState state={errState} reason={err}/>}{termRows.map((t,i)=><div key={i} className="space-y-1"><input aria-label={`Term ${i+1}`} className="w-full rounded border border-gray-300 bg-transparent p-2 dark:border-gray-700" value={t.label} onChange={e=>setTermRows(termRows.map((x,j)=>i===j?{...x,label:e.target.value}:x))}/><input aria-label={`Value ${i+1}`} className="w-full rounded border border-gray-300 bg-transparent p-2 dark:border-gray-700" value={t.value} onChange={e=>setTermRows(termRows.map((x,j)=>i===j?{...x,value:e.target.value}:x))}/><button type="button" className="min-h-11 underline" onClick={()=>setTermRows(termRows.filter((_,j)=>j!==i))}>Remove line {i+1}</button></div>)}<button type="button" className="min-h-11 underline" onClick={()=>setTermRows([...termRows,{label:'',value:''}])}>Add a line</button><button className="ml-3 min-h-11 rounded bg-violet-600 px-3 text-white" disabled={busy}>Save terms</button></form></Sheet>}
    </div>
  );
}
