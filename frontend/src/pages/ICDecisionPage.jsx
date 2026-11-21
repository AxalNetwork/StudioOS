import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Gavel, Save, ShieldCheck, PieChart, RefreshCw } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';
import { FillFormBar, FillLabel, useScopedFill } from '../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../lib/fillScoped.js';
import {
  canChangeDecision, AUTHOR_ONLY_LINE, recusalBody, RECUSAL_FINAL_LINE, ownRecusal,
  tallyText, VOTE_WORDS, CONDITION_WORDS, canOpenCommitRoom,
} from './icDecisionModel.js';

const VOTES = ['yes', 'no', 'abstain'];
const DECISIONS = ['invest', 'pass', 'defer'];
const OUTCOMES = ['open', 'vindicated', 'regret'];

export default function ICDecisionPage() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  // Every IC member may vote; only the record's author or an Admin may change
  // it (PUT /api/ic/:uid, #6155). Offering the others Save memo, Record
  // decision and Outcome only ever ended in 'Forbidden'.
  const canVote = ['admin', 'partner', 'investor'].includes(role);
  // Task #83 — after an "invest" decision, admins commit it to the cap-table /
  // position ledger. Prefill the position form via router state so they don't
  // re-key the startup + round.
  const canRecordPosition = role === 'admin';
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [memo, setMemo] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [recusing, setRecusing] = useState(false);
  const [declaration, setDeclaration] = useState('');
  // D1329 (#3490, AF17, the owner's answer B): Fill with Eadwyn on the memo's
  // words only, never its terms, decision or outcome. Its author fills it until
  // it is decided; a voter, a colleague and an admin read its marks.
  const fill = useScopedFill({
    scope: SCOPED_FORMS.icMemo, record: d?.id ?? null, enabled: !!d?.id,
    values: { memo }, onValues: (v) => { if (v.memo != null) setMemo(v.memo); },
  });

  const load = () => {
    setErr(null);
    api.icGet(uid)
      .then((res) => { setD(res); setMemo(res?.memo || ''); })
      .catch((e) => setErr(e.message || 'The record could not be read.'));
  };
  useEffect(load, [uid]);

  const saveMemo = async () => {
    setBusy(true); setErr(null);
    try { await api.icUpdate(uid, { memo }); await fill.afterSave(d?.id); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const castVote = async (vote) => {
    setBusy(true); setErr(null);
    try { await api.icVote(uid, { vote, rationale: rationale || undefined }); setRationale(''); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  // A recusal sends the declared conflict as its rationale (the Worker
  // refuses one without it) and is final; a later vote is refused in the
  // Worker's own words, which land in `err`.
  const recuse = async () => {
    const body = recusalBody(declaration);
    if (!body) return;
    setBusy(true); setErr(null);
    try { await api.icVote(uid, body); setDeclaration(''); setRecusing(false); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const setField = async (patch) => {
    setBusy(true); setErr(null);
    try { await api.icUpdate(uid, patch); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (err && !d) {
    return (
      <div className="max-w-3xl mx-auto py-16" role="alert">
        <p className="text-sm text-rose-700 dark:text-rose-300">Unreadable: this IC record could not be read. {err}</p>
        <button type="button" onClick={load}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }
  if (!d) return <div className="max-w-3xl mx-auto py-16 text-sm text-gray-500" role="status" aria-live="polite">Reading the IC record…</div>;

  const canChange = canChangeDecision(user, d);
  const recusal = ownRecusal(user, d.votes);
  const conditions = Array.isArray(d.conditions) ? d.conditions : [];

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/ic" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-4">
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

      {err && <div className="mb-4 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm">{err}</div>}

      {/* Memo */}
      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
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

      {/* Votes */}
      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Committee vote · {tallyText(d.tally)}
        </h2>
        {canVote && recusal && (
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">You recused yourself from this decision. {RECUSAL_FINAL_LINE}</p>
        )}
        {canVote && !recusal && (
          <div className="mb-3">
            <input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Rationale (required)"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm mb-2" />
            <div className="flex gap-2">
              {VOTES.map((v) => (
                <button key={v} onClick={() => castVote(v)} disabled={busy || !rationale.trim()}
                  title={rationale.trim() ? undefined : 'Every vote records its reason: write the rationale first.'}
                  className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
                  Vote {VOTE_WORDS[v].toLowerCase()}
                </button>
              ))}
              <button type="button" onClick={() => setRecusing((x) => !x)} disabled={busy} aria-expanded={recusing}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                Recuse…
              </button>
            </div>
            {recusing && (
              <div className="mt-3 p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
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
              </div>
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
              <span className="text-gray-500">{VOTE_WORDS[v.vote] || v.vote}{v.rationale ? ` — ${v.rationale}` : ''}</span>
            </li>
          ))}
          {(d.votes || []).length === 0 && <li className="py-2 text-sm text-gray-500">No votes yet.</li>}
        </ul>
      </section>

      {/* Conditions, read-only here: they are kept on the commit room. */}
      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Conditions</h2>
        {conditions.length === 0 ? (
          <p className="text-sm text-gray-500">No conditions on this decision.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {conditions.map((cond) => (
              <li key={cond.uid} className="py-2 text-sm flex justify-between gap-3">
                <span className="text-gray-700 dark:text-gray-300">{cond.body}</span>
                <span className="text-gray-500 shrink-0">{CONDITION_WORDS[cond.status] || cond.status}</span>
              </li>
            ))}
          </ul>
        )}
        {canOpenCommitRoom(role) && (
          <Link to="/deals/commit" className="mt-2 inline-block text-sm text-violet-700 dark:text-violet-300 hover:underline">
            Manage conditions on the commit room
          </Link>
        )}
      </section>

      {/* Decision + outcome */}
      {canChange && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Record decision</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {DECISIONS.map((dec) => (
              <button key={dec} onClick={() => setField({ decision: dec })} disabled={busy}
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
  );
}
