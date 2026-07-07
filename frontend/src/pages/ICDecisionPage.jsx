import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Gavel, Save, ShieldCheck, PieChart } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

const VOTES = ['yes', 'no', 'abstain'];
const DECISIONS = ['invest', 'pass', 'defer'];
const OUTCOMES = ['open', 'vindicated', 'regret'];

export default function ICDecisionPage() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canWrite = ['admin', 'partner', 'investor'].includes(role);
  // Task #83 — after an "invest" decision, admins commit it to the cap-table /
  // position ledger. Prefill the position form via router state so they don't
  // re-key the startup + round.
  const canRecordPosition = role === 'admin';
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [memo, setMemo] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.icGet(uid)
      .then((res) => { setD(res); setMemo(res?.memo || ''); })
      .catch((e) => setErr(e.message || 'Failed to load'));
  };
  useEffect(load, [uid]);

  const saveMemo = async () => {
    setBusy(true); setErr(null);
    try { await api.icUpdate(uid, { memo }); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const castVote = async (vote) => {
    setBusy(true); setErr(null);
    try { await api.icVote(uid, { vote, rationale: rationale || undefined }); setRationale(''); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const setField = async (patch) => {
    setBusy(true); setErr(null);
    try { await api.icUpdate(uid, patch); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (err && !d) return <div className="max-w-3xl mx-auto py-16 text-rose-600">{err}</div>;
  if (!d) return <div className="max-w-3xl mx-auto py-16 text-gray-500">Loading…</div>;

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
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">IC Memo</h2>
        {canWrite ? (
          <>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={8}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm" />
            <button onClick={saveMemo} disabled={busy}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm">
              <Save size={14} /> Save memo
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{d.memo || '—'}</p>
        )}
      </section>

      {/* Votes */}
      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Committee vote · 👍 {d.tally?.yes ?? 0} · 👎 {d.tally?.no ?? 0} · ➖ {d.tally?.abstain ?? 0}
        </h2>
        {canWrite && (
          <div className="mb-3">
            <input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Rationale (optional)"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm mb-2" />
            <div className="flex gap-2">
              {VOTES.map((v) => (
                <button key={v} onClick={() => castVote(v)} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
                  Vote {v}
                </button>
              ))}
            </div>
            {/* Task #83 — each vote auto-drafts a private journal entry (yes→invest,
                no→pass, abstain→defer) you can refine later on your Watchlist. */}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Voting drafts a private journal entry (your rationale becomes the thesis) you can refine on your Watchlist.
            </p>
          </div>
        )}
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {(d.votes || []).map((v, i) => (
            <li key={i} className="py-2 text-sm flex justify-between gap-3">
              <span className="text-gray-700 dark:text-gray-300">{v.user_name || `User ${v.user_id}`}</span>
              <span className="text-gray-500">{v.vote}{v.rationale ? ` — ${v.rationale}` : ''}</span>
            </li>
          ))}
          {(d.votes || []).length === 0 && <li className="py-2 text-sm text-gray-500">No votes yet.</li>}
        </ul>
      </section>

      {/* Decision + outcome */}
      {canWrite && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Record decision</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {DECISIONS.map((dec) => (
              <button key={dec} onClick={() => setField({ decision: dec })} disabled={busy}
                className={`px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ${d.decision === dec ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`}>
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
                className={`px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ${d.outcome === o ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`}>
                {o}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
